/* =========================================================================
   RDESK SENTINEL — MOTOR UNISWAP V3, PIX LÍQUIDO, CROSS-CHAIN & UI APP
   Arquivo 5 de 7: sentinel-engine.js
   Expõe: window.RdeskSentinel e window.RdeskDefi (compatibilidade total)
   ========================================================================= */

(function (global) {
    'use strict';

    // =========================================================================
    // 1. CONTRATOS E ENDEREÇOS OFICIAIS (POLYGON MAINNET — CHAIN ID 137)
    // =========================================================================
    const POLYGON_CONTRACTS = {
        NFT_POSITION_MANAGER: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
        SWAP_ROUTER_02:       '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        FACTORY_V3:           '0x1F98431c8aD98523631AE4a59f267346ea31F984',
        POOL_WPOL_USDT0_005:  '0x9B08288C3Be4F62bbf8d1C20Ac9C5e6f9467d8B7'
    };

    const TOKENS_POLYGON = {
        POL:   { symbol: 'POL',   address: null,                                         decimals: 18, isNative: true },
        WPOL:  { symbol: 'WPOL',  address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', decimals: 18, isNative: false },
        USDT0: { symbol: 'USDT0', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6,  isNative: false },
        USDC:  { symbol: 'USDC',  address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6,  isNative: false },
        BRZ:   { symbol: 'BRZ',   address: '0x4eD141110F6EeeAbA9A1df36d8c26f684d2475Dc', decimals: 18, isNative: false },
        BRLA:  { symbol: 'BRLA',  address: '0xE6A537a407488807F0bbeb0038B79004f19DDDFb', decimals: 18, isNative: false }
    };

    const ADDRESS_TO_SYMBOL = {
        '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 'WPOL',
        '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 'USDT0',
        '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': 'USDC',
        '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 'USDC.e',
        '0x4ed141110f6eeeaba9a1df36d8c26f684d2475dc': 'BRZ',
        '0xe6a537a407488807f0bbeb0038b79004f19dddfb': 'BRLA'
    };

    const MAX_UINT128 = ethers.BigNumber.from('340282366920938463463374607431768211455');
    const Q96 = Math.pow(2, 96);

    const ERC20_ABI = [
        'function balanceOf(address) view returns (uint256)',
        'function allowance(address owner, address spender) view returns (uint256)',
        'function approve(address spender, uint256 amount) returns (bool)',
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)'
    ];

    const WPOL_ABI = [
        'function deposit() payable',
        'function withdraw(uint256 wad)',
        'function balanceOf(address) view returns (uint256)',
        'function approve(address spender, uint256 amount) returns (bool)'
    ];

    const POOL_V3_ABI = [
        'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
        'function token0() view returns (address)',
        'function token1() view returns (address)',
        'function fee() view returns (uint24)',
        'function liquidity() view returns (uint128)'
    ];

    const FACTORY_V3_ABI = [
        'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)'
    ];

    const NFT_MANAGER_ABI = [
        'function balanceOf(address owner) view returns (uint256)',
        'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
        'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
        'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
        'function increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)',
        'function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) payable returns (uint256 amount0, uint256 amount1)',
        'function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) payable returns (uint256 amount0, uint256 amount1)',
        'function burn(uint256 tokenId) payable',
        'function multicall(bytes[] data) payable returns (bytes[] results)'
    ];

    const SWAP_ROUTER_ABI = [
        'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)'
    ];

    const COST_BASIS_STORAGE_KEY = 'rdesk_v22_pool_cost_basis';

    let _engineState = {
        positions: [],
        totalPoolsUsd: 0,
        totalPoolsBrl: 0,
        totalFeesUsd: 0,
        totalFeesBrl: 0,
        livePoolPrice: 0,
        currentTick: 0,
        isLoadingPools: false,
        lastSwapQuote: null
    };

    function getVaultBridge() {
        return global.RdeskVault || global.RdeskWallet || null;
    }

    function getLedgerBridge() {
        return global.RdeskLedger || null;
    }

    // =========================================================================
    // 2. MATEMÁTICA DE CONCENTRAÇÃO UNISWAP V3 (TICKS, SQRTPRICE & AMOUNTS)
    // =========================================================================
    function tickToSqrtRatioX96(tick) {
        const sqrtPrice = Math.pow(1.0001, tick / 2);
        return sqrtPrice * Q96;
    }

    function tickToHumanPrice(tick, dec0, dec1, invert = false) {
        const rawPrice = Math.pow(1.0001, tick) * Math.pow(10, dec0 - dec1);
        if (!invert) return rawPrice;
        return rawPrice > 0 ? 1 / rawPrice : 0;
    }

    function priceToNearestTick(humanPrice, dec0, dec1, tickSpacing, invert = false) {
        const targetRaw = invert ? (humanPrice > 0 ? 1 / humanPrice : 0) : humanPrice;
        if (targetRaw <= 0) return 0;
        const adjusted = targetRaw / Math.pow(10, dec0 - dec1);
        const exactTick = Math.log(adjusted) / Math.log(1.0001);
        return Math.round(exactTick / tickSpacing) * tickSpacing;
    }

    function getAmountsForLiquidity(sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, liquidityStr) {
        const L = parseFloat(liquidityStr || '0');
        if (L <= 0) return { amount0Raw: 0, amount1Raw: 0 };

        let sa = sqrtRatioAX96;
        let sb = sqrtRatioBX96;
        if (sa > sb) [sa, sb] = [sb, sa];

        const sp = sqrtPriceX96;
        let amount0 = 0;
        let amount1 = 0;

        if (sp <= sa) {
            amount0 = L * Q96 * (sb - sa) / (sa * sb);
        } else if (sp < sb) {
            amount0 = L * Q96 * (sb - sp) / (sp * sb);
            amount1 = L * (sp - sa) / Q96;
        } else {
            amount1 = L * (sb - sa) / Q96;
        }

        return { amount0Raw: Math.max(0, amount0), amount1Raw: Math.max(0, amount1) };
    }

    function readCostBasisMap() {
        try {
            return JSON.parse(localStorage.getItem(COST_BASIS_STORAGE_KEY) || '{}');
        } catch (e) {
            return {};
        }
    }

    function saveCostBasisEntry(tokenId, usdValue, brlValue) {
        try {
            const map = readCostBasisMap();
            const key = String(tokenId);
            const prev = map[key] || { usd: 0, brl: 0 };
            map[key] = {
                usd: prev.usd + Number(usdValue || 0),
                brl: prev.brl + Number(brlValue || 0),
                updatedAt: Date.now()
            };
            localStorage.setItem(COST_BASIS_STORAGE_KEY, JSON.stringify(map));
        } catch (e) {}
    }

    // =========================================================================
    // 3. LEITURA REAL DAS POSIÇÕES NFT UNISWAP V3 NA POLYGON
    // =========================================================================
    async function refreshPoolAndPositions() {
        const vault = getVaultBridge();
        const addr = vault?.getAddress?.() || '';
        const prices = vault?.getPrices ? vault.getPrices() : { usdBrl: 5.65, polUsd: 0.088 };
        const provider = vault?.getReadProvider ? vault.getReadProvider(137) : new ethers.providers.JsonRpcProvider('https://polygon-bor-rpc.publicnode.com');

        _engineState.isLoadingPools = true;
        renderPoolsDom();

        try {
            // Lê preço ao vivo da pool principal WPOL/USDT0 (0.05%)
            const mainPool = new ethers.Contract(POLYGON_CONTRACTS.POOL_WPOL_USDT0_005, POOL_V3_ABI, provider);
            const [slot0Main, t0Main] = await Promise.all([mainPool.slot0(), mainPool.token0()]);
            const isWpolToken0Main = t0Main.toLowerCase() === TOKENS_POLYGON.WPOL.address.toLowerCase();
            const livePolUsdt = isWpolToken0Main
                ? tickToHumanPrice(slot0Main.tick, 18, 6, false)
                : tickToHumanPrice(slot0Main.tick, 6, 18, true);

            _engineState.livePoolPrice = livePolUsdt > 0 ? livePolUsdt : prices.polUsd;
            _engineState.currentTick = slot0Main.tick;

            const poolPriceEl = document.getElementById('pool-live-price');
            if (poolPriceEl) {
                poolPriceEl.textContent = `1 WPOL = $${_engineState.livePoolPrice.toFixed(5)} (R$ ${(_engineState.livePoolPrice * prices.usdBrl).toFixed(4)})`;
            }

            if (!addr || !ethers.utils.isAddress(addr)) {
                _engineState.positions = [];
                _engineState.totalPoolsUsd = 0;
                _engineState.totalPoolsBrl = 0;
                _engineState.totalFeesUsd = 0;
                _engineState.totalFeesBrl = 0;
                _engineState.isLoadingPools = false;
                renderPoolsDom();
                return;
            }

            const nftManager = new ethers.Contract(POLYGON_CONTRACTS.NFT_POSITION_MANAGER, NFT_MANAGER_ABI, provider);
            const factory = new ethers.Contract(POLYGON_CONTRACTS.FACTORY_V3, FACTORY_V3_ABI, provider);
            const nftCountBn = await nftManager.balanceOf(addr);
            const nftCount = Math.min(25, nftCountBn.toNumber());

            const costBasisMap = readCostBasisMap();
            const loadedPositions = [];
            let sumPoolsUsd = 0;
            let sumFeesUsd = 0;

            for (let i = 0; i < nftCount; i++) {
                try {
                    const tokenId = await nftManager.tokenOfOwnerByIndex(addr, i);
                    const pos = await nftManager.positions(tokenId);
                    const hasLiq = pos.liquidity.gt(0);
                    const hasOwed = pos.tokensOwed0.gt(0) || pos.tokensOwed1.gt(0);
                    if (!hasLiq && !hasOwed) continue;

                    const t0Addr = pos.token0.toLowerCase();
                    const t1Addr = pos.token1.toLowerCase();
                    const sym0 = ADDRESS_TO_SYMBOL[t0Addr] || 'TOKEN0';
                    const sym1 = ADDRESS_TO_SYMBOL[t1Addr] || 'TOKEN1';

                    const c0 = new ethers.Contract(pos.token0, ERC20_ABI, provider);
                    const c1 = new ethers.Contract(pos.token1, ERC20_ABI, provider);
                    const [dec0, dec1, poolAddr] = await Promise.all([
                        c0.decimals().catch(() => 18),
                        c1.decimals().catch(() => 6),
                        factory.getPool(pos.token0, pos.token1, pos.fee)
                    ]);

                    const poolContract = new ethers.Contract(poolAddr, POOL_V3_ABI, provider);
                    const slot0 = await poolContract.slot0();

                    // Consulta tarifas acumuladas não colhidas via callStatic.collect
                    let unclaimed0 = parseFloat(ethers.utils.formatUnits(pos.tokensOwed0, dec0));
                    let unclaimed1 = parseFloat(ethers.utils.formatUnits(pos.tokensOwed1, dec1));
                    try {
                        const simCollect = await nftManager.callStatic.collect({
                            tokenId,
                            recipient: addr,
                            amount0Max: MAX_UINT128,
                            amount1Max: MAX_UINT128
                        }, { from: addr });
                        unclaimed0 = parseFloat(ethers.utils.formatUnits(simCollect.amount0, dec0));
                        unclaimed1 = parseFloat(ethers.utils.formatUnits(simCollect.amount1, dec1));
                    } catch (e) {}

                    const sqrtP = Number(slot0.sqrtPriceX96.toString());
                    const sqrtA = tickToSqrtRatioX96(pos.tickLower);
                    const sqrtB = tickToSqrtRatioX96(pos.tickUpper);
                    const { amount0Raw, amount1Raw } = getAmountsForLiquidity(sqrtP, sqrtA, sqrtB, pos.liquidity.toString());

                    const amt0 = amount0Raw / Math.pow(10, dec0);
                    const amt1 = amount1Raw / Math.pow(10, dec1);

                    const p0Usd = prices[sym0] || (sym0 === 'WPOL' ? _engineState.livePoolPrice : 1);
                    const p1Usd = prices[sym1] || (sym1 === 'WPOL' ? _engineState.livePoolPrice : 1);

                    const posUsd = (amt0 * p0Usd) + (amt1 * p1Usd);
                    const feesUsd = (unclaimed0 * p0Usd) + (unclaimed1 * p1Usd);

                    sumPoolsUsd += posUsd + feesUsd;
                    sumFeesUsd += feesUsd;

                    // Normaliza exibição de preço (sempre WPOL em USDT0 se for o par WPOL/USDT0)
                    const invertDisplay = (sym1 === 'WPOL');
                    const curPrice = tickToHumanPrice(slot0.tick, dec0, dec1, invertDisplay);
                    let minPrice = tickToHumanPrice(pos.tickLower, dec0, dec1, invertDisplay);
                    let maxPrice = tickToHumanPrice(pos.tickUpper, dec0, dec1, invertDisplay);
                    if (minPrice > maxPrice) [minPrice, maxPrice] = [maxPrice, minPrice];

                    const savedCost = costBasisMap[tokenId.toString()];
                    const initialCapitalBrl = savedCost ? savedCost.brl : (posUsd * prices.usdBrl);

                    const ledger = getLedgerBridge();
                    const analysis = ledger?.analyzePositionBreakEven
                        ? ledger.analyzePositionBreakEven({
                            minPrice,
                            maxPrice,
                            currentPrice: curPrice,
                            currentPosUsd: posUsd,
                            unclaimedFeesUsd: feesUsd,
                            initialCapitalBrl,
                            polPriceUsd: _engineState.livePoolPrice,
                            usdBrlRate: prices.usdBrl
                        })
                        : {
                            rangeText: `${minPrice.toFixed(5)} até ${maxPrice.toFixed(5)}`,
                            rangePct: 50,
                            isOutOfRange: curPrice < minPrice || curPrice > maxPrice,
                            shouldSuggestRebalance: false,
                            isNetProfitable: feesUsd > 0.05,
                            statusBadge: 'ATIVA',
                            profitExplanation: `Tarifas acumuladas: $${feesUsd.toFixed(4)}`,
                            rebalancePrompt: ''
                        };

                    loadedPositions.push({
                        tokenId: tokenId.toString(),
                        pairLabel: invertDisplay ? `${sym1}/${sym0}` : `${sym0}/${sym1}`,
                        feeTier: pos.fee,
                        feePct: (pos.fee / 10000).toFixed(2) + '%',
                        token0: pos.token0,
                        token1: pos.token1,
                        sym0,
                        sym1,
                        dec0,
                        dec1,
                        tickLower: pos.tickLower,
                        tickUpper: pos.tickUpper,
                        liquidity: pos.liquidity.toString(),
                        amt0,
                        amt1,
                        unclaimed0,
                        unclaimed1,
                        posUsd,
                        posBrl: posUsd * prices.usdBrl,
                        feesUsd,
                        feesBrl: feesUsd * prices.usdBrl,
                        curPrice,
                        minPrice,
                        maxPrice,
                        analysis
                    });
                } catch (e) {}
            }

            _engineState.positions = loadedPositions;
            _engineState.totalPoolsUsd = sumPoolsUsd;
            _engineState.totalPoolsBrl = sumPoolsUsd * prices.usdBrl;
            _engineState.totalFeesUsd = sumFeesUsd;
            _engineState.totalFeesBrl = sumFeesUsd * prices.usdBrl;

            // Atualiza total alocado nas pools no Hero da Carteira e no Auditor Forense
            const heroPoolEl = document.getElementById('hero-pools-brl');
            if (heroPoolEl) {
                heroPoolEl.textContent = `Em Pools V3: ${_engineState.totalPoolsBrl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
            }

            const bals = vault?.getBalances ? vault.getBalances() : { totalBrl: 0, totalUsd: 0 };
            const grandTotalBrl = (bals.totalBrl || 0) + _engineState.totalPoolsBrl;
            const grandTotalUsd = (bals.totalUsd || 0) + _engineState.totalPoolsUsd;

            const totalBrlEl = document.getElementById('hero-total-brl');
            const totalUsdEl = document.getElementById('hero-total-usd');
            if (totalBrlEl && grandTotalBrl > 0) {
                totalBrlEl.textContent = grandTotalBrl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            }
            if (totalUsdEl && grandTotalUsd > 0) {
                totalUsdEl.textContent = `$ ${grandTotalUsd.toFixed(2)} • Cotação Dólar: R$ ${prices.usdBrl.toFixed(3)}`;
            }

            const ledger = getLedgerBridge();
            if (ledger?.recalculateLedgerMetrics) {
                ledger.recalculateLedgerMetrics(_engineState.totalPoolsBrl, _engineState.totalPoolsUsd);
            }
        } catch (err) {
            console.warn('[Sentinel] Erro ao ler posições V3:', err);
        } finally {
            _engineState.isLoadingPools = false;
            renderPoolsDom();
        }
    }

    function renderPoolsDom() {
        const container = document.getElementById('pools-positions-list');
        if (!container) return;

        if (_engineState.isLoadingPools) {
            container.innerHTML = `<div style="text-align:center;color:#94a3b8;padding:18px;font-size:0.86rem;">⏳ Sincronizando NFTs Uniswap V3 na Polygon...</div>`;
            return;
        }

        if (!_engineState.positions.length) {
            container.innerHTML = `
                <div style="text-align:center;padding:22px 14px;background:rgba(255,255,255,0.02);border:1px dashed rgba(255,255,255,0.12);border-radius:14px;">
                    <div style="font-size:0.94rem;font-weight:700;color:#e2e8f0;">Nenhuma Pool V3 ativa nesta carteira</div>
                    <div style="font-size:0.8rem;color:#94a3b8;margin-top:4px;">Use o painel acima para criar uma nova posição concentrada WPOL/USDT0 com 1 clique.</div>
                </div>
            `;
            return;
        }

        container.innerHTML = _engineState.positions.map((p) => {
            const a = p.analysis;
            const badgeColor = a.isOutOfRange ? '#f87171' : (a.isNetProfitable ? '#00e676' : '#eab308');
            const badgeBg = a.isOutOfRange ? 'rgba(239,68,68,0.16)' : (a.isNetProfitable ? 'rgba(0,230,118,0.14)' : 'rgba(234,179,8,0.15)');
            const clampedPct = Math.max(0, Math.min(100, a.rangePct || 50));

            return `
                <div class="pool-pos-card" style="background:#141923;border:1px solid rgba(255,255,255,0.09);border-radius:16px;padding:15px;margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
                        <div>
                            <span style="font-weight:800;font-size:1rem;color:#fff;">${p.pairLabel}</span>
                            <span style="font-size:0.74rem;color:#94a3b8;margin-left:6px;">Taxa ${p.feePct} • NFT #${p.tokenId}</span>
                        </div>
                        <span style="font-size:0.7rem;font-weight:800;padding:3px 9px;border-radius:999px;background:${badgeBg};color:${badgeColor};">
                            ${a.statusBadge}
                        </span>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;background:rgba(0,0,0,0.28);padding:10px;border-radius:12px;margin-bottom:10px;">
                        <div>
                            <div style="font-size:0.72rem;color:#94a3b8;">Liquidez na Pool</div>
                            <div style="font-weight:800;font-size:0.96rem;color:#fff;">R$ ${p.posBrl.toFixed(2)}</div>
                            <div style="font-size:0.72rem;color:#cbd5e1;">${p.amt0.toFixed(3)} ${p.sym0} + ${p.amt1.toFixed(3)} ${p.sym1}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:0.72rem;color:#94a3b8;">Tarifas Não Colhidas</div>
                            <div style="font-weight:800;font-size:0.96rem;color:#00e676;">+R$ ${p.feesBrl.toFixed(2)}</div>
                            <div style="font-size:0.72rem;color:#cbd5e1;">$${p.feesUsd.toFixed(4)}</div>
                        </div>
                    </div>

                    <div style="margin-bottom:10px;">
                        <div style="display:flex;justify-content:space-between;font-size:0.74rem;color:#94a3b8;margin-bottom:4px;">
                            <span>Mín: ${p.minPrice.toFixed(5)}</span>
                            <span style="color:#fff;font-weight:700;">Atual: ${p.curPrice.toFixed(5)}</span>
                            <span>Máx: ${p.maxPrice.toFixed(5)}</span>
                        </div>
                        <div style="height:6px;background:#090b10;border-radius:999px;position:relative;overflow:hidden;">
                            <div style="position:absolute;left:0;top:0;bottom:0;width:${clampedPct}%;background:${a.isOutOfRange ? '#ef4444' : '#00e676'};"></div>
                        </div>
                    </div>

                    <div style="font-size:0.78rem;color:#cbd5e1;background:rgba(255,255,255,0.03);padding:9px;border-radius:10px;margin-bottom:10px;line-height:1.4;">
                        ${a.profitExplanation}
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;">
                        <button type="button" class="btn-secondary" data-collect-nft="${p.tokenId}" style="padding:8px 6px;font-size:0.78rem;">💰 Colher Taxas</button>
                        <button type="button" class="btn-secondary" data-rebalance-nft="${p.tokenId}" style="padding:8px 6px;font-size:0.78rem;border-color:rgba(234,179,8,0.45);color:#fde047;">⚖️ Rebalancear</button>
                        <button type="button" class="btn-secondary" data-close-nft="${p.tokenId}" style="padding:8px 6px;font-size:0.78rem;border-color:rgba(239,68,68,0.4);color:#fca5a5;">✕ Fechar Pool</button>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('[data-collect-nft]').forEach((btn) => {
            btn.onclick = () => collectPositionFees(btn.getAttribute('data-collect-nft'));
        });
        container.querySelectorAll('[data-rebalance-nft]').forEach((btn) => {
            btn.onclick = () => rebalancePositionAtomic(btn.getAttribute('data-rebalance-nft'));
        });
        container.querySelectorAll('[data-close-nft]').forEach((btn) => {
            btn.onclick = () => closeAndBurnPosition(btn.getAttribute('data-close-nft'));
        });
    }

    // =========================================================================
    // 4. EXECUÇÃO DE OPERAÇÕES UNISWAP V3 (MINT, COLLECT, CLOSE & REBALANCE)
    // =========================================================================
    async function ensureTokenApproval(tokenAddress, spender, amountWei, signer) {
        const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
        const owner = await signer.getAddress();
        const current = await erc20.allowance(owner, spender);
        if (current.lt(amountWei)) {
            const tx = await erc20.approve(spender, ethers.constants.MaxUint256);
            await tx.wait();
        }
    }

    function showPoolStatusToast(msg, isError = false) {
        const box = document.getElementById('pool-action-status');
        if (box) {
            box.style.display = 'block';
            box.style.background = isError ? 'rgba(239,68,68,0.15)' : 'rgba(0,230,118,0.14)';
            box.style.border = isError ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(0,230,118,0.35)';
            box.style.color = isError ? '#fca5a5' : '#6ee7b7';
            box.textContent = msg;
        }
    }

    async function createPoolPosition({ amountWpol, amountUsdt0, rangePct = 5, feeTier = 500 }) {
        const vault = getVaultBridge();
        try {
            showPoolStatusToast('Preparando assinatura e verificando saldos...');
            const signer = await vault.getSigner(137);
            const owner = await signer.getAddress();
            const provider = vault.getReadProvider(137);

            const mainPool = new ethers.Contract(POLYGON_CONTRACTS.POOL_WPOL_USDT0_005, POOL_V3_ABI, provider);
            const [slot0, t0Addr, t1Addr] = await Promise.all([mainPool.slot0(), mainPool.token0(), mainPool.token1()]);

            const isWpolToken0 = t0Addr.toLowerCase() === TOKENS_POLYGON.WPOL.address.toLowerCase();
            const tickSpacing = feeTier === 100 ? 1 : (feeTier === 500 ? 10 : (feeTier === 3000 ? 60 : 200));

            const curPrice = _engineState.livePoolPrice || 0.088;
            const pLow = curPrice * (1 - rangePct / 100);
            const pHigh = curPrice * (1 + rangePct / 100);

            let tickA = priceToNearestTick(pLow, isWpolToken0 ? 18 : 6, isWpolToken0 ? 6 : 18, tickSpacing, !isWpolToken0);
            let tickB = priceToNearestTick(pHigh, isWpolToken0 ? 18 : 6, isWpolToken0 ? 6 : 18, tickSpacing, !isWpolToken0);
            const tickLower = Math.min(tickA, tickB);
            const tickUpper = Math.max(tickA, tickB);

            const wpolWei = ethers.utils.parseEther(String(amountWpol || '0'));
            const usdtWei = ethers.utils.parseUnits(String(amountUsdt0 || '0'), 6);

            // Se faltar WPOL mas houver POL nativo suficiente, faz wrap automático
            if (wpolWei.gt(0)) {
                const wpolContract = new ethers.Contract(TOKENS_POLYGON.WPOL.address, WPOL_ABI, signer);
                const curWpol = await wpolContract.balanceOf(owner);
                if (curWpol.lt(wpolWei)) {
                    const diff = wpolWei.sub(curWpol);
                    showPoolStatusToast('Convertendo POL nativo para WPOL automaticamente...');
                    const wrapTx = await wpolContract.deposit({ value: diff });
                    await wrapTx.wait();
                }
                showPoolStatusToast('Aprovando WPOL para o roteador Uniswap V3...');
                await ensureTokenApproval(TOKENS_POLYGON.WPOL.address, POLYGON_CONTRACTS.NFT_POSITION_MANAGER, wpolWei, signer);
            }

            if (usdtWei.gt(0)) {
                showPoolStatusToast('Aprovando USDT0 para o roteador Uniswap V3...');
                await ensureTokenApproval(TOKENS_POLYGON.USDT0.address, POLYGON_CONTRACTS.NFT_POSITION_MANAGER, usdtWei, signer);
            }

            const amount0Desired = isWpolToken0 ? wpolWei : usdtWei;
            const amount1Desired = isWpolToken0 ? usdtWei : wpolWei;

            const nftManager = new ethers.Contract(POLYGON_CONTRACTS.NFT_POSITION_MANAGER, NFT_MANAGER_ABI, signer);
            const deadline = Math.floor(Date.now() / 1000) + 900;

            showPoolStatusToast('Assinando criação da Pool Uniswap V3...');
            const tx = await nftManager.mint({
                token0: t0Addr,
                token1: t1Addr,
                fee: feeTier,
                tickLower,
                tickUpper,
                amount0Desired,
                amount1Desired,
                amount0Min: 0,
                amount1Min: 0,
                recipient: owner,
                deadline
            });

            showPoolStatusToast(`Transação enviada (${tx.hash.slice(0, 10)}...). Aguardando bloco...`);
            const receipt = await tx.wait();

            // Registra custo base exato para o Consultor Break-Even
            const prices = vault.getPrices();
            const estUsd = (parseFloat(amountWpol || 0) * curPrice) + parseFloat(amountUsdt0 || 0);
            const estBrl = estUsd * prices.usdBrl;
            const transferTopic = ethers.utils.id('Transfer(address,address,uint256)');
            const mintLog = receipt.logs.find(
                (lg) => lg.address.toLowerCase() === POLYGON_CONTRACTS.NFT_POSITION_MANAGER.toLowerCase() && lg.topics[0] === transferTopic
            );
            if (mintLog && mintLog.topics[3]) {
                const newTokenId = ethers.BigNumber.from(mintLog.topics[3]).toString();
                saveCostBasisEntry(newTokenId, estUsd, estBrl);
            }

            showPoolStatusToast('✅ Nova Pool Uniswap V3 criada com sucesso!');
            await vault.refreshBalances();
            await refreshPoolAndPositions();
        } catch (err) {
            showPoolStatusToast(err?.reason || err?.message || 'Erro ao criar posição.', true);
        }
    }

    async function collectPositionFees(tokenId) {
        const vault = getVaultBridge();
        try {
            showPoolStatusToast(`Coletando tarifas do NFT #${tokenId}...`);
            const signer = await vault.getSigner(137);
            const owner = await signer.getAddress();
            const nftManager = new ethers.Contract(POLYGON_CONTRACTS.NFT_POSITION_MANAGER, NFT_MANAGER_ABI, signer);

            const tx = await nftManager.collect({
                tokenId,
                recipient: owner,
                amount0Max: MAX_UINT128,
                amount1Max: MAX_UINT128
            });
            await tx.wait();
            showPoolStatusToast(`✅ Tarifas do NFT #${tokenId} enviadas para sua carteira!`);
            await vault.refreshBalances();
            await refreshPoolAndPositions();
        } catch (err) {
            showPoolStatusToast(err?.reason || err?.message || 'Erro ao coletar taxas.', true);
        }
    }

    async function closeAndBurnPosition(tokenId) {
        const vault = getVaultBridge();
        const pos = _engineState.positions.find((p) => p.tokenId === String(tokenId));
        if (!pos) return;
        if (!confirm(`Deseja retirar 100% da liquidez + tarifas da Pool #${tokenId} (${pos.pairLabel}) para sua carteira?`)) return;

        try {
            showPoolStatusToast(`Removendo liquidez e coletando ativos da Pool #${tokenId}...`);
            const signer = await vault.getSigner(137);
            const owner = await signer.getAddress();
            const nftManager = new ethers.Contract(POLYGON_CONTRACTS.NFT_POSITION_MANAGER, NFT_MANAGER_ABI, signer);
            const deadline = Math.floor(Date.now() / 1000) + 900;

            const calls = [];
            if (ethers.BigNumber.from(pos.liquidity).gt(0)) {
                calls.push(
                    nftManager.interface.encodeFunctionData('decreaseLiquidity', [{
                        tokenId,
                        liquidity: pos.liquidity,
                        amount0Min: 0,
                        amount1Min: 0,
                        deadline
                    }])
                );
            }
            calls.push(
                nftManager.interface.encodeFunctionData('collect', [{
                    tokenId,
                    recipient: owner,
                    amount0Max: MAX_UINT128,
                    amount1Max: MAX_UINT128
                }])
            );
            calls.push(nftManager.interface.encodeFunctionData('burn', [tokenId]));

            const tx = await nftManager.multicall(calls);
            await tx.wait();

            showPoolStatusToast(`✅ Pool #${tokenId} encerrada e fundos devolvidos!`);
            await vault.refreshBalances();
            await refreshPoolAndPositions();
        } catch (err) {
            showPoolStatusToast(err?.reason || err?.message || 'Erro ao fechar posição.', true);
        }
    }

    async function rebalancePositionAtomic(tokenId) {
        const vault = getVaultBridge();
        const pos = _engineState.positions.find((p) => p.tokenId === String(tokenId));
        if (!pos) return;
        if (!confirm(`Rebalancear Pool #${tokenId} (${pos.pairLabel}) centralizando ±5% no preço atual de mercado?`)) return;

        try {
            showPoolStatusToast(`Etapa 1/3: Retirando liquidez antiga da Pool #${tokenId}...`);
            const signer = await vault.getSigner(137);
            const owner = await signer.getAddress();
            const nftManager = new ethers.Contract(POLYGON_CONTRACTS.NFT_POSITION_MANAGER, NFT_MANAGER_ABI, signer);
            const deadline = Math.floor(Date.now() / 1000) + 900;

            const calls = [];
            if (ethers.BigNumber.from(pos.liquidity).gt(0)) {
                calls.push(
                    nftManager.interface.encodeFunctionData('decreaseLiquidity', [{
                        tokenId,
                        liquidity: pos.liquidity,
                        amount0Min: 0,
                        amount1Min: 0,
                        deadline
                    }])
                );
            }
            calls.push(
                nftManager.interface.encodeFunctionData('collect', [{
                    tokenId,
                    recipient: owner,
                    amount0Max: MAX_UINT128,
                    amount1Max: MAX_UINT128
                }])
            );
            calls.push(nftManager.interface.encodeFunctionData('burn', [tokenId]));

            const closeTx = await nftManager.multicall(calls);
            await closeTx.wait();

            showPoolStatusToast('Etapa 2/3: Balanceando proporção 50/50 dos ativos...');
            const provider = vault.getReadProvider(137);
            const c0 = new ethers.Contract(pos.token0, ERC20_ABI, provider);
            const c1 = new ethers.Contract(pos.token1, ERC20_ABI, provider);
            const [b0, b1] = await Promise.all([c0.balanceOf(owner), c1.balanceOf(owner)]);

            const val0 = parseFloat(ethers.utils.formatUnits(b0, pos.dec0));
            const val1 = parseFloat(ethers.utils.formatUnits(b1, pos.dec1));

            const isWpol0 = pos.sym0 === 'WPOL';
            const wpolAmt = isWpol0 ? val0 : val1;
            const usdtAmt = isWpol0 ? val1 : val0;
            const curPrice = _engineState.livePoolPrice || 0.088;

            const wpolUsd = wpolAmt * curPrice;
            const totalUsd = wpolUsd + usdtAmt;
            const halfUsd = totalUsd / 2;

            // Faz swap da metade excedente com proteção de slippage de 1.5%
            const router = new ethers.Contract(POLYGON_CONTRACTS.SWAP_ROUTER_02, SWAP_ROUTER_ABI, signer);
            if (wpolUsd > halfUsd * 1.12) {
                const excessWpol = (wpolUsd - halfUsd) / curPrice;
                const amountIn = ethers.utils.parseEther(excessWpol.toFixed(6));
                const minOut = ethers.utils.parseUnits(((excessWpol * curPrice) * 0.985).toFixed(4), 6);
                await ensureTokenApproval(TOKENS_POLYGON.WPOL.address, POLYGON_CONTRACTS.SWAP_ROUTER_02, amountIn, signer);
                const swTx = await router.exactInputSingle({
                    tokenIn: TOKENS_POLYGON.WPOL.address,
                    tokenOut: TOKENS_POLYGON.USDT0.address,
                    fee: 500,
                    recipient: owner,
                    amountIn,
                    amountOutMinimum: minOut,
                    sqrtPriceLimitX96: 0
                });
                await swTx.wait();
            } else if (usdtAmt > halfUsd * 1.12) {
                const excessUsdt = usdtAmt - halfUsd;
                const amountIn = ethers.utils.parseUnits(excessUsdt.toFixed(4), 6);
                const minOut = ethers.utils.parseEther(((excessUsdt / curPrice) * 0.985).toFixed(5));
                await ensureTokenApproval(TOKENS_POLYGON.USDT0.address, POLYGON_CONTRACTS.SWAP_ROUTER_02, amountIn, signer);
                const swTx = await router.exactInputSingle({
                    tokenIn: TOKENS_POLYGON.USDT0.address,
                    tokenOut: TOKENS_POLYGON.WPOL.address,
                    fee: 500,
                    recipient: owner,
                    amountIn,
                    amountOutMinimum: minOut,
                    sqrtPriceLimitX96: 0
                });
                await swTx.wait();
            }

            showPoolStatusToast('Etapa 3/3: Abrindo nova Pool V3 centralizada...');
            const [finalWpolBn, finalUsdtBn] = await Promise.all([
                new ethers.Contract(TOKENS_POLYGON.WPOL.address, ERC20_ABI, provider).balanceOf(owner),
                new ethers.Contract(TOKENS_POLYGON.USDT0.address, ERC20_ABI, provider).balanceOf(owner)
            ]);

            await createPoolPosition({
                amountWpol: ethers.utils.formatEther(finalWpolBn),
                amountUsdt0: ethers.utils.formatUnits(finalUsdtBn, 6),
                rangePct: 5,
                feeTier: pos.feeTier || 500
            });
        } catch (err) {
            showPoolStatusToast(err?.reason || err?.message || 'Erro durante o rebalanceamento.', true);
        }
    }

    // =========================================================================
    // 5. COMPARADOR PIX LÍQUIDO & ROTEADOR SWAP / PONTE CROSS-CHAIN (LI.FI)
    // =========================================================================
    function updatePixComparisonTable() {
        const brlInput = document.getElementById('pix-amount-brl');
        const tbody = document.getElementById('pix-routes-tbody');
        if (!brlInput || !tbody) return;

        const brlAmount = Math.max(0, parseFloat(brlInput.value || '0'));
        const vault = getVaultBridge();
        const prices = vault?.getPrices ? vault.getPrices() : { usdBrl: 5.65 };
        const usdBrl = prices.usdBrl || 5.65;

        const routes = [
            {
                name: 'Transfero / BRZ On-Chain (Polygon)',
                spreadPct: 0.45,
                pixFeeBrl: 0.00,
                badge: 'MELHOR TAXA'
            },
            {
                name: 'Binance / Bybit PIX → Polygon',
                spreadPct: 0.65,
                pixFeeBrl: 1.50,
                badge: 'RÁPIDO'
            },
            {
                name: 'Nubank / Mercado Pago Cripto',
                spreadPct: 1.65,
                pixFeeBrl: 0.00,
                badge: 'SPREAD ALTO'
            },
            {
                name: 'MoonPay / Transak Cartão/PIX',
                spreadPct: 3.40,
                pixFeeBrl: 4.90,
                badge: 'CARO'
            }
        ];

        tbody.innerHTML = routes.map((r, idx) => {
            const netBrl = Math.max(0, brlAmount - r.pixFeeBrl);
            const effectiveRate = usdBrl * (1 + r.spreadPct / 100);
            const usdtReceived = netBrl / effectiveRate;
            const isBest = idx === 0;

            return `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.06);background:${isBest ? 'rgba(0,230,118,0.06)' : 'transparent'};">
                    <td style="padding:10px 8px;">
                        <div style="font-weight:700;color:#fff;font-size:0.84rem;">${r.name}</div>
                        <span style="font-size:0.66rem;font-weight:800;padding:2px 6px;border-radius:5px;background:${isBest ? 'rgba(0,230,118,0.18)' : 'rgba(255,255,255,0.08)'};color:${isBest ? '#00e676' : '#94a3b8'};">${r.badge}</span>
                    </td>
                    <td style="padding:10px 8px;text-align:right;font-size:0.82rem;color:#cbd5e1;">
                        ${r.spreadPct.toFixed(2)}% + R$ ${r.pixFeeBrl.toFixed(2)}
                    </td>
                    <td style="padding:10px 8px;text-align:right;font-weight:800;font-size:0.9rem;color:${isBest ? '#00e676' : '#fff'};">
                        ${usdtReceived.toFixed(2)} USDT0
                    </td>
                </tr>
            `;
        }).join('');
    }

    async function refreshSwapQuote() {
        const fromSel = document.getElementById('swap-from-token');
        const toSel = document.getElementById('swap-to-token');
        const amtInput = document.getElementById('swap-from-amount');
        const outEl = document.getElementById('swap-to-estimate');
        const availEl = document.getElementById('swap-available-amount');
        if (!fromSel || !toSel || !amtInput) return;

        const vault = getVaultBridge();
        const fromSym = String(fromSel.value || 'POL').toUpperCase();
        const toSym = String(toSel.value || 'USDT0').toUpperCase();
        const amountIn = parseFloat(amtInput.value || '0');

        if (availEl && vault?.getTokenBalance) {
            availEl.textContent = vault.getTokenBalance(fromSym).toFixed(4);
        }

        if (amountIn <= 0 || fromSym === toSym) {
            if (outEl) outEl.textContent = amountIn > 0 ? amountIn.toFixed(4) : '0.0000';
            return;
        }

        const prices = vault?.getPrices ? vault.getPrices() : { polUsd: 0.088, usdBrl: 5.65 };
        const pFrom = prices[fromSym] || 1;
        const pTo = prices[toSym] || 1;
        const estOut = (amountIn * pFrom) / pTo;

        _engineState.lastSwapQuote = { fromSym, toSym, amountIn, estOut };
        if (outEl) {
            outEl.textContent = `${estOut.toFixed(4)} ${toSym}`;
        }
    }

    async function executeOnChainSwap() {
        const vault = getVaultBridge();
        const fromSel = document.getElementById('swap-from-token');
        const toSel = document.getElementById('swap-to-token');
        const amtInput = document.getElementById('swap-from-amount');
        const statusEl = document.getElementById('swap-exec-status');
        if (!fromSel || !toSel || !amtInput) return;

        const fromSym = String(fromSel.value || 'POL').toUpperCase();
        const toSym = String(toSel.value || 'USDT0').toUpperCase();
        const amountStr = amtInput.value.trim();

        const setSwapMsg = (txt, isErr = false) => {
            if (!statusEl) return;
            statusEl.style.display = 'block';
            statusEl.style.color = isErr ? '#fca5a5' : '#6ee7b7';
            statusEl.textContent = txt;
        };

        try {
            if (!amountStr || parseFloat(amountStr) <= 0) throw new Error('Informe a quantidade para trocar.');
            if (fromSym === toSym) throw new Error('Selecione moedas diferentes.');

            const signer = await vault.getSigner(137);
            const owner = await signer.getAddress();

            // Caso 1: Wrap / Unwrap direto POL <-> WPOL
            if ((fromSym === 'POL' && toSym === 'WPOL') || (fromSym === 'WPOL' && toSym === 'POL')) {
                const wpol = new ethers.Contract(TOKENS_POLYGON.WPOL.address, WPOL_ABI, signer);
                const wei = ethers.utils.parseEther(amountStr);
                setSwapMsg(`Assinando conversão ${fromSym} → ${toSym}...`);
                const tx = fromSym === 'POL' ? await wpol.deposit({ value: wei }) : await wpol.withdraw(wei);
                await tx.wait();
                setSwapMsg(`✅ Conversão ${fromSym} → ${toSym} confirmada!`);
                await vault.refreshBalances();
                await refreshSwapQuote();
                return;
            }

            // Caso 2: Swap Uniswap V3 Router02 na Polygon
            const metaIn = TOKENS_POLYGON[fromSym];
            const metaOut = TOKENS_POLYGON[toSym];
            if (!metaIn || !metaOut) throw new Error('Par não suportado.');

            let tokenInAddr = metaIn.address;
            let tokenOutAddr = metaOut.address;
            const amountInWei = ethers.utils.parseUnits(amountStr, metaIn.decimals);

            // Se origem for POL nativo, converte para WPOL antes do swap
            if (metaIn.isNative) {
                const wpol = new ethers.Contract(TOKENS_POLYGON.WPOL.address, WPOL_ABI, signer);
                setSwapMsg('Convertendo POL para WPOL...');
                const wTx = await wpol.deposit({ value: amountInWei });
                await wTx.wait();
                tokenInAddr = TOKENS_POLYGON.WPOL.address;
            }
            if (metaOut.isNative) {
                tokenOutAddr = TOKENS_POLYGON.WPOL.address;
            }

            setSwapMsg(`Aprovando ${fromSym} no roteador...`);
            await ensureTokenApproval(tokenInAddr, POLYGON_CONTRACTS.SWAP_ROUTER_02, amountInWei, signer);

            const prices = vault.getPrices();
            const expectedOut = (parseFloat(amountStr) * (prices[fromSym] || 1)) / (prices[toSym] || 1);
            const minOutWei = ethers.utils.parseUnits((expectedOut * 0.98).toFixed(metaOut.decimals === 6 ? 5 : 6), metaOut.decimals);

            const router = new ethers.Contract(POLYGON_CONTRACTS.SWAP_ROUTER_02, SWAP_ROUTER_ABI, signer);
            setSwapMsg('Assinando troca na Uniswap V3...');
            const tx = await router.exactInputSingle({
                tokenIn: tokenInAddr,
                tokenOut: tokenOutAddr,
                fee: 500,
                recipient: owner,
                amountIn: amountInWei,
                amountOutMinimum: minOutWei,
                sqrtPriceLimitX96: 0
            });
            await tx.wait();

            setSwapMsg(`✅ Troca ${fromSym} → ${toSym} concluída com sucesso!`);
            await vault.refreshBalances();
            await refreshSwapQuote();
        } catch (err) {
            setSwapMsg(err?.reason || err?.message || 'Troca cancelada.', true);
        }
    }

    // =========================================================================
    // 6. NAVEGAÇÃO DE ABAS, PWA INSTALL, SERVICE WORKER & WAKE LOCK
    // =========================================================================
    function switchAppTab(tabName) {
        const target = String(tabName || 'wallet').toLowerCase();

        document.querySelectorAll('[data-tab-target]').forEach((btn) => {
            const active = btn.getAttribute('data-tab-target') === target;
            btn.classList.toggle('active', active);
        });

        document.querySelectorAll('[data-tab-panel]').forEach((panel) => {
            const match = panel.getAttribute('data-tab-panel') === target;
            panel.style.display = match ? 'block' : 'none';
            panel.classList.toggle('active', match);
        });

        if (target === 'pools') {
            refreshPoolAndPositions();
        } else if (target === 'audit') {
            const ledger = getLedgerBridge();
            if (ledger?.runAudit) ledger.runAudit(false);
        } else if (target === 'swap') {
            updatePixComparisonTable();
            refreshSwapQuote();
        }
    }

    function initPwaAndUiController() {
        // 1. Registro do Service Worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').catch(() => {});
        }

        // 2. Botão de Instalação PWA
        let deferredPrompt = null;
        const installBtn = document.getElementById('btn-install-pwa');
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            if (installBtn) installBtn.style.display = 'inline-flex';
        });

        installBtn?.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            await deferredPrompt.userChoice;
            deferredPrompt = null;
            installBtn.style.display = 'none';
        });

        // 3. Navegação da Barra Inferior / Abas
        document.querySelectorAll('[data-tab-target]').forEach((btn) => {
            btn.addEventListener('click', () => {
                switchAppTab(btn.getAttribute('data-tab-target'));
            });
        });

        // 4. Botões da Aba Pools V3
        document.getElementById('btn-refresh-pools')?.addEventListener('click', refreshPoolAndPositions);
        document.getElementById('btn-create-pool')?.addEventListener('click', () => {
            const wpolVal = document.getElementById('pool-input-wpol')?.value || '0';
            const usdtVal = document.getElementById('pool-input-usdt')?.value || '0';
            const rangeVal = parseFloat(document.getElementById('pool-input-range')?.value || '5');
            createPoolPosition({ amountWpol: wpolVal, amountUsdt0: usdtVal, rangePct: rangeVal, feeTier: 500 });
        });

        // 5. Botões da Aba Trocar / PIX Líquido
        document.getElementById('pix-amount-brl')?.addEventListener('input', updatePixComparisonTable);
        document.getElementById('swap-from-token')?.addEventListener('change', refreshSwapQuote);
        document.getElementById('swap-to-token')?.addEventListener('change', refreshSwapQuote);
        document.getElementById('swap-from-amount')?.addEventListener('input', refreshSwapQuote);
        document.getElementById('btn-swap-max')?.addEventListener('click', () => {
            const vault = getVaultBridge();
            const sym = document.getElementById('swap-from-token')?.value || 'POL';
            const bal = vault?.getTokenBalance ? vault.getTokenBalance(sym) : 0;
            const safeMax = sym === 'POL' ? Math.max(0, bal - 0.08) : bal;
            const inp = document.getElementById('swap-from-amount');
            if (inp) {
                inp.value = safeMax > 0 ? safeMax.toFixed(4) : '0';
                refreshSwapQuote();
            }
        });
        document.getElementById('btn-exec-swap')?.addEventListener('click', executeOnChainSwap);

        // 6. Botões da Aba Auditoria Forense
        document.getElementById('btn-audit-rescan')?.addEventListener('click', () => {
            const ledger = getLedgerBridge();
            if (ledger?.runAudit) ledger.runAudit(true);
        });
        document.getElementById('btn-audit-brl')?.addEventListener('click', () => {
            getLedgerBridge()?.setDisplayCurrency?.('BRL');
        });
        document.getElementById('btn-audit-usd')?.addEventListener('click', () => {
            getLedgerBridge()?.setDisplayCurrency?.('USD');
        });

        // 7. Wake Lock de tela quando o app estiver em primeiro plano
        if ('wakeLock' in navigator) {
            const requestWake = () => navigator.wakeLock.request('screen').catch(() => {});
            requestWake();
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') requestWake();
            });
        }

        // Inicializa estados iniciais
        updatePixComparisonTable();
        refreshSwapQuote();
        setTimeout(() => {
            refreshPoolAndPositions();
        }, 700);
    }

    const sentinelApi = {
        getState: () => ({ ..._engineState }),
        refreshAll: refreshPoolAndPositions,
        refreshPoolAndPositions,
        createPoolPosition,
        collectPositionFees,
        closeAndBurnPosition,
        rebalancePositionAtomic,
        refreshSwapQuote,
        executeOnChainSwap,
        updatePixComparisonTable,
        switchAppTab
    };

    // Expõe ambos os namespaces para evitar qualquer quebra entre módulos
    global.RdeskSentinel = sentinelApi;
    global.RdeskDefi = sentinelApi;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPwaAndUiController);
    } else {
        initPwaAndUiController();
    }
})(window);
