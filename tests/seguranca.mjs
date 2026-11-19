// Revisão de segurança (v42): cada falha encontrada na auditoria tem uma verificação aqui.
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, waitFn, TEST_PASSWORD, ROOT } from './helpers.mjs';
import { MockChain, ethers } from './mock-chain.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';

// ---------------------------------------------------------------- partes sem navegador
const require = createRequire(import.meta.url);
globalThis.window = globalThis; globalThis.ethers = ethers;
require(path.join(ROOT, 'bitcoin.js'));
require(path.join(ROOT, 'registry.js'));
const REG = globalThis.RdeskRegistry;
check('R$: "10.50" é dez e cinquenta (não mil e cinquenta)', REG.parseBRL('10.50') === 10.5);
check('R$: "1.234" é mil duzentos e trinta e quatro', REG.parseBRL('1.234') === 1234);
check('R$: "1.234,56" e "R$ 25" continuam certos', REG.parseBRL('1.234,56') === 1234.56 && REG.parseBRL('R$ 25') === 25);
check('R$: texto estranho é recusado', REG.parseBRL('10,5,3') === null && REG.parseBRL('abc') === null);

const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' };
const { server, url } = await startStaticServer(8791);
const browser = await launch();
try {
    const ctx = await browser.newContext(MOBILE);
    const { page, pageErrors, cspViolations } = await openApp(ctx, url, { 137: new MockChain({}) }, {});

    // ------------------------------------------------------------ QR de cobrança de token (EIP-681)
    const qr = await page.evaluate(() => {
        const P = window.RdeskQrScanner.parsePayload;
        const usdt = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', dest = '0x1111111111111111111111111111111111111111';
        return {
            transfer: P(`ethereum:${usdt}@137/transfer?address=${dest}&uint256=1e6`),
            semDestino: P(`ethereum:${usdt}@137/transfer?uint256=1e6`),
            outraFuncao: P(`ethereum:${usdt}@137/approve?address=${dest}`),
            simples: P(`ethereum:${dest}@8453`)
        };
    });
    check('QR de cobrança de token: destino é quem recebe, não o contrato', qr.transfer.address === '0x1111111111111111111111111111111111111111' && /c2132/i.test(qr.transfer.tokenAddress) && qr.transfer.chainId === 137, JSON.stringify(qr.transfer));
    check('QR de token sem destinatário ou com outra função não vira endereço', qr.semDestino.kind === 'text' && qr.outraFuncao.kind === 'text');
    check('QR comum continua funcionando', qr.simples.kind === 'evm' && qr.simples.chainId === 8453);

    // ------------------------------------------------------------ pedido de assinatura sem internet
    const ag = await page.evaluate(() => {
        const enc = (o) => 'RDESK1REQ:' + btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const base = { v: 1, f: 'bc1q4qw42stdzjqs59xvlrlxr8526e3nunw7mp73te', t: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', a: 50000, r: 5, u: [['ab'.repeat(32), 0, 100000]] };
        const tryIt = (o) => { try { window.RdeskAirgap.decodeRequest(enc({ ...base, ...o })); return 'aceito'; } catch (e) { return 'recusado'; } };
        return { ok: tryIt({}), taxaZero: tryIt({ r: 0 }), taxaQuebrada: tryIt({ r: 1.5 }), taxaAbsurda: tryIt({ r: 9999 }), valorPo: tryIt({ a: 10 }), repetida: tryIt({ u: [['ab'.repeat(32), 0, 100000], ['ab'.repeat(32), 0, 100000]] }) };
    });
    check('pedido sem internet normal é aceito', ag.ok === 'aceito');
    check('pedido com taxa zero, quebrada ou absurda é recusado', ag.taxaZero === 'recusado' && ag.taxaQuebrada === 'recusado' && ag.taxaAbsurda === 'recusado', JSON.stringify(ag));
    check('pedido com valor abaixo do mínimo ou moeda repetida é recusado', ag.valorPo === 'recusado' && ag.repetida === 'recusado');

    // ------------------------------------------------------------ gráfico: preço errado por vários dias
    const ds = await page.evaluate(() => {
        const days = {}; for (let i = 1; i <= 20; i++) days[`2026-01-${String(i).padStart(2, '0')}`] = 100;
        days['2026-01-09'] = 210; days['2026-01-10'] = 205; days['2026-01-11'] = 199; // três dias seguidos errados
        const fixed = window.RdeskHistory?._despike ? window.RdeskHistory._despike({ ...days }) : null;
        const step = {}; for (let i = 1; i <= 20; i++) step[`2026-01-${String(i).padStart(2, '0')}`] = i <= 10 ? 100 : 200; // mudança real de patamar
        const kept = window.RdeskHistory._despike({ ...step });
        return { bad: fixed && [fixed['2026-01-09'], fixed['2026-01-10'], fixed['2026-01-11']], kept: Object.values(kept) };
    });
    check('gráfico: 3 dias seguidos de preço errado são corrigidos', ds.bad && ds.bad.every((v) => v === 100), JSON.stringify(ds.bad));
    check('gráfico: mudança de preço de verdade é mantida', ds.kept.slice(10).every((v) => v === 200) && ds.kept.slice(0, 10).every((v) => v === 100), JSON.stringify(ds.kept));

    // ------------------------------------------------------------ nome da carteira com HTML
    await importWalletViaUi(page, { name: '<img id="pwn" src="x"><b id="pwn2">oi</b>' });
    await page.evaluate(() => window.RdeskWallet.openModal());
    await page.waitForSelector('#rdesk-mw-sheet');
    check('nome da carteira com HTML aparece como texto, sem virar código', (await page.locator('#pwn, #pwn2').count()) === 0 && /&lt;|<img/.test(await page.innerText('#rdesk-mw-sheet')));
    await page.evaluate(() => window.RdeskWallet.closeModal());

    // ------------------------------------------------------------ PIN/senha: limite de tentativas
    await page.evaluate(() => window.RdeskWallet.lockVault());
    const tries = await page.evaluate(async () => {
        const out = [];
        for (let i = 0; i < 6; i++) { try { await window.RdeskWallet.unlockWithPassword('errada-' + i); out.push('abriu'); } catch (e) { out.push(e.message); } }
        let certa;
        try { await window.RdeskWallet.unlockWithPassword('senha-de-teste-123'); certa = 'abriu'; } catch (e) { certa = e.message; }
        return { out, certa, wait: window.RdeskWallet.unlockWaitMs() };
    });
    check('5 erros seguidos: o 6º já pede para esperar', /Muitas tentativas/.test(tries.out[5]) && !/Muitas/.test(tries.out[4]), tries.out.join(' | '));
    check('durante a espera nem a senha certa abre (nada de chutar rápido)', /Muitas tentativas/.test(tries.certa) && tries.wait > 20000 && tries.wait <= 30000, `${tries.certa} ${tries.wait}`);
    await page.reload({ waitUntil: 'load' });
    await waitFn(page, () => window.RdeskWallet, null, { timeout: 30000 });
    check('recarregar a página não zera a espera', (await page.evaluate(() => window.RdeskWallet.unlockWaitMs())) > 15000);
    await page.evaluate(() => localStorage.setItem('rdesk_unlock_fails_v1', JSON.stringify({ n: 5, until: 0 }))); // "passou o tempo"
    const after = await page.evaluate(async (pw) => { try { await window.RdeskWallet.unlockWithPassword(pw); return { ok: true, left: localStorage.getItem('rdesk_unlock_fails_v1') }; } catch (e) { return { ok: false, m: e.message }; } }, TEST_PASSWORD);
    check('depois da espera, a senha certa abre e a contagem zera', after.ok && after.left === null, JSON.stringify(after));
    await page.waitForSelector('#vault-screen', { state: 'hidden', timeout: 15000 }).catch(() => {});

    // ------------------------------------------------------------ ver as palavras: 3 erros trancam
    await page.evaluate(() => window.RdeskWallet.openModal());
    await page.waitForSelector('#rdesk-mw-sheet');
    await page.click('#rdesk-mw-sheet [data-detail-acc]');
    await page.waitForSelector('#rmw-det-show-seed');
    const revealBtn = page.locator('#rmw-det-show-seed');
    if (await revealBtn.count()) {
        await revealBtn.click();
        for (let i = 0; i < 3; i++) {
            if (!(await page.locator('#rmw-reveal-pass').count())) break;
            await page.fill('#rmw-reveal-pass', 'errada');
            await page.click('#rmw-reveal-confirm');
            await page.waitForTimeout(150);
        }
        check('ver as palavras: 3 erros com o cofre aberto trancam o cofre', await page.evaluate(() => window.RdeskWallet.isLocked()));
    } else {
        check('ver as palavras: 3 erros com o cofre aberto trancam o cofre', false, 'botão de ver as palavras não encontrado');
    }

    // ------------------------------------------------------------ apagar tudo: só o que é deste app
    await page.evaluate(async () => {
        localStorage.setItem('fila_pedidos_config', 'da pastelaria');
        await new Promise((res) => { const r = indexedDB.open('outro_app_db', 1); r.onupgradeneeded = () => r.result.createObjectStore('x'); r.onsuccess = () => { r.result.close(); res(); }; });
        const c = await caches.open('outro-app-cache'); await c.put('/outro', new Response('x'));
    });
    const wiped = await page.evaluate(async () => {
        await window.RdeskAnon.wipeAll();
        const dbs = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [];
        return { ours: Object.keys(localStorage).filter((k) => /^rdesk/.test(k)), other: localStorage.getItem('fila_pedidos_config'), dbs, caches: await caches.keys() };
    });
    check('apagar tudo remove os dados do cofre', wiped.ours.length === 0 && !wiped.dbs.includes('rdesk_vault_backup'), JSON.stringify(wiped));
    check('apagar tudo NÃO apaga os outros sites do mesmo endereço (ex.: sistema de fila)', wiped.other === 'da pastelaria' && wiped.dbs.includes('outro_app_db') && wiped.caches.includes('outro-app-cache'), JSON.stringify(wiped));

    // ------------------------------------------------------------ dentro de moldura de outro site
    const framePage = await ctx.newPage();
    await framePage.setContent(`<iframe id="f" src="${url}" style="width:390px;height:700px"></iframe>`);
    await framePage.waitForTimeout(2500);
    const framed = await framePage.evaluate(() => location.href).catch(() => '');
    const hidden = await (async () => { try { const f = framePage.frames().find((x) => x !== framePage.mainFrame()); return f ? await f.evaluate(() => getComputedStyle(document.documentElement).display === 'none') : true; } catch (e) { return true; } })();
    check('o cofre não funciona dentro da moldura de outro site (fica escondido ou sai da moldura)', hidden || framed.startsWith(url), `${framed} hidden=${hidden}`);
    await framePage.close();

    check('sem erros de JavaScript nem violação de CSP', pageErrors.length === 0 && cspViolations.length === 0, [...pageErrors, ...cspViolations].slice(0, 3).join(' | '));
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
