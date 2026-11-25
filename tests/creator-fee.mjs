// Taxa do criador: desligada por padrão; quando ligada, cobra só em trocas/Render, aparece no recibo
// e vai direto para a carteira do criador. Rede e serviços simulados.
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, waitFn, TEST_MNEMONIC, deslizar } from './helpers.mjs';
import { MockChain, ADDR, ethers } from './mock-chain.mjs';

const OWNER = ethers.Wallet.fromMnemonic(TEST_MNEMONIC).address;
const CREATOR = '0x000000000000000000000000000000000000c0DE';
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' };
const lifiCalls = [];
const lifi = (q) => {
    lifiCalls.push(Object.fromEntries(q.entries()));
    return { status: 404, body: { message: 'sem rota (teste)' } };
};

const { server, url } = await startStaticServer(8774);
const browser = await launch();

async function swapReceipt(page) {
    await page.click('.nav-tab-btn[data-tab="pixswap"]');
    await page.selectOption('#swap-from-chain', '137');
    await page.selectOption('#swap-from-token', 'USDT');
    await page.selectOption('#swap-to-chain', '137');
    await page.selectOption('#swap-to-token', 'POL');
    await page.fill('#swap-amount-in', '100');
    await page.waitForTimeout(700);
    await waitFn(page, () => /Uniswap/.test(document.getElementById('swap-quote-info').textContent), null, { timeout: 20000 });
    await page.click('#btn-execute-swap');
    await waitFn(page, () => getComputedStyle(document.getElementById('modal-receipt')).display !== 'none', null, { timeout: 20000 });
    return (await page.innerText('#modal-receipt')).replace(/\s+/g, ' ');
}

try {
    // ---------------------------------------------------------------- padrão: desligada
    {
        const polygon = new MockChain({ polPriceUsd: 0.09 });
        polygon.fundNative(OWNER, 50); polygon.fundToken(ADDR.USDT0, OWNER, 400);
        const ctx = await browser.newContext(MOBILE);
        const { page } = await openApp(ctx, url, { 137: polygon }, { lifi });
        await importWalletViaUi(page);
        await page.evaluate(() => window.RdeskWallet.refreshBalances());
        const cfg = await page.evaluate(() => window.RdeskRegistry.creatorFee());
        check('taxa do criador vem DESLIGADA de fábrica', cfg.active === false && cfg.rateBps === 0, JSON.stringify(cfg));
        const rcp = await swapReceipt(page);
        check('desligada: recibo da troca diz "sem taxa do app"', /sem taxa do app/.test(rcp) && !/criador/.test(rcp), rcp.slice(0, 300));
        await deslizar(page, '#modal-receipt');
        await waitFn(page, () => /conclu|rro/i.test(document.getElementById('swap-feedback').textContent), null, { timeout: 60000 });
        check('desligada: a troca usa os 100 USDT inteiros e nada vai para o criador', polygon.balOf(ADDR.USDT0, OWNER) === 300000000n && polygon.balOf(ADDR.USDT0, CREATOR) === 0n);
        await page.fill('#swap-amount-in', '0');
        await page.selectOption('#swap-to-chain', '8453');
        await page.fill('#swap-amount-in', '10');
        await page.waitForTimeout(1500);
        check('desligada: rotas da LI.FI não pedem taxa extra', lifiCalls.length > 0 && lifiCalls.every((c) => !('fee' in c)), JSON.stringify(lifiCalls.at(-1)));
        await ctx.close();
    }
    // ---------------------------------------------------------------- ligada (0,3%)
    {
        lifiCalls.length = 0;
        const polygon = new MockChain({ polPriceUsd: 0.09 });
        polygon.fundNative(OWNER, 50); polygon.fundToken(ADDR.USDT0, OWNER, 400);
        const ctx = await browser.newContext(MOBILE);
        await ctx.addInitScript((c) => { window.__RDESK_CREATOR_FEE_TEST__ = { rateBps: 30, evmAddress: c }; }, CREATOR);
        const { page, pageErrors, cspViolations } = await openApp(ctx, url, { 137: polygon }, { lifi });
        await importWalletViaUi(page);
        await page.evaluate(() => window.RdeskWallet.refreshBalances());
        const rcp = await swapReceipt(page);
        check('ligada: recibo mostra "Taxa do criador (0,3%)" em reais antes de confirmar', /Taxa do criador \(0,3%\): R\$ 1,6/.test(rcp), rcp.slice(0, 320));
        await deslizar(page, '#modal-receipt');
        await waitFn(page, () => /conclu|rro/i.test(document.getElementById('swap-feedback').textContent), null, { timeout: 60000 });
        check('ligada: 0,3% (0,30 USDT) vai direto para a carteira do criador; o resto é trocado', polygon.balOf(ADDR.USDT0, CREATOR) === 300000n && polygon.balOf(ADDR.USDT0, OWNER) === 300000000n,
            `criador ${polygon.balOf(ADDR.USDT0, CREATOR)} dono ${polygon.balOf(ADDR.USDT0, OWNER)} | ${await page.innerText('#swap-feedback')}`);
        await page.selectOption('#swap-to-chain', '8453');
        await page.fill('#swap-amount-in', '10');
        await page.waitForTimeout(1500);
        check('ligada: rotas da LI.FI pedem a taxa do integrador (0.003)', lifiCalls.some((c) => c.fee === '0.003' && c.integrator === 'rdesk-sentinel'), JSON.stringify(lifiCalls.at(-1)));
        // Envio comum nunca tem taxa do criador
        await page.click('.nav-tab-btn[data-tab="wallet"]');
        await page.click('#btn-action-send');
        check('envio comum não menciona taxa do criador', !/criador/i.test(await page.innerText('#rdesk-mw-sheet')));
        const capped = await page.evaluate(() => { window.__RDESK_CREATOR_FEE_TEST__ = { rateBps: 500, evmAddress: '0x000000000000000000000000000000000000c0DE' }; return window.RdeskRegistry.creatorFee(); });
        check('taxa acima do limite de 1% é ignorada (fica desligada)', capped.active === false, JSON.stringify(capped));
        check('sem erros de JavaScript nem violação de CSP', pageErrors.length === 0 && cspViolations.length === 0, [...pageErrors, ...cspViolations].slice(0, 3).join(' | '));
        await ctx.close();
    }
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
