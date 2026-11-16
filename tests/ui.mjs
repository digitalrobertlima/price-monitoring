// Teste de interface com cliques reais: criar carteira pelo modal, bloquear,
// desbloquear, revelar a seed, navegar pelas abas e conferir o layout no celular.
import { startStaticServer, launch, check, finish } from './helpers.mjs';
import { MockChain } from './mock-chain.mjs';

const PASSWORD = 'minha-senha-forte-1';
const chain = new MockChain();
const { server, url } = await startStaticServer(8767);
const browser = await launch();
const chartStub = `(function(){const U=new Proxy(function(){},{get:(t,p)=>p===Symbol.toPrimitive?()=>0:(p==='then'?undefined:U),apply:()=>U,construct:()=>U});window.LightweightCharts=U;})();`;

async function newPage(viewport, extra = {}) {
    const context = await browser.newContext({ viewport, ...extra });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await page.route((u) => !u.href.startsWith('http://localhost'), (route) => {
        const req = route.request(); const u = req.url();
        if (/publicnode\.com|1rpc\.io|drpc\.org/.test(u) && req.method() === 'POST' && /polygon|matic/.test(u)) {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(chain.handle(JSON.parse(req.postData()))) });
        }
        if (/lightweight-charts/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: chartStub });
        return route.abort();
    });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.ethers && window.RdeskVault && window.RdeskGateway);
    await page.waitForTimeout(1500);
    return { context, page, errors };
}
const mode = (page) => page.evaluate(() => window.RdeskVault.getState().mode);

