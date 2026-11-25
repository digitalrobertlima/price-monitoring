// =====================================================================
// Deslizar para confirmar (v48.3)
// Mover dinheiro nunca é um clique: a pessoa arrasta o botão até o fim da trilha.
// - Trava curta ao abrir (um toque que "vazou" de outra tela não confirma nada).
// - Depois de confirmar, a trilha fica travada em "Enviando…" até a rede responder: não dá para mandar de novo.
// - Pedido igual a um que acabou de sair (mesmo destino, valor e moeda, nos últimos 3 min):
//   aviso grande antes, para a pessoa não pagar duas vezes achando que o celular não enviou.
//
// RdeskSlide.trilha(el, { rotulo, aoConfirmar })   → monta a trilha dentro de el
// RdeskSlide.pedir({ titulo, corpo, texto, chave, rotulo })  → Promise<controle | null>
//     controle.enviando(txt) · controle.pronto(txt) · controle.falhou(txt) · controle.fechar()
// RdeskSlide.confirmarTexto(texto, { titulo, chave, rotulo }) → Promise<boolean>  (troca o confirm() do navegador)
// =====================================================================
(function (global) {
    'use strict';

    const TRAVA_MS = 900;          // espera ao abrir antes de aceitar o deslize
    const LIMIAR = 0.9;            // precisa arrastar 90% da trilha
    const JANELA_REPETIDO = 180;   // segundos em que um pedido igual gera aviso
    const MEMO = 'rdesk_envios_recentes_v1';

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    // ---------- pedidos recentes (anti-duplicado) ----------
    function lerMemo() {
        try { return JSON.parse(sessionStorage.getItem(MEMO) || '{}'); } catch (e) { return {}; }
    }
    function gravarMemo(m) {
        try { sessionStorage.setItem(MEMO, JSON.stringify(m)); } catch (e) { /* sem memória: segue */ }
    }
    function chaveDe(partes) {
        return (Array.isArray(partes) ? partes : [partes]).map((p) => String(p ?? '').toLowerCase()).join('|').slice(0, 600);
    }
    /** Segundos desde o último envio igual (ou null). */
    function repetido(chave) {
        if (!chave) return null;
        const t = lerMemo()[chaveDe(chave)];
        if (!t) return null;
        const s = Math.round((Date.now() - t) / 1000);
        return s >= 0 && s <= JANELA_REPETIDO ? s : null;
    }
    function registrar(chave) {
        if (!chave) return;
        const m = lerMemo();
        const agora = Date.now();
        for (const k of Object.keys(m)) if (agora - m[k] > JANELA_REPETIDO * 1000) delete m[k];
        m[chaveDe(chave)] = agora;
        gravarMemo(m);
    }

    // ---------- a trilha ----------
    function trilha(alvo, { rotulo = 'Deslize para confirmar', aoConfirmar, perigo = false } = {}) {
        alvo.innerHTML = `
            <div class="slide-trilha${perigo ? ' perigo' : ''}" data-estado="espera">
                <div class="slide-preenche"></div>
                <span class="slide-rotulo">Aguarde…</span>
                <button type="button" class="slide-botao" role="slider" aria-label="${esc(rotulo)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" disabled>
                    <span aria-hidden="true">➜</span>
                </button>
            </div>`;
        const tr = alvo.querySelector('.slide-trilha');
        const bt = tr.querySelector('.slide-botao');
        const pre = tr.querySelector('.slide-preenche');
        const rot = tr.querySelector('.slide-rotulo');
        let fim = false;
        let arrastando = null;

        const max = () => Math.max(1, tr.clientWidth - bt.offsetWidth - 8);
        const pos = (x) => {
            const v = Math.max(0, Math.min(max(), x));
            bt.style.transform = `translateX(${v}px)`;
            pre.style.width = `${v + bt.offsetWidth / 2 + 4}px`;
            bt.setAttribute('aria-valuenow', String(Math.round((v / max()) * 100)));
            return v;
        };
        const voltar = () => {
            tr.classList.add('volta');
            pos(0);
            setTimeout(() => tr.classList.remove('volta'), 260);
        };
        const confirmar = () => {
            if (fim) return;
            fim = true;
            pos(max());
            tr.dataset.estado = 'feito';
            bt.disabled = true;
            rot.textContent = 'Confirmado';
            try { navigator.vibrate?.(30); } catch (e) { /* ok */ }
            aoConfirmar?.();
        };

        setTimeout(() => {
            if (fim) return;
            bt.disabled = false;
            tr.dataset.estado = 'pronta';
            rot.textContent = rotulo;
        }, TRAVA_MS);

        bt.addEventListener('pointerdown', (e) => {
            if (bt.disabled || fim) return;
            arrastando = { x0: e.clientX, id: e.pointerId };
            bt.setPointerCapture?.(e.pointerId);
            tr.classList.add('arrastando');
        });
        bt.addEventListener('pointermove', (e) => {
            if (!arrastando || e.pointerId !== arrastando.id) return;
            pos(e.clientX - arrastando.x0);
        });
        const soltar = (e) => {
            if (!arrastando || (e && e.pointerId !== arrastando.id)) return;
            const v = e ? e.clientX - arrastando.x0 : 0;
            arrastando = null;
            tr.classList.remove('arrastando');
            if (v >= max() * LIMIAR) confirmar();
            else voltar();
        };
        bt.addEventListener('pointerup', soltar);
        bt.addEventListener('pointercancel', () => { arrastando = null; tr.classList.remove('arrastando'); voltar(); });
        // Teclado (acessibilidade): setas andam um quarto da trilha; chegar ao fim confirma.
        bt.addEventListener('keydown', (e) => {
            if (bt.disabled || fim) return;
            const atual = Number(bt.getAttribute('aria-valuenow')) || 0;
            let novo = null;
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') novo = atual + 25;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'Home') novo = 0;
            if (e.key === 'End') novo = 100;
            if (novo == null) return;
            e.preventDefault();
            pos((Math.min(100, novo) / 100) * max());
            if (novo >= 100) confirmar();
        });

        return {
            travar(texto) {
                fim = true;
                bt.disabled = true;
                pos(max());
                tr.dataset.estado = 'enviando';
                rot.textContent = texto || 'Enviando…';
            },
            rotulo(texto) { rot.textContent = texto; },
            elemento: tr,
        };
    }

    // ---------- folha completa ----------
    let aberta = null;
    let fila = Promise.resolve();

    /** Abre a folha de confirmação. Uma por vez: um segundo pedido espera o primeiro terminar. */
    function pedir(o) {
        const vez = fila.then(() => abrir(o));
        fila = vez.then((c) => (c ? c._terminou : null)).catch(() => null);
        return vez;
    }

    function abrir({ titulo = 'Confirmar', corpo = '', texto = '', chave = null, rotulo = 'Deslize para confirmar', classe = '' } = {}) {
        return new Promise((resolve) => {
            const seg = repetido(chave);
            const m = document.createElement('div');
            m.className = `modal-overlay slide-folha ${classe}`.trim();
            m.style.display = 'flex';
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-modal', 'true');
            m.innerHTML = `
                <div class="modal-sheet">
                    <div class="modal-top"><h3>${esc(titulo)}</h3></div>
                    ${seg != null ? `<div class="slide-repetido" role="alert"><strong>⚠️ Você já enviou este mesmo pedido há ${seg < 60 ? `${seg} s` : `${Math.round(seg / 60)} min`}.</strong>
                        Ele pode ainda estar a caminho: a rede às vezes demora. Se deslizar de novo, <strong>sai outra vez</strong> e você paga duas vezes.</div>` : ''}
                    ${corpo}
                    ${texto ? `<p class="slide-texto">${esc(texto)}</p>` : ''}
                    <div class="slide-lugar"></div>
                    <p class="slide-status" aria-live="polite"></p>
                    <button type="button" class="btn-text slide-cancelar">Cancelar</button>
                </div>`;
            document.body.appendChild(m);
            aberta = m;
            const status = m.querySelector('.slide-status');
            const cancelar = m.querySelector('.slide-cancelar');
            let terminou;
            const terminouP = new Promise((r) => (terminou = r));
            let estado = 'aberta';
            const fechar = () => {
                if (!m.isConnected) return;
                m.remove();
                if (aberta === m) aberta = null;
                terminou();
            };
            const controle = {
                _terminou: terminouP,
                enviando(t) { estado = 'enviando'; t$.travar(t || 'Enviando… não feche o app'); cancelar.hidden = true; m.classList.add('enviando'); },
                pronto(t) {
                    estado = 'pronto';
                    m.classList.remove('enviando');
                    t$.rotulo('✅ ' + (t || 'Enviado'));
                    status.textContent = '';
                    setTimeout(fechar, 1400);
                },
                falhou(t) {
                    estado = 'falhou';
                    m.classList.remove('enviando');
                    status.textContent = t || 'Não foi enviado.';
                    status.classList.add('erro');
                    t$.rotulo('Não foi enviado');
                    cancelar.hidden = false;
                    cancelar.textContent = 'Fechar';
                },
                fechar,
                estaEnviando: () => estado === 'enviando',
            };
            const t$ = trilha(m.querySelector('.slide-lugar'), {
                rotulo: seg != null ? 'Deslize para enviar DE NOVO' : rotulo,
                perigo: seg != null,
                aoConfirmar: () => {
                    registrar(chave);
                    estado = 'confirmada';
                    cancelar.hidden = true;
                    resolve(controle);
                },
            });
            cancelar.addEventListener('click', () => {
                if (estado === 'aberta') { fechar(); resolve(null); return; }
                if (estado === 'falhou' || estado === 'pronto') fechar();
            });
            m.addEventListener('click', (e) => {
                if (e.target === m && estado === 'aberta') { fechar(); resolve(null); }
            });
            setTimeout(() => m.querySelector('.slide-botao')?.focus(), TRAVA_MS + 20);
        });
    }

    /** Troca direta do confirm(): confirma e fecha (quem chamou mostra o andamento na própria tela). */
    async function confirmarTexto(texto, o = {}) {
        const c = await pedir({ titulo: o.titulo || 'Confirmar envio', texto, chave: o.chave, rotulo: o.rotulo });
        if (!c) return false;
        c.fechar();
        return true;
    }

    // Botão voltar do Android: enquanto envia, não fecha nada; aberta, cancela.
    function voltar() {
        if (!aberta) return false;
        if (aberta.classList.contains('enviando')) return true;
        aberta.querySelector('.slide-cancelar:not([hidden])')?.click();
        return true;
    }

    global.RdeskSlide = { trilha, pedir, confirmarTexto, repetido, registrar, voltar, estaAberta: () => !!aberta, _TRAVA_MS: TRAVA_MS };
})(window);
