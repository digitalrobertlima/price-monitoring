(() => {
  'use strict';

  const app = window.RdeskApp;
  const $ = (id) => document.getElementById(id);
  const fmtBrl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtUsd = (v) => Number(v || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const shortAddr = (a) => (a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '--');

  function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v);
    });
    kids.flat().forEach((k) => k != null && node.append(k));
    return node;
  }

  let toastTimer = null;
  function toast(msg, isErr = false) {
    const box = $('toast');
    if (!box) return;
    box.textContent = msg;
    box.style.borderColor = isErr ? 'var(--danger)' : 'var(--accent)';
    box.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.add('hidden'), 3600);
  }

  let draftSeed = '';
  let challengeIdx = [];
  let pendingBio = null;
  let receiptCtx = null;

  function renderHeader() {
    const badge = $('rpcBadge');
    badge.textContent = app.state.rpcOnline ? 'Polygon • Online' : 'Polygon • RPC';
    badge.classList.toggle('offline', !app.state.rpcOnline);
    const active = app.getActiveWallet();
    $('activeWalletLabel').textContent = active ? `${active.label} (${shortAddr(active.address)})` : 'Conectar / Criar';
    $('lockBanner').classList.toggle('hidden', !(active?.type === 'vault' && !app.vault.isUnlocked(active.id)));
  }

  function renderPortfolio() {
    const t = app.oracle.getPortfolioTotals();
    const { usdBrl } = app.state.prices;
    $('ptaxBadge').textContent = usdBrl > 0 ? `USD/BRL R$ ${usdBrl.toFixed(2)}` : 'USD/BRL --';
    $('totalBrl').textContent = fmtBrl(t.totalBrl);
    $('totalUsd').textContent = `${fmtUsd(t.totalUsd)} USD`;
    const pill = $('gasShieldPill');
    pill.textContent = t.shieldOk
      ? `🛡️ Escudo Ativo: ${t.polBalance.toFixed(2)} POL (Livre: ${t.spendablePol.toFixed(2)})`
      : `⚠️ Escudo Baixo: ${t.polBalance.toFixed(2)} / 3,00 POL`;
    pill.classList.toggle('low', !t.shieldOk);

    const list = $('tokenList');
    list.replaceChildren(...t.items.map((it) => {
      const dec = it.symbol === 'USDT0' || it.symbol === 'USDC' ? 2 : 4;
      const right = el('div', { style: 'text-align:right' }, el('strong', { text: fmtBrl(it.brl) }), el('div', { class: 'text-muted', text: fmtUsd(it.usd) }));
      return el('div', { class: 'list-item' }, el('div', {}, el('strong', { text: it.symbol }), el('div', { class: 'text-muted', text: `${it.balance.toFixed(dec)} ${it.symbol}` })), right);
    }));
  }

  function renderWalletsList() {
    const box = $('savedWalletsList');
    if (!app.state.wallets.length) {
      box.replaceChildren(el('p', { class: 'text-muted', text: 'Nenhuma carteira salva neste dispositivo.' }));
      return;
    }
    box.replaceChildren(...app.state.wallets.map((w) => {
      const info = el('div', {
        style: 'cursor:pointer',
        onClick: () => {
          app.setActiveWallet(w.id);
          $('walletModal').classList.add('hidden');
          app.oracle.fetchBalances(w.address).catch(() => {});
        }
      }, el('strong', { text: `${w.label}${w.id === app.state.activeWalletId ? ' ✓' : ''}` }), el('div', { class: 'mono text-muted', text: `${shortAddr(w.address)} • ${w.type.toUpperCase()}` }));

      const btns = [];
      if (w.type === 'vault' && w.hasSeed) {
        btns.push(el('button', {
          type: 'button', class: 'btn btn-outline btn-sm', text: '+ Conta',
          onClick: async () => {
            const pin = window.prompt('PIN do cofre para derivar próxima conta BIP-44:');
            if (!pin) return;
            try {
              const d = await app.vault.deriveNextAccount(w.id, pin);
              toast(`Conta ${d.label} criada!`);
              app.oracle.fetchBalances(d.address).catch(() => {});
            } catch (e) { toast(e.message, true); }
          }
        }));
      }
      btns.push(el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Remover', onClick: () => app.vault.removeWallet(w.id) }));
      return el('div', { class: 'list-item' }, info, el('div', { class: 'input-row' }, btns));
    }));
  }

  function drawQrMatrix(address) {
    const c = $('qrCanvas');
    const ctx = c.getContext('2d');
    const n = 25;
    const s = Math.floor(c.width / n);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    const finder = (ox, oy) => {
      ctx.fillStyle = '#090d16'; ctx.fillRect(ox * s, oy * s, 7 * s, 7 * s);
      ctx.fillStyle = '#fff'; ctx.fillRect((ox + 1) * s, (oy + 1) * s, 5 * s, 5 * s);
      ctx.fillStyle = '#090d16'; ctx.fillRect((ox + 2) * s, (oy + 2) * s, 3 * s, 3 * s);
    };
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
    const bytes = ethers.utils.toUtf8Bytes(`ethereum:${address}@137`);
    for (let y = 0, idx = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        if ((x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8)) continue;
        if (((bytes[idx % bytes.length] >> (idx % 8)) ^ ((x * 7 + y * 13) & 1)) & 1) ctx.fillRect(x * s, y * s, s, s);
        idx += 1;
      }
    }
  }

  function resetSlider() {
    $('sliderTrack').classList.remove('unlocked');
    $('sliderThumb').style.left = '4px';
    $('sliderProgress').style.width = '0px';
    $('sliderText').textContent = 'Arraste para Confirmar →';
  }

  function confirmTransaction({ title, lines, onConfirm }) {
    const active = app.getActiveWallet();
    if (!active) return toast('Selecione ou crie uma carteira primeiro.', true);
    if (active.type === 'watch') return toast('Carteira Watch-Only não assina transações.', true);

    receiptCtx = { onConfirm, bioOk: false, busy: false };
    $('receiptTitle').textContent = title || 'Recibo Humano de Assinatura';
    $('receiptLines').replaceChildren(...lines.map((l) =>
      el('div', { class: 'receipt-line' }, el('span', { class: 'text-muted', text: l.label }), el('strong', { class: l.mono ? 'mono' : '', text: l.value }))
    ));
    const isVault = active.type === 'vault';
    $('receiptAuthBox').classList.toggle('hidden', !isVault);
    $('receiptPinInput').value = '';
    const bioBtn = $('btnReceiptBio');
    bioBtn.classList.toggle('hidden', !(isVault && active.bioCredId));
    bioBtn.textContent = 'Biometria';
    resetSlider();
    $('receiptModal').classList.remove('hidden');
  }

  function bindSlider() {
    const track = $('sliderTrack');
    const thumb = $('sliderThumb');
    let drag = false;
    let startX = 0;

    thumb.addEventListener('pointerdown', (e) => {
      if (!receiptCtx || receiptCtx.busy) return;
      drag = true;
      startX = e.clientX - thumb.offsetLeft;
      thumb.setPointerCapture(e.pointerId);
    });
    thumb.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const max = track.clientWidth - thumb.offsetWidth - 4;
      const left = Math.max(4, Math.min(max, e.clientX - startX));
      thumb.style.left = `${left}px`;
      $('sliderProgress').style.width = `${left + thumb.offsetWidth / 2}px`;
    });
    const finish = async () => {
      if (!drag) return;
      drag = false;
      const max = track.clientWidth - thumb.offsetWidth - 4;
      if (thumb.offsetLeft < max * 0.88) return resetSlider();
      thumb.style.left = `${max}px`;
      $('sliderProgress').style.width = '100%';
      track.classList.add('unlocked');
      $('sliderText').textContent = 'Autenticando e Assinando...';
      receiptCtx.busy = true;
      try {
        const auth = receiptCtx.bioOk ? { useBio: true } : { pin: $('receiptPinInput').value.trim() };
        const signer = await app.getSigner(app.oracle.getProvider(), auth);
        await receiptCtx.onConfirm(signer);
        $('receiptModal').classList.add('hidden');
        receiptCtx = null;
      } catch (err) {
        receiptCtx.busy = false;
        resetSlider();
        toast(err.reason || err.message || 'Falha na assinatura.', true);
      }
    };
    thumb.addEventListener('pointerup', finish);
    thumb.addEventListener('pointercancel', finish);
  }

  function bindEvents() {
    document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll('.tab-view').forEach((v) => v.classList.toggle('active', v.id === `tab-${b.dataset.tab}`));
    }));

    document.querySelectorAll('.vault-mode-btn').forEach((b) => b.addEventListener('click', () => {
      ['create', 'import', 'rabby', 'watch'].forEach((m) => $(`vaultMode${m[0].toUpperCase()}${m.slice(1)}`).classList.toggle('hidden', m !== b.dataset.mode));
      if (b.dataset.mode === 'rabby') $('rabbyStatus').textContent = app.state.rabbyProvider ? '✅ Rabby Wallet detectada.' : '⚠️ Rabby não detectada.';
    }));

    [['btnCloseWalletModal', 'walletModal'], ['btnCloseReceiveModal', 'receiveModal'], ['btnCloseSendModal', 'sendModal'], ['btnCloseReceiptModal', 'receiptModal']]
      .forEach(([btn, mod]) => $(btn).addEventListener('click', () => { $(mod).classList.add('hidden'); if (mod === 'receiptModal') receiptCtx = null; }));

    $('walletSelectorBtn').addEventListener('click', () => { renderWalletsList(); $('walletModal').classList.remove('hidden'); });
    $('unlockBannerBtn').addEventListener('click', () => confirmTransaction({
      title: 'Desbloquear Cofre', lines: [{ label: 'Ação', value: 'Liberar sessão de assinatura' }], onConfirm: async () => toast('Cofre desbloqueado!')
    }));
    $('btnRefreshBalances').addEventListener('click', () => app.oracle.refreshAll().then(() => toast('Atualizado!')).catch((e) => toast(e.message, true)));

    $('btnGenSeed').addEventListener('click', () => {
      draftSeed = app.vault.generateMnemonic($('seedWordCount').value);
      challengeIdx = app.vault.createBackupChallenge(draftSeed);
      pendingBio = null;
      $('seedGrid').replaceChildren(...draftSeed.split(' ').map((w, i) => el('div', { class: 'seed-cell', text: `${i + 1}. ${w}` })));
      $('challengeBoxes').replaceChildren(...challengeIdx.map((idx) =>
        el('div', { class: 'challenge-box' }, el('label', { text: `Palavra #${idx + 1}` }), el('input', { type: 'text', class: 'input challenge-input', autocomplete: 'off' }))
      ));
      $('seedDisplayBox').classList.remove('hidden');
    });

    $('btnCopySeed').addEventListener('click', () => draftSeed && app.vault.copySensitive(draftSeed).then(() => toast('Frase copiada! Clipboard limpa em 45s.')));
    $('btnEnableBio').addEventListener('click', async () => {
      pendingBio = await app.vault.enrollBiometric();
      toast(pendingBio ? 'Biometria vinculada!' : 'Biometria indisponível. Use PIN.', !pendingBio);
    });

    $('btnConfirmNewWallet').addEventListener('click', async () => {
      const ans = Array.from(document.querySelectorAll('.challenge-input')).map((i) => i.value);
      if (!app.vault.verifyBackupChallenge(draftSeed, challengeIdx, ans)) return toast('Palavras de backup incorretas.', true);
      try {
        await app.vault.saveVaultWallet({ secret: draftSeed, pin: $('newWalletPin').value, label: 'Cofre #0', accountIndex: 0, bioData: pendingBio });
        draftSeed = ''; $('seedDisplayBox').classList.add('hidden'); $('walletModal').classList.add('hidden');
        toast('Carteira criada com sucesso!'); app.oracle.refreshAll().catch(() => {});
      } catch (e) { toast(e.message, true); }
    });

    $('btnImportWallet').addEventListener('click', async () => {
      try {
        await app.vault.saveVaultWallet({ secret: $('importSecretInput').value, pin: $('importPinInput').value, label: 'Cofre Importado' });
        $('importSecretInput').value = ''; $('importPinInput').value = ''; $('walletModal').classList.add('hidden');
        toast('Carteira importada!'); app.oracle.refreshAll().catch(() => {});
      } catch (e) { toast(e.message, true); }
    });

    $('btnConnectRabby').addEventListener('click', () => app.oracle.connectRabby().then(() => { $('walletModal').classList.add('hidden'); toast('Rabby conectada!'); app.oracle.refreshAll().catch(() => {}); }).catch((e) => toast(e.message, true)));
    $('btnAddWatchWallet').addEventListener('click', () => {
      try {
        app.vault.addExternalWallet({ address: $('watchAddressInput').value.trim(), label: $('watchLabelInput').value.trim() || 'Watch-Only', type: 'watch' });
        $('walletModal').classList.add('hidden'); toast('Watch-Only adicionada!'); app.oracle.refreshAll().catch(() => {});
      } catch (e) { toast(e.message, true); }
    });

    $('btnOpenReceive').addEventListener('click', () => {
      const a = app.getActiveWallet();
      if (!a) return toast('Selecione uma carteira.', true);
      $('receiveAddressText').textContent = a.address; drawQrMatrix(a.address); $('receiveModal').classList.remove('hidden');
    });
    $('btnCopyAddress').addEventListener('click', () => { const a = app.getActiveWallet(); if (a) navigator.clipboard?.writeText(a.address).then(() => toast('Endereço copiado!')); });

    const syncSendShield = () => {
      const t = app.oracle.getPortfolioTotals();
      const isPol = $('sendTokenSelect').value === 'POL';
      $('btnSendMax').disabled = isPol && !t.shieldOk;
      $('sendShieldWarning').textContent = isPol && !t.shieldOk ? 'Escudo ativo: saldo POL abaixo de 3,00 POL.' : '';
    };
    $('btnOpenSend').addEventListener('click', () => { syncSendShield(); $('sendModal').classList.remove('hidden'); });
    $('sendTokenSelect').addEventListener('change', syncSendShield);
    $('btnSendMax').addEventListener('click', () => {
      const sym = $('sendTokenSelect').value;
      const max = app.oracle.getMaxSpendable(sym);
      if (sym === 'POL' && max <= 0) return toast('Bloqueado pelo Escudo de Gás (3,0 POL).', true);
      $('sendAmountInput').value = max.toFixed(6);
    });

    $('btnReviewSend').addEventListener('click', async () => {
      try {
        const sym = $('sendTokenSelect').value;
        const to = $('sendToInput').value.trim();
        const amt = $('sendAmountInput').value.trim();
        if (!ethers.utils.isAddress(to)) throw new Error('Endereço destino inválido.');
        if (!amt || Number(amt) <= 0) throw new Error('Informe um valor válido.');
        const tok = app.constants.TOKENS[sym];
        const gas = await app.oracle.estimateGasCost(tok.isNative ? 21000 : 65000);
        app.oracle.validateGasShield(tok.isNative ? Number(amt) : 0, gas.gasPol);
        const usd = Number(amt) * app.oracle.getTokenPriceUsd(sym);
        const brl = usd * Number(app.state.prices.usdBrl || 0);

        $('sendModal').classList.add('hidden');
        confirmTransaction({
          title: `Enviar ${sym}`,
          lines: [
            { label: 'Ação', value: `Transferir ${amt} ${sym}` },
            { label: 'Valor', value: `${fmtBrl(brl)} (${fmtUsd(usd)})` },
            { label: 'Taxa de Gás', value: `${fmtBrl(gas.gasBrl)} (${gas.gasPol.toFixed(5)} POL)` },
            { label: 'Destino', value: shortAddr(to), mono: true }
          ],
          onConfirm: async (signer) => {
            const val = ethers.utils.parseUnits(amt, tok.decimals);
            const tx = tok.isNative
              ? await signer.sendTransaction({ to, value: val })
              : await new ethers.Contract(tok.address, ['function transfer(address,uint256) returns (bool)'], signer).transfer(to, val);
            toast('Enviando transação...'); await tx.wait(); toast(`${amt} ${sym} enviado!`);
            app.oracle.fetchBalances().catch(() => {});
          }
        });
      } catch (e) { toast(e.message, true); }
    });

    $('btnReceiptBio').addEventListener('click', async () => {
      const a = app.getActiveWallet();
      if (!a?.bioCredId) return;
      try {
        await app.vault.unlockWallet(a.id, { useBio: true });
        if (receiptCtx) receiptCtx.bioOk = true;
        $('btnReceiptBio').textContent = '✓ Biometria OK';
        toast('Biometria validada!');
      } catch (e) { toast(e.message, true); }
    });
  }

  window.addEventListener('rdesk:stateChanged', (ev) => {
    renderHeader(); renderPortfolio();
    if (!$('walletModal').classList.contains('hidden')) renderWalletsList();
    if (ev.detail?.type === 'clipboardCleared') toast('Clipboard limpo automaticamente.');
  });

  bindSlider(); bindEvents(); renderHeader(); renderPortfolio();
  app.oracle.refreshAll().catch(() => {});
  app.ui = { toast, fmtBrl, fmtUsd, shortAddr, confirmTransaction };
})();
