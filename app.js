'use strict';

// =========================================================================
// 1. CONFIGURAÇÃO DE FUNDADOR, MONETIZAÇÃO & CONSTANTES DE REDE
// =========================================================================
const FOUNDER_ADDRESS = '0x2833a1C3dDe3B5d2265F057301a89bEf1BB50fe3';
const FOUNDER_WHITELIST = [FOUNDER_ADDRESS.toLowerCase()];
const PUBLIC_PLATFORM_FEE_BPS = 25; // 0.25% para usuários públicos; 0.00% automático para fundador

const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
const POLYGON_POOL_ADDRESS = '0x9b08288c3be4f62bbf8d1c20ac9c5e6f9467d8b7';
const POOL_FEE_TIER = 500;      // 0.05%
const POOL_TICK_SPACING = 10;   // Tick spacing oficial fee 500

const Q128 = ethers.BigNumber.from(2).pow(128);
const MAX_UINT256 = ethers.constants.MaxUint256;
const MAX_UINT128 = ethers.BigNumber.from('0xffffffffffffffffffffffffffffffff');

// 5 Melhores Redes Uniswap (Menor Gás + Maior Liquidez) com Multicall3 idêntico
const CHAINS = {
    137: {
        id: 137,
        name: 'Polygon',
        nativeSymbol: 'POL',
        rpcs: [
            'https://polygon-bor-rpc.publicnode.com',
            'https://polygon.drpc.org',
            'https://1rpc.io/matic'
        ],
        explorerApi: 'https://polygon.blockscout.com/api/v2',
        router02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        nfpm: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
        quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
        tokens: {
            POL:   { symbol: 'POL',   address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
            WPOL:  { symbol: 'WPOL',  address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', decimals: 18 },
            USDT0: { symbol: 'USDT0', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6  },
            BRZ:   { symbol: 'BRZ',   address: '0x4eD141110F6EeeAbA9A1df36d8c26f684d2475Dc', decimals: 18 },
            BRLA:  { symbol: 'BRLA',  address: '0xE6A537a407488807F0bbeb0038B79004f19DDDFb', decimals: 18 }
        }
    },
    8453: {
        id: 8453,
        name: 'Base',
        nativeSymbol: 'ETH',
        rpcs: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
        router02: '0x2626664c2603336E57B271c5C0b26F421741e481',
        nfpm: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
        quoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
        tokens: {
            ETH:  { symbol: 'ETH',  address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
            WETH: { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
            USDC: { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6  }
        }
    },
    42161: {
        id: 42161,
        name: 'Arbitrum',
        nativeSymbol: 'ETH',
        rpcs: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
        router02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        nfpm: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
        quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
        tokens: {
            ETH:  { symbol: 'ETH',  address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
            USDT: { symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6  },
            WBTC: { symbol: 'WBTC', address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', decimals: 8  }
        }
    },
    42220: {
        id: 42220,
        name: 'Celo',
        nativeSymbol: 'CELO',
        rpcs: ['https://forno.celo.org', 'https://celo-rpc.publicnode.com'],
        router02: '0x5615CDAb10dc425a742d643d949a7F474C01abc4',
        nfpm: '0x3d79EdAaBC0EaB6F08ED885C05Fc0B014290D95A',
        quoterV2: '0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8',
        tokens: {
            CELO:  { symbol: 'CELO',  address: '0x471EcE3750Da237f93B8E339c536989b8978a438', decimals: 18, isNative: true },
            cREAL: { symbol: 'cREAL', address: '0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787', decimals: 18 },
            cUSD:  { symbol: 'cUSD',  address: '0x765DE816845861e75A25fCA122bb6898B8B1282a', decimals: 18 },
            USDT:  { symbol: 'USDT',  address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', decimals: 6  }
        }
    },
    10: {
        id: 10,
        name: 'OP Mainnet',
        nativeSymbol: 'ETH',
        rpcs: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'],
        router02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        nfpm: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
        quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
        tokens: {
            ETH:  { symbol: 'ETH',  address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
            USDC: { symbol: 'USDC', address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6  }
        }
    }
};

// =========================================================================
// 2. ESTADO GLOBAL & TELEMETRIA EM TEMPO REAL
// =========================================================================
let state = {
    wallet: '',
    isFounder: false,
    displayCurrency: 'BRZ', // 'BRZ' | 'BRLA' | 'USD' | 'BRL'
    privacyHidden: false,
    notificationsEnabled: false,
    simulatorMode: 'my-balance', // 'my-balance' | 'sim-capital'
    riskProfile: 'sniper',       // 'escudo' | 'sniper' | 'turbo'
    customTargetBrlMin: null,
    onlyNoKycPix: false,
    monthlyGoalBrl: 150.0,
    webhookUrl: '',
    positions: [],
    allowances: [],
    forensics: {
        depositedUsd: 0,
        withdrawnUsd: 0,
        hodlBenchmarkUsd: 0,
        timeline: []
    }
};

let market = {
    polUsd: 0.087,
    ethUsd: 3100,
    btcUsd: 91000,
    celoUsd: 0.65,
    usdBrl: 5.65,
    usdtToBrz: 5.65,
    usdtToBrla: 5.65,
    binanceUsdtBrl: 5.64,
    atr15m: 0.0008,
    downWeight: 0.5,
    upWeight: 0.5,
    regimeText: 'SNIPER 50/50',
    poolActiveLiquidity: 0,
    poolFeesUsdPerMin: 1.40,
    dynamicGasReservePol: 0.85
};

let balances = {
    137: { POL: 0, WPOL: 0, USDT0: 0, BRZ: 0, BRLA: 0, totalUsd: 0 },
    8453: { ETH: 0, WETH: 0, USDC: 0, totalUsd: 0 },
    42161: { ETH: 0, USDT: 0, WBTC: 0, totalUsd: 0 },
    42220: { CELO: 0, cREAL: 0, cUSD: 0, USDT: 0, totalUsd: 0 },
    10: { ETH: 0, USDC: 0, totalUsd: 0 },
    poolsUsd: 0,
    unclaimedFeesUsd: 0
};

let sculptedPlan = {
    tickLower: 0,
    tickUpper: 0,
    pMin: 0,
    pMax: 0,
    baselineBrlMin: 0,
    projectedBrlMin: 0,
    survivalHours: 12,
    requiredCapitalUsd: 0,
    deployableUsd: 0,
    targetWpolShare: 0.5,
    targetUsdtShare: 0.5
};

let activeBridgeQuote = null;
let chart = null;
let candleSeries = null;
let previewLines = [];
let positionLines = [];
let currentTf = '15m';
let currentTfSec = 900;
let liveCandle = null;
let isBusyTx = false;
let lastAlertTag = '';
let vaultCryptoKey = null;

// =========================================================================
// 3. COFRE CRIPTOGRAFADO LOCAL (AES-GCM 256-BIT VIA WEB CRYPTO API)
// =========================================================================
async function deriveVaultKey(walletAddress) {
    const enc = new TextEncoder();
    const material = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(`RDESK-BITCOIN-GRADE-VAULT:${walletAddress.toLowerCase()}`),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    vaultCryptoKey = await window.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: enc.encode('RDESK-POLYGON-MULTICHAIN-SALT-V22'),
            iterations: 120000,
            hash: 'SHA-256'
        },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function saveEncryptedVault() {
    try {
        const sensitivePayload = JSON.stringify({
            monthlyGoalBrl: state.monthlyGoalBrl,
            webhookUrl: state.webhookUrl,
            forensics: state.forensics,
            displayCurrency: state.displayCurrency,
            riskProfile: state.riskProfile
        });

        let recordToStore = { plain: sensitivePayload };
        if (vaultCryptoKey) {
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const cipher = await window.crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                vaultCryptoKey,
                new TextEncoder().encode(sensitivePayload)
            );
            recordToStore = {
                iv: Array.from(iv),
                cipher: Array.from(new Uint8Array(cipher))
            };
        }

        const req = indexedDB.open('RDESK_CRYPTO_VAULT_V22', 1);
        req.onupgradeneeded = (e) => e.target.result.createObjectStore('vault');
        req.onsuccess = (e) => {
            const db = e.target.result;
            const tx = db.transaction('vault', 'readwrite');
            tx.objectStore('vault').put(recordToStore, state.wallet || 'default');
        };
    } catch (e) {}
}

async function loadEncryptedVault() {
    try {
        await new Promise((resolve) => {
            const req = indexedDB.open('RDESK_CRYPTO_VAULT_V22', 1);
            req.onupgradeneeded = (e) => e.target.result.createObjectStore('vault');
            req.onsuccess = (e) => {
                const db = e.target.result;
                const tx = db.transaction('vault', 'readonly');
                const getReq = tx.objectStore('vault').get(state.wallet || 'default');
                getReq.onsuccess = async () => {
                    const rec = getReq.result;
                    if (rec) {
                        try {
                            let jsonStr = rec.plain || null;
                            if (rec.iv && rec.cipher && vaultCryptoKey) {
                                const decrypted = await window.crypto.subtle.decrypt(
                                    { name: 'AES-GCM', iv: new Uint8Array(rec.iv) },
                                    vaultCryptoKey,
                                    new Uint8Array(rec.cipher)
                                );
                                jsonStr = new TextDecoder().decode(decrypted);
                            }
                            if (jsonStr) {
                                const parsed = JSON.parse(jsonStr);
                                if (Number.isFinite(parsed.monthlyGoalBrl)) state.monthlyGoalBrl = parsed.monthlyGoalBrl;
                                if (typeof parsed.webhookUrl === 'string') state.webhookUrl = parsed.webhookUrl;
                                if (parsed.forensics) state.forensics = parsed.forensics;
                                if (parsed.displayCurrency) state.displayCurrency = parsed.displayCurrency;
                                if (parsed.riskProfile) state.riskProfile = parsed.riskProfile;
                            }
                        } catch (decErr) {}
                    }
                    resolve();
                };
                getReq.onerror = () => resolve();
            };
            req.onerror = () => resolve();
        });
    } catch (e) {}
}

// =========================================================================
// 4. UTILITÁRIOS DE CONVERSÃO TRICAMBIAL & SEGURANÇA DE INPUTS
// =========================================================================
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Tempo limite RPC')), ms))
    ]);
}

function getPlatformFeeBps() {
    return state.isFounder ? 0 : PUBLIC_PLATFORM_FEE_BPS;
}

function formatInSelectedCurrency(usdAmount, includeCode = true) {
    const val = Number.isFinite(usdAmount) ? usdAmount : 0;
    const curr = state.displayCurrency;
    if (curr === 'USD') {
        return includeCode ? `$ ${val.toFixed(2)}` : val.toFixed(2);
    }
    if (curr === 'BRL') {
        const brl = val * market.usdBrl;
        return includeCode ? `R$ ${brl.toFixed(2)}` : brl.toFixed(2);
    }
    if (curr === 'BRLA') {
        const brla = val * market.usdtToBrla;
        return includeCode ? `${brla.toFixed(2)} BRLA` : brla.toFixed(2);
    }
    const brz = val * market.usdtToBrz;
    return includeCode ? `${brz.toFixed(2)} BRZ` : brz.toFixed(2);
}

function getActiveConversionRate() {
    if (state.displayCurrency === 'USD') return 1;
    if (state.displayCurrency === 'BRL') return market.usdBrl;
    if (state.displayCurrency === 'BRLA') return market.usdtToBrla;
    return market.usdtToBrz;
}

function triggerHaptic(pattern = [25]) {
    if (navigator.vibrate) {
        try { navigator.vibrate(pattern); } catch (e) {}
    }
}

function sendRangePushNotification(title, body, tag) {
    if (lastAlertTag === tag) return;
    lastAlertTag = tag;

    if (state.notificationsEnabled && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'SHOW_RANGE_ALERT',
            title,
            body,
            tag
        });
    }

    if (state.webhookUrl && state.webhookUrl.startsWith('https://')) {
        fetch(state.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source: 'RDESK_DEFI_SENTINEL',
                wallet: state.wallet,
                title,
                body,
                polPrice: market.polUsd,
                timestamp: new Date().toISOString()
            })
        }).catch(() => {});
    }
}

// =========================================================================
// 5. MOTOR MULTICALL3 ATÔMICO (< 300MS NAS 5 REDES UNISWAP)
// =========================================================================
const MULTICALL3_ABI = [
    "function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[])",
    "function getEthBalance(address addr) view returns (uint256 balance)"
];

const ERC20_IFACE = new ethers.utils.Interface([
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)"
]);

