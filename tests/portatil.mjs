// Versão portátil (Tails / pendrive): o app aberto direto do arquivo index.html, sem servidor.
import { launch, mockNetwork, importWalletViaUi, check, finish, waitFn, ROOT } from './helpers.mjs';
import { MockChain } from './mock-chain.mjs';

const btc = { fees: { fastestFee: 5, halfHourFee: 4, hourFee: 3, economyFee: 2, minimumFee: 1 }, utxos: [{ txid: 'cd'.repeat(32), vout: 0, value: 25000 }], broadcasts: [] };
const browser = await launch(['--allow-file-access-from-files']);
try {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) errors.push(m.text().slice(0, 160)); });
    await mockNetwork(page, { 137: new MockChain({ polPriceUsd: 0.09 }) }, { btc });
    await page.addInitScript(() => { try { localStorage.setItem('rdesk_onboarding_v1', JSON.stringify({ introDone: true, finished: true, hidden: false, did: {}, tips: { receive: 1, send: 1, pixswap: 1, earn: 1, audit: 1, addtoken: 1 } })); } catch (e) {} });
    await page.goto(`file://${ROOT}/index.html`, { waitUntil: 'load' });
    await waitFn(page, () => Boolean(window.RdeskWallet && window.RdeskDefi && window.RdeskSatsTrail && window.RdeskSwapPicker), null, { timeout: 15000 });
    check('aberto do arquivo: todos os módulos carregam', true);
    check('aberto do arquivo: não tenta se atualizar sozinho', (await page.evaluate(() => window.RdeskUpdater.check())) === null);
    await page.evaluate(() => document.querySelector('#ls-close')?.click());
    await importWalletViaUi(page);
    await waitFn(page, () => (window.RdeskWallet.getBalances().find((b) => b.chainId === 'btc')?.amount || 0) > 0, null, { timeout: 20000 });
    check('aberto do arquivo: cria o cofre e lê o saldo de Bitcoin', true);
    await page.evaluate(() => window.RdeskWallet.lock?.() || window.RdeskWallet.lockNow?.());
    await page.screenshot({ path: 'tests/artifacts-portatil.png' });
    check('sem erros de JavaScript nem bloqueio de segurança', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    finish();
}
