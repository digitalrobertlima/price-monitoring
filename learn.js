/* =========================================================================
   APRENDER — com a Duda e o Bit
   Para quem lê pouco: imagem + voz + uma ideia por tela + prática na hora.
   (Mayer: imagem com fala > imagem com texto; lições curtas no ritmo da pessoa;
    tom de conversa. Pesquisas de baixa alfabetização: ícones, áudio, um passo por vez.)

   - Duda: guia brasileira, desenhada em camadas (3D de verdade ao inclinar o celular/dedo).
   - Bit: uma moeda de Bitcoin com olhos, que conversa com a Duda.
   - Voz do próprio celular (speechSynthesis): grátis, sem cadastro, sem servidor.
   - Cada lição termina numa ação real e fácil no app.
   ========================================================================= */
(function (global) {
    'use strict';

    const KEY = 'rdesk_learn_v1';
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const W = () => global.RdeskWallet;
    const reduceMotion = () => global.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const buzz = (p) => { try { navigator.vibrate?.(p); } catch (e) { /* sem vibração */ } };

    function load() {
        try { return Object.assign({ done: {}, stars: 0, muted: false, welcomeDone: false }, JSON.parse(localStorage.getItem(KEY) || '{}')); }
        catch (e) { return { done: {}, stars: 0, muted: false, welcomeDone: false }; }
    }
    let st = load();
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* sem espaço */ } };

    // =====================================================================
    // PERSONAGENS (camadas SVG em profundidade: inclinou, vira 3D)
    // =====================================================================
    const SKIN = '<radialGradient id="dg-skin" cx="42%" cy="38%" r="70%"><stop offset="0" stop-color="#f0b98f"/><stop offset=".55" stop-color="#c98a5f"/><stop offset="1" stop-color="#9c6239"/></radialGradient>';
    function dudaLayers() {
        const svg = (inner, defs = '') => `<svg viewBox="0 0 200 240" aria-hidden="true"><defs>${defs}</defs>${inner}</svg>`;
        const curls = (list, fill) => list.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`).join('');
        const back = svg(`
            ${curls([[100, 92, 72], [52, 72, 30], [148, 72, 30], [44, 116, 30], [156, 116, 30], [64, 38, 28], [136, 38, 28], [100, 26, 30], [50, 150, 24], [150, 150, 24]], 'url(#dg-hair)')}
            <path d="M28 240 C30 196 62 178 100 178 C138 178 170 196 172 240 Z" fill="url(#dg-shirt)"/>
            <path d="M84 180 L100 202 L116 180" fill="none" stroke="#0a5655" stroke-width="4" stroke-linejoin="round"/>
            <circle cx="134" cy="210" r="10" fill="url(#dg-pin)"/><text x="134" y="215" text-anchor="middle" font-size="13" font-weight="900" fill="#3b2200">₿</text>`,
            `<radialGradient id="dg-hair" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#5a3a26"/><stop offset=".6" stop-color="#2d1b11"/><stop offset="1" stop-color="#1a0f09"/></radialGradient>
             <linearGradient id="dg-shirt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3c5"/><stop offset="1" stop-color="#0b7a76"/></linearGradient>
             <radialGradient id="dg-pin" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#ffe2a8"/><stop offset=".6" stop-color="#f7931a"/><stop offset="1" stop-color="#b45f00"/></radialGradient>`);
        const face = svg(`
            <rect x="86" y="140" width="28" height="44" rx="10" fill="#a8693f"/>
            <ellipse cx="52" cy="110" rx="9" ry="13" fill="#b77749"/><ellipse cx="148" cy="110" rx="9" ry="13" fill="#b77749"/>
            <ellipse cx="100" cy="104" rx="49" ry="57" fill="url(#dg-skin)"/>
            <circle cx="51" cy="130" r="6" fill="none" stroke="#f5c451" stroke-width="2.5"/><circle cx="149" cy="130" r="6" fill="none" stroke="#f5c451" stroke-width="2.5"/>`, SKIN);
        const eye = (x) => `<g class="eye"><ellipse cx="${x}" cy="100" rx="9.5" ry="11" fill="#fff"/><g class="pupil"><circle cx="${x}" cy="101" r="6.4" fill="#4a2a17"/><circle cx="${x}" cy="101" r="3.2" fill="#140904"/><circle cx="${x + 2.4}" cy="98" r="2" fill="#fff"/></g></g>`;
        const features = svg(`
            <path d="M70 84 Q81 77 92 83" stroke="#2a1810" stroke-width="4" fill="none" stroke-linecap="round" class="brow"/>
            <path d="M108 83 Q119 77 130 84" stroke="#2a1810" stroke-width="4" fill="none" stroke-linecap="round" class="brow"/>
            <g class="eyes">${eye(81)}${eye(119)}</g>
            <path d="M98 108 Q96 118 100 120 Q104 121 106 118" stroke="#8a5233" stroke-width="2.6" fill="none" stroke-linecap="round"/>
            <ellipse cx="70" cy="122" rx="9" ry="5" fill="#ff7a8a" opacity=".32"/><ellipse cx="130" cy="122" rx="9" ry="5" fill="#ff7a8a" opacity=".32"/>
            <g class="m-closed"><path d="M84 131 Q100 146 116 131" stroke="#7a2430" stroke-width="4" fill="#fff" stroke-linecap="round"/></g>
            <g class="m-open"><ellipse cx="100" cy="135" rx="12" ry="9" fill="#5b1520"/><ellipse cx="100" cy="140" rx="7" ry="4" fill="#e86a7a"/><rect x="91" y="127" width="18" height="4" rx="2" fill="#fff"/></g>`);
        const front = svg(curls([[66, 60, 17], [84, 50, 17], [102, 47, 17], [120, 51, 17], [136, 62, 15], [56, 78, 12], [146, 80, 12], [58, 126, 11], [144, 126, 11]], 'url(#dg-hair2)'),
            '<radialGradient id="dg-hair2" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#6b452c"/><stop offset=".7" stop-color="#2d1b11"/><stop offset="1" stop-color="#1a0f09"/></radialGradient>');
        return [[back, -18], [face, 0], [features, 10], [front, 18]];
    }

    function bitLayers() {
        const svg = (inner, defs = '') => `<svg viewBox="0 0 160 170" aria-hidden="true"><defs>${defs}</defs>${inner}</svg>`;
        const rim = svg('<circle cx="80" cy="80" r="62" fill="#9a4f00"/><circle cx="80" cy="80" r="62" fill="none" stroke="#6b3600" stroke-width="3" stroke-dasharray="3 5"/>');
        const face = svg(`
            <circle cx="80" cy="80" r="58" fill="url(#bg-gold)"/>
            <circle cx="80" cy="80" r="48" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="3"/>
            <circle cx="80" cy="80" r="56" fill="none" stroke="#c66b00" stroke-width="2" stroke-dasharray="2 4"/>
            <ellipse cx="62" cy="48" rx="18" ry="9" fill="rgba(255,255,255,.35)" transform="rotate(-25 62 48)"/>`,
            '<radialGradient id="bg-gold" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#fff0c8"/><stop offset=".45" stop-color="#f7931a"/><stop offset="1" stop-color="#b85d00"/></radialGradient>');
        const eye = (x) => `<g class="eye"><ellipse cx="${x}" cy="80" rx="10" ry="12" fill="#fff"/><g class="pupil"><circle cx="${x}" cy="82" r="6" fill="#2a1600"/><circle cx="${x + 2.4}" cy="79" r="2" fill="#fff"/></g></g>`;
        const features = svg(`
            <text x="80" y="47" text-anchor="middle" font-size="22" font-weight="900" fill="#fff6e0" opacity=".9">₿</text>
            <g class="eyes">${eye(63)}${eye(97)}</g>
            <ellipse cx="52" cy="98" rx="7" ry="4" fill="#ff6b6b" opacity=".35"/><ellipse cx="108" cy="98" rx="7" ry="4" fill="#ff6b6b" opacity=".35"/>
            <g class="m-closed"><path d="M66 103 Q80 116 94 103" stroke="#5c2a00" stroke-width="4" fill="none" stroke-linecap="round"/></g>
            <g class="m-open"><ellipse cx="80" cy="107" rx="10" ry="8" fill="#5c1a00"/><ellipse cx="80" cy="111" rx="6" ry="3.4" fill="#ff8a7a"/></g>`);
        const limbs = svg(`
            <g class="arm-l"><path d="M24 92 Q10 98 8 112" stroke="#b85d00" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="8" cy="114" r="7" fill="#ffe2a8" stroke="#b85d00" stroke-width="2"/></g>
            <g class="arm-r"><path d="M136 92 Q150 98 152 112" stroke="#b85d00" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="152" cy="114" r="7" fill="#ffe2a8" stroke="#b85d00" stroke-width="2"/></g>
            <path d="M64 136 L60 156" stroke="#b85d00" stroke-width="6" stroke-linecap="round"/><ellipse cx="57" cy="160" rx="10" ry="5" fill="#7a3d00"/>
            <path d="M96 136 L100 156" stroke="#b85d00" stroke-width="6" stroke-linecap="round"/><ellipse cx="103" cy="160" rx="10" ry="5" fill="#7a3d00"/>`);
        return [[limbs, -6], [rim, -10], [face, 0], [features, 9]];
    }

    let avSeq = 0;
    function avatarHtml(who) {
        // Cada cópia do personagem precisa de ids próprios para os degradês (senão some a cor)
        const sfx = `-${++avSeq}`;
        const uniq = (s) => s.replace(/id="([a-z0-9-]+)"/g, `id="$1${sfx}"`).replace(/url\(#([a-z0-9-]+)\)/g, `url(#$1${sfx})`);
        const layers = (who === 'duda' ? dudaLayers() : bitLayers()).map(([s, z]) => [uniq(s), z]);
        return `<div class="av av-${who}" data-av="${who}" role="img" aria-label="${who === 'duda' ? 'Duda, sua guia' : 'Bit, a moeda de Bitcoin'}">
            <div class="av-body">${layers.map(([s, z]) => `<div class="av-layer" style="--z:${z}px">${s}</div>`).join('')}</div>
            ${who === 'duda' ? '<span class="av-hand" aria-hidden="true">👋</span>' : ''}
            <span class="av-shadow" aria-hidden="true"></span>
        </div>`;
    }

    // Inclina os personagens na direção do dedo (ou do celular): profundidade de verdade
    function bindTilt(root) {
        const move = (x, y) => {
            root.querySelectorAll('.av').forEach((a) => {
                a.style.setProperty('--ry', `${(x * 22).toFixed(1)}deg`);
                a.style.setProperty('--rx', `${(-y * 14).toFixed(1)}deg`);
                a.querySelectorAll('.pupil').forEach((p) => { p.style.transform = `translate(${(x * 3).toFixed(1)}px, ${(y * 2).toFixed(1)}px)`; });
            });
        };
        root.addEventListener('pointermove', (e) => {
            const r = root.getBoundingClientRect();
            move(((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2);
        }, { passive: true });
        root.addEventListener('pointerleave', () => move(0, 0));
        const orient = (e) => { if (e.gamma == null) return; move(Math.max(-1, Math.min(1, e.gamma / 30)), Math.max(-1, Math.min(1, ((e.beta || 45) - 45) / 30))); };
        global.addEventListener('deviceorientation', orient, { passive: true });
        return () => global.removeEventListener('deviceorientation', orient);
    }

    // =====================================================================
    // VOZ: áudios naturais gravados (audio/*.mp3, gerados com Kokoro) e, só se faltar
    // algum, a voz do celular — sem mexer no tom (mexer no tom deixa robótico).
    // A boca acompanha o volume da voz de verdade (Web Audio).
    // =====================================================================
    let audioIndex = null;      // Set de chaves com áudio gravado
    let audioEl = null, audioCtx = null, analyser = null, lipRaf = 0, speakingWho = null;
    // Aberto de um arquivo (versão portátil / Tails): não dá para ler a lista, então tenta o áudio direto
    const FROM_FILE = global.location.protocol === 'file:';
    if (FROM_FILE) audioIndex = { has: () => true };
    else fetch('./audio/index.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : [])).then((list) => { audioIndex = new Set(list); }).catch(() => { audioIndex = new Set(); });

    let voice = null;
    function pickVoice() {
        const vs = global.speechSynthesis?.getVoices?.() || [];
        // Só vozes do próprio aparelho: as vozes "online" mandam o texto para servidores (Google, Microsoft)
        const local = vs.filter((v) => v.localService !== false && !/online|google/i.test(v.name));
        const pt = local.filter((v) => /^pt(-|_)BR/i.test(v.lang));
        // vozes "naturais"/neurais primeiro; as antigas de desktop por último
        const score = (v) => (/natural|neural|online/i.test(v.name) ? 3 : 0) + (/google/i.test(v.name) ? 2 : 0) + (/francisca|thalita|luciana|vit[oó]ria/i.test(v.name) ? 1 : 0) - (/desktop|maria|daniel/i.test(v.name) ? 2 : 0);
        voice = pt.sort((a, b) => score(b) - score(a))[0] || local.find((v) => /^pt/i.test(v.lang)) || null;
    }
    if (global.speechSynthesis) { pickVoice(); global.speechSynthesis.onvoiceschanged = pickVoice; }

    function setMouth(level) {
        document.querySelectorAll('.av.talking').forEach((a) => a.style.setProperty('--mouth', level.toFixed(2)));
    }
    function lipLoop() {
        if (!analyser) return;
        const buf = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        setMouth(Math.min(1, Math.max(0, (rms - 0.015) * 9)));
        lipRaf = requestAnimationFrame(lipLoop);
    }
    function ensureAudio() {
        if (audioEl) return audioEl;
        audioEl = new Audio();
        audioEl.preload = 'auto';
        try {
            const AC = global.AudioContext || global.webkitAudioContext;
            // Em arquivo local o navegador zera o som que passa pelo analisador: toca direto (sem mexer a boca pelo volume)
            if (AC && !FROM_FILE) {
                audioCtx = new AC();
                const src = audioCtx.createMediaElementSource(audioEl);
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 512;
                src.connect(analyser); analyser.connect(audioCtx.destination);
            }
        } catch (e) { analyser = null; }
        return audioEl;
    }
    // Primeiro toque na tela libera o som (regra dos navegadores)
    const unlockAudio = () => { try { ensureAudio(); audioCtx?.resume?.(); } catch (e) { /* ok */ } };
    ['pointerdown', 'keydown'].forEach((ev) => global.addEventListener(ev, unlockAudio, { passive: true }));

    function stopSpeech() {
        try { global.speechSynthesis?.cancel(); } catch (e) { /* nada */ }
        if (audioEl) { audioEl.onended = null; audioEl.pause(); }
        cancelAnimationFrame(lipRaf);
        document.body.classList.remove('lipsync');
    }

    function speak(text, who, onEnd) {
        const plain = String(text).replace(/<[^>]+>/g, '').replace(/[*_]/g, '');
        const fallbackMs = Math.min(9000, 900 + plain.length * 55);
        let done = false;
        const finish = () => { if (done) return; done = true; cancelAnimationFrame(lipRaf); document.body.classList.remove('lipsync'); onEnd?.(); };
        stopSpeech();
        speakingWho = who;
        if (st.muted) { setTimeout(finish, 600); return; }
        const key = DATA.voiceKey(who, plain);
        // 1) áudio natural gravado
        if (audioIndex && audioIndex.has(key)) {
            const a = ensureAudio();
            a.onended = finish; a.onerror = () => speakSynth(plain, who, finish, fallbackMs);
            a.src = `./audio/${key}.mp3`;
            const p = a.play();
            if (p && p.catch) {
                p.then(() => { if (analyser) { document.body.classList.add('lipsync'); lipLoop(); } })
                    .catch(() => { stage?.classList.add('needs-tap'); setTimeout(finish, fallbackMs); });
            }
            return;
        }
        // 2) voz do celular (só para falas sem áudio gravado)
        speakSynth(plain, who, finish, fallbackMs);
    }
    function speakSynth(plain, who, finish, fallbackMs) {
        const synth = global.speechSynthesis;
        // Sem voz do próprio aparelho: fica em silêncio (o texto está na tela) em vez de mandar o texto à nuvem
        if (!synth || typeof global.SpeechSynthesisUtterance !== 'function' || !voice) { setTimeout(finish, fallbackMs); return; }
        try {
            synth.cancel();
            const u = new global.SpeechSynthesisUtterance(plain);
            u.lang = 'pt-BR';
            try { if (voice) u.voice = voice; } catch (e) { /* voz inválida: usa a padrão do pt-BR */ }
            u.rate = who === 'bit' ? 1.06 : 1.0;
            u.pitch = 1;
            u.onend = finish; u.onerror = finish;
            synth.speak(u);
            setTimeout(finish, fallbackMs + 4000); // alguns celulares não avisam o fim
        } catch (e) { setTimeout(finish, fallbackMs); }
    }

    // =====================================================================
    // ILUSTRAÇÕES (desenhos que explicam sozinhos)
    // =====================================================================
    function keySvg() {
        const teeth = Array.from({ length: 12 }, (_, i) => `<rect x="${(96 + i * 9.4).toFixed(1)}" y="53" width="6.4" height="${[10, 16, 8, 14, 18, 9, 13, 17, 7, 15, 11, 16][i]}" rx="1.6" fill="#f7931a"/>`).join('');
        return `<svg class="art-key" viewBox="0 0 220 90" aria-hidden="true"><defs><linearGradient id="lk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe0a3"/><stop offset=".5" stop-color="#f7931a"/><stop offset="1" stop-color="#b45f00"/></linearGradient></defs>
            <circle cx="46" cy="45" r="36" fill="url(#lk)"/><circle cx="46" cy="45" r="15" fill="#0f1218"/><text x="46" y="52" text-anchor="middle" font-size="20" font-weight="900" fill="#f7931a">₿</text>
            <rect x="78" y="37" width="138" height="16" rx="5" fill="url(#lk)"/>${teeth}</svg>`;
    }
    const ART = {
        hello: () => `<div class="art art-hello"><span class="ah-vault">🔐</span><span class="ah-heart">💛</span></div>`,
        barter: () => `<div class="art art-barter"><span class="b1">🐔</span><span class="arr">⇄</span><span class="b2">🌽</span><small>Antes do dinheiro: troca direta</small></div>`,
        history: () => `<div class="art art-timeline">${[['🐚', 'Conchas'], ['🪙', 'Moedas'], ['💵', 'Papel'], ['📱', 'Pix'], ['₿', 'Bitcoin']].map(([e, l], i) => `<span class="tl" style="--i:${i}"><b>${e}</b><small>${l}</small></span>`).join('<i class="tl-arr">›</i>')}</div>`,
        printer: () => `<div class="art art-printer"><span class="pr">🖨️</span>${Array.from({ length: 6 }, (_, i) => `<span class="bill" style="--i:${i}">💵</span>`).join('')}</div>`,
        pastel: () => `<div class="art art-pastel"><span class="pa">🥟</span><span class="tag t1">R$ 3</span><span class="tag t2">R$ 5</span><span class="tag t3">R$ 8</span><small>Exemplo: o mesmo pastel, anos depois</small></div>`,
        genesis: () => `<div class="art art-genesis"><span class="g-news">📰<small>Crise de 2008</small></span><span class="tl-arr">›</span><span class="g-cal"><b>2009</b><small>nasce o Bitcoin</small></span></div>`,
        limit: () => `<div class="art art-limit"><div class="lim-num" data-count="21000000">0</div><div class="lim-lock">🔒 nunca mais que isso</div></div>`,
        network: () => `<div class="art art-net"><span class="globe">🌍</span>${Array.from({ length: 8 }, (_, i) => `<span class="node" style="--a:${i * 45}deg">💻</span>`).join('')}</div>`,
        bank: () => `<div class="art art-vs"><div class="vs-side bad"><b>🏦</b><small>No banco: eles guardam a chave</small></div><div class="vs-mid">×</div><div class="vs-side good"><b>🔐</b><small>Aqui: a chave é só sua</small></div></div>`,
        key: () => `<div class="art art-keybox">${keySvg()}<small>12 palavras = os dentes da chave</small></div>`,
        scam: () => `<div class="art art-scam"><span class="phone">📞</span><span class="bubble-x">“Me passa suas 12 palavras”</span><span class="no">🚫</span></div>`,
        qr: () => `<div class="art art-qr"><span class="ph">📱</span><span class="qr">▦</span><span class="coinfly">₿</span></div>`,
        trees: () => `<div class="art art-trees"><span class="tr t-btc"><b>🌳</b><small>Bitcoin 2009</small></span><span class="tr t-eth"><b>🌲</b><small>Ethereum 2015</small></span><span class="tr t-new"><b>🌱</b><small>Redes novas</small></span></div>`,
        feira: () => `<div class="art art-feira"><span class="stall">🧺</span><span class="c c1">🪙</span><span class="c c2">💵</span><span class="you">🙋</span><small>Cada troca deixa um trocadinho pra você</small></div>`,
        guarantee: () => `<div class="art art-guar"><span class="g-money">💰</span><b>“10% por mês GARANTIDO”</b><span class="no">🚩</span></div>`,
        pix: () => `<div class="art art-pixbuy"><span class="pixbuy-art big"><span class="pb-pix">PIX</span><span class="pb-arrow">➜</span><span class="pb-coin">₿</span></span></div>`,
        medal: () => `<div class="art art-medal"><span>🏅</span></div>`,
        // ---- Real, dólar e Bitcoin (valores ao vivo do próprio app)
        fx1994: () => `<div class="art art-fx"><div class="fx-card old"><small>1994</small><b>R$ 1</b><i>≈</i><b>US$ 1</b></div><small>Quando o real nasceu</small></div>`,
        fxnow: () => {
            const p = live();
            return `<div class="art art-fx"><div class="fx-card"><small>Hoje</small><b>US$ 1</b><i>=</i><b class="hot">${p ? esc(brl(p.usdBrl)) : '…'}</b></div><small>${p ? 'Cotação de agora, ao vivo' : 'Buscando a cotação…'}</small></div>`;
        },
        fxbtc: () => {
            const p = live();
            if (!p || !p.btcUsd) return `<div class="art art-fx"><div class="fx-card"><b>₿ 1</b><i>=</i><b>US$ …</b></div></div>`;
            return `<div class="art art-fx"><div class="fx-eq"><span class="fx-pill btc">₿ 1 = ${esc(usd(p.btcUsd))}</span><span class="fx-x">× ${esc(brl(p.usdBrl))}</span><span class="fx-pill brl">= ${esc(brl(p.btcUsd * p.usdBrl))}</span></div><small>Preço do bitcoin × dólar = bitcoin em reais (agora)</small></div>`;
        },
        supply: () => `<div class="art art-supply"><div class="sp-col"><div class="sp-bars">${[22, 34, 48, 64, 82, 100].map((h, i) => `<i style="--h:${h}%;--i:${i}"></i>`).join('')}</div><small>💵 Moedas: só aumentam</small></div><div class="sp-col"><div class="sp-bars btc">${[60, 80, 90, 95, 98, 100].map((h, i) => `<i style="--h:${h}%;--i:${i}"></i>`).join('')}<span class="sp-cap">🔒 21 mi</span></div><small>₿ Bitcoin: tem teto</small></div></div>`,
        world: () => `<div class="art art-world">${[['🏢', 'Empresas'], ['📊', 'Fundos'], ['🏛️', 'Governos']].map(([e, l], i) => `<span class="wd" style="--i:${i}"><b>${e}</b><small>${l}</small><em>₿</em></span>`).join('')}</div>`,
        coaster: () => `<div class="art art-coaster"><svg viewBox="0 0 240 110" aria-hidden="true"><path class="cz" d="M0 90 C20 80 30 30 50 40 S80 95 100 70 S130 10 150 30 S180 100 200 60 S225 20 240 15" fill="none" stroke="#f7931a" stroke-width="5" stroke-linecap="round"/></svg><span class="cart">🎢</span><small>Sobe e desce muito: pense em anos</small></div>`,
        // ---- Blockchain
        ledger: () => `<div class="art art-ledger"><div class="book">${['Ana → Beto: 0,01 ₿', 'Beto → Caio: 0,002 ₿', 'Caio → Duda: 0,005 ₿'].map((l, i) => `<span style="--i:${i}">✍️ ${l}</span>`).join('')}</div></div>`,
        copies: () => `<div class="art art-copies">${Array.from({ length: 6 }, (_, i) => `<span style="--i:${i}">💻<b>📒</b></span>`).join('')}<small>A mesma cópia em milhares de computadores</small></div>`,
        chain: () => `<div class="art art-chain">${[1, 2, 3, 4].map((n, i) => `<span class="blk" style="--i:${i}">🧱<small>Bloco ${n}</small></span>`).join('<i class="lnk">🔗</i>')}</div>`,
        roads: () => `<div class="art art-roads">${[['₿', 'Bitcoin', '#f7931a'], ['Ξ', 'Ethereum', '#627eea'], ['⬡', 'Polygon', '#8247e5']].map(([s, n, c], i) => `<span class="road" style="--c:${c};--i:${i}"><b>${s}</b><em>${n}</em><i class="car">🚗</i></span>`).join('')}<small>Cada rede é uma estrada • taxa = pedágio</small></div>`,
        // ---- Stablecoins
        stable: () => `<div class="art art-stable"><span class="st-a">💵</span><span class="st-eq">=</span><span class="st-b">🪙</span><small>1 pra 1, sempre</small></div>`,
        reserve: () => `<div class="art art-reserve"><span class="rv-safe">🏦<small>dinheiro guardado</small></span><span class="rv-arr">➜</span><span class="rv-coins">🪙🪙🪙<small>moeda digital</small></span></div>`,
        usd2: () => `<div class="art art-two"><div class="tw usdt"><b>USDT</b><small>Tether • 2014</small><em>o maior</em></div><div class="tw usdc"><b>USDC</b><small>Circle • 2018</small><em>regras dos EUA, relatório mensal</em></div></div>`,
        brl2: () => `<div class="art art-two"><div class="tw brz"><b>BRZ</b><small>Transfero • 2019</small><em>várias redes</em></div><div class="tw brla"><b>BRLA</b><small>Avenia</small><em>Polygon e Celo</em></div></div>`,
        brlnets: () => `<div class="art art-roads"><span class="road" style="--c:#35d07f;--i:0"><b>🟢</b><em>Celo</em><i class="car">🇧🇷</i></span><span class="road" style="--c:#8247e5;--i:1"><b>⬡</b><em>Polygon</em><i class="car">🇧🇷</i></span><span class="road" style="--c:#627eea;--i:2"><b>Ξ</b><em>Ethereum e outras</em><i class="car">🇧🇷</i></span><small>Onde o real digital mais circula</small></div>`,
        // Linhas com ícone, nome, explicação e (opcional) barrinha de 1 a 5 — usadas em várias lições
        rows: (sc) => `<div class="art art-rows">${(sc?.rows || []).map((r) => `<div class="ar ${r[3] || ''}"><span class="ar-i">${r[0]}</span><span class="ar-t"><b>${r[1]}</b><small>${r[2] || ''}</small></span>${r[4] != null ? `<span class="ar-m" aria-label="${r[4]} de 5"><i style="width:${r[4] * 20}%"></i></span>` : ''}</div>`).join('')}</div>`,
        satslive: () => {
            const v = live();
            const steps = [1000, 10000, 100000];
            const hour = 1621 / 220; // salário mínimo 2026 (R$ 1.621) em 220 horas por mês
            return `<div class="art art-rows">${steps.map((s) => {
                const r = v && v.btcUsd ? (s / 1e8) * v.btcUsd * v.usdBrl : null;
                return `<div class="ar ok"><span class="ar-i">🪙</span><span class="ar-t"><b>${s.toLocaleString('pt-BR')} satoshis</b><small>${r ? `${brl(r)} • ${fmtHours(r / hour)} de trabalho` : 'cotação carregando…'}</small></span></div>`;
            }).join('')}</div>`;
        },
        trail: () => `<div class="art art-trail">${['1 mil', '10 mil', '100 mil', '1 milhão', '10 milhões', '₿ 1'].map((m, i) => `<span class="tr-s" style="--i:${i}">${m}</span>`).join('<i>›</i>')}</div>`,
        drex: () => `<div class="art art-drex"><span class="dx">🏛️<small>Drex (Banco Central)</small></span><span class="no">⏸️</span><small>Desligado em 2025: não chegou às pessoas</small></div>`
    };
    // Cotação ao vivo (do próprio app)
    function live() {
        try {
            const p = W()?.getPrices?.();
            const usdBrl = Number(p?.USD_BRL || p?.usdBrl);
            const btcUsd = Number(p?.BTC);
            return usdBrl > 0 ? { usdBrl, btcUsd: btcUsd > 0 ? btcUsd : null } : null;
        } catch (e) { return null; }
    }
    const fmtHours = (h) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${h.toLocaleString('pt-BR', { maximumFractionDigits: h < 10 ? 1 : 0 })} h`);
    const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: v >= 1000 ? 0 : 2 });
    const usd = (v) => `US$ ${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
    function animateArt(el) {
        const n = el.querySelector('[data-count]');
        if (!n) return;
        const target = Number(n.getAttribute('data-count'));
        const t0 = performance.now();
        const step = (t) => {
            const p = Math.min(1, (t - t0) / 1600);
            n.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))).toLocaleString('pt-BR');
            if (p < 1) requestAnimationFrame(step);
        };
        reduceMotion() ? (n.textContent = target.toLocaleString('pt-BR')) : requestAnimationFrame(step);
    }

    // =====================================================================
    // LIÇÕES  (who: quem fala • art: desenho • quiz / action: prática)
    // =====================================================================
    const hasWallet = () => (W()?.getAccounts?.() || []).length > 0;
    const goTab = (tab) => document.querySelector(`.nav-tab-btn[data-tab="${tab}"]`)?.click();
    const DATA = global.RDESK_LESSONS;
    const { LESSONS, WELCOME, WELCOME_TRAIL, REACTIONS } = DATA;
    // Ações declaradas no conteúdo -> o que fazem no app
    function actionFor(a) {
        if (!a) return null;
        if (a.onlyIfNoWallet && hasWallet()) return null;
        const run = {
            'create-wallet': () => W()?.openModal('add'),
            receive: () => (hasWallet() ? W()?.openView('receive') : W()?.openModal('add')),
            'tab:earn': () => goTab('earn'),
            'buy-pix': () => W()?.openView('buy-pix'),
            'sats-trail': () => global.RdeskSatsTrail?.open?.(),
            'tab:pixswap': () => goTab('pixswap'),
            'tab:audit': () => goTab('audit'),
            market: () => global.RdeskMarket?.openMarket?.(),
            feel: () => global.RdeskFeel?.openSettings?.(),
            anon: () => global.RdeskAnon?.open?.(),
            send: () => (hasWallet() ? W()?.openView('send') : W()?.openModal('add')),
            calc: () => { goTab('earn'); setTimeout(() => document.getElementById('earn-calc')?.scrollIntoView({ behavior: 'smooth' }), 300); },
            offline: () => global.RdeskAirgap?.open?.(),
            pools: () => global.RdeskPools?.open?.()
        }[a.kind];
        return run ? { label: a.label, run } : null;
    }

    // =====================================================================
    // PALCO (tela cheia): personagens + desenho + balão + prática
    // =====================================================================
    let stage = null, untilt = null, onFinishTrail = null;

    function closeStage() {
        stopSpeech();
        untilt?.();
        stage?.remove();
        stage = null;
        document.body.classList.remove('learn-open');
        renderPath();
    }

    function openLesson(lesson, { trail = null } = {}) {
        closeStage();
        stage = document.createElement('div');
        stage.className = 'learn-stage';
        stage.id = 'learn-stage';
        stage.setAttribute('role', 'dialog');
        stage.setAttribute('aria-modal', 'true');
        stage.setAttribute('aria-label', lesson.title);
        stage.innerHTML = `
            <div class="ls-top">
                <button type="button" class="ls-x" id="ls-close" aria-label="Fechar">✕</button>
                <div class="ls-progress"><span id="ls-bar"></span></div>
                <button type="button" class="ls-sound" id="ls-sound" aria-label="Som">${st.muted ? '🔇' : '🔊'}</button>
            </div>
            <div class="ls-title">${esc(lesson.icon)} ${esc(lesson.title)}</div>
            <div class="ls-art" id="ls-art"></div>
            <div class="ls-bubble" id="ls-bubble" aria-live="polite"></div>
            <div class="ls-cast" id="ls-cast">
                ${avatarHtml('duda')}
                ${avatarHtml('bit')}
            </div>
            <div class="ls-bottom" id="ls-bottom"></div>`;
        document.body.appendChild(stage);
        document.body.classList.add('learn-open');
        untilt = bindTilt(stage);
        let i = 0;
        let lastArt = null;

        stage.querySelector('#ls-close').onclick = () => { if (trail && !st.welcomeDone) finishWelcome(false); else closeStage(); };
        stage.querySelector('#ls-sound').onclick = () => {
            st.muted = !st.muted; save();
            stage.querySelector('#ls-sound').textContent = st.muted ? '🔇' : '🔊';
            if (st.muted) stopSpeech(); else play();
        };
        // Tocar na Duda: ela acena. Tocar no Bit: ele gira.
        stage.querySelector('.av-duda').addEventListener('click', (e) => { const a = e.currentTarget; a.classList.remove('wave'); void a.offsetWidth; a.classList.add('wave'); buzz(15); });
        stage.querySelector('.av-bit').addEventListener('click', (e) => { const a = e.currentTarget; a.classList.remove('spin'); void a.offsetWidth; a.classList.add('spin'); buzz([10, 30, 10]); });

        const scenes = lesson.scenes;
        function setTalking(who) {
            stage.querySelectorAll('.av').forEach((a) => {
                const me = a.getAttribute('data-av') === who;
                a.classList.toggle('talking', me);
                a.classList.toggle('listening', !me && Boolean(who));
            });
            const bubble = stage.querySelector('#ls-bubble');
            bubble.classList.toggle('from-bit', who === 'bit');
        }
        function play() {
            const sc = scenes[i];
            setTalking(sc.who);
            stage?.classList.remove('needs-tap');
            speak(DATA.spoken(sc), sc.who, () => { if (stage && scenes[i] === sc) setTalking(null); });
        }
        function show() {
            const sc = scenes[i];
            stage.querySelector('#ls-bar').style.width = `${((i + 1) / scenes.length) * 100}%`;
            const artKey = sc.rows ? `${sc.art}:${JSON.stringify(sc.rows)}` : sc.art; // desenhos com dados próprios mudam a cada cena
            if (artKey !== lastArt) {
                const art = stage.querySelector('#ls-art');
                art.innerHTML = (ART[sc.art] || ART.hello)(sc);
                art.classList.remove('in'); void art.offsetWidth; art.classList.add('in');
                animateArt(art);
                lastArt = artKey;
            }
            const bubble = stage.querySelector('#ls-bubble');
            bubble.innerHTML = `<span class="who">${sc.who === 'bit' ? 'Bit' : 'Duda'}</span>${esc(sc.say)}${sc.quiz ? `<b class="q">${esc(sc.quiz.q)}</b>` : ''}`;
            bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop');
            const bottom = stage.querySelector('#ls-bottom');
            const last = i === scenes.length - 1;
            const action = actionFor(sc.action);
            if (sc.quiz) {
                bottom.innerHTML = `<div class="ls-quiz">${sc.quiz.options.map(([label], k) => `<button type="button" class="ls-opt" data-k="${k}">${esc(label)}</button>`).join('')}</div>
                    <button type="button" class="ls-again" id="ls-again">🔁 Ouvir de novo</button>`;
                bottom.querySelectorAll('.ls-opt').forEach((b) => {
                    b.onclick = () => {
                        const ok = sc.quiz.options[Number(b.getAttribute('data-k'))][1];
                        if (ok) {
                            b.classList.add('right');
                            bottom.querySelectorAll('.ls-opt').forEach((x) => { x.disabled = true; });
                            stage.querySelector('.av-bit').classList.add('spin');
                            buzz(30);
                            setTalking('bit');
                            speak(REACTIONS.right.say, REACTIONS.right.who, () => setTalking(null));
                            setTimeout(next, 900);
                        } else {
                            b.classList.remove('wrong'); void b.offsetWidth; b.classList.add('wrong');
                            buzz([40, 50, 40]);
                            setTalking('duda');
                            speak(REACTIONS.wrong.say, REACTIONS.wrong.who, () => setTalking(null));
                        }
                    };
                });
            } else {
                bottom.innerHTML = `${action ? `<button type="button" class="ls-action" id="ls-action">${esc(action.label)}</button>` : ''}
                    <button type="button" class="ls-next ${action ? 'secondary' : ''}" id="ls-next">${last ? (action ? 'Depois' : 'Concluir ✓') : 'Continuar ▶'}</button>
                    <button type="button" class="ls-again" id="ls-again">🔁 Ouvir de novo</button>`;
                bottom.querySelector('#ls-next').onclick = next;
                if (action) bottom.querySelector('#ls-action').onclick = () => { complete(lesson, { silent: true }); closeStage(); trail ? finishTrail() : null; action.run(); };
            }
            bottom.querySelector('#ls-again').onclick = play;
            play();
        }
        function next() {
            if (!stage) return;
            if (i < scenes.length - 1) { i += 1; show(); return; }
            complete(lesson);
            if (trail) {
                const nextId = trail.shift();
                const nextLesson = nextId && LESSONS.find((l) => l.id === nextId);
                if (nextLesson) { celebrateThen(lesson, () => openLesson(nextLesson, { trail })); return; }
                celebrateThen(lesson, finishTrail);
                return;
            }
            celebrateThen(lesson, closeStage);
        }
        show();
    }

    function celebrateThen(lesson, then) {
        if (!stage) { then(); return; }
        const isWelcome = lesson.id === WELCOME.id;
        if (isWelcome) { then(); return; }
        stage.querySelector('#ls-art').innerHTML = ART.medal();
        stage.querySelector('#ls-bubble').innerHTML = `<span class="who">Duda</span>Lição concluída! ⭐ Você tem ${st.stars} estrela${st.stars === 1 ? '' : 's'}.`;
        stage.querySelector('.av-bit').classList.add('dance');
        stage.querySelector('#ls-bottom').innerHTML = '<button type="button" class="ls-next" id="ls-next">Continuar ▶</button>';
        stage.querySelector('#ls-next').onclick = then;
        stage.querySelectorAll('.av').forEach((a) => a.classList.add('happy'));
        const talk = (who) => stage?.querySelectorAll('.av').forEach((av) => av.classList.toggle('talking', av.getAttribute('data-av') === who));
        talk('duda');
        speak(REACTIONS.done.say, REACTIONS.done.who, () => talk(null));
        global.RdeskOnboarding?.celebrate?.('Lição concluída!');
        buzz([20, 40, 20, 40, 60]);
    }

    function complete(lesson, { silent = false } = {}) {
        if (lesson.id === WELCOME.id) return;
        if (!st.done[lesson.id]) { st.done[lesson.id] = Date.now(); st.stars += 1; save(); }
        if (!silent) renderPath();
    }

    function finishTrail() {
        closeStage();
        finishWelcome(true);
    }

    // Primeira abertura: Duda se apresenta e leva pela trilha básica antes de usar o app
    function startWelcome(onDone) {
        onFinishTrail = onDone || null;
        openLesson(WELCOME, { trail: WELCOME_TRAIL.filter((id) => !st.done[id]) });
    }
    function finishWelcome(learned) {
        const wasDone = st.welcomeDone;
        st.welcomeDone = true; save();
        closeStage();
        if (!wasDone) onFinishTrail?.(learned);
        onFinishTrail = null;
    }

    // =====================================================================
    // ABA "APRENDER": trilha em forma de mapa
    // =====================================================================
    function renderPath() {
        const box = document.getElementById('learn-path');
        if (!box) return;
        const doneCount = LESSONS.filter((l) => st.done[l.id]).length;
        const nextLesson = LESSONS.find((l) => !st.done[l.id]);
        const head = document.getElementById('learn-progress');
        if (head) head.innerHTML = `<b>${doneCount} de ${LESSONS.length}</b> lições • ⭐ ${st.stars}<span class="lp-bar"><i style="width:${(doneCount / LESSONS.length) * 100}%"></i></span>`;
        box.innerHTML = LESSONS.map((l, k) => {
            const state = st.done[l.id] ? 'done' : l === nextLesson ? 'next' : 'todo';
            return `<li class="lp-node ${state}" style="--k:${k}">
                <button type="button" data-lesson="${l.id}" aria-label="${esc(l.title)}${state === 'done' ? ' (concluída)' : ''}">
                    <span class="lp-icon">${esc(l.icon)}</span>
                    ${state === 'done' ? '<span class="lp-check">✓</span>' : ''}
                </button>
                <span class="lp-label">${esc(l.title)}</span>
                ${state === 'next' ? '<span class="lp-here">👇 Comece aqui</span>' : ''}
            </li>`;
        }).join('');
        box.querySelectorAll('[data-lesson]').forEach((b) => {
            b.onclick = () => openLesson(LESSONS.find((l) => l.id === b.getAttribute('data-lesson')));
        });
    }

    // Gestos terminam sozinhos (para a pessoa poder tocar de novo)
    document.addEventListener('animationend', (e) => {
        const el = e.target;
        if (el.classList?.contains('av-body')) el.closest('.av')?.classList.remove('spin', 'dance');
        if (el.classList?.contains('av-hand')) el.closest('.av')?.classList.remove('wave');
    });

    function init() {
        const guide = document.getElementById('learn-guide');
        if (guide && !guide.children.length) {
            guide.innerHTML = `${avatarHtml('duda')}${avatarHtml('bit')}`;
            bindTilt(guide);
            guide.querySelector('.av-duda').addEventListener('click', (e) => { e.currentTarget.classList.remove('wave'); void e.currentTarget.offsetWidth; e.currentTarget.classList.add('wave'); });
            guide.querySelector('.av-bit').addEventListener('click', (e) => { e.currentTarget.classList.remove('spin'); void e.currentTarget.offsetWidth; e.currentTarget.classList.add('spin'); });
        }
        document.getElementById('btn-learn-start')?.addEventListener('click', () => {
            const n = LESSONS.find((l) => !st.done[l.id]) || LESSONS[0];
            openLesson(n);
        });
        renderPath();
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stage) closeStage(); });
    }

    global.RdeskLearn = {
        LESSONS, WELCOME, startWelcome, openLesson: (id) => openLesson(LESSONS.find((l) => l.id === id) || WELCOME),
        close: closeStage, getState: () => JSON.parse(JSON.stringify(st)), renderPath,
        reset: () => { st = { done: {}, stars: 0, muted: st.muted, welcomeDone: false }; save(); renderPath(); }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(window);