const POOL_IFACE = new ethers.utils.Interface([
    "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
    "function liquidity() view returns (uint128)",
    "function feeGrowthGlobal0X128() view returns (uint256)",
    "function feeGrowthGlobal1X128() view returns (uint256)",
    "function ticks(int24) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)"
]);

const NFPM_IFACE = new ethers.utils.Interface([
    "function balanceOf(address) view returns (uint256)",
    "function tokenOfOwnerByIndex(address, uint256) view returns (uint256)",
    "function positions(uint256) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)"
]);

async function getFastestProvider(chainId) {
    const chain = CHAINS[chainId];
    const racers = chain.rpcs.map(async (url) => {
        const provider = new ethers.providers.JsonRpcProvider(url);
        await provider.getBlockNumber();
        return provider;
    });
    return withTimeout(Promise.any(racers), 3200);
}

async function scanSingleChainMulticall(chainId, wallet) {
    const chain = CHAINS[chainId];
    const provider = await getFastestProvider(chainId);
    const mc = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
    const mcIface = new ethers.utils.Interface(MULTICALL3_ABI);

    const calls = [];
    // Call 0: Saldo Nativo
    calls.push({
        target: MULTICALL3_ADDRESS,
        callData: mcIface.encodeFunctionData('getEthBalance', [wallet])
    });

    // Calls 1..N: Saldos ERC20 da rede
    const erc20Tokens = Object.values(chain.tokens).filter((t) => !t.isNative || chainId === 42220);
    erc20Tokens.forEach((tok) => {
        calls.push({
            target: tok.address,
            callData: ERC20_IFACE.encodeFunctionData('balanceOf', [wallet])
        });
    });

    // Extras exclusivos da Polygon (Pool slot0, liquidity, feeGrowth, NFTs e Allowances)
    let polyExtraStart = calls.length;
    if (chainId === 137) {
        calls.push({ target: POLYGON_POOL_ADDRESS, callData: POOL_IFACE.encodeFunctionData('slot0', []) });
        calls.push({ target: POLYGON_POOL_ADDRESS, callData: POOL_IFACE.encodeFunctionData('liquidity', []) });
        calls.push({ target: POLYGON_POOL_ADDRESS, callData: POOL_IFACE.encodeFunctionData('feeGrowthGlobal0X128', []) });
        calls.push({ target: POLYGON_POOL_ADDRESS, callData: POOL_IFACE.encodeFunctionData('feeGrowthGlobal1X128', []) });
        calls.push({ target: chain.nfpm, callData: NFPM_IFACE.encodeFunctionData('balanceOf', [wallet]) });

        // Auditoria de permissões (Allowance Guard) nos tokens críticos
        const tokensToAudit = [chain.tokens.WPOL, chain.tokens.USDT0, chain.tokens.BRZ, chain.tokens.BRLA];
        const spendersToAudit = [
            { name: 'Uniswap SwapRouter02', address: chain.router02 },
            { name: 'Uniswap Position NFT', address: chain.nfpm }
        ];
        tokensToAudit.forEach((tok) => {
            spendersToAudit.forEach((sp) => {
                calls.push({
                    target: tok.address,
                    callData: ERC20_IFACE.encodeFunctionData('allowance', [wallet, sp.address])
                });
            });
        });
    }

    const results = await withTimeout(mc.callStatic.tryAggregate(false, calls), 4000);

    // Processa saldo nativo
    const nativeBal = results[0].success
        ? parseFloat(ethers.utils.formatUnits(mcIface.decodeFunctionResult('getEthBalance', results[0].returnData)[0], 18))
        : 0;

    const chainBal = { totalUsd: 0 };
    if (chain.nativeSymbol === 'POL') {
        chainBal.POL = nativeBal;
        chainBal.totalUsd += nativeBal * market.polUsd;
    } else if (chain.nativeSymbol === 'ETH') {
        chainBal.ETH = nativeBal;
        chainBal.totalUsd += nativeBal * market.ethUsd;
    }

    // Processa saldos ERC20
    erc20Tokens.forEach((tok, idx) => {
        const res = results[1 + idx];
        const amt = res && res.success
            ? parseFloat(ethers.utils.formatUnits(ERC20_IFACE.decodeFunctionResult('balanceOf', res.returnData)[0], tok.decimals))
            : 0;
        chainBal[tok.symbol] = amt;

        if (tok.symbol === 'WPOL') chainBal.totalUsd += amt * market.polUsd;
        else if (tok.symbol === 'WETH') chainBal.totalUsd += amt * market.ethUsd;
        else if (tok.symbol === 'WBTC') chainBal.totalUsd += amt * market.btcUsd;
        else if (tok.symbol === 'CELO') chainBal.totalUsd += amt * market.celoUsd;
        else if (tok.symbol === 'BRZ') chainBal.totalUsd += amt / market.usdtToBrz;
        else if (tok.symbol === 'BRLA') chainBal.totalUsd += amt / market.usdtToBrla;
        else if (tok.symbol === 'cREAL') chainBal.totalUsd += amt / market.usdBrl;
        else chainBal.totalUsd += amt; // USDT, USDT0, USDC, cUSD
    });

    balances[chainId] = chainBal;

    // Processa estado da Polygon Pool, NFTs e Allowances
    if (chainId === 137) {
        const slot0Res = results[polyExtraStart];
        const liqRes = results[polyExtraStart + 1];
        const fg0Res = results[polyExtraStart + 2];
        const fg1Res = results[polyExtraStart + 3];
        const nftBalRes = results[polyExtraStart + 4];

        let tickCurrent = 0;
        let fg0 = ethers.BigNumber.from(0);
        let fg1 = ethers.BigNumber.from(0);

        if (slot0Res && slot0Res.success) {
            const dec = POOL_IFACE.decodeFunctionResult('slot0', slot0Res.returnData);
            tickCurrent = Number(dec.tick);
            const onChainPol = Math.pow(1.0001, tickCurrent) * 1e12;
            if (onChainPol > 0) market.polUsd = onChainPol;
        }
        if (liqRes && liqRes.success) {
            const lBN = POOL_IFACE.decodeFunctionResult('liquidity', liqRes.returnData)[0];
            market.poolActiveLiquidity = parseFloat(lBN.toString());
        }
        if (fg0Res && fg0Res.success) fg0 = POOL_IFACE.decodeFunctionResult('feeGrowthGlobal0X128', fg0Res.returnData)[0];
        if (fg1Res && fg1Res.success) fg1 = POOL_IFACE.decodeFunctionResult('feeGrowthGlobal1X128', fg1Res.returnData)[0];

        // Lê Allowances
        const auditedAllowances = [];
        const tokensToAudit = [chain.tokens.WPOL, chain.tokens.USDT0, chain.tokens.BRZ, chain.tokens.BRLA];
        const spendersToAudit = [
            { name: 'Uniswap SwapRouter02', address: chain.router02 },
            { name: 'Uniswap Position NFT', address: chain.nfpm }
        ];
        let cursor = polyExtraStart + 5;
        tokensToAudit.forEach((tok) => {
            spendersToAudit.forEach((sp) => {
                const r = results[cursor++];
                if (r && r.success) {
                    const allowBN = ERC20_IFACE.decodeFunctionResult('allowance', r.returnData)[0];
                    if (allowBN.gt(0)) {
                        auditedAllowances.push({
                            tokenSymbol: tok.symbol,
                            tokenAddress: tok.address,
                            decimals: tok.decimals,
                            spenderName: sp.name,
                            spenderAddress: sp.address,
                            amountFormatted: allowBN.gt(ethers.utils.parseUnits('1000000000', tok.decimals))
                                ? 'ILIMITADA (RISCO)'
                                : parseFloat(ethers.utils.formatUnits(allowBN, tok.decimals)).toFixed(2)
                        });
                    }
                }
            });
        });
        state.allowances = auditedAllowances;

        // Lê NFTs em segundo Multicall caso o usuário possua posições
        const nftCount = nftBalRes && nftBalRes.success
            ? NFPM_IFACE.decodeFunctionResult('balanceOf', nftBalRes.returnData)[0].toNumber()
            : 0;

        if (nftCount > 0) {
            await fetchPolygonPositionsBatch(mc, chain.nfpm, wallet, nftCount, tickCurrent, fg0, fg1);
        } else {
            state.positions = [];
            balances.poolsUsd = 0;
            balances.unclaimedFeesUsd = 0;
        }

        // Reserva dinâmica de gás
        try {
            const feeData = await provider.getFeeData();
            const gwei = parseFloat(ethers.utils.formatUnits(feeData.gasPrice || ethers.utils.parseUnits('45', 'gwei'), 'gwei'));
            market.dynamicGasReservePol = Math.max(0.5, Math.min(2.5, (gwei * 950000 * 2.5) / 1e9));
        } catch (e) {}
    }
}

async function fetchPolygonPositionsBatch(mc, nfpmAddr, wallet, count, tickCurrent, fg0, fg1) {
    const idxCalls = [];
    for (let i = 0; i < Math.min(count, 15); i++) {
        idxCalls.push({
            target: nfpmAddr,
            callData: NFPM_IFACE.encodeFunctionData('tokenOfOwnerByIndex', [wallet, i])
        });
    }
    const idxRes = await mc.callStatic.tryAggregate(false, idxCalls);
    const tokenIds = idxRes
        .filter((r) => r.success)
        .map((r) => NFPM_IFACE.decodeFunctionResult('tokenOfOwnerByIndex', r.returnData)[0]);

    if (tokenIds.length === 0) return;

    const posCalls = tokenIds.map((id) => ({
        target: nfpmAddr,
        callData: NFPM_IFACE.encodeFunctionData('positions', [id])
    }));
    const posRes = await mc.callStatic.tryAggregate(false, posCalls);

    const wpolAddr = CHAINS[137].tokens.WPOL.address.toLowerCase();
    const usdtAddr = CHAINS[137].tokens.USDT0.address.toLowerCase();
    const activePositions = [];
    const tickSet = new Set();

    posRes.forEach((r, i) => {
        if (!r.success) return;
        const p = NFPM_IFACE.decodeFunctionResult('positions', r.returnData);
        const t0 = p.token0.toLowerCase();
        const t1 = p.token1.toLowerCase();
        if (((t0 === wpolAddr && t1 === usdtAddr) || (t1 === wpolAddr && t0 === usdtAddr)) && p.liquidity.gt(0)) {
            const tL = Number(p.tickLower);
            const tU = Number(p.tickUpper);
            tickSet.add(tL);
            tickSet.add(tU);
            const prices = ticksToHumanPrice(tL, tU, t0 === wpolAddr);
            activePositions.push({
                tokenId: tokenIds[i].toString(),
                min: prices.min,
                max: prices.max,
                tickLower: tL,
                tickUpper: tU,
                liquidity: p.liquidity.toString(),
                feeGrowthInside0LastX128: p.feeGrowthInside0LastX128.toString(),
                feeGrowthInside1LastX128: p.feeGrowthInside1LastX128.toString(),
                tokensOwed0: p.tokensOwed0.toString(),
                tokensOwed1: p.tokensOwed1.toString(),
                principalUsd: 0,
                feesUsd: 0
            });
        }
    });

    // Busca dados dos ticks únicos em um único batch
    const uniqueTicks = Array.from(tickSet);
    const ticksMap = {};
    if (uniqueTicks.length > 0) {
        const tickCalls = uniqueTicks.map((t) => ({
            target: POLYGON_POOL_ADDRESS,
            callData: POOL_IFACE.encodeFunctionData('ticks', [t])
        }));
        const tickRes = await mc.callStatic.tryAggregate(false, tickCalls);
        tickRes.forEach((r, idx) => {
            if (r.success) {
                const dec = POOL_IFACE.decodeFunctionResult('ticks', r.returnData);
                ticksMap[uniqueTicks[idx]] = {
                    feeGrowthOutside0X128: dec.feeGrowthOutside0X128,
                    feeGrowthOutside1X128: dec.feeGrowthOutside1X128
                };
            }
        });
    }

    let sumPrincipalUsd = 0;
    let sumFeesUsd = 0;

    activePositions.forEach((pos) => {
        const L = parseFloat(pos.liquidity);
        const sP = Math.sqrt(market.polUsd * 1e-12);
        const sA = Math.pow(1.0001, pos.tickLower / 2);
        const sB = Math.pow(1.0001, pos.tickUpper / 2);

        let raw0 = 0;
        let raw1 = 0;
        if (sP <= sA) raw0 = L * ((1 / sA) - (1 / sB));
        else if (sP >= sB) raw1 = L * (sB - sA);
        else {
            raw0 = L * ((1 / sP) - (1 / sB));
            raw1 = L * (sP - sA);
        }
        pos.principalUsd = ((raw0 / 1e18) * market.polUsd) + (raw1 / 1e6);
        pos.feesUsd = computePositionUnclaimedFeesUsd(pos, tickCurrent, fg0, fg1, ticksMap);

        sumPrincipalUsd += pos.principalUsd;
        sumFeesUsd += pos.feesUsd;
    });

    state.positions = activePositions;
    balances.poolsUsd = sumPrincipalUsd;
    balances.unclaimedFeesUsd = sumFeesUsd;
}

