/* =========================================================================
   RDESK SENTINEL — WALLET, BIOMETRIA WEBAUTHN, RABBY EIP-6963 & TRANSFERÊNCIAS
   Arquivo 3 de 7: wallet-service.js
   ========================================================================= */

(function () {
    'use strict';

    const VAULT_STORAGE_KEY = 'rdesk_v22_encrypted_vault';
    const BIO_DB_NAME = 'RDESK_BIO_KEYSTORE';
    const BIO_STORE_NAME = 'device_keys';
    const GAS_RESERVE_POL = 3.0;
    const GAS_RESERVE_ETH = 0.0015;

    // Configuração das 5 redes EVM suportadas
    const CHAINS = {
        137: {
            id: 137,
            hex: '0x89',
            name: 'Polygon',
            nativeSymbol: 'POL',
            explorer: 'https://polygonscan.com',
            rpcs: [
                'https://polygon-bor-rpc.publicnode.com',
                'https://1rpc.io/matic',
                'https://polygon.drpc.org'
            ]
        },
        42161: {
            id: 42161,
            hex: '0xa4b1',
            name: 'Arbitrum',
            nativeSymbol: 'ETH',
            explorer: 'https://arbiscan.io',
            rpcs: [
                'https://arbitrum-one-rpc.publicnode.com',
                'https://1rpc.io/arb'
            ]
        },
        8453: {
            id: 8453,
            hex: '0x2105',
            name: 'Base',
            nativeSymbol: 'ETH',
            explorer: 'https://basescan.org',
            rpcs: [
                'https://base-rpc.publicnode.com',
                'https://1rpc.io/base'
            ]
        },
        10: {
            id: 10,
            hex: '0xa',
            name: 'Optimism',
            nativeSymbol: 'ETH',
            explorer: 'https://optimistic.etherscan.io',
            rpcs: [
                'https://optimism-rpc.publicnode.com',
                'https://1rpc.io/op'
            ]
        },
        1: {
            id: 1,
            hex: '0x1',
            name: 'Ethereum',
            nativeSymbol: 'ETH',
            explorer: 'https://etherscan.io',
            rpcs: [
                'https://ethereum-rpc.publicnode.com',
                'https://1rpc.io/eth'
            ]
        }
    };

    // Contratos verificados por rede
    const CHAIN_TOKENS = {
        137: [
            { symbol: 'POL', name: 'Polygon Ecosystem Token', decimals: 18, isNative: true, priceKey: 'POL' },
            { symbol: 'WPOL', name: 'Wrapped POL', decimals: 18, address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', priceKey: 'POL' },
            { symbol: 'USDT', name: 'Tether USD (USDT0)', decimals: 6, address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', priceKey: 'USD' },
            { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', priceKey: 'USD' },
            { symbol: 'BRZ', name: 'Brazilian Digital Token', decimals: 18, address: '0x4eD141110F6EeeAbA9A1df36d8c26f684d2475Dc', priceKey: 'BRL' },
            { symbol: 'BRLA', name: 'BRLA Digital', decimals: 18, address: '0xE6A537a407488807F0bbeb0038B79004f19DDDFb', priceKey: 'BRL' },
            { symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8, address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', priceKey: 'BTC' }
        ],
        42161: [
            { symbol: 'ETH', name: 'Ether (Arbitrum)', decimals: 18, isNative: true, priceKey: 'ETH' },
            { symbol: 'USDT', name: 'Tether USD', decimals: 6, address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', priceKey: 'USD' },
            { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', priceKey: 'USD' },
            { symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8, address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', priceKey: 'BTC' }
        ],
        8453: [
            { symbol: 'ETH', name: 'Ether (Base)', decimals: 18, isNative: true, priceKey: 'ETH' },
            { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', priceKey: 'USD' }
        ],
        10: [
            { symbol: 'ETH', name: 'Ether (Optimism)', decimals: 18, isNative: true, priceKey: 'ETH' },
            { symbol: 'USDT', name: 'Tether USD', decimals: 6, address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', priceKey: 'USD' },
            { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', priceKey: 'USD' }
        ],
        1: [
            { symbol: 'ETH', name: 'Ether (Mainnet)', decimals: 18, isNative: true, priceKey: 'ETH' },
            { symbol: 'USDT', name: 'Tether USD', decimals: 6, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', priceKey: 'USD' },
            { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', priceKey: 'USD' },
            { symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8, address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', priceKey: 'BTC' }
        ]
    };

    // Estado interno seguro da carteira
    const walletState = {
        mode: 'NONE',          // 'NONE' | 'VAULT_LOCKED' | 'VAULT_UNLOCKED' | 'INJECTED' | 'WATCH_ONLY'
        address: '',
        localWallet: null,     // ethers.Wallet em memória apenas enquanto desbloqueado
        injectedProvider: null,
        injectedName: '',
        eip6963Providers: new Map(),
        balances: [],          // Lista plana de saldos por rede/ativo
        lpUsdTotal: 0,         // Atualizado pelo defi-pix-service.js
        prices: {
            USD_BRL: 5.65,
            POL: 0.088,
            ETH: 3100,
            BTC: 90000
        }
    };

    let draftMnemonicWords = [];
    let draftChallengeIndices = [];

    // =========================================================================
    // UTILITÁRIOS GERAIS & RECIBO HUMANO EM REAIS (R$)
    // =========================================================================
    function formatBRL(val) {
        return Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function formatUSD(val) {
        return '$ ' + Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function shortAddress(addr) {
        if (!addr || addr.length < 10) return '0x0000...0000';
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    }

    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout RPC')), ms))
        ]);
    }

    function openModal(id) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'flex';
    }

    function closeModal(id) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    }

    // Modal Universal de Recibo Pré-Assinatura em Reais (R$)
    function requestHumanReceipt(spec) {
        return new Promise((resolve) => {
            const modal = document.getElementById('modal-receipt');
            if (!modal) {
                resolve(true);
                return;
            }

            document.getElementById('rcp-title').textContent = spec.title || 'Confirmar Operação';
            document.getElementById('rcp-send-val').textContent = spec.sendVal || '--';
            document.getElementById('rcp-send-brl').textContent = spec.sendBrl || 'R$ 0,00';
            document.getElementById('rcp-recv-val').textContent = spec.recvVal || '--';
            document.getElementById('rcp-recv-brl').textContent = spec.recvBrl || 'R$ 0,00';
            document.getElementById('rcp-route').textContent = spec.route || 'Blockchain Direta';
            document.getElementById('rcp-fee').textContent = spec.fee || 'R$ 0,00 (Grátis)';
            document.getElementById('rcp-gas').textContent = spec.gas || '~R$ 0,02';
            document.getElementById('rcp-shield').textContent = spec.shield || '3.0 POL protegidos';

            const btnCancel = document.getElementById('btn-rcp-cancel');
            const btnConfirm = document.getElementById('btn-rcp-confirm');

            const cleanup = (result) => {
                closeModal('modal-receipt');
                btnCancel.onclick = null;
                btnConfirm.onclick = null;
                resolve(result);
            };

            btnCancel.onclick = () => cleanup(false);
            btnConfirm.onclick = () => cleanup(true);
            openModal('modal-receipt');
        });
    }

    // =========================================================================
    // CRIPTOGRAFIA AES-256-GCM + PBKDF2 & WEBAUTHN BIOMETRIA (INDEXEDDB)
    // =========================================================================
    function bufToB64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }

    function b64ToBuf(b64) {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    async function deriveAesKeyFromPassword(password, saltBytes) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            enc.encode(password),
            'PBKDF2',
            false,
            ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: saltBytes,
                iterations: 600000,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async function encryptWithAesKey(aesKey, plaintext) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(plaintext);
        const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded);
        return {
            iv: bufToB64(iv),
            cipher: bufToB64(cipherBuf)
        };
    }

    async function decryptWithAesKey(aesKey, ivB64, cipherB64) {
        const iv = b64ToBuf(ivB64);
        const cipher = b64ToBuf(cipherB64);
        const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipher);
        return new TextDecoder().decode(plainBuf);
    }

    // Armazenamento da chave de hardware não-exportável no IndexedDB
    function openBioKeyDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(BIO_DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                e.target.result.createObjectStore(BIO_STORE_NAME);
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function putBioDeviceKey(keyObj) {
        const db = await openBioKeyDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(BIO_STORE_NAME, 'readwrite');
            tx.objectStore(BIO_STORE_NAME).put(keyObj, 'active_bio_key');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function getBioDeviceKey() {
        const db = await openBioKeyDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(BIO_STORE_NAME, 'readonly');
            const req = tx.objectStore(BIO_STORE_NAME).get('active_bio_key');
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    function readStoredVault() {
        try {
            const raw = localStorage.getItem(VAULT_STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function writeStoredVault(vaultObj) {
        localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(vaultObj));
    }

    async function isPlatformBiometricsSupported() {
        if (!window.PublicKeyCredential || !window.isSecureContext) return false;
        try {
            return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        } catch (e) {
            return false;
        }
    }

    // Registra WebAuthn (Impressão Digital / FaceID / Windows Hello) e envelopa a seed
    async function enrollBiometricsForMnemonic(mnemonic, address) {
        const supported = await isPlatformBiometricsSupported();
        if (!supported) {
            throw new Error('Biometria nativa indisponível neste navegador (requer HTTPS/localhost e leitor biométrico ou Windows Hello).');
        }

        const rpId = window.location.hostname || 'localhost';
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const userId = new TextEncoder().encode(address.slice(0, 24));

        const credential = await navigator.credentials.create({
            publicKey: {
                challenge,
                rp: { name: 'RDESK SENTINEL', id: rpId },
                user: {
                    id: userId,
                    name: shortAddress(address),
                    displayName: `Carteira ${shortAddress(address)}`
                },
                pubKeyCredParams: [
                    { type: 'public-key', alg: -7 },   // ES256
                    { type: 'public-key', alg: -257 }  // RS256 (Windows Hello)
                ],
                authenticatorSelection: {
                    authenticatorAttachment: 'platform',
                    userVerification: 'required',
                    residentKey: 'preferred'
                },
                timeout: 60000
            }
        });

        if (!credential) {
            throw new Error('Registro biométrico cancelado pelo usuário.');
        }

        // Cria chave AES-256-GCM não-exportável vinculada a este dispositivo
        const deviceAesKey = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            false, // extractable: false -> JavaScript nunca consegue exportar os bytes da chave
            ['encrypt', 'decrypt']
        );

        await putBioDeviceKey(deviceAesKey);
        const wrapped = await encryptWithAesKey(deviceAesKey, mnemonic);

        const vault = readStoredVault();
        if (vault) {
            vault.biometric = {
                enabled: true,
                credentialId: bufToB64(credential.rawId),
                iv: wrapped.iv,
                cipher: wrapped.cipher
            };
            writeStoredVault(vault);
        }
    }

    // Desbloqueia usando Impressão Digital / Windows Hello
    async function unlockVaultWithBiometrics() {
        const vault = readStoredVault();
        if (!vault || !vault.biometric?.enabled) {
            throw new Error('Biometria ainda não ativada neste aparelho. Desbloqueie com sua senha e clique em "Ativar Biometria".');
        }

        const rpId = window.location.hostname || 'localhost';
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const credIdBytes = b64ToBuf(vault.biometric.credentialId);

        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge,
                rpId,
                allowCredentials: [{
                    type: 'public-key',
                    id: credIdBytes
                }],
                userVerification: 'required',
                timeout: 60000
            }
        });

        if (!assertion) {
            throw new Error('Verificação biométrica não concluída.');
        }

        const deviceAesKey = await getBioDeviceKey();
        if (!deviceAesKey) {
            throw new Error('Chave biométrica local não encontrada. Use sua senha para desbloquear e reativar.');
        }

        const mnemonic = await decryptWithAesKey(deviceAesKey, vault.biometric.iv, vault.biometric.cipher);
        const hdWallet = ethers.Wallet.fromMnemonic(mnemonic);

        walletState.mode = 'VAULT_UNLOCKED';
        walletState.address = hdWallet.address.toLowerCase();
        walletState.localWallet = hdWallet;
        walletState.injectedProvider = null;

        closeModal('modal-wallet');
        syncWalletUI();
        await refreshMultiChainBalances();
    }

    // Desbloqueia usando Senha / PIN
    async function unlockVaultWithPassword(password) {
        const vault = readStoredVault();
        if (!vault) {
            throw new Error('Nenhum cofre local encontrado. Crie ou importe uma carteira primeiro.');
        }
        const salt = b64ToBuf(vault.salt);
        const aesKey = await deriveAesKeyFromPassword(password, salt);
        const mnemonic = await decryptWithAesKey(aesKey, vault.iv, vault.cipher);
        const hdWallet = ethers.Wallet.fromMnemonic(mnemonic);

        walletState.mode = 'VAULT_UNLOCKED';
        walletState.address = hdWallet.address.toLowerCase();
        walletState.localWallet = hdWallet;
        walletState.injectedProvider = null;

        return { hdWallet, mnemonic };
    }

    function lockLocalVault() {
        const vault = readStoredVault();
        walletState.localWallet = null;
        if (vault && vault.address) {
            walletState.mode = 'VAULT_LOCKED';
            walletState.address = vault.address.toLowerCase();
        } else {
            walletState.mode = 'NONE';
            walletState.address = '';
        }
        syncWalletUI();
    }

    // =========================================================================
    // DESCOBERTA MULTI-CARTEIRA EIP-6963 (PRIORIZA RABBY WALLET)
    // =========================================================================
    function initEip6963Discovery() {
        window.addEventListener('eip6963:announceProvider', (event) => {
            const detail = event?.detail;
            if (!detail?.info || !detail?.provider) return;
            walletState.eip6963Providers.set(detail.info.rdns || detail.info.uuid, detail);
            renderDetectedWalletsList();
        });
        window.dispatchEvent(new Event('eip6963:requestProvider'));
    }

    function getBestRabbyOrInjectedProvider() {
        for (const [rdns, item] of walletState.eip6963Providers.entries()) {
            if (rdns === 'io.rabby' || /rabby/i.test(item.info.name)) {
                return { provider: item.provider, name: item.info.name || 'Rabby Wallet' };
            }
        }
        if (walletState.eip6963Providers.size > 0) {
            const first = Array.from(walletState.eip6963Providers.values())[0];
            return { provider: first.provider, name: first.info.name || 'Carteira Web3' };
        }
        if (window.ethereum?.providers && Array.isArray(window.ethereum.providers)) {
            const rabby = window.ethereum.providers.find(p => p.isRabby);
            if (rabby) return { provider: rabby, name: 'Rabby Wallet' };
            return { provider: window.ethereum.providers[0], name: 'Carteira Web3' };
        }
        if (window.ethereum) {
            return {
                provider: window.ethereum,
                name: window.ethereum.isRabby ? 'Rabby Wallet' : 'Carteira Web3'
            };
        }
        return null;
    }

    function renderDetectedWalletsList() {
        const container = document.getElementById('detected-wallets-list');
        if (!container) return;
        container.replaceChildren();

        if (walletState.eip6963Providers.size === 0 && !window.ethereum) {
            const note = document.createElement('div');
            note.className = 'muted-sm';
            note.style.marginTop = '6px';
            note.textContent = 'Nenhuma extensão injetada neste navegador. Se estiver no celular, copie o link abaixo e abra na aba DApps do app Rabby.';
            container.appendChild(note);
            return;
        }

        walletState.eip6963Providers.forEach((item) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'route-item';
            row.style.width = '100%';
            row.style.marginTop = '6px';
            row.style.cursor = 'pointer';

            const left = document.createElement('strong');
            left.textContent = `🔌 ${item.info.name}`;

            const right = document.createElement('span');
            right.className = 'kyc-badge free';
            right.textContent = 'Conectar';

            row.append(left, right);
            row.addEventListener('click', () => connectInjectedProvider(item.provider, item.info.name));
            container.appendChild(row);
        });
    }

    async function switchProviderChain(provider, chainId) {
        const chain = CHAINS[chainId];
        if (!chain || !provider) return;
        try {
            await provider.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: chain.hex }]
            });
        } catch (err) {
            if (err.code === 4902) {
                await provider.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: chain.hex,
                        chainName: `${chain.name} Mainnet`,
                        nativeCurrency: { name: chain.nativeSymbol, symbol: chain.nativeSymbol, decimals: 18 },
                        rpcUrls: [chain.rpcs[0]],
                        blockExplorerUrls: [chain.explorer]
                    }]
                });
            }
        }
    }

    async function connectInjectedProvider(specificProvider, labelName) {
        const found = specificProvider
            ? { provider: specificProvider, name: labelName || 'Carteira Web3' }
            : getBestRabbyOrInjectedProvider();

        if (!found) {
            // Mobile sem extensão: copia URL e avisa sem jogar na Play Store
            await navigator.clipboard.writeText(window.location.href).catch(() => {});
            alert('Link copiado! Abra o app Rabby Wallet no celular → toque na aba DApps / Navegador → cole o link.');
            return false;
        }

        try {
            const accounts = await found.provider.request({ method: 'eth_requestAccounts' });
            if (!accounts || !accounts[0]) return false;

            await switchProviderChain(found.provider, 137);

            walletState.mode = 'INJECTED';
            walletState.address = accounts[0].toLowerCase();
            walletState.localWallet = null;
            walletState.injectedProvider = found.provider;
            walletState.injectedName = found.name;

            found.provider.on?.('accountsChanged', (accs) => {
                if (accs && accs[0]) {
                    walletState.address = accs[0].toLowerCase();
                    syncWalletUI();
                    refreshMultiChainBalances();
                }
            });

            closeModal('modal-wallet');
            syncWalletUI();
            await refreshMultiChainBalances();
            return true;
        } catch (err) {
            console.error(err);
            return false;
        }
    }

    // =========================================================================
    // CRIAÇÃO E IMPORTAÇÃO DE COFRE BIP-39 (12 / 24 PALAVRAS)
    // =========================================================================
    function generateNewDraftMnemonic() {
        const count = Number(document.getElementById('create-words-count')?.value || 12);
        const entropyBytes = count === 24 ? 32 : 16;
        const mnemonic = ethers.utils.entropyToMnemonic(ethers.utils.randomBytes(entropyBytes));
        draftMnemonicWords = mnemonic.split(' ');

        const grid = document.getElementById('create-words-grid');
        if (grid) {
            grid.replaceChildren();
            draftMnemonicWords.forEach((word, idx) => {
                const chip = document.createElement('div');
                chip.className = 'word-chip';
                const num = document.createElement('span');
                num.textContent = `${idx + 1}.`;
                chip.append(num, document.createTextNode(word));
                grid.appendChild(chip);
            });
        }

        // Seleciona 3 índices aleatórios para confirmar que o usuário anotou
        const indices = new Set();
        while (indices.size < 3) {
            indices.add(Math.floor(Math.random() * draftMnemonicWords.length));
        }
        draftChallengeIndices = Array.from(indices).sort((a, b) => a - b);

        const chalBox = document.getElementById('verify-challenges-box');
        if (chalBox) {
            chalBox.replaceChildren();
            draftChallengeIndices.forEach((wordIdx) => {
                const row = document.createElement('div');
                row.className = 'challenge-row';

                const lbl = document.createElement('label');
                lbl.textContent = `Palavra #${wordIdx + 1}:`;

                const inp = document.createElement('input');
                inp.type = 'text';
                inp.className = 'field-input';
                inp.dataset.challengeIdx = String(wordIdx);
                inp.placeholder = `Digite a ${wordIdx + 1}ª palavra`;
                inp.autocomplete = 'off';
                inp.autocapitalize = 'none';

                row.append(lbl, inp);
                chalBox.appendChild(row);
            });
        }
    }

    async function saveNewEncryptedVault(mnemonic, password, enableBio) {
        const cleanMnemonic = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
        if (!ethers.utils.isValidMnemonic(cleanMnemonic)) {
            throw new Error('Frase de recuperação inválida. Verifique a ortografia e o número de palavras (12 ou 24).');
        }
        if (!password || password.length < 6) {
            throw new Error('Crie uma senha ou PIN com pelo menos 6 caracteres.');
        }

        const hdWallet = ethers.Wallet.fromMnemonic(cleanMnemonic);
        const address = hdWallet.address.toLowerCase();
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const aesKey = await deriveAesKeyFromPassword(password, salt);
        const encrypted = await encryptWithAesKey(aesKey, cleanMnemonic);

        writeStoredVault({
            version: 22,
            address,
            salt: bufToB64(salt),
            iv: encrypted.iv,
            cipher: encrypted.cipher,
            biometric: { enabled: false }
        });

        walletState.mode = 'VAULT_UNLOCKED';
        walletState.address = address;
        walletState.localWallet = hdWallet;
        walletState.injectedProvider = null;

        if (enableBio) {
            try {
                await enrollBiometricsForMnemonic(cleanMnemonic, address);
            } catch (bioErr) {
                console.warn('Biometria não ativada:', bioErr.message);
            }
        }

        closeModal('modal-wallet');
        syncWalletUI();
        await refreshMultiChainBalances();
    }

    // =========================================================================
    // COTAÇÕES AO VIVO & SALDOS MULTI-REDE
    // =========================================================================
    async function refreshMarketPrices() {
        try {
            const [fxRes, binanceRes] = await Promise.all([
                withTimeout(fetch('https://economia.awesomeapi.com.br/last/USD-BRL'), 4000).catch(() => null),
                withTimeout(fetch('https://api.binance.com/api/v3/ticker/price?symbols=["POLUSDT","ETHUSDT","BTCUSDT"]'), 4000).catch(() => null)
            ]);

            if (fxRes && fxRes.ok) {
                const fxJson = await fxRes.json();
                if (fxJson?.USDBRL?.bid) walletState.prices.USD_BRL = parseFloat(fxJson.USDBRL.bid);
            }

            if (binanceRes && binanceRes.ok) {
                const tickers = await binanceRes.json();
                if (Array.isArray(tickers)) {
                    tickers.forEach(t => {
                        if (t.symbol === 'POLUSDT') walletState.prices.POL = parseFloat(t.price);
                        if (t.symbol === 'ETHUSDT') walletState.prices.ETH = parseFloat(t.price);
                        if (t.symbol === 'BTCUSDT') walletState.prices.BTC = parseFloat(t.price);
                    });
                }
            }
        } catch (e) {}

        const oraclePill = document.getElementById('top-oracle-pill');
        if (oraclePill) {
            oraclePill.textContent = `Dólar: R$ ${walletState.prices.USD_BRL.toFixed(2).replace('.', ',')}`;
        }
    }

    function getUnitUsdPrice(priceKey) {
        if (priceKey === 'USD') return 1.0;
        if (priceKey === 'BRL') return 1.0 / (walletState.prices.USD_BRL || 5.65);
        return walletState.prices[priceKey] || 0;
    }

    async function getReadProviderForChain(chainId) {
        const chain = CHAINS[chainId] || CHAINS[137];
        for (const rpc of chain.rpcs) {
            try {
                const p = new ethers.providers.JsonRpcProvider(rpc);
                await withTimeout(p.getBlockNumber(), 3000);
                return p;
            } catch (e) {}
        }
        return new ethers.providers.JsonRpcProvider(chain.rpcs[0]);
    }

    async function refreshMultiChainBalances() {
        await refreshMarketPrices();

        if (!walletState.address || !ethers.utils.isAddress(walletState.address)) {
            walletState.balances = [];
            renderHeroAndAssets();
            return;
        }

        const addr = walletState.address;
        const erc20Abi = ['function balanceOf(address) view returns (uint256)'];
        const results = [];

        await Promise.all(Object.keys(CHAINS).map(async (chainIdStr) => {
            const chainId = Number(chainIdStr);
            const chain = CHAINS[chainId];
            const tokens = CHAIN_TOKENS[chainId] || [];

            try {
                const provider = await getReadProviderForChain(chainId);
                await Promise.all(tokens.map(async (tok) => {
                    try {
                        let rawBN;
                        if (tok.isNative) {
                            rawBN = await withTimeout(provider.getBalance(addr), 4000);
                        } else {
                            const c = new ethers.Contract(tok.address, erc20Abi, provider);
                            rawBN = await withTimeout(c.balanceOf(addr), 4000);
                        }
                        const amount = parseFloat(ethers.utils.formatUnits(rawBN, tok.decimals));
                        const unitUsd = getUnitUsdPrice(tok.priceKey);
                        const usdValue = amount * unitUsd;
                        const brlValue = usdValue * walletState.prices.USD_BRL;

                        results.push({
                            chainId,
                            chainName: chain.name,
                            symbol: tok.symbol,
                            name: tok.name,
                            decimals: tok.decimals,
                            address: tok.address || null,
                            isNative: Boolean(tok.isNative),
                            amount,
                            usdValue,
                            brlValue
                        });
                    } catch (e) {}
                }));
            } catch (e) {}
        }));

        walletState.balances = results.sort((a, b) => b.brlValue - a.brlValue);
        renderHeroAndAssets();
        updateSendAvailableDisplay();

        window.dispatchEvent(new CustomEvent('rdesk:wallet-updated', {
            detail: {
                address: walletState.address,
                mode: walletState.mode,
                balances: walletState.balances,
                prices: walletState.prices
            }
        }));
    }

    // =========================================================================
    // ATUALIZAÇÃO DA INTERFACE DA CARTEIRA (HERO + LISTA DE ATIVOS)
    // =========================================================================
    function syncWalletUI() {
        const vault = readStoredVault();
        const triggerBtn = document.getElementById('btn-wallet-trigger');
        const lockBtn = document.getElementById('btn-lock-vault');
        const lockedBar = document.getElementById('locked-vault-bar');
        const modeBadge = document.getElementById('wallet-mode-badge');
        const copyChip = document.getElementById('btn-copy-header-addr');
        const shortEl = document.getElementById('wallet-short-addr');

        if (walletState.mode === 'VAULT_LOCKED') {
            lockedBar.style.display = 'flex';
            lockBtn.style.display = 'none';
            triggerBtn.textContent = `🔒 ${shortAddress(walletState.address)}`;
            triggerBtn.classList.remove('connected');
            modeBadge.textContent = 'Cofre Local Bloqueado (Modo Leitura)';
            copyChip.style.display = 'inline-flex';
            shortEl.textContent = shortAddress(walletState.address);
        } else if (walletState.mode === 'VAULT_UNLOCKED') {
            lockedBar.style.display = 'none';
            lockBtn.style.display = 'inline-block';
            triggerBtn.textContent = `● ${shortAddress(walletState.address)}`;
            triggerBtn.classList.add('connected');
            const bioTag = vault?.biometric?.enabled ? ' + Biometria' : '';
            modeBadge.textContent = `Cofre Autocustódia Ativo${bioTag}`;
            copyChip.style.display = 'inline-flex';
            shortEl.textContent = shortAddress(walletState.address);
        } else if (walletState.mode === 'INJECTED') {
            lockedBar.style.display = 'none';
            lockBtn.style.display = 'none';
            triggerBtn.textContent = `● ${walletState.injectedName} ${shortAddress(walletState.address)}`;
            triggerBtn.classList.add('connected');
            modeBadge.textContent = `${walletState.injectedName} Conectada`;
            copyChip.style.display = 'inline-flex';
            shortEl.textContent = shortAddress(walletState.address);
        } else if (walletState.mode === 'WATCH_ONLY') {
            lockedBar.style.display = 'none';
            lockBtn.style.display = 'none';
            triggerBtn.textContent = `👁 ${shortAddress(walletState.address)}`;
            triggerBtn.classList.remove('connected');
            modeBadge.textContent = 'Modo Observação (Apenas Leitura)';
            copyChip.style.display = 'inline-flex';
            shortEl.textContent = shortAddress(walletState.address);
        } else {
            lockedBar.style.display = vault ? 'flex' : 'none';
            lockBtn.style.display = 'none';
            triggerBtn.textContent = 'Conectar / Criar Carteira';
            triggerBtn.classList.remove('connected');
            modeBadge.textContent = 'Nenhuma carteira ativa';
            copyChip.style.display = 'none';
        }

        renderHeroAndAssets();
    }

    function renderHeroAndAssets() {
        const freeUsd = walletState.balances.reduce((acc, b) => acc + b.usdValue, 0);
        const freeBrl = freeUsd * walletState.prices.USD_BRL;
        const lpUsd = walletState.lpUsdTotal || 0;
        const lpBrl = lpUsd * walletState.prices.USD_BRL;

        const totalUsd = freeUsd + lpUsd;
        const totalBrl = freeBrl + lpBrl;

        const heroBrlEl = document.getElementById('hero-total-brl');
        const heroUsdEl = document.getElementById('hero-total-usd');
        const heroBreakEl = document.getElementById('hero-breakdown');

        if (heroBrlEl) heroBrlEl.textContent = formatBRL(totalBrl);
        if (heroUsdEl) {
            heroUsdEl.textContent = `${formatUSD(totalUsd)} • Cotação Dólar: R$ ${walletState.prices.USD_BRL.toFixed(3).replace('.', ',')}`;
        }
        if (heroBreakEl) {
            heroBreakEl.textContent = `Livre na Carteira: ${formatBRL(freeBrl)}  •  Rendendo em Pools: ${formatBRL(lpBrl)}`;
        }

        const listEl = document.getElementById('wallet-assets-list');
        if (!listEl) return;
        listEl.replaceChildren();

        if (!walletState.address) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'Conecte ou crie sua carteira para visualizar seus saldos em Reais.';
            listEl.appendChild(empty);
            return;
        }

        const chainFilter = document.getElementById('wallet-chain-filter')?.value || 'ALL';
        const filtered = walletState.balances.filter(b => {
            if (chainFilter !== 'ALL' && String(b.chainId) !== chainFilter) return false;
            return b.amount > 0.00001 || (b.chainId === 137 && (b.symbol === 'POL' || b.symbol === 'USDT'));
        });

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'Nenhum saldo encontrado nesta rede. Use o botão "Receber" para depositar.';
            listEl.appendChild(empty);
            return;
        }

        filtered.forEach(item => {
            const row = document.createElement('div');
            row.className = 'asset-row';

            const left = document.createElement('div');
            left.className = 'asset-left';

            const icon = document.createElement('div');
            icon.className = 'asset-icon';
            icon.textContent = item.symbol.slice(0, 4);

            const info = document.createElement('div');
            info.className = 'asset-info';
            const title = document.createElement('strong');
            title.textContent = `${item.symbol} `;
            const sub = document.createElement('span');
            sub.textContent = `${item.name} • Rede ${item.chainName}`;
            info.append(title, sub);
            left.append(icon, info);

            const right = document.createElement('div');
            right.className = 'asset-right';
            const brlStrong = document.createElement('strong');
            brlStrong.textContent = formatBRL(item.brlValue);
            const qtySpan = document.createElement('span');
            qtySpan.textContent = `${item.amount.toFixed(4)} ${item.symbol}`;
            right.append(brlStrong, qtySpan);

            row.append(left, right);
            listEl.appendChild(row);
        });
    }

    // =========================================================================
    // RECEBER MOEDAS (QR CODE LOCAL + COPIAR + COMPARTILHAR)
    // =========================================================================
    function openReceiveModal() {
        const qrContainer = document.getElementById('receive-qrcode');
        const addrBox = document.getElementById('receive-full-address');
        qrContainer.replaceChildren();

        if (!walletState.address || !ethers.utils.isAddress(walletState.address)) {
            addrBox.textContent = 'Crie ou conecte sua carteira primeiro para gerar seu endereço.';
            openModal('modal-receive');
            return;
        }

        const checksumAddr = ethers.utils.getAddress(walletState.address);
        addrBox.textContent = checksumAddr;

        if (window.QRCode) {
            new QRCode(qrContainer, {
                text: checksumAddr,
                width: 180,
                height: 180,
                colorDark: '#090b10',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M
            });
        }
        openModal('modal-receive');
    }

    // =========================================================================
    // ENVIAR MOEDAS (VALIDAÇÃO, RESERVA DE GÁS & RECIBO EM REAIS)
    // =========================================================================
    function getAvailableBalanceForSend(chainId, symbol) {
        const found = walletState.balances.find(b => b.chainId === Number(chainId) && b.symbol === symbol);
        return found ? found.amount : 0;
    }

    function updateSendAvailableDisplay() {
        const chainId = Number(document.getElementById('send-chain-select')?.value || 137);
        const symbol = document.getElementById('send-token-select')?.value || 'USDT';
        const avail = getAvailableBalanceForSend(chainId, symbol);

        const availEl = document.getElementById('send-available-text');
        if (availEl) availEl.textContent = `Saldo: ${avail.toFixed(4)} ${symbol}`;

        const amt = parseFloat(document.getElementById('send-amount-input')?.value) || 0;
        const tokMeta = (CHAIN_TOKENS[chainId] || []).find(t => t.symbol === symbol);
        const unitUsd = tokMeta ? getUnitUsdPrice(tokMeta.priceKey) : 0;
        const brlVal = amt * unitUsd * walletState.prices.USD_BRL;

        const prevEl = document.getElementById('send-brl-preview');
        if (prevEl) prevEl.textContent = `Equivalente: ${formatBRL(brlVal)}`;
    }

    async function getActiveSignerForChain(chainId) {
        if (walletState.mode === 'VAULT_UNLOCKED' && walletState.localWallet) {
            const readProvider = await getReadProviderForChain(chainId);
            return walletState.localWallet.connect(readProvider);
        }
        if (walletState.mode === 'INJECTED' && walletState.injectedProvider) {
            await switchProviderChain(walletState.injectedProvider, chainId);
            const web3Provider = new ethers.providers.Web3Provider(walletState.injectedProvider);
            return web3Provider.getSigner();
        }
        if (walletState.mode === 'VAULT_LOCKED') {
            openModal('modal-wallet');
            throw new Error('Desbloqueie seu cofre com Biometria ou Senha antes de enviar.');
        }
        openModal('modal-wallet');
        throw new Error('Conecte a Rabby Wallet ou crie um cofre local para enviar.');
    }

    async function handleReviewAndExecuteSend() {
        const statusEl = document.getElementById('send-status-msg');
        statusEl.style.color = 'var(--accent)';
        statusEl.textContent = '';

        const chainId = Number(document.getElementById('send-chain-select').value);
        const symbol = document.getElementById('send-token-select').value;
        const toAddr = document.getElementById('send-recipient-input').value.trim();
        const amount = parseFloat(document.getElementById('send-amount-input').value);

        if (!ethers.utils.isAddress(toAddr)) {
            statusEl.style.color = 'var(--red)';
            statusEl.textContent = 'Endereço de destino inválido (deve começar com 0x...).';
            return;
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            statusEl.style.color = 'var(--red)';
            statusEl.textContent = 'Informe uma quantidade maior que zero.';
            return;
        }

        const chain = CHAINS[chainId];
        const tokMeta = (CHAIN_TOKENS[chainId] || []).find(t => t.symbol === symbol);
        if (!tokMeta) {
            statusEl.style.color = 'var(--red)';
            statusEl.textContent = `${symbol} não está configurado na rede ${chain.name}.`;
            return;
        }

        const avail = getAvailableBalanceForSend(chainId, symbol);
        if (amount > avail) {
            statusEl.style.color = 'var(--red)';
            statusEl.textContent = `Saldo insuficiente (${avail.toFixed(4)} ${symbol} disponíveis).`;
            return;
        }

        const unitUsd = getUnitUsdPrice(tokMeta.priceKey);
        const brlVal = amount * unitUsd * walletState.prices.USD_BRL;

        const confirmed = await requestHumanReceipt({
            title: `Confirmar Envio (${chain.name})`,
            sendVal: `${amount.toFixed(4)} ${symbol}`,
            sendBrl: formatBRL(brlVal),
            recvVal: `Para ${shortAddress(toAddr)}`,
            recvBrl: formatBRL(brlVal),
            route: `Transferência Direta • ${chain.name}`,
            fee: 'R$ 0,00 (Sem taxa do app)',
            gas: chainId === 137 ? '~R$ 0,02 (Polygon)' : 'Taxa padrão da rede',
            shield: chainId === 137 ? '3.0 POL protegidos' : 'Reserva de gás verificada'
        });

        if (!confirmed) return;

        try {
            const signer = await getActiveSignerForChain(chainId);
            const amountWei = ethers.utils.parseUnits(amount.toFixed(tokMeta.decimals), tokMeta.decimals);

            statusEl.textContent = 'Assinando e transmitindo envio para a blockchain...';

            let tx;
            if (tokMeta.isNative) {
                tx = await signer.sendTransaction({ to: toAddr, value: amountWei });
            } else {
                const erc20 = new ethers.Contract(
                    tokMeta.address,
                    ['function transfer(address to, uint256 value) returns (bool)'],
                    signer
                );
                tx = await erc20.transfer(toAddr, amountWei);
            }

            statusEl.textContent = `Enviado (${tx.hash.slice(0, 10)}...) Aguardando confirmação...`;
            await tx.wait();

            statusEl.style.color = 'var(--green-bright)';
            statusEl.textContent = `✓ Envio de ${amount} ${symbol} confirmado na rede ${chain.name}!`;
            document.getElementById('send-amount-input').value = '';
            await refreshMultiChainBalances();
        } catch (err) {
            statusEl.style.color = 'var(--red)';
            statusEl.textContent = err?.reason || err?.message || 'Envio cancelado.';
        }
    }

    // =========================================================================
    // VINCULAÇÃO DOS EVENTOS DA INTERFACE
    // =========================================================================
    function bindWalletEvents() {
        // Fechar modais
        document.querySelectorAll('[data-close-modal]').forEach(btn => {
            btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close-modal')));
        });
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay && overlay.id !== 'modal-receipt') {
                    overlay.style.display = 'none';
                }
            });
        });

        // Abrir modal de carteira
        document.getElementById('btn-wallet-trigger')?.addEventListener('click', () => {
            const vault = readStoredVault();
            const targetTab = vault ? 'unlock' : 'create';
            switchWalletModalTab(targetTab);
            openModal('modal-wallet');
        });

        // Bloquear cofre agora
        document.getElementById('btn-lock-vault')?.addEventListener('click', lockLocalVault);

        // Faixa de desbloqueio rápido
        document.getElementById('btn-quick-bio-unlock')?.addEventListener('click', async () => {
            try {
                await unlockVaultWithBiometrics();
            } catch (err) {
                alert(err.message);
            }
        });

        document.getElementById('btn-quick-pass-unlock')?.addEventListener('click', () => {
            switchWalletModalTab('unlock');
            openModal('modal-wallet');
            setTimeout(() => document.getElementById('unlock-password-input')?.focus(), 100);
        });

        // Abas internas do Modal de Carteira
        function switchWalletModalTab(tabName) {
            document.querySelectorAll('.wtab-btn').forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-wtab') === tabName);
            });
            document.querySelectorAll('.wpane').forEach(p => {
                p.classList.toggle('active', p.id === `wpane-${tabName}`);
                p.style.display = p.id === `wpane-${tabName}` ? 'flex' : 'none';
            });
            if (tabName === 'create' && draftMnemonicWords.length === 0) {
                generateNewDraftMnemonic();
            }
            if (tabName === 'external') {
                renderDetectedWalletsList();
            }
        }

        document.querySelectorAll('.wtab-btn').forEach(btn => {
            btn.addEventListener('click', () => switchWalletModalTab(btn.getAttribute('data-wtab')));
        });

        // Desbloqueio por Biometria dentro do modal
        document.getElementById('btn-unlock-with-bio')?.addEventListener('click', async () => {
            const errEl = document.getElementById('unlock-error-msg');
            errEl.textContent = '';
            try {
                await unlockVaultWithBiometrics();
            } catch (err) {
                errEl.textContent = err.message;
            }
        });

        // Ativar Biometria para cofre já existente
        document.getElementById('btn-enable-biometrics')?.addEventListener('click', async () => {
            const errEl = document.getElementById('unlock-error-msg');
            errEl.textContent = '';
            try {
                let mnemonic;
                let address = walletState.address;
                if (walletState.mode === 'VAULT_UNLOCKED' && walletState.localWallet) {
                    mnemonic = walletState.localWallet.mnemonic.phrase;
                } else {
                    const pass = document.getElementById('unlock-password-input').value;
                    if (!pass) throw new Error('Digite sua senha acima primeiro para vincular a biometria.');
                    const res = await unlockVaultWithPassword(pass);
                    mnemonic = res.mnemonic;
                    address = res.hdWallet.address.toLowerCase();
                }
                await enrollBiometricsForMnemonic(mnemonic, address);
                syncWalletUI();
                alert('✓ Biometria / Windows Hello ativada com sucesso neste aparelho!');
            } catch (err) {
                errEl.textContent = err.message;
            }
        });

        // Desbloqueio por Senha / PIN
        document.getElementById('btn-unlock-with-pass')?.addEventListener('click', async () => {
            const errEl = document.getElementById('unlock-error-msg');
            errEl.textContent = '';
            try {
                const pass = document.getElementById('unlock-password-input').value;
                await unlockVaultWithPassword(pass);
                document.getElementById('unlock-password-input').value = '';
                closeModal('modal-wallet');
                syncWalletUI();
                await refreshMultiChainBalances();
            } catch (err) {
                errEl.textContent = 'Senha incorreta ou cofre corrompido.';
            }
        });

        // Revelar palavras de backup
        document.getElementById('btn-reveal-backup-words')?.addEventListener('click', async () => {
            const outEl = document.getElementById('revealed-words-output');
            const pass = document.getElementById('reveal-pass-input').value;
            try {
                const res = await unlockVaultWithPassword(pass);
                outEl.style.display = 'block';
                outEl.textContent = res.mnemonic;
                document.getElementById('reveal-pass-input').value = '';
            } catch (err) {
                outEl.style.display = 'block';
                outEl.textContent = 'Senha incorreta.';
            }
        });

        // Criar Nova Carteira (12 / 24 palavras)
        document.getElementById('create-words-count')?.addEventListener('change', generateNewDraftMnemonic);
        document.getElementById('btn-new-mnemonic')?.addEventListener('click', generateNewDraftMnemonic);

        document.getElementById('btn-copy-mnemonic')?.addEventListener('click', async (e) => {
            if (draftMnemonicWords.length === 0) return;
            await navigator.clipboard.writeText(draftMnemonicWords.join(' ')).catch(() => {});
            e.target.textContent = '✓ Copiado! Limpando em 45s...';
            setTimeout(() => {
                navigator.clipboard.writeText('').catch(() => {});
                e.target.textContent = '📋 Copiar Palavras (Auto-limpa em 45s)';
            }, 45000);
        });

        document.getElementById('btn-confirm-create-vault')?.addEventListener('click', async () => {
            const errEl = document.getElementById('create-error-msg');
            errEl.textContent = '';
            try {
                const inputs = document.querySelectorAll('#verify-challenges-box input');
                for (const inp of inputs) {
                    const idx = Number(inp.dataset.challengeIdx);
                    const typed = inp.value.trim().toLowerCase();
                    if (typed !== draftMnemonicWords[idx]) {
                        throw new Error(`A palavra #${idx + 1} não confere com a frase gerada acima.`);
                    }
                }
                const p1 = document.getElementById('create-password-input').value;
                const p2 = document.getElementById('create-password-confirm').value;
                if (p1 !== p2) throw new Error('As duas senhas digitadas não são iguais.');

                const enableBio = document.getElementById('create-enable-bio-check').checked;
                await saveNewEncryptedVault(draftMnemonicWords.join(' '), p1, enableBio);
                draftMnemonicWords = [];
            } catch (err) {
                errEl.textContent = err.message;
            }
        });

        // Importar Seed existente
        document.getElementById('btn-confirm-import-vault')?.addEventListener('click', async () => {
            const errEl = document.getElementById('import-error-msg');
            errEl.textContent = '';
            try {
                const seed = document.getElementById('import-mnemonic-input').value;
                const pass = document.getElementById('import-password-input').value;
                const enableBio = document.getElementById('import-enable-bio-check').checked;
                await saveNewEncryptedVault(seed, pass, enableBio);
                document.getElementById('import-mnemonic-input').value = '';
                document.getElementById('import-password-input').value = '';
            } catch (err) {
                errEl.textContent = err.message;
            }
        });

        // Rabby Wallet (Desktop EIP-6963 & Mobile Assistido)
        document.getElementById('btn-connect-rabby-desktop')?.addEventListener('click', () => connectInjectedProvider());

        document.getElementById('btn-copy-rabby-mobile-url')?.addEventListener('click', async (e) => {
            await navigator.clipboard.writeText(window.location.href).catch(() => {});
            e.target.textContent = '✓ Link Copiado! Abra no app Rabby';
            setTimeout(() => {
                e.target.textContent = '📋 Copiar Link p/ Rabby Mobile';
            }, 3000);
        });

        // Modo Observação (0x...)
        document.getElementById('btn-activate-watch-only')?.addEventListener('click', async () => {
            const addr = document.getElementById('watch-address-input').value.trim();
            if (!ethers.utils.isAddress(addr)) {
                alert('Informe um endereço público válido (0x...).');
                return;
            }
            walletState.mode = 'WATCH_ONLY';
            walletState.address = addr.toLowerCase();
            walletState.localWallet = null;
            walletState.injectedProvider = null;
            closeModal('modal-wallet');
            syncWalletUI();
            await refreshMultiChainBalances();
        });

        // Copiar endereço no cabeçalho
        document.getElementById('btn-copy-header-addr')?.addEventListener('click', async () => {
            if (!walletState.address) return;
            await navigator.clipboard.writeText(ethers.utils.getAddress(walletState.address)).catch(() => {});
            const shortEl = document.getElementById('wallet-short-addr');
            shortEl.textContent = '✓ Copiado!';
            setTimeout(() => { shortEl.textContent = shortAddress(walletState.address); }, 1800);
        });

        // Filtro por rede na lista de moedas
        document.getElementById('wallet-chain-filter')?.addEventListener('change', renderHeroAndAssets);

        // Botões Receber & Enviar
        document.getElementById('btn-action-receive')?.addEventListener('click', openReceiveModal);

        document.getElementById('btn-copy-receive')?.addEventListener('click', async (e) => {
            if (!walletState.address) return;
            await navigator.clipboard.writeText(ethers.utils.getAddress(walletState.address)).catch(() => {});
            e.target.textContent = '✓ Endereço Copiado!';
            setTimeout(() => { e.target.textContent = '📋 Copiar Endereço'; }, 2200);
        });

        document.getElementById('btn-share-receive')?.addEventListener('click', async () => {
            if (!walletState.address) return;
            const addr = ethers.utils.getAddress(walletState.address);
            if (navigator.share) {
                await navigator.share({ title: 'Meu Endereço Cripto', text: addr }).catch(() => {});
            } else {
                await navigator.clipboard.writeText(addr).catch(() => {});
                alert('Endereço copiado: ' + addr);
            }
        });

        document.getElementById('btn-action-send')?.addEventListener('click', () => {
            if (!walletState.address) {
                openModal('modal-wallet');
                return;
            }
            document.getElementById('send-status-msg').textContent = '';
            updateSendAvailableDisplay();
            openModal('modal-send');
        });

        document.getElementById('send-chain-select')?.addEventListener('change', updateSendAvailableDisplay);
        document.getElementById('send-token-select')?.addEventListener('change', updateSendAvailableDisplay);
        document.getElementById('send-amount-input')?.addEventListener('input', updateSendAvailableDisplay);

        document.getElementById('btn-paste-recipient')?.addEventListener('click', async () => {
            try {
                const txt = await navigator.clipboard.readText();
                if (txt) document.getElementById('send-recipient-input').value = txt.trim();
            } catch (e) {
                alert('Cole o endereço manualmente no campo acima.');
            }
        });

        document.querySelectorAll('[data-pct]').forEach(btn => {
            btn.addEventListener('click', () => {
                const pct = parseFloat(btn.getAttribute('data-pct'));
                const chainId = Number(document.getElementById('send-chain-select').value);
                const symbol = document.getElementById('send-token-select').value;
                const avail = getAvailableBalanceForSend(chainId, symbol);

                let maxSendable = avail;
                if (symbol === 'POL') maxSendable = Math.max(0, avail - GAS_RESERVE_POL);
                else if (symbol === 'ETH') maxSendable = Math.max(0, avail - GAS_RESERVE_ETH);

                document.getElementById('send-amount-input').value = (maxSendable * pct).toFixed(4);
                updateSendAvailableDisplay();
            });
        });

        document.getElementById('btn-review-send')?.addEventListener('click', handleReviewAndExecuteSend);
    }

    // =========================================================================
    // INICIALIZAÇÃO & API GLOBAL PARA OS OUTROS MÓDULOS
    // =========================================================================
    window.RdeskWallet = {
        CHAINS,
        CHAIN_TOKENS,
        GAS_RESERVE_POL,
        getAddress: () => walletState.address,
        getMode: () => walletState.mode,
        getBalances: () => walletState.balances,
        getPrices: () => walletState.prices,
        getReadProvider: getReadProviderForChain,
        getSigner: getActiveSignerForChain,
        refreshBalances: refreshMultiChainBalances,
        setLpUsdTotal: (usd) => {
            walletState.lpUsdTotal = Number(usd) || 0;
            renderHeroAndAssets();
        },
        openWalletModal: () => openModal('modal-wallet'),
        formatBRL,
        formatUSD,
        shortAddress
    };

    window.RdeskReceipt = {
        confirm: requestHumanReceipt
    };

    document.addEventListener('DOMContentLoaded', async () => {
        initEip6963Discovery();
        bindWalletEvents();

        const stored = readStoredVault();
        if (stored && stored.address) {
            walletState.mode = 'VAULT_LOCKED';
            walletState.address = stored.address.toLowerCase();
        }
        syncWalletUI();
        await refreshMultiChainBalances();

        // Atualiza cotações e saldos a cada 25 segundos
        setInterval(refreshMultiChainBalances, 25000);
    });
})();
