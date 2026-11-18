/* =========================================================================
   ATUALIZAÇÃO FORÇADA
   O app confere (sem cache) se existe versão nova ao abrir, ao voltar para a
   tela e a cada 5 minutos. Se existe, atualiza sozinho — mas nunca no meio de
   uma transação: espera a pessoa terminar.
   ========================================================================= */
(function (global) {
    'use strict';
    const CURRENT = global.RDESK_VERSION || 'dev';
    const TRY_KEY = 'rdesk_update_try_v1';
    let pending = null;
    let applying = false;

    async function latestVersion() {
        const res = await fetch(`./version.js?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('sem versão');
        const m = (await res.text()).match(/RDESK_VERSION\s*=\s*['"]([^'"]+)['"]/);
        return m ? m[1] : null;
    }

    // Ocupado = transação em andamento, recibo aberto, ou uma tela da carteira aberta
    function busy() {
        if (global.RdeskDefi?.isBusy?.()) return true;
        const rcp = document.getElementById('modal-receipt');
        if (rcp && getComputedStyle(rcp).display !== 'none') return true;
        if (document.getElementById('rdesk-mw-overlay')?.classList.contains('open')) return true;
        if (document.querySelector('[aria-busy="true"]')) return true;
        return false;
    }

    function showCurtain() {
        if (document.getElementById('update-curtain')) return;
        const c = document.createElement('div');
        c.id = 'update-curtain';
        c.className = 'update-curtain';
        c.setAttribute('role', 'status');
        c.innerHTML = '<div class="uc-coin">₿</div><strong>Atualizando o app…</strong><span>Versão nova chegando</span>';
        document.body.appendChild(c);
    }

    async function apply(version) {
        if (applying) return;
        // Evita laço: no máximo uma tentativa por versão a cada minuto
        try {
            const last = JSON.parse(sessionStorage.getItem(TRY_KEY) || 'null');
            if (last && last.v === version && Date.now() - last.t < 60000) return;
            sessionStorage.setItem(TRY_KEY, JSON.stringify({ v: version, t: Date.now() }));
        } catch (e) { /* sem sessionStorage */ }
        applying = true;
        showCurtain();
        try {
            const reg = await navigator.serviceWorker?.getRegistration?.();
            if (reg) {
                await reg.update().catch(() => {});
                if (reg.waiting) reg.waiting.postMessage('skipWaiting');
            }
            if (global.caches) {
                const keys = await caches.keys();
                await Promise.all(keys.filter((k) => k.startsWith('rdesk-')).map((k) => caches.delete(k)));
            }
            // O GitHub Pages deixa o navegador guardar arquivos por 10 min: rebaixa todos agora
            // (cache: 'reload' substitui a cópia guardada), para a recarga já vir 100% nova
            const assets = new Set(['./', './index.html', './version.js', './manifest.json', './sw.js']);
            document.querySelectorAll('script[src], link[rel="stylesheet"][href], link[rel="manifest"][href]').forEach((el) => {
                const u = new URL(el.getAttribute('src') || el.getAttribute('href'), global.location.href);
                if (u.origin === global.location.origin) assets.add(u.pathname + u.search);
            });
            await Promise.all([...assets].map((a) => fetch(a, { cache: 'reload', credentials: 'same-origin' }).catch(() => null)));
        } catch (e) { /* segue para recarregar */ }
        const url = new URL(global.location.href);
        url.searchParams.set('v', version);
        global.location.replace(url.toString());
    }

    function tryApply() {
        if (!pending) return;
        if (busy()) { setTimeout(tryApply, 3000); return; }
        apply(pending);
    }

    async function check() {
        if (!global.location.protocol.startsWith('http')) return null; // versão portátil (arquivo): sem atualização automática
        try {
            const v = await latestVersion();
            if (v && v !== CURRENT) { pending = v; tryApply(); }
            return v;
        } catch (e) { return null; }
    }

    function init() {
        if ('serviceWorker' in navigator && global.location.protocol.startsWith('http')) {
            navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
                reg.update().catch(() => {});
            }).catch((err) => console.warn('Service Worker não registrado:', err.message));
            let reloaded = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (reloaded || !pending) return;
                reloaded = true;
                global.location.reload();
            });
        }
        // Tira o "?v=" da barra depois de atualizar
        try {
            const u = new URL(global.location.href);
            if (u.searchParams.has('v')) { u.searchParams.delete('v'); history.replaceState(history.state, '', u.toString()); }
        } catch (e) { /* ok */ }
        check();
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
        global.addEventListener('focus', check);
        global.addEventListener('online', check);
        setInterval(check, 5 * 60 * 1000);
    }

    global.RdeskUpdater = { check, current: CURRENT, isBusy: busy };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(window);