function subUint256(a, b) {
    return a.gte(b) ? a.sub(b) : MAX_UINT256.sub(b).add(a).add(1);
}

function computePositionUnclaimedFeesUsd(pos, tickCurrent, fg0, fg1, ticksMap) {
    try {
        const lower = ticksMap[pos.tickLower];
        const upper = ticksMap[pos.tickUpper];
        if (!lower || !upper) return 0;

        const below0 = tickCurrent >= pos.tickLower ? lower.feeGrowthOutside0X128 : subUint256(fg0, lower.feeGrowthOutside0X128);
        const below1 = tickCurrent >= pos.tickLower ? lower.feeGrowthOutside1X128 : subUint256(fg1, lower.feeGrowthOutside1X128);
        const above0 = tickCurrent < pos.tickUpper ? upper.feeGrowthOutside0X128 : subUint256(fg0, upper.feeGrowthOutside0X128);
        const above1 = tickCurrent < pos.tickUpper ? upper.feeGrowthOutside1X128 : subUint256(fg1, upper.feeGrowthOutside1X128);

        const inside0 = subUint256(subUint256(fg0, below0), above0);
        const inside1 = subUint256(subUint256(fg1, below1), above1);

        const liq = ethers.BigNumber.from(pos.liquidity);
        const d0 = subUint256(inside0, ethers.BigNumber.from(pos.feeGrowthInside0LastX128)).mul(liq).div(Q128);
        const d1 = subUint256(inside1, ethers.BigNumber.from(pos.feeGrowthInside1LastX128)).mul(liq).div(Q128);

        const tot0 = parseFloat(ethers.utils.formatUnits(ethers.BigNumber.from(pos.tokensOwed0).add(d0), 18));
        const tot1 = parseFloat(ethers.utils.formatUnits(ethers.BigNumber.from(pos.tokensOwed1).add(d1), 6));
        return Math.max(0, (tot0 * market.polUsd) + tot1);
    } catch (e) {
        return 0;
    }
}

async function syncAllChainsNow() {
    if (!state.wallet || !ethers.utils.isAddress(state.wallet)) return;
    const t0 = performance.now();
    const latEl = document.getElementById('rpc-latency-tag');
    if (latEl) latEl.textContent = 'LENDO...';

    const chainIds = [137, 8453, 42161, 42220, 10];
    await Promise.allSettled(chainIds.map((id) => scanSingleChainMulticall(id, state.wallet)));

    const elapsed = Math.round(performance.now() - t0);
    if (latEl) latEl.textContent = `${elapsed}ms (5 REDES)`;

    recomputeSculptor();
    renderAllViews();
}

// =========================================================================
// 6. AUDITORIA FORENSE DIA 1 & MINI-GRÁFICO DA VERDADE
// =========================================================================
async function runDayOneForensics() {
    if (!state.wallet) return;
    try {
        const res = await withTimeout(
            fetch(`https://polygon.blockscout.com/api/v2/addresses/${state.wallet}/token-transfers?type=ERC-20`),
            6000
        );
        const json = await res.json();
        const items = Array.isArray(json?.items) ? json.items : [];
        if (items.length === 0) {
            renderTruthChart();
            return;
        }

        const ignoredContracts = new Set([
            CHAINS[137].router02.toLowerCase(),
            CHAINS[137].nfpm.toLowerCase(),
            POLYGON_POOL_ADDRESS.toLowerCase(),
            '0x0000000000000000000000000000000000000000'
        ]);

        let netDepositedUsd = 0;
        let netWithdrawnUsd = 0;
        let hodlPolQty = 0;
        let hodlStableUsd = 0;
        const timeline = [];

        const ordered = items.slice().reverse();
        ordered.forEach((tx) => {
            const from = (tx.from?.hash || '').toLowerCase();
            const to = (tx.to?.hash || '').toLowerCase();
            const sym = (tx.token?.symbol || '').toUpperCase();
            const dec = parseInt(tx.token?.decimals || '18', 10);
            const rawVal = parseFloat(tx.total?.value || '0') / Math.pow(10, dec);
            if (!Number.isFinite(rawVal) || rawVal <= 0) return;

            let usdVal = 0;
            if (sym.includes('USDT') || sym.includes('USDC')) usdVal = rawVal;
            else if (sym === 'BRZ' || sym === 'BRLA') usdVal = rawVal / market.usdBrl;
            else if (sym === 'POL' || sym === 'WPOL' || sym === 'MATIC') usdVal = rawVal * market.polUsd;
            else return;

            // Ignora movimentações internas entre sua carteira e contratos Uniswap
            if (ignoredContracts.has(from) || ignoredContracts.has(to)) return;

            if (to === state.wallet) {
                netDepositedUsd += usdVal;
                if (sym === 'POL' || sym === 'WPOL') hodlPolQty += rawVal;
                else hodlStableUsd += usdVal;
            } else if (from === state.wallet) {
                netWithdrawnUsd += usdVal;
                if (sym === 'POL' || sym === 'WPOL') hodlPolQty = Math.max(0, hodlPolQty - rawVal);
                else hodlStableUsd = Math.max(0, hodlStableUsd - usdVal);
            }

            const netCap = Math.max(0, netDepositedUsd - netWithdrawnUsd);
            timeline.push({
                ts: tx.timestamp || '',
                investedUsd: netCap,
                hodlUsd: (hodlPolQty * market.polUsd) + hodlStableUsd
            });
        });

        state.forensics = {
            depositedUsd: netDepositedUsd,
            withdrawnUsd: netWithdrawnUsd,
            hodlBenchmarkUsd: (hodlPolQty * market.polUsd) + hodlStableUsd,
            timeline: timeline.slice(-30)
        };
        await saveEncryptedVault();
        renderAllViews();
    } catch (e) {
        renderTruthChart();
    }
}

function getTotalWealthUsd() {
    const walletLiquid =
        (balances[137]?.totalUsd || 0) +
        (balances[8453]?.totalUsd || 0) +
        (balances[42161]?.totalUsd || 0) +
        (balances[42220]?.totalUsd || 0) +
        (balances[10]?.totalUsd || 0);
    return walletLiquid + balances.poolsUsd + balances.unclaimedFeesUsd;
}

