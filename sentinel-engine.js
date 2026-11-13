const SYMBOL = 'POLUSDT';
const POOL_ADDRESS = '0x9b08288c3be4f62bbf8d1c20ac9c5e6f9467d8b7';
const POOL_FEE_TIER = 500;      // 0.05%
const POOL_TICK_SPACING = 10;   // Tick spacing oficial para fee 500
const GAS_RESERVE_POL = 1.5;    // Reserva obrigatória de gás na carteira

// Contratos Oficiais Uniswap V3 na Polygon Mainnet (Chain ID 137)
const UNISWAP_SWAP_ROUTER_02 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
const UNISWAP_QUOTER_V2      = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';
const NFPM_ADDRESS           = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';

const TOKENS = {
    POL:   { symbol: 'POL',   address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
    WPOL:  { symbol: 'WPOL',  address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', decimals: 18, isNative: false },
    USDT0: { symbol: 'USDT0', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6,  isNative: false },
    BRZ:   { symbol: 'BRZ',   address: '0x4eD141110F6EeeAbA9A1df36d8c26f684d2475Dc', decimals: 18, isNative: false },
    BRLA:  { symbol: 'BRLA',  address: '0xE6A537a407488807F0bbeb0038B79004f19DDDFb', decimals: 18, isNative: false }
};

const POL_ADDRESS = TOKENS.WPOL.address.toLowerCase();
const USDT_ADDRESS = TOKENS.USDT0.address.toLowerCase();

const POLYGON_RPCS = [
    'https://polygon-bor-rpc.publicnode.com',
    'https://1rpc.io/matic',
    'https://polygon.drpc.org',
    'https://polygon-rpc.com'
];

const UNISWAP_FEES = [500, 3000, 10000, 100];

const Q128 = ethers.BigNumber.from(2).pow(128);
const MAX_UINT256 = ethers.constants.MaxUint256;
const MAX_UINT128 = ethers.BigNumber.from('0xffffffffffffffffffffffffffffffff');

const swapABI = ["event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)"];
const iface = new ethers.utils.Interface(swapABI);
const SWAP_TOPIC = iface.getEventTopic("Swap");

let currentPriceGlobal = 0, lastPriceGlobal = 0;
let usdBrlCommercial = 5.65;
let usdtToBrzRate = 5.65;
let usdtToBrlaRate = 5.65;
let binanceUsdtBrlBid = 5.64;

let audioEnabled = false, audioCtx = null;
let currentRiskState = 'SAFE';
let connectedSignerAddress = null;
let onlyNoKycFilter = false;
let isAutoPilotRunning = false;

let appState = {
    wallet: '',
    web3Positions: [],
    manualPositions: [],
    focusedId: null,
    pnlOverrides: {}
};

let walletBalances = { pol: 0, wpol: 0, usdt0: 0, brz: 0, brla: 0 };
let totalUnclaimedFeesUsd = 0;
let focusedPositionTotalUsd = 0;
let focusedPositionFeesUsd = 0;

let activeSwapQuote = null;
let swapDebounceTimer = null;

let sniperTelemetry = {
    atr14: 0,
    downWeight: 0.5,
    upWeight: 0.5,
    regimeText: 'LATERAL 50/50',
    min: 0,
    max: 0
};

let autoPilotPlan = null;

let chart = null, candleSeries = null;
let positionLines = [];
let currentInterval = '15m', currentIntervalSeconds = 900;
let syntheticCandle = null;

const priceGlobalEl = document.getElementById('price-global');
const tapeEl = document.getElementById('tape');
const routeStatusEl = document.getElementById('route-status');

const VAR_INTERVALS = [
    { label: '1 MIN', key: '1m' }, { label: '5 MIN', key: '5m' }, { label: '15 MIN', key: '15m' },
    { label: '30 MIN', key: '30m' }, { label: '1 HORA', key: '1h' }, { label: '4 HORAS', key: '4h' },
    { label: '8 HORAS', key: '8h' }, { label: '12 HORAS', key: '12h' }, { label: '1 DIA', key: '1d' },
    { label: '1 SEM', key: '1w' }, { label: '1 MÊS', key: '1M' }
];

// =========================================================================
// UTILITÁRIOS RPC & MATEMÁTICA UNISWAP V3
// =========================================================================
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout RPC')), ms))
    ]);
}

function getReadProvider() {
    if (window.ethereum && connectedSignerAddress) {
        return new ethers.providers.Web3Provider(window.ethereum);
    }
    return new ethers.providers.JsonRpcProvider(POLYGON_RPCS[0]);
}

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
    } else {
        return {
            min: 1 / (Math.pow(1.0001, Number(tickUpper)) * 1e12),
            max: 1 / (Math.pow(1.0001, Number(tickLower)) * 1e12)
        };
    }
}

function getMotherRate() {
    return usdtToBrzRate > 0 ? usdtToBrzRate : usdBrlCommercial;
}

// =========================================================================
// COTAÇÃO ON-CHAIN DIRETA NO QUOTERV2 DA UNISWAP V3
// =========================================================================
async function quoteUniswapV3OnChain(symIn, symOut, amountWei) {
    const provider = getReadProvider();

    if ((symIn === 'POL' && symOut === 'WPOL') || (symIn === 'WPOL' && symOut === 'POL')) {
        return {
            mode: 'WRAP_UNWRAP',
            amountOutWei: amountWei,
            feeTier: 0,
            viaUsdt: false
        };
    }

    const tokenInAddr = symIn === 'POL' ? TOKENS.WPOL.address : TOKENS[symIn].address;
    const tokenOutAddr = symOut === 'POL' ? TOKENS.WPOL.address : TOKENS[symOut].address;

    const quoterAbi = [
        "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
        "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"
    ];
    const quoter = new ethers.Contract(UNISWAP_QUOTER_V2, quoterAbi, provider);

    let bestDirect = null;
    for (const fee of UNISWAP_FEES) {
        try {
            const res = await withTimeout(quoter.callStatic.quoteExactInputSingle({
                tokenIn: tokenInAddr,
                tokenOut: tokenOutAddr,
                amountIn: amountWei,
                fee: fee,
                sqrtPriceLimitX96: 0
            }), 4500);
            if (res && res.amountOut && res.amountOut.gt(0)) {
                if (!bestDirect || res.amountOut.gt(bestDirect.amountOutWei)) {
                    bestDirect = {
                        mode: 'SINGLE',
                        amountOutWei: res.amountOut,
                        feeTier: fee,
                        viaUsdt: false
                    };
                }
            }
        } catch (e) {}
    }

    if (bestDirect) return bestDirect;

    if (tokenInAddr.toLowerCase() !== USDT_ADDRESS && tokenOutAddr.toLowerCase() !== USDT_ADDRESS) {
        const candidatePairs = [
            [3000, 500],
            [500, 500],
            [10000, 500],
            [3000, 3000]
        ];
        for (const [fee1, fee2] of candidatePairs) {
            try {
                const encodedPath = ethers.utils.solidityPack(
                    ['address', 'uint24', 'address', 'uint24', 'address'],
                    [tokenInAddr, fee1, TOKENS.USDT0.address, fee2, tokenOutAddr]
                );
                const res = await withTimeout(quoter.callStatic.quoteExactInput(encodedPath, amountWei), 4500);
                if (res && res.amountOut && res.amountOut.gt(0)) {
                    return {
                        mode: 'MULTIHOP',
                        amountOutWei: res.amountOut,
                        pathBytes: encodedPath,
                        feeTier: `${fee1}/${fee2}`,
                        viaUsdt: true
                    };
                }
            } catch (e) {}
        }
    }

    throw new Error('Sem pool Uniswap V3 ativa para este par.');
}

// =========================================================================
// EXECUÇÃO ON-CHAIN NO SWAPROUTER02 COM APROVAÇÃO EXATA (SEM MAX_UINT256)
// =========================================================================
async function executeUniswapV3Swap(symIn, symOut, amountWei, quoteObj, signer, onStatus) {
    if (quoteObj.mode === 'WRAP_UNWRAP') {
        const wpolC = new ethers.Contract(TOKENS.WPOL.address, [
            "function deposit() payable",
            "function withdraw(uint256 wad)"
        ], signer);

        if (symIn === 'POL') {
            if (onStatus) onStatus('Assine na Rabby: converter POL → WPOL (1:1)...');
            const tx = await wpolC.deposit({ value: amountWei });
            await tx.wait();
            return tx;
        } else {
            if (onStatus) onStatus('Assine na Rabby: converter WPOL → POL (1:1)...');
            const tx = await wpolC.withdraw(amountWei);
            await tx.wait();
            return tx;
        }
    }

    const tokIn = TOKENS[symIn];
    const tokenInAddr = tokIn.isNative ? TOKENS.WPOL.address : tokIn.address;
    const tokenOutAddr = symOut === 'POL' ? TOKENS.WPOL.address : TOKENS[symOut].address;

    if (!tokIn.isNative) {
        const erc20 = new ethers.Contract(tokIn.address, [
            "function allowance(address, address) view returns (uint256)",
            "function approve(address spender, uint256 amount) returns (bool)"
        ], signer);
        const allow = await erc20.allowance(connectedSignerAddress, UNISWAP_SWAP_ROUTER_02);
        if (allow.lt(amountWei)) {
            if (onStatus) onStatus(`Assine na Rabby: aprovar ${symIn} exato para Uniswap V3...`);
            const appTx = await erc20.approve(UNISWAP_SWAP_ROUTER_02, amountWei);
            await appTx.wait();
        }
    }

    const minOut = quoteObj.amountOutWei.mul(988).div(1000);
    const routerAbi = [
        "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
        "function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
        "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
        "function multicall(bytes[] data) payable returns (bytes[] results)"
    ];
    const router = new ethers.Contract(UNISWAP_SWAP_ROUTER_02, routerAbi, signer);
    const txOverrides = tokIn.isNative ? { value: amountWei } : {};
    const recipient = symOut === 'POL' ? UNISWAP_SWAP_ROUTER_02 : connectedSignerAddress;

    if (onStatus) onStatus(`Confirme a troca ${symIn} → ${symOut} na Rabby Wallet...`);

    if (quoteObj.mode === 'SINGLE') {
        const swapParams = {
            tokenIn: tokenInAddr,
            tokenOut: tokenOutAddr,
            fee: quoteObj.feeTier,
            recipient: recipient,
            amountIn: amountWei,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        };

        if (symOut === 'POL') {
            const d1 = router.interface.encodeFunctionData('exactInputSingle', [swapParams]);
            const d2 = router.interface.encodeFunctionData('unwrapWETH9', [minOut, connectedSignerAddress]);
            const tx = await router.multicall([d1, d2], txOverrides);
            await tx.wait();
            return tx;
        } else {
            const tx = await router.exactInputSingle(swapParams, txOverrides);
            await tx.wait();
            return tx;
        }
    } else {
        const multiParams = {
            path: quoteObj.pathBytes,
            recipient: recipient,
            amountIn: amountWei,
            amountOutMinimum: minOut
        };

        if (symOut === 'POL') {
            const d1 = router.interface.encodeFunctionData('exactInput', [multiParams]);
            const d2 = router.interface.encodeFunctionData('unwrapWETH9', [minOut, connectedSignerAddress]);
            const tx = await router.multicall([d1, d2], txOverrides);
            await tx.wait();
            return tx;
        } else {
            const tx = await router.exactInput(multiParams, txOverrides);
            await tx.wait();
            return tx;
        }
    }
}

// =========================================================================
// ORÁCULO MOEDA MÃE (BRZ & BRLA ON-CHAIN VIA UNISWAP QUOTER + BRL REAL)
// =========================================================================
async function refreshMotherCurrencyOracle() {
    try {
        const res = await withTimeout(fetch('https://economia.awesomeapi.com.br/last/USD-BRL'), 4000);
        const json = await res.json();
        if (json?.USDBRL?.bid) {
            usdBrlCommercial = parseFloat(json.USDBRL.bid);
        }
    } catch (e) {}

    try {
        const bRes = await withTimeout(fetch('https://api.binance.com/api/v3/ticker/bookTicker?symbol=USDTBRL'), 4000);
        const bJson = await bRes.json();
        if (bJson?.bidPrice) {
            binanceUsdtBrlBid = parseFloat(bJson.bidPrice);
        }
    } catch (e) {}

    try {
        const oneHundredUsdt = ethers.utils.parseUnits('100', 6);
        const [qBrz, qBrla] = await Promise.all([
            quoteUniswapV3OnChain('USDT0', 'BRZ', oneHundredUsdt).catch(() => null),
            quoteUniswapV3OnChain('USDT0', 'BRLA', oneHundredUsdt).catch(() => null)
        ]);

        usdtToBrzRate = qBrz?.amountOutWei
            ? parseFloat(ethers.utils.formatUnits(qBrz.amountOutWei, 18)) / 100
            : usdBrlCommercial;

        usdtToBrlaRate = qBrla?.amountOutWei
            ? parseFloat(ethers.utils.formatUnits(qBrla.amountOutWei, 18)) / 100
            : usdBrlCommercial;
    } catch (e) {
        usdtToBrzRate = usdBrlCommercial;
        usdtToBrlaRate = usdBrlCommercial;
    }

    document.getElementById('top-usd-brl').textContent = `R$ ${usdBrlCommercial.toFixed(3)}`;
    document.getElementById('top-usdt-brz').textContent = `${usdtToBrzRate.toFixed(3)} BRZ`;
    document.getElementById('top-usdt-brla').textContent = `${usdtToBrlaRate.toFixed(3)} BRLA`;

    recomputeAutoPilotPlan();
    updateFocusedMetrics();
    recalculateRealPnL();
    recalculatePixRanking();
}

