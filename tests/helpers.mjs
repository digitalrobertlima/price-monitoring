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

// Preço de cada dia no passado (d = dias atrás) usado no histórico simulado
export function histPrice(key, d) {
    const k = String(key).toLowerCase();
    if (k.includes('0x0d500b1d')) return POL_USD + 0.0005 * d;      // POL: um pouco mais caro no passado
    if (k.includes('0x1bfd6703')) return 90000 + 1000 * d;          // BTC (WBTC)
    if (k.includes('0x7ceb23fd')) return 3000;                      // ETH (WETH)
    return 1;
}
export const CHANGE_24H = {
    'coingecko:bitcoin': -2, 'coingecko:ethereum': 1, 'coingecko:tether': 0, 'coingecko:usd-coin': 0,
    'polygon:0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 3, 'polygon:0x4ed141110f6eeeaba9a1df36d8c26f684d2475dc': -1, 'coingecko:celo': 0
};

// Histórico de uma carteira no formato da API do Blockscout (Polygon)
export function makeHistory(owner) {
    const W = owner.toLowerCase();
    const EOA = '0x1111111111111111111111111111111111111aaa';
    const EOA2 = '0x2222222222222222222222222222222222222bbb';
    const POOL = '0x9b08288c3be4f62bbf8d1c20ac9c5e6f9467d8b7';
    const NFPM = '0xc36442b4a4522e871399cd717abdd847ab11fe88';
    const ROUTER = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45';
    const USDT = '0xc2132d05d31c914a87c6611c10748aeb04b58e8f';
    const WPOL = '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270';
    const SPAM = '0x5555555555555555555555555555555555555555';
    const day = (d, h = 12) => new Date(Math.floor(Date.now() / 86400000) * 86400000 - d * 86400000 + h * 3600000).toISOString();
    const wei = (x, dec = 18) => (BigInt(Math.round(x * 1e6)) * 10n ** BigInt(dec - 6)).toString();
    const a = (hash, isC) => ({ hash, is_contract: isC });
    let n = 0;
    const H = () => `0x${(++n).toString(16).padStart(64, '0')}`;
    const txs = [], transfers = [], internals = [];
    const tx = (d, to, toC, value, method, status = 'ok', from = W) => { const h = H(); txs.push({ hash: h, timestamp: day(d), from: a(from, false), to: a(to, toC), value: wei(value), fee: { value: wei(0.02) }, status, method }); return h; };
    const tr = (h, d, token, from, fromC, to, toC, amt, dec, symbol) => transfers.push({ transaction_hash: h, timestamp: day(d), from: a(from, fromC), to: a(to, toC), token: { address_hash: token, type: 'ERC-20', symbol }, total: { value: wei(amt, dec) } });
    // 1) recebeu 1000 POL de outra pessoa (20 dias atrás) -> entrada
    txs.push({ hash: H(), timestamp: day(20), from: a(EOA, false), to: a(W, false), value: wei(1000), fee: { value: '0' }, status: 'ok', method: null });
    // 2) trocou 300 POL por USDT (18 dias atrás)
    const h2 = tx(18, ROUTER, true, 300, 'exactInputSingle');
    tr(h2, 18, USDT, POOL, true, W, false, 28, 6, 'USDT0');
    // 3) colocou para render: 10 USDT + 100 WPOL (15 dias atrás)
    const h3 = tx(15, NFPM, true, 0, 'mint');
    tr(h3, 15, USDT, W, false, POOL, true, 10, 6, 'USDT0');
    tr(h3, 15, WPOL, W, false, POOL, true, 100, 18, 'WPOL');
    // 4) recebeu 50 USDT de outra pessoa (10 dias atrás) -> entrada
    const h4 = H();
    tr(h4, 10, USDT, EOA2, false, W, false, 50, 6, 'USDT0');
    // 5) tirou do render: 90 WPOL + 12 USDT (5 dias atrás)
    const h5 = tx(5, NFPM, true, 0, 'multicall');
    tr(h5, 5, WPOL, POOL, true, W, false, 90, 18, 'WPOL');
    tr(h5, 5, USDT, POOL, true, W, false, 12, 6, 'USDT0');
    // 6) enviou 200 POL para outra pessoa (3 dias atrás) -> saída
    tx(3, EOA, false, 200, null);
    // 7) autorizou USDT (2 dias atrás) e 8) operação que falhou (1 dia atrás)
    tx(2, USDT, true, 0, 'approve');
    tx(1, ROUTER, true, 0, 'exactInputSingle', 'error');
    // moeda-lixo que não pode entrar na conta
    tr(H(), 4, SPAM, EOA, false, W, false, 1000000, 18, 'FAKE');
    return { txs, transfers, internals };
}

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
            // Simula servidor instável (como a Rabby devolvendo "bad response" ao esperar a confirmação)
            if (opts.badReceipts > 0) {
                try {
                    const body = JSON.parse(req.postData());
                    const calls = Array.isArray(body) ? body : [body];
                    if (calls.some((c) => c.method === 'eth_getTransactionReceipt')) { opts.badReceipts--; return text('bad response', 502); }
                } catch (e) {}
            }
            try { return json(chain.handle(JSON.parse(req.postData()))); } catch (e) { return route.abort(); }
        }
        if (/awesomeapi.*USD-BRL/.test(u)) return opts.failFx ? route.abort() : json({ USDBRL: { bid: String(USD_BRL), ask: String(USD_BRL) } });
        if (/open\.er-api\.com/.test(u)) return opts.failFx === 'all' ? route.abort() : json({ rates: { BRL: USD_BRL } });
        // Histórico (Blockscout), preços de cada dia (DefiLlama e PTAX do BCB) e variação em 24 h
        if (/polygon\.blockscout\.com\/api\/v2\/addresses\//.test(u)) {
            if (opts.historyDown) return text('erro', 503);
            const m = u.match(/addresses\/(0x[0-9a-fA-F]{40})\/(transactions|token-transfers|internal-transactions)/);
            const h = opts.history && m ? opts.history(m[1].toLowerCase()) : null;
            const kind = m ? m[2] : '';
            return json({ items: h ? (kind === 'transactions' ? h.txs : kind === 'token-transfers' ? h.transfers : h.internals) : [], next_page_params: null });
        }
        if (/coins\.llama\.fi\/chart\//.test(u)) {
            const keys = decodeURIComponent(u.split('/chart/')[1].split('?')[0]).split(',');
            const coins = {};
            const today = Math.floor(Date.now() / 86400000) * 86400;
            keys.forEach((k) => {
                const prices = [];
                for (let d = 60; d >= 1; d--) prices.push({ timestamp: today - d * 86400, price: histPrice(k, d) });
                coins[k] = { prices };
            });
            return json({ coins });
        }
        if (/olinda\.bcb\.gov\.br/.test(u)) {
            const value = [];
            for (let d = 60; d >= 0; d--) value.push({ cotacaoVenda: USD_BRL, dataHoraCotacao: `${new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)} 13:00:00.000` });
            return json({ value });
        }
        if (/coins\.llama\.fi\/batchHistorical/.test(u)) {
            const q = JSON.parse(new URL(u).searchParams.get('coins'));
            const coins = {};
            const todayStart = Math.floor(Date.now() / 86400000) * 86400;
            Object.entries(q).forEach(([k, list]) => {
                coins[k] = { prices: list.map((ts) => {
                    const d = Math.max(0, Math.round((todayStart - Math.floor(ts / 86400) * 86400) / 86400));
                    const base = k === 'coingecko:bitcoin' ? histPrice('0x1bfd6703', d) : k === 'coingecko:ethereum' ? 3000 : histPrice(k, d);
                    return { timestamp: ts + 60, price: base * (opts.exactBump || 1), confidence: 0.99 };
                }) };
            });
            return json({ coins });
        }
        if (/coins\.llama\.fi\/percentage\//.test(u)) {
            const keys = decodeURIComponent(u.split('/percentage/')[1].split('?')[0]).split(',');
            const coins = {};
            keys.forEach((k) => { coins[k] = CHANGE_24H[k.toLowerCase()] ?? 0; });
            return json({ coins });
        }
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
    // Os testes de fluxo começam com o tutorial já visto; o teste do tutorial passa opts.onboarding = true.
    if (!opts.onboarding) {
        await page.addInitScript(() => {
            try {
                if (!localStorage.getItem('rdesk_onboarding_v1')) {
                    localStorage.setItem('rdesk_onboarding_v1', JSON.stringify({ introDone: true, finished: true, hidden: false, did: {}, tips: { receive: 1, send: 1, pixswap: 1, earn: 1, audit: 1, addtoken: 1 } }));
                }
            } catch (e) {}
        });
    }
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
