(() => {
  'use strict';

  const app = window.RdeskApp;
  const $ = (id) => document.getElementById(id);
  const { TOKENS, CONTRACTS } = app.constants;
  const BLOCKSCOUT_API = 'https://polygon.blockscout.com/api/v2/addresses';
  const TRANSFER_TOPIC = ethers.utils.id('Transfer(address,address,uint256)');
  const DEFI_ROUTERS = new Set(Object.values(CONTRACTS).map((a) => a.toLowerCase()));
  const WHITELIST = new Map(
    Object.values(TOKENS).filter((t) => t.address).map((t) => [t.address.toLowerCase(), t])
  );

  let patrimonyChart = null;
  const isHumanCounterparty = (node) => node && !node.is_contract && !node.is_verified;

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fetchBlockscoutLedger(address) {
    const base = `${BLOCKSCOUT_API}/${address}`;
    const [txs, tokens, internals] = await Promise.all([
      fetchJson(`${base}/transactions`),
      fetchJson(`${base}/token-transfers`),
      fetchJson(`${base}/internal-transactions`)
    ]);
    return {
      txs: txs.items || [],
      tokens: (tokens.items || []).filter((t) => !t.token?.is_spam && WHITELIST.has((t.token?.address || '').toLowerCase())),
      internals: internals.items || []
    };
  }

  async function fetchRpcFallbackTransfers(address) {
    const addrLower = address.toLowerCase();
    const padded = ethers.utils.hexZeroPad(address, 32);
    const tokenAddrs = Array.from(WHITELIST.keys());
    return app.oracle.callWithFailover(async (provider) => {
      const latest = await provider.getBlockNumber();
      const fromBlock = Math.max(0, latest - 120000);
      const [inLogs, outLogs] = await Promise.all([
        provider.getLogs({ address: tokenAddrs, fromBlock, toBlock: latest, topics: [TRANSFER_TOPIC, null, padded] }),
        provider.getLogs({ address: tokenAddrs, fromBlock, toBlock: latest, topics: [TRANSFER_TOPIC, padded, null] })
      ]);
      return [...inLogs, ...outLogs].map((log) => {
        const meta = WHITELIST.get(log.address.toLowerCase());
        const from = ethers.utils.getAddress(`0x${log.topics[1].slice(26)}`);
        const to = ethers.utils.getAddress(`0x${log.topics[2].slice(26)}`);
        return {
          tx_hash: log.transactionHash,
          timestamp: new Date().toISOString(),
          from: { hash: from, is_contract: DEFI_ROUTERS.has(from.toLowerCase()) },
          to: { hash: to, is_contract: DEFI_ROUTERS.has(to.toLowerCase()) },
          token: { address: log.address, symbol: meta.symbol, decimals: String(meta.decimals) },
          total: { value: ethers.BigNumber.from(log.data).toString(), decimals: String(meta.decimals) },
          dir: to.toLowerCase() === addrLower ? 'in' : 'out'
        };
      });
    });
  }

  async function fetchBcbPtaxMap(datesIso) {
    const unique = Array.from(new Set(datesIso.filter(Boolean))).sort();
    const fallback = Number(app.state.prices.usdBrl || 5.75);
    const map = new Map();
    if (!unique.length) return { map, fallback };
    const fmt = (iso) => { const [y, m, d] = iso.split('-'); return `${m}-${d}-${y}`; };
    try {
      const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@i,dataFinalCotacao=@f)?@i='${fmt(unique[0])}'&@f='${fmt(unique[unique.length - 1])}'&$format=json&$select=cotacaoVenda,dataHoraCotacao`;
      const data = await fetchJson(url);
      let last = fallback;
      for (const row of data.value || []) {
        last = Number(row.cotacaoVenda || last);
        map.set((row.dataHoraCotacao || '').slice(0, 10), last);
      }
      for (const d of unique) {
        if (!map.has(d)) {
          const prev = Array.from(map.keys()).filter((k) => k <= d).pop();
          map.set(d, prev ? map.get(prev) : last);
        }
      }
    } catch (_) {
      unique.forEach((d) => map.set(d, fallback));
    }
    return { map, fallback };
  }

  async function fetchHistoricalPolUsd() {
    const fallback = Number(app.state.prices.wpolUsd || 0.35);
    try {
      const data = await fetchJson(`https://coins.llama.fi/chart/polygon:${TOKENS.WPOL.address}?period=1d&span=180`);
      const prices = data?.coins?.[`polygon:${TOKENS.WPOL.address}`]?.prices || [];
      const map = new Map();
      for (const p of prices) map.set(new Date(p.timestamp * 1000).toISOString().slice(0, 10), Number(p.price));
      return { map, fallback };
    } catch (_) {
      return { map: new Map(), fallback };
    }
  }

  function renderChart(series) {
    const canvas = $('patrimonyChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (patrimonyChart) patrimonyChart.destroy();
    patrimonyChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: series.map((s) => s.date.slice(5)),
        datasets: [
          { label: 'Patrimônio (R$)', data: series.map((s) => s.equityBrl), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.14)', fill: true, tension: 0.25 },
          { label: 'Aporte Líquido EOA (R$)', data: series.map((s) => s.investedBrl), borderColor: '#94a3b8', borderDash: [5, 5], fill: false, tension: 0.1 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#f1f5f9', font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(36,50,77,0.35)' } },
          y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(36,50,77,0.35)' } }
        }
      }
    });
  }

  function renderLedger(events) {
    const list = $('auditLedgerList');
    if (!events.length) {
      const empty = document.createElement('p');
      empty.className = 'text-muted';
      empty.textContent = 'Nenhuma movimentação encontrada para esta carteira.';
      return list.replaceChildren(empty);
    }
    list.replaceChildren(...events.slice(-25).reverse().map((ev) => {
      const row = document.createElement('div');
      row.className = 'list-item';
      const left = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = `${ev.tag} • ${ev.symbol}`;
      const sub = document.createElement('div');
      sub.className = 'text-muted';
      sub.textContent = `${ev.date} • ${ev.amount.toFixed(4)} ${ev.symbol}`;
      left.append(title, sub);

      const right = document.createElement('strong');
      right.className = ev.isDeFi ? 'text-muted' : ev.signedBrl >= 0 ? 'text-ok' : 'text-warn';
      right.textContent = ev.isDeFi ? 'Neutro (DeFi)' : `${ev.signedBrl >= 0 ? '+' : ''}${app.ui.fmtBrl(ev.signedBrl)}`;
      row.append(left, right);
      return row;
    }));
  }

  async function runForensicAudit() {
    const active = app.getActiveWallet();
    if (!active) return app.ui.toast('Selecione uma carteira para auditar.', true);
    const addr = active.address.toLowerCase();
    $('auditStatus').textContent = 'Varrendo histórico desde a 1ª TX na Polygon...';

    try {
      let source = { txs: [], tokens: [], internals: [] };
      try {
        source = await fetchBlockscoutLedger(active.address);
      } catch (_) {
        source.tokens = await fetchRpcFallbackTransfers(active.address);
      }

      const rawEvents = [];
      let totalGasPol = 0;

      for (const tx of source.txs) {
        const date = (tx.timestamp || '').slice(0, 10);
        if ((tx.from?.hash || '').toLowerCase() === addr && tx.fee?.value) {
          totalGasPol += Number(ethers.utils.formatEther(tx.fee.value));
        }
        const valPol = Number(ethers.utils.formatEther(tx.value || '0'));
        if (valPol > 0) {
          const isIn = (tx.to?.hash || '').toLowerCase() === addr;
          const peer = isIn ? tx.from : tx.to;
          const isDeFi = !isHumanCounterparty(peer) || DEFI_ROUTERS.has((peer?.hash || '').toLowerCase());
          rawEvents.push({ date, symbol: 'POL', amount: valPol, isIn, isDeFi, tag: isDeFi ? 'Pool/Contrato' : isIn ? 'Depósito EOA' : 'Saque EOA' });
        }
      }

      for (const itx of source.internals) {
        const valPol = Number(ethers.utils.formatEther(itx.value || '0'));
        if (valPol > 0 && (itx.to?.hash || '').toLowerCase() === addr) {
          const isDeFi = !isHumanCounterparty(itx.from);
          rawEvents.push({ date: (itx.timestamp || '').slice(0, 10), symbol: 'POL', amount: valPol, isIn: true, isDeFi, tag: isDeFi ? 'Retorno DeFi' : 'Entrada Interna' });
        }
      }

      for (const tr of source.tokens) {
        const meta = WHITELIST.get((tr.token?.address || '').toLowerCase());
        if (!meta) continue;
        const amt = Number(ethers.utils.formatUnits(tr.total?.value || '0', meta.decimals));
        if (amt <= 0) continue;
        const isIn = (tr.to?.hash || '').toLowerCase() === addr;
        const peer = isIn ? tr.from : tr.to;
        const isDeFi = !isHumanCounterparty(peer) || DEFI_ROUTERS.has((peer?.hash || '').toLowerCase());
        rawEvents.push({ date: (tr.timestamp || '').slice(0, 10), symbol: meta.symbol, amount: amt, isIn, isDeFi, tag: isDeFi ? 'Liquidez/Swap DeFi' : isIn ? 'Aporte EOA' : 'Retirada EOA' });
      }

      rawEvents.sort((a, b) => a.date.localeCompare(b.date));
      const [ptaxData, polHist] = await Promise.all([
        fetchBcbPtaxMap(rawEvents.map((e) => e.date)),
        fetchHistoricalPolUsd()
      ]);

      let netInvestedBrl = 0;
      let runningEquityBrl = 0;
      const dailyMap = new Map();

      for (const ev of rawEvents) {
        const ptax = ptaxData.map.get(ev.date) || ptaxData.fallback;
        let usdUnit = 1;
        if (ev.symbol === 'POL' || ev.symbol === 'WPOL') usdUnit = polHist.map.get(ev.date) || polHist.fallback;
        else if (ev.symbol === 'BRZ' || ev.symbol === 'BRLA') usdUnit = 1 / ptax;

        const brlVal = ev.amount * usdUnit * ptax;
        ev.signedBrl = ev.isIn ? brlVal : -brlVal;
        if (!ev.isDeFi) {
          netInvestedBrl += ev.signedBrl;
          runningEquityBrl = Math.max(0, runningEquityBrl + ev.signedBrl);
        }
        dailyMap.set(ev.date, { date: ev.date, investedBrl: netInvestedBrl, equityBrl: runningEquityBrl });
      }

      const currentBrl = app.oracle.getPortfolioTotals().totalBrl;
      const gasSpentBrl = totalGasPol * Number(app.state.prices.wpolUsd || polHist.fallback) * Number(app.state.prices.usdBrl || ptaxData.fallback);
      const realizedPnlBrl = currentBrl - netInvestedBrl - gasSpentBrl;

      const today = new Date().toISOString().slice(0, 10);
      dailyMap.set(today, { date: today, investedBrl: netInvestedBrl, equityBrl: currentBrl });

      $('auditNetInvestedBrl').textContent = app.ui.fmtBrl(netInvestedBrl);
      $('auditCurrentValueBrl').textContent = app.ui.fmtBrl(currentBrl);
      $('auditGasSpentBrl').textContent = app.ui.fmtBrl(gasSpentBrl);
      const pnlEl = $('auditRealizedPnlBrl');
      pnlEl.textContent = `${realizedPnlBrl >= 0 ? '+' : ''}${app.ui.fmtBrl(realizedPnlBrl)}`;
      pnlEl.className = realizedPnlBrl >= 0 ? 'text-ok' : 'text-err';

      renderChart(Array.from(dailyMap.values()));
      renderLedger(rawEvents);
      $('auditStatus').textContent = `Auditoria concluída: ${rawEvents.length} eventos classificados (PTAX BCB + Blockscout v2).`;
    } catch (e) {
      $('auditStatus').textContent = 'Falha ao auditar histórico.';
      app.ui.toast(e.message, true);
    }
  }

  $('btnRunAudit').addEventListener('click', runForensicAudit);
  window.addEventListener('rdesk:stateChanged', (ev) => {
    if (ev.detail?.type === 'walletChanged') {
      $('auditStatus').textContent = 'Carteira alterada. Clique em "Auditar 1ª TX" para recalcular.';
    }
  });

  app.audit = { runForensicAudit };
})();