// =========================================================================
// CONEXÃO DIRETA COM RABBY WALLET / EIP-1193
// =========================================================================
async function connectWeb3Wallet() {
    const btn = document.getElementById('btn-connect-wallet');
    if (!window.ethereum) {
        alert('Nenhuma carteira Web3 detectada. Ative sua Rabby Wallet ou MetaMask.');
        return false;
    }
    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (!accounts || accounts.length === 0) return false;

        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x89' }]
            });
        } catch (switchErr) {
            if (switchErr.code === 4902) {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: '0x89',
                        chainName: 'Polygon Mainnet',
                        nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
                        rpcUrls: ['https://polygon-bor-rpc.publicnode.com'],
                        blockExplorerUrls: ['https://polygonscan.com/']
                    }]
                });
            }
        }

        connectedSignerAddress = accounts[0].toLowerCase();
        appState.wallet = connectedSignerAddress;
        document.getElementById('wallet-address').value = connectedSignerAddress;

        const walletLabel = window.ethereum.isRabby ? 'RABBY' : 'WEB3';
        btn.textContent = `● ${walletLabel} ${connectedSignerAddress.slice(0, 5)}..${connectedSignerAddress.slice(-3)}`;
        btn.classList.add('wallet-connected');

        saveTripleBackup();
        await runUnstoppableScan();
        refreshSwapQuote();
        return true;
    } catch (err) {
        console.error(err);
        return false;
    }
}

document.getElementById('btn-connect-wallet').addEventListener('click', connectWeb3Wallet);

if (window.ethereum) {
    window.ethereum.on('accountsChanged', (accs) => {
        if (accs && accs.length > 0) {
            connectedSignerAddress = accs[0].toLowerCase();
            appState.wallet = connectedSignerAddress;
            document.getElementById('wallet-address').value = connectedSignerAddress;
            const btn = document.getElementById('btn-connect-wallet');
            const walletLabel = window.ethereum.isRabby ? 'RABBY' : 'WEB3';
            btn.textContent = `● ${walletLabel} ${connectedSignerAddress.slice(0, 5)}..${connectedSignerAddress.slice(-3)}`;
            btn.classList.add('wallet-connected');
            runUnstoppableScan();
            refreshSwapQuote();
        }
    });
}

// =========================================================================
// PILOTO AUTOMÁTICO 100% UNISWAP V3 (MULTI-STEP + SIMULAÇÃO ANTI-REVERT)
// =========================================================================
function recomputeAutoPilotPlan(onChainPoolPrice) {
    const capEl = document.getElementById('ap-available-capital');
    const summaryEl = document.getElementById('ap-plan-summary');
    const btnEl = document.getElementById('btn-start-earning');

    if (!capEl || !summaryEl || !btnEl) return;

    if (!connectedSignerAddress && !appState.wallet) {
        capEl.textContent = 'Capital Livre: 0.00 BRZ';
        summaryEl.textContent = 'Conecte sua Rabby Wallet para calcular o plano de liquidez 100% Uniswap V3 com reserva de gás (1.5 POL).';
        if (!isAutoPilotRunning) btnEl.textContent = 'CONECTAR RABBY & COMEÇAR A GANHAR';
        autoPilotPlan = null;
        return;
    }

    const price = (onChainPoolPrice && onChainPoolPrice > 0)
        ? onChainPoolPrice
        : (currentPriceGlobal > 0 ? currentPriceGlobal : 0.087);
    const motherRate = getMotherRate();

    const usablePol = Math.max(0, walletBalances.pol - GAS_RESERVE_POL);
    const valPolUsd = usablePol * price;
    const valWpolUsd = walletBalances.wpol * price;
    const valUsdtUsd = walletBalances.usdt0;
    const valBrzUsd = walletBalances.brz / motherRate;
    const valBrlaUsd = walletBalances.brla / (usdtToBrlaRate > 0 ? usdtToBrlaRate : motherRate);

    const totalDeployableUsd = valPolUsd + valWpolUsd + valUsdtUsd + valBrzUsd + valBrlaUsd;
    const totalDeployableBrz = totalDeployableUsd * motherRate;

    capEl.textContent = `Capital Livre: ${totalDeployableBrz.toFixed(2)} BRZ ($${totalDeployableUsd.toFixed(2)})`;

    if (totalDeployableUsd < 1.0) {
        summaryEl.textContent = `Saldo livre insuficiente ($${totalDeployableUsd.toFixed(2)}). Mantenha pelo menos 1.5 POL para gás + capital disponível.`;
        autoPilotPlan = null;
        return;
    }

    const halfSpanDefault = price * 0.025;
    const rawMin = sniperTelemetry.min > 0 ? Math.min(sniperTelemetry.min, price - halfSpanDefault * 0.6) : (price - halfSpanDefault);
    const rawMax = sniperTelemetry.max > 0 ? Math.max(sniperTelemetry.max, price + halfSpanDefault * 0.6) : (price + halfSpanDefault);

    let tickLower = humanPriceToAlignedTick(rawMin, true, false);
    let tickUpper = humanPriceToAlignedTick(rawMax, true, true);
    if (tickUpper - tickLower < POOL_TICK_SPACING * 4) {
        tickLower -= POOL_TICK_SPACING * 2;
        tickUpper += POOL_TICK_SPACING * 2;
    }

    const alignedPrices = ticksToHumanPrice(tickLower, tickUpper, true);
    const pMin = alignedPrices.min;
    const pMax = alignedPrices.max;

    const sqrtP = Math.sqrt(price);
    const sqrtA = Math.sqrt(pMin);
    const sqrtB = Math.sqrt(pMax);

    let targetUsdtShare = 0.5;
    if (price <= pMin) targetUsdtShare = 0.0;
    else if (price >= pMax) targetUsdtShare = 1.0;
    else {
        const amt0 = (1 / sqrtP) - (1 / sqrtB);
        const amt1 = sqrtP - sqrtA;
        const v0 = amt0 * price;
        const v1 = amt1;
        targetUsdtShare = v1 / (v0 + v1);
    }
    const targetWpolShare = 1 - targetUsdtShare;

    const targetUsdtUsd = totalDeployableUsd * targetUsdtShare;
    const targetWpolUsd = totalDeployableUsd * targetWpolShare;

    const swapSteps = [];

    if (valBrzUsd > 0.35) {
        swapSteps.push({ fromSym: 'BRZ', toSym: 'USDT0', amountFloat: walletBalances.brz });
    }
    if (valBrlaUsd > 0.35) {
        swapSteps.push({ fromSym: 'BRLA', toSym: 'USDT0', amountFloat: walletBalances.brla });
    }

    const projectedUsdtUsd = valUsdtUsd + valBrzUsd + valBrlaUsd;
    const projectedWpolUsd = valWpolUsd;

    if (projectedUsdtUsd > targetUsdtUsd + 0.45) {
        const usdtToSwapForWpol = Math.min(projectedUsdtUsd, projectedUsdtUsd - targetUsdtUsd);
        if (usdtToSwapForWpol > 0.35) {
            swapSteps.push({ fromSym: 'USDT0', toSym: 'WPOL', amountFloat: usdtToSwapForWpol });
        }
    } else if (projectedWpolUsd > targetWpolUsd + 0.45) {
        const wpolToSwapForUsdt = Math.min(walletBalances.wpol, (projectedWpolUsd - targetWpolUsd) / price);
        if (wpolToSwapForUsdt > 1.0) {
            swapSteps.push({ fromSym: 'WPOL', toSym: 'USDT0', amountFloat: wpolToSwapForUsdt });
        }
    } else if (valPolUsd > 0.8 && projectedWpolUsd < targetWpolUsd - 0.45) {
        const polNeededUsd = Math.min(valPolUsd, targetWpolUsd - projectedWpolUsd);
        if (polNeededUsd > 0.35) {
            swapSteps.push({ fromSym: 'POL', toSym: 'WPOL', amountFloat: polNeededUsd / price });
        }
    }

    autoPilotPlan = {
        totalDeployableUsd,
        totalDeployableBrz,
        tickLower,
        tickUpper,
        pMin,
        pMax,
        targetWpolShare,
        targetUsdtShare,
        swapSteps
    };

    const actionDesc = swapSteps.length > 0
        ? `Ajuste V3: ${swapSteps.map(s => `${s.amountFloat.toFixed(2)} ${s.fromSym}→${s.toSym}`).join(' + ')}`
        : `Balanceado (${Math.round(targetWpolShare*100)}% WPOL / ${Math.round(targetUsdtShare*100)}% USDT0)`;

    summaryEl.textContent = `Faixa: ${pMin.toFixed(5)} ↔ ${pMax.toFixed(5)} | ${actionDesc}`;
    if (!isAutoPilotRunning) {
        btnEl.textContent = 'COMEÇAR A GANHAR (UNISWAP V3)';
    }
}

function setAutoPilotStepUI(activeStep, logMessage, isError) {
    const stepper = document.getElementById('ap-stepper');
    const logEl = document.getElementById('ap-status-log');
    stepper.style.display = 'grid';

    [1, 2, 3].forEach(n => {
        const el = document.getElementById(`ap-step-${n}`);
        el.classList.remove('active', 'done');
        if (n < activeStep) el.classList.add('done');
        else if (n === activeStep) el.classList.add('active');
    });

    logEl.style.color = isError ? 'var(--danger-red)' : (activeStep === 4 ? 'var(--success-green)' : 'var(--cyan-accent)');
    logEl.textContent = logMessage;
}

async function getExactOnChainPoolPrice(provider) {
    try {
        const pool = new ethers.Contract(POOL_ADDRESS, [
            "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"
        ], provider);
        const slot0 = await withTimeout(pool.slot0(), 4000);
        const tick = Number(slot0.tick);
        return Math.pow(1.0001, tick) * 1e12;
    } catch (e) {
        return currentPriceGlobal;
    }
}

