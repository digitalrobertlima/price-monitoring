/* =========================================================================
   RDESK — LIVRO-CAIXA DE TODAS AS REDES
   O extrato detalhado lê a rede Polygon pelo explorador. As outras redes
   (BNB Chain, Ethereum, Base, Arbitrum, Optimism, Celo), as moedas que a
   pessoa adicionou e o Bitcoin também precisam aparecer. Aqui:
   - Bitcoin: histórico completo de todos os seus endereços (mempool.space).
   - Outras redes e moedas adicionadas: o app compara os saldos a cada
     atualização. Subiu = entrou; desceu = saiu. Na primeira vez que vê uma
     moeda com saldo, registra "Saldo encontrado".
   - Dinheiro entrando dispara som de moedas e aviso no celular.
   - Guarda o valor total real de cada dia (todas as redes) para o gráfico.
   Tudo fica só neste aparelho.
   ========================================================================= */
(function (global) {
    'use strict';

    const KEY = 'rdesk_ledger_v1_';
    const W = () => global.RdeskWallet;
    const st = { addr: '', data: null, btcLoading: false };
    const blank = () => ({ snap: {}, pend: {}, entries: [], days: {}, btcAt: 0, btcTxs: [] });

    function load(addr) {
        if (st.addr === addr && st.data) return st.data;
        st.addr = addr;
        try { st.data = { ...blank(), ...(JSON.parse(localStorage.getItem(KEY + addr) || 'null') || {}) }; } catch (e) { st.data = blank(); }
        return st.data;
    }
    function save() {
        if (!st.addr || !st.data) return;
        const d = st.data;
        if (d.entries.length > 600) d.entries = d.entries.slice(-600);
        const dayKeys = Object.keys(d.days).sort();
        if (dayKeys.length > 800) dayKeys.slice(0, dayKeys.length - 800).forEach((k) => delete d.days[k]);
        try { localStorage.setItem(KEY + st.addr, JSON.stringify(d)); } catch (e) {}
    }

    const assetKey = (b) => `${b.chainId}:${b.symbol}`;
    // A Polygon já tem histórico detalhado pelo explorador; aqui só entram as moedas que ele não cobre
    const tracked = (b) => b.chainId !== 137 || b.isCustom;
    const dayKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
    const fmtAmt = (a) => Math.abs(a).toLocaleString('pt-BR', { maximumFractionDigits: Math.abs(a) >= 1 ? 6 : 8 });

    function addEntry(d, e) {
        e.id = e.id || `l-${e.chainId}-${e.symbol}-${e.unix}-${Math.round(Math.abs(e.amt) * 1e8)}`;
        if (d.entries.some((x) => x.id === e.id)) return false;
        d.entries.push(e);
        return true;
    }

    function onBalances() {
        const w = W();
        if (!w?.isConnected?.()) return;
        const addr = String(w.getAddress() || '').toLowerCase();
        if (!addr) return;
        const d = load(addr);
        const list = w.getBalances() || [];
        if (!list.length) return;
        const usdBrl = w.getPrices?.().USD_BRL || 5.4;
        const now = Date.now();
        const firstLook = !Object.keys(d.snap).length;
        const btcFromHistory = d.btcAt > 0;
        let changed = false;
        const gains = [];
        list.forEach((b) => {
            if (!tracked(b) || !Number.isFinite(b.amount)) return;
            const k = assetKey(b);
            const prev = d.snap[k];
            const amt = Number(b.amount) || 0;
            const unit = amt > 0 ? (b.usdValue || 0) / amt : 0;
            if (prev === undefined) {
                d.snap[k] = amt; changed = true;
                if (amt > 0 && !(b.chainId === 'btc' && btcFromHistory)) {
                    addEntry(d, { unix: Math.floor(now / 1000), chainId: b.chainId, symbol: b.symbol, amt, brl: amt * unit * usdBrl, usd: amt * unit, type: 'FOUND', approx: true });
                    if (!firstLook) gains.push({ b, amt, brl: amt * unit * usdBrl });
                }
                return;
            }
            const diff = Number((amt - prev).toPrecision(12));
            if (Math.abs(diff) <= Math.max(1e-12, Math.abs(prev) * 1e-9)) { delete d.pend[k]; return; }
            // Queda precisa aparecer em duas leituras seguidas (uma falha momentânea da rede pode mostrar zero)
            if (diff < 0) {
                const p = d.pend[k];
                if (!p || Math.abs(p.amt - amt) > 1e-12) { d.pend[k] = { amt, at: now }; changed = true; return; }
                if (now - p.at < 10000) return;
            }
            delete d.pend[k];
            d.snap[k] = amt; changed = true;
            if (b.chainId === 'btc' && btcFromHistory) { if (diff > 0) gains.push({ b, amt: diff, brl: diff * unit * usdBrl }); refreshBitcoin(true); return; }
            addEntry(d, { unix: Math.floor(now / 1000), chainId: b.chainId, symbol: b.symbol, amt: diff, brl: Math.abs(diff) * unit * usdBrl, usd: Math.abs(diff) * unit, type: diff > 0 ? 'IN' : 'OUT', approx: true });
            if (diff > 0) gains.push({ b, amt: diff, brl: diff * unit * usdBrl });
        });
        // Valor total REAL do dia (todas as redes + render), para o gráfico do patrimônio
        const total = list.reduce((s, b) => s + (b.usdValue || 0), 0) + (global.RdeskDefi?.getLivePositionsUsd?.() || 0);
        const pricesOk = w.getPrices?.().live !== false;
        if (total > 0 && pricesOk) { d.days[dayKey(now)] = { usd: total, at: now }; changed = true; }
        if (changed) save();
        gains.forEach((g) => {
            const brl = g.brl > 0 ? ` (${w.formatBRL(g.brl)})` : '';
            global.RdeskFeel?.moneyIn(`Entrou ${fmtAmt(g.amt)} ${g.b.symbol}${brl} na ${global.RdeskRegistry?.getChain?.(g.b.chainId)?.name || 'rede'}`);
        });
        if (gains.length || changed) global.RdeskHistory?.renderAll?.();
    }

    // ------------------------------------------------------------------ Bitcoin: histórico completo
    let btcBusy = null;
    async function refreshBitcoin(force = false) {
        const w = W();
        const B = global.RdeskBitcoin;
        if (!w || !B?.fetchAddressTxs || !w.getBitcoinAddresses) return;
        if (global.RdeskAnon?.isOn?.() && !force) return;
        const addr = String(w.getAddress() || '').toLowerCase();
        const d = load(addr);
        if (!force && Date.now() - d.btcAt < 5 * 60 * 1000) return;
        if (btcBusy) return btcBusy;
        btcBusy = (async () => {
            try {
                const mine = new Set((w.getBitcoinAddresses() || []).filter(Boolean));
                if (!mine.size) return;
                const txs = new Map();
                for (const a of mine) {
                    try { (await B.fetchAddressTxs(a)).forEach((t) => txs.set(t.txid, t)); } catch (e) { /* um endereço sem resposta não derruba o resto */ }
                }
                const rows = [...txs.values()].map((t) => {
                    let inSats = 0, outSats = 0;
                    (t.vout || []).forEach((o) => { if (mine.has(o.scriptpubkey_address)) inSats += o.value; });
                    (t.vin || []).forEach((i) => { if (mine.has(i.prevout?.scriptpubkey_address)) outSats += i.prevout.value; });
                    const net = inSats - outSats;
                    const unix = t.status?.block_time || Math.floor(Date.now() / 1000);
                    return { txid: t.txid, unix, net, fee: outSats > 0 ? (t.fee || 0) : 0, confirmed: Boolean(t.status?.confirmed) };
                }).filter((r) => r.net !== 0).sort((a, b) => a.unix - b.unix);
                // Preço do Bitcoin no momento de cada transação
                const prices = {};
                try {
                    const q = { 'coingecko:bitcoin': rows.slice(-120).map((r) => r.unix) };
                    const res = await fetch(`https://coins.llama.fi/batchHistorical?coins=${encodeURIComponent(JSON.stringify(q))}&searchWidth=6h`);
                    const list = (await res.json())?.coins?.['coingecko:bitcoin']?.prices || [];
                    rows.forEach((r) => {
                        let best = null;
                        list.forEach((p) => { if (!best || Math.abs(p.timestamp - r.unix) < Math.abs(best.timestamp - r.unix)) best = p; });
                        if (best && Math.abs(best.timestamp - r.unix) < 6 * 3600) prices[r.txid] = Number(best.price);
                    });
                } catch (e) {}
                const fx = w.getPrices?.().USD_BRL || 5.4;
                const btcNow = w.getPrices?.().BTC || 0;
                d.btcTxs = rows.map((r) => {
                    const usd = Math.abs(r.net) / 1e8 * (prices[r.txid] || btcNow);
                    return { ...r, usd, brl: usd * fx };
                });
                d.btcAt = Date.now();
                // Tira as entradas de saldo do Bitcoin: agora o histórico real cobre
                d.entries = d.entries.filter((e) => e.chainId !== 'btc');
                save();
                global.RdeskHistory?.renderAll?.();
            } finally { btcBusy = null; }
        })();
        return btcBusy;
    }

    // Lançamentos no formato do extrato
    function getEntries() {
        const w = W();
        const addr = String(w?.getAddress?.() || '').toLowerCase();
        if (!addr) return [];
        const d = load(addr);
        const fromBalances = d.entries.map((e) => {
            const chain = global.RdeskRegistry?.getChain?.(e.chainId)?.name || e.chainId;
            const title = e.type === 'FOUND' ? `Saldo encontrado: ${e.symbol}` : e.type === 'IN' ? `Recebeu ${e.symbol}` : `Saiu ${e.symbol}`;
            return { id: e.id, src: 'saldo', unix: e.unix, chainId: e.chainId, chainName: chain, title, sym: e.symbol, amt: e.amt, brl: e.brl, usd: e.usd, auto: e.type === 'OUT' ? 'OUT' : 'IN', approx: true };
        });
        const fromBtc = (d.btcTxs || []).map((r) => ({
            id: `btc-${r.txid}`, src: 'btc', hash: r.txid, unix: r.unix, chainId: 'btc', chainName: 'Bitcoin', sym: 'BTC',
            title: r.net > 0 ? 'Recebeu Bitcoin' : 'Enviou Bitcoin', amt: r.net / 1e8, brl: r.brl, usd: r.usd, fee: r.fee, confirmed: r.confirmed, auto: r.net > 0 ? 'IN' : 'OUT'
        }));
        return [...fromBalances, ...fromBtc].sort((a, b) => a.unix - b.unix);
    }
    function dayTotals() {
        const addr = String(W()?.getAddress?.() || '').toLowerCase();
        if (!addr) return {};
        return load(addr).days || {};
    }

    global.addEventListener('rdesk:balancesUpdated', () => { try { onBalances(); } catch (e) {} });
    global.addEventListener('rdesk:walletChanged', () => { setTimeout(() => refreshBitcoin(false).catch(() => {}), 2500); });

    global.RdeskLedger = { getEntries, dayTotals, refreshBitcoin, _onBalances: onBalances, _data: () => st.data };
})(window);
