(() => {
  'use strict';

  const STORAGE_KEY = 'rdesk_sentinel_wallets_v1';
  const ACTIVE_KEY = 'rdesk_sentinel_active_v1';
  const PBKDF2_ITERS = 150000;
  const CLIPBOARD_TTL_MS = 45000;
  const unlockedSigners = new Map();
  let clipboardTimer = null;

  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const fromB64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  const persistStorage = () => navigator.storage?.persist?.().catch(() => {});

  async function deriveAesKey(passphrase, saltBytes) {
    const baseKey = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptSecret(plaintext, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAesKey(passphrase, salt);
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)
    );
    return { v: 1, iter: PBKDF2_ITERS, salt: toB64(salt), iv: toB64(iv), ct: toB64(cipher) };
  }

  async function decryptSecret(payload, passphrase) {
    const key = await deriveAesKey(passphrase, fromB64(payload.salt));
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(payload.iv) }, key, fromB64(payload.ct)
    );
    return new TextDecoder().decode(plainBuf);
  }

  function loadStoredWallets() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveStoredWallets(wallets) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
    persistStorage();
  }

  const state = {
    wallets: loadStoredWallets(),
    activeWalletId: localStorage.getItem(ACTIVE_KEY) || null,
    unlockedWalletId: null,
    bioSupported: Boolean(window.PublicKeyCredential),
    balances: { POL: '0', WPOL: '0', USDT0: '0', USDC: '0', BRZ: '0', BRLA: '0' },
    prices: { usdBrl: 0, wpolUsd: 0, brzUsd: 0, brlaUsd: 0 },
    rpcUrl: '',
    rpcOnline: false,
    rabbyProvider: null
  };

  if (!state.activeWalletId && state.wallets.length > 0) {
    state.activeWalletId = state.wallets[0].id;
  }

  const emit = (detail = {}) => window.dispatchEvent(new CustomEvent('rdesk:stateChanged', { detail }));
  const getActiveWallet = () => state.wallets.find((w) => w.id === state.activeWalletId) || null;

  function setActiveWallet(id) {
    state.activeWalletId = id;
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
    emit({ type: 'walletChanged', walletId: id });
  }

  function generateMnemonic(wordCount = 12) {
    const bytes = Number(wordCount) === 24 ? 32 : 16;
    return ethers.utils.entropyToMnemonic(ethers.utils.randomBytes(bytes));
  }

  function createBackupChallenge(mnemonic) {
    const words = mnemonic.trim().split(/\s+/);
    const picked = new Set();
    while (picked.size < 3 && picked.size < words.length) {
      picked.add(Math.floor(Math.random() * words.length));
    }
    return Array.from(picked).sort((a, b) => a - b);
  }

  function verifyBackupChallenge(mnemonic, indices, answers) {
    const words = mnemonic.trim().split(/\s+/);
    return indices.every((wordIdx, pos) => {
      const expected = (words[wordIdx] || '').toLowerCase();
      return expected.length > 0 && expected === (answers[pos] || '').trim().toLowerCase();
    });
  }

  function parseSecretMaterial(secret, accountIndex = 0) {
    const clean = secret.trim().replace(/\s+/g, ' ');
    if (ethers.utils.isValidMnemonic(clean)) {
      const wallet = ethers.Wallet.fromMnemonic(clean, `m/44'/60'/0'/0/${accountIndex}`);
      return { wallet, hasSeed: true, cleanSecret: clean };
    }
    const hex = clean.startsWith('0x') ? clean : `0x${clean}`;
    if (/^0x[0-9a-fA-F]{64}$/.test(hex)) {
      return { wallet: new ethers.Wallet(hex), hasSeed: false, cleanSecret: hex };
    }
    throw new Error('Frase BIP-39 (12/24 palavras) ou chave privada 0x inválida.');
  }

  async function enrollBiometric() {
    if (!window.PublicKeyCredential) return null;
    try {
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'RDESK SENTINEL' },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'vault', displayName: 'RDESK' },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
          timeout: 60000
        }
      });
      if (!cred) return null;
      return { credId: toB64(cred.rawId), bioSecret: toB64(crypto.getRandomValues(new Uint8Array(32))) };
    } catch (_) {
      return null;
    }
  }

  async function verifyBiometricAssertion(credId) {
    if (!window.PublicKeyCredential || !credId) return false;
    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ id: fromB64(credId), type: 'public-key' }],
          userVerification: 'required',
          timeout: 60000
        }
      });
      return Boolean(assertion);
    } catch (_) {
      return false;
    }
  }

  async function saveVaultWallet({ secret, pin, label, accountIndex = 0, bioData = null }) {
    if (!pin || String(pin).trim().length < 6) {
      throw new Error('Defina um PIN com pelo menos 6 dígitos.');
    }
    const { wallet, hasSeed, cleanSecret } = parseSecretMaterial(secret, accountIndex);
    const vaultPayload = await encryptSecret(cleanSecret, String(pin).trim());
    const bioVaultPayload = bioData?.bioSecret ? await encryptSecret(cleanSecret, bioData.bioSecret) : null;
    const id = `vault_${wallet.address.toLowerCase()}_${accountIndex}`;
    const entry = {
      id,
      label: label || `Cofre #${accountIndex}`,
      address: wallet.address,
      type: 'vault',
      accountIndex,
      hasSeed,
      vaultPayload,
      bioCredId: bioData?.credId || null,
      bioSecret: bioData?.bioSecret || null,
      bioVaultPayload
    };
    state.wallets = [...state.wallets.filter((w) => w.id !== id), entry];
    saveStoredWallets(state.wallets);
    unlockedSigners.set(id, wallet);
    state.unlockedWalletId = id;
    setActiveWallet(id);
    return entry;
  }

  async function unlockWallet(walletId, { pin = '', useBio = false } = {}) {
    const entry = state.wallets.find((w) => w.id === walletId);
    if (!entry || entry.type !== 'vault') throw new Error('Carteira de cofre não encontrada.');
    let rawSecret = '';
    if (useBio && entry.bioCredId && entry.bioVaultPayload && entry.bioSecret) {
      const ok = await verifyBiometricAssertion(entry.bioCredId);
      if (!ok) throw new Error('Falha na biometria. Utilize seu PIN do cofre.');
      rawSecret = await decryptSecret(entry.bioVaultPayload, entry.bioSecret);
    } else {
      if (!pin) throw new Error('Informe o PIN do cofre.');
      try {
        rawSecret = await decryptSecret(entry.vaultPayload, String(pin).trim());
      } catch (_) {
        throw new Error('PIN incorreto.');
      }
    }
    const { wallet } = parseSecretMaterial(rawSecret, entry.accountIndex || 0);
    unlockedSigners.set(entry.id, wallet);
    state.unlockedWalletId = entry.id;
    emit({ type: 'vaultUnlocked', walletId: entry.id });
    return wallet;
  }

  async function deriveNextAccount(baseWalletId, pin) {
    const base = state.wallets.find((w) => w.id === baseWalletId);
    if (!base || !base.hasSeed) throw new Error('Carteira atual não possui frase-semente BIP-39.');
    const rawSeed = await decryptSecret(base.vaultPayload, String(pin).trim());
    const used = state.wallets.filter((w) => w.type === 'vault' && w.hasSeed).map((w) => Number(w.accountIndex || 0));
    const nextIdx = used.length ? Math.max(...used) + 1 : 1;
    const bioData = base.bioCredId ? { credId: base.bioCredId, bioSecret: base.bioSecret } : null;
    return saveVaultWallet({ secret: rawSeed, pin, label: `Conta #${nextIdx}`, accountIndex: nextIdx, bioData });
  }

  function addExternalWallet({ address, label, type = 'watch' }) {
    if (!ethers.utils.isAddress(address)) throw new Error('Endereço Polygon inválido.');
    const checksum = ethers.utils.getAddress(address);
    const id = `${type}_${checksum.toLowerCase()}`;
    const entry = {
      id,
      label: label || (type === 'rabby' ? 'Rabby Wallet' : 'Watch-Only'),
      address: checksum,
      type,
      accountIndex: 0,
      hasSeed: false
    };
    state.wallets = [...state.wallets.filter((w) => w.id !== id), entry];
    saveStoredWallets(state.wallets);
    setActiveWallet(id);
    return entry;
  }

  function removeWallet(id) {
    unlockedSigners.delete(id);
    state.wallets = state.wallets.filter((w) => w.id !== id);
    saveStoredWallets(state.wallets);
    if (state.unlockedWalletId === id) state.unlockedWalletId = null;
    if (state.activeWalletId === id) setActiveWallet(state.wallets[0]?.id || null);
    else emit({ type: 'walletRemoved', walletId: id });
  }

  function lockAll() {
    unlockedSigners.clear();
    state.unlockedWalletId = null;
    emit({ type: 'vaultLocked' });
  }

  async function getSigner(provider, auth = {}) {
    const active = getActiveWallet();
    if (!active) throw new Error('Nenhuma carteira selecionada.');
    if (active.type === 'watch') throw new Error('Carteira Watch-Only não pode assinar transações.');
    if (active.type === 'rabby') {
      if (!state.rabbyProvider) throw new Error('Rabby Wallet não conectada.');
      return new ethers.providers.Web3Provider(state.rabbyProvider).getSigner();
    }
    let signer = unlockedSigners.get(active.id);
    if (!signer || auth.pin || auth.useBio) signer = await unlockWallet(active.id, auth);
    return provider ? signer.connect(provider) : signer;
  }

  async function copySensitive(text) {
    if (!navigator.clipboard) throw new Error('Área de transferência indisponível.');
    await navigator.clipboard.writeText(text);
    if (clipboardTimer) clearTimeout(clipboardTimer);
    clipboardTimer = setTimeout(async () => {
      try { await navigator.clipboard.writeText(' '); } catch (_) {}
      emit({ type: 'clipboardCleared' });
    }, CLIPBOARD_TTL_MS);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }

  window.RdeskApp = Object.assign(window.RdeskApp || {}, {
    state,
    emit,
    getActiveWallet,
    setActiveWallet,
    getSigner,
    vault: {
      generateMnemonic,
      createBackupChallenge,
      verifyBackupChallenge,
      enrollBiometric,
      saveVaultWallet,
      unlockWallet,
      deriveNextAccount,
      addExternalWallet,
      removeWallet,
      lockAll,
      copySensitive,
      isUnlocked: (id) => unlockedSigners.has(id || state.activeWalletId)
    }
  });
})();
