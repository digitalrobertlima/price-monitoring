/* =========================================================================
   RDESK — SENTIR O APP: sons, vibração, avisos e "tudo clicável"
   - Sons feitos na hora (Web Audio), sem baixar nada: cofre trancando,
     cofre abrindo, dinheiro entrando, toque, sucesso e erro.
   - Vibração curta nos toques (celulares Android; o iPhone não deixa).
   - Avisos do sistema (notificações) quando o app está aberto ou em
     segundo plano: dinheiro entrando, posição fora da faixa, Bitcoin
     mexendo forte. Sem servidor: com o app fechado não há aviso.
   - Selos, variações e números viram botões: um toque explica o que são.
   ========================================================================= */
(function (global) {
    'use strict';

    const KEY = 'rdesk_feel_v1';
    const DEF = { sound: true, haptic: true, notify: false, btcMove: 5 };
    let cfg = { ...DEF };
    try { cfg = { ...DEF, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) }; } catch (e) {}
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };

    // ------------------------------------------------------------------ sons
    let ac = null;
    function audio() {
        if (!cfg.sound) return null;
        try {
            if (!ac) { const C = global.AudioContext || global.webkitAudioContext; if (!C) return null; ac = new C(); }
            if (ac.state === 'suspended') ac.resume().catch(() => {});
            return ac;
        } catch (e) { return null; }
    }
    // Um "golpe" metálico: tom que cai rápido + ruído curto
    function hit(ctx, t, { freq = 180, to = 60, dur = 0.18, vol = 0.5, type = 'sine', noise = 0.25 } = {}) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
        if (noise > 0) {
            const len = Math.floor(ctx.sampleRate * 0.05), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
            const n = ctx.createBufferSource(), ng = ctx.createGain(), f = ctx.createBiquadFilter();
            f.type = 'bandpass'; f.frequency.value = 2400; n.buffer = buf; ng.gain.value = noise;
            n.connect(f).connect(ng).connect(ctx.destination); n.start(t);
        }
    }
    function ping(ctx, t, freq, dur = 0.35, vol = 0.25) {
        [1, 2.76].forEach((m, i) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'sine'; o.frequency.value = freq * m;
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol / (i + 1), t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
        });
    }
    const SOUNDS = {
        // Cofre trancando: trinco + duas batidas graves da porta pesada
        lock(ctx, t) { hit(ctx, t, { freq: 1400, to: 900, dur: 0.05, vol: 0.18, type: 'square', noise: 0.35 }); hit(ctx, t + 0.09, { freq: 140, to: 45, dur: 0.28, vol: 0.7 }); hit(ctx, t + 0.2, { freq: 95, to: 40, dur: 0.32, vol: 0.55, noise: 0.15 }); },
        // Cofre abrindo: engrenagem subindo + clique
        unlock(ctx, t) { for (let i = 0; i < 4; i++) hit(ctx, t + i * 0.045, { freq: 700 + i * 180, to: 500 + i * 150, dur: 0.03, vol: 0.12, type: 'square', noise: 0.2 }); hit(ctx, t + 0.22, { freq: 220, to: 330, dur: 0.18, vol: 0.35, noise: 0.1 }); },
        // Dinheiro entrando: duas moedas
        money(ctx, t) { ping(ctx, t, 1318); ping(ctx, t + 0.11, 1760, 0.5); hit(ctx, t, { freq: 2600, to: 2000, dur: 0.04, vol: 0.08, noise: 0.3 }); },
        tap(ctx, t) { hit(ctx, t, { freq: 900, to: 600, dur: 0.025, vol: 0.05, noise: 0 }); },
        ok(ctx, t) { ping(ctx, t, 880, 0.2, 0.18); ping(ctx, t + 0.09, 1175, 0.3, 0.18); },
        err(ctx, t) { hit(ctx, t, { freq: 220, to: 160, dur: 0.16, vol: 0.25, type: 'triangle', noise: 0 }); hit(ctx, t + 0.17, { freq: 180, to: 120, dur: 0.22, vol: 0.25, type: 'triangle', noise: 0 }); }
    };
    const VIBES = { lock: [18, 60, 40], unlock: [12, 40, 12], money: [20, 40, 20, 40, 60], tap: 8, ok: [15, 30, 15], err: [60, 40, 60] };
    let lastPlay = {};
    function play(name) {
        const now = Date.now();
        if (lastPlay[name] && now - lastPlay[name] < 120) return; // evita metralhadora
        lastPlay[name] = now;
        if (cfg.haptic && navigator.vibrate && VIBES[name]) { try { navigator.vibrate(VIBES[name]); } catch (e) {} }
        const ctx = audio();
        if (ctx && SOUNDS[name]) { try { SOUNDS[name](ctx, ctx.currentTime + 0.01); } catch (e) {} }
        lastSound = name;
    }
    let lastSound = '';

    // ------------------------------------------------------------------ avisos do sistema
    async function askNotify() {
        if (!('Notification' in global)) return 'indisponível';
        let p = Notification.permission;
        if (p === 'default') p = await Notification.requestPermission();
        cfg.notify = p === 'granted';
        save();
        return p;
    }
    const sent = [];
    async function notify(title, body, tag) {
        sent.push({ title, body, tag });
        if (!cfg.notify || !('Notification' in global) || Notification.permission !== 'granted') return false;
        if (global.RdeskAnon?.isOn?.() && /R\$|BTC|recebeu/i.test(body)) body = 'Toque para ver.'; // não mostra valores na tela bloqueada
        const opts = { body, tag: tag || title, icon: './icons/icon-192.png', badge: './icons/icon-192.png', renotify: true, vibrate: cfg.haptic ? [20, 40, 20] : undefined };
        try {
            const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
            if (reg && reg.showNotification) { await reg.showNotification(title, opts); return true; }
            new Notification(title, opts); return true;
        } catch (e) { return false; }
    }

    // Aviso dentro do app (sempre aparece, mesmo sem permissão de notificação)
    function toast(text, tone = 'ok') {
        let box = document.getElementById('rdesk-toasts');
        if (!box) { box = document.createElement('div'); box.id = 'rdesk-toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
        const el = document.createElement('div');
        el.className = `rdesk-toast ${tone}`;
        el.textContent = text;
        el.onclick = () => el.remove();
        box.appendChild(el);
        setTimeout(() => el.classList.add('out'), 4200);
        setTimeout(() => el.remove(), 4800);
    }

    function moneyIn(text) {
        play('money');
        toast(text, 'money');
        if (document.hidden) notify('Dinheiro entrando 💰', text, 'money-in');
    }

    // ------------------------------------------------------------------ tudo clicável: explica o que é
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const GLOSSARY = [
        [/rede jovem/i, 'Rede nova: mais barata e rápida, mas com menos tempo de prova. Bom para movimentar, não para guardar tudo.'],
        [/consolidad|desde 20/i, 'Há quanto tempo esta moeda ou rede existe. Quanto mais tempo funcionando sem parar, mais confiança ela conquistou.'],
        [/contrato de|contrato criado/i, 'Data em que o contrato desta moeda foi publicado na blockchain. Contratos muito novos pedem cuidado redobrado.'],
        [/24 ?h|em 24/i, 'Quanto o preço subiu ou caiu nas últimas 24 horas, comparando com a moeda que você escolheu como régua.'],
        [/ao vivo|cotaç/i, 'As cotações são atualizadas sozinhas enquanto o app está aberto. Se a fonte falhar, o app avisa que o valor é aproximado.'],
        [/rendendo|fora da faixa/i, 'Rendendo: o preço está dentro da sua faixa e você ganha tarifas. Fora da faixa: parou de ganhar até o preço voltar ou você mudar a faixa.']
    ];
    function explain(el) {
        const own = el.getAttribute('data-info') || el.getAttribute('title') || '';
        const txt = (el.textContent || '').trim();
        const g = GLOSSARY.find(([re]) => re.test(txt) || re.test(own));
        const body = own && g && own !== txt ? `${own}` : own || (g && g[1]) || '';
        if (!body) return false;
        const root = document.getElementById('ob-root');
        if (!root) return false;
        root.replaceChildren();
        const wrap = document.createElement('div');
        wrap.className = 'ob-overlay info-pop';
        wrap.setAttribute('role', 'dialog');
        wrap.innerHTML = `<div class="ob-sheet"><div class="info-pop-tag">${esc(txt.slice(0, 80))}</div><p>${esc(body)}</p>${g && own && own !== g[1] ? `<p class="muted-sm">${esc(g[1])}</p>` : ''}<button type="button" class="btn-primary" data-close>Entendi</button></div>`;
        wrap.addEventListener('click', (ev) => { if (ev.target === wrap || ev.target.hasAttribute('data-close')) root.replaceChildren(); });
        root.appendChild(wrap);
        requestAnimationFrame(() => wrap.classList.add('open'));
        return true;
    }
    const INFO_SEL = '.net-tag, .asset-tag, .chg, .quote-status, .pill-badge, [data-info]';
    document.addEventListener('click', (ev) => {
        const t = ev.target;
        if (!(t instanceof Element)) return;
        const info = t.closest(INFO_SEL);
        // Dentro de um botão maior (ex.: linha da moeda), o selo não rouba o toque — exceto se pedir explicitamente
        if (info && (!info.parentElement?.closest('button, a') || info.hasAttribute('data-info-own'))) {
            if (explain(info)) { ev.preventDefault(); ev.stopPropagation(); play('tap'); return; }
        }
        if (t.closest('button, a, [role="button"], .nav-tab-btn, input[type="checkbox"], select')) play('tap');
    }, true);
    // Selos com explicação ficam com cara de clicáveis e acessíveis pelo teclado
    function markInfo(root = document) {
        root.querySelectorAll(INFO_SEL).forEach((el) => {
            if (el.closest('button, a') && !el.hasAttribute('data-info-own')) return;
            if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
            el.classList.add('tappable');
        });
    }
    document.addEventListener('keydown', (ev) => {
        if ((ev.key === 'Enter' || ev.key === ' ') && ev.target instanceof Element && ev.target.matches(INFO_SEL) && ev.target.classList.contains('tappable')) { ev.preventDefault(); explain(ev.target); }
    });
    if (global.MutationObserver) {
        let pending = false;
        new MutationObserver(() => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; markInfo(); }); }).observe(document.documentElement, { childList: true, subtree: true });
    }

    // ------------------------------------------------------------------ painel de ajustes
    function openSettings() {
        const root = document.getElementById('ob-root');
        if (!root) return;
        root.replaceChildren();
        const perm = 'Notification' in global ? Notification.permission : 'indisponível';
        const wrap = document.createElement('div');
        wrap.className = 'ob-overlay';
        wrap.setAttribute('role', 'dialog');
        wrap.innerHTML = `<div class="ob-sheet feel-set">
            <h2>Sons, vibração e avisos</h2>
            <label class="toggle-row"><input type="checkbox" id="fs-sound" ${cfg.sound ? 'checked' : ''}><span><strong>Sons</strong><small>Cofre trancando, dinheiro entrando, toques</small></span></label>
            <label class="toggle-row"><input type="checkbox" id="fs-haptic" ${cfg.haptic ? 'checked' : ''}><span><strong>Vibração</strong><small>Só em celulares que deixam (o iPhone não deixa sites vibrarem)</small></span></label>
            <label class="toggle-row"><input type="checkbox" id="fs-notify" ${cfg.notify && perm === 'granted' ? 'checked' : ''} ${perm === 'indisponível' ? 'disabled' : ''}><span><strong>Avisos no celular</strong><small>Dinheiro entrando, posição fora da faixa e Bitcoin mexendo forte. ${perm === 'denied' ? 'Bloqueado no navegador: libere nas configurações do site.' : ''}</small></span></label>
            <label class="field-label">Avisar quando o Bitcoin mexer mais de
                <select id="fs-move" class="field-input">${[3, 5, 10].map((n) => `<option value="${n}" ${cfg.btcMove === n ? 'selected' : ''}>${n}% em 24 h</option>`).join('')}</select></label>
            <p class="muted-sm">Os avisos funcionam com o app aberto ou em segundo plano. Com o app totalmente fechado o celular não avisa: para isso seria preciso um servidor rodando o tempo todo, e o app não usa nenhum.</p>
            <div class="two-btn-row"><button type="button" class="btn-soft" id="fs-test">Testar som</button><button type="button" class="btn-primary" data-close>Pronto</button></div>
        </div>`;
        wrap.addEventListener('click', (ev) => { if (ev.target === wrap || ev.target.hasAttribute('data-close')) root.replaceChildren(); });
        root.appendChild(wrap);
        requestAnimationFrame(() => wrap.classList.add('open'));
        const $ = (id) => wrap.querySelector(id);
        $('#fs-sound').onchange = (e) => { cfg.sound = e.target.checked; save(); if (cfg.sound) play('ok'); };
        $('#fs-haptic').onchange = (e) => { cfg.haptic = e.target.checked; save(); };
        $('#fs-move').onchange = (e) => { cfg.btcMove = Number(e.target.value); save(); };
        $('#fs-notify').onchange = async (e) => {
            if (e.target.checked) { const p = await askNotify(); e.target.checked = p === 'granted'; if (p === 'granted') notify('Avisos ligados ✅', 'Você vai saber quando o dinheiro entrar.', 'test'); }
            else { cfg.notify = false; save(); }
        };
        $('#fs-test').onclick = () => { play('lock'); setTimeout(() => play('money'), 700); };
    }

    // ------------------------------------------------------------------ ligações com o resto do app
    global.addEventListener('rdesk:success', (ev) => { play('ok'); if (document.hidden && ev.detail?.text) notify('RDESK', ev.detail.text, 'success'); });
    document.addEventListener('DOMContentLoaded', () => {
        markInfo();
    });
    // Destrancou/trancou: o som acompanha o estado real do cofre
    let wasUnlocked = null;
    setInterval(() => {
        const u = global.RdeskWallet?.isUnlocked?.();
        if (typeof u !== 'boolean') return;
        if (wasUnlocked !== null && u !== wasUnlocked) play(u ? 'unlock' : 'lock');
        wasUnlocked = u;
    }, 400);

    global.RdeskFeel = {
        play, toast, notify, moneyIn, askNotify, openSettings, explain,
        get: () => ({ ...cfg }), set: (k, v) => { cfg[k] = v; save(); },
        _state: () => ({ lastSound, sent: sent.slice(), permission: 'Notification' in global ? Notification.permission : 'indisponível' })
    };
})(window);
