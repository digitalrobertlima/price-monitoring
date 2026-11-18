/* =========================================================================
   TROCA BONITA — cartões "Você envia / Você recebe" com botão de moeda grande
   e uma lista visual (reais digitais, Bitcoin, dólar digital, moedas das redes).
   Os <select> originais continuam sendo a fonte de verdade (a lógica da troca
   não muda): aqui só escolhemos por eles e mostramos bonito.
   ========================================================================= */
(function (global) {
    'use strict';
    const REG = () => global.RdeskRegistry;
    const W = () => global.RdeskWallet;
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // Grupos, na ordem que o brasileiro precisa: real primeiro, Bitcoin, dólar, o resto
    const GROUPS = [
        { key: 'brl', title: '🇧🇷 Reais digitais', hint: 'Valem R$ 1 cada. Bom pra guardar e mandar reais.' },
        { key: 'btc', title: '₿ Bitcoin', hint: 'A reserva de valor do seu cofre.' },
        { key: 'usd', title: '💵 Dólar digital', hint: 'Valem US$ 1 cada.' },
        { key: 'net', title: '⛽ Moedas das redes', hint: 'Pagam as taxas de cada rede. O preço sobe e desce.' }
    ];
    const ISSUER = { BRZ: 'Transfero', BRLA: 'Avenia', USDT: 'Tether', USDC: 'Circle', WBTC: 'token que representa Bitcoin' };
    const groupOf = (t, chain) => {
        if (chain === 'btc' || t.priceKey === 'BTC') return 'btc';
        if (t.priceKey === 'BRL') return 'brl';
        if (t.priceKey === 'USD') return 'usd';
        return 'net';
    };
    // As principais: as maiores por valor de mercado que este cofre guarda de verdade, uma linha por moeda,
    // já na rede mais barata e usada. Ordem: valor de mercado (Bitcoin tem cerca de 60% de todo o mercado).
    const MAIN = [
        { chain: 'btc', sym: 'BTC', title: 'Bitcoin', sub: 'a maior de todas • o seu cofre' },
        { chain: '1', sym: 'ETH', title: 'Ethereum', sub: 'a 2ª maior' },
        { chain: '137', sym: 'USDT', title: 'Dólar digital', sub: 'USDT • Tether • o mais usado' },
        { chain: '56', sym: 'BNB', title: 'BNB', sub: 'da Binance' },
        { chain: '137', sym: 'USDC', title: 'Dólar digital', sub: 'USDC • Circle' },
        { chain: '137', sym: 'BRZ', title: 'Real digital', sub: 'BRZ • Transfero' },
        { chain: '137', sym: 'BRLA', title: 'Real digital', sub: 'BRLA • Avenia' },
        { chain: '137', sym: 'POL', title: 'POL', sub: 'paga as taxas da Polygon' }
    ];
    const chainName = (c) => (c === 'btc' ? 'Bitcoin' : (REG().getChain(Number(c))?.name || String(c)));

    function allOptions() {
        const out = [];
        const add = (chain, t) => { if (/^W(POL|ETH)$/.test(t.symbol)) return; out.push({ chain: String(chain), sym: t.symbol, name: t.name, group: groupOf(t, chain) }); };
        add('btc', { symbol: 'BTC', name: 'Bitcoin nativo', priceKey: 'BTC' });
        REG().CHAINS.forEach((c) => REG().getTokens(c.id).forEach((t) => add(c.id, t)));
        return out;
    }
    const balanceOf = (chain, sym) => {
        try {
            const c = chain === 'btc' ? 'btc' : Number(chain);
            return (W()?.getBalances?.() || []).find((b) => b.chainId === c && b.symbol === sym)?.amount || 0;
        } catch (e) { return 0; }
    };
    const fmt = (n, d = 6) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: d });

    // Seleciona pelo <select> original e avisa a lógica da troca
    function choose(side, chain, sym) {
        const fc = $(`swap-${side}-chain`), ft = $(`swap-${side}-token`);
        if (fc.value !== chain) { fc.value = chain; fc.dispatchEvent(new Event('change', { bubbles: true })); }
        if (ft.value !== sym) { ft.value = sym; ft.dispatchEvent(new Event('change', { bubbles: true })); }
        paint();
    }

    function pillHtml(side) {
        const chain = $(`swap-${side}-chain`)?.value, sym = $(`swap-${side}-token`)?.value;
        if (!chain || !sym) return '';
        const c = chain === 'btc' ? 'btc' : Number(chain);
        return `${REG().tokenOnChainBadge(sym, c, 30)}<span class="sx-sym"><b>${esc(sym)}</b><small>${esc(chainName(chain))}</small></span><span class="sx-caret" aria-hidden="true">▾</span>`;
    }

    function paint() {
        ['from', 'to'].forEach((side) => {
            const pill = $(`sx-${side}-pill`);
            if (pill) pill.innerHTML = pillHtml(side);
            const net = $(`sx-${side}-net`);
            if (net) net.textContent = chainName($(`swap-${side}-chain`)?.value);
        });
        rateLine();
    }

    // "1 POL ≈ 0,61 BRZ" e o valor em R$ do que você recebe, como nos melhores sites de troca
    function rateLine() {
        const el = $('sx-rate'), outBrl = $('sx-out-brl');
        if (!el) return;
        const amtIn = parseFloat(String($('swap-amount-in')?.value || '').replace(',', '.')) || 0;
        const amtOut = parseFloat(String($('swap-amount-out')?.value || '').replace(',', '.')) || 0; // vem sem separador de milhar
        const fs = $('swap-from-token')?.value, ts = $('swap-to-token')?.value;
        if (amtIn > 0 && amtOut > 0) {
            el.innerHTML = `1 ${esc(fs)} ≈ <b>${fmt(amtOut / amtIn, amtOut / amtIn < 1 ? 8 : 4)}</b> ${esc(ts)}`;
            el.hidden = false;
        } else el.hidden = true;
        if (outBrl) {
            try {
                const tc = $('swap-to-chain').value, c = tc === 'btc' ? 'btc' : Number(tc);
                const meta = tc === 'btc' ? { priceKey: 'BTC' } : REG().getTokens(c).find((t) => t.symbol === ts);
                const usd = meta ? W().unitUsdFor(meta.priceKey, c, meta.address) : 0;
                const brl = amtOut * usd * (W().getPrices().USD_BRL || 0);
                outBrl.textContent = brl > 0 ? `≈ ${W().formatBRL(brl)}` : '';
            } catch (e) { outBrl.textContent = ''; }
        }
    }

    // Lista de moedas: tela cheia no celular, busca, grupos, saldo
    function openPicker(side) {
        close();
        const other = side === 'from' ? 'to' : 'from';
        const cur = { chain: $(`swap-${side}-chain`).value, sym: $(`swap-${side}-token`).value };
        const otherCur = { chain: $(`swap-${other}-chain`).value, sym: $(`swap-${other}-token`).value };
        const opts = allOptions();
        const wrap = document.createElement('div');
        wrap.className = 'sx-picker';
        wrap.id = 'sx-picker';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.setAttribute('aria-label', side === 'from' ? 'Escolher a moeda que você envia' : 'Escolher a moeda que você recebe');
        wrap.innerHTML = `
            <div class="sx-sheet">
                <div class="sx-sheet-head"><b>${side === 'from' ? 'Você envia' : 'Você recebe'}</b><button type="button" class="sx-x" aria-label="Fechar">✕</button></div>
                <input type="search" class="sx-search" placeholder="Buscar: real, bitcoin, dólar, BRZ…" aria-label="Buscar moeda" autocomplete="off">
                <div class="sx-list"></div>
            </div>`;
        document.body.appendChild(wrap);
        const list = wrap.querySelector('.sx-list');
        const words = { brl: 'real reais brl brasil', btc: 'bitcoin btc satoshi', usd: 'dolar dólar usd', net: 'rede gas taxa' };
        let showAll = false;
        const rowHtml = (o, title, sub) => {
            const bal = balanceOf(o.chain, o.sym);
            const on = o.chain === cur.chain && o.sym === cur.sym;
            const same = o.chain === otherCur.chain && o.sym === otherCur.sym;
            const c = o.chain === 'btc' ? 'btc' : Number(o.chain);
            return `<button type="button" class="sx-row ${on ? 'on' : ''}" data-chain="${esc(o.chain)}" data-sym="${esc(o.sym)}" ${same ? 'disabled title="Já está do outro lado"' : ''}>
                ${REG().tokenOnChainBadge(o.sym, c, 36)}
                <span class="sx-row-t"><b>${esc(title)}</b><small>${esc(sub)}</small></span>
                <span class="sx-row-b">${bal > 0 ? fmt(bal, 6) : ''}${on ? ' ✓' : ''}</span>
            </button>`;
        };
        const render = (q) => {
            const nq = q.trim().toLowerCase();
            if (!showAll && !nq) {
                const main = MAIN.filter((m) => m.chain === 'btc' || REG().getTokens(Number(m.chain)).some((x) => x.symbol === m.sym));
                list.innerHTML = `<div class="sx-group"><div class="sx-gtitle">⭐ Principais<small>As maiores do mercado que o seu cofre guarda.</small></div>${main.map((m) => rowHtml(m, m.title, m.sub)).join('')}</div>
                    <button type="button" class="sx-more" id="sx-more">Mostrar todas as redes ▾</button>
                    <p class="sx-foot-note">XRP, Solana, Tron, Dogecoin e Cardano ainda não: cada uma precisa de uma rede própria no cofre.</p>`;
                list.querySelector('#sx-more').onclick = () => { showAll = true; render(''); };
                return;
            }
            list.innerHTML = GROUPS.map((g) => {
                const rows = opts.filter((o) => o.group === g.key && (!nq || `${o.sym} ${o.name} ${chainName(o.chain)} ${ISSUER[o.sym] || ''} ${words[g.key]}`.toLowerCase().includes(nq)));
                if (!rows.length) return '';
                rows.sort((a, b) => (balanceOf(b.chain, b.sym) > 0) - (balanceOf(a.chain, a.sym) > 0));
                return `<div class="sx-group"><div class="sx-gtitle">${g.title}<small>${g.hint}</small></div>${rows.map((o) => rowHtml(o, o.sym, [ISSUER[o.sym], chainName(o.chain)].filter(Boolean).join(' • '))).join('')}</div>`;
            }).join('') || '<p class="sx-empty">Nada encontrado.</p>';
        };
        render('');
        wrap.querySelector('.sx-search').addEventListener('input', (e) => render(e.target.value));
        list.addEventListener('click', (e) => {
            if (e.target.closest('#sx-more')) return;
            const b = e.target.closest('.sx-row');
            if (!b || b.disabled) return;
            close();
            choose(side, b.dataset.chain, b.dataset.sym);
        });
        wrap.querySelector('.sx-x').onclick = close;
        wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
        document.addEventListener('keydown', onEsc);
        requestAnimationFrame(() => wrap.classList.add('open'));
    }
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    function close() { document.getElementById('sx-picker')?.remove(); document.removeEventListener('keydown', onEsc); }

    // Atalhos de troca: o que o brasileiro mais faz
    const QUICK = [
        { label: '🇧🇷 Reais → ₿ Bitcoin', from: ['137', 'BRZ'], to: ['btc', 'BTC'] },
        { label: '₿ Bitcoin → 🇧🇷 Reais', from: ['btc', 'BTC'], to: ['137', 'BRZ'] },
        { label: '💵 Dólar → 🇧🇷 Reais', from: ['137', 'USDT'], to: ['137', 'BRZ'] },
        { label: '🇧🇷 BRZ ⇄ BRLA', from: ['137', 'BRZ'], to: ['137', 'BRLA'] }
    ];

    function init() {
        if (!$('swap-from-token') || !REG()) return;
        ['from', 'to'].forEach((side) => {
            $(`sx-${side}-pill`)?.addEventListener('click', () => openPicker(side));
            [`swap-${side}-chain`, `swap-${side}-token`].forEach((id) => $(id)?.addEventListener('change', () => setTimeout(paint, 0)));
        });
        $('btn-swap-flip')?.addEventListener('click', (e) => {
            const b = e.currentTarget; b.classList.remove('spin'); void b.offsetWidth; b.classList.add('spin');
            setTimeout(() => b.classList.remove('spin'), 320);
            setTimeout(paint, 30);
        });
        const quick = $('sx-quick');
        if (quick) {
            quick.innerHTML = QUICK.map((q, i) => `<button type="button" class="sx-chip" data-q="${i}">${q.label}</button>`).join('');
            quick.addEventListener('click', (e) => {
                const b = e.target.closest('[data-q]');
                if (!b) return;
                const q = QUICK[Number(b.dataset.q)];
                choose('from', ...q.from);
                choose('to', ...q.to);
            });
        }
        // A cotação muda o campo "recebe" por código: observa para atualizar a linha de câmbio
        const out = $('swap-amount-out');
        if (out) {
            let last = '';
            setInterval(() => { const v = `${out.value}|${$('swap-amount-in')?.value}`; if (v !== last) { last = v; rateLine(); } }, 400);
        }
        global.addEventListener('rdesk:walletChanged', () => setTimeout(paint, 0));
        global.addEventListener('rdesk:pricesUpdated', () => setTimeout(rateLine, 0));
        paint();
    }

    global.RdeskSwapPicker = { init, paint, openPicker, close };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
    else setTimeout(init, 0);
})(window);