function renderTruthChart() {
    const container = document.getElementById('truth-chart-canvas');
    if (!container) return;
    container.replaceChildren();

    const width = container.clientWidth || 320;
    const height = 135;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.width = '100%';
    svg.style.height = '100%';

    const currentWealth = getTotalWealthUsd();
    const netInvested = Math.max(0, state.forensics.depositedUsd - state.forensics.withdrawnUsd);
    const hodlVal = state.forensics.hodlBenchmarkUsd > 0 ? state.forensics.hodlBenchmarkUsd : netInvested;

    const pts = state.forensics.timeline.length >= 2
        ? state.forensics.timeline.map((item, idx, arr) => {
            const progress = idx / (arr.length - 1);
            const interpWealth = item.investedUsd + (currentWealth - netInvested) * progress;
            return {
                invested: item.investedUsd,
                hodl: item.hodlUsd,
                wealth: Math.max(0, interpWealth)
            };
        })
        : [
            { invested: netInvested || currentWealth, hodl: netInvested || currentWealth, wealth: netInvested || currentWealth },
            { invested: netInvested || currentWealth, hodl: hodlVal || currentWealth, wealth: currentWealth }
        ];

    const allVals = pts.flatMap((p) => [p.invested, p.hodl, p.wealth]);
    const maxV = Math.max(...allVals, 1) * 1.08;
    const minV = Math.max(0, Math.min(...allVals) * 0.92);
    const span = Math.max(0.01, maxV - minV);

    const toCoords = (selector) => pts.map((p, i) => {
        const x = 10 + (i / Math.max(1, pts.length - 1)) * (width - 20);
        const y = (height - 14) - (((p[selector] - minV) / span) * (height - 28));
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const makePolyline = (pointsStr, color, dash = '') => {
        const pl = document.createElementNS(svgNS, 'polyline');
        pl.setAttribute('fill', 'none');
        pl.setAttribute('stroke', color);
        pl.setAttribute('stroke-width', '2.2');
        if (dash) pl.setAttribute('stroke-dasharray', dash);
        pl.setAttribute('points', pointsStr);
        return pl;
    };

    svg.appendChild(makePolyline(toCoords('invested'), '#E5E7EB', '4,4'));
    svg.appendChild(makePolyline(toCoords('hodl'), '#CDA434'));
    svg.appendChild(makePolyline(toCoords('wealth'), '#10B981'));
    container.appendChild(svg);

    const verdictEl = document.getElementById('truth-verdict-text');
    if (verdictEl) {
        const realProfitUsd = currentWealth - netInvested;
        const vsHodlUsd = currentWealth - hodlVal;
        if (netInvested <= 0 && currentWealth <= 0) {
            verdictEl.textContent = 'Conecte sua carteira para comparar seu patrimônio real contra os depósitos desde o Dia 1.';
        } else if (realProfitUsd >= 0 && vsHodlUsd >= 0) {
            verdictEl.textContent = `Lucro genuíno: seu saldo está ${formatInSelectedCurrency(realProfitUsd)} acima do valor tirado do bolso e ${formatInSelectedCurrency(vsHodlUsd)} acima do HODL.`;
        } else if (realProfitUsd >= 0 && vsHodlUsd < 0) {
            verdictEl.textContent = `Saldo positivo (+${formatInSelectedCurrency(realProfitUsd)}), porém o HODL renderia ${formatInSelectedCurrency(Math.abs(vsHodlUsd))} a mais devido ao Impermanent Loss.`;
        } else {
            verdictEl.textContent = `Atenção: embora as taxas subam, seu patrimônio está ${formatInSelectedCurrency(Math.abs(realProfitUsd))} abaixo do capital investido pela queda do ativo.`;
        }
    }
}

// =========================================================================
// 7. MOTOR DE ESTRATÉGIAS & SIMULADOR DUPLO (R$/MIN ↔ CAPITAL NECESSÁRIO)
// =========================================================================
function humanPriceToAlignedTick(humanPrice, isToken0Pol, roundUp) {
    const rawPrice = isToken0Pol ? (humanPrice * 1e-12) : ((1 / humanPrice) * 1e12);
    const exactTick = Math.log(rawPrice) / Math.log(1.0001);
    const aligned = roundUp
        ? Math.ceil(exactTick / POOL_TICK_SPACING) * POOL_TICK_SPACING
        : Math.floor(exactTick / POOL_TICK_SPACING) * POOL_TICK_SPACING;
    return Math.max(-887270, Math.min(887270, aligned));
}

function ticksToHumanPrice(tickLower, tickUpper, isToken0Pol) {
    if (isToken0Pol) {
        return {
            min: Math.pow(1.0001, Number(tickLower)) * 1e12,
            max: Math.pow(1.0001, Number(tickUpper)) * 1e12
        };
    }
    return {
        min: 1 / (Math.pow(1.0001, Number(tickUpper)) * 1e12),
        max: 1 / (Math.pow(1.0001, Number(tickLower)) * 1e12)
    };
}

function estimateUserRawLiquidity(capitalUsd, price, pMin, pMax) {
    if (capitalUsd <= 0 || price <= 0 || pMin >= pMax) return 0;
    const clampedP = Math.max(pMin * 1.00001, Math.min(pMax * 0.99999, price));
    const sqrtP = Math.sqrt(clampedP);
    const sqrtA = Math.sqrt(pMin);
    const sqrtB = Math.sqrt(pMax);
    const denom = (2 * sqrtP) - (clampedP / sqrtB) - sqrtA;
    if (denom <= 1e-12) return 0;
    return (capitalUsd * 1e12) / denom;
}

function estimateBrlPerMin(capitalUsd, price, pMin, pMax) {
    const userL = estimateUserRawLiquidity(capitalUsd, price, pMin, pMax);
    if (userL <= 0) return 0;
    const poolL = market.poolActiveLiquidity > 0 ? market.poolActiveLiquidity : Math.max(userL * 80, 1e18);
    const share = userL / (poolL + userL);
    return market.poolFeesUsdPerMin * share * market.usdBrl;
}

function computeRequiredCapitalUsdForTarget(targetBrlPerMin, price, pMin, pMax) {
    const maxPoolBrlMin = market.poolFeesUsdPerMin * market.usdBrl;
    if (targetBrlPerMin <= 0 || targetBrlPerMin >= maxPoolBrlMin * 0.95) return Infinity;
    const poolL = market.poolActiveLiquidity > 0 ? market.poolActiveLiquidity : 1e19;
    const reqUserL = (poolL * targetBrlPerMin) / (maxPoolBrlMin - targetBrlPerMin);
    const sqrtP = Math.sqrt(price);
    const sqrtA = Math.sqrt(pMin);
    const sqrtB = Math.sqrt(pMax);
    const factor = (2 * sqrtP) - (price / sqrtB) - sqrtA;
    return Math.max(0, (reqUserL / 1e12) * factor);
}

function computeDeployablePolygonUsd() {
    const b = balances[137];
    const usablePol = Math.max(0, (b.POL || 0) - market.dynamicGasReservePol);
    return (usablePol * market.polUsd) +
        ((b.WPOL || 0) * market.polUsd) +
        (b.USDT0 || 0) +
        ((b.BRZ || 0) / market.usdtToBrz) +
        ((b.BRLA || 0) / market.usdtToBrla);
}

function recomputeSculptor() {
    const price = market.polUsd > 0 ? market.polUsd : 0.087;
    const atr = market.atr15m > 0 ? market.atr15m : price * 0.009;
    const deployableUsd = computeDeployablePolygonUsd();

    const multMap = { escudo: 4.5, sniper: 2.5, turbo: 1.15 };
    const profileMult = multMap[state.riskProfile] || 2.5;
    const baseSpan = atr * profileMult;

    let pMin = Math.max(price * 0.1, price - (baseSpan * market.downWeight));
    let pMax = price + (baseSpan * market.upWeight);

    let tickLower = humanPriceToAlignedTick(pMin, true, false);
    let tickUpper = humanPriceToAlignedTick(pMax, true, true);
    if (tickUpper - tickLower < POOL_TICK_SPACING * 2) {
        const center = humanPriceToAlignedTick(price, true, false);
        tickLower = center - POOL_TICK_SPACING;
        tickUpper = center + POOL_TICK_SPACING;
    }

    let aligned = ticksToHumanPrice(tickLower, tickUpper, true);
    pMin = aligned.min;
    pMax = aligned.max;

    const baselineBrlMin = estimateBrlPerMin(Math.max(deployableUsd, 50), price, pMin, pMax);
    const actualBaselineBrlMin = estimateBrlPerMin(deployableUsd, price, pMin, pMax);
    let projectedBrlMin = actualBaselineBrlMin;
    let requiredCapitalUsd = deployableUsd;

    if (state.simulatorMode === 'sim-capital') {
        const target = state.customTargetBrlMin && state.customTargetBrlMin > 0
            ? state.customTargetBrlMin
            : Math.max(0.01, baselineBrlMin);
        requiredCapitalUsd = computeRequiredCapitalUsdForTarget(target, price, pMin, pMax);
        projectedBrlMin = target;
    } else if (state.customTargetBrlMin && state.customTargetBrlMin > 0 && deployableUsd > 0) {
        let lowSpan = price * 0.002;
        let highSpan = price * 0.65;
        for (let i = 0; i < 30; i++) {
            const mid = (lowSpan + highSpan) / 2;
            const cMin = Math.max(price * 0.1, price - (mid * market.downWeight));
            const cMax = price + (mid * market.upWeight);
            const est = estimateBrlPerMin(deployableUsd, price, cMin, cMax);
            if (est > state.customTargetBrlMin) lowSpan = mid;
            else highSpan = mid;
        }
        const finalSpan = (lowSpan + highSpan) / 2;
        tickLower = humanPriceToAlignedTick(Math.max(price * 0.1, price - (finalSpan * market.downWeight)), true, false);
        tickUpper = humanPriceToAlignedTick(price + (finalSpan * market.upWeight), true, true);
        if (tickUpper - tickLower < POOL_TICK_SPACING * 2) {
            const c = humanPriceToAlignedTick(price, true, false);
            tickLower = c - POOL_TICK_SPACING;
            tickUpper = c + POOL_TICK_SPACING;
        }
        aligned = ticksToHumanPrice(tickLower, tickUpper, true);
        pMin = aligned.min;
        pMax = aligned.max;
        projectedBrlMin = estimateBrlPerMin(deployableUsd, price, pMin, pMax);
    }

    const halfWidth = (pMax - pMin) / 2;
    const survivalHours = Math.max(0.2, Math.pow(halfWidth / Math.max(atr, 1e-6), 2) * 0.25);

    const sqrtP = Math.sqrt(price);
    const sqrtA = Math.sqrt(pMin);
    const sqrtB = Math.sqrt(pMax);
    const amt0Val = ((1 / sqrtP) - (1 / sqrtB)) * price;
    const amt1Val = sqrtP - sqrtA;
    const targetUsdtShare = Math.max(0, Math.min(1, amt1Val / Math.max(1e-9, amt0Val + amt1Val)));

    sculptedPlan = {
        tickLower,
        tickUpper,
        pMin,
        pMax,
        baselineBrlMin: actualBaselineBrlMin,
        projectedBrlMin,
        survivalHours,
        requiredCapitalUsd,
        deployableUsd,
        targetWpolShare: 1 - targetUsdtShare,
        targetUsdtShare
    };

    updateMotorUI();
}

function updateMotorUI() {
    const price = market.polUsd;
    const { pMin, pMax, baselineBrlMin, projectedBrlMin, survivalHours, requiredCapitalUsd } = sculptedPlan;
    const widthPct = pMin > 0 ? (((pMax - pMin) / pMin) * 100).toFixed(2) : '0.00';

    const baseLbl = document.getElementById('lbl-baseline-rate');
    if (baseLbl) baseLbl.textContent = `Seu saldo: R$ ${baselineBrlMin.toFixed(4)}/min`;

    const pisoEl = document.getElementById('sculpt-piso');
    const tetoEl = document.getElementById('sculpt-teto');
    const widthEl = document.getElementById('sculpt-width');
    const survEl = document.getElementById('sculpt-survival');
    const hourEl = document.getElementById('sculpt-projected-hour');
    const cursorEl = document.getElementById('sculpt-cursor');
    const revBanner = document.getElementById('reverse-capital-banner');
    const revCapEl = document.getElementById('reverse-req-capital');

    if (pisoEl) pisoEl.textContent = `PISO: ${pMin.toFixed(5)}`;
    if (tetoEl) tetoEl.textContent = `TETO: ${pMax.toFixed(5)}`;
    if (widthEl) widthEl.textContent = `Largura ${widthPct}%`;

    if (survEl) {
        const timeStr = survivalHours >= 24
            ? `~${(survivalHours / 24).toFixed(1)} dias dentro`
            : `~${survivalHours.toFixed(1)}h dentro`;
        survEl.textContent = `Duração est.: ${timeStr}`;
        survEl.style.color = survivalHours < 1.5 ? 'var(--coral)' : (survivalHours < 5 ? 'var(--amber)' : 'var(--emerald)');
    }

    if (hourEl) hourEl.textContent = `~R$ ${(projectedBrlMin * 60).toFixed(2)} / hora`;

    if (cursorEl && pMax > pMin) {
        const pct = Math.max(5, Math.min(95, ((price - pMin) / (pMax - pMin)) * 100));
        cursorEl.style.left = `${pct.toFixed(1)}%`;
    }

    if (revBanner && revCapEl) {
        if (state.simulatorMode === 'sim-capital') {
            revBanner.style.display = 'block';
            revCapEl.textContent = Number.isFinite(requiredCapitalUsd)
                ? formatInSelectedCurrency(requiredCapitalUsd)
                : 'Acima do teto da pool';
        } else {
            revBanner.style.display = 'none';
        }
    }

    updateChartRangeLines();
}

// =========================================================================
// 8. EXECUÇÃO ON-CHAIN UNISWAP V3 (COM PROTEÇÃO DE NÍVEL BITCOIN)
// =========================================================================
async function ensureExactApproval(tokenAddress, spender, amountWei, signer, logFn) {
    const erc20 = new ethers.Contract(tokenAddress, [
        "function allowance(address, address) view returns (uint256)",
        "function approve(address spender, uint256 amount) returns (bool)"
    ], signer);
    const current = await erc20.allowance(state.wallet, spender);
    if (current.lt(amountWei)) {
        if (logFn) logFn('Assine na carteira: aprovação exata (zero permissão ilimitada)...');
        // Nunca aprova MAX_UINT256: aprova estritamente o valor exato da operação
        const tx = await erc20.approve(spender, amountWei);
        await tx.wait();
    }
}

async function executeAutoPilotStrategy() {
    if (isBusyTx) return;
    if (!state.wallet) {
        await connectWallet();
        return;
    }

    const logEl = document.getElementById('autopilot-exec-log');
    const btn = document.getElementById('btn-confirm-execute');
    isBusyTx = true;
    btn.disabled = true;

    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const net = await provider.getNetwork();
        if (net.chainId !== 137) {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x89' }]
            });
        }

        const signer = provider.getSigner();
        const chain = CHAINS[137];
        const b = balances[137];
        const usablePol = Math.max(0, (b.POL || 0) - market.dynamicGasReservePol);

        if (sculptedPlan.deployableUsd < 1.0) {
            throw new Error(`Saldo livre insuficiente ($${sculptedPlan.deployableUsd.toFixed(2)}). Mantenha gás + capital.`);
        }

        // 1. Converte BRZ/BRLA para USDT0 se houver saldo
        if ((b.BRZ || 0) > 1.0) {
            const brzWei = ethers.utils.parseUnits(b.BRZ.toFixed(6), 18);
            await swapSameChainUniswap(137, 'BRZ', 'USDT0', brzWei, signer, (m) => { logEl.textContent = m; });
        }
        if ((b.BRLA || 0) > 1.0) {
            const brlaWei = ethers.utils.parseUnits(b.BRLA.toFixed(6), 18);
            await swapSameChainUniswap(137, 'BRLA', 'USDT0', brlaWei, signer, (m) => { logEl.textContent = m; });
        }

        // 2. Wrap de POL excedente para WPOL (1:1 sem slippage)
        if (usablePol > 0.5) {
            logEl.textContent = 'Convertendo POL livre para WPOL (1:1)...';
            const wpolC = new ethers.Contract(chain.tokens.WPOL.address, ["function deposit() payable"], signer);
            const wrapTx = await wpolC.deposit({ value: ethers.utils.parseUnits(usablePol.toFixed(6), 18) });
            await wrapTx.wait();
        }

        await syncAllChainsNow();
        const freshB = balances[137];
        const wpolUsd = (freshB.WPOL || 0) * market.polUsd;
        const usdtUsd = freshB.USDT0 || 0;
        const totalUsd = wpolUsd + usdtUsd;
        const targetUsdtUsd = totalUsd * sculptedPlan.targetUsdtShare;

        // 3. Rebalanceia WPOL <-> USDT0 na proporção exata do range
        if (usdtUsd > targetUsdtUsd + 0.35) {
            const diffUsd = usdtUsd - targetUsdtUsd;
            const usdtWei = ethers.utils.parseUnits(diffUsd.toFixed(6), 6);
            await swapSameChainUniswap(137, 'USDT0', 'WPOL', usdtWei, signer, (m) => { logEl.textContent = m; });
        } else if (wpolUsd > (totalUsd - targetUsdtUsd) + 0.35) {
            const diffPol = (wpolUsd - (totalUsd - targetUsdtUsd)) / market.polUsd;
            const wpolWei = ethers.utils.parseUnits(diffPol.toFixed(6), 18);
            await swapSameChainUniswap(137, 'WPOL', 'USDT0', wpolWei, signer, (m) => { logEl.textContent = m; });
        }

        // 4. Lê saldos finais exatos e abre a posição na Uniswap V3
        const wpolRead = new ethers.Contract(chain.tokens.WPOL.address, ["function balanceOf(address) view returns (uint256)"], signer);
        const usdtRead = new ethers.Contract(chain.tokens.USDT0.address, ["function balanceOf(address) view returns (uint256)"], signer);
        const [bal0BN, bal1BN] = await Promise.all([
            wpolRead.balanceOf(state.wallet),
            usdtRead.balanceOf(state.wallet)
        ]);

        if (bal0BN.isZero() || bal1BN.isZero()) {
            throw new Error('Balanceamento parcial concluído. Toque novamente para abrir a posição.');
        }

        await ensureExactApproval(chain.tokens.WPOL.address, chain.nfpm, bal0BN, signer, (m) => { logEl.textContent = m; });
        await ensureExactApproval(chain.tokens.USDT0.address, chain.nfpm, bal1BN, signer, (m) => { logEl.textContent = m; });

        logEl.textContent = 'Simulando posição anti-MEV antes de assinar...';
        const nfpm = new ethers.Contract(chain.nfpm, [
            "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)"
        ], signer);

        const deadline = Math.floor(Date.now() / 1000) + 300;
        const simParams = {
            token0: chain.tokens.WPOL.address,
            token1: chain.tokens.USDT0.address,
            fee: POOL_FEE_TIER,
            tickLower: sculptedPlan.tickLower,
            tickUpper: sculptedPlan.tickUpper,
            amount0Desired: bal0BN,
            amount1Desired: bal1BN,
            amount0Min: 0,
            amount1Min: 0,
            recipient: state.wallet,
            deadline
        };

        const sim = await nfpm.callStatic.mint(simParams);
        const finalParams = {
            ...simParams,
            amount0Min: sim.amount0.mul(992).div(1000),
            amount1Min: sim.amount1.mul(992).div(1000)
        };

        logEl.textContent = 'Confirme na sua carteira para ativar o rendimento...';
        const mintTx = await nfpm.mint(finalParams, { gasLimit: 650000 });
        await mintTx.wait();

        triggerHaptic([40, 30, 60]);
        logEl.style.color = 'var(--emerald)';
        logEl.textContent = 'Posição ativa na Uniswap V3! Já está gerando tarifas.';
        await syncAllChainsNow();
        setTimeout(() => {
            document.getElementById('sheet-xray').classList.remove('open');
            switchTab('pools');
        }, 1200);
    } catch (err) {
        logEl.style.color = 'var(--coral)';
        logEl.textContent = err?.reason || err?.message || 'Operação cancelada.';
    } finally {
        isBusyTx = false;
        btn.disabled = false;
    }
}

