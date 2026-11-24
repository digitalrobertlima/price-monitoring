/* =========================================================================
   MODO ANÔNIMO + APAGAR TUDO DESTE APARELHO
   Modo anônimo (o mínimo de pistas possível, bom para Tor/Tails):
   - só consulta o saldo do Bitcoin e das redes que a pessoa escolher
     (cada servidor consultado vê o seu endereço);
   - não busca o histórico sozinho (o serviço de histórico veria seu endereço);
   - esconde os saldos ao abrir e tranca o cofre depois de 2 minutos sem uso.
   Apagar tudo: limpa cofre, histórico, preferências e cache do aparelho.
   ========================================================================= */
(function (global) {
    'use strict';
    const KEY = 'rdesk_anon_v1';
    const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || { on: false, chains: ['btc', 137] }; } catch (e) { return { on: false, chains: ['btc', 137] }; } };
    const write = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* sem armazenamento */ } };
    const $ = (s, el = document) => el.querySelector(s);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function isOn() { return Boolean(read().on); }
    // Redes que podem ser consultadas agora (fora do modo anônimo: todas)
    function chainAllowed(chainId) {
        const s = read();
        if (!s.on) return true;
        return s.chains.map(String).includes(String(chainId));
    }
    function set(on, chains) {
        const s = read();
        s.on = Boolean(on);
        if (Array.isArray(chains)) s.chains = chains;
        write(s);
        if (s.on) global.RdeskPrivacy?.set(true);
        document.body.classList.toggle('anon-on', s.on);
        global.dispatchEvent(new CustomEvent('rdesk:anon', { detail: { on: s.on } }));
        global.RdeskWallet?.refreshBalances?.().catch?.(() => {});
    }

    // Apaga tudo o que o app guardou neste aparelho (só as palavras recuperam o cofre)
    // Só o que é deste app: no mesmo endereço (digitalrobertlima.github.io) moram outros sites,
    // e eles não podem perder os dados deles quando alguém apaga o cofre.
    const OUR_DBS = ['rdesk_vault_backup'];
    const scope = () => new URL('./', global.location.href).href;
    async function wipeAll() {
        try { global.RdeskNativeBio?.forget(); } catch (e) {} // apaga também a chave da digital no chip do celular
        try {
            Object.keys(localStorage).filter((k) => /^rdesk/i.test(k)).forEach((k) => localStorage.removeItem(k));
        } catch (e) {}
        try {
            Object.keys(sessionStorage).filter((k) => /^rdesk/i.test(k)).forEach((k) => sessionStorage.removeItem(k));
        } catch (e) {}
        try {
            await Promise.all(OUR_DBS.map((name) => new Promise((res) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = () => res(); })));
        } catch (e) {}
        try { if (global.caches) { const ks = await caches.keys(); await Promise.all(ks.filter((k) => k.startsWith('rdesk-')).map((k) => caches.delete(k))); } } catch (e) {}
        try {
            if (navigator.serviceWorker) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.filter((r) => r.scope === scope()).map((r) => r.unregister()));
            }
        } catch (e) {}
    }

    // ------------------------------------------------------------------ pontes do Tor (só no app Android)
    const PONTES = [
        ['nenhuma', 'Sem ponte', 'Mais rápido. A operadora vê que você usa Tor, mas não o que faz.'],
        ['snowflake', 'Snowflake', 'Parece uma chamada de vídeo. Bom quando o Tor está bloqueado. Mais lento.'],
        ['obfs4', 'obfs4 (embutidas)', 'Tráfego embaralhado, sem cara de nada. Usa pontes públicas que vêm no app.'],
        ['propria', 'Minhas pontes', 'Cole as linhas que você recebeu (bridges.torproject.org ou o robô @GetBridgesBot no Telegram).']
    ];
    function pontesHtml() {
        let cur = { modo: 'nenhuma', proprias: '' };
        try { cur = global.RdeskNativeTor.get(); } catch (e) { /* ok */ }
        return `<div class="an-chains an-pontes"><b>🌉 Ponte do Tor</b>
            ${PONTES.map(([id, nome, txt]) => `<label class="an-ponte"><input type="radio" name="an-ponte" value="${id}" ${cur.modo === id ? 'checked' : ''}><span><b>${nome}</b><small>${txt}</small></span></label>`).join('')}
            <textarea class="rmw-input" id="an-pontes-proprias" rows="3" placeholder="obfs4 1.2.3.4:443 ABCD… cert=… iat-mode=0" style="${cur.modo === 'propria' ? '' : 'display:none'}">${esc(cur.proprias || '')}</textarea>
            <button type="button" class="rmw-btn-secondary" id="an-ponte-aplicar">Aplicar e religar o Tor</button>
            <small id="an-ponte-msg"></small>
        </div>`;
    }
    function bindPontes(m) {
        const ta = m.querySelector('#an-pontes-proprias');
        m.querySelectorAll('input[name="an-ponte"]').forEach((r) => { r.onchange = () => { ta.style.display = r.value === 'propria' && r.checked ? '' : 'none'; }; });
        m.querySelector('#an-ponte-aplicar').onclick = () => {
            const modo = m.querySelector('input[name="an-ponte"]:checked')?.value || 'nenhuma';
            if (modo === 'propria' && !/\S/.test(ta.value)) { m.querySelector('#an-ponte-msg').textContent = 'Cole pelo menos uma linha de ponte.'; return; }
            global.RdeskNativeTor.set(modo, ta.value);
            m.querySelector('#an-ponte-msg').textContent = 'Religando o Tor pela ponte escolhida… Nada sai do app até conectar.';
        };
    }

    function open() {
        document.getElementById('anon-modal')?.remove();
        const s = read();
        const chains = (global.RdeskRegistry?.CHAINS || []).map((c) => ({ id: c.id, name: c.name }));
        const m = document.createElement('div');
        m.className = 'st-modal';
        m.id = 'anon-modal';
        m.setAttribute('role', 'dialog');
        m.setAttribute('aria-modal', 'true');
        m.setAttribute('aria-label', 'Privacidade máxima');
        m.innerHTML = `<div class="st-sheet"><div class="st-head"><b>🕵️ Privacidade máxima</b><button type="button" class="st-x" aria-label="Fechar">✕</button></div>
            <div class="ag-body">
                <label class="an-toggle"><input type="checkbox" id="anon-on" ${s.on ? 'checked' : ''}><span><b>Modo anônimo</b><small>O mínimo de pistas. Use junto com o Tor Browser ou o Tails.</small></span></label>
                <ul class="an-list">
                    ${global.RDESK_NATIVE ? '<li>🧅 <b>No app Android, tudo já passa pelo Tor embutido</b>, com um caminho separado para cada endereço e outro para envios. Se o Tor cair, nada sai do app.</li>' : ''}
                    <li>🔎 Consulta só o saldo das redes marcadas abaixo. Cada servidor consultado vê o seu endereço.</li>
                    <li>📜 Não busca o histórico sozinho (o serviço de histórico veria o seu endereço).</li>
                    <li>🙈 Esconde os saldos ao abrir.</li>
                    <li>🔒 Tranca o cofre depois de 2 minutos sem uso.</li>
                </ul>
                <div class="an-chains"><b>Redes consultadas</b>
                    <label><input type="checkbox" data-ch="btc" ${s.chains.map(String).includes('btc') ? 'checked' : ''}> Bitcoin</label>
                    ${chains.map((c) => `<label><input type="checkbox" data-ch="${c.id}" ${s.chains.map(String).includes(String(c.id)) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}
                </div>
                ${global.RdeskNativeTor ? pontesHtml() : ''}
                <div class="ag-ok">✅ Sempre ligado, em qualquer modo: sem cadastro, sem rastreador, sem fontes do Google, nenhum servidor sabe que o pedido veio deste app, endereço Bitcoin novo a cada recebimento, cotação de troca com endereço neutro até você confirmar, e a voz da Duda nunca vai para a nuvem.</div>
                <h3 class="an-danger-t">🧨 Apagar tudo deste aparelho</h3>
                <p class="ag-note">Remove o cofre cifrado, o histórico e as preferências deste aparelho. Seu dinheiro <b>não</b> some: ele está na blockchain e volta com as suas palavras. <b>Sem as palavras, não tem volta.</b></p>
                <input class="rmw-input" id="anon-wipe-confirm" placeholder="Digite APAGAR para confirmar" autocomplete="off" autocapitalize="characters">
                <button type="button" class="an-wipe" id="anon-wipe">Apagar tudo agora</button>
                <div id="anon-msg"></div>
            </div></div>`;
        document.body.appendChild(m);
        const close = () => m.remove();
        $('.st-x', m).onclick = close;
        m.addEventListener('click', (e) => { if (e.target === m) close(); });
        const save = () => set($('#anon-on', m).checked, [...m.querySelectorAll('[data-ch]:checked')].map((x) => (x.dataset.ch === 'btc' ? 'btc' : Number(x.dataset.ch))));
        $('#anon-on', m).onchange = save;
        if (global.RdeskNativeTor) bindPontes(m);
        m.querySelectorAll('[data-ch]').forEach((x) => { x.onchange = save; });
        $('#anon-wipe', m).onclick = async () => {
            if ($('#anon-wipe-confirm', m).value.trim().toUpperCase() !== 'APAGAR') { $('#anon-msg', m).innerHTML = '<div class="rmw-alert-err">Digite APAGAR para confirmar.</div>'; return; }
            $('#anon-wipe', m).disabled = true; $('#anon-wipe', m).textContent = 'Apagando…';
            await wipeAll();
            global.location.replace(global.location.pathname);
        };
        requestAnimationFrame(() => m.classList.add('open'));
    }

    global.RdeskAnon = { isOn, set, chainAllowed, autoLockMs: () => (isOn() ? 2 * 60 * 1000 : 10 * 60 * 1000), open, wipeAll };
    if (document.readyState !== 'loading') document.body.classList.toggle('anon-on', isOn());
    else document.addEventListener('DOMContentLoaded', () => document.body.classList.toggle('anon-on', isOn()));
})(window);
