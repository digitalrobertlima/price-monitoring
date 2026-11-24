/* =========================================================================
   RDESK — MERCADO EM REAIS
   - Cartão "Bitcoin agora" na tela inicial, com preço em reais ao vivo
     (fluxo da corretora a cada negócio; se cair, consulta a cada 30 s).
   - Mercado: as 10 maiores moedas por valor de mercado, cada uma clicável,
     com gráfico em reais (24 h, 7 dias, 30 dias, 1 ano).
   - Gráfico de cada moeda da carteira e o "Hoje" do patrimônio.
   Fontes gratuitas, sem cadastro: CoinGecko (preço em reais), DefiLlama
   (reserva, em dólar convertido) e Binance (preço ao vivo do BTC/BRL).
   Nenhuma delas recebe o endereço da sua carteira.
   ========================================================================= */
(function (global) {
    'use strict';

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const W = () => global.RdeskWallet;
    const CG = 'https://api.coingecko.com/api/v3';
    const LLAMA = 'https://coins.llama.fi';
    const fxNow = () => W()?.getPrices?.().USD_BRL || 5.4;
    const brl = (v) => {
        const a = Math.abs(v);
        const d = a >= 100 ? 2 : a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
        return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
    };
    const big = (v) => (v >= 1e12 ? `R$ ${(v / 1e12).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} tri` : v >= 1e9 ? `R$ ${(v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi` : v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : brl(v));
    const pct = (p) => (Number.isFinite(p) ? `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%` : '—');

    // As 10 maiores (reserva se a lista ao vivo falhar). "app" = o cofre já guarda esta moeda.
    const TOP = [
        { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', app: true },
        { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', app: true },
        { id: 'tether', symbol: 'USDT', name: 'Tether', app: true },
        { id: 'binancecoin', symbol: 'BNB', name: 'BNB', app: true },
        { id: 'usd-coin', symbol: 'USDC', name: 'USDC', app: true },
        { id: 'ripple', symbol: 'XRP', name: 'XRP' },
        { id: 'solana', symbol: 'SOL', name: 'Solana' },
        { id: 'tron', symbol: 'TRX', name: 'TRON' },
        { id: 'hyperliquid', symbol: 'HYPE', name: 'Hyperliquid' },
        { id: 'zcash', symbol: 'ZEC', name: 'Zcash' }
    ];
    const IN_APP = new Set(['BTC', 'ETH', 'USDT', 'BNB', 'USDC', 'BRZ', 'BRLA', 'POL', 'CELO', 'DAI', 'WBTC', 'WETH', 'DASH', 'HYPE']);
    const ABOUT = {
        XRP: 'Moeda da rede XRP Ledger (2012), criada pela empresa Ripple para pagamentos entre bancos.',
        SOL: 'Moeda da rede Solana (2020): rápida e barata, mas já parou algumas vezes.',
        TRX: 'Moeda da rede TRON (2017), muito usada para mandar USDT barato.',
        HYPE: 'Moeda da Hyperliquid (2024), uma corretora descentralizada com rede própria.',
        ZEC: 'Zcash (2016): moeda focada em privacidade, com transações que podem esconder valores e endereços.'
    };

    // ------------------------------------------------------------------ dados
    const memo = new Map();
    async function cached(key, ttl, fn) {
        const hit = memo.get(key);
        if (hit && Date.now() - hit.at < ttl) return hit.v;
        const v = await fn();
        if (v) memo.set(key, { at: Date.now(), v });
        return v;
    }
    const getJson = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(String(r.status)); return r.json(); };
    // Períodos do gráfico. YTD = do dia 1º de janeiro até hoje. "Máx" = desde o início da moeda.
    const ytdDays = () => Math.max(1, Math.ceil((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 1)) / 86400000));
    const RANGES = {
        '1': { label: '24 h', days: 1, period: '1h', span: 25 },
        '7': { label: '7 dias', days: 7, period: '4h', span: 43 },
        '30': { label: '30 dias', days: 30, period: '1d', span: 31 },
        '180': { label: '6 meses', days: 180, period: '1d', span: 181 },
        ytd: { label: 'YTD', title: 'Do dia 1º de janeiro até hoje', get days() { return ytdDays(); }, period: '1d', get span() { return ytdDays() + 1; } },
        '365': { label: '1 ano', days: 365, period: '1d', span: 366 },
        '1825': { label: '5 anos', days: 1825, period: '1w', span: 262, long: true },
        max: { label: 'Máx', title: 'Desde o início da moeda', days: 6200, period: '2w', span: 445, long: true }
    };
    const RANGE_ORDER = ['1', '7', '30', '180', 'ytd', '365', '1825', 'max']; // (chaves numéricas viriam fora de ordem)
    // Dólar oficial (PTAX do Banco Central) de cada dia, para converter históricos longos em reais
    // com o dólar da época (e não o de hoje).
    async function ptaxFrom(startUnix) {
        return cached(`ptax:${Math.floor(startUnix / 86400 / 30)}`, 6 * 3600000, async () => {
            const f = (d) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}-${d.getUTCFullYear()}`;
            const u = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@di,dataFinalCotacao=@df)?@di='${f(new Date(startUnix * 1000))}'&@df='${f(new Date())}'&$format=json&$select=cotacaoVenda,dataHoraCotacao`;
            const j = await getJson(u);
            const rows = (j?.value || []).map((r) => [Date.parse(String(r.dataHoraCotacao).replace(' ', 'T')) / 1000, Number(r.cotacaoVenda)]).filter(([t, v]) => t > 0 && v > 0).sort((a, b) => a[0] - b[0]);
            return rows.length ? rows : null;
        });
    }
    function fxAt(rows, t) {
        if (!rows) return fxNow();
        let lo = 0, hi = rows.length - 1;
        if (t <= rows[0][0]) return rows[0][1];
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (rows[mid][0] <= t) lo = mid; else hi = mid - 1; }
        return rows[lo][1];
    }

    function thin(pts, max = 220) {
        if (pts.length <= max) return pts;
        const step = pts.length / max;
        const out = [];
        for (let i = 0; i < max; i++) out.push(pts[Math.floor(i * step)]);
        out.push(pts[pts.length - 1]);
        return out;
    }
    // Série em reais: CoinGecko direto em BRL; se falhar, DefiLlama em dólar × dólar de hoje
    async function series({ cg, llama }, rangeId) {
        const r = RANGES[rangeId] || RANGES['7'];
        return cached(`s:${cg || llama}:${rangeId}`, rangeId === '1' ? 60000 : 5 * 60000, async () => {
            if (cg && !r.long) {
                try {
                    const j = await getJson(`${CG}/coins/${cg}/market_chart?vs_currency=brl&days=${r.days}`);
                    const pts = (j.prices || []).map(([ms, v]) => ({ t: ms / 1000, v: Number(v) })).filter((p) => p.v > 0);
                    if (pts.length > 3) return { pts: thin(pts), src: 'CoinGecko' };
                } catch (e) {}
            }
            const key = llama || (cg ? `coingecko:${cg}` : null);
            if (!key) return null;
            const start = Math.floor(Date.now() / 1000 - r.days * 86400);
            const j = await getJson(`${LLAMA}/chart/${key}?start=${start}&span=${r.span}&period=${r.period}`);
            const raw = (j.coins?.[key]?.prices || []).filter((p) => Number(p.price) > 0);
            if (raw.length < 2) return null;
            // Período longo: cada ponto convertido pelo dólar oficial daquele dia
            let rows = null;
            if (r.days > 30) { try { rows = await ptaxFrom(raw[0].timestamp); } catch (e) { rows = null; } }
            const pts = raw.map((p) => ({ t: p.timestamp, v: Number(p.price) * (rows ? fxAt(rows, p.timestamp) : fxNow()) }));
            return { pts: thin(pts), src: rows ? 'DefiLlama, convertido pelo dólar oficial (PTAX) de cada dia' : 'DefiLlama (em dólar, convertido pelo dólar de hoje)' };
        });
    }
    async function top10() {
        return cached('top10', 60000, async () => {
            try {
                const j0 = await getJson(`${CG}/coins/markets?vs_currency=brl&order=market_cap_desc&per_page=25&page=1&sparkline=false&price_change_percentage=24h`);
                // Só moedas de verdade: fora versões "embrulhadas", de staking e títulos tokenizados (ex.: FIGR_HELOC)
                const j = Array.isArray(j0) ? j0.filter((c) => !/heloc|wrapped|staked|steth|bridged|figure|tokenized|bond|treasur/i.test(`${c.id} ${c.symbol} ${c.name}`)).slice(0, 10) : null;
                if (Array.isArray(j) && j.length >= 5) {
                    return j.map((c, i) => ({ id: c.id, symbol: String(c.symbol || '').toUpperCase(), name: c.name, price: Number(c.current_price), change: Number(c.price_change_percentage_24h), mcap: Number(c.market_cap), rank: i + 1, high: Number(c.high_24h), low: Number(c.low_24h), ath: Number(c.ath), athDate: c.ath_date, supply: Number(c.circulating_supply), max: Number(c.max_supply) }));
                }
            } catch (e) {}
            // Reserva: preços da DefiLlama (dólar) convertidos
            const keys = TOP.map((c) => `coingecko:${c.id}`).join(',');
            const [p, ch] = await Promise.all([getJson(`${LLAMA}/prices/current/${keys}`).catch(() => null), getJson(`${LLAMA}/percentage/${keys}?period=24h`).catch(() => null)]);
            if (!p) return null;
            const fx = fxNow();
            return TOP.map((c, i) => ({ ...c, rank: i + 1, price: Number(p.coins?.[`coingecko:${c.id}`]?.price) * fx, change: Number(ch?.coins?.[`coingecko:${c.id}`]), mcap: NaN })).filter((c) => c.price > 0);
        });
    }

    // ------------------------------------------------------------------ gráfico confortável (Chart.js)
    const crosshair = {
        id: 'rdeskCross',
        afterDraw(chart) {
            const a = chart.tooltip?.getActiveElements?.() || [];
            if (!a.length) return;
            const { ctx, chartArea } = chart;
            const x = a[0].element.x;
            ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke(); ctx.restore();
        }
    };
    function lineChart(canvas, pts, { short = false, long = false } = {}) {
        const C = global.Chart;
        if (!C || !canvas) return null;
        if (canvas._chart) canvas._chart.destroy();
        const up = pts.length > 1 && pts[pts.length - 1].v >= pts[0].v;
        const color = up ? '#34d399' : '#fb7185';
        const ctx = canvas.getContext('2d');
        const h = canvas.clientHeight || 220;
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, up ? 'rgba(52,211,153,.32)' : 'rgba(251,113,133,.28)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        const fmtT = (t) => new Date(t * 1000).toLocaleString('pt-BR', short ? { hour: '2-digit', minute: '2-digit' } : long ? { month: 'short', year: '2-digit' } : { day: '2-digit', month: 'short' });
        let lastIdx = -1;
        canvas._chart = new C(canvas, {
            type: 'line',
            data: { labels: pts.map((p) => fmtT(p.t)), datasets: [{ data: pts.map((p) => p.v), borderColor: color, backgroundColor: grad, fill: true, borderWidth: 2.4, pointRadius: 0, pointHoverRadius: 6, pointHoverBackgroundColor: '#fff', tension: 0.25 }] },
            options: {
                responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(16,20,30,.95)', borderColor: 'rgba(247,147,26,.5)', borderWidth: 1, padding: 12, displayColors: false,
                        titleFont: { size: 13 }, bodyFont: { size: 16, weight: '700' },
                        callbacks: {
                            title: (it) => new Date(pts[it[0].dataIndex].t * 1000).toLocaleString('pt-BR', short ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'long', year: 'numeric' }),
                            label: (it) => brl(it.parsed.y)
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: '#7a8498', maxTicksLimit: 4, maxRotation: 0, font: { size: 11 } }, grid: { display: false } },
                    y: { position: 'right', ticks: { color: '#7a8498', maxTicksLimit: 4, font: { size: 11 }, callback: (v) => (v >= 1e5 ? `${Math.round(v / 1000)} mil` : brl(v).replace('R$ ', '')) }, grid: { color: 'rgba(255,255,255,.05)' } }
                },
                onHover: (ev, els) => {
                    const i = els?.[0]?.index;
                    if (i !== undefined && i !== lastIdx) { lastIdx = i; if (global.RdeskFeel?.get().haptic && navigator.vibrate && ev?.native?.pointerType !== 'mouse') { try { navigator.vibrate(3); } catch (e) {} } }
                }
            },
            plugins: [crosshair]
        });
        return canvas._chart;
    }

    // Bloco reutilizável: preço, variação do período, abas de período e gráfico
    function mountChart(box, source, { title = '', start = '1' } = {}) {
        if (!box) return;
        box.innerHTML = `
            <div class="mk-head"><div><span class="mk-title">${esc(title)}</span><strong class="mk-price money" data-mk-price>…</strong><span class="chg" data-mk-chg></span></div></div>
            <div class="chip-group mk-ranges" role="group" aria-label="Período">${RANGE_ORDER.map((id) => [id, RANGES[id]]).map(([id, r]) => `<button type="button" class="chip ${id === start ? 'active' : ''}" data-mk-range="${id}"${r.title ? ` title="${esc(r.title)}" aria-label="${esc(r.title)}"` : ''}>${r.label}</button>`).join('')}</div>
            <div class="mk-canvas-wrap"><canvas data-mk-canvas role="img" aria-label="Gráfico de preço em reais"></canvas><div class="mk-msg" data-mk-msg>Carregando…</div></div>
            <small class="mk-src muted-sm" data-mk-src></small>`;
        const q = (s) => box.querySelector(s);
        const show = async (rid) => {
            box.querySelectorAll('[data-mk-range]').forEach((b) => b.classList.toggle('active', b.getAttribute('data-mk-range') === rid));
            q('[data-mk-msg]').hidden = false; q('[data-mk-msg]').textContent = 'Carregando…';
            try {
                const s = await series(source, rid);
                if (!s || !box.isConnected) throw new Error('sem dados');
                q('[data-mk-msg]').hidden = true;
                lineChart(q('[data-mk-canvas]'), s.pts, { short: rid === '1', long: Boolean(RANGES[rid].long) || rid === '365' || rid === 'ytd' || rid === '180' });
                const first = s.pts[0].v, last = s.pts[s.pts.length - 1].v, ch = (last / first - 1) * 100;
                q('[data-mk-price]').textContent = brl(last);
                const c = q('[data-mk-chg]');
                c.textContent = `${pct(ch)} ${rid === 'ytd' ? 'no ano' : rid === 'max' ? 'desde o início' : `em ${RANGES[rid].label}`}`; c.className = `chg ${ch > 0 ? 'up' : ch < 0 ? 'down' : ''}`;
                q('[data-mk-src]').textContent = `Fonte: ${s.src}`;
                box.dataset.ready = '1';
            } catch (e) {
                if (!box.isConnected) return;
                q('[data-mk-msg]').hidden = false;
                q('[data-mk-msg]').textContent = global.RdeskAnon?.isOn?.() ? 'Modo anônimo: gráficos só quando você pedir.' : 'Não deu para buscar o gráfico agora. Toque num período para tentar de novo.';
            }
        };
        box.querySelectorAll('[data-mk-range]').forEach((b) => { b.onclick = () => show(b.getAttribute('data-mk-range')); });
        show(start);
        return { show };
    }

    function sourceFor({ symbol, chainId, address }) {
        const cg = global.RdeskAssetInfo?.coingeckoId?.(symbol);
        const chainLlama = global.RdeskRegistry?.getChain?.(chainId)?.llama;
        const isKnown = Boolean(cg) && !(address && !global.RdeskAssetInfo?.factsFor?.(symbol));
        if (isKnown) return { cg };
        if (address && chainLlama) return { llama: `${chainLlama}:${String(address).toLowerCase()}` };
        return cg ? { cg } : null;
    }
    function mountCoinChart(box, asset) {
        const src = sourceFor(asset);
        if (!box || !src) { if (box) box.hidden = true; return; }
        mountChart(box, src, { title: `${asset.symbol} em reais`, start: '7' });
    }

    // ------------------------------------------------------------------ Bitcoin ao vivo (cartão da tela inicial)
    const live = { price: 0, open: 0, at: 0, ws: null, src: '' };
    function paintLive() {
        const el = document.getElementById('btc-live-price');
        if (!el || !live.price) return;
        const prev = Number(el.dataset.v || 0);
        el.textContent = brl(live.price);
        el.dataset.v = String(live.price);
        if (prev && prev !== live.price) { el.classList.remove('tick-up', 'tick-down'); void el.offsetWidth; el.classList.add(live.price > prev ? 'tick-up' : 'tick-down'); }
        const ch = live.open ? (live.price / live.open - 1) * 100 : NaN;
        const c = document.getElementById('btc-live-chg');
        if (c) { c.textContent = Number.isFinite(ch) ? `${pct(ch)} em 24 h` : ''; c.className = `chg ${ch > 0 ? 'up' : ch < 0 ? 'down' : ''}`; }
        const s = document.getElementById('btc-live-src');
        if (s) s.textContent = live.src === 'ws' ? '● ao vivo, negócio a negócio' : `atualizado ${new Date(live.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        checkBigMove(ch);
    }
    // Aviso quando o Bitcoin mexe forte (uma vez a cada 6 h por direção)
    function checkBigMove(ch) {
        const lim = global.RdeskFeel?.get().btcMove || 5;
        if (!Number.isFinite(ch) || Math.abs(ch) < lim) return;
        const k = `rdesk_btc_move_${ch > 0 ? 'up' : 'down'}`;
        try {
            if (Date.now() - Number(localStorage.getItem(k) || 0) < 6 * 3600 * 1000) return;
            localStorage.setItem(k, String(Date.now()));
        } catch (e) { return; }
        global.RdeskFeel?.notify(ch > 0 ? 'Bitcoin subindo forte 📈' : 'Bitcoin caindo forte 📉', `${pct(ch)} em 24 h. Agora: ${brl(live.price)}.`, 'btc-move');
    }
    async function pollLive() {
        try {
            const j = await getJson(`${CG}/simple/price?ids=bitcoin&vs_currencies=brl&include_24hr_change=true`);
            const p = Number(j?.bitcoin?.brl), ch = Number(j?.bitcoin?.brl_24h_change);
            if (p > 0) { live.price = p; live.open = Number.isFinite(ch) ? p / (1 + ch / 100) : live.open; live.at = Date.now(); if (live.src !== 'ws') live.src = 'poll'; paintLive(); return; }
        } catch (e) {}
        const usd = W()?.getPrices?.().BTC;
        if (usd > 0) { live.price = usd * fxNow(); live.at = Date.now(); live.src = 'poll'; paintLive(); }
    }
    function startWs() {
        if (live.ws || !global.WebSocket || global.RdeskAnon?.isOn?.()) return;
        try {
            const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcbrl@miniTicker');
            live.ws = ws;
            let lastPaint = 0;
            ws.onmessage = (m) => {
                try {
                    const d = JSON.parse(m.data);
                    const c = Number(d.c), o = Number(d.o);
                    if (!(c > 0)) return;
                    live.price = c; if (o > 0) live.open = o; live.at = Date.now(); live.src = 'ws';
                    if (Date.now() - lastPaint > 900) { lastPaint = Date.now(); paintLive(); }
                } catch (e) {}
            };
            ws.onclose = ws.onerror = () => { live.ws = null; if (live.src === 'ws') live.src = 'poll'; };
        } catch (e) { live.ws = null; }
    }
    function stopWs() { try { live.ws?.close(); } catch (e) {} live.ws = null; }
    function mountHomeCard() {
        const card = document.getElementById('btc-live-card');
        if (!card || card.dataset.bound) return;
        card.dataset.bound = '1';
        document.getElementById('btn-open-market')?.addEventListener('click', () => openMarket());
        mountChart(document.getElementById('btc-live-chart'), { cg: 'bitcoin' }, { title: 'Bitcoin em reais', start: '1' });
    }

    // ------------------------------------------------------------------ telas: mercado e moeda
    function sheet(html, cls = '') {
        const root = document.getElementById('ob-root');
        if (!root) return null;
        root.replaceChildren();
        const wrap = document.createElement('div');
        wrap.className = `ob-overlay ${cls}`;
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.innerHTML = `<div class="ob-sheet mk-sheet">${html}</div>`;
        wrap.addEventListener('click', (ev) => { if (ev.target === wrap || ev.target.closest('[data-close]')) root.replaceChildren(); });
        root.appendChild(wrap);
        requestAnimationFrame(() => wrap.classList.add('open'));
        return wrap;
    }
    async function openMarket() {
        const el = sheet(`
            <div class="mk-top"><h2>Mercado em reais</h2><button type="button" class="icon-btn" data-close aria-label="Fechar">✕</button></div>
            <div class="mk-box" id="mk-btc"></div>
            <h3 class="view-subtitle">As 10 maiores moedas do mundo</h3>
            <p class="muted-sm">Por valor de mercado. Toque numa moeda para ver o gráfico e a ficha dela.</p>
            <div class="mk-list" id="mk-list"><div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div></div>`, 'mk-overlay');
        if (!el) return;
        mountChart(el.querySelector('#mk-btc'), { cg: 'bitcoin' }, { title: 'Bitcoin em reais', start: '1' });
        const listEl = el.querySelector('#mk-list');
        const list = await top10().catch(() => null);
        if (!listEl.isConnected) return;
        if (!list) { listEl.innerHTML = '<div class="empty-state">Não deu para buscar o mercado agora.</div>'; return; }
        listEl.innerHTML = list.map((c, i) => `
            <button type="button" class="mk-row" data-coin="${esc(c.id)}">
                <span class="mk-rank">${c.rank || i + 1}</span>
                ${global.RdeskRegistry?.tokenBadge ? global.RdeskRegistry.tokenBadge(c.symbol, 34) : ''}
                <span class="mk-names"><strong>${esc(c.name)}</strong><small>${esc(c.symbol)}${IN_APP.has(c.symbol) ? ' · <span class="mk-in">no seu cofre</span>' : ''}</small></span>
                <span class="mk-vals money"><strong>${esc(brl(c.price))}</strong><span class="chg ${c.change > 0 ? 'up' : c.change < 0 ? 'down' : ''}">${esc(pct(c.change))}</span></span>
            </button>`).join('');
        listEl.querySelectorAll('[data-coin]').forEach((b) => { b.onclick = () => openCoin(list.find((c) => c.id === b.getAttribute('data-coin'))); });
    }
    function openCoin(c) {
        if (!c) return;
        const f = global.RdeskAssetInfo?.factsFor?.(c.symbol);
        const facts = [];
        if (f) { facts.push(['O que é', f.kind], ['Existe desde', String(f.since)], ['O que garante o valor', f.backing], ['Pode ser congelada?', f.freeze]); }
        else if (ABOUT[c.symbol]) facts.push(['O que é', ABOUT[c.symbol]]);
        if (c.rank) facts.push(['Posição no mundo', `${c.rank}ª maior por valor de mercado`]);
        if (Number.isFinite(c.mcap)) facts.push(['Valor de mercado', big(c.mcap)]);
        if (c.low > 0 && c.high > 0) facts.push(['Mínimo e máximo em 24 h', `${brl(c.low)} – ${brl(c.high)}`]);
        if (c.ath > 0) facts.push(['Recorde de preço', `${brl(c.ath)}${c.athDate ? ` (${new Date(c.athDate).toLocaleDateString('pt-BR')})` : ''}`]);
        if (c.supply > 0) facts.push(['Em circulação', `${Math.round(c.supply).toLocaleString('pt-BR')} ${c.symbol}${c.max > 0 ? ` de no máximo ${Math.round(c.max).toLocaleString('pt-BR')}` : ''}`]);
        const can = IN_APP.has(c.symbol);
        const el = sheet(`
            <div class="mk-top"><button type="button" class="icon-btn" data-back aria-label="Voltar">←</button><h2>${esc(c.name)}</h2><button type="button" class="icon-btn" data-close aria-label="Fechar">✕</button></div>
            <div class="mk-box" id="mk-coin"></div>
            <dl class="asset-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
            ${can ? `<div class="two-btn-row"><button type="button" class="btn-primary" data-act="swap">Trocar por ${esc(c.symbol)}</button><button type="button" class="btn-soft" data-act="receive">Receber ${esc(c.symbol)}</button></div>`
                : `<p class="mk-soon">🔜 O cofre ainda não guarda ${esc(c.symbol)}. Por enquanto você acompanha o preço aqui; a carteira desta moeda chega numa próxima versão.</p>`}`, 'mk-overlay');
        if (!el) return;
        mountChart(el.querySelector('#mk-coin'), { cg: c.id }, { title: `${c.symbol} em reais`, start: '7' });
        el.querySelector('[data-back]').onclick = () => openMarket();
        el.querySelector('[data-act="swap"]')?.addEventListener('click', () => { document.getElementById('ob-root').replaceChildren(); document.querySelector('.nav-tab-btn[data-tab="pixswap"]')?.click(); });
        el.querySelector('[data-act="receive"]')?.addEventListener('click', () => { document.getElementById('ob-root').replaceChildren(); document.getElementById('btn-action-receive')?.click(); });
    }

    // ------------------------------------------------------------------ patrimônio de hoje
    const day = { pts: [], at: 0, error: '', busy: null };
    async function loadPortfolioDay() {
        if (day.busy) return day.busy;
        if (Date.now() - day.at < 5 * 60000 && day.pts.length) return day;
        day.busy = (async () => {
            try {
                const bal = (W()?.getBalances?.() || []).filter((b) => b.usdValue > 0.01 && b.amount > 0);
                const lp = global.RdeskDefi?.getLivePositionsUsd?.() || 0;
                const H = global.RdeskHistory;
                const groups = {};
                bal.forEach((b) => { const k = H?.llamaKeyFor?.(b); if (k) groups[k] = (groups[k] || 0) + b.amount; });
                const keys = Object.keys(groups);
                if (!keys.length && !lp) { day.pts = []; day.error = 'Sem moedas com saldo para desenhar o dia.'; return day; }
                const start = Math.floor(Date.now() / 1000 - 24 * 3600);
                const j = keys.length ? await getJson(`${LLAMA}/chart/${keys.join(',')}?start=${start}&span=25&period=1h`) : { coins: {} };
                const steps = [];
                for (let i = 0; i <= 24; i++) steps.push(start + i * 3600);
                const priceAt = (list, t) => { let best = null; (list || []).forEach((p) => { if (!best || Math.abs(p.timestamp - t) < Math.abs(best.timestamp - t)) best = p; }); return best ? Number(best.price) : 0; };
                const known = bal.filter((b) => H?.llamaKeyFor?.(b)).reduce((s, b) => s + b.usdValue, 0);
                const other = bal.reduce((s, b) => s + b.usdValue, 0) - known + lp; // sem série: fica constante
                const refId = H?.getRef?.() || 'BTC';
                const refKey = H?.REFS?.[refId]?.llama;
                let refList = null;
                if (refKey && refId !== 'USD' && refId !== 'BRL' && !j.coins?.[refKey]) { try { refList = (await getJson(`${LLAMA}/chart/${refKey}?start=${start}&span=25&period=1h`)).coins?.[refKey]?.prices; } catch (e) {} }
                const fx = fxNow();
                day.pts = steps.map((t, i) => {
                    let usd = other;
                    keys.forEach((k) => { usd += groups[k] * (priceAt(j.coins?.[k]?.prices, t) || 0); });
                    const refUsd = refId === 'USD' ? 1 : refId === 'BRL' ? 1 / fx : (priceAt(j.coins?.[refKey]?.prices || refList, t) || 1);
                    return { key: new Date(t * 1000).toISOString().slice(0, 10), t, usd, ref: usd / refUsd, flowIn: 0, flowOut: 0, intraday: true, live: i === steps.length - 1 };
                }).filter((p) => p.usd > 0);
                day.error = day.pts.length > 1 ? '' : 'Não deu para buscar os preços de hoje.';
                day.at = Date.now();
            } catch (e) { day.error = 'Não deu para buscar os preços de hoje agora.'; }
            finally { day.busy = null; }
            return day;
        })();
        return day.busy;
    }
    function portfolioDay() { return day.pts.length ? { pts: day.pts } : (day.error ? { pts: [], error: day.error } : null); }

    // ------------------------------------------------------------------ ciclo
    let pollTimer = null;
    function tick() {
        if (document.hidden) return;
        if (global.RdeskAnon?.isOn?.()) { stopWs(); return; }
        startWs();
        if (!live.ws || Date.now() - live.at > 30000) pollLive();
    }
    document.addEventListener('DOMContentLoaded', () => {
        mountHomeCard();
        setTimeout(tick, 1500);
        pollTimer = setInterval(tick, 30000);
        document.addEventListener('visibilitychange', () => { if (document.hidden) stopWs(); else tick(); });
        global.addEventListener('rdesk:anon', (e) => { if (e.detail?.on) stopWs(); else tick(); });
    });

    global.RdeskMarket = {
        openMarket, openCoin, mountCoinChart, mountChart, series, top10, loadPortfolioDay, portfolioDay, lineChart,
        _live: () => ({ ...live, ws: Boolean(live.ws) }), TOP
    };
    void pollTimer;
})(window);
