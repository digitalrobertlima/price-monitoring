// App instalável de verdade (WebAPK no Android, tela inicial no iPhone), servido como em produção:
// em /price-monitoring/ (GitHub Pages de projeto). Usa a própria checagem do Chrome (DevTools).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launch, mockNetwork, check, finish, ROOT } from './helpers.mjs';
import { chromium } from 'playwright';
import os from 'node:os';
import { MockChain } from './mock-chain.mjs';

const BASE = '/price-monitoring/';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (!u.startsWith(BASE)) { res.writeHead(404); res.end('fora do site'); return; }
    let p = path.join(ROOT, u.slice(BASE.length));
    if (p.endsWith(path.sep) || p === ROOT) p = path.join(p, 'index.html');
    if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
        res.end(data);
    });
});
await new Promise((r) => server.listen(8786, r));
const ORIGIN = 'http://localhost:8786';
const pngSize = (buf) => (buf.slice(1, 4).toString() === 'PNG' ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : null);

const browser = await launch();
try {
    // ---------------------------------------------------- manifest e arquivos
    const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    check('manifest tem os campos obrigatórios', ['name', 'short_name', 'start_url', 'display', 'background_color', 'theme_color', 'orientation', 'icons'].every((k) => man[k]) && man.display === 'standalone');
    const startAbs = new URL(man.start_url, `${ORIGIN}${BASE}manifest.json`).pathname;
    check('start_url e scope apontam para o site em /price-monitoring/ (e não para a raiz do domínio)', startAbs === BASE && new URL(man.scope, `${ORIGIN}${BASE}manifest.json`).pathname === BASE, startAbs);
    for (const [size, f] of [[192, 'icons/icon-192.png'], [512, 'icons/icon-512.png'], [180, 'icons/apple-touch-icon.png']]) {
        const dims = pngSize(fs.readFileSync(path.join(ROOT, f)));
        check(`ícone PNG ${size}x${size} existe com o tamanho exato`, dims && dims[0] === size && dims[1] === size, `${f}: ${dims}`);
    }
    check('ícones 192 e 512 marcados "any maskable"', [192, 512].every((s) => man.icons.some((i) => i.sizes === `${s}x${s}` && i.type === 'image/png' && i.purpose === 'any maskable')));
    for (const s of man.screenshots) {
        const dims = pngSize(fs.readFileSync(path.join(ROOT, s.src)));
        check(`captura ${s.form_factor} confere com o tamanho declarado`, dims && `${dims[0]}x${dims[1]}` === s.sizes, `${dims}`);
    }
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    check('HTML liga manifest, theme-color, apple-touch-icon e modo app do iPhone', /<link rel="manifest" href="\.\/manifest\.json">/.test(html) && /<meta name="theme-color" content="#0c0f16">/.test(html) && /rel="apple-touch-icon"[^>]+href="\.\/icons\/apple-touch-icon\.png"/.test(html) && /apple-mobile-web-app-capable" content="yes"/.test(html));
    check('cor do tema igual no HTML e no manifest', man.theme_color === '#0c0f16');

    // ---------------------------------------------------- o Chrome diz que é instalável?
    // Perfil normal (não anônimo): no modo anônimo o Chrome nunca oferece instalação
    const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-')), { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, args: ['--no-sandbox'], ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = ctx.pages()[0] || await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockNetwork(page, { 137: new MockChain({}) }, {});
    await page.goto(`${ORIGIN}${BASE}`, { waitUntil: 'load' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: 'load' }); // agora controlada pelo service worker
    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    check('service worker registrado e controlando a página', controlled);
    const cdp = await ctx.newCDPSession(page);
    const am = await cdp.send('Page.getAppManifest');
    check('Chrome lê o manifest sem erros', am.errors.length === 0 && am.url.endsWith('/price-monitoring/manifest.json'), JSON.stringify(am.errors));
    let inst = await cdp.send('Page.getInstallabilityErrors');
    for (let i = 0; i < 10 && inst.installabilityErrors.length; i++) { await page.waitForTimeout(500); inst = await cdp.send('Page.getInstallabilityErrors'); }
    check('Chrome considera o app INSTALÁVEL (nenhum motivo para virar atalho)', inst.installabilityErrors.length === 0, JSON.stringify(inst.installabilityErrors));
    // ícones respondem pelo caminho de produção
    const st = await page.evaluate(async (b) => Promise.all(['icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'manifest.json'].map((f) => fetch(b + f).then((r) => r.status))), BASE);
    check('ícones e manifest respondem em /price-monitoring/', st.every((s) => s === 200), st.join(','));

    // ---------------------------------------------------- abre sem internet (instalado)
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    check('instalado, abre mesmo sem internet', await page.evaluate(() => Boolean(document.querySelector('#tab-panel-wallet') && window.RdeskWallet)));
    await ctx.setOffline(false);

    // ---------------------------------------------------- atalhos do ícone
    await page.goto(`${ORIGIN}${BASE}?aba=learn`, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    check('atalho "Aprender" do ícone abre a aba Aprender e limpa a URL', (await page.evaluate(() => document.getElementById('tab-panel-learn')?.classList.contains('active'))) && !page.url().includes('aba='), page.url());
    check('sem erros de JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
