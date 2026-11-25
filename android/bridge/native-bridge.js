// Ponte do app Android: roda ANTES de todo o resto do app, só dentro do APK.
// Toda conexão externa sai pelo Tor embutido (código nativo). O WebView em si não tem rede.
// Cada endereço da carteira ganha um caminho do Tor só dele; envio de transação usa outro caminho.
(function (global) {
    'use strict';

    // ------------------------------------------------------------------ isolamento (testável fora do app)
    const SLOT_PUBLIC = 0;
    const SLOT_SEND = 15;
    const ADDR_SLOTS = 14; // caminhos 1..14 para endereços
    const ADDR_RE = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;
    const BTC_RE = /(?:^|[^0-9A-Za-z])(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34}|X[1-9A-HJ-NP-Za-km-z]{33})(?![0-9A-Za-z])/;
    const OWNER_SELECTORS = ['70a08231', '2f745c59', 'dd62ed3e', '7ecebe00', '6352211e'];

    function paddedAddr(hex) {
        // procura um endereço "acolchoado" (24 zeros + 40 hex) que não pareça número pequeno
        const re = /0{24}([0-9a-fA-F]{40})/g;
        let m;
        while ((m = re.exec(hex))) {
            if (!/^0{8}/.test(m[1])) return '0x' + m[1];
            re.lastIndex = m.index + 2;
        }
        return null;
    }

    function rpcKey(msg) {
        if (Array.isArray(msg)) {
            for (const x of msg) { const k = rpcKey(x); if (k) return k; }
            return null;
        }
        if (!msg || typeof msg !== 'object') return null;
        const m = String(msg.method || '');
        const p = Array.isArray(msg.params) ? msg.params : [];
        if (m === 'eth_sendRawTransaction' || m === 'sendrawtransaction') return 'send';
        if (m === 'eth_getBalance' || m === 'eth_getTransactionCount' || m === 'eth_getCode' || m === 'eth_getProof') {
            return typeof p[0] === 'string' && ADDR_RE.test(p[0]) ? p[0] : null;
        }
        if (m === 'eth_call' || m === 'eth_estimateGas' || m === 'eth_createAccessList') {
            const t = p[0] || {};
            if (typeof t.from === 'string' && ADDR_RE.test(t.from)) return t.from;
            const d = String(t.data || t.input || '').replace(/^0x/, '');
            if (OWNER_SELECTORS.includes(d.slice(0, 8).toLowerCase()) && d.length >= 72) return '0x' + d.slice(32, 72);
            return paddedAddr(d.slice(8));
        }
        if (m === 'eth_getLogs') {
            const topics = (p[0] && p[0].topics) || [];
            for (const t of topics.flat()) { const a = typeof t === 'string' ? paddedAddr(t.replace(/^0x/, '')) : null; if (a) return a; }
            return null;
        }
        return null;
    }

    function keyFor(url, bodyText) {
        if (bodyText) {
            const s = bodyText.trim();
            if (s[0] === '{' || s[0] === '[') {
                try { const k = rpcKey(JSON.parse(s)); if (k) return k; } catch (e) { /* não é JSON */ }
            }
            if (/^(0x)?[0-9a-fA-F]{100,}$/.test(s)) return 'send'; // transação crua (Bitcoin/Dash)
        }
        let path = '';
        try { const u = new URL(url); path = decodeURIComponent(u.pathname + u.search); } catch (e) { path = String(url || ''); }
        if (/\/tx\/?$|\/tx\/send|broadcast|pushtx|sendrawtransaction/i.test(path)) return 'send';
        const a = path.match(ADDR_RE);
        if (a) return a[0];
        const b = path.match(BTC_RE);
        if (b) return b[1];
        return null;
    }

    const slots = new Map();
    function slotFor(key) {
        if (!key) return SLOT_PUBLIC;
        if (key === 'send') return SLOT_SEND;
        const k = /^0x/i.test(key) ? key.toLowerCase() : key;
        if (!slots.has(k)) slots.set(k, (slots.size % ADDR_SLOTS) + 1);
        return slots.get(k);
    }

    global.RdeskIsolation = { keyFor, slotFor, rpcKey, SLOT_PUBLIC, SLOT_SEND, _reset: () => slots.clear() };

    // ------------------------------------------------------------------ daqui para baixo, só no APK
    const N = global.RdeskNative;
    if (!N) return;
    global.RDESK_NATIVE = true;
    document.documentElement.dataset.native = 'android';

    const origFetch = global.fetch.bind(global);
    const pending = new Map();
    let seq = 0;
    global.__rdeskDone = function (id, res) {
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        if (res && res.error) p.reject(new TypeError(res.error));
        else p.resolve(res || {});
    };

    function b64(bytes) {
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(s);
    }
    function unb64(str) {
        const bin = atob(str || '');
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    async function toBytes(body) {
        if (body == null) return null;
        if (typeof body === 'string') return new TextEncoder().encode(body);
        if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString());
        if (body instanceof ArrayBuffer) return new Uint8Array(body);
        if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
        if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
        throw new TypeError('Tipo de corpo não suportado no app');
    }

    global.fetch = async function (input, init) {
        init = init || {};
        let url;
        let method = 'GET';
        const headers = {};
        let body = null;
        if (typeof Request !== 'undefined' && input instanceof Request) {
            url = input.url; method = input.method;
            input.headers.forEach((v, k) => { headers[k] = v; });
            if (init.body == null && method !== 'GET' && method !== 'HEAD') body = await input.clone().arrayBuffer();
        } else {
            url = String(input);
        }
        const u = new URL(url, global.location.href);
        if (u.origin === global.location.origin || u.protocol === 'blob:' || u.protocol === 'data:') return origFetch(input, init);
        if (u.protocol !== 'https:') throw new TypeError('O app só conversa por https, pelo Tor.');
        if (init.method) method = String(init.method);
        method = method.toUpperCase();
        if (init.headers) new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
        if (init.body != null) body = init.body;
        const bytes = await toBytes(body);
        let text = '';
        if (bytes && bytes.length < 200000) { try { text = new TextDecoder().decode(bytes); } catch (e) { text = ''; } }
        const slot = slotFor(keyFor(u.href, text));
        const id = ++seq;
        return new Promise((resolve, reject) => {
            const signal = init.signal;
            if (signal) {
                if (signal.aborted) { reject(new DOMException('Cancelado', 'AbortError')); return; }
                signal.addEventListener('abort', () => { if (pending.delete(id)) reject(new DOMException('Cancelado', 'AbortError')); });
            }
            pending.set(id, {
                resolve: (r) => {
                    const st = Number(r.status) || 0;
                    const noBody = st === 204 || st === 205 || st === 304 || method === 'HEAD';
                    try {
                        const resp = new Response(noBody ? null : unb64(r.body), { status: st >= 200 && st <= 599 ? st : 502, statusText: r.statusText || '', headers: r.headers || {} });
                        try { Object.defineProperty(resp, 'url', { value: u.href }); } catch (e) { /* ok */ }
                        resolve(resp);
                    } catch (e) { reject(new TypeError('Resposta inválida')); }
                },
                reject
            });
            N.request(id, JSON.stringify({ url: u.href, method, headers, body: bytes ? b64(bytes) : null, slot }));
        });
    };

    // Conexões que não passam pelo Tor simplesmente não existem aqui dentro
    try { global.WebSocket = undefined; } catch (e) { /* ok */ }
    try { global.EventSource = undefined; } catch (e) { /* ok */ }
    // Passkeys do navegador não funcionam no app: o app usa só senha/PIN
    try { global.PublicKeyCredential = undefined; } catch (e) { /* ok */ }

    // Biometria do Android (chave no chip seguro do celular): usada pelo cofre no lugar das passkeys
    function call(fn) {
        return new Promise((resolve, reject) => {
            const id = ++seq;
            pending.set(id, { resolve, reject });
            fn(id);
        });
    }
    global.RdeskNativeBio = {
        available: () => { try { return Boolean(N.bioAvailable()); } catch (e) { return false; } },
        status: () => { try { return JSON.parse(N.bioStatus()); } catch (e) { return null; } },
        encrypt: (text) => call((id) => N.bioEncrypt(id, String(text))),
        decrypt: (ct, iv) => call((id) => N.bioDecrypt(id, String(ct), String(iv))).then((r) => r.text),
        forget: () => { try { N.bioForget(); } catch (e) { /* ok */ } }
    };

    // Ponte do Tor (Snowflake, obfs4 ou as suas): trocar religa o Tor
    global.RdeskNativeTor = {
        get: () => JSON.parse(N.getBridge()),
        set: (modo, proprias) => N.setBridge(String(modo), String(proprias || ''))
    };

    // ------------------------------------------------------------------ Bitcoin sem servidor (Kyoto)
    // Os filtros dos blocos vêm direto da rede Bitcoin, pelo Tor. Nenhum servidor recebe seus endereços.
    const BTC_KEY = 'rdesk_btc_luz_v1';
    let btcSt = { estado: 'desligado' };
    let btcWatch = new Set();
    let btcStartedFor = '';
    const btcCfg = () => { try { return JSON.parse(localStorage.getItem(BTC_KEY) || '{}'); } catch (e) { return {}; } };
    global.__rdeskBtc = function (st) {
        if (!st) return;
        const dados = st.dados || btcSt.dados;
        btcSt = { ...st, dados };
        if (st.dados) btcWatch = new Set(st.dados.vigiados || []);
        global.dispatchEvent(new CustomEvent('rdesk:btcluz', { detail: btcSt }));
    };
    const btcReady = () => btcSt.estado === 'pronto' && Boolean(btcSt.dados);
    function btcTxsOf(a) {
        return (btcSt.dados.txs || []).filter((t) => (t.vout || []).some((o) => o.scriptpubkey_address === a) || (t.vin || []).some((i) => i.prevout && i.prevout.scriptpubkey_address === a))
            .sort((x, y) => (y.status.block_time || 9e12) - (x.status.block_time || 9e12));
    }
    // Altura e hash do bloco de partida: tenta vários servidores (pelo Tor, um deles pode limitar)
    const BTC_INFO = ['https://mempool.emzy.de/api', 'https://mempool.bitcoin-austria.at/api', 'https://blockstream.info/api'];
    async function btcInfo(path, ok) {
        let last;
        for (const h of BTC_INFO) {
            try { const t = (await (await fetch(h + path)).text()).trim(); if (ok(t)) return t; last = new Error(t.slice(0, 60)); } catch (e) { last = e; }
        }
        throw last || new Error('sem resposta');
    }
    async function birthday(year) {
        const tip = Number(await btcInfo('/blocks/tip/height', (t) => /^\d+$/.test(t)));
        let h;
        if (year === 'novo') h = tip - 6;
        else {
            const ts = Date.UTC(Number(year) || 2015, 0, 1) / 1000;
            h = Math.floor(840000 + (ts - 1713571200) / 600) - 2016; // ~1 bloco a cada 10 min, com folga de 2 semanas
        }
        h = Math.max(481824, Math.min(h, tip - 6)); // no mínimo a ativação do SegWit (endereços bc1)
        const hash = await btcInfo(`/block-height/${h}`, (t) => /^[0-9a-f]{64}$/.test(t));
        if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('sem hash do bloco');
        return { height: h, hash };
    }
    async function btcTick() {
        if (global.RDESK_TESTE) return; // modo teste: Bitcoin testnet4 pelos servidores (o Kyoto do app é só da rede real)
        const c = btcCfg();
        if (!c.on) return;
        const d = global.RdeskWallet && global.RdeskWallet.getBtcDescriptors && global.RdeskWallet.getBtcDescriptors();
        if (!d || btcStartedFor === d.id) return;
        let t = {};
        try { t = JSON.parse(N.torState()); } catch (e) { /* ok */ }
        if (t.state !== 'on') return;
        btcStartedFor = d.id;
        try {
            const b = await birthday(c.ano || '2020');
            N.btcStart(JSON.stringify({ id: d.id, ext: d.ext, int: d.int, height: b.height, hash: b.hash }));
        } catch (e) { btcStartedFor = ''; }
    }
    setInterval(btcTick, 15000);
    global.addEventListener('rdesk:tor', () => setTimeout(btcTick, 2000));
    try { btcSt = JSON.parse(N.btcState()); if (btcSt.dados) btcWatch = new Set(btcSt.dados.vigiados || []); } catch (e) { /* ok */ }
    global.RdeskNativeBtc = {
        config: btcCfg,
        setConfig(c) {
            localStorage.setItem(BTC_KEY, JSON.stringify(c || {}));
            btcStartedFor = '';
            if (!c || !c.on) { N.btcStop(); btcSt = { estado: 'desligado' }; btcWatch = new Set(); }
            else setTimeout(btcTick, 500);
        },
        state: () => btcSt,
        ready: btcReady,
        covers: (a) => btcReady() && btcWatch.has(a),
        balance(a) {
            const us = (btcSt.dados.utxos || []).filter((u) => u.address === a);
            const confirmed = us.filter((u) => u.confirmed).reduce((x, u) => x + u.value, 0);
            const pending = us.filter((u) => !u.confirmed).reduce((x, u) => x + u.value, 0);
            return { confirmedSats: confirmed, pendingSats: pending, totalSats: confirmed + pending, btc: (confirmed + pending) / 1e8, txCount: btcTxsOf(a).length };
        },
        utxos: (a) => (btcSt.dados.utxos || []).filter((u) => u.address === a).map((u) => ({ txid: u.txid, vout: u.vout, value: u.value, confirmed: u.confirmed })),
        txs: btcTxsOf,
        broadcast: (hex) => call((id) => N.btcBroadcast(id, String(hex))).then((r) => r.txid),
        wipe: () => { try { N.btcWipe(); } catch (e) { /* ok */ } },
        _start: (cfg) => N.btcStart(JSON.stringify(cfg)),
        _birthday: birthday
    };

    // Sem service worker: os arquivos já vêm dentro do APK
    const swStub = {
        register: () => Promise.reject(new Error('O app Android não usa service worker')),
        getRegistration: () => Promise.resolve(undefined),
        getRegistrations: () => Promise.resolve([]),
        addEventListener() {}, removeEventListener() {},
        controller: null,
        ready: new Promise(() => {})
    };
    try { Object.defineProperty(Navigator.prototype, 'serviceWorker', { get: () => swStub, configurable: true }); } catch (e) { /* ok */ }

    // Área de transferência nativa: marcada como sensível e apagada sozinha em 60 s
    const clip = {
        writeText: (t) => { N.copy(String(t)); return Promise.resolve(); },
        readText: () => Promise.resolve(String(N.paste() || ''))
    };
    try { Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => clip, configurable: true }); } catch (e) { /* ok */ }

    // Avisos locais (nunca por servidor)
    function NativeNotification(title, opts) { N.notify(String(title || ''), String((opts && opts.body) || '')); }
    Object.defineProperty(NativeNotification, 'permission', { get: () => String(N.notifPermission()) });
    NativeNotification.requestPermission = () => new Promise((res) => {
        const id = ++seq;
        pending.set(id, { resolve: (r) => res(r.perm || 'denied'), reject: () => res('denied') });
        N.requestNotif(id);
    });
    global.Notification = NativeNotification;

    // Exportar arquivo (CSV do extrato): abre o "compartilhar" do Android
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
        if (this.download && /^blob:/.test(this.href)) {
            const name = this.download;
            origFetch(this.href).then((r) => r.blob()).then((b) => b.text().then((t) => N.share(name, t, b.type || 'text/plain'))).catch(() => {});
            return;
        }
        return origClick.call(this);
    };

    // Botão voltar do Android: fecha a janela de cima; se não houver, o app vai para o fundo
    global.__rdeskBack = function () {
        const ob = document.getElementById('ob-root');
        if (ob && ob.children.length) { ob.replaceChildren(); return true; }
        const modals = [...document.querySelectorAll('.st-modal, .open[role="dialog"], #rdesk-mw-overlay.open')];
        const top = modals[modals.length - 1];
        if (top) {
            const x = top.querySelector('.st-x, [data-close], .rmw-close, [aria-label="Fechar"]');
            if (x) { x.click(); return true; }
            if (top.classList.contains('st-modal')) { top.remove(); return true; }
        }
        return false;
    };

    // ------------------------------------------------------------------ selo do Tor
    let torState = { state: 'starting', progress: 0 };
    function paintTor() {
        let el = document.getElementById('rdesk-tor');
        if (!el) {
            if (!document.body) return;
            el = document.createElement('div');
            el.id = 'rdesk-tor';
            el.setAttribute('role', 'status');
            el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom));z-index:2147483000;' +
                'background:#1b1430;color:#e9dcff;border:1px solid #7d4cdb;border-radius:999px;padding:7px 14px;font:600 13px system-ui,sans-serif;' +
                'box-shadow:0 6px 24px rgba(0,0,0,.45);pointer-events:none;transition:opacity .5s';
            document.body.appendChild(el);
        }
        const s = torState;
        if (s.state === 'on') {
            el.textContent = '🧅 Conectado pelo Tor';
            el.style.opacity = '1';
            clearTimeout(paintTor._t);
            paintTor._t = setTimeout(() => { el.style.opacity = '0'; }, 2200);
        } else if (s.state === 'error') {
            el.textContent = '⚠️ Tor sem conexão. Nada sai do app até voltar.';
            el.style.opacity = '1';
        } else {
            el.textContent = `🧅 Conectando com privacidade… ${Math.max(0, Math.min(100, s.progress | 0))}%`;
            el.style.opacity = '1';
        }
    }
    global.__rdeskTor = function (s) {
        const was = torState.state;
        torState = s || torState;
        if (was !== torState.state || torState.state !== 'on') paintTor();
        global.dispatchEvent(new CustomEvent('rdesk:tor', { detail: torState }));
    };
    global.RdeskTor = { state: () => torState };
    document.addEventListener('DOMContentLoaded', () => {
        try { torState = JSON.parse(N.torState()); } catch (e) { /* ok */ }
        paintTor();
    });

    // ------------------------------------------------------------------ versão nova do app (consulta pelo Tor)
    async function checkUpdate() {
        try {
            const cur = Number(N.versionCode());
            const r = await fetch('https://api.github.com/repos/digitalrobertlima/price-monitoring/releases?per_page=15', { headers: { Accept: 'application/vnd.github+json' } });
            if (!r.ok) return;
            const list = await r.json();
            let best = null;
            for (const rel of list) {
                const m = /^android-v(\d+)(?:\.(\d+))?$/.exec(rel.tag_name || '');
                if (!m || rel.draft) continue;
                const code = Number(m[1]) * 100 + Number(m[2] || 0) * 10;
                if (code > cur && (!best || code > best.code)) best = { code, tag: rel.tag_name, url: rel.html_url };
            }
            if (!best) return;
            const bar = document.createElement('button');
            bar.type = 'button';
            bar.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(10px + env(safe-area-inset-top));z-index:2147483001;background:#14351f;color:#d7ffe2;' +
                'border:1px solid #2fbf6a;border-radius:14px;padding:12px;font:600 14px system-ui,sans-serif;text-align:left';
            bar.textContent = `⬆️ Nova versão do app (${best.tag.replace('android-', '')}). Toque para copiar o link de download.`;
            bar.onclick = () => { N.copy(best.url); bar.textContent = '✅ Link copiado. Abra no navegador (de preferência o Tor Browser).'; setTimeout(() => bar.remove(), 6000); };
            document.body.appendChild(bar);
        } catch (e) { /* sem novidade */ }
    }
    global.addEventListener('rdesk:tor', (ev) => {
        if (ev.detail && ev.detail.state === 'on' && !checkUpdate.done) { checkUpdate.done = true; setTimeout(checkUpdate, 8000); }
    });
})(window);
