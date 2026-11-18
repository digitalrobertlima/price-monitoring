/* =========================================================================
   COFRE — a tela trancada é literalmente a porta de um cofre.
   Trancado: nada do app aparece (nem saldo, nem botões). "Abrir o cofre" pede a
   digital (ou a senha); a roda gira, a maçaneta destrava e a porta abre em 3D.
   Ao trancar, a porta fecha na frente do app.
   ========================================================================= */
(function (global) {
    'use strict';

    const W = () => global.RdeskWallet;
    const reduceMotion = () => global.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const buzz = (p) => { try { navigator.vibrate?.(p); } catch (e) { /* sem vibração */ } };
    let screen = null;
    let shown = false;
    let busy = false;
    let timers = [];
    const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
    const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

    // Há cofre neste aparelho (carteira criada ou importada com as 12 palavras / chave)?
    const hasVault = () => (W()?.getAccounts?.() || []).some((a) => a.type === 'seed' || a.type === 'pk');
    const shouldLock = () => Boolean(W() && hasVault() && W().isLocked());

    const BOLTS = Array.from({ length: 8 }, (_, i) => `<span class="vd-bolt" style="--a:${i * 45}deg"></span>`).join('');
    const COINS = ['₿', '₿', 'Ξ', '₿', 'R$'].map((c, i) => `<span class="vd-coin c${i}">${c}</span>`).join('');

    function build() {
        screen = document.createElement('div');
        screen.id = 'vault-screen';
        screen.className = 'vault-screen';
        screen.setAttribute('role', 'dialog');
        screen.setAttribute('aria-modal', 'true');
        screen.setAttribute('aria-labelledby', 'vault-title');
        screen.innerHTML = `
            <div class="vd-stage" aria-hidden="true">
                <div class="vd-frame">
                    <span class="vd-hinge h1"></span><span class="vd-hinge h2"></span>
                    <div class="vd-inside"><div class="vd-glow"></div><div class="vd-coins">${COINS}</div></div>
                    <div class="vd-door">
                        <div class="vd-door-back"></div>
                        <div class="vd-door-face">
                            ${BOLTS}
                            <div class="vd-ring"></div>
                            <div class="vd-dial"></div>
                            <div class="vd-handle"><i></i><i></i><i></i><span class="vd-hub"><span class="vd-btc">₿</span></span></div>
                        </div>
                    </div>
                </div>
                <div class="vd-floor"></div>
            </div>
            <div class="vd-copy">
                <h1 id="vault-title" class="vd-title">Cofre trancado</h1>
                <p class="vd-sub" id="vault-sub">Só você abre.</p>
            </div>
            <div class="vd-actions">
                <button type="button" class="vd-open" id="vault-open-btn">
                    <svg class="ic-key" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 20 3"/><path d="m16 7 3 3"/><path d="m18.5 4.5 2 2"/></svg>
                    <svg class="ic-bio" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 11v4"/><path d="M8.5 8.5a5 5 0 0 1 8.4 3.6c0 2.6-.4 4.9-1.3 6.9"/><path d="M6.2 12.2c0-1 .2-1.9.6-2.8"/><path d="M9.3 19.6c.6-1.9.9-4 .9-6.4a1.8 1.8 0 0 1 3.6 0c0 .8 0 1.6-.1 2.4"/><path d="M5 5.6A9 9 0 0 1 21 12c0 1.4-.1 2.7-.4 4"/><path d="M3.4 9a9 9 0 0 0-.4 2.7c0 1.5-.3 2.9-.8 4.2"/></svg>
                    <span id="vault-open-label">Abrir o cofre</span>
                </button>
                <div class="vd-pin" id="vault-pinpad" hidden></div>
                <form class="vd-pass" id="vault-pass-form" hidden>
                    <input type="password" id="vault-pass-input" autocomplete="current-password" placeholder="Sua senha" aria-label="Senha do cofre">
                    <button type="submit" class="vd-pass-go" id="vault-pass-go" aria-label="Abrir com a senha">→</button>
                </form>
                <div class="vd-msg" id="vault-msg" role="alert"></div>
                <div class="vd-links">
                    <button type="button" class="vd-link" id="vault-pass-btn">Usar senha</button>
                    <button type="button" class="vd-link" id="vault-more-btn">Outras opções</button>
                </div>
            </div>`;
        document.body.appendChild(screen);

        const $ = (id) => screen.querySelector(id);
        $('#vault-open-btn').addEventListener('click', () => (W().isBiometryReady?.() ? openWithBiometry() : showPassword()));
        $('#vault-pass-btn').addEventListener('click', showPassword);
        $('#vault-more-btn').addEventListener('click', () => W().openView('unlock'));
        $('#vault-pass-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const pass = $('#vault-pass-input').value;
            if (!pass) return;
            await attempt(() => W().unlockWithPassword(pass));
        });
    }

    const isPin = () => W()?.getLockType?.() === 'pin';
    let pinPad = null;
    function showPassword() {
        if (isPin() && global.RdeskPinPad) {
            const host = screen.querySelector('#vault-pinpad');
            host.hidden = false;
            screen.querySelector('#vault-pass-btn').hidden = true;
            screen.querySelector('#vault-open-btn').hidden = true;
            screen.classList.add('pin-mode');
            pinPad = global.RdeskPinPad.mount(host, { length: 6, title: 'Digite seu PIN', onComplete: (pin) => attempt(() => W().unlockWithPassword(pin)) });
            return;
        }
        const form = screen.querySelector('#vault-pass-form');
        form.hidden = false;
        screen.querySelector('#vault-pass-btn').hidden = true;
        screen.querySelector('#vault-pass-input').focus();
    }

    function refreshLabels() {
        const bio = Boolean(W()?.isBiometryReady?.());
        screen.querySelector('#vault-open-label').textContent = bio ? 'Abrir com a digital' : isPin() ? 'Abrir com o PIN' : 'Abrir com a senha';
        screen.querySelector('#vault-pass-btn').textContent = isPin() ? 'Usar PIN' : 'Usar senha';
        screen.querySelector('.ic-bio').style.display = bio ? '' : 'none';
        screen.querySelector('.ic-key').style.display = bio ? 'none' : '';
        screen.querySelector('#vault-pass-btn').hidden = !bio || !screen.querySelector('#vault-pass-form').hidden;
        const acc = W()?.getActiveAccount?.();
        screen.querySelector('#vault-sub').textContent = acc?.name ? `${acc.name} • só você abre` : 'Só você abre.';
    }

    async function openWithBiometry() { await attempt(() => W().unlockWithBiometrics()); }

    async function attempt(fn) {
        if (busy) return;
        busy = true;
        const msg = screen.querySelector('#vault-msg');
        msg.textContent = '';
        screen.classList.add('trying');
        try {
            await fn(); // o desbloqueio dispara rdesk:walletChanged -> sync() abre a porta
        } catch (err) {
            screen.classList.remove('trying');
            screen.classList.remove('shake'); void screen.offsetWidth; screen.classList.add('shake');
            buzz([40, 60, 40]);
            const wrong = /incorret|senha/i.test(err?.message || '');
            if (isPin() && pinPad) { pinPad.error(wrong ? 'PIN errado. Tente de novo.' : ''); msg.textContent = wrong ? '' : (err?.message || ''); }
            else msg.textContent = wrong ? 'Senha errada. Tente de novo.' : (err?.message || 'Não deu para abrir. Tente de novo.');
            if (!wrong && !pinPad) showPassword();
        } finally {
            busy = false;
        }
    }

    function hideApp(hidden) {
        document.body.classList.toggle('vault-locked', hidden);
        ['app-main'].forEach((id) => { const el = document.getElementById(id); if (el) el.inert = hidden; });
        document.querySelectorAll('.app-header, .main-nav').forEach((el) => { el.inert = hidden; });
    }

    // Tranca: a porta aparece aberta e fecha na frente do app
    function close(animated) {
        if (!screen) build();
        clearTimers();
        shown = true;
        refreshLabels();
        screen.querySelector('#vault-msg').textContent = '';
        screen.querySelector('#vault-pass-input').value = '';
        screen.querySelector('#vault-pass-form').hidden = true;
        screen.querySelector('#vault-pinpad').hidden = true;
        screen.querySelector('#vault-pinpad').innerHTML = '';
        screen.querySelector('#vault-open-btn').hidden = false;
        pinPad = null;
        screen.classList.remove('opening', 'opened', 'trying', 'shake', 'closing', 'pin-mode');
        screen.hidden = false;
        hideApp(true);
        if (animated && !reduceMotion()) {
            screen.classList.add('closing'); // começa aberta
            void screen.offsetWidth;
            requestAnimationFrame(() => { screen.classList.remove('closing'); later(() => buzz(25), 650); });
        }
        refreshLabels();
    }

    // Abre: roda gira, maçaneta destrava, porta abre e a gente "entra" no app
    function open() {
        if (!screen || !shown) { hideApp(false); return; }
        clearTimers();
        shown = false;
        buzz([15, 40, 15]);
        try { global.RdeskWallet?.closeModal?.(); } catch (e) { /* nada aberto */ }
        const finish = () => { screen.hidden = true; screen.classList.remove('opening', 'opened', 'trying'); hideApp(false); };
        if (reduceMotion()) { finish(); return; }
        screen.classList.remove('trying');
        screen.classList.add('opening');
        later(() => { hideApp(false); screen.classList.add('opened'); }, 1750);
        later(finish, 2250);
    }

    function sync(animated) {
        if (screen?.classList.contains('celebrate') && !shouldLock()) return; // a comemoração abre sozinha
        if (shouldLock()) { if (!shown) close(animated); else refreshLabels(); }
        else if (shown) open();
        else hideApp(false);
    }

    function init() {
        if (!global.RdeskWallet) return void setTimeout(init, 60);
        // Na abertura do app o cofre já aparece trancado (sem animação)
        sync(false);
        ['rdesk:walletChanged', 'rdesk:wallet-updated'].forEach((ev) => global.addEventListener(ev, () => sync(true)));
        document.getElementById('btn-lock-vault')?.addEventListener('click', () => setTimeout(() => sync(true), 0));
    }

    // Cofre recém-criado: a porta aparece, mostra o nome e abre sozinha (comemoração)
    function celebrate(name) {
        if (!screen) build();
        clearTimers();
        shown = true;
        screen.classList.remove('opening', 'opened', 'trying', 'shake', 'closing');
        screen.classList.add('celebrate');
        screen.querySelector('#vault-title').textContent = 'Seu cofre está pronto!';
        screen.querySelector('#vault-sub').textContent = name ? `${name} • só você tem a chave` : 'Só você tem a chave';
        screen.hidden = false;
        hideApp(true);
        later(() => {
            open();
            later(() => { screen.classList.remove('celebrate'); screen.querySelector('#vault-title').textContent = 'Cofre trancado'; }, 2400);
        }, reduceMotion() ? 900 : 1300);
    }

    global.RdeskVaultDoor = { sync, celebrate, isShown: () => shown };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(window);
