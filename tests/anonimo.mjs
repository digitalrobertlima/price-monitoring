// Privacidade máxima: nenhum pedido diz de onde veio, modo anônimo só consulta as redes escolhidas,
// não busca o histórico sozinho, esconde saldos, trava rápido; "Apagar tudo" limpa o aparelho.
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, waitFn } from './helpers.mjs';
import { MockChain } from './mock-chain.mjs';

const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' };
const btc = { fees: { fastestFee: 5, halfHourFee: 4, hourFee: 3, economyFee: 2, minimumFee: 1 }, utxos: [{ txid: 'ab'.repeat(32), vout: 0, value: 42000 }], broadcasts: [] };
const { server, url } = await startStaticServer(8785);
const browser = await launch();
try {
    const ctx = await browser.newContext(MOBILE);
    const { page, pageErrors, cspViolations } = await openApp(ctx, url, { 137: new MockChain({}) }, { btc });
    const seen = [];
    page.on('request', (r) => { if (!r.url().startsWith('http://localhost')) seen.push({ url: r.url(), referer: r.headers().referer || '', body: (r.postData() || '').toLowerCase() }); });
    const OWNER = 'f39fd6e51aad88f6f4ce6ab8827279cfffb92266'; // endereço 0x da frase de testes (sem 0x, minúsculo)
    await importWalletViaUi(page);
    await page.waitForTimeout(3000);
    check('nenhum servidor externo recebe de onde veio o pedido (sem Referer)', seen.length > 3 && seen.every((s) => !s.referer), seen.filter((s) => s.referer).slice(0, 2).map((s) => s.url + ' ← ' + s.referer).join(' | '));
    check('fontes não vêm do Google', !seen.some((s) => /fonts\.(googleapis|gstatic)/.test(s.url)));

    // ------------------------------------------------ liga o modo anônimo só com Bitcoin
    await page.evaluate(() => window.RdeskAnon.open());
    await page.check('#anon-on');
    await page.uncheck('#anon-modal [data-ch="137"]');
    check('modo anônimo ligado: saldos escondidos e trava em 2 minutos', await page.evaluate(() => window.RdeskAnon.isOn() && document.body.classList.contains('privacy-on') && window.RdeskAnon.autoLockMs() === 120000));
    await page.click('#anon-modal .st-x');
    seen.length = 0;
    await page.evaluate(() => window.RdeskWallet.refreshBalances());
    await page.evaluate(() => window.dispatchEvent(new Event('rdesk:walletChanged')));
    await page.waitForTimeout(2500);
    const hosts = [...new Set(seen.map((s) => new URL(s.url).hostname))];
    const leaks = seen.filter((s) => (s.url.toLowerCase() + s.body).includes(OWNER));
    check('nenhum servidor recebe o seu endereço 0x (só o Bitcoin é consultado)', seen.some((s) => /mempool\.space|blockstream/.test(s.url)) && leaks.length === 0, leaks.map((s) => new URL(s.url).hostname + ' ' + s.body.slice(0, 80)).join(' | ') || hosts.join(', '));
    check('não busca o histórico sozinho', !seen.some((s) => /blockscout/.test(s.url)));
    check('saldo de Bitcoin continua aparecendo', Math.round((await page.evaluate(() => window.RdeskWallet.getBalances().find((b) => b.chainId === 'btc')?.amount || 0)) * 1e8) === 42000);

    // ------------------------------------------------ apagar tudo
    await page.evaluate(() => window.RdeskAnon.open());
    await page.click('#anon-wipe');
    check('apagar pede para digitar APAGAR', /Digite APAGAR/.test(await page.innerText('#anon-msg')));
    await page.fill('#anon-wipe-confirm', 'apagar');
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#anon-wipe')]);
    await page.waitForTimeout(800);
    const left = await page.evaluate(async () => ({ ls: Object.keys(localStorage).filter((k) => /vault|rdesk_anon|sats|hist/i.test(k)), connected: Boolean(window.RdeskWallet?.isConnected?.()) }));
    check('depois de apagar: nenhum cofre nem rastro no aparelho', left.ls.length === 0 && !left.connected, JSON.stringify(left));
    check('sem erros de JavaScript nem violação de CSP', pageErrors.length === 0 && cspViolations.length === 0, [...pageErrors, ...cspViolations].slice(0, 3).join(' | '));
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
