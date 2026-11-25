// v46.3: leitura de saldos robusta (como pelo Tor no app Android):
//  - se o 1º servidor de uma rede recusa (ex.: Cloudflare bloqueando o Tor), o app usa o próximo;
//  - barra de progresso mostra cada rede sendo consultada;
//  - ao abrir de novo, o último saldo aparece na hora, marcado como "salvo", enquanto a rede atualiza.
import { startStaticServer, launch, openApp, importWalletViaUi, unlockViaDoor, check, finish, TEST_MNEMONIC, POL_USD, waitFn } from './helpers.mjs';
import { MockChain, ADDR, ethers } from './mock-chain.mjs';

const OWNER = ethers.Wallet.fromMnemonic(TEST_MNEMONIC).address.toLowerCase();
const chain = new MockChain({ polPriceUsd: POL_USD });
chain.fundNative(OWNER, 50);
chain.fundToken(ADDR.USDC, OWNER, 100);

const { server, url } = await startStaticServer(8797);
const browser = await launch();
try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });

    // ------------------------------------------------------------ 1. 1º servidor da Polygon recusando
    const a = await openApp(ctx, url, chain, { rpcDown: /polygon-bor-rpc\.publicnode\.com/ });
    const page = a.page;
    const balReqs = [];
    page.on('request', (r) => { const d = r.postData() || ''; if (/polygon\.drpc\.org/.test(r.url()) && /eth_getBalance/.test(d) && /0x70a08231/.test(d)) balReqs.push(d); });
    await importWalletViaUi(page);
    await page.evaluate(() => window.RdeskWallet.refreshBalances());
    await waitFn(page, () => {
        const b = window.RdeskWallet.getBalances();
        return b.some((x) => x.chainId === 137 && x.symbol === 'POL' && x.amount > 0);
    }, null, { timeout: 40000 }).catch(() => {});
    const bals = await page.evaluate(() => window.RdeskWallet.getBalances().filter((x) => x.chainId === 137).map((x) => `${x.symbol}=${x.amount}`).join(' '));
    check('1º servidor da Polygon recusando: o saldo vem do servidor seguinte', /POL=50\b/.test(bals) && /USDC=100\b/.test(bals), bals);
    check('o servidor de reserva foi usado de fato', a.external.some((u) => /polygon\.drpc\.org/.test(u)), a.external.filter((u) => /polygon|drpc/.test(u)).slice(0, 4).join(' '));
    const lote = balReqs.length ? JSON.parse(balReqs[0]) : null;
    check('todas as moedas da rede num pedido só (lote), não um por moeda', Array.isArray(lote) && lote.length === 8, lote ? `${lote.length} moedas no 1º pedido` : 'nenhum');

    await waitFn(page, () => document.querySelector('#sync-bar .sync-step') !== null, null, { timeout: 10000 }).catch(() => {});
    const steps = await page.$$eval('#sync-bar .sync-step', (els) => els.map((e) => `${e.className.replace('sync-step ', '')}:${e.textContent.trim()}`));
    check('barra de progresso mostra cada rede (Polygon, Ethereum, Base…)', steps.some((s) => /Polygon/.test(s)) && steps.some((s) => /Ethereum/.test(s)) && steps.length >= 6, steps.join(' | '));
    check('Polygon aparece como lida (✓)', steps.some((s) => /^ok:.*Polygon/.test(s)), steps.find((s) => /Polygon/.test(s)));
    const fill = await page.$eval('#sync-bar .sync-fill', (e) => e.style.width).catch(() => '');
    check('barra chega a 100% quando todas as redes terminam', fill === '100%', fill);

    const snap = await page.evaluate(() => JSON.parse(localStorage.getItem('rdesk_saldos_salvos_v1') || '{}'));
    const mine = snap[OWNER];
    check('saldo salvo neste aparelho, com o preço de cada moeda', mine && mine.list.some((x) => x.chainId === 137 && x.symbol === 'POL' && x.amount === 50) && mine.units['137:POL'] > 0, JSON.stringify(mine?.units || {}).slice(0, 120));
    const totalAntes = await page.innerText('#hero-total-brl');
    check('saldo total na tela antes de fechar', /R\$\s*[1-9]/.test(totalAntes), totalAntes);
    await page.close();

    // ------------------------------------------------------------ 2. abre de novo com a rede travada
    const b = await openApp(ctx, url, chain, { rpcHang: /./ });
    const p2 = b.page;
    await unlockViaDoor(p2);
    await p2.waitForTimeout(1500);
    const totalDepois = await p2.innerText('#hero-total-brl');
    check('ao abrir, o saldo salvo aparece na hora (não R$ 0,00)', totalDepois === totalAntes, `${totalAntes} -> ${totalDepois}`);
    const head = await p2.innerText('#sync-bar .sync-head').catch(() => '');
    check('aviso: é o saldo salvo e a rede ainda está atualizando', /saldo salvo/i.test(head) && /atualizando/i.test(head), head);
    const tag = await p2.locator('.asset-row .saved-tag').count();
    check('cada moeda mostra a marca "salvo" enquanto não atualiza', tag > 0, `${tag} moedas`);
    const running = await p2.locator('#sync-bar.running .sync-spin').count();
    check('redes em andamento giram na barra de progresso', running > 0, `${running}`);
    check('sem erros de JavaScript', !a.pageErrors.length && !b.pageErrors.length, [...a.pageErrors, ...b.pageErrors].join(' | '));

    // ------------------------------------------------------------ 3. modo anônimo não guarda saldo
    await p2.evaluate(() => { window.RdeskAnon.set(true); });
    await p2.waitForTimeout(300);
    const anon = await p2.evaluate(() => localStorage.getItem('rdesk_saldos_salvos_v1'));
    check('modo anônimo: nenhum saldo fica guardado no aparelho', anon === null, String(anon).slice(0, 60));
} finally {
    await browser.close();
    server.close();
}
finish();
