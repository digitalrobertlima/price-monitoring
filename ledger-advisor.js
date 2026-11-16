/* =========================================================================
   RDESK SENTINEL — AUDITORIA FORENSE REAL, CURVA DE PATRIMÔNIO & BREAK-EVEN
   Arquivo 4 de 7: ledger-advisor.js
   Expõe: window.RdeskLedger
   ========================================================================= */

(function (global) {
    'use strict';

    const BLOCKSCOUT_ENDPOINTS = {
        137:   'https://polygon.blockscout.com/api/v2',
        1:     'https://eth.blockscout.com/api/v2',
        42161: 'https://arbitrum.blockscout.com/api/v2',
        8453:  'https://base.blockscout.com/api/v2',
        10:    'https://optimism.blockscout.com/api/v2'
    };

    const CHAIN_NATIVE_SYMBOL = {
        137:   'POL',
        1:     'ETH',
        42161: 'ETH',
        8453:  'ETH',
        10:    'ETH'
    };

    const KNOWN_TOKENS_BY_CHAIN = {
        137: {
            '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': { symbol: 'WPOL',  decimals: 18 },
            '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': { symbol: 'USDT0', decimals: 6 },
            '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': { symbol: 'USDC',  decimals: 6 },
            '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': { symbol: 'USDC',  decimals: 6 },
            '0x4ed141110f6eeeaba9a1df36d8c26f684d2475dc': { symbol: 'BRZ',   decimals: 18 },
            '0xe6a537a407488807f0bbeb0038b79004f19dddfb': { symbol: 'BRLA',  decimals: 18 },
            '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': { symbol: 'WETH',  decimals: 18 },
            '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': { symbol: 'WBTC',  decimals: 8 }
        },
        42161: {
            '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { symbol: 'USDT',  decimals: 6 },
            '0xaf88d065e77c8cc2239327c5edb3a432268e5831': { symbol: 'USDC',  decimals: 6 },
            '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': { symbol: 'WETH',  decimals: 18 }
        },
        8453: {
            '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC',  decimals: 6 },
            '0x4200000000000000000000000000000000000006': { symbol: 'WETH',  decimals: 18 }
        },
        10: {
            '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': { symbol: 'USDT',  decimals: 6 },
            '0x0b2c639c533813f4aa9d7837caf62653d097ff85': { symbol: 'USDC',  decimals: 6 },
            '0x4200000000000000000000000000000000000006': { symbol: 'WETH',  decimals: 18 }
        },
        1: {
            '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT',  decimals: 6 },
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC',  decimals: 6 },
            '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'WETH',  decimals: 18 }
        }
    };

    const LEDGER_CACHE_PREFIX = 'rdesk_v22_ledger_';
    const OVERRIDES_PREFIX = 'rdesk_v22_overrides_';

    const _contractFlagCache = new Map();
    const _historicalFxMap = {};    // 'YYYY-MM-DD' -> usdBrlRate
    const _historicalPriceMap = {}; // 'YYYY-MM-DD:assetKey' -> usdPrice

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
            trendDirection: 'NEUTRAL'
        },
        dailySeries: []
    };

    let _chartInstance = null;
    const _listeners = new Set();

    function getVaultBridge() {
        return global.RdeskVault || global.RdeskWallet || null;
    }

    function emitLedgerUpdate(reason) {
        const snap = getLedgerSnapshot();
        syncAuditDom(snap);
        _listeners.forEach((cb) => {
            try { cb(snap, reason); } catch (e) {}
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
    // 1. DETECÇÃO DE SMART CONTRACTS VS. CARTEIRAS HUMANAS (EOA)
    // =========================================================================
    async function isSmartContractAddress(chainId, addrLower, hintIsContract) {
        if (!addrLower || !ethers.utils.isAddress(addrLower)) return false;
        const key = `${chainId}:${addrLower}`;
        if (_contractFlagCache.has(key)) return _contractFlagCache.get(key);

        if (typeof hintIsContract === 'boolean') {
            _contractFlagCache.set(key, hintIsContract);
            return hintIsContract;
        }

        try {
            const vault = getVaultBridge();
            const provider = vault?.getReadProvider ? vault.getReadProvider(chainId) : null;
            if (provider) {
                const code = await withTimeout(provider.getCode(addrLower), 3500);
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
        const vault = getVaultBridge();
        const liveFx = vault?.getPrices ? (vault.getPrices().usdBrl || 5.65) : 5.65;
        const startDate = new Date((startUnixSec - 7 * 86400) * 1000);
        const endDate = new Date();

        const fmtBcb = (d) =>
            `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}-${d.getUTCFullYear()}`;

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
        const vault = getVaultBridge();
        return vault?.getPrices ? (vault.getPrices().usdBrl || 5.65) : 5.65;
    }

    async function loadBatchAssetPriceHistory(startUnixSec) {
        const spanDays = Math.max(7, Math.ceil((Date.now() / 1000 - startUnixSec) / 86400) + 3);
        const coins = [
            { key: 'POL',  llamaId: 'polygon:0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270' },
            { key: 'ETH',  llamaId: 'coingecko:ethereum' },
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
        const vault = getVaultBridge();
        const livePrices = vault?.getPrices ? vault.getPrices() : {};

        if (['USDT', 'USDC', 'USDT0', 'USDC.e', 'DAI'].includes(symbol)) {
            return 1.0;
        }
        if (symbol === 'BRZ' || symbol === 'BRLA') {
            return 1.0 / fx;
        }

        const normKey = (symbol === 'WPOL' || symbol === 'MATIC') ? 'POL' : (symbol === 'WETH' ? 'ETH' : symbol);
        const exact = _historicalPriceMap[`${dateKey}:${normKey}`];
        if (exact && exact > 0) return exact;

        const baseMs = new Date(dateKey + 'T12:00:00Z').getTime();
        for (let i = 1; i <= 5; i++) {
            const prevKey = new Date(baseMs - i * 86400000).toISOString().slice(0, 10);
            const fallback = _historicalPriceMap[`${prevKey}:${normKey}`];
            if (fallback && fallback > 0) return fallback;
        }

        return livePrices[normKey] || livePrices[symbol] || (normKey === 'POL' ? (livePrices.polUsd || 0.088) : 0);
    }

    // =========================================================================
    // 3. VARREDURA HISTÓRICA (3 ROTAS: BLOCKSCOUT V2 / RPC GETLOGS / CACHE)
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

    async function fetchFallbackRpcLogs(walletLower, chainId) {
        const vault = getVaultBridge();
        const provider = vault?.getReadProvider ? vault.getReadProvider(chainId) : null;
        const chainTokens = KNOWN_TOKENS_BY_CHAIN[chainId] || {};
        const tokenAddresses = Object.keys(chainTokens);
        if (!provider || tokenAddresses.length === 0) return [];

        const transferTopic = ethers.utils.id('Transfer(address,address,uint256)');
        const walletTopic = ethers.utils.hexZeroPad(walletLower, 32);

        const latest = await withTimeout(provider.getBlockNumber(), 5000);
        const fromBlock = Math.max(0, latest - 250000);

        const [logsIn, logsOut] = await Promise.all([
            withTimeout(provider.getLogs({ address: tokenAddresses, topics: [transferTopic, null, walletTopic], fromBlock, toBlock: 'latest' }), 7000),
            withTimeout(provider.getLogs({ address: tokenAddresses, topics: [transferTopic, walletTopic, null], fromBlock, toBlock: 'latest' }), 7000)
        ]);

        const allLogs = [...logsIn, ...logsOut];
        const blockCache = new Map();
        const syntheticTransfers = [];

        for (const lg of allLogs.slice(-150)) {
            if (!blockCache.has(lg.blockNumber)) {
                const blk = await provider.getBlock(lg.blockNumber).catch(() => null);
                blockCache.set(lg.blockNumber, blk ? blk.timestamp : Math.floor(Date.now() / 1000));
            }
            const ts = blockCache.get(lg.blockNumber);
            const meta = chainTokens[lg.address.toLowerCase()];
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
    }

    async function runFullHistoryAudit(walletAddress, chainId = 137, activePoolsBrl = 0, activePoolsUsd = 0) {
        const vault = getVaultBridge();
        const resolvedAddr = walletAddress || vault?.getAddress?.() || '';
        const walletLower = String(resolvedAddr).trim().toLowerCase();
        if (!ethers.utils.isAddress(walletLower)) return getLedgerSnapshot();

        if (_ledgerState.isScanning && _ledgerState.wallet === walletLower && _ledgerState.chainId === chainId) {
            return getLedgerSnapshot();
        }

        _ledgerState.wallet = walletLower;
        _ledgerState.chainId = chainId;

        try {
            const savedOv = localStorage.getItem(`${OVERRIDES_PREFIX}${chainId}_${walletLower}`);
            _ledgerState.manualOverrides = savedOv ? JSON.parse(savedOv) : {};
        } catch (e) {
            _ledgerState.manualOverrides = {};
        }

        const nativeSymbol = CHAIN_NATIVE_SYMBOL[chainId] || 'POL';
        const knownTokens = KNOWN_TOKENS_BY_CHAIN[chainId] || {};
        const apiBase = BLOCKSCOUT_ENDPOINTS[chainId];

        setScanProgress(true, 'Lendo histórico desde a 1ª transação da carteira...', 8);

        let normalTxs = [];
        let tokenTransfers = [];
        let internalTxs = [];
        let usedRoute = 'BLOCKSCOUT_V2';

        try {
            if (!apiBase) throw new Error('Sem endpoint Blockscout');
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
                        return getLedgerSnapshot();
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

        for (const tr of tokenTransfers) {
            if (!tr?.transaction_hash || tr.token?.is_spam === true) continue;
            const tokenAddr = (tr.token?.address_hash || tr.token?.address || '').toLowerCase();
            const verifiedMeta = knownTokens[tokenAddr];
            if (!verifiedMeta) continue;

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
        return getLedgerSnapshot();
    }

    // =========================================================================
    // 4. CÁLCULO DO PATRIMÔNIO VIVO & CURVA DE EVOLUÇÃO
    // =========================================================================
    function recalculateLedgerMetrics(
        activePoolsBrl = _ledgerState.summary.activePoolsBrl,
        activePoolsUsd = _ledgerState.summary.activePoolsUsd
    ) {
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

        const vault = getVaultBridge();
        const bals = vault?.getBalances ? vault.getBalances() : {};
        const freeWalletBrl = Number(bals.totalBrl || 0);
        const freeWalletUsd = Number(bals.totalUsd || 0);

        const currentEquityBrl = freeWalletBrl + activePoolsBrl;
        const currentEquityUsd = freeWalletUsd + activePoolsUsd;

        const netInvestedBrl = Math.max(0, totalInBrl - totalOutBrl);
        const netInvestedUsd = Math.max(0, totalInUsd - totalOutUsd);

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
        renderEquityChart();
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

        const equityLineColor = isProfit ? '#00e676' : '#f59e0b';

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
                        backgroundColor: 'rgba(0, 230, 118, 0.65)',
                        borderRadius: 3
                    },
                    {
                        type: 'bar',
                        label: 'Saques Reais',
                        data: outflows,
                        backgroundColor: 'rgba(239, 68, 68, 0.65)',
                        borderRadius: 3
                    },
                    {
                        type: 'line',
                        label: 'Capital Líquido Investido (Linha de Base)',
                        data: baselineCurve,
                        borderColor: '#eab308',
                        borderWidth: 2,
                        tension: 0.15,
                        pointRadius: 2
                    },
                    {
                        type: 'line',
                        label: 'Patrimônio Vivo (Carteira + Pools)',
                        data: equityCurve,
                        borderColor: equityLineColor,
                        backgroundColor: isProfit ? 'rgba(0, 230, 118, 0.12)' : 'rgba(245, 158, 11, 0.12)',
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
                        labels: { color: '#94a3b8', font: { size: 11 } }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#64748b', font: { size: 10 }, maxTicksLimit: 8 },
                        grid: { color: 'rgba(255,255,255,0.04)' }
                    },
                    y: {
                        ticks: {
                            color: '#94a3b8',
                            font: { size: 10 },
                            callback: (v) => (isBrl ? 'R$ ' : '$ ') + Number(v).toLocaleString('pt-BR')
                        },
                        grid: { color: 'rgba(255,255,255,0.06)' }
                    }
                }
            }
        });
    }

    // =========================================================================
    // 5. SINCRONIZAÇÃO COM ELEMENTOS DOM DA ABA RESULTADO / AUDITORIA
    // =========================================================================
    function syncAuditDom(snap) {
        const s = snap.summary;
        const isBrl = snap.displayCurrency === 'BRL';
        const fmt = (brlVal, usdVal) => isBrl
            ? brlVal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            : `$ ${usdVal.toFixed(2)}`;

        const progressWrap = document.getElementById('audit-scan-progress');
        if (progressWrap) {
            progressWrap.style.display = snap.isScanning ? 'block' : 'none';
            const txtEl = document.getElementById('audit-scan-text');
            const barEl = document.getElementById('audit-scan-bar');
            if (txtEl) txtEl.textContent = snap.progressText;
            if (barEl) barEl.style.width = `${snap.progressPct}%`;
        }

        const pnlEl = document.getElementById('audit-real-pnl');
        if (pnlEl) {
            const sign = s.realPnlBrl >= 0 ? '+' : '';
            pnlEl.textContent = `${sign}${fmt(s.realPnlBrl, s.realPnlUsd)} (${sign}${s.roiPct.toFixed(1)}%)`;
            pnlEl.style.color = s.realPnlBrl >= 0 ? '#00e676' : '#f87171';
        }

        const inEl = document.getElementById('audit-total-in');
        if (inEl) inEl.textContent = fmt(s.totalInBrl, s.totalInUsd);

        const outEl = document.getElementById('audit-total-out');
        if (outEl) outEl.textContent = fmt(s.totalOutBrl, s.totalOutUsd);

        const gasEl = document.getElementById('audit-total-gas');
        if (gasEl) gasEl.textContent = fmt(s.totalGasBrl, s.totalGasUsd);

        const eqEl = document.getElementById('audit-current-equity');
        if (eqEl) eqEl.textContent = fmt(s.currentEquityBrl, s.currentEquityUsd);

        const listEl = document.getElementById('audit-events-list');
        if (listEl) {
            if (!snap.events.length) {
                listEl.innerHTML = `<div style="text-align:center;color:#94a3b8;padding:16px;font-size:0.84rem;">Nenhuma movimentação encontrada para esta carteira na rede selecionada.</div>`;
            } else {
                const recent = [...snap.events].reverse().slice(0, 60);
                listEl.innerHTML = recent.map((ev) => {
                    const cls = ev.effectiveClass || ev.autoClass;
                    const badgeMap = {
                        IN:     { label: 'APORTE REAL', color: '#00e676', bg: 'rgba(0,230,118,0.12)' },
                        OUT:    { label: 'SAQUE REAL',  color: '#f87171', bg: 'rgba(239,68,68,0.12)' },
                        DEFI:   { label: 'POOL / SWAP', color: '#eab308', bg: 'rgba(234,179,8,0.12)' },
                        IGNORE: { label: 'IGNORADO',    color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' }
                    };
                    const b = badgeMap[cls] || badgeMap.DEFI;
                    const valBrl = ev.inBrl > 0 ? ev.inBrl : ev.outBrl;
                    const valUsd = ev.inUsd > 0 ? ev.inUsd : ev.outUsd;

                    return `
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;margin-bottom:7px;">
                            <div style="min-width:0;">
                                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                    <span style="font-size:0.68rem;font-weight:800;padding:2px 7px;border-radius:6px;background:${b.bg};color:${b.color};">${b.label}</span>
                                    <span style="font-size:0.74rem;color:#94a3b8;">${ev.dateKey}</span>
                                    <a href="https://polygonscan.com/tx/${ev.hash}" target="_blank" rel="noopener" style="font-size:0.72rem;color:#60a5fa;text-decoration:none;font-family:monospace;">${ev.hash.slice(0, 8)}...</a>
                                </div>
                                <div style="font-size:0.82rem;color:#f1f5f9;margin-top:4px;word-break:break-word;">${ev.summaryText}</div>
                            </div>
                            <div style="text-align:right;flex-shrink:0;">
                                <div style="font-weight:700;font-size:0.85rem;color:#fff;">${fmt(valBrl, valUsd)}</div>
                                <select data-override-hash="${ev.hash}" style="margin-top:4px;background:#0b0e14;color:#cbd5e1;border:1px solid rgba(255,255,255,0.15);border-radius:6px;font-size:0.7rem;padding:2px 5px;">
                                    <option value="IN" ${cls === 'IN' ? 'selected' : ''}>Aporte</option>
                                    <option value="OUT" ${cls === 'OUT' ? 'selected' : ''}>Saque</option>
                                    <option value="DEFI" ${cls === 'DEFI' ? 'selected' : ''}>Pool/Swap</option>
                                    <option value="IGNORE" ${cls === 'IGNORE' ? 'selected' : ''}>Ignorar</option>
                                </select>
                            </div>
                        </div>
                    `;
                }).join('');

                listEl.querySelectorAll('[data-override-hash]').forEach((sel) => {
                    sel.onchange = () => {
                        setEventClassificationOverride(sel.getAttribute('data-override-hash'), sel.value);
                    };
                });
            }
        }
    }

    // =========================================================================
    // 6. CONSULTOR TÁTICO BREAK-EVEN & REBALANCEAMENTO POR POSIÇÃO
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

        const grossProfitBrl = totalCurrentValueBrl - baseCapBrl;
        const netProfitBrl = grossProfitBrl - totalGasBrl;

        const isNetProfitable = netProfitBrl > 0.01;
        const missingToBreakEvenBrl = isNetProfitable ? 0 : Math.abs(netProfitBrl);
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
            rebalancePrompt = `Posição fora da faixa (${rangeText}) — não está gerando tarifas agora. Recomendado rebalancear.`;
        } else if (isNearEdge) {
            rebalancePrompt = `Posição na borda do range ${rangeText} (${rangePct.toFixed(0)}% da faixa). Considere rebalancear.`;
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
                renderEquityChart();
            }
        },
        runAudit: (force = false) => {
            const vault = getVaultBridge();
            const addr = vault?.getAddress?.() || '';
            if (!addr) return Promise.resolve(getLedgerSnapshot());
            if (!force && _ledgerState.wallet === addr.toLowerCase() && _ledgerState.events.length > 0) {
                recalculateLedgerMetrics();
                return Promise.resolve(getLedgerSnapshot());
            }
            return runFullHistoryAudit(addr, 137);
        },
        runFullHistoryAudit,
        recalculateLedgerMetrics,
        renderEquityChart,
        analyzePositionBreakEven,
        setEventClassificationOverride
    };
})(window);