async function runAutoPilotWorkflow() {
    if (isAutoPilotRunning) return;

    if (!connectedSignerAddress) {
        const ok = await connectWeb3Wallet();
        if (!ok) return;
    }

    const btn = document.getElementById('btn-start-earning');
    isAutoPilotRunning = true;
    btn.disabled = true;
    btn.textContent = 'EXECUTANDO NA UNISWAP V3...';

    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const signer = provider.getSigner();

    try {
        setAutoPilotStepUI(1, 'Lendo preço real e saldos na Polygon...', false);
        await refreshLivePoolFeesAndBalances();
        const realPoolPrice = await getExactOnChainPoolPrice(provider);
        recomputeAutoPilotPlan(realPoolPrice);

        if (!autoPilotPlan) {
            throw new Error('Saldo livre insuficiente (mantenha pelo menos 1.5 POL para gás + capital).');
        }

        for (let i = 0; i < autoPilotPlan.swapSteps.length; i++) {
            const act = autoPilotPlan.swapSteps[i];
            const tokIn = TOKENS[act.fromSym];

            await refreshLivePoolFeesAndBalances();
            const liveAvail = walletBalances[act.fromSym.toLowerCase()] || 0;
            const safeAmount = act.fromSym === 'POL'
                ? Math.min(act.amountFloat, Math.max(0, liveAvail - GAS_RESERVE_POL))
                : Math.min(act.amountFloat, liveAvail);

            if (safeAmount <= 0.05) continue;

            const amountWei = ethers.utils.parseUnits(safeAmount.toFixed(tokIn.decimals), tokIn.decimals);
            setAutoPilotStepUI(2, `Passo ${i+1}/${autoPilotPlan.swapSteps.length}: Cotando ${act.fromSym} → ${act.toSym} na Uniswap V3...`, false);

            const quoteObj = await quoteUniswapV3OnChain(act.fromSym, act.toSym, amountWei);
            await executeUniswapV3Swap(act.fromSym, act.toSym, amountWei, quoteObj, signer, (msg) => {
                setAutoPilotStepUI(2, msg, false);
            });
        }

        const wpolC = new ethers.Contract(TOKENS.WPOL.address, [
            "function balanceOf(address) view returns (uint256)",
            "function allowance(address, address) view returns (uint256)",
            "function approve(address spender, uint256 amount) returns (bool)"
        ], signer);
        const usdtC = new ethers.Contract(TOKENS.USDT0.address, [
            "function balanceOf(address) view returns (uint256)",
            "function allowance(address, address) view returns (uint256)",
            "function approve(address spender, uint256 amount) returns (bool)"
        ], signer);

        const [balWpolBN, balUsdtBN] = await Promise.all([
            wpolC.balanceOf(connectedSignerAddress),
            usdtC.balanceOf(connectedSignerAddress)
        ]);

        if (balWpolBN.isZero() || balUsdtBN.isZero()) {
            throw new Error(`Balanceamento incompleto (WPOL: ${ethers.utils.formatUnits(balWpolBN, 18)}, USDT0: ${ethers.utils.formatUnits(balUsdtBN, 6)}). Clique novamente para completar.`);
        }

        setAutoPilotStepUI(2, 'Verificando aprovações exatas na Uniswap V3...', false);
        const allow0 = await wpolC.allowance(connectedSignerAddress, NFPM_ADDRESS);
        if (allow0.lt(balWpolBN)) {
            setAutoPilotStepUI(2, 'Assine na Rabby: aprovar WPOL exato para Uniswap V3...', false);
            const tx0 = await wpolC.approve(NFPM_ADDRESS, balWpolBN);
            await tx0.wait();
        }

        const allow1 = await usdtC.allowance(connectedSignerAddress, NFPM_ADDRESS);
        if (allow1.lt(balUsdtBN)) {
            setAutoPilotStepUI(2, 'Assine na Rabby: aprovar USDT0 exato para Uniswap V3...', false);
            const tx1 = await usdtC.approve(NFPM_ADDRESS, balUsdtBN);
            await tx1.wait();
        }

        setAutoPilotStepUI(3, 'Simulando posição na Uniswap V3 (proteção anti-revert & anti-MEV)...', false);
        const nfpmMint = new ethers.Contract(NFPM_ADDRESS, [
            "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)"
        ], signer);

        const deadline = Math.floor(Date.now() / 1000) + 1200;
        const baseMintParams = {
            token0: TOKENS.WPOL.address,
            token1: TOKENS.USDT0.address,
            fee: POOL_FEE_TIER,
            tickLower: autoPilotPlan.tickLower,
            tickUpper: autoPilotPlan.tickUpper,
            amount0Desired: balWpolBN,
            amount1Desired: balUsdtBN,
            amount0Min: 0,
            amount1Min: 0,
            recipient: connectedSignerAddress,
            deadline
        };

        const simRes = await nfpmMint.callStatic.mint(baseMintParams);
        if (!simRes || simRes.liquidity.isZero()) {
            throw new Error('Liquidez simulada igual a zero. Aumente o capital ou tente novamente.');
        }

        const protectedMintParams = {
            ...baseMintParams,
            amount0Min: simRes.amount0.mul(985).div(1000),
            amount1Min: simRes.amount1.mul(985).div(1000)
        };

        setAutoPilotStepUI(3, 'Assine na Rabby: abrir pool WPOL/USDT0 (0.05%)...', false);
        const mintTx = await nfpmMint.mint(protectedMintParams, { gasLimit: 650000 });

        setAutoPilotStepUI(3, `Enviada (${mintTx.hash.slice(0, 10)}...) Confirmando na Polygon...`, false);
        const receipt = await mintTx.wait();
        const gasPaidPol = parseFloat(ethers.utils.formatEther(receipt.gasUsed.mul(receipt.effectiveGasPrice)));

        setAutoPilotStepUI(4, 'SUCESSO! Posição aberta e rendendo tarifas na Uniswap V3!', false);
        playBeep(1318, 0.35, 'sine');

        await runUnstoppableScan();
        if (appState.focusedId) {
            appState.pnlOverrides[appState.focusedId] = {
                initBrz: Number(autoPilotPlan.totalDeployableBrz.toFixed(2)),
                openGasPol: Number(gasPaidPol.toFixed(5)),
                autoChecked: true
            };
            saveTripleBackup();
            syncPnlInputsWithFocused();
            recalculateRealPnL();
        }
    } catch (err) {
        const cleanMsg = err?.error?.message || err?.reason || err?.message || 'Operação cancelada ou revertida.';
        setAutoPilotStepUI(1, cleanMsg, true);
    } finally {
        isAutoPilotRunning = false;
        btn.disabled = false;
        btn.textContent = 'COMEÇAR A GANHAR (UNISWAP V3)';
    }
}

document.getElementById('btn-start-earning').addEventListener('click', runAutoPilotWorkflow);

// =========================================================================
// EXECUÇÃO ON-CHAIN UNISWAP V3: COLHER TARIFAS, WITHDRAW & REBALANCEAR
// =========================================================================
async function executeCollectFeesOnChain(tokenId, e) {
    if (e) e.stopPropagation();
    if (!connectedSignerAddress) {
        const ok = await connectWeb3Wallet();
        if (!ok) return;
    }

    const feedbackEl = document.getElementById('nft-tx-feedback');
    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();
        const nfpm = new ethers.Contract(NFPM_ADDRESS, [
            "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)"
        ], signer);

        feedbackEl.style.color = 'var(--cyan-accent)';
        feedbackEl.textContent = `Simulando coleta NFT #${tokenId} na Rabby Wallet...`;

        const tx = await nfpm.collect({
            tokenId: ethers.BigNumber.from(tokenId),
            recipient: connectedSignerAddress,
            amount0Max: MAX_UINT128,
            amount1Max: MAX_UINT128
        });

        feedbackEl.textContent = `Coleta enviada (${tx.hash.slice(0, 10)}...) Aguardando bloco...`;
        await tx.wait();

        feedbackEl.style.color = 'var(--success-green)';
        feedbackEl.textContent = `Tarifas do NFT #${tokenId} recolhidas direto para sua carteira!`;
        playBeep(1174, 0.25, 'sine');
        await refreshLivePoolFeesAndBalances();
    } catch (err) {
        feedbackEl.style.color = 'var(--danger-red)';
        feedbackEl.textContent = err.reason || err.message || 'Coleta cancelada.';
    }
}

async function executeWithdrawPositionOnChain(tokenId, e, skipConfirm = false) {
    if (e) e.stopPropagation();
    if (!connectedSignerAddress) {
        const ok = await connectWeb3Wallet();
        if (!ok) return false;
    }

    if (!skipConfirm) {
        const ok = confirm(`Deseja fechar 100% da posição NFT #${tokenId} e sacar todo o capital + tarifas para sua Rabby Wallet?`);
        if (!ok) return false;
    }

    const feedbackEl = document.getElementById('nft-tx-feedback');
    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();

        const nfpmAbi = [
            "function positions(uint256) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
            "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint256 amount0, uint256 amount1)",
            "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)",
            "function multicall(bytes[] data) payable returns (bytes[] results)"
        ];

        const nfpm = new ethers.Contract(NFPM_ADDRESS, nfpmAbi, signer);
        feedbackEl.style.color = 'var(--warning-yellow)';
        feedbackEl.textContent = `Lendo liquidez exata do NFT #${tokenId}...`;

        const posOnChain = await nfpm.positions(ethers.BigNumber.from(tokenId));
        const currentLiquidity = posOnChain.liquidity;

        if (currentLiquidity.isZero()) {
            feedbackEl.textContent = `Liquidez já zerada. Executando apenas coleta final...`;
            await executeCollectFeesOnChain(tokenId, null);
            return true;
        }

        const deadline = Math.floor(Date.now() / 1000) + 1200;

        const simDec = await nfpm.callStatic.decreaseLiquidity({
            tokenId: ethers.BigNumber.from(tokenId),
            liquidity: currentLiquidity,
            amount0Min: 0,
            amount1Min: 0,
            deadline
        });

        const decreaseData = nfpm.interface.encodeFunctionData('decreaseLiquidity', [{
            tokenId: ethers.BigNumber.from(tokenId),
            liquidity: currentLiquidity,
            amount0Min: simDec.amount0.mul(985).div(1000),
            amount1Min: simDec.amount1.mul(985).div(1000),
            deadline
        }]);

        const collectData = nfpm.interface.encodeFunctionData('collect', [{
            tokenId: ethers.BigNumber.from(tokenId),
            recipient: connectedSignerAddress,
            amount0Max: MAX_UINT128,
            amount1Max: MAX_UINT128
        }]);

        feedbackEl.textContent = `Confirme o Withdraw atômico (Multicall) na Rabby Wallet...`;
        const tx = await nfpm.multicall([decreaseData, collectData], { gasLimit: 450000 });

        feedbackEl.textContent = `Withdraw enviado (${tx.hash.slice(0, 10)}...) Aguardando bloco...`;
        await tx.wait();

        feedbackEl.style.color = 'var(--success-green)';
        feedbackEl.textContent = `Posição #${tokenId} encerrada! Capital + tarifas na carteira.`;
        playBeep(1318, 0.3, 'sine');
        await runUnstoppableScan();
        return true;
    } catch (err) {
        feedbackEl.style.color = 'var(--danger-red)';
        feedbackEl.textContent = err.reason || err.message || 'Withdraw cancelado.';
        return false;
    }
}

async function executeRebalancePositionOnChain(tokenId, e) {
    if (e) e.stopPropagation();
    const ok = confirm(`Rebalancear NFT #${tokenId}? Isso vai:\n1. Encerrar e sacar 100% da posição #${tokenId}\n2. Ajustar WPOL/USDT0 na Uniswap V3\n3. Reabrir na nova faixa Sniper atual.`);
    if (!ok) return;

    const closed = await executeWithdrawPositionOnChain(tokenId, null, true);
    if (closed) {
        await runAutoPilotWorkflow();
    }
}

// =========================================================================
// MOTOR DE LUCRO LÍQUIDO REAL (PÓS-GÁS DE ABERTURA & FECHAMENTO EM BRZ/BRLA)
// =========================================================================
async function autoDetectPositionOpeningCost(pos, provider) {
    if (!pos.tokenId || appState.pnlOverrides[pos.id]?.autoChecked) return;
    try {
        const latestBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, latestBlock - 45000);
        const topic0 = ethers.utils.id("IncreaseLiquidity(uint256,uint128,uint256,uint256)");
        const topic1 = ethers.utils.hexZeroPad(ethers.BigNumber.from(pos.tokenId).toHexString(), 32);

        const logs = await withTimeout(provider.getLogs({
            address: NFPM_ADDRESS,
            topics: [topic0, topic1],
            fromBlock,
            toBlock: latestBlock
        }), 4500);

        appState.pnlOverrides[pos.id] = appState.pnlOverrides[pos.id] || {};
        appState.pnlOverrides[pos.id].autoChecked = true;

        if (logs && logs.length > 0) {
            const firstLog = logs[0];
            const receipt = await provider.getTransactionReceipt(firstLog.transactionHash);
            const gasPol = parseFloat(ethers.utils.formatEther(receipt.gasUsed.mul(receipt.effectiveGasPrice)));

            const decoded = ethers.utils.defaultAbiCoder.decode(['uint128', 'uint256', 'uint256'], firstLog.data);
            const initPol = parseFloat(ethers.utils.formatUnits(decoded[1], 18));
            const initUsdt = parseFloat(ethers.utils.formatUnits(decoded[2], 6));
            const initUsd = (initPol * currentPriceGlobal) + initUsdt;
            const initBrz = initUsd * getMotherRate();

            if (gasPol > 0) appState.pnlOverrides[pos.id].openGasPol = Number(gasPol.toFixed(5));
            if (initBrz > 0 && !appState.pnlOverrides[pos.id].initBrz) {
                appState.pnlOverrides[pos.id].initBrz = Number(initBrz.toFixed(2));
            }
            saveTripleBackup();
            syncPnlInputsWithFocused();
            recalculateRealPnL();
        }
    } catch (e) {}
}

function syncPnlInputsWithFocused() {
    const focusedId = appState.focusedId;
    const initInput = document.getElementById('pnl-init-brz');
    const gasInput = document.getElementById('pnl-open-gas-pol');

    if (focusedId && appState.pnlOverrides[focusedId]) {
        const ov = appState.pnlOverrides[focusedId];
        initInput.value = ov.initBrz !== undefined ? ov.initBrz : '';
        gasInput.value = ov.openGasPol !== undefined ? ov.openGasPol : '0.05';
    } else {
        initInput.value = '';
        gasInput.value = '0.05';
    }
}

