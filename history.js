/* =========================================================================
   RDESK — HISTÓRICO, EXTRATO, GRÁFICO DE PATRIMÔNIO E MOEDA DE REFERÊNCIA
   - Lê todas as transações da carteira na Polygon (Blockscout), desde a 1ª.
   - Extrato estilo bancário: agrupado por dia, em linguagem simples.
   - Gráfico do patrimônio na tela inicial, com entradas e saídas marcadas,
     reconstruído dia a dia com preços históricos; o último ponto é o valor
     ao vivo e se move junto com as cotações.
   - Moeda de referência (régua): Bitcoin por padrão; Real (BRZ), Dólar ou
     Ether. Lucro, gráfico e variação de cada moeda são medidos nela.
   ========================================================================= */
(function (global) {
    'use strict';

    const BLOCKSCOUT = 'https://polygon.blockscout.com/api/v2';
    const NFPM = '0xc36442b4a4522e871399cd717abdd847ab11fe88';
    const WPOL = '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270';
    const WBTC = '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6';
    const WETH = '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619';
    const BRZ = '0x4ed141110f6eeeaba9a1df36d8c26f684d2475dc';
    const BRLA = '0xe6a537a407488807f0bbeb0038b79004f19dddfb';
    // Só moedas conferidas entram na conta (moedas-lixo enviadas de graça inflariam o resultado)
    const TOKENS = {
        [WPOL]: { symbol: 'WPOL', decimals: 18, kind: 'POL' },
        '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': { symbol: 'USDT', decimals: 6, kind: 'USD' },
        '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': { symbol: 'USDC', decimals: 6, kind: 'USD' },
        '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': { symbol: 'USDC.e', decimals: 6, kind: 'USD' },
        '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': { symbol: 'DAI', decimals: 18, kind: 'USD' },
        [BRZ]: { symbol: 'BRZ', decimals: 18, kind: 'BRL' },
        [BRLA]: { symbol: 'BRLA', decimals: 18, kind: 'BRL' },
        [WETH]: { symbol: 'WETH', decimals: 18, kind: 'ETH' },
        [WBTC]: { symbol: 'WBTC', decimals: 8, kind: 'BTC' }
    };

    const REFS = {
        BTC: { id: 'BTC', name: 'Bitcoin', unit: 'BTC', llama: 'coingecko:bitcoin', hint: 'Mostra se você ficou mais rico ou mais pobre em bitcoins.' },
        BRL: { id: 'BRL', name: 'Real (BRZ)', unit: 'BRZ', llama: `polygon:${BRZ}`, hint: 'Mostra tudo em reais. O real perde valor frente ao dólar com o tempo.' },
        USD: { id: 'USD', name: 'Dólar (USDT)', unit: 'US$', llama: 'coingecko:tether', hint: 'Mostra tudo em dólares.' },
        ETH: { id: 'ETH', name: 'Ether', unit: 'ETH', llama: 'coingecko:ethereum', hint: 'Mostra se você ficou mais rico ou mais pobre em ether.' }
    };
    const REF_KEY = 'rdesk_ref_currency_v1';
    const CACHE_PREFIX = 'rdesk_history_v4_'; // v3: inclui o POL devolvido pelos contratos
    const PAGE_SIZE = 40;

    const W = () => global.RdeskWallet;
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmtBRL = (v) => (W() ? W().formatBRL(v) : `R$ ${Number(v).toFixed(2)}`);

    const st = {
        wallet: '',
        events: [],
        overrides: {},
        ptax: {},
        llama: {}, // addr -> { 'YYYY-MM-DD': usd }
        exact: {}, // hash -> { POL, BTC, ETH } preço no minuto da transação (entradas e saídas)
        nativeEnd: {}, // 'YYYY-MM-DD' -> saldo real de POL nativo no fim do dia (lido da rede)
        seriesReady: false,
        loading: false,
        progress: '',
        savedAt: 0,
        error: '',
        ref: 'BTC',
        change24: {}, // llamaKey -> % (ex.: -1.2)
        change24At: 0,
        filter: 'ALL',
        shown: PAGE_SIZE,
        range: 'all',
        lastLiveUsd: 0,
        failedLoad: false
    };
    try { const r = localStorage.getItem(REF_KEY); if (REFS[r]) st.ref = r; } catch (e) {}

    // ------------------------------------------------------------------ preços
    const dayKey = (unix) => new Date(unix * 1000).toISOString().slice(0, 10);
    const todayKey = () => new Date().toISOString().slice(0, 10);
    function back(map, key, days = 7) {
        if (!map) return null;
        if (map[key]) return map[key];
        const base = new Date(`${key}T12:00:00Z`).getTime();
        for (let i = 1; i <= days; i++) {
            const k = new Date(base - i * 86400000).toISOString().slice(0, 10);
            if (map[k]) return map[k];
        }
        return null;
    }
    function fxOn(key) { return back(st.ptax, key) || W()?.getPrices().USD_BRL || 5.4; }
    function nowUsd(kind) {
        const p = W()?.getPrices() || {};
        if (kind === 'USD') return 1;
        if (kind === 'BRL') return 1 / (p.USD_BRL || 5.4);
        if (kind === 'POL') return p.POL || 0;
        if (kind === 'BTC') return p.BTC || 0;
        if (kind === 'ETH') return p.ETH || 0;
        return 0;
    }
    function usdOn(kind, key) {
        if (kind === 'USD') return 1;
        if (kind === 'BRL') return 1 / fxOn(key);
        const addr = kind === 'POL' ? WPOL : kind === 'BTC' ? WBTC : kind === 'ETH' ? WETH : null;
        if (key === todayKey()) return nowUsd(kind) || back(st.llama[addr], key, 10) || 0;
        return back(st.llama[addr], key, 10) || nowUsd(kind);
    }
    // Quanto 1 unidade da referência vale em dólares naquele dia
    function refUsdOn(key, ref = st.ref) {
        if (ref === 'USD') return 1;
        if (ref === 'BRL') return 1 / fxOn(key);
        return usdOn(ref, key);
    }
    function refUsdNow(ref = st.ref) {
        if (ref === 'USD') return 1;
        if (ref === 'BRL') return 1 / (W()?.getPrices().USD_BRL || 5.4);
        return nowUsd(ref);
    }

    async function loadPriceSeries(fromUnix) {
        const days = Math.min(1500, Math.max(10, Math.ceil((Date.now() / 1000 - fromUnix) / 86400) + 3));
        const end = new Date();
        const start = new Date(end.getTime() - days * 86400000);
        const fmtBcb = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
        const bcb = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@di,dataFinalCotacao=@df)?@di='${fmtBcb(start)}'&@df='${fmtBcb(end)}'&$format=json&$select=cotacaoVenda,dataHoraCotacao`;
        const llama = `https://coins.llama.fi/chart/polygon:${WPOL},polygon:${WBTC},polygon:${WETH}?start=${Math.floor(start.getTime() / 1000)}&span=${days + 1}&period=1d`;
        const [b, l] = await Promise.all([fetch(bcb).catch(() => null), fetch(llama).catch(() => null)]);
        try {
            if (b && b.ok) ((await b.json())?.value || []).forEach((row) => { const k = String(row.dataHoraCotacao || '').slice(0, 10); if (k && row.cotacaoVenda) st.ptax[k] = Number(row.cotacaoVenda); });
        } catch (e) {}
        try {
            if (l && l.ok) {
                const coins = (await l.json())?.coins || {};
                Object.entries(coins).forEach(([key, val]) => {
                    const addr = key.split(':')[1].toLowerCase();
                    st.llama[addr] = st.llama[addr] || {};
                    (val.prices || []).forEach((pt) => { st.llama[addr][dayKey(pt.timestamp)] = Number(pt.price); });
                });
            }
        } catch (e) {}
        st.seriesReady = true;
    }

    // ------------------------------------------------------------------ variação em 24 h
    const CHAIN_LLAMA = { 137: 'polygon', 1: 'ethereum', 8453: 'base', 42161: 'arbitrum', 10: 'optimism', 42220: 'celo' };
    function llamaKeyFor(b) {
        const s = String(b.symbol || '').toUpperCase();
        if (s === 'POL' || s === 'WPOL') return `polygon:${WPOL}`;
        if (s === 'ETH' || s === 'WETH') return 'coingecko:ethereum';
        if (s === 'BTC' || s === 'WBTC' || s === 'CBBTC') return 'coingecko:bitcoin';
        if (s === 'USDT' || s === 'USDT0') return 'coingecko:tether';
        if (s === 'USDC' || s === 'USDC.E') return 'coingecko:usd-coin';
        if (s === 'BRZ') return `polygon:${BRZ}`;
        if (s === 'BRLA') return `polygon:${BRLA}`;
        if (s === 'CELO') return 'coingecko:celo';
        if (b.address && CHAIN_LLAMA[b.chainId]) return `${CHAIN_LLAMA[b.chainId]}:${String(b.address).toLowerCase()}`;
        return null;
    }
    async function refreshChange24(force) {
        if (!force && Date.now() - st.change24At < 5 * 60 * 1000) return;
        const keys = new Set(Object.values(REFS).map((r) => r.llama));
        (W()?.getBalances() || []).forEach((b) => { const k = llamaKeyFor(b); if (k) keys.add(k); });
        try {
            const res = await fetch(`https://coins.llama.fi/percentage/${[...keys].join(',')}?period=24h`);
            if (!res.ok) return;
            const coins = (await res.json())?.coins || {};
            Object.entries(coins).forEach(([k, v]) => { if (Number.isFinite(Number(v))) st.change24[k] = Number(v); });
            st.change24At = Date.now();
            W()?.renderHome?.();
            renderBalanceRef();
        } catch (e) {}
    }
    // Variação de uma moeda em 24 h MEDIDA NA REFERÊNCIA (ex.: BRZ frente ao Bitcoin)
    function changeVsRef(b) {
        const k = llamaKeyFor(b);
        if (!k || !(k in st.change24)) return null;
        const r = st.change24[REFS[st.ref].llama];
        if (!Number.isFinite(r)) return null;
        return ((1 + st.change24[k] / 100) / (1 + r / 100) - 1) * 100;
    }
    function portfolioChangeVsRef() {
        const bal = (W()?.getBalances() || []).filter((b) => b.usdValue > 0);
        const r = st.change24[REFS[st.ref].llama];
        if (!bal.length || !Number.isFinite(r)) return null;
        let now = 0, past = 0;
        for (const b of bal) {
            const k = llamaKeyFor(b);
            const c = k && Number.isFinite(st.change24[k]) ? st.change24[k] : 0;
            now += b.usdValue;
            past += b.usdValue / (1 + c / 100);
        }
        if (!(past > 0)) return null;
        return ((now / past) * (1 + r / 100) - 1) * 100;
    }

    // ------------------------------------------------------------------ formatação
    function fmtRef(v, ref = st.ref, opts = {}) {
        const sign = opts.sign && v > 0 ? '+' : (v < 0 ? '−' : '');
        const a = Math.abs(v);
        if (ref === 'USD') return `${sign}US$ ${a.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (ref === 'BRL') return `${sign}${a.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BRZ`;
        // Bitcoin sempre com 8 casas (0,00000000); Ether com 6
        const digits = ref === 'BTC' ? 8 : 6;
        const txt = a.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
        return `${sign}${txt} ${REFS[ref].unit}`;
    }
    const fmtPct = (p) => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
    function fmtAmt(a, sym) {
        const x = Math.abs(a);
        if (/^(W?BTC|CBBTC)$/i.test(String(sym || ''))) return x.toLocaleString('pt-BR', { minimumFractionDigits: 8, maximumFractionDigits: 8 });
        return x === 0 ? '0' : x.toLocaleString('pt-BR', { maximumFractionDigits: x >= 1000 ? 2 : x >= 1 ? 4 : 6, maximumSignificantDigits: x < 1 ? 4 : undefined });
    }

    // ------------------------------------------------------------------ leitura do histórico
    async function fetchPages(url, label, maxPages = 30) {
        const all = [];
        let next = null;
        for (let page = 1; page <= maxPages; page++) {
            const u = new URL(url);
            if (next) Object.entries(next).forEach(([k, v]) => u.searchParams.set(k, v));
            const res = await fetch(u.toString());
            if (!res.ok) { if (page === 1) throw new Error(`histórico indisponível (${res.status})`); break; }
            const json = await res.json();
            if (Array.isArray(json.items)) all.push(...json.items);
            setProgress(`Lendo ${label}: ${all.length}…`);
            if (!json.next_page_params) break;
            next = json.next_page_params;
        }
        return all;
    }

    function setProgress(text) {
        st.progress = text;
        const el = document.getElementById('audit-status-text');
        if (el && st.loading) el.textContent = text;
        const hs = document.getElementById('home-chart-status');
        if (hs && st.loading && !st.events.length) hs.textContent = text;
    }

    const lower = (h) => String(h || '').toLowerCase();

    async function buildEvents(wallet) {
        const [txs, transfers, internals] = await Promise.all([
            fetchPages(`${BLOCKSCOUT}/addresses/${wallet}/transactions`, 'transações'),
            fetchPages(`${BLOCKSCOUT}/addresses/${wallet}/token-transfers`, 'movimentos de moedas'),
            fetchPages(`${BLOCKSCOUT}/addresses/${wallet}/internal-transactions`, 'movimentos internos', 15)
        ]);
        const map = new Map();
        const get = (hash, ts) => {
            const h = lower(hash);
            if (!map.has(h)) map.set(h, { hash: h, unix: Math.floor(new Date(ts).getTime() / 1000), to: '', method: '', ok: true, gasPol: 0, items: [], contractTouched: false, fromSelf: false, block: 0 });
            return map.get(h);
        };
        for (const tx of txs) {
            const e = get(tx.hash, tx.timestamp);
            e.block = Number(tx.block_number || tx.block || 0) || e.block;
            const from = lower(tx.from?.hash), to = lower(tx.to?.hash);
            e.to = to; e.method = tx.method || ''; e.ok = tx.status === 'ok';
            e.fromSelf = from === wallet;
            if (from === wallet && tx.fee?.value) e.gasPol += Number(global.ethers.utils.formatEther(tx.fee.value));
            if (to && to !== wallet && tx.to?.is_contract) e.contractTouched = true;
            if (!e.ok) continue;
            const v = tx.value ? Number(global.ethers.utils.formatEther(tx.value)) : 0;
            if (v > 0) {
                if (to === wallet && from !== wallet) { e.items.push({ sym: 'POL', kind: 'POL', amt: v, dir: 1, peerC: Boolean(tx.from?.is_contract) }); if (tx.from?.is_contract) e.contractTouched = true; }
                else if (from === wallet && to !== wallet) e.items.push({ sym: 'POL', kind: 'POL', amt: v, dir: -1, peerC: Boolean(tx.to?.is_contract) });
            }
        }
        for (const it of internals) {
            if (!it.transaction_hash) continue;
            const v = it.value ? Number(global.ethers.utils.formatEther(it.value)) : 0;
            if (!(v > 0) || it.success === false) continue;
            const from = lower(it.from?.hash), to = lower(it.to?.hash);
            const e = get(it.transaction_hash, it.timestamp);
            if (to === wallet && from !== wallet) { e.items.push({ sym: 'POL', kind: 'POL', amt: v, dir: 1, peerC: true }); e.contractTouched = true; }
        }
        for (const tr of transfers) {
            if (!tr.transaction_hash || tr.token?.type !== 'ERC-20' || tr.token?.is_spam === true) continue;
            const meta = TOKENS[lower(tr.token?.address_hash || tr.token?.address)];
            if (!meta) continue;
            const amt = Number(global.ethers.utils.formatUnits(tr.total?.value || '0', meta.decimals));
            if (!(amt > 0)) continue;
            const from = lower(tr.from?.hash), to = lower(tr.to?.hash);
            const e = get(tr.transaction_hash, tr.timestamp);
            e.block = e.block || Number(tr.block_number || 0);
            if (to === wallet && from !== wallet) { e.items.push({ sym: meta.symbol, kind: meta.kind, amt, dir: 1, peerC: Boolean(tr.from?.is_contract) }); if (tr.from?.is_contract) e.contractTouched = true; }
            else if (from === wallet && to !== wallet) { e.items.push({ sym: meta.symbol, kind: meta.kind, amt, dir: -1, peerC: Boolean(tr.to?.is_contract) }); if (tr.to?.is_contract) e.contractTouched = true; }
        }
        const list = [...map.values()].sort((a, b) => a.unix - b.unix);
        await addNativeReturns(list, wallet);
        return list.map(classify);
    }

    // POL nativo que volta de contratos (troca que paga em POL, tirar do render, sobra devolvida)
    // não aparece no serviço de histórico da Polygon (transações internas não processadas).
    // Ele é deduzido dos recibos de cada transação: o contrato desembrulha WPOL (evento Withdrawal)
    // e manda o POL para você; e o que você mandou a mais e não foi embrulhado (Deposit) volta.
    const T_DEPOSIT = '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c';
    const T_WITHDRAWAL = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65';
    async function fetchReceipts(hashes) {
        const urls = global.RdeskRegistry?.getChain(137)?.rpcs || [];
        const out = {};
        for (let i = 0; i < hashes.length; i += 20) {
            const chunk = hashes.slice(i, i + 20);
            const body = chunk.map((h, k) => ({ jsonrpc: '2.0', id: k, method: 'eth_getTransactionReceipt', params: [h] }));
            for (const u of urls) {
                try {
                    const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
                    const j = await r.json();
                    if (!Array.isArray(j)) throw new Error('sem lote');
                    j.forEach((x) => { if (x && x.result) out[chunk[x.id]] = x.result; });
                    if (chunk.every((h) => out[h])) break;
                } catch (e) { /* tenta o próximo servidor */ }
            }
            setProgress(`Conferindo POL devolvido pelos contratos: ${Math.min(i + 20, hashes.length)} de ${hashes.length}…`);
        }
        return out;
    }
    // Só contratos que embrulham/desembrulham POL de forma conhecida (Uniswap e o próprio WPOL).
    // Em pontes e agregadores o POL enviado segue adiante sem virar WPOL: lá não há "sobra" a deduzir.
    const NATIVE_AWARE = new Set([
        NFPM, WPOL,
        '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', // SwapRouter02
        '0xec7be89e9d109e7e3fec59c222cf297125fefda2', // Universal Router
        '0x643770e279d5d0733f21d6dc03a8efbabf3255b4', // Universal Router (anterior)
        '0x1095692a6237d83c6a72f3f5efedb9a670c49223'  // Universal Router (v4)
    ]);
    // Saldo REAL de POL nativo no fim de cada dia com movimento, lido da rede (o histórico não mostra
    // todo POL que chega de contratos). Corrige o gráfico mesmo quando algum retorno não foi deduzido.
    async function rpcBatch(calls) {
        const urls = global.RdeskRegistry?.getChain(137)?.rpcs || [];
        const out = new Array(calls.length).fill(null);
        for (let i = 0; i < calls.length; i += 20) {
            const chunk = calls.slice(i, i + 20);
            const body = chunk.map((c, k) => ({ jsonrpc: '2.0', id: k, method: c[0], params: c[1] }));
            for (const u of urls) {
                try {
                    const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
                    const j = await r.json();
                    if (!Array.isArray(j)) throw new Error('sem lote');
                    j.forEach((x) => { if (x && x.result !== undefined && x.result !== null) out[i + x.id] = x.result; });
                    if (chunk.every((_, k) => out[i + k] !== null)) break;
                } catch (e) { /* próximo servidor */ }
            }
        }
        return out;
    }
    async function loadNativeBalances(wallet) {
        const lastBlockOfDay = {};
        st.events.forEach((e) => { const k = dayKey(e.unix); if (e.block > (lastBlockOfDay[k] || 0)) lastBlockOfDay[k] = e.block; });
        const days = Object.keys(lastBlockOfDay).sort().slice(-400);
        if (!days.length) return;
        setProgress('Conferindo o saldo de POL de cada dia…');
        const res = await rpcBatch(days.map((k) => ['eth_getBalance', [wallet, `0x${lastBlockOfDay[k].toString(16)}`]]));
        days.forEach((k, i) => { if (res[i]) st.nativeEnd[k] = Number(global.ethers.utils.formatEther(res[i])); });
    }

    async function addNativeReturns(list, wallet) {
        const need = list.filter((e) => e.ok && e.fromSelf && NATIVE_AWARE.has(e.to) && !e.nativeChecked && !/^approve$/i.test(e.method || ''));
        if (!need.length) return;
        const receipts = await fetchReceipts(need.map((e) => e.hash));
        const word = (hex) => Number(global.ethers.utils.formatEther(global.ethers.BigNumber.from(hex || '0x0')));
        need.forEach((e) => {
            const rc = receipts[e.hash];
            if (!rc) return;
            let wrapped = 0, unwrapped = 0;
            (rc.logs || []).forEach((lg) => {
                if (lower(lg.address) !== WPOL || !lg.topics || lg.topics.length < 2) return;
                const who = `0x${lg.topics[1].slice(26)}`.toLowerCase();
                // contrato que embrulha/desembrulha: o próprio destino da transação; se foi direto no WPOL, é você
                if (who !== (e.to === WPOL ? wallet : e.to)) return;
                if (lg.topics[0] === T_DEPOSIT) wrapped += word(lg.data);
                if (lg.topics[0] === T_WITHDRAWAL) unwrapped += word(lg.data);
            });
            const sentNative = e.items.filter((i) => i.sym === 'POL' && i.dir < 0).reduce((s, i) => s + i.amt, 0);
            const refund = sentNative > 0 ? sentNative - wrapped : 0;
            if (refund > 1e-9) { // o que não foi usado voltou: o envio real foi menor
                const outItem = e.items.find((i) => i.sym === 'POL' && i.dir < 0);
                outItem.amt = Math.max(0, outItem.amt - refund);
                if (outItem.amt < 1e-12) e.items.splice(e.items.indexOf(outItem), 1);
            }
            if (unwrapped > 1e-9) e.items.push({ sym: 'POL', kind: 'POL', amt: unwrapped, dir: 1, peerC: true });
            e.nativeChecked = true;
        });
    }

    // Tipo e título em linguagem simples
    function classify(e) {
        const ins = e.items.filter((i) => i.dir > 0), outs = e.items.filter((i) => i.dir < 0);
        const list = (arr) => [...new Set(arr.map((i) => (i.sym === 'WPOL' ? 'POL' : i.sym)))].join(' e ');
        let type = 'OTHER', title = 'Interagiu com um contrato', auto = 'DEFI';
        if (!e.ok) { type = 'FAIL'; title = 'Operação que falhou (só a taxa foi cobrada)'; }
        else if (e.to === NFPM) {
            if (outs.length && !ins.length) { type = 'RENDER_IN'; title = 'Colocou para render'; }
            else if (ins.length && !outs.length) { type = 'RENDER_OUT'; title = 'Tirou do render'; }
            else if (ins.length && outs.length) { type = 'RENDER_IN'; title = 'Ajustou o render'; }
            else { type = 'RENDER'; title = 'Ajuste no render'; }
        } else if (e.to === WPOL && ins.length + outs.length) {
            type = 'WRAP'; title = outs.some((o) => o.sym === 'POL') ? 'Converteu POL em WPOL' : 'Converteu WPOL em POL';
        } else if (ins.length && outs.length) {
            type = 'SWAP'; title = `Trocou ${list(outs)} por ${list(ins)}`;
        } else if (ins.length) {
            const fromPerson = ins.every((i) => !i.peerC) && !e.contractTouched;
            type = fromPerson ? 'RECEIVE' : 'RECEIVE_C'; title = `Recebeu ${list(ins)}`;
            if (fromPerson) auto = 'IN';
        } else if (outs.length) {
            const toPerson = outs.every((o) => !o.peerC) && !e.contractTouched;
            type = toPerson ? 'SEND' : 'SEND_C'; title = `Enviou ${list(outs)}${toPerson ? '' : ' para um contrato'}`;
            if (toPerson) auto = 'OUT';
        } else if (/approve/i.test(e.method)) {
            type = 'APPROVE'; title = `Autorizou o uso de ${TOKENS[e.to]?.symbol || 'uma moeda'}`;
        }
        return { ...e, type, title, auto };
    }

    // Valores na data (dólar e real), calculados quando os preços históricos chegam
    function valued(e) {
        const key = dayKey(e.unix);
        const fx = fxOn(key);
        const ex = st.exact[e.hash];
        // Preço no momento exato da transação quando disponível; senão, o preço do dia
        const price = (kind) => (ex && ex[kind] > 0 ? ex[kind] : usdOn(kind, key));
        let inUsd = 0, outUsd = 0;
        e.items.forEach((i) => { const u = i.amt * price(i.kind); if (i.dir > 0) inUsd += u; else outUsd += u; });
        const gasUsd = e.gasPol * price('POL');
        const cls = st.overrides[e.hash] || e.auto;
        const refUsd = st.ref === 'USD' ? 1 : st.ref === 'BRL' ? 1 / fx : price(st.ref);
        return { key, fx, inUsd, outUsd, gasUsd, cls, refUsd };
    }

    // Entradas e saídas valem pelo preço do minuto em que aconteceram (POL oscila muito no mesmo dia)
    async function loadExactPrices() {
        const targets = st.events.filter((e) => e.items.length && ((st.overrides[e.hash] || e.auto) !== 'DEFI' || e.type === 'RECEIVE_C' || e.type === 'SEND_C'));
        if (!targets.length) return;
        const coins = { POL: `polygon:${WPOL}`, BTC: 'coingecko:bitcoin', ETH: 'coingecko:ethereum' };
        const ts = [...new Set(targets.map((e) => e.unix))].slice(-150);
        const q = {};
        Object.values(coins).forEach((c) => { q[c] = ts; });
        try {
            const res = await fetch(`https://coins.llama.fi/batchHistorical?coins=${encodeURIComponent(JSON.stringify(q))}&searchWidth=1h`);
            if (!res.ok) return;
            const data = (await res.json())?.coins || {};
            const nearest = (list, t) => {
                let best = null;
                (list || []).forEach((p) => { if (!best || Math.abs(p.timestamp - t) < Math.abs(best.timestamp - t)) best = p; });
                return best && Math.abs(best.timestamp - t) <= 3600 ? Number(best.price) : null;
            };
            targets.forEach((e) => {
                const ex = {};
                Object.entries(coins).forEach(([kind, c]) => { const p = nearest(data[c]?.prices, e.unix); if (p > 0) ex[kind] = p; });
                if (Object.keys(ex).length) st.exact[e.hash] = ex;
            });
        } catch (err) {}
    }

    // ------------------------------------------------------------------ cálculo: resultado e série
    function liveEquityUsd() {
        const free = (W()?.getBalances() || []).reduce((s, b) => s + (b.usdValue || 0), 0);
        const lp = global.RdeskDefi?.getLivePositionsUsd?.() || 0;
        return free + lp;
    }

    function computeResult() {
        let inUsdRef = 0, outUsdRef = 0, inBrl = 0, outBrl = 0;
        st.events.forEach((e) => {
            const v = valued(e);
            if (v.cls === 'IN') { const u = v.inUsd || v.outUsd; inUsdRef += u / v.refUsd; inBrl += u * v.fx; }
            else if (v.cls === 'OUT') { const u = v.outUsd || v.inUsd; outUsdRef += u / v.refUsd; outBrl += u * v.fx; }
        });
        const eqUsd = liveEquityUsd();
        const usdBrl = W()?.getPrices().USD_BRL || 5.4;
        const eqRef = eqUsd / (refUsdNow() || 1);
        const eqBrl = eqUsd * usdBrl;
        const pnlRef = eqRef + outUsdRef - inUsdRef;
        const pnlBrl = eqBrl + outBrl - inBrl;
        return { inRef: inUsdRef, outRef: outUsdRef, eqRef, pnlRef, inBrl, outBrl, eqBrl, pnlBrl, pct: inUsdRef > 0 ? (pnlRef / inUsdRef) * 100 : null };
    }

    // Patrimônio dia a dia: refaz os saldos da Polygon a partir das transações (moedas colocadas
    // para render continuam contando como suas) e avalia com o preço de cada dia.
    function computeSeries() {
        if (!st.events.length) return [];
        const hold = { POL: 0, USD: 0, BRL: 0, ETH: 0, BTC: 0 }; // POL aqui = WPOL (o nativo fica em 'native')
        let native = 0;
        const pool = { POL: 0, USD: 0, BRL: 0, ETH: 0, BTC: 0 };
        const byDay = new Map();
        st.events.forEach((e) => { const k = dayKey(e.unix); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); });
        const first = new Date(`${dayKey(st.events[0].unix)}T00:00:00Z`).getTime();
        const today = todayKey();
        const pts = [];
        for (let t = first; ; t += 86400000) {
            const key = new Date(t).toISOString().slice(0, 10);
            let flowIn = 0, flowOut = 0;
            (byDay.get(key) || []).forEach((e) => {
                native -= e.gasPol;
                e.items.forEach((i) => { if (i.sym === 'POL') native += i.dir * i.amt; else hold[i.kind] += i.dir * i.amt; });
                if (e.type.startsWith('RENDER')) {
                    // Dentro do render as moedas se convertem umas nas outras (POL vira USDT e vice-versa).
                    // Por isso o que volta tira do "cesto" uma FRAÇÃO do valor, e não as mesmas moedas;
                    // devolver 80% ou mais do valor conta como posição encerrada (cesto zerado).
                    const priceNow = (k) => usdOn(k, key);
                    const basketUsd = Object.keys(pool).reduce((s, k) => s + pool[k] * priceNow(k), 0);
                    e.items.filter((i) => i.dir < 0).forEach((i) => { pool[i.kind] += i.amt; });
                    const backUsd = e.items.filter((i) => i.dir > 0).reduce((s, i) => s + i.amt * priceNow(i.kind), 0);
                    if (backUsd > 0 && basketUsd > 0) {
                        const frac = backUsd / basketUsd >= 0.8 ? 1 : backUsd / basketUsd;
                        Object.keys(pool).forEach((k) => { pool[k] *= (1 - frac); });
                    }
                }
                const v = valued(e);
                if (v.cls === 'IN') flowIn += (v.inUsd || v.outUsd) / v.refUsd;
                if (v.cls === 'OUT') flowOut += (v.outUsd || v.inUsd) / v.refUsd;
            });
            if (Number.isFinite(st.nativeEnd[key])) native = st.nativeEnd[key]; // saldo real lido da rede
            let usd = Math.max(0, native) * usdOn('POL', key);
            Object.keys(hold).forEach((k) => { usd += (Math.max(0, hold[k]) + pool[k]) * usdOn(k, key); });
            pts.push({ key, t: t / 1000 + 43200, ref: usd / refUsdOn(key), usd, flowIn, flowOut });
            if (key >= today) break;
            if (pts.length > 2000) break;
        }
        // Último ponto = agora, com o valor ao vivo de todas as redes
        const live = liveEquityUsd();
        const last = pts[pts.length - 1];
        last.usd = live; last.ref = live / (refUsdNow() || 1); last.t = Date.now() / 1000; last.live = true;
        return pts;
    }

    // ------------------------------------------------------------------ carregar
    function cacheKey(w) { return CACHE_PREFIX + w; }
    function saveCache() {
        try {
            const slim = st.events.map((e) => ({ h: e.hash, u: e.unix, t: e.to, m: e.method, o: e.ok ? 1 : 0, g: e.gasPol, c: e.contractTouched ? 1 : 0, f: e.fromSelf ? 1 : 0, n: e.nativeChecked ? 1 : 0, b: e.block || 0, i: e.items.map((i) => [i.sym, i.kind, i.amt, i.dir, i.peerC ? 1 : 0]) }));
            localStorage.setItem(cacheKey(st.wallet), JSON.stringify({ at: st.savedAt, ev: slim, nat: st.nativeEnd }));
        } catch (e) {}
    }
    function loadCache(w) {
        try {
            const raw = JSON.parse(localStorage.getItem(cacheKey(w)) || 'null');
            if (!raw || !Array.isArray(raw.ev)) return false;
            st.events = raw.ev.map((x) => classify({ hash: x.h, unix: x.u, to: x.t, method: x.m, ok: Boolean(x.o), gasPol: x.g, contractTouched: Boolean(x.c), fromSelf: Boolean(x.f), nativeChecked: Boolean(x.n), block: x.b || 0, items: x.i.map((a) => ({ sym: a[0], kind: a[1], amt: a[2], dir: a[3], peerC: Boolean(a[4]) })) }));
            st.savedAt = raw.at || 0;
            st.nativeEnd = raw.nat || {};
            return true;
        } catch (e) { return false; }
    }
    function loadOverrides(w) {
        st.overrides = {};
        try {
            const addr = W()?.getAddress() || '';
            [`rdesk_v22_audit_ov_${addr}`, `rdesk_v22_audit_ov_${w}`].forEach((k) => Object.assign(st.overrides, JSON.parse(localStorage.getItem(k) || '{}')));
        } catch (e) {}
    }
    function saveOverrides() { try { localStorage.setItem(`rdesk_v22_audit_ov_${st.wallet}`, JSON.stringify(st.overrides)); } catch (e) {} }

    let loadingPromise = null;
    async function load(force = false) {
        const w = lower(W()?.getAddress());
        if (!w) { st.wallet = ''; st.events = []; renderAll(); return; }
        if (w !== st.wallet) {
            st.wallet = w; st.events = []; st.savedAt = 0; st.seriesReady = false; st.shown = PAGE_SIZE;
            loadOverrides(w);
            if (loadCache(w)) renderAll();
        }
        if (!force && st.savedAt && Date.now() - st.savedAt < 2 * 60 * 1000 && st.seriesReady) { renderAll(); return; }
        if (loadingPromise) return loadingPromise;
        loadingPromise = (async () => {
            st.loading = true; st.error = '';
            setProgress('Lendo seu histórico desde a primeira transação…');
            renderAll();
            try {
                const events = await buildEvents(w);
                if (lower(W()?.getAddress()) !== w) return; // trocou de carteira no meio
                st.events = events;
                st.savedAt = Date.now();
                setProgress('Buscando os preços de cada dia…');
                st.nativeEnd = {};
                await Promise.all([loadPriceSeries(events.length ? events[0].unix : Date.now() / 1000 - 30 * 86400), loadExactPrices(), loadNativeBalances(w).catch(() => {})]);
                saveCache();
            } catch (err) {
                st.error = 'Não deu para ler o histórico agora (o serviço de histórico não respondeu). Toque em Atualizar para tentar de novo.';
                if (st.events.length && !st.seriesReady) await loadPriceSeries(st.events[0].unix).catch(() => {});
            } finally {
                st.loading = false;
                loadingPromise = null;
                renderAll();
            }
        })();
        return loadingPromise;
    }

    // ------------------------------------------------------------------ desenho: tela inicial
    function renderBalanceRef() {
        const acc = W()?.getActiveAccount?.() || (W()?.getAddress() ? {} : null);
        const refEl = document.getElementById('hero-total-usd');
        const chgEl = document.getElementById('hero-ref-change');
        const btn = document.getElementById('btn-ref-picker');
        if (btn) btn.innerHTML = `Comparando com <strong>${esc(REFS[st.ref].name)}</strong> ▾`;
        if (!acc) return;
        const total = (W()?.getBalances() || []).reduce((s, b) => s + (b.usdValue || 0), 0) + (global.RdeskDefi?.getLivePositionsUsd?.() || 0);
        if (refEl) {
            refEl.textContent = st.ref === 'BRL'
                ? `≈ US$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `≈ ${fmtRef(total / (refUsdNow() || 1))}`;
        }
        if (chgEl) {
            const c = portfolioChangeVsRef();
            chgEl.hidden = c === null;
            if (c !== null) {
                chgEl.textContent = `${fmtPct(c)} em 24 h frente ao ${REFS[st.ref].name.split(' ')[0]}`;
                chgEl.className = `chg ${c > 0.005 ? 'up' : c < -0.005 ? 'down' : ''}`;
            }
        }
    }

    function renderHomeChart() {
        const card = document.getElementById('home-chart-card');
        if (!card) return;
        const hasWallet = Boolean(W()?.getAddress());
        card.hidden = !hasWallet;
        if (!hasWallet) return;
        const status = document.getElementById('home-chart-status');
        const unit = document.getElementById('home-chart-unit');
        if (unit) unit.textContent = `em ${REFS[st.ref].unit === 'US$' ? 'dólares' : REFS[st.ref].unit}`;
        let pts = computeSeries();
        if (!pts.length) {
            chart.set([], null);
            if (status) status.textContent = st.loading ? (st.progress || 'Lendo seu histórico…') : (st.error || 'Ainda não há movimentações na Polygon para desenhar o gráfico.');
            return;
        }
        if (st.range !== 'all') pts = pts.slice(-Number(st.range) - 1);
        const others = (W()?.getBalances() || []).some((b) => b.chainId !== 137 && b.usdValue > 0.5);
        if (status) status.textContent = st.loading ? 'Atualizando…' : (st.error || (others ? 'O histórico é da rede Polygon; as outras redes entram a partir de hoje.' : ''));
        chart.set(pts, st.ref);
    }

    // Gráfico de linha leve (canvas próprio), com toque para ver cada dia
    const chart = (() => {
        let canvas, tip, data = [], ref = 'BTC', hover = null;
        function ensure() {
            const host = document.getElementById('home-chart');
            if (!host) return false;
            if (!canvas || !host.contains(canvas)) {
                canvas = document.createElement('canvas');
                canvas.className = 'eq-canvas';
                canvas.setAttribute('role', 'img');
                tip = document.createElement('div');
                tip.className = 'eq-tip';
                tip.hidden = true;
                host.replaceChildren(canvas, tip);
                const pick = (ev) => {
                    if (!data.length) return;
                    const r = canvas.getBoundingClientRect();
                    const x = ev.clientX - r.left;
                    const i = Math.round(((x - 8) / Math.max(1, r.width - 16)) * (data.length - 1));
                    hover = Math.max(0, Math.min(data.length - 1, i));
                    draw();
                };
                canvas.addEventListener('pointerdown', (ev) => { try { canvas.setPointerCapture(ev.pointerId); } catch (e) {} pick(ev); });
                canvas.addEventListener('pointermove', (ev) => { if (ev.buttons || ev.pointerType === 'mouse') pick(ev); });
                canvas.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse' && hover !== null) { hover = null; draw(); } }); // no toque, a informação fica até o próximo toque
                if (global.ResizeObserver) new ResizeObserver(() => draw()).observe(host);
            }
            return true;
        }
        function draw() {
            if (!ensure()) return;
            const w = Math.max(240, canvas.parentElement.clientWidth || 320), h = 170;
            const dpr = global.devicePixelRatio || 1;
            canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
            canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);
            if (data.length < 2) {
                ctx.fillStyle = '#7a8498'; ctx.font = '13px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(data.length ? 'Poucos dados ainda' : 'Carregando…', w / 2, h / 2);
                tip.hidden = true;
                canvas.setAttribute('aria-label', 'Gráfico do patrimônio sem dados ainda');
                return;
            }
            const pad = { l: 8, r: 8, t: 14, b: 18 };
            const vals = data.map((p) => p.ref);
            let lo = Math.min(...vals), hi = Math.max(...vals);
            if (hi - lo < hi * 0.02) { const m = (hi + lo) / 2 || 1; lo = m * 0.98; hi = m * 1.02; }
            const X = (i) => pad.l + (i / (data.length - 1)) * (w - pad.l - pad.r);
            const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
            const up = vals[vals.length - 1] >= vals[0];
            const color = up ? '#34d399' : '#fb7185';
            const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
            grad.addColorStop(0, up ? 'rgba(52,211,153,0.28)' : 'rgba(251,113,133,0.25)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.beginPath();
            data.forEach((p, i) => (i ? ctx.lineTo(X(i), Y(p.ref)) : ctx.moveTo(X(i), Y(p.ref))));
            ctx.lineTo(X(data.length - 1), h - pad.b); ctx.lineTo(X(0), h - pad.b); ctx.closePath();
            ctx.fillStyle = grad; ctx.fill();
            ctx.beginPath();
            data.forEach((p, i) => (i ? ctx.lineTo(X(i), Y(p.ref)) : ctx.moveTo(X(i), Y(p.ref))));
            ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.stroke();
            // entradas e saídas
            data.forEach((p, i) => {
                if (p.flowIn > 0) { ctx.fillStyle = '#34d399'; ctx.beginPath(); ctx.arc(X(i), Y(p.ref), 4.5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#0c0f16'; ctx.lineWidth = 2; ctx.stroke(); }
                if (p.flowOut > 0) { ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(X(i), Y(p.ref), 4.5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#0c0f16'; ctx.lineWidth = 2; ctx.stroke(); }
            });
            // ponto ao vivo pulsando
            const li = data.length - 1;
            ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(li), Y(data[li].ref), 4, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = up ? 'rgba(52,211,153,0.25)' : 'rgba(251,113,133,0.25)';
            ctx.beginPath(); ctx.arc(X(li), Y(data[li].ref), 9, 0, Math.PI * 2); ctx.fill();
            // datas nas pontas
            ctx.fillStyle = '#7a8498'; ctx.font = '11px Inter, system-ui, sans-serif'; ctx.textBaseline = 'alphabetic';
            const lab = (p) => (p.live ? 'agora' : new Date(p.t * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }));
            ctx.textAlign = 'left'; ctx.fillText(lab(data[0]), pad.l, h - 3);
            ctx.textAlign = 'right'; ctx.fillText(lab(data[li]), w - pad.r, h - 3);
            // mira do toque
            if (hover !== null && data[hover]) {
                const p = data[hover];
                ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
                ctx.beginPath(); ctx.moveTo(X(hover), pad.t); ctx.lineTo(X(hover), h - pad.b); ctx.stroke(); ctx.setLineDash([]);
                ctx.fillStyle = '#f4f6fb'; ctx.beginPath(); ctx.arc(X(hover), Y(p.ref), 4, 0, Math.PI * 2); ctx.fill();
                const when = p.live ? 'Agora' : new Date(p.t * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
                const flows = [p.flowIn > 0 ? `entrou ${fmtRef(p.flowIn, ref)}` : '', p.flowOut > 0 ? `saiu ${fmtRef(p.flowOut, ref)}` : ''].filter(Boolean).join(' • ');
                const usdBrl = W()?.getPrices().USD_BRL || 5.4;
                tip.hidden = false;
                tip.innerHTML = `<strong>${esc(when)}</strong><span class="money">${esc(fmtRef(p.ref, ref))} • ${esc(fmtBRL(p.usd * (p.live ? usdBrl : fxOn(p.key))))}</span>${flows ? `<small class="money">${esc(flows)}</small>` : ''}`;
            } else tip.hidden = true;
            // Ganho do período SEM contar dinheiro que entrou ou saiu (saque não é prejuízo)
            const flowsNet = data.slice(1).reduce((s, p) => s + p.flowIn - p.flowOut, 0);
            const gain = vals[li] - vals[0] - flowsNet;
            const base = vals[0] + data.slice(1).reduce((s, p) => s + p.flowIn, 0);
            const pct = base > 0 ? (gain / base) * 100 : null;
            canvas.setAttribute('aria-label', `Patrimônio em ${REFS[ref].name}: de ${fmtRef(vals[0], ref)} para ${fmtRef(vals[li], ref)}; ganho no período ${fmtRef(gain, ref, { sign: true })}`);
            const sum = document.getElementById('home-chart-summary');
            if (sum) {
                sum.textContent = `${gain >= 0 ? 'Ganho' : 'Perda'} no período: ${fmtRef(gain, ref, { sign: true })}${pct !== null ? ` (${fmtPct(pct)})` : ''}`;
                sum.className = `chg money ${gain > 0 ? 'up' : gain < 0 ? 'down' : ''}`;
            }
        }
        return {
            set(pts, r) { data = pts || []; ref = r || ref; if (hover !== null && hover >= data.length) hover = null; draw(); },
            redraw: draw,
            getState: () => ({ points: data.length, hover, first: data[0] ? data[0].ref : null, last: data.length ? data[data.length - 1].ref : null, flowsIn: data.filter((p) => p.flowIn > 0).length, flowsOut: data.filter((p) => p.flowOut > 0).length, tip: tip && !tip.hidden ? tip.textContent : '' })
        };
    })();

    // ------------------------------------------------------------------ desenho: extrato
    const TYPE_ICON = {
        RECEIVE: ['↓', 'in'], RECEIVE_C: ['↓', 'in'], SEND: ['↑', 'out'], SEND_C: ['↑', 'out'], SWAP: ['⇄', 'swap'],
        RENDER_IN: ['↗', 'render'], RENDER_OUT: ['↙', 'render'], RENDER: ['↗', 'render'], WRAP: ['⇄', 'swap'],
        APPROVE: ['✓', 'neutral'], FAIL: ['!', 'fail'], OTHER: ['•', 'neutral']
    };
    const CLASS_LABEL = { IN: 'Entrada de dinheiro', OUT: 'Saída de dinheiro', DEFI: 'Movimento interno', IGNORE: 'Ignorado na conta' };
    function matchesFilter(e, cls) {
        switch (st.filter) {
            case 'IN': return cls === 'IN';
            case 'OUT': return cls === 'OUT';
            case 'SWAP': return e.type === 'SWAP' || e.type === 'WRAP';
            case 'RENDER': return e.type.startsWith('RENDER');
            default: return true;
        }
    }
    function dayTitle(key) {
        const t = todayKey();
        const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        if (key === t) return 'Hoje';
        if (key === y) return 'Ontem';
        return new Date(`${key}T12:00:00Z`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: key.slice(0, 4) === t.slice(0, 4) ? undefined : 'numeric' });
    }

    function renderExtrato() {
        const box = document.getElementById('extrato-list');
        if (!box) return;
        const r = computeResult();
        const has = Boolean(W()?.getAddress());
        const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
        const status = document.getElementById('audit-status-text');
        if (status) status.textContent = !has ? 'Abra uma carteira para ver o extrato.' : st.loading ? (st.progress || 'Lendo…') : st.error || (st.events.length ? `${st.events.length} transações na rede Polygon desde ${dayTitle(dayKey(st.events[0].unix)).toLowerCase()}.` : 'Nenhuma transação ainda.');
        const prog = document.getElementById('audit-progress-wrap');
        if (prog) prog.style.display = st.loading ? 'block' : 'none';
        set('audit-ref-name', REFS[st.ref].name);
        const pnlEl = document.getElementById('audit-kpi-pnl');
        if (pnlEl) {
            pnlEl.textContent = has && st.events.length ? fmtRef(r.pnlRef, st.ref, { sign: true }) + (r.pct !== null ? ` (${fmtPct(r.pct)})` : '') : '—';
            pnlEl.className = `money ${r.pnlRef > 0 ? 'up' : r.pnlRef < 0 ? 'down' : ''}`;
        }
        set('audit-kpi-pnl-brl', has && st.events.length ? `Em reais: ${r.pnlBrl >= 0 ? '+' : '−'}${fmtBRL(Math.abs(r.pnlBrl))}` : '');
        set('audit-kpi-in', fmtRef(r.inRef));
        set('audit-kpi-out', fmtRef(r.outRef));
        set('audit-kpi-equity', fmtRef(r.eqRef));
        const pill = document.getElementById('audit-trend-pill');
        if (pill) {
            pill.className = `pill-badge ${!st.events.length ? '' : r.pnlRef >= 0 ? 'safe' : 'danger'}`;
            pill.textContent = !st.events.length ? 'Sem dados' : `${r.pnlRef >= 0 ? 'Lucro' : 'Prejuízo'} em ${REFS[st.ref].unit === 'US$' ? 'dólar' : REFS[st.ref].unit}`;
        }

        if (!has) { box.innerHTML = '<div class="empty-state">Abra uma carteira para ver o extrato.</div>'; return; }
        if (!st.events.length) {
            box.innerHTML = st.loading ? '<div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div>' : `<div class="empty-state">${esc(st.error || 'Nenhuma transação na rede Polygon ainda.')}</div>`;
            return;
        }
        const usdBrl = W()?.getPrices().USD_BRL || 5.4;
        const rows = st.events.slice().reverse().map((e) => ({ e, v: valued(e) })).filter(({ e, v }) => matchesFilter(e, v.cls));
        const page = rows.slice(0, st.shown);
        let html = '', lastDay = '';
        page.forEach(({ e, v }) => {
            if (v.key !== lastDay) { html += `<h3 class="extrato-day">${esc(dayTitle(v.key))}</h3>`; lastDay = v.key; }
            const [ico, tone] = TYPE_ICON[e.type] || TYPE_ICON.OTHER;
            const amounts = e.items.map((i) => `${i.dir > 0 ? '+' : '−'}${fmtAmt(i.amt, i.sym)} ${i.sym}`).join(' · ');
            const time = new Date(e.unix * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            let value = '', vTone = '';
            if (v.cls === 'IN') { value = `+${fmtBRL((v.inUsd || v.outUsd) * v.fx)}`; vTone = 'up'; }
            else if (v.cls === 'OUT') { value = `−${fmtBRL((v.outUsd || v.inUsd) * v.fx)}`; vTone = 'down'; }
            else if (v.inUsd || v.outUsd) value = fmtBRL(Math.max(v.inUsd, v.outUsd) * v.fx);
            else value = `taxa ${fmtBRL(v.gasUsd * v.fx)}`;
            html += `<button type="button" class="extrato-row" data-hash="${esc(e.hash)}">
                <span class="ex-ico ${tone}" aria-hidden="true">${ico}</span>
                <span class="ex-main"><strong>${esc(e.title)}</strong><small>${esc(time)}${amounts ? ` · <span class="money">${esc(amounts)}</span>` : ''}${v.cls !== e.auto ? ' · <em>ajustado</em>' : ''}</small></span>
                <span class="ex-val money ${vTone}">${esc(value)}</span>
            </button>`;
        });
        if (!page.length) html = '<div class="empty-state">Nada neste filtro.</div>';
        box.innerHTML = html;
        box.querySelectorAll('.extrato-row').forEach((b) => { b.onclick = () => openDetail(b.getAttribute('data-hash')); });
        const more = document.getElementById('extrato-more');
        if (more) { more.hidden = rows.length <= st.shown; more.textContent = `Ver mais (${rows.length - st.shown} restantes)`; }
        void usdBrl;
    }

    function sheet(html) {
        const root = document.getElementById('ob-root');
        if (!root) return null;
        root.replaceChildren();
        const wrap = document.createElement('div');
        wrap.className = 'ob-overlay';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.innerHTML = `<div class="ob-sheet">${html}</div>`;
        wrap.addEventListener('click', (ev) => { if (ev.target === wrap) root.replaceChildren(); });
        root.appendChild(wrap);
        requestAnimationFrame(() => wrap.classList.add('open'));
        return wrap;
    }

    function openDetail(hash) {
        const e = st.events.find((x) => x.hash === hash);
        if (!e) return;
        const v = valued(e);
        const when = new Date(e.unix * 1000).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
        const items = e.items.map((i) => `<li><span>${i.dir > 0 ? 'Entrou' : 'Saiu'}</span><strong class="money">${i.dir > 0 ? '+' : '−'}${esc(fmtAmt(i.amt, i.sym))} ${esc(i.sym)}</strong></li>`).join('');
        const el = sheet(`
            <div class="ex-detail">
                <h2>${esc(e.title)}</h2>
                <p class="muted-sm">${esc(when)}</p>
                ${items ? `<ul class="ex-items">${items}</ul>` : ''}
                <ul class="ex-items">
                    <li><span>Valor na data</span><strong class="money">${esc(fmtBRL(Math.max(v.inUsd, v.outUsd) * v.fx))}</strong></li>
                    <li><span>Taxa da rede</span><strong class="money">${esc(fmtAmt(e.gasPol))} POL (${esc(fmtBRL(v.gasUsd * v.fx))})</strong></li>
                </ul>
                <h3>Como entra na conta do lucro</h3>
                <p class="muted-sm">Entradas e saídas de dinheiro mudam quanto você colocou na carteira. Movimentos internos (trocas, render) não contam como dinheiro novo.</p>
                <div class="chip-group ex-class" role="radiogroup" aria-label="Classificação">
                    ${['IN', 'OUT', 'DEFI', 'IGNORE'].map((c) => `<button type="button" class="chip ${v.cls === c ? 'active' : ''}" role="radio" aria-checked="${v.cls === c}" data-cls="${c}">${CLASS_LABEL[c]}</button>`).join('')}
                </div>
                ${v.cls !== e.auto ? `<button type="button" class="btn-text small" data-cls-reset>Voltar para a classificação automática (${esc(CLASS_LABEL[e.auto])})</button>` : ''}
                <a class="btn-soft ex-link" href="https://polygonscan.com/tx/${esc(e.hash)}" target="_blank" rel="noopener noreferrer">Ver no explorador da Polygon ↗</a>
                <button type="button" class="btn-primary" data-close>Fechar</button>
            </div>`);
        if (!el) return;
        el.querySelectorAll('[data-cls]').forEach((b) => {
            b.onclick = () => { st.overrides[e.hash] = b.getAttribute('data-cls'); if (st.overrides[e.hash] === e.auto) delete st.overrides[e.hash]; saveOverrides(); openDetail(hash); renderAll(); };
        });
        el.querySelector('[data-cls-reset]')?.addEventListener('click', () => { delete st.overrides[e.hash]; saveOverrides(); openDetail(hash); renderAll(); });
        el.querySelector('[data-close]').onclick = () => document.getElementById('ob-root').replaceChildren();
    }

    function exportCsv() {
        const lines = [['data', 'hora', 'tipo', 'descricao', 'classificacao', 'valor_brl_na_data', `valor_${REFS[st.ref].unit}_na_data`, 'taxa_pol', 'hash'].join(';')];
        st.events.forEach((e) => {
            const v = valued(e);
            const usd = Math.max(v.inUsd, v.outUsd);
            const d = new Date(e.unix * 1000);
            lines.push([v.key, d.toLocaleTimeString('pt-BR'), e.type, `"${e.title} ${e.items.map((i) => `${i.dir > 0 ? '+' : '-'}${i.amt} ${i.sym}`).join(' ')}"`, CLASS_LABEL[v.cls],
                (usd * v.fx).toFixed(2).replace('.', ','), String(usd / v.refUsd).replace('.', ','), String(e.gasPol).replace('.', ','), e.hash].join(';'));
        });
        const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `extrato-rdesk-${todayKey()}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    // ------------------------------------------------------------------ referência
    function setRef(id) {
        if (!REFS[id]) return;
        st.ref = id;
        try { localStorage.setItem(REF_KEY, id); } catch (e) {}
        W()?.renderHome?.();
        renderAll();
    }
    function openRefPicker() {
        const el = sheet(`
            <div class="ob-menu ref-picker">
                <h2>Comparar com qual moeda?</h2>
                <p class="muted-sm">É a sua régua: o gráfico, o lucro e a variação de cada moeda passam a mostrar se você ganhou ou perdeu <strong>em relação a ela</strong>.</p>
                ${Object.values(REFS).map((r) => `<button type="button" data-ref="${r.id}" class="${r.id === st.ref ? 'on' : ''}" aria-pressed="${r.id === st.ref}"><span>${r.id === 'BTC' ? '₿' : r.id === 'BRL' ? 'R$' : r.id === 'USD' ? '$' : 'Ξ'}</span><span class="ref-txt"><strong>${esc(r.name)}${r.id === 'BTC' ? ' (padrão)' : ''}</strong><small>${esc(r.hint)}</small></span></button>`).join('')}
            </div>`);
        el?.querySelectorAll('[data-ref]').forEach((b) => { b.onclick = () => { setRef(b.getAttribute('data-ref')); document.getElementById('ob-root').replaceChildren(); }; });
    }

    function renderAll() {
        renderBalanceRef();
        renderHomeChart();
        renderExtrato();
    }

    // ------------------------------------------------------------------ ligações
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('btn-ref-picker')?.addEventListener('click', openRefPicker);
        document.querySelectorAll('[data-open-ref]').forEach((b) => b.addEventListener('click', openRefPicker));
        document.getElementById('btn-open-extrato')?.addEventListener('click', () => document.querySelector('.nav-tab-btn[data-tab="audit"]')?.click());
        document.getElementById('btn-audit-refresh')?.addEventListener('click', () => load(true));
        document.getElementById('btn-export-audit-csv')?.addEventListener('click', exportCsv);
        document.getElementById('extrato-more')?.addEventListener('click', () => { st.shown += PAGE_SIZE; renderExtrato(); });
        document.querySelectorAll('#extrato-filters [data-xf]').forEach((b) => b.addEventListener('click', () => {
            document.querySelectorAll('#extrato-filters [data-xf]').forEach((x) => x.classList.toggle('active', x === b));
            st.filter = b.getAttribute('data-xf'); st.shown = PAGE_SIZE; renderExtrato();
        }));
        document.querySelectorAll('#home-chart-range [data-range]').forEach((b) => b.addEventListener('click', () => {
            document.querySelectorAll('#home-chart-range [data-range]').forEach((x) => x.classList.toggle('active', x === b));
            st.range = b.getAttribute('data-range'); renderHomeChart();
        }));
        document.querySelector('.nav-tab-btn[data-tab="audit"]')?.addEventListener('click', () => load(false));

        global.addEventListener('rdesk:walletChanged', () => { setTimeout(() => { load(false); refreshChange24(true); }, 300); });
        global.addEventListener('rdesk:success', () => setTimeout(() => load(true), 8000));
        setTimeout(() => { if (W()?.getAddress()) { load(false); refreshChange24(true); } }, 1200);

        // O ponto "agora" do gráfico e a variação acompanham as cotações ao vivo
        setInterval(() => {
            if (document.hidden || !W()?.getAddress()) return;
            const live = liveEquityUsd();
            if (Math.abs(live - st.lastLiveUsd) > 1e-9) { st.lastLiveUsd = live; renderBalanceRef(); if (st.events.length) renderHomeChart(); }
            refreshChange24(false);
        }, 4000);
    });

    global.RdeskHistory = {
        load, setRef, openRefPicker, renderBalance: renderBalanceRef, getRef: () => st.ref, REFS,
        changeVsRef, portfolioChangeVsRef, fmtPct, fmtRef, llamaKeyFor,
        getResult: computeResult, getSeries: computeSeries,
        getState: () => ({ wallet: st.wallet, events: st.events.length, exactPrices: Object.keys(st.exact).length, nativeDays: Object.keys(st.nativeEnd).length, loading: st.loading, error: st.error, ref: st.ref, filter: st.filter, seriesReady: st.seriesReady, chart: chart.getState() }),
        getEvents: () => st.events.map((e) => ({ hash: e.hash, type: e.type, title: e.title, auto: e.auto, cls: st.overrides[e.hash] || e.auto, items: e.items })),
        refreshChange24
    };
})(window);
