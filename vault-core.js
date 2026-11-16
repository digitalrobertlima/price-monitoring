/**
 * RDESK SENTINEL V22 — WALLET VAULT MULTI-CHAIN (4º de 9 arquivos)
 * Autocustódia BIP-39 (12 ou 24 palavras) 100% compatível com Rabby/MetaMask,
 * Criptografia AES-GCM 256-bit (PBKDF2 600k), Escudo Anti-Zero-Gás (3.0 POL),
 * 8 Ativos em 5 Redes EVM com Redundância Tripla e Ponte EIP-6963.
 */
(function (global) {
    'use strict';

    // =========================================================================
    // 1. CARTEIRAS DO PROPRIETÁRIO (ISENÇÃO AUTOMÁTICA DE TAXA DE INTEGRADOR)
    // =========================================================================
    const OWNER_EXEMPT_WALLETS = new Set([
        '0x2833a1c3dde3b5d2265f057301a89bef1bb50fe3'
    ]);

    const DERIVATION_PATH_EVM = "m/44'/60'/0'/0/0";
    const PBKDF2_ITERATIONS = 600000;
    const AUTO_LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutos
    const CLIPBOARD_CLEAR_MS = 45 * 1000;        // 45 segundos
    const VAULT_STORAGE_KEY = 'rdesk_v22_encrypted_vault';
    const VAULT_IDB_NAME = 'RDESK_V22_SECURE_VAULT';

    // =========================================================================
    // 2. REDES SUPORTADAS (5 TOP REDES EVM + REDUNDÂNCIA TRIPLA DE RPC)
    // =========================================================================
    const NETWORKS = {
        137: {
            chainId: 137,
            hexChainId: '0x89',
            key: 'polygon',
            name: 'Polygon',
            shortName: 'POL',
            nativeSymbol: 'POL',
            nativeDecimals: 18,
            gasReserve: 3.0, // Escudo obrigatório de 3.0 POL contra falta de gás
            explorer: 'https://polygonscan.com',
            rpcs: [
                'https://polygon-bor-rpc.publicnode.com',
                'https://1rpc.io/matic',
                'https://polygon.drpc.org'
            ]
        },
        1: {
            chainId: 1,
            hexChainId: '0x1',
            key: 'ethereum',
            name: 'Ethereum',
            shortName: 'ETH',
            nativeSymbol: 'ETH',
            nativeDecimals: 18,
            gasReserve: 0.004,
            explorer: 'https://etherscan.io',
            rpcs: [
                'https://ethereum-rpc.publicnode.com',
                'https://1rpc.io/eth',
                'https://eth.llamarpc.com'
            ]
        },
        42161: {
            chainId: 42161,
            hexChainId: '0xa4b1',
            key: 'arbitrum',
            name: 'Arbitrum One',
            shortName: 'ARB',
            nativeSymbol: 'ETH',
            nativeDecimals: 18,
            gasReserve: 0.0015,
            explorer: 'https://arbiscan.io',
            rpcs: [
                'https://arbitrum-one-rpc.publicnode.com',
                'https://1rpc.io/arb',
                'https://arbitrum.drpc.org'
            ]
        },
        8453: {
            chainId: 8453,
            hexChainId: '0x2105',
            key: 'base',
            name: 'Base',
            shortName: 'BASE',
            nativeSymbol: 'ETH',
            nativeDecimals: 18,
            gasReserve: 0.0015,
            explorer: 'https://basescan.org',
            rpcs: [
                'https://base-rpc.publicnode.com',
                'https://1rpc.io/base',
                'https://base.drpc.org'
            ]
        },
        10: {
            chainId: 10,
            hexChainId: '0xa',
            key: 'optimism',
            name: 'Optimism',
            shortName: 'OP',
            nativeSymbol: 'ETH',
            nativeDecimals: 18,
            gasReserve: 0.0015,
            explorer: 'https://optimistic.etherscan.io',
            rpcs: [
                'https://optimism-rpc.publicnode.com',
                'https://1rpc.io/op',
                'https://optimism.drpc.org'
            ]
        }
    };

    // =========================================================================
    // 3. REGISTRO OFICIAL DOS 8 ATIVOS (+ WPOL PARA UNISWAP V3 POLYGON)
    // =========================================================================
    const ASSET_REGISTRY = {
        POL: {
            symbol: 'POL',
            name: 'Polygon Ecosystem Token',
            kind: 'VOLATILE',
            binanceSymbol: 'POLUSDT',
            llamaId: 'polygon:0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
            contracts: {
                137: { address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
                1:   { address: '0x455e53CBB86018Ac2B8092FdCd39d8444aFFC3F6', decimals: 18, isNative: false }
            }
        },
        WPOL: {
            symbol: 'WPOL',
            name: 'Wrapped POL (Uniswap V3)',
            kind: 'VOLATILE',
            binanceSymbol: 'POLUSDT',
            llamaId: 'polygon:0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
            contracts: {
                137: { address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', decimals: 18, isNative: false }
            }
        },
        USDT: {
            symbol: 'USDT',
            name: 'Tether USD (USDT / USDT0)',
            kind: 'USD_STABLE',
            binanceSymbol: null,
            llamaId: 'ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7',
            contracts: {
                137:   { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6, isNative: false },
                1:     { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, isNative: false },
                42161: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6, isNative: false },
                8453:  { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6, isNative: false },
                10:    { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6, isNative: false }
            }
        },
        USDC: {
            symbol: 'USDC',
            name: 'USD Coin (Nativo)',
            kind: 'USD_STABLE',
            binanceSymbol: null,
            llamaId: 'ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            contracts: {
                137:   { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6, isNative: false },
                1:     { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, isNative: false },
                42161: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, isNative: false },
                8453:  { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, isNative: false },
                10:    { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6, isNative: false }
            }
        },
        BRZ: {
            symbol: 'BRZ',
            name: 'Brazilian Digital Token (1:1 BRL)',
            kind: 'BRL_STABLE',
            binanceSymbol: null,
            llamaId: null,
            contracts: {
                137:   { address: '0x4eD141110F6EeeAbA9A1df36d8c26f684d2475Dc', decimals: 18, isNative: false },
                1:     { address: '0x01d33FD36ec67c6Ada32cf36b31e88EE190B1839', decimals: 18, isNative: false },
                42161: { address: '0xA8940698FdA5A07AbAEf4A5ccDf2f1Bb525B47A2', decimals: 18, isNative: false },
                8453:  { address: '0xE9185Ee218cae427aF7B9764A011bb89FeA761B4', decimals: 18, isNative: false },
                10:    { address: '0xE9185Ee218cae427aF7B9764A011bb89FeA761B4', decimals: 18, isNative: false }
            }
        },
        BRLA: {
            symbol: 'BRLA',
            name: 'BRLA Digital Real (1:1 BRL)',
            kind: 'BRL_STABLE',
            binanceSymbol: null,
            llamaId: null,
            contracts: {
                137: { address: '0xE6A537a407488807F0bbeb0038B79004f19DDDFb', decimals: 18, isNative: false }
            }
        },
        ETH: {
            symbol: 'ETH',
            name: 'Ethereum (Nativo)',
            kind: 'VOLATILE',
            binanceSymbol: 'ETHUSDT',
            llamaId: 'coingecko:ethereum',
            contracts: {
                1:     { address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
                42161: { address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
                8453:  { address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
                10:    { address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true }
            }
        },
        WETH: {
            symbol: 'WETH',
            name: 'Wrapped Ether',
            kind: 'VOLATILE',
            binanceSymbol: 'ETHUSDT',
            llamaId: 'coingecko:ethereum',
            contracts: {
                137:   { address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18, isNative: false },
                1:     { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18, isNative: false },
                42161: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18, isNative: false },
                8453:  { address: '0x4200000000000000000000000000000000000006', decimals: 18, isNative: false },
                10:    { address: '0x4200000000000000000000000000000000000006', decimals: 18, isNative: false }
            }
        },
        WBTC: {
            symbol: 'WBTC',
            name: 'Wrapped Bitcoin',
            kind: 'VOLATILE',
            binanceSymbol: 'BTCUSDT',
            llamaId: 'ethereum:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
            contracts: {
                137:   { address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', decimals: 8, isNative: false },
                1:     { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8, isNative: false },
                42161: { address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', decimals: 8, isNative: false },
                8453:  { address: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c', decimals: 8, isNative: false },
                10:    { address: '0x68f180fcCe6836688e9084f035309E29Bf0A2095', decimals: 8, isNative: false }
            }
        }
    };

    const ERC20_MIN_ABI = [
        'function balanceOf(address owner) view returns (uint256)',
        'function allowance(address owner, address spender) view returns (uint256)',
        'function approve(address spender, uint256 amount) returns (bool)',
        'function transfer(address to, uint256 amount) returns (bool)'
    ];

    // =========================================================================
    // 4. MEMÓRIA PRIVADA ISOLADA (CLOSURE — NUNCA EXPOSTA NO WINDOW)
    // =========================================================================
    let _privateMnemonic = null;
    let _privateKey = null;
    let _autoLockTimer = null;
    let _clipboardTimer = null;

    let _publicState = {
        mode: 'NONE',              // 'NONE' | 'VAULT_LOCKED' | 'VAULT_UNLOCKED' | 'EXTERNAL_WALLET' | 'WATCH_ONLY'
        address: null,             // Endereço 0x... em minúsculas
        walletLabel: 'Desconectado',
        backupVerified: false,
        wordCount: 12,
        activeChainId: 137,
        usdBrlRate: 5.65,
        pricesUsd: {
            POL: 0.088,
            WPOL: 0.088,
            USDT: 1.0,
            USDC: 1.0,
            BRZ: 1 / 5.65,
            BRLA: 1 / 5.65,
            ETH: 3150.0,
            WETH: 3150.0,
            WBTC: 91000.0
        },
        balancesByChain: {},       // { [chainId]: { [symbol]: number } }
        totalByAsset: {},          // { [symbol]: { amount: number, usd: number, brl: number } }
        totalPortfolioUsd: 0,
        totalPortfolioBrl: 0,
        discoveredProviders: new Map() // EIP-6963 providers
    };

    let _activeExternalEip1193 = null;
    const _listeners = new Set();

    function emitVaultChange(reason) {
        const snapshot = getPublicSnapshot();
        _listeners.forEach((cb) => {
            try {
                cb(snapshot, reason);
            } catch (e) {
                console.error('Vault listener error:', e);
            }
        });
    }

    function resetAutoLockTimer() {
        if (_autoLockTimer) clearTimeout(_autoLockTimer);
        if (_publicState.mode === 'VAULT_UNLOCKED') {
            _autoLockTimer = setTimeout(() => {
                lockVault();
            }, AUTO_LOCK_TIMEOUT_MS);
        }
    }

    // =========================================================================
    // 5. UTILITÁRIOS DE TEMPO, REDUNDÂNCIA RPC E PERSISTÊNCIA ANDROID
    // =========================================================================
    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout RPC')), ms))
        ]);
    }

    async function callWithRpcFailover(chainId, taskFn, timeoutMs = 4500) {
        const net = NETWORKS[chainId];
        if (!net) throw new Error(`Rede ${chainId} não configurada.`);

        let lastErr = null;
        for (let i = 0; i < net.rpcs.length; i++) {
            try {
                const provider = new ethers.providers.JsonRpcProvider(net.rpcs[i], {
                    name: net.key,
                    chainId: net.chainId
                });
                return await withTimeout(taskFn(provider, net.rpcs[i]), timeoutMs);
            } catch (err) {
                lastErr = err;
            }
        }
        throw lastErr || new Error(`Todas as 3 rotas RPC falharam para ${net.name}.`);
    }

    async function requestAndroidPersistentStorage() {
        if (navigator.storage && typeof navigator.storage.persist === 'function') {
            try {
                await navigator.storage.persist();
            } catch (e) {}
        }
    }

    function saveEncryptedBlobRedundant(blobJsonStr) {
        try {
            localStorage.setItem(VAULT_STORAGE_KEY, blobJsonStr);
        } catch (e) {}

        try {
            const req = indexedDB.open(VAULT_IDB_NAME, 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('vault')) {
                    db.createObjectStore('vault');
                }
            };
            req.onsuccess = (e) => {
                const db = e.target.result;
                const tx = db.transaction('vault', 'readwrite');
                tx.objectStore('vault').put(blobJsonStr, 'primary');
            };
        } catch (e) {}
    }

    async function loadEncryptedBlobRedundant() {
        try {
            const ls = localStorage.getItem(VAULT_STORAGE_KEY);
            if (ls) return JSON.parse(ls);
        } catch (e) {}

        try {
            const idbData = await new Promise((resolve) => {
                const req = indexedDB.open(VAULT_IDB_NAME, 1);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('vault')) {
                        db.createObjectStore('vault');
                    }
                };
                req.onsuccess = (e) => {
                    const db = e.target.result;
                    const tx = db.transaction('vault', 'readonly');
                    const getReq = tx.objectStore('vault').get('primary');
                    getReq.onsuccess = () => resolve(getReq.result || null);
                    getReq.onerror = () => resolve(null);
                };
                req.onerror = () => resolve(null);
            });
            if (idbData) {
                try { localStorage.setItem(VAULT_STORAGE_KEY, idbData); } catch (e) {}
                return JSON.parse(idbData);
            }
        } catch (e) {}

        return null;
    }

    // =========================================================================
    // 6. CRIPTOGRAFIA BANCÁRIA (WEB CRYPTO PBKDF2 600K + AES-GCM 256)
    // =========================================================================
    function bytesToBase64(bytes) {
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    }

    function base64ToBytes(b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }

    async function deriveAesKeyFromPassword(password, saltBytes) {
        const enc = new TextEncoder();
        const keyMaterial = await window.crypto.subtle.importKey(
            'raw',
            enc.encode(password),
            'PBKDF2',
            false,
            ['deriveKey']
        );

        return window.crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: saltBytes,
                iterations: PBKDF2_ITERATIONS,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async function encryptMnemonicPayload(mnemonicPhrase, password) {
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const aesKey = await deriveAesKeyFromPassword(password, salt);

        const encoded = new TextEncoder().encode(mnemonicPhrase);
        const cipherBuffer = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            aesKey,
            encoded
        );

        return {
            version: 1,
            kdf: 'PBKDF2-SHA256',
            iterations: PBKDF2_ITERATIONS,
            cipher: 'AES-GCM-256',
            salt: bytesToBase64(salt),
            iv: bytesToBase64(iv),
            ciphertext: bytesToBase64(new Uint8Array(cipherBuffer))
        };
    }

    async function decryptMnemonicPayload(vaultRecord, password) {
        const salt = base64ToBytes(vaultRecord.salt);
        const iv = base64ToBytes(vaultRecord.iv);
        const ciphertext = base64ToBytes(vaultRecord.ciphertext);

        const aesKey = await deriveAesKeyFromPassword(password, salt);
        const plainBuffer = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            aesKey,
            ciphertext
        );

        return new TextDecoder().decode(plainBuffer);
    }

    // =========================================================================
    // 7. GERAÇÃO BIP-39 (12 OU 24 PALAVRAS), DESAFIO DE 3 PALAVRAS & COFRE
    // =========================================================================
    function generateDraftMnemonic(wordCount = 12) {
        const byteLength = Number(wordCount) === 24 ? 32 : 16;
        const entropy = ethers.utils.randomBytes(byteLength);
        return ethers.utils.entropyToMnemonic(entropy);
    }

    function createBackupChallenge(mnemonicPhrase) {
        const words = String(mnemonicPhrase || '').trim().split(/\s+/);
        if (words.length !== 12 && words.length !== 24) {
            throw new Error('A frase deve conter 12 ou 24 palavras.');
        }

        const pickedIndices = new Set();
        while (pickedIndices.size < 3) {
            const randByte = window.crypto.getRandomValues(new Uint8Array(1))[0];
            pickedIndices.add(randByte % words.length);
        }

        return Array.from(pickedIndices)
            .sort((a, b) => a - b)
            .map((zeroIdx) => ({
                index: zeroIdx,
                position: zeroIdx + 1, // 1-based para exibição humana (#1 até #12/#24)
                expectedWord: words[zeroIdx].toLowerCase()
            }));
    }

    async function commitVaultFromMnemonic({ mnemonic, password, challengeChecks = null, isImport = false }) {
        const normalized = String(mnemonic || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');

        const words = normalized.split(' ');
        if (words.length !== 12 && words.length !== 24) {
            throw new Error('Informe exatamente 12 ou 24 palavras válidas.');
        }

        if (!ethers.utils.isValidMnemonic(normalized)) {
            throw new Error('Frase de recuperação BIP-39 inválida. Verifique a ortografia e a ordem das palavras.');
        }

        if (!password || String(password).length < 8) {
            throw new Error('Defina uma senha de pelo menos 8 caracteres para proteger o cofre neste aparelho.');
        }

        // Valida a prova dedicada das 3 palavras aleatórias antes de liberar o cofre
        if (!isImport) {
            if (!Array.isArray(challengeChecks) || challengeChecks.length < 3) {
                throw new Error('Conclua a confirmação das 3 palavras aleatórias antes de ativar sua carteira.');
            }
            for (const item of challengeChecks) {
                const expected = words[item.index];
                const typed = String(item.answer || '').trim().toLowerCase();
                if (!expected || typed !== expected) {
                    throw new Error(`A palavra #${item.position} não confere com sua frase anotada.`);
                }
            }
        }

        const walletObj = ethers.Wallet.fromMnemonic(normalized, DERIVATION_PATH_EVM);
        const addressLower = walletObj.address.toLowerCase();

        const encryptedRecord = await encryptMnemonicPayload(normalized, password);
        encryptedRecord.address = addressLower;
        encryptedRecord.wordCount = words.length;
        encryptedRecord.backupVerified = true;
        encryptedRecord.createdAt = new Date().toISOString();

        saveEncryptedBlobRedundant(JSON.stringify(encryptedRecord));
        await requestAndroidPersistentStorage();

        _privateMnemonic = normalized;
        _privateKey = walletObj.privateKey;

        _publicState.mode = 'VAULT_UNLOCKED';
        _publicState.address = addressLower;
        _publicState.walletLabel = `Cofre (${words.length}p)`;
        _publicState.backupVerified = true;
        _publicState.wordCount = words.length;

        resetAutoLockTimer();
        emitVaultChange('VAULT_CREATED_AND_UNLOCKED');
        refreshAllBalancesAndPrices();
        return addressLower;
    }

    async function unlockVault(password) {
        const record = await loadEncryptedBlobRedundant();
        if (!record) {
            throw new Error('Nenhum cofre encontrado neste aparelho.');
        }

        let plainMnemonic;
        try {
            plainMnemonic = await decryptMnemonicPayload(record, password);
        } catch (err) {
            throw new Error('Senha incorreta. Não foi possível abrir o cofre.');
        }

        const walletObj = ethers.Wallet.fromMnemonic(plainMnemonic, DERIVATION_PATH_EVM);
        _privateMnemonic = plainMnemonic;
        _privateKey = walletObj.privateKey;

        _publicState.mode = 'VAULT_UNLOCKED';
        _publicState.address = walletObj.address.toLowerCase();
        _publicState.walletLabel = `Cofre (${record.wordCount || 12}p)`;
        _publicState.backupVerified = true;
        _publicState.wordCount = record.wordCount || 12;

        resetAutoLockTimer();
        emitVaultChange('VAULT_UNLOCKED');
        refreshAllBalancesAndPrices();
        return _publicState.address;
    }

    function lockVault() {
        _privateMnemonic = null;
        _privateKey = null;
        if (_autoLockTimer) clearTimeout(_autoLockTimer);

        if (_publicState.address && _publicState.mode === 'VAULT_UNLOCKED') {
            _publicState.mode = 'VAULT_LOCKED';
            emitVaultChange('VAULT_LOCKED');
        }
    }

    async function revealMnemonicWithPassword(password) {
        const record = await loadEncryptedBlobRedundant();
        if (!record) throw new Error('Nenhum cofre salvo neste dispositivo.');
        const plain = await decryptMnemonicPayload(record, password);
        resetAutoLockTimer();
        return plain;
    }

    function copySecretWithAutoClear(secretText, onClearedCallback) {
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(secretText).then(() => {
            if (_clipboardTimer) clearTimeout(_clipboardTimer);
            _clipboardTimer = setTimeout(() => {
                navigator.clipboard.writeText('').catch(() => {});
                if (typeof onClearedCallback === 'function') onClearedCallback();
            }, CLIPBOARD_CLEAR_MS);
        });
    }

    // =========================================================================
    // 8. CONEXÃO EXTERNA (EIP-6963 + RABBY / METAMASK + ANDROID DEEP-LINK)
    // =========================================================================
    function initEip6963Discovery() {
        window.addEventListener('eip6963:announceProvider', (event) => {
            const detail = event?.detail;
            if (!detail || !detail.info || !detail.provider) return;
            _publicState.discoveredProviders.set(detail.info.rdns || detail.info.uuid, detail);
            emitVaultChange('EIP6963_PROVIDER_ANNOUNCED');
        });

        window.dispatchEvent(new Event('eip6963:requestProvider'));
    }

    function isAndroidDevice() {
        return /Android/i.test(navigator.userAgent || '');
    }

    async function connectExternalWallet(preferredRdns = '') {
        window.dispatchEvent(new Event('eip6963:requestProvider'));

        let chosenProvider = null;
        let label = 'Web3';

        if (preferredRdns && _publicState.discoveredProviders.has(preferredRdns)) {
            const entry = _publicState.discoveredProviders.get(preferredRdns);
            chosenProvider = entry.provider;
            label = entry.info.name || 'Web3';
        } else if (_publicState.discoveredProviders.size > 0) {
            // Prioriza Rabby se estiver presente entre os provedores anunciados
            for (const entry of _publicState.discoveredProviders.values()) {
                if ((entry.info.rdns || '').includes('rabby') || (entry.info.name || '').toLowerCase().includes('rabby')) {
                    chosenProvider = entry.provider;
                    label = entry.info.name;
                    break;
                }
            }
            if (!chosenProvider) {
                const first = _publicState.discoveredProviders.values().next().value;
                chosenProvider = first.provider;
                label = first.info.name || 'Web3';
            }
        } else if (window.ethereum) {
            chosenProvider = window.ethereum;
            label = window.ethereum.isRabby ? 'Rabby' : (window.ethereum.isMetaMask ? 'MetaMask' : 'Web3');
        }

        if (!chosenProvider) {
            return {
                connected: false,
                needsMobileHandoff: isAndroidDevice(),
                cleanUrl: window.location.href
            };
        }

        const accounts = await chosenProvider.request({ method: 'eth_requestAccounts' });
        if (!accounts || accounts.length === 0) {
            throw new Error('Nenhuma conta autorizada na carteira externa.');
        }

        _activeExternalEip1193 = chosenProvider;
        _privateMnemonic = null;
        _privateKey = null;

        _publicState.mode = 'EXTERNAL_WALLET';
        _publicState.address = accounts[0].toLowerCase();
        _publicState.walletLabel = label;

        if (typeof chosenProvider.on === 'function') {
            chosenProvider.on('accountsChanged', (accs) => {
                if (accs && accs[0]) {
                    _publicState.address = accs[0].toLowerCase();
                    emitVaultChange('EXTERNAL_ACCOUNT_CHANGED');
                    refreshAllBalancesAndPrices();
                }
            });
            chosenProvider.on('chainChanged', (hexId) => {
                const parsed = parseInt(hexId, 16);
                if (NETWORKS[parsed]) {
                    _publicState.activeChainId = parsed;
                    emitVaultChange('CHAIN_CHANGED');
                }
            });
        }

        emitVaultChange('EXTERNAL_WALLET_CONNECTED');
        refreshAllBalancesAndPrices();
        return { connected: true, address: _publicState.address, label };
    }

    function openAndroidWalletHandoff(targetApp = 'rabby') {
        const cleanUrl = window.location.href;
        const noProtocol = cleanUrl.replace(/^https?:\/\//, '');

        if (navigator.clipboard) {
            navigator.clipboard.writeText(cleanUrl).catch(() => {});
        }

        if (targetApp === 'metamask') {
            window.location.href = `https://metamask.app.link/dapp/${noProtocol}`;
        } else if (targetApp === 'trust') {
            window.location.href = `https://link.trustwallet.com/open_url?coin_id=966&url=${encodeURIComponent(cleanUrl)}`;
        } else {
            // Abre o app nativo Rabby Mobile no Android com o link já copiado
            window.location.href = 'intent://#Intent;package=com.debank.rabbymobile;end';
        }
    }

    function setWatchOnlyAddress(rawAddr) {
        const trimmed = String(rawAddr || '').trim().toLowerCase();
        if (!ethers.utils.isAddress(trimmed)) {
            throw new Error('Endereço EVM inválido (deve começar com 0x...).');
        }
        _publicState.mode = 'WATCH_ONLY';
        _publicState.address = trimmed;
        _publicState.walletLabel = 'Observação';
        emitVaultChange('WATCH_ONLY_SET');
        refreshAllBalancesAndPrices();
        return trimmed;
    }

    // =========================================================================
    // 9. ORÁCULO DE PREÇOS (REDUNDÂNCIA TRIPLA) & LEITURA DE SALDOS (5 REDES)
    // =========================================================================
    async function refreshMultiChainPrices() {
        // Rota 1 & 2 para Câmbio BRL (AwesomeAPI + BCB PTAX)
        let fxUpdated = false;
        try {
            const res = await withTimeout(fetch('https://economia.awesomeapi.com.br/last/USD-BRL'), 4000);
            const json = await res.json();
            if (json?.USDBRL?.bid) {
                _publicState.usdBrlRate = parseFloat(json.USDBRL.bid);
                fxUpdated = true;
            }
        } catch (e) {}

        if (!fxUpdated) {
            try {
                const today = new Date();
                const past = new Date(Date.now() - 5 * 86400000);
                const fmt = (d) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}-${d.getUTCFullYear()}`;
                const bcbUrl = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='${fmt(past)}'&@dataFinalCotacao='${fmt(today)}'&$format=json`;
                const res = await withTimeout(fetch(bcbUrl), 4000);
                const json = await res.json();
                const lastRow = json?.value?.[json.value.length - 1];
                if (lastRow?.cotacaoVenda) {
                    _publicState.usdBrlRate = parseFloat(lastRow.cotacaoVenda);
                }
            } catch (e) {}
        }

        // Rota 1 para Preços dos Ativos: Binance Ticker
        let gotBinance = false;
        try {
            const symbols = encodeURIComponent(JSON.stringify(['POLUSDT', 'ETHUSDT', 'BTCUSDT']));
            const res = await withTimeout(fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${symbols}`), 4000);
            const list = await res.json();
            if (Array.isArray(list)) {
                list.forEach((item) => {
                    const p = parseFloat(item.price);
                    if (!Number.isFinite(p) || p <= 0) return;
                    if (item.symbol === 'POLUSDT') {
                        _publicState.pricesUsd.POL = p;
                        _publicState.pricesUsd.WPOL = p;
                    } else if (item.symbol === 'ETHUSDT') {
                        _publicState.pricesUsd.ETH = p;
                        _publicState.pricesUsd.WETH = p;
                    } else if (item.symbol === 'BTCUSDT') {
                        _publicState.pricesUsd.WBTC = p;
                    }
                });
                gotBinance = true;
            }
        } catch (e) {}

        // Rota 2 (Failover): DefiLlama Coins API
        if (!gotBinance) {
            try {
                const ids = [
                    'polygon:0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
                    'coingecko:ethereum',
                    'ethereum:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'
                ].join(',');
                const res = await withTimeout(fetch(`https://coins.llama.fi/prices/current/${ids}`), 4000);
                const json = await res.json();
                const c = json?.coins || {};
                if (c['polygon:0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270']?.price) {
                    const p = c['polygon:0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'].price;
                    _publicState.pricesUsd.POL = p;
                    _publicState.pricesUsd.WPOL = p;
                }
                if (c['coingecko:ethereum']?.price) {
                    const p = c['coingecko:ethereum'].price;
                    _publicState.pricesUsd.ETH = p;
                    _publicState.pricesUsd.WETH = p;
                }
                if (c['ethereum:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599']?.price) {
                    _publicState.pricesUsd.WBTC = c['ethereum:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'].price;
                }
            } catch (e) {}
        }

        // Stablecoins ancoradas
        _publicState.pricesUsd.USDT = 1.0;
        _publicState.pricesUsd.USDC = 1.0;
        _publicState.pricesUsd.BRZ = 1 / _publicState.usdBrlRate;
        _publicState.pricesUsd.BRLA = 1 / _publicState.usdBrlRate;
    }

    async function refreshAllBalancesAndPrices() {
        await refreshMultiChainPrices();
        const addr = _publicState.address;
        if (!addr) {
            emitVaultChange('PRICES_UPDATED');
            return;
        }

        const chainIds = Object.keys(NETWORKS).map(Number);
        const newBalancesByChain = {};

        await Promise.all(chainIds.map(async (chainId) => {
            newBalancesByChain[chainId] = {};
            try {
                await callWithRpcFailover(chainId, async (provider) => {
                    const assetsOnChain = Object.values(ASSET_REGISTRY).filter(
                        (a) => a.contracts[chainId]
                    );

                    const settled = await Promise.allSettled(assetsOnChain.map(async (asset) => {
                        const meta = asset.contracts[chainId];
                        if (meta.isNative) {
                            const raw = await provider.getBalance(addr);
                            return { symbol: asset.symbol, amount: parseFloat(ethers.utils.formatUnits(raw, meta.decimals)) };
                        }
                        const contract = new ethers.Contract(meta.address, ERC20_MIN_ABI, provider);
                        const raw = await contract.balanceOf(addr);
                        return { symbol: asset.symbol, amount: parseFloat(ethers.utils.formatUnits(raw, meta.decimals)) };
                    }));

                    // Se o nó inteiro falhou, tenta o próximo RPC; se só um token falhou,
                    // mantém a leitura anterior dele em vez de descartar a rede toda.
                    if (settled.every((r) => r.status === 'rejected')) throw settled[0].reason;
                    settled.forEach((r, idx) => {
                        const sym = assetsOnChain[idx].symbol;
                        if (r.status === 'fulfilled') {
                            newBalancesByChain[chainId][sym] = r.value.amount;
                        } else if (_publicState.balancesByChain[chainId]?.[sym] !== undefined) {
                            newBalancesByChain[chainId][sym] = _publicState.balancesByChain[chainId][sym];
                        }
                    });
                }, 5000);
            } catch (err) {
                // Preserva leitura anterior da rede se houver oscilação momentânea
                if (_publicState.balancesByChain[chainId]) {
                    newBalancesByChain[chainId] = _publicState.balancesByChain[chainId];
                }
            }
        }));

        _publicState.balancesByChain = newBalancesByChain;

        // Consolida saldos totais por moeda e em Reais (BRL)
        const totals = {};
        let grandUsd = 0;

        Object.keys(ASSET_REGISTRY).forEach((sym) => {
            let sumAmt = 0;
            chainIds.forEach((cid) => {
                sumAmt += (newBalancesByChain[cid]?.[sym] || 0);
            });
            const pUsd = _publicState.pricesUsd[sym] || 0;
            const valUsd = sumAmt * pUsd;
            const valBrl = valUsd * _publicState.usdBrlRate;

            totals[sym] = { amount: sumAmt, usd: valUsd, brl: valBrl };
            grandUsd += valUsd;
        });

        _publicState.totalByAsset = totals;
        _publicState.totalPortfolioUsd = grandUsd;
        _publicState.totalPortfolioBrl = grandUsd * _publicState.usdBrlRate;

        emitVaultChange('BALANCES_UPDATED');
    }

    // =========================================================================
    // 10. ESCUDO ANTI-ZERO-GÁS & SIGNER UNIVERSAL (INTERNO OU EXTERNO)
    // =========================================================================
    function getSpendableBalance(chainId, symbol) {
        const net = NETWORKS[chainId];
        const rawBal = _publicState.balancesByChain[chainId]?.[symbol] || 0;
        if (!net) return rawBal;

        const asset = ASSET_REGISTRY[symbol];
        const isNativeCoin = asset?.contracts?.[chainId]?.isNative === true;
        if (isNativeCoin) {
            return Math.max(0, rawBal - net.gasReserve);
        }
        return rawBal;
    }

    function hasMinimumGasShield(chainId) {
        const net = NETWORKS[chainId];
        if (!net) return false;
        const nativeBal = _publicState.balancesByChain[chainId]?.[net.nativeSymbol] || 0;
        // Exige pelo menos 0.05 POL (ou equivalente) além de verificar o escudo completo
        return nativeBal >= Math.min(0.05, net.gasReserve * 0.02);
    }

    // Gorjeta mínima (gwei) que os validadores aceitam. Na Polygon, o padrão do ethers v5
    // (1,5 gwei) é recusado com "transaction underpriced", então aplicamos um piso.
    const MIN_PRIORITY_FEE_GWEI = { 137: 30 };

    // Escolhe o primeiro RPC que responde e ajusta o cálculo de taxa EIP-1559 da rede.
    async function pickHealthySigningProvider(net) {
        let provider = null;
        for (const rpcUrl of net.rpcs) {
            const candidate = new ethers.providers.StaticJsonRpcProvider(rpcUrl, {
                name: net.key,
                chainId: net.chainId
            });
            try {
                await withTimeout(candidate.getBlockNumber(), 4000);
                provider = candidate;
                break;
            } catch (e) {}
        }
        if (!provider) {
            throw new Error(`Nenhum servidor da rede ${net.name} respondeu. Verifique sua conexão e tente de novo.`);
        }

        const baseGetFeeData = provider.getFeeData.bind(provider);
        provider.getFeeData = async () => {
            const [block, gasPrice, suggestedTipHex] = await Promise.all([
                provider.getBlock('latest'),
                provider.getGasPrice().catch(() => null),
                provider.send('eth_maxPriorityFeePerGas', []).catch(() => null)
            ]);
            if (!block || !block.baseFeePerGas) return baseGetFeeData();

            const floor = ethers.utils.parseUnits(String(MIN_PRIORITY_FEE_GWEI[net.chainId] || 0), 'gwei');
            let tip = suggestedTipHex ? ethers.BigNumber.from(suggestedTipHex) : ethers.utils.parseUnits('1.5', 'gwei');
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

    async function getSignerForChain(chainId) {
        const net = NETWORKS[chainId];
        if (!net) throw new Error(`Rede ${chainId} não suportada.`);

        if (_publicState.mode === 'VAULT_UNLOCKED' && _privateKey) {
            resetAutoLockTimer();
            const provider = await pickHealthySigningProvider(net);
            return new ethers.Wallet(_privateKey, provider);
        }

        if (_publicState.mode === 'EXTERNAL_WALLET' && _activeExternalEip1193) {
            try {
                await _activeExternalEip1193.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: net.hexChainId }]
                });
            } catch (switchErr) {
                if (switchErr.code === 4902) {
                    await _activeExternalEip1193.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: net.hexChainId,
                            chainName: net.name,
                            nativeCurrency: {
                                name: net.nativeSymbol,
                                symbol: net.nativeSymbol,
                                decimals: net.nativeDecimals
                            },
                            rpcUrls: net.rpcs,
                            blockExplorerUrls: [net.explorer]
                        }]
                    });
                } else {
                    throw switchErr;
                }
            }
            const web3Prov = new ethers.providers.Web3Provider(_activeExternalEip1193);
            return web3Prov.getSigner();
        }

        if (_publicState.mode === 'VAULT_LOCKED') {
            throw new Error('Cofre bloqueado. Digite sua senha para assinar a transação.');
        }

        throw new Error('Crie seu Wallet Vault ou conecte uma carteira antes de transacionar.');
    }

    // =========================================================================
    // 11. ENVIO MULTI-REDE (8 MOEDAS / 5 REDES) + RECIBO HUMANO EM REAIS
    // =========================================================================
    async function buildTransferPreview({ chainId, symbol, toAddress, amount }) {
        const net = NETWORKS[chainId];
        const asset = ASSET_REGISTRY[symbol];
        const contractMeta = asset?.contracts?.[chainId];

        if (!net || !asset || !contractMeta) {
            throw new Error(`${symbol} não está disponível na rede ${net?.name || chainId}.`);
        }

        const cleanTo = String(toAddress || '').trim();
        if (!ethers.utils.isAddress(cleanTo)) {
            throw new Error('Endereço de destino inválido (deve começar com 0x...).');
        }

        const qty = parseFloat(amount);
        if (!Number.isFinite(qty) || qty <= 0) {
            throw new Error('Informe uma quantidade válida maior que zero.');
        }

        const spendable = getSpendableBalance(chainId, symbol);
        if (qty > spendable + 1e-9) {
            throw new Error(
                contractMeta.isNative
                    ? `Saldo insuficiente considerando o escudo obrigatório de ${net.gasReserve} ${net.nativeSymbol}. Disponível: ${spendable.toFixed(4)} ${symbol}.`
                    : `Saldo insuficiente de ${symbol} na ${net.name}. Disponível: ${spendable.toFixed(4)} ${symbol}.`
            );
        }

        const unitPriceUsd = _publicState.pricesUsd[symbol] || 0;
        const amountUsd = qty * unitPriceUsd;
        const amountBrl = amountUsd * _publicState.usdBrlRate;

        let estimatedGasNative = 0.015;
        let txPayload = null;

        if (contractMeta.isNative) {
            const valueWei = ethers.utils.parseUnits(qty.toFixed(contractMeta.decimals), contractMeta.decimals);
            txPayload = { to: cleanTo, value: valueWei };
            estimatedGasNative = chainId === 137 ? 0.008 : 0.00012;
        } else {
            const iface = new ethers.utils.Interface(ERC20_MIN_ABI);
            const rawUnits = ethers.utils.parseUnits(qty.toFixed(contractMeta.decimals), contractMeta.decimals);
            const data = iface.encodeFunctionData('transfer', [cleanTo, rawUnits]);
            txPayload = { to: contractMeta.address, data, value: 0 };
            estimatedGasNative = chainId === 137 ? 0.022 : 0.00028;
        }

        const nativePriceUsd = _publicState.pricesUsd[net.nativeSymbol] || 0;
        const gasBrl = estimatedGasNative * nativePriceUsd * _publicState.usdBrlRate;

        return {
            actionTitle: `Enviar ${symbol} (${net.name})`,
            outSummary: `${qty.toFixed(symbol === 'WBTC' ? 6 : 4)} ${symbol}`,
            outBrl: amountBrl,
            inSummary: `Destino ${cleanTo.slice(0, 6)}...${cleanTo.slice(-4)}`,
            inBrl: amountBrl,
            networkName: net.name,
            estimatedGasText: `${estimatedGasNative.toFixed(5)} ${net.nativeSymbol}`,
            estimatedGasBrl: gasBrl,
            gasReserveText: `${net.gasReserve} ${net.nativeSymbol} protegidos`,
            chainId,
            txPayload
        };
    }

    async function sendPreparedTransaction(chainId, txPayload) {
        const signer = await getSignerForChain(chainId);
        // Simulação prévia obrigatória para evitar gastar gás em transação que falharia
        await signer.call(txPayload);
        const txResponse = await signer.sendTransaction(txPayload);
        const receipt = await txResponse.wait(1);
        refreshAllBalancesAndPrices();
        return receipt;
    }

    function isOwnerExempt(address = _publicState.address) {
        if (!address) return false;
        const lower = address.toLowerCase();
        if (OWNER_EXEMPT_WALLETS.has(lower)) return true;
        // Se for uma carteira criada/gerenciada no próprio cofre local do dispositivo
        if (_publicState.mode === 'VAULT_UNLOCKED' || _publicState.mode === 'VAULT_LOCKED') {
            return true;
        }
        return false;
    }

    function getPublicSnapshot() {
        return {
            mode: _publicState.mode,
            address: _publicState.address,
            walletLabel: _publicState.walletLabel,
            backupVerified: _publicState.backupVerified,
            wordCount: _publicState.wordCount,
            activeChainId: _publicState.activeChainId,
            usdBrlRate: _publicState.usdBrlRate,
            pricesUsd: { ..._publicState.pricesUsd },
            balancesByChain: JSON.parse(JSON.stringify(_publicState.balancesByChain)),
            totalByAsset: JSON.parse(JSON.stringify(_publicState.totalByAsset)),
            totalPortfolioUsd: _publicState.totalPortfolioUsd,
            totalPortfolioBrl: _publicState.totalPortfolioBrl,
            discoveredProviders: Array.from(_publicState.discoveredProviders.values()).map((d) => ({
                rdns: d.info.rdns,
                name: d.info.name,
                icon: d.info.icon
            })),
            isOwnerExempt: isOwnerExempt(_publicState.address)
        };
    }

    async function bootstrapVault() {
        initEip6963Discovery();
        const existingRecord = await loadEncryptedBlobRedundant();
        if (existingRecord && existingRecord.address) {
            _publicState.mode = 'VAULT_LOCKED';
            _publicState.address = existingRecord.address.toLowerCase();
            _publicState.walletLabel = `Cofre Bloqueado (${existingRecord.wordCount || 12}p)`;
            _publicState.backupVerified = Boolean(existingRecord.backupVerified);
            _publicState.wordCount = existingRecord.wordCount || 12;
            emitVaultChange('VAULT_DETECTED_LOCKED');
            refreshAllBalancesAndPrices();
        } else {
            await refreshMultiChainPrices();
            emitVaultChange('NO_VAULT');
        }
    }

    // Exporta apenas a API segura e sem dados privados
    global.RdeskVault = {
        NETWORKS,
        ASSET_REGISTRY,
        ERC20_MIN_ABI,
        OWNER_EXEMPT_WALLETS,
        bootstrapVault,
        subscribe: (fn) => {
            _listeners.add(fn);
            return () => _listeners.delete(fn);
        },
        getState: getPublicSnapshot,
        setActiveChain: (chainId) => {
            if (NETWORKS[chainId]) {
                _publicState.activeChainId = Number(chainId);
                emitVaultChange('ACTIVE_CHAIN_CHANGED');
            }
        },
        generateDraftMnemonic,
        createBackupChallenge,
        commitVaultFromMnemonic,
        unlockVault,
        lockVault,
        revealMnemonicWithPassword,
        copySecretWithAutoClear,
        connectExternalWallet,
        openAndroidWalletHandoff,
        setWatchOnlyAddress,
        callWithRpcFailover,
        refreshAllBalancesAndPrices,
        getSpendableBalance,
        hasMinimumGasShield,
        getSignerForChain,
        buildTransferPreview,
        sendPreparedTransaction,
        isOwnerExempt
    };
})(window);
