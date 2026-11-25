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
        '0x3f5fd15e3d5250ae6700bfd8f1adb6b74afca1d4': { symbol: 'BRLS', decimals: 18, kind: 'BRL' },
        '0xe6a537a407488807f0bbeb0038b79004f19dddfb': { symbol: 'BRLA', decimals: 18, kind: 'BRL' },
        '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': { symbol: 'WETH', decimals: 18, kind: 'ETH' },
        '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': { symbol: 'WBTC', decimals: 8, kind: 'BTC' }
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
    };

    let rangeChart = null;
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
        rangeChart = window.RdeskRangeChart.create(container, {
            height: 280, decimals: 4,
            // A pessoa arrastou uma alça da faixa no gráfico: essa passa a ser a faixa dela
            onRangeChange: ({ min, max }) => setCustomRange(min, max, 'grafico')
        });
    }

    // Faixa Sniper sugerida (tracejada) + cada posição real ou simulada (cheia; vermelha se fora da faixa)
    function redrawChartRangeLines() {
        if (!rangeChart) return;
        const bands = [];
        // Faixa escolhida (sugerida ou da pessoa): editável, com alças para arrastar
        if (defiState.sniper.min > 0 && defiState.sniper.max > defiState.sniper.min) {
            rangeChart.setEditableBand({ min: defiState.sniper.min, max: defiState.sniper.max, color: '#38bdf8' });
        } else {
            rangeChart.setEditableBand(null);
        }
        // Com faixa própria, a sugerida aparece tracejada só como referência
        if (defiState.customRange && defiState.suggested && defiState.suggested.max > defiState.suggested.min) {
            bands.push({ min: defiState.suggested.min, max: defiState.suggested.max, color: '#94a3b8', label: 'Sugerida', dashed: true });
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
            // Liquidez e preço do fundo direto da rede (para a calculadora)
            ensurePoolLiquidity();

            if (klinesRes && klinesRes.ok) {
                const raw = await klinesRes.json();
                defiState.candles = raw.map(k => ({
                    time: Math.floor(k[0] / 1000),
                    open: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    close: parseFloat(k[4])
                }));

                defiState.candlesTf = tf;
                if (rangeChart && defiState.candles.length > 0) {
                    rangeChart.setCandles(defiState.candles);
                }
            }
        } catch (e) {}

        // Reserva: velas da própria pool Uniswap quando a fonte principal não responde
        if (!defiState.candles.length || defiState.candlesTf !== tf) {
            try {
                const cfg = { '15m': ['minute', 15], '1h': ['hour', 1], '4h': ['hour', 4] }[tf] || ['minute', 15];
                const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/polygon_pos/pools/${POOL_POL_USDT}/ohlcv/${cfg[0]}?aggregate=${cfg[1]}&limit=90&currency=usd&token=base`);
                const list = res.ok ? (await res.json())?.data?.attributes?.ohlcv_list : null;
                if (Array.isArray(list) && list.length) {
                    const parsed = list.map((k) => ({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4] }))
                        .filter((c) => c.open > 0 && c.close > 0).sort((a, b) => a.time - b.time);
                    // Só aceita se o último fechamento bater com o preço conhecido do POL (evita série da moeda errada)
                    const ref = currentSpotPrice();
                    const last = parsed.length ? parsed[parsed.length - 1].close : 0;
                    if (!(ref > 0) || Math.abs(last / ref - 1) < 0.2) defiState.candles = parsed;
                    defiState.candlesTf = tf;
                    if (rangeChart && defiState.candles.length > 0) rangeChart.setCandles(defiState.candles);
                }
            } catch (e) {}
        }

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

    // Faixa escolhida pela pessoa (arrastando no gráfico ou digitando). null volta para a sugerida.
    function setCustomRange(min, max, origem) {
        min = Number(min); max = Number(max);
        if (!(min > 0 && max > min)) { defiState.customRange = null; }
        else defiState.customRange = { min, max, origem: origem || 'manual' };
        recalculateSniperRange();
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

        const sugLower = priceToTickAligned(Math.max(0.001, spot - halfBand));
        const sugUpper = Math.max(sugLower + TICK_SPACING, priceToTickAligned(spot + halfBand));
        defiState.suggested = { min: tickToHumanPrice(sugLower), max: tickToHumanPrice(sugUpper), tickLower: sugLower, tickUpper: sugUpper };

        // Faixa da pessoa (arrastada no gráfico ou digitada) tem prioridade sobre a sugerida
        let tickLower = sugLower, tickUpper = sugUpper;
        if (defiState.customRange && defiState.customRange.max > defiState.customRange.min) {
            tickLower = priceToTickAligned(defiState.customRange.min);
            tickUpper = Math.max(tickLower + TICK_SPACING, priceToTickAligned(defiState.customRange.max));
        }
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
        const minInp = document.getElementById('earn-range-min');
        const maxInp = document.getElementById('earn-range-max');
        if (minInp && document.activeElement !== minInp) minInp.value = minPrice.toFixed(4);
        if (maxInp && document.activeElement !== maxInp) maxInp.value = maxPrice.toFixed(4);
        const modeEl = document.getElementById('earn-range-mode');
        if (modeEl) {
            const inside = spot > minPrice && spot < maxPrice;
            const width = ((maxPrice - minPrice) / spot) * 100;
            modeEl.textContent = (defiState.customRange ? 'Sua faixa' : 'Faixa sugerida pelo app') +
                ` • ${width.toFixed(1).replace('.', ',')}% de largura` + (inside ? '' : ' • ⚠️ o preço atual está fora dela: não rende até voltar');
            modeEl.classList.toggle('warn', !inside);
        }
        document.getElementById('btn-earn-reset-sniper')?.toggleAttribute('hidden', !defiState.customRange);

        redrawChartRangeLines();
        renderEarnCalc();
    }

    // =========================================================================
    // CALCULADORA: quanto preciso colocar, em qual faixa, para ganhar R$ X por minuto/hora/dia/mês
    // Conta da própria Uniswap V3: sua fatia das taxas = sua liquidez ÷ (sua + a que já está no preço atual).
    // Liquidez do fundo lida na rede; volume de 24 h do GeckoTerminal; taxa do fundo 0,05%.
    // =========================================================================
    const CALC_POOL_FEE = 0.0005;
    const PERIOD_MIN = { min: 1, hora: 60, dia: 1440, mes: 43200 };
    const PERIOD_LABEL = { min: 'minuto', hora: 'hora', dia: 'dia', mes: 'mês' };
    function dailySigma() {
        const c = defiState.candles || [];
        if (c.length < 10) return 0.035;
        const rets = [];
        for (let i = 1; i < c.length; i++) if (c[i - 1].close > 0) rets.push(Math.log(c[i].close / c[i - 1].close));
        const m = rets.reduce((a, b) => a + b, 0) / rets.length;
        const sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, rets.length - 1));
        const perDay = { '15m': 96, '1h': 24, '4h': 6 }[defiState.timeframe || '15m'] || 96;
        return Math.max(0.01, Math.min(0.25, sd * Math.sqrt(perDay)));
    }
    // Liquidez (unidades da Uniswap) que um valor em dólar vira numa faixa de largura w (fração do preço)
    function liquidityPerUsd(spot, w) {
        const k = 1e-12; // WPOL (18 casas) / USDT (6 casas)
        const P = spot * k, pa = spot * (1 - w / 2) * k, pb = spot * (1 + w / 2) * k;
        const denom = 2 * Math.sqrt(P) - Math.sqrt(pa) - P / Math.sqrt(pb);
        return denom > 0 ? 1e6 / denom : 0;
    }
    function earnModel(widthPct) {
        const spot = currentSpotPrice() || 0;
        const vol = defiState.poolVol24hUsd || 0;
        const La = defiState.poolLiquidity || 0;
        const sigma = dailySigma();
        const inRange = Math.max(0.05, Math.min(1, (widthPct / 2) / (1.2 * sigma)));
        const c = liquidityPerUsd(spot, widthPct);
        const poolDayUsd = vol * CALC_POOL_FEE * inRange; // o máximo que caberia a quem está na faixa
        const usdPerDay = (capUsd) => (La > 0 && c > 0 ? poolDayUsd * (c * capUsd) / (c * capUsd + La) : poolDayUsd * Math.min(1, capUsd / 320000) * Math.min(18, 0.16 / widthPct));
        const needUsd = (targetUsdDay) => {
            if (!(targetUsdDay > 0)) return 0;
            if (targetUsdDay >= poolDayUsd * 0.98) return Infinity;
            if (La > 0 && c > 0) return (targetUsdDay * La) / (c * (poolDayUsd - targetUsdDay));
            let lo = 0, hi = 1e9; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (usdPerDay(mid) < targetUsdDay) lo = mid; else hi = mid; } return hi;
        };
        return { spot, vol, sigma, inRange, poolDayUsd, usdPerDay, needUsd, min: spot * (1 - widthPct / 2), max: spot * (1 + widthPct / 2) };
    }
    // Liquidez do fundo (só leitura: não mexe no preço que as operações em andamento usam)
    function ensurePoolLiquidity() {
        if (defiState.poolLiquidity > 0 || defiState.liqBusy || (defiState.liqAt && Date.now() - defiState.liqAt < 30000)) return;
        if (window.RdeskAnon && !window.RdeskAnon.chainAllowed(137)) return;
        defiState.liqBusy = true; defiState.liqAt = Date.now();
        Promise.resolve(window.RdeskWallet.getReadProvider(POLYGON_ID))
            .then((pr) => new ethers.Contract(POOL_POL_USDT, ['function liquidity() view returns (uint128)'], pr).liquidity())
            .then((l) => { defiState.poolLiquidity = Number(l.toString()); renderEarnCalc(); })
            .catch((e) => { defiState.liqError = String(e?.message || e).slice(0, 120); })
            .finally(() => { defiState.liqBusy = false; });
    }
    function renderEarnCalc() {
        ensurePoolLiquidity();
        const box = document.getElementById('earn-calc-out');
        if (!box) return;
        const prices = window.RdeskWallet.getPrices();
        const fx = prices.USD_BRL || 5.4;
        const target = REG.parseBRL(document.getElementById('calc-target')?.value) || 0;
        const per = document.getElementById('calc-period')?.value || 'dia';
        const haveTxt = document.getElementById('calc-have')?.value;
        const free = getFreePolygonInvestableUsd().totalUsd * fx;
        const have = haveTxt ? (REG.parseBRL(haveTxt) || 0) : free;
        const fmt = (v) => window.RdeskWallet.formatBRL(v);
        const perMin = PERIOD_MIN[per];
        const fmtRate = (brlDay) => { const v = brlDay / 1440 * perMin; return v >= 1 ? fmt(v) : `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`; };
        const widths = [{ w: 0.03, name: 'Estreita' }, { w: 0.08, name: 'Média' }, { w: 0.2, name: 'Larga' }];
        if (defiState.sniper && defiState.sniper.max > defiState.sniper.min) {
            const sp = currentSpotPrice() || 1;
            widths.push({ w: Math.max(0.005, (defiState.sniper.max - defiState.sniper.min) / sp), name: defiState.customRange ? 'A sua' : 'Sugerida', current: true });
        }
        const m0 = earnModel(0.08);
        if (!(m0.spot > 0) || !(m0.vol > 0)) { box.innerHTML = '<p class="muted-sm">Carregando o preço e o movimento do fundo…</p>'; return; }
        const targetDayUsd = target > 0 ? (target / perMin) * 1440 / fx : 0;
        const rows = widths.map(({ w, name, current }) => {
            const m = earnModel(w);
            const need = targetDayUsd ? m.needUsd(targetDayUsd) * fx : null;
            const gain = m.usdPerDay(have / fx) * fx;
            return { w, name, current, m, need, gain };
        });
        box.innerHTML = `
            <div class="calc-table" role="table" aria-label="Resultado da calculadora">
                ${rows.map((r) => `
                <div class="calc-row ${r.current ? 'current' : ''}" role="row">
                    <div class="calc-name"><strong>${REG.esc(r.name)}</strong><small>±${(r.w * 50).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% · US$ ${r.m.min.toFixed(4)} – ${r.m.max.toFixed(4)}</small><small>no preço ~${Math.round(r.m.inRange * 100)}% do tempo</small></div>
                    ${target > 0 ? `<div class="calc-cell"><span>Precisa colocar</span><strong class="money">${r.need === Infinity ? 'impossível' : fmt(r.need)}</strong></div>` : ''}
                    <div class="calc-cell"><span>Com ${fmt(have)}</span><strong class="money">${fmtRate(r.gain)}/${PERIOD_LABEL[per]}</strong></div>
                    ${r.current ? '' : `<button type="button" class="btn-soft small" data-calc-use="${r.w}">Usar</button>`}
                </div>`).join('')}
            </div>
            <p class="muted-sm">Estimativa com dados de agora: o fundo movimentou US$ ${Math.round(m0.vol).toLocaleString('pt-BR')} em 24 h e as taxas de quem está no preço somam ~${fmt(m0.poolDayUsd / m0.inRange * fx)}/dia. ${rows.some((r) => r.need === Infinity) ? 'Quando aparece "impossível", nem com todo o dinheiro do mundo: o fundo inteiro não gera esse valor nessa faixa. ' : ''}Faixa estreita ganha mais enquanto o preço está nela, mas sai mais vezes. Não é promessa: o volume muda todo dia.</p>`;
        box.querySelectorAll('[data-calc-use]').forEach((b) => {
            b.onclick = () => {
                const w = Number(b.getAttribute('data-calc-use'));
                const sp = currentSpotPrice();
                setCustomRange(sp * (1 - w / 2), sp * (1 + w / 2), 'calculadora');
                document.getElementById('earn-chart-container')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            };
        });
    }

    // =========================================================================
    // LEITURA ON-CHAIN DAS POSIÇÕES UNISWAP V3 & PILOTO AUTOMÁTICO
    // =========================================================================
    async function refreshUniswapPositions() {
        const addr = window.RdeskWallet.getAddress();
        const prices = window.RdeskWallet.getPrices();
        const spot = prices.POL || 0.088;

        loadSavedSimPositions();

        // Modo anônimo sem a Polygon: não pergunta pelas posições (o servidor veria o seu endereço)
        if (addr && window.RdeskAnon && !window.RdeskAnon.chainAllowed(137)) { updateTopPoolStatusPill(spot); renderPositionsCards(); return; }
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
            defiState.positionsReadFor = String(addr).toLowerCase();
            window.dispatchEvent(new CustomEvent('rdesk:positionsRead'));
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
            s2.innerHTML = `<span class="muted-sm">Valor na Pool</span><br><strong class="money">${pos.isSimulated ? 'Estudo' : window.RdeskWallet.formatBRL(totalBrl)}</strong>`;

            const s3 = document.createElement('div');
            const feesBrl = pos.isSimulated ? 0 : pos.feesUsd * prices.USD_BRL;
            s3.innerHTML = `<span class="muted-sm">Tarifas Acumuladas</span><br><strong class="money" style="color:var(--green-bright);">${pos.isSimulated ? '--' : window.RdeskWallet.formatBRL(feesBrl)}</strong>`;

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
    async function ensureExactErc20Approval(tokenAddress, spender, requiredAmountBN, signer, chainId = POLYGON_ID) {
        const owner = await signer.getAddress();
        const ABI = ['function allowance(address owner, address spender) view returns (uint256)', 'function approve(address spender, uint256 value) returns (bool)'];
        const erc20 = new ethers.Contract(tokenAddress, ABI, signer);
        // Leitura pelos nossos servidores (o da carteira conectada pode estar atrasado)
        const reader = new ethers.Contract(tokenAddress, ABI, window.RdeskWallet.getProvider(chainId));
        const currentAllowance = await reader.allowance(owner, spender).catch(() => erc20.allowance(owner, spender));
        if (currentAllowance.gte(requiredAmountBN)) return;
        if (!currentAllowance.isZero()) {
            const txReset = await erc20.approve(spender, 0);
            await window.RdeskWallet.confirmTx(txReset, chainId);
        }
        const tx = await erc20.approve(spender, requiredAmountBN);
        await window.RdeskWallet.confirmTx(tx, chainId);
        // Espera a autorização aparecer para a rede antes de seguir (evita "cannot estimate gas")
        for (let i = 0; i < 12; i++) {
            const seen = await reader.allowance(owner, spender).catch(() => null);
            if (seen && seen.gte(requiredAmountBN)) return;
            await new Promise((r) => setTimeout(r, 1500));
        }
    }

    // Limite de gás calculado pelos nossos servidores (com folga), para a carteira não precisar estimar
    async function gasLimitFor(contract, method, args, overrides, chainId = POLYGON_ID) {
        const from = await contract.signer.getAddress();
        const reader = contract.connect(window.RdeskWallet.getProvider(chainId));
        let lastErr;
        for (let i = 0; i < 3; i++) {
            try {
                const est = await reader.estimateGas[method](...args, { ...overrides, from });
                return est.mul(125).div(100);
            } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 2000)); }
        }
        throw lastErr;
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
            title: 'Começar a render (Uniswap)',
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
                await window.RdeskWallet.confirmTx(txWrap, POLYGON_ID);
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
                        await window.RdeskWallet.confirmTx(txSwap, POLYGON_ID);
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
                        await window.RdeskWallet.confirmTx(txSwap, POLYGON_ID);
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
            await window.RdeskWallet.confirmTx(txMint, POLYGON_ID);

            fb.style.color = 'var(--green-bright)';
            fb.textContent = '✓ Posição aberta e rendendo tarifas na Uniswap V3!';
            window.dispatchEvent(new CustomEvent('rdesk:success', { detail: { text: 'Seu dinheiro já está rendendo!' } }));
            await window.RdeskWallet.refreshBalances();
            await refreshUniswapPositions();
        } catch (err) {
            fb.style.color = 'var(--red)';
            fb.textContent = window.RdeskWallet.friendlyTxError(err, { native: 'POL' });
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
            fee: REG.creatorFee().active ? creatorFeeText(pos.feesUsd * prices.USD_BRL * REG.creatorFee().rate, ' (só sobre o que rendeu)') : 'R$ 0,00',
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
                ['function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) payable returns (uint256, uint256)',
                    'function positions(uint256) view returns (uint96, address, address token0, address token1, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128)'],
                signer
            );
            const collectArgs = { tokenId: pos.tokenId, recipient: owner, amount0Max: MAX_U128, amount1Max: MAX_U128 };
            const cf = REG.creatorFee();
            // Com a taxa do criador ligada: lê antes quanto vai sair, para cobrar só sobre o que rendeu
            const preview = cf.active ? await nfpm.callStatic.collect(collectArgs, { from: owner }).catch(() => null) : null;
            const tx = await nfpm.collect(collectArgs);
            await window.RdeskWallet.confirmTx(tx, POLYGON_ID);
            if (cf.active && preview) {
                try {
                    const p = await nfpm.positions(pos.tokenId);
                    for (const [token, amt] of [[p.token0, preview[0]], [p.token1, preview[1]]]) {
                        await payCreatorFee(signer, POLYGON_ID, { address: token, isNative: false }, ethers.BigNumber.from(amt).mul(cf.rateBps).div(10000));
                    }
                } catch (e) { console.warn('taxa do criador não enviada', e); }
            }
            await window.RdeskWallet.refreshBalances();
            await refreshUniswapPositions();
        } catch (err) {
            alert(window.RdeskWallet.friendlyTxError(err, { native: 'POL' }));
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
            await window.RdeskWallet.confirmTx(txClose, POLYGON_ID);

            await window.RdeskWallet.refreshBalances();
            await refreshUniswapPositions();
            return true;
        } catch (err) {
            alert(window.RdeskWallet.friendlyTxError(err, { native: 'POL' }));
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
    // =========================================================================
    // TROCAR MOEDAS (Uniswap V3 na Polygon, com várias faixas de tarifa e rota em
    // dois saltos; demais redes e pontes via LI.FI)
    // =========================================================================
    const REG = window.RdeskRegistry;
    const SWAP_FEE_TIERS = [100, 500, 3000, 10000];      // 0,01% 0,05% 0,3% 1%
    const HOP_FEE_TIERS = [100, 500, 3000];
    const SWAP_SLIPPAGE_BPS = 150;                       // 1,5%
    const IMPACT_WARN = 0.03;                            // avisa acima de 3% de perda frente ao mercado
    const IMPACT_BLOCK = 0.10;                           // bloqueia acima de 10%
    const NATIVE_RESERVE = { POL: 3.0, ETH: 0.0015, CELO: 0.05, BNB: 0.002 };
    const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
    const MULTICALL3_ABI = ['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)'];
    // Primeira promessa que der certo (Promise.any com reserva para navegadores antigos)
    const firstSuccess = (list) => new Promise((resolve, reject) => {
        let pending = list.length;
        if (!pending) reject(new Error('sem tentativas'));
        list.forEach((p) => p.then(resolve, () => { if (--pending === 0) reject(new Error('todas falharam')); }));
    });
    const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('tempo esgotado')), ms))]);
    const QUOTER_ABI = [
        'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
        'function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)'
    ];
    const quoterIface = new ethers.utils.Interface(QUOTER_ABI);
    const ROUTER_ABI = [
        'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
        'function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum)) payable returns (uint256 amountOut)'
    ];
    const feeLabel = (fee) => `${(fee / 10000).toLocaleString('pt-BR')}%`;
    let swapQuoteSeq = 0;

    // Bitcoin nativo entra na troca como uma "rede" a mais (valor 'btc')
    const BTC_META = { symbol: 'BTC', name: 'Bitcoin', address: null, decimals: 8, isNative: true, priceKey: 'BTC' };
    const LIFI_BTC_CHAIN = '20000000000001';
    const chainOfValue = (v) => (v === 'btc' ? 'btc' : Number(v || 137));
    // Contrato oficial da LI.FI (mesmo endereço em todas as redes EVM que o app usa)
    // Privacidade: enquanto a pessoa só olha o preço, a cotação vai com endereços neutros (queimado/inútil).
    // O endereço de verdade só sai do aparelho quando ela confirma a troca (a cotação é refeita na hora).
    const PREVIEW_EVM = '0x000000000000000000000000000000000000dEaD';
    const PREVIEW_BTC = 'bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9e75rs';
    const LIFI_DIAMOND = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae';
    const lc = (s) => String(s || '').toLowerCase();

    // Confere a resposta da LI.FI ANTES de mostrar o recibo: um serviço comprometido não consegue
    // desviar o dinheiro para outro contrato, outro destinatário ou outro valor.
    function checkLifiQuote(data, { fromChain, rawIn, fromAddress, toAddress, fromNative, amountUsd }) {
        const a = data.action || {};
        const tr = data.transactionRequest || {};
        if (String(a.fromAmount) !== rawIn.toString()) throw new Error('O valor da rota não confere com o que você digitou. Cancelada.');
        if (lc(a.fromAddress) !== lc(fromAddress)) throw new Error('A rota foi montada para outra carteira. Cancelada.');
        const sameAddr = String(toAddress).startsWith('bc1') ? a.toAddress === toAddress : lc(a.toAddress) === lc(toAddress);
        if (!sameAddr) {
            throw new Error('A rota entregaria o dinheiro para outro endereço. Cancelada.');
        }
        if (fromChain === 'btc') return; // o lado Bitcoin é conferido no PSBT
        if (lc(tr.to) !== LIFI_DIAMOND) throw new Error('A rota pede para assinar com um contrato desconhecido. Cancelada.');
        const spender = data.estimate?.approvalAddress;
        if (!fromNative && lc(spender) !== LIFI_DIAMOND) throw new Error('A rota pede autorização para um contrato desconhecido. Cancelada.');
        if (tr.chainId && Number(tr.chainId) !== Number(fromChain)) throw new Error('A rota é de outra rede. Cancelada.');
        const est = data.estimate || {};
        if (est.toAmountMin && est.toAmount && ethers.BigNumber.from(est.toAmountMin).lt(ethers.BigNumber.from(est.toAmount).mul(95).div(100))) {
            throw new Error('A rota aceitaria receber bem menos do que o prometido. Cancelada.');
        }
        const value = ethers.BigNumber.from(tr.value || '0');
        if (fromNative) {
            if (value.gt(rawIn.mul(1005).div(1000))) throw new Error('A rota cobraria mais do que você digitou. Cancelada.');
        } else if (value.gt(0)) {
            const nativeMeta = tokensOf(fromChain).find((x) => x.isNative);
            const nativeUsd = parseFloat(ethers.utils.formatEther(value)) * (nativeMeta ? tokenUnitUsd(fromChain, nativeMeta) : 0);
            if (!(nativeUsd <= Math.max(2, amountUsd * 0.03))) throw new Error('A rota cobraria uma taxa extra alta na moeda da rede. Cancelada.');
        }
    }
    // Parte do criador (desligada por padrão; ver RdeskRegistry.creatorFee)
    async function payCreatorFee(signer, chainId, meta, raw) {
        const cf = REG.creatorFee();
        if (!cf.active || !raw || raw.lte(0)) return null;
        const tx = meta.isNative
            ? await signer.sendTransaction({ to: cf.evmAddress, value: raw })
            : await new ethers.Contract(meta.address, ['function transfer(address,uint256) returns (bool)'], signer).transfer(cf.evmAddress, raw);
        await window.RdeskWallet.confirmTx(tx, chainId);
        return tx.hash;
    }
    const creatorFeeText = (brl, extra = '') => {
        const cf = REG.creatorFee();
        return cf.active ? `Taxa do criador (${(cf.rateBps / 100).toLocaleString('pt-BR')}%): ${window.RdeskWallet.formatBRL(brl)}${extra}` : `R$ 0,00 (sem taxa do app)${extra}`;
    };
    const tokensOf = (chainId) => (chainId === 'btc' ? [BTC_META] : REG.getTokens(chainId));
    function getTokenMeta(chainId, symbol) {
        return tokensOf(chainId).find((t) => t.symbol === symbol) || null;
    }
    // Endereço usado dentro da Uniswap (moeda nativa entra como a versão embrulhada)
    function uniswapAddress(meta) {
        return meta.isNative ? ADDR_WPOL : meta.address;
    }
    function tokenUnitUsd(chainId, meta) {
        return window.RdeskWallet.unitUsdFor(meta.priceKey, chainId, meta.address);
    }
    function swapEls() {
        const g = (id) => document.getElementById(id);
        return { fc: g('swap-from-chain'), ft: g('swap-from-token'), tc: g('swap-to-chain'), tt: g('swap-to-token'), amt: g('swap-amount-in'), out: g('swap-amount-out'), info: g('swap-quote-info'), contracts: g('swap-contracts') };
    }
    function readSwapForm() {
        const e = swapEls();
        const amountText = String(e.amt?.value || '').trim().replace(',', '.');
        return { fromChain: chainOfValue(e.fc?.value), toChain: chainOfValue(e.tc?.value), fromSym: e.ft?.value || '', toSym: e.tt?.value || '', amountText, amountIn: parseFloat(amountText) || 0 };
    }
    const swapKey = (f) => `${f.fromChain}:${f.fromSym}>${f.toChain}:${f.toSym}@${f.amountText}`;

    function fillTokenSelect(select, chainId, wanted) {
        if (!select) return;
        const tokens = tokensOf(chainId);
        // Deixa claro o que é Bitcoin de verdade e o que é só um token que representa Bitcoin
        const label = (t) => (chainId === 'btc' ? 'BTC — Bitcoin nativo' : /^(WBTC|CBBTC)$/i.test(t.symbol) ? `${t.symbol} — Bitcoin pareado (token)` : t.symbol);
        select.replaceChildren(...tokens.map((t) => new Option(label(t), t.symbol)));
        if (tokens.some((t) => t.symbol === wanted)) select.value = wanted;
    }
    // Monta as listas de rede e de moeda (as moedas mudam conforme a rede escolhida).
    function populateSwapSelects() {
        const e = swapEls();
        if (!e.fc || !e.tc) return;
        if (!e.fc.options.length) {
            // Bitcoin primeiro: é a reserva de valor do app
            [e.fc, e.tc].forEach((sel) => sel.replaceChildren(new Option('Bitcoin', 'btc'), ...REG.CHAINS.map((c) => new Option(c.name, String(c.id)))));
            e.fc.value = '137'; e.tc.value = '137';
            fillTokenSelect(e.ft, 137, 'POL');
            fillTokenSelect(e.tt, 137, 'USDT');
        } else {
            fillTokenSelect(e.ft, chainOfValue(e.fc.value), e.ft.value);
            fillTokenSelect(e.tt, chainOfValue(e.tc.value), e.tt.value);
        }
        renderSwapContracts();
    }
    // Mostra o contrato das duas moedas para conferência.
    function renderSwapContracts() {
        const e = swapEls();
        if (!e.contracts) return;
        const f = readSwapForm();
        const line = (label, chainId, sym) => {
            const meta = getTokenMeta(chainId, sym);
            if (!meta) return '';
            const where = meta.address
                ? `<a href="${REG.esc(REG.explorerTokenUrl(chainId, meta.address))}" target="_blank" rel="noopener noreferrer" title="${REG.esc(meta.address)}">${REG.esc(REG.shortAddress(meta.address, 8, 6))} ↗</a>`
                : '<span>moeda nativa da rede</span>';
            return `<div class="swap-contract-line">${REG.tokenOnChainBadge(sym, chainId, 22)}<span>${label} <strong>${REG.esc(sym)}</strong> ${REG.chainBadge(chainId)}</span>${where}</div>`;
        };
        e.contracts.innerHTML = line('Envia', f.fromChain, f.fromSym) + line('Recebe', f.toChain, f.toSym);
    }

    function syncSwapBrl() {
        const brlEl = document.getElementById('swap-amount-brl');
        if (!brlEl || document.activeElement === brlEl) return;
        const f = readSwapForm();
        const meta = getTokenMeta(f.fromChain, f.fromSym);
        const brl = meta && f.amountIn > 0 ? f.amountIn * tokenUnitUsd(f.fromChain, meta) * window.RdeskWallet.getPrices().USD_BRL : 0;
        brlEl.value = brl > 0 ? brl.toFixed(2).replace('.', ',') : '';
    }

    function updateSwapFromBalanceDisplay() {
        syncSwapBrl();
        const f = readSwapForm();
        const found = window.RdeskWallet.getBalances().find((b) => b.chainId === f.fromChain && b.symbol === f.fromSym);
        const balEl = document.getElementById('swap-from-bal');
        if (balEl) balEl.textContent = `${(found ? found.amount : 0).toLocaleString('pt-BR', { maximumFractionDigits: 6 })} ${f.fromSym}`;
    }

    // Procura a melhor rota na Uniswap V3 da Polygon: direto em cada faixa de tarifa e, se preciso, em dois saltos.
    async function quotePolygonUniswap(fromMeta, toMeta, rawIn) {
        const addrIn = uniswapAddress(fromMeta), addrOut = uniswapAddress(toMeta);
        const best = { out: ethers.constants.Zero, hops: null };
        const consider = (out, hops) => { if (out.gt(best.out)) { best.out = out; best.hops = hops; } };

        // Rotas candidatas vão em poucas consultas agrupadas (Multicall3), cada uma enviada a todos os
        // servidores da Polygon ao mesmo tempo (vale a primeira resposta). Grupos pequenos: servidores
        // públicos limitam o gás de uma consulta, e um grupo grande demais é recusado inteiro.
        const decodeOut = (c, ret) => quoterIface.decodeFunctionResult(c.hops.length === 1 ? 'quoteExactInputSingle' : 'quoteExactInput', ret).amountOut;
        // App Android (Tor): cada pedido leva bem mais tempo e alguns servidores recusam o Tor.
        // Então: espera mais, pergunta só aos 2 servidores que estão respondendo (os mais rápidos na
        // última medição) e não refaz rota por rota quando o problema foi só demora.
        const tor = Boolean(window.RDESK_NATIVE);
        const ESPERA = tor ? 30000 : 9000;
        let rpcs = (REG.getChain(137)?.rpcs || []);
        if (tor) {
            await Promise.race([Promise.resolve(REG.rankRpcs?.(137)), new Promise((r) => setTimeout(r, 3000))]).catch(() => {});
            const saude = REG.rpcHealth?.(137);
            const bons = saude ? saude.filter((x) => x.ok).sort((a, b) => a.ms - b.ms).map((x) => x.url) : [];
            rpcs = (bons.length ? bons : rpcs).slice(0, 2);
        }
        const providers = rpcs.map((url) => new ethers.providers.StaticJsonRpcProvider(url, 137));
        const runGroup = async (group) => {
            const payload = group.map((c) => ({ target: QUOTER_V2, allowFailure: true, callData: c.data }));
            let demoras = 0;
            const attempts = providers.map((p, i) => withTimeout(new ethers.Contract(MULTICALL3, MULTICALL3_ABI, p).callStatic.aggregate3(payload, { gasLimit: 15000000 }), ESPERA)
                .then((res) => ({ res, i })));
            attempts.forEach((pr, i) => pr.catch((err) => {
                if (/tempo esgotado/.test(String(err && err.message))) demoras++;
                console.debug('[cotação] servidor', i, 'falhou:', String(err && (err.reason || err.message)).slice(0, 120));
            }));
            let won;
            try { won = await firstSuccess(attempts); } catch (err) {
                await Promise.resolve(); // deixa as contagens de "demora" acontecerem
                const e = new Error('cotação falhou');
                e.soDemora = demoras === providers.length;
                throw e;
            }
            return won.res.map((r, k) => { if (!r.success) return null; try { return decodeOut(group[k], r.returnData); } catch (e) { return null; } });
        };
        // Uma rota sozinha, com teto de gás: pool quase sem liquidez faz o simulador da Uniswap gastar
        // gás sem fim, e isso derrubava o grupo inteiro.
        const runSingle = async (c) => {
            const attempts = providers.map((p) => withTimeout(p.call({ to: QUOTER_V2, data: c.data, gasLimit: 3000000 }), ESPERA));
            try { return decodeOut(c, await firstSuccess(attempts)); } catch (e) { return null; }
        };
        const runAll = async (cands, size) => {
            const groups = [];
            for (let i = 0; i < cands.length; i += size) groups.push(cands.slice(i, i + size));
            const settled = await Promise.allSettled(groups.map(runGroup));
            const out = [];
            for (let gi = 0; gi < groups.length; gi++) {
                if (settled[gi].status === 'fulfilled') out.push(...settled[gi].value);
                // Só demora (rede lenta): refazer rota por rota só multiplicaria a espera
                else if (settled[gi].reason && settled[gi].reason.soDemora) out.push(...groups[gi].map(() => null));
                else out.push(...(await Promise.all(groups[gi].map(runSingle))));
            }
            if (out.every((x) => x == null) && settled.every((r) => r.status === 'rejected')) throw new Error('rede indisponível');
            return out;
        };
        const started = Date.now();

        const directCands = SWAP_FEE_TIERS.map((fee) => ({
            hops: [{ tokenIn: addrIn, fee, tokenOut: addrOut }],
            data: quoterIface.encodeFunctionData('quoteExactInputSingle', [{ tokenIn: addrIn, tokenOut: addrOut, amountIn: rawIn, fee, sqrtPriceLimitX96: 0 }])
        }));
        let candidates = directCands;
        let results = await runAll(directCands, 2);
        results.forEach((out, i) => { if (out && !out.isZero()) consider(out, directCands[i].hops); });

        // Dois saltos (via USDT, WPOL ou USDC) só quando não há pool direta ou ela paga mal frente ao mercado
        const unitIn = tokenUnitUsd(137, fromMeta), unitOut = tokenUnitUsd(137, toMeta);
        const directValueRatio = best.hops && unitIn > 0 && unitOut > 0
            ? (parseFloat(ethers.utils.formatUnits(best.out, toMeta.decimals)) * unitOut) / (parseFloat(ethers.utils.formatUnits(rawIn, fromMeta.decimals)) * unitIn)
            : 0;
        if (!best.hops || directValueRatio < 0.99) {
            const mids = ['USDT', 'WPOL', 'USDC'].map((s) => getTokenMeta(137, s)).filter(Boolean)
                .map((m) => m.address).filter((x) => x.toLowerCase() !== addrIn.toLowerCase() && x.toLowerCase() !== addrOut.toLowerCase());
            const hopCands = [];
            mids.forEach((mid) => HOP_FEE_TIERS.forEach((f1) => HOP_FEE_TIERS.forEach((f2) => hopCands.push({
                hops: [{ tokenIn: addrIn, fee: f1, tokenOut: mid }, { tokenIn: mid, fee: f2, tokenOut: addrOut }],
                data: quoterIface.encodeFunctionData('quoteExactInput', [ethers.utils.solidityPack(['address', 'uint24', 'address', 'uint24', 'address'], [addrIn, f1, mid, f2, addrOut]), rawIn])
            }))));
            if (hopCands.length) {
                let hopResults = [];
                try { hopResults = await runAll(hopCands, 3); } catch (err) { if (!best.hops) throw err; }
                candidates = directCands.concat(hopCands);
                results = results.concat(hopResults);
            }
        }
        console.debug('[cotação]', candidates.length, 'rotas em', Date.now() - started, 'ms');
        // Prefere a rota direta quando ela paga praticamente o mesmo (menos contratos envolvidos).
        results.forEach((out, i) => {
            if (!out || out.isZero()) return;
            const c = candidates[i];
            if (c.hops.length === 2 && best.hops && best.hops.length === 1 && out.lte(best.out.mul(1005).div(1000))) return;
            consider(out, c.hops);
        });
        if (!best.hops) return null;
        const symbolOf = (addr) => (REG.findToken(137, addr)?.symbol || REG.shortAddress(addr));
        const label = best.hops.length === 1
            ? `Uniswap V3 direto (tarifa ${feeLabel(best.hops[0].fee)})`
            : `Uniswap V3 via ${symbolOf(best.hops[0].tokenOut)} (${feeLabel(best.hops[0].fee)} + ${feeLabel(best.hops[1].fee)})`;
        return { rawOut: best.out, hops: best.hops, label };
    }

    // Calcula a cotação do formulário atual. Devolve a cotação (ou null) e atualiza a tela.
    // Uma cotação por vez para a mesma troca: atualizações periódicas não cancelam a que está em
    // andamento (senão, com RPC lento, cada nova atualização descartava a anterior e a tela ficava
    // presa em "Buscando…").
    let swapInFlight = null;
    function refreshSwapQuote() {
        const key = swapKey(readSwapForm());
        if (swapInFlight && swapInFlight.key === key) return swapInFlight.promise;
        const t0 = Date.now();
        console.debug('[cotação] início', key);
        const promise = computeSwapQuote().finally(() => {
            console.debug('[cotação] fim', key, Date.now() - t0, 'ms');
            if (swapInFlight && swapInFlight.promise === promise) swapInFlight = null;
        });
        swapInFlight = { key, promise };
        return promise;
    }
    async function computeSwapQuote() {
        const seq = ++swapQuoteSeq;
        const e = swapEls();
        const f = readSwapForm();
        updateSwapFromBalanceDisplay();
        renderSwapContracts();
        const setOut = (value, info) => {
            if (seq !== swapQuoteSeq) return; // já existe um pedido mais novo
            if (e.out) e.out.value = value;
            if (e.info && info !== undefined) e.info.textContent = info;
        };
        const fail = (info) => { if (seq === swapQuoteSeq) defiState.swapQuote = null; setOut('--', info); return null; };

        if (!(f.amountIn > 0)) { defiState.swapQuote = null; setOut('0', 'Digite a quantidade'); return null; }
        const fromMeta = getTokenMeta(f.fromChain, f.fromSym);
        const toMeta = getTokenMeta(f.toChain, f.toSym);
        if (!fromMeta || !toMeta) return fail('Moeda indisponível nesta rede');
        if (f.fromChain === f.toChain && f.fromSym === f.toSym) return fail('Escolha moedas diferentes');

        let rawIn;
        try { rawIn = ethers.utils.parseUnits(f.amountText, fromMeta.decimals); } catch (err) { return fail('Quantidade com casas decimais demais para esta moeda'); }
        // Atualização da mesma troca (cotação a cada 10 s): mantém o número na tela até chegar o novo.
        // Troca diferente: nunca mostra o número da anterior enquanto busca.
        const sameForm = Boolean(defiState.swapQuote && defiState.swapQuote.key === swapKey(f) && e.out && e.info);
        const base = { key: swapKey(f), fromChain: f.fromChain, toChain: f.toChain, fromSym: f.fromSym, toSym: f.toSym, fromMeta, toMeta, amountIn: f.amountIn, rawIn };
        const usdIn = f.amountIn * tokenUnitUsd(f.fromChain, fromMeta);
        const impactOf = (amountOut) => {
            const usdOut = amountOut * tokenUnitUsd(f.toChain, toMeta);
            return usdIn > 0 && usdOut > 0 ? 1 - usdOut / usdIn : null;
        };
        const publish = (quote, info) => {
            if (seq !== swapQuoteSeq) return null;
            if (quote.impact !== null && quote.impact > IMPACT_BLOCK) {
                return fail(`Sem liquidez: esta troca perderia ${(quote.impact * 100).toFixed(1)}% frente ao mercado. Tente um valor menor ou outra moeda.`);
            }
            defiState.swapQuote = quote;
            const warn = quote.impact !== null && quote.impact > IMPACT_WARN ? ` • ⚠️ ${(quote.impact * 100).toFixed(1)}% abaixo do mercado` : '';
            setOut(quote.amountOut.toLocaleString('pt-BR', { maximumFractionDigits: quote.amountOut >= 1000 ? 2 : 6, useGrouping: false }), info + warn);
            return quote;
        };

        // Caso 0: Bitcoin nativo entrando ou saindo (LI.FI escolhe o serviço: LayerSwap, Relay, THORChain…)
        if (f.fromChain === 'btc' || f.toChain === 'btc') {
            if (f.fromChain === 'btc' && f.toChain === 'btc') return fail('Escolha outra rede para receber');
            setOut(sameForm ? e.out.value : '…', sameForm ? e.info.textContent : 'Consultando rota para o Bitcoin…');
            return quoteBitcoinRoute(f, base, fail, publish, seq);
        }

        // Caso 1: embrulhar / desembrulhar POL (1:1)
        if (f.fromChain === 137 && f.toChain === 137 && ((f.fromSym === 'POL' && f.toSym === 'WPOL') || (f.fromSym === 'WPOL' && f.toSym === 'POL'))) {
            return publish({ ...base, type: 'WRAP_UNWRAP', amountOut: f.amountIn, rawOut: rawIn, impact: 0, routeLabel: 'Contrato oficial WPOL (1:1)' }, 'Conversão 1:1, sem tarifa');
        }

        // Caso 2: Polygon -> Uniswap V3 (melhor rota)
        if (f.fromChain === 137 && f.toChain === 137) {
            setOut(sameForm ? e.out.value : '…', sameForm ? e.info.textContent : (window.RDESK_NATIVE ? 'Buscando a melhor rota pelo Tor… (até 30 s)' : 'Buscando a melhor rota…'));
            let route;
            const cfU = REG.creatorFee();
            const creatorFeeRaw = cfU.active ? rawIn.mul(cfU.rateBps).div(10000) : ethers.constants.Zero;
            const swapRaw = rawIn.sub(creatorFeeRaw);
            try { route = await quotePolygonUniswap(fromMeta, toMeta, swapRaw); } catch (err) { return fail('Rede indisponível para cotar agora. Tente de novo.'); }
            if (!route) return fail('Não há pool na Uniswap V3 para este par.');
            const amountOut = parseFloat(ethers.utils.formatUnits(route.rawOut, toMeta.decimals));
            const creatorFeeBrl = parseFloat(ethers.utils.formatUnits(creatorFeeRaw, fromMeta.decimals)) * tokenUnitUsd(137, fromMeta) * window.RdeskWallet.getPrices().USD_BRL;
            return publish({ ...base, rawIn: swapRaw, totalRaw: rawIn, creatorFeeRaw, creatorFeeBrl, type: 'UNISWAP_V3', amountOut, rawOut: route.rawOut, hops: route.hops, impact: impactOf(amountOut), routeLabel: route.label }, route.label);
        }

        // Caso 3: outras redes ou ponte entre redes -> LI.FI
        setOut(sameForm ? e.out.value : '…', sameForm ? e.info.textContent : 'Consultando rota entre redes…');
        try {
            const ZERO = '0x0000000000000000000000000000000000000000';
            const userAddr = PREVIEW_EVM;
            const params = new URLSearchParams({
                fromChain: String(f.fromChain), toChain: String(f.toChain),
                fromToken: fromMeta.isNative ? ZERO : fromMeta.address, toToken: toMeta.isNative ? ZERO : toMeta.address,
                fromAmount: rawIn.toString(), fromAddress: userAddr, slippage: String(SWAP_SLIPPAGE_BPS / 10000), integrator: REG.creatorFee().lifiIntegrator
            });
            if (REG.creatorFee().active) params.set('fee', String(REG.creatorFee().rate));
            const res = await withTimeout(fetch(`https://li.quest/v1/quote?${params}`), 25000);
            const data = await res.json();
            if (!res.ok || !data?.estimate?.toAmount) throw new Error(data?.message || 'sem rota');
            try {
                checkLifiQuote(data, { fromChain: f.fromChain, rawIn, fromAddress: userAddr, toAddress: userAddr, fromNative: fromMeta.isNative, amountUsd: f.amountIn * tokenUnitUsd(f.fromChain, fromMeta) });
            } catch (err) { return fail(err.message); }
            const amountOut = parseFloat(ethers.utils.formatUnits(data.estimate.toAmount, toMeta.decimals));
            const tool = data.toolDetails?.name || 'LI.FI';
            const minutes = Math.max(1, Math.round((data.estimate.executionDuration || 60) / 60));
            return publish({ ...base, type: 'LIFI', preview: true, lifiParams: params.toString(), amountOut, rawOut: ethers.BigNumber.from(data.estimate.toAmount), impact: impactOf(amountOut), lifiData: data,
                routeLabel: `${tool} (LI.FI) • ~${minutes} min` }, `${f.fromChain === f.toChain ? 'Troca' : 'Ponte'} via ${tool} • ~${minutes} min`);
        } catch (err) {
            return fail('Rota indisponível para este par/rede agora.');
        }
    }

    async function quoteBitcoinRoute(f, base, fail, publish, seq) {
        const W = window.RdeskWallet;
        // Saindo do Bitcoin: usa o endereço do cofre com mais Bitcoin; chegando no Bitcoin: um endereço novo
        const fromBtcAddr = f.fromChain === 'btc';
        const btcAddress = fromBtcAddr ? (W.getBitcoinSpendAddress?.() || W.getBitcoinAddress()) : W.getBitcoinAddress();
        const evmAddress = W.getAddress();
        if (!btcAddress) return fail('Esta carteira não tem endereço Bitcoin (só carteiras criadas ou importadas no app têm).');
        if (!evmAddress) return fail('Abra uma carteira para trocar.');
        const fromBtc = f.fromChain === 'btc';
        // Saindo do Bitcoin o serviço precisa ver as suas moedas para montar a transação; nos outros casos, endereços neutros
        const qFrom = fromBtc ? btcAddress : PREVIEW_EVM;
        const qTo = fromBtc ? evmAddress : PREVIEW_BTC;
        const lifiChain = (c) => (c === 'btc' ? LIFI_BTC_CHAIN : String(c));
        const lifiToken = (c, meta) => (c === 'btc' ? 'bitcoin' : meta.isNative ? '0x0000000000000000000000000000000000000000' : meta.address);
        const params = new URLSearchParams({
            fromChain: lifiChain(f.fromChain), toChain: lifiChain(f.toChain),
            fromToken: lifiToken(f.fromChain, base.fromMeta), toToken: lifiToken(f.toChain, base.toMeta),
            fromAmount: base.rawIn.toString(), fromAddress: qFrom, toAddress: qTo,
            slippage: String(SWAP_SLIPPAGE_BPS / 10000), integrator: REG.creatorFee().lifiIntegrator
        });
        if (REG.creatorFee().active) params.set('fee', String(REG.creatorFee().rate));
        let data;
        try {
            const res = await withTimeout(fetch(`https://li.quest/v1/quote?${params}`), 30000);
            data = await res.json();
            if (!res.ok || !data?.estimate?.toAmount) {
                if (/UTXO/i.test(data?.message || '')) return fail('Sem bitcoin confirmado nesta carteira para trocar.');
                const two = twoStepPlan(f);
                if (two) { fail(two.text); showTwoStep(two); return null; }
                return fail('Nenhum serviço aceita essa troca agora (valor baixo demais ou rota indisponível).');
            }
        } catch (err) { return fail('Serviço de rotas indisponível agora. Tente de novo.'); }
        if (seq !== swapQuoteSeq) return null;
        try {
            checkLifiQuote(data, { fromChain: f.fromChain, rawIn: base.rawIn, fromAddress: qFrom, toAddress: qTo,
                fromNative: Boolean(base.fromMeta.isNative), amountUsd: base.amountIn * tokenUnitUsd(f.fromChain, base.fromMeta) });
        } catch (err) { return fail(err.message); }
        const prices = window.RdeskWallet.getPrices();
        const usdBrl = prices.USD_BRL;
        const amountOut = parseFloat(ethers.utils.formatUnits(data.estimate.toAmount, base.toMeta.decimals));
        const tool = data.toolDetails?.name || data.tool || 'serviço de ponte';
        const minutes = Math.max(1, Math.round((data.estimate.executionDuration || 900) / 60));
        const serviceUsd = (data.estimate.feeCosts || []).reduce((s, c) => s + Number(c.amountUSD || 0), 0);
        let networkUsd = (data.estimate.gasCosts || []).reduce((s, c) => s + Number(c.amountUSD || 0), 0);
        let btcPlan = null;
        if (fromBtc) {
            // Confere a transação Bitcoin AGORA, para mostrar a taxa exata em reais antes de pedir confirmação
            const tr = data.transactionRequest || {};
            try {
                const utxos = await window.RdeskBitcoin.fetchUtxos(btcAddress);
                const mine = new Set(utxos.filter((u) => u.confirmed !== false).map((u) => `${u.txid}:${u.vout}`));
                if (/^70736274ff/i.test(String(tr.data || ''))) {
                    btcPlan = window.RdeskBitcoin.checkSwapPsbt(tr.data, { ownAddress: btcAddress, depositAddress: tr.to, depositValue: tr.value });
                    if (btcPlan.inputs.some((i) => !mine.has(`${i.txid}:${i.vout}`))) throw new Error('A troca usa moedas que já foram gastas ou ainda não confirmaram. Peça a cotação de novo.');
                } else if (tr.to && tr.data) {
                    const rates = await window.RdeskBitcoin.fetchFeeRates();
                    btcPlan = window.RdeskBitcoin.planTransaction({ utxos, toAddress: tr.to, amountSats: Number(tr.value), feeRate: rates.normal, changeAddress: btcAddress, memo: String(tr.data) });
                } else throw new Error('O serviço não devolveu a transação Bitcoin.');
                if (Number(tr.value) !== Number(base.rawIn.toString())) throw new Error('O valor do depósito não confere com o que você digitou. Cancelada.');
            } catch (err) { return fail(err.message); }
            networkUsd = (btcPlan.fee / 1e8) * (prices.BTC || 0);
        }
        const feesBrl = (serviceUsd + networkUsd) * usdBrl;
        const usdInQ = base.amountIn * tokenUnitUsd(f.fromChain, base.fromMeta);
        const usdOutQ = amountOut * tokenUnitUsd(f.toChain, base.toMeta);
        if (usdInQ > 0 && usdOutQ > 0 && 1 - usdOutQ / usdInQ > IMPACT_BLOCK) {
            return fail(`As taxas levariam ${((1 - usdOutQ / usdInQ) * 100).toFixed(0)}% do valor (≈ ${window.RdeskWallet.formatBRL(feesBrl)}). Troque um valor maior.`);
        }
        const amountsText = `taxas ≈ ${window.RdeskWallet.formatBRL(feesBrl)}`;
        return publish({
            ...base, type: fromBtc ? 'BTC_OUT' : 'LIFI', preview: !fromBtc, lifiParams: params.toString(), amountOut, rawOut: ethers.BigNumber.from(data.estimate.toAmount),
            impact: (() => { const usdIn = base.amountIn * tokenUnitUsd(f.fromChain, base.fromMeta); const usdOut = amountOut * tokenUnitUsd(f.toChain, base.toMeta); return usdIn > 0 && usdOut > 0 ? 1 - usdOut / usdIn : null; })(),
            lifiData: data, btcPlan, btcAddress, tool, minutes, serviceBrl: serviceUsd * usdBrl, networkBrl: networkUsd * usdBrl,
            routeLabel: `${tool} • ~${minutes} min`
        }, `${tool} • ~${minutes} min • ${amountsText}`);
    }

    // ---------------------------------------------------------------------------------
    // TROCA EM 2 ETAPAS (Bitcoin ↔ real digital): quando nenhum serviço faz BTC → BRZ/BRLA direto,
    // o caminho é passar pelo dólar digital (USDC) da mesma rede. Cada etapa é uma troca normal,
    // conferida e confirmada por você. O app lembra da etapa 2 e avisa quando o USDC chegar.
    // ---------------------------------------------------------------------------------
    const LEG_KEY = 'rdesk_swap_leg2_v1';
    const readLeg = () => { try { return JSON.parse(localStorage.getItem(LEG_KEY) || 'null'); } catch (e) { return null; } };
    const writeLeg = (v) => { try { if (v) localStorage.setItem(LEG_KEY, JSON.stringify(v)); else localStorage.removeItem(LEG_KEY); } catch (e) {} };
    const usdcBal = (chainId) => Number(window.RdeskWallet.getBalances().find((b) => b.chainId === chainId && b.symbol === 'USDC')?.amount || 0);
    function twoStepPlan(f) {
        const other = f.fromChain === 'btc' ? f.toChain : f.fromChain;
        const otherSym = f.fromChain === 'btc' ? f.toSym : f.fromSym;
        if (other === 'btc' || otherSym === 'USDC' || !getTokenMeta(other, 'USDC')) return null;
        const chain = REG.getChain(other).name;
        const brlIn = f.amountIn * tokenUnitUsd(f.fromChain, getTokenMeta(f.fromChain, f.fromSym)) * window.RdeskWallet.getPrices().USD_BRL;
        if (f.fromChain === 'btc') {
            return { text: `Nenhum serviço troca BTC por ${otherSym} direto agora. Dá em 2 etapas pelo USDC da ${chain}.`,
                step1: { fromChain: 'btc', fromSym: 'BTC', toChain: other, toSym: 'USDC', amount: f.amountText },
                step2: { fromChain: other, fromSym: 'USDC', toChain: other, toSym: otherSym }, brlIn, chain, last: otherSym };
        }
        return { text: `Nenhum serviço troca ${otherSym} por BTC direto agora. Dá em 2 etapas pelo USDC da ${chain}.`,
            step1: { fromChain: other, fromSym: otherSym, toChain: other, toSym: 'USDC', amount: f.amountText },
            step2: { fromChain: other, fromSym: 'USDC', toChain: 'btc', toSym: 'BTC' }, brlIn, chain, last: 'BTC' };
    }
    function setSwapForm({ fromChain, fromSym, toChain, toSym, amount }) {
        const e = swapEls();
        if (!e.fc) return;
        e.fc.value = String(fromChain); e.tc.value = String(toChain);
        fillTokenSelect(e.ft, chainOfValue(e.fc.value), fromSym);
        fillTokenSelect(e.tt, chainOfValue(e.tc.value), toSym);
        if (amount !== undefined) e.amt.value = String(amount);
        renderSwapContracts(); updateSwapFromBalanceDisplay(); syncSwapBrl();
        window.RdeskSwapPicker?.paint?.();
        document.getElementById('swap-two-step')?.remove();
        clearTimeout(swapQuoteTimer);
        swapQuoteTimer = setTimeout(refreshSwapQuote, 200);
    }
    function showTwoStep(plan) {
        const info = document.getElementById('swap-quote-info');
        if (!info) return;
        document.getElementById('swap-two-step')?.remove();
        const box = document.createElement('div');
        box.id = 'swap-two-step';
        box.className = 'two-step';
        box.innerHTML = `<div class="two-step-path"><span>1</span> ${REG.esc(plan.step1.fromSym)} → USDC <small>agora</small></div>
            <div class="two-step-path"><span>2</span> USDC → ${REG.esc(plan.last)} <small>${plan.step1.fromChain === 'btc' ? 'quando o USDC chegar (o app avisa)' : 'logo em seguida'}</small></div>
            <button type="button" class="btn-primary" id="btn-two-step">Fazer em 2 etapas</button>`;
        info.after(box);
        box.querySelector('#btn-two-step').onclick = () => {
            writeLeg({ ...plan.step2, created: Date.now(), startUsdc: usdcBal(plan.step2.fromChain), armed: false });
            box.remove();
            setSwapForm(plan.step1);
        };
    }
    // Depois da etapa 1: quando o USDC entra, oferece a etapa 2 já preenchida
    function checkLeg2() {
        const leg = readLeg();
        const old = document.getElementById('swap-leg2');
        if (!leg) { old?.remove(); return; }
        if (Date.now() - leg.created > 3 * 86400 * 1000) { writeLeg(null); old?.remove(); return; }
        const got = usdcBal(leg.fromChain) - Number(leg.startUsdc || 0);
        if (!leg.armed || !(got > 0.5)) return;
        const amount = Math.floor(got * 1e6) / 1e6;
        if (old && old.dataset.amt === String(amount)) return;
        old?.remove();
        const card = document.getElementById('swap-panel') || document.getElementById('swap-quote-info')?.parentElement;
        if (!card) return;
        const box = document.createElement('div');
        box.id = 'swap-leg2'; box.className = 'two-step ready'; box.dataset.amt = String(amount);
        box.innerHTML = `<strong>✅ Etapa 1 concluída: chegaram ${amount.toLocaleString('pt-BR')} USDC.</strong>
            <div class="two-step-path"><span>2</span> USDC → ${REG.esc(leg.toSym)}</div>
            <div class="two-step-row"><button type="button" class="btn-primary" data-go>Fazer a etapa 2</button><button type="button" class="btn-soft" data-cancel>Agora não</button></div>`;
        card.prepend(box);
        if (!leg.notified) {
            leg.notified = true; writeLeg(leg);
            window.RdeskFeel?.toast?.(`Etapa 1 pronta: ${amount.toLocaleString('pt-BR')} USDC chegaram. Falta trocar por ${leg.toSym}.`, 'money');
            window.RdeskFeel?.notify?.('Etapa 2 da troca pronta', `Chegaram ${amount.toLocaleString('pt-BR')} USDC. Toque para trocar por ${leg.toSym}.`, 'leg2');
        }
        box.querySelector('[data-go]').onclick = () => {
            document.querySelector('.nav-tab-btn[data-tab="pixswap"]')?.click();
            writeLeg(null); box.remove();
            setSwapForm({ fromChain: leg.fromChain, fromSym: 'USDC', toChain: leg.toChain, toSym: leg.toSym, amount });
        };
        box.querySelector('[data-cancel]').onclick = () => { writeLeg(null); box.remove(); };
    }
    window.addEventListener('rdesk:balancesUpdated', () => { try { checkLeg2(); } catch (e) {} });
    // A etapa 1 só "arma" a etapa 2 depois de enviada de verdade
    function armLeg2IfMatches(q) {
        const leg = readLeg();
        if (!leg || leg.armed) return;
        if (q.toSym === 'USDC' && String(q.toChain) === String(leg.fromChain)) { leg.armed = true; writeLeg(leg); setTimeout(checkLeg2, 500); }
    }

    async function executeActiveSwap() {
        const fb = document.getElementById('swap-feedback');
        const btn = document.getElementById('btn-execute-swap');
        const say = (text, color = 'var(--accent)') => { fb.style.color = color; fb.textContent = text; };
        say('');

        // Garante que a cotação é exatamente a do que está na tela agora
        let q = defiState.swapQuote;
        if (!q || q.key !== swapKey(readSwapForm())) q = await refreshSwapQuote();
        if (!q) { say(document.getElementById('swap-quote-info')?.textContent || 'Informe uma quantidade válida para trocar.', 'var(--red)'); return; }

        const prices = window.RdeskWallet.getPrices();
        const brlIn = q.amountIn * tokenUnitUsd(q.fromChain, q.fromMeta) * prices.USD_BRL;
        const brlOut = q.amountOut * tokenUnitUsd(q.toChain, q.toMeta) * prices.USD_BRL;
        const minOut = q.rawOut.mul(10000 - SWAP_SLIPPAGE_BPS).div(10000);
        const minOutText = parseFloat(ethers.utils.formatUnits(minOut, q.toMeta.decimals)).toLocaleString('pt-BR', { maximumFractionDigits: 6 });
        const impactNote = q.impact !== null && q.impact > IMPACT_WARN ? ` • ATENÇÃO: ${(q.impact * 100).toFixed(1)}% abaixo do mercado` : '';
        const nativeSym = tokensOf(q.fromChain).find((t) => t.isNative)?.symbol || '';

        const confirmed = await window.RdeskReceipt.confirm({
            title: q.fromChain === q.toChain ? 'Confirmar troca' : 'Confirmar envio para outra rede',
            sendVal: `${q.amountIn.toLocaleString('pt-BR', { maximumFractionDigits: 8 })} ${q.fromSym} (${REG.getChain(q.fromChain).name})`,
            sendBrl: brlIn > 0 ? window.RdeskWallet.formatBRL(brlIn) : 'sem cotação',
            recvVal: `~${q.amountOut.toLocaleString('pt-BR', { maximumFractionDigits: 6 })} ${q.toSym} (${REG.getChain(q.toChain).name})`,
            recvBrl: brlOut > 0 ? window.RdeskWallet.formatBRL(brlOut) : 'sem cotação',
            route: q.routeLabel,
            fee: q.serviceBrl !== undefined
                ? `Serviço de troca (${q.tool}): ${window.RdeskWallet.formatBRL(q.serviceBrl)}${REG.creatorFee().active ? ' (inclui a taxa do criador)' : ' • app: R$ 0,00'}`
                : q.creatorFeeRaw ? creatorFeeText(q.creatorFeeBrl) : 'R$ 0,00 (sem taxa do app)',
            gas: q.btcPlan
                ? `${q.btcPlan.fee.toLocaleString('pt-BR')} sat ≈ ${window.RdeskWallet.formatBRL(q.networkBrl)} (rede Bitcoin)`
                : q.networkBrl !== undefined ? `≈ ${window.RdeskWallet.formatBRL(q.networkBrl)} em ${nativeSym} (rede ${REG.getChain(q.fromChain).name})` : `Paga em ${nativeSym} na rede ${REG.getChain(q.fromChain).name}`,
            shield: (q.fromChain === 'btc' || q.toChain === 'btc')
                ? `Mínimo: ${minOutText} ${q.toSym}.${q.toChain === 'btc' ? ` Chega como BTC nativo (rede Bitcoin) no seu endereço ${REG.shortAddress(window.RdeskWallet.getBitcoinAddress(), 8, 6)}.` : ''} Durante ~${q.minutes} min o valor fica com o ${q.tool}; se a troca falhar, ele devolve para você.${impactNote}`
                : `Mínimo garantido: ${minOutText} ${q.toSym} (1,5%)${impactNote}`
        });
        if (!confirmed) return;

        try {
            btn.disabled = true;
            defiState.busy = true;
            if (q.type === 'BTC_OUT') {
                // Sai do Bitcoin: assina a transação conferida e transmite
                say('Assinando a transação Bitcoin…');
                const key = window.RdeskWallet.getBitcoinKeyFor(q.btcAddress);
                if (key.address !== q.btcAddress) throw new Error('Erro interno: a chave não confere com o endereço Bitcoin.');
                const signed = window.RdeskBitcoin.signTransaction(q.btcPlan, key.privateKey);
                const txid = await window.RdeskBitcoin.broadcast(signed.hex);
                defiState.swapQuote = null;
                armLeg2IfMatches(q);
                window.dispatchEvent(new CustomEvent('rdesk:success', { detail: { text: 'Bitcoin enviado para a troca!' } }));
                fb.style.color = 'var(--green-bright)';
                fb.innerHTML = `✓ Bitcoin enviado ao ${REG.esc(q.tool)}. ${REG.esc(q.toSym)} chega na ${REG.esc(REG.getChain(q.toChain).name)} em cerca de ${q.minutes} min. <a href="https://mempool.space/tx/${REG.esc(txid)}" target="_blank" rel="noopener noreferrer">Acompanhar ↗</a>`;
                window.RdeskWallet.refreshBalances().then(updateSwapFromBalanceDisplay).catch(() => {});
                return;
            }
            const signer = await window.RdeskWallet.getSigner(q.fromChain);
            const owner = await signer.getAddress();

            if (q.type === 'WRAP_UNWRAP') {
                const wpol = new ethers.Contract(ADDR_WPOL, ['function deposit() payable', 'function withdraw(uint256 wad)'], signer);
                say('Assinando conversão 1:1...');
                const tx = q.fromSym === 'POL' ? await wpol.deposit({ value: q.rawIn }) : await wpol.withdraw(q.rawIn);
                await window.RdeskWallet.confirmTx(tx, POLYGON_ID);
            } else if (q.type === 'UNISWAP_V3') {
                const payWithNative = Boolean(q.fromMeta.isNative);
                const receiveNative = Boolean(q.toMeta.isNative);
                const wpolRead = new ethers.Contract(ADDR_WPOL, ['function balanceOf(address) view returns (uint256)', 'function withdraw(uint256 wad)'], signer);
                const wpolBefore = receiveNative ? await wpolRead.balanceOf(owner) : ethers.constants.Zero;

                if (!payWithNative) {
                    say(`Aprovando exatamente ${q.amountIn} ${q.fromSym}...`);
                    await ensureExactErc20Approval(q.hops[0].tokenIn, SWAP_ROUTER_02, q.rawIn, signer);
                }
                say('Executando troca na Uniswap V3...');
                const router = new ethers.Contract(SWAP_ROUTER_02, ROUTER_ABI, signer);
                const overrides = payWithNative ? { value: q.rawIn } : {};
                let txSwap;
                let method, args;
                if (q.hops.length === 1) {
                    method = 'exactInputSingle';
                    args = [{ tokenIn: q.hops[0].tokenIn, tokenOut: q.hops[0].tokenOut, fee: q.hops[0].fee, recipient: owner, amountIn: q.rawIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0 }];
                } else {
                    const path = ethers.utils.solidityPack(['address', 'uint24', 'address', 'uint24', 'address'],
                        [q.hops[0].tokenIn, q.hops[0].fee, q.hops[0].tokenOut, q.hops[1].fee, q.hops[1].tokenOut]);
                    method = 'exactInput';
                    args = [{ path, recipient: owner, amountIn: q.rawIn, amountOutMinimum: minOut }];
                }
                overrides.gasLimit = await gasLimitFor(router, method, args, overrides, POLYGON_ID);
                txSwap = await router[method](...args, overrides);
                await window.RdeskWallet.confirmTx(txSwap, POLYGON_ID);

                if (q.creatorFeeRaw && q.creatorFeeRaw.gt(0)) {
                    say('Enviando a taxa do criador…');
                    try { await payCreatorFee(signer, POLYGON_ID, q.fromMeta, q.creatorFeeRaw); } catch (e) { console.warn('taxa do criador não enviada', e); }
                }
                if (receiveNative) {
                    // O router entrega WPOL: converte o que chegou em POL nativo.
                    say('Convertendo WPOL recebido em POL...');
                    const got = (await wpolRead.balanceOf(owner)).sub(wpolBefore);
                    if (got.gt(0)) {
                        const txUnwrap = await wpolRead.withdraw(got);
                        await window.RdeskWallet.confirmTx(txUnwrap, POLYGON_ID);
                    }
                }
            } else if (q.type === 'LIFI') {
                if (q.preview) {
                    // Agora sim, com o seu endereço: refaz a cotação e só segue se o preço não piorou
                    say('Confirmando a rota com o seu endereço…');
                    const p2 = new URLSearchParams(q.lifiParams);
                    p2.set('fromAddress', owner);
                    p2.set('toAddress', q.toChain === 'btc' ? window.RdeskWallet.getBitcoinAddress() : owner);
                    const r2 = await withTimeout(fetch(`https://li.quest/v1/quote?${p2}`), 30000);
                    const d2 = await r2.json();
                    if (!r2.ok || !d2?.estimate?.toAmount) throw new Error('A rota não está mais disponível. Peça a cotação de novo.');
                    if (ethers.BigNumber.from(d2.estimate.toAmount).lt(q.rawOut.mul(97).div(100))) throw new Error('O preço piorou desde a cotação. Revise a troca de novo.');
                    q.lifiData = d2;
                    q.preview = false;
                }
                const txReq = q.lifiData?.transactionRequest;
                if (!txReq || !txReq.to || !txReq.data) throw new Error('A rota não devolveu uma transação válida. Peça a cotação de novo.');
                checkLifiQuote(q.lifiData, { fromChain: q.fromChain, rawIn: q.rawIn, fromAddress: owner, toAddress: q.toChain === 'btc' ? window.RdeskWallet.getBitcoinAddress() : owner,
                    fromNative: Boolean(q.fromMeta.isNative), amountUsd: q.amountIn * tokenUnitUsd(q.fromChain, q.fromMeta) });
                if (!q.fromMeta.isNative) {
                    const spender = q.lifiData.estimate?.approvalAddress;
                    if (!spender) throw new Error('A rota não informou o contrato a aprovar. Operação cancelada.');
                    say(`Aprovando exatamente ${q.amountIn} ${q.fromSym}...`);
                    await ensureExactErc20Approval(q.fromMeta.address, spender, q.rawIn, signer, q.fromChain);
                }
                say('Enviando a transação...');
                const tx = await signer.sendTransaction({ to: txReq.to, data: txReq.data, value: txReq.value ? ethers.BigNumber.from(txReq.value) : 0 });
                await window.RdeskWallet.confirmTx(tx, q.fromChain);
            }

            defiState.swapQuote = null;
            armLeg2IfMatches(q);
            window.dispatchEvent(new CustomEvent('rdesk:success', { detail: { text: q.fromChain === q.toChain ? 'Troca concluída!' : 'Ponte enviada!' } }));
            say(q.fromChain === q.toChain
                ? `✓ Troca de ${q.amountIn} ${q.fromSym} por ${q.toSym} concluída!`
                : `✓ Enviado: ${q.toSym} chega na ${REG.getChain(q.toChain).name} em ${q.minutes ? `cerca de ${q.minutes} min` : 'alguns minutos'}.`, 'var(--green-bright)');
            await window.RdeskWallet.refreshBalances();
            updateSwapFromBalanceDisplay();
        } catch (err) {
            say(window.RdeskWallet.friendlyTxError(err, { native: nativeSym }), 'var(--red)');
            // Mesmo com erro de comunicação, a troca pode ter acontecido: atualiza os saldos para conferir
            window.RdeskWallet.refreshBalances().then(updateSwapFromBalanceDisplay).catch(() => {});
        } finally {
            btn.disabled = false;
            defiState.busy = false;
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
        const buyBrl = REG.parseBRL(document.getElementById('pix-buy-brl')?.value) || 0;
        const buySym = document.getElementById('pix-buy-token')?.value || 'USDT';
        const buyContainer = document.getElementById('pix-buy-routes');

        if (buyContainer) {
            buyContainer.replaceChildren();
            let unitBrl = usdBrl;
            if (buySym === 'POL') unitBrl = (prices.POL || 0.088) * usdBrl;
            else if (buySym === 'BRZ' || buySym === 'BRLA' || buySym === 'BRLS') unitBrl = 1.0;

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
        const sellAmt = parseFloat(String(document.getElementById('pix-sell-amount')?.value || '').replace(',', '.')) || 0;
        const sellContainer = document.getElementById('pix-sell-routes');

        if (sellContainer) {
            sellContainer.replaceChildren();
            let unitBrl = usdBrl;
            if (sellSym === 'POL' || sellSym === 'WPOL') unitBrl = (prices.POL || 0.088) * usdBrl;
            else if (sellSym === 'BRZ' || sellSym === 'BRLA' || sellSym === 'BRLS') unitBrl = 1.0;

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
    // Falha de rede na auditoria vira um aviso na tela, nunca um erro solto.
    // O histórico, o extrato e o resultado ficam em history.js (RdeskHistory)
    function runAuditSafely(forceRefresh = false) {
        return window.RdeskHistory ? window.RdeskHistory.load(forceRefresh) : Promise.resolve();
    }


    // =========================================================================
    // VINCULAÇÃO DE EVENTOS & API GLOBAL
    // =========================================================================
    function bindDefiAndPixEvents() {
        // Tela 2: Render V3
        document.getElementById('earn-target-brl-min')?.addEventListener('input', recalculateSniperRange);
        ['calc-target', 'calc-have'].forEach((id) => document.getElementById(id)?.addEventListener('input', renderEarnCalc));
        document.getElementById('calc-period')?.addEventListener('change', renderEarnCalc);
        document.getElementById('btn-earn-reset-sniper')?.addEventListener('click', () => {
            const inp = document.getElementById('earn-target-brl-min');
            if (inp) inp.value = '';
            defiState.customRange = null;
            recalculateSniperRange();
        });
        ['earn-range-min', 'earn-range-max'].forEach((id) => {
            document.getElementById(id)?.addEventListener('change', () => {
                const mn = parseFloat(String(document.getElementById('earn-range-min').value).replace(',', '.'));
                const mx = parseFloat(String(document.getElementById('earn-range-max').value).replace(',', '.'));
                if (mn > 0 && mx > mn) { setCustomRange(mn, mx, 'digitada'); return; }
                // Ainda incompleto (ex.: digitou o mínimo novo antes do máximo): não apaga o que a pessoa digitou
                const modeEl = document.getElementById('earn-range-mode');
                if (modeEl) { modeEl.textContent = 'O mínimo precisa ser menor que o máximo.'; modeEl.classList.add('warn'); }
            });
        });
        document.querySelectorAll('[data-range-width]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const spot = currentSpotPrice();
                const pct = Number(btn.getAttribute('data-range-width')) / 100;
                if (spot > 0 && pct > 0) setCustomRange(spot * (1 - pct / 2), spot * (1 + pct / 2), 'atalho');
            });
        });
        document.getElementById('btn-chart-reset-view')?.addEventListener('click', () => rangeChart?.resetView());
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

        populateSwapSelects();
        // Moeda adicionada ou removida pelo usuário: refaz as listas da troca
        let swapTokenSignature = '';
        window.addEventListener('rdesk:walletChanged', () => {
            const sig = REG.loadCustomTokens().map((t) => `${t.chainId}:${t.address}`).join('|');
            if (sig !== swapTokenSignature) { swapTokenSignature = sig; populateSwapSelects(); }
        });
        ['swap-from-chain', 'swap-to-chain'].forEach((id) => {
            document.getElementById(id)?.addEventListener('change', () => { populateSwapSelects(); triggerSwapQuote(); });
        });
        ['swap-from-token', 'swap-to-token'].forEach((id) => {
            document.getElementById(id)?.addEventListener('change', () => { renderSwapContracts(); triggerSwapQuote(); });
        });
        document.getElementById('swap-amount-in')?.addEventListener('input', () => { syncSwapBrl(); triggerSwapQuote(); });
        // Digitar em reais: converte para a quantidade da moeda escolhida e cota
        document.getElementById('swap-amount-brl')?.addEventListener('input', () => {
            const f = readSwapForm();
            const meta = getTokenMeta(f.fromChain, f.fromSym);
            const brl = REG.parseBRL(document.getElementById('swap-amount-brl').value);
            const coin = meta ? REG.coinFromBrl(brl, tokenUnitUsd(f.fromChain, meta), window.RdeskWallet.getPrices().USD_BRL, meta.decimals) : '';
            document.getElementById('swap-amount-in').value = coin;
            triggerSwapQuote();
        });
        ['swap-from-token', 'swap-from-chain'].forEach((id) => document.getElementById(id)?.addEventListener('change', updateSwapFromBalanceDisplay));

        document.getElementById('btn-swap-max')?.addEventListener('click', () => {
            const f = readSwapForm();
            const found = window.RdeskWallet.getBalances().find((b) => b.chainId === f.fromChain && b.symbol === f.fromSym);
            let avail = found ? found.amount : 0;
            const meta = getTokenMeta(f.fromChain, f.fromSym);
            if (meta?.isNative && f.fromChain !== 'btc') avail = Math.max(0, avail - (NATIVE_RESERVE[f.fromSym] || 0)); // deixa moeda nativa para as taxas
            if (f.fromChain === 'btc') avail = Math.max(0, avail - 0.00003); // folga para a taxa da rede Bitcoin
            const step = f.fromChain === 'btc' ? 1e8 : 1e6;
            document.getElementById('swap-amount-in').value = avail > 0 ? String(Math.floor(avail * step) / step) : '0';
            syncSwapBrl();
            refreshSwapQuote();
        });

        // Inverter: o que eu recebia passa a ser o que envio (rede, moeda e quantidade)
        document.getElementById('btn-swap-flip')?.addEventListener('click', () => {
            const e = swapEls();
            const prev = { fc: e.fc.value, ft: e.ft.value, tc: e.tc.value, tt: e.tt.value, out: parseFloat(String(e.out.value).replace(',', '.')) };
            e.fc.value = prev.tc; e.tc.value = prev.fc;
            fillTokenSelect(e.ft, chainOfValue(prev.tc), prev.tt);
            fillTokenSelect(e.tt, chainOfValue(prev.fc), prev.ft);
            syncSwapBrl();
            if (prev.out > 0) e.amt.value = String(prev.out);
            renderSwapContracts();
            refreshSwapQuote();
        });

        document.getElementById('btn-execute-swap')?.addEventListener('click', executeActiveSwap);

        // Sincroniza sempre que a carteira atualizar saldos
        window.addEventListener('rdesk:wallet-updated', async () => {
            recalculateSniperRange();
            recalculatePixComparator();
            updateSwapFromBalanceDisplay();
            await refreshUniswapPositions();
        });
    }

    window.RdeskDefi = {
        _earn: { earnModel, renderEarnCalc, liquidityPerUsd, state: () => defiState },
        _twoStep: { twoStepPlan, readLeg, checkLeg2, setSwapForm, armLeg2IfMatches },
        refreshPoolAndPositions: async () => {
            await loadPoolCandlesAndComputeSniper();
            await refreshUniswapPositions();
        },
        setCustomRange: (min, max) => setCustomRange(min, max, 'api'),
        useSuggestedRange: () => { defiState.customRange = null; recalculateSniperRange(); },
        refreshPixAndSwap: () => {
            recalculatePixComparator();
            refreshSwapQuote();
        },
        runAudit: (force = false) => runAuditSafely(force),
        getLivePositionsUsd: () => defiState.livePositions.reduce((s, p) => s + (p.totalUsd || 0), 0),
        // Já leu as posições da carteira atual na rede? (antes disso, "zero posições" não quer dizer nada)
        positionsKnownFor: (addr) => Boolean(defiState.positionsReadFor) && defiState.positionsReadFor === String(addr || '').toLowerCase(),
        isBusy: () => Boolean(defiState.busy),
        refreshSwapQuote: () => refreshSwapQuote(),
        getSwapQuote: () => defiState.swapQuote ? { type: defiState.swapQuote.type, amountOut: defiState.swapQuote.amountOut, routeLabel: defiState.swapQuote.routeLabel, impact: defiState.swapQuote.impact, hops: defiState.swapQuote.hops || null } : null,
        populateSwapSelects: () => populateSwapSelects(),
        onPricesUpdated: () => { try { redrawChartRangeLines(); updateSwapFromBalanceDisplay(); } catch (e) {} },
        getState: () => ({
            sniper: { ...defiState.sniper },
            customRange: defiState.customRange ? { ...defiState.customRange } : null,
            suggested: defiState.suggested ? { ...defiState.suggested } : null,
            chart: rangeChart ? rangeChart.getState() : null,
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
