// Digitar em reais: enviar, trocar e pedir um valor. Rede simulada.
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, waitFn, TEST_MNEMONIC } from './helpers.mjs';
import { MockChain, ADDR, ethers } from './mock-chain.mjs';

const OWNER = ethers.Wallet.fromMnemonic(TEST_MNEMONIC).address;
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' };
const polygon = new MockChain({ polPriceUsd: 0.09 });
polygon.fundNative(OWNER, 500); polygon.fundToken(ADDR.USDT0, OWNER, 400);
const btc = { fees: { fastestFee: 12, halfHourFee: 8, hourFee: 6, economyFee: 3, minimumFee: 1 }, utxos: [{ txid: 'ab'.repeat(32), vout: 1, value: 800000 }], broadcasts: [] };
const { server, url } = await startStaticServer(8775);
const browser = await launch();
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
try {
    const ctx = await browser.newContext(MOBILE);
    const { page, pageErrors, cspViolations } = await openApp(ctx, url, { 137: polygon }, { btc });
    await importWalletViaUi(page);
    await page.evaluate(() => window.RdeskWallet.refreshBalances());
    const px = await page.evaluate(() => ({ pol: window.RdeskWallet.unitUsdFor('POL', 137), usdt: window.RdeskWallet.unitUsdFor('USDT', 137, '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'), fx: window.RdeskWallet.getPrices().USD_BRL }));

    // ---------------------------------------------------------- enviar
    await page.click('#btn-action-send');
    await page.waitForSelector('#rmw-snd-brl');
    await page.fill('#rmw-snd-brl', '1');
    const polAmt = parseFloat((await page.inputValue('#rmw-snd-amt')).replace(',', '.'));
    check('enviar: digitar R$ 1 calcula a quantidade de POL', near(polAmt, 1 / (px.pol * px.fx), 1e-5), `${polAmt} esperado ${1 / (px.pol * px.fx)}`);
    await page.fill('#rmw-snd-brl', '1.234,56');
    const polAmt2 = parseFloat((await page.inputValue('#rmw-snd-amt')).replace(',', '.'));
    check('enviar: aceita "1.234,56" do jeito brasileiro', near(polAmt2, 1234.56 / (px.pol * px.fx), 1e-5), String(polAmt2));
    await page.fill('#rmw-snd-amt', '10');
    await page.locator('#rmw-snd-amt').dispatchEvent('input');
    check('enviar: digitar a quantidade mostra o valor em reais', (await page.inputValue('#rmw-snd-brl')) === (10 * px.pol * px.fx).toFixed(2).replace('.', ','), await page.inputValue('#rmw-snd-brl'));
    await page.click('#rmw-close-btn');

    // ---------------------------------------------------------- receber (Bitcoin com valor no QR)
    await page.click('#btn-action-receive');
    await page.click('[data-net="btc"]');
    await page.fill('#rmw-rec-brl', '50');
    const ask = await page.innerText('#rmw-rec-ask');
    const btcPx = await page.evaluate(() => window.RdeskWallet.unitUsdFor('BTC', 'btc'));
    const expBtc = (50 / (btcPx * px.fx)).toFixed(8).replace(/\.?0+$/, '');
    check('receber: pedir R$ 50 mostra quantos BTC pedir', ask.includes(expBtc.replace('.', ',')) && /BTC/.test(ask), ask);
    await page.addScriptTag({ url: url + '/vendor/jsqr-1.4.0.js' });
    const scanned = await page.evaluate(() => {
        const src = document.querySelector('#rmw-rec-qr canvas');
        const c = document.createElement('canvas'); c.width = 400; c.height = 400;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 400); g.drawImage(src, 50, 50, 300, 300);
        const r = window.jsQR(g.getImageData(0, 0, 400, 400).data, 400, 400);
        return r ? r.data : null;
    });
    check('receber Bitcoin: o QR leva o valor (padrão bitcoin:…?amount=)', new RegExp(`^bitcoin:bc1q[0-9a-z]+\\?amount=${expBtc.replace('.', '\\.')}$`).test(scanned || ''), scanned);
    await page.click('[data-net="137"]');
    await page.fill('#rmw-rec-brl', '20');
    await page.selectOption('#rmw-rec-coin', 'USDT');
    check('receber Polygon: pedir R$ 20 em USDT', /Peça para enviarem [\d,]+ USDT/.test(await page.innerText('#rmw-rec-ask')), await page.innerText('#rmw-rec-ask'));
    await page.click('#rmw-close-btn');

    // ---------------------------------------------------------- trocar
    await page.click('.nav-tab-btn[data-tab="pixswap"]');
    await page.selectOption('#swap-from-chain', '137');
    await page.selectOption('#swap-from-token', 'USDT');
    await page.selectOption('#swap-to-chain', '137');
    await page.selectOption('#swap-to-token', 'POL');
    await page.fill('#swap-amount-brl', '54');
    const inAmt = parseFloat(await page.inputValue('#swap-amount-in'));
    check('trocar: digitar R$ 54 vira a quantidade de USDT', near(inAmt, 54 / (px.usdt * px.fx), 1e-5), String(inAmt));
    await waitFn(page, () => /Uniswap/.test(document.getElementById('swap-quote-info').textContent), null, { timeout: 20000 });
    check('trocar: cota a partir do valor em reais', parseFloat((await page.inputValue('#swap-amount-out')).replace(/\./g, '').replace(',', '.')) > 0);
    await page.fill('#swap-amount-in', '20');
    await page.locator('#swap-amount-in').dispatchEvent('input');
    check('trocar: digitar a quantidade atualiza os reais', (await page.inputValue('#swap-amount-brl')) === (20 * px.usdt * px.fx).toFixed(2).replace('.', ','), await page.inputValue('#swap-amount-brl'));
    await page.waitForTimeout(800);
    await waitFn(page, () => /Uniswap/.test(document.getElementById('swap-quote-info').textContent) && !/…/.test(document.getElementById('swap-amount-out').value), null, { timeout: 20000 });
    const out20 = parseFloat((await page.inputValue('#swap-amount-out')).replace(/\./g, '').replace(',', '.'));
    const expOut = 20 * px.usdt / px.pol;
    check('trocar: 20 USDT cota perto de 20 dólares em POL', out20 > expOut * 0.95 && out20 < expOut * 1.02, `${out20} esperado ~${expOut}`);
    check('trocar: "Tem" mostra o saldo da moeda escolhida (USDT)', /USDT/.test(await page.innerText('#swap-from-bal')), await page.innerText('#swap-from-bal'));
    await page.screenshot({ path: 'tests/artifacts-troca-reais.png' });
    check('sem erros de JavaScript nem violação de CSP', pageErrors.length === 0 && cspViolations.length === 0, [...pageErrors, ...cspViolations].slice(0, 3).join(' | '));
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
