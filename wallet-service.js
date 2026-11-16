/* =========================================================================
   RDESK SENTINEL — GERENCIADOR MULTI-CARTEIRA, ORÁCULO & SYNC SWAP V5
   Substitui: wallet-service.js
   ========================================================================= */

(function () {
    'use strict';

    const VAULT_STORAGE_KEY = 'rdesk_multi_vault_v2';
    const BIO_STORAGE_KEY = 'rdesk_bio_prf_v3';
    // Registro antigo de biometria guardava a chave ao lado do segredo: é apagado na inicialização.
    const INSECURE_BIO_KEYS = ['rdesk_bio_passkey_v2'];
    const LEGACY_KEYS = ['rdesk_vault_v1', 'rdesk_wallet_vault', 'rdesk_bio_v1'];
    const PBKDF2_ITERATIONS = 600000;
    const LEGACY_PBKDF2_ITERATIONS = 150000;
    const MIN_PASSWORD_LENGTH = 8;
    const AUTO_LOCK_MS = 10 * 60 * 1000;
    // Gorjeta mínima (gwei) aceita pelos validadores; o padrão do ethers v5 (1,5) é recusado na Polygon.
    const MIN_PRIORITY_FEE_GWEI = { 137: 30 };
    const IDB_NAME = 'rdesk_vault_backup';

    const POLYGON_RPCS = [
        'https://polygon-bor-rpc.publicnode.com',
        'https://1rpc.io/matic',
        'https://polygon.drpc.org'
    ];

    const CHAIN_RPC_LISTS = {
        137:   POLYGON_RPCS,
        42161: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
        8453:  ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
        10:    ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'],
        1:     ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org']
    };
    const CHAIN_RPCS = Object.fromEntries(Object.entries(CHAIN_RPC_LISTS).map(([id, list]) => [id, list[0]]));

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
            ethUsd: 0,
            btcUsd: 0,
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
            USD_BRL: usdBrl,
            ETH: Number(state.prices.ethUsd) || 0,
            BTC: Number(state.prices.btcUsd) || 0,
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

    // Se a cotação externa do POL estiver indisponível há mais de 5 min, vale o preço lido da própria pool.
    function notePoolPrice(poolPriceUsd) {
        const p = Number(poolPriceUsd);
        if (!(p > 0)) return;
        if (!state.prices.polLiveAt || Date.now() - state.prices.polLiveAt > 5 * 60 * 1000) {
            state.prices.polUsd = p;
        }
    }

    async function refreshLiveMarketPrices() {
        try {
            const [fxRes, polRes, majorsRes] = await Promise.all([
                fetch('https://economia.awesomeapi.com.br/last/USD-BRL', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
                fetch('https://coins.llama.fi/prices/current/polygon:0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
                fetch('https://coins.llama.fi/prices/current/coingecko:ethereum,coingecko:bitcoin', { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
            ]);
            const ethPrice = parseFloat(majorsRes?.coins?.['coingecko:ethereum']?.price);
            const btcPrice = parseFloat(majorsRes?.coins?.['coingecko:bitcoin']?.price);
            if (Number.isFinite(ethPrice) && ethPrice > 0) state.prices.ethUsd = ethPrice;
            if (Number.isFinite(btcPrice) && btcPrice > 0) state.prices.btcUsd = btcPrice;
            if (fxRes?.USDBRL?.bid) {
                const parsedFx = parseFloat(fxRes.USDBRL.bid);
                if (Number.isFinite(parsedFx) && parsedFx > 0) state.prices.usdBrl = parsedFx;
            }
            const polPrice = polRes?.coins?.['polygon:0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270']?.price;
            if (polPrice && Number.isFinite(parseFloat(polPrice))) {
                state.prices.polUsd = parseFloat(polPrice);
                state.prices.polLiveAt = Date.now();
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
    function esc(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    async function deriveAesKey(password, saltBytes, usages, iterations = PBKDF2_ITERATIONS) {
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(String(password)),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
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
            version: 3,
            iterations: PBKDF2_ITERATIONS,
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
        const key = await deriveAesKey(password, salt, ['decrypt'], Number(encryptedBlob.iterations) || LEGACY_PBKDF2_ITERATIONS);

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

        // Sem nenhuma carteira com chave guardada, não sobra nada cifrado no aparelho.
        const hasKeyedAccount = state.accounts.some((a) => a.type === 'seed' || a.type === 'pk');
        if (!hasKeyedAccount) {
            encryptedSecrets = null;
            localStorage.removeItem(BIO_STORAGE_KEY);
            if (state.unlockedSecrets) {
                state.unlockedSecrets = null;
                state.isLocked = false;
            }
        }

        const payload = {
            version: 3,
            accounts: state.accounts,
            activeAccountId: state.activeAccountId,
            encryptedSecrets
        };
        const serialized = JSON.stringify(payload);
        localStorage.setItem(VAULT_STORAGE_KEY, serialized);
        state.hasLegacyCorrupted = false;
        await idbSet('vault', state.accounts.length ? serialized : null);
    }

    // Cópia redundante do cofre cifrado no IndexedDB (sobrevive a uma limpeza só do localStorage).
    function idbOpen() {
        return new Promise((resolve) => {
            try {
                const req = indexedDB.open(IDB_NAME, 1);
                req.onupgradeneeded = () => req.result.createObjectStore('kv');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
    }
    async function idbSet(key, value) {
        const db = await idbOpen();
        if (!db) return;
        await new Promise((resolve) => {
            const tx = db.transaction('kv', 'readwrite');
            if (value === null) tx.objectStore('kv').delete(key); else tx.objectStore('kv').put(value, key);
            tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve;
        });
        db.close();
    }
    async function idbGet(key) {
        const db = await idbOpen();
        if (!db) return null;
        const value = await new Promise((resolve) => {
            const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => resolve(null);
        });
        db.close();
        return value;
    }
    async function restoreVaultFromBackupIfMissing() {
        if (localStorage.getItem(VAULT_STORAGE_KEY)) return;
        const backup = await idbGet('vault');
        if (backup) localStorage.setItem(VAULT_STORAGE_KEY, backup);
    }

    function hardResetCorruptedVault() {
        LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
        localStorage.removeItem(VAULT_STORAGE_KEY);
        localStorage.removeItem(BIO_STORAGE_KEY);
        idbSet('vault', null);
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
    // A chave que protege a senha é derivada DENTRO do autenticador (extensão PRF do WebAuthn)
    // e só sai dele depois da digital/rosto. No aparelho fica apenas a senha cifrada.
    function isBiometryRegistered() {
        try {
            const parsed = JSON.parse(localStorage.getItem(BIO_STORAGE_KEY) || 'null');
            return Boolean(parsed && parsed.credIdB64 && parsed.prfSaltB64 && parsed.wrappedPassB64 && parsed.ivB64);
        } catch (e) {
            return false;
        }
    }

    function isBiometrySupported() {
        return Boolean(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);
    }

    function webAuthnRpId() {
        return window.location.hostname || undefined;
    }

    async function evaluatePrfSecret(credIdBytes, prfSaltBytes) {
        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)),
                rpId: webAuthnRpId(),
                allowCredentials: [{ type: 'public-key', id: credIdBytes }],
                userVerification: 'required',
                timeout: 60000,
                extensions: { prf: { eval: { first: prfSaltBytes } } }
            }
        });
        if (!assertion) throw new Error('Verificação biométrica não concluída.');
        const first = assertion.getClientExtensionResults?.()?.prf?.results?.first;
        if (!first) {
            throw new Error('Este aparelho não oferece biometria com chave protegida (WebAuthn PRF). Use a senha do cofre.');
        }
        return crypto.subtle.importKey('raw', first, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }

    async function registerDeviceBiometry(password) {
        if (!isBiometrySupported()) {
            throw new Error('Este navegador não suporta biometria WebAuthn.');
        }
        if (!password) {
            throw new Error('Desbloqueie o cofre com sua senha primeiro para ativar a biometria.');
        }

        const credential = await navigator.credentials.create({
            publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)),
                rp: { name: 'RDESK SENTINEL', id: webAuthnRpId() },
                user: {
                    id: crypto.getRandomValues(new Uint8Array(16)),
                    name: 'rdesk-autocustodia',
                    displayName: 'Cofre RDESK SENTINEL'
                },
                pubKeyCredParams: [
                    { type: 'public-key', alg: -7 },
                    { type: 'public-key', alg: -257 }
                ],
                authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
                timeout: 60000,
                attestation: 'none',
                extensions: { prf: {} }
            }
        });

        if (!credential || !credential.rawId) {
            throw new Error('Cadastro biométrico cancelado no aparelho.');
        }
        if (credential.getClientExtensionResults?.()?.prf?.enabled === false) {
            throw new Error('Este aparelho não oferece biometria com chave protegida (WebAuthn PRF). Continue usando a senha do cofre.');
        }

        const credId = new Uint8Array(credential.rawId);
        const prfSalt = crypto.getRandomValues(new Uint8Array(32));
        const wrapKey = await evaluatePrfSecret(credId, prfSalt);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const wrappedBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, new TextEncoder().encode(password));

        localStorage.setItem(BIO_STORAGE_KEY, JSON.stringify({
            version: 3,
            credIdB64: bytesToBase64(credId),
            prfSaltB64: bytesToBase64(prfSalt),
            wrappedPassB64: bytesToBase64(new Uint8Array(wrappedBuf)),
            ivB64: bytesToBase64(iv)
        }));
        return true;
    }

    async function unlockWithBiometry() {
        if (!isBiometryRegistered()) {
            throw new Error('Biometria ainda não ativada neste aparelho. Desbloqueie com sua senha e ative a biometria nos detalhes da carteira.');
        }
        const bioRecord = JSON.parse(localStorage.getItem(BIO_STORAGE_KEY));
        const wrapKey = await evaluatePrfSecret(safeBase64ToBytes(bioRecord.credIdB64), safeBase64ToBytes(bioRecord.prfSaltB64));
        let passBuf;
        try {
            passBuf = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: safeBase64ToBytes(bioRecord.ivB64) },
                wrapKey,
                safeBase64ToBytes(bioRecord.wrappedPassB64)
            );
        } catch (e) {
            throw new Error('A biometria não confere com o cofre deste aparelho. Use a senha.');
        }
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
        if (Number(meta.encryptedSecrets.iterations) !== PBKDF2_ITERATIONS) {
            await persistVaultToStorage(); // regrava com a proteção atual
        }
        touchAutoLock();
        notifyAccountChanged();
    }

    function lockVaultNow() {
        state.unlockedSecrets = null;
        state.isLocked = true;
        clearTimeout(autoLockTimer);
        notifyAccountChanged();
        renderModal();
    }

    // Bloqueia sozinho após 10 minutos sem uso.
    let autoLockTimer = null;
    function touchAutoLock() {
        clearTimeout(autoLockTimer);
        if (!state.unlockedSecrets) return;
        autoLockTimer = setTimeout(() => {
            if (state.unlockedSecrets) lockVaultNow();
        }, AUTO_LOCK_MS);
    }
    ['pointerdown', 'keydown'].forEach((evt) => window.addEventListener(evt, touchAutoLock, { passive: true }));

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
        if (!passwordIfNeeded || passwordIfNeeded.length < MIN_PASSWORD_LENGTH) {
            throw new Error(`Defina uma senha de pelo menos ${MIN_PASSWORD_LENGTH} caracteres para proteger seu cofre.`);
        }
        state.unlockedSecrets = { masterSeedMap: {}, pkMap: {}, password: passwordIfNeeded };
        state.isLocked = false;
        touchAutoLock();
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

    // Cofre da versão anterior do app (uma única frase, chave 'rdesk_v22_encrypted_vault').
    const LEGACY_V22_KEY = 'rdesk_v22_encrypted_vault';
    function readLegacyV22Vault() {
        try {
            const rec = JSON.parse(localStorage.getItem(LEGACY_V22_KEY) || 'null');
            return rec && rec.salt && rec.iv && rec.ciphertext ? rec : null;
        } catch (e) {
            return null;
        }
    }

    async function importLegacyV22Vault(legacyPassword) {
        const rec = readLegacyV22Vault();
        if (!rec) throw new Error('Nenhum cofre anterior encontrado neste navegador.');
        if (!legacyPassword) throw new Error('Digite a senha do cofre anterior.');
        let mnemonic;
        try {
            const key = await deriveAesKey(legacyPassword, safeBase64ToBytes(rec.salt), ['decrypt'], Number(rec.iterations) || 600000);
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: safeBase64ToBytes(rec.iv) }, key, safeBase64ToBytes(rec.ciphertext));
            mnemonic = new TextDecoder().decode(plain);
        } catch (e) {
            throw new Error('Senha do cofre anterior incorreta.');
        }
        // Cofre novo ainda sem senha: reaproveita a mesma senha. Se já existe, precisa estar desbloqueado.
        if (!requiresVaultPasswordSetup() && !state.unlockedSecrets) {
            throw new Error('Desbloqueie o cofre atual primeiro e tente de novo.');
        }
        if (requiresVaultPasswordSetup() && legacyPassword.length < MIN_PASSWORD_LENGTH) {
            throw new Error(`A senha antiga tem menos de ${MIN_PASSWORD_LENGTH} caracteres. Use "Importar frase-semente" com as suas palavras e crie uma senha nova.`);
        }
        await addAccountFromMnemonic({ mnemonic, name: 'Carteira anterior', password: legacyPassword });
        localStorage.removeItem(LEGACY_V22_KEY); // já está guardada no cofre novo
        try { indexedDB.deleteDatabase('RDESK_V22_SECURE_VAULT'); } catch (e) {}
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
        const target = state.accounts.find((a) => a.id === accountId);
        if (!target) return;
        const hasStoredKey = target.type === 'seed' || target.type === 'pk';
        if (hasStoredKey && !state.unlockedSecrets) {
            throw new Error('Desbloqueie o cofre para apagar esta carteira: a chave dela precisa ser removida do aparelho.');
        }
        state.accounts = state.accounts.filter((a) => a.id !== accountId);
        if (state.unlockedSecrets) {
            delete state.unlockedSecrets.pkMap[accountId];
            // A frase só sai do cofre quando nenhuma outra conta deriva dela.
            if (target.seedGroupId && !state.accounts.some((a) => a.seedGroupId === target.seedGroupId)) {
                delete state.unlockedSecrets.masterSeedMap[target.seedGroupId];
            }
        }
        delete state.balancesCache[target.address.toLowerCase()];
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
    const NETWORK_NAMES = { 137: 'matic', 42161: 'arbitrum', 8453: 'base', 10: 'optimism', 1: 'homestead' };
    const preferredRpcIndex = {};

    function buildProvider(chainId, rpcUrl) {
        return new ethers.providers.StaticJsonRpcProvider(rpcUrl, { chainId: Number(chainId), name: NETWORK_NAMES[chainId] || 'unknown' });
    }

    function getReadProvider(chainId = 137) {
        const id = Number(chainId);
        const list = CHAIN_RPC_LISTS[id] || POLYGON_RPCS;
        return buildProvider(CHAIN_RPC_LISTS[id] ? id : 137, list[preferredRpcIndex[id] || 0]);
    }

    function withTimeout(promise, ms) {
        return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
    }

    // Devolve um provedor que respondeu agora; lembra qual servidor está saudável.
    async function getHealthyProvider(chainId = 137) {
        const id = Number(chainId);
        const list = CHAIN_RPC_LISTS[id] || POLYGON_RPCS;
        const start = preferredRpcIndex[id] || 0;
        for (let i = 0; i < list.length; i++) {
            const idx = (start + i) % list.length;
            const provider = buildProvider(id, list[idx]);
            try {
                await withTimeout(provider.getBlockNumber(), 4500);
                preferredRpcIndex[id] = idx;
                return provider;
            } catch (e) {}
        }
        throw new Error('Nenhum servidor da rede respondeu. Verifique sua conexão e tente de novo.');
    }

    // Ajusta o cálculo de taxa EIP-1559 (piso de gorjeta por rede).
    function applyFeePolicy(provider, chainId) {
        const baseGetFeeData = provider.getFeeData.bind(provider);
        provider.getFeeData = async () => {
            const [block, gasPrice, tipHex] = await Promise.all([
                provider.getBlock('latest'),
                provider.getGasPrice().catch(() => null),
                provider.send('eth_maxPriorityFeePerGas', []).catch(() => null)
            ]);
            if (!block || !block.baseFeePerGas) return baseGetFeeData();
            const floor = ethers.utils.parseUnits(String(MIN_PRIORITY_FEE_GWEI[Number(chainId)] || 0), 'gwei');
            let tip = tipHex ? ethers.BigNumber.from(tipHex) : ethers.utils.parseUnits('1.5', 'gwei');
            if (tip.lt(floor)) tip = floor;
            return {
                lastBaseFeePerGas: block.baseFeePerGas,
                maxPriorityFeePerGas: tip,
                maxFeePerGas: block.baseFeePerGas.mul(2).add(tip),
                gasPrice
            };
        };
        return provider;
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
        touchAutoLock();
        const provider = applyFeePolicy(await getHealthyProvider(chainId), chainId);
        return new ethers.Wallet(privateKey, provider);
    }

    async function refreshAllAccountsBalances() {
        if (!state.accounts.length) return getActiveAccountBalances();
        await refreshLiveMarketPrices();

        try {
            const provider = await getHealthyProvider(137);
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

            // Notifica imediatamente o Swap e o Painel após os saldos reais chegarem!
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

        const walletPanel = document.getElementById('tab-panel-wallet') || document.body;
        const explicitBadge = document.getElementById('hero-wallet-badge') || document.getElementById('active-wallet-badge');
        let badgeTarget = explicitBadge;
        if (!badgeTarget) {
            walletPanel.querySelectorAll('span, div, button').forEach((el) => {
                if (el.children.length === 0 && /Nenhuma carteira ativa|Cofre Local|Carteira Ativa|Rabby Conectada|Observação/i.test(el.textContent.trim())) {
                    badgeTarget = el;
                }
            });
        }

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

            if (totalBrlEl && /0,00/.test(totalBrlEl.textContent) && cached.brl > 0) {
                totalBrlEl.textContent = cached.brl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            }
            if (totalUsdEl && /0\.00/.test(totalUsdEl.textContent) && cached.usd > 0) {
                totalUsdEl.textContent = `$ ${cached.usd.toFixed(2)} • Cotação Dólar: R$ ${cached.usdBrl.toFixed(3)}`;
            }

            // Atualiza pílula "Livre na Carteira: R$ 0,00"
            document.querySelectorAll('span, div').forEach((el) => {
                if (el.children.length === 0 && /Livre na Carteira:\s*R\$\s*0,00/.test(el.textContent) && cached.brl > 0) {
                    el.textContent = el.textContent.replace(
                        /Livre na Carteira:\s*R\$\s*0,00/,
                        `Livre na Carteira: ${cached.brl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
                    );
                }
            });

            // Sincroniza o label "Disponível: X.XX" na aba Trocar / Ponte
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
        renderHeroAndAssets();

        const events = fromBalanceLoad
            ? ['rdesk:balancesUpdated', 'rdesk:walletChanged', 'wallet:changed', 'rdesk:wallet-updated']
            : ['rdesk:walletChanged', 'rdesk:wallet-changed', 'rdesk-wallet-changed', 'wallet:changed', 'walletChanged', 'rdesk:wallet-updated'];

        events.forEach((evName) => {
            try {
                window.dispatchEvent(new CustomEvent(evName, { detail: pubState }));
                document.dispatchEvent(new CustomEvent(evName, { detail: pubState }));
            } catch (e) {}
        });

        changeListeners.forEach((fn) => {
            try { fn(addr, acc, pubState); } catch (e) {}
        });

        const defi = window.RdeskDefi;
        if (defi) {
            const safeCall = (fnName, ...args) => {
                try {
                    if (typeof defi[fnName] === 'function') {
                        const res = defi[fnName](...args);
                        if (res && typeof res.catch === 'function') res.catch(() => {});
                    }
                } catch (e) {}
            };
            safeCall('onWalletChanged', addr, pubState);
            safeCall('setWallet', addr);
            safeCall('refreshAll');
            safeCall('refreshWallet');
            safeCall('refreshBalances');
            safeCall('refreshSwapQuote');
            safeCall('updateSwapQuote');
            safeCall('refreshPoolAndPositions');
            safeCall('refreshPixAndSwap');
            safeCall('runAudit', false);
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
        // Nada sensível (frase em criação, chave revelada, senha digitada) fica na página depois de fechar.
        createSeedDraft = null;
        overlay?.querySelector('.rmw-sheet')?.replaceChildren();
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
    // TELA RECEBER (QR CODE + COPIAR ENDEREÇO — 100% COMPATÍVEL COM RABBY MOBILE)
    // -------------------------------------------------------------------------
    function drawLocalQr(target, text, size) {
        if (!target) return;
        target.replaceChildren();
        if (typeof QRCode === 'undefined') {
            target.textContent = 'QR indisponível';
            return;
        }
        new QRCode(target, { text, width: size, height: size, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    }

    function renderReceiveView(sheet) {
        const acc = getActiveAccount();
        if (!acc) { currentView = 'add'; renderModal(); return; }
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
                    ${esc(acc.name)}
                </div>
                <div style="background:#ffffff;border:1px solid rgba(234,179,8,0.35);border-radius:16px;padding:12px;display:inline-block;">
                    <div id="rmw-rec-qr" style="width:190px;height:190px;"></div>
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

        drawLocalQr(sheet.querySelector('#rmw-rec-qr'), acc.address, 190);
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
                De: <strong style="color:#fff;">${esc(acc.name)}</strong> (${acc.address.slice(0, 6)}...${acc.address.slice(-4)})
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
            const sendBtn = sheet.querySelector('#rmw-snd-exec');
            const msgBox = sheet.querySelector('#rmw-snd-msg');
            msgBox.innerHTML = '';
            const sym = sheet.querySelector('#rmw-snd-token').value;
            const to = sheet.querySelector('#rmw-snd-to').value.trim();
            const amtStr = sheet.querySelector('#rmw-snd-amt').value.trim();

            try {
                if (!ethers.utils.isAddress(to)) throw new Error('Endereço de destino inválido.');
                if (!amtStr || !(parseFloat(amtStr) > 0)) throw new Error('Informe uma quantidade válida.');
                const dest = ethers.utils.getAddress(to);
                const meta = TOKENS_META[sym];
                const amountWei = ethers.utils.parseUnits(amtStr, meta.decimals);

                // Última conferência antes de assinar: envio em blockchain não tem estorno.
                if (!confirm(`Enviar ${amtStr} ${sym} na rede Polygon para:\n\n${dest}\n\nConfira o endereço inteiro. Este envio não pode ser desfeito.`)) return;

                sendBtn.disabled = true;
                const signer = await getActiveSigner(137);

                msgBox.innerHTML = `<div class="rmw-alert-ok">Aguardando assinatura na carteira...</div>`;
                let tx;
                if (!meta.address) {
                    tx = await signer.sendTransaction({ to: dest, value: amountWei });
                } else {
                    const contract = new ethers.Contract(meta.address, ERC20_ABI, signer);
                    tx = await contract.transfer(dest, amountWei);
                }

                msgBox.innerHTML = `<div class="rmw-alert-ok">Transação enviada (${tx.hash.slice(0, 10)}...) Confirmando...</div>`;
                await tx.wait();
                msgBox.innerHTML = `<div class="rmw-alert-ok">✅ Envio confirmado na Polygon!</div>`;
                refreshAllAccountsBalances();
            } catch (err) {
                msgBox.innerHTML = `<div class="rmw-alert-err">${esc(err?.reason || err?.message || 'Envio cancelado.')}</div>`;
            } finally {
                sendBtn.disabled = false;
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
                                <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(acc.name)}</span>
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
                <button class="rmw-btn-primary" id="rmw-bio-unlock-btn" style="margin-top:0;${bioReady ? '' : 'display:none;'}">👆 Desbloquear com Biometria</button>
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
            if (confirm('ATENÇÃO: isso apaga TODAS as carteiras e chaves guardadas neste navegador.\n\nSeus fundos continuam na blockchain, mas só podem ser recuperados com a frase-semente ou a chave privada que você anotou. Sem esse backup, o acesso é perdido para sempre.\n\nApagar tudo mesmo assim?')) {
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

            ${readLegacyV22Vault() ? `
            <div style="background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.4);border-radius:14px;padding:12px;margin-bottom:10px;">
                <div style="font-weight:700;font-size:0.92rem;margin-bottom:4px;">♻️ Cofre da versão anterior encontrado</div>
                <div style="font-size:0.78rem;color:#94a3b8;margin-bottom:8px;">Há uma carteira criada na versão antiga deste app neste navegador. Digite a senha dela para trazê-la para cá.</div>
                <input type="password" class="rmw-input" id="rmw-legacy-pass" placeholder="Senha do cofre anterior" autocomplete="off">
                <button class="rmw-btn-primary" id="rmw-legacy-import" style="margin-top:8px;">Recuperar carteira anterior</button>
            </div>` : ''}

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

        sheet.querySelector('#rmw-legacy-import')?.addEventListener('click', async () => {
            const msgBox = sheet.querySelector('#rmw-add-msg');
            const btn = sheet.querySelector('#rmw-legacy-import');
            btn.disabled = true;
            try {
                await importLegacyV22Vault(sheet.querySelector('#rmw-legacy-pass').value);
                currentView = 'list';
                renderModal();
            } catch (err) {
                msgBox.innerHTML = `<div class="rmw-alert-err">${esc(err.message)}</div>`;
                btn.disabled = false;
            }
        });

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
                        enableBio: false
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
                    enableBio: false
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
                <input type="text" class="rmw-input" id="rmw-f-name" value="${esc(createSeedDraft.name)}" placeholder="Ex: CAIXA FORTE, POOL V3...">

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
                    <input type="password" class="rmw-input" id="rmw-f-pass" value="${esc(createSeedDraft.password)}" placeholder="Mínimo 8 caracteres">
                ` : ''}

                ${needsPassword ? `
                    <label style="display:flex;align-items:center;gap:8px;font-size:0.84rem;color:#cbd5e1;margin:8px 0;cursor:pointer;">
                        <input type="checkbox" id="rmw-f-bio" ${createSeedDraft.enableBio ? 'checked' : ''}>
                        <span>👆 Ativar desbloqueio por biometria neste aparelho</span>
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
                if (needsPassword && pwd.length < MIN_PASSWORD_LENGTH) {
                    msgBox.innerHTML = `<div class="rmw-alert-err">Crie uma senha de pelo menos ${MIN_PASSWORD_LENGTH} caracteres para o cofre antes de continuar.</div>`;
                    return;
                }
                if (isLockedExisting && !pwd) {
                    msgBox.innerHTML = `<div class="rmw-alert-err">Informe a senha do cofre antes de continuar.</div>`;
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
                <input type="password" class="rmw-input" id="rmw-f-pass" placeholder="Mínimo 8 caracteres">
            ` : ''}

            ${activeFormMode !== 'watch-only' && needsPassword ? `
                <label style="display:flex;align-items:center;gap:8px;font-size:0.84rem;color:#cbd5e1;margin:8px 0;cursor:pointer;">
                    <input type="checkbox" id="rmw-f-bio">
                    <span>👆 Ativar desbloqueio por biometria neste aparelho</span>
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
                        <input type="text" class="rmw-input" id="rmw-det-name" value="${esc(acc.name)}" style="margin:0;padding:7px 10px;font-weight:700;">
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
                <div id="rmw-det-qr" style="width:92px;height:92px;padding:5px;box-sizing:content-box;border-radius:10px;background:#fff;"></div>
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
        drawLocalQr(sheet.querySelector('#rmw-det-qr'), acc.address, 92);

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

        let secretHideTimer = null;
        const hideSecret = () => { clearTimeout(secretHideTimer); secretArea.replaceChildren(); };

        const showSecretValue = (kind) => {
            const { privateKey, mnemonic } = exportAccountSecrets(acc.id);
            const value = kind === 'seed' ? mnemonic : privateKey;
            const title = kind === 'seed' ? 'Frase-Semente (12/24 palavras)' : 'Chave Privada (0x...)';
            secretArea.innerHTML = `
                <div class="rmw-secret-box">
                    <div style="font-size:0.74rem;color:#94a3b8;margin-bottom:4px;">${title} — nunca compartilhe. Some da tela em 60 segundos.</div>
                    <div id="rmw-secret-value"></div>
                    <button class="rmw-btn-secondary" id="rmw-copy-secret-val" style="margin-top:8px;padding:7px;">📋 Copiar (apaga da área de transferência em 45s)</button>
                    <button class="rmw-btn-secondary" id="rmw-hide-secret-val" style="margin-top:6px;padding:7px;">Ocultar agora</button>
                </div>
            `;
            secretArea.querySelector('#rmw-secret-value').textContent = value;
            secretArea.querySelector('#rmw-copy-secret-val').onclick = async () => {
                await copyToClipboardSafe(value);
                secretArea.querySelector('#rmw-copy-secret-val').textContent = '✅ Copiado — será apagado em 45s';
                setTimeout(async () => {
                    try {
                        if (navigator.clipboard?.readText && (await navigator.clipboard.readText()) !== value) return;
                    } catch (e) {}
                    copyToClipboardSafe(' ');
                }, 45000);
            };
            secretArea.querySelector('#rmw-hide-secret-val').onclick = hideSecret;
            clearTimeout(secretHideTimer);
            secretHideTimer = setTimeout(hideSecret, 60000);
        };

        // Mesmo com o cofre aberto, ver a frase ou a chave exige digitar a senha de novo.
        const revealSecret = (kind) => {
            if (!state.unlockedSecrets) {
                msgBox.innerHTML = `<div class="rmw-alert-err">Cofre bloqueado. Desbloqueie primeiro.</div>`;
                return;
            }
            msgBox.replaceChildren();
            secretArea.innerHTML = `
                <div class="rmw-secret-box">
                    <div style="font-size:0.8rem;color:#e2e8f0;margin-bottom:6px;">Digite a senha do cofre para ver ${kind === 'seed' ? 'a frase-semente' : 'a chave privada'}:</div>
                    <input type="password" class="rmw-input" id="rmw-reveal-pass" placeholder="Senha do cofre" autocomplete="off">
                    <button class="rmw-btn-primary" id="rmw-reveal-confirm" style="margin-top:8px;">Mostrar</button>
                </div>
            `;
            const confirmReveal = () => {
                const typed = secretArea.querySelector('#rmw-reveal-pass')?.value || '';
                if (typed !== state.unlockedSecrets?.password) {
                    msgBox.innerHTML = `<div class="rmw-alert-err">Senha incorreta.</div>`;
                    return;
                }
                try {
                    msgBox.replaceChildren();
                    showSecretValue(kind);
                } catch (err) {
                    msgBox.innerHTML = `<div class="rmw-alert-err">${esc(err.message)}</div>`;
                }
            };
            secretArea.querySelector('#rmw-reveal-confirm').onclick = confirmReveal;
            secretArea.querySelector('#rmw-reveal-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmReveal(); });
            secretArea.querySelector('#rmw-reveal-pass').focus();
        };

        sheet.querySelector('#rmw-det-show-seed')?.addEventListener('click', () => revealSecret('seed'));
        sheet.querySelector('#rmw-det-show-pk')?.addEventListener('click', () => revealSecret('pk'));

        sheet.querySelector('#rmw-det-delete').onclick = async () => {
            const hasKey = acc.type === 'seed' || acc.type === 'pk';
            const warning = hasKey
                ? `Apagar "${acc.name}" (${acc.address.slice(0, 6)}...${acc.address.slice(-4)})?\n\nA chave desta carteira será removida deste aparelho. Sem o backup da frase ou da chave privada, os fundos ficam inacessíveis para sempre.`
                : `Remover "${acc.name}" (${acc.address.slice(0, 6)}...${acc.address.slice(-4)}) desta lista?`;
            if (!confirm(warning)) return;
            try {
                await deleteSingleAccount(acc.id);
                currentView = state.accounts.length ? 'list' : 'add';
                renderModal();
            } catch (err) {
                msgBox.innerHTML = `<div class="rmw-alert-err">${esc(err.message)}</div>`;
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
                setTimeout(() => {
                    const anyExternalModalOpen = Array.from(document.querySelectorAll('[id*="receive"], [class*="receive-modal"]'))
                        .some((el) => el.id !== 'rdesk-mw-overlay' && (el.classList.contains('open') || el.classList.contains('active') || el.style.display === 'flex' || el.style.display === 'block'));
                    if (!anyExternalModalOpen) {
                        openReceiveModal();
                    }
                }, 60);
            } else if (isSendBtn) {
                setTimeout(() => {
                    const anyExternalModalOpen = Array.from(document.querySelectorAll('[id*="send"], [class*="send-modal"]'))
                        .some((el) => el.id !== 'rdesk-mw-overlay' && (el.classList.contains('open') || el.classList.contains('active') || el.style.display === 'flex' || el.style.display === 'block'));
                    if (!anyExternalModalOpen) {
                        openSendModal();
                    }
                }, 60);
            }
        });
    }

    // =========================================================================
    // 10. INICIALIZAÇÃO E API PÚBLICA COMPLETA (window.RdeskWallet)
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
        INSECURE_BIO_KEYS.forEach((k) => localStorage.removeItem(k));
        await restoreVaultFromBackupIfMissing();
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

        bindCompatUi();
        bindHeroActionFallbacks();
        await refreshLiveMarketPrices();
        notifyAccountChanged(false);
        await refreshBalancesCompat();
    }

    // =========================================================================
    // 11. CAMADA DE COMPATIBILIDADE v23 (CONTRATO COM defi-pix-service.js)
    //     Recibo em R$, constantes, formatadores, saldos multi-rede (array),
    //     tela "Suas Moedas", hero card, barra de bloqueio e evento de sync.
    // =========================================================================
    const GAS_RESERVE_POL = 3.0;

    const CHAIN_NAMES = { 137: 'Polygon', 42161: 'Arbitrum', 8453: 'Base', 10: 'Optimism', 1: 'Ethereum' };

    // priceKey: 'USD' = 1 dólar | 'BRL' = 1 real | demais = chave em getPrices()
    const CHAIN_TOKENS = {
        137: [
            { symbol: 'POL',  address: null, decimals: 18, isNative: true, priceKey: 'POL' },
            { symbol: 'WPOL', address: TOKENS_META.WPOL.address, decimals: 18, priceKey: 'POL' },
            { symbol: 'USDT', address: TOKENS_META.USDT0.address, decimals: 6, priceKey: 'USD' },
            { symbol: 'USDC', address: TOKENS_META.USDC.address, decimals: 6, priceKey: 'USD' },
            { symbol: 'BRZ',  address: TOKENS_META.BRZ.address, decimals: 18, priceKey: 'BRL' },
            { symbol: 'BRLA', address: TOKENS_META.BRLA.address, decimals: 18, priceKey: 'BRL' },
            { symbol: 'WBTC', address: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', decimals: 8, priceKey: 'BTC' }
        ],
        42161: [
            { symbol: 'ETH',  address: null, decimals: 18, isNative: true, priceKey: 'ETH' },
            { symbol: 'USDT', address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', decimals: 6, priceKey: 'USD' },
            { symbol: 'USDC', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', decimals: 6, priceKey: 'USD' },
            { symbol: 'WBTC', address: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', decimals: 8, priceKey: 'BTC' }
        ],
        8453: [
            { symbol: 'ETH',  address: null, decimals: 18, isNative: true, priceKey: 'ETH' },
            { symbol: 'USDC', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6, priceKey: 'USD' }
        ],
        10: [
            { symbol: 'ETH',  address: null, decimals: 18, isNative: true, priceKey: 'ETH' },
            { symbol: 'USDT', address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', decimals: 6, priceKey: 'USD' },
            { symbol: 'USDC', address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', decimals: 6, priceKey: 'USD' }
        ],
        1: [
            { symbol: 'ETH',  address: null, decimals: 18, isNative: true, priceKey: 'ETH' },
            { symbol: 'USDT', address: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6, priceKey: 'USD' },
            { symbol: 'USDC', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6, priceKey: 'USD' },
            { symbol: 'WBTC', address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', decimals: 8, priceKey: 'BTC' }
        ]
    };

    state.lpUsd = 0;
    state.chainBalances = {}; // { [addrLower]: [{ chainId, symbol, amount }] }

    function formatBRL(value) {
        const n = Number(value);
        return (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function formatUSD(value) {
        const n = Number(value);
        return (Number.isFinite(n) ? n : 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    }

    function unitUsdFor(priceKey) {
        const p = getNormalizedPricesObject();
        if (priceKey === 'USD') return 1;
        if (priceKey === 'BRL') return 1 / p.usdBrl;
        return Number(p[priceKey]) || 0;
    }

    function getBalancesArray() {
        const acc = getActiveAccount();
        let list = acc ? state.chainBalances[acc.address.toLowerCase()] : null;

        // Fallback: enquanto os saldos multi-rede não chegam, usa o cache da Polygon
        if (!list && acc) {
            const cached = state.balancesCache[acc.address.toLowerCase()];
            if (cached?.tokens) {
                const t = cached.tokens;
                list = [
                    { chainId: 137, symbol: 'POL',  amount: t.POL || 0 },
                    { chainId: 137, symbol: 'WPOL', amount: t.WPOL || 0 },
                    { chainId: 137, symbol: 'USDT', amount: t.USDT0 || 0 },
                    { chainId: 137, symbol: 'USDC', amount: t.USDC || 0 },
                    { chainId: 137, symbol: 'BRZ',  amount: t.BRZ || 0 },
                    { chainId: 137, symbol: 'BRLA', amount: t.BRLA || 0 }
                ];
            }
        }

        const usdBrl = getNormalizedPricesObject().usdBrl;
        const arr = (list || []).map((b) => {
            const meta = (CHAIN_TOKENS[b.chainId] || []).find((t) => t.symbol === b.symbol);
            const usdValue = b.amount * unitUsdFor(meta ? meta.priceKey : 'USD');
            return { chainId: b.chainId, symbol: b.symbol, amount: b.amount, usdValue, brlValue: usdValue * usdBrl };
        });

        // Mantém as propriedades antigas (pol, wpol, usdt0, totalUsd...) por compatibilidade
        return Object.assign(arr, getActiveAccountBalances());
    }

    async function refreshChainBalancesForActive() {
        const acc = getActiveAccount();
        if (!acc || typeof ethers === 'undefined') return;

        const addr = acc.address;
        const jobs = [];

        Object.keys(CHAIN_TOKENS).forEach((cid) => {
            const chainId = Number(cid);
            const provider = getReadProvider(chainId);
            CHAIN_TOKENS[chainId].forEach((tk) => {
                jobs.push((async () => {
                    try {
                        let raw;
                        if (tk.isNative) {
                            raw = await provider.getBalance(addr);
                        } else {
                            const c = new ethers.Contract(tk.address, ERC20_ABI, provider);
                            raw = await c.balanceOf(addr);
                        }
                        return { chainId, symbol: tk.symbol, amount: parseFloat(ethers.utils.formatUnits(raw, tk.decimals)) || 0, ok: true };
                    } catch (e) {
                        return { chainId, symbol: tk.symbol, amount: 0, ok: false };
                    }
                })());
            });
        });

        const results = await Promise.all(jobs);
        const previous = state.chainBalances[addr.toLowerCase()] || [];

        // Se uma consulta falhar (RPC fora do ar), mantém o último saldo conhecido em vez de zerar
        state.chainBalances[addr.toLowerCase()] = results.map((r) => {
            if (r.ok) return { chainId: r.chainId, symbol: r.symbol, amount: r.amount };
            const old = previous.find((p) => p.chainId === r.chainId && p.symbol === r.symbol);
            return { chainId: r.chainId, symbol: r.symbol, amount: old ? old.amount : 0 };
        });
    }

    async function refreshBalancesCompat() {
        await refreshAllAccountsBalances();
        try { await refreshChainBalancesForActive(); } catch (e) {}
        notifyAccountChanged(true);
        return getBalancesArray();
    }

    function setLpUsdTotal(usd) {
        const n = Number(usd);
        state.lpUsd = Number.isFinite(n) && n > 0 ? n : 0;
        renderHeroAndAssets();
    }

    function renderHeroAndAssets() {
        const acc = getActiveAccount();
        const prices = getNormalizedPricesObject();
        const balances = getBalancesArray();
        const freeUsd = balances.reduce((s, b) => s + (b.usdValue || 0), 0);
        const lpUsd = state.lpUsd || 0;
        const totalUsd = freeUsd + lpUsd;
        const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

        set('hero-total-brl', formatBRL(totalUsd * prices.usdBrl));
        set('hero-total-usd', `${formatUSD(totalUsd)} • Cotação Dólar: R$ ${prices.usdBrl.toFixed(3)}`);
        set('hero-breakdown', `Livre na Carteira: ${formatBRL(freeUsd * prices.usdBrl)}  •  Rendendo em Pools: ${formatBRL(lpUsd * prices.usdBrl)}`);
        set('top-oracle-pill', `Dólar: R$ ${prices.usdBrl.toFixed(2).replace('.', ',')}`);

        const badge = document.getElementById('wallet-mode-badge');
        const shortAddr = document.getElementById('wallet-short-addr');
        const copyBtn = document.getElementById('btn-copy-header-addr');
        if (!acc) {
            if (badge) badge.textContent = 'Nenhuma carteira ativa';
            if (copyBtn) copyBtn.style.display = 'none';
        } else {
            if (badge) {
                badge.textContent = acc.type === 'rabby' ? '🦊 Rabby Conectada'
                    : acc.type === 'watch' ? '👁️ Modo Observação'
                    : (state.isLocked ? '🔒 Cofre Local (Leitura)' : '🔓 Cofre Desbloqueado');
            }
            if (shortAddr) shortAddr.textContent = `${acc.address.slice(0, 6)}...${acc.address.slice(-4)}`;
            if (copyBtn) copyBtn.style.display = 'inline-flex';
        }

        // Botão "Bloquear" e barra de desbloqueio rápido
        const isVault = acc && (acc.type === 'seed' || acc.type === 'pk');
        const lockBtn = document.getElementById('btn-lock-vault');
        if (lockBtn) lockBtn.style.display = isVault && !state.isLocked ? 'inline-block' : 'none';
        const lockBar = document.getElementById('locked-vault-bar');
        if (lockBar) lockBar.style.display = isVault && state.isLocked ? 'flex' : 'none';

        // Lista "Suas Moedas"
        const listEl = document.getElementById('wallet-assets-list');
        if (listEl) {
            if (!acc) {
                listEl.innerHTML = '<div class="empty-state">Conecte ou crie sua carteira para visualizar seus saldos em Reais.</div>';
                return;
            }
            const filter = document.getElementById('wallet-chain-filter')?.value || 'ALL';
            const rows = balances
                .filter((b) => (filter === 'ALL' || String(b.chainId) === filter) && b.amount > 0)
                .sort((a, b) => b.usdValue - a.usdValue);
            if (!rows.length) {
                listEl.innerHTML = '<div class="empty-state">Nenhum saldo encontrado nesta seleção. Toque em Receber para depositar.</div>';
            } else {
                listEl.innerHTML = rows.map((b) => `
                    <div class="asset-row">
                        <div class="asset-left"><strong>${b.symbol}</strong><small class="muted-sm"> ${CHAIN_NAMES[b.chainId] || b.chainId}</small></div>
                        <div class="asset-right" style="text-align:right;">
                            <strong>${formatBRL(b.brlValue)}</strong><br>
                            <small class="muted-sm">${b.amount.toLocaleString('pt-BR', { maximumFractionDigits: 6 })} ${b.symbol}</small>
                        </div>
                    </div>`).join('');
            }
        }
    }

    function bindCompatUi() {
        document.getElementById('btn-lock-vault')?.addEventListener('click', () => lockVaultNow());
        document.getElementById('btn-quick-bio-unlock')?.addEventListener('click', async () => {
            try { await unlockWithBiometry(); }
            catch (err) { openWalletModal('unlock'); }
        });
        document.getElementById('btn-quick-pass-unlock')?.addEventListener('click', () => openWalletModal('unlock'));
        document.getElementById('wallet-chain-filter')?.addEventListener('change', renderHeroAndAssets);
        document.getElementById('btn-copy-header-addr')?.addEventListener('click', async () => {
            const acc = getActiveAccount();
            if (!acc) return;
            await copyToClipboardSafe(acc.address);
            const el = document.getElementById('wallet-short-addr');
            if (el) {
                const prev = el.textContent;
                el.textContent = '✅ Copiado!';
                setTimeout(() => { el.textContent = prev; }, 1500);
            }
        });
    }

    // Recibo em R$ antes de qualquer assinatura (usa o #modal-receipt do index.html)
    const receiptApi = {
        confirm(spec) {
            spec = spec || {};
            const overlay = document.getElementById('modal-receipt');
            if (!overlay) {
                return Promise.resolve(window.confirm(`${spec.title || 'Confirmar operação'}\n\nVocê envia: ${spec.sendVal || '--'} (${spec.sendBrl || ''})\nVocê recebe: ${spec.recvVal || '--'}\nRota: ${spec.route || '--'}\nGás: ${spec.gas || '--'}`));
            }
            const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text == null ? '--' : String(text); };
            set('rcp-title', spec.title || 'Confirmar Operação');
            set('rcp-send-val', spec.sendVal);
            set('rcp-send-brl', spec.sendBrl);
            set('rcp-recv-val', spec.recvVal);
            set('rcp-recv-brl', spec.recvBrl);
            set('rcp-route', spec.route);
            set('rcp-fee', spec.fee || 'R$ 0,00');
            set('rcp-gas', spec.gas);
            set('rcp-shield', spec.shield || `${GAS_RESERVE_POL.toFixed(1)} POL protegidos`);

            return new Promise((resolve) => {
                const okBtn = document.getElementById('btn-rcp-confirm');
                const noBtn = document.getElementById('btn-rcp-cancel');
                let done = false;

                const finish = (result) => {
                    if (done) return;
                    done = true;
                    overlay.style.display = 'none';
                    okBtn?.removeEventListener('click', onOk);
                    noBtn?.removeEventListener('click', onNo);
                    overlay.removeEventListener('click', onBackdrop);
                    document.removeEventListener('keydown', onKey);
                    resolve(result);
                };
                const onOk = () => finish(true);
                const onNo = () => finish(false);
                const onBackdrop = (e) => { if (e.target === overlay) finish(false); };
                const onKey = (e) => { if (e.key === 'Escape') finish(false); };

                okBtn?.addEventListener('click', onOk);
                noBtn?.addEventListener('click', onNo);
                overlay.addEventListener('click', onBackdrop);
                document.addEventListener('keydown', onKey);
                overlay.style.display = 'flex';
            });
        }
    };
    window.RdeskReceipt = receiptApi;

    const walletApi = {
        getAddress: () => getActiveAccount()?.address || '',
        getActiveAccount,
        getAccounts: () => [...state.accounts],
        getState: getPublicWalletState,
        getPrices: getPricesSyncOrRefresh,
        refreshPrices: refreshLiveMarketPrices,
        getBalances: getBalancesArray,
        getBalance: getSingleTokenBalance,
        getTokenBalance: getSingleTokenBalance,
        refreshBalances: refreshBalancesCompat,
        setLpUsdTotal,
        formatBRL,
        formatUSD,
        GAS_RESERVE_POL,
        CHAIN_TOKENS,
        CHAIN_NAMES,
        notePoolPrice,
        getHealthyProvider,
        isBiometrySupported,
        isBiometryRegistered,
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
        balances: { get: getBalancesArray, enumerable: true },
        prices:   { get: getPricesSyncOrRefresh, enumerable: true }
    });

    window.RdeskWallet = walletApi;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWalletEngine);
    } else {
        initWalletEngine();
    }
})();
