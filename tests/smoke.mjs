// Teste com rede REAL (roda no GitHub Actions ou localmente com internet):
// a página abre sem erros, lê o saldo de um endereço e o preço da pool direto da Polygon.
import { startStaticServer, launch, check, finish } from './helpers.mjs';

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
    await page.waitForFunction(() => window.ethers && window.RdeskWallet && window.RdeskDefi && window.RdeskRangeChart, null, { timeout: 60000 });
    check('página e bibliotecas carregadas', true);

    await page.click('#btn-wallet-trigger');
    await page.locator('#rdesk-mw-sheet .rmw-opt-btn', { hasText: 'observação' }).click();
    await page.fill('#rmw-f-watch-input', WATCH_ADDRESS);
    if (await page.locator('#rmw-f-name').count()) await page.fill('#rmw-f-name', 'Observação');
    await page.click('#rmw-f-submit');
    await page.waitForFunction(() => window.RdeskWallet.isConnected(), null, { timeout: 30000 });
    await page.evaluate(async () => { window.RdeskWallet.closeModal(); await window.RdeskWallet.refreshBalances(); });

    const appPol = await page.evaluate(() => window.RdeskWallet.getBalances().find((b) => b.chainId === 137 && b.symbol === 'POL')?.amount);
    const chainPol = Number(BigInt(await rpc('eth_getBalance', [WATCH_ADDRESS, 'latest']))) / 1e18;
    check('saldo de POL lido pela app bate com a Polygon', typeof appPol === 'number' && Math.abs(appPol - chainPol) < 1e-6, `app=${appPol} rede=${chainPol}`);

    const prices = await page.evaluate(() => window.RdeskWallet.getPrices());
    check('cotações ao vivo (POL em USD e dólar em R$)', prices.POL > 0.001 && prices.POL < 100 && prices.USD_BRL > 2 && prices.USD_BRL < 20, `POL=$${prices.POL} USD/BRL=${prices.USD_BRL}`);

    await page.click('.nav-tab-btn[data-tab="earn"]');
    await page.waitForFunction(() => window.RdeskDefi.getState().poolPrice > 0, null, { timeout: 45000 });
    const st = await page.evaluate(() => window.RdeskDefi.getState());
    check('preço da pool Uniswap coerente com o mercado (±5%)', Math.abs(st.poolPrice - prices.POL) / prices.POL < 0.05, `pool=$${st.poolPrice.toFixed(5)} mercado=$${prices.POL}`);
    check('faixa Sniper em volta do preço real', st.sniper.min < st.poolPrice && st.poolPrice < st.sniper.max, `$${st.sniper.min.toFixed(4)} – $${st.sniper.max.toFixed(4)}`);
    const label = await page.getAttribute('#earn-chart-container canvas', 'aria-label');
    check('gráfico com velas reais e faixa Sniper', /Faixa Sniper/.test(label || '') && (await page.evaluate(() => document.querySelector('#earn-chart-container canvas').width)) > 0, label);
    console.log(`Posições Uniswap V3 do endereço: ${st.positions.length}`);

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
