/* =========================================================================
   RDESK SENTINEL — ORQUESTRADOR DE NAVEGAÇÃO, MICRO-MENTOR & PWA
   Arquivo 5 de 7: app.js
   ========================================================================= */

(function () {
    'use strict';

    let deferredInstallPrompt = null;
    let activeMentorTarget = null;

    // =========================================================================
    // 1. NAVEGAÇÃO ENTRE OS 4 PILARES (CARTEIRA, RENDER V3, PIX & LUCRO REAL)
    // =========================================================================
    function switchMainTab(tabName) {
        document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
            const isTarget = btn.getAttribute('data-tab') === tabName;
            btn.classList.toggle('active', isTarget);
            btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
        });

        document.querySelectorAll('.tab-panel').forEach((panel) => {
            const isTarget = panel.id === `tab-panel-${tabName}`;
            panel.classList.toggle('active', isTarget);
        });

        if (tabName === 'earn' && window.RdeskDefi) {
            window.RdeskDefi.resizeChart();
            window.RdeskDefi.refreshPoolAndPositions();
        } else if (tabName === 'pixswap' && window.RdeskDefi) {
            window.RdeskDefi.refreshPixAndSwap();
        } else if (tabName === 'audit' && window.RdeskDefi) {
            window.RdeskDefi.runAudit(false);
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // =========================================================================
    // 2. SUB-MODOS DA TELA 3 (COMPRAR PIX, SACAR PIX & TROCAR / PONTE)
    // =========================================================================
    function switchPixSwapSubmode(subName) { // mantida por compatibilidade: só existe a troca agora
        document.querySelectorAll('.submode-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-sub') === subName);
        });

        document.querySelectorAll('.subpanel').forEach((panel) => {
            const isTarget = panel.id === `subpanel-${subName}`;
            panel.classList.toggle('active', isTarget);
            panel.style.display = isTarget ? 'flex' : 'none';
        });

        if (window.RdeskDefi) {
            window.RdeskDefi.refreshPixAndSwap();
        }
    }

    // =========================================================================
    // 3. MICRO-MENTOR EDUCATIVO (BALÕES DE AJUDA EM PORTUGUÊS SIMPLES)
    // =========================================================================
    function showMentorPopover(targetEl) {
        const popover = document.getElementById('micro-mentor-popover');
        if (!popover || !targetEl) return;

        const title = targetEl.getAttribute('data-tip-title') || '';
        const body = targetEl.getAttribute('data-tip-body') || '';
        const tip = targetEl.getAttribute('data-tip-tip') || '';

        if (!title && !body) return;

        document.getElementById('mm-head').textContent = title;
        document.getElementById('mm-body').textContent = body;
        document.getElementById('mm-tip').textContent = tip ? `💡 ${tip}` : '';

        popover.classList.add('visible');
        activeMentorTarget = targetEl;

        const rect = targetEl.getBoundingClientRect();
        const popW = popover.offsetWidth || 270;
        const popH = popover.offsetHeight || 110;

        let left = rect.left + (rect.width / 2) - (popW / 2);
        left = Math.max(12, Math.min(window.innerWidth - popW - 12, left));

        let top = rect.bottom + 8;
        if (top + popH > window.innerHeight - 16) {
            top = Math.max(12, rect.top - popH - 8);
        }

        popover.style.left = `${Math.round(left)}px`;
        popover.style.top = `${Math.round(top)}px`;
    }

    function hideMentorPopover() {
        const popover = document.getElementById('micro-mentor-popover');
        if (popover) popover.classList.remove('visible');
        activeMentorTarget = null;
    }

    function bindMicroMentor() {
        document.querySelectorAll('[data-tip-title]').forEach((el) => {
            el.addEventListener('mouseenter', () => showMentorPopover(el));
            el.addEventListener('mouseleave', hideMentorPopover);
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                if (activeMentorTarget === el) {
                    hideMentorPopover();
                } else {
                    showMentorPopover(el);
                }
            });
        });

        document.addEventListener('click', () => {
            if (activeMentorTarget) hideMentorPopover();
        });
    }

    // =========================================================================
    // 4. INSTALAÇÃO PWA (ANDROID / WINDOWS) & SERVICE WORKER
    // =========================================================================
    function initPwaSupport() {
        const installBtn = document.getElementById('btn-install-pwa');

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredInstallPrompt = e;
            if (installBtn) installBtn.style.display = 'inline-block';
        });

        installBtn?.addEventListener('click', async () => {
            if (!deferredInstallPrompt) return;
            deferredInstallPrompt.prompt();
            await deferredInstallPrompt.userChoice.catch(() => {});
            deferredInstallPrompt = null;
            installBtn.style.display = 'none';
        });

        window.addEventListener('appinstalled', () => {
            deferredInstallPrompt = null;
            if (installBtn) installBtn.style.display = 'none';
        });

        // O service worker é registrado pelo updater.js (atualização forçada)
    }

    // Comprar com Pix: abre a tela (mostra "Em breve" enquanto o servidor não estiver ligado)
    document.addEventListener('DOMContentLoaded', () => {
        const on = Boolean(window.RdeskRegistry?.pixBuyEndpoint?.());
        const badge = document.getElementById('pixbuy-badge');
        const sub = document.getElementById('pixbuy-sub');
        if (on) { if (badge) badge.textContent = 'Novo'; if (sub) sub.textContent = 'Mande um Pix e receba cripto na carteira'; }
        document.getElementById('btn-buy-pix')?.addEventListener('click', () => window.RdeskWallet?.openView('buy-pix'));
    });

    // =========================================================================
    // 5. VINCULAÇÃO GERAL DA JORNADA DO USUÁRIO
    // =========================================================================
    // Olho: esconde/mostra todos os saldos e valores em R$ (lembra a escolha neste aparelho)
    const HIDE_KEY = 'rdesk_hide_balances_v1';
    function applyBalancePrivacy(hidden) {
        document.body.classList.toggle('privacy-on', hidden);
        const btn = document.getElementById('btn-toggle-balances');
        if (btn) {
            btn.setAttribute('aria-pressed', String(hidden));
            const label = hidden ? 'Mostrar saldos' : 'Esconder saldos';
            btn.setAttribute('aria-label', label);
            btn.title = label;
        }
    }
    function readBalancePrivacy() { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch (e) { return false; } }
    window.RdeskPrivacy = {
        isHidden: () => document.body.classList.contains('privacy-on'),
        set: (hidden) => { try { localStorage.setItem(HIDE_KEY, hidden ? '1' : '0'); } catch (e) {} applyBalancePrivacy(Boolean(hidden)); }
    };

    // Ninguém pode abrir o cofre dentro de uma moldura (iframe) e enganar o toque por cima dele.
    // (O GitHub Pages não deixa mandar o cabeçalho que bloqueia isso; então o próprio app se recusa.)
    let framed = false;
    try { framed = window.top !== window.self; } catch (e) { framed = true; }
    if (framed) {
        document.documentElement.style.display = 'none';
        try { window.top.location = window.location.href; } catch (e) { /* bloqueado: segue escondido */ }
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('btn-pools-new')?.addEventListener('click', () => window.RdeskPools?.openNew());
        applyBalancePrivacy(readBalancePrivacy());
        document.getElementById('btn-toggle-balances')?.addEventListener('click', () => window.RdeskPrivacy.set(!window.RdeskPrivacy.isHidden()));

        // Navegação principal das 4 abas
        document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                switchMainTab(btn.getAttribute('data-tab'));
            });
        });

        // Atalho "Trocar" da tela inicial
        document.getElementById('btn-action-swap')?.addEventListener('click', () => switchMainTab('pixswap'));

        bindMicroMentor();
        initPwaSupport();

        // Lista de moedas: adicionar moeda personalizada e mostrar as sem saldo
        document.getElementById('btn-add-token')?.addEventListener('click', () => {
            if (!window.RdeskWallet.isConnected()) { window.RdeskWallet.openModal('add'); return; }
            window.RdeskWallet.openView('addtoken');
        });
        document.getElementById('wallet-show-zero')?.addEventListener('change', () => window.RdeskWallet.renderHome());

        // Cotações: busca a cada 10 s enquanto a página está visível; o "há X s" anda a cada segundo.
        setInterval(async () => {
            if (document.hidden || !window.RdeskWallet) return;
            try {
                await window.RdeskWallet.refreshPrices();
                window.RdeskWallet.renderHome();
                window.RdeskDefi?.onPricesUpdated?.();
            } catch (e) {}
        }, 10000);
        setInterval(() => { if (!document.hidden) window.RdeskWallet?.renderQuoteStatus(); }, 1000);

        // Atualiza saldos, preço e posições a cada 30s enquanto a página está visível e sem operação em curso.
        setInterval(async () => {
            if (document.hidden || !window.RdeskWallet || !window.RdeskDefi) return;
            if (window.RdeskDefi.isBusy()) return;
            const receipt = document.getElementById('modal-receipt');
            if (receipt && getComputedStyle(receipt).display !== 'none') return;
            try {
                await window.RdeskWallet.refreshBalances();
                if (document.getElementById('tab-panel-earn')?.classList.contains('active')) {
                    await window.RdeskDefi.refreshPoolAndPositions();
                }
            } catch (e) {}
        }, 30000);

        // Atalhos do ícone instalado (segurar o ícone no Android): ?aba=learn, ?acao=receber.
        // Só valores conhecidos; depois limpa a URL para não repetir ao recarregar.
        try {
            const qs = new URLSearchParams(location.search);
            const aba = qs.get('aba'), acao = qs.get('acao');
            if (aba || acao) {
                history.replaceState(null, '', location.pathname);
                setTimeout(() => {
                    if (['wallet', 'learn', 'pixswap', 'earn', 'audit'].includes(aba)) document.querySelector(`.nav-tab-btn[data-tab="${aba}"]`)?.click();
                    if (acao === 'receber' && window.RdeskWallet) {
                        if (window.RdeskWallet.isConnected()) window.RdeskWallet.openView('receive', { chainId: 'btc' });
                        else window.RdeskWallet.openModal('add');
                    }
                }, 900);
            }
        } catch (e) {}
    });
})();
