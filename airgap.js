/* =========================================================================
   BITCOIN SEM INTERNET (assinatura "air-gapped")
   1) Celular COM internet prepara o pedido (lê as moedas do endereço) → QR.
   2) Celular SEM internet (modo avião, com as palavras) lê o QR, mostra
      tudo, refaz a conta sozinho e assina → QR da transação assinada.
   3) Qualquer celular com internet (de preferência via Tor/VPN) lê esse QR
      e transmite. A chave nunca encosta na internet.
   ========================================================================= */
(function (global) {
    'use strict';
    const B = () => global.RdeskBitcoin;
    const W = () => global.RdeskWallet;
    const $ = (s, el = document) => el.querySelector(s);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const REQ = 'RDESK1REQ:', TX = 'RDESK1TX:';
    const MAX_INPUTS = 6; // mantém o QR legível pela câmera
    const btc = (sats) => `${(sats / 1e8).toLocaleString('pt-BR', { minimumFractionDigits: 8, maximumFractionDigits: 8 })} BTC`;
    const satsTxt = (n) => `${Number(n).toLocaleString('pt-BR')} sats`;
    const brlOf = (sats) => { try { const p = W().getPrices(); return p.BTC > 0 && p.USD_BRL > 0 ? W().formatBRL((sats / 1e8) * p.BTC * p.USD_BRL) : ''; } catch (e) { return ''; } };
    const b64u = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const unb64u = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

    // ------------------------------------------------------------------ pedido
    function encodeRequest(r) { return REQ + b64u(JSON.stringify({ v: 1, f: r.from, t: r.to, a: r.max ? 'max' : r.amount, r: r.feeRate, u: r.utxos.map((x) => [x.txid, x.vout, x.value]) })); }
    function decodeRequest(text) {
        const s = String(text || '').trim();
        if (!s.startsWith(REQ)) throw new Error('Este QR não é um pedido de assinatura do cofre.');
        const o = JSON.parse(unb64u(s.slice(REQ.length)));
        if (o.v !== 1 || !B().isValidAddress(o.f) || !B().isValidAddress(o.t)) throw new Error('Pedido inválido ou de versão diferente.');
        if (!Array.isArray(o.u) || !o.u.length || o.u.length > MAX_INPUTS) throw new Error('Pedido com moedas demais ou nenhuma.');
        const utxos = o.u.map(([txid, vout, value]) => {
            if (!/^[0-9a-f]{64}$/.test(txid) || !Number.isInteger(vout) || !Number.isInteger(value) || value <= 0) throw new Error('Pedido com dados estranhos. Não assine.');
            return { txid, vout, value, confirmed: true };
        });
        const feeRate = Number(o.r);
        if (!Number.isInteger(feeRate) || feeRate < 1 || feeRate > 500) throw new Error('Pedido com taxa estranha. Não assine.');
        if (o.a !== 'max' && !(Number.isInteger(o.a) && o.a >= B().DUST_SATS)) throw new Error('Pedido com valor estranho. Não assine.');
        if (new Set(utxos.map((u) => `${u.txid}:${u.vout}`)).size !== utxos.length) throw new Error('Pedido com moeda repetida. Não assine.');
        return { from: o.f, to: o.t, max: o.a === 'max', amount: o.a === 'max' ? 0 : Number(o.a), feeRate, utxos };
    }
    // Refaz o plano a partir do pedido (o aparelho que assina nunca confia num plano pronto)
    function planFrom(req, changeAddress) {
        return B().planTransaction({ utxos: req.utxos, toAddress: req.to, amountSats: req.amount, feeRate: req.feeRate, changeAddress, sendMax: req.max });
    }

    // ------------------------------------------------------------------ QR grande
    function drawBigQr(host, text) {
        host.replaceChildren();
        if (typeof QRCode === 'undefined') { host.textContent = 'QR indisponível'; return; }
        const size = Math.min(320, Math.floor((global.innerWidth || 360) - 64));
        new QRCode(host, { text, width: size, height: size, colorDark: '#000000', colorLight: '#ffffff', correctLevel: text.length > 900 ? QRCode.CorrectLevel.L : QRCode.CorrectLevel.M });
    }
    async function scanText(title) {
        if (!global.RdeskQrScanner) return null;
        return global.RdeskQrScanner.scan({ title });
    }

    // ------------------------------------------------------------------ tela
    let modal = null;
    function shell(title, body) {
        close();
        modal = document.createElement('div');
        modal.className = 'st-modal ag';
        modal.id = 'ag-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', title);
        modal.innerHTML = `<div class="st-sheet"><div class="st-head"><b>${esc(title)}</b><button type="button" class="st-x" aria-label="Fechar">✕</button></div><div class="ag-body">${body}</div></div>`;
        document.body.appendChild(modal);
        $('.st-x', modal).onclick = close;
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        requestAnimationFrame(() => modal?.classList.add('open'));
        return $('.ag-body', modal);
    }
    function close() { document.getElementById('ag-modal')?.remove(); modal = null; }
    const msg = (el, text, bad = true) => { el.innerHTML = text ? `<div class="${bad ? 'rmw-alert-err' : 'ag-ok'}">${esc(text)}</div>` : ''; };

    function hub() {
        const body = shell('🛰️ Bitcoin sem internet', `
            <p class="ag-lead">A chave fica num celular <b>sem internet</b> (modo avião). Outro celular, com internet, só leva e traz QR Codes. Nem um vírus no celular conectado consegue pegar suas palavras.</p>
            <div class="ag-steps">
                <button type="button" class="ag-step" data-ag="prepare"><span>1</span><b>Preparar o envio</b><small>No celular COM internet</small></button>
                <button type="button" class="ag-step" data-ag="sign"><span>2</span><b>Assinar</b><small>No celular SEM internet, com as palavras</small></button>
                <button type="button" class="ag-step" data-ag="broadcast"><span>3</span><b>Transmitir</b><small>Em qualquer celular com internet</small></button>
            </div>
            <p class="ag-note">Para esconder de onde sai a transação, faça o passo 3 no Tor Browser ou com uma VPN ligada (ex.: Orbot no Android). O app usa o caminho que o celular der.</p>`);
        body.querySelectorAll('[data-ag]').forEach((b) => { b.onclick = () => ({ prepare, sign, broadcast })[b.dataset.ag](); });
    }

    // 1) PREPARAR (online)
    function prepare() {
        const acc = (() => { try { return W().getActiveAccount(); } catch (e) { return null; } })();
        const body = shell('1 · Preparar o envio', `
            <label class="rmw-label" for="ag-from">Endereço Bitcoin do cofre sem internet</label>
            <div class="ag-row"><input class="rmw-input" id="ag-from" placeholder="bc1q…" autocomplete="off" spellcheck="false" value="${esc(W().getBitcoinSpendAddress?.() || acc?.btcAddress || '')}"><button type="button" class="rmw-icon-btn" id="ag-from-scan" aria-label="Ler QR">📷</button></div>
            <label class="rmw-label" for="ag-to">Para quem vai (endereço Bitcoin)</label>
            <div class="ag-row"><input class="rmw-input" id="ag-to" placeholder="bc1…" autocomplete="off" spellcheck="false"><button type="button" class="rmw-icon-btn" id="ag-to-scan" aria-label="Ler QR">📷</button></div>
            <label class="rmw-label" for="ag-amt">Quanto (em satoshis)</label>
            <input class="rmw-input" id="ag-amt" inputmode="numeric" placeholder="ex.: 50000">
            <label class="ag-check"><input type="checkbox" id="ag-max"> Mandar tudo</label>
            <div id="ag-msg"></div>
            <button type="button" class="rmw-btn-primary" id="ag-go">Gerar QR do pedido</button>
            <div id="ag-out"></div>`);
        const scanInto = (btnId, inputId) => { $(btnId, body).onclick = async () => { const t = await scanText('Ler endereço'); if (t) { const p = global.RdeskQrScanner.parsePayload(t); $(inputId, body).value = p.address || t.trim(); } }; };
        scanInto('#ag-from-scan', '#ag-from'); scanInto('#ag-to-scan', '#ag-to');
        $('#ag-go', body).onclick = async () => {
            const m = $('#ag-msg', body), out = $('#ag-out', body);
            msg(m, ''); out.innerHTML = '';
            const from = $('#ag-from', body).value.trim(), to = $('#ag-to', body).value.trim();
            const max = $('#ag-max', body).checked, amount = Math.round(Number(String($('#ag-amt', body).value).replace(/\D/g, '')));
            if (!B().isValidAddress(from)) return msg(m, 'Endereço do cofre sem internet inválido.');
            if (!B().isValidAddress(to)) return msg(m, 'Endereço de destino inválido.');
            if (!max && !(amount >= B().DUST_SATS)) return msg(m, `Valor mínimo: ${B().DUST_SATS} satoshis.`);
            $('#ag-go', body).disabled = true; $('#ag-go', body).textContent = 'Lendo as moedas do endereço…';
            try {
                const [utxosAll, fees] = await Promise.all([B().fetchUtxos(from), B().fetchFeeRates()]);
                const utxos = utxosAll.filter((u) => u.confirmed).sort((a, b) => b.value - a.value).slice(0, MAX_INPUTS);
                const req = { from, to, max, amount, feeRate: Math.max(1, Math.ceil(fees.normal)), utxos };
                const plan = planFrom(req, from);
                req.utxos = plan.inputs; // só as moedas usadas (QR menor)
                const text = encodeRequest(req);
                out.innerHTML = `<div class="ag-sum"><div><span>Vai</span><b>${btc(plan.amount)}</b><small>${brlOf(plan.amount)}</small></div><div><span>Taxa da rede</span><b>${satsTxt(plan.fee)}</b><small>${brlOf(plan.fee)}</small></div></div>
                    <p class="ag-lead">Agora, no celular <b>sem internet</b>: Bitcoin sem internet → <b>2 · Assinar</b> → leia este QR.</p>
                    <div class="ag-qr" id="ag-qr"></div><textarea class="rmw-textarea ag-raw" readonly>${esc(text)}</textarea>`;
                drawBigQr($('#ag-qr', out), text);
                if (utxosAll.filter((u) => u.confirmed).length > MAX_INPUTS) msg(m, `Usando só as ${MAX_INPUTS} maiores moedas do endereço (para o QR caber).`, false);
            } catch (e) { msg(m, e.message); }
            $('#ag-go', body).disabled = false; $('#ag-go', body).textContent = 'Gerar QR do pedido';
        };
    }

    // 2) ASSINAR (offline)
    function sign(prefill) {
        const online = navigator.onLine;
        const body = shell('2 · Assinar sem internet', `
            ${online ? '<div class="ag-warn">📶 Este celular parece estar com internet. Para a chave nunca encostar na rede, ligue o <b>modo avião</b> antes de assinar.</div>' : '<div class="ag-ok">✈️ Sem internet. Ótimo.</div>'}
            <button type="button" class="rmw-btn-primary" id="ag-scan">📷 Ler o QR do pedido</button>
            <details class="more-opts"><summary>Colar o pedido</summary><textarea class="rmw-textarea" id="ag-paste" placeholder="RDESK1REQ:…"></textarea><button type="button" class="rmw-btn-secondary" id="ag-paste-go">Usar</button></details>
            <div id="ag-msg"></div><div id="ag-out"></div>`);
        const m = $('#ag-msg', body), out = $('#ag-out', body);
        const handle = (text) => {
            msg(m, ''); out.innerHTML = '';
            let req, key, plan;
            try {
                req = decodeRequest(text);
                if (W().isLocked?.()) { W().openModal('unlock'); throw new Error('Abra o cofre (PIN ou senha) e leia o QR de novo.'); }
                const mine = W().getBitcoinAddresses?.() || [];
                if (!mine.includes(req.from)) throw new Error('Este pedido é de outro cofre. Confira se abriu o cofre certo neste celular.');
                key = W().getBitcoinKeyFor(req.from);
                // troco num endereço novo do cofre (privacidade)
                plan = planFrom(req, W().getBitcoinChangeAddress?.() || key.address);
            } catch (e) { return msg(m, e.message); }
            const changeOk = plan.outputs.every((o) => o.isMemo || o.address === req.to || (W().getBitcoinAddresses?.() || [key.address]).includes(o.address));
            const feeHigh = plan.fee > Math.max(30000, plan.amount * 0.05);
            if (!changeOk) return msg(m, 'O pedido mandaria dinheiro para um endereço que não é o destino nem o seu. Não assinado.');
            out.innerHTML = `
                <div class="ag-sum big"><div><span>Para</span><b class="ag-addr">${esc(req.to)}</b></div>
                <div><span>Valor</span><b>${btc(plan.amount)}</b><small>${satsTxt(plan.amount)}</small></div>
                <div><span>Taxa da rede</span><b>${satsTxt(plan.fee)}</b><small>${req.feeRate} sat/vB</small></div>
                <div><span>Volta pra você</span><b>${plan.change ? btc(plan.change) : '—'}</b></div></div>
                ${feeHigh ? '<label class="ag-check warn"><input type="checkbox" id="ag-feeok"> A taxa está alta. Entendi e quero assinar mesmo assim.</label>' : ''}
                <p class="ag-lead">Confira o endereço de destino <b>letra por letra</b> com quem vai receber.</p>
                <button type="button" class="rmw-btn-primary" id="ag-sign">✍️ Assinar</button>`;
            $('#ag-sign', out).onclick = () => {
                if (feeHigh && !$('#ag-feeok', out).checked) return msg(m, 'Marque que entendeu a taxa alta.');
                try {
                    const signed = B().signTransaction(plan, key.privateKey);
                    W().afterBitcoinSpend?.(plan);
                    const qrText = TX + B().hexToB64(signed.hex);
                    out.innerHTML = `<div class="ag-ok">✅ Assinada. Agora leve este QR para um celular com internet: Bitcoin sem internet → <b>3 · Transmitir</b>.</div>
                        <div class="ag-qr" id="ag-qr"></div><p class="ag-txid">Código da transação: <code>${esc(signed.txid)}</code></p><textarea class="rmw-textarea ag-raw" readonly id="ag-signed-hex">${esc(signed.hex)}</textarea>`;
                    drawBigQr($('#ag-qr', out), qrText);
                } catch (e) { msg(m, e.message); }
            };
        };
        $('#ag-scan', body).onclick = async () => { const t = await scanText('Ler pedido de assinatura'); if (t) handle(t); };
        $('#ag-paste-go', body).onclick = () => handle($('#ag-paste', body).value);
        if (prefill) handle(prefill);
    }

    // 3) TRANSMITIR (online)
    function broadcast(prefill) {
        const body = shell('3 · Transmitir', `
            <p class="ag-lead">Leia o QR da transação assinada. Você confere tudo antes de mandar para a rede.</p>
            <button type="button" class="rmw-btn-primary" id="ag-scan">📷 Ler o QR da transação</button>
            <details class="more-opts"><summary>Colar a transação (hex)</summary><textarea class="rmw-textarea" id="ag-paste" placeholder="02000000…"></textarea><button type="button" class="rmw-btn-secondary" id="ag-paste-go">Usar</button></details>
            <div id="ag-msg"></div><div id="ag-out"></div>
            <p class="ag-note">Dica de privacidade: transmita pelo Tor Browser ou com VPN ligada. A transação já está assinada: quem transmite não consegue mudar nada nela.</p>`);
        const m = $('#ag-msg', body), out = $('#ag-out', body);
        const handle = (text) => {
            msg(m, ''); out.innerHTML = '';
            let hex = String(text || '').trim(), d;
            try {
                if (hex.startsWith(TX)) hex = B().b64ToHex(hex.slice(TX.length));
                d = B().decodeTx(hex);
            } catch (e) { return msg(m, e.message); }
            out.innerHTML = `<div class="ag-sum">${d.outputs.map((o) => `<div><span>${o.type === 'op_return' ? 'Anotação' : 'Para'}</span><b class="ag-addr">${esc(o.address || o.memo || o.type)}</b><small>${o.type === 'op_return' ? '' : `${btc(o.value)} ${brlOf(o.value) ? '• ' + brlOf(o.value) : ''}`}</small></div>`).join('')}</div>
                <p class="ag-txid">Código: <code>${esc(d.txid)}</code></p>
                <button type="button" class="rmw-btn-primary" id="ag-send">📡 Transmitir para a rede Bitcoin</button>`;
            $('#ag-send', out).onclick = async () => {
                const btn = $('#ag-send', out); btn.disabled = true; btn.textContent = 'Transmitindo…';
                try {
                    const txid = await B().broadcast(hex);
                    out.innerHTML = `<div class="ag-ok">✅ Transmitida! Código: <code>${esc(txid)}</code></div><a class="rmw-btn-secondary" href="https://mempool.space/tx/${esc(txid)}" target="_blank" rel="noopener noreferrer">Acompanhar na mempool.space ↗</a>`;
                } catch (e) { btn.disabled = false; btn.textContent = '📡 Tentar de novo'; msg(m, e.message); }
            };
        };
        $('#ag-scan', body).onclick = async () => { const t = await scanText('Ler transação assinada'); if (t) handle(t); };
        $('#ag-paste-go', body).onclick = () => handle($('#ag-paste', body).value);
        if (prefill) handle(prefill);
    }

    global.RdeskAirgap = { open: hub, prepare, sign, broadcast, encodeRequest, decodeRequest, close };
})(window);
