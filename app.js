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
    function switchPixSwapSubmode(subName) {
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

        if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
            navigator.serviceWorker.register('./sw.js').catch((err) => {
                console.warn('Service Worker não registrado:', err.message);
            });
        }
    }

    // =========================================================================
    // 5. VINCULAÇÃO GERAL DA JORNADA DO USUÁRIO
    // =========================================================================
    document.addEventListener('DOMContentLoaded', () => {
        // Navegação principal das 4 abas
        document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                switchMainTab(btn.getAttribute('data-tab'));
            });
        });

        // Atalhos rápidos na Hero Card da Tela 1 (Carteira)
        document.getElementById('btn-action-pix')?.addEventListener('click', () => {
            switchMainTab('pixswap');
            switchPixSwapSubmode('pix-buy');
        });

        document.getElementById('btn-action-swap')?.addEventListener('click', () => {
            switchMainTab('pixswap');
            switchPixSwapSubmode('dex-swap');
        });

        // Sub-abas da Tela 3 (PIX & Trocas)
        document.querySelectorAll('.submode-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                switchPixSwapSubmode(btn.getAttribute('data-sub'));
            });
        });

        bindMicroMentor();
        initPwaSupport();
    });
})();
