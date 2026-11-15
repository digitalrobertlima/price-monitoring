/**
 * RDESK SENTINEL V22 — MOTOR TÁTICO, PILOTO V3, REBALANCEAMENTO & MICRO-MENTOR (7º de 9 arquivos)
 * Integra:
 *  - RdeskVault (vault-core.js): Carteira BIP-39 12/24 palavras + 8 moedas + 5 redes + EIP-6963
 *  - RdeskLedger (ledger-advisor.js): Auditoria desde a 1ª TX + Curva de Patrimônio + Break-Even
 *  - RdeskGateway (gateway-pix.js): Swap Intra/Cross-Chain + Comprar/Sacar PIX Líquido
 *  - Piloto Automático Uniswap V3 (Polygon WPOL/USDT0 0.05%) com Escudo 3.0 POL
 *  - Rebalanceamento Autônomo (multicall decrease+collect -> balanceamento exato -> mint)
 *  - Recibo Humano Pré-Assinatura em Reais (R$) + MicroMentor Educativo Universal
 *  - Modo Sereno (One Screen, One Action) <-> Terminal Pro + PWA Android + Wake Lock
 */
(function (global) {
    'use strict';

    // =========================================================================
    // 1. CONSTANTES OFICIAIS UNISWAP V3 (POLYGON MAINNET - CHAIN ID 137)
    // =========================================================================
    const SYMBOL = 'POLUSDT';
    const POOL_ADDRESS = '0x9b08288c3be4f62bbf8d1c20ac9c5e6f9467d8b7';
    const NFPM_ADDRESS = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
    const POOL_FEE_TIER = 500;     // 0.05%
    const POOL_TICK_SPACING = 10;
    const GAS_RESERVE_POL = 3.0;   // Escudo obrigatório de 3.0 POL contra falta de gás

    const WPOL_ADDR = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';
    const USDT0_ADDR = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
    const BRZ_ADDR = '0x4eD141110F6EeeAbA9A1df36d8c26f684d2475Dc';
    const BRLA_ADDR = '0xE6A537a407488807F0bbeb0038B79004f19DDDFb';

    const SWAP_TOPIC = ethers.utils.id('Swap(address,address,int256,int256,uint160,uint128,int24)');
    const Q128 = ethers.BigNumber.from(2).pow(128);
    const Q256 = ethers.BigNumber.from(2).pow(256);
    const MAX_UINT128 = ethers.BigNumber.from(2).pow(128).sub(1);
    const MAX_UINT256 = ethers.constants.MaxUint256;

    const STATE_BACKUP_KEY = 'rdesk_v22_app_state';

    // =========================================================================
    // 2. ESTADO OPERACIONAL DO SUPER APP
    // =========================================================================
    let appState = {
        uiProfile: 'SERENO', // 'SERENO' | 'PRO'
        audioEnabled: false,
        activeTimeframe: '15m',
        activeSeconds: 900,
        focusedId: null,
        web3Positions: [],
        manualPositions: [],
        pnlOverrides: {}, // { [posId]: { initBrz, openGasPol, autoChecked } }
        onlyNoKycPix: false
    };

    let currentPriceGlobal = 0;
    let lastPriceGlobal = 0;
    let usdBrlCommercial = 5.65;
    let usdtToBrzRate = 5.65;
    let usdtToBrlaRate = 5.65;
    let totalUnclaimedFeesUsd = 0;
    let isAutoPilotRunning = false;
    let lastAlertBeepMs = 0;

    let walletBalances = {
        pol: 0,
        wpol: 0,
        usdt0: 0,
        brz: 0,
        brla: 0
    };

    let sniperTelemetry = {
        atr14: 0,
        downWeight: 0.5,
        upWeight: 0.5,
        regimeText: 'LATERAL 50/50',
        min: 0,
        max: 0
    };

    let poolTelemetry = {
        activeLiquidityRaw: 0,
        volumeUsdPerMin: 2800,
        feesUsdPerMin: 1.40,
        source: 'inicial'
    };

    let yieldTargetState = {
        customTargetBrlPerMin: null,
        baselineBrlPerMin: 0,
        projectedBrlPerMin: 0,
        sculptedTickLower: null,
        sculptedTickUpper: null,
        sculptedMin: 0,
        sculptedMax: 0,
        riskLabel: 'SNIPER BASE',
        riskColor: 'var(--success-green)',
        cappedByPool: false
    };

    let autoPilotPlan = null;
    let activeSwapQuote = null;
    let swapQuoteTimer = null;

    let tvChart = null;
    let candleSeries = null;
    let currentCandle = null;
    let priceLinesMap = [];
    let previewLinesMap = [];

    // =========================================================================
    // 3. UTILITÁRIOS GERAIS, ÁUDIO E PERSISTÊNCIA LOCAL
    // =========================================================================
    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Tempo limite excedido')), ms))
        ]);
    }

    function formatBrl(val) {
        const num = Number(val) || 0;
        return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function formatUsd(val) {
        const num = Number(val) || 0;
        return '$ ' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function sanitizeLabel(raw) {
        return String(raw || '').replace(/[<>"'`]/g, '').trim().slice(0, 32);
    }

    function getMotherRate() {
        return usdtToBrzRate > 0 ? usdtToBrzRate : usdBrlCommercial;
    }

    function playBeep(freq = 880, durationSec = 0.18, type = 'sine') {
        if (!appState.audioEnabled) return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            gain.gain.setValueAtTime(0.06, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationSec);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + durationSec);
        } catch (e) {}
    }

    function saveAppState() {
        try {
            localStorage.setItem(STATE_BACKUP_KEY, JSON.stringify(appState));
        } catch (e) {}
    }

    function loadAppState() {
        try {
            const raw = localStorage.getItem(STATE_BACKUP_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                appState.uiProfile = parsed.uiProfile === 'PRO' ? 'PRO' : 'SERENO';
                appState.audioEnabled = Boolean(parsed.audioEnabled);
                appState.activeTimeframe = parsed.activeTimeframe || '15m';
                appState.activeSeconds = Number(parsed.activeSeconds) || 900;
                appState.focusedId = parsed.focusedId || null;
                appState.manualPositions = Array.isArray(parsed.manualPositions) ? parsed.manualPositions : [];
                appState.pnlOverrides = parsed.pnlOverrides && typeof parsed.pnlOverrides === 'object' ? parsed.pnlOverrides : {};
                appState.onlyNoKycPix = Boolean(parsed.onlyNoKycPix);
            }
        } catch (e) {}
    }

    // =========================================================================
    // 4. RECIBO HUMANO PRÉ-ASSINATURA EM REAIS (R$) — CALM FINANCE GUARDRAIL
    // =========================================================================
    function showHumanReceiptModal(receipt) {
        return new Promise((resolve) => {
            const modal = document.getElementById('receipt-modal');
            if (!modal) {
                resolve(confirm(`${receipt.actionTitle}\nSai: ${receipt.outSummary} (${formatBrl(receipt.outBrl)})\nEntra: ${receipt.inSummary} (${formatBrl(receipt.inBrl)})`));
                return;
            }

            document.getElementById('receipt-title').textContent = receipt.actionTitle || 'Revisar Operação';
            document.getElementById('receipt-out-val').textContent = receipt.outSummary || '--';
            document.getElementById('receipt-out-brl').textContent = formatBrl(receipt.outBrl);
            document.getElementById('receipt-in-val').textContent = receipt.inSummary || '--';
            document.getElementById('receipt-in-brl').textContent = formatBrl(receipt.inBrl);
            document.getElementById('receipt-route').textContent = receipt.routeLabel || 'Contrato Direto On-Chain';
            document.getElementById('receipt-app-fee').textContent = receipt.appFeeText || 'R$ 0,00 (Taxa Zero)';
            document.getElementById('receipt-gas').textContent = `${receipt.estimatedGasText || '~0.02 POL'} (${formatBrl(receipt.estimatedGasBrl)})`;
            document.getElementById('receipt-shield').textContent = receipt.gasReserveText || '3.0 POL protegidos';

            const btnConfirm = document.getElementById('btn-receipt-confirm');
            const btnCancel = document.getElementById('btn-receipt-cancel');

            const cleanup = (answer) => {
                modal.classList.remove('open');
                btnConfirm.removeEventListener('click', onConfirm);
                btnCancel.removeEventListener('click', onCancel);
                resolve(answer);
            };

            const onConfirm = () => cleanup(true);
            const onCancel = () => cleanup(false);

            btnConfirm.addEventListener('click', onConfirm);
            btnCancel.addEventListener('click', onCancel);
            modal.classList.add('open');
        });
    }

    // =========================================================================
    // 5. SISTEMA UNIVERSAL DE BALÕES EXPLICATIVOS (MICRO-MENTOR EDUCATIVO)
    // =========================================================================
    function initMicroMentor() {
        const balloon = document.getElementById('micro-mentor-balloon');
        if (!balloon) return;

        const titleEl = document.getElementById('mm-title');
        const whatEl = document.getElementById('mm-what');
        const impactEl = document.getElementById('mm-impact');
        let hideTimer = null;

        function positionBalloon(targetEl) {
            const rect = targetEl.getBoundingClientRect();
            const bRect = balloon.getBoundingClientRect();
            const margin = 10;

            let top = rect.bottom + 8;
            if (top + bRect.height > window.innerHeight - margin) {
                top = Math.max(margin, rect.top - bRect.height - 8);
            }

            let left = rect.left + (rect.width / 2) - (bRect.width / 2);
            left = Math.max(margin, Math.min(window.innerWidth - bRect.width - margin, left));

            balloon.style.top = `${Math.round(top)}px`;
            balloon.style.left = `${Math.round(left)}px`;
        }

        function showForElement(el) {
            if (!el) return;
            const title = el.getAttribute('data-tip-title');
            const what = el.getAttribute('data-tip-what');
            const impact = el.getAttribute('data-tip-impact');
            if (!title && !what) return;

            if (hideTimer) clearTimeout(hideTimer);
            titleEl.textContent = title || 'Informação';
            whatEl.textContent = what || '';
            impactEl.textContent = impact ? `Na prática: ${impact}` : '';
            impactEl.style.display = impact ? 'block' : 'none';

            balloon.classList.add('visible');
            positionBalloon(el);
        }

        function scheduleHide() {
            hideTimer = setTimeout(() => {
                balloon.classList.remove('visible');
            }, 140);
        }

        document.addEventListener('mouseover', (e) => {
            const target = e.target.closest('[data-tip-title]');
            if (target) showForElement(target);
        });

        document.addEventListener('mouseout', (e) => {
            const target = e.target.closest('[data-tip-title]');
            if (target) scheduleHide();
        });

        // Suporte no Android / toque em ícones de ajuda (?)
        document.addEventListener('click', (e) => {
            const helpBtn = e.target.closest('.tip-help-badge');
            if (helpBtn) {
                e.stopPropagation();
                const owner = helpBtn.closest('[data-tip-title]') || helpBtn;
                showForElement(owner);
                return;
            }
            if (!e.target.closest('#micro-mentor-balloon')) {
                balloon.classList.remove('visible');
            }
        });
    }

    // =========================================================================
    // 6. DIVULGAÇÃO PROGRESSIVA (MODO SERENO <-> TERMINAL PRO) & NAVEGAÇÃO
    // =========================================================================
    function applyUiProfile(profile) {
        appState.uiProfile = profile === 'PRO' ? 'PRO' : 'SERENO';
        const isPro = appState.uiProfile === 'PRO';
        document.body.classList.toggle('mode-pro', isPro);
        document.body.classList.toggle('mode-sereno', !isPro);

        const toggleBtn = document.getElementById('btn-toggle-pro');
        if (toggleBtn) {
            toggleBtn.textContent = isPro ? 'MODO SERENO' : 'TERMINAL PRO';
            toggleBtn.classList.toggle('pro-active', isPro);
        }

        saveAppState();

        if (isPro && tvChart) {
            const wrapper = document.getElementById('tv-chart');
            if (wrapper) {
                setTimeout(() => {
                    tvChart.applyOptions({ width: wrapper.clientWidth, height: wrapper.clientHeight });
                }, 60);
            }
        }
        if (global.RdeskLedger) {
            setTimeout(() => global.RdeskLedger.renderEquityChart('equity-curve-chart'), 80);
        }
    }

    function switchMainSection(targetKey) {
        // Atualiza botões da barra mobile e abas principais
        document.querySelectorAll('.mb-nav-btn, .sereno-nav-btn').forEach((b) => {
            b.classList.toggle('active', b.getAttribute('data-target') === targetKey);
        });

        document.querySelectorAll('.sereno-view').forEach((pane) => {
            pane.classList.toggle('active', pane.id === `sview-${targetKey}`);
        });

        if (targetKey === 'earn' || targetKey === 'radar') {
            switchRightTab('radar');
        } else if (targetKey === 'swap') {
            switchRightTab('swap');
        } else if (targetKey === 'pix') {
            switchRightTab('pix');
        } else if (targetKey === 'audit') {
            if (global.RdeskLedger) {
                global.RdeskLedger.renderEquityChart('equity-curve-chart');
            }
        }
    }

    function switchRightTab(tabName) {
        ['radar', 'swap', 'pix'].forEach((name) => {
            document.getElementById(`tab-${name}`)?.classList.toggle('active', name === tabName);
            document.getElementById(`view-${name}`)?.classList.toggle('active', name === tabName);
        });
        if (tabName === 'swap') {
            updateSwapBalanceLabels();
            scheduleSwapQuote(50);
        } else if (tabName === 'pix') {
            renderPixModule();
        }
    }

    // =========================================================================
    // 7. CONTROLADOR DO WALLET VAULT (12/24 PALAVRAS, 3 PALAVRAS, EIP-6963 & ENVIO)
    // =========================================================================
    let _currentDraftMnemonic = '';
    let _currentChallengeList = [];

    function openWalletModal(initialSubTab = 'connect') {
        const modal = document.getElementById('wallet-modal');
        if (!modal) return;
        modal.classList.add('open');
        switchWalletModalTab(initialSubTab);
    }

    function closeWalletModal() {
        document.getElementById('wallet-modal')?.classList.remove('open');
    }

    function switchWalletModalTab(tabKey) {
        document.querySelectorAll('.wm-tab-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-wmtab') === tabKey);
        });
        document.querySelectorAll('.wm-pane').forEach((pane) => {
            pane.classList.toggle('active', pane.id === `wmpane-${tabKey}`);
        });

        if (tabKey === 'create' && !_currentDraftMnemonic) {
            regenerateDraftSeedUI();
        }
    }

    function regenerateDraftSeedUI() {
        const countEl = document.getElementById('create-word-count');
        const wordCount = Number(countEl?.value || 12);
        _currentDraftMnemonic = global.RdeskVault.generateDraftMnemonic(wordCount);
        _currentChallengeList = global.RdeskVault.createBackupChallenge(_currentDraftMnemonic);

        const words = _currentDraftMnemonic.split(' ');
        const grid = document.getElementById('draft-words-grid');
        if (grid) {
            grid.replaceChildren();
            words.forEach((w, idx) => {
                const chip = document.createElement('div');
                chip.className = 'seed-word-chip';
                const num = document.createElement('span');
                num.className = 'seed-idx';
                num.textContent = `${idx + 1}.`;
                const txt = document.createElement('strong');
                txt.textContent = w;
                chip.append(num, txt);
                grid.appendChild(chip);
            });
        }

        // Passo 1 visível, Passo 2 (Desafio das 3 palavras) aguardando clique em "Já anotei"
        document.getElementById('create-step-1')?.classList.add('active');
        document.getElementById('create-step-2')?.classList.remove('active');
    }

    function showThreeWordVerificationStep() {
        const container = document.getElementById('challenge-inputs-box');
        if (!container) return;
        container.replaceChildren();

        _currentChallengeList.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'challenge-row';

            const lbl = document.createElement('label');
            lbl.textContent = `Palavra #${item.position}:`;

            const inp = document.createElement('input');
            inp.type = 'text';
            inp.autocomplete = 'off';
            inp.autocapitalize = 'none';
            inp.spellcheck = false;
            inp.placeholder = `Digite a ${item.position}ª palavra`;
            inp.setAttribute('data-challenge-pos', String(item.position));

            row.append(lbl, inp);
            container.appendChild(row);
        });

        document.getElementById('create-step-1')?.classList.remove('active');
        document.getElementById('create-step-2')?.classList.add('active');
    }

    function renderMultiAssetPortfolio(vaultSnap) {
        const grid = document.getElementById('multi-asset-grid');
        if (!grid) return;
        grid.replaceChildren();

        const order = ['POL', 'USDT', 'USDC', 'BRZ', 'BRLA', 'ETH', 'WBTC', 'WETH'];
        const totals = vaultSnap.totalByAsset || {};
        const byChain = vaultSnap.balancesByChain || {};
        const nets = global.RdeskVault.NETWORKS;

        order.forEach((sym) => {
            const info = totals[sym] || { amount: 0, usd: 0, brl: 0 };
            const assetMeta = global.RdeskVault.ASSET_REGISTRY[sym];

            // Lista redes onde há saldo > 0
            const activeNets = [];
            Object.keys(nets).forEach((cid) => {
                const amt = byChain[cid]?.[sym] || 0;
                if (amt > 0.000001) {
                    activeNets.push(`${nets[cid].shortName}: ${amt.toFixed(sym === 'WBTC' ? 5 : 2)}`);
                }
            });

            const card = document.createElement('div');
            card.className = 'asset-tile';
            card.setAttribute('data-tip-title', `${sym} — ${assetMeta?.name || sym}`);
            card.setAttribute(
                'data-tip-what',
                sym === 'BRZ' || sym === 'BRLA'
                    ? 'Stablecoin pareada 1:1 com o Real Brasileiro na blockchain.'
                    : `Saldo consolidado de ${sym} somando Polygon, Ethereum, Arbitrum, Base e Optimism.`
            );
            card.setAttribute(
                'data-tip-impact',
                activeNets.length > 0 ? `Distribuição: ${activeNets.join(' | ')}` : 'Toque para depositar, comprar via PIX ou trocar.'
            );

            const top = document.createElement('div');
            top.className = 'asset-tile-top';
            const symEl = document.createElement('span');
            symEl.className = 'asset-sym';
            symEl.textContent = sym;
            const brlEl = document.createElement('span');
            brlEl.className = 'asset-brl';
            brlEl.textContent = formatBrl(info.brl);
            top.append(symEl, brlEl);

            const sub = document.createElement('div');
            sub.className = 'asset-tile-sub';
            const qtySpan = document.createElement('span');
            qtySpan.textContent = `${info.amount.toFixed(sym === 'WBTC' ? 6 : 4)} ${sym}`;
            const netSpan = document.createElement('span');
            netSpan.className = 'asset-net-tag';
            netSpan.textContent = activeNets.length > 0 ? activeNets[0] : 'Multi-Rede';
            sub.append(qtySpan, netSpan);

            card.append(top, sub);
            card.addEventListener('click', () => {
                // Preenche automaticamente o Swap com este ativo
                const inSel = document.getElementById('swap-token-in');
                if (inSel) inSel.value = sym;
                switchMainSection('swap');
            });

            grid.appendChild(card);
        });
    }

    function syncUiWithVaultState(vaultSnap) {
        const walletBtn = document.getElementById('btn-wallet-status');
        const serenoPill = document.getElementById('sereno-wallet-pill');
        const serenoAddr = document.getElementById('sereno-wallet-address');
        const lockIndicator = document.getElementById('vault-lock-banner');

        const shortAddr = vaultSnap.address
            ? `${vaultSnap.address.slice(0, 6)}...${vaultSnap.address.slice(-4)}`
            : 'Sem Carteira';

        if (walletBtn) {
            if (vaultSnap.mode === 'VAULT_UNLOCKED') {
                walletBtn.textContent = `● COFRE ${shortAddr}`;
                walletBtn.className = 'top-btn wallet-unlocked';
            } else if (vaultSnap.mode === 'VAULT_LOCKED') {
                walletBtn.textContent = `🔒 DESBLOQUEAR ${shortAddr}`;
                walletBtn.className = 'top-btn wallet-locked';
            } else if (vaultSnap.mode === 'EXTERNAL_WALLET') {
                walletBtn.textContent = `● ${vaultSnap.walletLabel.toUpperCase()} ${shortAddr}`;
                walletBtn.className = 'top-btn wallet-unlocked';
            } else if (vaultSnap.mode === 'WATCH_ONLY') {
                walletBtn.textContent = `👁 LEITURA ${shortAddr}`;
                walletBtn.className = 'top-btn';
            } else {
                walletBtn.textContent = 'CRIAR / CONECTAR CARTEIRA';
                walletBtn.className = 'top-btn btn-cta-copper';
            }
        }

        if (serenoPill) {
            serenoPill.textContent = vaultSnap.mode === 'NONE'
                ? 'Autocustódia Inativa'
                : `${vaultSnap.walletLabel} • ${shortAddr}`;
        }

        if (serenoAddr) {
            serenoAddr.textContent = vaultSnap.address || 'Crie seu cofre em 30 segundos ou conecte sua Rabby';
        }

        if (lockIndicator) {
            lockIndicator.style.display = vaultSnap.mode === 'VAULT_LOCKED' ? 'flex' : 'none';
        }

        // Atualiza saldos Polygon locais usados pelo Piloto V3
        const polChain = vaultSnap.balancesByChain?.[137] || {};
        walletBalances = {
            pol: polChain.POL || 0,
            wpol: polChain.WPOL || 0,
            usdt0: polChain.USDT || 0,
            brz: polChain.BRZ || 0,
            brla: polChain.BRLA || 0
        };

        // Atualiza badges rápidos na barra lateral Pro
        const mapQuick = {
            'bal-pol': walletBalances.pol,
            'bal-wpol': walletBalances.wpol,
            'bal-usdt0': walletBalances.usdt0,
            'bal-brz': walletBalances.brz,
            'bal-brla': walletBalances.brla
        };
        Object.entries(mapQuick).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val.toFixed(2);
        });

        // Escudo de Gás Visual (3.0 POL)
        const gasShieldEl = document.getElementById('gas-shield-status');
        if (gasShieldEl) {
            const hasShield = walletBalances.pol >= GAS_RESERVE_POL;
            gasShieldEl.textContent = hasShield
                ? `Escudo Ativo: ${walletBalances.pol.toFixed(2)} POL (3.0 POL protegidos)`
                : `Reserva de Gás Baixa: ${walletBalances.pol.toFixed(2)} / 3.00 POL`;
            gasShieldEl.style.color = hasShield ? 'var(--success-green)' : 'var(--warning-yellow)';
        }

        // Atualiza lista de carteiras externas detectadas (EIP-6963)
        const extList = document.getElementById('eip6963-providers-list');
        if (extList) {
            extList.replaceChildren();
            if (vaultSnap.discoveredProviders.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'muted-hint';
                empty.textContent = 'Nenhuma extensão injetada nesta janela. No celular, use os botões abaixo para abrir direto na Rabby ou MetaMask.';
                extList.appendChild(empty);
            } else {
                vaultSnap.discoveredProviders.forEach((p) => {
                    const btn = document.createElement('button');
                    btn.className = 'provider-detect-btn';
                    btn.textContent = `Conectar ${p.name}`;
                    btn.addEventListener('click', async () => {
                        try {
                            await global.RdeskVault.connectExternalWallet(p.rdns);
                            closeWalletModal();
                        } catch (err) {
                            alert(err.message);
                        }
                    });
                    extList.appendChild(btn);
                });
            }
        }

        usdBrlCommercial = vaultSnap.usdBrlRate || 5.65;
        renderMultiAssetPortfolio(vaultSnap);
        updateSwapBalanceLabels();
        recomputeAutoPilotPlan();
        updateConsolidationHero();
    }

    function updateConsolidationHero() {
        const vaultSnap = global.RdeskVault.getState();
        const freeBrl = vaultSnap.totalPortfolioBrl || 0;
        const freeUsd = vaultSnap.totalPortfolioUsd || 0;

        let activePoolsUsd = 0;
        appState.web3Positions.forEach((p) => {
            activePoolsUsd += (p.positionUsd || 0) + (p.liveFeesUsd || 0);
        });
        const activePoolsBrl = activePoolsUsd * usdBrlCommercial;

        const grandBrl = freeBrl + activePoolsBrl;
        const grandUsd = freeUsd + activePoolsUsd;

        const heroBrlEl = document.getElementById('sereno-total-brl');
        const heroUsdEl = document.getElementById('sereno-total-usd');
        const heroSplitEl = document.getElementById('sereno-equity-split');

        if (heroBrlEl) heroBrlEl.textContent = formatBrl(grandBrl);
        if (heroUsdEl) heroUsdEl.textContent = `${formatUsd(grandUsd)} • Dólar: R$ ${usdBrlCommercial.toFixed(3)}`;
        if (heroSplitEl) {
            heroSplitEl.textContent = `Carteira Livre: ${formatBrl(freeBrl)}  |  Rendendo em Pools: ${formatBrl(activePoolsBrl)}`;
        }

        if (global.RdeskLedger) {
            global.RdeskLedger.recalculateLedgerMetrics(activePoolsBrl, activePoolsUsd);
        }
    }

    // =========================================================================
    // 8. MATEMÁTICA UNISWAP V3, SNIPER PRO (15M) & ESCULTOR DE META R$/MIN
    // =========================================================================
    function ticksToHumanPrice(tickLower, tickUpper, token0IsWpol = true) {
        const rawMin = Math.pow(1.0001, Number(tickLower)) * 1e12;
        const rawMax = Math.pow(1.0001, Number(tickUpper)) * 1e12;
        if (token0IsWpol) {
            return { min: Math.min(rawMin, rawMax), max: Math.max(rawMin, rawMax) };
        }
        return { min: 1 / Math.max(rawMin, rawMax), max: 1 / Math.min(rawMin, rawMax) };
    }

    function humanPriceToAlignedTick(humanPrice, token0IsWpol = true, roundUp = false) {
        const adjusted = token0IsWpol ? (humanPrice / 1e12) : ((1 / humanPrice) / 1e12);
        const exactTick = Math.log(Math.max(1e-30, adjusted)) / Math.log(1.0001);
        const spaced = roundUp
            ? Math.ceil(exactTick / POOL_TICK_SPACING) * POOL_TICK_SPACING
            : Math.floor(exactTick / POOL_TICK_SPACING) * POOL_TICK_SPACING;
        return spaced;
    }

    function computeRangeTokenShares(price, pMin, pMax) {
        if (price <= pMin) return { targetWpolShare: 1.0, targetUsdtShare: 0.0 };
        if (price >= pMax) return { targetWpolShare: 0.0, targetUsdtShare: 1.0 };

        const sqrtP = Math.sqrt(price);
        const sqrtA = Math.sqrt(pMin);
        const sqrtB = Math.sqrt(pMax);

        const amt0 = (1 / sqrtP) - (1 / sqrtB);
        const amt1 = sqrtP - sqrtA;

        const val0Usd = amt0 * price;
        const val1Usd = amt1;
        const total = val0Usd + val1Usd;

        if (total <= 0) return { targetWpolShare: 0.5, targetUsdtShare: 0.5 };
        return {
            targetWpolShare: val0Usd / total,
            targetUsdtShare: val1Usd / total
        };
    }

    function estimateBrlPerMinForRange(capitalUsd, price, pMin, pMax) {
        if (capitalUsd <= 0 || price <= pMin || price >= pMax) return 0;
        const widthRatio = (pMax - pMin) / price;
        // Concentração relativa à faixa ampla de referência (20%)
        const concentrationFactor = Math.min(18, Math.max(0.5, 0.20 / Math.max(0.0025, widthRatio)));
        const basePoolShare = Math.min(0.25, capitalUsd / 180000);
        const estFeesUsdPerMin = poolTelemetry.feesUsdPerMin * basePoolShare * concentrationFactor;
        return estFeesUsdPerMin * usdBrlCommercial;
    }

    function solveRangeForTargetBrlPerMin(targetBrlPerMin, capitalUsd, price, defaultTickLower, defaultTickUpper) {
        const defaultPrices = ticksToHumanPrice(defaultTickLower, defaultTickUpper, true);
        const baselineBrlMin = estimateBrlPerMinForRange(capitalUsd, price, defaultPrices.min, defaultPrices.max);

        if (!targetBrlPerMin || targetBrlPerMin <= 0 || capitalUsd <= 0) {
            return {
                isCustom: false,
                tickLower: defaultTickLower,
                tickUpper: defaultTickUpper,
                pMin: defaultPrices.min,
                pMax: defaultPrices.max,
                baselineBrlMin,
                projectedBrlMin: baselineBrlMin,
                riskLabel: 'SNIPER SEGURO',
                riskColor: 'var(--success-green)',
                cappedByPool: false
            };
        }

        let lowSteps = 2;
        let highSteps = 120;
        let bestSteps = 12;
        const centerTick = humanPriceToAlignedTick(price, true, false);

        for (let iter = 0; iter < 16; iter++) {
            const midSteps = Math.floor((lowSteps + highSteps) / 2);
            const tL = centerTick - midSteps * POOL_TICK_SPACING;
            const tU = centerTick + midSteps * POOL_TICK_SPACING;
            const pr = ticksToHumanPrice(tL, tU, true);
            const est = estimateBrlPerMinForRange(capitalUsd, price, pr.min, pr.max);

            if (est >= targetBrlPerMin) {
                bestSteps = midSteps;
                lowSteps = midSteps + 1;
            } else {
                highSteps = midSteps - 1;
            }
        }

        const finalTickLower = centerTick - bestSteps * POOL_TICK_SPACING;
        const finalTickUpper = centerTick + bestSteps * POOL_TICK_SPACING;
        const finalPrices = ticksToHumanPrice(finalTickLower, finalTickUpper, true);
        const projectedBrlMin = estimateBrlPerMinForRange(capitalUsd, price, finalPrices.min, finalPrices.max);
        const widthPct = ((finalPrices.max - finalPrices.min) / finalPrices.min) * 100;

        let riskLabel = 'EQUILIBRADO';
        let riskColor = 'var(--cyan-accent)';
        if (widthPct < 1.2) {
            riskLabel = 'SCALP ESTREITO (ALTA ATENÇÃO)';
            riskColor = 'var(--warning-yellow)';
        } else if (widthPct >= 3.0) {
            riskLabel = 'FAIXA CONFORTÁVEL';
            riskColor = 'var(--success-green)';
        }

        return {
            isCustom: true,
            tickLower: finalTickLower,
            tickUpper: finalTickUpper,
            pMin: finalPrices.min,
            pMax: finalPrices.max,
            baselineBrlMin,
            projectedBrlMin,
            riskLabel,
            riskColor,
            cappedByPool: bestSteps <= 2 && projectedBrlMin < targetBrlPerMin
        };
    }

    function computeEMA(values, period) {
        if (!values.length) return 0;
        const k = 2 / (period + 1);
        let ema = values[0];
        for (let i = 1; i < values.length; i++) {
            ema = values[i] * k + ema * (1 - k);
        }
        return ema;
    }

    async function refreshSniperModel15m() {
        try {
            const res = await withTimeout(
                fetch(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=15m&limit=100`),
                5000
            );
            const raw = await res.json();
            if (!Array.isArray(raw) || raw.length < 25) return;

            const candles = raw.map((d) => ({
                open: parseFloat(d[1]),
                high: parseFloat(d[2]),
                low: parseFloat(d[3]),
                close: parseFloat(d[4])
            }));

            const trs = [];
            for (let i = 1; i < candles.length; i++) {
                const c = candles[i];
                const prevC = candles[i - 1].close;
                trs.push(Math.max(c.high - c.low, Math.abs(c.high - prevC), Math.abs(c.low - prevC)));
            }

            const atr14 = trs.slice(-14).reduce((a, b) => a + b, 0) / 14;
            const closes = candles.map((c) => c.close);
            const ema9 = computeEMA(closes.slice(-30), 9);
            const ema21 = computeEMA(closes.slice(-45), 21);
            const lastPrice = currentPriceGlobal > 0 ? currentPriceGlobal : closes[closes.length - 1];

            let downWeight = 0.5;
            let upWeight = 0.5;
            let regimeText = 'LATERAL 50/50';

            if (ema9 > ema21 * 1.0015) {
                downWeight = 0.38;
                upWeight = 0.62;
                regimeText = 'ALTA 38/62';
            } else if (ema9 < ema21 * 0.9985) {
                downWeight = 0.62;
                upWeight = 0.38;
                regimeText = 'BAIXA 62/38';
            }

            const totalSpan = Math.max(lastPrice * 0.018, atr14 * 5.2);
            const min = Math.max(0.0001, lastPrice - totalSpan * downWeight);
            const max = lastPrice + totalSpan * upWeight;

            sniperTelemetry = { atr14, downWeight, upWeight, regimeText, min, max };

            const regimeEl = document.getElementById('sniper-regime');
            const stratEl = document.getElementById('strat-sniper');
            const effEl = document.getElementById('sniper-efficiency');
            if (regimeEl) regimeEl.textContent = regimeText;
            if (stratEl) stratEl.textContent = `${min.toFixed(5)} ↔ ${max.toFixed(5)}`;
            if (effEl) effEl.textContent = `ATR14: ${atr14.toFixed(5)}`;

            recomputeAutoPilotPlan();
        } catch (e) {}
    }

    async function refreshPoolVolumeAndLiquidity() {
        try {
            const res = await withTimeout(
                fetch(`https://api.geckoterminal.com/api/v2/networks/polygon_pos/pools/${POOL_ADDRESS}`),
                5000
            );
            const json = await res.json();
            const volObj = json?.data?.attributes?.volume_usd;
            if (volObj) {
                const h24 = parseFloat(volObj.h24) || 0;
                const m5 = parseFloat(volObj.m5) || 0;
                const avg24 = h24 / 1440;
                const rec5 = m5 / 5;
                const blended = rec5 > 0 ? avg24 * 0.65 + rec5 * 0.35 : avg24;
                if (blended > 0) {
                    poolTelemetry.volumeUsdPerMin = blended;
                    poolTelemetry.feesUsdPerMin = blended * (POOL_FEE_TIER / 1_000_000);
                    poolTelemetry.source = 'on-chain + gecko';
                }
            }
        } catch (e) {}
        recomputeAutoPilotPlan();
    }

    // =========================================================================
    // 9. PILOTO AUTOMÁTICO V3 & REBALANCEAMENTO AUTÔNOMO (COM ESCUDO 3.0 POL)
    // =========================================================================
    function buildLiquidityPrepPlan(targetWpolShare, targetUsdtShare, price) {
        const motherRate = getMotherRate();
        const usablePol = Math.max(0, walletBalances.pol - GAS_RESERVE_POL);
        const totalUsd =
            usablePol * price +
            walletBalances.wpol * price +
            walletBalances.usdt0 +
            walletBalances.brz / motherRate +
            walletBalances.brla / (usdtToBrlaRate > 0 ? usdtToBrlaRate : motherRate);

        if (totalUsd < 0.8) return null;

        const swapSteps = [];

        // 1. Converte stablecoins BRL (BRZ / BRLA) livres para USDT0
        if (walletBalances.brz > 1.0) {
            swapSteps.push({ fromSym: 'BRZ', toSym: 'USDT', amountFloat: walletBalances.brz });
        }
        if (walletBalances.brla > 1.0) {
            swapSteps.push({ fromSym: 'BRLA', toSym: 'USDT', amountFloat: walletBalances.brla });
        }

        // 2. Embrulha POL excedente (acima do escudo de 3.0 POL) em WPOL
        if (usablePol > 0.25) {
            swapSteps.push({ fromSym: 'POL', toSym: 'WPOL', amountFloat: usablePol });
        }

        // 3. Equilibra proporção exata entre WPOL e USDT0 conforme faixa escolhida
        const projectedWpolUsd = (walletBalances.wpol + usablePol) * price;
        const projectedUsdtUsd = totalUsd - projectedWpolUsd;
        const desiredWpolUsd = totalUsd * targetWpolShare;
        const desiredUsdtUsd = totalUsd * targetUsdtShare;

        if (projectedWpolUsd > desiredWpolUsd + 0.35) {
            const excessWpol = (projectedWpolUsd - desiredWpolUsd) / price;
            swapSteps.push({ fromSym: 'WPOL', toSym: 'USDT', amountFloat: excessWpol });
        } else if (projectedUsdtUsd > desiredUsdtUsd + 0.35) {
            const excessUsdt = projectedUsdtUsd - desiredUsdtUsd;
            swapSteps.push({ fromSym: 'USDT', toSym: 'WPOL', amountFloat: excessUsdt });
        }

        return {
            totalDeployableUsd: totalUsd,
            totalDeployableBrl: totalUsd * usdBrlCommercial,
            targetWpolShare,
            targetUsdtShare,
            swapSteps
        };
    }

    function recomputeAutoPilotPlan(onChainPoolPrice) {
        const capEl = document.getElementById('ap-available-capital');
        const summaryEl = document.getElementById('ap-plan-summary');
        const btnEl = document.getElementById('btn-start-earning');
        const diagEl = document.getElementById('yt-diagnosis-text');
        const fbEl = document.getElementById('yt-sculpt-feedback');
        const serenoEarnEstimateEl = document.getElementById('sereno-earn-estimate');

        const vaultSnap = global.RdeskVault?.getState();
        const price = onChainPoolPrice && onChainPoolPrice > 0
            ? onChainPoolPrice
            : (currentPriceGlobal > 0 ? currentPriceGlobal : 0.088);

        const usablePol = Math.max(0, walletBalances.pol - GAS_RESERVE_POL);
        const motherRate = getMotherRate();
        const totalDeployableUsd =
            usablePol * price +
            walletBalances.wpol * price +
            walletBalances.usdt0 +
            walletBalances.brz / motherRate +
            walletBalances.brla / (usdtToBrlaRate > 0 ? usdtToBrlaRate : motherRate);
        const totalDeployableBrl = totalDeployableUsd * usdBrlCommercial;

        if (capEl) capEl.textContent = `Capital Livre: ${formatBrl(totalDeployableBrl)}`;

        const halfSpanDefault = price * 0.025;
        const rawMin = sniperTelemetry.min > 0 ? Math.min(sniperTelemetry.min, price - halfSpanDefault * 0.6) : (price - halfSpanDefault);
        const rawMax = sniperTelemetry.max > 0 ? Math.max(sniperTelemetry.max, price + halfSpanDefault * 0.6) : (price + halfSpanDefault);

        let baseTickLower = humanPriceToAlignedTick(rawMin, true, false);
        let baseTickUpper = humanPriceToAlignedTick(rawMax, true, true);
        if (baseTickUpper - baseTickLower < POOL_TICK_SPACING * 4) {
            baseTickLower -= POOL_TICK_SPACING * 2;
            baseTickUpper += POOL_TICK_SPACING * 2;
        }

        const solved = solveRangeForTargetBrlPerMin(
            yieldTargetState.customTargetBrlPerMin,
            totalDeployableUsd,
            price,
            baseTickLower,
            baseTickUpper
        );

        yieldTargetState.baselineBrlPerMin = solved.baselineBrlMin;
        yieldTargetState.projectedBrlPerMin = solved.projectedBrlMin;
        yieldTargetState.sculptedTickLower = solved.tickLower;
        yieldTargetState.sculptedTickUpper = solved.tickUpper;
        yieldTargetState.sculptedMin = solved.pMin;
        yieldTargetState.sculptedMax = solved.pMax;
        yieldTargetState.riskLabel = solved.riskLabel;
        yieldTargetState.riskColor = solved.riskColor;

        const perDayBrl = solved.projectedBrlMin * 60 * 24;
        if (serenoEarnEstimateEl) {
            serenoEarnEstimateEl.textContent = totalDeployableBrl > 2
                ? `Seu saldo livre de ${formatBrl(totalDeployableBrl)} pode gerar ~R$ ${solved.projectedBrlMin.toFixed(4)}/min (${formatBrl(perDayBrl)}/dia) na Uniswap V3.`
                : `Deposite ou converta saldo acima da reserva de 3.0 POL para ativar o Piloto Automático.`;
        }

        if (diagEl) {
            diagEl.textContent = `Com ${formatBrl(totalDeployableBrl)} livres, o range Sniper gera ~R$ ${solved.baselineBrlMin.toFixed(4)}/min (${formatBrl(solved.baselineBrlMin * 60)}/h).`;
        }

        if (fbEl) {
            const widthPct = (((solved.pMax - solved.pMin) / solved.pMin) * 100).toFixed(2);
            fbEl.style.color = solved.riskColor;
            fbEl.textContent = `Faixa: ${solved.pMin.toFixed(5)} ↔ ${solved.pMax.toFixed(5)} (${widthPct}%) • ${solved.riskLabel}`;
        }

        updateChartPreviewLines(solved.pMin, solved.pMax, solved.isCustom);

        const shares = computeRangeTokenShares(price, solved.pMin, solved.pMax);
        const prep = buildLiquidityPrepPlan(shares.targetWpolShare, shares.targetUsdtShare, price);

        if (!vaultSnap?.address || !prep) {
            autoPilotPlan = null;
            if (summaryEl) {
                summaryEl.textContent = !vaultSnap?.address
                    ? 'Crie seu Cofre ou conecte sua carteira para ativar o Piloto Automático.'
                    : `Saldo livre insuficiente (${formatBrl(totalDeployableBrl)}). O escudo de 3.0 POL permanece protegido.`;
            }
            if (btnEl && !isAutoPilotRunning) {
                btnEl.textContent = !vaultSnap?.address ? 'CRIAR / CONECTAR CARTEIRA' : 'COMEÇAR A GANHAR (AUTO-SETUP)';
            }
            return;
        }

        autoPilotPlan = {
            ...prep,
            tickLower: solved.tickLower,
            tickUpper: solved.tickUpper,
            pMin: solved.pMin,
            pMax: solved.pMax
        };

        const stepsLabel = prep.swapSteps.length > 0
            ? `Ajuste automático: ${prep.swapSteps.map((s) => `${s.amountFloat.toFixed(2)} ${s.fromSym}→${s.toSym}`).join(' + ')}`
            : `Proporção pronta (${Math.round(shares.targetWpolShare * 100)}% WPOL / ${Math.round(shares.targetUsdtShare * 100)}% USDT)`;

        if (summaryEl) {
            summaryEl.textContent = `Range ${solved.pMin.toFixed(5)} ↔ ${solved.pMax.toFixed(5)} • ${stepsLabel}`;
        }
        if (btnEl && !isAutoPilotRunning) {
            btnEl.textContent = `COMEÇAR A GANHAR (${formatBrl(totalDeployableBrl)})`;
        }
    }

    function setAutoPilotLog(text, isError = false) {
        const logEl = document.getElementById('ap-status-log');
        const serenoLogEl = document.getElementById('sereno-autopilot-log');
        const color = isError ? 'var(--danger-red)' : 'var(--cyan-accent)';
        if (logEl) {
            logEl.style.color = color;
            logEl.textContent = text;
        }
        if (serenoLogEl) {
            serenoLogEl.style.color = color;
            serenoLogEl.textContent = text;
        }
    }

    async function getExactOnChainPoolPrice() {
        try {
            return await global.RdeskVault.callWithRpcFailover(137, async (provider) => {
                const pool = new ethers.Contract(
                    POOL_ADDRESS,
                    ['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)'],
                    provider
                );
                const slot0 = await pool.slot0();
                return Math.pow(1.0001, Number(slot0.tick)) * 1e12;
            }, 4000);
        } catch (e) {
            return currentPriceGlobal;
        }
    }

    async function runAutoPilotWorkflow() {
        if (isAutoPilotRunning) return;
        const vaultSnap = global.RdeskVault.getState();

        if (!vaultSnap.address) {
            openWalletModal('create');
            return;
        }
        if (vaultSnap.mode === 'VAULT_LOCKED') {
            openWalletModal('connect');
            return;
        }

        isAutoPilotRunning = true;
        try {
            setAutoPilotLog('Sincronizando preço real da pool na Polygon...');
            await global.RdeskVault.refreshAllBalancesAndPrices();
            const realPoolPrice = await getExactOnChainPoolPrice();
            recomputeAutoPilotPlan(realPoolPrice);

            if (!autoPilotPlan) {
                throw new Error('Saldo livre insuficiente acima da reserva de segurança de 3.0 POL.');
            }

            // Recibo Humano Pré-Assinatura em Reais
            const confirmed = await showHumanReceiptModal({
                actionTitle: 'Ativar Piloto Automático Uniswap V3',
                outSummary: `${formatBrl(autoPilotPlan.totalDeployableBrl)} em saldo livre`,
                outBrl: autoPilotPlan.totalDeployableBrl,
                inSummary: `Pool POL/USDT0 (${autoPilotPlan.pMin.toFixed(5)} ↔ ${autoPilotPlan.pMax.toFixed(5)})`,
                inBrl: autoPilotPlan.totalDeployableBrl,
                routeLabel: 'Uniswap V3 NFPM (Polygon 0.05%)',
                appFeeText: 'R$ 0,00 (Contrato Imutável Direto)',
                estimatedGasText: '~0.06 POL',
                estimatedGasBrl: 0.06 * (vaultSnap.pricesUsd.POL || 0.088) * usdBrlCommercial,
                gasReserveText: '3.00 POL intactos na carteira'
            });

            if (!confirmed) {
                setAutoPilotLog('');
                return;
            }

            // 1. Executa conversões/balanceamentos necessários
            for (let i = 0; i < autoPilotPlan.swapSteps.length; i++) {
                const st = autoPilotPlan.swapSteps[i];
                setAutoPilotLog(`Etapa ${i + 1}: Convertendo ${st.amountFloat.toFixed(2)} ${st.fromSym} → ${st.toSym}...`);
                const quote = await global.RdeskGateway.quoteBestSwapOrBridge({
                    fromChainId: 137,
                    toChainId: 137,
                    fromSymbol: st.fromSym,
                    toSymbol: st.toSym,
                    amountIn: st.amountFloat
                });
                await global.RdeskGateway.executePreparedSwapOrBridge(quote, (subMsg) => setAutoPilotLog(subMsg));
            }

            const signer = await global.RdeskVault.getSignerForChain(137);
            const ownerAddr = await signer.getAddress();

            const erc20Abi = global.RdeskVault.ERC20_MIN_ABI;
            const wpolC = new ethers.Contract(WPOL_ADDR, erc20Abi, signer);
            const usdtC = new ethers.Contract(USDT0_ADDR, erc20Abi, signer);

            const [balWpolBN, balUsdtBN] = await Promise.all([
                wpolC.balanceOf(ownerAddr),
                usdtC.balanceOf(ownerAddr)
            ]);

            if (balWpolBN.isZero() || balUsdtBN.isZero()) {
                throw new Error('Balanceamento parcial concluído. Clique novamente para abrir a posição.');
            }

            // 2. Aprovações exatas (sem MAX_UINT256)
            const allow0 = await wpolC.allowance(ownerAddr, NFPM_ADDRESS);
            if (allow0.lt(balWpolBN)) {
                setAutoPilotLog('Aprovando WPOL exato para Uniswap V3...');
                if (!allow0.isZero()) await (await wpolC.approve(NFPM_ADDRESS, 0)).wait(1);
                await (await wpolC.approve(NFPM_ADDRESS, balWpolBN)).wait(1);
            }

            const allow1 = await usdtC.allowance(ownerAddr, NFPM_ADDRESS);
            if (allow1.lt(balUsdtBN)) {
                setAutoPilotLog('Aprovando USDT0 exato para Uniswap V3...');
                if (!allow1.isZero()) await (await usdtC.approve(NFPM_ADDRESS, 0)).wait(1);
                await (await usdtC.approve(NFPM_ADDRESS, balUsdtBN)).wait(1);
            }

            // 3. Simulação callStatic + Mint protegido anti-MEV
            setAutoPilotLog('Simulando e abrindo posição NFT na Uniswap V3...');
            const nfpmMint = new ethers.Contract(
                NFPM_ADDRESS,
                ['function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'],
                signer
            );

            const baseParams = {
                token0: WPOL_ADDR,
                token1: USDT0_ADDR,
                fee: POOL_FEE_TIER,
                tickLower: autoPilotPlan.tickLower,
                tickUpper: autoPilotPlan.tickUpper,
                amount0Desired: balWpolBN,
                amount1Desired: balUsdtBN,
                amount0Min: 0,
                amount1Min: 0,
                recipient: ownerAddr,
                deadline: Math.floor(Date.now() / 1000) + 1200
            };

            const simRes = await nfpmMint.callStatic.mint(baseParams);
            const protectedParams = {
                ...baseParams,
                amount0Min: simRes.amount0.mul(985).div(1000),
                amount1Min: simRes.amount1.mul(985).div(1000)
            };

            const mintTx = await nfpmMint.mint(protectedParams, { gasLimit: 650000 });
            const receipt = await mintTx.wait(1);
            const gasPaidPol = parseFloat(ethers.utils.formatEther(receipt.gasUsed.mul(receipt.effectiveGasPrice)));

            setAutoPilotLog('Posição aberta com sucesso! Rendendo tarifas na Uniswap V3.');
            playBeep(1318, 0.3, 'sine');
            updateChartPreviewLines(0, 0, false);

            await scanWeb3Positions();
            if (appState.focusedId) {
                appState.pnlOverrides[appState.focusedId] = {
                    initBrz: Number((autoPilotPlan.totalDeployableUsd * getMotherRate()).toFixed(2)),
                    openGasPol: Number(gasPaidPol.toFixed(5)),
                    autoChecked: true
                };
                saveAppState();
                syncPnlInputsWithFocused();
            }
        } catch (err) {
            setAutoPilotLog(err?.reason || err?.message || 'Operação cancelada.', true);
        } finally {
            isAutoPilotRunning = false;
            recomputeAutoPilotPlan();
        }
    }

    // =========================================================================
    // 10. REBALANCEAMENTO AUTÔNOMO (FECHAR + COLETAR + AJUSTAR + REABRIR)
    // =========================================================================
    async function executeRebalancePositionOnChain(tokenId, e) {
        if (e) e.stopPropagation();
        if (isAutoPilotRunning) return;

        const vaultSnap = global.RdeskVault.getState();
        if (vaultSnap.mode === 'VAULT_LOCKED') {
            openWalletModal('connect');
            return;
        }

        const feedbackEl = document.getElementById('nft-tx-feedback');
        isAutoPilotRunning = true;

        try {
            if (feedbackEl) {
                feedbackEl.style.color = 'var(--cyan-accent)';
                feedbackEl.textContent = `Calculando rebalanceamento autônomo para NFT #${tokenId}...`;
            }

            const realPoolPrice = await getExactOnChainPoolPrice();
            recomputeAutoPilotPlan(realPoolPrice);

            const targetTickLower = yieldTargetState.sculptedTickLower;
            const targetTickUpper = yieldTargetState.sculptedTickUpper;
            if (targetTickLower === null || targetTickUpper === null) {
                throw new Error('Aguarde o cálculo da nova faixa Sniper.');
            }

            const newPrices = ticksToHumanPrice(targetTickLower, targetTickUpper, true);
            const posObj = appState.web3Positions.find((p) => String(p.tokenId) === String(tokenId));
            const estPosBrl = ((posObj?.positionUsd || 0) + (posObj?.liveFeesUsd || 0)) * usdBrlCommercial;

            const confirmed = await showHumanReceiptModal({
                actionTitle: `Rebalancear Posição NFT #${tokenId}`,
                outSummary: `Encerrar faixa antiga (${posObj ? `${posObj.min.toFixed(5)}↔${posObj.max.toFixed(5)}` : `#${tokenId}`})`,
                outBrl: estPosBrl,
                inSummary: `Nova faixa Sniper (${newPrices.min.toFixed(5)} ↔ ${newPrices.max.toFixed(5)})`,
                inBrl: estPosBrl,
                routeLabel: 'Multicall NFPM + SwapRouter02 (Uniswap V3)',
                appFeeText: 'R$ 0,00 (Execução Direta On-Chain)',
                estimatedGasText: '~0.07 POL',
                estimatedGasBrl: 0.07 * (vaultSnap.pricesUsd.POL || 0.088) * usdBrlCommercial,
                gasReserveText: '3.00 POL protegidos'
            });

            if (!confirmed) {
                if (feedbackEl) feedbackEl.textContent = '';
                return;
            }

            const signer = await global.RdeskVault.getSignerForChain(137);
            const ownerAddr = await signer.getAddress();

            // Passo 1: Fechar e coletar 100% da posição antiga em 1 transação multicall
            if (feedbackEl) feedbackEl.textContent = `1/3: Recolhendo liquidez + tarifas do NFT #${tokenId}...`;
            const nfpmAbi = [
                'function positions(uint256) view returns (uint96,address,address,address,uint24,int24,int24,uint128 liquidity,uint256,uint256,uint128,uint128)',
                'function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint256, uint256)',
                'function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external payable returns (uint256, uint256)',
                'function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)',
                'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'
            ];

            const nfpm = new ethers.Contract(NFPM_ADDRESS, nfpmAbi, signer);
            const onChainPos = await nfpm.positions(ethers.BigNumber.from(tokenId));
            const calls = [];

            if (onChainPos.liquidity.gt(0)) {
                calls.push(
                    nfpm.interface.encodeFunctionData('decreaseLiquidity', [{
                        tokenId: ethers.BigNumber.from(tokenId),
                        liquidity: onChainPos.liquidity,
                        amount0Min: 0,
                        amount1Min: 0,
                        deadline: Math.floor(Date.now() / 1000) + 1200
                    }])
                );
            }

            calls.push(
                nfpm.interface.encodeFunctionData('collect', [{
                    tokenId: ethers.BigNumber.from(tokenId),
                    recipient: ownerAddr,
                    amount0Max: MAX_UINT128,
                    amount1Max: MAX_UINT128
                }])
            );

            const closeTx = await nfpm.multicall(calls, { gasLimit: 450000 });
            const closeReceipt = await closeTx.wait(1);
            let totalGasPol = parseFloat(ethers.utils.formatEther(closeReceipt.gasUsed.mul(closeReceipt.effectiveGasPrice)));

            // Passo 2: Ler novos saldos livres e equilibrar apenas a diferença
            if (feedbackEl) feedbackEl.textContent = '2/3: Equilibrando proporção WPOL / USDT0 para a nova faixa...';
            await global.RdeskVault.refreshAllBalancesAndPrices();
            const shares = computeRangeTokenShares(realPoolPrice, newPrices.min, newPrices.max);

            const wpolUsd = walletBalances.wpol * realPoolPrice;
            const usdtUsd = walletBalances.usdt0;
            const combinedUsd = wpolUsd + usdtUsd;

            const targetWpolUsd = combinedUsd * shares.targetWpolShare;
            const targetUsdtUsd = combinedUsd * shares.targetUsdtShare;

            if (wpolUsd > targetWpolUsd + 0.35) {
                const diffWpol = (wpolUsd - targetWpolUsd) / realPoolPrice;
                const q = await global.RdeskGateway.quoteBestSwapOrBridge({
                    fromChainId: 137,
                    toChainId: 137,
                    fromSymbol: 'WPOL',
                    toSymbol: 'USDT',
                    amountIn: diffWpol
                });
                await global.RdeskGateway.executePreparedSwapOrBridge(q);
            } else if (usdtUsd > targetUsdtUsd + 0.35) {
                const diffUsdt = usdtUsd - targetUsdtUsd;
                const q = await global.RdeskGateway.quoteBestSwapOrBridge({
                    fromChainId: 137,
                    toChainId: 137,
                    fromSymbol: 'USDT',
                    toSymbol: 'WPOL',
                    amountIn: diffUsdt
                });
                await global.RdeskGateway.executePreparedSwapOrBridge(q);
            }

            // Passo 3: Aprovar exato e abrir o novo NFT na faixa atualizada
            if (feedbackEl) feedbackEl.textContent = '3/3: Abrindo nova posição otimizada na Uniswap V3...';
            const erc20Abi = global.RdeskVault.ERC20_MIN_ABI;
            const wpolC = new ethers.Contract(WPOL_ADDR, erc20Abi, signer);
            const usdtC = new ethers.Contract(USDT0_ADDR, erc20Abi, signer);

            const [bal0, bal1] = await Promise.all([wpolC.balanceOf(ownerAddr), usdtC.balanceOf(ownerAddr)]);
            const allow0 = await wpolC.allowance(ownerAddr, NFPM_ADDRESS);
            if (allow0.lt(bal0)) {
                if (!allow0.isZero()) await (await wpolC.approve(NFPM_ADDRESS, 0)).wait(1);
                await (await wpolC.approve(NFPM_ADDRESS, bal0)).wait(1);
            }
            const allow1 = await usdtC.allowance(ownerAddr, NFPM_ADDRESS);
            if (allow1.lt(bal1)) {
                if (!allow1.isZero()) await (await usdtC.approve(NFPM_ADDRESS, 0)).wait(1);
                await (await usdtC.approve(NFPM_ADDRESS, bal1)).wait(1);
            }

            const baseMint = {
                token0: WPOL_ADDR,
                token1: USDT0_ADDR,
                fee: POOL_FEE_TIER,
                tickLower: targetTickLower,
                tickUpper: targetTickUpper,
                amount0Desired: bal0,
                amount1Desired: bal1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: ownerAddr,
                deadline: Math.floor(Date.now() / 1000) + 1200
            };

            const sim = await nfpm.callStatic.mint(baseMint);
            const mintTx = await nfpm.mint(
                {
                    ...baseMint,
                    amount0Min: sim.amount0.mul(985).div(1000),
                    amount1Min: sim.amount1.mul(985).div(1000)
                },
                { gasLimit: 650000 }
            );
            const mintReceipt = await mintTx.wait(1);
            totalGasPol += parseFloat(ethers.utils.formatEther(mintReceipt.gasUsed.mul(mintReceipt.effectiveGasPrice)));

            // Preserva histórico de aporte inicial para manter contabilidade real íntegra
            const oldOv = appState.pnlOverrides[`web3-${tokenId}`] || {};
            delete appState.pnlOverrides[`web3-${tokenId}`];

            await scanWeb3Positions();
            if (appState.focusedId) {
                appState.pnlOverrides[appState.focusedId] = {
                    initBrz: oldOv.initBrz || Number((combinedUsd * getMotherRate()).toFixed(2)),
                    openGasPol: Number(((oldOv.openGasPol || 0) + totalGasPol).toFixed(5)),
                    autoChecked: true
                };
                saveAppState();
                syncPnlInputsWithFocused();
            }

            if (feedbackEl) {
                feedbackEl.style.color = 'var(--success-green)';
                feedbackEl.textContent = `Rebalanceamento concluído! Nova faixa ${newPrices.min.toFixed(5)} ↔ ${newPrices.max.toFixed(5)}.`;
            }
            playBeep(1318, 0.35, 'sine');
        } catch (err) {
            if (feedbackEl) {
                feedbackEl.style.color = 'var(--danger-red)';
                feedbackEl.textContent = err?.reason || err?.message || 'Rebalanceamento cancelado.';
            }
        } finally {
            isAutoPilotRunning = false;
        }
    }

    async function executeCollectFeesOnChain(tokenId, e) {
        if (e) e.stopPropagation();
        const vaultSnap = global.RdeskVault.getState();
        const posObj = appState.web3Positions.find((p) => String(p.tokenId) === String(tokenId));
        const feesBrl = (posObj?.liveFeesUsd || 0) * usdBrlCommercial;

        const confirmed = await showHumanReceiptModal({
            actionTitle: `Colher Tarifas do NFT #${tokenId}`,
            outSummary: 'Apenas gás de rede Polygon',
            outBrl: 0.02 * (vaultSnap.pricesUsd.POL || 0.088) * usdBrlCommercial,
            inSummary: `~${formatBrl(feesBrl)} em WPOL + USDT0 para sua carteira`,
            inBrl: feesBrl,
            routeLabel: 'Uniswap V3 NFPM.collect()',
            appFeeText: 'R$ 0,00 (100% das tarifas são suas)',
            estimatedGasText: '~0.02 POL',
            estimatedGasBrl: 0.02 * (vaultSnap.pricesUsd.POL || 0.088) * usdBrlCommercial,
            gasReserveText: '3.00 POL protegidos'
        });

        if (!confirmed) return;

        const feedbackEl = document.getElementById('nft-tx-feedback');
        try {
            const signer = await global.RdeskVault.getSignerForChain(137);
            const ownerAddr = await signer.getAddress();
            const nfpm = new ethers.Contract(
                NFPM_ADDRESS,
                ['function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external payable returns (uint256, uint256)'],
                signer
            );
            const tx = await nfpm.collect({
                tokenId: ethers.BigNumber.from(tokenId),
                recipient: ownerAddr,
                amount0Max: MAX_UINT128,
                amount1Max: MAX_UINT128
            });
            await tx.wait(1);
            if (feedbackEl) {
                feedbackEl.style.color = 'var(--success-green)';
                feedbackEl.textContent = `Tarifas do NFT #${tokenId} colhidas para sua carteira!`;
            }
            await scanWeb3Positions();
        } catch (err) {
            if (feedbackEl) {
                feedbackEl.style.color = 'var(--danger-red)';
                feedbackEl.textContent = err?.reason || err?.message || 'Erro ao colher tarifas.';
            }
        }
    }

    async function executeWithdrawPositionOnChain(tokenId, e) {
        if (e) e.stopPropagation();
        const vaultSnap = global.RdeskVault.getState();
        const posObj = appState.web3Positions.find((p) => String(p.tokenId) === String(tokenId));
        const totalBrl = ((posObj?.positionUsd || 0) + (posObj?.liveFeesUsd || 0)) * usdBrlCommercial;

        const confirmed = await showHumanReceiptModal({
            actionTitle: `Encerrar e Sacar Posição NFT #${tokenId}`,
            outSummary: `Remover 100% da liquidez do NFT #${tokenId}`,
            outBrl: totalBrl,
            inSummary: `~${formatBrl(totalBrl)} de volta no saldo livre da carteira`,
            inBrl: totalBrl,
            routeLabel: 'Uniswap V3 NFPM.multicall([decrease, collect])',
            appFeeText: 'R$ 0,00',
            estimatedGasText: '~0.045 POL',
            estimatedGasBrl: 0.045 * (vaultSnap.pricesUsd.POL || 0.088) * usdBrlCommercial,
            gasReserveText: '3.00 POL protegidos'
        });

        if (!confirmed) return;

        const feedbackEl = document.getElementById('nft-tx-feedback');
        try {
            const signer = await global.RdeskVault.getSignerForChain(137);
            const ownerAddr = await signer.getAddress();
            const nfpm = new ethers.Contract(
                NFPM_ADDRESS,
                [
                    'function positions(uint256) view returns (uint96,address,address,address,uint24,int24,int24,uint128 liquidity,uint256,uint256,uint128,uint128)',
                    'function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint256, uint256)',
                    'function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external payable returns (uint256, uint256)',
                    'function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)'
                ],
                signer
            );
            const pos = await nfpm.positions(ethers.BigNumber.from(tokenId));
            const calls = [];
            if (pos.liquidity.gt(0)) {
                calls.push(
                    nfpm.interface.encodeFunctionData('decreaseLiquidity', [{
                        tokenId: ethers.BigNumber.from(tokenId),
                        liquidity: pos.liquidity,
                        amount0Min: 0,
                        amount1Min: 0,
                        deadline: Math.floor(Date.now() / 1000) + 1200
                    }])
                );
            }
            calls.push(
                nfpm.interface.encodeFunctionData('collect', [{
                    tokenId: ethers.BigNumber.from(tokenId),
                    recipient: ownerAddr,
                    amount0Max: MAX_UINT128,
                    amount1Max: MAX_UINT128
                }])
            );

            const tx = await nfpm.multicall(calls, { gasLimit: 450000 });
            await tx.wait(1);
            if (feedbackEl) {
                feedbackEl.style.color = 'var(--success-green)';
                feedbackEl.textContent = `Posição #${tokenId} encerrada e fundos devolvidos à carteira!`;
            }
            await scanWeb3Positions();
        } catch (err) {
            if (feedbackEl) {
                feedbackEl.style.color = 'var(--danger-red)';
                feedbackEl.textContent = err?.reason || err?.message || 'Erro ao encerrar posição.';
            }
        }
    }

    // =========================================================================
    // 11. LEITURA ON-CHAIN DE POSIÇÕES NFT V3 & TARIFAS LIVE (256-BIT)
    // =========================================================================
    function subUint256(a, b) {
        return a.gte(b) ? a.sub(b) : Q256.sub(b).add(a);
    }

    function computeLiveUnclaimedFees(pos, poolState) {
        try {
            const L = ethers.BigNumber.from(pos.liquidity || '0');
            if (L.isZero()) return { usd: 0 };

            const lowerInfo = poolState.ticksMap[pos.tickLower];
            const upperInfo = poolState.ticksMap[pos.tickUpper];
            if (!lowerInfo || !upperInfo) return { usd: 0 };

            const tc = poolState.tickCurrent;
            const fg0 = poolState.feeGrowthGlobal0X128;
            const fg1 = poolState.feeGrowthGlobal1X128;

            const below0 = tc >= pos.tickLower ? lowerInfo.feeGrowthOutside0X128 : subUint256(fg0, lowerInfo.feeGrowthOutside0X128);
            const below1 = tc >= pos.tickLower ? lowerInfo.feeGrowthOutside1X128 : subUint256(fg1, lowerInfo.feeGrowthOutside1X128);

            const above0 = tc < pos.tickUpper ? upperInfo.feeGrowthOutside0X128 : subUint256(fg0, upperInfo.feeGrowthOutside0X128);
            const above1 = tc < pos.tickUpper ? upperInfo.feeGrowthOutside1X128 : subUint256(fg1, upperInfo.feeGrowthOutside1X128);

            const inside0 = subUint256(subUint256(fg0, below0), above0);
            const inside1 = subUint256(subUint256(fg1, below1), above1);

            const delta0 = subUint256(inside0, ethers.BigNumber.from(pos.feeGrowthInside0LastX128 || '0'));
            const delta1 = subUint256(inside1, ethers.BigNumber.from(pos.feeGrowthInside1LastX128 || '0'));

            const owed0 = ethers.BigNumber.from(pos.tokensOwed0 || '0').add(L.mul(delta0).div(Q128));
            const owed1 = ethers.BigNumber.from(pos.tokensOwed1 || '0').add(L.mul(delta1).div(Q128));

            const f0 = parseFloat(ethers.utils.formatUnits(owed0, 18));
            const f1 = parseFloat(ethers.utils.formatUnits(owed1, 6));
            const price = currentPriceGlobal > 0 ? currentPriceGlobal : 0.088;

            return { usd: f0 * price + f1 };
        } catch (e) {
            return { usd: 0 };
        }
    }

    function computePositionUsdValue(pos, price) {
        if (!pos.liquidity || pos.liquidity === '0' || price <= 0) return 0;
        const L = parseFloat(pos.liquidity);
        const sqrtP = Math.sqrt(price / 1e12);
        const sqrtA = Math.sqrt(pos.min / 1e12);
        const sqrtB = Math.sqrt(pos.max / 1e12);

        let raw0 = 0;
        let raw1 = 0;
        if (sqrtP <= sqrtA) {
            raw0 = L * ((1 / sqrtA) - (1 / sqrtB));
        } else if (sqrtP >= sqrtB) {
            raw1 = L * (sqrtB - sqrtA);
        } else {
            raw0 = L * ((1 / sqrtP) - (1 / sqrtB));
            raw1 = L * (sqrtP - sqrtA);
        }

        return (raw0 / 1e18) * price + (raw1 / 1e6);
    }

    async function scanWeb3Positions() {
        const vaultSnap = global.RdeskVault.getState();
        const address = vaultSnap.address;
        const routeStatusEl = document.getElementById('route-status');
        if (!address || !ethers.utils.isAddress(address)) return;

        if (routeStatusEl) routeStatusEl.textContent = 'ESCANEANDO...';

        try {
            const nfpmAbi = [
                'function balanceOf(address owner) view returns (uint256)',
                'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
                'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)'
            ];

            const found = await global.RdeskVault.callWithRpcFailover(137, async (provider) => {
                const nfpm = new ethers.Contract(NFPM_ADDRESS, nfpmAbi, provider);
                const countBN = await nfpm.balanceOf(address);
                const count = Math.min(30, countBN.toNumber());
                const list = [];

                for (let i = count - 1; i >= 0; i--) {
                    const tidBN = await nfpm.tokenOfOwnerByIndex(address, i);
                    const p = await nfpm.positions(tidBN);
                    if (p.liquidity.isZero()) continue;

                    const t0 = p.token0.toLowerCase();
                    const t1 = p.token1.toLowerCase();
                    const isTargetPair =
                        (t0 === WPOL_ADDR.toLowerCase() && t1 === USDT0_ADDR.toLowerCase()) ||
                        (t0 === USDT0_ADDR.toLowerCase() && t1 === WPOL_ADDR.toLowerCase());
                    if (!isTargetPair) continue;

                    const prices = ticksToHumanPrice(p.tickLower, p.tickUpper, t0 === WPOL_ADDR.toLowerCase());
                    list.push({
                        id: `web3-${tidBN.toString()}`,
                        tokenId: tidBN.toString(),
                        min: prices.min,
                        max: prices.max,
                        tickLower: Number(p.tickLower),
                        tickUpper: Number(p.tickUpper),
                        liquidity: p.liquidity.toString(),
                        feeGrowthInside0LastX128: p.feeGrowthInside0LastX128.toString(),
                        feeGrowthInside1LastX128: p.feeGrowthInside1LastX128.toString(),
                        tokensOwed0: p.tokensOwed0.toString(),
                        tokensOwed1: p.tokensOwed1.toString(),
                        liveFeesUsd: 0,
                        positionUsd: 0,
                        label: `NFT #${tidBN.toString()}`,
                        source: 'web3'
                    });
                }
                return list;
            }, 6500);

            appState.web3Positions = found;
            if (!appState.focusedId && found.length > 0) {
                appState.focusedId = found[0].id;
            }
            if (routeStatusEl) routeStatusEl.textContent = `OK (${found.length} ATIVAS)`;
        } catch (err) {
            if (routeStatusEl) routeStatusEl.textContent = 'FAILOVER RPC';
        }

        await refreshLiveFeesAndMetrics();
        saveAppState();
    }

    async function refreshLiveFeesAndMetrics() {
        const price = currentPriceGlobal > 0 ? currentPriceGlobal : 0.088;

        if (appState.web3Positions.length > 0) {
            try {
                await global.RdeskVault.callWithRpcFailover(137, async (provider) => {
                    const pool = new ethers.Contract(
                        POOL_ADDRESS,
                        [
                            'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
                            'function feeGrowthGlobal0X128() view returns (uint256)',
                            'function feeGrowthGlobal1X128() view returns (uint256)',
                            'function ticks(int24) view returns (uint128, int128, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56, uint160, uint32, bool)'
                        ],
                        provider
                    );

                    const [slot0, fg0, fg1] = await Promise.all([
                        pool.slot0(),
                        pool.feeGrowthGlobal0X128(),
                        pool.feeGrowthGlobal1X128()
                    ]);

                    const uniqueTicks = new Set();
                    appState.web3Positions.forEach((p) => {
                        uniqueTicks.add(p.tickLower);
                        uniqueTicks.add(p.tickUpper);
                    });

                    const ticksMap = {};
                    await Promise.all(
                        Array.from(uniqueTicks).map(async (t) => {
                            const td = await pool.ticks(t);
                            ticksMap[t] = {
                                feeGrowthOutside0X128: td.feeGrowthOutside0X128,
                                feeGrowthOutside1X128: td.feeGrowthOutside1X128
                            };
                        })
                    );

                    const poolState = {
                        tickCurrent: Number(slot0.tick),
                        feeGrowthGlobal0X128: fg0,
                        feeGrowthGlobal1X128: fg1,
                        ticksMap
                    };

                    let sumFees = 0;
                    appState.web3Positions.forEach((p) => {
                        p.positionUsd = computePositionUsdValue(p, price);
                        p.liveFeesUsd = computeLiveUnclaimedFees(p, poolState).usd;
                        sumFees += p.liveFeesUsd;
                    });
                    totalUnclaimedFeesUsd = sumFees;
                }, 5000);
            } catch (e) {}
        }

        renderAllPositions();
        updateFocusedMetrics();
        updateConsolidationHero();
    }

    // =========================================================================
    // 12. RENDERIZAÇÃO DOS CARDS DE POSIÇÃO + CONSULTOR BREAK-EVEN & REBALANCE
    // =========================================================================
    function getAllPositions() {
        return [...appState.web3Positions, ...appState.manualPositions];
    }

    function renderAllPositions() {
        const containers = [
            document.getElementById('positions-list'),
            document.getElementById('sereno-positions-list')
        ].filter(Boolean);

        const all = getAllPositions();
        const price = currentPriceGlobal > 0 ? currentPriceGlobal : 0.088;

        containers.forEach((listEl) => {
            listEl.replaceChildren();
            if (all.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'muted-hint';
                empty.textContent = 'Nenhuma pool ativa detectada. Use o Piloto Automático acima para abrir sua primeira posição.';
                listEl.appendChild(empty);
                return;
            }

            all.forEach((pos) => {
                const isFocused = pos.id === appState.focusedId;
                const ov = appState.pnlOverrides[pos.id] || {};
                const initialCapitalBrl = ov.initBrz || ((pos.positionUsd || 0) * usdBrlCommercial);

                const advice = global.RdeskLedger
                    ? global.RdeskLedger.analyzePositionBreakEven({
                        minPrice: pos.min,
                        maxPrice: pos.max,
                        currentPrice: price,
                        currentPosUsd: pos.positionUsd || 0,
                        unclaimedFeesUsd: pos.liveFeesUsd || 0,
                        initialCapitalBrl,
                        openGasPol: ov.openGasPol || 0.05,
                        polPriceUsd: price,
                        usdBrlRate: usdBrlCommercial
                    })
                    : null;

                const card = document.createElement('div');
                card.className = `pos-card ${isFocused ? 'focused' : ''}`;
                card.addEventListener('click', () => {
                    appState.focusedId = pos.id;
                    saveAppState();
                    syncPnlInputsWithFocused();
                    renderAllPositions();
                    updateFocusedMetrics();
                });

                const header = document.createElement('div');
                header.className = 'pos-card-top';

                const titleSpan = document.createElement('strong');
                titleSpan.textContent = `${pos.label} • ${pos.min.toFixed(5)} ↔ ${pos.max.toFixed(5)}`;

                const badgeSpan = document.createElement('span');
                badgeSpan.className = `pos-status-badge tone-${(advice?.statusTone || 'PROFIT').toLowerCase()}`;
                badgeSpan.textContent = advice?.statusBadge || 'ATIVA';

                header.append(titleSpan, badgeSpan);
                card.appendChild(header);

                // Diagnóstico Break-Even (Lucro Bruto vs Lucro Líquido Real)
                if (advice && pos.source === 'web3') {
                    const diagBox = document.createElement('div');
                    diagBox.className = `breakeven-box ${advice.isNetProfitable ? 'is-profit' : 'is-waiting'}`;
                    diagBox.textContent = advice.profitExplanation;
                    card.appendChild(diagBox);

                    // Recomendação Proativa de Rebalanceamento
                    if (advice.shouldSuggestRebalance) {
                        const rebAlert = document.createElement('div');
                        rebAlert.className = 'rebalance-prompt-box';

                        const msg = document.createElement('span');
                        msg.textContent = advice.rebalancePrompt;

                        const rebNowBtn = document.createElement('button');
                        rebNowBtn.className = 'btn-rebalance-cta';
                        rebNowBtn.textContent = 'REBALANCEAR AGORA';
                        rebNowBtn.addEventListener('click', (ev) => executeRebalancePositionOnChain(pos.tokenId, ev));

                        rebAlert.append(msg, rebNowBtn);
                        card.appendChild(rebAlert);
                    }
                }

                // Barra de ações da posição
                const actionsRow = document.createElement('div');
                actionsRow.className = 'pos-actions-row';

                if (pos.source === 'web3') {
                    const btnColher = document.createElement('button');
                    btnColher.className = 'pos-act-btn green';
                    btnColher.textContent = `COLHER (${formatBrl((pos.liveFeesUsd || 0) * usdBrlCommercial)})`;
                    btnColher.addEventListener('click', (ev) => executeCollectFeesOnChain(pos.tokenId, ev));

                    const btnReb = document.createElement('button');
                    btnReb.className = 'pos-act-btn copper';
                    btnReb.textContent = 'REBALANCEAR';
                    btnReb.addEventListener('click', (ev) => executeRebalancePositionOnChain(pos.tokenId, ev));

                    const btnOut = document.createElement('button');
                    btnOut.className = 'pos-act-btn red';
                    btnOut.textContent = 'SACAR POOL';
                    btnOut.addEventListener('click', (ev) => executeWithdrawPositionOnChain(pos.tokenId, ev));

                    actionsRow.append(btnColher, btnReb, btnOut);
                } else {
                    const btnDel = document.createElement('button');
                    btnDel.className = 'pos-act-btn red';
                    btnDel.textContent = 'REMOVER SIMULAÇÃO';
                    btnDel.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        appState.manualPositions = appState.manualPositions.filter((m) => m.id !== pos.id);
                        if (appState.focusedId === pos.id) appState.focusedId = null;
                        saveAppState();
                        renderAllPositions();
                        updateFocusedMetrics();
                    });
                    actionsRow.appendChild(btnDel);
                }

                card.appendChild(actionsRow);
                listEl.appendChild(card);
            });
        });

        updateChartPositionLines();
    }

    function syncPnlInputsWithFocused() {
        const initEl = document.getElementById('pnl-init-brz');
        const gasEl = document.getElementById('pnl-open-gas-pol');
        if (!initEl || !gasEl || !appState.focusedId) return;

        const ov = appState.pnlOverrides[appState.focusedId] || {};
        if (ov.initBrz !== undefined) initEl.value = ov.initBrz;
        if (ov.openGasPol !== undefined) gasEl.value = ov.openGasPol;
    }

    function updateFocusedMetrics() {
        const all = getAllPositions();
        const focused = all.find((p) => p.id === appState.focusedId) || all[0] || null;
        const price = currentPriceGlobal > 0 ? currentPriceGlobal : 0.088;
        const motherRate = getMotherRate();

        const focusedLbl = document.getElementById('focused-label');
        const statusPill = document.getElementById('alert-status');

        if (!focused) {
            if (focusedLbl) focusedLbl.textContent = 'FOCO: NENHUMA POSIÇÃO';
            return;
        }

        if (focusedLbl) focusedLbl.textContent = `FOCO: ${focused.label}`;

        const posUsd = focused.positionUsd || 0;
        const feesUsd = focused.liveFeesUsd || 0;

        const valBrzEl = document.getElementById('wallet-total-brz');
        const valSubEl = document.getElementById('wallet-total-usd');
        const feesBrzEl = document.getElementById('fees-total-brz');
        const feesSubEl = document.getElementById('fees-total-usd');

        if (valBrzEl) valBrzEl.textContent = `${(posUsd * motherRate).toFixed(2)} BRZ`;
        if (valSubEl) valSubEl.textContent = `${formatUsd(posUsd)} | ${formatBrl(posUsd * usdBrlCommercial)}`;
        if (feesBrzEl) feesBrzEl.textContent = `${(totalUnclaimedFeesUsd * motherRate).toFixed(4)} BRZ`;
        if (feesSubEl) feesSubEl.textContent = `${formatUsd(totalUnclaimedFeesUsd)} | ${formatBrl(totalUnclaimedFeesUsd * usdBrlCommercial)}`;

        // Distribuição POL / USDT na faixa
        const shares = computeRangeTokenShares(price, focused.min, focused.max);
        const polPct = Math.round(shares.targetWpolShare * 100);
        const usdtPct = 100 - polPct;
        const span = focused.max - focused.min;
        const markerPct = span > 0 ? Math.max(0, Math.min(100, ((price - focused.min) / span) * 100)) : 50;

        if (document.getElementById('bar-pol')) document.getElementById('bar-pol').style.width = `${polPct}%`;
        if (document.getElementById('bar-usdt')) document.getElementById('bar-usdt').style.width = `${usdtPct}%`;
        if (document.getElementById('dist-marker')) document.getElementById('dist-marker').style.left = `${markerPct}%`;
        if (document.getElementById('lbl-pol')) document.getElementById('lbl-pol').textContent = `${polPct}% POL`;
        if (document.getElementById('lbl-usdt')) document.getElementById('lbl-usdt').textContent = `${usdtPct}% USDT`;

        // P&L Líquido Real
        const initBrz = parseFloat(document.getElementById('pnl-init-brz')?.value) || (posUsd * motherRate);
        const openGasPol = parseFloat(document.getElementById('pnl-open-gas-pol')?.value) || 0.05;
        const totalGasBrz = (openGasPol + 0.045) * price * motherRate;
        const netFeesBrz = (feesUsd * motherRate) - totalGasBrz;
        const realTotalBrz = ((posUsd + feesUsd) * motherRate) - initBrz - totalGasBrz;

        const netFeesEl = document.getElementById('pnl-net-fees-brz');
        const gasSubEl = document.getElementById('pnl-gas-cost-sub');
        const realBrzEl = document.getElementById('pnl-real-total-brz');
        const realBrlEl = document.getElementById('pnl-real-total-brl');

        if (netFeesEl) {
            netFeesEl.textContent = `${netFeesBrz >= 0 ? '+' : ''}${netFeesBrz.toFixed(4)} BRZ`;
            netFeesEl.style.color = netFeesBrz >= 0 ? 'var(--success-green)' : 'var(--warning-yellow)';
        }
        if (gasSubEl) gasSubEl.textContent = `Gás Total (Ab+Fech): -${totalGasBrz.toFixed(2)} BRZ`;
        if (realBrzEl) {
            realBrzEl.textContent = `${realTotalBrz >= 0 ? '+' : ''}${realTotalBrz.toFixed(2)} BRZ`;
            realBrzEl.style.color = realTotalBrz >= 0 ? 'var(--success-green)' : 'var(--danger-red)';
        }
        if (realBrlEl) realBrlEl.textContent = `${formatBrl(realTotalBrz * (usdBrlCommercial / motherRate))} líquido real`;

        // Alerta visual & sonoro calmo de borda/saída de range
        if (statusPill) {
            if (price < focused.min || price > focused.max) {
                statusPill.textContent = 'FORA DO RANGE';
                statusPill.className = 'status-pill danger';
                if (Date.now() - lastAlertBeepMs > 25000) {
                    playBeep(520, 0.25, 'triangle');
                    lastAlertBeepMs = Date.now();
                }
            } else if (markerPct <= 10 || markerPct >= 90) {
                statusPill.textContent = 'BORDA DO RANGE';
                statusPill.className = 'status-pill warn';
            } else {
                statusPill.textContent = 'SEGURO';
                statusPill.className = 'status-pill safe';
            }
        }
    }

    // =========================================================================
    // 13. SWAP MULTI-REDE & MÓDULO PIX (COMPRAR & SACAR LÍQUIDO)
    // =========================================================================
    function updateSwapBalanceLabels() {
        const fromChain = Number(document.getElementById('swap-from-chain')?.value || 137);
        const toChain = Number(document.getElementById('swap-to-chain')?.value || 137);
        const symIn = document.getElementById('swap-token-in')?.value || 'POL';
        const symOut = document.getElementById('swap-token-out')?.value || 'USDT';

        const snap = global.RdeskVault.getState();
        const balIn = snap.balancesByChain?.[fromChain]?.[symIn] || 0;
        const balOut = snap.balancesByChain?.[toChain]?.[symOut] || 0;

        const inEl = document.getElementById('swap-in-bal');
        const outEl = document.getElementById('swap-out-bal');
        if (inEl) inEl.textContent = balIn.toFixed(symIn === 'WBTC' ? 6 : 4);
        if (outEl) outEl.textContent = balOut.toFixed(symOut === 'WBTC' ? 6 : 4);
    }

    function scheduleSwapQuote(delayMs = 350) {
        if (swapQuoteTimer) clearTimeout(swapQuoteTimer);
        swapQuoteTimer = setTimeout(refreshSwapQuoteNow, delayMs);
    }

    async function refreshSwapQuoteNow() {
        const fromChainId = Number(document.getElementById('swap-from-chain')?.value || 137);
        const toChainId = Number(document.getElementById('swap-to-chain')?.value || 137);
        const fromSymbol = document.getElementById('swap-token-in')?.value || 'POL';
        const toSymbol = document.getElementById('swap-token-out')?.value || 'USDT';
        const amountIn = parseFloat(document.getElementById('swap-amount-in')?.value || '0');

        const outBox = document.getElementById('swap-amount-out');
        const routeTag = document.getElementById('swap-router-tag');
        const brlEqEl = document.getElementById('swap-brl-eq');
        const execBtn = document.getElementById('btn-exec-swap');

        if (!Number.isFinite(amountIn) || amountIn <= 0) {
            activeSwapQuote = null;
            if (outBox) outBox.value = '0.00';
            if (brlEqEl) brlEqEl.textContent = 'R$ 0,00';
            return;
        }

        if (outBox) outBox.value = 'Calculando...';

        try {
            const quote = await global.RdeskGateway.quoteBestSwapOrBridge({
                fromChainId,
                toChainId,
                fromSymbol,
                toSymbol,
                amountIn
            });
            activeSwapQuote = quote;

            const snap = global.RdeskVault.getState();
            const outBrl = quote.amountOutFloat * (snap.pricesUsd[toSymbol] || 0) * usdBrlCommercial;

            if (outBox) outBox.value = quote.amountOutFloat.toFixed(toSymbol === 'WBTC' ? 6 : 4);
            if (routeTag) routeTag.textContent = quote.routeEngine;
            if (brlEqEl) brlEqEl.textContent = `${formatBrl(outBrl)} (${formatUsd(outBrl / usdBrlCommercial)})`;
            if (execBtn) {
                execBtn.textContent = fromChainId === toChainId
                    ? `TROCAR ${fromSymbol} → ${toSymbol}`
                    : `ENVIAR VIA PONTE PARA ${global.RdeskVault.NETWORKS[toChainId]?.name.toUpperCase()}`;
            }
        } catch (err) {
            activeSwapQuote = null;
            if (outBox) outBox.value = '--';
            if (routeTag) routeTag.textContent = err.message || 'Rota indisponível';
        }
    }

    async function handleExecuteSwapClick() {
        const statusEl = document.getElementById('swap-tx-status');
        try {
            if (!activeSwapQuote) await refreshSwapQuoteNow();
            if (!activeSwapQuote) throw new Error('Informe um valor válido para cotar antes de trocar.');

            const receiptPreview = global.RdeskGateway.buildSwapReceiptPreview(activeSwapQuote);
            const confirmed = await showHumanReceiptModal(receiptPreview);
            if (!confirmed) return;

            if (statusEl) {
                statusEl.style.color = 'var(--cyan-accent)';
                statusEl.textContent = 'Processando operação na rede...';
            }

            const txReceipt = await global.RdeskGateway.executePreparedSwapOrBridge(activeSwapQuote, (msg) => {
                if (statusEl) statusEl.textContent = msg;
            });

            if (statusEl) {
                statusEl.style.color = 'var(--success-green)';
                statusEl.textContent = `Concluído com sucesso! TX: ${txReceipt.transactionHash.slice(0, 12)}...`;
            }
            playBeep(1318, 0.25, 'sine');
        } catch (err) {
            if (statusEl) {
                statusEl.style.color = 'var(--danger-red)';
                statusEl.textContent = err?.reason || err?.message || 'Operação não concluída.';
            }
        }
    }

    function renderPixModule() {
        // 1. Rotas de Compra via PIX (BRL -> Autocustódia)
        const buyBrl = parseFloat(document.getElementById('pix-buy-brl')?.value || '120');
        const buyAsset = document.getElementById('pix-buy-asset')?.value || 'USDT';
        const buyList = document.getElementById('pix-buy-routes-list');

        if (buyList) {
            buyList.replaceChildren();
            const buyRoutes = global.RdeskGateway.evaluatePixBuyRoutes({
                brlAmount: buyBrl,
                targetSymbol: buyAsset,
                targetChainId: 137
            });

            buyRoutes.forEach((r, idx) => {
                const row = document.createElement('div');
                row.className = `pix-route-card ${idx === 0 ? 'winner' : ''}`;

                const top = document.createElement('div');
                top.className = 'pix-route-top';
                const nameEl = document.createElement('strong');
                nameEl.textContent = `${idx === 0 ? '★ ' : ''}${r.name}`;
                const valEl = document.createElement('span');
                valEl.className = 'pix-net-val';
                valEl.textContent = `~${r.netTokens.toFixed(r.targetSymbol === 'WBTC' ? 6 : 2)} ${r.targetSymbol}`;
                top.append(nameEl, valEl);

                const sub = document.createElement('div');
                sub.className = 'pix-route-sub';
                sub.textContent = `${r.badge} • Líquido: ${formatBrl(r.netBrl)} • ${r.etaText}`;

                row.append(top, sub);
                row.addEventListener('click', () => {
                    if (r.walletAddress && navigator.clipboard) {
                        navigator.clipboard.writeText(r.walletAddress).catch(() => {});
                    }
                    window.open(r.url, '_blank', 'noopener,noreferrer');
                });
                buyList.appendChild(row);
            });
        }

        // 2. Rotas de Saque PIX Líquido (Cripto -> Banco)
        const sellAsset = document.getElementById('pix-asset')?.value || 'USDT';
        const sellAmount = parseFloat(document.getElementById('pix-amount')?.value || '50');
        const sellList = document.getElementById('pix-ranking-list');

        if (sellList) {
            sellList.replaceChildren();
            const routes = global.RdeskGateway.rankPixCashoutRoutes({
                symbol: sellAsset,
                amount: sellAmount,
                chainId: 137,
                onlyNoKyc: appState.onlyNoKycPix
            });

            routes.forEach((r, idx) => {
                const item = document.createElement('div');
                item.className = `pix-route-card ${idx === 0 ? 'winner' : ''}`;

                const top = document.createElement('div');
                top.className = 'pix-route-top';
                const title = document.createElement('strong');
                title.textContent = `${idx === 0 ? '🏆 ' : ''}${r.name}`;
                const netBrlEl = document.createElement('span');
                netBrlEl.className = 'pix-net-val';
                netBrlEl.textContent = formatBrl(r.netBrl);
                top.append(title, netBrlEl);

                const meta = document.createElement('div');
                meta.className = 'pix-route-sub';
                meta.textContent = `${r.tag} • Custo total: -${r.effectiveLossPct.toFixed(2)}% • ${r.eta}`;

                item.append(top, meta);

                if (r.smallAmountWarning) {
                    const warn = document.createElement('div');
                    warn.className = 'pix-warn-line';
                    warn.textContent = r.smallAmountWarning;
                    item.appendChild(warn);
                }

                item.addEventListener('click', () => {
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(String(r.amount)).catch(() => {});
                    }
                    window.open(r.url, '_blank', 'noopener,noreferrer');
                });

                sellList.appendChild(item);
            });
        }
    }

    // =========================================================================
    // 14. GRÁFICO TRADINGVIEW, OHLC MULTI-TIMEFRAME & FEEDS AO VIVO
    // =========================================================================
    async function initTradingViewChart() {
        const container = document.getElementById('tv-chart');
        if (!container || typeof LightweightCharts === 'undefined') return;

        tvChart = LightweightCharts.createChart(container, {
            width: Math.max(280, container.clientWidth),
            height: Math.max(220, container.clientHeight),
            layout: { background: { color: '#050505' }, textColor: '#999' },
            grid: {
                vertLines: { color: 'rgba(255,255,255,0.03)' },
                horzLines: { color: 'rgba(255,255,255,0.04)' }
            },
            timeScale: { timeVisible: true, secondsVisible: false },
            rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' }
        });

        candleSeries = tvChart.addCandlestickSeries({
            upColor: '#00D084',
            downColor: '#E5484D',
            borderVisible: false,
            wickUpColor: '#00D084',
            wickDownColor: '#E5484D',
            priceFormat: { type: 'price', precision: 5, minMove: 0.00001 }
        });

        await loadChartCandles(appState.activeTimeframe);
    }

    async function loadChartCandles(interval = '15m') {
        if (!candleSeries) return;
        try {
            const res = await withTimeout(
                fetch(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${interval}&limit=200`),
                5000
            );
            const raw = await res.json();
            if (!Array.isArray(raw)) return;

            const bars = raw.map((d) => ({
                time: Math.floor(d[0] / 1000),
                open: parseFloat(d[1]),
                high: parseFloat(d[2]),
                low: parseFloat(d[3]),
                close: parseFloat(d[4])
            }));

            candleSeries.setData(bars);
            currentCandle = bars[bars.length - 1] || null;
            updateChartPositionLines();
        } catch (e) {}
    }

    function updateLiveCandle(price) {
        if (!candleSeries || !currentCandle || price <= 0) return;
        const sec = appState.activeSeconds || 900;
        const bucket = Math.floor(Date.now() / 1000 / sec) * sec;

        if (bucket > currentCandle.time) {
            currentCandle = { time: bucket, open: price, high: price, low: price, close: price };
        } else {
            currentCandle.high = Math.max(currentCandle.high, price);
            currentCandle.low = Math.min(currentCandle.low, price);
            currentCandle.close = price;
        }
        candleSeries.update(currentCandle);
    }

    function updateChartPositionLines() {
        if (!candleSeries) return;
        priceLinesMap.forEach((l) => {
            try { candleSeries.removePriceLine(l); } catch (e) {}
        });
        priceLinesMap = [];

        getAllPositions().forEach((pos) => {
            const isFocused = pos.id === appState.focusedId;
            const color = isFocused ? '#CDA434' : 'rgba(205, 164, 52, 0.45)';
            [
                { price: pos.min, title: `${pos.label} MÍN` },
                { price: pos.max, title: `${pos.label} MÁX` }
            ].forEach((cfg) => {
                const line = candleSeries.createPriceLine({
                    price: cfg.price,
                    color,
                    lineWidth: isFocused ? 2 : 1,
                    lineStyle: 2,
                    axisLabelVisible: isFocused,
                    title: cfg.title
                });
                priceLinesMap.push(line);
            });
        });
    }

    function updateChartPreviewLines(minP, maxP, active) {
        if (!candleSeries) return;
        previewLinesMap.forEach((l) => {
            try { candleSeries.removePriceLine(l); } catch (e) {}
        });
        previewLinesMap = [];

        if (!active || minP <= 0 || maxP <= 0) return;
        [
            { price: minP, title: 'ALVO MÍN' },
            { price: maxP, title: 'ALVO MÁX' }
        ].forEach((cfg) => {
            previewLinesMap.push(
                candleSeries.createPriceLine({
                    price: cfg.price,
                    color: '#00D4FF',
                    lineWidth: 1,
                    lineStyle: 1,
                    axisLabelVisible: true,
                    title: cfg.title
                })
            );
        });
    }

    async function buildVariationsPanel() {
        const grid = document.getElementById('variations-grid');
        if (!grid) return;

        const intervals = [
            { label: '1 MIN', tf: '1m' },
            { label: '5 MIN', tf: '5m' },
            { label: '15 MIN', tf: '15m' },
            { label: '1 HORA', tf: '1h' },
            { label: '4 HORAS', tf: '4h' },
            { label: '1 DIA', tf: '1d' },
            { label: '1 SEMANA', tf: '1w' }
        ];

        const results = await Promise.all(
            intervals.map(async (item) => {
                try {
                    const res = await withTimeout(
                        fetch(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${item.tf}&limit=2`),
                        4000
                    );
                    const data = await res.json();
                    const bar = data[data.length - 1];
                    const o = parseFloat(bar[1]);
                    const c = parseFloat(bar[4]);
                    const pct = o > 0 ? ((c - o) / o) * 100 : 0;
                    return { label: item.label, pct };
                } catch (e) {
                    return { label: item.label, pct: 0 };
                }
            })
        );

        grid.replaceChildren();
        results.forEach((r) => {
            const card = document.createElement('div');
            card.className = 'var-card';
            const lbl = document.createElement('span');
            lbl.className = 'var-lbl';
            lbl.textContent = r.label;
            const val = document.createElement('strong');
            val.className = r.pct >= 0 ? 'up' : 'down';
            val.textContent = `${r.pct >= 0 ? '+' : ''}${r.pct.toFixed(2)}%`;
            card.append(lbl, val);
            grid.appendChild(card);
        });
    }

    function initGlobalTracker() {
        try {
            const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${SYMBOL.toLowerCase()}@ticker`);
            ws.onmessage = (event) => {
                const payload = JSON.parse(event.data);
                const newPrice = parseFloat(payload.c);
                if (!Number.isFinite(newPrice) || newPrice <= 0) return;

                const priceEl = document.getElementById('price-global');
                if (priceEl) {
                    if (lastPriceGlobal !== 0 && newPrice !== lastPriceGlobal) {
                        priceEl.classList.remove('tick-up', 'tick-down');
                        void priceEl.offsetWidth;
                        priceEl.classList.add(newPrice > lastPriceGlobal ? 'tick-up' : 'tick-down');
                    }
                    priceEl.textContent = newPrice.toFixed(6);
                }

                lastPriceGlobal = newPrice;
                currentPriceGlobal = newPrice;

                const polBrzEl = document.getElementById('macro-pol-brz');
                const polBrlEl = document.getElementById('macro-pol-brl');
                if (polBrzEl) polBrzEl.textContent = `${(newPrice * getMotherRate()).toFixed(4)} BRZ`;
                if (polBrlEl) polBrlEl.textContent = `R$ ${(newPrice * usdBrlCommercial).toFixed(4)}`;

                updateLiveCandle(newPrice);
                updateFocusedMetrics();
            };
            ws.onclose = () => setTimeout(initGlobalTracker, 4000);
        } catch (e) {}
    }

    function initPolygonTapeScanner() {
        try {
            const wsPool = new WebSocket('wss://polygon-bor-rpc.publicnode.com');
            const dot = document.getElementById('polygon-dot');
            const iface = new ethers.utils.Interface([
                'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)'
            ]);

            wsPool.onopen = () => {
                wsPool.send(JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'eth_subscribe',
                    params: ['logs', { address: POOL_ADDRESS }]
                }));
            };

            wsPool.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                const log = msg?.params?.result;
                if (!log || log.topics?.[0] !== SWAP_TOPIC) return;

                if (dot) {
                    dot.style.background = 'var(--dekton-copper)';
                    setTimeout(() => { dot.style.background = '#fff'; }, 300);
                }

                try {
                    const parsed = iface.parseLog(log);
                    const amt0 = parseFloat(ethers.utils.formatUnits(parsed.args.amount0.toString(), 18));
                    const amt1 = parseFloat(ethers.utils.formatUnits(parsed.args.amount1.toString(), 6));
                    const isBuy = amt0 < 0;

                    const tape = document.getElementById('tape');
                    if (!tape) return;

                    const row = document.createElement('div');
                    row.className = `tape-row ${isBuy ? 'buy' : 'sell'}`;

                    const c1 = document.createElement('div');
                    c1.textContent = new Date().toLocaleTimeString('pt-BR', { hour12: false });
                    const c2 = document.createElement('div');
                    c2.textContent = isBuy ? 'COMPRA' : 'VENDA';
                    const c3 = document.createElement('div');
                    c3.textContent = formatBrl(Math.abs(amt1) * usdBrlCommercial);
                    const c4 = document.createElement('div');
                    c4.textContent = Math.abs(amt0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

                    row.append(c1, c2, c3, c4);
                    tape.prepend(row);
                    while (tape.children.length > 40) {
                        tape.removeChild(tape.lastChild);
                    }
                } catch (e) {}
            };

            wsPool.onclose = () => setTimeout(initPolygonTapeScanner, 5000);
        } catch (e) {}
    }

    // =========================================================================
    // 15. RENDERIZAÇÃO DO LEDGER HISTÓRICO (DESDE A 1ª TX)
    // =========================================================================
    function syncLedgerUi(ledgerSnap) {
        const s = ledgerSnap.summary;
        const isBrl = ledgerSnap.displayCurrency === 'BRL';

        const progBar = document.getElementById('ledger-progress-bar');
        const progTxt = document.getElementById('ledger-progress-text');
        if (progBar) progBar.style.display = ledgerSnap.isScanning ? 'block' : 'none';
        if (progTxt) progTxt.textContent = ledgerSnap.isScanning ? ledgerSnap.progressText : `Auditoria desde ${s.firstTxDate}`;

        const trendBadge = document.getElementById('equity-trend-badge');
        if (trendBadge) {
            if (s.trendDirection === 'UP') {
                trendBadge.textContent = `▲ PATRIMÔNIO SUBINDO (+${s.roiPct.toFixed(2)}%)`;
                trendBadge.className = 'trend-pill up';
            } else if (s.trendDirection === 'DOWN') {
                trendBadge.textContent = `▼ PATRIMÔNIO ABAIXO DO APORTE (${s.roiPct.toFixed(2)}%)`;
                trendBadge.className = 'trend-pill down';
            } else {
                trendBadge.textContent = 'AGUARDANDO HISTÓRICO';
                trendBadge.className = 'trend-pill';
            }
        }

        const setTxt = (id, brlVal, usdVal) => {
            const el = document.getElementById(id);
            if (el) el.textContent = isBrl ? formatBrl(brlVal) : formatUsd(usdVal);
        };

        setTxt('ld-total-in', s.totalInBrl, s.totalInUsd);
        setTxt('ld-total-out', s.totalOutBrl, s.totalOutUsd);
        setTxt('ld-current-eq', s.currentEquityBrl, s.currentEquityUsd);
        setTxt('ld-real-pnl', s.realPnlBrl, s.realPnlUsd);

        const pnlEl = document.getElementById('ld-real-pnl');
        if (pnlEl) pnlEl.style.color = s.realPnlBrl >= 0 ? 'var(--success-green)' : 'var(--warning-yellow)';

        global.RdeskLedger?.renderEquityChart('equity-curve-chart');

        // Tabela de eventos recentes com botão de reclassificação
        const txBody = document.getElementById('ledger-events-list');
        if (txBody) {
            txBody.replaceChildren();
            const recent = [...ledgerSnap.events].reverse().slice(0, 45);
            recent.forEach((ev) => {
                const row = document.createElement('div');
                row.className = 'ledger-ev-row';

                const dEl = document.createElement('span');
                dEl.className = 'ev-date';
                dEl.textContent = ev.dateKey;

                const descEl = document.createElement('span');
                descEl.className = 'ev-desc';
                descEl.textContent = ev.summaryText;

                const valEl = document.createElement('span');
                valEl.className = 'ev-val';
                const valNum = ev.inBrl > 0 ? ev.inBrl : ev.outBrl;
                valEl.textContent = valNum > 0 ? formatBrl(valNum) : `Gás ${formatBrl(ev.gasBrl)}`;

                const clsBtn = document.createElement('button');
                clsBtn.className = `ev-class-btn cls-${ev.effectiveClass.toLowerCase()}`;
                clsBtn.textContent = ev.effectiveClass === 'IN' ? 'APORTE' : (ev.effectiveClass === 'OUT' ? 'SAQUE' : (ev.effectiveClass === 'DEFI' ? 'DEFI' : 'IGNORADO'));
                clsBtn.title = 'Clique para alterar a classificação contábil desta transação';
                clsBtn.addEventListener('click', () => {
                    const cycle = { IN: 'OUT', OUT: 'DEFI', DEFI: 'IGNORE', IGNORE: 'IN' };
                    global.RdeskLedger.setEventClassificationOverride(ev.hash, cycle[ev.effectiveClass] || 'DEFI');
                });

                row.append(dEl, descEl, valEl, clsBtn);
                txBody.appendChild(row);
            });
        }
    }

    // =========================================================================
    // 16. PWA ANDROID (SERVICE WORKER, INSTALL PROMPT & WAKE LOCK)
    // =========================================================================
    function initAndroidPwaFeatures() {
        if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
            navigator.serviceWorker.register('./sw.js').catch(() => {});
        }

        let deferredPrompt = null;
        const installBtn = document.getElementById('btn-install-pwa');

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            if (installBtn) installBtn.style.display = 'inline-flex';
        });

        installBtn?.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const choice = await deferredPrompt.userChoice;
            if (choice.outcome === 'accepted') installBtn.style.display = 'none';
            deferredPrompt = null;
        });

        // Screen Wake Lock API (Impede a tela do celular de apagar durante monitoramento)
        let wakeSentinel = null;
        let wakeActive = false;
        const wakeBtn = document.getElementById('btn-wake-lock');

        async function acquireWake() {
            if (!('wakeLock' in navigator)) return;
            try {
                wakeSentinel = await navigator.wakeLock.request('screen');
                if (wakeBtn) {
                    wakeBtn.textContent = 'TELA: ATIVA';
                    wakeBtn.classList.add('wake-on');
                }
            } catch (e) {}
        }

        wakeBtn?.addEventListener('click', async () => {
            if (!('wakeLock' in navigator)) {
                alert('Seu navegador não suporta bloqueio de suspensão de tela.');
                return;
            }
            wakeActive = !wakeActive;
            if (wakeActive) {
                await acquireWake();
            } else {
                if (wakeSentinel) await wakeSentinel.release();
                wakeSentinel = null;
                wakeBtn.textContent = 'TELA: AUTO';
                wakeBtn.classList.remove('wake-on');
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (wakeActive && document.visibilityState === 'visible') acquireWake();
        });
    }

    // =========================================================================
    // 17. INICIALIZAÇÃO GERAL E BINDING DE EVENTOS
    // =========================================================================
    window.addEventListener('DOMContentLoaded', async () => {
        loadAppState();
        initMicroMentor();
        initAndroidPwaFeatures();
        applyUiProfile(appState.uiProfile);

        // Toggle Modo Sereno <-> Terminal Pro
        document.getElementById('btn-toggle-pro')?.addEventListener('click', () => {
            applyUiProfile(appState.uiProfile === 'PRO' ? 'SERENO' : 'PRO');
        });

        // Áudio
        const audioBtn = document.getElementById('btn-audio');
        if (audioBtn) {
            audioBtn.textContent = appState.audioEnabled ? 'SOM: ON' : 'SOM: OFF';
            audioBtn.addEventListener('click', () => {
                appState.audioEnabled = !appState.audioEnabled;
                audioBtn.textContent = appState.audioEnabled ? 'SOM: ON' : 'SOM: OFF';
                saveAppState();
                if (appState.audioEnabled) playBeep(987, 0.15, 'sine');
            });
        }

        // Navegação Mobile & Sereno
        document.querySelectorAll('.mb-nav-btn, .sereno-nav-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const target = btn.getAttribute('data-target');
                if (target) switchMainSection(target);
            });
        });

        // Abas laterais Pro
        document.getElementById('tab-radar')?.addEventListener('click', () => switchRightTab('radar'));
        document.getElementById('tab-swap')?.addEventListener('click', () => switchRightTab('swap'));
        document.getElementById('tab-pix')?.addEventListener('click', () => switchRightTab('pix'));

        // Modal de Carteira & Cofre
        document.getElementById('btn-wallet-status')?.addEventListener('click', () => {
            const st = global.RdeskVault.getState();
            openWalletModal(st.mode === 'NONE' ? 'create' : 'connect');
        });
        document.getElementById('btn-sereno-open-wallet')?.addEventListener('click', () => {
            const st = global.RdeskVault.getState();
            openWalletModal(st.mode === 'NONE' ? 'create' : 'connect');
        });
        document.getElementById('btn-close-wallet-modal')?.addEventListener('click', closeWalletModal);

        document.querySelectorAll('.wm-tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => switchWalletModalTab(btn.getAttribute('data-wmtab')));
        });

        // Criar Carteira (12 ou 24 palavras) + Desafio das 3 palavras
        document.getElementById('create-word-count')?.addEventListener('change', regenerateDraftSeedUI);
        document.getElementById('btn-regenerate-seed')?.addEventListener('click', regenerateDraftSeedUI);
        document.getElementById('btn-copy-draft-seed')?.addEventListener('click', () => {
            const btn = document.getElementById('btn-copy-draft-seed');
            global.RdeskVault.copySecretWithAutoClear(_currentDraftMnemonic, () => {
                if (btn) btn.textContent = 'COPIAR FRASES (LIMPA EM 45S)';
            });
            if (btn) btn.textContent = 'COPIADA! (AUTO-LIMPEZA 45S)';
        });
        document.getElementById('btn-go-verify-words')?.addEventListener('click', showThreeWordVerificationStep);
        document.getElementById('btn-back-to-words')?.addEventListener('click', () => {
            document.getElementById('create-step-2')?.classList.remove('active');
            document.getElementById('create-step-1')?.classList.add('active');
        });

        document.getElementById('btn-finalize-create-vault')?.addEventListener('click', async () => {
            const errEl = document.getElementById('create-vault-error');
            try {
                if (errEl) errEl.textContent = '';
                const p1 = document.getElementById('create-vault-pass')?.value || '';
                const p2 = document.getElementById('create-vault-pass-confirm')?.value || '';
                if (p1 !== p2) throw new Error('As duas senhas digitadas não coincidem.');

                const checks = _currentChallengeList.map((item) => {
                    const inp = document.querySelector(`[data-challenge-pos="${item.position}"]`);
                    return { index: item.index, position: item.position, answer: inp?.value || '' };
                });

                await global.RdeskVault.commitVaultFromMnemonic({
                    mnemonic: _currentDraftMnemonic,
                    password: p1,
                    challengeChecks: checks,
                    isImport: false
                });
                _currentDraftMnemonic = '';
                closeWalletModal();
            } catch (err) {
                if (errEl) errEl.textContent = err.message;
            }
        });

        // Importar Seed (12 ou 24 palavras compatíveis com Rabby/MetaMask)
        document.getElementById('btn-finalize-import-vault')?.addEventListener('click', async () => {
            const errEl = document.getElementById('import-vault-error');
            try {
                if (errEl) errEl.textContent = '';
                const seed = document.getElementById('import-seed-input')?.value || '';
                const pass = document.getElementById('import-vault-pass')?.value || '';
                await global.RdeskVault.commitVaultFromMnemonic({
                    mnemonic: seed,
                    password: pass,
                    isImport: true
                });
                document.getElementById('import-seed-input').value = '';
                closeWalletModal();
            } catch (err) {
                if (errEl) errEl.textContent = err.message;
            }
        });

        // Desbloquear / Bloquear Cofre
        document.getElementById('btn-vault-unlock')?.addEventListener('click', async () => {
            const errEl = document.getElementById('unlock-vault-error');
            try {
                if (errEl) errEl.textContent = '';
                const pass = document.getElementById('vault-unlock-pass')?.value || '';
                await global.RdeskVault.unlockVault(pass);
                document.getElementById('vault-unlock-pass').value = '';
                closeWalletModal();
            } catch (err) {
                if (errEl) errEl.textContent = err.message;
            }
        });
        document.getElementById('btn-vault-lock')?.addEventListener('click', () => {
            global.RdeskVault.lockVault();
            closeWalletModal();
        });

        // Handoff Android (Rabby Mobile / MetaMask / Trust) & Modo Observação
        document.getElementById('btn-handoff-rabby')?.addEventListener('click', () => global.RdeskVault.openAndroidWalletHandoff('rabby'));
        document.getElementById('btn-handoff-metamask')?.addEventListener('click', () => global.RdeskVault.openAndroidWalletHandoff('metamask'));
        document.getElementById('btn-connect-injected')?.addEventListener('click', async () => {
            try {
                const res = await global.RdeskVault.connectExternalWallet();
                if (res.connected) closeWalletModal();
                else if (res.needsMobileHandoff) global.RdeskVault.openAndroidWalletHandoff('rabby');
            } catch (err) {
                alert(err.message);
            }
        });
        document.getElementById('btn-set-watch-only')?.addEventListener('click', () => {
            try {
                const addr = document.getElementById('watch-only-input')?.value || '';
                global.RdeskVault.setWatchOnlyAddress(addr);
                closeWalletModal();
            } catch (err) {
                alert(err.message);
            }
        });

        // Enviar Multi-Rede (8 moedas / 5 redes) com Recibo Humano
        document.getElementById('btn-send-max')?.addEventListener('click', () => {
            const cid = Number(document.getElementById('send-chain-id')?.value || 137);
            const sym = document.getElementById('send-asset-symbol')?.value || 'POL';
            const maxVal = global.RdeskVault.getSpendableBalance(cid, sym);
            const inp = document.getElementById('send-amount');
            if (inp) inp.value = maxVal.toFixed(sym === 'WBTC' ? 6 : 4);
        });

        document.getElementById('btn-preview-send')?.addEventListener('click', async () => {
            const statusEl = document.getElementById('send-tx-feedback');
            try {
                if (statusEl) statusEl.textContent = '';
                const cid = Number(document.getElementById('send-chain-id')?.value || 137);
                const sym = document.getElementById('send-asset-symbol')?.value || 'POL';
                const to = document.getElementById('send-to-address')?.value || '';
                const amt = document.getElementById('send-amount')?.value || '';

                const preview = await global.RdeskVault.buildTransferPreview({
                    chainId: cid,
                    symbol: sym,
                    toAddress: to,
                    amount: amt
                });

                const ok = await showHumanReceiptModal(preview);
                if (!ok) return;

                if (statusEl) {
                    statusEl.style.color = 'var(--cyan-accent)';
                    statusEl.textContent = 'Enviando transação na blockchain...';
                }
                const receipt = await global.RdeskVault.sendPreparedTransaction(cid, preview.txPayload);
                if (statusEl) {
                    statusEl.style.color = 'var(--success-green)';
                    statusEl.textContent = `Enviado com sucesso! Hash: ${receipt.transactionHash.slice(0, 12)}...`;
                }
            } catch (err) {
                if (statusEl) {
                    statusEl.style.color = 'var(--danger-red)';
                    statusEl.textContent = err?.reason || err?.message || 'Falha no envio.';
                }
            }
        });

        // Revelar Frase de Backup no Cofre
        document.getElementById('btn-reveal-seed')?.addEventListener('click', async () => {
            const box = document.getElementById('revealed-seed-box');
            try {
                const pass = document.getElementById('reveal-seed-pass')?.value || '';
                const phrase = await global.RdeskVault.revealMnemonicWithPassword(pass);
                if (box) {
                    box.style.display = 'block';
                    box.textContent = phrase;
                }
            } catch (err) {
                alert(err.message);
            }
        });

        // Piloto Automático & Escultor R$/min
        document.getElementById('btn-start-earning')?.addEventListener('click', runAutoPilotWorkflow);
        document.getElementById('btn-sereno-autopilot')?.addEventListener('click', runAutoPilotWorkflow);

        document.getElementById('yt-target-input')?.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            yieldTargetState.customTargetBrlPerMin = Number.isFinite(v) && v > 0 ? v : null;
            recomputeAutoPilotPlan();
        });
        document.getElementById('yt-clear-btn')?.addEventListener('click', () => {
            yieldTargetState.customTargetBrlPerMin = null;
            const inp = document.getElementById('yt-target-input');
            if (inp) inp.value = '';
            recomputeAutoPilotPlan();
        });

        // Range Manual Offline
        document.getElementById('btn-add-manual')?.addEventListener('click', () => {
            const min = parseFloat(document.getElementById('manual-min')?.value || '0');
            const max = parseFloat(document.getElementById('manual-max')?.value || '0');
            const tag = sanitizeLabel(document.getElementById('manual-tag')?.value) || `Simulação #${appState.manualPositions.length + 1}`;
            if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || min >= max) {
                alert('Informe faixa mínima menor que a máxima.');
                return;
            }
            const id = `man-${Date.now()}`;
            appState.manualPositions.push({ id, min, max, label: tag, source: 'manual' });
            appState.focusedId = id;
            saveAppState();
            renderAllPositions();
            updateFocusedMetrics();
        });

        // Inputs P&L
        ['pnl-init-brz', 'pnl-open-gas-pol'].forEach((id) => {
            document.getElementById(id)?.addEventListener('input', () => {
                if (appState.focusedId) {
                    appState.pnlOverrides[appState.focusedId] = {
                        initBrz: parseFloat(document.getElementById('pnl-init-brz')?.value) || 0,
                        openGasPol: parseFloat(document.getElementById('pnl-open-gas-pol')?.value) || 0.05,
                        autoChecked: true
                    };
                    saveAppState();
                }
                updateFocusedMetrics();
            });
        });

        // Swap Multi-Rede
        ['swap-from-chain', 'swap-to-chain', 'swap-token-in', 'swap-token-out', 'swap-amount-in'].forEach((id) => {
            document.getElementById(id)?.addEventListener('change', () => {
                updateSwapBalanceLabels();
                scheduleSwapQuote(120);
            });
            document.getElementById(id)?.addEventListener('input', () => scheduleSwapQuote(320));
        });

        document.getElementById('btn-swap-max')?.addEventListener('click', () => {
            const cid = Number(document.getElementById('swap-from-chain')?.value || 137);
            const sym = document.getElementById('swap-token-in')?.value || 'POL';
            const maxSpend = global.RdeskVault.getSpendableBalance(cid, sym);
            const inp = document.getElementById('swap-amount-in');
            if (inp) inp.value = maxSpend.toFixed(sym === 'WBTC' ? 6 : 4);
            scheduleSwapQuote(50);
        });

        document.getElementById('btn-flip-tokens')?.addEventListener('click', () => {
            const inSel = document.getElementById('swap-token-in');
            const outSel = document.getElementById('swap-token-out');
            const cIn = document.getElementById('swap-from-chain');
            const cOut = document.getElementById('swap-to-chain');
            if (inSel && outSel) {
                const tmp = inSel.value;
                inSel.value = outSel.value;
                outSel.value = tmp;
            }
            if (cIn && cOut) {
                const tmpC = cIn.value;
                cIn.value = cOut.value;
                cOut.value = tmpC;
            }
            updateSwapBalanceLabels();
            scheduleSwapQuote(50);
        });

        document.getElementById('btn-exec-swap')?.addEventListener('click', handleExecuteSwapClick);

        // Módulo PIX (Comprar & Sacar)
        ['pix-buy-brl', 'pix-buy-asset', 'pix-asset', 'pix-amount'].forEach((id) => {
            document.getElementById(id)?.addEventListener('input', renderPixModule);
            document.getElementById(id)?.addEventListener('change', renderPixModule);
        });

        document.getElementById('btn-filter-nokyc')?.addEventListener('click', (e) => {
            appState.onlyNoKycPix = !appState.onlyNoKycPix;
            e.target.textContent = appState.onlyNoKycPix ? 'FILTRO: 100% SEM KYC' : 'FILTRO: TODAS';
            saveAppState();
            renderPixModule();
        });

        // Controles do Ledger Histórico (Moeda BRL/USD & Re-escanear)
        document.getElementById('btn-ledger-currency')?.addEventListener('click', (e) => {
            const curr = global.RdeskLedger.getState().displayCurrency === 'BRL' ? 'USD' : 'BRL';
            global.RdeskLedger.setDisplayCurrency(curr);
            e.target.textContent = `MOEDA: ${curr}`;
        });

        document.getElementById('btn-rescan-history')?.addEventListener('click', () => {
            const addr = global.RdeskVault.getState().address;
            if (addr) global.RdeskLedger.runFullHistoryAudit(addr, 137);
        });

        // Timeframes do Gráfico
        document.querySelectorAll('.tf-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                document.querySelectorAll('.tf-btn').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                appState.activeTimeframe = btn.getAttribute('data-interval') || '15m';
                appState.activeSeconds = Number(btn.getAttribute('data-seconds')) || 900;
                saveAppState();
                await loadChartCandles(appState.activeTimeframe);
            });
        });

        // Subscreve atualizações do Cofre e do Livro-Razão
        let lastAuditedWallet = null;
        global.RdeskVault.subscribe(async (snap) => {
            syncUiWithVaultState(snap);
            if (snap.address && snap.address !== lastAuditedWallet) {
                lastAuditedWallet = snap.address;
                await scanWeb3Positions();
                global.RdeskLedger?.runFullHistoryAudit(snap.address, 137);
            }
        });

        global.RdeskLedger?.subscribe((ledgerSnap) => {
            syncLedgerUi(ledgerSnap);
        });

        // Inicialização dos motores em tempo real
        await global.RdeskVault.bootstrapVault();
        await initTradingViewChart();
        renderPixModule();
        buildVariationsPanel();
        refreshSniperModel15m();
        refreshPoolVolumeAndLiquidity();
        initGlobalTracker();
        initPolygonTapeScanner();

        setInterval(() => global.RdeskVault.refreshAllBalancesAndPrices(), 20000);
        setInterval(refreshLiveFeesAndMetrics, 14000);
        setInterval(refreshSniperModel15m, 25000);
        setInterval(refreshPoolVolumeAndLiquidity, 35000);
        setInterval(buildVariationsPanel, 60000);
    });
})(window);
