/* =========================================================================
   RUMO AO 1º BITCOIN — trilha gamificada em satoshis.
   Conta só Bitcoin nativo (na sua chave). Mostra cada marco em R$ e em
   horas do seu próprio trabalho, porque é isso que o Bitcoin guarda.
   ========================================================================= */
(function (global) {
    'use strict';
    const W = () => global.RdeskWallet;
    const $ = (id) => document.getElementById(id);
    const KEY = 'rdesk_sats_trail_v1';
    const SAT = 1e8;
    const MIN_WAGE = 1621; // salário mínimo 2026 (Decreto 12.797/2025)
    const HOURS_MONTH = 220;

    const STEPS = [
        { sats: 1000, name: 'Primeiro passo', icon: '🌱', tip: 'Você já é dono de um pedacinho de Bitcoin.' },
        { sats: 10000, name: 'Poupador', icon: '🐷', tip: 'Dez mil satoshis: o hábito começou.' },
        { sats: 100000, name: 'Guardião', icon: '🛡️', tip: 'Cem mil: um milésimo de Bitcoin.' },
        { sats: 1000000, name: 'Cofre forte', icon: '🏦', tip: 'Um milhão: um centésimo de Bitcoin.' },
        { sats: 10000000, name: 'Montanha', icon: '🏔️', tip: 'Dez milhões: um décimo de Bitcoin.' },
        { sats: 100000000, name: '1 Bitcoin inteiro', icon: '🏆', tip: 'Cem milhões de satoshis. Pouquíssima gente no mundo tem.' }
    ];

    const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } };
    const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* sem armazenamento */ } };
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function income() { const s = load(); return Number(s.monthly) > 0 ? Number(s.monthly) : MIN_WAGE; }
    const hourly = () => income() / HOURS_MONTH;

    function satsNow() {
        try {
            const bals = W()?.getBalances?.() || [];
            const btc = bals.filter((b) => b.chainId === 'btc' && b.symbol === 'BTC').reduce((a, b) => a + (Number(b.amount) || 0), 0);
            const wbtc = bals.filter((b) => b.symbol === 'WBTC').reduce((a, b) => a + (Number(b.amount) || 0), 0);
            return { native: Math.round(btc * SAT), wrapped: Math.round(wbtc * SAT) };
        } catch (e) { return { native: 0, wrapped: 0 }; }
    }
    function brlPerSat() {
        try { const p = W().getPrices(); return p.BTC > 0 && p.USD_BRL > 0 ? (p.BTC * p.USD_BRL) / SAT : 0; } catch (e) { return 0; }
    }
    const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: v >= 100 ? 0 : 2 });
    const satsTxt = (n) => `${Number(n).toLocaleString('pt-BR')} sats`;
    function hoursTxt(reais) {
        const h = reais / hourly();
        if (!(h > 0)) return '';
        if (h < 1) return `${Math.max(1, Math.round(h * 60))} min de trabalho`;
        if (h < 220) return `${h.toLocaleString('pt-BR', { maximumFractionDigits: h < 10 ? 1 : 0 })} h de trabalho`;
        const m = h / HOURS_MONTH;
        return m < 24 ? `${m.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses de trabalho` : `${(m / 12).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} anos de trabalho`;
    }
    function state() {
        const { native, wrapped } = satsNow();
        const idx = STEPS.findIndex((s) => native < s.sats);
        const next = idx === -1 ? null : STEPS[idx];
        const prev = idx <= 0 ? 0 : STEPS[idx - 1].sats;
        const reached = idx === -1 ? STEPS.length : idx;
        const pct = next ? Math.max(0, Math.min(100, ((native - prev) / (next.sats - prev)) * 100)) : 100;
        return { native, wrapped, next, reached, pct };
    }

    // Cartão compacto (Início e Aprender)
    function cardHtml() {
        const st = state(), ps = brlPerSat();
        const left = st.next ? st.next.sats - st.native : 0;
        return `
            <button type="button" class="st-card" data-open-trail aria-label="Abrir a trilha Rumo ao 1º Bitcoin">
                <span class="st-top"><span class="st-title">🏁 Rumo ao 1º Bitcoin</span><span class="st-lvl">${st.reached}/${STEPS.length} ${STEPS[Math.max(0, st.reached - 1)]?.icon && st.reached ? STEPS[st.reached - 1].icon : '🥚'}</span></span>
                <span class="st-now money">${satsTxt(st.native)}</span>
                <span class="st-bar"><i style="width:${st.pct.toFixed(1)}%"></i></span>
                <span class="st-sub">${st.next ? `Próximo: <b>${esc(st.next.name)}</b> • faltam <span class="money">${satsTxt(left)}</span>${ps ? ` ≈ <span class="money">${brl(left * ps)}</span>` : ''}` : '🏆 Você tem 1 Bitcoin inteiro!'}</span>
            </button>`;
    }
    function mountCards() {
        const bal = $('balance-card');
        if (bal && !$('st-home')) { const d = document.createElement('div'); d.id = 'st-home'; bal.after(d); }
        const path = $('learn-path');
        if (path && !$('st-learn')) { const d = document.createElement('div'); d.id = 'st-learn'; path.before(d); }
        ['st-home', 'st-learn'].forEach((id) => { const el = $(id); if (el) el.innerHTML = cardHtml(); });
        checkCelebrate();
    }

    // Trilha completa
    function open() {
        close();
        const st = state(), ps = brlPerSat();
        const wrap = document.createElement('div');
        wrap.className = 'st-modal';
        wrap.id = 'st-modal';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.setAttribute('aria-label', 'Rumo ao 1º Bitcoin');
        const nodes = STEPS.map((s, i) => {
            const done = i < st.reached, cur = i === st.reached;
            const r = s.sats * ps;
            return `<li class="st-node ${done ? 'done' : ''} ${cur ? 'cur' : ''}">
                <span class="st-badge">${done ? s.icon : cur ? s.icon : '🔒'}</span>
                <span class="st-info"><b>${esc(s.name)}</b><span class="st-amt">${satsTxt(s.sats)} • ${(s.sats / SAT).toLocaleString('pt-BR', { maximumFractionDigits: 8 })} BTC</span>
                ${ps ? `<span class="st-val">${brl(r)} hoje • <b>${hoursTxt(r)}</b></span>` : ''}
                ${cur ? `<span class="st-prog"><i style="width:${st.pct.toFixed(1)}%"></i></span>` : ''}
                <small>${esc(s.tip)}</small></span>
            </li>`;
        }).join('');
        wrap.innerHTML = `
            <div class="st-sheet">
                <div class="st-head"><b>🏁 Rumo ao 1º Bitcoin</b><button type="button" class="st-x" aria-label="Fechar">✕</button></div>
                <div class="st-hero"><span class="st-hero-n money">${satsTxt(st.native)}</span><small>Bitcoin de verdade, na sua chave${ps ? ` • <span class="money">${brl(st.native * ps)}</span>` : ''}</small></div>
                ${st.wrapped > 0 ? `<p class="st-note">Você também tem <b class="money">${satsTxt(st.wrapped)}</b> em WBTC (recibo de Bitcoin). Troque por Bitcoin nativo para contar na trilha.</p>` : ''}
                <label class="st-income"><span>Quanto você ganha por mês?</span><span class="st-income-in">R$ <input type="text" inputmode="decimal" id="st-income" value="${income().toLocaleString('pt-BR')}" aria-label="Quanto você ganha por mês, em reais"></span><small>Pra mostrar cada marco em horas do <b>seu</b> trabalho. Fica só neste celular. Padrão: salário mínimo.</small></label>
                <ol class="st-path">${nodes}</ol>
                <div class="st-actions">
                    <button type="button" class="btn-primary" id="st-buy">₿ Juntar mais Bitcoin</button>
                    <button type="button" class="btn-text" id="st-learn-sats">O que é satoshi?</button>
                </div>
            </div>`;
        document.body.appendChild(wrap);
        wrap.querySelector('.st-x').onclick = close;
        wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
        wrap.querySelector('#st-income').addEventListener('change', (e) => {
            const v = Number(String(e.target.value).replace(/\./g, '').replace(',', '.'));
            const s = load(); const nv = v > 0 && v < 1e7 ? v : MIN_WAGE;
            if (nv === Number(s.monthly)) return;
            s.monthly = nv; save(s);
            // Redesenha depois que o campo termina de perder o foco (evita remover a tela no meio do evento)
            setTimeout(() => { const y = $('st-modal')?.querySelector('.st-sheet')?.scrollTop || 0; open(); const sh = $('st-modal')?.querySelector('.st-sheet'); if (sh) sh.scrollTop = y; mountCards(); }, 0);
        });
        wrap.querySelector('#st-buy').onclick = () => {
            close();
            const tab = document.querySelector('[data-tab="pixswap"]');
            tab?.click();
            setTimeout(() => document.querySelector('.sx-chip[data-q="0"]')?.click(), 120);
        };
        wrap.querySelector('#st-learn-sats').onclick = () => { close(); global.RdeskLearn?.openLesson?.('satoshi'); };
        document.addEventListener('keydown', onEsc);
        requestAnimationFrame(() => wrap.classList.add('open'));
    }
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    function close() { $('st-modal')?.remove(); document.removeEventListener('keydown', onEsc); }

    // Festa quando passa de um marco (uma vez por marco)
    function checkCelebrate() {
        const st = state();
        const s = load();
        const seen = Number(s.seen || 0);
        if (st.reached > seen) {
            s.seen = st.reached; save(s);
            if (seen === 0 && !s.init) { s.init = 1; save(s); if (st.reached === 0) return; }
            const step = STEPS[st.reached - 1];
            if (!step || document.body.classList.contains('vault-locked')) return;
            const t = document.createElement('div');
            t.className = 'st-toast';
            t.setAttribute('role', 'status');
            t.innerHTML = `<span class="st-toast-i">${step.icon}</span><span><b>Conquista: ${esc(step.name)}!</b><small>${satsTxt(step.sats)} de Bitcoin na sua chave.</small></span>`;
            document.body.appendChild(t);
            setTimeout(() => t.classList.add('out'), 4200);
            setTimeout(() => t.remove(), 4800);
        }
    }

    function init() {
        mountCards();
        document.addEventListener('click', (e) => { if (e.target.closest('[data-open-trail]')) open(); });
        ['rdesk:walletChanged', 'rdesk:pricesUpdated', 'rdesk:balancesUpdated'].forEach((ev) => global.addEventListener(ev, () => setTimeout(mountCards, 0)));
        setInterval(mountCards, 15000);
    }

    global.RdeskSatsTrail = { open, close, state, STEPS, hoursTxt, refresh: mountCards };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
    else setTimeout(init, 0);
})(window);
