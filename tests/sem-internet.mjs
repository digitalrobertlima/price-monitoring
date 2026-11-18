// Bitcoin sem internet: celular online prepara → celular OFFLINE assina → celular online transmite.
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, waitFn, TEST_MNEMONIC } from './helpers.mjs';
import { MockChain } from './mock-chain.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { ethers } from './mock-chain.mjs';

const require = createRequire(import.meta.url);
globalThis.window = globalThis; globalThis.ethers = ethers;
globalThis.atob = globalThis.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));
globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
require(path.join(ROOT, 'bitcoin.js'));
const BTC = globalThis.RdeskBitcoin;
const OWN = BTC.deriveFromMnemonic(TEST_MNEMONIC, 0).address;
const DEST = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' };
const btc = { fees: { fastestFee: 9, halfHourFee: 6, hourFee: 4, economyFee: 2, minimumFee: 1 }, utxos: [{ txid: 'ab'.repeat(32), vout: 1, value: 300000 }, { txid: 'cd'.repeat(32), vout: 0, value: 5000 }], broadcasts: [], txid: '9'.repeat(64) };

const { server, url } = await startStaticServer(8783);
const browser = await launch();
try {
    // ---------------------------------------------- celular ONLINE (sem as palavras): prepara
    const onCtx = await browser.newContext(MOBILE);
    const on = await openApp(onCtx, url, { 137: new MockChain({}) }, { btc });
    await on.page.evaluate(() => window.RdeskAirgap.open());
    await on.page.click('[data-ag="prepare"]');
    await on.page.fill('#ag-from', OWN);
    await on.page.fill('#ag-to', DEST);
    await on.page.fill('#ag-amt', '120000');
    await on.page.click('#ag-go');
    await on.page.waitForSelector('#ag-qr img, #ag-qr canvas', { timeout: 15000 });
    const reqText = await on.page.inputValue('#ag-out .ag-raw');
    check('online: pedido virou QR (sem precisar das palavras)', reqText.startsWith('RDESK1REQ:') && reqText.length < 900, `${reqText.length} caracteres`);

    // ---------------------------------------------- celular OFFLINE (com as palavras): assina
    const offCtx = await browser.newContext(MOBILE);
    const off = await openApp(offCtx, url, { 137: new MockChain({}) }, { btc });
    await importWalletViaUi(off.page);
    await offCtx.setOffline(true);
    await off.page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await off.page.evaluate(() => window.RdeskAirgap.sign());
    check('offline: reconhece que está sem internet', /Sem internet/.test(await off.page.innerText('#ag-modal')));
    // pedido adulterado: troca o destino -> o app refaz a conta e mostra o destino real; adulterar o "from" é recusado
    const evil = 'RDESK1REQ:' + Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(reqText.slice(10).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()), f: DEST })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await off.page.click('#ag-modal .more-opts > summary');
    await off.page.fill('#ag-paste', evil);
    await off.page.click('#ag-paste-go');
    check('offline: pedido de outro cofre é recusado', /outro cofre/.test(await off.page.innerText('#ag-msg')));
    await off.page.fill('#ag-paste', reqText);
    await off.page.click('#ag-paste-go');
    await off.page.waitForSelector('#ag-sign');
    const shown = await off.page.innerText('#ag-out');
    check('offline: mostra destino, valor e taxa antes de assinar', shown.includes(DEST) && /0,00120000 BTC/.test(shown), shown.replace(/\s+/g, ' ').slice(0, 160));
    const during = [];
    const onReq = (r) => { if (!r.url().startsWith('http://localhost')) during.push(r.url()); };
    off.page.on('request', onReq);
    await off.page.click('#ag-sign');
    await off.page.waitForSelector('#ag-signed-hex');
    const signedHex = await off.page.inputValue('#ag-signed-hex');
    const qrOk = await off.page.locator('#ag-qr img, #ag-qr canvas').count();
    const d = BTC.decodeTx(signedHex);
    check('offline: assinou sem internet, troco num endereço novo, e gerou o QR da transação', qrOk > 0 && d.outputs[0].address === DEST && d.outputs[0].value === 120000 && d.outputs[1].address === BTC.deriveAtPath(TEST_MNEMONIC, "m/84'/0'/0'/1/0").address, JSON.stringify(d.outputs));
    await off.page.waitForTimeout(500);
    off.page.off('request', onReq);
    check('offline: nenhum pedido de rede saiu durante a assinatura', during.length === 0, during.slice(0, 3).join(' '));

    // ---------------------------------------------- celular ONLINE: transmite
    await on.page.evaluate(() => window.RdeskAirgap.broadcast());
    await on.page.click('#ag-modal .more-opts > summary');
    await on.page.fill('#ag-paste', 'RDESK1TX:' + Buffer.from(signedHex, 'hex').toString('base64'));
    await on.page.click('#ag-paste-go');
    await on.page.waitForSelector('#ag-send');
    check('transmitir: mostra para onde vai e o código antes de mandar', (await on.page.innerText('#ag-out')).includes(DEST) && (await on.page.innerText('#ag-out')).includes(d.txid));
    await on.page.click('#ag-send');
    await waitFn(on.page, () => /Transmitida/.test(document.getElementById('ag-out')?.textContent || ''), null, { timeout: 15000 });
    check('transmitir: a transação assinada chegou à rede', btc.broadcasts.length === 1 && btc.broadcasts[0] === signedHex);
    await on.page.fill('#ag-paste', signedHex.slice(0, 100));
    await on.page.click('#ag-paste-go');
    check('transmitir: QR cortado é recusado', /incompleta|não é/.test(await on.page.innerText('#ag-msg')));
    check('sem erros de JavaScript', on.pageErrors.length === 0 && off.pageErrors.length === 0, [...on.pageErrors, ...off.pageErrors].slice(0, 3).join(' | '));
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
