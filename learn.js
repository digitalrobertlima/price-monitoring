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
    // VOZ (do próprio celular)
    // =====================================================================
    let voice = null;
    function pickVoice() {
        const vs = global.speechSynthesis?.getVoices?.() || [];
        const pt = vs.filter((v) => /^pt(-|_)BR/i.test(v.lang));
        voice = pt.find((v) => /luciana|francisca|maria|vit[oó]ria|thalita|google português/i.test(v.name)) || pt[0] || vs.find((v) => /^pt/i.test(v.lang)) || null;
    }
    if (global.speechSynthesis) { pickVoice(); global.speechSynthesis.onvoiceschanged = pickVoice; }

    function speak(text, who, onEnd) {
        const synth = global.speechSynthesis;
        const plain = String(text).replace(/<[^>]+>/g, '').replace(/[*_]/g, '');
        const fallbackMs = Math.min(9000, 900 + plain.length * 55);
        let done = false;
        const finish = () => { if (done) return; done = true; onEnd?.(); };
        if (!synth || st.muted || typeof global.SpeechSynthesisUtterance !== 'function') { setTimeout(finish, st.muted ? 600 : fallbackMs); return; }
        try {
            synth.cancel();
            const u = new global.SpeechSynthesisUtterance(plain);
            u.lang = 'pt-BR';
            try { if (voice) u.voice = voice; } catch (e) { /* voz inválida: usa a padrão do pt-BR */ }
            u.rate = who === 'bit' ? 1.08 : 1.0;
            u.pitch = who === 'bit' ? 1.55 : 1.08;
            u.onend = finish; u.onerror = finish;
            synth.speak(u);
            setTimeout(finish, fallbackMs + 4000); // alguns celulares não avisam o fim
        } catch (e) { setTimeout(finish, fallbackMs); }
    }
    const stopSpeech = () => { try { global.speechSynthesis?.cancel(); } catch (e) { /* nada */ } };

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
        medal: () => `<div class="art art-medal"><span>🏅</span></div>`
    };
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
    const LESSONS = [
        {
            id: 'dinheiro', icon: '💵', title: 'O que é dinheiro?', scenes: [
                { who: 'duda', art: 'barter', say: 'Antigamente não existia dinheiro. Quem tinha galinha trocava por milho, direto.' },
                { who: 'bit', art: 'barter', say: 'Mas e se o dono do milho não quisesse galinha? Aí complicava!' },
                { who: 'duda', art: 'history', say: 'Por isso inventaram o dinheiro: primeiro conchas, depois moedas, papel, e hoje o Pix.' },
                { who: 'bit', art: 'history', say: 'E agora tem eu: o Bitcoin, dinheiro que vive na internet!' },
                { who: 'duda', art: 'history', say: 'Pergunta rápida:', quiz: { q: 'Pra que serve o dinheiro?', options: [['🔄 Trocar por coisas e guardar valor', true], ['🎀 Só para enfeitar', false], ['🤷 Pra nada', false]] } }
            ]
        },
        {
            id: 'inflacao', icon: '🥟', title: 'Por que tudo fica mais caro?', scenes: [
                { who: 'duda', art: 'pastel', say: 'Já reparou que o pastel vai ficando mais caro com o tempo? O pastel é o mesmo. Quem perdeu valor foi o dinheiro.' },
                { who: 'bit', art: 'printer', say: 'É que o governo pode imprimir mais dinheiro. Quanto mais nota existe, menos cada uma vale.' },
                { who: 'duda', art: 'printer', say: 'Nos anos oitenta e noventa, aqui no Brasil, os preços chegavam a mudar todo dia. Chamamos isso de inflação.' },
                { who: 'duda', art: 'pastel', say: 'Pergunta rápida:', quiz: { q: 'Quando imprimem muito dinheiro, o pastel…', options: [['📈 Fica mais caro', true], ['📉 Fica mais barato', false], ['➖ Não muda nada', false]] } }
            ]
        },
        {
            id: 'bitcoin', icon: '₿', title: 'O que é o Bitcoin?', scenes: [
                { who: 'bit', art: 'genesis', say: 'Eu nasci em 2009, logo depois de uma grande crise dos bancos. Quem me criou usou um apelido: Satoshi Nakamoto.' },
                { who: 'duda', art: 'limit', say: 'O mais importante: só vão existir vinte e um milhões de bitcoins. Ninguém pode imprimir mais. Nem governo, nem banco, nem empresa.' },
                { who: 'bit', art: 'network', say: 'E eu não tenho dono! Milhares de computadores no mundo todo cuidam de mim, vinte e quatro horas por dia, desde 2009.' },
                { who: 'duda', art: 'limit', say: 'Por isso muita gente usa o Bitcoin para guardar valor por muitos anos. O preço sobe e desce bastante no caminho, então pense no longo prazo.' },
                { who: 'bit', art: 'limit', say: 'Valendo!', quiz: { q: 'Quantos bitcoins vão existir no máximo?', options: [['🔒 21 milhões', true], ['♾️ Infinitos', false], ['🏦 O banco decide', false]] } }
            ]
        },
        {
            id: 'chave', icon: '🔑', title: 'A chave e o cofre', scenes: [
                { who: 'duda', art: 'bank', say: 'No banco, quem guarda a chave do cofre é o banco. Aqui é diferente: a chave é só sua.' },
                { who: 'bit', art: 'key', say: 'A chave são doze palavras. O app cria pra você. Você só precisa escrever no papel, na ordem.' },
                { who: 'duda', art: 'key', say: 'Quem tem as doze palavras abre o cofre. Por isso: nunca mostre, nunca mande foto, nunca conte pra ninguém.' },
                { who: 'bit', art: 'scam', say: 'Nem pra quem disser que é do suporte! Ninguém de verdade vai pedir suas palavras.', quiz: { q: 'Alguém do “suporte” pede suas 12 palavras. Você…', options: [['🚫 Não passa de jeito nenhum', true], ['📲 Manda pelo WhatsApp', false], ['✂️ Manda só metade', false]] } },
                { who: 'duda', art: 'key', say: 'Agora é com você!', action: () => (hasWallet() ? null : { label: '🔑 Criar meu cofre agora', run: () => W()?.openModal('add') }) }
            ]
        },
        {
            id: 'receber', icon: '📲', title: 'Receber o primeiro valor', scenes: [
                { who: 'duda', art: 'qr', say: 'Pra receber, você mostra o seu código. É tipo uma chave Pix, só que da sua carteira.' },
                { who: 'bit', art: 'qr', say: 'A pessoa lê o código e eu chego voando na sua carteira!' },
                { who: 'duda', art: 'qr', say: 'Confira sempre a rede: é o caminho por onde a moeda viaja. Os dois lados precisam usar a mesma.' },
                { who: 'duda', art: 'qr', say: 'Bora ver o seu código?', action: () => ({ label: '📲 Ver meu código de receber', run: () => (hasWallet() ? W()?.openView('receive') : W()?.openModal('add')) }) }
            ]
        },
        {
            id: 'redes', icon: '🌳', title: 'Bitcoin e as redes novas', scenes: [
                { who: 'duda', art: 'trees', say: 'Pense numa árvore. O Bitcoin é a árvore mais velha e forte: está de pé desde 2009.' },
                { who: 'bit', art: 'trees', say: 'A Ethereum veio em 2015. Também é forte.' },
                { who: 'duda', art: 'trees', say: 'As redes mais novas são práticas e baratas, mas ainda estão crescendo e podem ter problemas. Use pra movimentar, e guarde o grosso no Bitcoin.' },
                { who: 'bit', art: 'trees', say: 'Valendo!', quiz: { q: 'Onde é mais seguro guardar por muitos anos?', options: [['🌳 No Bitcoin', true], ['🌱 Na rede mais nova', false], ['🎲 Tanto faz', false]] } }
            ]
        },
        {
            id: 'golpes', icon: '🚩', title: 'Como não cair em golpe', scenes: [
                { who: 'duda', art: 'guarantee', say: 'Se alguém promete lucro garantido todo mês, desconfie. Ninguém consegue garantir isso.' },
                { who: 'bit', art: 'scam', say: 'E nunca, nunca passe suas doze palavras. Nem pra amigo, nem pra parente, nem pra suporte.' },
                { who: 'duda', art: 'guarantee', say: 'Na dúvida, pare e pergunte pra alguém de confiança. Pressa é a arma do golpista.' },
                { who: 'bit', art: 'guarantee', say: 'Valendo!', quiz: { q: 'Prometeram 10% por mês garantido. Isso é…', options: [['🚩 Sinal de golpe', true], ['💎 Ótimo negócio', false], ['😴 Normal', false]] } }
            ]
        },
        {
            id: 'render', icon: '📈', title: 'Fazer o dinheiro trabalhar', scenes: [
                { who: 'duda', art: 'feira', say: 'Pensa numa feira de trocas. Você coloca suas moedas na barraca, e cada pessoa que troca deixa um trocadinho pra você.' },
                { who: 'bit', art: 'feira', say: 'Isso é o Render! Mas atenção: se o preço mudar muito, você pode terminar com mais de uma moeda e menos da outra.' },
                { who: 'duda', art: 'feira', say: 'Ganho não é garantido. Use só uma parte do dinheiro, e guarde a reserva no Bitcoin.', action: () => ({ label: '📈 Conhecer o Render', run: () => goTab('earn') }) }
            ]
        },
        {
            id: 'pix', icon: '💸', title: 'Comprar com Pix', scenes: [
                { who: 'duda', art: 'pix', say: 'Em breve você vai poder comprar cripto só mandando um Pix, do jeito que você já faz todo dia.' },
                { who: 'bit', art: 'pix', say: 'Você paga o Pix e eu caio direto no seu cofre!', action: () => ({ label: '💸 Ver como vai funcionar', run: () => W()?.openView('buy-pix') }) }
            ]
        }
    ];
    // Boas-vindas: a Duda e o Bit se apresentam e convidam para aprender antes de usar
    const WELCOME = {
        id: 'boasvindas', icon: '👋', title: 'Boas-vindas', scenes: [
            { who: 'duda', art: 'hello', say: 'Oi! Eu sou a Duda. Vou te acompanhar aqui dentro.' },
            { who: 'bit', art: 'hello', say: 'E eu sou o Bit, uma moeda de Bitcoin! Prazer!' },
            { who: 'duda', art: 'bank', say: 'Aqui você tem um cofre de dinheiro digital que só você abre.' },
            { who: 'duda', art: 'hello', say: 'Antes de mexer no seu dinheiro, eu te ensino o básico em poucos minutinhos. Bora?' }
        ]
    };
    const WELCOME_TRAIL = ['dinheiro', 'inflacao', 'bitcoin', 'chave'];

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
            speak(sc.say + (sc.quiz ? ` ${sc.quiz.q}` : ''), sc.who, () => { if (stage && scenes[i] === sc) setTalking(null); });
        }
        function show() {
            const sc = scenes[i];
            stage.querySelector('#ls-bar').style.width = `${((i + 1) / scenes.length) * 100}%`;
            if (sc.art !== lastArt) {
                const art = stage.querySelector('#ls-art');
                art.innerHTML = (ART[sc.art] || ART.hello)();
                art.classList.remove('in'); void art.offsetWidth; art.classList.add('in');
                animateArt(art);
                lastArt = sc.art;
            }
            const bubble = stage.querySelector('#ls-bubble');
            bubble.innerHTML = `<span class="who">${sc.who === 'bit' ? 'Bit' : 'Duda'}</span>${esc(sc.say)}${sc.quiz ? `<b class="q">${esc(sc.quiz.q)}</b>` : ''}`;
            bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop');
            const bottom = stage.querySelector('#ls-bottom');
            const last = i === scenes.length - 1;
            const action = typeof sc.action === 'function' ? sc.action() : null;
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
                            speak('Acertou!', 'bit', () => setTalking(null));
                            setTimeout(next, 900);
                        } else {
                            b.classList.remove('wrong'); void b.offsetWidth; b.classList.add('wrong');
                            buzz([40, 50, 40]);
                            setTalking('duda');
                            speak('Quase! Tenta de novo.', 'duda', () => setTalking(null));
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
        speak('Lição concluída! Mandou bem!', 'duda');
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
