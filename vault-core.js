/* =========================================================================
   RDESK SENTINEL — COFRE MULTI-CARTEIRA, BIOMETRIA, ORÁCULO & RECEBER/ENVIAR
   Arquivo 3 de 7: vault-core.js
   Expõe: window.RdeskVault e window.RdeskWallet (compatibilidade total)
   ========================================================================= */

(function () {
    'use strict';

    const VAULT_STORAGE_KEY = 'rdesk_multi_vault_v2';
    const BIO_STORAGE_KEY = 'rdesk_bio_passkey_v2';
    const LEGACY_KEYS = ['rdesk_vault_v1', 'rdesk_wallet_vault', 'rdesk_bio_v1'];

    const CHAIN_RPCS = {
        137:   'https://polygon-bor-rpc.publicnode.com',
        42161: 'https://arb1.arbitrum.io/rpc',
        8453:  'https://mainnet.base.org',
        10:    'https://mainnet.optimism.io',
        1:     'https://ethereum-rpc.publicnode.com'
    };

    const POLYGON_RPCS = [
        'https://polygon-bor-rpc.publicnode.com',
        'https://1rpc.io/matic',
        'https://polygon.drpc.org',
        'https://polygon-rpc.com'
    ];

    const ERC20_ABI = [
        'function balanceOf(address) view returns (uint256)',
        'function transfer(address to, uint256 amount) returns (bool)'
    ];

    const TOKENS_META = {
        POL:   { symbol: 'POL',   name: 'Polygon Ecosystem Token • Rede Polygon', address: null, decimals: 18 },
        WPOL:  { symbol: 'WPOL',  name: 'Wrapped POL • Rede Polygon',             address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', decimals: 18 },
        USDT0: { symbol: 'USDT0', name: 'Tether USD (USDT0) • Rede Polygon',      address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
        USDC:  { symbol: 'USDC',  name: 'USD Coin (Nativo) • Rede Polygon',       address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
        BRZ:   { symbol: 'BRZ',   name: 'Brazilian Digital Token • Rede Polygon', address: '0x4eD141110F6EeeAbA9A1df36d8c26f684d2475Dc', decimals: 18 },
        BRLA:  { symbol: 'BRLA',  name: 'BRLA Digital • Rede Polygon',            address: '0xE6A537a407488807F0bbeb0038B79004f19DDDFb', decimals: 18 }
    };

    let state = {
        accounts: [],          // [{ id, name, address, type: 'seed'|'pk'|'rabby'|'watch', hdIndex, seedGroupId, pinned }]
        activeAccountId: null,
        unlockedSecrets: null, // { masterSeedMap, pkMap, password }
        isLocked: true,
        hasLegacyCorrupted: false,
        rabbyProvider: null,
        balancesCache: {},     // { [addrLower]: { brl, usd, summary, tokens: { POL, WPOL, USDT0, USDC, BRZ, BRLA }, polUsd, usdBrl } }
        prices: {
            usdBrl: 5.65,
            polUsd: 0.088,
            updatedAt: 0
        }
    };

    let currentView = 'list'; // 'list' | 'unlock' | 'add' | 'form' | 'detail' | 'receive' | 'send'
    let activeFormMode = 'create-seed';
    let inspectingAccountId = null;
    let createSeedDraft = null;
    const changeListeners = [];

    // =========================================================================
    // 1. UTILITÁRIOS SEGUROS (CLIPBOARD WEBVIEW & BASE64URL)
    // =========================================================================
    async function copyToClipboardSafe(text) {
        const str = String(text || '');
        if (!str) return false;
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(str);
                return true;
            }
        } catch (e) {}

        try {
            const ta = document.createElement('textarea');
            ta.value = str;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            ta.setSelectionRange(0, str.length);
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch (e) {
            return false;
        }
    }

    function bytesToBase64(bytes) {
        const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < arr.length; i += chunk) {
            binary += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
        }
        return btoa(binary);
    }

    function safeBase64ToBytes(str) {
        if (!str || typeof str !== 'string') {
            throw new Error('Dado codificado ausente ou inválido.');
        }
        let clean = str.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
            throw new Error('Formato Base64 incompatível com a versão atual do cofre.');
        }
        while (clean.length % 4 !== 0) clean += '=';
        const binary = atob(clean);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    // =========================================================================
    // 2. ORÁCULO DE PREÇOS & SALDOS COM ALIASES COMPLETOS (USDT = USDT0)
    // =========================================================================
    function getNormalizedPricesObject() {
        const usdBrl = state.prices.usdBrl > 0 ? state.prices.usdBrl : 5.65;
        const polUsd = state.prices.polUsd > 0 ? state.prices.polUsd : 0.088;
        const polBrl = polUsd * usdBrl;
        const brlToUsd = 1 / usdBrl;

        return {
            usdBrl,
            brlPerUsd: usdBrl,
            usdToBrl: usdBrl,
            polUsd,
            polToUsd: polUsd,
            polBrl,
            polToBrl: polBrl,
            maticUsd: polUsd,
            wpolUsd: polUsd,
            wpolBrl: polBrl,
            usdtUsd: 1.0,
            usdt0Usd: 1.0,
            usdcUsd: 1.0,
            usdtBrl: usdBrl,
            usdt0Brl: usdBrl,
            usdcBrl: usdBrl,
            brzUsd: brlToUsd,
            brzBrl: 1.0,
            brlaUsd: brlToUsd,
            brlaBrl: 1.0,
            POL: polUsd,
            MATIC: polUsd,
            WPOL: polUsd,
            WMATIC: polUsd,
            USDT: 1.0,
            USDT0: 1.0,
            USDC: 1.0,
            BRZ: brlToUsd,
            BRLA: brlToUsd,
            updatedAt: state.prices.updatedAt || Date.now()
        };
    }

    async function refreshLiveMarketPrices() {
        try {
            const [fxRes, polRes] = await Promise.all([
                fetch('https://economia.awesomeapi.com.br/last/USD-BRL').then((r) => r.json()).catch(() => null),
                fetch('https://coins.llama.fi/prices/current/polygon:0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270').then((r) => r.json()).catch(() => null)
            ]);
            if (fxRes?.USDBRL?.bid) {
                const parsedFx = parseFloat(fxRes.USDBRL.bid);
                if (Number.isFinite(parsedFx) && parsedFx > 0) state.prices.usdBrl = parsedFx;
            }
            const polPrice = polRes?.coins?.['polygon:0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270']?.price;
            if (polPrice && Number.isFinite(parseFloat(polPrice))) {
                state.prices.polUsd = parseFloat(polPrice);
            }
            state.prices.updatedAt = Date.now();
        } catch (e) {}
        return getNormalizedPricesObject();
    }

    function getPricesSyncOrRefresh() {
        if (Date.now() - (state.prices.updatedAt || 0) > 25000) {
            refreshLiveMarketPrices().catch(() => {});
        }
        return getNormalizedPricesObject();
    }

    function getActiveAccountBalances() {
        const acc = getActiveAccount();
        const cached = acc ? state.balancesCache[acc.address.toLowerCase()] : null;
        const pol = cached?.tokens?.POL || 0;
        const wpol = cached?.tokens?.WPOL || 0;
        const usdt0 = cached?.tokens?.USDT0 || 0;
        const usdc = cached?.tokens?.USDC || 0;
        const brz = cached?.tokens?.BRZ || 0;
        const brla = cached?.tokens?.BRLA || 0;

        return {
            pol,
            matic: pol,
            wpol,
            wmatic: wpol,
            usdt0,
            usdt: usdt0,
            usdc,
            brz,
            brla,
            POL: pol,
            MATIC: pol,
            WPOL: wpol,
            WMATIC: wpol,
            USDT0: usdt0,
            USDT: usdt0,
            USDC: usdc,
            BRZ: brz,
            BRLA: brla,
            totalUsd: cached?.usd || 0,
            totalBrl: cached?.brl || 0
        };
    }

    function getSingleTokenBalance(symbol) {
        const sym = String(symbol || '').toUpperCase();
        const bals = getActiveAccountBalances();
        return Number(bals[sym] ?? bals[sym.toLowerCase()] ?? 0);
    }

    // =========================================================================
    // 3. CRIPTOGRAFIA AES-256-GCM + PBKDF2
    // =========================================================================
    async function deriveAesKey(password, saltBytes, usages) {
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(String(password)),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: saltBytes, iterations: 150000, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            usages
        );
    }

    async function encryptSecretsPayload(secretsObj, password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveAesKey(password, salt, ['encrypt']);
        const encoded = new TextEncoder().encode(JSON.stringify(secretsObj));
        const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

        return {
            version: 2,
            saltB64: bytesToBase64(salt),
            ivB64: bytesToBase64(iv),
            cipherB64: bytesToBase64(new Uint8Array(cipherBuf))
        };
    }

    async function decryptSecretsPayload(encryptedBlob, password) {
        if (!encryptedBlob || !encryptedBlob.saltB64 || !encryptedBlob.ivB64 || !encryptedBlob.cipherB64) {
            throw new Error('Cofre local vazio ou em formato antigo.');
        }
        const salt = safeBase64ToBytes(encryptedBlob.saltB64);
        const iv = safeBase64ToBytes(encryptedBlob.ivB64);
        const cipher = safeBase64ToBytes(encryptedBlob.cipherB64);
        const key = await deriveAesKey(password, salt, ['decrypt']);

        try {
            const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
            return JSON.parse(new TextDecoder().decode(plainBuf));
        } catch (e) {
            throw new Error('Senha/PIN incorreto.');
        }
    }

    function readVaultMetaFromStorage() {
        try {
            const raw = localStorage.getItem(VAULT_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && Array.isArray(parsed.accounts)) return parsed;
            }
            for (const oldKey of LEGACY_KEYS) {
                if (localStorage.getItem(oldKey)) {
                    state.hasLegacyCorrupted = true;
                    break;
                }
            }
        } catch (e) {
            state.hasLegacyCorrupted = true;
        }
        return null;
    }

    async function persistVaultToStorage() {
        const existing = readVaultMetaFromStorage();
        let encryptedSecrets = existing?.encryptedSecrets || null;

        if (state.unlockedSecrets && state.unlockedSecrets.password) {
            encryptedSecrets = await encryptSecretsPayload(
                {
                    masterSeedMap: state.unlockedSecrets.masterSeedMap || {},
                    pkMap: state.unlockedSecrets.pkMap || {}
                },
                state.unlockedSecrets.password
            );
        }

        const payload = {
            version: 2,
            accounts: state.accounts,
            activeAccountId: state.activeAccountId,
            encryptedSecrets
        };
        localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(payload));
        state.hasLegacyCorrupted = false;
    }

    function hardResetCorruptedVault() {
        LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
        localStorage.removeItem(VAULT_STORAGE_KEY);
        localStorage.removeItem(BIO_STORAGE_KEY);
        state.accounts = [];
        state.activeAccountId = null;
        state.unlockedSecrets = null;
        state.isLocked = false;
        state.hasLegacyCorrupted = false;
        notifyAccountChanged();
        renderModal();
    }

    // =========================================================================
    // 4. BIOMETRIA / WINDOWS HELLO
    // =========================================================================
    function isBiometryRegistered() {
        try {
            const raw = localStorage.getItem(BIO_STORAGE_KEY);
            if (!raw) return false;
            const parsed = JSON.parse(raw);
            return Boolean(parsed && parsed.credIdB64 && parsed.wrapKeyB64 && parsed.wrappedPassB64 && parsed.ivB64);
        } catch (e) {
            return false;
        }
    }

    async function registerDeviceBiometry(password) {
        if (!window.PublicKeyCredential || !navigator.credentials) {
            throw new Error('Este navegador não suporta biometria WebAuthn.');
        }
        if (!password) {
            throw new Error('Desbloqueie o cofre com sua senha primeiro para ativar a biometria.');
        }

        const credential = await navigator.credentials.create({
            publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)),
                rp: { name: 'RDESK SENTINEL', id: window.location.hostname || undefined },
                user: {
                    id: crypto.getRandomValues(new Uint8Array(16)),
                    name: 'rdesk-autocustodia',
                    displayName: 'Cofre RDESK SENTINEL'
                },
                pubKeyCredParams: [
                    { type: 'public-key', alg: -7 },
                    { type: 'public-key', alg: -257 }
                ],
                authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
                timeout: 60000,
                attestation: 'none'
            }
        });

        if (!credential || !credential.rawId) {
            throw new Error('Cadastro biométrico cancelado no aparelho.');
        }

        const wrapKeyRaw = crypto.getRandomValues(new Uint8Array(32));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cryptoKey = await crypto.subtle.importKey('raw', wrapKeyRaw, { name: 'AES-GCM' }, false, ['encrypt']);
        const wrappedBuf = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            cryptoKey,
            new TextEncoder().encode(password)
        );

        localStorage.setItem(BIO_STORAGE_KEY, JSON.stringify({
            credIdB64: bytesToBase64(new Uint8Array(credential.rawId)),
            wrapKeyB64: bytesToBase64(wrapKeyRaw),
            wrappedPassB64: bytesToBase64(new Uint8Array(wrappedBuf)),
            ivB64: bytesToBase64(iv)
        }));
        return true;
    }

    async function unlockWithBiometry() {
        const raw = localStorage.getItem(BIO_STORAGE_KEY);
        if (!raw) {
            throw new Error('Biometria ainda não ativada neste aparelho. Desbloqueie com sua senha e clique em "Ativar Biometria".');
        }
        const bioRecord = JSON.parse(raw);
        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)),
                rpId: window.location.hostname || undefined,
                allowCredentials: [{ type: 'public-key', id: safeBase64ToBytes(bioRecord.credIdB64) }],
                userVerification: 'required',
                timeout: 60000
            }
        });
        if (!assertion) throw new Error('Verificação biométrica não concluída.');

        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            safeBase64ToBytes(bioRecord.wrapKeyB64),
            { name: 'AES-GCM' },
            false,
            ['decrypt']
        );
        const passBuf = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: safeBase64ToBytes(bioRecord.ivB64) },
            cryptoKey,
            safeBase64ToBytes(bioRecord.wrappedPassB64)
        );
        await unlockVaultWithPassword(new TextDecoder().decode(passBuf));
        return true;
    }

    async function unlockVaultWithPassword(password) {
        const meta = readVaultMetaFromStorage();
        if (!meta || !meta.encryptedSecrets) throw new Error('Nenhum cofre local encontrado.');
        const secrets = await decryptSecretsPayload(meta.encryptedSecrets, password);
        state.unlockedSecrets = {
            masterSeedMap: secrets.masterSeedMap || {},
            pkMap: secrets.pkMap || {},
            password
        };
        state.isLocked = false;
        notifyAccountChanged();
    }

    function lockVaultNow() {
        state.unlockedSecrets = null;
        state.isLocked = true;
        notifyAccountChanged();
        renderModal();
    }

    // =========================================================================
    // 5. OPERAÇÕES MULTI-CARTEIRA
    // =========================================================================
    function getActiveAccount() {
        if (!state.accounts.length) return null;
        return state.accounts.find((a) => a.id === state.activeAccountId) || state.accounts[0];
    }

    function getPublicWalletState() {
        const acc = getActiveAccount();
        const address = acc ? acc.address : '';
        return {
            address,
            account: acc,
            balances: getActiveAccountBalances(),
            prices: getPricesSyncOrRefresh(),
            isConnected: Boolean(address),
            isUnlocked: !state.isLocked,
            isLocked: state.isLocked,
            isWatchOnly: acc?.type === 'watch',
            mode: acc?.type || 'none',
            label: acc?.name || ''
        };
    }

    function requiresVaultPasswordSetup() {
        const meta = readVaultMetaFromStorage();
        return !state.unlockedSecrets && !(meta && meta.encryptedSecrets);
    }

    async function ensureUnlockedSecrets(passwordIfNeeded) {
        if (state.unlockedSecrets) return state.unlockedSecrets;
        const meta = readVaultMetaFromStorage();
        if (meta && meta.encryptedSecrets) {
            if (!passwordIfNeeded) {
                throw new Error('Cofre bloqueado. Informe sua Senha/PIN ou desbloqueie com Biometria primeiro.');
            }
            await unlockVaultWithPassword(passwordIfNeeded);
            return state.unlockedSecrets;
        }
        if (!passwordIfNeeded || passwordIfNeeded.length < 4) {
            throw new Error('Defina uma Senha/PIN de pelo menos 4 caracteres para proteger seu cofre.');
        }
        state.unlockedSecrets = { masterSeedMap: {}, pkMap: {}, password: passwordIfNeeded };
        state.isLocked = false;
        return state.unlockedSecrets;
    }

    async function addAccountFromMnemonic({ mnemonic, name, hdIndex = 0, password, enableBio = false }) {
        const cleanPhrase = String(mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (!ethers.utils.isValidMnemonic(cleanPhrase)) {
            throw new Error('Frase-semente inválida. Verifique as 12 ou 24 palavras em inglês.');
        }

        const secrets = await ensureUnlockedSecrets(password);
        const path = `m/44'/60'/0'/0/${Number(hdIndex) || 0}`;
        const hdNode = ethers.utils.HDNode.fromMnemonic(cleanPhrase).derivePath(path);
        const address = ethers.utils.getAddress(hdNode.address);

        let seedGroupId = Object.keys(secrets.masterSeedMap).find((k) => secrets.masterSeedMap[k] === cleanPhrase);
        if (!seedGroupId) {
            seedGroupId = 'seed-' + Date.now();
            secrets.masterSeedMap[seedGroupId] = cleanPhrase;
        }

        const existing = state.accounts.find((a) => a.address.toLowerCase() === address.toLowerCase());
        if (existing) {
            existing.name = name?.trim() || existing.name;
            existing.type = 'seed';
            existing.seedGroupId = seedGroupId;
            existing.hdIndex = Number(hdIndex) || 0;
            state.activeAccountId = existing.id;
        } else {
            const acc = {
                id: 'acc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
                name: (name && name.trim()) || `Carteira #${state.accounts.length + 1}`,
                address,
                type: 'seed',
                seedGroupId,
                hdIndex: Number(hdIndex) || 0,
                pinned: state.accounts.length === 0
            };
            state.accounts.push(acc);
            state.activeAccountId = acc.id;
        }

        await persistVaultToStorage();
        if (enableBio) {
            await registerDeviceBiometry(secrets.password).catch(() => {});
        }
        notifyAccountChanged();
        await refreshAllAccountsBalances();
    }

    async function deriveNextAccountFromSeed(seedGroupId) {
        if (!state.unlockedSecrets || !state.unlockedSecrets.masterSeedMap[seedGroupId]) {
            throw new Error('Desbloqueie o cofre para derivar novas contas desta frase-semente.');
        }
        const phrase = state.unlockedSecrets.masterSeedMap[seedGroupId];
        const siblings = state.accounts.filter((a) => a.seedGroupId === seedGroupId);
        const usedIndices = new Set(siblings.map((a) => Number(a.hdIndex || 0)));
        let nextIdx = 0;
        while (usedIndices.has(nextIdx)) nextIdx++;

        await addAccountFromMnemonic({
            mnemonic: phrase,
            name: `Conta Seed #${nextIdx + 1}`,
            hdIndex: nextIdx
        });
    }

    async function addAccountFromPrivateKey({ privateKey, name, password, enableBio = false }) {
        let pk = String(privateKey || '').trim();
        if (!pk.startsWith('0x')) pk = '0x' + pk;
        let wallet;
        try {
            wallet = new ethers.Wallet(pk);
        } catch (e) {
            throw new Error('Chave privada inválida. Deve conter 64 caracteres hexadecimais.');
        }

        const secrets = await ensureUnlockedSecrets(password);
        const address = ethers.utils.getAddress(wallet.address);

        let acc = state.accounts.find((a) => a.address.toLowerCase() === address.toLowerCase());
        if (acc) {
            acc.name = (name && name.trim()) || acc.name;
            acc.type = 'pk';
        } else {
            acc = {
                id: 'acc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
                name: (name && name.trim()) || `Chave Importada #${state.accounts.length + 1}`,
                address,
                type: 'pk',
                pinned: state.accounts.length === 0
            };
            state.accounts.push(acc);
        }

        secrets.pkMap[acc.id] = wallet.privateKey;
        state.activeAccountId = acc.id;

        await persistVaultToStorage();
        if (enableBio) {
            await registerDeviceBiometry(secrets.password).catch(() => {});
        }
        notifyAccountChanged();
        await refreshAllAccountsBalances();
    }

    async function addWatchOnlyAccount({ address, name }) {
        const raw = String(address || '').trim();
        if (!ethers.utils.isAddress(raw)) {
            throw new Error('Endereço Ethereum/Polygon inválido (deve começar com 0x...).');
        }
        const checksumAddr = ethers.utils.getAddress(raw);
        let acc = state.accounts.find((a) => a.address.toLowerCase() === checksumAddr.toLowerCase());
        if (!acc) {
            acc = {
                id: 'acc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
                name: (name && name.trim()) || `Observação ${checksumAddr.slice(0, 6)}`,
                address: checksumAddr,
                type: 'watch',
                pinned: false
            };
            state.accounts.push(acc);
        }
        state.activeAccountId = acc.id;
        await persistVaultToStorage();
        notifyAccountChanged();
        await refreshAllAccountsBalances();
    }

    async function upsertRabbyAccount(rawAddress, providerObj, makeActive = true) {
        if (!rawAddress || !ethers.utils.isAddress(rawAddress)) return;
        const checksumAddr = ethers.utils.getAddress(rawAddress);
        let acc = state.accounts.find((a) => a.address.toLowerCase() === checksumAddr.toLowerCase());
        if (!acc) {
            acc = {
                id: 'acc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
                name: providerObj?.isRabby ? 'Rabby Conectada' : 'Carteira Web3',
                address: checksumAddr,
                type: 'rabby',
                pinned: true
            };
            state.accounts.push(acc);
        }
        if (makeActive || !state.activeAccountId) {
            state.activeAccountId = acc.id;
        }
        await persistVaultToStorage();
        notifyAccountChanged();
        await refreshAllAccountsBalances();
    }

    function resolveInjectedWeb3Provider() {
        if (state.rabbyProvider) return state.rabbyProvider;
        if (window.rabby) return window.rabby;
        if (window.ethereum) {
            if (Array.isArray(window.ethereum.providers)) {
                const rabby = window.ethereum.providers.find((p) => p.isRabby);
                if (rabby) return rabby;
            }
            return window.ethereum;
        }
        return null;
    }

    async function switchChainOnProvider(chainId = 137) {
        const targetId = Number(chainId) || 137;
        const hexChainId = '0x' + targetId.toString(16);
        const acc = getActiveAccount();
        if (!acc || acc.type !== 'rabby') return true;

        const eth = resolveInjectedWeb3Provider();
        if (!eth) return false;
        try {
            await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }] });
            return true;
        } catch (switchErr) {
            if (switchErr && switchErr.code === 4902 && targetId === 137) {
                await eth.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: '0x89',
                        chainName: 'Polygon Mainnet',
                        nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
                        rpcUrls: ['https://polygon-bor-rpc.publicnode.com'],
                        blockExplorerUrls: ['https://polygonscan.com/']
                    }]
                });
                return true;
            }
            throw switchErr;
        }
    }

    async function connectRabbyExtension() {
        window.dispatchEvent(new Event('eip6963:requestProvider'));
        await new Promise((r) => setTimeout(r, 80));

        const eth = resolveInjectedWeb3Provider();
        if (!eth) {
            throw new Error('Extensão Rabby/Web3 não detectada neste navegador. No celular, abra o site dentro do navegador interno da Rabby Wallet ou importe sua Seed/Chave Privada.');
        }

        const accounts = await eth.request({ method: 'eth_requestAccounts' });
        if (!accounts || !accounts.length) {
            throw new Error('Nenhuma conta autorizada na Rabby Wallet.');
        }

        await switchChainOnProvider(137).catch(() => {});
        await upsertRabbyAccount(accounts[0], eth, true);
    }

    async function switchActiveAccount(accountId) {
        const target = state.accounts.find((a) => a.id === accountId);
        if (!target) return;
        state.activeAccountId = target.id;
        await persistVaultToStorage();
        notifyAccountChanged();
        await refreshAllAccountsBalances();
    }

    async function deleteSingleAccount(accountId) {
        state.accounts = state.accounts.filter((a) => a.id !== accountId);
        if (state.unlockedSecrets && state.unlockedSecrets.pkMap) {
            delete state.unlockedSecrets.pkMap[accountId];
        }
        if (state.activeAccountId === accountId) {
            state.activeAccountId = state.accounts[0]?.id || null;
        }
        await persistVaultToStorage();
        notifyAccountChanged();
    }

    function exportAccountSecrets(accountId) {
        const acc = state.accounts.find((a) => a.id === accountId);
        if (!acc) throw new Error('Carteira não encontrada.');
        if (acc.type === 'watch' || acc.type === 'rabby') {
            throw new Error('Contas externas/observação não possuem chave armazenada neste cofre.');
        }
        if (!state.unlockedSecrets) {
            throw new Error('Cofre bloqueado. Desbloqueie primeiro.');
        }

        if (acc.type === 'pk') {
            const pk = state.unlockedSecrets.pkMap[acc.id];
            if (!pk) throw new Error('Chave privada não localizada.');
            return { privateKey: pk, mnemonic: null };
        }

        if (acc.type === 'seed') {
            const phrase = state.unlockedSecrets.masterSeedMap[acc.seedGroupId];
            if (!phrase) throw new Error('Frase-semente não localizada.');
            const path = `m/44'/60'/0'/0/${Number(acc.hdIndex) || 0}`;
            const node = ethers.utils.HDNode.fromMnemonic(phrase).derivePath(path);
            return { privateKey: node.privateKey, mnemonic: phrase };
        }
        throw new Error('Tipo de conta desconhecido.');
    }

    // =========================================================================
    // 6. PROVIDER, SIGNER MULTI-CHAIN & LEITURA DE SALDOS REAIS
    // =========================================================================
    function getReadProvider(chainId = 137) {
        const rpc = CHAIN_RPCS[Number(chainId)] || POLYGON_RPCS[0];
        return new ethers.providers.JsonRpcProvider(rpc);
    }

    async function getActiveSigner(chainId = 137) {
        const acc = getActiveAccount();
        if (!acc) {
            openWalletModal('add');
            throw new Error('Nenhuma carteira ativa. Crie ou importe uma carteira primeiro.');
        }
        if (acc.type === 'watch') {
            throw new Error(`A carteira "${acc.name}" está em Modo Observação (apenas leitura). Importe a Seed ou Chave Privada para assinar.`);
        }
        if (acc.type === 'rabby') {
            const eth = resolveInjectedWeb3Provider();
            if (!eth) throw new Error('Extensão Rabby não encontrada.');
            await eth.request({ method: 'eth_requestAccounts' });
            if (chainId) {
                await switchChainOnProvider(chainId).catch(() => {});
            }
            return new ethers.providers.Web3Provider(eth).getSigner();
        }
        if (state.isLocked || !state.unlockedSecrets) {
            openWalletModal('unlock');
            throw new Error('Cofre bloqueado. Desbloqueie com sua Biometria ou Senha/PIN.');
        }
        const { privateKey } = exportAccountSecrets(acc.id);
        return new ethers.Wallet(privateKey, getReadProvider(chainId));
    }

    async function refreshAllAccountsBalances() {
        if (!state.accounts.length) return getActiveAccountBalances();
        await refreshLiveMarketPrices();

        try {
            const provider = getReadProvider(137);
            const wpol = new ethers.Contract(TOKENS_META.WPOL.address, ERC20_ABI, provider);
            const usdt = new ethers.Contract(TOKENS_META.USDT0.address, ERC20_ABI, provider);
            const usdc = new ethers.Contract(TOKENS_META.USDC.address, ERC20_ABI, provider);
            const brz = new ethers.Contract(TOKENS_META.BRZ.address, ERC20_ABI, provider);
            const brla = new ethers.Contract(TOKENS_META.BRLA.address, ERC20_ABI, provider);

            await Promise.all(state.accounts.map(async (acc) => {
                try {
                    const [bPol, bWpol, bUsdt, bUsdc, bBrz, bBrla] = await Promise.all([
                        provider.getBalance(acc.address),
                        wpol.balanceOf(acc.address),
                        usdt.balanceOf(acc.address),
                        usdc.balanceOf(acc.address).catch(() => ethers.BigNumber.from(0)),
                        brz.balanceOf(acc.address),
                        brla.balanceOf(acc.address)
                    ]);

                    const polNum = parseFloat(ethers.utils.formatEther(bPol));
                    const wpolNum = parseFloat(ethers.utils.formatEther(bWpol));
                    const usdtNum = parseFloat(ethers.utils.formatUnits(bUsdt, 6));
                    const usdcNum = parseFloat(ethers.utils.formatUnits(bUsdc, 6));
                    const brzNum = parseFloat(ethers.utils.formatEther(bBrz));
                    const brlaNum = parseFloat(ethers.utils.formatEther(bBrla));

                    const totalUsd = ((polNum + wpolNum) * state.prices.polUsd) + usdtNum + usdcNum + ((brzNum + brlaNum) / state.prices.usdBrl);
                    const totalBrl = totalUsd * state.prices.usdBrl;

                    state.balancesCache[acc.address.toLowerCase()] = {
                        brl: totalBrl,
                        usd: totalUsd,
                        summary: `${(polNum + wpolNum).toFixed(2)} POL • ${usdtNum.toFixed(2)} USDT0`,
                        tokens: { POL: polNum, WPOL: wpolNum, USDT0: usdtNum, USDC: usdcNum, BRZ: brzNum, BRLA: brlaNum },
                        polUsd: state.prices.polUsd,
                        usdBrl: state.prices.usdBrl
                    };
                } catch (e) {}
            }));

            notifyAccountChanged(true);
            if (currentView === 'list') renderModal();
        } catch (e) {}

        return getActiveAccountBalances();
    }

    // =========================================================================
    // 7. SINCRONIZAÇÃO COM PAINEL PRINCIPAL & MÓDULO DE SWAP / PIX
    // =========================================================================
    function syncMainDashboardDom(triggerSwapRefresh = false) {
        const acc = getActiveAccount();
        const topBtn = document.querySelector('#btn-wallet-trigger, #wallet-chip-btn, #btn-connect-wallet, [data-wallet-open]');
        if (topBtn) {
            if (!acc) {
                topBtn.textContent = '🔑 Conectar / Criar Carteira';
            } else {
                const lockIcon = (acc.type === 'seed' || acc.type === 'pk')
                    ? (state.isLocked ? '🔒' : '🔓')
                    : (acc.type === 'rabby' ? '🦊' : '👁️');
                topBtn.textContent = `${lockIcon} ${acc.name} (${acc.address.slice(0, 6)}..${acc.address.slice(-4)})`;
            }
        }

        const banner = document.getElementById('wallet-lock-banner');
        if (banner) {
            const needsUnlock = acc && (acc.type === 'seed' || acc.type === 'pk') && state.isLocked;
            banner.style.display = needsUnlock ? 'flex' : 'none';
        }

        const badgeTarget = document.getElementById('hero-wallet-badge') || document.getElementById('active-wallet-badge');
        if (badgeTarget) {
            if (!acc) {
                badgeTarget.textContent = 'Nenhuma carteira ativa';
            } else {
                const modeLabel = acc.type === 'rabby'
                    ? '🦊 Rabby Conectada'
                    : (acc.type === 'watch'
                        ? '👁️ Modo Observação'
                        : (state.isLocked ? '🔒 Cofre Local (Leitura)' : '🔓 Cofre Desbloqueado'));
                badgeTarget.textContent = `${modeLabel} • ${acc.address.slice(0, 6)}...${acc.address.slice(-4)}`;
                badgeTarget.style.cursor = 'pointer';
                badgeTarget.title = 'Toque para copiar o endereço completo';
                badgeTarget.onclick = async () => {
                    await copyToClipboardSafe(acc.address);
                    const prev = badgeTarget.textContent;
                    badgeTarget.textContent = '✅ Endereço copiado!';
                    setTimeout(() => { badgeTarget.textContent = prev; }, 1500);
                };
            }
        }

        const cached = acc ? state.balancesCache[acc.address.toLowerCase()] : null;
        if (acc && cached) {
            const totalBrlEl = document.getElementById('hero-total-brl') || document.getElementById('total-patrimonio-brl');
            const totalUsdEl = document.getElementById('hero-total-usd') || document.getElementById('total-patrimonio-usd');

            if (totalBrlEl && cached.brl >= 0) {
                totalBrlEl.textContent = cached.brl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            }
            if (totalUsdEl && cached.usd >= 0) {
                totalUsdEl.textContent = `$ ${cached.usd.toFixed(2)} • Cotação Dólar: R$ ${cached.usdBrl.toFixed(3)}`;
            }

            const freePill = document.getElementById('hero-free-brl');
            if (freePill) {
                freePill.textContent = `Livre na Carteira: ${cached.brl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
            }

            const swapInSelect = document.querySelector('#swap-from-token, #swap-token-in, select[data-swap-from]');
            const swapAvailEl = document.querySelector('#swap-available-amount, #swap-in-bal, [data-swap-available]');
            if (swapInSelect && swapAvailEl) {
                const sym = String(swapInSelect.value || 'POL').toUpperCase();
                const bal = getSingleTokenBalance(sym);
                swapAvailEl.textContent = bal.toFixed(4);
            }

            if (triggerSwapRefresh) {
                const swapInput = document.querySelector('#swap-from-amount, #swap-amount-in, input[data-swap-amount]');
                if (swapInput) {
                    swapInput.dispatchEvent(new Event('input', { bubbles: true }));
                    swapInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        }
    }

    function notifyAccountChanged(fromBalanceLoad = false) {
        const pubState = getPublicWalletState();
        const addr = pubState.address;
        const acc = pubState.account;

        const legacyInput = document.getElementById('wallet-address');
        if (legacyInput) legacyInput.value = addr;

        syncMainDashboardDom(fromBalanceLoad);

        const events = fromBalanceLoad
            ? ['rdesk:balancesUpdated', 'rdesk:walletChanged', 'wallet:changed']
            : ['rdesk:walletChanged', 'rdesk:wallet-changed', 'rdesk-wallet-changed', 'wallet:changed', 'walletChanged'];

        events.forEach((evName) => {
            try {
                window.dispatchEvent(new CustomEvent(evName, { detail: pubState }));
                document.dispatchEvent(new CustomEvent(evName, { detail: pubState }));
            } catch (e) {}
        });

        changeListeners.forEach((fn) => {
            try { fn(addr, acc, pubState); } catch (e) {}
        });

        // Aciona Auditoria e Motor de Pools quando a carteira muda (evita loop durante refresh de saldo)
        if (!fromBalanceLoad) {
            if (window.RdeskLedger && typeof window.RdeskLedger.runAudit === 'function') {
                window.RdeskLedger.runAudit(false).catch(() => {});
            }
            if (window.RdeskSentinel && typeof window.RdeskSentinel.refreshAll === 'function') {
                window.RdeskSentinel.refreshAll().catch(() => {});
            }
            if (window.RdeskDefi && typeof window.RdeskDefi.refreshPoolAndPositions === 'function') {
                window.RdeskDefi.refreshPoolAndPositions();
            }
        }
    }

    // =========================================================================
    // 8. MODAL MULTI-CARTEIRA, DESAFIO 3 PALAVRAS, RECEBER & ENVIAR NATIVOS
    // =========================================================================
    function injectMultiWalletStyles() {
        if (document.getElementById('rdesk-multiwallet-styles')) return;
        const style = document.createElement('style');
        style.id = 'rdesk-multiwallet-styles';
        style.textContent = `
            #rdesk-mw-overlay {
                position: fixed; inset: 0; background: rgba(4, 6, 10, 0.88);
                backdrop-filter: blur(8px); z-index: 99999; display: none;
                align-items: flex-end; justify-content: center; padding: 12px;
            }
            #rdesk-mw-overlay.open { display: flex; }
            @media (min-width: 640px) { #rdesk-mw-overlay { align-items: center; } }
            .rmw-sheet {
                width: 100%; max-width: 460px; max-height: 92vh; overflow-y: auto;
                background: #11151f; border: 1px solid rgba(234, 179, 8, 0.3);
                border-radius: 20px; padding: 18px; color: #f1f5f9;
                box-shadow: 0 24px 60px rgba(0, 0, 0, 0.85);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            .rmw-header {
                display: flex; align-items: center; justify-content: space-between;
                margin-bottom: 14px; padding-bottom: 10px;
                border-bottom: 1px solid rgba(255,255,255,0.08);
            }
            .rmw-title { font-size: 1.02rem; font-weight: 700; display: flex; align-items: center; gap: 8px; }
            .rmw-icon-btn {
                background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12);
                color: #cbd5e1; border-radius: 10px; padding: 6px 10px; cursor: pointer; font-size: 0.84rem;
            }
            .rmw-icon-btn:hover { background: rgba(255,255,255,0.14); color: #fff; }
            .rmw-acc-card {
                background: #181e2c; border: 1px solid rgba(255,255,255,0.08);
                border-radius: 14px; padding: 12px; margin-bottom: 10px;
                display: flex; align-items: center; justify-content: space-between; gap: 10px;
                cursor: pointer; transition: border-color 0.2s, background 0.2s;
            }
            .rmw-acc-card.active { border-color: #eab308; background: rgba(234, 179, 8, 0.09); }
            .rmw-avatar {
                width: 40px; height: 40px; border-radius: 11px; flex-shrink: 0;
                display: flex; align-items: center; justify-content: center;
                font-weight: 800; font-size: 0.85rem; color: #090b10;
            }
            .rmw-badge {
                font-size: 0.66rem; font-weight: 700; padding: 2px 7px; border-radius: 6px;
                background: rgba(255,255,255,0.08); color: #94a3b8; text-transform: uppercase;
            }
            .rmw-badge.seed { background: rgba(0, 230, 118, 0.14); color: #00e676; }
            .rmw-badge.pk { background: rgba(234, 179, 8, 0.16); color: #eab308; }
            .rmw-badge.rabby { background: rgba(99, 102, 241, 0.2); color: #a5b4fc; }
            .rmw-opt-btn {
                width: 100%; background: #181e2c; border: 1px solid rgba(255,255,255,0.09);
                border-radius: 14px; padding: 13px 14px; margin-bottom: 9px;
                display: flex; align-items: center; gap: 12px; color: #f8fafc;
                cursor: pointer; text-align: left; font-size: 0.94rem; font-weight: 600;
            }
            .rmw-opt-btn:hover { border-color: #eab308; background: #1e2638; }
            .rmw-opt-ico {
                width: 34px; height: 34px; border-radius: 10px; display: flex;
                align-items: center; justify-content: center; font-size: 1.1rem; flex-shrink: 0;
            }
            .rmw-btn-primary {
                width: 100%; background: #eab308; color: #090b10; border: none;
                border-radius: 12px; padding: 12px; font-weight: 800; font-size: 0.94rem;
                cursor: pointer; margin-top: 6px;
            }
            .rmw-btn-primary:hover { filter: brightness(1.08); }
            .rmw-btn-secondary {
                width: 100%; background: rgba(255,255,255,0.07); color: #e2e8f0;
                border: 1px solid rgba(255,255,255,0.12); border-radius: 12px;
                padding: 11px; font-weight: 600; font-size: 0.9rem; cursor: pointer; margin-top: 8px;
            }
            .rmw-btn-danger {
                width: 100%; background: rgba(239, 68, 68, 0.14); color: #f87171;
                border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 12px;
                padding: 11px; font-weight: 700; font-size: 0.9rem; cursor: pointer; margin-top: 12px;
            }
            .rmw-input, .rmw-textarea, .rmw-select {
                width: 100%; background: #0b0e14; border: 1px solid rgba(255,255,255,0.16);
                border-radius: 11px; padding: 11px 12px; color: #fff; font-size: 0.92rem;
                margin-top: 5px; margin-bottom: 10px; box-sizing: border-box;
            }
            .rmw-textarea { min-height: 76px; font-family: monospace; resize: vertical; }
            .rmw-label { font-size: 0.8rem; color: #94a3b8; font-weight: 600; display: block; margin-top: 6px; }
            .rmw-alert-err {
                background: rgba(239, 68, 68, 0.14); border: 1px solid rgba(239, 68, 68, 0.4);
                color: #fca5a5; border-radius: 10px; padding: 10px; font-size: 0.83rem; margin: 8px 0;
            }
            .rmw-alert-ok {
                background: rgba(0, 230, 118, 0.12); border: 1px solid rgba(0, 230, 118, 0.35);
                color: #6ee7b7; border-radius: 10px; padding: 10px; font-size: 0.83rem; margin: 8px 0;
            }
            .rmw-words-grid {
                display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
                background: #090b10; border: 1px dashed #eab308; border-radius: 12px;
                padding: 10px; margin-top: 8px;
            }
            .rmw-word-pill {
                background: #141923; border: 1px solid rgba(255,255,255,0.08);
                border-radius: 8px; padding: 6px 7px; font-family: monospace; font-size: 0.8rem;
                color: #fde047; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .rmw-word-num { color: #64748b; font-size: 0.72rem; margin-right: 4px; }
            .rmw-secret-box {
                background: #090b10; border: 1px dashed #eab308; border-radius: 12px;
                padding: 12px; font-family: monospace; font-size: 0.86rem; color: #fde047;
                word-break: break-all; margin-top: 8px;
            }
        `;
        document.head.appendChild(style);
    }

    function getAvatarGradient(addr) {
        const hex = (addr || '0x123456').slice(2, 8);
        const h1 = parseInt(hex.slice(0, 2), 16) % 360;
        const h2 = (h1 + 110) % 360;
        return `linear-gradient(135deg, hsl(${h1}, 85%, 60%), hsl(${h2}, 85%, 52%))`;
    }

    function ensureModalContainer() {
        injectMultiWalletStyles();
        const legacyModal = document.getElementById('wallet-modal-overlay');
        if (legacyModal) legacyModal.remove();

        let overlay = document.getElementById('rdesk-mw-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'rdesk-mw-overlay';
            overlay.innerHTML = `<div class="rmw-sheet" id="rdesk-mw-sheet"></div>`;
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closeWalletModal();
            });
            document.body.appendChild(overlay);
        }
        return overlay;
    }

    function openWalletModal(preferredView) {
        const overlay = ensureModalContainer();
        if (preferredView) {
            currentView = preferredView;
        } else if (state.hasLegacyCorrupted && !state.accounts.length) {
            currentView = 'unlock';
        } else if (!state.accounts.length) {
            currentView = 'add';
        } else if (state.isLocked && state.accounts.some((a) => a.type === 'seed' || a.type === 'pk')) {
            currentView = 'unlock';
        } else {
            currentView = 'list';
        }
        overlay.classList.add('open');
        renderModal();
        refreshAllAccountsBalances();
    }

    function openReceiveModal() {
        const acc = getActiveAccount();
        if (!acc) {
            openWalletModal('add');
            return;
        }
        openWalletModal('receive');
    }

    function openSendModal() {
        const acc = getActiveAccount();
        if (!acc) {
            openWalletModal('add');
            return;
        }
        openWalletModal('send');
    }

    function closeWalletModal() {
        const overlay = document.getElementById('rdesk-mw-overlay');
        if (overlay) overlay.classList.remove('open');
    }

    function renderModal() {
        const sheet = document.getElementById('rdesk-mw-sheet');
        if (!sheet) return;

        if (currentView === 'unlock') renderUnlockView(sheet);
        else if (currentView === 'add') renderAddMethodView(sheet);
        else if (currentView === 'form') renderFormView(sheet);
        else if (currentView === 'detail') renderDetailView(sheet);
        else if (currentView === 'receive') renderReceiveView(sheet);
        else if (currentView === 'send') renderSendView(sheet);
        else renderListView(sheet);
    }

    // -------------------------------------------------------------------------
    // TELA RECEBER (QR CODE + COPIAR ENDEREÇO)
    // -------------------------------------------------------------------------
    function renderReceiveView(sheet) {
        const acc = getActiveAccount();
        if (!acc) { currentView = 'add'; renderModal(); return; }
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=210x210&bgcolor=0b0e14&color=ffffff&data=${encodeURIComponent(acc.address)}`;

        sheet.innerHTML = `
            <div class="rmw-header">
                <div class="rmw-title">
                    <button class="rmw-icon-btn" id="rmw-rec-list" title="Trocar carteira">👛</button>
                    ↓ Receber Cripto (Polygon)
                </div>
                <button class="rmw-icon-btn" id="rmw-close-btn">✕</button>
            </div>

            <div style="text-align:center;padding:8px 0 12px;">
                <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:rgba(130,71,229,0.2);color:#c4b5fd;font-size:0.75rem;font-weight:700;margin-bottom:8px;">
                    Rede Polygon Mainnet (Chain ID 137)
                </div>
                <div style="font-weight:800;font-size:1.05rem;color:#fff;margin-bottom:10px;">
                    ${acc.name}
                </div>
                <div style="background:#0b0e14;border:1px solid rgba(234,179,8,0.35);border-radius:16px;padding:14px;display:inline-block;">
                    <img src="${qrUrl}" alt="QR Code Receber" style="width:190px;height:190px;display:block;border-radius:8px;">
                </div>
            </div>

            <div class="rmw-secret-box" style="text-align:center;font-size:0.84rem;color:#f8fafc;">
                ${acc.address}
            </div>

            <div style="font-size:0.76rem;color:#94a3b8;text-align:center;margin:8px 0 10px;">
                Envie apenas ativos da rede <strong style="color:#fff;">Polygon</strong> (POL, WPOL, USDT0, BRZ ou BRLA) para este endereço.
            </div>

            <button class="rmw-btn-primary" id="rmw-rec-copy-btn">📋 Copiar Endereço Completo</button>
            ${navigator.share ? `<button class="rmw-btn-secondary" id="rmw-rec-share-btn">📤 Compartilhar Endereço</button>` : ''}
        `;

        sheet.querySelector('#rmw-close-btn').onclick = closeWalletModal;
        sheet.querySelector('#rmw-rec-list').onclick = () => { currentView = 'list'; renderModal(); };

        sheet.querySelector('#rmw-rec-copy-btn').onclick = async () => {
            await copyToClipboardSafe(acc.address);
            const btn = sheet.querySelector('#rmw-rec-copy-btn');
            btn.textContent = '✅ Endereço Copiado!';
            setTimeout(() => { btn.textContent = '📋 Copiar Endereço Completo'; }, 2000);
        };

        sheet.querySelector('#rmw-rec-share-btn')?.addEventListener('click', () => {
            navigator.share({ title: `Carteira ${acc.name} (Polygon)`, text: acc.address }).catch(() => {});
        });
    }

    // -------------------------------------------------------------------------
    // TELA ENVIAR (TRANSFERÊNCIA DIRETA NA POLYGON)
    // -------------------------------------------------------------------------
    function renderSendView(sheet) {
        const acc = getActiveAccount();
        if (!acc) { currentView = 'add'; renderModal(); return; }
        const bal = getActiveAccountBalances();

        sheet.innerHTML = `
            <div class="rmw-header">
                <div class="rmw-title">
                    <button class="rmw-icon-btn" id="rmw-snd-list">👛</button>
                    ↑ Enviar Ativos (Polygon)
                </div>
                <button class="rmw-icon-btn" id="rmw-close-btn">✕</button>
            </div>

            <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:8px;">
                De: <strong style="color:#fff;">${acc.name}</strong> (${acc.address.slice(0, 6)}...${acc.address.slice(-4)})
            </div>

            <label class="rmw-label">Moeda</label>
            <select class="rmw-select" id="rmw-snd-token">
                <option value="USDT0">USDT0 (Saldo: ${bal.usdt0.toFixed(4)})</option>
                <option value="POL">POL Nativo (Saldo: ${bal.pol.toFixed(4)})</option>
                <option value="WPOL">WPOL (Saldo: ${bal.wpol.toFixed(4)})</option>
                <option value="BRZ">BRZ (Saldo: ${bal.brz.toFixed(2)})</option>
                <option value="BRLA">BRLA (Saldo: ${bal.brla.toFixed(2)})</option>
            </select>

            <label class="rmw-label">Endereço de Destino (0x...)</label>
            <input type="text" class="rmw-input" id="rmw-snd-to" placeholder="0x...">

            <label class="rmw-label">Quantidade</label>
            <input type="number" class="rmw-input" id="rmw-snd-amt" step="any" placeholder="0.00">

            <div id="rmw-snd-msg"></div>
            <button class="rmw-btn-primary" id="rmw-snd-exec">Assinar e Enviar na Polygon</button>
        `;

        sheet.querySelector('#rmw-close-btn').onclick = closeWalletModal;
        sheet.querySelector('#rmw-snd-list').onclick = () => { currentView = 'list'; renderModal(); };

        sheet.querySelector('#rmw-snd-exec').onclick = async () => {
            const msgBox = sheet.querySelector('#rmw-snd-msg');
            msgBox.innerHTML = '';
            const sym = sheet.querySelector('#rmw-snd-token').value;
            const to = sheet.querySelector('#rmw-snd-to').value.trim();
            const amtStr = sheet.querySelector('#rmw-snd-amt').value.trim();

            try {
                if (!ethers.utils.isAddress(to)) throw new Error('Endereço de destino inválido.');
                if (!amtStr || parseFloat(amtStr) <= 0) throw new Error('Informe uma quantidade válida.');

                const signer = await getActiveSigner(137);
                const meta = TOKENS_META[sym];
                const amountWei = ethers.utils.parseUnits(amtStr, meta.decimals);

                msgBox.innerHTML = `<div class="rmw-alert-ok">Aguardando assinatura na carteira...</div>`;
                let tx;
                if (!meta.address) {
                    tx = await signer.sendTransaction({ to, value: amountWei });
                } else {
                    const contract = new ethers.Contract(meta.address, ERC20_ABI, signer);
                    tx = await contract.transfer(to, amountWei);
                }

                msgBox.innerHTML = `<div class="rmw-alert-ok">Transação enviada (${tx.hash.slice(0, 10)}...) Confirmando...</div>`;
                await tx.wait();
                msgBox.innerHTML = `<div class="rmw-alert-ok">✅ Envio confirmado na Polygon!</div>`;
                refreshAllAccountsBalances();
            } catch (err) {
                msgBox.innerHTML = `<div class="rmw-alert-err">${err?.reason || err?.message || 'Envio cancelado.'}</div>`;
            }
        };
    }

    // -------------------------------------------------------------------------
    // TELA A: LISTA DE CARTEIRAS
    // -------------------------------------------------------------------------
    function renderListView(sheet) {
        const activeAcc = getActiveAccount();
        const hasVaultAccounts = state.accounts.some((a) => a.type === 'seed' || a.type === 'pk');

        const cardsHtml = state.accounts.map((acc) => {
            const isAct = activeAcc && activeAcc.id === acc.id;
            const bal = state.balancesCache[acc.address.toLowerCase()];
            const badgeClass = acc.type === 'seed' ? 'seed' : (acc.type === 'pk' ? 'pk' : (acc.type === 'rabby' ? 'rabby' : ''));
            const badgeText = acc.type === 'seed'
                ? `SEED #${(acc.hdIndex || 0) + 1}`
                : (acc.type === 'pk' ? 'CHAVE PRIVADA' : (acc.type === 'rabby' ? 'RABBY' : 'OBSERVAÇÃO'));

            return `
                <div class="rmw-acc-card ${isAct ? 'active' : ''}" data-select-acc="${acc.id}">
                    <div style="display:flex;align-items:center;gap:11px;min-width:0;">
                        <div class="rmw-avatar" style="background:${getAvatarGradient(acc.address)};">
                            ${acc.address.slice(2, 4).toUpperCase()}
                        </div>
                        <div style="min-width:0;">
                            <div style="font-weight:700;font-size:0.95rem;display:flex;align-items:center;gap:6px;">
                                <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${acc.name}</span>
                                <span class="rmw-badge ${badgeClass}">${badgeText}</span>
                            </div>
                            <div style="font-size:0.78rem;color:#94a3b8;font-family:monospace;margin-top:2px;">
                                ${acc.address.slice(0, 8)}...${acc.address.slice(-6)}
                            </div>
                            <div style="font-size:0.76rem;color:#00e676;margin-top:2px;">
                                ${bal ? `~R$ ${bal.brl.toFixed(2)} (${bal.summary})` : 'Consultando saldo...'}
                            </div>
                        </div>
                    </div>
                    <button class="rmw-icon-btn" data-detail-acc="${acc.id}" title="Detalhes, Seed e Chave Privada">•••</button>
                </div>
            `;
        }).join('');

        sheet.innerHTML = `
            <div class="rmw-header">
                <div class="rmw-title">👛 Minhas Carteiras (${state.accounts.length})</div>
                <div style="display:flex;gap:6px;">
                    ${hasVaultAccounts ? `<button class="rmw-icon-btn" id="rmw-lock-btn">${state.isLocked ? '🔓 Desbloquear' : '🔒 Bloquear'}</button>` : ''}
                    <button class="rmw-icon-btn" id="rmw-close-btn">✕</button>
                </div>
            </div>

            ${state.isLocked && hasVaultAccounts ? `
                <div class="rmw-alert-err" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                    <span>🔒 Cofre bloqueado (modo leitura).</span>
                    <button class="rmw-icon-btn" id="rmw-quick-unlock" style="background:#eab308;color:#000;font-weight:700;">Desbloquear</button>
                </div>
            ` : ''}

            <div>${cardsHtml || '<p style="color:#94a3b8;text-align:center;padding:18px 0;">Nenhuma carteira adicionada ainda.</p>'}</div>

            <button class="rmw-btn-primary" id="rmw-goto-add">+ Adicionar uma carteira</button>
        `;

        sheet.querySelector('#rmw-close-btn').onclick = closeWalletModal;
        sheet.querySelector('#rmw-goto-add').onclick = () => { currentView = 'add'; renderModal(); };
        sheet.querySelector('#rmw-lock-btn')?.addEventListener('click', () => {
            if (state.isLocked) { currentView = 'unlock'; renderModal(); }
            else lockVaultNow();
        });
        sheet.querySelector('#rmw-quick-unlock')?.addEventListener('click', () => {
            currentView = 'unlock'; renderModal();
        });

        sheet.querySelectorAll('[data-select-acc]').forEach((el) => {
            el.addEventListener('click', async (e) => {
                if (e.target.closest('[data-detail-acc]')) return;
                await switchActiveAccount(el.getAttribute('data-select-acc'));
                closeWalletModal();
            });
        });

        sheet.querySelectorAll('[data-detail-acc]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                inspectingAccountId = btn.getAttribute('data-detail-acc');
                currentView = 'detail';
                renderModal();
            });
        });
    }

    // -------------------------------------------------------------------------
    // TELA B: DESBLOQUEIO DO COFRE
    // -------------------------------------------------------------------------
    function renderUnlockView(sheet) {
        const bioReady = isBiometryRegistered();

        sheet.innerHTML = `
            <div class="rmw-header">
                <div class="rmw-title">🔐 Desbloquear Cofre Local</div>
                <div style="display:flex;gap:6px;">
                    ${state.accounts.length ? '<button class="rmw-icon-btn" id="rmw-back-list">Carteiras</button>' : ''}
                    <button class="rmw-icon-btn" id="rmw-close-btn">✕</button>
                </div>
            </div>

            <div style="background:#181e2c;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:14px;margin-bottom:12px;">
                <div style="font-weight:700;font-size:0.95rem;margin-bottom:4px;">👆 Acesso Rápido por Biometria / Windows Hello</div>
                <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:10px;">
                    ${bioReady
                        ? 'Biometria ativa neste dispositivo. Toque abaixo para liberar suas carteiras.'
                        : 'Desbloqueie com sua Senha/PIN abaixo e ative a biometria nos detalhes da carteira.'}
                </div>
                <button class="rmw-btn-primary" id="rmw-bio-unlock-btn" style="margin-top:0;">👆 Desbloquear com Biometria</button>
            </div>

            <label class="rmw-label">Senha / PIN do Cofre Local</label>
            <div style="display:flex;gap:8px;align-items:center;">
                <input type="password" class="rmw-input" id="rmw-pass-input" placeholder="Digite sua senha/PIN..." style="margin:0;">
                <button class="rmw-btn-primary" id="rmw-pass-unlock-btn" style="width:auto;padding:11px 16px;margin:0;">Entrar</button>
            </div>

            <div id="rmw-unlock-msg"></div>

            <button class="rmw-btn-secondary" id="rmw-goto-add-from-unlock">+ Adicionar / Importar Outra Carteira</button>
            <button class="rmw-btn-danger" id="rmw-reset-vault-btn">🗑️ Limpar Cofre Local e Recomeçar</button>
        `;

        const msgBox = sheet.querySelector('#rmw-unlock-msg');
        sheet.querySelector('#rmw-close-btn').onclick = closeWalletModal;
        sheet.querySelector('#rmw-back-list')?.addEventListener('click', () => { currentView = 'list'; renderModal(); });
        sheet.querySelector('#rmw-goto-add-from-unlock').onclick = () => { currentView = 'add'; renderModal(); };

        sheet.querySelector('#rmw-bio-unlock-btn').onclick = async () => {
            msgBox.innerHTML = '';
            try {
                await unlockWithBiometry();
                currentView = 'list';
                renderModal();
            } catch (err) {
                msgBox.innerHTML = `<div class="rmw-alert-err">${err.message}</div>`;
            }
        };

        const doPasswordUnlock = async () => {
            const pwd = sheet.querySelector('#rmw-pass-input').value;
            msgBox.innerHTML = '';
            try {
                await unlockVaultWithPassword(pwd);
                currentView = 'list';
                renderModal();
            } catch (err) {
                msgBox.innerHTML = `<div class="rmw-alert-err">${err.message}</div>`;
            }
        };

        sheet.querySelector('#rmw-pass-unlock-btn').onclick = doPasswordUnlock;
        sheet.querySelector('#rmw-pass-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') doPasswordUnlock();
        });

        sheet.querySelector('#rmw-reset-vault-btn').onclick = () => {
            if (confirm('Isso apagará apenas o cofre criptografado salvo neste navegador (seus fundos na blockchain continuam intactos na sua Seed/Chave Privada). Deseja limpar e recomeçar?')) {
                hardResetCorruptedVault();
                currentView = 'add';
                renderModal();
            }
        };
    }

    // -------------------------------------------------------------------------
    // TELA C: MÉTODOS DE ADIÇÃO
    // -------------------------------------------------------------------------
    function renderAddMethodView(sheet) {
        const hasUnlockedSeed = state.unlockedSecrets && Object.keys(state.unlockedSecrets.masterSeedMap || {}).length > 0;

        sheet.innerHTML = `
            <div class="rmw-header">
                <div class="rmw-title">
                    ${state.accounts.length ? '<button class="rmw-icon-btn" id="rmw-back-btn">←</button>' : ''}
                    Selecionar método para adicionar
                </div>
                <button class="rmw-icon-btn" id="rmw-close-btn">✕</button>
            </div>

            <button class="rmw-opt-btn" data-mode="create-seed">
                <div class="rmw-opt-ico" style="background:rgba(0,230,118,0.16);color:#00e676;">+</div>
                <div>
                    <div>Criar carteira</div>
                    <div style="font-size:0.75rem;color:#94a3b8;font-weight:400;">Gera nova frase-semente com verificação de 3 palavras</div>
                </div>
            </button>

            ${hasUnlockedSeed ? `
                <button class="rmw-opt-btn" id="rmw-derive-from-existing-seed">
                    <div class="rmw-opt-ico" style="background:rgba(234,179,8,0.18);color:#eab308;">🌱</div>
                    <div>
                        <div>Adicionar conta da frase-semente atual</div>
                        <div style="font-size:0.75rem;color:#94a3b8;font-weight:400;">Deriva o próximo endereço HD (BIP44) em 1 clique</div>
                    </div>
                </button>
            ` : ''}

            <button class="rmw-opt-btn" data-mode="import-seed">
                <div class="rmw-opt-ico" style="background:rgba(59,130,246,0.18);color:#60a5fa;">📝</div>
                <div>
                    <div>Importar frase-semente</div>
                    <div style="font-size:0.75rem;color:#94a3b8;font-weight:400;">12 ou 24 palavras (Rabby, MetaMask, Ledger)</div>
                </div>
            </button>

            <button class="rmw-opt-btn" data-mode="import-pk">
                <div class="rmw-opt-ico" style="background:rgba(245,158,11,0.18);color:#fbbf24;">🔑</div>
                <div>
                    <div>Importar chave privada</div>
                    <div style="font-size:0.75rem;color:#94a3b8;font-weight:400;">Chave hexadecimal avulsa (0x...)</div>
                </div>
            </button>

            <button class="rmw-opt-btn" id="rmw-opt-rabby">
                <div class="rmw-opt-ico" style="background:rgba(99,102,241,0.2);color:#a5b4fc;">🦊</div>
                <div>
                    <div>Conectar Rabby Wallet / Extensão</div>
                    <div style="font-size:0.75rem;color:#94a3b8;font-weight:400;">Assinatura externa via extensão ou navegador Rabby</div>
                </div>
            </button>

            <button class="rmw-opt-btn" data-mode="watch-only">
                <div class="rmw-opt-ico" style="background:rgba(148,163,184,0.16);color:#cbd5e1;">👁️</div>
                <div>
                    <div>Endereço de observação (Watch-Only)</div>
                    <div style="font-size:0.75rem;color:#94a3b8;font-weight:400;">Acompanhar saldos, pools e lucro real sem chave</div>
                </div>
            </button>

            <div id="rmw-add-msg"></div>
        `;

        sheet.querySelector('#rmw-close-btn').onclick = closeWalletModal;
        sheet.querySelector('#rmw-back-btn')?.addEventListener('click', () => { currentView = 'list'; renderModal(); });

        sheet.querySelectorAll('[data-mode]').forEach((btn) => {
            btn.onclick = () => {
                activeFormMode = btn.getAttribute('data-mode');
                if (activeFormMode === 'create-seed') {
                    createSeedDraft = {
                        mnemonic: ethers.Wallet.createRandom().mnemonic.phrase,
                        wordCount: 12,
                        step: 'show',
                        challengeIndices: [],
                        name: '',
                        password: '',
                        enableBio: true
                    };
                }
                currentView = 'form';
                renderModal();
            };
        });

        sheet.querySelector('#rmw-derive-from-existing-seed')?.addEventListener('click', async () => {
            const firstSeedId = Object.keys(state.unlockedSecrets.masterSeedMap)[0];
            try {
                await deriveNextAccountFromSeed(firstSeedId);
                currentView = 'list';
                renderModal();
            } catch (err) {
                sheet.querySelector('#rmw-add-msg').innerHTML = `<div class="rmw-alert-err">${err.message}</div>`;
            }
        });

        sheet.querySelector('#rmw-opt-rabby').onclick = async () => {
            const msgBox = sheet.querySelector('#rmw-add-msg');
            msgBox.innerHTML = '';
            try {
                await connectRabbyExtension();
                currentView = 'list';
                renderModal();
            } catch (err) {
                msgBox.innerHTML = `<div class="rmw-alert-err">${err.message}</div>`;
            }
        };
    }

    function pickThreeRandomWordIndices(totalWords) {
        const pool = Array.from({ length: totalWords }, (_, i) => i);
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool.slice(0, 3).sort((a, b) => a - b);
    }

    // -------------------------------------------------------------------------
    // TELA D: FORMULÁRIOS (COM DESAFIO DE 3 PALAVRAS NA CRIAÇÃO DE CARTEIRA)
    // -------------------------------------------------------------------------
    function renderFormView(sheet) {
        const needsPassword = requiresVaultPasswordSetup();
        const isLockedExisting = !state.unlockedSecrets && Boolean(readVaultMetaFromStorage()?.encryptedSecrets);

        if (activeFormMode === 'create-seed') {
            if (!createSeedDraft) {
                createSeedDraft = {
                    mnemonic: ethers.Wallet.createRandom().mnemonic.phrase,
                    wordCount: 12,
                    step: 'show',
                    challengeIndices: [],
                    name: '',
                    password: '',
                    enableBio: true
                };
            }

            const wordsArr = createSeedDraft.mnemonic.split(' ');

            if (createSeedDraft.step === 'verify') {
                const [idx1, idx2, idx3] = createSeedDraft.challengeIndices;
                sheet.innerHTML = `
                    <div class="rmw-header">
                        <div class="rmw-title">
                            <button class="rmw-icon-btn" id="rmw-verify-back">←</button>
                            Confirmar Palavras Anotadas
                        </div>
                        <button class="rmw-icon-btn" id="rmw-close-btn">✕</button>
                    </div>

                    <div style="background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.35);border-radius:12px;padding:11px;font-size:0.82rem;color:#fde047;margin-bottom:12px;">
                        🛡️ <strong>Prova de Segurança:</strong> Digite exatamente as 3 palavras solicitadas abaixo para comprovar que você anotou sua frase-semente.
                    </div>

                    <label class="rmw-label">Palavra #${idx1 + 1}</label>
                    <input type="text" class="rmw-input" id="rmw-chk-w1" autocomplete="off" autocapitalize="none" placeholder="Digite a ${idx1 + 1}ª palavra...">

                    <label class="rmw-label">Palavra #${idx2 + 1}</label>
                    <input type="text" class="rmw-input" id="rmw-chk-w2" autocomplete="off" autocapitalize="none" placeholder="Digite a ${idx2 + 1}ª palavra...">

                    <label class="rmw-label">Palavra #${idx3 + 1}</label>
                    <input type="text" class="rmw-input" id="rmw-chk-w3" autocomplete="off" autocapitalize="none" placeholder="Digite a ${idx3 + 1}ª palavra...">

                    <div id="rmw-form-msg"></div>

                    <button class="rmw-btn-primary" id="rmw-verify-confirm-btn">✅ Confirmar Backup e Criar Carteira</button>
                    <button class="rmw-btn-secondary" id="rmw-verify-review-btn">👁️ Voltar para rever as palavras novamente</button>
                `;

                sheet.querySelector('#rmw-close-btn').onclick = closeWalletModal;
                const goBackToWords = () => { createSeedDraft.step = 'show'; renderModal(); };
                sheet.querySelector('#rmw-verify-back').onclick = goBackToWords;
                sheet.querySelector('#rmw-verify-review-btn').onclick = goBackToWords;

                sheet.querySelector('#rmw-verify-confirm-btn').onclick = async () => {
                    const msgBox = sheet.querySelector('#rmw-form-msg');
                    msgBox.innerHTML = '';

                    const a1 = sheet.querySelector('#rmw-chk-w1').value.trim().toLowerCase();
                    const a2 = sheet.querySelector('#rmw-chk-w2').value.trim().toLowerCase();
                    const a3 = sheet.querySelector('#rmw-chk-w3').value.trim().toLowerCase();

                    if (a1 !== wordsArr[idx1]) {
                        msgBox.innerHTML = `<div class="rmw-alert-err">A <strong>Palavra #${idx1 + 1}</strong> não confere. Verifique suas anotações.</div>`;
                        return;
                    }
                    if (a2 !== wordsArr[idx2]) {
                        msgBox.innerHTML = `<div class="rmw-alert-err">A <strong>Palavra #${idx2 + 1}</strong> não confere. Verifique suas anotações.</div>`;
                        return;
                    }
                    if (a3 !== wordsArr[idx3]) {
                        msgBox.innerHTML = `<div class="rmw-alert-err">A <strong>Palavra #${idx3 + 1}</strong> não confere. Verifique suas anotações.</div>`;
                        return;
                    }

                    try {
                        await addAccountFromMnemonic({
                            mnemonic: createSeedDraft.mnemonic,
                            name: createSeedDraft.name || 'CAIXA FORTE',
                            hdIndex: 0,
                            password: createSeedDraft.password,
                            enableBio: createSeedDraft.enableBio
                        });
                        createSeedDraft = null;
                        currentView = 'list';
                        renderModal();
                    } catch (err) {
                        msgBox.innerHTML = `<div class="rmw-alert-err">${err.message}</div>`;
                    }
                };
                return;
            }

            const numberedGridHtml = wordsArr.map((w, i) => `
                <div class="rmw-word-pill"><span class="rmw-word-num">${i + 1}.</span>${w}</div>
            `).join('');

            sheet.innerHTML = `
                <div class="rmw-header">
                    <div class="rmw-title">
                        <button class="rmw-icon-btn" id="rmw-form-back">←</button>
                        ✨ Criar Nova Carteira
                    </div>
                    <button class="rmw-icon-btn" id="rmw-close-btn">✕</button>
                </div>

                <label class="rmw-label">Apelido da Carteira</label>
                <input type="text" class="rmw-input" id="rmw-f-name" value="${createSeedDraft.name}" placeholder="Ex: CAIXA FORTE, POOL V3...">

                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
                    <label class="rmw-label" style="margin:0;">Anote estas ${createSeedDraft.wordCount} palavras na ordem exata:</label>
                    <select id="rmw-f-words" class="rmw-select" style="width:auto;padding:4px 8px;margin:0;font-size:0.78rem;">
                        <option value="12" ${createSeedDraft.wordCount === 12 ? 'selected' : ''}>12 palavras</option>
                        <option value="24" ${createSeedDraft.wordCount === 24 ? 'selected' : ''}>24 palavras</option>
                    </select>
                </div>

                <div class="rmw-words-grid">${numberedGridHtml}</div>
                <button type="button" class="rmw-btn-secondary" id="rmw-f-copy-gen" style="margin-top:8px;">📋 Copiar Palavras para Guardar Offline</button>

                ${needsPassword || isLockedExisting ? `
                    <label class="rmw-label" style="margin-top:10px;">${needsPassword ? 'Crie uma Senha/PIN para o Cofre Local' : 'Digite a Senha/PIN do seu Cofre Local'}</label>
                    <input type="password" class="rmw-input" id="rmw-f-pass" value="${createSeedDraft.password}" placeholder="Mínimo 4 caracteres">
                ` : ''}

                ${needsPassword ? `
                    <label style="display:flex;align-items:center;gap:8px;font-size:0.84rem;color:#cbd5e1;margin:8px 0;cursor:pointer;">
                        <input type="checkbox" id="rmw-f-bio" ${createSeedDraft.enableBio ? 'checked' : ''}>
                        <span>👆 Ativar desbloqueio rápido por Biometria / Windows Hello</span>
                    </label>
                ` : ''}

                <div id="rmw-form-msg"></div>
                <button class="rmw-btn-primary" id="rmw-f-next-verify">Já anotei — Verificar 3 Palavras →</button>
            `;

            sheet.querySelector('#rmw-close-btn').onclick = closeWalletModal;
            sheet.querySelector('#rmw-form-back').onclick = () => { currentView = 'add'; renderModal(); };

            sheet.querySelector('#rmw-f-words').onchange = (e) => {
                const count = Number(e.target.value);
                const bits = count === 24 ? 32 : 16;
                createSeedDraft.wordCount = count;
                createSeedDraft.mnemonic = ethers.utils.entropyToMnemonic(ethers.utils.randomBytes(bits));
                createSeedDraft.name = sheet.querySelector('#rmw-f-name').value;
                createSeedDraft.password = sheet.querySelector('#rmw-f-pass')?.value || '';
                renderModal();
            };

            sheet.querySelector('#rmw-f-copy-gen').onclick = async () => {
                await copyToClipboardSafe(createSeedDraft.mnemonic);
                sheet.querySelector('#rmw-f-copy-gen').textContent = '✅ Palavras Copiadas!';
            };

            sheet.querySelector('#rmw-f-next-verify').onclick = () => {
                const msgBox = sheet.querySelector('#rmw-form-msg');
                const pwd = sheet.querySelector('#rmw-f-pass')?.value || '';
                if ((needsPassword || isLockedExisting) && pwd.length < 4) {
                    msgBox.innerHTML = `<div class="rmw-alert-err">Informe a Senha/PIN do cofre (mínimo 4 caracteres) antes de continuar.</div>`;
                    return;
                }
                createSeedDraft.name = sheet.querySelector('#rmw-f-name').value;
                createSeedDraft.password = pwd;
                createSeedDraft.enableBio = Boolean(sheet.querySelector('#rmw-f-bio')?.checked);
                createSeedDraft.challengeIndices = pickThreeRandomWordIndices(wordsArr.length);
                createSeedDraft.step = 'verify';
                renderModal();
            };
            return;
        }

        const titles = {
            'import-seed': '📝 Importar Frase-Semente',
            'import-pk': '🔑 Importar Chave Privada',
            'watch-only': '👁️ Adicionar Endereço de Observação'
        };

        sheet.innerHTML = `
            <div class="rmw-header">
                <div class="rmw-title">
                    <button class="rmw-icon-btn" id="rmw-form-back">←</button>
                    ${titles[activeFormMode] || 'Adicionar Carteira'}
                </div>
                <button class="rmw-icon-btn" id="rmw-close-btn">✕</button>
            </div>

            <label class="rmw-label">Apelido da Carteira</label>
            <input type="text" class="rmw-input" id="rmw-f-name" placeholder="Ex: CAIXA FORTE, POOL V3, RESERVA...">

            ${activeFormMode === 'import-seed' ? `
                <label class="rmw-label">Frase-Semente (12 ou 24 palavras separadas por espaço)</label>
                <textarea class="rmw-textarea" id="rmw-f-seed-input" placeholder="word1 word2 word3 ..."></textarea>
                <label class="rmw-label">Índice da Conta HD (BIP44 — padrão #0)</label>
                <input type="number" class="rmw-input" id="rmw-f-hd-index" value="0" min="0" max="50">
            ` : ''}

            ${activeFormMode === 'import-pk' ? `
                <label class="rmw-label">Chave Privada (64 caracteres hexadecimais)</label>
                <input type="password" class="rmw-input" id="rmw-f-pk-input" placeholder="0x...">
            ` : ''}

            ${activeFormMode === 'watch-only' ? `
                <label class="rmw-label">Endereço Público da Carteira (0x...)</label>
                <input type="text" class="rmw-input" id="rmw-f-watch-input" placeholder="0x2833...">
            ` : ''}

            ${activeFormMode !== 'watch-only' && (needsPassword || isLockedExisting) ? `
                <label class="rmw-label">${needsPassword ? 'Crie uma Senha/PIN para o Cofre Local' : 'Digite a Senha/PIN do seu Cofre Local'}</label>
                <input type="password" class="rmw-input" id="rmw-f-pass" placeholder="Mínimo 4 caracteres">
            ` : ''}

            ${activeFormMode !== 'watch-only' && needsPassword ? `
                <label style="display:flex;align-items:center;gap:8px;font-size:0.84rem;color:#cbd5e1;margin:8px 0;cursor:pointer;">
                    <input type="checkbox" id="rmw-f-bio" checked>
                    <span>👆 Ativar desbloqueio rápido por Biometria / Windows Hello</span>
                </label>
            ` : ''}

            <div id="rmw-form-msg"></div>
            <button class="rmw-btn-primary" id="rmw-f-submit">Salvar e Ativar Carteira</button>
        `;

        sheet.querySelector('#rmw-close-btn').onclick = closeWalletModal;
        sheet.querySelector('#rmw-form-back').onclick = () => { currentView = 'add'; renderModal(); };

        sheet.querySelector('#rmw-f-submit').onclick = async () => {
            const msgBox = sheet.querySelector('#rmw-form-msg');
            msgBox.innerHTML = '';
            const name = sheet.querySelector('#rmw-f-name').value;
            const password = sheet.querySelector('#rmw-f-pass')?.value || '';
            const enableBio = Boolean(sheet.querySelector('#rmw-f-bio')?.checked);

            try {
                if (activeFormMode === 'import-seed') {
                    const mnemonic = sheet.querySelector('#rmw-f-seed-input').value;
                    const hdIndex = parseInt(sheet.querySelector('#rmw-f-hd-index').value || '0', 10);
                    await addAccountFromMnemonic({ mnemonic, name, hdIndex, password, enableBio });
                } else if (activeFormMode === 'import-pk') {
                    const privateKey = sheet.querySelector('#rmw-f-pk-input').value;
                    await addAccountFromPrivateKey({ privateKey, name, password, enableBio });
                } else if (activeFormMode === 'watch-only') {
                    const address = sheet.querySelector('#rmw-f-watch-input').value;
                    await addWatchOnlyAccount({ address, name });
                }
                currentView = 'list';
                renderModal();
            } catch (err) {
                msgBox.innerHTML = `<div class="rmw-alert-err">${err.message}</div>`;
            }
        };
    }

    // -------------------------------------------------------------------------
    // TELA E: DETALHE DA CARTEIRA + BACKUP
    // -------------------------------------------------------------------------
    function renderDetailView(sheet) {
        const acc = state.accounts.find((a) => a.id === inspectingAccountId) || getActiveAccount();
        if (!acc) { currentView = 'list'; renderModal(); return; }

        const isVaultAcc = acc.type === 'seed' || acc.type === 'pk';
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&bgcolor=0b0e14&color=ffffff&data=${encodeURIComponent(acc.address)}`;

        sheet.innerHTML = `
            <div class="rmw-header">
                <div class="rmw-title">
                    <button class="rmw-icon-btn" id="rmw-det-back">←</button>
                    Detalhe da carteira
                </div>
                <button class="rmw-icon-btn" id="rmw-close-btn">✕</button>
            </div>

            <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
                <div class="rmw-avatar" style="width:48px;height:48px;background:${getAvatarGradient(acc.address)};">
                    ${acc.address.slice(2, 4).toUpperCase()}
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;gap:6px;">
                        <input type="text" class="rmw-input" id="rmw-det-name" value="${acc.name}" style="margin:0;padding:7px 10px;font-weight:700;">
                        <button class="rmw-icon-btn" id="rmw-det-save-name">Salvar</button>
                    </div>
                    <div style="font-size:0.75rem;color:#94a3b8;font-family:monospace;word-break:break-all;margin-top:5px;">
                        ${acc.address}
                    </div>
                </div>
            </div>

            <div style="background:#181e2c;border-radius:14px;padding:12px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
                <div style="font-size:0.82rem;color:#cbd5e1;">
                    <div><strong>Fonte:</strong> ${acc.type === 'seed' ? 'Frase-semente HD' : (acc.type === 'pk' ? 'Chave privada importada' : (acc.type === 'rabby' ? 'Rabby Externa' : 'Observação'))}</div>
                    ${acc.type === 'seed' ? `<div style="margin-top:4px;"><strong>Caminho HD:</strong> BIP44 #${(acc.hdIndex || 0) + 1}</div>` : ''}
                    <button class="rmw-btn-secondary" id="rmw-det-copy-addr" style="margin-top:10px;padding:7px 12px;">📋 Copiar Endereço</button>
                </div>
                <img src="${qrUrl}" alt="QR Code" style="width:92px;height:92px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);">
            </div>

            ${acc.type === 'seed' ? `
                <button class="rmw-opt-btn" id="rmw-det-derive-sibling">
                    <div class="rmw-opt-ico" style="background:rgba(0,230,118,0.15);color:#00e676;">+</div>
                    <div>Adicionar carteira a partir desta frase-semente</div>
                </button>
            ` : ''}

            ${isVaultAcc ? `
                <div style="font-size:0.78rem;color:#94a3b8;font-weight:700;margin:10px 0 6px;">CÓPIA DE SEGURANÇA & BIOMETRIA</div>

                <button class="rmw-opt-btn" id="rmw-det-bio-btn">
                    <div class="rmw-opt-ico" style="background:rgba(234,179,8,0.16);color:#eab308;">👆</div>
                    <div>${isBiometryRegistered() ? 'Regravar Biometria / Digital neste aparelho' : 'Ativar Biometria / Digital neste aparelho'}</div>
                </button>

                ${acc.type === 'seed' ? `
                    <button class="rmw-opt-btn" id="rmw-det-show-seed">
                        <div class="rmw-opt-ico" style="background:rgba(59,130,246,0.16);color:#60a5fa;">📜</div>
                        <div>Criar cópia de segurança da frase-semente</div>
                    </button>
                ` : ''}

                <button class="rmw-opt-btn" id="rmw-det-show-pk">
                    <div class="rmw-opt-ico" style="background:rgba(245,158,11,0.16);color:#fbbf24;">🗝️</div>
                    <div>Criar cópia de segurança da chave privada</div>
                </button>

                <div id="rmw-det-secret-area"></div>
            ` : ''}

            <div id="rmw-det-msg"></div>
            <button class="rmw-btn-danger" id="rmw-det-delete">🗑️ Apagar carteira</button>
        `;

        const msgBox = sheet.querySelector('#rmw-det-msg');
        const secretArea = sheet.querySelector('#rmw-det-secret-area');

        sheet.querySelector('#rmw-close-btn').onclick = closeWalletModal;
        sheet.querySelector('#rmw-det-back').onclick = () => { currentView = 'list'; renderModal(); };

        sheet.querySelector('#rmw-det-save-name').onclick = async () => {
            const newName = sheet.querySelector('#rmw-det-name').value.trim();
            if (newName) {
                acc.name = newName;
                await persistVaultToStorage();
                notifyAccountChanged();
                msgBox.innerHTML = `<div class="rmw-alert-ok">Apelido atualizado!</div>`;
            }
        };

        sheet.querySelector('#rmw-det-copy-addr').onclick = async () => {
            await copyToClipboardSafe(acc.address);
            sheet.querySelector('#rmw-det-copy-addr').textContent = '✅ Endereço Copiado!';
        };

        sheet.querySelector('#rmw-det-derive-sibling')?.addEventListener('click', async () => {
            try {
                await deriveNextAccountFromSeed(acc.seedGroupId);
                currentView = 'list';
                renderModal();
            } catch (err) {
                msgBox.innerHTML = `<div class="rmw-alert-err">${err.message}</div>`;
            }
        });

        sheet.querySelector('#rmw-det-bio-btn')?.addEventListener('click', async () => {
            try {
                if (!state.unlockedSecrets?.password) {
                    throw new Error('Desbloqueie o cofre com sua senha primeiro para vincular a biometria.');
                }
                await registerDeviceBiometry(state.unlockedSecrets.password);
                msgBox.innerHTML = `<div class="rmw-alert-ok">✅ Biometria ativada com sucesso neste dispositivo!</div>`;
            } catch (err) {
                msgBox.innerHTML = `<div class="rmw-alert-err">${err.message}</div>`;
            }
        });

        const revealSecret = (kind) => {
            try {
                const { privateKey, mnemonic } = exportAccountSecrets(acc.id);
                const value = kind === 'seed' ? mnemonic : privateKey;
                const title = kind === 'seed' ? 'Frase-Semente (12/24 palavras)' : 'Chave Privada (0x...)';
                secretArea.innerHTML = `
                    <div class="rmw-secret-box">
                        <div style="font-size:0.74rem;color:#94a3b8;margin-bottom:4px;">${title} — Nunca compartilhe:</div>
                        <div>${value}</div>
                        <button class="rmw-btn-secondary" id="rmw-copy-secret-val" style="margin-top:8px;padding:7px;">📋 Copiar ${title}</button>
                    </div>
                `;
                secretArea.querySelector('#rmw-copy-secret-val').onclick = async () => {
                    await copyToClipboardSafe(value);
                    secretArea.querySelector('#rmw-copy-secret-val').textContent = '✅ Copiado para área de transferência!';
                };
            } catch (err) {
                msgBox.innerHTML = `<div class="rmw-alert-err">${err.message}</div>`;
            }
        };

        sheet.querySelector('#rmw-det-show-seed')?.addEventListener('click', () => revealSecret('seed'));
        sheet.querySelector('#rmw-det-show-pk')?.addEventListener('click', () => revealSecret('pk'));

        sheet.querySelector('#rmw-det-delete').onclick = async () => {
            if (confirm(`Remover "${acc.name}" (${acc.address.slice(0, 6)}...${acc.address.slice(-4)}) desta lista?`)) {
                await deleteSingleAccount(acc.id);
                currentView = state.accounts.length ? 'list' : 'add';
                renderModal();
            }
        };
    }

    // =========================================================================
    // 9. GARANTIA UNIVERSAL DOS BOTÕES "RECEBER" E "ENVIAR"
    // =========================================================================
    function bindHeroActionFallbacks() {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('button, [role="button"]');
            if (!btn) return;
            if (btn.closest('#rdesk-mw-overlay')) return;

            const id = (btn.id || '').toLowerCase();
            const label = (btn.textContent || '').trim().toLowerCase();

            const isReceiveBtn = id === 'btn-action-receive' || id === 'btn-receive' || btn.getAttribute('data-action') === 'receive' || /^↓?\s*receber$/i.test(label);
            const isSendBtn = id === 'btn-action-send' || id === 'btn-send' || btn.getAttribute('data-action') === 'send' || /^↑?\s*enviar$/i.test(label);

            if (isReceiveBtn) {
                openReceiveModal();
            } else if (isSendBtn) {
                openSendModal();
            }
        });
    }

    // =========================================================================
    // 10. INICIALIZAÇÃO E PONTE UNIFICADA (window.RdeskVault + window.RdeskWallet)
    // =========================================================================
    function registerChangeListener(cb) {
        if (typeof cb !== 'function') return;
        changeListeners.push(cb);
        const st = getPublicWalletState();
        if (st.address) {
            try { cb(st.address, st.account, st); } catch (e) {}
        }
    }

    async function initWalletEngine() {
        const meta = readVaultMetaFromStorage();
        if (meta && Array.isArray(meta.accounts)) {
            state.accounts = meta.accounts;
            state.activeAccountId = meta.activeAccountId || meta.accounts[0]?.id || null;
            state.isLocked = Boolean(meta.encryptedSecrets);
        }

        window.addEventListener('eip6963:announceProvider', (event) => {
            const info = event.detail?.info;
            if (info && (info.rdns?.includes('rabby') || info.name?.toLowerCase().includes('rabby'))) {
                state.rabbyProvider = event.detail.provider;
            }
        });
        window.dispatchEvent(new Event('eip6963:requestProvider'));

        const injected = resolveInjectedWeb3Provider();
        if (injected && typeof injected.request === 'function') {
            injected.request({ method: 'eth_accounts' })
                .then((accs) => {
                    if (accs && accs[0]) {
                        upsertRabbyAccount(accs[0], injected, state.accounts.length === 0);
                    }
                })
                .catch(() => {});

            if (typeof injected.on === 'function') {
                injected.on('accountsChanged', (accs) => {
                    if (accs && accs[0]) {
                        upsertRabbyAccount(accs[0], injected, true);
                    }
                });
            }
        }

        document.querySelectorAll('#btn-wallet-trigger, #wallet-chip-btn, #btn-connect-wallet, [data-wallet-open]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                openWalletModal();
            });
        });

        document.getElementById('btn-banner-bio')?.addEventListener('click', async () => {
            try { await unlockWithBiometry(); }
            catch (err) { openWalletModal('unlock'); }
        });

        document.getElementById('btn-banner-pass')?.addEventListener('click', () => {
            openWalletModal('unlock');
        });

        bindHeroActionFallbacks();
        await refreshLiveMarketPrices();
        notifyAccountChanged(false);
        await refreshAllAccountsBalances();
    }

    const walletApi = {
        getAddress: () => getActiveAccount()?.address || '',
        getActiveAccount,
        getAccounts: () => [...state.accounts],
        getState: getPublicWalletState,
        getPrices: getPricesSyncOrRefresh,
        refreshPrices: refreshLiveMarketPrices,
        getBalances: getActiveAccountBalances,
        getBalance: getSingleTokenBalance,
        getTokenBalance: getSingleTokenBalance,
        refreshBalances: refreshAllAccountsBalances,
        getSigner: getActiveSigner,
        getProvider: getReadProvider,
        getReadProvider,
        getChainId: () => 137,
        switchChain: switchChainOnProvider,
        ensureChain: switchChainOnProvider,
        connectRabby: connectRabbyExtension,
        isConnected: () => Boolean(getActiveAccount()?.address),
        isUnlocked: () => !state.isLocked,
        isLocked: () => state.isLocked,
        isWatchOnly: () => getActiveAccount()?.type === 'watch',
        openModal: openWalletModal,
        openReceiveModal,
        openSendModal,
        closeModal: closeWalletModal,
        switchAccount: switchActiveAccount,
        lockVault: lockVaultNow,
        unlockWithBiometrics: unlockWithBiometry,
        copyText: copyToClipboardSafe,
        shortAddress: (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '',
        onChange: registerChangeListener,
        onAccountChange: registerChangeListener,
        subscribe: registerChangeListener
    };

    Object.defineProperties(walletApi, {
        address:  { get: () => getActiveAccount()?.address || '', enumerable: true },
        balances: { get: getActiveAccountBalances, enumerable: true },
        prices:   { get: getPricesSyncOrRefresh, enumerable: true }
    });

    // Expõe ambos os namespaces para evitar qualquer quebra entre módulos
    window.RdeskWallet = walletApi;
    window.RdeskVault = walletApi;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWalletEngine);
    } else {
        initWalletEngine();
    }
})();