function recalculateRealPnL() {
    const motherRate = getMotherRate();
    const polPriceBrz = currentPriceGlobal * motherRate;

    const initBrzInput = parseFloat(document.getElementById('pnl-init-brz').value);
    const openGasPol = parseFloat(document.getElementById('pnl-open-gas-pol').value) || 0;
    const estCloseGasPol = 0.045;

    const totalGasPol = openGasPol + estCloseGasPol;
    const totalGasBrz = totalGasPol * polPriceBrz;

    const currentPosBrz = focusedPositionTotalUsd * motherRate;
    const currentFeesBrz = focusedPositionFeesUsd * motherRate;

    const netFeesAfterGasBrz = currentFeesBrz - totalGasBrz;
    const netFeesEl = document.getElementById('pnl-net-fees-brz');
    netFeesEl.textContent = `${netFeesAfterGasBrz >= 0 ? '+' : ''}${netFeesAfterGasBrz.toFixed(4)} BRZ`;
    netFeesEl.style.color = netFeesAfterGasBrz >= 0 ? 'var(--success-green)' : 'var(--danger-red)';
    document.getElementById('pnl-gas-cost-sub').textContent = `Gás Total (${totalGasPol.toFixed(3)} POL): -${totalGasBrz.toFixed(3)} BRZ`;

    const baseCapitalBrz = Number.isFinite(initBrzInput) && initBrzInput > 0 ? initBrzInput : currentPosBrz;
    const realNetProfitBrz = (currentPosBrz + currentFeesBrz) - baseCapitalBrz - totalGasBrz;
    const realNetProfitBrl = realNetProfitBrz * (usdBrlCommercial / motherRate);

    const totalPnlEl = document.getElementById('pnl-real-total-brz');
    totalPnlEl.textContent = `${realNetProfitBrz >= 0 ? '+' : ''}${realNetProfitBrz.toFixed(2)} BRZ`;
    totalPnlEl.style.color = realNetProfitBrz >= 0 ? 'var(--success-green)' : 'var(--danger-red)';

    const roiPct = baseCapitalBrz > 0 ? ((realNetProfitBrz / baseCapitalBrz) * 100).toFixed(2) : '0.00';
    document.getElementById('pnl-real-total-brl').textContent = `R$ ${realNetProfitBrl.toFixed(2)} (${realNetProfitBrz >= 0 ? '+' : ''}${roiPct}%)`;
}

['pnl-init-brz', 'pnl-open-gas-pol'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        if (appState.focusedId) {
            appState.pnlOverrides[appState.focusedId] = appState.pnlOverrides[appState.focusedId] || {};
            const initVal = parseFloat(document.getElementById('pnl-init-brz').value);
            const gasVal = parseFloat(document.getElementById('pnl-open-gas-pol').value);
            if (Number.isFinite(initVal)) appState.pnlOverrides[appState.focusedId].initBrz = initVal;
            if (Number.isFinite(gasVal)) appState.pnlOverrides[appState.focusedId].openGasPol = gasVal;
            saveTripleBackup();
        }
        recalculateRealPnL();
    });
});

// =========================================================================
// NAVEGAÇÃO ENTRE AS 3 ABAS & SWAP NATIVO 100% UNISWAP V3
// =========================================================================
function switchRightTab(target) {
    ['radar', 'swap', 'pix'].forEach(name => {
        document.getElementById(`tab-${name}`).classList.toggle('active', name === target);
        document.getElementById(`view-${name}`).classList.toggle('active', name === target);
    });
    if (target === 'swap') {
        updateSwapBalanceLabels();
        refreshSwapQuote();
    } else if (target === 'pix') {
        recalculatePixRanking();
    }
}

document.getElementById('tab-radar').addEventListener('click', () => switchRightTab('radar'));
document.getElementById('tab-swap').addEventListener('click', () => switchRightTab('swap'));
document.getElementById('tab-pix').addEventListener('click', () => switchRightTab('pix'));

document.querySelectorAll('.tok-badge').forEach(badge => {
    badge.addEventListener('click', () => {
        const sym = badge.getAttribute('data-tok');
        document.getElementById('swap-token-in').value = sym;
        if (document.getElementById('swap-token-out').value === sym) {
            document.getElementById('swap-token-out').value = sym === 'USDT0' ? 'WPOL' : 'USDT0';
        }
        const bal = walletBalances[sym.toLowerCase()] || 0;
        if (bal > 0) {
            document.getElementById('swap-amount-in').value = (sym === 'POL' ? Math.max(0, bal - GAS_RESERVE_POL) : bal).toFixed(4);
        }
        switchRightTab('swap');
    });
});

function updateSwapBalanceLabels() {
    const symIn = document.getElementById('swap-token-in').value;
    const symOut = document.getElementById('swap-token-out').value;
    const balIn = walletBalances[symIn.toLowerCase()] || 0;
    const balOut = walletBalances[symOut.toLowerCase()] || 0;
    document.getElementById('swap-in-bal').textContent = balIn.toFixed(4);
    document.getElementById('swap-out-bal').textContent = balOut.toFixed(4);
}

document.getElementById('btn-swap-max').addEventListener('click', () => {
    const symIn = document.getElementById('swap-token-in').value;
    const balIn = walletBalances[symIn.toLowerCase()] || 0;
    const usable = symIn === 'POL' ? Math.max(0, balIn - GAS_RESERVE_POL) : balIn;
    document.getElementById('swap-amount-in').value = usable.toFixed(4);
    scheduleSwapQuote();
});

document.getElementById('btn-flip-tokens').addEventListener('click', () => {
    const inSel = document.getElementById('swap-token-in');
    const outSel = document.getElementById('swap-token-out');
    const tmp = inSel.value;
    inSel.value = outSel.value;
    outSel.value = tmp;
    updateSwapBalanceLabels();
    scheduleSwapQuote();
});

function scheduleSwapQuote() {
    clearTimeout(swapDebounceTimer);
    swapDebounceTimer = setTimeout(refreshSwapQuote, 350);
}

['swap-token-in', 'swap-token-out', 'swap-amount-in'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => { updateSwapBalanceLabels(); scheduleSwapQuote(); });
    document.getElementById(id).addEventListener('change', () => { updateSwapBalanceLabels(); scheduleSwapQuote(); });
});

async function checkUniswapAllowanceIfNeeded(tokenObj, amountWei) {
    if (tokenObj.isNative || !connectedSignerAddress) return true;
    try {
        const provider = getReadProvider();
        const erc20 = new ethers.Contract(tokenObj.address, ["function allowance(address, address) view returns (uint256)"], provider);
        const currentAllowance = await withTimeout(erc20.allowance(connectedSignerAddress, UNISWAP_SWAP_ROUTER_02), 4000);
        return currentAllowance.gte(amountWei);
    } catch (e) {
        return true;
    }
}

async function refreshSwapQuote() {
    const symIn = document.getElementById('swap-token-in').value;
    const symOut = document.getElementById('swap-token-out').value;
    const amtFloat = parseFloat(document.getElementById('swap-amount-in').value);
    const outInput = document.getElementById('swap-amount-out');
    const actionBtn = document.getElementById('btn-exec-swap');

    updateSwapBalanceLabels();

    if (symIn === symOut) {
        outInput.value = 'Mesmo token';
        actionBtn.disabled = true;
        activeSwapQuote = null;
        return;
    }
    if (!Number.isFinite(amtFloat) || amtFloat <= 0) {
        outInput.value = '0.00';
        actionBtn.disabled = true;
        activeSwapQuote = null;
        return;
    }

    const tokIn = TOKENS[symIn];
    const tokOut = TOKENS[symOut];
    const amountWei = ethers.utils.parseUnits(amtFloat.toFixed(tokIn.decimals), tokIn.decimals);

    outInput.value = 'Simulando V3...';

    try {
        const quoteObj = await quoteUniswapV3OnChain(symIn, symOut, amountWei);
        const outFormatted = parseFloat(ethers.utils.formatUnits(quoteObj.amountOutWei, tokOut.decimals));
        outInput.value = outFormatted.toFixed(4);

        const poolLabel = quoteObj.mode === 'WRAP_UNWRAP'
            ? 'CONTRATO WPOL 1:1'
            : (quoteObj.viaUsdt ? `UNISWAP V3 (${quoteObj.feeTier})` : `UNISWAP V3 (${(quoteObj.feeTier/10000).toFixed(2)}%)`);
        document.getElementById('swap-router-tag').textContent = poolLabel;
        document.getElementById('swap-impact').textContent = quoteObj.mode === 'WRAP_UNWRAP' ? '0.00% (1:1)' : 'Pool Direta / 1.2%';

        let brzEq = 0;
        if (symOut === 'BRZ' || symOut === 'BRLA') brzEq = outFormatted;
        else if (symOut === 'USDT0') brzEq = outFormatted * getMotherRate();
        else brzEq = outFormatted * currentPriceGlobal * getMotherRate();
        document.getElementById('swap-brl-eq').textContent = `${brzEq.toFixed(2)} BRZ | R$ ${(brzEq * (usdBrlCommercial / getMotherRate())).toFixed(2)}`;

        const hasAllowance = quoteObj.mode === 'WRAP_UNWRAP'
            ? true
            : await checkUniswapAllowanceIfNeeded(tokIn, amountWei);

        activeSwapQuote = {
            symIn,
            symOut,
            tokIn,
            tokOut,
            amountWei,
            outFormatted,
            quoteObj,
            hasAllowance
        };

        updateSwapButtonState();
    } catch (err) {
        outInput.value = 'Sem pool V3';
        actionBtn.disabled = true;
        activeSwapQuote = null;
    }
}

function updateSwapButtonState() {
    const btn = document.getElementById('btn-exec-swap');
    if (!connectedSignerAddress) {
        btn.disabled = false;
        btn.classList.remove('needs-approve');
        btn.textContent = 'CONECTAR RABBY PARA TROCAR';
        return;
    }
    if (!activeSwapQuote) {
        btn.disabled = true;
        return;
    }
    btn.disabled = false;
    if (!activeSwapQuote.hasAllowance) {
        btn.classList.add('needs-approve');
        btn.textContent = `1. APROVAR ${activeSwapQuote.symIn} EXATO NA UNISWAP`;
    } else {
        btn.classList.remove('needs-approve');
        btn.textContent = `2. TROCAR NA UNISWAP V3 (${activeSwapQuote.symIn} → ${activeSwapQuote.symOut})`;
    }
}

document.getElementById('btn-exec-swap').addEventListener('click', async () => {
    if (!connectedSignerAddress) {
        await connectWeb3Wallet();
        return;
    }
    if (!activeSwapQuote) return;

    const btn = document.getElementById('btn-exec-swap');
    const statusEl = document.getElementById('swap-tx-status');
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const signer = provider.getSigner();

    try {
        btn.disabled = true;

        if (!activeSwapQuote.hasAllowance) {
            statusEl.style.color = 'var(--warning-yellow)';
            statusEl.textContent = `Assine a aprovação exata de ${activeSwapQuote.symIn}...`;
            const erc20 = new ethers.Contract(
                activeSwapQuote.tokIn.address,
                ["function approve(address spender, uint256 amount) returns (bool)"],
                signer
            );
            const appTx = await erc20.approve(UNISWAP_SWAP_ROUTER_02, activeSwapQuote.amountWei);
            statusEl.textContent = 'Aguardando confirmação na Polygon...';
            await appTx.wait();
            activeSwapQuote.hasAllowance = true;
            statusEl.style.color = 'var(--success-green)';
            statusEl.textContent = 'Aprovado! Clique novamente para trocar na Uniswap V3.';
            updateSwapButtonState();
            return;
        }

        const tx = await executeUniswapV3Swap(
            activeSwapQuote.symIn,
            activeSwapQuote.symOut,
            activeSwapQuote.amountWei,
            activeSwapQuote.quoteObj,
            signer,
            (msg) => {
                statusEl.style.color = 'var(--cyan-accent)';
                statusEl.textContent = msg;
            }
        );

        statusEl.style.color = 'var(--success-green)';
        statusEl.textContent = `SUCESSO UNISWAP V3! Hash: ${tx.hash.slice(0, 14)}...`;
        playBeep(1174, 0.25, 'sine');

        await refreshLivePoolFeesAndBalances();
        await refreshSwapQuote();
    } catch (err) {
        statusEl.style.color = 'var(--danger-red)';
        statusEl.textContent = err.reason || err.message || 'Troca cancelada na carteira.';
        btn.disabled = false;
    }
});

// =========================================================================
// RANKER INTELIGENTE DE SAQUE PIX (INCLUI SPREAD IMPLÍCITO BIPA & TABELAS REAIS)
// =========================================================================
function getBipaRealTieredFeePct(brlAmount) {
    if (brlAmount < 10) return 0.0300;
    if (brlAmount < 100) return 0.0225;
    if (brlAmount < 200) return 0.0200;
    if (brlAmount < 1000) return 0.0175;
    if (brlAmount < 2000) return 0.0150;
    if (brlAmount < 3000) return 0.0125;
    if (brlAmount < 5000) return 0.0100;
    return 0.0075;
}

