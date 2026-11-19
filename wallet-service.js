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
    const REG = window.RdeskRegistry;
    const MIN_PRIORITY_FEE_GWEI = Object.fromEntries(REG.CHAINS.filter((c) => c.minTipGwei).map((c) => [c.id, c.minTipGwei]));
    const IDB_NAME = 'rdesk_vault_backup';

    const CHAIN_RPC_LISTS = Object.fromEntries(REG.CHAINS.map((c) => [c.id, c.rpcs]));
    const POLYGON_RPCS = CHAIN_RPC_LISTS[137];
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
            celoUsd: 0,
            bnbUsd: 0,
            custom: {},        // { '137:0xabc…': preço em USD } para moedas adicionadas pelo usuário
            usdBrlLive: false, // false = ainda usando valor de reserva
            polLive: false,
            updatedAt: 0
        }
    };

    let currentView = 'list'; // 'list' | 'unlock' | 'add' | 'form' | 'detail' | 'receive' | 'send'
    let activeFormMode = 'create-seed';
    let inspectingAccountId = null;
    let createSeedDraft = null;
    let importLock = 'pin';
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
            CELO: Number(state.prices.celoUsd) || 0,
            BNB: Number(state.prices.bnbUsd) || 0,
            live: Boolean(state.prices.usdBrlLive && state.prices.polLive),
            usdBrlLive: Boolean(state.prices.usdBrlLive),
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
            state.prices.polLive = true; // preço lido direto da pool na blockchain
        }
    }

    const fetchJson = (url) => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

    // Dólar em reais: tenta três fontes independentes, na ordem.
    async function fetchUsdBrl() {
        const a = await fetchJson('https://economia.awesomeapi.com.br/last/USD-BRL');
        let v = parseFloat(a?.USDBRL?.bid);
        if (v > 2 && v < 20) return v;
        const b = await fetchJson('https://open.er-api.com/v6/latest/USD');
        v = parseFloat(b?.rates?.BRL);
        if (v > 2 && v < 20) return v;
        const c = await fetchJson('https://api.frankfurter.app/latest?from=USD&to=BRL');
        v = parseFloat(c?.rates?.BRL);
        return v > 2 && v < 20 ? v : null;
    }

    let pricesInFlight = null;
    async function refreshLiveMarketPrices() {
        if (pricesInFlight) return pricesInFlight;
        pricesInFlight = (async () => {
            try {
                const WPOL_KEY = 'polygon:0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';
                const customKeys = REG.loadCustomTokens().map((t) => `${REG.getChain(t.chainId).llama}:${t.address}`);
                const keys = [WPOL_KEY, 'coingecko:ethereum', 'coingecko:bitcoin', 'coingecko:celo', 'coingecko:binancecoin', ...customKeys];
                const [fx, coinsRes] = await Promise.all([
                    fetchUsdBrl(),
                    fetchJson(`https://coins.llama.fi/prices/current/${keys.join(',')}`)
                ]);
                const price = (k) => { const n = parseFloat(coinsRes?.coins?.[k]?.price); return Number.isFinite(n) && n > 0 ? n : null; };

                if (fx) { state.prices.usdBrl = fx; state.prices.usdBrlLive = true; }
                if (price('coingecko:ethereum')) state.prices.ethUsd = price('coingecko:ethereum');
                if (price('coingecko:bitcoin')) state.prices.btcUsd = price('coingecko:bitcoin');
                if (price('coingecko:celo')) state.prices.celoUsd = price('coingecko:celo');
                if (price('coingecko:binancecoin')) state.prices.bnbUsd = price('coingecko:binancecoin');
                if (price(WPOL_KEY)) {
                    state.prices.polUsd = price(WPOL_KEY);
                    state.prices.polLiveAt = Date.now();
                    state.prices.polLive = true;
                }
                REG.loadCustomTokens().forEach((t) => {
                    const v = price(`${REG.getChain(t.chainId).llama}:${t.address}`);
                    if (v) state.prices.custom[`${t.chainId}:${t.address.toLowerCase()}`] = v;
                });

                // Reserva para ETH/BTC quando a fonte principal falha
                if (!state.prices.ethUsd || !state.prices.btcUsd) {
                    const tick = await fetchJson('https://api.binance.com/api/v3/ticker/price?symbols=%5B%22ETHUSDT%22,%22BTCUSDT%22%5D');
                    (Array.isArray(tick) ? tick : []).forEach((row) => {
                        const v = parseFloat(row.price);
                        if (!(v > 0)) return;
                        if (row.symbol === 'ETHUSDT' && !state.prices.ethUsd) state.prices.ethUsd = v;
                        if (row.symbol === 'BTCUSDT' && !state.prices.btcUsd) state.prices.btcUsd = v;
                    });
                }
                state.prices.updatedAt = Date.now();
            } catch (e) {}
            return getNormalizedPricesObject();
        })();
        try { return await pricesInFlight; } finally { pricesInFlight = null; }
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
        ensureBtcAddresses();
        const existing = readVaultMetaFromStorage();
        let encryptedSecrets = existing?.encryptedSecrets || null;

        if (state.unlockedSecrets && state.unlockedSecrets.password) {
            encryptedSecrets = await encryptSecretsPayload(
                {
                    masterSeedMap: state.unlockedSecrets.masterSeedMap || {},
                    pkMap: state.unlockedSecrets.pkMap || {},
                    // senha extra (passphrase BIP39) de cada frase, quando a pessoa usa
                    passphraseMap: state.unlockedSecrets.passphraseMap || {}
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

        // Tipo de trava (não é segredo): "pin" mostra o teclado numérico para abrir
        const lockType = encryptedSecrets ? (state.lockType || existing?.lockType || 'password') : undefined;
        const payload = {
            version: 3,
            accounts: state.accounts,
            activeAccountId: state.activeAccountId,
            encryptedSecrets,
            lockType
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
            passphraseMap: secrets.passphraseMap || {},
            pkMap: secrets.pkMap || {},
            password
        };
        state.isLocked = false;
        if (Number(meta.encryptedSecrets.iterations) !== PBKDF2_ITERATIONS || ensureBtcAddresses()) {
            await persistVaultToStorage(); // regrava com a proteção atual / endereços Bitcoin
        }
        touchAutoLock();
        notifyAccountChanged();
        kickChainBalances();
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
        }, window.RdeskAnon?.autoLockMs?.() || AUTO_LOCK_MS); // modo anônimo: 2 min
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
        const pinOk = state.lockType === 'pin' && /^\d{6}$/.test(String(passwordIfNeeded || ''));
        if (!pinOk && (!passwordIfNeeded || passwordIfNeeded.length < MIN_PASSWORD_LENGTH)) {
            throw new Error(`Defina uma senha de pelo menos ${MIN_PASSWORD_LENGTH} caracteres para proteger seu cofre.`);
        }
        state.unlockedSecrets = { masterSeedMap: {}, pkMap: {}, passphraseMap: {}, password: passwordIfNeeded };
        state.isLocked = false;
        touchAutoLock();
        return state.unlockedSecrets;
    }

    // Senha extra (passphrase BIP39, a "25ª palavra") da frase: muda TODAS as carteiras geradas
    const passphraseOf = (seedGroupId) => state.unlockedSecrets?.passphraseMap?.[seedGroupId] || '';

    async function addAccountFromMnemonic({ mnemonic, name, hdIndex = 0, password, enableBio = false, passphrase = '' }) {
        const cleanPhrase = String(mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (!ethers.utils.isValidMnemonic(cleanPhrase)) {
            throw new Error('Frase-semente inválida. Verifique as 12 ou 24 palavras em inglês.');
        }
        const extra = String(passphrase || ''); // exatamente como digitada (maiúsculas e espaços contam)

        const secrets = await ensureUnlockedSecrets(password);
        secrets.passphraseMap = secrets.passphraseMap || {};
        const path = `m/44'/60'/0'/0/${Number(hdIndex) || 0}`;
        const hdNode = ethers.utils.HDNode.fromMnemonic(cleanPhrase, extra || undefined).derivePath(path);
        const address = ethers.utils.getAddress(hdNode.address);

        // Mesma frase + senha extra diferente = outro cofre
        let seedGroupId = Object.keys(secrets.masterSeedMap).find((k) => secrets.masterSeedMap[k] === cleanPhrase && (secrets.passphraseMap[k] || '') === extra);
        if (!seedGroupId) {
            seedGroupId = 'seed-' + Date.now();
            secrets.masterSeedMap[seedGroupId] = cleanPhrase;
            if (extra) secrets.passphraseMap[seedGroupId] = extra;
        }

        const existing = state.accounts.find((a) => a.address.toLowerCase() === address.toLowerCase());
        if (existing) {
            existing.name = name?.trim() || existing.name;
            existing.type = 'seed';
            existing.seedGroupId = seedGroupId;
            existing.hdIndex = Number(hdIndex) || 0;
            existing.words = cleanPhrase.split(' ').length;
            state.activeAccountId = existing.id;
        } else {
            const acc = {
                id: 'acc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
                name: (name && name.trim()) || `Carteira #${state.accounts.length + 1}`,
                address,
                type: 'seed',
                seedGroupId,
                hdIndex: Number(hdIndex) || 0,
                words: cleanPhrase.split(' ').length,
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
        await refreshAllAccountsBalances(); kickChainBalances();
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

    // Endereço Bitcoin (BIP84) de cada conta com chave; é público e fica salvo para aparecer mesmo com o cofre bloqueado.
    function ensureBtcAddresses() {
        if (!state.unlockedSecrets || !window.RdeskBitcoin) return false;
        let changed = false;
        state.accounts.forEach((acc) => {
            try { if (btcExtend(acc)) changed = true; } catch (e) {}
            if (acc.btcAddress) return;
            try {
                if (acc.type === 'seed' && state.unlockedSecrets.masterSeedMap[acc.seedGroupId]) {
                    acc.btcAddress = window.RdeskBitcoin.deriveFromMnemonic(state.unlockedSecrets.masterSeedMap[acc.seedGroupId], acc.hdIndex || 0, passphraseOf(acc.seedGroupId)).address;
                    changed = true;
                } else if (acc.type === 'pk' && state.unlockedSecrets.pkMap[acc.id]) {
                    acc.btcAddress = window.RdeskBitcoin.deriveFromPrivateKey(state.unlockedSecrets.pkMap[acc.id]).address;
                    changed = true;
                }
            } catch (e) {}
        });
        return changed;
    }

    // =========================================================================
    // BITCOIN COM ENDEREÇO NOVO A CADA RECEBIMENTO (BIP84)
    // Cofre 1 da frase: caminho padrão m/84'/0'/0' (recuperável em qualquer carteira Bitcoin).
    // Cofres seguintes da mesma frase: conta BIP84 própria m/84'/0'/k'.
    // Externo (/0/i) = endereços para receber; interno (/1/i) = troco. O endereço antigo continua
    // sendo lido. Os endereços (não são segredo) ficam salvos; as chaves só existem com o cofre aberto.
    // =========================================================================
    const BTC_GAP = 4; // quantos endereços novos ficam sempre preparados (e vigiados) à frente
    const btcHdOk = (acc) => acc && acc.type === 'seed';
    const btcBase = (acc) => `m/84'/0'/${acc.hdIndex || 0}'`;
    // No cofre 1, pula os índices que já são o endereço antigo de outro cofre da mesma frase
    function btcSkip(acc) {
        if ((acc.hdIndex || 0) !== 0) return new Set();
        return new Set(state.accounts.filter((a) => a.type === 'seed' && a.seedGroupId === acc.seedGroupId && a.id !== acc.id).map((a) => a.hdIndex || 0).filter((k) => k > 0));
    }
    function btcDerive(acc, chain, i) {
        const seed = state.unlockedSecrets?.masterSeedMap?.[acc.seedGroupId];
        if (!seed) throw new Error('Cofre bloqueado. Desbloqueie para usar o Bitcoin.');
        return window.RdeskBitcoin.deriveAtPath(seed, `${btcBase(acc)}/${chain}/${i}`, passphraseOf(acc.seedGroupId));
    }
    // Garante BTC_GAP endereços ainda não usados à frente, em cada lado (precisa do cofre aberto)
    function btcExtend(acc) {
        if (!btcHdOk(acc) || !state.unlockedSecrets) return false;
        acc.btcHd = acc.btcHd || { ext: [], int: [], extNext: 0, intNext: 0 };
        const hd = acc.btcHd, skip = btcSkip(acc);
        let changed = false;
        [['ext', 0, 'extNext'], ['int', 1, 'intNext']].forEach(([list, chain, nextKey]) => {
            let i = hd[list].length ? hd[list][hd[list].length - 1].i + 1 : 0;
            while (hd[list].filter((x) => x.i >= hd[nextKey]).length < BTC_GAP && i < 10000) {
                if (!(chain === 0 && skip.has(i))) { hd[list].push({ i, a: btcDerive(acc, chain, i).address }); changed = true; }
                i++;
            }
        });
        return changed;
    }
    // Todos os endereços a vigiar (antigo + recebimento + troco)
    function btcScanList(acc) {
        const set = new Set();
        if (acc?.btcAddress) set.add(acc.btcAddress);
        (acc?.btcHd?.ext || []).forEach((x) => set.add(x.a));
        (acc?.btcHd?.int || []).forEach((x) => set.add(x.a));
        return [...set];
    }
    // Endereço para receber agora: o primeiro ainda não usado
    function btcReceiveAddress(acc = getActiveAccount()) {
        if (!acc) return '';
        const hd = acc.btcHd;
        const fresh = hd?.ext?.find((x) => x.i >= hd.extNext);
        return fresh ? fresh.a : (acc.btcAddress || '');
    }
    function btcChangeAddress(acc = getActiveAccount()) {
        const hd = acc?.btcHd;
        const fresh = hd?.int?.find((x) => x.i >= hd.intNext);
        return fresh ? fresh.a : (acc?.btcAddress || '');
    }
    // Saldos por endereço (memória) e marcação de uso: endereço que já recebeu não é mostrado de novo
    state.btcPerAddr = state.btcPerAddr || {};
    function btcMarkUsage(acc, perAddr) {
        const hd = acc.btcHd;
        if (!hd) return false;
        let moved = false;
        hd.ext.forEach((x) => { if (perAddr[x.a]?.txCount > 0 && x.i >= hd.extNext) { hd.extNext = x.i + 1; moved = true; } });
        hd.int.forEach((x) => { if (perAddr[x.a]?.txCount > 0 && x.i >= hd.intNext) { hd.intNext = x.i + 1; moved = true; } });
        if (moved && state.unlockedSecrets) btcExtend(acc);
        return moved;
    }
    // Pular para um endereço novo sem esperar o atual ser usado (até um limite, para nada ficar fora da vigia)
    async function btcNewReceiveAddress() {
        const acc = getActiveAccount();
        if (!btcHdOk(acc)) throw new Error('Só cofres criados com palavras têm endereços novos.');
        if (state.isLocked || !state.unlockedSecrets) { openWalletModal('unlock'); throw new Error('Abra o cofre para gerar um endereço novo.'); }
        btcExtend(acc);
        const hd = acc.btcHd;
        const used = Math.max(0, ...hd.ext.filter((x) => (state.btcPerAddr[x.a]?.txCount || 0) > 0).map((x) => x.i + 1));
        if (hd.extNext - used >= 12) throw new Error('Já existem vários endereços novos sem uso. Use um deles antes de gerar outro.');
        const cur = hd.ext.find((x) => x.i >= hd.extNext);
        hd.extNext = (cur ? cur.i : hd.extNext) + 1;
        btcExtend(acc);
        await persistVaultToStorage();
        notifyAccountChanged();
        return btcReceiveAddress(acc);
    }
    // Moedas de todos os endereços do cofre, cada uma marcada com o endereço de onde veio
    async function btcGatherUtxos() {
        const acc = getActiveAccount();
        const list = btcScanList(acc).filter((a) => !state.btcPerAddr[a] || state.btcPerAddr[a].totalSats > 0);
        const all = await Promise.all(list.map((a) => window.RdeskBitcoin.fetchUtxos(a).then((us) => us.map((u) => ({ ...u, addr: a })))));
        return all.flat();
    }
    // Chave de um endereço do cofre (procura no antigo, no recebimento e no troco)
    function btcKeyFor(address, acc = getActiveAccount()) {
        if (!acc) throw new Error('Nenhuma carteira ativa.');
        if (state.isLocked || !state.unlockedSecrets) { openWalletModal('unlock'); throw new Error('Cofre bloqueado. Desbloqueie para assinar.'); }
        if (address === acc.btcAddress) return getActiveBitcoinKey();
        const hd = acc.btcHd;
        const e = hd?.ext?.find((x) => x.a === address), n = hd?.int?.find((x) => x.a === address);
        if (!e && !n) throw new Error('Este endereço não é deste cofre.');
        const key = btcDerive(acc, e ? 0 : 1, (e || n).i);
        if (key.address !== address) throw new Error('Erro interno: chave não confere com o endereço.');
        touchAutoLock();
        return key;
    }
    // Assina um plano cujas entradas vêm de vários endereços do cofre
    function btcSignPlan(plan, utxos) {
        const where = new Map(utxos.map((u) => [`${u.txid}:${u.vout}`, u.addr]));
        const cache = {};
        const inputs = plan.inputs.map((u) => {
            const addr = where.get(`${u.txid}:${u.vout}`);
            if (!addr) throw new Error('Uma das moedas não é deste cofre. Cancelado.');
            cache[addr] = cache[addr] || btcKeyFor(addr);
            return { ...u, privateKey: cache[addr].privateKey };
        });
        return window.RdeskBitcoin.signTransaction({ ...plan, inputs }, null);
    }
    // Endereço com mais Bitcoin confirmado (as trocas saem de um endereço só)
    function btcRichestAddress(acc = getActiveAccount()) {
        let best = acc?.btcAddress || '', max = -1;
        btcScanList(acc).forEach((a) => { const c = state.btcPerAddr[a]?.confirmedSats || 0; if (c > max) { max = c; best = a; } });
        return best;
    }
    // Depois de gastar, o troco foi para um endereço interno: passa para o próximo
    async function btcAfterSpend(plan) {
        const acc = getActiveAccount();
        const hd = acc?.btcHd;
        if (!hd) return;
        const ch = plan.outputs.find((o) => o.isChange);
        const x = ch && hd.int.find((y) => y.a === ch.address);
        if (x && x.i >= hd.intNext) { hd.intNext = x.i + 1; btcExtend(acc); await persistVaultToStorage(); }
    }

    // Chave Bitcoin da conta ativa (só com o cofre aberto).
    function getActiveBitcoinKey() {
        const acc = getActiveAccount();
        if (!acc) throw new Error('Nenhuma carteira ativa.');
        if (acc.type !== 'seed' && acc.type !== 'pk') throw new Error('Bitcoin só está disponível em carteiras criadas ou importadas neste app (frase ou chave privada).');
        if (state.isLocked || !state.unlockedSecrets) {
            openWalletModal('unlock');
            throw new Error('Cofre bloqueado. Desbloqueie para enviar Bitcoin.');
        }
        touchAutoLock();
        const key = acc.type === 'seed'
            ? window.RdeskBitcoin.deriveFromMnemonic(state.unlockedSecrets.masterSeedMap[acc.seedGroupId], acc.hdIndex || 0, passphraseOf(acc.seedGroupId))
            : window.RdeskBitcoin.deriveFromPrivateKey(state.unlockedSecrets.pkMap[acc.id]);
        if (acc.btcAddress && key.address !== acc.btcAddress) throw new Error('Erro interno: endereço Bitcoin não confere com a chave.');
        return key;
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
            hdIndex: nextIdx,
            passphrase: passphraseOf(seedGroupId)
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
        await refreshAllAccountsBalances(); kickChainBalances();
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
        await refreshAllAccountsBalances(); kickChainBalances();
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
        await refreshAllAccountsBalances(); kickChainBalances();
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
            const chain = REG.getChain(targetId);
            if (switchErr && switchErr.code === 4902 && chain) {
                const nativeToken = REG.getTokens(targetId).find((t) => t.isNative);
                await eth.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: hexChainId,
                        chainName: chain.name,
                        nativeCurrency: { name: nativeToken.symbol, symbol: nativeToken.symbol, decimals: 18 },
                        rpcUrls: [chain.rpcs[0]],
                        blockExplorerUrls: [chain.explorer + '/']
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
        await refreshAllAccountsBalances(); kickChainBalances();
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
                delete state.unlockedSecrets.masterSeedMap[target.seedGroupId]; if (state.unlockedSecrets.passphraseMap) delete state.unlockedSecrets.passphraseMap[target.seedGroupId];
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
            const node = ethers.utils.HDNode.fromMnemonic(phrase, passphraseOf(acc.seedGroupId) || undefined).derivePath(path);
            return { privateKey: node.privateKey, mnemonic: phrase };
        }
        throw new Error('Tipo de conta desconhecido.');
    }

    // =========================================================================
    // 6. PROVIDER, SIGNER MULTI-CHAIN & LEITURA DE SALDOS REAIS
    // =========================================================================
    const NETWORK_NAMES = { 137: 'matic', 42161: 'arbitrum', 8453: 'base', 10: 'optimism', 1: 'homestead', 42220: 'celo', 56: 'bnb' };
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

    // Confirmação de transação pelos NOSSOS servidores (não pelo da carteira conectada).
    // A Rabby e outros servidores públicos às vezes respondem "bad response" enquanto esperam a
    // confirmação, mesmo com a transação feita; aqui a confirmação é conferida em todos os servidores.
    async function confirmTx(tx, chainId = 137, opts = {}) {
        const hash = tx && (tx.hash || tx);
        if (!hash) throw new Error('Transação sem identificador.');
        const id = Number(chainId);
        const urls = CHAIN_RPC_LISTS[id] || POLYGON_RPCS;
        const providers = urls.map((u) => buildProvider(id, u));
        const deadline = Date.now() + (opts.timeoutMs || 240000);
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        while (Date.now() < deadline) {
            const lookups = providers.map((p) => withTimeout(p.getTransactionReceipt(hash), 7000).catch(() => null));
            if (tx && typeof tx.wait === 'function' && !opts.skipWalletWait) lookups.push(withTimeout(tx.wait(), 7000).catch((e) => (e && e.receipt ? e.receipt : null)));
            const receipts = (await Promise.all(lookups)).filter((r) => r && r.blockNumber);
            if (receipts.length) {
                const r = receipts[0];
                if (r.status === 0) {
                    const err = new Error('A rede recusou a transação (ela reverteu). Só a taxa da rede foi cobrada.');
                    err.reverted = true; err.receipt = r;
                    throw err;
                }
                return r;
            }
            await sleep(1500);
        }
        const explorer = REG.getChain(id)?.explorer;
        throw new Error(`A transação foi enviada mas ainda não confirmou. Confira em ${explorer ? `${explorer}/tx/${hash}` : hash}.`);
    }

    // Erro técnico (em inglês, da biblioteca ou do servidor) -> frase que qualquer pessoa entende
    function friendlyTxError(err, ctx = {}) {
        const raw = String(err?.reason || err?.error?.message || err?.data?.message || err?.message || err || '');
        if (err?.reverted) return raw;
        if (/user rejected|user denied|rejected by user|ACTION_REJECTED|cancel/i.test(raw) || err?.code === 4001 || err?.code === 'ACTION_REJECTED') return 'Você cancelou na carteira. Nada foi enviado.';
        if (/insufficient funds/i.test(raw)) return `Saldo de ${ctx.native || 'moeda da rede'} insuficiente para pagar a taxa da rede.`;
        if (/Too little received|slippage|price slippage/i.test(raw)) return 'O preço mudou além da proteção. Nada foi trocado; peça a cotação de novo.';
        if (/STF|transfer amount exceeds|exceeds balance/i.test(raw)) return 'Saldo ou autorização insuficiente para essa quantidade. Nada foi trocado.';
        if (/cannot estimate gas|UNPREDICTABLE_GAS_LIMIT|execution reverted/i.test(raw)) return 'A rede recusaria essa operação agora (a simulação falhou). Nada foi enviado. Tente de novo em alguns segundos.';
        if (/bad response|missing response|timeout|network|failed to fetch|SERVER_ERROR|could not detect/i.test(raw)) return 'O servidor da rede não respondeu. Atualize a carteira para conferir se a operação foi feita antes de tentar de novo.';
        if (/nonce/i.test(raw)) return 'Há outra transação pendente na carteira. Espere ela confirmar e tente de novo.';
        return raw.length > 160 ? `${raw.slice(0, 157)}…` : raw;
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
                await switchChainOnProvider(chainId);
            }
            const web3 = new ethers.providers.Web3Provider(eth, 'any');
            const net = await web3.getNetwork();
            if (chainId && net.chainId !== Number(chainId)) {
                throw new Error(`A Rabby está na rede errada. Troque para ${REG.getChain(chainId)?.name || chainId} e tente de novo.`);
            }
            return web3.getSigner();
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
        // Modo anônimo sem a Polygon marcada: não pergunta o saldo (o servidor veria o seu endereço)
        if (window.RdeskAnon && !window.RdeskAnon.chainAllowed(137)) return getActiveAccountBalances();

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
            // Cabeçalho mostra quem está usando, sem endereço (o endereço fica em "Receber")
            if (!acc) {
                topBtn.innerHTML = '<span class="who-avatar" aria-hidden="true">+</span><span class="who-text"><small>Bem-vindo</small><strong>Começar</strong></span>';
            } else {
                const kind = acc.type === 'watch' ? 'Só observando' : acc.type === 'rabby' ? 'Rabby' : (state.isLocked ? 'Trancada' : 'Carteira');
                topBtn.innerHTML = `<span class="who-avatar" aria-hidden="true" style="background:${getAvatarGradient(acc.address)}">${esc(String(acc.name || 'C').trim().charAt(0).toUpperCase() || 'C')}</span>` +
                    `<span class="who-text"><small>${kind}</small><strong>${esc(acc.name)}</strong></span><span class="who-caret" aria-hidden="true">▾</span>`;
            }
            topBtn.setAttribute('aria-label', acc ? `Carteira ${acc.name}. Toque para trocar ou adicionar carteiras` : 'Começar: criar ou abrir uma carteira');
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
                background: #141925; border: 1px solid rgba(255, 255, 255, 0.08);
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
            .rmw-acc-card.active { border-color: #f7931a; background: rgba(247, 147, 26, 0.09); }
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
            .rmw-badge.pk { background: rgba(52, 211, 153, 0.16); color: #34d399; }
            .rmw-badge.rabby { background: rgba(99, 102, 241, 0.2); color: #a5b4fc; }
            .rmw-opt-btn {
                width: 100%; background: #181e2c; border: 1px solid rgba(255,255,255,0.09);
                border-radius: 14px; padding: 13px 14px; margin-bottom: 9px;
                display: flex; align-items: center; gap: 12px; color: #f8fafc;
                cursor: pointer; text-align: left; font-size: 0.94rem; font-weight: 600;
            }
            .rmw-opt-btn:hover { border-color: #f7931a; background: #1e2638; }
            .rmw-opt-ico {
                width: 34px; height: 34px; border-radius: 10px; display: flex;
                align-items: center; justify-content: center; font-size: 1.1rem; flex-shrink: 0;
            }
            .rmw-btn-primary {
                width: 100%; background: linear-gradient(180deg, #ffa53a, #e07b00); color: #1a0f00; border: none;
                border-radius: 12px; padding: 12px; font-weight: 800; font-size: 0.94rem;
                cursor: pointer; margin-top: 6px;
            }
            .rmw-btn-primary:hover { filter: brightness(1.08); }
            .rmw-btn-secondary {
                width: 100%; background: rgba(255,255,255,0.07); color: #e2e8f0;
                border: 1px solid rgba(255,255,255,0.12); border-radius: 12px;
                padding: 11px; font-weight: 600; font-size: 0.9rem; cursor: pointer; margin-top: 8px;
            }
            .rmw-alert-warn {
                background: rgba(52,211,153,0.1); border: 1px solid rgba(52,211,153,0.38); color: #fde68a;
                border-radius: 12px; padding: 10px 12px; font-size: 0.8rem; line-height: 1.45; margin: 10px 0;
            }
            .rmw-alert-warn strong { color: #fff; }
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
                background: #090b10; border: 1px dashed #34d399; border-radius: 12px;
                padding: 10px; margin-top: 8px;
            }
            .rmw-word-pill {
                background: #141923; border: 1px solid rgba(255,255,255,0.08);
                border-radius: 8px; padding: 6px 7px; font-family: monospace; font-size: 0.8rem;
                color: #fde047; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .rmw-word-num { color: #64748b; font-size: 0.72rem; margin-right: 4px; }
            .rmw-secret-box {
                background: #090b10; border: 1px dashed #34d399; border-radius: 12px;
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
        viewTrail = [];
        viewParams = pendingViewParams || {};
        pendingViewParams = null;
        if (!overlay.classList.contains('open')) {
            // Se o "voltar" disparado pelo fechamento anterior ainda não chegou, a entrada nova
            // só é criada depois dele (senão aquele voltar fecharia esta janela recém-aberta).
            if (pendingSelfBack) pushAfterSelfBack = true;
            else { try { history.pushState({ rdeskModal: true }, ''); } catch (e) {} }
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

    function closeWalletModal(fromHistory) {
        const overlay = document.getElementById('rdesk-mw-overlay');
        const wasOpen = overlay && overlay.classList.contains('open');
        if (overlay) overlay.classList.remove('open');
        viewTrail = [];
        if (wasOpen && fromHistory !== true && history.state && history.state.rdeskModal) {
            pushAfterSelfBack = false;
            // Um "voltar" nosso já a caminho basta; um segundo voltaria duas páginas (podendo sair do app).
            if (!pendingSelfBack) { try { pendingSelfBack = true; history.back(); } catch (e) { pendingSelfBack = false; } }
        }
        // Nada sensível (frase em criação, chave revelada, senha digitada) fica na página depois de fechar.
        createSeedDraft = null;
        overlay?.querySelector('.rmw-sheet')?.replaceChildren();
    }

    function renderModal() {
        const sheet = document.getElementById('rdesk-mw-sheet');
        if (!sheet) return;

        trackViewTrail();
        try { window.dispatchEvent(new CustomEvent('rdesk:view', { detail: { view: currentView } })); } catch (e) {}
        if (externalViews[currentView]) externalViews[currentView](sheet, viewContext);
        else if (currentView === 'unlock') renderUnlockView(sheet);
        else if (currentView === 'add') renderAddMethodView(sheet);
        else if (currentView === 'form') renderFormView(sheet);
        else if (currentView === 'detail') renderDetailView(sheet);
        else renderListView(sheet);
        ensureBackButton(sheet);
        sheet.querySelectorAll('[data-scan-for]').forEach((btn) => {
            if (btn.dataset.scanBound || !window.RdeskQrScanner) return;
            btn.dataset.scanBound = '1';
            window.RdeskQrScanner.attach(btn, sheet.querySelector('#' + btn.getAttribute('data-scan-for')), { raw: btn.hasAttribute('data-scan-raw'), title: 'Ler QR Code' });
        });
    }

    // ---- Navegação: toda tela que não é a primeira ganha um botão "voltar" ----
    const externalViews = {};
    let viewTrail = [];
    let viewParams = {};
    let pendingViewParams = null;
    const trailParams = {};
    function trackViewTrail() {
        const idx = viewTrail.lastIndexOf(currentView);
        if (idx >= 0) viewTrail.length = idx + 1;
        else viewTrail.push(currentView);
        trailParams[currentView] = viewParams;
    }
    function navigateTo(view, params) {
        viewParams = params || {};
        currentView = view;
        renderModal();
    }
    function goBackOrClose() {
        if (viewTrail.length > 1) {
            viewTrail.pop();
            currentView = viewTrail[viewTrail.length - 1];
            viewParams = trailParams[currentView] || {};
            renderModal();
        } else {
            closeWalletModal();
        }
    }
    function ensureBackButton(sheet) {
        if (viewTrail.length < 2) return;
        if (sheet.querySelector('#rmw-back-btn, #rmw-verify-back, #rmw-form-back, #rmw-det-back, [data-rmw-back]')) return;
        const title = sheet.querySelector('.rmw-title');
        if (!title) return;
        const btn = document.createElement('button');
        btn.className = 'rmw-icon-btn';
        btn.setAttribute('data-rmw-back', '1');
        btn.setAttribute('aria-label', 'Voltar');
        btn.textContent = '←';
        btn.onclick = goBackOrClose;
        title.prepend(btn);
    }
    // Botão "voltar" do celular/navegador fecha a tela atual do modal em vez de sair do app.
    let pendingSelfBack = false, pushAfterSelfBack = false;
    window.addEventListener('popstate', () => {
        const overlay = document.getElementById('rdesk-mw-overlay');
        if (pendingSelfBack) { // voltar que nós mesmos pedimos ao fechar a janela
            pendingSelfBack = false;
            if (pushAfterSelfBack && overlay && overlay.classList.contains('open')) { try { history.pushState({ rdeskModal: true }, ''); } catch (e) {} }
            pushAfterSelfBack = false;
            return;
        }
        if (!overlay || !overlay.classList.contains('open')) return;
        if (viewTrail.length > 1) {
            history.pushState({ rdeskModal: true }, '');
            goBackOrClose();
        } else {
            closeWalletModal(true);
        }
    });

    const viewContext = {
        get params() { return viewParams; },
        esc: (v) => esc(v),
        navigate: navigateTo,
        back: goBackOrClose,
        close: () => closeWalletModal(),
        copy: (t) => copyToClipboardSafe(t),
        drawQr: (target, text, size) => drawLocalQr(target, text, size),
        getActiveAccount: () => getActiveAccount(),
        getSigner: (chainId) => getActiveSigner(chainId),
        getBitcoinKey: () => getActiveBitcoinKey(),
        btcReceiveAddress: () => btcReceiveAddress(),
        btcChangeAddress: () => btcChangeAddress(),
        gatherBitcoinUtxos: () => btcGatherUtxos(),
        signBitcoinPlan: (plan, utxos) => btcSignPlan(plan, utxos),
        afterBitcoinSpend: (plan) => btcAfterSpend(plan),
        newBitcoinAddress: () => btcNewReceiveAddress(),
        getHealthyProvider: (chainId) => getHealthyProvider(chainId),
        getBalances: () => getBalancesArray(),
        refreshBalances: () => refreshBalancesCompat(),
        prices: () => getNormalizedPricesObject(),
        formatBRL: (v) => formatBRL(v),
        isLocked: () => state.isLocked
    };

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
            const seedWords = acc.type === 'seed'
                ? (acc.words || (state.unlockedSecrets?.masterSeedMap?.[acc.seedGroupId] || '').split(' ').filter(Boolean).length || 12)
                : 12;
            const badgeText = acc.type === 'seed'
                ? `${seedWords} palavras${state.accounts.filter((a) => a.type === 'seed').length > 1 ? ` • nº ${(acc.hdIndex || 0) + 1}` : ''}`
                : (acc.type === 'pk' ? 'Chave privada' : (acc.type === 'rabby' ? 'Rabby' : 'Só ver'));

            return `
                <div class="rmw-acc-card ${isAct ? 'active' : ''}" data-select-acc="${acc.id}">
                    <div style="display:flex;align-items:center;gap:11px;min-width:0;">
                        <div class="rmw-avatar" style="background:${getAvatarGradient(acc.address)};">
                            ${esc(String(acc.name || 'C').trim().charAt(0).toUpperCase() || 'C')}
                        </div>
                        <div style="min-width:0;">
                            <div style="font-weight:700;font-size:0.95rem;display:flex;align-items:center;gap:6px;">
                                <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(acc.name)}</span>
                                <span class="rmw-badge ${badgeClass}">${badgeText}</span>
                            </div>
                            <div style="font-size:0.78rem;color:#94a3b8;font-family:monospace;margin-top:2px;">
                                ${acc.address.slice(0, 8)}...${acc.address.slice(-6)}
                            </div>
                            <div class="money" style="font-size:0.76rem;color:#00e676;margin-top:2px;">
                                ${bal ? formatBRL(bal.brl) : 'Consultando saldo...'}
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
                    ${hasVaultAccounts ? `<button class="rmw-icon-btn" id="rmw-lock-btn">${state.isLocked ? '🔓 Destrancar' : '🔒 Trancar'}</button>` : ''}
                    <button class="rmw-icon-btn" id="rmw-close-btn">✕</button>
                </div>
            </div>

            ${state.isLocked && hasVaultAccounts ? `
                <div class="rmw-alert-err" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                    <span>🔒 Cofre bloqueado (modo leitura).</span>
                    <button class="rmw-icon-btn" id="rmw-quick-unlock" style="background:#f7931a;color:#1a0f00;font-weight:700;">Desbloquear</button>
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
                <div class="rmw-title">🔐 Abrir o cofre</div>
                <div style="display:flex;gap:6px;">
                    ${state.accounts.length ? '<button class="rmw-icon-btn" id="rmw-back-list">Carteiras</button>' : ''}
                    <button class="rmw-icon-btn" id="rmw-close-btn" aria-label="Fechar">✕</button>
                </div>
            </div>

            <button class="rmw-btn-primary ks-cta" id="rmw-bio-unlock-btn" style="${bioReady ? '' : 'display:none;'}">👆 Abrir com a digital</button>

            <label class="rmw-label" for="rmw-pass-input">${bioReady ? 'Ou com a senha' : 'Sua senha'}</label>
            <div style="display:flex;gap:8px;align-items:center;">
                <input type="password" class="rmw-input" id="rmw-pass-input" placeholder="Sua senha" style="margin:0;" autocomplete="current-password">
                <button class="rmw-btn-primary" id="rmw-pass-unlock-btn" style="width:auto;padding:11px 18px;margin:0;">Abrir</button>
            </div>

            <div id="rmw-unlock-msg"></div>

            <div class="ks-card" style="margin-top:14px;"><span class="ks-ico">📜</span><b>Esqueceu a senha?</b><small>Suas palavras abrem tudo de novo: apague o cofre deste celular e entre com elas.</small></div>
            <button class="rmw-btn-secondary" id="rmw-goto-add-from-unlock">＋ Adicionar outra carteira</button>
            <button class="rmw-btn-danger" id="rmw-reset-vault-btn">🗑️ Apagar o cofre deste celular</button>
        `;

        // Cofre com PIN: teclado numérico no lugar do campo de senha
        if (readVaultMetaFromStorage()?.lockType === 'pin' && window.RdeskPinPad) {
            const row = sheet.querySelector('#rmw-pass-input').parentElement;
            row.style.display = 'none';
            const lbl = sheet.querySelector('label[for="rmw-pass-input"]');
            if (lbl) lbl.textContent = isBiometryRegistered() ? 'Ou com o PIN' : 'Seu PIN';
            const host = document.createElement('div');
            row.after(host);
            window.RdeskPinPad.mount(host, { length: 6, onComplete: (pin) => { sheet.querySelector('#rmw-pass-input').value = pin; sheet.querySelector('#rmw-pass-unlock-btn').click(); } });
        }
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
                msgBox.innerHTML = `<div class="rmw-alert-err">${esc(err.message)}</div>`;
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
                msgBox.innerHTML = `<div class="rmw-alert-err">${esc(err.message)}</div>`;
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
                    ${state.accounts.length ? 'Adicionar carteira' : 'Vamos começar'}
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

            <button class="rmw-opt-btn big-choice" data-mode="create-seed">
                <div class="rmw-opt-ico big">🔑</div>
                <div>
                    <div>Criar meu cofre</div>
                    <div class="opt-sub">Primeira vez? Comece aqui • criar carteira nova</div>
                </div>
            </button>

            <button class="rmw-opt-btn big-choice" data-mode="import-seed">
                <div class="rmw-opt-ico big">📜</div>
                <div>
                    <div>Já tenho minhas 12 palavras</div>
                    <div class="opt-sub">Importar frase-semente (Rabby, MetaMask…)</div>
                </div>
            </button>

            <details class="more-opts">
                <summary>Mais opções</summary>
                ${hasUnlockedSeed ? `
                <button class="rmw-opt-btn" id="rmw-derive-from-existing-seed">
                    <div class="rmw-opt-ico">🌱</div>
                    <div><div>Outra conta com as mesmas palavras</div><div class="opt-sub">Cria o próximo endereço da sua chave</div></div>
                </button>` : ''}
                <button class="rmw-opt-btn" data-mode="import-pk">
                    <div class="rmw-opt-ico">🗝️</div>
                    <div><div>Importar chave privada</div><div class="opt-sub">Código 0x… de 64 letras e números</div></div>
                </button>
                <button class="rmw-opt-btn" id="rmw-opt-rabby">
                    <div class="rmw-opt-ico">🦊</div>
                    <div><div>Conectar a Rabby</div><div class="opt-sub">A extensão Rabby assina por você</div></div>
                </button>
                <button class="rmw-opt-btn" data-mode="watch-only">
                    <div class="rmw-opt-ico">👁️</div>
                    <div><div>Só acompanhar (observação)</div><div class="opt-sub">Vê saldos de um endereço, sem poder mexer</div></div>
                </button>
            </details>

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
                    createSeedDraft = newSeedDraft();
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
                sheet.querySelector('#rmw-add-msg').innerHTML = `<div class="rmw-alert-err">${esc(err.message)}</div>`;
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
    // CRIAR O COFRE: uma história visual em 4 passos
    //   1. o que é a chave  2. ver a chave (12 palavras)  3. conferir  4. proteger
    // -------------------------------------------------------------------------
    function newSeedDraft() {
        return { mnemonic: ethers.Wallet.createRandom().mnemonic.phrase, wordCount: 12, step: 'intro', revealed: false,
            quiz: [], quizAt: 0, name: '', password: '', enableBio: isBiometrySupported() };
    }

    // Chave dourada: cada dente é uma palavra (lit = quantos dentes acesos)
    function keySvg(lit = 12, total = 12) {
        const step = 113 / total;
        const teeth = Array.from({ length: total }, (_, i) => {
            const hgt = [10, 16, 8, 14, 18, 9, 13, 17, 7, 15, 11, 16][i % 12];
            const x = 96 + i * step;
            return `<rect class="kt ${i < lit ? 'on' : ''}" x="${x.toFixed(1)}" y="53" width="${(step * 0.68).toFixed(1)}" height="${hgt}" rx="1.6"/>`;
        }).join('');
        return `<svg class="key-svg" viewBox="0 0 220 90" aria-hidden="true">
            <defs><linearGradient id="kg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe0a3"/><stop offset=".5" stop-color="#f7931a"/><stop offset="1" stop-color="#b45f00"/></linearGradient></defs>
            <circle cx="46" cy="45" r="36" fill="url(#kg)"/><circle cx="46" cy="45" r="15" fill="#0f1218"/>
            <text x="46" y="52" text-anchor="middle" font-size="20" font-weight="900" fill="#f7931a">₿</text>
            <rect x="78" y="37" width="138" height="16" rx="5" fill="url(#kg)"/>${teeth}
        </svg>`;
    }

    // Criar um PIN no teclado (digita duas vezes). onSet(pin) quando confirmado.
    function createPinFlow(host, onSet) {
        let first = null;
        const pad = window.RdeskPinPad.mount(host, {
            length: 6, title: 'Crie um PIN de 6 números',
            onComplete: (pin) => {
                if (/^(\d)\1{5}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) { pad.error('Muito fácil de adivinhar. Escolha outro.'); return; }
                if (!first) { first = pin; host.querySelector('.pp-title').textContent = 'Digite de novo para confirmar'; pad.reset(); return; }
                if (pin !== first) { first = null; host.querySelector('.pp-title').textContent = 'Crie um PIN de 6 números'; pad.error('Os dois PINs não batem. Crie de novo.'); return; }
                host.querySelector('.pp-title').textContent = '✓ PIN criado!';
                host.classList.add('done');
                onSet(pin);
            }
        });
        return pad;
    }

    function renderCreateKeyStory(sheet, { needsPassword, isLockedExisting }) {
        const d = createSeedDraft;
        const words = d.mnemonic.split(' ');
        const steps = ['intro', 'show', 'verify', 'protect'];
        const stepNo = steps.indexOf(d.step) + 1;
        const dots = steps.map((s, i) => `<span class="ks-dot ${i < stepNo ? 'on' : ''}"></span>`).join('');
        const head = (back) => `
            <div class="rmw-header">
                <div class="rmw-title"><button class="rmw-icon-btn" id="ks-back" data-rmw-back="1" aria-label="Voltar">←</button><span class="ks-dots" aria-label="Passo ${stepNo} de 4">${dots}</span></div>
                <button class="rmw-icon-btn" id="rmw-close-btn" aria-label="Fechar">✕</button>
            </div>`;
        const go = (step) => { d.step = step; renderModal(); };
        const bindHead = (backTo) => {
            sheet.querySelector('#rmw-close-btn').onclick = closeWalletModal;
            sheet.querySelector('#ks-back').onclick = () => (backTo ? go(backTo) : (currentView = 'add', renderModal()));
        };

        if (d.step === 'intro') {
            sheet.innerHTML = `${head()}
                <div class="ks">
                    <div class="ks-hero">${keySvg(12)}<div class="ks-vault-mini">🔒</div></div>
                    <h2 class="ks-title">Seu cofre precisa de uma chave</h2>
                    <div class="ks-cards">
                        <div class="ks-card"><span class="ks-ico">🔑</span><b>A chave são 12 palavras</b><small>O app cria pra você. Você <u>não escolhe</u> nada.</small></div>
                        <div class="ks-card"><span class="ks-ico">✍️</span><b>Escreva num papel</b><small>Na ordem, de 1 a 12.</small></div>
                        <div class="ks-card warn"><span class="ks-ico">🙈</span><b>Só você pode ver</b><small>Quem tem as palavras abre o cofre. Nunca mande foto nem print.</small></div>
                    </div>
                    <button class="rmw-btn-primary ks-cta" id="ks-next">Pegar papel e caneta e continuar →</button>
                </div>`;
            bindHead(null);
            sheet.querySelector('#ks-next').onclick = () => go('show');
            return;
        }

        if (d.step === 'show') {
            sheet.innerHTML = `${head()}
                <div class="ks">
                    <div class="ks-hero small">${keySvg(words.length, words.length)}</div>
                    <h2 class="ks-title">Esta é a chave do seu cofre</h2>
                    <div class="ks-seg" role="radiogroup" aria-label="Tamanho da chave">
                        <button type="button" role="radio" data-wc="12" aria-checked="${words.length === 12}">12 palavras<small>padrão</small></button>
                        <button type="button" role="radio" data-wc="24" aria-checked="${words.length === 24}">24 palavras<small>ainda mais forte</small></button>
                    </div>
                    <p class="ks-sub">Copie as ${words.length} palavras no papel, <b>na ordem</b>.</p>
                    <div class="ks-words ${d.revealed ? 'revealed' : ''}" id="ks-words">
                        <div class="rmw-words-grid">${words.map((w, i) => `<div class="rmw-word-pill"><span class="rmw-word-num">${i + 1}</span>${esc(w)}</div>`).join('')}</div>
                        <button type="button" class="ks-veil" id="ks-reveal"><span class="ks-ico">👀</span><b>Toque para ver sua chave</b><small>Confira se ninguém está olhando</small></button>
                    </div>
                    <div class="ks-rules"><span>✍️ No papel</span><span>🔢 Na ordem</span><span>🚫📸 Sem foto</span></div>
                    <div id="rmw-form-msg"></div>
                    <button class="rmw-btn-primary ks-cta" id="rmw-f-next-verify" ${d.revealed ? '' : 'disabled'}>Já escrevi no papel →</button>
                </div>`;
            bindHead('intro');
            sheet.querySelectorAll('[data-wc]').forEach((b) => {
                b.onclick = () => {
                    const n = Number(b.getAttribute('data-wc'));
                    if (n === words.length) return;
                    // Nova chave com 12 (128 bits) ou 24 palavras (256 bits)
                    d.mnemonic = ethers.utils.entropyToMnemonic(ethers.utils.randomBytes(n === 24 ? 32 : 16));
                    d.wordCount = n;
                    d.revealed = false;
                    renderModal();
                };
            });
            sheet.querySelector('#ks-reveal').onclick = () => { d.revealed = true; sheet.querySelector('#ks-words').classList.add('revealed'); sheet.querySelector('#rmw-f-next-verify').disabled = false; };
            sheet.querySelector('#rmw-f-next-verify').onclick = () => {
                // 3 perguntas: "qual é a palavra nº X?" com 3 opções tiradas da própria chave
                d.quiz = pickThreeRandomWordIndices(words.length).map((idx) => {
                    const others = words.map((w, i) => i).filter((i) => i !== idx && words[i] !== words[idx]).sort(() => Math.random() - 0.5).slice(0, 2);
                    return { idx, options: [idx, ...others].sort(() => Math.random() - 0.5).map((i) => words[i]) };
                });
                d.quizAt = 0;
                go('verify');
            };
            return;
        }

        if (d.step === 'verify') {
            const q = d.quiz[d.quizAt];
            sheet.innerHTML = `${head()}
                <div class="ks">
                    <div class="ks-hero small">${keySvg(d.quizAt)}</div>
                    <h2 class="ks-title">Vamos conferir seu papel</h2>
                    <p class="ks-sub">Pergunta ${d.quizAt + 1} de 3</p>
                    <div class="ks-ask">Qual é a palavra <span class="ks-num" id="ks-num">nº ${q.idx + 1}</span>?</div>
                    <div class="ks-options" id="ks-options">
                        ${q.options.map((w) => `<button type="button" class="ks-opt" data-word="${esc(w)}">${esc(w)}</button>`).join('')}
                    </div>
                    <div id="rmw-form-msg"></div>
                    <button type="button" class="rmw-btn-secondary" id="ks-review">👀 Ver a chave de novo</button>
                </div>`;
            bindHead('show');
            sheet.querySelector('#ks-review').onclick = () => go('show');
            sheet.querySelectorAll('.ks-opt').forEach((b) => {
                b.onclick = () => {
                    const msg = sheet.querySelector('#rmw-form-msg');
                    if (b.getAttribute('data-word') === words[q.idx]) {
                        b.classList.add('right');
                        sheet.querySelectorAll('.ks-opt').forEach((x) => { x.disabled = true; });
                        setTimeout(() => {
                            if (d.quizAt < 2) { d.quizAt += 1; renderModal(); } else go('protect');
                        }, 420);
                    } else {
                        b.classList.remove('wrong'); void b.offsetWidth; b.classList.add('wrong');
                        try { navigator.vibrate?.([40, 50, 40]); } catch (e) { /* sem vibração */ }
                        msg.innerHTML = `<div class="rmw-alert-err">Não é essa. Olhe a palavra nº ${q.idx + 1} no seu papel.</div>`;
                    }
                };
            });
            return;
        }

        // 4. proteger: como abrir o cofre neste celular (PIN, senha, digital) + senha extra opcional
        const existingType = isLockedExisting ? (readVaultMetaFromStorage()?.lockType || 'password') : null;
        d.lockType = d.lockType || 'pin';
        const usePin = needsPassword ? d.lockType === 'pin' : existingType === 'pin';
        const askSecret = needsPassword || isLockedExisting;
        sheet.innerHTML = `${head()}
            <div class="ks">
                <div class="ks-hero small"><div class="ks-phone">📱<span>🔒</span></div></div>
                <h2 class="ks-title">${needsPassword ? 'Como você quer abrir o cofre?' : isLockedExisting ? 'Abra seu cofre para guardar a chave' : 'Quase pronto!'}</h2>
                <p class="ks-sub">${needsPassword ? 'Vale só neste celular. Perdeu o celular? Suas palavras recuperam tudo.' : isLockedExisting ? (existingType === 'pin' ? 'Digite o seu PIN.' : 'Digite a sua senha.') : 'Dê um nome para o seu cofre.'}</p>
                ${needsPassword ? `
                <div class="ks-seg" role="radiogroup" aria-label="Tipo de trava">
                    <button type="button" role="radio" data-lock="pin" aria-checked="${usePin}">🔢 PIN<small>6 números, como no banco</small></button>
                    <button type="button" role="radio" data-lock="password" aria-checked="${!usePin}">🔤 Senha<small>letras e números, mais forte</small></button>
                </div>` : ''}
                ${askSecret && usePin ? `<div id="ks-pinpad"></div>` : ''}
                ${askSecret && !usePin ? `
                    <label class="rmw-label" for="rmw-f-pass">${needsPassword ? 'Crie uma senha' : 'Senha'}</label>
                    <input type="password" class="rmw-input" id="rmw-f-pass" value="${esc(d.lockType === 'password' ? d.password : '')}" placeholder="${needsPassword ? 'Pelo menos 8 letras ou números' : 'Sua senha'}" autocomplete="${needsPassword ? 'new-password' : 'current-password'}">` : ''}
                ${needsPassword ? `
                    <label class="ks-bio"><input type="checkbox" id="rmw-f-bio" ${d.enableBio ? 'checked' : ''}><span class="ks-ico">👆</span><span><b>Também abrir com a digital</b><small>Ou rosto. O PIN/senha continua valendo</small></span></label>` : ''}
                <label class="rmw-label" for="rmw-f-name">Nome do cofre</label>
                <input type="text" class="rmw-input" id="rmw-f-name" value="${esc(d.name)}" placeholder="Meu cofre" maxlength="40">
                <details class="more-opts ks-extra" ${d.passphrase ? 'open' : ''}>
                    <summary>Senha extra na chave (opcional, avançado)</summary>
                    <div class="ks-card warn"><span class="ks-ico">🧩</span><b>A “25ª palavra”</b><small>Ela vira parte da chave: as palavras <u>com</u> esta senha abrem este cofre; <u>sem</u> ela, abrem outro cofre, vazio. Protege se alguém achar o seu papel. <b>Se esquecer, ninguém recupera.</b> Guarde em outro lugar.</small></div>
                    <input type="password" class="rmw-input" id="ks-pp1" value="${esc(d.passphrase || '')}" placeholder="Senha extra (maiúsculas e espaços contam)" autocomplete="off">
                    <input type="password" class="rmw-input" id="ks-pp2" value="${esc(d.passphrase || '')}" placeholder="Repita a senha extra" autocomplete="off">
                </details>
                <div id="rmw-form-msg"></div>
                <button class="rmw-btn-primary ks-cta" id="rmw-verify-confirm-btn">🔐 Criar meu cofre</button>
            </div>`;
        bindHead('show');
        const msgBox = sheet.querySelector('#rmw-form-msg');
        const keep = () => { d.name = sheet.querySelector('#rmw-f-name').value.trim(); d.passphrase = sheet.querySelector('#ks-pp1').value; d.enableBio = Boolean(sheet.querySelector('#rmw-f-bio')?.checked); };
        sheet.querySelectorAll('[data-lock]').forEach((b) => {
            b.onclick = () => { keep(); const v = b.getAttribute('data-lock'); if (v !== d.lockType) { d.lockType = v; d.password = ''; d.pinOk = false; renderModal(); } };
        });
        // Teclado de PIN: criar (duas vezes) ou digitar o existente
        let pinPad = null;
        if (askSecret && usePin && window.RdeskPinPad) {
            let first = null;
            const host = sheet.querySelector('#ks-pinpad');
            const start = () => {
                pinPad = window.RdeskPinPad.mount(host, {
                    length: 6,
                    title: needsPassword ? (d.pinOk ? '✓ PIN criado (toque para trocar)' : 'Crie um PIN de 6 números') : 'Seu PIN',
                    onComplete: (pin) => {
                        if (!needsPassword) { d.password = pin; sheet.querySelector('#rmw-verify-confirm-btn').click(); return; }
                        if (/^(\d)\1{5}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) { pinPad.error('Muito fácil de adivinhar. Escolha outro.'); return; }
                        if (!first) { first = pin; host.querySelector('.pp-title').textContent = 'Digite de novo para confirmar'; pinPad.reset(); return; }
                        if (pin !== first) { first = null; host.querySelector('.pp-title').textContent = 'Crie um PIN de 6 números'; pinPad.error('Os dois PINs não batem. Crie de novo.'); return; }
                        d.password = pin; d.pinOk = true;
                        host.querySelector('.pp-title').textContent = '✓ PIN criado!';
                        host.classList.add('done');
                    }
                });
            };
            if (d.pinOk && needsPassword) { host.innerHTML = '<button type="button" class="pp-done" id="ks-pin-again">✓ PIN criado • trocar</button>'; host.querySelector('#ks-pin-again').onclick = () => { d.pinOk = false; d.password = ''; host.innerHTML = ''; start(); }; }
            else start();
        }
        sheet.querySelector('#rmw-verify-confirm-btn').onclick = async () => {
            const btn = sheet.querySelector('#rmw-verify-confirm-btn');
            msgBox.innerHTML = '';
            keep();
            const err = (text) => { msgBox.innerHTML = `<div class="rmw-alert-err">${esc(text)}</div>`; };
            if (askSecret && !usePin) d.password = sheet.querySelector('#rmw-f-pass')?.value || '';
            if (needsPassword && usePin && !(d.pinOk && /^\d{6}$/.test(d.password))) return err('Crie o seu PIN de 6 números no teclado acima.');
            if (needsPassword && !usePin && d.password.length < MIN_PASSWORD_LENGTH) return err(`A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} letras ou números.`);
            if (isLockedExisting && !d.password) return err(existingType === 'pin' ? 'Digite o seu PIN.' : 'Digite a senha do seu cofre.');
            if (d.passphrase !== sheet.querySelector('#ks-pp2').value) return err('As duas senhas extras não batem.');
            btn.disabled = true;
            btn.textContent = 'Fechando o cofre…';
            try {
                if (needsPassword) state.lockType = usePin ? 'pin' : 'password';
                await addAccountFromMnemonic({ mnemonic: d.mnemonic, name: d.name || 'Meu cofre', hdIndex: 0, password: d.password, enableBio: d.enableBio, passphrase: d.passphrase || '' });
                const name = d.name || 'Meu cofre';
                createSeedDraft = null;
                closeWalletModal();
                window.RdeskVaultDoor?.celebrate?.(name);
            } catch (e) {
                btn.disabled = false;
                btn.textContent = '🔐 Criar meu cofre';
                if (!needsPassword && usePin) pinPad?.error(/incorret|senha/i.test(e.message) ? 'PIN errado.' : '');
                err(/incorret/i.test(e.message) ? (existingType === 'pin' ? 'PIN errado.' : 'Senha errada.') : e.message);
            }
        };
    }

    // -------------------------------------------------------------------------
    // TELA D: FORMULÁRIOS (COM DESAFIO DE 3 PALAVRAS NA CRIAÇÃO DE CARTEIRA)
    // -------------------------------------------------------------------------
    function renderFormView(sheet) {
        const needsPassword = requiresVaultPasswordSetup();
        const isLockedExisting = !state.unlockedSecrets && Boolean(readVaultMetaFromStorage()?.encryptedSecrets);

        if (activeFormMode === 'create-seed') {
            if (!createSeedDraft) createSeedDraft = newSeedDraft();
            renderCreateKeyStory(sheet, { needsPassword, isLockedExisting });
            return;
        }

        const titles = {
            'import-seed': '📜 Abrir com minhas palavras',
            'import-pk': '🗝️ Importar chave privada',
            'watch-only': '👁️ Só acompanhar um endereço'
        };

        sheet.innerHTML = `
            <div class="rmw-header">
                <div class="rmw-title">
                    <button class="rmw-icon-btn" id="rmw-form-back">←</button>
                    ${titles[activeFormMode] || 'Adicionar Carteira'}
                </div>
                <button class="rmw-icon-btn" id="rmw-close-btn">✕</button>
            </div>

            ${activeFormMode === 'import-seed' ? `
                <div class="ks-hero small">${keySvg(12)}</div>
                <p class="ks-sub" style="margin:0 0 6px;">Escreva cada palavra no quadradinho com o <b>mesmo número</b> do seu papel.</p>
                <textarea class="rmw-textarea" id="rmw-f-seed-input" placeholder="palavra1 palavra2 palavra3 …" autocapitalize="none" autocomplete="off" spellcheck="false" style="min-height:110px;font-size:1.05rem;"></textarea>
                <button type="button" class="rmw-btn-secondary" data-scan-for="rmw-f-seed-input" data-scan-raw="1" style="margin-top:6px;padding:8px;">📷 Ler de um QR Code</button>
            ` : ''}

            <label class="rmw-label">Nome ${activeFormMode === 'watch-only' ? '' : 'do cofre'}</label>
            <input type="text" class="rmw-input" id="rmw-f-name" placeholder="${activeFormMode === 'watch-only' ? 'Ex.: Carteira da loja' : 'Meu cofre'}">

            ${activeFormMode === 'import-seed' ? `
                <details class="more-opts"><summary>Avançado: senha extra, número da conta</summary>
                    <label class="rmw-label" for="rmw-f-passphrase">Senha extra (passphrase), se a sua chave tiver</label>
                    <input type="password" class="rmw-input" id="rmw-f-passphrase" placeholder="Deixe vazio se você não usa" autocomplete="off">
                    <small class="muted-sm">Com senha extra errada, abre outro cofre (vazio). Maiúsculas e espaços contam.</small>
                    <label class="rmw-label">Número da conta (padrão 0)</label>
                    <input type="number" class="rmw-input" id="rmw-f-hd-index" value="0" min="0" max="50">
                </details>
            ` : ''}

            ${activeFormMode === 'import-pk' ? `
                <label class="rmw-label">Chave Privada (64 caracteres hexadecimais)</label>
                <div class="input-with-actions">
                    <input type="password" class="rmw-input" id="rmw-f-pk-input" placeholder="0x..." autocomplete="off">
                    <button type="button" class="rmw-icon-btn" data-scan-for="rmw-f-pk-input" data-scan-raw="1" title="Ler QR Code" aria-label="Ler QR Code">📷</button>
                </div>
            ` : ''}

            ${activeFormMode === 'watch-only' ? `
                <label class="rmw-label">Endereço Público da Carteira (0x...)</label>
                <div class="input-with-actions">
                    <input type="text" class="rmw-input" id="rmw-f-watch-input" placeholder="0x2833..." autocomplete="off" autocapitalize="off" spellcheck="false">
                    <button type="button" class="rmw-icon-btn" data-scan-for="rmw-f-watch-input" title="Ler QR Code" aria-label="Ler QR Code">📷</button>
                </div>
            ` : ''}

            ${activeFormMode !== 'watch-only' && needsPassword ? `
                <label class="rmw-label">Como você quer abrir o cofre neste celular?</label>
                <div class="ks-seg" role="radiogroup" aria-label="Tipo de trava">
                    <button type="button" role="radio" data-lock="pin" aria-checked="${importLock === 'pin'}">🔢 PIN<small>6 números</small></button>
                    <button type="button" role="radio" data-lock="password" aria-checked="${importLock !== 'pin'}">🔤 Senha<small>mais forte</small></button>
                </div>
                ${importLock === 'pin' ? '<div id="rmw-f-pinpad"></div><input type="hidden" id="rmw-f-pass" value="">' : '<input type="password" class="rmw-input" id="rmw-f-pass" placeholder="Pelo menos 8 letras ou números">'}
            ` : ''}
            ${activeFormMode !== 'watch-only' && !needsPassword && isLockedExisting ? `
                <label class="rmw-label">${readVaultMetaFromStorage()?.lockType === 'pin' ? 'PIN do seu cofre' : 'Senha do seu cofre'}</label>
                <input type="password" class="rmw-input" id="rmw-f-pass" ${readVaultMetaFromStorage()?.lockType === 'pin' ? 'inputmode="numeric" maxlength="6" placeholder="••••••"' : 'placeholder="Sua senha"'}>
            ` : ''}

            ${activeFormMode !== 'watch-only' && needsPassword ? `
                <label class="ks-bio" style="margin-top:10px;"><input type="checkbox" id="rmw-f-bio"><span class="ks-ico">👆</span><span><b>Abrir com a digital</b><small>Mais rápido no dia a dia</small></span></label>
            ` : ''}

            <div id="rmw-form-msg"></div>
            <button class="rmw-btn-primary" id="rmw-f-submit">${activeFormMode === 'watch-only' ? '👁️ Acompanhar' : '🔐 Abrir meu cofre'}</button>
        `;

        sheet.querySelector('#rmw-close-btn').onclick = closeWalletModal;
        sheet.querySelector('#rmw-form-back').onclick = () => { currentView = 'add'; renderModal(); };
        sheet.querySelectorAll('[data-lock]').forEach((b) => {
            b.onclick = () => {
                const keepSeed = sheet.querySelector('#rmw-f-seed-input')?.value, keepName = sheet.querySelector('#rmw-f-name').value;
                importLock = b.getAttribute('data-lock'); renderModal();
                if (keepSeed && sheet.querySelector('#rmw-f-seed-input')) { const ta = sheet.querySelector('#rmw-f-seed-input'); ta.value = keepSeed; ta.dispatchEvent(new Event('input')); }
                sheet.querySelector('#rmw-f-name').value = keepName;
            };
        });
        if (window.RdeskSeedGrid) window.RdeskSeedGrid.mount(sheet.querySelector('#rmw-f-seed-input'));
        const pinHost = sheet.querySelector('#rmw-f-pinpad');
        if (pinHost && window.RdeskPinPad) createPinFlow(pinHost, (pin) => { sheet.querySelector('#rmw-f-pass').value = pin; });

        sheet.querySelector('#rmw-f-submit').onclick = async () => {
            const msgBox = sheet.querySelector('#rmw-form-msg');
            msgBox.innerHTML = '';
            const name = sheet.querySelector('#rmw-f-name').value;
            const password = sheet.querySelector('#rmw-f-pass')?.value || '';
            if (needsPassword && activeFormMode !== 'watch-only') {
                if (importLock === 'pin' && !/^\d{6}$/.test(password)) { msgBox.innerHTML = '<div class="rmw-alert-err">Crie o seu PIN de 6 números no teclado acima.</div>'; return; }
                state.lockType = importLock === 'pin' ? 'pin' : 'password';
            }
            const enableBio = Boolean(sheet.querySelector('#rmw-f-bio')?.checked);

            try {
                if (activeFormMode === 'import-seed') {
                    const mnemonic = sheet.querySelector('#rmw-f-seed-input').value;
                    const hdIndex = parseInt(sheet.querySelector('#rmw-f-hd-index').value || '0', 10);
                    await addAccountFromMnemonic({ mnemonic, name, hdIndex, password, enableBio, passphrase: sheet.querySelector('#rmw-f-passphrase')?.value || '' });
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
                    <div class="rmw-opt-ico" style="background:rgba(52,211,153,0.16);color:#34d399;">👆</div>
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
            const viewAtClick = currentView;
            const paramsAtClick = viewParams;
            const inspectingAtClick = inspectingAccountId;
            try {
                await deleteSingleAccount(acc.id);
                // Só muda de tela se a pessoa ainda está nesta mesma tela (não atropela uma navegação feita enquanto salvava).
                const overlayOpen = document.getElementById('rdesk-mw-overlay')?.classList.contains('open');
                if (overlayOpen && currentView === viewAtClick && viewParams === paramsAtClick && inspectingAccountId === inspectingAtClick) {
                    currentView = state.accounts.length ? 'list' : 'add';
                    renderModal();
                }
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

            if (btn.closest('#rdesk-mw-overlay')) return; // botões de dentro do modal têm seus próprios destinos
            const isReceiveBtn = id === 'btn-action-receive' || id === 'btn-receive' || btn.getAttribute('data-action') === 'receive';
            const isSendBtn = id === 'btn-action-send' || id === 'btn-send' || btn.getAttribute('data-action') === 'send';

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

    const CHAIN_NAMES = Object.fromEntries([...REG.CHAINS, REG.BITCOIN].map((c) => [c.id, c.name]));

    // priceKey: 'USD' = 1 dólar | 'BRL' = 1 real | demais = chave em getPrices()
    // Lista viva de moedas por rede (oficiais + adicionadas pelo usuário), sempre lida do registro.
    const CHAIN_TOKENS = new Proxy({}, {
        get: (_, key) => (typeof key === 'string' && /^\d+$/.test(key) ? REG.getTokens(Number(key)) : undefined),
        has: (_, key) => Boolean(REG.getChain(Number(key))),
        ownKeys: () => REG.CHAINS.map((c) => String(c.id)),
        getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true })
    });

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

    function unitUsdFor(priceKey, chainId, address) {
        const p = getNormalizedPricesObject();
        if (!priceKey) return address ? (state.prices.custom[`${chainId}:${String(address).toLowerCase()}`] || 0) : 0;
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
            if (b.chainId === 'btc') {
                const usdBtc = b.amount * unitUsdFor('BTC');
                return { chainId: 'btc', symbol: 'BTC', amount: b.amount, pending: b.pending || 0, usdValue: usdBtc, brlValue: usdBtc * usdBrl, address: null, hasPrice: unitUsdFor('BTC') > 0 };
            }
            const meta = (CHAIN_TOKENS[b.chainId] || []).find((t) => t.symbol === b.symbol);
            if (!meta) return null; // moeda removida da lista
            const unit = unitUsdFor(meta.priceKey, b.chainId, meta.address);
            const usdValue = b.amount * unit;
            return { chainId: b.chainId, symbol: b.symbol, amount: b.amount, usdValue, brlValue: usdValue * usdBrl, address: meta.address || null, isCustom: Boolean(meta.isCustom), name: meta.name || b.symbol, hasPrice: unit > 0 };
        });

        // Mantém as propriedades antigas (pol, wpol, usdt0, totalUsd...) por compatibilidade
        return Object.assign(arr.filter(Boolean), getActiveAccountBalances());
    }

    // Depois de criar, importar, abrir ou trocar de cofre: busca já os saldos de todas as redes (e do Bitcoin),
    // sem esperar o ciclo de 30 s
    let chainKick = null;
    function kickChainBalances() {
        if (chainKick) return chainKick;
        chainKick = refreshChainBalancesForActive().then(() => notifyAccountChanged(true)).catch(() => {}).finally(() => { chainKick = null; });
        return chainKick;
    }
    async function refreshChainBalancesForActive() {
        const acc = getActiveAccount();
        if (!acc || typeof ethers === 'undefined') return;

        const addr = acc.address;
        const jobs = [];

        Object.keys(CHAIN_TOKENS).forEach((cid) => {
            const chainId = Number(cid);
            if (window.RdeskAnon && !window.RdeskAnon.chainAllowed(chainId)) return; // modo anônimo: só as redes escolhidas
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

        // Bitcoin nativo (endereço próprio, derivado da mesma frase)
        if (acc.btcAddress && window.RdeskBitcoin && (!window.RdeskAnon || window.RdeskAnon.chainAllowed('btc'))) {
            jobs.push((async () => {
                // Lê todos os endereços do cofre (endereço novo a cada recebimento) e soma
                const list = btcScanList(acc);
                const got = await Promise.all(list.map((a) => window.RdeskBitcoin.fetchBalance(a).then((b) => [a, b]).catch(() => [a, null])));
                const ok = got.filter(([, b]) => b);
                if (!ok.length) return { chainId: 'btc', symbol: 'BTC', amount: 0, ok: false };
                if (ok.length < got.length) return { chainId: 'btc', symbol: 'BTC', amount: 0, ok: false }; // parcial: mantém o último total
                const per = {};
                ok.forEach(([a, b]) => { per[a] = b; });
                Object.assign(state.btcPerAddr, per);
                if (btcMarkUsage(acc, per)) persistVaultToStorage().catch(() => {});
                const total = ok.reduce((s, [, b]) => s + b.totalSats, 0), pend = ok.reduce((s, [, b]) => s + b.pendingSats, 0);
                return { chainId: 'btc', symbol: 'BTC', amount: total / 1e8, pending: pend / 1e8, ok: true };
            })());
        }

        // Cada saldo chega no seu tempo: um servidor lento não segura os outros (antes, um RPC travado
        // atrasava até o Bitcoin). Se uma consulta falhar ou demorar demais, mantém o último saldo conhecido.
        const key = addr.toLowerCase();
        const previous = state.chainBalances[key] || [];
        const cur = previous.map((p) => ({ ...p }));
        const put = (r) => {
            if (!r || r.chainId === undefined) return;
            const i = cur.findIndex((p) => p.chainId === r.chainId && p.symbol === r.symbol);
            const old = i >= 0 ? cur[i] : null;
            const entry = r.ok ? { chainId: r.chainId, symbol: r.symbol, amount: r.amount, pending: r.pending || 0 } : { chainId: r.chainId, symbol: r.symbol, amount: old ? old.amount : 0 };
            if (i >= 0) cur[i] = entry; else cur.push(entry);
        };
        const LIMIT = 12000;
        const capped = jobs.map((j) => Promise.race([j, new Promise((res) => setTimeout(() => res(null), LIMIT))]).then(put).catch(() => {}));
        // Mostra o que já chegou depois de alguns segundos, sem esperar o mais lento
        const early = setTimeout(() => { if (getActiveAccount()?.address === addr) { state.chainBalances[key] = cur.map((p) => ({ ...p })); notifyAccountChanged(true); } }, 2500);
        await Promise.all(capped);
        clearTimeout(early);
        state.chainBalances[key] = cur;
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

    // Quantidade legível: 2,038 BRZ em vez de 2,03796471 BRZ (Bitcoin pequeno mantém precisão)
    function formatAmount(a, sym) {
        const x = Math.abs(Number(a) || 0);
        if (/^(W?BTC|CBBTC)$/i.test(String(sym || ''))) return x.toLocaleString('pt-BR', { minimumFractionDigits: 8, maximumFractionDigits: 8 });
        if (x === 0) return '0';
        return x.toLocaleString('pt-BR', x >= 1
            ? { maximumFractionDigits: x >= 1000 ? 2 : 4 }
            : { maximumSignificantDigits: 4 });
    }
    // Variação da moeda em 24 h medida na moeda de referência escolhida (Bitcoin por padrão)
    function changeChip(b) {
        const H = window.RdeskHistory;
        const c = H ? H.changeVsRef(b) : null;
        if (c === null || !Number.isFinite(c)) return '<small class="chg muted">—</small>';
        const ref = H.REFS[H.getRef()];
        return `<small class="chg ${c > 0.005 ? 'up' : c < -0.005 ? 'down' : ''}" title="Variação em 24 h frente ao ${esc(ref.name)}">${esc(H.fmtPct(c))}</small>`;
    }

    // Nome que qualquer pessoa entende (o símbolo técnico aparece embaixo, menor)
    const FRIENDLY_NAMES = {
        BTC: 'Bitcoin (nativo)', BNB: 'BNB', ETH: 'Ethereum', POL: 'Polygon (POL)', WPOL: 'POL embrulhado', CELO: 'Celo',
        USDT: 'Dólar digital (Tether)', USDC: 'Dólar digital (USD Coin)', BRZ: 'Real digital (BRZ)', BRLA: 'Real digital (BRLA)',
        WETH: 'Ether embrulhado', WBTC: 'Bitcoin pareado (token WBTC)', CBBTC: 'Bitcoin pareado (token da Coinbase)'
    };
    function friendlyTokenName(b) {
        if (b.isCustom) return b.name || b.symbol;
        return FRIENDLY_NAMES[String(b.symbol).toUpperCase()] || b.name || b.symbol;
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
        window.RdeskHistory?.renderBalance?.(); // valor na moeda de referência e variação em 24 h
        const earningEl = document.getElementById('hero-breakdown');
        if (earningEl) {
            earningEl.hidden = !(lpUsd > 0);
            earningEl.textContent = lpUsd > 0 ? `${formatBRL(lpUsd * prices.usdBrl)} rendendo na Uniswap` : '';
        }
        document.body.classList.toggle('no-wallet', !acc);
        const welcome = document.getElementById('welcome-card');
        if (welcome) welcome.hidden = Boolean(acc);

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
        if (lockBar) lockBar.style.display = 'none'; // trancado = porta do cofre (vault-door.js)

        // Lista "Suas Moedas"
        const listEl = document.getElementById('wallet-assets-list');
        if (listEl) {
            if (!acc) {
                listEl.innerHTML = '<div class="empty-state">Crie ou abra sua carteira para ver suas moedas aqui.</div>';
                renderQuoteStatus();
                return;
            }
            const filterEl = document.getElementById('wallet-chain-filter');
            if (filterEl && filterEl.options.length <= 1) {
                [...REG.CHAINS, REG.BITCOIN].forEach((c) => filterEl.add(new Option(c.name, String(c.id))));
            }
            const filter = filterEl?.value || 'ALL';
            const showZero = Boolean(document.getElementById('wallet-show-zero')?.checked);
            // Bitcoin sempre em primeiro (mesmo zerado: é a reserva do app), depois Ether na Ethereum, depois o resto
            const tier = (b) => (b.chainId === 'btc' ? 0 : Number(b.chainId) === 1 && b.symbol === 'ETH' ? 1 : 2);
            const rows = balances
                .filter((b) => (filter === 'ALL' || String(b.chainId) === filter) && (showZero || b.amount > 0 || b.isCustom || b.chainId === 'btc'))
                .sort((a, b) => (tier(a) - tier(b)) || (b.usdValue - a.usdValue) || (b.amount - a.amount));
            const nothing = !rows.length || (filter === 'ALL' && !showZero && rows.every((r) => !(r.amount > 0) && !r.isCustom));
            if (nothing) {
                listEl.innerHTML = filter === 'ALL'
                    ? '<div class="empty-state big"><strong>Sua carteira ainda está vazia</strong><span>Para colocar sua primeira moeda, toque em Receber e mostre o código para quem vai te enviar.</span><button type="button" class="btn-soft" data-empty-receive>Receber minha primeira moeda</button></div>'
                    : '<div class="empty-state">Nenhuma moeda nesta rede.</div>';
                listEl.querySelector('[data-empty-receive]')?.addEventListener('click', () => openReceiveModal());
            } else {
                listEl.innerHTML = rows.map((b) => `
                    <button type="button" class="asset-row asset-row-btn" data-asset-chain="${esc(b.chainId)}" data-asset-symbol="${esc(b.symbol)}">
                        <span class="asset-left">
                            ${REG.tokenOnChainBadge(b.symbol, b.chainId, 38)}
                            <span class="asset-names">
                                <strong>${esc(friendlyTokenName(b))}</strong>
                                <span class="asset-meta money">${esc(formatAmount(b.amount, b.symbol))} ${esc(b.symbol)} · ${esc(REG.getChain(b.chainId)?.name || '')}</span>
                                ${REG.maturity(b.chainId).level === 'solid' ? REG.maturityBadge(b.chainId) : ''}
                            </span>
                        </span>
                        <span class="asset-right money">
                            <strong>${b.hasPrice ? formatBRL(b.brlValue) : 'sem cotação'}</strong>
                            ${changeChip(b)}
                        </span>
                    </button>`).join('');
                listEl.querySelectorAll('[data-asset-chain]').forEach((row) => {
                    row.onclick = () => {
                        const raw = row.getAttribute('data-asset-chain');
                        walletApi.openView('asset', { chainId: raw === 'btc' ? 'btc' : Number(raw), symbol: row.getAttribute('data-asset-symbol') });
                    };
                });
            }
        }
        renderQuoteStatus();
    }

    // Estado das cotações: ao vivo x valor de reserva (nunca mostra um número antigo como se fosse atual)
    function renderQuoteStatus() {
        const statusEl = document.getElementById('hero-quote-status');
        if (!statusEl) return;
        const stale = !state.prices.usdBrlLive || !state.prices.polLive;
        const age = state.prices.updatedAt ? Math.round((Date.now() - state.prices.updatedAt) / 1000) : null;
        if (!state.prices.updatedAt) statusEl.textContent = 'Buscando cotações…';
        else if (stale) statusEl.textContent = '⚠️ Cotação indisponível agora: valores em R$ são aproximados';
        else statusEl.textContent = `● Cotações ao vivo • atualizadas há ${age < 2 ? 'instantes' : age + ' s'}`;
        statusEl.classList.toggle('stale', stale);
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
        registerView: (name, renderFn) => { externalViews[name] = renderFn; },
        renderHome: () => renderHeroAndAssets(),
        renderQuoteStatus: () => renderQuoteStatus(),
        openView: (view, params) => { pendingViewParams = params || {}; openWalletModal(view); },
        // Endereço para RECEBER Bitcoin: um novo a cada recebimento
        getBitcoinAddress: () => btcReceiveAddress(),
        getBitcoinLegacyAddress: () => getActiveAccount()?.btcAddress || '',
        getBitcoinAddresses: () => btcScanList(getActiveAccount()),
        getBitcoinSpendAddress: () => btcRichestAddress(),
        getBitcoinChangeAddress: () => btcChangeAddress(),
        getBitcoinKeyFor: (a) => btcKeyFor(a),
        newBitcoinAddress: () => btcNewReceiveAddress(),
        gatherBitcoinUtxos: () => btcGatherUtxos(),
        signBitcoinPlan: (plan, utxos) => btcSignPlan(plan, utxos),
        afterBitcoinSpend: (plan) => btcAfterSpend(plan),
        getBitcoinPerAddress: () => ({ ...state.btcPerAddr }),
        getBitcoinKey: () => getActiveBitcoinKey(),
        unitUsdFor,
        isBiometrySupported,
        isBiometryRegistered,
        getSigner: getActiveSigner,
        getProvider: getReadProvider,
        confirmTx,
        friendlyTxError,
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
        unlockWithPassword: (pwd) => unlockVaultWithPassword(pwd),
        getLockType: () => readVaultMetaFromStorage()?.lockType || 'password',
        setLockTypeForNewVault: (type) => { state.lockType = type === 'pin' ? 'pin' : 'password'; },
        isBiometryReady: () => { try { return isBiometryRegistered(); } catch (e) { return false; } },
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
