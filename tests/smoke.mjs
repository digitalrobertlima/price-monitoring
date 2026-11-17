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

    await page.click('#btn-wallet-trigger');
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
    check('todas as 6 redes responderam', audit.every((a) => !a.unreachable), audit.filter((a) => a.unreachable).map((a) => a.chain).join(','));

    // ---- Bitcoin: API pública responde ----
    const btcNet = await page.evaluate(async () => {
        try {
            const fees = await window.RdeskBitcoin.fetchFeeRates();
            const bal = await window.RdeskBitcoin.fetchBalance('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
            return { fees, bal };
        } catch (e) { return { error: String(e.message) }; }
    });
    check('rede Bitcoin: taxas e saldo consultados', !btcNet.error && btcNet.fees && Number(btcNet.fees.normal) > 0 && btcNet.bal && typeof btcNet.bal.totalSats === 'number', JSON.stringify(btcNet).slice(0, 200));

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
        return { out: parseFloat(await page.inputValue('#swap-amount-out')), info: (await page.textContent('#swap-quote-info')).replace(/\s+/g, ' ').trim() };
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
