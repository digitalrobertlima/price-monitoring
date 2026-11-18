// Rumo ao 1º Bitcoin (trilha em satoshis), troca nova (cartões + lista de moedas) e lições de lastro/confisco/privacidade.
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, waitFn } from './helpers.mjs';
import { MockChain, ADDR } from './mock-chain.mjs';

const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' };
const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const polygon = new MockChain({ polPriceUsd: 0.09 });
polygon.fundNative(OWNER, 50);
polygon.fundToken(ADDR.USDT0, OWNER, 100);
const btc = { fees: { fastestFee: 12, halfHourFee: 8, hourFee: 6, economyFee: 3, minimumFee: 1 }, utxos: [{ txid: 'ab'.repeat(32), vout: 1, value: 150000 }], broadcasts: [] };

const { server, url } = await startStaticServer(8781);
const browser = await launch();
try {
    const ctx = await browser.newContext(MOBILE);
    const { page, pageErrors, cspViolations } = await openApp(ctx, url, { 137: polygon }, { btc });
    // ------------------------------------------------------------ trilha sem carteira
    await page.waitForSelector('#st-home .st-card');
    check('trilha aparece no Início mesmo sem carteira (0 sats)', /0 sats/.test(await page.innerText('#st-home')));
    await importWalletViaUi(page);
    await waitFn(page, () => /150\.000 sats/.test(document.querySelector('#st-home')?.textContent || ''), null, { timeout: 20000 });
    check('trilha conta o Bitcoin nativo em satoshis (150.000)', true);
    await page.waitForSelector('.st-toast', { timeout: 10000 });
    check('passou de marco: aparece a conquista', /Guardião/.test(await page.innerText('.st-toast')));
    check('cartão mostra nível 3 de 6 e o próximo marco', /3\/6/.test(await page.innerText('#st-home')) && /Cofre forte/.test(await page.innerText('#st-home')));
    await page.click('#st-home .st-card');
    await page.waitForSelector('#st-modal .st-node');
    check('trilha tem 6 marcos, 3 conquistados e 1 em andamento', (await page.locator('.st-node').count()) === 6 && (await page.locator('.st-node.done').count()) === 3 && (await page.locator('.st-node.cur').count()) === 1);
    const before = await page.innerText('.st-node.cur .st-val');
    check('cada marco mostra R$ e horas de trabalho (salário mínimo por padrão)', /R\$/.test(before) && /trabalho/.test(before), before);
    await page.fill('#st-income', '6.600');
    await page.dispatchEvent('#st-income', 'change');
    await page.waitForTimeout(200);
    const after = await page.innerText('.st-node.cur .st-val');
    check('renda informada muda as horas de trabalho', after !== before, `${before} → ${after}`);
    await page.screenshot({ path: 'tests/artifacts-trilha.png' });
    await page.click('#st-modal .st-x');
    // a conquista não repete
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);
    check('conquista não aparece de novo depois de vista', (await page.locator('.st-toast').count()) === 0);

    // ------------------------------------------------------------ troca nova
    if (await page.locator('#vault-screen:not([hidden])').count()) {
        await page.click('#vault-open-btn').catch(() => {});
        if (await page.locator('#vault-pass-input').count()) { await page.fill('#vault-pass-input', 'senha-de-teste-123'); await page.click('#vault-pass-go'); }
        await waitFn(page, () => window.RdeskWallet.isUnlocked(), null, { timeout: 30000 });
        await page.waitForSelector('#vault-screen', { state: 'hidden', timeout: 10000 });
    }
    await page.click('[data-tab="pixswap"]');
    await page.waitForSelector('#sx-from-pill .sx-sym');
    check('troca: botões grandes de moeda com a rede', /POL/.test(await page.innerText('#sx-from-pill')) && /Polygon/.test(await page.innerText('#sx-from-pill')));
    await page.click('#sx-to-pill');
    await page.waitForSelector('#sx-picker .sx-row');
    const main = await page.$$eval('#sx-picker .sx-row b', (els) => els.map((e) => e.textContent.trim()));
    check('lista começa só com as principais, Bitcoin primeiro', main[0] === 'Bitcoin' && main.length === 8 && main.includes('Real digital'), main.join(' | '));
    await page.click('#sx-more');
    const groups = await page.$$eval('#sx-picker .sx-gtitle', (els) => els.map((e) => e.firstChild.textContent.trim()));
    check('"todas as redes": começa pelos reais digitais', /Reais digitais/.test(groups[0]) && groups.length === 4, groups.join(' | '));
    check('reais digitais em várias redes (BRZ Polygon/Base, BRLA Polygon/Celo)', (await page.locator('.sx-row[data-sym="BRZ"]').count()) === 2 && (await page.locator('.sx-row[data-sym="BRLA"]').count()) === 2);
    check('a moeda do outro lado fica desativada', await page.locator('.sx-row[data-sym="POL"][data-chain="137"]').isDisabled());
    await page.fill('#sx-picker .sx-search', 'bitcoin');
    check('busca por "bitcoin" acha o Bitcoin nativo', (await page.locator('.sx-row[data-chain="btc"]').count()) === 1);
    await page.fill('#sx-picker .sx-search', '');
    await page.click('.sx-row[data-sym="BRZ"][data-chain="137"]');
    check('escolher na lista muda a troca de verdade', (await page.inputValue('#swap-to-token')) === 'BRZ' && (await page.inputValue('#swap-to-chain')) === '137' && /BRZ/.test(await page.innerText('#sx-to-pill')));
    await page.click('#btn-swap-flip');
    await page.waitForTimeout(200);
    check('inverter também vira os botões', /BRZ/.test(await page.innerText('#sx-from-pill')) && /POL/.test(await page.innerText('#sx-to-pill')));
    await page.click('.sx-chip[data-q="1"]');
    check('atalho "Bitcoin → Reais" monta a troca', (await page.inputValue('#swap-from-chain')) === 'btc' && (await page.inputValue('#swap-to-token')) === 'BRZ');
    await page.click('.sx-chip[data-q="2"]');
    await page.fill('#swap-amount-in', '10');
    await page.dispatchEvent('#swap-amount-in', 'input');
    await waitFn(page, () => !document.getElementById('sx-rate').hidden || /liquidez|rota|--/i.test(document.getElementById('swap-quote-info').textContent), null, { timeout: 20000 }).catch(() => {});
    await page.screenshot({ path: 'tests/artifacts-troca-nova.png' });
    check('troca mostra "taxas incluídas"', /Taxas incluídas/.test(await page.innerText('.sx-fees')));

    // ------------------------------------------------------------ lições novas
    for (const [id, min] of [['lastro', 6], ['confisco', 1], ['privacidade', 1], ['satoshi', 1], ['redes-real', 1]]) {
        await page.evaluate((x) => window.RdeskLearn.openLesson(x), id);
        await page.waitForSelector('#learn-stage .ls-art .art');
        let found = 0;
        for (let i = 0; i < 12; i++) {
            found = Math.max(found, await page.locator('#learn-stage .art-rows .ar').count());
            if (found >= min) break;
            const next = page.locator('#learn-stage #ls-next');
            try { await next.waitFor({ state: 'visible', timeout: 6000 }); } catch (e) { break; }
            if (/Concluir|Depois/.test(await next.innerText())) break;
            await next.click({ force: true });
            await page.waitForTimeout(400);
        }
        check(`lição "${id}" abre com desenhos em linhas`, found >= min, `${found}`);
        if (id === 'lastro') await page.screenshot({ path: 'tests/artifacts-licao-lastro.png' });
        await page.evaluate(() => document.querySelector('#ls-close')?.click());
        await page.waitForTimeout(300);
    }
    check('sem erros de JavaScript nem violação de CSP', pageErrors.length === 0 && cspViolations.length === 0, [...pageErrors, ...cspViolations].slice(0, 3).join(' | '));
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