async function swapSameChainUniswap(chainId, symIn, symOut, amountWei, signer, logFn) {
    const chain = CHAINS[chainId];
    const tokIn = chain.tokens[symIn];
    const tokOut = chain.tokens[symOut];
    const addrIn = tokIn.isNative ? (chain.tokens.WPOL?.address || chain.tokens.WETH?.address) : tokIn.address;
    const addrOut = tokOut.isNative ? (chain.tokens.WPOL?.address || chain.tokens.WETH?.address) : tokOut.address;

    const quoter = new ethers.Contract(chain.quoterV2, [
        "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160, uint32, uint256)"
    ], signer);

    let bestFee = 500;
    let bestOut = ethers.BigNumber.from(0);
    for (const fee of [500, 3000, 10000]) {
        try {
            const q = await quoter.callStatic.quoteExactInputSingle({
                tokenIn: addrIn,
                tokenOut: addrOut,
                amountIn: amountWei,
                fee,
                sqrtPriceLimitX96: 0
            });
            if (q.amountOut.gt(bestOut)) {
                bestOut = q.amountOut;
                bestFee = fee;
            }
        } catch (e) {}
    }
    if (bestOut.isZero()) throw new Error(`Sem liquidez direta ${symIn} → ${symOut}`);

    // Desconta comissão da plataforma apenas se NÃO for carteira fundadora
    let swapAmountWei = amountWei;
    const feeBps = getPlatformFeeBps();
    if (feeBps > 0 && !tokIn.isNative) {
        const feeWei = amountWei.mul(feeBps).div(10000);
        if (feeWei.gt(0)) {
            if (logFn) logFn(`Repassando taxa de automação (0.25%)...`);
            const erc20Fee = new ethers.Contract(tokIn.address, ["function transfer(address, uint256) returns (bool)"], signer);
            const fTx = await erc20Fee.transfer(FOUNDER_ADDRESS, feeWei);
            await fTx.wait();
            swapAmountWei = amountWei.sub(feeWei);
        }
    }

    if (!tokIn.isNative) {
        await ensureExactApproval(tokIn.address, chain.router02, swapAmountWei, signer, logFn);
    }

    const router = new ethers.Contract(chain.router02, [
        "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)"
    ], signer);

    if (logFn) logFn(`Trocando ${symIn} → ${symOut} na Uniswap V3...`);
    const minOut = bestOut.mul(990).div(1000);
    const tx = await router.exactInputSingle({
        tokenIn: addrIn,
        tokenOut: addrOut,
        fee: bestFee,
        recipient: state.wallet,
        amountIn: swapAmountWei,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0
    }, tokIn.isNative ? { value: swapAmountWei } : {});
    await tx.wait();
}

// =========================================================================
// 9. GESTÃO DE POOLS (COLHER, WITHDRAW, REBALANCEAR) & ALLOWANCE GUARD
// =========================================================================
async function collectFeesNft(tokenId) {
    if (!state.wallet) return;
    const fb = document.getElementById('pool-action-feedback');
    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();
        const nfpm = new ethers.Contract(CHAINS[137].nfpm, [
            "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256, uint256)"
        ], signer);
        fb.textContent = `Colhendo tarifas do NFT #${tokenId}...`;
        const tx = await nfpm.collect({
            tokenId: ethers.BigNumber.from(tokenId),
            recipient: state.wallet,
            amount0Max: MAX_UINT128,
            amount1Max: MAX_UINT128
        });
        await tx.wait();
        triggerHaptic([35, 25, 35]);
        fb.style.color = 'var(--emerald)';
        fb.textContent = `Tarifas do NFT #${tokenId} depositadas na sua carteira!`;
        await syncAllChainsNow();
    } catch (e) {
        fb.style.color = 'var(--coral)';
        fb.textContent = e?.reason || 'Coleta cancelada.';
    }
}

async function withdrawPositionNft(tokenId, autoReopen = false) {
    if (!state.wallet) return;
    const fb = document.getElementById('pool-action-feedback');
    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();
        const nfpm = new ethers.Contract(CHAINS[137].nfpm, [
            "function positions(uint256) view returns (uint96, address, address, address, uint24, int24, int24, uint128 liquidity, uint256, uint256, uint128, uint128)",
            "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint256, uint256)",
            "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256, uint256)",
            "function multicall(bytes[] data) payable returns (bytes[] results)"
        ], signer);

        fb.textContent = `Resgatando 100% do NFT #${tokenId}...`;
        const pos = await nfpm.positions(ethers.BigNumber.from(tokenId));
        const liq = pos.liquidity;
        const deadline = Math.floor(Date.now() / 1000) + 300;

        const decData = nfpm.interface.encodeFunctionData('decreaseLiquidity', [{
            tokenId: ethers.BigNumber.from(tokenId),
            liquidity: liq,
            amount0Min: 0,
            amount1Min: 0,
            deadline
        }]);
        const colData = nfpm.interface.encodeFunctionData('collect', [{
            tokenId: ethers.BigNumber.from(tokenId),
            recipient: state.wallet,
            amount0Max: MAX_UINT128,
            amount1Max: MAX_UINT128
        }]);

        const tx = await nfpm.multicall([decData, colData], { gasLimit: 450000 });
        await tx.wait();
        triggerHaptic([40, 30, 40]);
        fb.style.color = 'var(--emerald)';
        fb.textContent = `Posição #${tokenId} encerrada e devolvida para a carteira.`;
        await syncAllChainsNow();

        if (autoReopen) {
            await executeAutoPilotStrategy();
        }
    } catch (e) {
        fb.style.color = 'var(--coral)';
        fb.textContent = e?.reason || 'Resgate cancelado.';
    }
}

async function revokeTokenAllowance(tokenAddress, spenderAddress, symbol) {
    if (!state.wallet) return;
    const fb = document.getElementById('pool-action-feedback');
    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();
        const erc20 = new ethers.Contract(tokenAddress, ["function approve(address, uint256) returns (bool)"], signer);
        fb.textContent = `Revogando permissão de ${symbol}...`;
        const tx = await erc20.approve(spenderAddress, 0);
        await tx.wait();
        fb.style.color = 'var(--emerald)';
        fb.textContent = `Permissão de ${symbol} revogada com sucesso!`;
        await syncAllChainsNow();
    } catch (e) {
        fb.style.color = 'var(--coral)';
        fb.textContent = 'Revogação cancelada.';
    }
}

// =========================================================================
// 10. BRIDGE MULTI-CHAIN (LI.FI / UNISWAP V3) & BTC / LIGHTNING SEM KYC
// =========================================================================
async function refreshBridgeQuote() {
    const fromVal = document.getElementById('bridge-from-asset').value;
    const toVal = document.getElementById('bridge-to-asset').value;
    const amt = parseFloat(document.getElementById('bridge-amount-in').value);
    const outInput = document.getElementById('bridge-amount-out');
    const feeDisp = document.getElementById('bridge-fee-display');
    const etaEl = document.getElementById('bridge-eta-tag');

    const feeBps = getPlatformFeeBps();
    if (feeDisp) {
        feeDisp.textContent = feeBps === 0
            ? 'Taxa App: 0.00% (Fundador)'
            : 'Taxa App: 0.25%';
    }

    if (!Number.isFinite(amt) || amt <= 0 || fromVal === toVal) {
        outInput.value = '0.0000';
        activeBridgeQuote = null;
        return;
    }

    const [fromChainStr, fromSym] = fromVal.split(':');
    const [toChainStr, toSym] = toVal.split(':');
    const fromChain = Number(fromChainStr);
    const toChain = Number(toChainStr);
    const tokIn = CHAINS[fromChain].tokens[fromSym];
    const tokOut = CHAINS[toChain].tokens[toSym];
    const amountWei = ethers.utils.parseUnits(amt.toFixed(tokIn.decimals), tokIn.decimals);

    outInput.value = 'Cotando...';

    try {
        if (fromChain === toChain) {
            const provider = await getFastestProvider(fromChain);
            const quoter = new ethers.Contract(CHAINS[fromChain].quoterV2, [
                "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160, uint32, uint256)"
            ], provider);
            const addrIn = tokIn.isNative ? (CHAINS[fromChain].tokens.WPOL?.address || CHAINS[fromChain].tokens.WETH?.address) : tokIn.address;
            const addrOut = tokOut.isNative ? (CHAINS[fromChain].tokens.WPOL?.address || CHAINS[fromChain].tokens.WETH?.address) : tokOut.address;

            const q = await quoter.callStatic.quoteExactInputSingle({
                tokenIn: addrIn,
                tokenOut: addrOut,
                amountIn: amountWei,
                fee: 500,
                sqrtPriceLimitX96: 0
            });
            const netOutBN = feeBps > 0 ? q.amountOut.mul(10000 - feeBps).div(10000) : q.amountOut;
            outInput.value = parseFloat(ethers.utils.formatUnits(netOutBN, tokOut.decimals)).toFixed(5);
            if (etaEl) etaEl.textContent = '~3 seg (Local)';
            activeBridgeQuote = { type: 'LOCAL', fromChain, fromSym, toSym, amountWei };
        } else {
            // LI.FI Public Cross-Chain Quote (sem API Key, com repasse de fee para fundador)
            const params = new URLSearchParams({
                fromChain: String(fromChain),
                toChain: String(toChain),
                fromToken: tokIn.address,
                toToken: tokOut.address,
                fromAmount: amountWei.toString(),
                fromAddress: state.wallet || FOUNDER_ADDRESS,
                integrator: 'rdesk-defi-terminal'
            });
            if (feeBps > 0) {
                params.set('fee', (feeBps / 10000).toString());
                params.set('referrer', FOUNDER_ADDRESS);
            }
            const res = await withTimeout(fetch(`https://li.quest/v1/quote?${params.toString()}`), 6000);
            const data = await res.json();
            if (data?.estimate?.toAmount) {
                const outFmt = parseFloat(ethers.utils.formatUnits(data.estimate.toAmount, tokOut.decimals));
                outInput.value = outFmt.toFixed(5);
                if (etaEl) etaEl.textContent = `~${Math.max(10, data.estimate.executionDuration || 25)} seg`;
                activeBridgeQuote = { type: 'LIFI', fromChain, tokIn, amountWei, txRequest: data.transactionRequest };
            } else {
                outInput.value = 'Rota indisponível';
                activeBridgeQuote = null;
            }
        }
    } catch (e) {
        outInput.value = 'Erro cotação';
        activeBridgeQuote = null;
    }
}