function recalculatePixRanking() {
    const asset = document.getElementById('pix-asset').value;
    const amount = parseFloat(document.getElementById('pix-amount').value) || 0;
    const listEl = document.getElementById('pix-ranking-list');
    listEl.replaceChildren();

    const polPriceUsd = currentPriceGlobal > 0 ? currentPriceGlobal : 0.087;
    const motherRate = getMotherRate();

    let usdValue = 0;
    if (asset === 'USDT0') usdValue = amount;
    else if (asset === 'POL' || asset === 'WPOL') usdValue = amount * polPriceUsd;
    else if (asset === 'BRZ' || asset === 'BRLA') usdValue = amount / motherRate;

    const grossCommercialBrl = usdValue * usdBrlCommercial;
    const gasBaseBrl = 0.03;
    const dexSwapPct = (asset === 'USDT0') ? 0 : 0.0005;

    const routes = [
        {
            id: 'nakpix_coupon',
            name: 'NakPix (c/ Cupom)',
            kyc: 'SEM KYC',
            kycClass: 'kyc-free',
            isNoKyc: true,
            url: null,
            computeNet: () => {
                const swapCost = grossCommercialBrl * dexSwapPct;
                const bridgeFee = grossCommercialBrl * 0.02;
                const net = Math.max(0, grossCommercialBrl - gasBaseBrl - swapCost - bridgeFee);
                return { net, detail: `Taxa 2.0% + Gás Polygon | USDT0 direto` };
            }
        },
        {
            id: 'pagfinance',
            name: 'PagFinance',
            kyc: 'CPF RÁPIDO',
            kycClass: 'kyc-lite',
            isNoKyc: false,
            url: 'https://pag.finance',
            computeNet: () => {
                const needSwap = (asset === 'BRZ' || asset === 'BRLA') ? grossCommercialBrl * 0.0005 : 0;
                const bridgeFee = grossCommercialBrl > 0 ? Math.max(1.20, grossCommercialBrl * 0.02) : 0;
                const net = Math.max(0, grossCommercialBrl - gasBaseBrl - needSwap - bridgeFee);
                return { net, detail: `Taxa 2.0% (piso R$1,20) | Auto-custódia` };
            }
        },
        {
            id: 'depix',
            name: 'DePix / Liquid',
            kyc: 'SEM KYC',
            kycClass: 'kyc-free',
            isNoKyc: true,
            url: 'https://depixapp.com',
            computeNet: () => {
                const swapCost = grossCommercialBrl * dexSwapPct;
                const bridgeFee = grossCommercialBrl * 0.018;
                const net = Math.max(0, grossCommercialBrl - 0.18 - swapCost - bridgeFee);
                return { net, detail: `~1.8% off-ramp + ponte Liquid` };
            }
        },
        {
            id: 'nakpix_std',
            name: 'NakPix (Padrão)',
            kyc: 'SEM KYC',
            kycClass: 'kyc-free',
            isNoKyc: true,
            url: null,
            computeNet: () => {
                const swapCost = grossCommercialBrl * dexSwapPct;
                const bridgeFee = grossCommercialBrl * 0.04;
                const net = Math.max(0, grossCommercialBrl - gasBaseBrl - swapCost - bridgeFee);
                return { net, detail: `Taxa 4.0% sem cupom | USDT0 Polygon` };
            }
        },
        {
            id: 'bipa',
            name: 'Bipa (Plano Free)',
            kyc: 'KYC TOTAL',
            kycClass: 'kyc-full',
            isNoKyc: false,
            url: 'https://bipa.app',
            computeNet: () => {
                const swapCost = grossCommercialBrl * dexSwapPct;
                const tierPct = getBipaRealTieredFeePct(grossCommercialBrl);
                const implicitFxSpreadPct = 0.0115;
                const totalBipaCost = grossCommercialBrl * (tierPct + implicitFxSpreadPct);
                const net = Math.max(0, grossCommercialBrl - gasBaseBrl - swapCost - totalBipaCost);
                return {
                    net,
                    detail: `Taxa ${(tierPct*100).toFixed(2)}% + Spread FX ~1.15%`
                };
            }
        },
        {
            id: 'binance',
            name: 'Binance Spot',
            kyc: 'KYC TOTAL',
            kycClass: 'kyc-full',
            isNoKyc: false,
            url: 'https://www.binance.com/pt-BR/trade/USDT_BRL',
            computeNet: () => {
                const swapCost = grossCommercialBrl * dexSwapPct;
                const effectiveRate = binanceUsdtBrlBid > 0 ? binanceUsdtBrlBid : (usdBrlCommercial * 0.996);
                const brlOnBook = usdValue * effectiveRate;
                const tradeFee = brlOnBook * 0.001;
                const pixWithdrawFee = grossCommercialBrl > 0 ? 3.50 : 0;
                const net = Math.max(0, brlOnBook - gasBaseBrl - swapCost - tradeFee - pixWithdrawFee);
                return {
                    net,
                    detail: `Book R$${effectiveRate.toFixed(3)} + 0.1% + R$3,50 saque`
                };
            }
        }
    ];

    const evaluated = routes
        .filter(r => !onlyNoKycFilter || r.isNoKyc)
        .map(r => {
            const res = r.computeNet();
            const totalLossPct = grossCommercialBrl > 0
                ? (((grossCommercialBrl - res.net) / grossCommercialBrl) * 100)
                : 0;
            return { ...r, netBrl: res.net, detail: res.detail, lossPct: totalLossPct };
        })
        .sort((a, b) => b.netBrl - a.netBrl);

    evaluated.forEach((item, idx) => {
        const isWinner = idx === 0 && grossCommercialBrl > 0;
        const card = document.createElement('div');
        card.className = 'rank-card' + (isWinner ? ' best-route' : '');

        const left = document.createElement('div');
        left.className = 'rank-left';

        const titleRow = document.createElement('div');
        titleRow.className = 'rank-title';
        const trophy = isWinner ? '★ ' : `#${idx + 1} `;
        titleRow.appendChild(document.createTextNode(`${trophy}${item.name} `));

        const pill = document.createElement('span');
        pill.className = `kyc-pill ${item.kycClass}`;
        pill.textContent = item.kyc;
        titleRow.appendChild(pill);

        const sub = document.createElement('div');
        sub.className = 'rank-sub';
        sub.textContent = item.detail;

        left.append(titleRow, sub);

        const right = document.createElement('div');
        right.className = 'rank-right';

        const netEl = document.createElement('div');
        netEl.className = 'rank-net';
        netEl.textContent = `R$ ${item.netBrl.toFixed(2)}`;

        const lossEl = document.createElement('div');
        lossEl.className = 'rank-loss';
        lossEl.textContent = `-${item.lossPct.toFixed(2)}% real`;

        right.append(netEl, lossEl);
        card.append(left, right);

        card.addEventListener('click', () => {
            navigator.clipboard.writeText(String(amount)).catch(() => {});
            document.getElementById('pix-hint').textContent = `Copiado (${amount} ${asset})! Rota selecionada: ${item.name} → Líquido R$ ${item.netBrl.toFixed(2)}.`;
            if (item.url) {
                window.open(item.url, '_blank', 'noopener,noreferrer');
            }
        });

        listEl.appendChild(card);
    });
}

document.getElementById('btn-filter-nokyc').addEventListener('click', (e) => {
    onlyNoKycFilter = !onlyNoKycFilter;
    e.target.textContent = onlyNoKycFilter ? 'FILTRO: 100% SEM KYC' : 'FILTRO: TODAS';
    e.target.classList.toggle('active-filter', onlyNoKycFilter);
    recalculatePixRanking();
});

['pix-asset', 'pix-amount'].forEach(id => {
    document.getElementById(id).addEventListener('input', recalculatePixRanking);
    document.getElementById(id).addEventListener('change', recalculatePixRanking);
});

document.getElementById('chip-use-usdt').addEventListener('click', () => {
    document.getElementById('pix-asset').value = 'USDT0';
    document.getElementById('pix-amount').value = walletBalances.usdt0 > 0 ? walletBalances.usdt0.toFixed(4) : '50';
    recalculatePixRanking();
});

document.getElementById('chip-use-wpol').addEventListener('click', () => {
    document.getElementById('pix-asset').value = 'WPOL';
    document.getElementById('pix-amount').value = walletBalances.wpol > 0 ? walletBalances.wpol.toFixed(4) : '500';
    recalculatePixRanking();
});

document.getElementById('chip-use-brz').addEventListener('click', () => {
    if (walletBalances.brla > walletBalances.brz) {
        document.getElementById('pix-asset').value = 'BRLA';
        document.getElementById('pix-amount').value = walletBalances.brla.toFixed(2);
    } else {
        document.getElementById('pix-asset').value = 'BRZ';
        document.getElementById('pix-amount').value = walletBalances.brz > 0 ? walletBalances.brz.toFixed(2) : '250';
    }
    recalculatePixRanking();
});

document.getElementById('chip-use-fees').addEventListener('click', () => {
    document.getElementById('pix-asset').value = 'USDT0';
    document.getElementById('pix-amount').value = totalUnclaimedFeesUsd > 0 ? totalUnclaimedFeesUsd.toFixed(4) : '1.00';
    recalculatePixRanking();
});

// =========================================================================
// SANITIZAÇÃO E VALIDAÇÃO DE SEGURANÇA
// =========================================================================
function sanitizeLabel(str) {
    return String(str || '').replace(/[<>"'&]/g, '').trim().slice(0, 26) || 'Faixa';
}

function sanitizePosition(p) {
    if (!p || typeof p !== 'object') return null;
    const min = Number(p.min);
    const max = Number(p.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || min >= max) return null;
    return {
        id: String(p.id || ('pos-' + Math.random().toString(36).slice(2, 8))).replace(/[^a-zA-Z0-9_-]/g, ''),
        tokenId: p.tokenId ? String(p.tokenId).replace(/[^0-9]/g, '') : undefined,
        min,
        max,
        tickLower: Number.isFinite(Number(p.tickLower)) ? Number(p.tickLower) : undefined,
        tickUpper: Number.isFinite(Number(p.tickUpper)) ? Number(p.tickUpper) : undefined,
        liquidity: p.liquidity && /^[0-9]+$/.test(String(p.liquidity)) ? String(p.liquidity) : undefined,
        feeGrowthInside0LastX128: p.feeGrowthInside0LastX128 && /^[0-9]+$/.test(String(p.feeGrowthInside0LastX128)) ? String(p.feeGrowthInside0LastX128) : undefined,
        feeGrowthInside1LastX128: p.feeGrowthInside1LastX128 && /^[0-9]+$/.test(String(p.feeGrowthInside1LastX128)) ? String(p.feeGrowthInside1LastX128) : undefined,
        tokensOwed0: p.tokensOwed0 && /^[0-9]+$/.test(String(p.tokensOwed0)) ? String(p.tokensOwed0) : '0',
        tokensOwed1: p.tokensOwed1 && /^[0-9]+$/.test(String(p.tokensOwed1)) ? String(p.tokensOwed1) : '0',
        liveFeesUsd: Number.isFinite(Number(p.liveFeesUsd)) ? Number(p.liveFeesUsd) : 0,
        label: sanitizeLabel(p.label),
        source: p.source === 'web3' ? 'web3' : 'manual'
    };
}

function applyValidatedState(raw) {
    if (!raw || typeof raw !== 'object') return;
    if (raw.wallet && ethers.utils.isAddress(String(raw.wallet))) {
        appState.wallet = String(raw.wallet).toLowerCase();
    }
    if (Array.isArray(raw.web3Positions)) {
        appState.web3Positions = raw.web3Positions.map(sanitizePosition).filter(Boolean).slice(0, 20);
    }
    if (Array.isArray(raw.manualPositions)) {
        appState.manualPositions = raw.manualPositions.map(sanitizePosition).filter(Boolean).slice(0, 20);
    }
    if (raw.focusedId) {
        appState.focusedId = String(raw.focusedId).replace(/[^a-zA-Z0-9_-]/g, '');
    }
    if (raw.pnlOverrides && typeof raw.pnlOverrides === 'object') {
        appState.pnlOverrides = raw.pnlOverrides;
    }
}

// =========================================================================
// BACKUPS LOCAIS PRIVADOS (SEM EXPOR CARTEIRA NA URL)
// =========================================================================
function saveTripleBackup() {
    const payload = JSON.stringify(appState);
    try { localStorage.setItem('rdesk_v19_backup', payload); } catch (e) {}
    try {
        const req = indexedDB.open('RDESK_VAULT', 1);
        req.onupgradeneeded = (e) => e.target.result.createObjectStore('state');
        req.onsuccess = (e) => {
            const db = e.target.result;
            const tx = db.transaction('state', 'readwrite');
            tx.objectStore('state').put(payload, 'latest');
        };
    } catch (e) {}
}

async function loadFromTripleBackup() {
    try {
        const ls = localStorage.getItem('rdesk_v19_backup') || localStorage.getItem('rdesk_v18_backup') || localStorage.getItem('rdesk_v17_backup');
        if (ls) {
            applyValidatedState(JSON.parse(ls));
            return;
        }
    } catch (e) {}
    try {
        await new Promise((resolve) => {
            const req = indexedDB.open('RDESK_VAULT', 1);
            req.onupgradeneeded = (e) => e.target.result.createObjectStore('state');
            req.onsuccess = (e) => {
                const db = e.target.result;
                const tx = db.transaction('state', 'readonly');
                const getReq = tx.objectStore('state').get('latest');
                getReq.onsuccess = () => {
                    if (getReq.result) applyValidatedState(JSON.parse(getReq.result));
                    resolve();
                };
                getReq.onerror = () => resolve();
            };
            req.onerror = () => resolve();
        });
    } catch (e) {}
}

document.getElementById('btn-export-json').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(appState, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rdesk-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById('btn-import-json').addEventListener('click', () => document.getElementById('file-import').click());
document.getElementById('file-import').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file || file.size > 262144) {
        alert('Arquivo inválido ou maior que 256 KB.');
        return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            applyValidatedState(JSON.parse(ev.target.result));
            if (appState.wallet) document.getElementById('wallet-address').value = appState.wallet;
            saveTripleBackup();
            syncPnlInputsWithFocused();
            renderAllPositions();
        } catch (err) { alert('Arquivo JSON inválido.'); }
    };
    reader.readAsText(file);
});

