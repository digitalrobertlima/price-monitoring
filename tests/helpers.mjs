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

export function launch(extraArgs = []) {
    return chromium.launch({
        args: ['--no-sandbox', ...extraArgs],
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

// Descobre a rede pelo endereço do servidor RPC.
function chainIdFromRpcUrl(u) {
    if (/polygon|matic/i.test(u)) return 137;
    if (/arb/i.test(u)) return 42161;
    if (/base/i.test(u)) return 8453;
    if (/optimism/i.test(u)) return 10;
    if (/celo/i.test(u)) return 42220;
    if (/ethereum-rpc|eth\.drpc/i.test(u)) return 1;
    return null;
}

// Toda a rede externa é simulada: RPC de cada rede -> MockChain; cotações -> valores fixos; Bitcoin -> opts.btc;
// o resto é cortado. `chains` é a MockChain da Polygon ou um mapa { chainId: MockChain }.
// Devolve a lista de pedidos externos feitos pela página (para conferir que nada inesperado sai).
export async function mockNetwork(page, chains, opts = {}) {
    const map = chains && typeof chains.handle === 'function' ? { 137: chains } : (chains || {});
    const polygon = map[137];
    const external = [];
    await page.route((u) => !u.href.startsWith('http://localhost'), async (route) => {
        const req = route.request();
        const u = req.url();
        external.push(u);
        const json = (obj) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) });
        const text = (body, status = 200) => route.fulfill({ status, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body });

        // Bitcoin (API estilo Esplora)
        if (/mempool\.space\/api|blockstream\.info\/api/.test(u)) {
            const btc = opts.btc;
            if (!btc) return route.abort();
            if (/\/v1\/fees\/recommended/.test(u)) return json(btc.fees);
            if (/\/address\/[^/]+\/utxo/.test(u)) return json(btc.utxos.map((x) => ({ txid: x.txid, vout: x.vout, value: x.value, status: { confirmed: x.confirmed !== false } })));
            if (/\/address\/[^/]+$/.test(u)) {
                const conf = btc.utxos.filter((x) => x.confirmed !== false).reduce((n, x) => n + x.value, 0);
                const pend = btc.utxos.filter((x) => x.confirmed === false).reduce((n, x) => n + x.value, 0);
                return json({ chain_stats: { funded_txo_sum: conf, spent_txo_sum: 0 }, mempool_stats: { funded_txo_sum: pend, spent_txo_sum: 0 } });
            }
            if (/\/tx$/.test(u) && req.method() === 'POST') { btc.broadcasts.push(req.postData()); return text(btc.txid || 'f'.repeat(64)); }
            return route.abort();
        }

        if (req.method() === 'POST') {
            const chain = map[chainIdFromRpcUrl(u)];
            if (!chain) return route.abort();
            try { return json(chain.handle(JSON.parse(req.postData()))); } catch (e) { return route.abort(); }
        }
        if (/awesomeapi.*USD-BRL/.test(u)) return opts.failFx ? route.abort() : json({ USDBRL: { bid: String(USD_BRL), ask: String(USD_BRL) } });
        if (/open\.er-api\.com/.test(u)) return opts.failFx === 'all' ? route.abort() : json({ rates: { BRL: USD_BRL } });
        if (/coins\.llama\.fi\/prices\/current\//.test(u)) {
            const keys = decodeURIComponent(u.split('/prices/current/')[1].split('?')[0]).split(',');
            const coins = {};
            keys.forEach((k) => {
                if (/^polygon:0x0d500b1d/i.test(k)) coins[k] = { price: polygon ? polygon.priceUsd : POL_USD };
                else if (k === 'coingecko:ethereum') coins[k] = { price: 3000 };
                else if (k === 'coingecko:bitcoin') coins[k] = { price: 90000 };
                else if (k === 'coingecko:celo') coins[k] = { price: 0.5 };
                else if (opts.customPrices && opts.customPrices[k.split(':')[1].toLowerCase()]) coins[k] = { price: opts.customPrices[k.split(':')[1].toLowerCase()] };
            });
            return json({ coins });
        }
        if (/api\.binance\.com\/api\/v3\/klines/.test(u)) return json(candles(Number(new URL(u).searchParams.get('limit')) || 90, 900, polygon ? polygon.priceUsd : POL_USD));
        return route.abort();
    });
    return external;
}

// Espera uma condição dentro da página (por sondagem; funciona mesmo com a política CSP do site).
export async function waitFn(page, fn, arg, options = {}) {
    const timeout = options.timeout ?? 30000;
    const start = Date.now();
    for (;;) {
        let ok = false;
        try { ok = await page.evaluate(fn, arg); } catch (e) { if (!/Execution context was destroyed|navigation/i.test(e.message)) throw e; }
        if (ok) return ok;
        if (Date.now() - start > timeout) throw new Error(`Tempo esgotado (${timeout} ms) esperando: ${String(fn).slice(0, 120)}`);
        await page.waitForTimeout(150);
    }
}

export async function openApp(context, url, chain, opts = {}) {
    const page = await context.newPage();
    const pageErrors = [];
    const dialogs = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept().catch(() => {}); });
    const cspViolations = [];
    page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text().slice(0, 200)); });
    const external = await mockNetwork(page, chain, opts);
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await waitFn(page, () => window.ethers && window.RdeskWallet && window.RdeskDefi && window.RdeskReceipt, null, { timeout: 60000 });
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
    await waitFn(page, () => window.RdeskWallet.isConnected() && window.RdeskWallet.isUnlocked(), null, { timeout: 30000 });
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
