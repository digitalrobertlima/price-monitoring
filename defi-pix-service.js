/* =========================================================================
   RDESK SENTINEL — UNISWAP V3, SWAP/BRIDGE, PIX LÍQUIDO & AUDITORIA 1ª TX
   Arquivo 4 de 7: defi-pix-service.js
   ========================================================================= */

(function () {
    'use strict';

    // =========================================================================
    // ENDEREÇOS OFICIAIS UNISWAP V3 NA POLYGON MAINNET (CHAIN ID 137)
    // =========================================================================
    const POLYGON_ID = 137;
    const POOL_POL_USDT = '0x9b08288c3be4f62bbf8d1c20ac9c5e6f9467d8b7'; // Fee 500 (0.05%), tickSpacing 10
    const POOL_FEE = 500;
    const TICK_SPACING = 10;
    const NFPM_ADDRESS = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
    const SWAP_ROUTER_02 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
    const QUOTER_V2 = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';

    const ADDR_WPOL = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';
    const ADDR_USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
    const ADDR_USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
    const ADDR_BRZ  = '0x4eD141110F6EeeAbA9A1df36d8c26f684d2475Dc';
    const ADDR_BRLA = '0xE6A537a407488807F0bbeb0038B79004f19DDDFb';
    const ADDR_WBTC = '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6';

    const BLOCKSCOUT_V2 = 'https://polygon.blockscout.com/api/v2';
    const SIM_POSITIONS_KEY = 'rdesk_v22_sim_positions';

    // Tokens verificados na Polygon (ignora spam/phishing airdrops na auditoria)
    const VERIFIED_AUDIT_TOKENS = {
        '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': { symbol: 'WPOL', decimals: 18, kind: 'POL' },
        '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': { symbol: 'USDT0', decimals: 6, kind: 'USD' },
        '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': { symbol: 'USDC', decimals: 6, kind: 'USD' },
        '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': { symbol: 'USDC.e', decimals: 6, kind: 'USD' },
        '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': { symbol: 'DAI', decimals: 18, kind: 'USD' },
        '0x4ed141110f6eeeaba9a1df36d8c26f684d2475dc': { symbol: 'BRZ', decimals: 18, kind: 'BRL' },
        '0xe6a537a407488807f0bbeb0038b79004f19dddfb': { symbol: 'BRLA', decimals: 18, kind: 'BRL' },
        '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': { symbol: 'WETH', decimals: 18, kind: 'ETH' },
        '0x1bfd67037b42cf73acF2047067bd4f2c47d9bfd6': { symbol: 'WBTC', decimals: 8, kind: 'BTC' }
    };

    const defiState = {
        timeframe: '15m',
        candles: [],
        sniper: {
            min: 0.0810,
            max: 0.0950,
            tickLower: -301460,
            tickUpper: -299870,
            estBrlPerMin: 0
        },
        poolVol24hUsd: 1850000,
        livePositions: [],
        simPositions: [],
        swapQuote: null,
        pixOnlyNoKyc: false,
        audit: {
            currency: 'BRL',
            filter: 'ALL',
            events: [],
            overrides: {},
            ptaxMap: {},
            llamaDaily: {},
            contractCache: new Map(),
            lastWalletAudited: ''
        }
    };

    let rangeChart = null;
    let auditChart = null;
    let swapQuoteTimer = null;

    // =========================================================================
    // MATEMÁTICA UNISWAP V3 (WPOL 18 DEC / USDT0 6 DEC)
    // =========================================================================
    function priceToTickAligned(humanPrice) {
        if (!humanPrice || humanPrice <= 0) return -300600;
        const rawRatio = humanPrice * 1e-12; // 10^(6 - 18)
        const rawTick = Math.floor(Math.log(rawRatio) / Math.log(1.0001));
        return Math.round(rawTick / TICK_SPACING) * TICK_SPACING;
    }

    function tickToHumanPrice(tick) {
        return Math.pow(1.0001, Number(tick)) * 1e12;
    }

    function computeOptimalTokenRatio(currentPrice, minPrice, maxPrice) {
        if (currentPrice <= minPrice) return { wpolWeight: 1, usdtWeight: 0 };
        if (currentPrice >= maxPrice) return { wpolWeight: 0, usdtWeight: 1 };

        const sqrtP = Math.sqrt(currentPrice);
        const sqrtA = Math.sqrt(minPrice);
        const sqrtB = Math.sqrt(maxPrice);

        const amount0 = (1 / sqrtP) - (1 / sqrtB); // POL units per L
        const amount1 = sqrtP - sqrtA;             // USDT units per L

        const usd0 = amount0 * currentPrice;
        const usd1 = amount1;
        const total = usd0 + usd1;
        if (total <= 0) return { wpolWeight: 0.5, usdtWeight: 0.5 };
        return {
            wpolWeight: usd0 / total,
            usdtWeight: usd1 / total
        };
    }

    // =========================================================================
    // GRÁFICO TRADINGVIEW LIGHTWEIGHT CHARTS & TELEMETRIA SNIPER V3
    // =========================================================================
    function initEarnChart() {
        const container = document.getElementById('earn-chart-container');
        if (!container || !window.RdeskRangeChart) return;
        rangeChart = window.RdeskRangeChart.create(container, { height: 290, decimals: 4 });
    }

    // Faixa Sniper sugerida (tracejada) + cada posição real ou simulada (cheia; vermelha se fora da faixa)
    function redrawChartRangeLines() {
        if (!rangeChart) return;
        const bands = [];
        if (defiState.sniper.min > 0 && defiState.sniper.max > defiState.sniper.min) {
            bands.push({ min: defiState.sniper.min, max: defiState.sniper.max, color: '#38bdf8', label: 'Faixa Sniper', dashed: true });
        }
        [...defiState.livePositions, ...defiState.simPositions].forEach((p) => {
            const color = p.isSimulated ? '#eab308' : (p.inRange ? '#00e676' : '#f43f5e');
            bands.push({ min: p.minPrice, max: p.maxPrice, color, label: p.isSimulated ? `${p.label} (simulada)` : p.label, dashed: false });
        });
        rangeChart.setBands(bands);
        rangeChart.setSpot(currentSpotPrice());
    }

    // Preço de referência: o da própria pool quando já foi lido; senão a cotação de mercado.
    function currentSpotPrice() {
        return defiState.poolPrice > 0 ? defiState.poolPrice : (window.RdeskWallet.getPrices().POL || 0);
    }

    async function loadPoolCandlesAndComputeSniper() {
        const tf = defiState.timeframe || '15m';
        try {
            const [klinesRes, geckoRes] = await Promise.all([
                fetch(`https://api.binance.com/api/v3/klines?symbol=POLUSDT&interval=${tf}&limit=90`),
                fetch(`https://api.geckoterminal.com/api/v2/networks/polygon_pos/pools/${POOL_POL_USDT}`).catch(() => null)
            ]);

            if (geckoRes && geckoRes.ok) {
                const gJson = await geckoRes.json();
                const vol24 = parseFloat(gJson?.data?.attributes?.volume_usd?.h24);
                if (vol24 > 0) defiState.poolVol24hUsd = vol24;
            }

            if (klinesRes && klinesRes.ok) {
                const raw = await klinesRes.json();
                defiState.candles = raw.map(k => ({
                    time: Math.floor(k[0] / 1000),
                    open: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    close: parseFloat(k[4])
                }));

                if (rangeChart && defiState.candles.length > 0) {
                    rangeChart.setCandles(defiState.candles);
                }
            }
        } catch (e) {}

        recalculateSniperRange();
    }

    function getFreePolygonInvestableUsd() {
        const balances = window.RdeskWallet.getBalances();
        const prices = window.RdeskWallet.getPrices();
        const reservePol = window.RdeskWallet.GAS_RESERVE_POL;

        let polFree = 0;
        let wpolFree = 0;
        let usdtFree = 0;

        balances.forEach(b => {
            if (b.chainId !== POLYGON_ID) return;
            if (b.symbol === 'POL') polFree = Math.max(0, b.amount - reservePol);
            if (b.symbol === 'WPOL') wpolFree = b.amount;
            if (b.symbol === 'USDT') usdtFree = b.amount;
        });

        const totalUsd = ((polFree + wpolFree) * prices.POL) + usdtFree;
        return { polFree, wpolFree, usdtFree, totalUsd };
    }

    function recalculateSniperRange() {
        const prices = window.RdeskWallet.getPrices();
        const spot = currentSpotPrice() || 0.088;
        const candles = defiState.candles;

        // Calcula ATR(14) simples
        let atr = spot * 0.018;
        if (candles.length >= 15) {
            let sumTr = 0;
            for (let i = candles.length - 14; i < candles.length; i++) {
                const c = candles[i];
                const prevClose = candles[i - 1].close;
                const tr = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
                sumTr += tr;
            }
            atr = sumTr / 14;
        }

        // Largura base Sniper = ~3.5x ATR(14)
        let halfBand = Math.max(spot * 0.025, atr * 3.5);

        // Se o usuário informou meta opcional em R$/min, ajusta largura da faixa
        const customTargetBrlMin = parseFloat(document.getElementById('earn-target-brl-min')?.value);
        const freeCap = getFreePolygonInvestableUsd();
        const capitalUsd = Math.max(10, freeCap.totalUsd);

        // Estimativa conservadora de rendimento por minuto em faixa concentrada
        const dailyFeesPoolUsd = defiState.poolVol24hUsd * 0.0005;
        const activePoolTvlRef = 320000; // Liquidez ativa concentrada de referência
        const baseWidthPct = (halfBand * 2) / spot;

        if (Number.isFinite(customTargetBrlMin) && customTargetBrlMin > 0) {
            const targetUsdMin = customTargetBrlMin / (prices.USD_BRL || 5.65);
            const neededConcentration = (targetUsdMin * 1440) / ((capitalUsd / activePoolTvlRef) * dailyFeesPoolUsd || 0.01);
            const targetWidthPct = Math.min(0.45, Math.max(0.012, 0.14 / Math.max(0.2, neededConcentration)));
            halfBand = (spot * targetWidthPct) / 2;
        }

        const tickLower = priceToTickAligned(Math.max(0.001, spot - halfBand));
        const tickUpper = Math.max(tickLower + TICK_SPACING, priceToTickAligned(spot + halfBand));
        const minPrice = tickToHumanPrice(tickLower);
        const maxPrice = tickToHumanPrice(tickUpper);

        const actualWidthPct = Math.max(0.01, (maxPrice - minPrice) / spot);
        const concentrationFactor = Math.min(18, 0.16 / actualWidthPct);
        const estUsdPerDay = (freeCap.totalUsd / activePoolTvlRef) * dailyFeesPoolUsd * concentrationFactor;
        const estBrlPerMin = (estUsdPerDay * prices.USD_BRL) / 1440;

        defiState.sniper = { min: minPrice, max: maxPrice, tickLower, tickUpper, estBrlPerMin };

        const freeEl = document.getElementById('earn-free-brl');
        const rateEl = document.getElementById('earn-est-rate');
        const rangeEl = document.getElementById('earn-range-preview');

        if (freeEl) freeEl.textContent = window.RdeskWallet.formatBRL(freeCap.totalUsd * prices.USD_BRL);
        if (rateEl) rateEl.textContent = `R$ ${estBrlPerMin.toFixed(4).replace('.', ',')}/min`;
        if (rangeEl) rangeEl.textContent = `$ ${minPrice.toFixed(4)} – $ ${maxPrice.toFixed(4)}`;

        redrawChartRangeLines();
    }

    // =========================================================================
    // LEITURA ON-CHAIN DAS POSIÇÕES UNISWAP V3 & PILOTO AUTOMÁTICO
    // =========================================================================
    async function refreshUniswapPositions() {
        const addr = window.RdeskWallet.getAddress();
        const prices = window.RdeskWallet.getPrices();
        const spot = prices.POL || 0.088;

        loadSavedSimPositions();

        if (!addr) {
            defiState.livePositions = [];
            window.RdeskWallet.setLpUsdTotal(0);
            updateTopPoolStatusPill(spot);
            renderPositionsCards();
            redrawChartRangeLines();
            return;
        }

        try {
            const provider = await window.RdeskWallet.getReadProvider(POLYGON_ID);
            const nfpmAbi = [
                'function balanceOf(address) view returns (uint256)',
                'function tokenOfOwnerByIndex(address, uint256) view returns (uint256)',
                'function positions(uint256) view returns (uint96,address,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256,uint256,uint128 tokensOwed0,uint128 tokensOwed1)',
                'function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) returns (uint256 amount0, uint256 amount1)'
            ];
            const poolAbi = [
                'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)'
            ];

            const nfpm = new ethers.Contract(NFPM_ADDRESS, nfpmAbi, provider);
            const pool = new ethers.Contract(POOL_POL_USDT, poolAbi, provider);

            const [countBN, slot0] = await Promise.all([nfpm.balanceOf(addr), pool.slot0()]);
            const count = countBN.toNumber();
            const currentTick = Number(slot0.tick);
            const sqrtP = Math.pow(1.0001, currentTick / 2);
            defiState.poolTick = currentTick;
            defiState.poolPrice = Math.pow(1.0001, currentTick) * 1e12;
            window.RdeskWallet.notePoolPrice?.(defiState.poolPrice);
            const MAX_U128 = ethers.BigNumber.from('340282366920938463463374607431768211455');

            const loaded = [];
            let totalLpUsd = 0;

            for (let i = 0; i < count; i++) {
                const tokenIdBN = await nfpm.tokenOfOwnerByIndex(addr, i);
                const pos = await nfpm.positions(tokenIdBN);
                const isMainPair =
                    pos.token0.toLowerCase() === ADDR_WPOL.toLowerCase() &&
                    pos.token1.toLowerCase() === ADDR_USDT.toLowerCase();

                if (!isMainPair) continue;

                const liqStr = pos.liquidity.toString();
                let unclaimed0 = parseFloat(ethers.utils.formatEther(pos.tokensOwed0));
                let unclaimed1 = parseFloat(ethers.utils.formatUnits(pos.tokensOwed1, 6));

                // Lê tarifas exatas não colhidas em tempo real via callStatic.collect
                try {
                    const simCollect = await nfpm.callStatic.collect({
                        tokenId: tokenIdBN,
                        recipient: addr,
                        amount0Max: MAX_U128,
                        amount1Max: MAX_U128
                    });
                    unclaimed0 = parseFloat(ethers.utils.formatEther(simCollect.amount0));
                    unclaimed1 = parseFloat(ethers.utils.formatUnits(simCollect.amount1, 6));
                } catch (e) {}

                if (pos.liquidity.isZero() && unclaimed0 === 0 && unclaimed1 === 0) continue;

                const L = parseFloat(liqStr);
                const tickLower = Number(pos.tickLower);
                const tickUpper = Number(pos.tickUpper);
                const sA = Math.pow(1.0001, tickLower / 2);
                const sB = Math.pow(1.0001, tickUpper / 2);

                let raw0 = 0, raw1 = 0;
                if (L > 0) {
                    if (sqrtP <= sA) raw0 = L * ((1 / sA) - (1 / sB));
                    else if (sqrtP >= sB) raw1 = L * (sB - sA);
                    else {
                        raw0 = L * ((1 / sqrtP) - (1 / sB));
                        raw1 = L * (sqrtP - sA);
                    }
                }

                const polPrincipal = raw0 / 1e18;
                const usdtPrincipal = raw1 / 1e6;
                const principalUsd = (polPrincipal * spot) + usdtPrincipal;
                const feesUsd = (unclaimed0 * spot) + unclaimed1;
                const posTotalUsd = principalUsd + feesUsd;

                totalLpUsd += posTotalUsd;

                const minPrice = tickToHumanPrice(tickLower);
                const maxPrice = tickToHumanPrice(tickUpper);
                const inRange = currentTick >= tickLower && currentTick < tickUpper;

                loaded.push({
                    id: tokenIdBN.toString(),
                    tokenId: tokenIdBN,
                    label: `NFT #${tokenIdBN.toString()}`,
                    tickLower,
                    tickUpper,
                    minPrice,
                    maxPrice,
                    liquidity: pos.liquidity,
                    polPrincipal,
                    usdtPrincipal,
                    principalUsd,
                    feesUsd,
                    totalUsd: posTotalUsd,
                    inRange,
                    isSimulated: false
                });
            }

            defiState.livePositions = loaded;
            window.RdeskWallet.setLpUsdTotal(totalLpUsd);
            updateTopPoolStatusPill(spot);
            renderPositionsCards();
            redrawChartRangeLines();
        } catch (err) {
            console.warn('Falha ao ler posições V3:', err.message);
        }
    }

    function updateTopPoolStatusPill(spot) {
        const pill = document.getElementById('top-status-pill');
        if (!pill) return;

        if (defiState.livePositions.length === 0) {
            pill.className = 'pill-badge safe';
            pill.textContent = 'PRONTO';
            return;
        }

        const outAny = defiState.livePositions.some(p => !p.inRange);
        if (outAny) {
            pill.className = 'pill-badge danger';
            pill.textContent = 'FORA DA FAIXA';
            return;
        }

        const nearEdge = defiState.livePositions.some(p => {
            const span = p.maxPrice - p.minPrice;
            return (spot - p.minPrice) < span * 0.1 || (p.maxPrice - spot) < span * 0.1;
        });

        if (nearEdge) {
            pill.className = 'pill-badge warning';
            pill.textContent = 'BORDA';
        } else {
            pill.className = 'pill-badge safe';
            pill.textContent = 'SEGURO';
        }
    }

    function renderPositionsCards() {
        const container = document.getElementById('active-positions-list');
        if (!container) return;
        container.replaceChildren();

        const prices = window.RdeskWallet.getPrices();
        const all = [...defiState.livePositions, ...defiState.simPositions];

        if (all.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'Nenhuma posição ativa na Uniswap V3. Use o Piloto Automático acima para começar.';
            container.appendChild(empty);
            return;
        }

        all.forEach(pos => {
            const card = document.createElement('div');
            card.className = 'position-card';

            const head = document.createElement('div');
            head.className = 'pos-header';

            const title = document.createElement('strong');
            title.textContent = `${pos.label} • POL / USDT0 (0.05%)`;

            const badge = document.createElement('span');
            if (pos.isSimulated) {
                badge.className = 'pill-badge warning';
                badge.textContent = 'SIMULAÇÃO';
            } else if (pos.inRange) {
                badge.className = 'pill-badge safe';
                badge.textContent = '● RENDENDO';
            } else {
                badge.className = 'pill-badge danger';
                badge.textContent = '● FORA DA FAIXA';
            }
            head.append(title, badge);

            const stats = document.createElement('div');
            stats.className = 'pos-stats-grid';

            const s1 = document.createElement('div');
            s1.innerHTML = `<span class="muted-sm">Faixa</span><br><strong>$${pos.minPrice.toFixed(4)} – $${pos.maxPrice.toFixed(4)}</strong>`;

            const s2 = document.createElement('div');
            const totalBrl = pos.isSimulated ? 0 : pos.totalUsd * prices.USD_BRL;
            s2.innerHTML = `<span class="muted-sm">Valor na Pool</span><br><strong>${pos.isSimulated ? 'Estudo' : window.RdeskWallet.formatBRL(totalBrl)}</strong>`;

            const s3 = document.createElement('div');
            const feesBrl = pos.isSimulated ? 0 : pos.feesUsd * prices.USD_BRL;
            s3.innerHTML = `<span class="muted-sm">Tarifas Acumuladas</span><br><strong style="color:var(--green-bright);">${pos.isSimulated ? '--' : window.RdeskWallet.formatBRL(feesBrl)}</strong>`;

            stats.append(s1, s2, s3);

            // Medidor visual: posição do preço atual dentro da faixa (ou colado na borda quando saiu)
            const meter = document.createElement('div');
            const spotNow = currentSpotPrice();
            const ratio = (spotNow - pos.minPrice) / (pos.maxPrice - pos.minPrice);
            const outOfRange = !pos.isSimulated && !pos.inRange;
            meter.className = `pos-range-meter${outOfRange ? ' out' : ''}`;
            const track = document.createElement('div');
            track.className = 'pos-range-track';
            const fill = document.createElement('div');
            fill.className = 'pos-range-fill';
            const marker = document.createElement('div');
            marker.className = 'pos-range-marker';
            marker.style.left = `${Math.min(100, Math.max(0, ratio * 100)).toFixed(1)}%`;
            track.append(fill, marker);
            const legend = document.createElement('div');
            legend.className = 'pos-range-legend';
            const lMin = document.createElement('span'); lMin.textContent = `$${pos.minPrice.toFixed(4)}`;
            const lNow = document.createElement('strong');
            lNow.textContent = ratio < 0 ? `preço $${spotNow.toFixed(4)} abaixo da faixa` : ratio > 1 ? `preço $${spotNow.toFixed(4)} acima da faixa` : `preço $${spotNow.toFixed(4)}`;
            const lMax = document.createElement('span'); lMax.textContent = `$${pos.maxPrice.toFixed(4)}`;
            legend.append(lMin, lNow, lMax);
            meter.append(track, legend);

            const btnRow = document.createElement('div');
            btnRow.className = 'pos-btn-row';

            if (pos.isSimulated) {
                const btnDel = document.createElement('button');
                btnDel.type = 'button';
                btnDel.className = 'btn-ghost';
                btnDel.textContent = 'Remover Simulação';
                btnDel.addEventListener('click', () => {
                    defiState.simPositions = defiState.simPositions.filter(x => x.id !== pos.id);
                    localStorage.setItem(SIM_POSITIONS_KEY, JSON.stringify(defiState.simPositions));
                    renderPositionsCards();
                    redrawChartRangeLines();
                });
                btnRow.appendChild(btnDel);
            } else {
                const btnCollect = document.createElement('button');
                btnCollect.type = 'button';
                btnCollect.className = 'btn-ghost';
                btnCollect.textContent = 'Colher Tarifas';
                btnCollect.addEventListener('click', () => collectPositionFees(pos));

                const btnRebal = document.createElement('button');
                btnRebal.type = 'button';
                btnRebal.className = 'btn-primary-sm';
                btnRebal.textContent = 'Rebalancear';
                btnRebal.addEventListener('click', () => rebalancePosition(pos));

                const btnClose = document.createElement('button');
                btnClose.type = 'button';
                btnClose.className = 'btn-ghost';
                btnClose.style.color = 'var(--red)';
                btnClose.textContent = 'Encerrar Pool';
                btnClose.addEventListener('click', () => withdrawPosition(pos));

                btnRow.append(btnCollect, btnRebal, btnClose);
            }

            card.append(head, stats, meter, btnRow);
            container.appendChild(card);
        });
    }

    function loadSavedSimPositions() {
        try {
            const raw = localStorage.getItem(SIM_POSITIONS_KEY);
            defiState.simPositions = raw ? JSON.parse(raw) : [];
        } catch (e) {
            defiState.simPositions = [];
        }
    }

    // =========================================================================
    // EXECUÇÃO ON-CHAIN UNISWAP V3 (APROVAÇÃO EXATA & SIMULAÇÃO CALLSTATIC)
    // =========================================================================
    async function ensureExactErc20Approval(tokenAddress, spender, requiredAmountBN, signer) {
        const owner = await signer.getAddress();
        const erc20 = new ethers.Contract(
            tokenAddress,
            [
                'function allowance(address owner, address spender) view returns (uint256)',
                'function approve(address spender, uint256 value) returns (bool)'
            ],
            signer
        );
        const currentAllowance = await erc20.allowance(owner, spender);
        if (currentAllowance.gte(requiredAmountBN)) return;
        if (!currentAllowance.isZero()) {
            const txReset = await erc20.approve(spender, 0);
            await txReset.wait();
        }
        const tx = await erc20.approve(spender, requiredAmountBN);
        await tx.wait();
    }

    // Lê o preço atual direto da pool (referência para proporção e proteção de slippage).
    async function readPoolPrice(providerOrSigner) {
        const pool = new ethers.Contract(
            POOL_POL_USDT,
            ['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)'],
            providerOrSigner
        );
        const slot0 = await pool.slot0();
        defiState.poolTick = Number(slot0.tick);
        defiState.poolPrice = Math.pow(1.0001, defiState.poolTick) * 1e12;
        window.RdeskWallet.notePoolPrice?.(defiState.poolPrice);
        return defiState.poolPrice;
    }

    const SLIPPAGE_BPS = 150;          // 1,5%
    const MAX_POOL_DEVIATION = 0.03;   // pool x mercado: acima disso, não opera
    const applySlippage = (bn) => bn.mul(10000 - SLIPPAGE_BPS).div(10000);

    async function startAutopilotPosition(skipConfirm = false) {
        const fb = document.getElementById('autopilot-feedback');
        const btn = document.getElementById('btn-start-autopilot');
        fb.style.color = 'var(--accent)';
        fb.textContent = '';

        const prices = window.RdeskWallet.getPrices();
        let spot = prices.POL || 0.088;
        const cap = getFreePolygonInvestableUsd();

        if (cap.totalUsd < 2.0) {
            fb.style.color = 'var(--red)';
            fb.textContent = `Saldo livre insuficiente acima da reserva de ${window.RdeskWallet.GAS_RESERVE_POL} POL para gás.`;
            return;
        }

        const totalBrl = cap.totalUsd * prices.USD_BRL;
        const confirmed = skipConfirm || await window.RdeskReceipt.confirm({
            title: 'Ativar Piloto Automático Uniswap V3',
            sendVal: `${cap.polFree.toFixed(2)} POL + ${cap.wpolFree.toFixed(2)} WPOL + ${cap.usdtFree.toFixed(2)} USDT0`,
            sendBrl: window.RdeskWallet.formatBRL(totalBrl),
            recvVal: `Pool POL/USDT0 ($${defiState.sniper.min.toFixed(4)} – $${defiState.sniper.max.toFixed(4)})`,
            recvBrl: `Est. R$ ${defiState.sniper.estBrlPerMin.toFixed(4)}/min`,
            route: 'Uniswap V3 NFPM (Polygon)',
            fee: 'R$ 0,00 (Sem taxa do app)',
            gas: '~R$ 0,06 (Wrap + Swap + Mint)',
            shield: '3.0 POL livres garantidos'
        });

        if (!confirmed) return;

        try {
            btn.disabled = true;
            defiState.busy = true;
            const signer = await window.RdeskWallet.getSigner(POLYGON_ID);
            const owner = await signer.getAddress();

            // Preço de referência = o da própria pool. Se divergir demais do mercado, não opera.
            const marketPrice = spot;
            spot = await readPoolPrice(signer);
            if (marketPrice > 0 && Math.abs(spot - marketPrice) / marketPrice > MAX_POOL_DEVIATION) {
                throw new Error(`Preço da pool ($${spot.toFixed(5)}) está ${(Math.abs(spot - marketPrice) / marketPrice * 100).toFixed(1)}% diferente do mercado ($${marketPrice.toFixed(5)}). Operação cancelada por segurança; tente de novo em instantes.`);
            }
            if (!(defiState.sniper.tickLower < defiState.poolTick && defiState.poolTick < defiState.sniper.tickUpper)) {
                recalculateSniperRange();
            }

            // 1. Wrap POL excedente em WPOL (mantendo 3.0 POL nativos)
            if (cap.polFree > 0.05) {
                fb.textContent = `Etapa 1/3: Convertendo ${cap.polFree.toFixed(2)} POL em WPOL...`;
                const wpolContract = new ethers.Contract(ADDR_WPOL, ['function deposit() payable'], signer);
                const wrapWei = ethers.utils.parseEther(cap.polFree.toFixed(6));
                const txWrap = await wpolContract.deposit({ value: wrapWei });
                await txWrap.wait();
            }

            // Lê saldos atualizados de WPOL e USDT0
            const erc20BalAbi = ['function balanceOf(address) view returns (uint256)'];
            const wpolRead = new ethers.Contract(ADDR_WPOL, erc20BalAbi, signer);
            const usdtRead = new ethers.Contract(ADDR_USDT, erc20BalAbi, signer);

            let wpolBN = await wpolRead.balanceOf(owner);
            let usdtBN = await usdtRead.balanceOf(owner);

            const wpolUsd = parseFloat(ethers.utils.formatEther(wpolBN)) * spot;
            const usdtUsd = parseFloat(ethers.utils.formatUnits(usdtBN, 6));
            const combinedUsd = wpolUsd + usdtUsd;

            const ratio = computeOptimalTokenRatio(spot, defiState.sniper.min, defiState.sniper.max);
            const targetWpolUsd = combinedUsd * ratio.wpolWeight;
            const diffUsd = wpolUsd - targetWpolUsd;

            // 2. Equilibra WPOL <-> USDT0 se diferença > $0.50
            if (Math.abs(diffUsd) > 0.5) {
                fb.textContent = 'Etapa 2/3: Equilibrando proporção WPOL / USDT0 na Uniswap V3...';
                const router = new ethers.Contract(
                    SWAP_ROUTER_02,
                    ['function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)'],
                    signer
                );
                if (diffUsd > 0) {
                    const polToSell = diffUsd / spot;
                    const amtIn = ethers.utils.parseEther(polToSell.toFixed(6));
                    if (amtIn.gt(0) && amtIn.lte(wpolBN)) {
                        await ensureExactErc20Approval(ADDR_WPOL, SWAP_ROUTER_02, amtIn, signer);
                        const minOut = ethers.utils.parseUnits((diffUsd * (1 - POOL_FEE / 1e6) * (1 - SLIPPAGE_BPS / 1e4)).toFixed(6), 6);
                        const txSwap = await router.exactInputSingle({
                            tokenIn: ADDR_WPOL,
                            tokenOut: ADDR_USDT,
                            fee: POOL_FEE,
                            recipient: owner,
                            amountIn: amtIn,
                            amountOutMinimum: minOut,
                            sqrtPriceLimitX96: 0
                        });
                        await txSwap.wait();
                    }
                } else {
                    const usdtToSell = Math.abs(diffUsd);
                    const amtIn = ethers.utils.parseUnits(usdtToSell.toFixed(6), 6);
                    if (amtIn.gt(0) && amtIn.lte(usdtBN)) {
                        await ensureExactErc20Approval(ADDR_USDT, SWAP_ROUTER_02, amtIn, signer);
                        const minOut = ethers.utils.parseEther(((usdtToSell / spot) * (1 - POOL_FEE / 1e6) * (1 - SLIPPAGE_BPS / 1e4)).toFixed(6));
                        const txSwap = await router.exactInputSingle({
                            tokenIn: ADDR_USDT,
                            tokenOut: ADDR_WPOL,
                            fee: POOL_FEE,
                            recipient: owner,
                            amountIn: amtIn,
                            amountOutMinimum: minOut,
                            sqrtPriceLimitX96: 0
                        });
                        await txSwap.wait();
                    }
                }
            }

            // 3. Aprova valores exatos e cria posição NFT na Uniswap V3
            fb.textContent = 'Etapa 3/3: Abrindo posição de liquidez na Uniswap V3...';
            wpolBN = await wpolRead.balanceOf(owner);
            usdtBN = await usdtRead.balanceOf(owner);

            if (wpolBN.gt(0)) await ensureExactErc20Approval(ADDR_WPOL, NFPM_ADDRESS, wpolBN, signer);
            if (usdtBN.gt(0)) await ensureExactErc20Approval(ADDR_USDT, NFPM_ADDRESS, usdtBN, signer);

            const nfpm = new ethers.Contract(
                NFPM_ADDRESS,
                ['function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'],
                signer
            );

            const deadline = Math.floor(Date.now() / 1000) + 600;
            const mintParams = {
                token0: ADDR_WPOL,
                token1: ADDR_USDT,
                fee: POOL_FEE,
                tickLower: defiState.sniper.tickLower,
                tickUpper: defiState.sniper.tickUpper,
                amount0Desired: wpolBN,
                amount1Desired: usdtBN,
                amount0Min: 0,
                amount1Min: 0,
                recipient: owner,
                deadline
            };

            // Simulação callStatic anti-revert / anti-MEV
            const sim = await nfpm.callStatic.mint(mintParams);
            mintParams.amount0Min = applySlippage(sim.amount0);
            mintParams.amount1Min = applySlippage(sim.amount1);

            const txMint = await nfpm.mint(mintParams);
            await txMint.wait();

            fb.style.color = 'var(--green-bright)';
            fb.textContent = '✓ Posição aberta e rendendo tarifas na Uniswap V3!';
            await window.RdeskWallet.refreshBalances();
            await refreshUniswapPositions();
        } catch (err) {
            fb.style.color = 'var(--red)';
            fb.textContent = err?.reason || err?.message || 'Operação cancelada.';
        } finally {
            btn.disabled = false;
            defiState.busy = false;
        }
    }

    async function collectPositionFees(pos) {
        const prices = window.RdeskWallet.getPrices();
        const confirmed = await window.RdeskReceipt.confirm({
            title: `Colher Tarifas (${pos.label})`,
            sendVal: '0 tokens (Apenas coleta)',
            sendBrl: 'R$ 0,00',
            recvVal: 'Tarifas acumuladas em WPOL + USDT0',
            recvBrl: window.RdeskWallet.formatBRL(pos.feesUsd * prices.USD_BRL),
            route: 'Uniswap V3 NFPM collect()',
            fee: 'R$ 0,00',
            gas: '~R$ 0,02 (Polygon)',
            shield: 'Liquidez da pool permanece ativa'
        });
        if (!confirmed) return;

        try {
            const signer = await window.RdeskWallet.getSigner(POLYGON_ID);
            const owner = await signer.getAddress();
            const MAX_U128 = ethers.BigNumber.from('340282366920938463463374607431768211455');
            const nfpm = new ethers.Contract(
                NFPM_ADDRESS,
                ['function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) payable returns (uint256, uint256)'],
                signer
            );
            const tx = await nfpm.collect({
                tokenId: pos.tokenId,
                recipient: owner,
                amount0Max: MAX_U128,
                amount1Max: MAX_U128
            });
            await tx.wait();
            await window.RdeskWallet.refreshBalances();
            await refreshUniswapPositions();
        } catch (err) {
            alert(err?.reason || err?.message || 'Erro ao colher tarifas.');
        }
    }

    async function withdrawPosition(pos, skipConfirm = false) {
        const prices = window.RdeskWallet.getPrices();
        if (!skipConfirm) {
            const confirmed = await window.RdeskReceipt.confirm({
                title: `Encerrar Posição (${pos.label})`,
                sendVal: `Liquidez ${pos.label}`,
                sendBrl: window.RdeskWallet.formatBRL(pos.totalUsd * prices.USD_BRL),
                recvVal: 'WPOL + USDT0 + Tarifas direto na carteira',
                recvBrl: window.RdeskWallet.formatBRL(pos.totalUsd * prices.USD_BRL),
                route: 'Uniswap V3 decreaseLiquidity + collect',
                fee: 'R$ 0,00',
                gas: '~R$ 0,03 (Polygon)',
                shield: '100% do saldo volta para sua carteira'
            });
            if (!confirmed) return false;
        }

        try {
            const signer = await window.RdeskWallet.getSigner(POLYGON_ID);
            const owner = await signer.getAddress();
            const MAX_U128 = ethers.BigNumber.from('340282366920938463463374607431768211455');
            const nfpm = new ethers.Contract(
                NFPM_ADDRESS,
                [
                    'function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) payable returns (uint256, uint256)',
                    'function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) payable returns (uint256, uint256)',
                    'function multicall(bytes[] data) payable returns (bytes[] results)'
                ],
                signer
            );

            const calls = [];
            if (pos.liquidity.gt(0)) {
                const decParams = {
                    tokenId: pos.tokenId,
                    liquidity: pos.liquidity,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: Math.floor(Date.now() / 1000) + 600
                };
                // Simula a retirada e exige no mínimo 98,5% do simulado (proteção anti-sandwich)
                const simDec = await nfpm.callStatic.decreaseLiquidity(decParams);
                decParams.amount0Min = applySlippage(simDec[0]);
                decParams.amount1Min = applySlippage(simDec[1]);
                calls.push(nfpm.interface.encodeFunctionData('decreaseLiquidity', [decParams]));
            }
            calls.push(nfpm.interface.encodeFunctionData('collect', [{
                tokenId: pos.tokenId,
                recipient: owner,
                amount0Max: MAX_U128,
                amount1Max: MAX_U128
            }]));

            const txClose = await nfpm.multicall(calls);
            await txClose.wait();

            await window.RdeskWallet.refreshBalances();
            await refreshUniswapPositions();
            return true;
        } catch (err) {
            alert(err?.reason || err?.message || 'Erro ao encerrar posição.');
            return false;
        }
    }

    async function rebalancePosition(pos) {
        const prices = window.RdeskWallet.getPrices();
        const confirmed = await window.RdeskReceipt.confirm({
            title: `Rebalancear ${pos.label} para Nova Faixa`,
            sendVal: `${pos.label} ($${pos.minPrice.toFixed(4)} – $${pos.maxPrice.toFixed(4)})`,
            sendBrl: window.RdeskWallet.formatBRL(pos.totalUsd * prices.USD_BRL),
            recvVal: `Nova Faixa ($${defiState.sniper.min.toFixed(4)} – $${defiState.sniper.max.toFixed(4)})`,
            recvBrl: 'Mesmo capital, faixa recentrada no preço atual',
            route: 'Fechar Antiga → Equilibrar → Abrir Nova',
            fee: 'R$ 0,00',
            gas: '~R$ 0,08 (Polygon)',
            shield: '3.0 POL protegidos na carteira'
        });
        if (!confirmed) return;

        const closed = await withdrawPosition(pos, true);
        if (closed) {
            await loadPoolCandlesAndComputeSniper();
            await startAutopilotPosition(true);
        }
    }

    // =========================================================================
    // TROCA DEX (UNISWAP V3) & PONTE MULTI-REDE (LI.FI)
    // =========================================================================
    function resolveTokenAddressForSwap(chainId, symbol) {
        if (chainId === 137 && symbol === 'POL') return ADDR_WPOL;
        const list = window.RdeskWallet.CHAIN_TOKENS[chainId] || [];
        const found = list.find(t => t.symbol === symbol);
        if (!found) return null;
        return found.isNative ? '0x0000000000000000000000000000000000000000' : found.address;
    }

    function getTokenMeta(chainId, symbol) {
        const list = window.RdeskWallet.CHAIN_TOKENS[chainId] || [];
        return list.find(t => t.symbol === symbol) || null;
    }

    function updateSwapFromBalanceDisplay() {
        const fromChain = Number(document.getElementById('swap-from-chain')?.value || 137);
        const fromSym = document.getElementById('swap-from-token')?.value || 'POL';
        const balances = window.RdeskWallet.getBalances();
        const found = balances.find(b => b.chainId === fromChain && b.symbol === fromSym);
        const avail = found ? found.amount : 0;

        const balEl = document.getElementById('swap-from-bal');
        if (balEl) balEl.textContent = `${avail.toFixed(4)} ${fromSym}`;
    }

    async function refreshSwapQuote() {
        const fromChain = Number(document.getElementById('swap-from-chain')?.value || 137);
        const toChain = Number(document.getElementById('swap-to-chain')?.value || 137);
        const fromSym = document.getElementById('swap-from-token')?.value || 'POL';
        const toSym = document.getElementById('swap-to-token')?.value || 'USDT';
        const amountIn = parseFloat(document.getElementById('swap-amount-in')?.value) || 0;

        const outInput = document.getElementById('swap-amount-out');
        const infoEl = document.getElementById('swap-quote-info');
        updateSwapFromBalanceDisplay();

        if (amountIn <= 0) {
            if (outInput) outInput.value = '0.00';
            defiState.swapQuote = null;
            return;
        }

        const fromMeta = getTokenMeta(fromChain, fromSym);
        const toMeta = getTokenMeta(toChain, toSym);
        if (!fromMeta || !toMeta) {
            if (outInput) outInput.value = '--';
            if (infoEl) infoEl.textContent = 'Par indisponível nesta rede';
            defiState.swapQuote = null;
            return;
        }

        // Caso 1: Wrap / Unwrap 1:1 POL <-> WPOL na Polygon
        if (fromChain === 137 && toChain === 137 &&
            ((fromSym === 'POL' && toSym === 'WPOL') || (fromSym === 'WPOL' && toSym === 'POL'))) {
            if (outInput) outInput.value = amountIn.toFixed(4);
            if (infoEl) infoEl.textContent = 'Conversão 1:1 (0% tarifa DEX)';
            defiState.swapQuote = {
                type: 'WRAP_UNWRAP',
                fromChain,
                toChain,
                fromSym,
                toSym,
                amountIn,
                amountOut: amountIn,
                routeLabel: 'Contrato Oficial WPOL (1:1)'
            };
            return;
        }

        // Caso 2: Mesma rede Polygon -> Uniswap V3 QuoterV2
        if (fromChain === 137 && toChain === 137) {
            const addrIn = resolveTokenAddressForSwap(137, fromSym);
            const addrOut = resolveTokenAddressForSwap(137, toSym);
            if (!addrIn || !addrOut || addrIn === addrOut) return;

            const prices = window.RdeskWallet.getPrices();
            const usdIn = amountIn * (fromMeta.priceKey === 'USD' ? 1 : fromMeta.priceKey === 'BRL' ? (1 / prices.USD_BRL) : (prices[fromMeta.priceKey] || 0));
            const unitOutUsd = toMeta.priceKey === 'USD' ? 1 : toMeta.priceKey === 'BRL' ? (1 / prices.USD_BRL) : (prices[toMeta.priceKey] || 1);
            let estOut = unitOutUsd > 0 ? (usdIn / unitOutUsd) * 0.999 : 0;

            try {
                const provider = await window.RdeskWallet.getReadProvider(137);
                const quoter = new ethers.Contract(
                    QUOTER_V2,
                    ['function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160, uint32, uint256)'],
                    provider
                );
                const rawIn = ethers.utils.parseUnits(amountIn.toFixed(fromMeta.decimals), fromMeta.decimals);
                const res = await quoter.callStatic.quoteExactInputSingle({
                    tokenIn: addrIn,
                    tokenOut: addrOut,
                    amountIn: rawIn,
                    fee: POOL_FEE,
                    sqrtPriceLimitX96: 0
                });
                estOut = parseFloat(ethers.utils.formatUnits(res.amountOut, toMeta.decimals));
            } catch (e) {
                // Sem pool direta de 0,05% para o par: não oferece uma troca que reverteria.
                if (outInput) outInput.value = '--';
                if (infoEl) infoEl.textContent = 'Sem pool direta para este par na Uniswap V3 (0,05%). Troque passando por USDT.';
                defiState.swapQuote = null;
                return;
            }

            if (outInput) outInput.value = estOut.toFixed(4);
            if (infoEl) infoEl.textContent = 'Uniswap V3 Polygon (0.05%)';
            defiState.swapQuote = {
                type: 'UNISWAP_V3',
                fromChain: 137,
                toChain: 137,
                fromSym,
                toSym,
                fromMeta,
                toMeta,
                addrIn,
                addrOut,
                amountIn,
                amountOut: estOut,
                routeLabel: 'Uniswap V3 SwapRouter02 (Polygon)'
            };
            return;
        }

        // Caso 3: Cross-chain ou outras EVMs -> LI.FI Quote API
        try {
            if (infoEl) infoEl.textContent = 'Consultando ponte cross-chain...';
            const fromTokenAddr = fromMeta.isNative ? '0x0000000000000000000000000000000000000000' : fromMeta.address;
            const toTokenAddr = toMeta.isNative ? '0x0000000000000000000000000000000000000000' : toMeta.address;
            const rawAmount = ethers.utils.parseUnits(amountIn.toFixed(fromMeta.decimals), fromMeta.decimals).toString();
            const userAddr = window.RdeskWallet.getAddress() || '0x000000000000000000000000000000000000dEaD';

            const url = `https://li.quest/v1/quote?fromChain=${fromChain}&toChain=${toChain}&fromToken=${fromTokenAddr}&toToken=${toTokenAddr}&fromAmount=${rawAmount}&fromAddress=${userAddr}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Rota cross-chain indisponível');
            const data = await res.json();

            const estOut = parseFloat(ethers.utils.formatUnits(data.estimate.toAmount, toMeta.decimals));
            if (outInput) outInput.value = estOut.toFixed(4);
            if (infoEl) infoEl.textContent = `Ponte via ${data.toolDetails?.name || 'LI.FI'}`;

            defiState.swapQuote = {
                type: 'LIFI',
                fromChain,
                toChain,
                fromSym,
                toSym,
                fromMeta,
                toMeta,
                amountIn,
                amountOut: estOut,
                lifiData: data,
                routeLabel: `Roteador ${data.toolDetails?.name || 'LI.FI'}`
            };
        } catch (err) {
            if (outInput) outInput.value = '--';
            if (infoEl) infoEl.textContent = 'Rota indisponível para este par/rede';
            defiState.swapQuote = null;
        }
    }

    async function executeActiveSwap() {
        const fb = document.getElementById('swap-feedback');
        fb.style.color = 'var(--accent)';
        fb.textContent = '';

        const q = defiState.swapQuote;
        if (!q || q.amountIn <= 0) {
            fb.style.color = 'var(--red)';
            fb.textContent = 'Informe uma quantidade válida para trocar.';
            return;
        }

        const prices = window.RdeskWallet.getPrices();
        const fromMeta = getTokenMeta(q.fromChain, q.fromSym);
        const unitUsd = fromMeta?.priceKey === 'USD' ? 1 : fromMeta?.priceKey === 'BRL' ? (1 / prices.USD_BRL) : (prices[fromMeta?.priceKey] || 0);
        const brlVal = q.amountIn * unitUsd * prices.USD_BRL;

        const confirmed = await window.RdeskReceipt.confirm({
            title: q.fromChain === q.toChain ? 'Confirmar Troca DEX' : 'Confirmar Ponte Cross-Chain',
            sendVal: `${q.amountIn.toFixed(4)} ${q.fromSym}`,
            sendBrl: window.RdeskWallet.formatBRL(brlVal),
            recvVal: `~${q.amountOut.toFixed(4)} ${q.toSym}`,
            recvBrl: window.RdeskWallet.formatBRL(brlVal * 0.998),
            route: q.routeLabel,
            fee: 'R$ 0,00 (Sem taxa do app)',
            gas: q.fromChain === 137 ? '~R$ 0,03 (Polygon)' : 'Gás da rede de origem',
            shield: 'Proteção anti-slippage 1.5%'
        });

        if (!confirmed) return;

        try {
            const signer = await window.RdeskWallet.getSigner(q.fromChain);
            const owner = await signer.getAddress();

            if (q.type === 'WRAP_UNWRAP') {
                const wpol = new ethers.Contract(
                    ADDR_WPOL,
                    ['function deposit() payable', 'function withdraw(uint256 wad)'],
                    signer
                );
                const wei = ethers.utils.parseEther(q.amountIn.toFixed(6));
                fb.textContent = 'Assinando conversão 1:1...';
                const tx = q.fromSym === 'POL' ? await wpol.deposit({ value: wei }) : await wpol.withdraw(wei);
                await tx.wait();
            } else if (q.type === 'UNISWAP_V3') {
                const rawIn = ethers.utils.parseUnits(q.amountIn.toFixed(q.fromMeta.decimals), q.fromMeta.decimals);
                const wpolBefore = q.toSym === 'POL'
                    ? await new ethers.Contract(ADDR_WPOL, ['function balanceOf(address) view returns (uint256)'], signer).balanceOf(owner)
                    : ethers.constants.Zero;
                const minOut = ethers.utils.parseUnits((q.amountOut * 0.985).toFixed(q.toMeta.decimals), q.toMeta.decimals);

                if (q.fromSym === 'POL') {
                    fb.textContent = 'Etapa 1/2: Convertendo POL para WPOL...';
                    const wpol = new ethers.Contract(ADDR_WPOL, ['function deposit() payable'], signer);
                    const txWrap = await wpol.deposit({ value: rawIn });
                    await txWrap.wait();
                }

                fb.textContent = 'Aprovando e executando troca na Uniswap V3...';
                await ensureExactErc20Approval(q.addrIn, SWAP_ROUTER_02, rawIn, signer);

                const router = new ethers.Contract(
                    SWAP_ROUTER_02,
                    ['function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)'],
                    signer
                );
                const txSwap = await router.exactInputSingle({
                    tokenIn: q.addrIn,
                    tokenOut: q.addrOut,
                    fee: POOL_FEE,
                    recipient: owner,
                    amountIn: rawIn,
                    amountOutMinimum: minOut,
                    sqrtPriceLimitX96: 0
                });
                await txSwap.wait();

                if (q.toSym === 'POL') {
                    // O router entrega WPOL: converte o que chegou em POL nativo.
                    fb.textContent = 'Convertendo WPOL recebido em POL...';
                    const wpolOut = new ethers.Contract(ADDR_WPOL, ['function balanceOf(address) view returns (uint256)', 'function withdraw(uint256 wad)'], signer);
                    const got = (await wpolOut.balanceOf(owner)).sub(wpolBefore);
                    if (got.gt(0)) {
                        const txUnwrap = await wpolOut.withdraw(got);
                        await txUnwrap.wait();
                    }
                }
            } else if (q.type === 'LIFI' && q.lifiData?.transactionRequest) {
                const txReq = q.lifiData.transactionRequest;
                if (!q.fromMeta.isNative && q.lifiData.estimate?.approvalAddress) {
                    const rawIn = ethers.utils.parseUnits(q.amountIn.toFixed(q.fromMeta.decimals), q.fromMeta.decimals);
                    fb.textContent = 'Aprovando token para ponte...';
                    await ensureExactErc20Approval(q.fromMeta.address, q.lifiData.estimate.approvalAddress, rawIn, signer);
                }
                fb.textContent = 'Enviando transação cross-chain...';
                const tx = await signer.sendTransaction({
                    to: txReq.to,
                    data: txReq.data,
                    value: txReq.value ? ethers.BigNumber.from(txReq.value) : 0
                });
                await tx.wait();
            }

            fb.style.color = 'var(--green-bright)';
            fb.textContent = `✓ Troca de ${q.amountIn} ${q.fromSym} por ${q.toSym} concluída!`;
            await window.RdeskWallet.refreshBalances();
        } catch (err) {
            fb.style.color = 'var(--red)';
            fb.textContent = err?.reason || err?.message || 'Troca cancelada.';
        }
    }

    // =========================================================================
    // COMPARADOR PIX LÍQUIDO (COMPRAR & SACAR COM FILTRO SEM KYC)
    // =========================================================================
    const PIX_RAILS = [
        {
            name: 'NakPix (c/ Cupom)',
            kycTier: 'SEM KYC',
            kycClass: 'free',
            noKyc: true,
            spreadPct: 0.008,
            fixedBrl: 0.0,
            eta: 'PIX Instantâneo (~1 min)',
            url: 'https://nakpix.com'
        },
        {
            name: 'DePix / Liquid Network',
            kycTier: 'SEM KYC',
            kycClass: 'free',
            noKyc: true,
            spreadPct: 0.012,
            fixedBrl: 1.0,
            eta: 'PIX em ~2 min',
            url: 'https://depix.info'
        },
        {
            name: 'PagFinance PIX',
            kycTier: 'KYC LEVE',
            kycClass: 'lite',
            noKyc: false,
            spreadPct: 0.014,
            fixedBrl: 0.0,
            eta: 'PIX Instantâneo',
            url: 'https://pagfinance.com'
        },
        {
            name: 'Bipa',
            kycTier: 'KYC COMPLETO',
            kycClass: 'full',
            noKyc: false,
            spreadPct: 0.011,
            fixedBrl: 0.0,
            eta: 'PIX Direto',
            url: 'https://bipa.app'
        },
        {
            name: 'Binance Spot',
            kycTier: 'KYC COMPLETO',
            kycClass: 'full',
            noKyc: false,
            spreadPct: 0.005,
            fixedBrl: 3.5,
            eta: 'PIX Bancário',
            url: 'https://www.binance.com/pt-BR'
        }
    ];

    function recalculatePixComparator() {
        const prices = window.RdeskWallet.getPrices();
        const usdBrl = prices.USD_BRL || 5.65;

        // 1. Comprar com PIX (R$ -> Cripto)
        const buyBrl = parseFloat(document.getElementById('pix-buy-brl')?.value) || 0;
        const buySym = document.getElementById('pix-buy-token')?.value || 'USDT';
        const buyContainer = document.getElementById('pix-buy-routes');

        if (buyContainer) {
            buyContainer.replaceChildren();
            let unitBrl = usdBrl;
            if (buySym === 'POL') unitBrl = (prices.POL || 0.088) * usdBrl;
            else if (buySym === 'BRZ' || buySym === 'BRLA') unitBrl = 1.0;

            const rankedBuy = PIX_RAILS.map(r => {
                const netBrlAfterFees = Math.max(0, (buyBrl - r.fixedBrl) * (1 - r.spreadPct));
                const netTokens = unitBrl > 0 ? netBrlAfterFees / unitBrl : 0;
                return { ...r, netTokens, netBrlAfterFees };
            }).sort((a, b) => b.netTokens - a.netTokens);

            rankedBuy.forEach((item, idx) => {
                const a = document.createElement('a');
                a.href = item.url;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.className = 'route-item' + (idx === 0 ? ' best' : '');

                const left = document.createElement('div');
                left.innerHTML = `<strong>${idx === 0 ? '🏆 ' : ''}${item.name}</strong> <span class="kyc-badge ${item.kycClass}">${item.kycTier}</span><br><span class="muted-sm">${item.eta} • Taxa/Spread ${(item.spreadPct * 100).toFixed(1)}%</span>`;

                const right = document.createElement('div');
                right.style.textAlign = 'right';
                right.innerHTML = `<strong style="color:var(--green-bright); font-family:var(--font-mono);">${item.netTokens.toFixed(4)} ${buySym}</strong><br><span class="muted-sm">Líquido na carteira</span>`;

                a.append(left, right);
                buyContainer.appendChild(a);
            });
        }

        // 2. Sacar para Banco via PIX (Cripto -> R$)
        const sellSym = document.getElementById('pix-sell-token')?.value || 'USDT';
        const sellAmt = parseFloat(document.getElementById('pix-sell-amount')?.value) || 0;
        const sellContainer = document.getElementById('pix-sell-routes');

        if (sellContainer) {
            sellContainer.replaceChildren();
            let unitBrl = usdBrl;
            if (sellSym === 'POL' || sellSym === 'WPOL') unitBrl = (prices.POL || 0.088) * usdBrl;
            else if (sellSym === 'BRZ' || sellSym === 'BRLA') unitBrl = 1.0;

            const grossBrl = sellAmt * unitBrl;
            const visibleRails = PIX_RAILS.filter(r => !defiState.pixOnlyNoKyc || r.noKyc);

            const rankedSell = visibleRails.map(r => {
                const netBrl = Math.max(0, (grossBrl * (1 - r.spreadPct)) - r.fixedBrl);
                return { ...r, netBrl };
            }).sort((a, b) => b.netBrl - a.netBrl);

            rankedSell.forEach((item, idx) => {
                const a = document.createElement('a');
                a.href = item.url;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.className = 'route-item' + (idx === 0 ? ' best' : '');

                const left = document.createElement('div');
                left.innerHTML = `<strong>${idx === 0 ? '🏆 ' : ''}${item.name}</strong> <span class="kyc-badge ${item.kycClass}">${item.kycTier}</span><br><span class="muted-sm">${item.eta} • Spread ${(item.spreadPct * 100).toFixed(1)}%</span>`;

                const right = document.createElement('div');
                right.style.textAlign = 'right';
                right.innerHTML = `<strong style="color:var(--green-bright); font-family:var(--font-mono);">${window.RdeskWallet.formatBRL(item.netBrl)}</strong><br><span class="muted-sm">Cai líquido no PIX</span>`;

                a.append(left, right);
                sellContainer.appendChild(a);
            });
        }
    }

    // =========================================================================
    // AUDITORIA CONTÁBIL REAL DESDE A 1ª TRANSAÇÃO (EOA vs. SMART CONTRACT)
    // =========================================================================
    function setAuditProgress(visible, text, pct) {
        const wrap = document.getElementById('audit-progress-wrap');
        const bar = document.getElementById('audit-progress-bar');
        const status = document.getElementById('audit-status-text');
        if (wrap) wrap.style.display = visible ? 'block' : 'none';
        if (bar && typeof pct === 'number') bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
        if (status && text) status.textContent = text;
    }

    async function loadHistoricalPtaxAndLlamaSeries() {
        // 1. PTAX BCB dos últimos 730 dias + AwesomeAPI para cotação atual
        try {
            const end = new Date();
            const start = new Date(end.getTime() - 730 * 86400000);
            const fmtBcb = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
            const bcbUrl = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@di,dataFinalCotacao=@df)?@di='${fmtBcb(start)}'&@df='${fmtBcb(end)}'&$format=json&$select=cotacaoVenda,dataHoraCotacao`;

            const [bcbRes, llamaRes] = await Promise.all([
                fetch(bcbUrl).catch(() => null),
                fetch(`https://coins.llama.fi/chart/polygon:${ADDR_WPOL},polygon:${ADDR_WBTC},polygon:0x7ceb23fd6bc0add59e62ac25578270cff1b9f619?span=500&period=1d`).catch(() => null)
            ]);

            if (bcbRes && bcbRes.ok) {
                const bcbJson = await bcbRes.json();
                (bcbJson?.value || []).forEach(row => {
                    const dayKey = String(row.dataHoraCotacao || '').slice(0, 10);
                    if (dayKey && row.cotacaoVenda) {
                        defiState.audit.ptaxMap[dayKey] = parseFloat(row.cotacaoVenda);
                    }
                });
            }

            if (llamaRes && llamaRes.ok) {
                const lJson = await llamaRes.json();
                const coins = lJson?.coins || {};
                Object.entries(coins).forEach(([key, obj]) => {
                    const addr = key.split(':')[1]?.toLowerCase();
                    if (!addr || !Array.isArray(obj.prices)) return;
                    defiState.audit.llamaDaily[addr] = {};
                    obj.prices.forEach(pt => {
                        const dKey = new Date(pt.timestamp * 1000).toISOString().slice(0, 10);
                        defiState.audit.llamaDaily[addr][dKey] = pt.price;
                    });
                });
            }
        } catch (e) {}
    }

    function getHistoricalUsdBrl(dateKey) {
        const map = defiState.audit.ptaxMap;
        if (map[dateKey]) return map[dateKey];
        const base = new Date(`${dateKey}T12:00:00Z`).getTime();
        for (let i = 1; i <= 7; i++) {
            const prev = new Date(base - i * 86400000).toISOString().slice(0, 10);
            if (map[prev]) return map[prev];
        }
        return window.RdeskWallet.getPrices().USD_BRL || 5.65;
    }

    function getHistoricalAssetUsd(kind, dateKey, fxRate) {
        const prices = window.RdeskWallet.getPrices();
        if (kind === 'USD') return 1.0;
        if (kind === 'BRL') return 1.0 / fxRate;

        const addrMap = {
            POL: ADDR_WPOL.toLowerCase(),
            BTC: ADDR_WBTC.toLowerCase(),
            ETH: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619'
        };
        const addr = addrMap[kind];
        const series = addr ? defiState.audit.llamaDaily[addr] : null;
        if (series) {
            if (series[dateKey]) return series[dateKey];
            const base = new Date(`${dateKey}T12:00:00Z`).getTime();
            for (let i = 1; i <= 5; i++) {
                const prev = new Date(base - i * 86400000).toISOString().slice(0, 10);
                if (series[prev]) return series[prev];
            }
        }
        return prices[kind] || prices.POL || 0.088;
    }

    async function isAddressSmartContract(addrLower, apiHint, provider) {
        if (!addrLower) return false;
        if (typeof apiHint === 'boolean') {
            defiState.audit.contractCache.set(addrLower, apiHint);
            return apiHint;
        }
        if (defiState.audit.contractCache.has(addrLower)) {
            return defiState.audit.contractCache.get(addrLower);
        }
        try {
            const code = await provider.getCode(addrLower);
            const isC = Boolean(code && code !== '0x');
            defiState.audit.contractCache.set(addrLower, isC);
            return isC;
        } catch (e) {
            return false;
        }
    }

    async function fetchBlockscoutPages(urlBase, label, startPct, spanPct) {
        const all = [];
        let nextParams = null;
        let page = 1;

        while (page <= 25) {
            const url = new URL(urlBase);
            if (nextParams) {
                Object.entries(nextParams).forEach(([k, v]) => url.searchParams.set(k, v));
            }
            const res = await fetch(url.toString());
            if (!res.ok) break;
            const json = await res.json();
            if (Array.isArray(json.items)) all.push(...json.items);

            setAuditProgress(true, `${label}: ${all.length} registros lidos...`, startPct + Math.min(spanPct, page * 2));
            if (!json.next_page_params) break;
            nextParams = json.next_page_params;
            page++;
        }
        return all;
    }

    // Falha de rede na auditoria vira um aviso na tela, nunca um erro solto.
    async function runAuditSafely(forceRefresh = false) {
        try {
            await runFullHistoryAudit(forceRefresh);
        } catch (err) {
            setAuditProgress(true, 'Não foi possível ler o histórico agora (servidor de histórico indisponível). Toque em Atualizar para tentar de novo.', 0);
        }
    }

    async function runFullHistoryAudit(forceRefresh = false) {
        const wallet = window.RdeskWallet.getAddress();
        if (!wallet) return;
        if (!forceRefresh && defiState.audit.lastWalletAudited === wallet && defiState.audit.events.length > 0) {
            renderAuditView();
            return;
        }

        try {
            const savedOv = localStorage.getItem(`rdesk_v22_audit_ov_${wallet}`);
            defiState.audit.overrides = savedOv ? JSON.parse(savedOv) : {};
        } catch (e) {
            defiState.audit.overrides = {};
        }

        setAuditProgress(true, 'Carregando cotações históricas (BCB PTAX & DefiLlama)...', 10);
        await loadHistoricalPtaxAndLlamaSeries();

        const provider = await window.RdeskWallet.getReadProvider(POLYGON_ID);

        const [txs, transfers, internals] = await Promise.all([
            fetchBlockscoutPages(`${BLOCKSCOUT_V2}/addresses/${wallet}/transactions`, 'Transações', 18, 22),
            fetchBlockscoutPages(`${BLOCKSCOUT_V2}/addresses/${wallet}/token-transfers`, 'Tokens', 40, 22),
            fetchBlockscoutPages(`${BLOCKSCOUT_V2}/addresses/${wallet}/internal-transactions`, 'Transações internas', 62, 18)
        ]);

        setAuditProgress(true, 'Separando movimentações DeFi de aportes e saques reais...', 84);

        const txMap = new Map();
        const ensureTx = (hash, isoTime) => {
            const h = hash.toLowerCase();
            if (!txMap.has(h)) {
                const unix = Math.floor(new Date(isoTime).getTime() / 1000);
                txMap.set(h, {
                    hash: h,
                    unix,
                    dateKey: new Date(unix * 1000).toISOString().slice(0, 10),
                    inflows: [],
                    outflows: [],
                    gasPol: 0,
                    touchedContract: false
                });
            }
            return txMap.get(h);
        };

        // 1. Transações principais & gás (inclusive transações revertidas!)
        for (const tx of txs) {
            const entry = ensureTx(tx.hash, tx.timestamp);
            const fromAddr = tx.from?.hash?.toLowerCase() || '';
            const toAddr = tx.to?.hash?.toLowerCase() || '';

            if (fromAddr === wallet && tx.fee?.value) {
                entry.gasPol += parseFloat(ethers.utils.formatEther(tx.fee.value));
            }
            if (tx.status !== 'ok') continue;

            if (toAddr && toAddr !== wallet) {
                if (await isAddressSmartContract(toAddr, tx.to?.is_contract, provider)) {
                    entry.touchedContract = true;
                }
            }

            const polVal = tx.value ? parseFloat(ethers.utils.formatEther(tx.value)) : 0;
            if (polVal > 0) {
                if (toAddr === wallet && fromAddr !== wallet) {
                    const fromIsC = await isAddressSmartContract(fromAddr, tx.from?.is_contract, provider);
                    if (fromIsC) entry.touchedContract = true;
                    entry.inflows.push({ symbol: 'POL', kind: 'POL', amount: polVal, fromIsC });
                } else if (fromAddr === wallet && toAddr !== wallet) {
                    const toIsC = await isAddressSmartContract(toAddr, tx.to?.is_contract, provider);
                    if (toIsC) entry.touchedContract = true;
                    entry.outflows.push({ symbol: 'POL', kind: 'POL', amount: polVal, toIsC });
                }
            }
        }

        // 2. Transações internas (ex: unwrap WPOL -> POL)
        for (const itx of internals) {
            if (!itx.transaction_hash) continue;
            const entry = ensureTx(itx.transaction_hash, itx.timestamp);
            const fromAddr = itx.from?.hash?.toLowerCase() || '';
            const toAddr = itx.to?.hash?.toLowerCase() || '';
            const polVal = itx.value ? parseFloat(ethers.utils.formatEther(itx.value)) : 0;
            if (polVal <= 0) continue;

            if (toAddr === wallet && fromAddr !== wallet) {
                const fromIsC = await isAddressSmartContract(fromAddr, itx.from?.is_contract, provider);
                if (fromIsC) entry.touchedContract = true;
                entry.inflows.push({ symbol: 'POL', kind: 'POL', amount: polVal, fromIsC });
            }
        }

        // 3. Transferências ERC-20 verificadas (ignorando spam airdrops)
        for (const tr of transfers) {
            if (!tr.transaction_hash || tr.token?.type !== 'ERC-20') continue;
            if (tr.token?.is_spam === true) continue;

            const tokenAddr = (tr.token?.address_hash || tr.token?.address || '').toLowerCase();
            const meta = VERIFIED_AUDIT_TOKENS[tokenAddr];
            if (!meta) continue; // Ignora tokens não verificados para evitar inflação falsa

            const entry = ensureTx(tr.transaction_hash, tr.timestamp);
            const fromAddr = tr.from?.hash?.toLowerCase() || '';
            const toAddr = tr.to?.hash?.toLowerCase() || '';
            const amount = parseFloat(ethers.utils.formatUnits(tr.total?.value || '0', meta.decimals));
            if (amount <= 0) continue;

            if (toAddr === wallet && fromAddr !== wallet) {
                const fromIsC = await isAddressSmartContract(fromAddr, tr.from?.is_contract, provider);
                if (fromIsC) entry.touchedContract = true;
                entry.inflows.push({ symbol: meta.symbol, kind: meta.kind, amount, fromIsC });
            } else if (fromAddr === wallet && toAddr !== wallet) {
                const toIsC = await isAddressSmartContract(toAddr, tr.to?.is_contract, provider);
                if (toIsC) entry.touchedContract = true;
                entry.outflows.push({ symbol: meta.symbol, kind: meta.kind, amount, toIsC });
            }
        }

        // Ordena da 1ª transação até hoje
        const sorted = Array.from(txMap.values()).sort((a, b) => a.unix - b.unix);
        const events = sorted.map(tx => {
            const fxRate = getHistoricalUsdBrl(tx.dateKey);
            const polHistUsd = getHistoricalAssetUsd('POL', tx.dateKey, fxRate);
            const gasUsd = tx.gasPol * polHistUsd;
            const gasBrl = gasUsd * fxRate;

            let inUsd = 0, inBrl = 0;
            const desc = [];

            tx.inflows.forEach(item => {
                const pUsd = getHistoricalAssetUsd(item.kind, tx.dateKey, fxRate);
                const u = item.amount * pUsd;
                inUsd += u;
                inBrl += u * fxRate;
                desc.push(`+${item.amount.toFixed(2)} ${item.symbol}`);
            });

            let outUsd = 0, outBrl = 0;
            tx.outflows.forEach(item => {
                const pUsd = getHistoricalAssetUsd(item.kind, tx.dateKey, fxRate);
                const u = item.amount * pUsd;
                outUsd += u;
                outBrl += u * fxRate;
                desc.push(`-${item.amount.toFixed(2)} ${item.symbol}`);
            });

            // Classificação contábil: somente transferência direta com EOA (não-contrato) é Aporte ou Saque
            let autoClass = 'DEFI';
            if (!tx.touchedContract && inUsd > 0.05 && outUsd === 0) {
                autoClass = 'IN';
            } else if (!tx.touchedContract && outUsd > 0.05 && inUsd === 0) {
                autoClass = 'OUT';
            }

            return {
                hash: tx.hash,
                dateKey: tx.dateKey,
                autoClass,
                inUsd,
                inBrl,
                outUsd,
                outBrl,
                gasUsd,
                gasBrl,
                summary: desc.length > 0 ? desc.join(' | ') : 'Contrato / Aprovação / Gás'
            };
        });

        defiState.audit.events = events;
        defiState.audit.lastWalletAudited = wallet;
        setAuditProgress(false, `Auditoria concluída: ${events.length} transações desde a 1ª operação.`, 100);
        renderAuditView();
    }

    function renderAuditView() {
        const prices = window.RdeskWallet.getPrices();
        const isBrl = defiState.audit.currency === 'BRL';
        const fmt = (brl, usd) => isBrl ? window.RdeskWallet.formatBRL(brl) : window.RdeskWallet.formatUSD(usd);

        let totalInBrl = 0, totalInUsd = 0;
        let totalOutBrl = 0, totalOutUsd = 0;
        let totalGasBrl = 0, totalGasUsd = 0;

        const dailyMap = new Map();

        defiState.audit.events.forEach(ev => {
            const eff = defiState.audit.overrides[ev.hash] || ev.autoClass;
            ev.effectiveClass = eff;

            totalGasBrl += ev.gasBrl;
            totalGasUsd += ev.gasUsd;

            if (!dailyMap.has(ev.dateKey)) {
                dailyMap.set(ev.dateKey, { date: ev.dateKey, inBrl: 0, outBrl: 0, inUsd: 0, outUsd: 0 });
            }
            const day = dailyMap.get(ev.dateKey);

            if (eff === 'IN') {
                const vBrl = ev.inBrl || ev.outBrl;
                const vUsd = ev.inUsd || ev.outUsd;
                totalInBrl += vBrl;
                totalInUsd += vUsd;
                day.inBrl += vBrl;
                day.inUsd += vUsd;
            } else if (eff === 'OUT') {
                const vBrl = ev.outBrl || ev.inBrl;
                const vUsd = ev.outUsd || ev.inUsd;
                totalOutBrl += vBrl;
                totalOutUsd += vUsd;
                day.outBrl += vBrl;
                day.outUsd += vUsd;
            }
        });

        // Patrimônio atual ao vivo (Saldos Livres + Pools Uniswap V3)
        const freeUsd = window.RdeskWallet.getBalances().reduce((acc, b) => acc + b.usdValue, 0);
        const lpUsd = defiState.livePositions.reduce((acc, p) => acc + p.totalUsd, 0);
        const equityUsd = freeUsd + lpUsd;
        const equityBrl = equityUsd * (prices.USD_BRL || 5.65);

        const pnlBrl = (equityBrl + totalOutBrl) - totalInBrl;
        const pnlUsd = (equityUsd + totalOutUsd) - totalInUsd;
        const activePnl = isBrl ? pnlBrl : pnlUsd;
        const baseCap = isBrl ? totalInBrl : totalInUsd;
        const roiPct = baseCap > 0 ? (activePnl / baseCap) * 100 : 0;

        document.getElementById('audit-kpi-in').textContent = fmt(totalInBrl, totalInUsd);
        document.getElementById('audit-kpi-out').textContent = fmt(totalOutBrl, totalOutUsd);
        document.getElementById('audit-kpi-equity').textContent = fmt(equityBrl, equityUsd);

        const pnlEl = document.getElementById('audit-kpi-pnl');
        pnlEl.textContent = `${activePnl >= 0 ? '+' : ''}${fmt(pnlBrl, pnlUsd)} (${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(1)}%)`;
        pnlEl.style.color = activePnl >= 0 ? 'var(--green-bright)' : 'var(--red)';

        const trendPill = document.getElementById('audit-trend-pill');
        if (trendPill) {
            trendPill.className = 'pill-badge ' + (activePnl >= 0 ? 'safe' : 'danger');
            trendPill.textContent = activePnl >= 0 ? 'NO LUCRO' : 'NO PREJUÍZO';
        }

        // Tabela de eventos
        const tbody = document.getElementById('audit-events-tbody');
        if (tbody) {
            tbody.replaceChildren();
            const filtered = defiState.audit.events.filter(ev => {
                if (defiState.audit.filter === 'EXTERNAL') return ev.effectiveClass === 'IN' || ev.effectiveClass === 'OUT';
                if (defiState.audit.filter === 'DEFI') return ev.effectiveClass === 'DEFI';
                return true;
            }).slice().reverse();

            if (filtered.length === 0) {
                const tr = document.createElement('tr');
                tr.innerHTML = '<td colspan="5" class="empty-cell">Nenhuma transação encontrada para este filtro.</td>';
                tbody.appendChild(tr);
            } else {
                filtered.forEach(ev => {
                    const tr = document.createElement('tr');

                    const tdDate = document.createElement('td');
                    tdDate.textContent = ev.dateKey;

                    const tdClass = document.createElement('td');
                    const badge = document.createElement('span');
                    if (ev.effectiveClass === 'IN') { badge.className = 'badge-in'; badge.textContent = 'APORTE'; }
                    else if (ev.effectiveClass === 'OUT') { badge.className = 'badge-out'; badge.textContent = 'SAQUE'; }
                    else if (ev.effectiveClass === 'IGNORE') { badge.className = 'badge-ignore'; badge.textContent = 'IGNORADO'; }
                    else { badge.className = 'badge-defi'; badge.textContent = 'POOL / DEFI'; }
                    tdClass.appendChild(badge);

                    const tdDesc = document.createElement('td');
                    tdDesc.textContent = ev.summary;

                    const tdVal = document.createElement('td');
                    const vBrl = ev.effectiveClass === 'OUT' ? ev.outBrl : (ev.inBrl || ev.outBrl);
                    const vUsd = ev.effectiveClass === 'OUT' ? ev.outUsd : (ev.inUsd || ev.outUsd);
                    tdVal.textContent = vUsd > 0 ? fmt(vBrl, vUsd) : `Gás ${fmt(ev.gasBrl, ev.gasUsd)}`;

                    const tdBtn = document.createElement('td');
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'mini-link-btn';
                    btn.textContent = 'Alterar';
                    btn.addEventListener('click', () => {
                        const cycle = ['IN', 'OUT', 'DEFI', 'IGNORE'];
                        const next = cycle[(cycle.indexOf(ev.effectiveClass) + 1) % cycle.length];
                        const w = window.RdeskWallet.getAddress();
                        defiState.audit.overrides[ev.hash] = next;
                        localStorage.setItem(`rdesk_v22_audit_ov_${w}`, JSON.stringify(defiState.audit.overrides));
                        renderAuditView();
                    });
                    tdBtn.appendChild(btn);

                    tr.append(tdDate, tdClass, tdDesc, tdVal, tdBtn);
                    tbody.appendChild(tr);
                });
            }
        }

        renderAuditCashflowChart(Array.from(dailyMap.values()), equityBrl, equityUsd);
    }

    function renderAuditCashflowChart(dailySeries, equityBrl, equityUsd) {
        const canvas = document.getElementById('audit-chart-canvas');
        if (!canvas || !window.Chart) return;

        const isBrl = defiState.audit.currency === 'BRL';
        const today = new Date().toISOString().slice(0, 10);
        if (dailySeries.length === 0 || dailySeries[dailySeries.length - 1].date !== today) {
            dailySeries.push({ date: today, inBrl: 0, outBrl: 0, inUsd: 0, outUsd: 0 });
        }

        const labels = [];
        const inBars = [];
        const outBars = [];
        const netInvestedLine = [];
        const equityLine = [];

        let runningNet = 0;
        dailySeries.forEach((d, i) => {
            const vIn = isBrl ? d.inBrl : d.inUsd;
            const vOut = isBrl ? d.outBrl : d.outUsd;
            runningNet += (vIn - vOut);

            labels.push(d.date);
            inBars.push(Number(vIn.toFixed(2)));
            outBars.push(Number((-vOut).toFixed(2)));
            netInvestedLine.push(Number(runningNet.toFixed(2)));
            equityLine.push(i === dailySeries.length - 1 ? Number((isBrl ? equityBrl : equityUsd).toFixed(2)) : null);
        });

        if (equityLine.length > 0) equityLine[0] = inBars[0] || 0;

        if (auditChart) auditChart.destroy();
        auditChart = new window.Chart(canvas.getContext('2d'), {
            data: {
                labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Aportes Reais',
                        data: inBars,
                        backgroundColor: 'rgba(16, 185, 129, 0.75)',
                        borderRadius: 4
                    },
                    {
                        type: 'bar',
                        label: 'Saques Reais',
                        data: outBars,
                        backgroundColor: 'rgba(244, 63, 94, 0.75)',
                        borderRadius: 4
                    },
                    {
                        type: 'line',
                        label: 'Capital Líquido Investido',
                        data: netInvestedLine,
                        borderColor: '#eab308',
                        borderWidth: 2,
                        tension: 0.2,
                        pointRadius: 2
                    },
                    {
                        type: 'line',
                        label: 'Patrimônio Atual (Carteira + Pools)',
                        data: equityLine,
                        borderColor: '#38bdf8',
                        borderDash: [5, 4],
                        borderWidth: 2.5,
                        spanGaps: true,
                        pointRadius: 5,
                        pointBackgroundColor: '#38bdf8'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#9aa3b2', font: { size: 11 } } }
                },
                scales: {
                    x: { ticks: { color: '#646e80', maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.04)' } },
                    y: { ticks: { color: '#9aa3b2' }, grid: { color: 'rgba(255,255,255,0.05)' } }
                }
            }
        });
    }

    function exportAuditCsv() {
        if (defiState.audit.events.length === 0) return;
        const lines = ['Data;Classificacao;Movimento;Valor_BRL;Valor_USD;Gas_BRL;TxHash'];
        defiState.audit.events.forEach(ev => {
            const vBrl = ev.effectiveClass === 'OUT' ? ev.outBrl : (ev.inBrl || ev.outBrl);
            const vUsd = ev.effectiveClass === 'OUT' ? ev.outUsd : (ev.inUsd || ev.outUsd);
            lines.push(`${ev.dateKey};${ev.effectiveClass};"${ev.summary}";${vBrl.toFixed(2)};${vUsd.toFixed(2)};${ev.gasBrl.toFixed(4)};${ev.hash}`);
        });
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rdesk-auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // =========================================================================
    // VINCULAÇÃO DE EVENTOS & API GLOBAL
    // =========================================================================
    function bindDefiAndPixEvents() {
        // Tela 2: Render V3
        document.getElementById('earn-target-brl-min')?.addEventListener('input', recalculateSniperRange);
        document.getElementById('btn-earn-reset-sniper')?.addEventListener('click', () => {
            const inp = document.getElementById('earn-target-brl-min');
            if (inp) inp.value = '';
            recalculateSniperRange();
        });
        document.getElementById('btn-start-autopilot')?.addEventListener('click', () => startAutopilotPosition(false));

        document.querySelectorAll('.tf-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tf-chip').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                defiState.timeframe = btn.getAttribute('data-tf');
                loadPoolCandlesAndComputeSniper();
            });
        });

        document.getElementById('btn-add-sim')?.addEventListener('click', () => {
            const minP = parseFloat(document.getElementById('sim-min').value);
            const maxP = parseFloat(document.getElementById('sim-max').value);
            const lbl = document.getElementById('sim-label').value.trim() || `Simulação #${defiState.simPositions.length + 1}`;
            if (!Number.isFinite(minP) || !Number.isFinite(maxP) || minP <= 0 || minP >= maxP) {
                alert('Informe um preço mínimo menor que o preço máximo.');
                return;
            }
            defiState.simPositions.push({
                id: 'sim-' + Date.now(),
                label: lbl,
                minPrice: minP,
                maxPrice: maxP,
                isSimulated: true
            });
            localStorage.setItem(SIM_POSITIONS_KEY, JSON.stringify(defiState.simPositions));
            renderPositionsCards();
            redrawChartRangeLines();
        });

        // Tela 3: PIX & Trocas
        document.getElementById('pix-buy-brl')?.addEventListener('input', recalculatePixComparator);
        document.getElementById('pix-buy-token')?.addEventListener('change', recalculatePixComparator);
        document.getElementById('pix-sell-token')?.addEventListener('change', recalculatePixComparator);
        document.getElementById('pix-sell-amount')?.addEventListener('input', recalculatePixComparator);

        document.getElementById('btn-toggle-nokyc')?.addEventListener('click', (e) => {
            defiState.pixOnlyNoKyc = !defiState.pixOnlyNoKyc;
            e.target.textContent = defiState.pixOnlyNoKyc ? 'Filtro: 100% Sem KYC' : 'Filtro: Todas';
            recalculatePixComparator();
        });

        const triggerSwapQuote = () => {
            clearTimeout(swapQuoteTimer);
            swapQuoteTimer = setTimeout(refreshSwapQuote, 350);
        };

        ['swap-from-chain', 'swap-from-token', 'swap-to-chain', 'swap-to-token', 'swap-amount-in'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', triggerSwapQuote);
            document.getElementById(id)?.addEventListener('change', triggerSwapQuote);
        });

        document.getElementById('btn-swap-max')?.addEventListener('click', () => {
            const fromChain = Number(document.getElementById('swap-from-chain').value);
            const fromSym = document.getElementById('swap-from-token').value;
            const found = window.RdeskWallet.getBalances().find(b => b.chainId === fromChain && b.symbol === fromSym);
            let avail = found ? found.amount : 0;
            if (fromSym === 'POL') avail = Math.max(0, avail - window.RdeskWallet.GAS_RESERVE_POL);
            else if (fromSym === 'ETH') avail = Math.max(0, avail - 0.0015);
            document.getElementById('swap-amount-in').value = avail.toFixed(4);
            refreshSwapQuote();
        });

        document.getElementById('btn-swap-flip')?.addEventListener('click', () => {
            const fc = document.getElementById('swap-from-chain');
            const tc = document.getElementById('swap-to-chain');
            const ft = document.getElementById('swap-from-token');
            const tt = document.getElementById('swap-to-token');
            [fc.value, tc.value] = [tc.value, fc.value];
            [ft.value, tt.value] = [tt.value, ft.value];
            refreshSwapQuote();
        });

        document.getElementById('btn-execute-swap')?.addEventListener('click', executeActiveSwap);

        // Tela 4: Auditoria Real
        document.getElementById('btn-audit-currency')?.addEventListener('click', (e) => {
            defiState.audit.currency = defiState.audit.currency === 'BRL' ? 'USD' : 'BRL';
            e.target.textContent = defiState.audit.currency === 'BRL' ? 'BRL / USD' : 'USD / BRL';
            renderAuditView();
        });

        document.getElementById('btn-audit-refresh')?.addEventListener('click', () => runAuditSafely(true));
        document.getElementById('btn-export-audit-csv')?.addEventListener('click', exportAuditCsv);

        document.querySelectorAll('.audit-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.audit-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                defiState.audit.filter = btn.getAttribute('data-afilter');
                renderAuditView();
            });
        });

        // Sincroniza sempre que a carteira atualizar saldos
        window.addEventListener('rdesk:wallet-updated', async () => {
            recalculateSniperRange();
            recalculatePixComparator();
            updateSwapFromBalanceDisplay();
            await refreshUniswapPositions();
        });
    }

    window.RdeskDefi = {
        refreshPoolAndPositions: async () => {
            await loadPoolCandlesAndComputeSniper();
            await refreshUniswapPositions();
        },
        refreshPixAndSwap: () => {
            recalculatePixComparator();
            refreshSwapQuote();
        },
        runAudit: (force = false) => runAuditSafely(force),
        isBusy: () => Boolean(defiState.busy),
        getState: () => ({
            sniper: { ...defiState.sniper },
            poolPrice: defiState.poolPrice || 0,
            poolTick: defiState.poolTick ?? null,
            positions: defiState.livePositions.map((p) => ({ id: p.id, minPrice: p.minPrice, maxPrice: p.maxPrice, inRange: p.inRange, totalUsd: p.totalUsd, feesUsd: p.feesUsd }))
        }),
        resizeChart: () => {
            const c = document.getElementById('earn-chart-container');
            if (rangeChart && c && c.clientWidth > 0) rangeChart.redraw();
        }
    };

    document.addEventListener('DOMContentLoaded', async () => {
        initEarnChart();
        bindDefiAndPixEvents();
        recalculatePixComparator();
        await loadPoolCandlesAndComputeSniper();
        await refreshUniswapPositions();
        refreshSwapQuote();
    });
})();
