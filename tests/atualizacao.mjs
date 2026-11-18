// Atualização forçada: quando sai versão nova, o app se atualiza sozinho — mas nunca no meio de algo.
import { startStaticServer, launch, openApp, check, finish, waitFn } from './helpers.mjs';
import { MockChain } from './mock-chain.mjs';
import fs from 'node:fs';

const { server, url } = await startStaticServer(8776);
const browser = await launch();
const local = fs.readFileSync(new URL('../version.js', import.meta.url), 'utf8').match(/'([^']+)'/)[1];
try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const { page, pageErrors } = await openApp(ctx, url, { 137: new MockChain({ polPriceUsd: 0.09 }) }, {});
    check('app sabe a própria versão (version.js)', (await page.evaluate(() => window.RdeskUpdater.current)) === local, local);
    check('sem versão nova: nada acontece', (await page.evaluate(() => window.RdeskUpdater.check())) === local && !(await page.locator('#update-curtain').count()));

    // Publica "versão nova" (version.js muda no servidor)
    let served = 'v999';
    await page.route('**/version.js*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'cache-control': 'max-age=600' }, body: `self.RDESK_VERSION = '${served}';` }));
    const reqs = [];
    page.on('request', (r) => { if (/version\.js/.test(r.url())) reqs.push(r.url()); });

    // Ocupado (tela de receber aberta): espera
    await page.click('#btn-action-receive').catch(() => page.evaluate(() => window.RdeskWallet.openModal('add')));
    await page.waitForTimeout(400);
    await page.evaluate(() => { window.__marca = 1; window.RdeskUpdater.check(); });
    await page.waitForTimeout(2500);
    check('no meio de uma tela aberta, não atualiza (espera a pessoa terminar)', (await page.evaluate(() => window.__marca)) === 1);
    check('pergunta a versão sem usar cache', reqs.some((u) => /version\.js\?t=\d+/.test(u)), reqs.join(' '));

    // Fecha a tela: atualiza sozinho
    await page.evaluate(() => window.RdeskWallet.closeModal());
    await page.waitForTimeout(500);
    await page.waitForFunction(() => window.__marca === undefined, null, { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('load');
    await waitFn(page, () => Boolean(window.RdeskUpdater), null, { timeout: 15000 });
    check('ao terminar, recarrega sozinho na versão nova', (await page.evaluate(() => window.RdeskUpdater.current)) === 'v999' && (await page.evaluate(() => window.__marca)) === undefined);
    check('depois de atualizar, a barra de endereço fica limpa (sem ?v=)', !/[?&]v=/.test(page.url()), page.url());
    await page.waitForTimeout(1500);
    check('já atualizado: não fica recarregando em laço', (await page.evaluate(() => window.RdeskUpdater.check())) === 'v999' && !(await page.locator('#update-curtain').count()));

    // Voltar para o app (aba visível de novo) também confere
    served = 'v1000';
    reqs.length = 0;
    await page.evaluate(() => { window.__marca2 = 1; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => window.__marca2 === undefined && window.RdeskUpdater?.current === 'v1000', null, { timeout: 15000 }).catch(() => {});
    check('ao voltar para o app, confere e atualiza', reqs.length > 0 && (await page.evaluate(() => window.RdeskUpdater.current)) === 'v1000');
    check('sem erros de JavaScript', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

    // Service worker: version.js nunca de cache; arquivos do app revalidados
    const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
    check('service worker usa a mesma versão no nome do cache e não guarda version.js', /importScripts\('\.\/version\.js'\)/.test(sw) && /RDESK_VERSION/.test(sw) && /no-store/.test(sw) && /cache: 'no-cache'/.test(sw));
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
