/**
 * RDESK SENTINEL V22 — LEDGER ADVISOR & CURVA DE PATRIMÔNIO (5º de 9 arquivos)
 * 1. Auditoria cronológica desde a 1ª transação (3 rotas de redundância)
 * 2. Separação EOA vs. Smart Contract (elimina falsos saques/depósitos em pools V3)
 * 3. Precificação histórica em lote (DefiLlama /chart/ + BCB PTAX Oficial + BRZ/BRLA 1:1)
 * 4. Curva Visual de Patrimônio (Capital Investido vs. Patrimônio Vivo em R$ e USD)
 * 5. Consultor Tático Break-Even & Recomendação de Rebalanceamento por Posição
 */
(function (global) {
    'use strict';

    const BLOCKSCOUT_ENDPOINTS = {
        137: 'https://polygon.blockscout.com/api/v2',
        1: 'https://eth.blockscout.com/api/v2',
        42161: 'https://arbitrum.blockscout.com/api/v2',
        8453: 'https://base.blockscout.com/api/v2',
        10: 'https://optimism.blockscout.com/api/v2'
    };

    const LEDGER_CACHE_PREFIX = 'rdesk_v22_ledger_';
    const OVERRIDES_PREFIX = 'rdesk_v22_overrides_';

    // Cache em memória de contratos verificados via is_contract ou eth_getCode
    const _contractFlagCache = new Map();
    const _historicalFxMap = {};      // 'YYYY-MM-DD' -> usdBrlRate
    const _historicalPriceMap = {};   // 'YYYY-MM-DD:assetKey' -> usdPrice

    let _ledgerState = {
        wallet: null,
        chainId: 137,
        displayCurrency: 'BRL',
        isScanning: false,
        progressPct: 0,
        progressText: '',
        events: [],
        manualOverrides: {},
        summary: {
            totalInBrl: 0,
            totalInUsd: 0,
            totalOutBrl: 0,
            totalOutUsd: 0,
            totalGasBrl: 0,
            totalGasUsd: 0,
            netInvestedBrl: 0,
            netInvestedUsd: 0,
            currentEquityBrl: 0,
            currentEquityUsd: 0,
            activePoolsBrl: 0,
            activePoolsUsd: 0,
            realPnlBrl: 0,
            realPnlUsd: 0,
            roiPct: 0,
            firstTxDate: '--',
            trendDirection: 'NEUTRAL' // 'UP' | 'DOWN' | 'NEUTRAL'
        },
        dailySeries: []
    };

    let _chartInstance = null;
    const _listeners = new Set();

    function emitLedgerUpdate(reason) {
        const snap = getLedgerSnapshot();
        _listeners.forEach((cb) => {
            try {
                cb(snap, reason);
            } catch (e) {
                console.error('Ledger listener error:', e);
            }
        });
    }

    function setScanProgress(isScanning, text = '', pct = 0) {
        _ledgerState.isScanning = isScanning;
        _ledgerState.progressText = text;
        _ledgerState.progressPct = Math.min(100, Math.max(0, Math.round(pct)));
        emitLedgerUpdate('SCAN_PROGRESS');
    }

    function dateKeyFromUnix(unixSec) {
        return new Date(unixSec * 1000).toISOString().slice(0, 10);
    }

    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
        ]);
    }

    // =========================================================================
    // 1. MAPA DE CONTRATOS VERIFICADOS (EVITA CONTAR POOLS COMO SAQUE REAL)
    // =========================================================================
    function buildKnownTokenLookup(chainId) {
        const map = new Map();
        const reg = global.RdeskVault?.ASSET_REGISTRY || {};
        Object.values(reg).forEach((asset) => {
            const c = asset.contracts?.[chainId];
            if (c && !c.isNative && c.address) {
                map.set(c.address.toLowerCase(), {
                    symbol: asset.symbol,
                    decimals: c.decimals,
                    kind: asset.kind,
                    llamaId: asset.llamaId
                });
            }
        });
        return map;
    }

    async function isSmartContractAddress(chainId, addrLower, hintIsContract) {
        if (!addrLower || !ethers.utils.isAddress(addrLower)) return false;
        const key = `${chainId}:${addrLower}`;
        if (_contractFlagCache.has(key)) return _contractFlagCache.get(key);

        if (typeof hintIsContract === 'boolean') {
            _contractFlagCache.set(key, hintIsContract);
            return hintIsContract;
        }

        try {
            if (global.RdeskVault?.callWithRpcFailover) {
                const code = await global.RdeskVault.callWithRpcFailover(
                    chainId,
                    (provider) => provider.getCode(addrLower),
                    3500
                );
                const isContract = Boolean(code && code !== '0x');
                _contractFlagCache.set(key, isContract);
                return isContract;
            }
        } catch (e) {}

        return false;
    }

    // =========================================================================
    // 2. ORÁCULO HISTÓRICO: BCB PTAX OFICIAL + DEFILLAMA /CHART/ EM LOTE
    // =========================================================================
    async function loadBcbPtaxHistory(startUnixSec) {
        const liveFx = global.RdeskVault?.getState()?.usdBrlRate || 5.65;
        const startDate = new Date((startUnixSec - 7 * 86400) * 1000);
        const endDate = new Date();

        const fmtBcb = (d) =>
            `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}-${d.getUTCFullYear()}`;

        // Rota 1: Banco Central do Brasil (PTAX oficial desde qualquer ano)
        try {
            const url =
                `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/` +
                `CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)` +
                `?@dataInicial='${fmtBcb(startDate)}'&@dataFinalCotacao='${fmtBcb(endDate)}'&$format=json`;
            const res = await withTimeout(fetch(url), 6000);
            const json = await res.json();
            if (Array.isArray(json?.value)) {
                json.value.forEach((row) => {
                    if (row.dataHoraCotacao && row.cotacaoVenda) {
                        const dKey = row.dataHoraCotacao.slice(0, 10);
                        _historicalFxMap[dKey] = parseFloat(row.cotacaoVenda);
                    }
                });
            }
        } catch (e) {}

        // Rota 2 (Failover): AwesomeAPI últimos 365 dias
        if (Object.keys(_historicalFxMap).length === 0) {
            try {
                const res = await withTimeout(fetch('https://economia.awesomeapi.com.br/json/daily/USD-BRL/365'), 5000);
                const list = await res.json();
                if (Array.isArray(list)) {
                    list.forEach((item) => {
                        const dKey = dateKeyFromUnix(Number(item.timestamp));
                        _historicalFxMap[dKey] = parseFloat(item.bid);
                    });
                }
            } catch (e) {}
        }

        const todayKey = new Date().toISOString().slice(0, 10);
        _historicalFxMap[todayKey] = liveFx;
    }

    function getUsdBrlForDate(dateKey) {
        if (_historicalFxMap[dateKey]) return _historicalFxMap[dateKey];
        const baseMs = new Date(dateKey + 'T12:00:00Z').getTime();
        for (let i = 1; i <= 7; i++) {
            const prevKey = new Date(baseMs - i * 86400000).toISOString().slice(0, 10);
            if (_historicalFxMap[prevKey]) return _historicalFxMap[prevKey];
        }
        return global.RdeskVault?.getState()?.usdBrlRate || 5.65;
    }

    async function loadBatchAssetPriceHistory(startUnixSec) {
        const spanDays = Math.max(7, Math.ceil((Date.now() / 1000 - startUnixSec) / 86400) + 3);
        const coins = [
            { key: 'POL', llamaId: 'polygon:0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270' },
            { key: 'ETH', llamaId: 'coingecko:ethereum' },
            { key: 'WBTC', llamaId: 'ethereum:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599' }
        ];

        await Promise.all(
            coins.map(async (c) => {
                try {
                    const url = `https://coins.llama.fi/chart/${c.llamaId}?start=${startUnixSec - 86400}&span=${spanDays}&period=1d`;
                    const res = await withTimeout(fetch(url), 6000);
                    const json = await res.json();
                    const prices = json?.coins?.[c.llamaId]?.prices;
                    if (Array.isArray(prices)) {
                        prices.forEach((pt) => {
                            const dKey = dateKeyFromUnix(pt.timestamp);
                            _historicalPriceMap[`${dKey}:${c.key}`] = pt.price;
                        });
                    }
                } catch (e) {}
            })
        );
    }

    function getAssetUsdPriceOnDate(symbol, dateKey) {
        const fx = getUsdBrlForDate(dateKey);
        const livePrices = global.RdeskVault?.getState()?.pricesUsd || {};

        if (symbol === 'USDT' || symbol === 'USDC' || symbol === 'USDT0' || symbol === 'USDC.e' || symbol === 'DAI') {
            return 1.0;
        }
        if (symbol === 'BRZ' || symbol === 'BRLA') {
            return 1.0 / fx;
        }

        const normKey = symbol === 'WPOL' || symbol === 'MATIC' ? 'POL' : (symbol === 'WETH' ? 'ETH' : symbol);
        const exact = _historicalPriceMap[`${dateKey}:${normKey}`];
        if (exact && exact > 0) return exact;

        const baseMs = new Date(dateKey + 'T12:00:00Z').getTime();
        for (let i = 1; i <= 5; i++) {
            const prevKey = new Date(baseMs - i * 86400000).toISOString().slice(0, 10);
            const fallback = _historicalPriceMap[`${prevKey}:${normKey}`];
            if (fallback && fallback > 0) return fallback;
        }

        return livePrices[normKey] || livePrices[symbol] || 0;
    }

    // =========================================================================
    // 3. VARREDURA HISTÓRICA (3 ROTAS DE REDUNDÂNCIA: BLOCKSCOUT / RPC / CACHE)
    // =========================================================================
    async function fetchBlockscoutPages(baseUrl, label, basePct, spanPct) {
        let items = [];
        let nextParams = null;
        let page = 1;

        while (page <= 35) {
            const urlObj = new URL(baseUrl);
            if (nextParams) {
                Object.entries(nextParams).forEach(([k, v]) => urlObj.searchParams.set(k, v));
            }

            const res = await withTimeout(fetch(urlObj.toString()), 7000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (Array.isArray(data.items)) {
                items = items.concat(data.items);
            }

            setScanProgress(
                true,
                `${label}: ${items.length} registros lidos (pág. ${page})...`,
                basePct + Math.min(spanPct, page * 1.5)
            );

            if (!data.next_page_params) break;
            nextParams = data.next_page_params;
            page++;
        }

        return items;
    }

    // Rota 2 (Failover caso Blockscout esteja indisponível): Logs ERC-20 direto via RPC
    async function fetchFallbackRpcLogs(walletLower, chainId) {
        const net = global.RdeskVault?.NETWORKS?.[chainId];
        if (!net) return [];

        const transferTopic = ethers.utils.id('Transfer(address,address,uint256)');
        const walletTopic = ethers.utils.hexZeroPad(walletLower, 32);
        const tokenMap = buildKnownTokenLookup(chainId);
        const tokenAddresses = Array.from(tokenMap.keys());
        if (tokenAddresses.length === 0) return [];

        return global.RdeskVault.callWithRpcFailover(chainId, async (provider) => {
            const latest = await provider.getBlockNumber();
            const fromBlock = Math.max(0, latest - 250000);

            const [logsIn, logsOut] = await Promise.all([
                provider.getLogs({ address: tokenAddresses, topics: [transferTopic, null, walletTopic], fromBlock, toBlock: 'latest' }),
                provider.getLogs({ address: tokenAddresses, topics: [transferTopic, walletTopic, null], fromBlock, toBlock: 'latest' })
            ]);

            const allLogs = [...logsIn, ...logsOut];
            const blockCache = new Map();
            const syntheticTransfers = [];

            for (const lg of allLogs.slice(-150)) {
                if (!blockCache.has(lg.blockNumber)) {
                    const blk = await provider.getBlock(lg.blockNumber);
                    blockCache.set(lg.blockNumber, blk ? blk.timestamp : Math.floor(Date.now() / 1000));
                }
                const ts = blockCache.get(lg.blockNumber);
                const meta = tokenMap.get(lg.address.toLowerCase());
                if (!meta) continue;

                const from = '0x' + lg.topics[1].slice(26).toLowerCase();
                const to = '0x' + lg.topics[2].slice(26).toLowerCase();
                syntheticTransfers.push({
                    transaction_hash: lg.transactionHash,
                    timestamp: new Date(ts * 1000).toISOString(),
                    from: { hash: from, is_contract: null },
                    to: { hash: to, is_contract: null },
                    token: { address_hash: lg.address.toLowerCase(), symbol: meta.symbol, decimals: meta.decimals, type: 'ERC-20', is_spam: false },
                    total: { value: ethers.BigNumber.from(lg.data).toString(), decimals: meta.decimals }
                });
            }
            return syntheticTransfers;
        }, 8000);
    }

    async function runFullHistoryAudit(walletAddress, chainId = 137, activePoolsBrl = 0, activePoolsUsd = 0) {
        const walletLower = String(walletAddress || '').trim().toLowerCase();
        if (!ethers.utils.isAddress(walletLower)) return;

        _ledgerState.wallet = walletLower;
        _ledgerState.chainId = chainId;

        try {
            const savedOv = localStorage.getItem(`${OVERRIDES_PREFIX}${chainId}_${walletLower}`);
            _ledgerState.manualOverrides = savedOv ? JSON.parse(savedOv) : {};
        } catch (e) {
            _ledgerState.manualOverrides = {};
        }

        const net = global.RdeskVault?.NETWORKS?.[chainId];
        const nativeSymbol = net?.nativeSymbol || 'POL';
        const knownTokens = buildKnownTokenLookup(chainId);
        const apiBase = BLOCKSCOUT_ENDPOINTS[chainId];

        setScanProgress(true, 'Lendo histórico desde a 1ª transação da carteira...', 8);

        let normalTxs = [];
        let tokenTransfers = [];
        let internalTxs = [];
        let usedRoute = 'BLOCKSCOUT_V2';

        try {
            if (!apiBase) throw new Error('Sem endpoint Blockscout para esta rede');
            [normalTxs, tokenTransfers, internalTxs] = await Promise.all([
                fetchBlockscoutPages(`${apiBase}/addresses/${walletLower}/transactions`, 'Transações principais', 10, 20),
                fetchBlockscoutPages(`${apiBase}/addresses/${walletLower}/token-transfers`, 'Transferências de tokens', 30, 20),
                fetchBlockscoutPages(`${apiBase}/addresses/${walletLower}/internal-transactions`, 'Operações internas', 50, 15).catch(() => [])
            ]);
        } catch (errRoute1) {
            try {
                usedRoute = 'RPC_GETLOGS';
                setScanProgress(true, 'Rota 2 (RPC Direto): reconstruindo transferências on-chain...', 40);
                tokenTransfers = await fetchFallbackRpcLogs(walletLower, chainId);
            } catch (errRoute2) {
                usedRoute = 'LOCAL_CACHE';
                try {
                    const cached = localStorage.getItem(`${LEDGER_CACHE_PREFIX}${chainId}_${walletLower}`);
                    if (cached) {
                        const parsed = JSON.parse(cached);
                        _ledgerState.events = parsed.events || [];
                        recalculateLedgerMetrics(activePoolsBrl, activePoolsUsd);
                        setScanProgress(false);
                        return;
                    }
                } catch (e) {}
            }
        }

        setScanProgress(true, 'Agrupando transações por hash e filtrando spam...', 68);

        const txMap = new Map();

        function ensureTx(hashRaw, timestampIso) {
            const hash = String(hashRaw || '').toLowerCase();
            if (!txMap.has(hash)) {
                const unixSec = Math.floor(new Date(timestampIso).getTime() / 1000) || Math.floor(Date.now() / 1000);
                txMap.set(hash, {
                    hash,
                    unixSec,
                    dateKey: dateKeyFromUnix(unixSec),
                    inflows: [],
                    outflows: [],
                    gasNative: 0,
                    touchedContract: false
                });
            }
            return txMap.get(hash);
        }

        // 1. Transações principais (inclui gás mesmo em transações revertidas)
        for (const tx of normalTxs) {
            if (!tx?.hash) continue;
            const entry = ensureTx(tx.hash, tx.timestamp);
            const fromAddr = tx.from?.hash?.toLowerCase() || '';
            const toAddr = tx.to?.hash?.toLowerCase() || '';

            if (fromAddr === walletLower && tx.fee?.value) {
                entry.gasNative += parseFloat(ethers.utils.formatEther(tx.fee.value));
            }

            if (tx.status !== 'ok') continue;

            if (toAddr && toAddr !== walletLower) {
                const toIsContract = await isSmartContractAddress(chainId, toAddr, tx.to?.is_contract);
                if (toIsContract) entry.touchedContract = true;
            }

            const nativeVal = tx.value ? parseFloat(ethers.utils.formatEther(tx.value)) : 0;
            if (nativeVal > 0) {
                if (toAddr === walletLower && fromAddr !== walletLower) {
                    const fromIsContract = await isSmartContractAddress(chainId, fromAddr, tx.from?.is_contract);
                    if (fromIsContract) entry.touchedContract = true;
                    entry.inflows.push({ symbol: nativeSymbol, amount: nativeVal, counterparty: fromAddr, isContract: fromIsContract });
                } else if (fromAddr === walletLower && toAddr !== walletLower) {
                    const toIsContract = await isSmartContractAddress(chainId, toAddr, tx.to?.is_contract);
                    if (toIsContract) entry.touchedContract = true;
                    entry.outflows.push({ symbol: nativeSymbol, amount: nativeVal, counterparty: toAddr, isContract: toIsContract });
                }
            }
        }

        // 2. Transações internas (ex.: unwrap de WPOL -> POL ou WETH -> ETH)
        for (const itx of internalTxs) {
            if (!itx?.transaction_hash || !itx.success) continue;
            const val = itx.value ? parseFloat(ethers.utils.formatEther(itx.value)) : 0;
            if (val <= 0) continue;

            const entry = ensureTx(itx.transaction_hash, itx.timestamp);
            const fromAddr = itx.from?.hash?.toLowerCase() || '';
            const toAddr = itx.to?.hash?.toLowerCase() || '';

            if (toAddr === walletLower && fromAddr !== walletLower) {
                const fromIsContract = await isSmartContractAddress(chainId, fromAddr, itx.from?.is_contract);
                if (fromIsContract) entry.touchedContract = true;
                entry.inflows.push({ symbol: nativeSymbol, amount: val, counterparty: fromAddr, isContract: fromIsContract });
            } else if (fromAddr === walletLower && toAddr !== walletLower) {
                const toIsContract = await isSmartContractAddress(chainId, toAddr, itx.to?.is_contract);
                if (toIsContract) entry.touchedContract = true;
                entry.outflows.push({ symbol: nativeSymbol, amount: val, counterparty: toAddr, isContract: toIsContract });
            }
        }

        // 3. Transferências ERC-20 (somente tokens oficiais verificados, ignorando spam/phishing)
        for (const tr of tokenTransfers) {
            if (!tr?.transaction_hash || tr.token?.is_spam === true) continue;
            const tokenAddr = (tr.token?.address_hash || tr.token?.address || '').toLowerCase();
            const verifiedMeta = knownTokens.get(tokenAddr);
            if (!verifiedMeta) continue; // Ignora airdrops falsos/spam

            const entry = ensureTx(tr.transaction_hash, tr.timestamp);
            const fromAddr = tr.from?.hash?.toLowerCase() || '';
            const toAddr = tr.to?.hash?.toLowerCase() || '';
            const decimals = Number(tr.total?.decimals ?? verifiedMeta.decimals);
            const amount = parseFloat(ethers.utils.formatUnits(tr.total?.value || '0', decimals));
            if (amount <= 0) continue;

            if (toAddr === walletLower && fromAddr !== walletLower) {
                const fromIsContract = await isSmartContractAddress(chainId, fromAddr, tr.from?.is_contract);
                if (fromIsContract) entry.touchedContract = true;
                entry.inflows.push({ symbol: verifiedMeta.symbol, amount, counterparty: fromAddr, isContract: fromIsContract });
            } else if (fromAddr === walletLower && toAddr !== walletLower) {
                const toIsContract = await isSmartContractAddress(chainId, toAddr, tr.to?.is_contract);
                if (toIsContract) entry.touchedContract = true;
                entry.outflows.push({ symbol: verifiedMeta.symbol, amount, counterparty: toAddr, isContract: toIsContract });
            }
        }

        const sortedTxs = Array.from(txMap.values()).sort((a, b) => a.unixSec - b.unixSec);
        const oldestUnix = sortedTxs.length > 0 ? sortedTxs[0].unixSec : Math.floor(Date.now() / 1000) - 86400;

        setScanProgress(true, 'Baixando série histórica oficial PTAX (BCB) e preços em lote...', 80);
        await Promise.all([
            loadBcbPtaxHistory(oldestUnix),
            loadBatchAssetPriceHistory(oldestUnix)
        ]);

        setScanProgress(true, 'Consolidando livro-razão em Reais (BRL) e Dólar (USD)...', 92);

        const finalizedEvents = sortedTxs.map((tx) => {
            const fxRate = getUsdBrlForDate(tx.dateKey);
            const nativePriceUsd = getAssetUsdPriceOnDate(nativeSymbol, tx.dateKey);
            const gasUsd = tx.gasNative * nativePriceUsd;
            const gasBrl = gasUsd * fxRate;

            let inUsd = 0;
            let inBrl = 0;
            const parts = [];

            tx.inflows.forEach((inf) => {
                const pUsd = getAssetUsdPriceOnDate(inf.symbol, tx.dateKey);
                const vUsd = inf.amount * pUsd;
                inUsd += vUsd;
                inBrl += vUsd * fxRate;
                parts.push(`+${inf.amount.toFixed(inf.symbol === 'WBTC' ? 6 : 2)} ${inf.symbol}`);
            });

            let outUsd = 0;
            let outBrl = 0;
            tx.outflows.forEach((outf) => {
                const pUsd = getAssetUsdPriceOnDate(outf.symbol, tx.dateKey);
                const vUsd = outf.amount * pUsd;
                outUsd += vUsd;
                outBrl += vUsd * fxRate;
                parts.push(`-${outf.amount.toFixed(outf.symbol === 'WBTC' ? 6 : 2)} ${outf.symbol}`);
            });

            // Classificação contábil: somente transferência pura entre carteiras humanas (EOA) é Aporte ou Saque Real
            const allCounterpartiesAreEoa =
                tx.inflows.every((x) => !x.isContract) &&
                tx.outflows.every((x) => !x.isContract);

            let autoClass = 'DEFI';
            if (!tx.touchedContract && allCounterpartiesAreEoa && inUsd > 0.05 && outUsd === 0) {
                autoClass = 'IN';
            } else if (!tx.touchedContract && allCounterpartiesAreEoa && outUsd > 0.05 && inUsd === 0) {
                autoClass = 'OUT';
            }

            return {
                hash: tx.hash,
                unixSec: tx.unixSec,
                dateKey: tx.dateKey,
                fxRate,
                autoClass,
                inUsd,
                inBrl,
                outUsd,
                outBrl,
                gasUsd,
                gasBrl,
                summaryText: parts.length > 0 ? parts.join(' | ') : 'Interação / Aprovação de Contrato',
                route: usedRoute
            };
        });

        _ledgerState.events = finalizedEvents;

        try {
            localStorage.setItem(
                `${LEDGER_CACHE_PREFIX}${chainId}_${walletLower}`,
                JSON.stringify({ updatedAt: Date.now(), events: finalizedEvents })
            );
        } catch (e) {}

        recalculateLedgerMetrics(activePoolsBrl, activePoolsUsd);
        setScanProgress(false);
    }

    // =========================================================================
    // 4. CÁLCULO DO PATRIMÔNIO VIVO & CURVA DE EVOLUÇÃO (SUBINDO VS. DESCENDO)
    // =========================================================================
    function recalculateLedgerMetrics(activePoolsBrl = _ledgerState.summary.activePoolsBrl, activePoolsUsd = _ledgerState.summary.activePoolsUsd) {
        let totalInBrl = 0;
        let totalInUsd = 0;
        let totalOutBrl = 0;
        let totalOutUsd = 0;
        let totalGasBrl = 0;
        let totalGasUsd = 0;

        const dailyMap = new Map();

        _ledgerState.events.forEach((ev) => {
            const effClass = _ledgerState.manualOverrides[ev.hash] || ev.autoClass;
            ev.effectiveClass = effClass;

            totalGasBrl += ev.gasBrl;
            totalGasUsd += ev.gasUsd;

            if (!dailyMap.has(ev.dateKey)) {
                dailyMap.set(ev.dateKey, { date: ev.dateKey, inBrl: 0, outBrl: 0, inUsd: 0, outUsd: 0 });
            }
            const day = dailyMap.get(ev.dateKey);

            if (effClass === 'IN') {
                const vBrl = ev.inBrl > 0 ? ev.inBrl : ev.outBrl;
                const vUsd = ev.inUsd > 0 ? ev.inUsd : ev.outUsd;
                totalInBrl += vBrl;
                totalInUsd += vUsd;
                day.inBrl += vBrl;
                day.inUsd += vUsd;
            } else if (effClass === 'OUT') {
                const vBrl = ev.outBrl > 0 ? ev.outBrl : ev.inBrl;
                const vUsd = ev.outUsd > 0 ? ev.outUsd : ev.inUsd;
                totalOutBrl += vBrl;
                totalOutUsd += vUsd;
                day.outBrl += vBrl;
                day.outUsd += vUsd;
            }
        });

        const vaultSnap = global.RdeskVault?.getState();
        const freeWalletBrl = vaultSnap?.totalPortfolioBrl || 0;
        const freeWalletUsd = vaultSnap?.totalPortfolioUsd || 0;

        const currentEquityBrl = freeWalletBrl + activePoolsBrl;
        const currentEquityUsd = freeWalletUsd + activePoolsUsd;

        const netInvestedBrl = Math.max(0, totalInBrl - totalOutBrl);
        const netInvestedUsd = Math.max(0, totalInUsd - totalOutUsd);

        // Equação contábil real: (Patrimônio Atual + Total Sacado) - Total Aportado
        const realPnlBrl = (currentEquityBrl + totalOutBrl) - totalInBrl;
        const realPnlUsd = (currentEquityUsd + totalOutUsd) - totalInUsd;
        const roiPct = totalInBrl > 0 ? (realPnlBrl / totalInBrl) * 100 : 0;

        let trendDirection = 'NEUTRAL';
        if (totalInBrl > 0) {
            trendDirection = realPnlBrl >= 0 ? 'UP' : 'DOWN';
        }

        _ledgerState.summary = {
            totalInBrl,
            totalInUsd,
            totalOutBrl,
            totalOutUsd,
            totalGasBrl,
            totalGasUsd,
            netInvestedBrl,
            netInvestedUsd,
            currentEquityBrl,
            currentEquityUsd,
            activePoolsBrl,
            activePoolsUsd,
            realPnlBrl,
            realPnlUsd,
            roiPct,
            firstTxDate: _ledgerState.events.length > 0 ? _ledgerState.events[0].dateKey : '--',
            trendDirection
        };

        // Monta série temporal para o gráfico visual
        const series = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
        const todayKey = new Date().toISOString().slice(0, 10);
        if (series.length === 0 || series[series.length - 1].date !== todayKey) {
            series.push({ date: todayKey, inBrl: 0, outBrl: 0, inUsd: 0, outUsd: 0 });
        }

        let runningInvestedBrl = 0;
        let runningInvestedUsd = 0;
        _ledgerState.dailySeries = series.map((d, idx) => {
            runningInvestedBrl += d.inBrl - d.outBrl;
            runningInvestedUsd += d.inUsd - d.outUsd;

            let equityPointBrl = null;
            let equityPointUsd = null;
            if (idx === 0) {
                equityPointBrl = d.inBrl;
                equityPointUsd = d.inUsd;
            }
            if (idx === series.length - 1) {
                equityPointBrl = currentEquityBrl;
                equityPointUsd = currentEquityUsd;
            }

            return {
                ...d,
                cumInvestedBrl: Number(runningInvestedBrl.toFixed(2)),
                cumInvestedUsd: Number(runningInvestedUsd.toFixed(2)),
                equityPointBrl: equityPointBrl !== null ? Number(equityPointBrl.toFixed(2)) : null,
                equityPointUsd: equityPointUsd !== null ? Number(equityPointUsd.toFixed(2)) : null
            };
        });

        emitLedgerUpdate('METRICS_RECALCULATED');
    }

    function renderEquityChart(canvasId = 'equity-curve-chart') {
        const canvasEl = document.getElementById(canvasId);
        if (!canvasEl || typeof Chart === 'undefined') return;

        const isBrl = _ledgerState.displayCurrency === 'BRL';
        const series = _ledgerState.dailySeries;
        const isProfit = _ledgerState.summary.realPnlBrl >= 0;

        const labels = series.map((s) => s.date);
        const inflows = series.map((s) => Number((isBrl ? s.inBrl : s.inUsd).toFixed(2)));
        const outflows = series.map((s) => Number((-(isBrl ? s.outBrl : s.outUsd)).toFixed(2)));
        const baselineCurve = series.map((s) => (isBrl ? s.cumInvestedBrl : s.cumInvestedUsd));
        const equityCurve = series.map((s) => (isBrl ? s.equityPointBrl : s.equityPointUsd));

        const equityLineColor = isProfit ? '#00D084' : '#F5A623';

        if (_chartInstance) {
            _chartInstance.destroy();
        }

        _chartInstance = new Chart(canvasEl.getContext('2d'), {
            data: {
                labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Aportes Reais',
                        data: inflows,
                        backgroundColor: 'rgba(0, 208, 132, 0.65)',
                        borderRadius: 3
                    },
                    {
                        type: 'bar',
                        label: 'Saques Reais',
                        data: outflows,
                        backgroundColor: 'rgba(229, 72, 77, 0.65)',
                        borderRadius: 3
                    },
                    {
                        type: 'line',
                        label: 'Capital Líquido Investido (Linha de Base)',
                        data: baselineCurve,
                        borderColor: '#CDA434',
                        borderWidth: 2,
                        tension: 0.15,
                        pointRadius: 2
                    },
                    {
                        type: 'line',
                        label: 'Patrimônio Vivo (Carteira + Pools)',
                        data: equityCurve,
                        borderColor: equityLineColor,
                        backgroundColor: isProfit ? 'rgba(0, 208, 132, 0.12)' : 'rgba(245, 166, 35, 0.12)',
                        fill: '-1',
                        borderDash: [5, 4],
                        borderWidth: 2.5,
                        spanGaps: true,
                        pointRadius: 5,
                        pointBackgroundColor: equityLineColor
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        labels: { color: '#AAA', font: { family: 'Space Mono', size: 10 } }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#777', font: { family: 'Space Mono', size: 10 }, maxTicksLimit: 8 },
                        grid: { color: 'rgba(255,255,255,0.03)' }
                    },
                    y: {
                        ticks: {
                            color: '#888',
                            font: { family: 'Space Mono', size: 10 },
                            callback: (v) => (isBrl ? 'R$ ' : '$ ') + Number(v).toLocaleString('pt-BR')
                        },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    }
                }
            }
        });
    }

    // =========================================================================
    // 5. CONSULTOR TÁTICO BREAK-EVEN & REBALANCEAMENTO POR POSIÇÃO
    // =========================================================================
    function analyzePositionBreakEven({
        minPrice,
        maxPrice,
        currentPrice,
        currentPosUsd,
        unclaimedFeesUsd,
        initialCapitalBrl,
        openGasPol = 0.05,
        estCloseGasPol = 0.045,
        polPriceUsd = 0.088,
        usdBrlRate = 5.65
    }) {
        const currentPosBrl = currentPosUsd * usdBrlRate;
        const feesBrl = unclaimedFeesUsd * usdBrlRate;
        const totalCurrentValueBrl = currentPosBrl + feesBrl;

        const baseCapBrl = initialCapitalBrl > 0 ? initialCapitalBrl : currentPosBrl;
        const openGasBrl = openGasPol * polPriceUsd * usdBrlRate;
        const closeGasBrl = estCloseGasPol * polPriceUsd * usdBrlRate;
        const totalGasBrl = openGasBrl + closeGasBrl;

        // Lucro Bruto (antes de descontar gás de abertura e fechamento)
        const grossProfitBrl = totalCurrentValueBrl - baseCapBrl;
        // Lucro Líquido Real (se fechar e sacar neste exato instante)
        const netProfitBrl = grossProfitBrl - totalGasBrl;

        const isNetProfitable = netProfitBrl > 0.01;
        const missingToBreakEvenBrl = isNetProfitable ? 0 : Math.abs(netProfitBrl);
        // Total acumulado de tarifas necessário para cruzar o ponto zero líquido
        const totalFeesNeededToStartProfitBrl = Math.max(0, feesBrl + missingToBreakEvenBrl);

        const span = maxPrice - minPrice;
        const rangePct = span > 0 ? ((currentPrice - minPrice) / span) * 100 : 50;
        const isOutOfRange = currentPrice < minPrice || currentPrice > maxPrice;
        const isNearEdge = !isOutOfRange && (rangePct <= 10 || rangePct >= 90);
        const shouldSuggestRebalance = isOutOfRange || isNearEdge;

        const rangeText = `${Number(minPrice).toFixed(5)} até ${Number(maxPrice).toFixed(5)}`;

        let statusBadge = isNetProfitable ? 'NO LUCRO LÍQUIDO' : 'AGUARDANDO EMPATE';
        let statusTone = isNetProfitable ? 'PROFIT' : 'BREAKEVEN_WAIT';

        let profitExplanation = '';
        if (!isNetProfitable) {
            profitExplanation =
                `Ainda não deu lucro líquido nesta operação. Se você fechar agora, terá prejuízo líquido de ` +
                `-R$ ${missingToBreakEvenBrl.toFixed(2)} (já contando gás de abertura e fechamento). ` +
                `A partir de R$ ${totalFeesNeededToStartProfitBrl.toFixed(2)} em tarifas totais você começa a fazer lucro líquido real.`;
        } else {
            profitExplanation =
                `Operação no lucro! Lucro Bruto: +R$ ${grossProfitBrl.toFixed(2)} | ` +
                `Lucro Líquido Real (pós-gás): +R$ ${netProfitBrl.toFixed(2)}.`;
        }

        let rebalancePrompt = '';
        if (isOutOfRange) {
            statusBadge = 'FORA DO RANGE';
            statusTone = 'OUT_OF_RANGE';
            rebalancePrompt = `Você está com uma posição fora da faixa (${rangeText}) e não está gerando tarifas agora. Deseja rebalancear automaticamente?`;
        } else if (isNearEdge) {
            rebalancePrompt = `Você está com uma posição aberta no range ${rangeText} (${rangePct.toFixed(0)}% da faixa, próximo da borda). Deseja rebalancear?`;
        } else {
            rebalancePrompt = `Posição ativa no range ${rangeText} (${rangePct.toFixed(0)}% da faixa).`;
        }

        return {
            rangeText,
            rangePct,
            isOutOfRange,
            isNearEdge,
            shouldSuggestRebalance,
            isNetProfitable,
            statusBadge,
            statusTone,
            grossProfitBrl,
            netProfitBrl,
            totalGasBrl,
            missingToBreakEvenBrl,
            totalFeesNeededToStartProfitBrl,
            profitExplanation,
            rebalancePrompt
        };
    }

    function setEventClassificationOverride(txHash, newClass) {
        const hashLower = String(txHash || '').toLowerCase();
        if (!['IN', 'OUT', 'DEFI', 'IGNORE'].includes(newClass)) return;
        _ledgerState.manualOverrides[hashLower] = newClass;

        if (_ledgerState.wallet) {
            try {
                localStorage.setItem(
                    `${OVERRIDES_PREFIX}${_ledgerState.chainId}_${_ledgerState.wallet}`,
                    JSON.stringify(_ledgerState.manualOverrides)
                );
            } catch (e) {}
        }
        recalculateLedgerMetrics();
    }

    function getLedgerSnapshot() {
        return {
            wallet: _ledgerState.wallet,
            chainId: _ledgerState.chainId,
            displayCurrency: _ledgerState.displayCurrency,
            isScanning: _ledgerState.isScanning,
            progressPct: _ledgerState.progressPct,
            progressText: _ledgerState.progressText,
            events: [..._ledgerState.events],
            summary: { ..._ledgerState.summary },
            dailySeries: [..._ledgerState.dailySeries]
        };
    }

    global.RdeskLedger = {
        subscribe: (fn) => {
            _listeners.add(fn);
            return () => _listeners.delete(fn);
        },
        getState: getLedgerSnapshot,
        setDisplayCurrency: (curr) => {
            if (curr === 'BRL' || curr === 'USD') {
                _ledgerState.displayCurrency = curr;
                emitLedgerUpdate('CURRENCY_CHANGED');
            }
        },
        runFullHistoryAudit,
        recalculateLedgerMetrics,
        renderEquityChart,
        analyzePositionBreakEven,
        setEventClassificationOverride
    };
})(window);
