// Importar a chave digitando cada palavra no seu quadradinho numerado.
import { startStaticServer, launch, openApp, check, finish, waitFn } from './helpers.mjs';
import { MockChain, ethers } from './mock-chain.mjs';

const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' };
const { server, url } = await startStaticServer(8782);
const browser = await launch();
try {
    const ctx = await browser.newContext(MOBILE);
    const { page, pageErrors, cspViolations } = await openApp(ctx, url, { 137: new MockChain({}) }, {});
    const open = async () => {
        await page.evaluate(() => window.RdeskWallet.openModal('add'));
        await page.locator('#rdesk-mw-sheet .rmw-opt-btn', { hasText: 'Já tenho minhas palavras' }).click();
        await page.waitForSelector('.sg-cell input');
    };
    await open();
    check('12 quadradinhos numerados de 1 a 12', (await page.locator('.sg-cell').count()) === 12 && (await page.innerText('.sg-cell:nth-child(12) .sg-n')) === '12');
    const m = ethers.Wallet.createRandom().mnemonic.phrase.split(' ');
    // palavra por palavra: a primeira pela sugestão, as outras digitadas
    await page.click('.sg-cell:nth-child(1) input');
    await page.keyboard.type('pre');
    const chips = await page.$$eval('.sg-chip', (els) => els.map((e) => e.textContent));
    check('enquanto digita, sugere palavras da lista oficial', chips.includes('predict') && chips.length === 4, chips.join(','));
    await page.click('.sg-chip[data-w="predict"]');
    check('tocar na sugestão preenche e pula para a próxima caixa', (await page.inputValue('.sg-cell:nth-child(1) input')) === 'predict' && (await page.evaluate(() => document.activeElement?.dataset?.i)) === '1');
    await page.fill('.sg-cell:nth-child(1) input', m[0]);
    for (let i = 1; i < 12; i++) {
        await page.click(`.sg-cell:nth-child(${i + 1}) input`);
        await page.fill(`.sg-cell:nth-child(${i + 1}) input`, m[i]);
    }
    check('frase montada na ordem certa', (await page.inputValue('#rmw-f-seed-input')) === m.join(' '));
    check('palavras certas ficam verdes, contador 12 de 12', (await page.locator('.sg-cell.ok').count()) === 12 && /12 de 12/.test(await page.innerText('.sg-status')));
    await page.fill('.sg-cell:nth-child(5) input', 'bananaxx');
    await page.click('.sg-cell:nth-child(6) input');
    check('palavra que não existe fica vermelha e avisa', (await page.locator('.sg-cell.bad').count()) === 1 && /não existe/.test(await page.innerText('.sg-status')));
    await page.fill('.sg-cell:nth-child(5) input', m[4]);
    await page.screenshot({ path: 'tests/artifacts-palavras.png' });
    // Bug relatado: com o teclado de PIN na tela, a tecla de apagar não funcionava em nenhum campo
    check('teclado de PIN está na tela (cenário do bug)', (await page.locator('#rmw-f-pinpad .pp-key').count()) === 12);
    await page.click('.sg-cell:nth-child(3) input');
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
    check('apagar funciona no quadradinho da palavra', (await page.inputValue('.sg-cell:nth-child(3) input')) === m[2].slice(0, -2), await page.inputValue('.sg-cell:nth-child(3) input'));
    await page.keyboard.type(m[2].slice(-2));
    await page.click('#rmw-f-name');
    await page.keyboard.type('Meu cofre');
    await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
    check('apagar funciona no nome do cofre', (await page.inputValue('#rmw-f-name')) === 'Meu co', JSON.stringify(await page.inputValue('#rmw-f-name')));
    await page.keyboard.type('fre 12');
    check('números digitados no nome ficam no nome (não vão para o PIN)', (await page.inputValue('#rmw-f-name')) === 'Meu cofre 12' && (await page.locator('#rmw-f-pinpad .pp-dots i.on').count()) === 0, JSON.stringify(await page.inputValue('#rmw-f-name')));
    // colar a frase de 24 palavras na primeira caixa
    const m24 = ethers.utils.entropyToMnemonic(ethers.utils.randomBytes(32));
    await page.click('[data-n="24"]');
    check('troca para 24 quadradinhos', (await page.locator('.sg-cell').count()) === 24);
    await page.evaluate((text) => {
        const inp = document.querySelector('.sg-cell input');
        const dt = new DataTransfer(); dt.setData('text', text);
        inp.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, m24);
    check('colar a frase inteira espalha as 24 palavras', (await page.inputValue('#rmw-f-seed-input')) === m24 && (await page.inputValue('.sg-cell:nth-child(24) input')) === m24.split(' ')[23]);
    if (await page.locator('[data-lock="password"]').count()) await page.click('[data-lock="password"]');
    await page.fill('#rmw-f-pass', 'senha-de-teste-123');
    await page.click('#rmw-f-submit');
    await waitFn(page, () => window.RdeskWallet.isConnected(), null, { timeout: 30000 });
    const acc = await page.evaluate(() => window.RdeskWallet.getActiveAccount());
    check('importa o cofre certo das 24 palavras', acc.address === ethers.utils.HDNode.fromMnemonic(m24).derivePath("m/44'/60'/0'/0/0").address);
    await page.evaluate(() => window.RdeskWallet.openModal());
    await page.waitForSelector('#rdesk-mw-sheet');
    const badge = await page.locator('#rdesk-mw-sheet').innerText();
    check('o selo da carteira de 24 palavras diz 24 (não 12)', /24 palavras/i.test(badge) && !/12 palavras/i.test(badge), badge.slice(0, 120));
    check('sem erros de JavaScript nem violação de CSP', pageErrors.length === 0 && cspViolations.length === 0, [...pageErrors, ...cspViolations].slice(0, 3).join(' | '));
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
