// Utilitários partilhados pelos testes: servidor estático, navegador e asserções simples.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };

export function startStaticServer(port = 8765) {
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

export async function launch() {
    return chromium.launch({
        args: ['--no-sandbox'],
        ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
    });
}

// Abre a app e devolve a página + a lista (viva) de erros de JavaScript.
export async function openApp(context, url) {
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('dialog', (d) => d.accept().catch(() => {}));
    if (process.env.OFFLINE_STUBS) {
        // Ambiente sem internet: simula só o gráfico de velas externo e corta o resto da rede.
        const stub = `(function(){const U=new Proxy(function(){},{get:(t,p)=>p===Symbol.toPrimitive?()=>0:(p==='then'?undefined:U),apply:()=>U,construct:()=>U});window.LightweightCharts=U;})();`;
        await page.route((u) => !u.href.startsWith('http://localhost'), (route) => {
            const u = route.request().url();
            if (/lightweight-charts/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: stub });
            return route.abort();
        });
    }
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(
        () => window.ethers && window.RdeskVault && window.RdeskLedger && window.RdeskGateway,
        null,
        { timeout: 60000 }
    );
    return { page, pageErrors };
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

export async function rpc(url, method, params = []) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    const json = await res.json();
    if (json.error) throw new Error(`${method}: ${json.error.message}`);
    return json.result;
}
