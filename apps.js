// =====================================================================
// Apps dentro da carteira
// A Caixa Forte abre apps de confiança numa janela própria e empresta a carteira para eles, sem nunca
// entregar a chave: o app pede, a Caixa Forte mostra o que vai acontecer e só assina se você confirmar.
//
// Primeiro app: BRLS — Real Soberano (real digital 1:1, trabalho com pagamento garantido, conversa cifrada).
// Protocolo "ponte BRLS" (postMessage), igual ao de wallet/src/externa.js no repositório do BRLS:
//   app → aqui  { brls: 1, tipo: "ola" }
//   aqui → app  { brls: 1, tipo: "ponte", endereco, chainId, nome }
//   app → aqui  { brls: 1, tipo: "pedido", id, method, params, descricao }
//   aqui → app  { brls: 1, tipo: "resposta", id, result | erro }
//   aqui → app  { brls: 1, tipo: "conta", endereco }   (trocou de carteira)
// No app Android (Tor embutido), a janela do app não tem internet. Ela pede a rede por aqui:
//   app → aqui  { brls: 1, tipo: "rede", id, url, method, headers, corpo }
//   aqui → app  { brls: 1, tipo: "rede-resposta", id, status, conteudo, corpo } | { ..., erro }
//   app → aqui  { brls: 1, tipo: "copiar", texto }
// O pedido sai pelo fetch da Caixa Forte, que no APK é a ponte nativa: Tor, um caminho por endereço.
// Os arquivos do app vêm de dentro do APK (mesma origem oficial), nunca baixados na hora.
// Só fala com a janela do app aberto e com a origem cadastrada abaixo.
// =====================================================================
(function (global) {
    'use strict';

    const APPS = [
        {
            id: 'brls',
            nome: 'BRLS — Real Soberano',
            icone: '🏛️',
            resumo: 'Real digital 1:1. Contrate ou trabalhe com o pagamento travado em contrato até o serviço ser feito.',
            url: 'https://digitalrobertlima.github.io/xBRL/wallet/',
            origem: 'https://digitalrobertlima.github.io',
            implantacao: 'https://digitalrobertlima.github.io/xBRL/wallet/src/deployments/137.json',
            nomesContratos: { xBRL: 'Moeda BRLS', ReservaBRL: 'Reserva do BRLS', CofreCripto: 'Cofre cripto do BRLS', EscrowTrabalho: 'Trabalhos do BRLS', Mensageiro: 'Conversas do BRLS', Encaminhador: 'Envio sem gás do BRLS' },
            conversa: true, // pode pedir a chave pública e o segredo da conversa cifrada
            chainId: 137,
        },
    ];
    // Só para os testes automáticos (apontar para uma cópia local do app numa rede de teste).
    if (global.__RDESK_APPS_TESTE__) Object.assign(APPS[0], global.__RDESK_APPS_TESTE__);

    const W = () => global.RdeskWallet;
    const NATIVO = () => !!global.RDESK_NATIVE; // dentro do app Android: rede só pelo Tor
    const E = () => global.ethers;
    let aberto = null; // { app, overlay, iframe, ouvir, desligarConta, contratos }

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const curto = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
    const fmtPol = (wei) => {
        const n = Number(E().utils.formatEther(wei || 0));
        return n.toLocaleString('pt-BR', { maximumFractionDigits: n < 0.01 ? 6 : 4 });
    };

    // ---------- cartão na tela inicial ----------
    function pintarCartao() {
        const alvo = document.getElementById('apps-card');
        if (!alvo) return;
        alvo.innerHTML = `
            <div class="section-head"><div><h2>Apps na sua carteira</h2><small class="muted-sm">Usam esta carteira sem ver a sua chave. Tudo que mexe em dinheiro pede a sua confirmação aqui.</small></div></div>
            ${APPS.map((a) => `
                <button type="button" class="app-item" data-app="${esc(a.id)}">
                    <span class="app-ico" aria-hidden="true">${a.icone}</span>
                    <span class="app-txt"><strong>${esc(a.nome)}</strong><small>${esc(a.resumo)}</small></span>
                    <span class="app-ir" aria-hidden="true">Abrir</span>
                </button>`).join('')}`;
        alvo.querySelectorAll('[data-app]').forEach((b) => b.addEventListener('click', () => abrir(b.getAttribute('data-app'))));
    }

    // ---------- abrir / fechar ----------
    function abrir(id) {
        const app = APPS.find((a) => a.id === id);
        if (!app) return;
        const w = W();
        if (!w?.address) { w?.openModal?.('add'); return; }
        if (w.isWatchOnly?.()) { avisar('Esta carteira é só de observação. Escolha uma carteira com chave para usar o app.'); return; }
        if (w.isLocked?.()) { w.openModal?.('unlock'); avisar('Destranque o cofre e toque em Abrir de novo.'); return; }
        fechar();

        const overlay = document.createElement('div');
        overlay.className = 'app-frame-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', app.nome);
        overlay.setAttribute('aria-busy', 'true'); // não atualiza o app no meio do uso
        overlay.innerHTML = `
            <div class="app-frame-bar">
                <button type="button" class="app-frame-voltar" aria-label="Fechar o app">← Voltar</button>
                <strong>${app.icone} ${esc(app.nome)}</strong>
                <span class="app-frame-conta">${esc(curto(w.address))}</span>
            </div>
            <iframe class="app-frame" title="${esc(app.nome)}" src="${esc(app.url)}?via=caixaforte${NATIVO() ? '&tor=ponte' : ''}" allow="camera; clipboard-read; clipboard-write; web-share" referrerpolicy="no-referrer"></iframe>`;
        document.body.appendChild(overlay);
        document.body.classList.add('app-frame-aberto');
        const iframe = overlay.querySelector('iframe');
        overlay.querySelector('.app-frame-voltar').addEventListener('click', fechar);

        const enviar = (msg) => iframe.contentWindow?.postMessage({ brls: 1, ...msg }, app.origem);
        const ouvir = (ev) => {
            if (!aberto || ev.source !== iframe.contentWindow || ev.origin !== app.origem) return;
            const d = ev.data;
            if (!d || d.brls !== 1) return;
            if (d.tipo === 'ola') enviar({ tipo: 'ponte', endereco: W().address, chainId: app.chainId, nome: 'Caixa Forte', rede: NATIVO() });
            if (d.tipo === 'rede' && NATIVO()) {
                rede(d).then((r) => {
                    if (aberto?.iframe !== iframe) return;
                    if (!r.erro && r.status === 200) aberto.redeOk++;
                    enviar({ tipo: 'rede-resposta', id: d.id, ...r });
                });
            }
            if (d.tipo === 'copiar' && NATIVO() && typeof d.texto === 'string') {
                navigator.clipboard?.writeText(d.texto.slice(0, 4000)).then(() => avisar('Copiado. A área de transferência se apaga sozinha em 60 s.'), () => {});
            }
            if (d.tipo === 'pedido') {
                tratar(app, d)
                    .then((result) => enviar({ tipo: 'resposta', id: d.id, result }))
                    .catch((e) => enviar({ tipo: 'resposta', id: d.id, erro: { code: e.code || 4001, message: String(e.message || e).slice(0, 300) } }));
            }
        };
        global.addEventListener('message', ouvir);
        // Só avisa o app quando a conta muda DE VERDADE (o aviso da carteira também dispara ao atualizar saldos)
        let ultimaConta = String(W().address || '').toLowerCase();
        const desligarConta = W().onAccountChange?.(() => {
            const agora = String(W().address || '').toLowerCase();
            if (!aberto || aberto.iframe !== iframe || !agora || agora === ultimaConta) return;
            ultimaConta = agora;
            enviar({ tipo: 'conta', endereco: W().address });
        });
        aberto = { app, overlay, iframe, ouvir, desligarConta, contratos: null, redeOk: 0 };
        carregarContratos(app);
    }

    function fechar() {
        if (!aberto) return;
        global.removeEventListener('message', aberto.ouvir);
        if (typeof aberto.desligarConta === 'function') aberto.desligarConta();
        aberto.overlay.remove();
        document.body.classList.remove('app-frame-aberto');
        aberto = null;
    }

    async function carregarContratos(app) {
        try {
            const r = await fetch(app.implantacao, { cache: 'no-cache' });
            const j = await r.json();
            const mapa = {};
            for (const [k, nome] of Object.entries(app.nomesContratos)) if (j[k]) mapa[String(j[k]).toLowerCase()] = nome;
            if (aberto && aberto.app === app) aberto.contratos = mapa;
        } catch (e) { /* sem nomes: mostra o endereço */ }
    }

    // ---------- rede do app (só no APK: a janela do app não tem internet) ----------
    // Passa pelo fetch daqui, que no APK é a ponte nativa (Tor). Só GET/POST, com limites de tamanho e tempo.
    async function rede(d) {
        try {
            const url = new URL(String(d.url || ''));
            if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('endereço inválido');
            if (url.origin === global.location.origin) throw new Error('endereço inválido');
            const method = String(d.method || 'GET').toUpperCase();
            if (method !== 'GET' && method !== 'POST') throw new Error('pedido não suportado');
            const corpo = d.corpo == null ? undefined : String(d.corpo);
            if (corpo && corpo.length > 512 * 1024) throw new Error('pedido grande demais');
            const headers = {};
            for (const k of ['content-type', 'accept']) if (d.headers && typeof d.headers[k] === 'string') headers[k] = d.headers[k].slice(0, 100);
            const ctl = new AbortController();
            const t = setTimeout(() => ctl.abort(), 60000);
            try {
                const r = await fetch(url.href, { method, headers, body: method === 'POST' ? corpo : undefined, signal: ctl.signal });
                const texto = await r.text();
                if (texto.length > 4 * 1024 * 1024) throw new Error('resposta grande demais');
                return { status: r.status, conteudo: r.headers.get('content-type') || '', corpo: texto };
            } finally { clearTimeout(t); }
        } catch (e) {
            return { erro: String((e && e.message) || e || 'falha na rede').slice(0, 200) };
        }
    }

    // ---------- pedidos do app ----------
    function erro(code, message) {
        const e = new Error(message);
        e.code = code;
        return e;
    }

    async function tratar(app, d) {
        const w = W();
        const eu = (w.address || '').toLowerCase();
        const p = Array.isArray(d.params) ? d.params : [];
        switch (d.method) {
            case 'eth_accounts':
            case 'eth_requestAccounts':
                return [w.address];
            case 'eth_chainId':
                return '0x' + app.chainId.toString(16);
            case 'wallet_switchEthereumChain':
                if (Number(p[0]?.chainId) !== app.chainId) throw erro(4902, 'A Caixa Forte abre este app só na rede Polygon.');
                return null;
            case 'eth_sendTransaction': {
                const tx = p[0] || {};
                if (String(tx.from || '').toLowerCase() !== eu) throw erro(4100, 'O pedido veio para outra carteira.');
                if (!E().utils.isAddress(tx.to || '')) throw erro(4001, 'Pedido sem destino.');
                const valor = E().BigNumber.from(tx.value || 0);
                const gas = tx.gas ? E().BigNumber.from(tx.gas) : null;
                const signer = await w.getSigner(app.chainId);
                const precoGas = await signer.provider.getGasPrice().catch(() => null);
                return confirmarEFazer(app, {
                    titulo: 'Confirmar no app',
                    pedido: d.descricao || 'Operação no contrato',
                    contrato: tx.to,
                    linhas: [
                        valor.gt(0) ? ['Sai da sua carteira', `${fmtPol(valor)} POL`] : null,
                        gas && precoGas ? ['Taxa da rede (no máximo)', `${fmtPol(gas.mul(precoGas))} POL`] : null,
                    ],
                    botao: 'Deslize para enviar',
                    chave: ['app', app.id, tx.to, tx.data || '0x', valor.toString()],
                    enviando: 'Enviando para a rede… não feche o app',
                    pronto: 'Enviado',
                }, async () => {
                    const enviado = await signer.sendTransaction({ to: tx.to, data: tx.data || '0x', value: valor, ...(gas ? { gasLimit: gas } : {}) });
                    return enviado.hash;
                });
            }
            case 'eth_signTypedData_v4': {
                if (String(p[0] || '').toLowerCase() !== eu) throw erro(4100, 'O pedido veio para outra carteira.');
                const dados = typeof p[1] === 'string' ? JSON.parse(p[1]) : p[1];
                const tipos = { ...dados.types };
                delete tipos.EIP712Domain;
                if (Number(dados.domain?.chainId) !== app.chainId) throw erro(4001, 'Assinatura para outra rede: recusada.');
                const signer = await w.getSigner(app.chainId);
                return confirmarEFazer(app, {
                    titulo: 'Assinar (não gasta nada agora)',
                    pedido: d.descricao || 'Autorização assinada',
                    contrato: dados.domain?.verifyingContract,
                    linhas: [['O que é', dados.primaryType === 'Permit' ? 'Autorização de uso de moeda (valor exato)' : 'Ação que outra pessoa vai enviar por você']],
                    botao: 'Deslize para assinar',
                    chave: ['assinar', app.id, JSON.stringify(dados.message)],
                    enviando: 'Assinando…',
                    pronto: 'Assinado',
                }, () => signer._signTypedData(dados.domain, tipos, dados.message));
            }
            case 'personal_sign': {
                const signer = await w.getSigner(app.chainId);
                return confirmarEFazer(app, { titulo: 'Assinar mensagem', pedido: d.descricao || 'Assinatura de texto', linhas: [], botao: 'Deslize para assinar', enviando: 'Assinando…', pronto: 'Assinado' },
                    () => signer.signMessage(E().utils.arrayify(p[0])));
            }
            case 'brls_chavePublica':
            case 'brls_segredo': {
                if (!app.conversa) throw erro(4200, 'Não permitido para este app.');
                const signer = await w.getSigner(app.chainId);
                if (!signer.privateKey) throw erro(4200, 'A conversa cifrada precisa de uma carteira com chave guardada na Caixa Forte.');
                const chave = new (E().utils.SigningKey)(signer.privateKey);
                if (d.method === 'brls_chavePublica') return '0x' + chave.publicKey.slice(4);
                const pub = String(p[0] || '');
                if (!/^0x[0-9a-fA-F]{128}$/.test(pub)) throw erro(4001, 'Chave inválida.');
                return chave.computeSharedSecret('0x04' + pub.slice(2)); // só o X (32 bytes)
            }
            default:
                throw erro(4200, `O app pediu algo que a Caixa Forte não faz (${String(d.method).slice(0, 40)}).`);
        }
    }

    // ---------- confirmação: deslizar, nunca um clique ----------
    // Abre a folha (uma por vez), mostra o que o app pede e só segue se a pessoa deslizar até o fim.
    // Depois disso a folha fica travada em "Enviando…" até a rede responder, para ninguém mandar duas vezes.
    // Pedido igual a um que saiu há pouco (mesmo contrato, dados e valor): aviso grande antes.
    async function confirmar(app, o) {
        const nomeContrato = o.contrato ? (aberto?.contratos?.[String(o.contrato).toLowerCase()] || 'Contrato') : '';
        const corpo = `
            <p class="app-confirm-de">${app.icone} <strong>${esc(app.nome)}</strong> pede:</p>
            <p class="app-confirm-pedido">${esc(o.pedido)}</p>
            <div class="receipt-summary-box">
                ${o.contrato ? `<div class="rcp-line"><span>Onde</span><strong>${esc(nomeContrato)}<br><small>${esc(o.contrato)}</small></strong></div>` : ''}
                ${(o.linhas || []).filter(Boolean).map(([a, b]) => `<div class="rcp-line"><span>${esc(a)}</span><strong>${esc(b)}</strong></div>`).join('')}
                <div class="rcp-line"><span>Carteira</span><strong>${esc(curto(W().address))}</strong></div>
            </div>`;
        return global.RdeskSlide.pedir({ titulo: o.titulo, corpo, chave: o.chave, rotulo: o.botao, classe: 'app-confirm' });
    }

    /** Confirma, faz a ação e mostra o resultado na própria folha. Recusou → erro 4001. */
    async function confirmarEFazer(app, o, acao) {
        const c = await confirmar(app, o);
        if (!c) throw erro(4001, 'Você recusou na Caixa Forte.');
        c.enviando(o.enviando || 'Enviando… não feche o app');
        try {
            const r = await acao();
            c.pronto(o.pronto || 'Feito');
            return r;
        } catch (e) {
            const msg = global.RdeskWallet?.friendlyTxError ? global.RdeskWallet.friendlyTxError(e, { native: 'POL' }) : String(e?.message || e);
            c.falhou(String(msg).replace(/<[^>]*>/g, '').slice(0, 200));
            throw e;
        }
    }

    function avisar(texto) {
        if (global.RdeskFeel?.toast) global.RdeskFeel.toast(texto);
        else alert(texto);
    }

    global.RdeskApps = { lista: () => APPS.slice(), abrir, fechar, estaAberto: () => !!aberto, redeOk: () => (aberto ? aberto.redeOk : 0), _tratar: tratar, _rede: rede };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pintarCartao);
    else pintarCartao();
})(window);