document.getElementById('btn-copy-link').addEventListener('click', () => {
    const payload = JSON.stringify(appState);
    const encoded = btoa(unescape(encodeURIComponent(payload)));
    const shareUrl = `${window.location.origin}${window.location.pathname}#rdesk=${encoded}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
        const btn = document.getElementById('btn-copy-link');
        btn.textContent = 'COPIADO!';
        setTimeout(() => btn.textContent = 'LINK', 2000);
    });
});

// =========================================================================
// TARIFAS NÃO RECOLHIDAS EM TEMPO REAL (256-BIT) & SALDOS LIVRES
// =========================================================================
function subUint256(a, b) {
    return a.gte(b) ? a.sub(b) : MAX_UINT256.sub(b).add(a).add(1);
}

function computeLiveUnclaimedFees(pos, poolState) {
    if (!pos.liquidity || pos.tickLower === undefined || pos.tickUpper === undefined || !poolState) {
        return { owed0: 0, owed1: 0, usd: 0 };
    }
    try {
        const tickCurrent = poolState.tickCurrent;
        const fg0 = poolState.feeGrowthGlobal0X128;
        const fg1 = poolState.feeGrowthGlobal1X128;
        const lower = poolState.ticksMap[pos.tickLower];
        const upper = poolState.ticksMap[pos.tickUpper];
        if (!lower || !upper) return { owed0: 0, owed1: 0, usd: 0 };

        const below0 = tickCurrent >= pos.tickLower ? lower.feeGrowthOutside0X128 : subUint256(fg0, lower.feeGrowthOutside0X128);
        const below1 = tickCurrent >= pos.tickLower ? lower.feeGrowthOutside1X128 : subUint256(fg1, lower.feeGrowthOutside1X128);
        const above0 = tickCurrent < pos.tickUpper ? upper.feeGrowthOutside0X128 : subUint256(fg0, upper.feeGrowthOutside0X128);
        const above1 = tickCurrent < pos.tickUpper ? upper.feeGrowthOutside1X128 : subUint256(fg1, upper.feeGrowthOutside1X128);

        const inside0 = subUint256(subUint256(fg0, below0), above0);
        const inside1 = subUint256(subUint256(fg1, below1), above1);

        const last0 = ethers.BigNumber.from(pos.feeGrowthInside0LastX128 || '0');
        const last1 = ethers.BigNumber.from(pos.feeGrowthInside1LastX128 || '0');
        const liq = ethers.BigNumber.from(pos.liquidity);

        const delta0 = subUint256(inside0, last0).mul(liq).div(Q128);
        const delta1 = subUint256(inside1, last1).mul(liq).div(Q128);

        const base0 = ethers.BigNumber.from(pos.tokensOwed0 || '0');
        const base1 = ethers.BigNumber.from(pos.tokensOwed1 || '0');

        const total0 = parseFloat(ethers.utils.formatUnits(base0.add(delta0), 18));
        const total1 = parseFloat(ethers.utils.formatUnits(base1.add(delta1), 6));
        const usd = (total0 * currentPriceGlobal) + total1;

        return { owed0: total0, owed1: total1, usd: Number.isFinite(usd) ? usd : 0 };
    } catch (e) {
        return { owed0: 0, owed1: 0, usd: 0 };
    }
}

async function refreshLivePoolFeesAndBalances() {
    if (!appState.wallet || !ethers.utils.isAddress(appState.wallet)) return;

    const poolABI = [
        "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
        "function feeGrowthGlobal0X128() view returns (uint256)",
        "function feeGrowthGlobal1X128() view returns (uint256)",
        "function ticks(int24) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)"
    ];
    const erc20ABI = ["function balanceOf(address) view returns (uint256)"];

    for (const rpcUrl of POLYGON_RPCS) {
        try {
            const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
            const pool = new ethers.Contract(POOL_ADDRESS, poolABI, provider);

            const wpolC = new ethers.Contract(TOKENS.WPOL.address, erc20ABI, provider);
            const usdtC = new ethers.Contract(TOKENS.USDT0.address, erc20ABI, provider);
            const brzC = new ethers.Contract(TOKENS.BRZ.address, erc20ABI, provider);
            const brlaC = new ethers.Contract(TOKENS.BRLA.address, erc20ABI, provider);

            const [bPolNative, bWpol, bUsdt, bBrz, bBrla] = await withTimeout(Promise.all([
                provider.getBalance(appState.wallet),
                wpolC.balanceOf(appState.wallet),
                usdtC.balanceOf(appState.wallet),
                brzC.balanceOf(appState.wallet),
                brlaC.balanceOf(appState.wallet)
            ]), 4500);

            walletBalances = {
                pol: parseFloat(ethers.utils.formatUnits(bPolNative, 18)),
                wpol: parseFloat(ethers.utils.formatUnits(bWpol, 18)),
                usdt0: parseFloat(ethers.utils.formatUnits(bUsdt, 6)),
                brz: parseFloat(ethers.utils.formatUnits(bBrz, 18)),
                brla: parseFloat(ethers.utils.formatUnits(bBrla, 18))
            };

            document.getElementById('bal-pol').textContent = walletBalances.pol.toFixed(2);
            document.getElementById('bal-wpol').textContent = walletBalances.wpol.toFixed(2);
            document.getElementById('bal-usdt0').textContent = walletBalances.usdt0.toFixed(2);
            document.getElementById('bal-brz').textContent = walletBalances.brz.toFixed(2);
            document.getElementById('bal-brla').textContent = walletBalances.brla.toFixed(2);

            updateSwapBalanceLabels();
            recomputeAutoPilotPlan();

            if (appState.web3Positions.length > 0) {
                const [slot0, fg0, fg1] = await withTimeout(Promise.all([
                    pool.slot0(),
                    pool.feeGrowthGlobal0X128(),
                    pool.feeGrowthGlobal1X128()
                ]), 4500);

                const uniqueTicks = new Set();
                appState.web3Positions.forEach(p => {
                    if (p.tickLower !== undefined) uniqueTicks.add(p.tickLower);
                    if (p.tickUpper !== undefined) uniqueTicks.add(p.tickUpper);
                    autoDetectPositionOpeningCost(p, provider);
                });

                const ticksMap = {};
                await Promise.all(Array.from(uniqueTicks).map(async (t) => {
                    const tData = await pool.ticks(t);
                    ticksMap[t] = {
                        feeGrowthOutside0X128: tData.feeGrowthOutside0X128,
                        feeGrowthOutside1X128: tData.feeGrowthOutside1X128
                    };
                }));

                const poolState = {
                    tickCurrent: Number(slot0.tick),
                    feeGrowthGlobal0X128: fg0,
                    feeGrowthGlobal1X128: fg1,
                    ticksMap
                };

                let totalFeesUsd = 0;
                appState.web3Positions.forEach(p => {
                    const fees = computeLiveUnclaimedFees(p, poolState);
                    p.liveFeesUsd = fees.usd;
                    totalFeesUsd += fees.usd;
                });

                totalUnclaimedFeesUsd = totalFeesUsd;
                const motherRate = getMotherRate();
                document.getElementById('fees-total-brz').textContent = `${(totalFeesUsd * motherRate).toFixed(4)} BRZ`;
                document.getElementById('fees-total-usd').textContent = `$ ${totalFeesUsd.toFixed(4)} | R$ ${(totalFeesUsd * usdBrlCommercial).toFixed(4)}`;
                renderAllPositions();
            }
            return;
        } catch (e) {}
    }
}

// =========================================================================
// MOTOR SNIPER PRO (15M ATR 14 + EMA 9/21 SKEW)
// =========================================================================
function computeEMA(values, period) {
    const k = 2 / (period + 1);
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
        ema = values[i] * k + ema * (1 - k);
    }
    return ema;
}

async function refreshSniperModel15m() {
    try {
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=15m&limit=100`);
        const raw = await res.json();
        const candles = raw.map(d => ({
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4])
        }));

        if (candles.length < 30) return;

        const macroSlice = candles.slice(-96);
        let max24 = 0, min24 = Infinity;
        macroSlice.forEach(c => { max24 = Math.max(max24, c.high); min24 = Math.min(min24, c.low); });
        document.getElementById('strat-macro').textContent = `${min24.toFixed(5)} <> ${max24.toFixed(5)}`;

        const trs = [];
        for (let i = candles.length - 15; i < candles.length; i++) {
            const curr = candles[i];
            const prev = candles[i - 1];
            trs.push(Math.max(
                curr.high - curr.low,
                Math.abs(curr.high - prev.close),
                Math.abs(curr.low - prev.close)
            ));
        }
        const atr14 = trs.reduce((a, b) => a + b, 0) / trs.length;

        const closes = candles.map(c => c.close);
        const ema9 = computeEMA(closes.slice(-30), 9);
        const ema21 = computeEMA(closes.slice(-45), 21);
        const rawBias = atr14 > 0 ? (ema9 - ema21) / atr14 : 0;
        const clampedBias = Math.max(-1, Math.min(1, rawBias));

        const upWeight = 0.50 + (clampedBias * 0.18);
        const downWeight = 1 - upWeight;

        let regimeText = 'LATERAL 50/50';
        if (clampedBias > 0.25) regimeText = `ALTA ${Math.round(downWeight*100)}/${Math.round(upWeight*100)}`;
        else if (clampedBias < -0.25) regimeText = `BAIXA ${Math.round(downWeight*100)}/${Math.round(upWeight*100)}`;

        sniperTelemetry = { ...sniperTelemetry, atr14, upWeight, downWeight, regimeText };
        if (currentPriceGlobal === 0) currentPriceGlobal = closes[closes.length - 1];
        recalculateLiveSniperBounds();
    } catch (e) {}
}

function recalculateLiveSniperBounds() {
    if (currentPriceGlobal <= 0 || sniperTelemetry.atr14 <= 0) return;

    const totalSpan = sniperTelemetry.atr14 * 2.5;
    const sMin = currentPriceGlobal - (totalSpan * sniperTelemetry.downWeight);
    const sMax = currentPriceGlobal + (totalSpan * sniperTelemetry.upWeight);

    sniperTelemetry.min = sMin;
    sniperTelemetry.max = sMax;

    const widthPct = ((sMax - sMin) / sMin) * 100;
    const concMult = Math.round(1 / (1 - Math.sqrt(sMin / sMax)));

    document.getElementById('sniper-regime').textContent = sniperTelemetry.regimeText;
    document.getElementById('sniper-efficiency').textContent = `${widthPct.toFixed(2)}% (~${concMult}x)`;
    document.getElementById('strat-sniper').textContent = `${sMin.toFixed(5)} <> ${sMax.toFixed(5)}`;

    recomputeAutoPilotPlan();
}

// =========================================================================
// 3 CAMADAS DE LEITURA WEB3
// =========================================================================
async function fetchViaMultiRpcEthers(address) {
    const nfpmABI = [
        "function balanceOf(address) view returns (uint256)",
        "function tokenOfOwnerByIndex(address, uint256) view returns (uint256)",
        "function positions(uint256) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)"
    ];

    for (let i = 0; i < POLYGON_RPCS.length; i++) {
        const rpcUrl = POLYGON_RPCS[i];
        try {
            routeStatusEl.textContent = `ROTA 1.${i+1}...`;
            const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
            const nfpm = new ethers.Contract(NFPM_ADDRESS, nfpmABI, provider);

            const balanceBN = await withTimeout(nfpm.balanceOf(address), 4500);
            const balance = balanceBN.toNumber();
            const found = [];

            for (let idx = 0; idx < balance; idx++) {
                const tokenIdBN = await withTimeout(nfpm.tokenOfOwnerByIndex(address, idx), 4500);
                const pos = await withTimeout(nfpm.positions(tokenIdBN), 4500);
                const t0 = pos.token0.toLowerCase();
                const t1 = pos.token1.toLowerCase();

                if ((t0 === POL_ADDRESS && t1 === USDT_ADDRESS) || (t1 === POL_ADDRESS && t0 === USDT_ADDRESS)) {
                    if (pos.liquidity.gt(0)) {
                        const prices = ticksToHumanPrice(pos.tickLower, pos.tickUpper, t0 === POL_ADDRESS);
                        found.push({
                            id: `web3-${tokenIdBN.toString()}`,
                            tokenId: tokenIdBN.toString(),
                            min: prices.min,
                            max: prices.max,
                            tickLower: Number(pos.tickLower),
                            tickUpper: Number(pos.tickUpper),
                            liquidity: pos.liquidity.toString(),
                            feeGrowthInside0LastX128: pos.feeGrowthInside0LastX128.toString(),
                            feeGrowthInside1LastX128: pos.feeGrowthInside1LastX128.toString(),
                            tokensOwed0: pos.tokensOwed0.toString(),
                            tokensOwed1: pos.tokensOwed1.toString(),
                            liveFeesUsd: 0,
                            label: `NFT #${tokenIdBN.toString()}`,
                            source: 'web3'
                        });
                    }
                }
            }
            routeStatusEl.textContent = `OK (RPC #${i+1})`;
            return found;
        } catch (err) {}
    }
    throw new Error('Todos os RPCs falharam');
}