async function executeBridgeOrSwap() {
    if (!state.wallet) {
        await connectWallet();
        return;
    }
    if (!activeBridgeQuote) return;
    const btn = document.getElementById('btn-exec-bridge');
    btn.disabled = true;
    btn.textContent = 'ASSINANDO NA CARTEIRA...';

    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const net = await provider.getNetwork();
        if (net.chainId !== activeBridgeQuote.fromChain) {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x' + activeBridgeQuote.fromChain.toString(16) }]
            });
        }
        const signer = provider.getSigner();

        if (activeBridgeQuote.type === 'LOCAL') {
            await swapSameChainUniswap(
                activeBridgeQuote.fromChain,
                activeBridgeQuote.fromSym,
                activeBridgeQuote.toSym,
                activeBridgeQuote.amountWei,
                signer,
                (msg) => { btn.textContent = msg; }
            );
        } else if (activeBridgeQuote.type === 'LIFI') {
            const { tokIn, amountWei, txRequest } = activeBridgeQuote;
            if (!tokIn.isNative && txRequest.to) {
                await ensureExactApproval(tokIn.address, txRequest.to, amountWei, signer, (m) => { btn.textContent = m; });
            }
            const tx = await signer.sendTransaction({
                to: txRequest.to,
                data: txRequest.data,
                value: txRequest.value ? ethers.BigNumber.from(txRequest.value) : 0,
                gasLimit: txRequest.gasLimit ? ethers.BigNumber.from(txRequest.gasLimit) : 450000
            });
            await tx.wait();
        }

        triggerHaptic([35, 25, 45]);
        btn.textContent = 'CONVERSÃO CONCLUÍDA!';
        await syncAllChainsNow();
    } catch (e) {
        btn.textContent = 'CANCELADO / TENTAR NOVAMENTE';
    } finally {
        setTimeout(() => {
            btn.disabled = false;
            btn.textContent = 'CONVERTER AGORA';
        }, 2000);
    }
}

// Modo FixedFloat Nativo: Bitcoin On-Chain & Lightning Network Sem KYC (SideShift v2 Permissionless)
async function createNativeBtcOrLightningOrder() {
    const pair = document.getElementById('btc-pair-select').value;
    const amount = parseFloat(document.getElementById('btc-swap-amount').value);
    const dest = document.getElementById('btc-dest-address').value.trim();
    const qrBox = document.getElementById('btc-qr-box');
    const statusEl = document.getElementById('btc-order-status');

    if (!dest) {
        alert('Informe o endereço de destino ou fatura Lightning (lnbc...).');
        return;
    }

    const pairConfig = {
        BTC_TO_USDT_POLY: { depositCoin: 'btc', depositNetwork: 'bitcoin', settleCoin: 'usdt', settleNetwork: 'polygon' },
        LN_TO_USDT_POLY:  { depositCoin: 'btc', depositNetwork: 'lightning', settleCoin: 'usdt', settleNetwork: 'polygon' },
        USDT_POLY_TO_LN:  { depositCoin: 'usdt', depositNetwork: 'polygon', settleCoin: 'btc', settleNetwork: 'lightning' },
        USDT_POLY_TO_BTC: { depositCoin: 'usdt', depositNetwork: 'polygon', settleCoin: 'btc', settleNetwork: 'bitcoin' }
    }[pair];

    const btn = document.getElementById('btn-create-btc-order');
    btn.disabled = true;
    btn.textContent = 'GERANDO COFRE SEM KYC...';

    try {
        const res = await fetch('https://sideshift.ai/api/v2/shifts/variable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                depositCoin: pairConfig.depositCoin,
                depositNetwork: pairConfig.depositNetwork,
                settleCoin: pairConfig.settleCoin,
                settleNetwork: pairConfig.settleNetwork,
                settleAddress: dest,
                refundAddress: state.wallet || undefined
            })
        });
        const order = await res.json();
        if (!order?.depositAddress) {
            throw new Error(order?.error?.message || 'Não foi possível gerar o endereço agora.');
        }

        qrBox.classList.add('visible');
        document.getElementById('btc-deposit-addr').textContent = order.depositAddress;
        document.getElementById('btc-qr-img').src =
            `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(order.depositAddress)}`;
        statusEl.textContent = `Ordem #${order.id} ativa (${Number.isFinite(amount) ? amount : 'livre'}). Aguardando depósito...`;

        // Monitora status da liquidação ao vivo
        const pollTimer = setInterval(async () => {
            try {
                const stRes = await fetch(`https://sideshift.ai/api/v2/shifts/${order.id}`);
                const stJson = await stRes.json();
                if (stJson?.status) {
                    statusEl.textContent = `Status: ${stJson.status.toUpperCase()}`;
                    if (stJson.status === 'settled') {
                        clearInterval(pollTimer);
                        triggerHaptic([50, 30, 70]);
                        syncAllChainsNow();
                    }
                }
            } catch (e) {}
        }, 7000);
    } catch (e) {
        alert(e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'GERAR ORDEM INSTANTÂNEA';
    }
}

// =========================================================================
// 11. CALCULADORA BIDIRECIONAL DE SAQUE PIX ("QUERO R$ X LIMPOS")
// =========================================================================
function renderPixRoutes() {
    const targetNetBrl = parseFloat(document.getElementById('pix-target-brl').value) || 0;
    const container = document.getElementById('pix-routes-container');
    if (!container) return;
    container.replaceChildren();

    const routes = [
        { name: 'NakPix (c/ Cupom)', kyc: 'SEM KYC', noKyc: true, pct: 0.02, fixedBrl: 0.03, url: null },
        { name: 'DePix / Liquid', kyc: 'SEM KYC', noKyc: true, pct: 0.018, fixedBrl: 0.20, url: 'https://depixapp.com' },
        { name: 'PagFinance', kyc: 'CPF RÁPIDO', noKyc: false, pct: 0.02, fixedBrl: 1.20, url: 'https://pag.finance' },
        { name: 'NakPix (Padrão)', kyc: 'SEM KYC', noKyc: true, pct: 0.04, fixedBrl: 0.03, url: null },
        { name: 'Binance Spot', kyc: 'KYC TOTAL', noKyc: false, pct: 0.005, fixedBrl: 3.53, url: 'https://www.binance.com/pt-BR/trade/USDT_BRL' },
        { name: 'Bipa (Plano Free)', kyc: 'KYC TOTAL', noKyc: false, pct: 0.029, fixedBrl: 0.03, url: 'https://bipa.app' }
    ];

    const evaluated = routes
        .filter((r) => !state.onlyNoKycPix || r.noKyc)
        .map((r) => {
            const requiredGrossBrl = targetNetBrl > 0 ? (targetNetBrl + r.fixedBrl) / (1 - r.pct) : 0;
            const requiredUsdt = requiredGrossBrl / market.usdBrl;
            const totalFeeBrl = Math.max(0, requiredGrossBrl - targetNetBrl);
            return { ...r, requiredUsdt, totalFeeBrl };
        })
        .sort((a, b) => a.requiredUsdt - b.requiredUsdt);

    evaluated.forEach((item, idx) => {
        const card = document.createElement('div');
        card.className = 'pix-route-item' + (idx === 0 && targetNetBrl > 0 ? ' winner' : '');

        const left = document.createElement('div');
        const title = document.createElement('div');
        title.style.cssText = 'font-size: 0.76rem; font-weight: 700; color: var(--text-primary);';
        title.textContent = `${idx === 0 ? '★ ' : ''}${item.name} (${item.kyc})`;

        const sub = document.createElement('div');
        sub.style.cssText = 'font-size: 0.65rem; color: var(--text-secondary);';
        sub.textContent = `Custo total da rota: R$ ${item.totalFeeBrl.toFixed(2)}`;
        left.append(title, sub);

        const right = document.createElement('div');
        right.style.textAlign = 'right';
        const usdtEl = document.createElement('div');
        usdtEl.className = 'mono';
        usdtEl.style.cssText = 'font-size: 0.78rem; font-weight: 800; color: var(--emerald);';
        usdtEl.textContent = `${item.requiredUsdt.toFixed(2)} USDT0`;

        const hint = document.createElement('div');
        hint.style.cssText = 'font-size: 0.62rem; color: var(--text-muted);';
        hint.textContent = 'Toque p/ copiar';
        right.append(usdtEl, hint);

        card.append(left, right);
        card.addEventListener('click', () => {
            navigator.clipboard.writeText(item.requiredUsdt.toFixed(2)).catch(() => {});
            triggerHaptic([20]);
            if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer');
        });
        container.appendChild(card);
    });
}

// =========================================================================
// 12. RENDERIZAÇÃO UNIFICADA DAS 4 TELAS
// =========================================================================
function renderAllViews() {
    const totalUsd = getTotalWealthUsd();
    const netInvested = Math.max(0, state.forensics.depositedUsd - state.forensics.withdrawnUsd);
    const realPnlUsd = totalUsd - netInvested;
    const pnlPct = netInvested > 0 ? ((realPnlUsd / netInvested) * 100).toFixed(2) : '0.00';

    document.getElementById('top-pol-price').textContent = `POL $${market.polUsd.toFixed(4)}`;
    document.getElementById('top-fx-rate').textContent = `1$ = R$${market.usdBrl.toFixed(2)}`;

    // Tela 1: Cofre
    document.getElementById('hero-total-wealth').textContent = formatInSelectedCurrency(totalUsd);
    const pnlBadge = document.getElementById('hero-real-pnl');
    pnlBadge.textContent = `Lucro Real: ${realPnlUsd >= 0 ? '+' : ''}${formatInSelectedCurrency(realPnlUsd)} (${realPnlUsd >= 0 ? '+' : ''}${pnlPct}%)`;
    pnlBadge.className = 'pnl-badge sensitive-val ' + (realPnlUsd >= 0 ? 'pos' : 'neg');
    document.getElementById('hero-unclaimed-fees').textContent = `Taxas livres: +${formatInSelectedCurrency(balances.unclaimedFeesUsd)}`;

    [137, 8453, 42161, 42220, 10].forEach((id) => {
        const el = document.getElementById(`chain-val-${id}`);
        if (el) el.textContent = formatInSelectedCurrency(balances[id]?.totalUsd || 0, false);
    });
    const poolsEl = document.getElementById('chain-val-pools');
    if (poolsEl) poolsEl.textContent = formatInSelectedCurrency(balances.poolsUsd + balances.unclaimedFeesUsd, false);

    // Anel de Meta Mensal
    const projectedMonthBrl = sculptedPlan.projectedBrlMin * 60 * 24 * 30;
    const goalPct = Math.min(100, Math.round((projectedMonthBrl / Math.max(1, state.monthlyGoalBrl)) * 100));
    const circle = document.getElementById('goal-ring-circle');
    if (circle) {
        const offset = 138.2 - (138.2 * goalPct) / 100;
        circle.style.strokeDashoffset = offset.toFixed(1);
    }
    document.getElementById('goal-ring-pct').textContent = `${goalPct}%`;
    document.getElementById('goal-title-display').textContent = `Meta: R$ ${state.monthlyGoalBrl.toFixed(2)} / mês`;
    document.getElementById('goal-progress-sub').textContent =
        `Ritmo projetado: R$ ${(sculptedPlan.projectedBrlMin * 60 * 24).toFixed(2)}/dia`;

    // Tela 3: Pools Ativas & Escudo de Permissões
    renderActivePoolsList();
    renderAllowanceGuardList();

    // Tela 4: Auditoria Dia 1
    document.getElementById('forensic-deposited').textContent = formatInSelectedCurrency(state.forensics.depositedUsd);
    document.getElementById('forensic-withdrawn').textContent = formatInSelectedCurrency(state.forensics.withdrawnUsd);
    document.getElementById('forensic-current').textContent = formatInSelectedCurrency(totalUsd);
    const netEl = document.getElementById('forensic-net-result');
    netEl.textContent = `${realPnlUsd >= 0 ? '+' : ''}${formatInSelectedCurrency(realPnlUsd)}`;
    netEl.style.color = realPnlUsd >= 0 ? 'var(--emerald)' : 'var(--coral)';

    applyPrivacyMask();
    renderTruthChart();
}

