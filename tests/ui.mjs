// Gerenciador de carteiras testado com cliques reais em tela de celular:
// criar (com prova das 3 palavras), adicionar, trocar, ver a frase, apagar,
// bloquear/desbloquear, persistência, cópia de segurança e biometria (WebAuthn PRF).
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, TEST_MNEMONIC, TEST_PASSWORD, waitFn } from './helpers.mjs';
import { MockChain, ethers } from './mock-chain.mjs';

const VAULT_KEY = 'rdesk_multi_vault_v2';
const BIO_KEY = 'rdesk_bio_prf_v3';
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' };
const TEST_ADDR = ethers.Wallet.fromMnemonic(TEST_MNEMONIC).address;

const chain = new MockChain();
const { server, url } = await startStaticServer(8767);
const browser = await launch();

const sheetText = async (page) => (await page.innerText('#rdesk-mw-sheet')).replace(/\s+/g, ' ');
const accounts = (page) => page.evaluate(() => window.RdeskWallet.getAccounts().map((a) => ({ name: a.name, address: a.address, type: a.type })));
const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), key);
// Decifra o cofre guardado, do lado do teste, para conferir exatamente o que ficou no aparelho.
const decryptVault = (page, password) => page.evaluate(async ({ key, password }) => {
    const meta = JSON.parse(localStorage.getItem(key));
    const blob = meta.encryptedSecrets;
    const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveKey']);
    const aes = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(blob.saltB64), iterations: blob.iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(blob.ivB64) }, aes, b64(blob.cipherB64));
    return JSON.parse(new TextDecoder().decode(plain));
}, { key: VAULT_KEY, password });
async function addVirtualAuthenticator(context, page, hasPrf) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf }
    });
}