async function fetchViaRawJsonRpc(address) {
    routeStatusEl.textContent = 'ROTA 2 (RAW)...';
    const cleanAddr = address.replace('0x', '').padStart(64, '0');
    const res = await withTimeout(fetch('https://polygon-bor-rpc.publicnode.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'eth_call',
            params: [{ to: NFPM_ADDRESS, data: '0x70a08231' + cleanAddr }, 'latest']
        })
    }), 5000);
    const json = await res.json();
    if (!json.result) throw new Error('Falha Raw eth_call');
    const count = parseInt(json.result, 16);
    if (count === 0) return [];

    const nfpmIface = new ethers.utils.Interface([
        "function tokenOfOwnerByIndex(address, uint256) view returns (uint256)",
        "function positions(uint256) view returns (uint96, address, address, address, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128)"
    ]);

    const found = [];
    for (let i = 0; i < count; i++) {
        const callDataIdx = nfpmIface.encodeFunctionData('tokenOfOwnerByIndex', [address, i]);
        const r1 = await fetch('https://polygon-bor-rpc.publicnode.com', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to: NFPM_ADDRESS, data: callDataIdx }, 'latest'] })
        }).then(r => r.json());
        const [tokenId] = nfpmIface.decodeFunctionResult('tokenOfOwnerByIndex', r1.result);

        const callDataPos = nfpmIface.encodeFunctionData('positions', [tokenId]);
        const r2 = await fetch('https://polygon-bor-rpc.publicnode.com', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'eth_call', params: [{ to: NFPM_ADDRESS, data: callDataPos }, 'latest'] })
        }).then(r => r.json());
        const pos = nfpmIface.decodeFunctionResult('positions', r2.result);

        const t0 = pos[2].toLowerCase();
        const t1 = pos[3].toLowerCase();
        const liq = pos[7];
        if (((t0 === POL_ADDRESS && t1 === USDT_ADDRESS) || (t1 === POL_ADDRESS && t0 === USDT_ADDRESS)) && liq.gt(0)) {
            const prices = ticksToHumanPrice(pos[5], pos[6], t0 === POL_ADDRESS);
            found.push({
                id: `web3-${tokenId.toString()}`,
                tokenId: tokenId.toString(),
                min: prices.min,
                max: prices.max,
                tickLower: Number(pos[5]),
                tickUpper: Number(pos[6]),
                liquidity: liq.toString(),
                feeGrowthInside0LastX128: pos[8].toString(),
                feeGrowthInside1LastX128: pos[9].toString(),
                tokensOwed0: pos[10].toString(),
                tokensOwed1: pos[11].toString(),
                liveFeesUsd: 0,
                label: `NFT #${tokenId.toString()}`,
                source: 'web3'
            });
        }
    }
    routeStatusEl.textContent = 'OK (ROTA 2)';
    return found;
}

async function fetchViaSubgraph(address) {
    routeStatusEl.textContent = 'ROTA 3 (GRAPH)...';
    const query = `{
        positions(where: { owner: "${address}", pool: "${POOL_ADDRESS}", liquidity_gt: "0" }) {
            id
            liquidity
            tickLower { tickIdx }
            tickUpper { tickIdx }
        }
    }`;
    const res = await withTimeout(fetch('https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-v3-polygon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
    }), 4500);
    const json = await res.json();
    const list = json?.data?.positions || [];
    const found = list.map(p => {
        const prices = ticksToHumanPrice(p.tickLower.tickIdx, p.tickUpper.tickIdx, true);
        return {
            id: `web3-${p.id}`,
            tokenId: p.id,
            min: prices.min,
            max: prices.max,
            tickLower: Number(p.tickLower.tickIdx),
            tickUpper: Number(p.tickUpper.tickIdx),
            liquidity: p.liquidity,
            liveFeesUsd: 0,
            label: `NFT #${p.id}`,
            source: 'web3'
        };
    });
    routeStatusEl.textContent = 'OK (ROTA 3)';
    return found;
}

async function runUnstoppableScan() {
    const rawAddr = document.getElementById('wallet-address').value.trim();
    if (!ethers.utils.isAddress(rawAddr)) {
        routeStatusEl.textContent = 'ENDEREÇO INVÁLIDO';
        routeStatusEl.style.color = 'var(--danger-red)';
        return;
    }
    const address = rawAddr.toLowerCase();
    appState.wallet = address;
    const btnScan = document.getElementById('btn-scan');
    btnScan.textContent = '...';
    routeStatusEl.style.color = 'var(--dekton-copper)';

    let scannedPositions = null;
    try {
        scannedPositions = await fetchViaMultiRpcEthers(address);
    } catch (e1) {
        try {
            scannedPositions = await fetchViaRawJsonRpc(address);
        } catch (e2) {
            try {
                scannedPositions = await fetchViaSubgraph(address);
            } catch (e3) {
                routeStatusEl.textContent = 'OFFLINE (BACKUP)';
                routeStatusEl.style.color = 'var(--warning-yellow)';
            }
        }
    }

    if (Array.isArray(scannedPositions)) {
        appState.web3Positions = scannedPositions;
        if (!appState.focusedId && scannedPositions.length > 0) {
            appState.focusedId = scannedPositions[0].id;
        }
        saveTripleBackup();
    }

    syncPnlInputsWithFocused();
    renderAllPositions();
    await refreshLivePoolFeesAndBalances();
    btnScan.textContent = 'SCAN';
}

document.getElementById('btn-scan').addEventListener('click', runUnstoppableScan);

// =========================================================================
// INSERÇÃO MANUAL MULTI-FAIXA
// =========================================================================
function addManualPosition(minVal, maxVal, tagVal) {
    const min = parseFloat(minVal);
    const max = parseFloat(maxVal);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || min >= max) {
        alert('Informe valores válidos (Mínima menor que Máxima).');
        return;
    }
    const id = 'man-' + Date.now();
    const label = sanitizeLabel(tagVal) || `Manual #${appState.manualPositions.length + 1}`;
    appState.manualPositions.push({ id, min, max, label, source: 'manual' });
    appState.focusedId = id;
    saveTripleBackup();
    syncPnlInputsWithFocused();
    renderAllPositions();
}

document.getElementById('btn-add-manual').addEventListener('click', () => {
    const minEl = document.getElementById('manual-min');
    const maxEl = document.getElementById('manual-max');
    const tagEl = document.getElementById('manual-tag');
    addManualPosition(minEl.value, maxEl.value, tagEl.value);
    minEl.value = '';
    maxEl.value = '';
    tagEl.value = '';
});

document.getElementById('btn-use-sniper').addEventListener('click', () => {
    if (sniperTelemetry.min > 0 && sniperTelemetry.max > 0) {
        addManualPosition(sniperTelemetry.min.toFixed(6), sniperTelemetry.max.toFixed(6), `Sniper ${sniperTelemetry.regimeText.split(' ')[0]}`);
    }
});

function removePosition(id, e) {
    e.stopPropagation();
    appState.manualPositions = appState.manualPositions.filter(p => p.id !== id);
    appState.web3Positions = appState.web3Positions.filter(p => p.id !== id);
    if (appState.focusedId === id) {
        const remaining = [...appState.web3Positions, ...appState.manualPositions];
        appState.focusedId = remaining.length > 0 ? remaining[0].id : null;
    }
    saveTripleBackup();
    syncPnlInputsWithFocused();
    renderAllPositions();
}

// =========================================================================
// RENDERIZAÇÃO SEGURA DOS CARDS DE POSIÇÃO (COLHER, REBALANCEAR & WITHDRAW)
// =========================================================================
function getAllPositions() {
    return [...appState.web3Positions, ...appState.manualPositions];
}

function renderAllPositions() {
    const listEl = document.getElementById('positions-list');
    const all = getAllPositions();
    listEl.replaceChildren();

    if (candleSeries && positionLines.length > 0) {
        positionLines.forEach(line => {
            try { candleSeries.removePriceLine(line); } catch (e) {}
        });
        positionLines = [];
    }

    if (all.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'color:#555; font-size:0.65rem; text-align:center; padding:6px;';
        emptyDiv.textContent = 'Nenhuma faixa ativa. Clique em COMEÇAR A GANHAR acima.';
        listEl.appendChild(emptyDiv);
        document.getElementById('focused-label').textContent = 'FOCO: NENHUMA POSIÇÃO';
        return;
    }

    if (!all.some(p => p.id === appState.focusedId)) {
        appState.focusedId = all[0].id;
    }

    const palette = ['#00ff88', '#00d4ff', '#cda434', '#ff7b00', '#b565ff'];
    const motherRate = getMotherRate();

    all.forEach((pos, idx) => {
        const color = palette[idx % palette.length];
        const isFocused = pos.id === appState.focusedId;
        const widthPct = (((pos.max - pos.min) / pos.min) * 100).toFixed(2);
        const badge = pos.source === 'manual' ? 'MAN' : 'V3';

        const item = document.createElement('div');
        item.className = 'pos-item' + (isFocused ? ' focused-pos' : '');
        item.style.borderLeftColor = color;

        const topRow = document.createElement('div');
        topRow.className = 'pos-top-row';

        const meta = document.createElement('div');
        meta.className = 'pos-meta';

        const titleLine = document.createElement('span');
        titleLine.style.color = color;
        titleLine.style.fontWeight = '700';
        const feeTag = pos.source === 'web3' ? ` | +${(pos.liveFeesUsd * motherRate).toFixed(3)} BRZ` : '';
        titleLine.textContent = `[${badge}] ${pos.label} (${widthPct}%)${feeTag}`;

        const rangeLine = document.createElement('span');
        rangeLine.style.color = '#ccc';
        rangeLine.textContent = `${pos.min.toFixed(5)} → ${pos.max.toFixed(5)}`;

        meta.appendChild(titleLine);
        meta.appendChild(rangeLine);

        const delBtn = document.createElement('button');
        delBtn.className = 'pos-del';
        delBtn.title = 'Ocultar faixa';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', (ev) => removePosition(pos.id, ev));

        topRow.append(meta, delBtn);
        item.appendChild(topRow);

        if (pos.source === 'web3' && pos.tokenId) {
            const actionsRow = document.createElement('div');
            actionsRow.className = 'pos-actions-row';

            const collectBtn = document.createElement('button');
            collectBtn.className = 'btn-nft-collect';
            collectBtn.textContent = 'COLHER';
            collectBtn.title = 'Assina collect() na Rabby Wallet e envia tarifas para sua carteira';
            collectBtn.addEventListener('click', (ev) => executeCollectFeesOnChain(pos.tokenId, ev));

            const rebalBtn = document.createElement('button');
            rebalBtn.className = 'btn-nft-collect';
            rebalBtn.style.borderColor = 'var(--cyan-accent)';
            rebalBtn.style.color = 'var(--cyan-accent)';
            rebalBtn.textContent = 'REBALANCEAR';
            rebalBtn.title = 'Fecha esta posição, ajusta WPOL/USDT0 e reabre na faixa Sniper atual';
            rebalBtn.addEventListener('click', (ev) => executeRebalancePositionOnChain(pos.tokenId, ev));

            const withdrawBtn = document.createElement('button');
            withdrawBtn.className = 'btn-nft-withdraw';
            withdrawBtn.textContent = 'WITHDRAW';
            withdrawBtn.title = 'Fecha 100% da posição e devolve capital + tarifas para sua Rabby Wallet';
            withdrawBtn.addEventListener('click', (ev) => executeWithdrawPositionOnChain(pos.tokenId, ev));

            actionsRow.append(collectBtn, rebalBtn, withdrawBtn);
            item.appendChild(actionsRow);
        }

        item.addEventListener('click', () => {
            appState.focusedId = pos.id;
            saveTripleBackup();
            syncPnlInputsWithFocused();
            renderAllPositions();
        });

        listEl.appendChild(item);

        if (candleSeries) {
            positionLines.push(candleSeries.createPriceLine({
                price: pos.min,
                color: color,
                lineWidth: isFocused ? 2 : 1,
                lineStyle: 2,
                axisLabelVisible: true,
                title: `MIN ${pos.label}`
            }));
            positionLines.push(candleSeries.createPriceLine({
                price: pos.max,
                color: color,
                lineWidth: isFocused ? 2 : 1,
                lineStyle: 2,
                axisLabelVisible: true,
                title: `MAX ${pos.label}`
            }));
        }
    });

    updateFocusedMetrics();
}