function renderActivePoolsList() {
    const container = document.getElementById('active-pools-container');
    const shell = document.getElementById('app-shell');
    if (!container) return;
    container.replaceChildren();

    if (state.positions.length === 0) {
        shell.classList.remove('state-warning', 'state-danger');
        const empty = document.createElement('div');
        empty.style.cssText = 'text-align: center; padding: 14px; color: var(--text-muted); font-size: 0.75rem;';
        empty.textContent = 'Nenhuma posição ativa na Uniswap V3. Use a aba Motor para começar.';
        container.appendChild(empty);
        return;
    }

    let worstState = 'SAFE';

    state.positions.forEach((pos) => {
        const inRange = market.polUsd >= pos.min && market.polUsd <= pos.max;
        const margin = (pos.max - pos.min) * 0.08;
        const nearEdge = inRange && (market.polUsd <= pos.min + margin || market.polUsd >= pos.max - margin);

        if (!inRange) {
            worstState = 'DANGER';
            sendRangePushNotification(
                `NFT #${pos.tokenId} fora da faixa!`,
                `POL em $${market.polUsd.toFixed(5)} saiu de [${pos.min.toFixed(5)} - ${pos.max.toFixed(5)}].`,
                `out-${pos.tokenId}`
            );
        } else if (nearEdge && worstState !== 'DANGER') {
            worstState = 'WARNING';
            sendRangePushNotification(
                `NFT #${pos.tokenId} encostando na borda`,
                `Preço próximo do limite da faixa. Verifique na aba Pools.`,
                `edge-${pos.tokenId}`
            );
        }

        const card = document.createElement('div');
        card.className = 'pos-card' + (!inRange ? ' out-range' : '');

        const head = document.createElement('div');
        head.className = 'pos-card-head';

        const title = document.createElement('strong');
        title.style.fontSize = '0.78rem';
        title.textContent = `NFT #${pos.tokenId} • ${formatInSelectedCurrency(pos.principalUsd)}`;

        const badge = document.createElement('span');
        badge.className = 'status-badge' + (!inRange ? ' danger' : nearEdge ? ' warn' : '');
        badge.textContent = !inRange ? 'FORA DA FAIXA' : nearEdge ? 'BORDA' : 'RENDENDO';
        head.append(title, badge);

        const sub = document.createElement('div');
        sub.className = 'mono';
        sub.style.cssText = 'font-size: 0.68rem; color: var(--text-secondary); display: flex; justify-content: space-between;';
        sub.textContent = `${pos.min.toFixed(5)} ↔ ${pos.max.toFixed(5)} | Taxas: +${formatInSelectedCurrency(pos.feesUsd)}`;

        const btnGrid = document.createElement('div');
        btnGrid.className = 'pos-btn-grid';
        btnGrid.style.gridTemplateColumns = 'repeat(3, 1fr)';

        const btnCollect = document.createElement('button');
        btnCollect.className = 'pos-act-btn';
        btnCollect.style.color = 'var(--emerald)';
        btnCollect.textContent = 'COLHER';
        btnCollect.addEventListener('click', () => collectFeesNft(pos.tokenId));

        const btnRebal = document.createElement('button');
        btnRebal.className = 'pos-act-btn';
        btnRebal.style.color = 'var(--gold-accent)';
        btnRebal.textContent = 'REBALANCEAR';
        btnRebal.addEventListener('click', () => withdrawPositionNft(pos.tokenId, true));

        const btnWithdraw = document.createElement('button');
        btnWithdraw.className = 'pos-act-btn danger';
        btnWithdraw.textContent = 'SACAR 100%';
        btnWithdraw.addEventListener('click', () => withdrawPositionNft(pos.tokenId, false));

        btnGrid.append(btnCollect, btnRebal, btnWithdraw);
        card.append(head, sub, btnGrid);
        container.appendChild(card);
    });

    shell.classList.toggle('state-warning', worstState === 'WARNING');
    shell.classList.toggle('state-danger', worstState === 'DANGER');
    updateChartRangeLines();
}

function renderAllowanceGuardList() {
    const list = document.getElementById('allowance-list');
    if (!list) return;
    list.replaceChildren();

    if (!state.wallet) {
        list.textContent = 'Conecte sua carteira para auditar aprovações abertas nos contratos.';
        return;
    }
    if (state.allowances.length === 0) {
        list.style.color = 'var(--emerald)';
        list.textContent = '✓ Blindagem limpa: nenhuma permissão aberta em roteadores.';
        return;
    }

    state.allowances.forEach((al) => {
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border-subtle);';

        const info = document.createElement('div');
        info.innerHTML = `<strong style="color:var(--text-primary);">${al.tokenSymbol}</strong> → ${al.spenderName}<br><span class="mono" style="font-size:0.64rem; color:var(--amber);">Limite: ${al.amountFormatted}</span>`;

        const revBtn = document.createElement('button');
        revBtn.className = 'pos-act-btn danger';
        revBtn.style.padding = '5px 9px';
        revBtn.textContent = 'REVOGAR';
        revBtn.addEventListener('click', () => revokeTokenAllowance(al.tokenAddress, al.spenderAddress, al.tokenSymbol));

        row.append(info, revBtn);
        list.appendChild(row);
    });
}

function applyPrivacyMask() {
    document.querySelectorAll('.sensitive-val').forEach((el) => {
        el.classList.toggle('privacy-blur', state.privacyHidden);
    });
}

// =========================================================================
// 13. GRÁFICO TRADINGVIEW & TELEMETRIA DE MERCADO EM TEMPO REAL
// =========================================================================
function initChart() {
    const container = document.getElementById('tv-chart');
    if (!container || typeof LightweightCharts === 'undefined') return;

    chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: 190,
        layout: { background: { type: 'solid', color: '#0D0F14' }, textColor: '#9CA3AF' },
        grid: { vertLines: { color: 'rgba(255,255,255,0.03)' }, horzLines: { color: 'rgba(255,255,255,0.03)' } },
        timeScale: { timeVisible: true, borderColor: 'rgba(255,255,255,0.06)' },
        rightPriceScale: { borderColor: 'rgba(255,255,255,0.06)' }
    });

    candleSeries = chart.addCandlestickSeries({
        upColor: '#10B981',
        downColor: '#EF4444',
        borderVisible: false,
        wickUpColor: '#10B981',
        wickDownColor: '#EF4444',
        priceFormat: { type: 'price', precision: 5, minMove: 0.00001 }
    });

    new ResizeObserver((entries) => {
        if (entries.length && chart) {
            chart.resize(entries[0].contentRect.width, 190);
        }
    }).observe(container);

    loadKlines(currentTf);
}

async function loadKlines(interval) {
    try {
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=POLUSDT&interval=${interval}&limit=140`);
        const raw = await res.json();
        const data = raw.map((d) => ({
            time: Math.floor(d[0] / 1000),
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4])
        }));
        if (candleSeries) candleSeries.setData(data);

        if (interval === '15m' && data.length > 25) {
            const trs = [];
            for (let i = data.length - 14; i < data.length; i++) {
                trs.push(Math.max(
                    data[i].high - data[i].low,
                    Math.abs(data[i].high - data[i - 1].close),
                    Math.abs(data[i].low - data[i - 1].close)
                ));
            }
            market.atr15m = trs.reduce((a, b) => a + b, 0) / trs.length;

            const closes = data.map((c) => c.close);
            const ema9 = closes.slice(-9).reduce((a, b) => a + b, 0) / 9;
            const ema21 = closes.slice(-21).reduce((a, b) => a + b, 0) / 21;
            const bias = Math.max(-1, Math.min(1, (ema9 - ema21) / Math.max(1e-6, market.atr15m)));
            market.upWeight = 0.5 + (bias * 0.16);
            market.downWeight = 1 - market.upWeight;
            market.regimeText = bias > 0.25
                ? `ALTA ${Math.round(market.downWeight * 100)}/${Math.round(market.upWeight * 100)}`
                : bias < -0.25
                    ? `BAIXA ${Math.round(market.downWeight * 100)}/${Math.round(market.upWeight * 100)}`
                    : 'SNIPER 50/50';
            const badge = document.getElementById('motor-regime-badge');
            if (badge) badge.textContent = market.regimeText;
        }
        recomputeSculptor();
    } catch (e) {}
}

function updateChartRangeLines() {
    if (!candleSeries) return;
    previewLines.forEach((l) => { try { candleSeries.removePriceLine(l); } catch (e) {} });
    positionLines.forEach((l) => { try { candleSeries.removePriceLine(l); } catch (e) {} });
    previewLines = [];
    positionLines = [];

    if (sculptedPlan.pMin > 0 && sculptedPlan.pMax > sculptedPlan.pMin) {
        previewLines.push(candleSeries.createPriceLine({
            price: sculptedPlan.pMin,
            color: '#38BDF8',
            lineWidth: 1,
            lineStyle: 3,
            axisLabelVisible: true,
            title: 'PISO'
        }));
        previewLines.push(candleSeries.createPriceLine({
            price: sculptedPlan.pMax,
            color: '#CDA434',
            lineWidth: 1,
            lineStyle: 3,
            axisLabelVisible: true,
            title: 'TETO'
        }));
    }

    state.positions.forEach((p) => {
        positionLines.push(candleSeries.createPriceLine({
            price: p.min,
            color: '#10B981',
            lineWidth: 2,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `#${p.tokenId} MIN`
        }));
        positionLines.push(candleSeries.createPriceLine({
            price: p.max,
            color: '#10B981',
            lineWidth: 2,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `#${p.tokenId} MAX`
        }));
    });
}

async function refreshMarketOracles() {
    try {
        const [fxRes, geckoRes] = await Promise.allSettled([
            fetch('https://economia.awesomeapi.com.br/last/USD-BRL').then((r) => r.json()),
            fetch(`https://api.geckoterminal.com/api/v2/networks/polygon_pos/pools/${POLYGON_POOL_ADDRESS}`).then((r) => r.json())
        ]);

        if (fxRes.status === 'fulfilled' && fxRes.value?.USDBRL?.bid) {
            market.usdBrl = parseFloat(fxRes.value.USDBRL.bid);
            market.usdtToBrz = market.usdBrl;
            market.usdtToBrla = market.usdBrl;
        }
        if (geckoRes.status === 'fulfilled') {
            const volH24 = parseFloat(geckoRes.value?.data?.attributes?.volume_usd?.h24 || '0');
            if (volH24 > 0) {
                market.poolFeesUsdPerMin = (volH24 / 1440) * 0.0005;
            }
        }
    } catch (e) {}
    recomputeSculptor();
    renderPixRoutes();
}

function startBinanceWebSocket() {
    const ws = new WebSocket('wss://stream.binance.com:9443/stream?streams=polusdt@ticker/ethusdt@ticker/btcusdt@ticker');
    ws.onmessage = (ev) => {
        try {
            const msg = JSON.parse(ev.data);
            const stream = msg.stream || '';
            const price = parseFloat(msg.data?.c);
            if (!Number.isFinite(price) || price <= 0) return;

            if (stream.startsWith('polusdt')) {
                market.polUsd = price;
                if (candleSeries) {
                    const blockTime = Math.floor(Date.now() / 1000 / currentTfSec) * currentTfSec;
                    if (!liveCandle || liveCandle.time !== blockTime) {
                        liveCandle = { time: blockTime, open: price, high: price, low: price, close: price };
                    } else {
                        liveCandle.high = Math.max(liveCandle.high, price);
                        liveCandle.low = Math.min(liveCandle.low, price);
                        liveCandle.close = price;
                    }
                    candleSeries.update(liveCandle);
                }
                recomputeSculptor();
                renderAllViews();
            } else if (stream.startsWith('ethusdt')) {
                market.ethUsd = price;
            } else if (stream.startsWith('btcusdt')) {
                market.btcUsd = price;
            }
        } catch (e) {}
    };
    ws.onclose = () => setTimeout(startBinanceWebSocket, 3000);
}

// =========================================================================
// 14. CONEXÃO WEB3, NAVEGAÇÃO & BOTTOM SHEETS EDUCATIVOS
// =========================================================================
async function connectWallet() {
    if (!window.ethereum) {
        alert('Instale ou ative sua carteira Web3 (Rabby Wallet ou MetaMask).');
        return;
    }
    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (!accounts || accounts.length === 0) return;

        state.wallet = accounts[0].toLowerCase();
        state.isFounder = FOUNDER_WHITELIST.includes(state.wallet);

        const btn = document.getElementById('btn-connect-wallet');
        btn.textContent = `${state.wallet.slice(0, 6)}...${state.wallet.slice(-4)}`;
        btn.classList.add('connected');

        const badge = document.getElementById('founder-status-badge');
        badge.textContent = state.isFounder
            ? 'MODO FUNDADOR • TAXA 0.00%'
            : 'CARTEIRA CONECTADA • TAXA 0.25%';
        badge.style.color = state.isFounder ? 'var(--emerald)' : 'var(--gold-accent)';

        await deriveVaultKey(state.wallet);
        await loadEncryptedVault();
        if (state.webhookUrl) {
            const whInput = document.getElementById('input-webhook-url');
            if (whInput) whInput.value = state.webhookUrl;
        }

        await syncAllChainsNow();
        runDayOneForensics();
    } catch (e) {}
}

