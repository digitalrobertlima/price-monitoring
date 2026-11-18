/* =========================================================================
   RDESK — PRIMEIRA EXPERIÊNCIA, PRIMEIROS PASSOS, DICAS NA HORA E MENU
   - Boas-vindas curtas (3 cartões) só na primeira abertura.
   - "Primeiros passos" na tela inicial, com progresso, até a pessoa
     completar o essencial; depois some sozinho.
   - Dica curta na PRIMEIRA vez que a pessoa entra em cada tela (ajuda na
     hora em que ela precisa, que é o que a pesquisa mostra funcionar).
   - Tudo pode ser revisto em Menu → "Rever o tutorial".
   ========================================================================= */
(function (global) {
    'use strict';

    const KEY = 'rdesk_onboarding_v1';
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function load() {
        try { return Object.assign({ introDone: false, finished: false, hidden: false, did: {}, tips: {} }, JSON.parse(localStorage.getItem(KEY) || '{}')); }
        catch (e) { return { introDone: false, finished: false, hidden: false, did: {}, tips: {} }; }
    }
    let st = load();
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };

    const W = () => global.RdeskWallet;
    const root = () => document.getElementById('ob-root');

    // ------------------------------------------------------------------ peças visuais
    function sheet(html, opts = {}) {
        const r = root();
        if (!r) return null;
        close();
        const wrap = document.createElement('div');
        wrap.className = `ob-overlay ${opts.full ? 'full' : ''}`;
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.innerHTML = `<div class="ob-sheet ${opts.className || ''}">${html}</div>`;
        wrap.addEventListener('click', (e) => { if (e.target === wrap && !opts.locked) close(); });
        r.appendChild(wrap);
        requestAnimationFrame(() => wrap.classList.add('open'));
        const focusable = wrap.querySelector('[data-autofocus]') || wrap.querySelector('button');
        focusable?.focus({ preventScroll: true });
        return wrap;
    }
    function close() { root()?.replaceChildren(); }

    function toast(text, kind = 'ok') {
        let t = document.getElementById('ob-toast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'ob-toast';
            t.setAttribute('role', 'status');
            document.body.appendChild(t);
        }
        t.className = `ob-toast ${kind}`;
        t.textContent = text;
        t.classList.remove('show');
        void t.offsetWidth;
        t.classList.add('show');
        clearTimeout(t._h);
        t._h = setTimeout(() => t.classList.remove('show'), 3200);
    }

    // Comemoração curta: o fim de uma tarefa marca a memória da experiência (regra do pico-fim)
    function celebrate(text) {
        try { navigator.vibrate?.(35); } catch (e) {}
        toast(`✓ ${text}`, 'ok');
        if (global.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        const burst = document.createElement('div');
        burst.className = 'ob-burst';
        burst.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 14; i++) {
            const s = document.createElement('i');
            s.style.setProperty('--a', `${(360 / 14) * i}deg`);
            s.style.setProperty('--d', `${60 + (i % 3) * 18}px`);
            burst.appendChild(s);
        }
        document.body.appendChild(burst);
        setTimeout(() => burst.remove(), 900);
    }

    // ------------------------------------------------------------------ boas-vindas (3 cartões)
    const INTRO = [
        {
            art: '<span class="coin c1">₿</span><span class="coin c2">Ξ</span><span class="coin c3">$</span>',
            title: 'Bem-vindo ao RDESK',
            text: 'Uma carteira de dinheiro digital em que <strong>só você tem a chave</strong>. Nenhum banco ou empresa consegue mexer no seu dinheiro — nem nós.'
        },
        {
            art: '<span class="paper">1 casa&nbsp;&nbsp;2 lua<br>3 rio&nbsp;&nbsp;&nbsp;4 pão<br>…&nbsp;&nbsp;12 sol</span>',
            title: 'Você é o dono. E o responsável.',
            text: 'Sua carteira é protegida por <strong>12 palavras</strong>. Quem tem as palavras tem o dinheiro. Anote no papel e guarde bem: se perder, ninguém consegue recuperar.'
        },
        {
            art: '<span class="coin c1 big">₿</span>',
            title: 'Bitcoin: a sua reserva',
            text: 'O <strong>Bitcoin</strong> funciona sem parar desde 2009 e ninguém consegue imprimir mais. É o lugar mais seguro para guardar patrimônio a longo prazo. A <strong>Ethereum</strong> (desde 2015) vem logo depois. As redes mais novas são práticas e baratas, mas <strong>ainda estão nascendo</strong> e têm mais riscos: use para movimentar, não para guardar tudo.'
        },
        {
            art: '<span class="mini-actions"><b>↓</b><b>↑</b><b>⇄</b><b>↗</b></span>',
            title: 'O que dá para fazer aqui',
            text: '<strong>Receber</strong> e <strong>enviar</strong> moedas, <strong>trocar</strong> uma por outra e fazer o dinheiro <strong>render</strong>. Vamos mostrando cada coisa na hora em que você precisar.'
        }
    ];

    function showIntro(i = 0) {
        const c = INTRO[i];
        const last = i === INTRO.length - 1;
        const dots = INTRO.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('');
        const el = sheet(`
            <div class="ob-intro">
                <div class="ob-art" aria-hidden="true">${c.art}</div>
                <h2 id="ob-title">${c.title}</h2>
                <p>${c.text}</p>
                <div class="ob-dots" aria-label="Passo ${i + 1} de ${INTRO.length}">${dots}</div>
                <button type="button" class="btn-primary" id="ob-next" data-autofocus>${last ? 'Vamos começar' : 'Continuar'}</button>
                <button type="button" class="btn-text" id="ob-skip">${last ? 'Só quero olhar' : 'Pular'}</button>
            </div>`, { full: true, locked: true, className: 'intro' });
        if (!el) return;
        el.querySelector('#ob-next').onclick = () => {
            if (!last) { showIntro(i + 1); return; }
            finishIntro(true);
        };
        el.querySelector('#ob-skip').onclick = () => finishIntro(false);
    }
    // Primeira abertura: a Duda ensina o básico ANTES de a pessoa mexer em qualquer coisa
    function firstRun() {
        if (global.RdeskLearn) global.RdeskLearn.startWelcome((learned) => finishIntro(learned));
        else showIntro(0);
    }
    function finishIntro(start) {
        st.introDone = true; save();
        close();
        renderSteps();
        if (start && W() && !W().getAccounts().length) W().openModal('add');
    }

    // ------------------------------------------------------------------ primeiros passos
    function stepList() {
        const w = W();
        const accs = w ? w.getAccounts() : [];
        const hasAcc = accs.length > 0;
        let total = 0;
        try { total = (w?.getBalances() || []).reduce((s, b) => s + (b.amount > 0 ? 1 : 0), 0); } catch (e) {}
        return [
            { id: 'wallet', title: 'Criar ou abrir sua carteira', hint: 'Leva 2 minutos. Tenha papel e caneta por perto.', done: hasAcc, go: () => w?.openModal(hasAcc ? 'list' : 'add') },
            { id: 'receive', title: 'Conhecer o seu endereço', hint: 'É o “número” da sua carteira, para alguém te enviar moedas.', done: Boolean(st.did.receive), go: () => (hasAcc ? w.openView('receive') : w?.openModal('add')) },
            { id: 'fund', title: 'Colocar sua primeira moeda', hint: 'Peça para alguém enviar ou mande de outra carteira sua.', done: total > 0, go: () => (hasAcc ? w.openView('receive') : w?.openModal('add')) },
            { id: 'earn', title: 'Conhecer o Render', hint: 'Veja como suas moedas podem render, sem compromisso.', done: Boolean(st.did.earn), go: () => document.querySelector('.nav-tab-btn[data-tab="earn"]')?.click() }
        ];
    }

    function renderSteps() {
        const box = document.getElementById('getting-started');
        if (!box) return;
        if (!st.introDone || st.finished || st.hidden) { box.hidden = true; return; }
        const steps = stepList();
        const done = steps.filter((s) => s.done).length;
        if (done === steps.length) {
            st.finished = true; save();
            box.hidden = true;
            celebrate('Primeiros passos concluídos!');
            return;
        }
        const next = steps.find((s) => !s.done);
        box.hidden = false;
        box.innerHTML = `
            <div class="steps-head">
                <div>
                    <h2>Primeiros passos</h2>
                    <span class="muted-sm">${done} de ${steps.length} feitos</span>
                </div>
                <button type="button" class="btn-text small" data-steps-hide>Esconder</button>
            </div>
            <div class="steps-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="${done}"><span style="width:${Math.max(6, (done / steps.length) * 100)}%"></span></div>
            <ol class="steps-list">
                ${steps.map((s) => `
                    <li class="${s.done ? 'done' : ''} ${s === next ? 'next' : ''}">
                        <button type="button" data-step="${s.id}" ${s.done ? 'aria-disabled="true"' : ''}>
                            <span class="step-check" aria-hidden="true">${s.done ? '✓' : ''}</span>
                            <span class="step-text"><strong>${esc(s.title)}</strong>${s === next ? `<small>${esc(s.hint)}</small>` : ''}</span>
                            ${s.done ? '' : '<span class="step-go" aria-hidden="true">›</span>'}
                        </button>
                    </li>`).join('')}
            </ol>`;
        box.querySelectorAll('[data-step]').forEach((b) => {
            b.onclick = () => { const s = steps.find((x) => x.id === b.getAttribute('data-step')); if (s && !s.done) s.go(); };
        });
        box.querySelector('[data-steps-hide]').onclick = () => { st.hidden = true; save(); renderSteps(); toast('Você pode rever o tutorial no menu ☰'); };
    }

    // ------------------------------------------------------------------ dicas na hora certa
    const TIPS = {
        receive: { title: 'Este é o seu endereço', text: 'Funciona como o número da sua carteira. Mostre o código ou copie o endereço para quem vai te enviar. <strong>Escolha a mesma rede que a pessoa vai usar</strong> — rede é o caminho por onde a moeda viaja.' },
        send: { title: 'Antes de enviar', text: 'Confira o endereço inteiro e a rede. Envio em blockchain <strong>não tem estorno</strong>. Na dúvida, mande um valor pequeno primeiro.' },
        pixswap: { title: 'Trocar moedas', text: 'Escolha o que você dá e o que quer receber. O app mostra quanto você recebe <strong>antes</strong> de confirmar, e bloqueia trocas que te fariam perder dinheiro.' },
        earn: { title: 'Render', text: 'O gráfico mostra o preço do POL. A faixa azul é onde seu dinheiro trabalha: <strong>arraste as alças azuis</strong> para escolher a sua, ou use a sugerida. Nada acontece até você confirmar.' },
        audit: { title: 'Seu extrato', text: 'Aqui aparecem todas as suas transações, como num extrato do banco. Em cima, quanto você ganhou ou perdeu desde o começo, comparando com a moeda que você escolher (Bitcoin, real, dólar ou ether).' },
        addtoken: { title: 'Adicionar uma moeda', text: 'Pegue o endereço do contrato no <strong>site oficial</strong> do projeto. Qualquer pessoa pode criar uma moeda com qualquer nome.' }
    };
    function maybeTip(id) {
        if (!st.introDone || st.tips[id] || !TIPS[id]) return;
        st.tips[id] = true; save();
        const t = TIPS[id];
        let card = document.getElementById('ob-coach');
        if (!card) {
            card = document.createElement('div');
            card.id = 'ob-coach';
            card.className = 'ob-coach';
            card.setAttribute('role', 'status');
            document.body.appendChild(card);
        }
        card.innerHTML = `<div><strong>${t.title}</strong><p>${t.text}</p></div><button type="button" class="btn-soft" data-coach-ok>Entendi</button>`;
        // Com uma janela aberta (Receber, Enviar…), a dica fica no topo para não cobrir os botões
        card.classList.toggle('top', Boolean(document.getElementById('rdesk-mw-overlay')?.classList.contains('open')));
        card.classList.add('show');
        card.querySelector('[data-coach-ok]').onclick = () => card.classList.remove('show');
    }

    // ------------------------------------------------------------------ explicações e menu
    const EXPLAIN = {
        render: `
            <h2>Como o Render funciona</h2>
            <ol class="explain-list">
                <li><strong>Você coloca POL e dólar digital</strong> num fundo de trocas da Uniswap (um serviço público na blockchain).</li>
                <li><strong>Quem troca paga uma taxa pequena</strong>, e uma parte dela vai para você.</li>
                <li><strong>Só rende dentro da faixa.</strong> Se o preço sair dela, para de render até voltar ou até você mudar a faixa.</li>
            </ol>
            <h3>Riscos — leia com calma</h3>
            <ul class="explain-list risk">
                <li>Se o POL cair muito, você fica com mais POL e menos dólar (e o contrário se subir). Pode terminar com menos do que colocou.</li>
                <li>Os ganhos mostrados são <strong>estimativas</strong>, não promessa.</li>
                <li>Contratos podem ter falhas. Coloque só o que aceita arriscar.</li>
                <li>O Render roda na <strong>Polygon, uma rede jovem</strong> (de 2020). Use só uma parte do seu dinheiro; sua reserva fica melhor em Bitcoin.</li>
            </ul>`,
        security: `
            <h2>Como sua carteira é protegida</h2>
            <ul class="explain-list">
                <li>As 12 palavras ficam <strong>cifradas neste aparelho</strong> com a sua senha. Nada vai para servidor nenhum.</li>
                <li>A carteira se <strong>tranca sozinha</strong> depois de 10 minutos sem uso.</li>
                <li>Antes de qualquer envio, troca ou render, o app mostra um <strong>recibo em reais</strong> para você conferir.</li>
                <li>Se limpar os dados do navegador ou trocar de celular, você só entra de novo com as 12 palavras.</li>
            </ul>`
    };
    function explain(id) {
        const el = sheet(`<div class="ob-explain">${EXPLAIN[id] || ''}<button type="button" class="btn-primary" data-autofocus id="ob-close">Entendi</button></div>`);
        el?.querySelector('#ob-close')?.addEventListener('click', close);
    }

    function openMenu() {
        const hidden = global.RdeskPrivacy?.isHidden();
        const install = document.getElementById('btn-install-pwa');
        const canInstall = install && install.style.display !== 'none';
        const el = sheet(`
            <div class="ob-menu">
                <h2>Menu</h2>
                <button type="button" data-m="wallets"><span>👛</span>Minhas carteiras</button>
                <button type="button" data-m="pix"><span>💸</span>Receber por Pix</button>
                <button type="button" data-m="addtoken"><span>＋</span>Adicionar uma moeda</button>
                <button type="button" data-m="ref"><span>⚖️</span>Comparar com outra moeda</button>
                <button type="button" data-m="privacy"><span>👁</span>${hidden ? 'Mostrar saldos' : 'Esconder saldos'}</button>
                <button type="button" data-m="learn"><span>🎓</span>Aprender com a Duda</button>
                <button type="button" data-m="tutorial"><span>👋</span>Rever as boas-vindas</button>
                <button type="button" data-m="security"><span>🛡️</span>Como sua carteira é protegida</button>
                <button type="button" data-m="render"><span>📈</span>Como o Render funciona</button>
                ${canInstall ? '<button type="button" data-m="install"><span>📲</span>Instalar no celular</button>' : ''}
                <p class="muted-sm">RDESK é um app aberto: o código está no GitHub e roda só no seu aparelho.</p>
            </div>`);
        if (!el) return;
        el.querySelectorAll('[data-m]').forEach((b) => {
            b.onclick = () => {
                const m = b.getAttribute('data-m');
                close();
                if (m === 'wallets') W()?.openModal(W().getAccounts().length ? 'list' : 'add');
                else if (m === 'addtoken') document.getElementById('btn-add-token')?.click();
                else if (m === 'pix') W()?.openView('pix');
                else if (m === 'ref') global.RdeskHistory?.openRefPicker();
                else if (m === 'privacy') global.RdeskPrivacy?.set(!global.RdeskPrivacy.isHidden());
                else if (m === 'tutorial') restart();
                else if (m === 'learn') document.querySelector('.nav-tab-btn[data-tab="learn"]')?.click();
                else if (m === 'security' || m === 'render') explain(m);
                else if (m === 'install') install?.click();
            };
        });
    }

    function restart() {
        st = { introDone: false, finished: false, hidden: false, did: {}, tips: {} };
        save();
        global.RdeskLearn?.reset?.();
        firstRun();
    }

    // ------------------------------------------------------------------ ligações
    function mark(id) {
        if (st.did[id]) return;
        st.did[id] = true; save();
        renderSteps();
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('btn-open-menu')?.addEventListener('click', openMenu);
        document.getElementById('btn-welcome-create')?.addEventListener('click', () => W()?.openModal('add'));
        document.getElementById('btn-welcome-import')?.addEventListener('click', () => W()?.openModal('add'));
        document.querySelectorAll('[data-explain]').forEach((b) => b.addEventListener('click', () => explain(b.getAttribute('data-explain'))));

        document.querySelectorAll('.nav-tab-btn').forEach((b) => b.addEventListener('click', () => {
            const tab = b.getAttribute('data-tab');
            if (tab === 'earn') mark('earn');
            setTimeout(() => maybeTip(tab), 350);
        }));

        global.addEventListener('rdesk:view', (e) => {
            const view = e.detail?.view;
            if (view === 'receive') mark('receive');
            if (view === 'receive' || view === 'send' || view === 'addtoken') setTimeout(() => maybeTip(view), 400);
        });
        global.addEventListener('rdesk:walletChanged', () => renderSteps());
        global.addEventListener('rdesk:success', (e) => celebrate(e.detail?.text || 'Pronto!'));

        if (!st.introDone) setTimeout(firstRun, 250);
        else renderSteps();
        setInterval(() => { if (!document.hidden && !st.finished && !st.hidden) renderSteps(); }, 15000);
    });

    global.RdeskOnboarding = {
        restart, showIntro, openMenu, explain, celebrate, toast,
        getState: () => JSON.parse(JSON.stringify(st)),
        renderSteps
    };
})(window);
