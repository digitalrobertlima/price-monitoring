// Utilitários dos testes: servidor estático, navegador, rede simulada e asserções simples.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };

export const TEST_MNEMONIC = 'test test test test test test test test test test test junk'; // seed pública de testes
export const TEST_PASSWORD = 'senha-de-teste-123';
export const POL_USD = 0.09;
export const USD_BRL = 5.4;

export function startStaticServer(port) {
    const server = http.createServer((req, res) => {
        let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
        if (p.endsWith(path.sep) || p === ROOT) p = path.join(p, 'index.html');
        if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
        fs.readFile(p, (err, data) => {
            if (err) { res.writeHead(404); res.end('not found'); return; }
            res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    return new Promise((resolve) => server.listen(port, () => resolve({ server, url: `http://localhost:${port}/` })));
}

export function launch() {
    return chromium.launch({
        args: ['--no-sandbox'],
        ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
    });
}

function candles(n, stepSec, base) {
    const now = Math.floor(Date.now() / 1000 / stepSec) * stepSec;
    return Array.from({ length: n }, (_, i) => {
        const t = (now - (n - 1 - i) * stepSec) * 1000;
        const drift = i === n - 1 ? 0 : 0.004; // a última vela fecha no preço atual
        const o = base * (1 + 0.004 * Math.sin(i / 3)), c = base * (1 + drift * Math.sin((i + 1) / 3));
        return [t, String(o), String(Math.max(o, c) * 1.002), String(Math.min(o, c) * 0.998), String(c), '1000', t + stepSec * 1000 - 1, '90', 10, '500', '45', '0'];
    });
}

// Toda a rede externa é simulada: RPC da Polygon -> MockChain; cotações -> valores fixos; o resto é cortado.
// Devolve a lista de pedidos externos feitos pela página (para conferir que nada inesperado sai).
export async function mockNetwork(page, chain) {
    const external = [];
    await page.route((u) => !u.href.startsWith('http://localhost'), async (route) => {
        const req = route.request();
        const u = req.url();
        external.push(u);
        const json = (obj) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
        if (req.method() === 'POST' && /polygon|matic/i.test(u)) {
            try { return json(chain.handle(JSON.parse(req.postData()))); } catch (e) { return route.abort(); }
        }
        if (/awesomeapi.*USD-BRL/.test(u)) return json({ USDBRL: { bid: String(USD_BRL), ask: String(USD_BRL) } });
        if (/coins\.llama\.fi\/prices\/current\/polygon/.test(u)) return json({ coins: { 'polygon:0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270': { price: chain.priceUsd } } });
        if (/coins\.llama\.fi\/prices\/current\/coingecko/.test(u)) return json({ coins: { 'coingecko:ethereum': { price: 3000 }, 'coingecko:bitcoin': { price: 90000 } } });
        if (/api\.binance\.com\/api\/v3\/klines/.test(u)) return json(candles(Number(new URL(u).searchParams.get('limit')) || 90, 900, chain.priceUsd));
        return route.abort();
    });
    return external;
}

export async function openApp(context, url, chain) {
    const page = await context.newPage();
    const pageErrors = [];
    const dialogs = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept().catch(() => {}); });
    const cspViolations = [];
    page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text().slice(0, 200)); });
    const external = await mockNetwork(page, chain);
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.ethers && window.RdeskWallet && window.RdeskDefi && window.RdeskReceipt, null, { timeout: 60000 });
    await page.waitForTimeout(800);
    return { page, pageErrors, dialogs, external, cspViolations };
}

// Importa a carteira de teste pelo próprio modal (cliques reais).
export async function importWalletViaUi(page, { name = 'Principal', mnemonic = TEST_MNEMONIC, password = TEST_PASSWORD } = {}) {
    await page.click('#btn-wallet-trigger');
    if (await page.locator('#rmw-goto-add').count()) await page.click('#rmw-goto-add');
    await page.locator('#rdesk-mw-sheet .rmw-opt-btn', { hasText: 'Importar frase-semente' }).click();
    await page.fill('#rmw-f-name', name);
    await page.fill('#rmw-f-seed-input', mnemonic);
    if (await page.locator('#rmw-f-pass').count()) await page.fill('#rmw-f-pass', password);
    await page.click('#rmw-f-submit');
    await page.waitForFunction(() => window.RdeskWallet.isConnected() && window.RdeskWallet.isUnlocked(), null, { timeout: 30000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.RdeskWallet.closeModal());
}

const results = [];
export function check(name, cond, detail = '') {
    results.push({ name, ok: Boolean(cond), detail });
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
}
export function finish() {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} verificações passaram.`);
    if (failed.length) {
        console.log('Falharam:\n' + failed.map((f) => ` - ${f.name} ${f.detail}`).join('\n'));
        process.exitCode = 1;
    }
}