function switchTab(tabName) {
    document.querySelectorAll('.nav-item').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-tab') === tabName);
    });
    document.querySelectorAll('.screen-view').forEach((v) => {
        v.classList.toggle('active', v.id === `view-${tabName}`);
    });
    triggerHaptic([12]);
}

const EDU_TEXTS = {
    patrimonio: {
        title: 'Patrimônio Líquido Real vs. Ilusório',
        body: 'Soma todo o seu saldo livre nas 5 redes mais o valor real das suas posições na Uniswap V3 e tarifas não colhidas. Toque no card do saldo para ver se seu patrimônio está realmente acima do dinheiro que saiu do seu bolso.'
    },
    meta: {
        title: 'Planejador de Meta Mensal',
        body: 'Converte o ritmo atual de geração de tarifas por minuto em projeção mensal para mostrar quanto das suas contas reais já está coberto pelo rendimento.'
    },
    escultor: {
        title: 'Escultor de Rendimento (R$/min)',
        body: 'Na Uniswap V3, quanto mais estreita a faixa entre Piso e Teto, maior sua fatia nas tarifas por minuto — porém maior a chance de o preço sair da faixa. Use o Simulador Reverso para descobrir quanto capital precisa para ganhar sua meta com segurança.'
    },
    allowance: {
        title: 'Escudo de Permissões (Zero Dreno)',
        body: 'Diferente de sites comuns que pedem permissão ilimitada, o RDESK aprova apenas o valor exato da operação. Aqui você audita e revoga qualquer autorização antiga em 1 clique.'
    }
};

function bindEvents() {
    document.getElementById('btn-connect-wallet').addEventListener('click', connectWallet);

    document.querySelectorAll('.nav-item').forEach((btn) => {
        btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
    });

    document.getElementById('btn-goto-motor').addEventListener('click', () => switchTab('motor'));

    // Alternador de Moeda (BRZ | BRLA | USD | R$)
    document.querySelectorAll('.curr-pill').forEach((pill) => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('.curr-pill').forEach((p) => p.classList.remove('active'));
            pill.classList.add('active');
            state.displayCurrency = pill.getAttribute('data-curr');
            saveEncryptedVault();
            recomputeSculptor();
            renderAllViews();
        });
    });

    // Olho Mágico (Privacidade)
    document.getElementById('btn-privacy-eye').addEventListener('click', (e) => {
        state.privacyHidden = !state.privacyHidden;
        e.currentTarget.classList.toggle('active', state.privacyHidden);
        applyPrivacyMask();
    });

    // Notificações Nativas
    document.getElementById('btn-notif-bell').addEventListener('click', async (e) => {
        if ('Notification' in window) {
            const perm = await Notification.requestPermission();
            state.notificationsEnabled = perm === 'granted';
            e.currentTarget.classList.toggle('active', state.notificationsEnabled);
        }
    });

    // Gaveta do Mini-Gráfico da Verdade
    document.getElementById('card-hero-balance').addEventListener('click', (e) => {
        if (e.target.closest('.help-trigger')) return;
        document.getElementById('truth-chart-drawer').classList.toggle('open');
        renderTruthChart();
    });

    // Editar Meta Mensal
    document.getElementById('btn-edit-goal').addEventListener('click', () => {
        const val = parseFloat(prompt('Qual sua meta de renda mensal em Reais (R$)?', String(state.monthlyGoalBrl)));
        if (Number.isFinite(val) && val > 0) {
            state.monthlyGoalBrl = val;
            saveEncryptedVault();
            renderAllViews();
        }
    });

    // Seletor do Simulador Duplo
    document.getElementById('mode-my-balance').addEventListener('click', () => {
        state.simulatorMode = 'my-balance';
        document.getElementById('mode-my-balance').classList.add('active');
        document.getElementById('mode-sim-capital').classList.remove('active');
        recomputeSculptor();
    });

    document.getElementById('mode-sim-capital').addEventListener('click', () => {
        state.simulatorMode = 'sim-capital';
        document.getElementById('mode-sim-capital').classList.add('active');
        document.getElementById('mode-my-balance').classList.remove('active');
        recomputeSculptor();
    });

    // Perfis 1-Clique
    document.querySelectorAll('.profile-pill').forEach((pill) => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('.profile-pill').forEach((p) => p.classList.remove('active'));
            pill.classList.add('active');
            state.riskProfile = pill.getAttribute('data-profile');
            state.customTargetBrlMin = null;
            document.getElementById('input-target-brl-min').value = '';
            saveEncryptedVault();
            recomputeSculptor();
        });
    });

    // Input Meta R$/minuto
    document.getElementById('input-target-brl-min').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.customTargetBrlMin = Number.isFinite(val) && val > 0 ? val : null;
        recomputeSculptor();
    });

    document.getElementById('btn-reset-target').addEventListener('click', () => {
        state.customTargetBrlMin = null;
        document.getElementById('input-target-brl-min').value = '';
        recomputeSculptor();
    });

    // Timeframes do Gráfico
    document.querySelectorAll('.tf-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tf-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            currentTf = btn.getAttribute('data-tf');
            currentTfSec = parseInt(btn.getAttribute('data-sec'), 10);
            liveCandle = null;
            loadKlines(currentTf);
        });
    });

    // Bottom Sheet: Raio-X Antes de Assinar
    document.getElementById('btn-open-xray').addEventListener('click', () => {
        const feePct = (getPlatformFeeBps() / 100).toFixed(2);
        document.getElementById('xray-out-val').textContent = formatInSelectedCurrency(sculptedPlan.deployableUsd);
        document.getElementById('xray-in-val').textContent =
            `${Math.round(sculptedPlan.targetWpolShare * 100)}% WPOL / ${Math.round(sculptedPlan.targetUsdtShare * 100)}% USDT0`;
        document.getElementById('xray-range-val').textContent =
            `${sculptedPlan.pMin.toFixed(5)} ↔ ${sculptedPlan.pMax.toFixed(5)}`;
        document.getElementById('xray-cost-val').textContent =
            `~R$ ${(market.dynamicGasReservePol * market.polUsd * market.usdBrl * 0.2).toFixed(2)} gás + ${feePct}% app`;
        document.getElementById('autopilot-exec-log').textContent = '';
        document.getElementById('sheet-xray').classList.add('open');
    });

    document.getElementById('btn-close-xray').addEventListener('click', () => {
        document.getElementById('sheet-xray').classList.remove('open');
    });

    document.getElementById('btn-confirm-execute').addEventListener('click', executeAutoPilotStrategy);

    // Ajuda Educativa Contextual (?)
    document.querySelectorAll('.help-trigger').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const key = btn.getAttribute('data-edu');
            const info = EDU_TEXTS[key];
            if (info) {
                document.getElementById('edu-sheet-title').textContent = info.title;
                document.getElementById('edu-sheet-body').textContent = info.body;
                document.getElementById('sheet-edu').classList.add('open');
            }
        });
    });

    document.getElementById('btn-close-edu').addEventListener('click', () => {
        document.getElementById('sheet-edu').classList.remove('open');
    });

    // Sub-abas da Tela Caixa
    document.querySelectorAll('.subtab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.subtab-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            const target = btn.getAttribute('data-sub');
            document.querySelectorAll('.subview').forEach((v) => v.classList.toggle('active', v.id === `sub-${target}`));
        });
    });

    // Alternador Bridge Web3 vs BTC/Lightning
    document.getElementById('bridge-mode-web3').addEventListener('click', () => {
        document.getElementById('bridge-mode-web3').classList.add('active');
        document.getElementById('bridge-mode-btc').classList.remove('active');
        document.getElementById('panel-bridge-web3').style.display = 'flex';
        document.getElementById('panel-bridge-btc').style.display = 'none';
    });

    document.getElementById('bridge-mode-btc').addEventListener('click', () => {
        document.getElementById('bridge-mode-btc').classList.add('active');
        document.getElementById('bridge-mode-web3').classList.remove('active');
        document.getElementById('panel-bridge-btc').style.display = 'flex';
        document.getElementById('panel-bridge-web3').style.display = 'none';
    });

    // Bridge & Swap Listeners
    ['bridge-from-asset', 'bridge-to-asset', 'bridge-amount-in'].forEach((id) => {
        document.getElementById(id).addEventListener('input', refreshBridgeQuote);
        document.getElementById(id).addEventListener('change', refreshBridgeQuote);
    });

    document.getElementById('btn-bridge-max').addEventListener('click', () => {
        const [chainStr, sym] = document.getElementById('bridge-from-asset').value.split(':');
        const cId = Number(chainStr);
        const bal = balances[cId]?.[sym] || 0;
        const usable = sym === 'POL' ? Math.max(0, bal - market.dynamicGasReservePol) : bal;
        document.getElementById('bridge-amount-in').value = usable.toFixed(4);
        refreshBridgeQuote();
    });

    document.getElementById('btn-exec-bridge').addEventListener('click', executeBridgeOrSwap);
    document.getElementById('btn-create-btc-order').addEventListener('click', createNativeBtcOrLightningOrder);
    document.getElementById('btn-copy-btc-addr').addEventListener('click', () => {
        const txt = document.getElementById('btc-deposit-addr').textContent;
        navigator.clipboard.writeText(txt).catch(() => {});
        triggerHaptic([20]);
    });

    // PIX Listeners
    document.getElementById('pix-target-brl').addEventListener('input', renderPixRoutes);
    document.getElementById('btn-pix-nokyc').addEventListener('click', (e) => {
        state.onlyNoKycPix = !state.onlyNoKycPix;
        e.currentTarget.textContent = state.onlyNoKycPix ? 'FILTRO: SEM KYC' : 'FILTRO: TODAS';
        renderPixRoutes();
    });
    document.getElementById('btn-pix-use-fees').addEventListener('click', () => {
        const feesBrl = balances.unclaimedFeesUsd * market.usdBrl;
        document.getElementById('pix-target-brl').value = Math.max(1, feesBrl).toFixed(2);
        renderPixRoutes();
    });

    // Pools & Auditoria Listeners
    document.getElementById('btn-refresh-pools').addEventListener('click', syncAllChainsNow);
    document.getElementById('btn-run-forensics').addEventListener('click', runDayOneForensics);
    document.getElementById('btn-save-webhook').addEventListener('click', () => {
        const url = document.getElementById('input-webhook-url').value.trim();
        if (url && !url.startsWith('https://')) {
            alert('Por segurança, o Webhook deve começar com https://');
            return;
        }
        state.webhookUrl = url;
        saveEncryptedVault();
        triggerHaptic([20]);
    });

    // Exportar / Importar Cofre JSON
    document.getElementById('btn-export-vault').addEventListener('click', () => {
        const cleanExport = {
            monthlyGoalBrl: state.monthlyGoalBrl,
            displayCurrency: state.displayCurrency,
            riskProfile: state.riskProfile,
            forensics: state.forensics
        };
        const blob = new Blob([JSON.stringify(cleanExport, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `rdesk-cofre-${new Date().toISOString().slice(0, 10)}.rdesk`;
        a.click();
    });

    document.getElementById('btn-import-vault').addEventListener('click', () => {
        document.getElementById('file-import-vault').click();
    });

    document.getElementById('file-import-vault').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file || file.size > 262144) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const imported = JSON.parse(ev.target.result);
                if (Number.isFinite(imported.monthlyGoalBrl)) state.monthlyGoalBrl = imported.monthlyGoalBrl;
                if (imported.forensics) state.forensics = imported.forensics;
                saveEncryptedVault();
                renderAllViews();
            } catch (err) {}
        };
        reader.readAsText(file);
    });

    if (window.ethereum) {
        window.ethereum.on('accountsChanged', (accs) => {
            if (accs && accs.length > 0) connectWallet();
        });
    }
}

// =========================================================================
// 15. INICIALIZAÇÃO DO PWA & LOOPS EM TEMPO REAL
// =========================================================================
window.addEventListener('DOMContentLoaded', async () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    const urlParams = new URLSearchParams(window.location.search);
    const startTab = urlParams.get('tab');
    if (startTab && ['cofre', 'motor', 'pools', 'caixa'].includes(startTab)) {
        switchTab(startTab);
    }

    bindEvents();
    initChart();
    await refreshMarketOracles();
    renderPixRoutes();
    renderAllViews();
    startBinanceWebSocket();

    setInterval(refreshMarketOracles, 25000);
    setInterval(() => {
        if (state.wallet) syncAllChainsNow();
    }, 15000);
});
