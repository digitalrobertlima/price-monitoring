// Opções da chave: 12 ou 24 palavras, PIN com teclado (ou senha), digital e senha extra (passphrase BIP39).
import { startStaticServer, launch, openApp, check, finish, waitFn, ROOT } from './helpers.mjs';
import { MockChain, ethers } from './mock-chain.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
globalThis.window = globalThis; globalThis.ethers = ethers;
require(path.join(ROOT, 'bitcoin.js'));
const BTC = globalThis.RdeskBitcoin;
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' };
const PIN = '482915';
const EXTRA = 'Minha Senha Extra 25';

const tapPin = async (page, scope, pin) => { for (const d of pin) await page.click(`${scope} .pp-key[data-d="${d}"]`); await page.waitForTimeout(400); };
const { server, url } = await startStaticServer(8778);
const browser = await launch();
try {
    const ctx = await browser.newContext(MOBILE);
    const { page, pageErrors, cspViolations } = await openApp(ctx, url, { 137: new MockChain({ polPriceUsd: 0.09 }) }, {});
    await page.click('#btn-wallet-trigger');
    await page.locator('#rdesk-mw-sheet .rmw-opt-btn', { hasText: 'Criar meu cofre' }).click();
    await page.click('#ks-next');
    await page.waitForSelector('[data-wc="24"]');
    // ---------------------------------------------------------------- 24 palavras
    await page.click('[data-wc="24"]');
    await page.click('#ks-reveal');
    const words = await page.$$eval('.rmw-word-pill', (els) => els.map((e) => { const c = e.cloneNode(true); c.querySelector('.rmw-word-num')?.remove(); return c.textContent.trim(); }));
    check('dá para escolher 24 palavras (chave de 256 bits) e a chave desenhada ganha 24 dentes',
        words.length === 24 && ethers.utils.isValidMnemonic(words.join(' ')) && (await page.locator('#rdesk-mw-sheet .key-svg .kt').count()) === 24, `${words.length}`);
    await page.click('#rmw-f-next-verify');
    for (let r = 0; r < 3; r++) {
        await waitFn(page, (k) => (document.querySelector('.ks-sub')?.textContent || '').includes(`Pergunta ${k + 1} de 3`), r, { timeout: 5000 });
        const n = Number((await page.innerText('#ks-num')).replace(/\D/g, ''));
        await page.click(`.ks-opt[data-word="${words[n - 1]}"]`);
    }
    // ---------------------------------------------------------------- PIN com teclado
    await page.waitForSelector('#ks-pinpad .pp-key');
    check('PIN é o padrão e aparece um teclado numérico (sem teclado de letras)', (await page.locator('#ks-pinpad .pp-key').count()) === 12 && (await page.locator('#ks-pinpad input').count()) === 0);
    await page.screenshot({ path: 'tests/artifacts-chave-pin.png' });
    await tapPin(page, '#ks-pinpad', '111111');
    check('PIN fácil demais (111111) é recusado', /fácil/.test(await page.innerText('#ks-pinpad .pp-msg')));
    await tapPin(page, '#ks-pinpad', PIN);
    await tapPin(page, '#ks-pinpad', '482910');
    check('PIN de confirmação diferente: pede para criar de novo', /não batem/.test(await page.innerText('#ks-pinpad .pp-msg')));
    await tapPin(page, '#ks-pinpad', PIN);
    await tapPin(page, '#ks-pinpad', PIN);
    check('PIN confirmado', /PIN criado/.test(await page.innerText('#ks-pinpad')));
    // ---------------------------------------------------------------- senha extra
    await page.click('.ks-extra > summary');
    check('senha extra explica que sem ela abre outro cofre e que ninguém recupera', /outro cofre/.test(await page.innerText('.ks-extra')) && /ninguém recupera/.test(await page.innerText('.ks-extra')));
    await page.fill('#ks-pp1', EXTRA);
    await page.fill('#ks-pp2', EXTRA + 'x');
    await page.uncheck('#rmw-f-bio');
    await page.click('#rmw-verify-confirm-btn');
    check('as duas senhas extras precisam bater', /não batem/.test(await page.innerText('#rmw-form-msg')));
    await page.fill('#ks-pp2', EXTRA);
    await page.fill('#rmw-f-name', 'Cofre 24');
    await page.click('#rmw-verify-confirm-btn');
    await waitFn(page, () => window.RdeskWallet.isConnected() && window.RdeskWallet.isUnlocked(), null, { timeout: 30000 });
    const acc = await page.evaluate(() => window.RdeskWallet.getActiveAccount());
    const phrase = words.join(' ');
    const withExtra = ethers.utils.HDNode.fromMnemonic(phrase, EXTRA).derivePath("m/44'/60'/0'/0/0").address;
    const without = ethers.utils.HDNode.fromMnemonic(phrase).derivePath("m/44'/60'/0'/0/0").address;
    check('endereço vem das 24 palavras + senha extra (padrão BIP39), diferente de sem a senha', acc.address === withExtra && acc.address !== without, acc.address);
    check('endereço Bitcoin também usa a senha extra', acc.btcAddress === BTC.deriveFromMnemonic(phrase, 0, EXTRA).address && acc.btcAddress !== BTC.deriveFromMnemonic(phrase, 0).address, acc.btcAddress);
    check('cofre lembra que abre com PIN', (await page.evaluate(() => window.RdeskWallet.getLockType())) === 'pin');
    await page.waitForSelector('#vault-screen', { state: 'hidden', timeout: 10000 });

    // ---------------------------------------------------------------- abrir com o PIN
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#vault-open-btn');
    check('porta do cofre oferece "Abrir com o PIN"', /Abrir com o PIN/.test(await page.innerText('#vault-open-btn')));
    await page.click('#vault-open-btn');
    await page.waitForSelector('#vault-pinpad .pp-key');
    await page.screenshot({ path: 'tests/artifacts-chave-porta-pin.png' });
    await tapPin(page, '#vault-pinpad', '000001');
    await waitFn(page, () => /PIN errado/.test(document.querySelector('#vault-pinpad .pp-msg')?.textContent || ''), null, { timeout: 30000 });
    check('PIN errado: a porta treme e avisa', (await page.evaluate(() => window.RdeskWallet.isLocked())));
    await tapPin(page, '#vault-pinpad', PIN);
    await waitFn(page, () => window.RdeskWallet.isUnlocked(), null, { timeout: 30000 });
    check('PIN certo abre o cofre', true);
    const signer = await page.evaluate(() => window.RdeskWallet.getSigner(137).then((s) => s.getAddress()));
    check('depois de abrir, assina com a chave certa (frase + senha extra)', signer === withExtra);

    // ---------------------------------------------------------------- importar com senha extra
    await page.waitForSelector('#vault-screen', { state: 'hidden', timeout: 10000 });
    await page.evaluate(() => window.RdeskWallet.openModal('add'));
    await page.locator('#rdesk-mw-sheet .rmw-opt-btn', { hasText: 'Já tenho minhas 12 palavras' }).click();
    const m12 = ethers.Wallet.createRandom().mnemonic.phrase;
    await page.fill('#rmw-f-seed-input', m12);
    await page.click('#rdesk-mw-sheet .more-opts > summary');
    await page.fill('#rmw-f-passphrase', 'outra');
    await page.click('#rmw-f-submit');
    await waitFn(page, (n) => window.RdeskWallet.getAccounts().length === n, 2, { timeout: 30000 });
    const imp = await page.evaluate(() => window.RdeskWallet.getActiveAccount());
    check('importar também aceita a senha extra', imp.address === ethers.utils.HDNode.fromMnemonic(m12, 'outra').derivePath("m/44'/60'/0'/0/0").address);
    check('sem erros de JavaScript nem violação de CSP', pageErrors.length === 0 && cspViolations.length === 0, [...pageErrors, ...cspViolations].slice(0, 3).join(' | '));
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
