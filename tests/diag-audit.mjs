// Diagnóstico (rede real): roda a auditoria numa carteira pública e imprime como cada transação foi classificada.
import { startStaticServer, launch, waitFn } from './helpers.mjs';
const ADDRESS = process.env.DIAG_ADDRESS || '0x2833a1C3dDe3B5d2265F057301a89bEf1BB50fe3';
const { server, url } = await startStaticServer(8790);
const browser = await launch();
try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx.addInitScript(() => localStorage.setItem('rdesk_onboarding_v1', JSON.stringify({ introDone: true, finished: true, did: {}, tips: { audit: 1, earn: 1, pixswap: 1 } })));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('ERRO', e.message));
    await page.goto(url, { waitUntil: 'load' });
    await waitFn(page, () => window.RdeskWallet && window.RdeskDefi, null, { timeout: 60000 });
    await page.click('#btn-wallet-trigger');
    await page.locator('#rdesk-mw-sheet .rmw-opt-btn', { hasText: 'observação' }).click();
    await page.fill('#rmw-f-watch-input', ADDRESS);
    await page.click('#rmw-f-submit');
    await waitFn(page, () => window.RdeskWallet.isConnected(), null, { timeout: 30000 });
    await page.evaluate(async () => { window.RdeskWallet.closeModal(); await window.RdeskWallet.refreshBalances(); });
    const t0 = Date.now();
    await page.evaluate(() => window.RdeskDefi.runAudit(true));
    console.log('auditoria levou', Date.now() - t0, 'ms');
    const d = await page.evaluate(() => window.RdeskDefi.getAuditDebug());
    console.log('transações:', d.txs.length, 'eventos:', d.events.length);
    const counts = {};
    d.events.forEach((e) => { counts[e.autoClass] = (counts[e.autoClass] || 0) + 1; });
    console.log('classes:', JSON.stringify(counts));
    d.txs.forEach((tx, i) => {
        const ev = d.events[i];
        if (!tx.inflows.length && !tx.outflows.length) return;
        const fl = (arr, k) => arr.map((x) => `${k}${x.amount.toFixed(4)} ${x.symbol}${x.fromIsC || x.toIsC ? '(C)' : ''}`).join(' ');
        console.log(`${tx.dateKey} ${tx.hash.slice(0, 10)} contrato=${tx.touchedContract ? 'S' : 'N'} ${fl(tx.inflows, '+')} ${fl(tx.outflows, '-')} => ${ev.autoClass} in$${ev.inUsd.toFixed(2)} out$${ev.outUsd.toFixed(2)}`);
    });
    console.log('TELA:', (await page.innerText('#tab-panel-audit')).replace(/\s+/g, ' ').slice(0, 300));
    const raw = await page.evaluate(async (a) => {
        const r = await fetch(`https://polygon.blockscout.com/api/v2/addresses/${a}/token-transfers`);
        const j = await r.json();
        return j.items.slice(-15).map((x) => `${x.timestamp.slice(0, 10)} ${x.token?.symbol} ${x.token?.address_hash || x.token?.address} from=${x.from?.hash?.slice(0, 8)}(${x.from?.is_contract}) to=${x.to?.hash?.slice(0, 8)}(${x.to?.is_contract}) tipo=${x.type} metodo=${x.method}`);
    }, ADDRESS);
    console.log('MAIS ANTIGAS (token-transfers, pág. 1 final):\n' + raw.join('\n'));
} finally { await browser.close(); server.close(); }
