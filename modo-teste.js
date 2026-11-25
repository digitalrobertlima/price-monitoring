/* =========================================================================
   RDESK — MODO TESTE (testnets)
   Carrega antes de tudo. Com o modo teste ligado:
   - o app inteiro passa a usar as redes de teste (Polygon Amoy, Sepolia, Base/Arbitrum/OP
     Sepolia, Celo Sepolia, BNB testnet, HyperEVM testnet, Bitcoin testnet4, Dash testnet);
   - TUDO que o app guarda neste aparelho fica num espaço separado ("rdeskT_…"): cofre,
     carteiras, saldos salvos, extrato, preferências. O cofre real não é lido nem alterado;
   - moedas de teste não têm valor: nada entra no total em R$;
   - trocas, Pix, fundos e o relayer ficam desligados (não existem nas redes de teste).
   Desligar volta ao app normal, com o cofre real intacto.
   ========================================================================= */
(function (global) {
    'use strict';

    const FLAG = 'rdesk_modo_teste';
    const PREFIX = 'rdeskT_';
    let on = false;
    try { on = global.localStorage.getItem(FLAG) === '1'; } catch (e) { on = false; }
    global.RDESK_TESTE = on;

    function set(v) {
        try { if (v) global.localStorage.setItem(FLAG, '1'); else global.localStorage.removeItem(FLAG); } catch (e) {}
        // Recarrega: cada módulo lê as redes uma vez ao abrir, então a troca é limpa
        global.location.reload();
    }
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // Tela do modo teste (aberta pelo menu)
    function open() {
        document.getElementById('teste-modal')?.remove();
        const REG = global.RdeskRegistry;
        const nets = on ? [...(REG?.CHAINS || []), REG?.BITCOIN].filter(Boolean) : (REG?.TEST_CHAINS || []);
        const m = document.createElement('div');
        m.className = 'st-modal'; m.id = 'teste-modal';
        m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Modo teste');
        m.innerHTML = `<div class="st-sheet"><div class="st-head"><b>🧪 Modo teste</b><button type="button" class="st-x" aria-label="Fechar">✕</button></div>
            <div class="ag-body">
                <p>Use o app nas <b>redes de teste</b>: Polygon Amoy, Sepolia, Base, Arbitrum e OP Sepolia, Celo Sepolia, BNB testnet, HyperEVM testnet, <b>Bitcoin testnet4</b> e <b>Dash testnet</b>. As moedas de teste são de graça e <b>não valem nada</b>: dá para treinar envio, recebimento e o app todo sem risco.</p>
                <ul class="an-list">
                    <li>🗂 Tem um <b>cofre separado</b>: o seu cofre real não é aberto nem alterado. Crie uma carteira nova lá dentro (recomendado) ou importe uma frase só de testes.</li>
                    <li>🚫 Trocas, Pix, fundos (render) e o pagador de taxas ficam desligados: não existem nas redes de teste.</li>
                    <li>🟧 Uma faixa laranja no topo mostra o tempo todo que você está no modo teste.</li>
                </ul>
                ${on ? `<div class="teste-card"><h4>Moedas de teste grátis (faucets)</h4><p>Copie seu endereço em Receber e cole num destes sites:</p>
                    <div class="teste-faucets">${nets.filter((c) => c.faucet).map((c) => `<a href="${esc(c.faucet)}" target="_blank" rel="noopener noreferrer">${esc(c.name)}</a>`).join('')}
                    <a href="https://testnet-faucet.dash.org" target="_blank" rel="noopener noreferrer">Dash testnet</a></div></div>` : ''}
                <button type="button" class="${on ? 'btn-soft' : 'btn-primary'}" id="teste-toggle" style="margin-top:14px;width:100%">${on ? 'Sair do modo teste (voltar ao cofre real)' : 'Entrar no modo teste'}</button>
            </div></div>`;
        document.body.appendChild(m);
        const close = () => m.remove();
        m.querySelector('.st-x').addEventListener('click', close);
        m.addEventListener('click', (e) => { if (e.target === m) close(); });
        m.querySelector('#teste-toggle').addEventListener('click', () => set(!on));
        requestAnimationFrame(() => m.classList.add('open'));
    }

    global.RdeskTeste = { on, set, open, PREFIX };
    if (!on) return;

    // --------------------------------------------------------------- armazenamento separado
    const map = (k) => {
        const key = String(k);
        if (key === FLAG || key.startsWith(PREFIX) || !/^rdesk/i.test(key)) return key;
        return PREFIX + key;
    };
    // Quem já viu as boas-vindas no app real não precisa ver de novo no modo teste
    try {
        const ls = global.localStorage;
        ['rdesk_onboarding_v1'].forEach((k) => { if (ls.getItem(k) && !ls.getItem(PREFIX + k)) ls.setItem(PREFIX + k, ls.getItem(k)); });
    } catch (e) {}
    try {
        const P = global.Storage.prototype;
        const get = P.getItem, setI = P.setItem, rem = P.removeItem;
        P.getItem = function (k) { return get.call(this, map(k)); };
        P.setItem = function (k, v) { return setI.call(this, map(k), v); };
        P.removeItem = function (k) { return rem.call(this, map(k)); };
    } catch (e) {}
    try {
        const idb = global.indexedDB;
        if (idb) {
            const open = idb.open.bind(idb), del = idb.deleteDatabase.bind(idb);
            const dbMap = (n) => (/^rdesk/i.test(String(n)) && !String(n).startsWith(PREFIX) ? PREFIX + n : n);
            idb.open = (name, ...rest) => open(dbMap(name), ...rest);
            idb.deleteDatabase = (name) => del(dbMap(name));
        }
    } catch (e) {}

    // --------------------------------------------------------------- faixa sempre visível
    function banner() {
        if (document.getElementById('rdesk-teste-faixa')) return;
        document.body.classList.add('modo-teste');
        const el = document.createElement('div');
        el.id = 'rdesk-teste-faixa';
        el.setAttribute('role', 'status');
        el.innerHTML = '<span>🧪 <strong>MODO TESTE</strong> · moedas sem valor · cofre separado</span><button type="button" id="rdesk-teste-sair">Sair</button>';
        document.body.prepend(el);
        el.querySelector('#rdesk-teste-sair').addEventListener('click', () => set(false));
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();
})(typeof window !== 'undefined' ? window : globalThis);