try {
    // ------------------------------------------------------------ Desktop: criar carteira pelo modal
    const d = await newPage({ width: 1366, height: 900 });
    const page = d.page;
    await page.click('#btn-wallet-status');
    await page.click('.wm-tab-btn[data-wmtab="create"]');
    await page.waitForSelector('#draft-words-grid .seed-word-chip strong');
    const words = await page.$$eval('#draft-words-grid .seed-word-chip strong', (els) => els.map((e) => e.textContent));
    check('modal mostra 12 palavras para anotar', words.length === 12, words.length + ' palavras');

    await page.click('#btn-go-verify-words');
    const asked = await page.$$eval('[data-challenge-pos]', (els) => els.map((e) => Number(e.getAttribute('data-challenge-pos'))));
    check('pede 3 palavras para confirmar o backup', asked.length === 3, asked.join(','));

    // Primeiro com uma palavra errada: tem de recusar.
    for (const pos of asked) await page.fill(`[data-challenge-pos="${pos}"]`, pos === asked[0] ? 'errada' : words[pos - 1]);
    await page.fill('#create-vault-pass', PASSWORD);
    await page.fill('#create-vault-pass-confirm', PASSWORD);
    await page.click('#btn-finalize-create-vault');
    await page.waitForTimeout(600);
    check('palavra errada bloqueia a criação e mostra o motivo',
        (await mode(page)) === 'NONE' && /não confere/.test(await page.textContent('#create-vault-error')), await page.textContent('#create-vault-error'));

    await page.fill(`[data-challenge-pos="${asked[0]}"]`, words[asked[0] - 1]);
    await page.fill('#create-vault-pass-confirm', 'outra-coisa');
    await page.click('#btn-finalize-create-vault');
    await page.waitForTimeout(400);
    check('senhas diferentes são recusadas', (await mode(page)) === 'NONE' && /não coincidem/.test(await page.textContent('#create-vault-error')));

    await page.fill('#create-vault-pass', 'curta1');
    await page.fill('#create-vault-pass-confirm', 'curta1');
    await page.click('#btn-finalize-create-vault');
    await page.waitForTimeout(400);
    check('senha curta (menos de 8) é recusada', (await mode(page)) === 'NONE', await page.textContent('#create-vault-error'));

    await page.fill('#create-vault-pass', PASSWORD);
    await page.fill('#create-vault-pass-confirm', PASSWORD);
    await page.click('#btn-finalize-create-vault');
    await page.waitForFunction(() => window.RdeskVault.getState().mode === 'VAULT_UNLOCKED', null, { timeout: 30000 });
    const st = await page.evaluate(() => window.RdeskVault.getState());
    const expected = await page.evaluate((m) => ethers.Wallet.fromMnemonic(m).address.toLowerCase(), words.join(' '));
    check('carteira criada pelo modal com o endereço das palavras mostradas', st.address === expected, st.address);
    check('modal fecha e o botão do topo mostra o cofre aberto',
        !(await page.evaluate(() => document.getElementById('wallet-modal').classList.contains('open'))) &&
        /COFRE/.test(await page.textContent('#btn-wallet-status')), await page.textContent('#btn-wallet-status'));

    // Revelar seed, bloquear, desbloquear — tudo por cliques.
    await page.click('#btn-wallet-status');
    await page.fill('#reveal-seed-pass', PASSWORD);
    await page.click('#btn-reveal-seed');
    await page.waitForFunction(() => (document.getElementById('revealed-seed-box')?.textContent || '').split(' ').length >= 12, null, { timeout: 30000 });
    check('revelar a frase com a senha mostra as mesmas 12 palavras', (await page.textContent('#revealed-seed-box')).trim() === words.join(' '));

    await page.click('#btn-vault-lock');
    await page.waitForTimeout(400);
    check('botão BLOQUEAR tranca o cofre', (await mode(page)) === 'VAULT_LOCKED', await page.textContent('#btn-wallet-status'));
    const leaked = await page.evaluate((ws) => {
        const visible = document.body.innerText;
        return ws.filter((w) => w.length >= 5).every((w) => visible.includes(w));
    }, words);
    check('frase não fica visível na tela depois de bloquear', !leaked);

    await page.click('#btn-wallet-status');
    await page.fill('#vault-unlock-pass', 'senha-errada-999');
    await page.click('#btn-vault-unlock');
    await page.waitForTimeout(1500);
    check('senha errada não desbloqueia e avisa', (await mode(page)) === 'VAULT_LOCKED' && /incorreta/i.test(await page.textContent('#unlock-vault-error')));
    await page.fill('#vault-unlock-pass', PASSWORD);
    await page.click('#btn-vault-unlock');
    await page.waitForFunction(() => window.RdeskVault.getState().mode === 'VAULT_UNLOCKED', null, { timeout: 30000 });
    check('senha certa desbloqueia pelo modal', true);

    // Navegação pelas 5 abas principais.
    const targets = await page.$$eval('.sereno-nav-btn', (els) => els.map((e) => e.getAttribute('data-target')));
    let navOk = targets.length >= 5;
    for (const t of targets) {
        await page.click(`.sereno-nav-btn[data-target="${t}"]`);
        await page.waitForTimeout(300);
        const shown = await page.evaluate((k) => {
            const pane = document.getElementById(`sview-${k}`);
            return Boolean(pane && pane.classList.contains('active') && pane.getBoundingClientRect().height > 50);
        }, t);
        if (!shown) { navOk = false; console.log('   aba sem conteúdo visível:', t); }
    }
    check('as 5 abas principais abrem o seu conteúdo sem erro', navOk && d.errors.length === 0, `${targets.join(', ')}; erros: ${d.errors.slice(0, 3).join(' | ')}`);
    await page.click('#btn-wallet-status');
    const stale = await page.evaluate(() => {
        const box = document.getElementById('revealed-seed-box');
        return box && box.textContent.trim().length > 0 && getComputedStyle(box).display !== 'none';
    });
    check('frase revelada não continua exposta ao reabrir o modal', !stale);
    await page.click('#btn-close-wallet-modal');
    await page.screenshot({ path: 'tests/artifacts-ui-desktop.png' });
    const storage = await d.context.storageState();
    await d.context.close();

    // ------------------------------------------------------------ Celular (390x844)
    const m = await newPage({ width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const overflow = await m.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    check('celular: sem rolagem horizontal', overflow.sw <= overflow.iw + 2, `largura do conteúdo ${overflow.sw}px em tela de ${overflow.iw}px`);
    const tap = await m.page.evaluate(() => {
        const b = document.getElementById('btn-wallet-status') || document.getElementById('btn-sereno-open-wallet');
        const r = b.getBoundingClientRect();
        return { visible: r.width > 0 && r.height > 0 && r.right <= window.innerWidth + 1 && r.left >= -1, h: Math.round(r.height), w: Math.round(r.width) };
    });
    check('celular: botão de carteira visível dentro da tela', tap.visible, JSON.stringify(tap));
    await m.page.tap('#btn-wallet-status').catch(async () => m.page.tap('#btn-sereno-open-wallet'));
    await m.page.waitForTimeout(500);
    const modalBox = await m.page.evaluate(() => {
        const mod = document.querySelector('#wallet-modal.open .modal-card, #wallet-modal.open > div');
        if (!mod) return null; const r = mod.getBoundingClientRect();
        return { w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right), iw: window.innerWidth };
    });
    check('celular: modal da carteira abre e cabe na tela', modalBox && modalBox.left >= -1 && modalBox.right <= modalBox.iw + 1, JSON.stringify(modalBox));
    await m.page.screenshot({ path: 'tests/artifacts-ui-mobile-modal.png' });
    await m.page.tap('#btn-close-wallet-modal').catch(() => {});
    await m.page.waitForTimeout(300);
    await m.page.screenshot({ path: 'tests/artifacts-ui-mobile.png', fullPage: true });
    check('celular: sem erros de JavaScript', m.errors.length === 0, m.errors.slice(0, 3).join(' | '));
    await m.context.close();
    void storage;
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