function updateFocusedMetrics() {
    const all = getAllPositions();
    const focused = all.find(p => p.id === appState.focusedId);
    if (!focused || currentPriceGlobal <= 0) return;

    document.getElementById('focused-label').textContent = `FOCO: ${focused.label.toUpperCase()}`;

    const min = focused.min;
    const max = focused.max;
    const price = currentPriceGlobal;
    const motherRate = getMotherRate();

    const sqrtP = Math.sqrt(price);
    const sqrtA = Math.sqrt(min);
    const sqrtB = Math.sqrt(max);

    let usdtPct = 50;
    if (price <= min) usdtPct = 0;
    else if (price >= max) usdtPct = 100;
    else {
        const amt0 = (1 / sqrtP) - (1 / sqrtB);
        const amt1 = sqrtP - sqrtA;
        const val0Usd = amt0 * price;
        const val1Usd = amt1;
        usdtPct = (val1Usd / (val0Usd + val1Usd)) * 100;
    }

    const polPct = 100 - usdtPct;
    document.getElementById('bar-usdt').style.width = `${usdtPct.toFixed(1)}%`;
    document.getElementById('bar-pol').style.width = `${polPct.toFixed(1)}%`;
    document.getElementById('dist-marker').style.left = `${usdtPct.toFixed(1)}%`;
    document.getElementById('lbl-pol').textContent = `${polPct.toFixed(1)}% POL`;
    document.getElementById('lbl-usdt').textContent = `${usdtPct.toFixed(1)}% USDT`;

    if (focused.liquidity && focused.tickLower !== undefined) {
        const L = parseFloat(focused.liquidity);
        const sP = Math.sqrt(price * 1e-12);
        const sA = Math.pow(1.0001, focused.tickLower / 2);
        const sB = Math.pow(1.0001, focused.tickUpper / 2);

        let raw0 = 0, raw1 = 0;
        if (sP <= sA) raw0 = L * ((1 / sA) - (1 / sB));
        else if (sP >= sB) raw1 = L * (sB - sA);
        else {
            raw0 = L * ((1 / sP) - (1 / sB));
            raw1 = L * (sP - sA);
        }
        const humanPol = raw0 / 1e18;
        const humanUsdt = raw1 / 1e6;
        const totalUsd = (humanPol * price) + humanUsdt;

        focusedPositionTotalUsd = totalUsd;
        focusedPositionFeesUsd = focused.liveFeesUsd || 0;

        document.getElementById('wallet-total-brz').textContent = `${(totalUsd * motherRate).toFixed(2)} BRZ`;
        document.getElementById('wallet-total-usd').textContent = `$ ${totalUsd.toFixed(2)} | R$ ${(totalUsd * usdBrlCommercial).toFixed(2)}`;
    } else {
        focusedPositionTotalUsd = 0;
        focusedPositionFeesUsd = 0;
        document.getElementById('wallet-total-brz').textContent = `FAIXA MANUAL`;
        document.getElementById('wallet-total-usd').textContent = `${min.toFixed(5)} <> ${max.toFixed(5)}`;
    }

    recalculateRealPnL();
    evaluateRiskAlert(price, min, max);
}

function evaluateRiskAlert(price, min, max) {
    const statusEl = document.getElementById('alert-status');
    const span = max - min;
    const buffer = span * 0.08;

    if (price < min || price > max) {
        if (currentRiskState !== 'DANGER') {
            currentRiskState = 'DANGER';
            document.body.classList.remove('warning-mode');
            document.body.classList.add('danger-mode');
            statusEl.textContent = 'FORA DO RANGE';
            statusEl.className = 'status-pill danger';
            playBeep(320, 0.35, 'sawtooth');
        }
    } else if (price <= min + buffer || price >= max - buffer) {
        if (currentRiskState !== 'WARNING') {
            currentRiskState = 'WARNING';
            document.body.classList.remove('danger-mode');
            document.body.classList.add('warning-mode');
            statusEl.textContent = 'BORDA DO RANGE';
            statusEl.className = 'status-pill warning';
            playBeep(880, 0.2, 'sine');
        }
    } else {
        if (currentRiskState !== 'SAFE') {
            currentRiskState = 'SAFE';
            document.body.classList.remove('danger-mode', 'warning-mode');
            statusEl.textContent = 'SEGURO';
            statusEl.className = 'status-pill safe';
        }
    }
}

// =========================================================================
// GRÁFICO TRADINGVIEW & FEEDS EM TEMPO REAL
// =========================================================================
function initTradingViewChart() {
    const container = document.getElementById('tv-chart');
    chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight,
        layout: { background: { type: 'solid', color: '#030303' }, textColor: '#666' },
        grid: { vertLines: { color: 'rgba(255,255,255,0.025)' }, horzLines: { color: 'rgba(255,255,255,0.025)' } },
        crosshair: { vertLine: { color: '#cda434', style: 3 }, horzLine: { color: '#cda434', style: 3 } },
        timeScale: { timeVisible: true, borderColor: 'rgba(255,255,255,0.05)' },
        rightPriceScale: { borderColor: 'rgba(255,255,255,0.05)' }
    });

    candleSeries = chart.addCandlestickSeries({
        upColor: '#00ff88',
        downColor: '#ff2a40',
        borderVisible: false,
        wickUpColor: '#00ff88',
        wickDownColor: '#ff2a40',
        priceFormat: { type: 'price', precision: 6, minMove: 0.000001 }
    });

    new ResizeObserver(entries => {
        if (!entries.length) return;
        chart.resize(entries[0].contentRect.width, entries[0].contentRect.height);
    }).observe(container);

    document.querySelectorAll('.tf-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentInterval = e.target.getAttribute('data-interval');
            currentIntervalSeconds = parseInt(e.target.getAttribute('data-seconds'));
            syntheticCandle = null;
            loadChartHistory(currentInterval);
        });
    });

    loadChartHistory(currentInterval);
}

async function loadChartHistory(interval) {
    try {
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${interval}&limit=200`);
        const data = await res.json();
        const klines = data.map(d => ({
            time: Math.floor(d[0] / 1000),
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4])
        }));
        candleSeries.setData(klines);
        renderAllPositions();
    } catch (e) {}
}

function updateLiveCandle(price) {
    if (!candleSeries || price === 0) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const blockTime = Math.floor(nowSec / currentIntervalSeconds) * currentIntervalSeconds;
    if (!syntheticCandle || syntheticCandle.time !== blockTime) {
        syntheticCandle = { time: blockTime, open: price, high: price, low: price, close: price };
    } else {
        syntheticCandle.high = Math.max(syntheticCandle.high, price);
        syntheticCandle.low = Math.min(syntheticCandle.low, price);
        syntheticCandle.close = price;
    }
    candleSeries.update(syntheticCandle);
}

async function buildVariationsPanel() {
    const grid = document.getElementById('variations-grid');
    const frag = document.createDocumentFragment();
    let count = 0;

    for (const v of VAR_INTERVALS) {
        try {
            const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${v.key}&limit=2`);
            const data = await res.json();
            if (data && data.length > 0) {
                const current = parseFloat(data[data.length - 1][4]);
                const old = parseFloat(data[0][1]);
                const perc = ((current - old) / old) * 100;
                const isPos = perc >= 0;

                const card = document.createElement('div');
                card.className = 'var-card ' + (isPos ? 'positive' : 'negative');

                const lbl = document.createElement('span');
                lbl.className = 'var-label';
                lbl.textContent = v.label;

                const val = document.createElement('span');
                val.className = 'var-value';
                val.textContent = `${isPos ? '+' : ''}${perc.toFixed(2)}%`;

                card.appendChild(lbl);
                card.appendChild(val);
                frag.appendChild(card);
                count++;
            }
        } catch (e) {}
    }
    if (count > 0) grid.replaceChildren(frag);
}

function initGlobalTracker() {
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${SYMBOL.toLowerCase()}@ticker`);
    ws.onmessage = (event) => {
        const newPrice = parseFloat(JSON.parse(event.data).c);
        if (lastPriceGlobal !== 0 && newPrice !== lastPriceGlobal) {
            priceGlobalEl.classList.remove('tick-up', 'tick-down');
            void priceGlobalEl.offsetWidth;
            priceGlobalEl.classList.add(newPrice > lastPriceGlobal ? 'tick-up' : 'tick-down');
        }
        lastPriceGlobal = newPrice;
        currentPriceGlobal = newPrice;
        priceGlobalEl.textContent = currentPriceGlobal.toFixed(6);

        document.getElementById('macro-pol-brz').textContent = `${(currentPriceGlobal * getMotherRate()).toFixed(4)} BRZ`;
        document.getElementById('macro-pol-brl').textContent = `R$ ${(currentPriceGlobal * usdBrlCommercial).toFixed(4)}`;

        updateLiveCandle(currentPriceGlobal);
        recalculateLiveSniperBounds();
        updateFocusedMetrics();
        recalculatePixRanking();
    };
    ws.onclose = () => setTimeout(initGlobalTracker, 3000);
}

function initPolygonScanner() {
    const wsPool = new WebSocket('wss://polygon-bor-rpc.publicnode.com');
    const dot = document.getElementById('polygon-dot');
    wsPool.onopen = () => {
        wsPool.send(JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'eth_subscribe',
            params: ['logs', { address: POOL_ADDRESS }]
        }));
    };
    wsPool.onmessage = (event) => {
        const response = JSON.parse(event.data);
        if (response.method === 'eth_subscription' && response.params.result.topics[0] === SWAP_TOPIC) {
            dot.style.background = 'var(--dekton-copper)';
            setTimeout(() => dot.style.background = '#fff', 350);
            try {
                const parsed = iface.parseLog(response.params.result);
                const amount0 = parseFloat(ethers.utils.formatUnits(parsed.args.amount0.toString(), 18));
                const amount1 = parseFloat(ethers.utils.formatUnits(parsed.args.amount1.toString(), 6));
                const isBuy = amount0 < 0;
                const polVal = Math.abs(amount0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
                const brzVal = (Math.abs(amount1) * getMotherRate()).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
                const time = new Date().toLocaleTimeString('pt-BR', { hour12: false });

                const row = document.createElement('div');
                row.className = 'tape-row';

                const c1 = document.createElement('div'); c1.textContent = time;
                const c2 = document.createElement('div'); c2.className = isBuy ? 'type-buy' : 'type-sell'; c2.textContent = isBuy ? 'COMPRA' : 'VENDA';
                const c3 = document.createElement('div'); c3.textContent = `${brzVal} BRZ`;
                const c4 = document.createElement('div'); c4.textContent = `${polVal} P`;

                row.append(c1, c2, c3, c4);
                tapeEl.prepend(row);
                if (tapeEl.children.length > 30) tapeEl.removeChild(tapeEl.lastChild);
            } catch (e) {}
        }
    };
    wsPool.onclose = () => setTimeout(initPolygonScanner, 3500);
}

document.getElementById('btn-audio').addEventListener('click', async () => {
    const btn = document.getElementById('btn-audio');
    if (!audioEnabled) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        audioEnabled = true;
        btn.textContent = 'SOM: ON';
        btn.classList.add('active-audio');
        playBeep(1046, 0.12, 'sine');
    } else {
        audioEnabled = false;
        btn.textContent = 'SOM: OFF';
        btn.classList.remove('active-audio');
    }
});

function playBeep(freq, dur, type) {
    if (!audioEnabled || !audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
}

function setupResizers() {
    const res1 = document.getElementById('resizer-1');
    const res2 = document.getElementById('resizer-2');
    const leftCol = document.getElementById('col-left');
    const rightCol = document.getElementById('col-right');

    let activeResizer = null;
    res1.addEventListener('mousedown', () => { activeResizer = 1; res1.classList.add('dragging'); });
    res2.addEventListener('mousedown', () => { activeResizer = 2; res2.classList.add('dragging'); });

    window.addEventListener('mousemove', (e) => {
        if (!activeResizer) return;
        if (activeResizer === 1) {
            leftCol.style.width = Math.max(110, Math.min(340, e.clientX - 8)) + 'px';
        } else if (activeResizer === 2) {
            rightCol.style.width = Math.max(280, Math.min(560, window.innerWidth - e.clientX - 8)) + 'px';
        }
    });

    window.addEventListener('mouseup', () => {
        if (activeResizer) {
            res1.classList.remove('dragging');
            res2.classList.remove('dragging');
            activeResizer = null;
        }
    });
}

window.addEventListener('DOMContentLoaded', async () => {
    setupResizers();
    await loadFromTripleBackup();

    if (appState.wallet) {
        document.getElementById('wallet-address').value = appState.wallet;
    }

    syncPnlInputsWithFocused();
    initTradingViewChart();
    renderAllPositions();
    refreshMotherCurrencyOracle();
    setInterval(refreshMotherCurrencyOracle, 25000);
    refreshSniperModel15m();
    setInterval(refreshSniperModel15m, 15000);
    buildVariationsPanel();
    setInterval(buildVariationsPanel, 60000);
    initGlobalTracker();
    initPolygonScanner();
    recalculatePixRanking();
    refreshSwapQuote();
    setInterval(() => {
        if (document.getElementById('view-swap').classList.contains('active')) {
            refreshSwapQuote();
        }
    }, 8000);

    if (appState.wallet) {
        await runUnstoppableScan();
    }
    setInterval(refreshLivePoolFeesAndBalances, 12000);
});