try {
    // ================================================================ 1. Criar carteira
    const context = await browser.newContext(MOBILE);
    let { page, pageErrors, dialogs, external, cspViolations } = await openApp(context, url, chain);

    await page.click('#btn-wallet-trigger');
    const addMenu = await sheetText(page);
    check('menu oferece criar, importar frase, importar chave, Rabby e observação',
        ['Criar carteira', 'Importar frase-semente', 'Importar chave privada', 'Rabby', 'observação'].every((t) => addMenu.includes(t)), addMenu.slice(0, 120));
    await page.screenshot({ path: 'tests/artifacts-ui-adicionar.png' });

    await page.locator('#rdesk-mw-sheet .rmw-opt-btn', { hasText: 'Criar carteira' }).click();
    await page.waitForSelector('.rmw-word-pill');
    const words = await page.$$eval('.rmw-word-pill', (els) => els.map((e) => {
        const clone = e.cloneNode(true); clone.querySelector('.rmw-word-num')?.remove(); return clone.textContent.trim();
    }));
    check('mostra 12 palavras para anotar', words.length === 12 && ethers.utils.isValidMnemonic(words.join(' ')), `${words.length} palavras`);
    await page.screenshot({ path: 'tests/artifacts-ui-palavras.png' });

    await page.fill('#rmw-f-name', 'Caixa <b>Forte</b>');
    await page.fill('#rmw-f-pass', 'curta1');
    await page.click('#rmw-f-next-verify');
    check('senha com menos de 8 caracteres é recusada', /pelo menos 8/.test(await page.innerText('#rmw-form-msg')), await page.innerText('#rmw-form-msg'));
    await page.fill('#rmw-f-pass', TEST_PASSWORD);
    await page.click('#rmw-f-next-verify');

    await page.waitForSelector('#rmw-chk-w1');
    const asked = await page.$$eval('.rmw-label', (els) => els.map((e) => Number((e.textContent.match(/#(\d+)/) || [])[1])).filter(Boolean));
    check('pede 3 palavras para provar o backup', asked.length === 3, asked.join(', '));
    await page.fill('#rmw-chk-w1', 'errada');
    await page.fill('#rmw-chk-w2', words[asked[1] - 1]);
    await page.fill('#rmw-chk-w3', words[asked[2] - 1]);
    await page.click('#rmw-verify-confirm-btn');
    check('palavra errada bloqueia a criação', /não confere/.test(await page.innerText('#rmw-form-msg')) && (await accounts(page)).length === 0);
    await page.fill('#rmw-chk-w1', words[asked[0] - 1]);
    await page.click('#rmw-verify-confirm-btn');
    await waitFn(page, () => window.RdeskWallet.isConnected() && window.RdeskWallet.isUnlocked(), null, { timeout: 30000 });
    const created = (await accounts(page))[0];
    check('carteira criada com o endereço das palavras mostradas', created.address === ethers.Wallet.fromMnemonic(words.join(' ')).address, created.address);
    check('nome com HTML é mostrado como texto (sem injeção)', (await page.locator('#rdesk-mw-sheet b').count()) === 0 && created.name === 'Caixa <b>Forte</b>');

    const blob = await stored(page, VAULT_KEY);
    const raw = JSON.stringify(blob);
    check('frase não fica em texto puro no aparelho; cofre com 600 mil iterações',
        !words.slice(1).some((w, i) => raw.includes(`${words[i]} ${w}`)) && blob.encryptedSecrets.iterations === 600000, `iterações=${blob.encryptedSecrets.iterations}`);

    // ================================================================ 2. Segunda carteira, trocar, lista
    await page.evaluate(() => window.RdeskWallet.closeModal());
    await importWalletViaUi(page, { name: 'Pool V3' });
    let list = await accounts(page);
    check('segunda carteira adicionada sem pedir nova senha', list.length === 2 && list[1].address === TEST_ADDR, list.map((a) => a.name).join(' | '));
    check('a carteira recém-adicionada fica ativa', (await page.evaluate(() => window.RdeskWallet.getAddress())) === TEST_ADDR);

    await page.click('#btn-wallet-trigger');
    await page.waitForSelector('[data-select-acc]');
    check('lista "Minhas Carteiras" mostra as duas', (await page.locator('[data-select-acc]').count()) === 2, (await sheetText(page)).slice(0, 140));
    await page.screenshot({ path: 'tests/artifacts-ui-lista.png' });
    await page.locator('[data-select-acc]').first().click();
    await page.waitForTimeout(500);
    check('tocar numa carteira troca a conta ativa', (await page.evaluate(() => window.RdeskWallet.getAddress())) === created.address);
    const activeName = await page.evaluate((a) => window.RdeskWallet.getAccounts().find((x) => x.address === a)?.name, created.address);
    const headerText = await page.innerText('#btn-wallet-trigger');
    check('cabeçalho mostra o nome da carteira ativa, sem o endereço técnico', headerText.includes(activeName) && !/0x[0-9a-f]{4}/i.test(headerText), headerText);

    // ================================================================ 3. Ver a frase exige a senha de novo
    if (!(await page.locator('[data-detail-acc]').count())) await page.click('#btn-wallet-trigger');
    await page.locator('[data-detail-acc]').first().click();
    await page.waitForSelector('#rmw-det-show-seed');
    await page.screenshot({ path: 'tests/artifacts-ui-detalhe.png' });
    await page.click('#rmw-det-show-seed');
    check('frase não aparece antes de digitar a senha', !(await sheetText(page)).includes(words[3] + ' ' + words[4]));
    await page.fill('#rmw-reveal-pass', 'senha-errada-000');
    await page.click('#rmw-reveal-confirm');
    check('senha errada não revela a frase', /incorreta/i.test(await page.innerText('#rmw-det-msg')) && (await page.locator('#rmw-secret-value').count()) === 0);
    await page.fill('#rmw-reveal-pass', TEST_PASSWORD);
    await page.click('#rmw-reveal-confirm');
    check('senha certa revela exatamente as 12 palavras', (await page.innerText('#rmw-secret-value')).trim() === words.join(' '));
    await page.click('#rmw-hide-secret-val');
    check('"Ocultar agora" tira a frase da tela', (await page.locator('#rmw-secret-value').count()) === 0);
    check('QR do endereço é gerado localmente', (await page.locator('#rmw-det-qr canvas, #rmw-det-qr img').count()) > 0);

    // ================================================================ 4. Apagar carteira remove a chave do aparelho
    let before = await decryptVault(page, TEST_PASSWORD);
    check('cofre guarda as duas frases enquanto as duas carteiras existem', Object.keys(before.masterSeedMap).length === 2);
    await page.click('#rmw-det-back').catch(() => {});
    await page.waitForSelector('[data-detail-acc]');
    await page.locator('[data-detail-acc]').nth(1).click();
    await page.waitForSelector('#rmw-det-delete');
    dialogs.length = 0;
    await page.click('#rmw-det-delete');
    await waitFn(page, () => window.RdeskWallet.getAccounts().length === 1, null, { timeout: 15000 });
    check('apagar pede confirmação avisando que a chave será removida', dialogs.length === 1 && /removida deste aparelho/.test(dialogs[0]), dialogs[0]?.slice(0, 90));
    await page.waitForTimeout(2500); // regravação do cofre (PBKDF2) termina
    const after = await decryptVault(page, TEST_PASSWORD);
    check('frase da carteira apagada sai do cofre; a outra permanece',
        Object.values(after.masterSeedMap).length === 1 && Object.values(after.masterSeedMap)[0] === words.join(' '));

    // ================================================================ 5. Bloquear, recarregar, desbloquear
    await page.evaluate(() => window.RdeskWallet.closeModal());
    await page.click('#btn-lock-vault');
    check('botão Bloquear tranca o cofre', await page.evaluate(() => window.RdeskWallet.isLocked()));
    let signErr = await page.evaluate(() => window.RdeskWallet.getSigner(137).then(() => '').catch((e) => e.message));
    check('cofre bloqueado não assina', /bloqueado/i.test(signErr), signErr);
    await page.evaluate(() => window.RdeskWallet.closeModal());

    await page.reload({ waitUntil: 'load' });
    await waitFn(page, () => window.RdeskWallet && window.RdeskWallet.isConnected(), null, { timeout: 30000 });
    check('após recarregar: mesma carteira, cofre bloqueado',
        (await page.evaluate(() => window.RdeskWallet.getAddress())) === created.address && (await page.evaluate(() => window.RdeskWallet.isLocked())));
    await page.click('#btn-wallet-trigger');
    await page.waitForSelector('#rmw-pass-input');
    await page.screenshot({ path: 'tests/artifacts-ui-desbloquear.png' });
    await page.fill('#rmw-pass-input', 'senha-errada-000');
    await page.click('#rmw-pass-unlock-btn');
    await waitFn(page, () => (document.getElementById('rmw-unlock-msg')?.textContent || '').length > 0, null, { timeout: 30000 });
    check('senha errada não desbloqueia e avisa', (await page.evaluate(() => window.RdeskWallet.isLocked())) && /incorret/i.test(await page.innerText('#rmw-unlock-msg')));
    await page.fill('#rmw-pass-input', TEST_PASSWORD);
    await page.click('#rmw-pass-unlock-btn');
    await waitFn(page, () => window.RdeskWallet.isUnlocked(), null, { timeout: 30000 });
    const signer = await page.evaluate(() => window.RdeskWallet.getSigner(137).then((s) => s.getAddress()));
    check('senha certa desbloqueia e o assinador usa o endereço da frase', signer === created.address);

    // ================================================================ 6. Cópia de segurança no IndexedDB
    await page.evaluate((k) => localStorage.removeItem(k), VAULT_KEY);
    await page.reload({ waitUntil: 'load' });
    await waitFn(page, () => window.RdeskWallet, null, { timeout: 30000 });
    await page.waitForTimeout(1200);
    check('cofre é restaurado se só o localStorage for apagado', (await page.evaluate(() => window.RdeskWallet.getAddress())) === created.address);

    // ================================================================ 7. Receber: QR local, nada de terceiros
    await page.click('#btn-action-receive');
    await page.waitForSelector('#rmw-rec-qr img[src]', { state: 'attached' });
    check('tela Receber mostra o endereço completo e QR', (await sheetText(page)).includes(created.address));
    await page.screenshot({ path: 'tests/artifacts-ui-receber.png' });
    await page.evaluate(() => window.RdeskWallet.closeModal());
    const foreignScripts = external.filter((u) => /\.js(\?|$)/.test(u));
    check('nenhum script de terceiros é carregado', foreignScripts.length === 0, foreignScripts.join(', '));
    check('endereço não é enviado a serviço externo de QR', !external.some((u) => /qrserver|chart\.googleapis/.test(u)));

    // ================================================================ 7b. Modo observação (só leitura)
    await page.click('#btn-wallet-trigger');
    await page.waitForSelector('#rmw-pass-input, #rmw-goto-add');
    if (await page.locator('#rmw-goto-add-from-unlock').count()) await page.click('#rmw-goto-add-from-unlock'); else await page.click('#rmw-goto-add');
    await page.locator('#rdesk-mw-sheet .rmw-opt-btn', { hasText: 'observação' }).click();
    await page.fill('#rmw-f-watch-input', '0x2833a1C3dDe3B5d2265F057301a89bEf1BB50fe3');
    await page.click('#rmw-f-submit');
    await waitFn(page, () => window.RdeskWallet.getAccounts().length === 2, null, { timeout: 15000 });
    const watchErr = await page.evaluate(() => window.RdeskWallet.getSigner(137).then(() => '').catch((e) => e.message));
    check('endereço de observação entra na lista e não consegue assinar', (await page.evaluate(() => window.RdeskWallet.isWatchOnly())) && /Observação/.test(watchErr), watchErr);
    await page.evaluate(() => window.RdeskWallet.closeModal());
    await page.evaluate(() => window.RdeskWallet.switchAccount(window.RdeskWallet.getAccounts()[0].id));

    // ================================================================ 8. Layout no celular
    for (const tab of ['wallet', 'earn', 'pixswap', 'audit']) {
        await page.click(`.nav-tab-btn[data-tab="${tab}"]`);
        await page.waitForTimeout(700);
        const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        check(`aba "${tab}" sem rolagem horizontal no celular`, o.sw <= o.iw + 2, `${o.sw}px em ${o.iw}px`);
        await page.screenshot({ path: `tests/artifacts-ui-aba-${tab}.png`, fullPage: true });
    }
    check('nenhuma violação da política de segurança de conteúdo (CSP)', cspViolations.length === 0, cspViolations.slice(0, 3).join(' | '));
    check('sem erros de JavaScript', pageErrors.length === 0, [...new Set(pageErrors)].slice(0, 4).join(' | '));

    // ================================================================ 9. Apagar a última carteira zera o cofre
    await page.click('.nav-tab-btn[data-tab="wallet"]');
    await page.click('#btn-wallet-trigger');
    await page.waitForSelector('#rmw-pass-input');
    await page.fill('#rmw-pass-input', TEST_PASSWORD);
    await page.click('#rmw-pass-unlock-btn');
    await waitFn(page, () => window.RdeskWallet.isUnlocked(), null, { timeout: 30000 });
    await page.evaluate(() => window.RdeskWallet.openModal('list'));
    for (const left of [1, 0]) {
        await page.evaluate(() => window.RdeskWallet.openModal('list'));
        await page.locator('[data-detail-acc]').first().click();
        await page.click('#rmw-det-delete');
        await waitFn(page, (n) => window.RdeskWallet.getAccounts().length === n, left, { timeout: 15000 });
    }
    await page.waitForTimeout(1500);
    const emptied = await stored(page, VAULT_KEY);
    check('apagar a última carteira não deixa nada cifrado no aparelho', emptied.accounts.length === 0 && emptied.encryptedSecrets === null);
    await context.close();

    // ================================================================ 9b. Recuperar carteira criada na versão anterior do app
    const legCtx = await browser.newContext(MOBILE);
    const leg = await openApp(legCtx, url, chain);
    await leg.page.evaluate(async ({ mnemonic, password }) => {
        // Grava um cofre no formato exato da versão anterior (v22)
        const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
        const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
        const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveKey']);
        const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(mnemonic)));
        localStorage.setItem('rdesk_v22_encrypted_vault', JSON.stringify({ version: 1, kdf: 'PBKDF2-SHA256', iterations: 600000, cipher: 'AES-GCM-256', salt: b64(salt), iv: b64(iv), ciphertext: b64(ct) }));
    }, { mnemonic: TEST_MNEMONIC, password: TEST_PASSWORD });
    await leg.page.click('#btn-wallet-trigger');
    await leg.page.waitForSelector('#rmw-legacy-pass');
    await leg.page.fill('#rmw-legacy-pass', 'senha-errada-000');
    await leg.page.click('#rmw-legacy-import');
    await waitFn(leg.page, () => (document.getElementById('rmw-add-msg')?.textContent || '').length > 0, null, { timeout: 30000 });
    const legWrong = await leg.page.innerText('#rmw-add-msg');
    await leg.page.fill('#rmw-legacy-pass', TEST_PASSWORD);
    await leg.page.click('#rmw-legacy-import');
    await waitFn(leg.page, () => window.RdeskWallet.isConnected() && localStorage.getItem('rdesk_v22_encrypted_vault') === null, null, { timeout: 30000 }).catch(() => {});
    check('cofre da versão anterior é recuperado com a senha antiga (senha errada é recusada)',
        /incorreta/i.test(legWrong) && (await leg.page.evaluate(() => window.RdeskWallet.getAddress())) === TEST_ADDR &&
        (await leg.page.evaluate(() => localStorage.getItem('rdesk_v22_encrypted_vault'))) === null, legWrong);
    await legCtx.close();

    // ================================================================ 10. Biometria com chave protegida (WebAuthn PRF)
    const bioCtx = await browser.newContext(MOBILE);
    const bio = await openApp(bioCtx, url, chain);
    await addVirtualAuthenticator(bioCtx, bio.page, true);
    await importWalletViaUi(bio.page);
    await bio.page.click('#btn-wallet-trigger');
    await bio.page.locator('[data-detail-acc]').first().click();
    await bio.page.click('#rmw-det-bio-btn');
    await waitFn(bio.page, () => (document.getElementById('rmw-det-msg')?.textContent || '').length > 0, null, { timeout: 30000 });
    const bioMsg = await bio.page.innerText('#rmw-det-msg');
    const bioRecord = await stored(bio.page, BIO_KEY);
    check('biometria ativa com autenticador que suporta PRF', /ativada/i.test(bioMsg) && Boolean(bioRecord), bioMsg);
    check('registro da biometria não guarda chave nem senha em claro',
        Boolean(bioRecord) && Object.keys(bioRecord).sort().join(',') === 'credIdB64,ivB64,prfSaltB64,version,wrappedPassB64' && !JSON.stringify(bioRecord).includes(TEST_PASSWORD),
        bioRecord ? Object.keys(bioRecord).join(',') : 'sem registro');
    await bio.page.evaluate(() => { window.RdeskWallet.closeModal(); window.RdeskWallet.lockVault(); window.RdeskWallet.closeModal(); });
    const bioUnlock = await bio.page.evaluate(() => window.RdeskWallet.unlockWithBiometrics().then(() => 'ok').catch((e) => e.message));
    check('desbloqueio por biometria abre o cofre', bioUnlock === 'ok' && (await bio.page.evaluate(() => window.RdeskWallet.isUnlocked())), bioUnlock);
    await bioCtx.close();

    const noPrfCtx = await browser.newContext(MOBILE);
    const noPrf = await openApp(noPrfCtx, url, chain);
    await addVirtualAuthenticator(noPrfCtx, noPrf.page, false);
    await importWalletViaUi(noPrf.page);
    await noPrf.page.click('#btn-wallet-trigger');
    await noPrf.page.locator('[data-detail-acc]').first().click();
    await noPrf.page.click('#rmw-det-bio-btn');
    await waitFn(noPrf.page, () => (document.getElementById('rmw-det-msg')?.textContent || '').length > 0, null, { timeout: 30000 });
    const noPrfMsg = await noPrf.page.innerText('#rmw-det-msg');
    check('aparelho sem PRF: biometria é recusada com aviso, nada inseguro é gravado',
        /PRF|senha/i.test(noPrfMsg) && !/ativada/i.test(noPrfMsg) && (await stored(noPrf.page, BIO_KEY)) === null, noPrfMsg);
    await noPrfCtx.close();
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
