// Palavras da chave em português (lista oficial BIP39): criar, importar, idioma detectado, sem misturar.
import { startStaticServer, launch, openApp, check, finish, waitFn, ROOT } from './helpers.mjs';
import { MockChain, ethers } from './mock-chain.mjs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';

// ---------------------------------------------------------------- lista e vetores (sem navegador)
const require = createRequire(import.meta.url);
globalThis.window = globalThis; globalThis.ethers = ethers;
require(path.join(ROOT, 'wordlist-pt.js'));
const R = globalThis.RdeskWordlists;
const sha = createHash('sha256').update(R.PT.join('\n') + '\n').digest('hex');
check('lista em português idêntica à oficial (bitcoin/bips, 2048 palavras)', R.PT.length === 2048 && sha === '2685e9c194c82ae67e10ba59d9ea5345a23dc093e92276fc5361f6667d79cd3f', sha);
// Vetores calculados à parte (Python puro, BIP39): entropia -> palavras -> semente com senha "TREZOR"
const VEC = [
    ['00000000000000000000000000000000', 'abacate abacate abacate abacate abacate abacate abacate abacate abacate abacate abacate abater', 'ab9742b024a1e8bd241b76f8b3a157e9'],
    ['7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f', 'imitador vinheta sogro xerife veleiro pomar volumoso tratador imitador vinheta sogro xingar', '298d1614ff06ae803709f5be5331135c'],
    ['000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'abacate afivelar inativo afivelar donzela achatar barulho beber albergue exalar cuidado baioneta abotoar joia dever informal argola peneira aditivo celebrar ouvido amarelo gritaria toalha', '97e10ea0e982c1923d53a0a47b4809ea']
];
VEC.forEach(([ent, words, seed], i) => {
    const m = ethers.utils.entropyToMnemonic('0x' + ent, R.pt());
    const back = ethers.utils.mnemonicToEntropy(words, R.pt()).slice(2);
    const s = ethers.utils.mnemonicToSeed(words, 'TREZOR').slice(2, 34);
    check(`vetor ${i + 1}: entropia ↔ palavras ↔ semente batem com a conta independente`, m === words && back === ent && s === seed, `${m} | ${back} | ${s}`);
});
check('idioma detectado pelas palavras (sem nenhuma palavra em comum)', R.detect(VEC[0][1]) === 'pt' && R.detect('abandon ability able') === 'en' && R.detect('abacate abandon') === null);
check('acentos digitados por engano não atrapalham (normalizado)', R.detect('ABACATE abáter') === 'pt');

const PT_PHRASE = VEC[1][1];
const expectEvm = ethers.utils.HDNode.fromMnemonic(PT_PHRASE, undefined, R.pt()).derivePath("m/44'/60'/0'/0/0").address;

const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' };
const { server, url } = await startStaticServer(8794);
const browser = await launch();
try {
    const ctx = await browser.newContext(MOBILE);
    const { page, pageErrors, cspViolations } = await openApp(ctx, url, { 137: new MockChain({}) }, {});

    // ------------------------------------------------------------ importar chave em português nos quadradinhos
    await page.click('#btn-wallet-trigger');
    if (await page.locator('#rmw-goto-add').count()) await page.click('#rmw-goto-add');
    await page.locator('#rdesk-mw-sheet .rmw-opt-btn', { hasText: 'Importar frase-semente' }).click();
    await page.fill('#rmw-f-name', 'Cofre BR');
    const cells = page.locator('.sg-grid input');
    await cells.first().fill('abacat');
    await page.waitForSelector('.sg-chip[data-w="abacate"]');
    check('sugestão em português enquanto digita ("abacat" → abacate)', true);
    await page.fill('#rmw-f-seed-input', PT_PHRASE);
    await page.locator('#rmw-f-seed-input').dispatchEvent('input');
    const st = await page.innerText('.sg-status');
    check('quadradinhos reconhecem a chave em português', /12 de 12 palavras · 🇧🇷 em português/.test(st), st);
    await page.locator('.sg-grid input').nth(3).fill('ability');
    await page.locator('.sg-grid input').nth(3).dispatchEvent('input');
    check('mistura de inglês com português é avisada', /misturadas/.test(await page.innerText('.sg-status')));
    await page.fill('#rmw-f-seed-input', PT_PHRASE);
    await page.locator('#rmw-f-seed-input').dispatchEvent('input');
    if (await page.locator('[data-lock="password"]').count()) await page.click('[data-lock="password"]');
    await page.fill('#rmw-f-pass', 'senha-de-teste-123');
    if (await page.locator('#rmw-f-pass2').count()) await page.fill('#rmw-f-pass2', 'senha-de-teste-123');
    await page.click('#rmw-f-submit');
    await waitFn(page, () => window.RdeskWallet?.isConnected?.(), null, { timeout: 30000 });
    const addr = await page.evaluate(() => window.RdeskWallet.getAddress());
    check('chave em português abre a carteira certa (mesmo endereço da conta independente)', addr.toLowerCase() === expectEvm.toLowerCase(), `${addr} vs ${expectEvm}`);
    const btc = await page.evaluate(() => window.RdeskWallet.getBitcoinAddress?.());
    check('Bitcoin também sai da chave em português', /^bc1q/.test(btc || ''), btc);

    // ------------------------------------------------------------ criar chave escolhendo português
    await page.evaluate(() => window.RdeskWallet.closeModal());
    await page.waitForTimeout(400);
    await page.evaluate(() => window.RdeskWallet.openModal('add'));
    await page.waitForSelector('#rdesk-mw-sheet [data-mode="create-seed"]', { timeout: 15000 });
    await page.click('#rdesk-mw-sheet [data-mode="create-seed"]');
    await page.waitForSelector('#ks-next', { timeout: 15000 });
    await page.click('#ks-next');
    await page.waitForSelector('.rmw-word-txt');
    const before = await page.locator('.rmw-word-txt').allInnerTexts();
    check('chave nova começa em inglês (abre em qualquer carteira)', R.detect(before.join(' ')) === 'en', before.join(' '));
    await page.click('[data-lang="pt"]');
    const after = await page.locator('.rmw-word-txt').allInnerTexts();
    check('escolher Português gera uma chave nova toda em português', after.length === 12 && R.detect(after.join(' ')) === 'pt' && ethers.utils.isValidMnemonic(after.join(' '), R.pt()), after.join(' '));
    check('aviso de que algumas carteiras só aceitam inglês', /só aceitam inglês/.test(await page.innerText('#rdesk-mw-sheet')));
    await page.click('[data-wc="24"]');
    const w24 = await page.locator('.rmw-word-txt').allInnerTexts();
    check('24 palavras continuam em português', w24.length === 24 && R.detect(w24.join(' ')) === 'pt' && ethers.utils.isValidMnemonic(w24.join(' '), R.pt()));

    check('sem erros de JavaScript nem violação de CSP', pageErrors.length === 0 && cspViolations.length === 0, [...pageErrors, ...cspViolations].slice(0, 3).join(' | '));
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
