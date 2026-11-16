(() => {
  'use strict';

  const app = window.RdeskApp;
  const $ = (id) => document.getElementById(id);
  const { TOKENS, CONTRACTS, ERC20_ABI } = app.constants;
  const FEE_TIER = 500;
  const TICK_SPACING = 10;

  const POOL_ABI = ['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)'];
  const WPOL_ABI = [...ERC20_ABI, 'function deposit() payable', 'function withdraw(uint256 wad)'];
  const NPM_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
    'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256, uint256, uint128 tokensOwed0, uint128 tokensOwed1)',
    'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
    'function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) payable returns (uint256 amount0, uint256 amount1)',
    'function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) payable returns (uint256 amount0, uint256 amount1)',
    'function burn(uint256 tokenId) payable',
    'function multicall(bytes[] data) payable returns (bytes[] results)'
  ];
  const ROUTER_ABI = [
    'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)'
  ];

  const tickToPrice = (tick) => Math.pow(1.0001, tick) * 1e12;
  const priceToTick = (price) => Math.floor(Math.log(Math.max(price, 1e-12) / 1e12) / Math.log(1.0001));
  const alignTick = (tick) => Math.round(tick / TICK_SPACING) * TICK_SPACING;
  const shortAddr = app.ui.shortAddr;

  let poolSlot0 = { sqrtPriceX96: ethers.BigNumber.from(0), tick: 0, spotUsd: 0 };
  let activePositions = [];

  async function syncSlot0() {
    const [sqrtPriceX96, tick] = await app.oracle.callWithFailover((p) =>
      new ethers.Contract(CONTRACTS.PoolWPOLUSDT0, POOL_ABI, p).slot0()
    );
    const spotUsd = tickToPrice(Number(tick)) || Number(app.state.prices.wpolUsd || 0);
    poolSlot0 = { sqrtPriceX96, tick: Number(tick), spotUsd };
    $('poolSpotPrice').textContent = spotUsd > 0 ? `WPOL $${spotUsd.toFixed(4)}` : 'WPOL --';
    updatePoolSummary();
    return poolSlot0;
  }

  function calcPoolPlan() {
    const usdTotal = Math.max(5, Number($('poolAmountUsd').value || 0));
    const pct = Number($('poolRangePct').value || 10) / 100;
    const spot = poolSlot0.spotUsd || Number(app.state.prices.wpolUsd || 0.35);
    const lowUsd = spot * (1 - pct);
    const highUsd = spot * (1 + pct);
    const tickLower = alignTick(priceToTick(lowUsd));
    const tickUpper = Math.max(tickLower + TICK_SPACING, alignTick(priceToTick(highUsd)));
    const wpolAmt = (usdTotal * 0.5) / spot;
    const usdtAmt = usdTotal * 0.5;
    return { usdTotal, pct, spot, lowUsd, highUsd, tickLower, tickUpper, wpolAmt, usdtAmt };
  }

  function updatePoolSummary() {
    const p = calcPoolPlan();
    const { usdBrl } = app.state.prices;
    $('poolCalcSummary').textContent = `Faixa: $${p.lowUsd.toFixed(4)} – $${p.highUsd.toFixed(4)} | Aporte: ${p.wpolAmt.toFixed(2)} WPOL + ${p.usdtAmt.toFixed(2)} USDT0 (~${app.ui.fmtBrl(p.usdTotal * usdBrl)})`;
  }

  async function ensureExactApproval(tokenAddr, owner, spender, exactAmount, signer) {
    if (exactAmount.lte(0)) return;
    const erc20 = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
    const current = await erc20.allowance(owner, spender);
    if (current.lt(exactAmount)) {
      if (current.gt(0)) await (await erc20.approve(spender, 0)).wait();
      await (await erc20.approve(spender, exactAmount)).wait();
    }
  }

  async function executeOpenPool(plan, signer) {
    const owner = await signer.getAddress();
    const npm = new ethers.Contract(CONTRACTS.NonfungiblePositionManager, NPM_ABI, signer);
    const wpolWei = ethers.utils.parseUnits(plan.wpolAmt.toFixed(6), 18);
    const usdtWei = ethers.utils.parseUnits(plan.usdtAmt.toFixed(6), 6);

    const wpolContract = new ethers.Contract(TOKENS.WPOL.address, WPOL_ABI, signer);
    const wpolBal = await wpolContract.balanceOf(owner);
    if (wpolBal.lt(wpolWei)) {
      const deficit = wpolWei.sub(wpolBal);
      app.oracle.validateGasShield(Number(ethers.utils.formatEther(deficit)), 0.08);
      await (await wpolContract.deposit({ value: deficit })).wait();
    }

    await ensureExactApproval(TOKENS.WPOL.address, owner, CONTRACTS.NonfungiblePositionManager, wpolWei, signer);
    await ensureExactApproval(TOKENS.USDT0.address, owner, CONTRACTS.NonfungiblePositionManager, usdtWei, signer);

    const tx = await npm.mint({
      token0: TOKENS.WPOL.address,
      token1: TOKENS.USDT0.address,
      fee: FEE_TIER,
      tickLower: plan.tickLower,
      tickUpper: plan.tickUpper,
      amount0Desired: wpolWei,
      amount1Desired: usdtWei,
      amount0Min: 0,
      amount1Min: 0,
      recipient: owner,
      deadline: Math.floor(Date.now() / 1000) + 900
    });
    await tx.wait();
    app.ui.toast('Pool Uniswap V3 aberta com sucesso!');
    await Promise.all([app.oracle.fetchBalances(), loadPositions()]);
  }

  async function showBreakEven() {
    const p = calcPoolPlan();
    const { usdBrl } = app.state.prices;
    const gasIn = await app.oracle.estimateGasCost(420000);
    const gasOut = await app.oracle.estimateGasCost(260000);
    const totalGasBrl = gasIn.gasBrl + gasOut.gasBrl;
    const estApr = p.pct <= 0.05 ? 0.65 : p.pct <= 0.10 ? 0.38 : 0.22;
    const dailyFeeBrl = (p.usdTotal * usdBrl * estApr) / 365;
    const days = dailyFeeBrl > 0 ? totalGasBrl / dailyFeeBrl : 0;
    const box = $('breakEvenBox');
    box.classList.remove('hidden');
    box.textContent = `Gás Ida+Volta: ${app.ui.fmtBrl(totalGasBrl)} | Rendimento est. (${Math.round(estApr * 100)}% APR): ${app.ui.fmtBrl(dailyFeeBrl)}/dia | Break-Even: ~${days.toFixed(1)} dias.`;
  }

  async function loadPositions() {
    const active = app.getActiveWallet();
    const list = $('positionsList');
    if (!active) return list.replaceChildren();
    try {
      const items = await app.oracle.callWithFailover(async (provider) => {
        const npm = new ethers.Contract(CONTRACTS.NonfungiblePositionManager, NPM_ABI, provider);
        const count = Number(await npm.balanceOf(active.address));
        const ids = await Promise.all(Array.from({ length: count }, (_, i) => npm.tokenOfOwnerByIndex(active.address, i)));
        return Promise.all(ids.map(async (id) => ({ id: id.toString(), ...(await npm.positions(id)) })));
      });
      activePositions = items.filter((p) => p.liquidity.gt(0) || p.tokensOwed0.gt(0) || p.tokensOwed1.gt(0));
      if (!activePositions.length) {
        const p = document.createElement('p');
        p.className = 'text-muted';
        p.textContent = 'Nenhuma posição NFT Uniswap V3 ativa.';
        return list.replaceChildren(p);
      }
      renderPositions();
    } catch (e) {
      app.ui.toast(e.message, true);
    }
  }

  function renderPositions() {
    const list = $('positionsList');
    list.replaceChildren(...activePositions.map((pos) => {
      const inRange = poolSlot0.tick >= pos.tickLower && poolSlot0.tick <= pos.tickUpper;
      const card = document.createElement('div');
      card.className = 'list-item';
      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = `NFT #${pos.id} • ${inRange ? 'Em Range' : 'Fora do Range'}`;
      const sub = document.createElement('div');
      sub.className = 'text-muted';
      sub.textContent = `Faixa: $${tickToPrice(pos.tickLower).toFixed(4)} – $${tickToPrice(pos.tickUpper).toFixed(4)}`;
      info.append(title, sub);

      const actions = document.createElement('div');
      actions.className = 'input-row';
      const mkBtn = (label, cls, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = `btn ${cls} btn-sm`; b.textContent = label;
        b.addEventListener('click', fn);
        return b;
      };
      actions.append(
        mkBtn('Colher', 'btn-outline', () => reviewCollectOrClose(pos, false)),
        mkBtn('Fechar', 'btn-danger', () => reviewCollectOrClose(pos, true))
      );
      card.append(info, actions);
      return card;
    }));
  }

  async function reviewCollectOrClose(pos, closeAll) {
    const gas = await app.oracle.estimateGasCost(closeAll ? 280000 : 140000);
    app.oracle.validateGasShield(0, gas.gasPol);
    app.ui.confirmTransaction({
      title: closeAll ? `Fechar Pool #${pos.id}` : `Colher Taxas #${pos.id}`,
      lines: [
        { label: 'Posição', value: `Uniswap V3 NFT #${pos.id}` },
        { label: 'Operação', value: closeAll ? 'Remover 100% Liquidez + Coletar + Queimar NFT' : 'Coletar Taxas Acumuladas' },
        { label: 'Taxa de Gás', value: `${app.ui.fmtBrl(gas.gasBrl)} (${gas.gasPol.toFixed(5)} POL)` },
        { label: 'Contrato', value: shortAddr(CONTRACTS.NonfungiblePositionManager), mono: true }
      ],
      onConfirm: async (signer) => {
        const owner = await signer.getAddress();
        const npm = new ethers.Contract(CONTRACTS.NonfungiblePositionManager, NPM_ABI, signer);
        const maxU128 = ethers.BigNumber.from('0xffffffffffffffffffffffffffffffff');
        if (!closeAll) {
          await (await npm.collect({ tokenId: pos.id, recipient: owner, amount0Max: maxU128, amount1Max: maxU128 })).wait();
        } else {
          const calls = [];
          if (pos.liquidity.gt(0)) {
            calls.push(npm.interface.encodeFunctionData('decreaseLiquidity', [{
              tokenId: pos.id, liquidity: pos.liquidity, amount0Min: 0, amount1Min: 0, deadline: Math.floor(Date.now() / 1000) + 900
            }]));
          }
          calls.push(npm.interface.encodeFunctionData('collect', [{ tokenId: pos.id, recipient: owner, amount0Max: maxU128, amount1Max: maxU128 }]));
          calls.push(npm.interface.encodeFunctionData('burn', [pos.id]));
          await (await npm.multicall(calls)).wait();
        }
        app.ui.toast(closeAll ? `Pool #${pos.id} encerrada!` : `Taxas da #${pos.id} colhidas!`);
        await Promise.all([app.oracle.fetchBalances(), loadPositions()]);
      }
    });
  }

  function renderPixComparator() {
    const brl = Math.max(0, Number($('pixBrlAmount').value || 0));
    const usdBrl = Number(app.state.prices.usdBrl || 5.75);
    const routes = [
      { name: 'PIX → BRZ / BRLA On-Chain + Swap 0,05%', spread: 0.0045, fixedBrl: 0.15 },
      { name: 'Exchange Local (Binance / Mercado Bitcoin)', spread: 0.0085, fixedBrl: 3.50 },
      { name: 'Cartão / Ramp Direto Internacional', spread: 0.0320, fixedBrl: 5.00 }
    ];
    $('pixComparisonBox').replaceChildren(...routes.map((r, idx) => {
      const netUsdt = Math.max(0, (brl - r.fixedBrl) / (usdBrl * (1 + r.spread)));
      const row = document.createElement('div');
      row.className = 'list-item';
      const left = document.createElement('div');
      const t = document.createElement('strong');
      t.textContent = r.name;
      const s = document.createElement('div');
      s.className = 'text-muted';
      s.textContent = `Spread ${(r.spread * 100).toFixed(2)}% + Taxa ${app.ui.fmtBrl(r.fixedBrl)}`;
      left.append(t, s);
      const right = document.createElement('strong');
      right.className = idx === 0 ? 'text-ok' : '';
      right.textContent = `${netUsdt.toFixed(2)} USDT0`;
      row.append(left, right);
      return row;
    }));
  }

  function updateSwapQuote() {
    const from = $('swapFromToken').value;
    const to = $('swapToToken').value;
    const amt = Number($('swapAmountIn').value || 0);
    if (from === to || amt <= 0) {
      $('swapQuoteOut').textContent = 'Cotação estimada: --';
      return 0;
    }
    const pFrom = app.oracle.getTokenPriceUsd(from);
    const pTo = app.oracle.getTokenPriceUsd(to);
    const estOut = pTo > 0 ? (amt * pFrom * 0.999) / pTo : 0;
    $('swapQuoteOut').textContent = `Cotação estimada: ~${estOut.toFixed(6)} ${to}`;
    return estOut;
  }

  async function reviewSwap() {
    try {
      const from = $('swapFromToken').value;
      const to = $('swapToToken').value;
      const amtStr = $('swapAmountIn').value.trim();
      const amt = Number(amtStr);
      if (from === to) throw new Error('Selecione tokens diferentes.');
      if (!amt || amt <= 0) throw new Error('Informe a quantidade.');
      const isWrapPair = (from === 'POL' && to === 'WPOL') || (from === 'WPOL' && to === 'POL');
      const gas = await app.oracle.estimateGasCost(isWrapPair ? 55000 : 210000);
      app.oracle.validateGasShield(from === 'POL' ? amt : 0, gas.gasPol);
      const estOut = updateSwapQuote();
      const usd = amt * app.oracle.getTokenPriceUsd(from);
      const brl = usd * Number(app.state.prices.usdBrl || 0);

      app.ui.confirmTransaction({
        title: `Swap ${from} → ${to}`,
        lines: [
          { label: 'Entrada', value: `${amtStr} ${from} (${app.ui.fmtBrl(brl)})` },
          { label: 'Saída Estimada', value: `~${estOut.toFixed(6)} ${to}` },
          { label: 'Taxa de Gás', value: `${app.ui.fmtBrl(gas.gasBrl)} (${gas.gasPol.toFixed(5)} POL)` },
          { label: 'Roteador', value: shortAddr(isWrapPair ? TOKENS.WPOL.address : CONTRACTS.SwapRouter02), mono: true }
        ],
        onConfirm: async (signer) => {
          const owner = await signer.getAddress();
          const tokIn = TOKENS[from];
          const tokOut = TOKENS[to];
          const amountInWei = ethers.utils.parseUnits(amtStr, tokIn.decimals);
          if (from === 'POL' && to === 'WPOL') {
            await (await new ethers.Contract(TOKENS.WPOL.address, WPOL_ABI, signer).deposit({ value: amountInWei })).wait();
          } else if (from === 'WPOL' && to === 'POL') {
            await (await new ethers.Contract(TOKENS.WPOL.address, WPOL_ABI, signer).withdraw(amountInWei)).wait();
          } else {
            const addrIn = from === 'POL' ? TOKENS.WPOL.address : tokIn.address;
            const addrOut = to === 'POL' ? TOKENS.WPOL.address : tokOut.address;
            if (from !== 'POL') {
              await ensureExactApproval(addrIn, owner, CONTRACTS.SwapRouter02, amountInWei, signer);
            }
            const router = new ethers.Contract(CONTRACTS.SwapRouter02, ROUTER_ABI, signer);
            await (await router.exactInputSingle({
              tokenIn: addrIn, tokenOut: addrOut, fee: FEE_TIER, recipient: owner,
              amountIn: amountInWei, amountOutMinimum: 0, sqrtPriceLimitX96: 0
            }, from === 'POL' ? { value: amountInWei } : {})).wait();
          }
          app.ui.toast(`Swap ${from} → ${to} concluído!`);
          app.oracle.fetchBalances().catch(() => {});
        }
      });
    } catch (e) { app.ui.toast(e.message, true); }
  }

  $('poolAmountUsd').addEventListener('input', updatePoolSummary);
  $('poolRangePct').addEventListener('change', updatePoolSummary);
  $('btnBreakEven').addEventListener('click', showBreakEven);
  $('btnReloadPools').addEventListener('click', () => Promise.all([syncSlot0(), loadPositions()]));
  $('btnOpenPool').addEventListener('click', async () => {
    try {
      const plan = calcPoolPlan();
      const gas = await app.oracle.estimateGasCost(420000);
      app.oracle.validateGasShield(0, gas.gasPol);
      const brl = plan.usdTotal * Number(app.state.prices.usdBrl || 0);
      app.ui.confirmTransaction({
        title: 'Abrir Pool Uniswap V3',
        lines: [
          { label: 'Par & Taxa', value: 'WPOL / USDT0 (0,05%)' },
          { label: 'Aporte Total', value: `${app.ui.fmtBrl(brl)} (${app.ui.fmtUsd(plan.usdTotal)})` },
          { label: 'Aprovação ERC-20', value: 'Valor Exato (Zero MaxUint256)' },
          { label: 'Taxa de Gás', value: `${app.ui.fmtBrl(gas.gasBrl)} (${gas.gasPol.toFixed(5)} POL)` },
          { label: 'Contrato', value: shortAddr(CONTRACTS.NonfungiblePositionManager), mono: true }
        ],
        onConfirm: (signer) => executeOpenPool(plan, signer)
      });
    } catch (e) { app.ui.toast(e.message, true); }
  });

  $('pixBrlAmount').addEventListener('input', renderPixComparator);
  ['swapFromToken', 'swapToToken', 'swapAmountIn'].forEach((id) => $(id).addEventListener('input', updateSwapQuote));
  $('btnSwapMax').addEventListener('click', () => {
    const sym = $('swapFromToken').value;
    const max = app.oracle.getMaxSpendable(sym);
    if (sym === 'POL' && max <= 0) return app.ui.toast('Bloqueado pelo Escudo de Gás (3,0 POL).', true);
    $('swapAmountIn').value = max.toFixed(6);
    updateSwapQuote();
  });
  $('btnExecuteSwap').addEventListener('click', reviewSwap);

  window.addEventListener('rdesk:stateChanged', (ev) => {
    renderPixComparator(); updatePoolSummary();
    if (ev.detail?.type === 'walletChanged') loadPositions();
  });

  syncSlot0().catch(() => {});
  renderPixComparator();
  loadPositions();
  app.defi = { syncSlot0, loadPositions, calcPoolPlan };
})();
