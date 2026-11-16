(() => {
  'use strict';

  const CHAIN_ID = 137;
  const CHAIN_HEX = '0x89';
  const GAS_SHIELD_POL = 3.0;
  const RPCS = [
    'https://polygon-bor-rpc.publicnode.com',
    'https://1rpc.io/matic',
    'https://polygon.drpc.org',
    'https://polygon-rpc.com'
  ];

  const TOKENS = {
    POL: { symbol: 'POL', name: 'Polygon Ecosystem Token', address: null, decimals: 18, isNative: true },
    WPOL: { symbol: 'WPOL', name: 'Wrapped POL', address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', decimals: 18 },
    USDT0: { symbol: 'USDT0', name: 'Tether USD0', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6, isStableUsd: true },
    USDC: { symbol: 'USDC', name: 'USD Coin', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6, isStableUsd: true },
    BRZ: { symbol: 'BRZ', name: 'Brazilian Digital Token', address: '0x4eD141110F6EeeAbA9A1df36d8c26f684d2475Dc', decimals: 18, isStableBrl: true },
    BRLA: { symbol: 'BRLA', name: 'BRLA Digital', address: '0xE6A537a407488807F0bbeb0038B79004f19DDDFb', decimals: 18, isStableBrl: true }
  };

  const CONTRACTS = {
    NonfungiblePositionManager: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    SwapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    PoolWPOLUSDT0: '0x9B08288C3Be4F62bbf8d1C20Ac9C5e6f9467d8B7'
  };

  const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)'
  ];

  const providerPool = RPCS.map((url) => new ethers.providers.StaticJsonRpcProvider(url, { chainId: CHAIN_ID, name: 'matic' }));
  let activeRpcIdx = 0;

  const withTimeout = (promise, ms = 7000) =>
    Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('RPC timeout')), ms))]);

  const getProvider = () => providerPool[activeRpcIdx];

  async function callWithFailover(fn) {
    const app = window.RdeskApp;
    for (let offset = 0; offset < RPCS.length; offset += 1) {
      const idx = (activeRpcIdx + offset) % RPCS.length;
      try {
        const res = await withTimeout(fn(providerPool[idx]), 7000);
        if (activeRpcIdx !== idx || !app.state.rpcOnline) {
          activeRpcIdx = idx;
          app.state.rpcUrl = RPCS[idx];
          app.state.rpcOnline = true;
          app.emit({ type: 'rpcChanged', online: true, rpcUrl: RPCS[idx] });
        }
        return res;
      } catch (_) {
        continue;
      }
    }
    app.state.rpcOnline = false;
    app.emit({ type: 'rpcChanged', online: false, rpcUrl: '' });
    throw new Error('Todos os nós RPC da Polygon estão indisponíveis no momento.');
  }

  async function fetchPrices() {
    const app = window.RdeskApp;
    const llamaKeys = [
      `polygon:${TOKENS.WPOL.address}`,
      `polygon:${TOKENS.BRZ.address}`,
      `polygon:${TOKENS.BRLA.address}`
    ].join(',');

    const [fxRes, llamaRes] = await Promise.allSettled([
      fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL').then((r) => r.json()),
      fetch(`https://coins.llama.fi/prices/current/${llamaKeys}`).then((r) => r.json())
    ]);

    if (fxRes.status === 'fulfilled' && fxRes.value?.USDBRL?.bid) {
      app.state.prices.usdBrl = Number(fxRes.value.USDBRL.bid) || app.state.prices.usdBrl;
    }
    if (llamaRes.status === 'fulfilled' && llamaRes.value?.coins) {
      const coins = llamaRes.value.coins;
      const wpol = coins[`polygon:${TOKENS.WPOL.address}`]?.price;
      const brz = coins[`polygon:${TOKENS.BRZ.address}`]?.price;
      const brla = coins[`polygon:${TOKENS.BRLA.address}`]?.price;
      if (wpol) app.state.prices.wpolUsd = Number(wpol);
      if (brz) app.state.prices.brzUsd = Number(brz);
      if (brla) app.state.prices.brlaUsd = Number(brla);
    }
    app.emit({ type: 'pricesUpdated', prices: { ...app.state.prices } });
    return app.state.prices;
  }

  function getTokenPriceUsd(symbol) {
    const { usdBrl, wpolUsd, brzUsd, brlaUsd } = window.RdeskApp.state.prices;
    if (symbol === 'USDT0' || symbol === 'USDC') return 1;
    if (symbol === 'POL' || symbol === 'WPOL') return Number(wpolUsd || 0);
    const brlFallback = usdBrl > 0 ? 1 / usdBrl : 0;
    if (symbol === 'BRZ') return Number(brzUsd || brlFallback);
    if (symbol === 'BRLA') return Number(brlaUsd || brlFallback);
    return 0;
  }

  async function fetchBalances(addressOverride) {
    const app = window.RdeskApp;
    const addr = addressOverride || app.getActiveWallet()?.address;
    if (!addr) return app.state.balances;

    const raw = await callWithFailover(async (provider) => {
      const erc20Symbols = ['WPOL', 'USDT0', 'USDC', 'BRZ', 'BRLA'];
      const [polWei, ...ercWeiList] = await Promise.all([
        provider.getBalance(addr),
        ...erc20Symbols.map((sym) => {
          const contract = new ethers.Contract(TOKENS[sym].address, ERC20_ABI, provider);
          return contract.balanceOf(addr);
        })
      ]);
      const out = { POL: ethers.utils.formatUnits(polWei, 18) };
      erc20Symbols.forEach((sym, i) => {
        out[sym] = ethers.utils.formatUnits(ercWeiList[i], TOKENS[sym].decimals);
      });
      return out;
    });

    app.state.balances = raw;
    app.emit({ type: 'balancesUpdated', balances: { ...raw } });
    return raw;
  }

  function getPortfolioTotals() {
    const { balances, prices } = window.RdeskApp.state;
    const usdBrl = Number(prices.usdBrl || 0);
    let totalUsd = 0;

    const items = Object.keys(TOKENS).map((sym) => {
      const bal = Number(balances[sym] || 0);
      const unitUsd = getTokenPriceUsd(sym);
      const usd = bal * unitUsd;
      const brl = usd * usdBrl;
      totalUsd += usd;
      return { symbol: sym, name: TOKENS[sym].name, balance: bal, usd, brl };
    });

    const polBalance = Number(balances.POL || 0);
    const spendablePol = Math.max(0, polBalance - GAS_SHIELD_POL);
    return {
      items,
      totalUsd,
      totalBrl: totalUsd * usdBrl,
      polBalance,
      spendablePol,
      shieldOk: polBalance >= GAS_SHIELD_POL
    };
  }

  function getMaxSpendable(symbol) {
    const bal = Number(window.RdeskApp.state.balances[symbol] || 0);
    return symbol === 'POL' ? Math.max(0, bal - GAS_SHIELD_POL) : Math.max(0, bal);
  }

  function validateGasShield(polAmountToSpend = 0, estimatedGasPol = 0.04) {
    const polBal = Number(window.RdeskApp.state.balances.POL || 0);
    const remaining = polBal - Number(polAmountToSpend || 0) - Number(estimatedGasPol || 0);
    if (remaining < GAS_SHIELD_POL) {
      throw new Error(
        `Escudo de Gás ativo: mantenha ao menos ${GAS_SHIELD_POL.toFixed(1)} POL livres (saldo atual: ${polBal.toFixed(4)} POL).`
      );
    }
    return true;
  }

  async function estimateGasCost(gasUnits = 160000) {
    const { usdBrl, wpolUsd } = window.RdeskApp.state.prices;
    let gasPriceWei = ethers.utils.parseUnits('35', 'gwei');
    try {
      const fetched = await callWithFailover((p) => p.getGasPrice());
      if (fetched && fetched.gt(0)) gasPriceWei = fetched;
    } catch (_) {}

    const gasPol = Number(ethers.utils.formatEther(gasPriceWei.mul(ethers.BigNumber.from(gasUnits))));
    const gasUsd = gasPol * Number(wpolUsd || 0);
    const gasBrl = gasUsd * Number(usdBrl || 0);
    return { gasPriceWei, gasPol, gasUsd, gasBrl };
  }

  function checkInjectedRabby() {
    const eth = window.ethereum;
    if (!eth) return null;
    if (eth.isRabby) return eth;
    if (Array.isArray(eth.providers)) {
      return eth.providers.find((p) => p && p.isRabby) || null;
    }
    return null;
  }

  function detectRabby() {
    const app = window.RdeskApp;
    const setFound = (provider) => {
      if (!provider || app.state.rabbyProvider === provider) return;
      app.state.rabbyProvider = provider;
      app.emit({ type: 'rabbyDetected', detected: true });
    };

    window.addEventListener('eip6963:announceProvider', (event) => {
      const detail = event?.detail;
      if (!detail?.provider) return;
      if (detail.info?.rdns === 'io.rabby' || /rabby/i.test(detail.info?.name || '')) {
        setFound(detail.provider);
      }
    });
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    const immediate = checkInjectedRabby();
    if (immediate) setFound(immediate);

    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      const found = checkInjectedRabby();
      if (found) {
        setFound(found);
        clearInterval(timer);
      } else if (polls >= 30) {
        clearInterval(timer);
      }
    }, 150);
  }

  async function connectRabby() {
    const app = window.RdeskApp;
    const provider = app.state.rabbyProvider || checkInjectedRabby();
    if (!provider) {
      throw new Error('Rabby Wallet não detectada. Abra no navegador com a extensão ou pelo app mobile Rabby.');
    }
    app.state.rabbyProvider = provider;
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!accounts?.length) throw new Error('Nenhuma conta autorizada na Rabby.');

    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
    } catch (err) {
      if (err?.code === 4902) {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: CHAIN_HEX,
            chainName: 'Polygon Mainnet',
            nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
            rpcUrls: [RPCS[0]],
            blockExplorerUrls: ['https://polygonscan.com']
          }]
        });
      }
    }
    return app.vault.addExternalWallet({ address: accounts[0], label: 'Rabby Wallet', type: 'rabby' });
  }

  async function refreshAll() {
    await fetchPrices();
    await fetchBalances();
  }

  detectRabby();

  window.RdeskApp = Object.assign(window.RdeskApp || {}, {
    constants: { CHAIN_ID, CHAIN_HEX, GAS_SHIELD_POL, RPCS, TOKENS, CONTRACTS, ERC20_ABI },
    oracle: {
      getProvider,
      callWithFailover,
      fetchPrices,
      fetchBalances,
      refreshAll,
      getTokenPriceUsd,
      getPortfolioTotals,
      getMaxSpendable,
      validateGasShield,
      estimateGasCost,
      detectRabby,
      connectRabby
    }
  });
})();
