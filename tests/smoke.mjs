// Teste com rede REAL (roda no GitHub Actions ou localmente com internet):
// a página abre sem erros, lê o saldo de um endereço e o preço da pool direto da Polygon.
import { startStaticServer, launch, check, finish, waitFn } from './helpers.mjs';

const TARGET_URL = process.env.TARGET_URL || null; // ex.: URL do GitHub Pages
const WATCH_ADDRESS = process.env.WATCH_ADDRESS || '0x2833a1C3dDe3B5d2265F057301a89bEf1BB50fe3';
const RPCS = ['https://polygon-bor-rpc.publicnode.com', 'https://1rpc.io/matic', 'https://polygon.drpc.org'];

async function rpc(method, params) {
    for (const url of RPCS) {
        try {
            const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
            const json = await res.json();
            if (json.result !== undefined) return json.result;
        } catch (e) {}
    }
    throw new Error(`RPC indisponível para ${method}`);
}

const local = TARGET_URL ? null : await startStaticServer(8765);
const url = TARGET_URL || local.url;
console.log(`Alvo: ${url}\n`);
const browser = await launch();
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const pageErrors = [], csp = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text().slice(0, 200)); });
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await waitFn(page, () => window.ethers && window.RdeskWallet && window.RdeskDefi && window.RdeskRangeChart, null, { timeout: 60000 });
    check('página e bibliotecas carregadas', true);

    // Primeira abertura no site publicado: passa pelas boas-vindas como uma pessoa faria
    await page.waitForSelector('#learn-stage', { timeout: 15000 });
    check('primeira abertura: a Duda e o Bit aparecem (personagens desenhados)', (await page.locator('#learn-stage .av-duda .av-layer').count()) === 4 && (await page.locator('#learn-stage .av-bit .av-layer').count()) === 4);
    await page.click('#ls-next');
    await page.click('#ls-close'); // "pular por enquanto"
    check('boas-vindas da Duda saem do caminho quando a pessoa pula', (await page.locator('#learn-stage').count()) === 0);
    const ver = await page.evaluate(async () => [window.RdeskUpdater?.current, await window.RdeskUpdater?.check()]);
    check('atualização forçada: o app sabe a própria versão e confere a do servidor', Boolean(ver[0]) && ver[0] === ver[1], JSON.stringify(ver));

    await page.click('#btn-wallet-trigger');
    if (await page.locator('.more-opts:not([open]) > summary').count()) await page.click('.more-opts > summary');
    await page.locator('#rdesk-mw-sheet .rmw-opt-btn', { hasText: 'observação' }).click();
    await page.fill('#rmw-f-watch-input', WATCH_ADDRESS);
    if (await page.locator('#rmw-f-name').count()) await page.fill('#rmw-f-name', 'Observação');
    await page.click('#rmw-f-submit');
    await waitFn(page, () => window.RdeskWallet.isConnected(), null, { timeout: 30000 });
    await page.evaluate(async () => { window.RdeskWallet.closeModal(); await window.RdeskWallet.refreshBalances(); });

    const appPol = await page.evaluate(() => window.RdeskWallet.getBalances().find((b) => b.chainId === 137 && b.symbol === 'POL')?.amount);
    const chainPol = Number(BigInt(await rpc('eth_getBalance', [WATCH_ADDRESS, 'latest']))) / 1e18;
    check('saldo de POL lido pela app bate com a Polygon', typeof appPol === 'number' && Math.abs(appPol - chainPol) < 1e-6, `app=${appPol} rede=${chainPol}`);

    const prices = await page.evaluate(() => window.RdeskWallet.getPrices());
    check('cotações ao vivo (POL em USD e dólar em R$)', prices.POL > 0.001 && prices.POL < 100 && prices.USD_BRL > 2 && prices.USD_BRL < 20, `POL=$${prices.POL} USD/BRL=${prices.USD_BRL}`);

    await page.click('.nav-tab-btn[data-tab="earn"]');
    await waitFn(page, () => window.RdeskDefi.getState().poolPrice > 0, null, { timeout: 45000 });
    const st = await page.evaluate(() => window.RdeskDefi.getState());
    check('preço da pool Uniswap coerente com o mercado (±5%)', Math.abs(st.poolPrice - prices.POL) / prices.POL < 0.05, `pool=$${st.poolPrice.toFixed(5)} mercado=$${prices.POL}`);
    check('faixa Sniper em volta do preço real', st.sniper.min < st.poolPrice && st.poolPrice < st.sniper.max, `$${st.sniper.min.toFixed(4)} – $${st.sniper.max.toFixed(4)}`);
    const label = await page.getAttribute('#earn-chart-container canvas', 'aria-label');
    check('gráfico com velas reais e faixa Sniper', /Sua faixa/.test(label || '') && (await page.evaluate(() => document.querySelector('#earn-chart-container canvas').width)) > 0, label);
    console.log(`Posições Uniswap V3 do endereço: ${st.positions.length}`);

    // ---- cotações: dólar e POL vindos de fonte ao vivo (não o valor de reserva) ----
    const live = await page.evaluate(() => window.RdeskWallet.getPrices());
    check('dólar em R$ veio de fonte ao vivo (não o valor de reserva)', live.usdBrlLive === true && live.live === true, `usdBrlLive=${live.usdBrlLive} live=${live.live} USD/BRL=${live.USD_BRL}`);
    check('preços de ETH e BTC carregados', live.ETH > 100 && live.BTC > 1000, `ETH=$${live.ETH} BTC=$${live.BTC}`);

    // ---- contratos: cada moeda da lista confere com o que a própria rede responde ----
    const audit = await page.evaluate(async () => {
        const REG = window.RdeskRegistry; const out = [];
        for (const chain of REG.CHAINS) {
            let provider;
            try { provider = await window.RdeskWallet.getHealthyProvider(chain.id); } catch (e) { out.push({ chain: chain.name, unreachable: String(e.message).slice(0, 80) }); continue; }
            for (const tk of (REG.BUILTIN_TOKENS[chain.id] || []).filter((x) => x.address)) {
                let lastErr = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        const info = await REG.inspectTokenContract(chain.id, tk.address, provider);
                        out.push({ chain: chain.name, symbol: tk.symbol, onchain: info.symbol, decOk: info.decimals === tk.decimals, dec: `${tk.decimals}/${info.decimals}` });
                        lastErr = null; break;
                    } catch (e) { lastErr = String(e.message).slice(0, 100); await new Promise((r) => setTimeout(r, 1200)); }
                }
                if (lastErr) out.push({ chain: chain.name, symbol: tk.symbol, error: lastErr });
            }
        }
        return out;
    });
    const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const alias = { USDT: ['USDT', 'USDT0', 'USD₮', 'USD₮0', 'USD0', 'USD'], USDC: ['USDC'], WETH: ['WETH'], WBTC: ['WBTC'], WPOL: ['WPOL', 'WMATIC'], BRZ: ['BRZ'], BRLA: ['BRLA'], CBBTC: ['CBBTC'] };
    const bad = audit.filter((a) => a.error || (a.symbol && (!a.decOk || !(alias[norm(a.symbol)] || [norm(a.symbol)]).map(norm).includes(norm(a.onchain)))));
    const verified = audit.filter((a) => a.symbol && !a.error);
    console.log('   contratos:', audit.map((a) => a.unreachable ? `${a.chain}: SEM RPC (${a.unreachable})` : `${a.symbol}@${a.chain}=${a.onchain || a.error}(${a.dec || '-'})`).join(' | '));
    check('contratos das moedas conferem com símbolo e casas decimais lidos na rede', bad.length === 0 && verified.length >= 15, `${verified.length} conferidos; problemas: ${JSON.stringify(bad)}`);
    check('todas as 8 redes responderam', audit.every((a) => !a.unreachable), audit.filter((a) => a.unreachable).map((a) => a.chain).join(','));

    // ---- Bitcoin: API pública responde ----
    const btcNet = await page.evaluate(async () => {
        try {
            const fees = await window.RdeskBitcoin.fetchFeeRates();
            const bal = await window.RdeskBitcoin.fetchBalance('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
            return { fees, bal };
        } catch (e) { return { error: String(e.message) }; }
    });
    check('rede Bitcoin: taxas e saldo consultados', !btcNet.error && btcNet.fees && Number(btcNet.fees.normal) > 0 && btcNet.bal && typeof btcNet.bal.totalSats === 'number', JSON.stringify(btcNet).slice(0, 200));

    // ---- Histórico real desde a 1ª transação: extrato, resultado e gráfico ----
    await waitFn(page, () => window.RdeskHistory && !window.RdeskHistory.getState().loading && (window.RdeskHistory.getState().events > 0 || window.RdeskHistory.getState().error), null, { timeout: 90000 }).catch(() => {});
    const hs = await page.evaluate(() => ({ st: window.RdeskHistory.getState(), r: window.RdeskHistory.getResult(), ev: window.RdeskHistory.getEvents() }));
    const ins = hs.ev.filter((e) => e.cls === 'IN').length, outs = hs.ev.filter((e) => e.cls === 'OUT').length;
    console.log(`   histórico: ${hs.st.events} transações, ${ins} entradas, ${outs} saídas; colocou ${hs.r.inBrl.toFixed(2)} BRL, tirou ${hs.r.outBrl.toFixed(2)}, tem ${hs.r.eqBrl.toFixed(2)}, resultado ${hs.r.pnlBrl.toFixed(2)} BRL / ${hs.r.pnlRef} ${hs.st.ref}`);
    check('histórico real lido desde a 1ª transação, com entradas reconhecidas', hs.st.events > 10 && ins > 0 && hs.r.inBrl > 0 && !hs.st.error, `${hs.st.events} transações, ${ins} entradas ${hs.st.error || ''}`);
    const maxBrl = await page.evaluate(() => { const fx = window.RdeskWallet.getPrices().USD_BRL; return Math.max(...window.RdeskHistory.getSeries().map((p) => p.usd * fx)); });
    console.log(`   maior patrimônio no gráfico: R$ ${maxBrl.toFixed(2)}`);
    console.log('   pico:', await page.evaluate(() => { const s = window.RdeskHistory.getSeries(); const m = s.reduce((b, p) => (p.usd > b.usd ? p : b), s[0] || {}); const i = s.indexOf(m); return JSON.stringify(s.slice(Math.max(0, i - 1), i + 2)).slice(0, 3000); }));
    const chartNote = await page.evaluate(() => document.getElementById('home-chart-status')?.textContent || '');
    console.log(`   saldos diários conferidos na rede: ${hs.st.nativeDays}, sem conferência: ${hs.st.nativeMissing}, incompleto: ${hs.st.incomplete}, cortados: ${hs.st.capped}, recibos: ${hs.st.receipts}`);
    // Se algum servidor de arquivo falhar, o gráfico pode estimar alto — mas então TEM que avisar na tela
    check('patrimônio do gráfico nunca passa muito do que realmente entrou (ou avisa que é estimativa)',
        maxBrl <= hs.r.inBrl * 1.3 || (hs.st.nativeMissing > 0 && /estimativa/.test(chartNote)) || (hs.st.incomplete && /pode estar errado/.test(chartNote)),
        `máximo R$ ${maxBrl.toFixed(2)} vs entradas R$ ${hs.r.inBrl.toFixed(2)}; faltaram ${hs.st.nativeMissing} dias; aviso: ${chartNote}`);
    check('gráfico do patrimônio desenhado com o histórico real', hs.st.chart.points > 2 && hs.st.chart.last > 0, JSON.stringify(hs.st.chart));
    await page.click('.nav-tab-btn[data-tab="audit"]');
    await page.waitForSelector('.extrato-row', { timeout: 20000 }).catch(() => {});
    check('extrato mostra as transações', (await page.locator('.extrato-row').count()) > 5);
    await page.click('.nav-tab-btn[data-tab="wallet"]');

    // ---- Trocas: cotações reais (somente leitura, nada é assinado) ----
    await page.click('.nav-tab-btn[data-tab="pixswap"]');
    await waitFn(page, () => document.querySelectorAll('#swap-from-token option').length > 0, null, { timeout: 20000 });
    const quote = async (fromChain, from, toChain, to, amount) => {
        await page.selectOption('#swap-from-chain', String(fromChain));
        await page.selectOption('#swap-to-chain', String(toChain)).catch(() => {});
        await page.selectOption('#swap-from-token', from);
        await page.selectOption('#swap-to-token', to);
        await page.fill('#swap-amount-in', '');
        await page.waitForTimeout(300);
        await page.fill('#swap-amount-in', String(amount));
        await page.waitForTimeout(700); // a cotação começa 350 ms depois de digitar
        await waitFn(page, () => {
            const info = document.getElementById('swap-quote-info').textContent;
            const out = document.getElementById('swap-amount-out').value;
            if (/Buscando|Consultando/.test(info) || out === '…') return false;
            return parseFloat(out) > 0 || /Não há|Sem liquidez|indispon|rro|não encontr/i.test(info);
        }, null, { timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(500);
        return { out: parseFloat((await page.inputValue('#swap-amount-out')).replace(',', '.')), info: (await page.textContent('#swap-quote-info')).replace(/\s+/g, ' ').trim() };
    };
    // Diagnóstico: quanto tempo a consulta agrupada leva na rede real
    const diag = await page.evaluate(async () => {
        const provider = await window.RdeskWallet.getHealthyProvider(137);
        const iface = new ethers.utils.Interface(['function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160, uint32, uint256)']);
        const mc = new ethers.Contract('0xcA11bde05977b3631167028862bE2a173976CA11', ['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)'], provider);
        const WPOL = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
        const calls = [100, 500, 3000, 10000].map((fee) => ({ target: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e', allowFailure: true,
            callData: iface.encodeFunctionData('quoteExactInputSingle', [{ tokenIn: WPOL, tokenOut: USDT, amountIn: ethers.utils.parseEther('100'), fee, sqrtPriceLimitX96: 0 }]) }));
        const t0 = Date.now();
        try {
            const r = await mc.callStatic.aggregate3(calls);
            return { ms: Date.now() - t0, url: provider.connection?.url, ok: r.map((x) => x.success) };
        } catch (e) { return { ms: Date.now() - t0, url: provider.connection?.url, error: String(e.message).slice(0, 300) }; }
    });
    console.log('   diagnóstico multicall:', JSON.stringify(diag));
    page.on('console', (m) => { if (/swap|cota|quote/i.test(m.text())) console.log('   [console]', m.text().slice(0, 200)); });
    const t1 = Date.now();
    const direct = await page.evaluate(async () => { try { const q = await window.RdeskDefi.refreshSwapQuote(); return q ? { out: q.amountOut, route: q.routeLabel || q.label } : 'null'; } catch (e) { return 'erro ' + e.message; } });
    console.log('   refreshSwapQuote direto:', Date.now() - t1, 'ms', JSON.stringify(direct));
    const q1 = await quote(137, 'POL', 137, 'USDT', 100);
    check('cotação real POL → USDT bate com o mercado (±3%)', q1.out > 0 && Math.abs(q1.out / (100 * live.POL) - 1) < 0.03, `100 POL → ${q1.out} USDT | ${q1.info}`);
    const q2 = await quote(137, 'USDT', 137, 'USDC', 50);
    check('cotação real USDT → USDC perto de 1:1', q2.out > 49 && q2.out < 51, `50 USDT → ${q2.out} USDC | ${q2.info}`);
    for (const [from, to, amount] of [['USDT', 'BRLA', 20], ['USDT', 'BRZ', 20], ['POL', 'BRLA', 100], ['USDT', 'WETH', 50], ['USDT', 'WBTC', 50]]) {
        const q = await quote(137, from, 137, to, amount);
        const coherent = q.out > 0 ? /Uniswap/.test(q.info) : /Não há|Sem liquidez/i.test(q.info);
        check(`troca ${from} → ${to}: cotação real ou aviso claro de falta de liquidez`, coherent, `${amount} ${from} → ${Number.isFinite(q.out) ? q.out : '--'} ${to} | ${q.info}`);
    }
    const q3 = await quote(8453, 'ETH', 8453, 'USDC', 0.01);
    console.log(`   LI.FI (Base ETH → USDC, informativo): ${Number.isFinite(q3.out) ? q3.out : '--'} | ${q3.info}`);
    check('troca em outra rede (Base) termina com cotação ou aviso (não fica girando)', !/Consultando/.test(q3.info) && (q3.out > 0 || q3.info.length > 0), q3.info);

    // Troca de Bitcoin real: a LI.FI devolve um PSBT e a nossa conferência precisa aceitá-lo (endereço público com saldo)
    const btcSwap = await page.evaluate(async () => {
        const addr = 'bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h';
        const q = new URLSearchParams({ fromChain: '20000000000001', toChain: '137', fromToken: 'bitcoin', toToken: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', fromAmount: '300000', fromAddress: addr, toAddress: '0x2833a1C3dDe3B5d2265F057301a89bEf1BB50fe3', slippage: '0.015', integrator: 'rdesk-sentinel' });
        try {
            const r = await fetch('https://li.quest/v1/quote?' + q);
            const d = await r.json();
            if (!r.ok) return { skip: `${r.status} ${d.message || ''}`.slice(0, 160) };
            const tr = d.transactionRequest;
            const plan = window.RdeskBitcoin.checkSwapPsbt(tr.data, { ownAddress: addr, depositAddress: tr.to, depositValue: tr.value });
            return { ok: true, tool: d.tool, fee: plan.fee, rate: plan.feeRate, extras: plan.extras, memo: plan.memo, out: d.estimate.toAmount, min: Math.round(d.estimate.executionDuration / 60) };
        } catch (e) { return { error: String(e.message).slice(0, 200) }; }
    });
    console.log('   troca BTC real (LI.FI):', JSON.stringify(btcSwap));
    if (btcSwap.skip) console.log('   (informativo: serviço sem rota agora)');
    else check('PSBT real da troca de Bitcoin passa pela conferência do app', btcSwap.ok === true, JSON.stringify(btcSwap));

    // ---- v43: mercado em reais, data dos contratos e histórico do Bitcoin (fontes reais, dentro da página) ----
    const v43 = await page.evaluate(async () => {
        const out = {};
        try { const t = await window.RdeskMarket.top10(); out.top = t ? t.map((c) => `${c.symbol}:${Math.round(c.price)}`).join(' ') : null; } catch (e) { out.top = 'erro ' + e.message; }
        try { const s = await window.RdeskMarket.series({ cg: 'bitcoin' }, '1'); out.btc = s ? { n: s.pts.length, last: Math.round(s.pts[s.pts.length - 1].v), src: s.src } : null; } catch (e) { out.btc = 'erro ' + e.message; }
        try {
            let c = await window.RdeskAssetInfo.contractInfo(1, '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9');
            if (!c?.created) { await new Promise((r) => setTimeout(r, 3000)); c = await window.RdeskAssetInfo.contractInfo(1, '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', { force: true }); }
            out.aave = c;
        } catch (e) { out.aave = 'erro ' + e.message; }
        try { const txs = await window.RdeskBitcoin.fetchAddressTxs('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', 1); out.btcTxs = txs.length; } catch (e) { out.btcTxs = 'erro ' + e.message; }
        return out;
    });
    console.log('   v43:', JSON.stringify(v43).slice(0, 600));
    check('mercado: as maiores moedas com preço em reais', typeof v43.top === 'string' && v43.top.split(' ').length >= 8 && /BTC:\d{5,}/.test(v43.top), String(v43.top));
    check('gráfico do Bitcoin em reais com dados reais (24 h)', v43.btc && v43.btc.n > 10 && v43.btc.last > 100000, JSON.stringify(v43.btc));
    check('data real do contrato da AAVE na Ethereum (2020), não 2015', v43.aave && v43.aave.created && new Date(v43.aave.created * 1000).getUTCFullYear() === 2020, JSON.stringify(v43.aave));
    check('histórico de um endereço Bitcoin lido (para o extrato)', typeof v43.btcTxs === 'number' && v43.btcTxs > 0, String(v43.btcTxs));

    // ---- v44: Dash (serviço público responde) e calculadora com dados reais do fundo ----
    const v44 = await page.evaluate(async () => {
        const out = {};
        try { const b = await window.RdeskDash.fetchBalance('XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5'); out.dash = { ok: true, duffs: b.totalDuffs }; } catch (e) { out.dash = { ok: false, err: e.message }; }
        document.querySelector('.nav-tab-btn[data-tab="earn"]')?.click();
        const t0 = Date.now();
        while (Date.now() - t0 < 25000) { const s = window.RdeskDefi._earn.state(); if (s.poolLiquidity > 0 && s.poolVol24hUsd > 0) break; await new Promise((r) => setTimeout(r, 500)); }
        const s = window.RdeskDefi._earn.state();
        const m = window.RdeskDefi._earn.earnModel(0.08);
        out.calc = { L: s.poolLiquidity || 0, liqError: s.liqError || "", vol: Math.round(s.poolVol24hUsd), spot: s.poolPrice, perDay1000: m.usdPerDay(1000), need1day: m.needUsd(1), poolDay: m.poolDayUsd };
        return out;
    });
    console.log('   v44:', JSON.stringify(v44));
    check('Dash: serviço público de saldo responde', v44.dash.ok, JSON.stringify(v44.dash));
    check('calculadora com dados reais: US$ 1.000 numa faixa média rende um valor plausível por dia', v44.calc.L > 0 && v44.calc.perDay1000 > 0.0001 && v44.calc.perDay1000 < 100, JSON.stringify(v44.calc));

    // ---- v45: contratos oficiais da Uniswap em cada rede (fábrica e gerenciador de posições batem) ----
    const v45 = await page.evaluate(async () => {
        const P = window.RdeskPools, E = window.ethers, out = {};
        const usdc = { 1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 137: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 56: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 42220: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C' };
        await Promise.all(Object.keys(P.UNI).map(async (c) => {
            const id = Number(c);
            // servidores públicos falham de vez em quando: até 3 tentativas com pausa
            for (let tent = 0; tent < 3; tent++) try {
                const f = await P.withRpcs(id, (pr) => new E.Contract(P.UNI[id].nfpm, ['function factory() view returns (address)'], pr).factory());
                let found = 0;
                for (const fee of [500, 3000, 100, 10000]) { const pi = await P.poolInfo(id, P.WRAPPED[id].address, usdc[id], fee).catch(() => null); if (pi?.exists) found++; }
                out[id] = { factoryOk: f.toLowerCase() === P.UNI[id].factory.toLowerCase(), pools: found, tent };
                break;
            } catch (e) { out[id] = { err: String(e.message || e).slice(0, 80) }; await new Promise((r) => setTimeout(r, 2500)); }
        }));
        try { out.mine = (await P.listPositions('0x2833a1C3dDe3B5d2265F057301a89bEf1BB50fe3')).length; } catch (e) { out.mine = 'erro ' + e.message; }
        out.polyDbg = await Promise.all((window.RdeskRegistry.getChain(137).rpcs || []).map(async (u) => {
            try { const pr = new E.providers.StaticJsonRpcProvider(u, 137); const code = await pr.getCode(P.UNI[137].nfpm); const bn = await pr.getBlockNumber(); return `${u.split('/')[2]} code=${code.length} bloco=${bn}`; } catch (e) { return `${u.split('/')[2]} erro ${String(e.message).slice(0, 60)}`; }
        }));
        return out;
    });
    console.log('   v45:', JSON.stringify(v45));
    check('fundos: contratos oficiais da Uniswap conferidos nas 7 redes (fábrica certa e fundos achados)', Object.keys(v45).filter((k) => k !== 'mine' && k !== 'polyDbg').every((k) => v45[k].factoryOk && v45[k].pools > 0), JSON.stringify(v45));
    check('fundos: posições do cofre lidas direto da rede', typeof v45.mine === 'number' && v45.mine > 0, String(v45.mine));

    await page.waitForTimeout(4000);
    check('sem erros de JavaScript nem violação de CSP', pageErrors.length === 0 && csp.length === 0, [...pageErrors, ...csp].slice(0, 4).join(' | '));
    await context.close();
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    if (local) local.server.close();
    finish();
}
