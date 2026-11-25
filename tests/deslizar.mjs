// v48.3: mover dinheiro é "deslize para confirmar", com trava enquanto envia e aviso de pedido repetido.
import fs from 'node:fs';
import path from 'node:path';
import { startStaticServer, launch, check, finish, deslizar, ROOT } from './helpers.mjs';

const { server, url } = await startStaticServer(8797);
fs.writeFileSync(path.join(ROOT, 'tests', '_deslizar.html'), `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="../styles.css"><script src="../slide-confirm.js"></script></head><body></body></html>`);
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: false })).newPage();
const erros = [];
page.on('pageerror', (e) => erros.push(e.message));
try {
    await page.goto(url + 'tests/_deslizar.html');
    await page.evaluate(() => sessionStorage.clear());
    // 1) pedido aberto: botão travado no começo, um toque não confirma
    await page.evaluate(() => { window.__c = null; RdeskSlide.pedir({ titulo: 'Enviar', texto: 'Enviar 10 BRLS para 0xabc', chave: ['t', 'x', 10] }).then((c) => { window.__c = c || 'cancelou'; }); });
    await page.waitForSelector('.slide-folha .slide-botao');
    check('abre travado (um toque que vazou de outra tela não confirma)', await page.locator('.slide-folha .slide-botao').isDisabled());
    await page.waitForSelector('.slide-folha .slide-botao:not([disabled])');
    await page.click('.slide-folha .slide-botao');
    await page.waitForTimeout(300);
    check('um clique simples não confirma', (await page.evaluate(() => window.__c)) === null);
    // 2) arrastar até a metade: volta, sem confirmar
    const b = await page.locator('.slide-folha .slide-botao').boundingBox();
    const t = await page.locator('.slide-folha .slide-trilha').boundingBox();
    await page.mouse.move(b.x + 20, b.y + 20); await page.mouse.down(); await page.mouse.move(b.x + 20 + (t.width - b.width) * 0.5, b.y + 20); await page.mouse.up();
    await page.waitForTimeout(400);
    check('arrastar até a metade não confirma e volta', (await page.evaluate(() => window.__c)) === null && (await page.locator('.slide-folha .slide-botao').getAttribute('aria-valuenow')) === '0');
    // 3) arrastar até o fim: confirma
    await deslizar(page);
    await page.waitForFunction(() => window.__c && window.__c !== 'cancelou');
    check('deslizar até o fim confirma', true);
    // 4) enviando: travado, sem cancelar, voltar do Android não fecha
    await page.evaluate(() => window.__c.enviando());
    check('enviando: trilha travada e sem botão de cancelar', await page.locator('.slide-folha .slide-botao').isDisabled() && await page.locator('.slide-folha .slide-cancelar').isHidden());
    check('enviando: voltar do Android não fecha a folha', await page.evaluate(() => RdeskSlide.voltar()) && (await page.locator('.slide-folha').count()) === 1);
    // 5) segundo pedido enquanto o primeiro envia: espera (nunca duas folhas)
    await page.evaluate(() => { window.__c2 = null; RdeskSlide.pedir({ titulo: 'Enviar', texto: 'Enviar 10 BRLS para 0xabc', chave: ['t', 'x', 10] }).then((c) => { window.__c2 = c || 'cancelou'; }); });
    await page.waitForTimeout(500);
    check('segundo pedido espera o primeiro terminar', (await page.locator('.slide-folha').count()) === 1);
    await page.evaluate(() => window.__c.pronto('Enviado'));
    // 6) o pedido igual aparece com aviso de repetido e trilha de perigo
    await page.waitForSelector('.slide-repetido', { timeout: 5000 });
    const aviso = await page.locator('.slide-repetido').innerText();
    check('pedido igual em seguida: aviso de que já foi enviado', /já enviou este mesmo pedido/.test(aviso) && /duas vezes/.test(aviso), aviso);
    check('pedido igual: trilha pede "DE NOVO"', await page.locator('.slide-trilha.perigo').count() === 1);
    await page.click('.slide-folha .slide-cancelar');
    await page.waitForFunction(() => window.__c2 === 'cancelou');
    check('cancelar devolve "não" e fecha', (await page.locator('.slide-folha').count()) === 0);
    // 7) pedido diferente: sem aviso; teclado (End) confirma
    const r = await page.evaluate(async () => {
        const p = RdeskSlide.confirmarTexto('Enviar 1 POL para 0xdef', { chave: ['t', 'y', 1] });
        await new Promise((res) => setTimeout(res, RdeskSlide._TRAVA_MS + 100));
        const semAviso = !document.querySelector('.slide-repetido');
        const bt = document.querySelector('.slide-folha .slide-botao');
        bt.focus();
        bt.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        return { semAviso, ok: await p };
    });
    check('pedido diferente não avisa; teclado (End) confirma', r.semAviso && r.ok === true);
    // 8) falhou: mostra o motivo e libera "Fechar"
    await page.evaluate(() => { RdeskSlide.pedir({ titulo: 'X', texto: 'y', chave: ['z'] }).then((c) => { window.__c3 = c; }); });
    await deslizar(page);
    await page.waitForFunction(() => window.__c3);
    await page.evaluate(() => { window.__c3.enviando(); window.__c3.falhou('Saldo insuficiente'); });
    check('falhou: mostra o motivo e deixa fechar', (await page.locator('.slide-status.erro').innerText()) === 'Saldo insuficiente' && await page.locator('.slide-cancelar').isVisible());
    check('sem erros na página', erros.length === 0, erros.join(' | '));
} finally {
    await browser.close();
    server.close();
    fs.rmSync(path.join(ROOT, 'tests', '_deslizar.html'), { force: true });
}
finish();
