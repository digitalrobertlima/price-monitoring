// Extrato, resultado (lucro) desde a 1ª transação, gráfico de patrimônio na tela inicial e moeda de
// referência. Histórico simulado no formato da API do Blockscout, com preços diferentes a cada dia.
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, waitFn, TEST_MNEMONIC, POL_USD, USD_BRL, makeHistory, histPrice } from './helpers.mjs';
import { MockChain, ADDR, ethers } from './mock-chain.mjs';

const OWNER = ethers.Wallet.fromMnemonic(TEST_MNEMONIC).address;
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block', acceptDownloads: true };
const chain = new MockChain({ polPriceUsd: POL_USD });
chain.fundNative(OWNER, 400);
chain.fundToken(ADDR.USDT0, OWNER, 80);

const { server, url } = await startStaticServer(8771);
const browser = await launch();
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

try {
    const context = await browser.newContext(MOBILE);
    const netOpts = { history: (addr) => (addr === OWNER.toLowerCase() ? makeHistory(OWNER) : null), receipts: makeHistory(OWNER).receipts };
    const { page, pageErrors, cspViolations } = await openApp(context, url, chain, netOpts);
    const ui = (fn, arg) => page.evaluate(fn, arg);
    await importWalletViaUi(page);
    await ui(() => window.RdeskWallet.refreshBalances());
    await waitFn(page, () => window.RdeskHistory.getState().events > 0 && window.RdeskHistory.getState().seriesReady && !window.RdeskHistory.getState().loading, null, { timeout: 30000 });
    await page.waitForTimeout(600);

    // ================================================================ 1. Classificação
    const evs = await ui(() => window.RdeskHistory.getEvents());
    const titles = evs.map((e) => e.title);
    check('histórico lido desde a 1ª transação, moeda-lixo ignorada (9 transações)', evs.length === 9, titles.join(' | '));
    const sw2 = evs.find((e) => e.title === 'Trocou USDT por POL');
    const ren = evs.find((e) => e.title === 'Colocou para render');
    const out5 = evs.find((e) => e.title === 'Tirou do render');
    check('POL que volta dos contratos (fora do histórico da Polygon) é deduzido dos recibos',
        sw2 && sw2.items.some((i) => i.sym === 'POL' && i.dir > 0 && Math.abs(i.amt - 210) < 1e-9) &&
        ren && ren.items.some((i) => i.sym === 'POL' && i.dir < 0 && Math.abs(i.amt - 100) < 1e-9) &&
        out5 && out5.items.some((i) => i.sym === 'POL' && i.dir > 0 && Math.abs(i.amt - 5) < 1e-9), JSON.stringify([sw2?.items, ren?.items, out5?.items]));
    check('cada transação ganha um nome que qualquer um entende',
        ['Recebeu POL', 'Trocou POL por USDT', 'Colocou para render', 'Recebeu USDT', 'Tirou do render', 'Enviou POL', 'Autorizou o uso de USDT', 'Operação que falhou (só a taxa foi cobrada)'].every((t) => titles.includes(t)), titles.join(' | '));
    check('só transferências com pessoas contam como entrada/saída de dinheiro',
        evs.filter((e) => e.auto === 'IN').map((e) => e.title).join(',') === 'Recebeu POL,Recebeu USDT' && evs.filter((e) => e.auto === 'OUT').map((e) => e.title).join(',') === 'Enviou POL');

    check('entradas e saídas usam o preço do minuto da transação (não só o do dia)', (await ui(() => window.RdeskHistory.getState().exactPrices)) >= 3);

    // ================================================================ 2. Resultado conferido à mão
    await ui(() => window.RdeskHistory.setRef('USD'));
    const liveUsd = await ui(() => window.RdeskWallet.getBalances().reduce((s, b) => s + b.usdValue, 0));
    const inUsd = 1000 * histPrice('0x0d500b1d', 20) + 50;
    const outUsd = 200 * histPrice('0x0d500b1d', 3);
    let r = await ui(() => window.RdeskHistory.getResult());
    check('lucro em dólar = tem hoje + tirou − colocou (preços de cada dia)',
        near(r.inRef, inUsd, 1e-6) && near(r.outRef, outUsd, 1e-6) && near(r.pnlRef, liveUsd + outUsd - inUsd, 1e-6),
        `colocou ${r.inRef.toFixed(4)} (esperado ${inUsd}) tirou ${r.outRef.toFixed(4)} (${outUsd}) lucro ${r.pnlRef.toFixed(4)}`);
    check('lucro em reais usa o dólar de cada dia', near(r.pnlBrl, (liveUsd + outUsd - inUsd) * USD_BRL, 1e-6), `${r.pnlBrl.toFixed(2)}`);

    await ui(() => window.RdeskHistory.setRef('BTC'));
    r = await ui(() => window.RdeskHistory.getResult());
    const btc = (d) => histPrice('0x1bfd6703', d);
    const inBtc = 1000 * histPrice('0x0d500b1d', 20) / btc(20) + 50 / btc(10);
    const outBtc = outUsd / btc(3);
    check('com o Bitcoin como régua, cada entrada vale os bitcoins que comprava naquele dia',
        near(r.inRef, inBtc, 1e-6) && near(r.outRef, outBtc, 1e-6) && near(r.pnlRef, liveUsd / 90000 + outBtc - inBtc, 1e-6), `${r.pnlRef}`);

    // ================================================================ 3. Gráfico da tela inicial
    let ch = await ui(() => window.RdeskHistory.getState().chart);
    check('tela inicial mostra o gráfico do patrimônio com entradas e saídas marcadas', ch.points === 21 && ch.flowsIn === 2 && ch.flowsOut === 1, JSON.stringify(ch));
    const series = await ui(() => window.RdeskHistory.getSeries());
    await ui(() => window.RdeskHistory.setRef('USD'));
    const sUsd = await ui(() => window.RdeskHistory.getSeries());
    check('primeiro dia do gráfico = 1000 POL no preço daquele dia', near(sUsd[0].ref, 1000 * histPrice('0x0d500b1d', 20), 1e-6), `${sUsd[0].ref}`);
    const d16 = sUsd.find((p) => p.key === new Date(Date.now() - 16 * 86400000).toISOString().slice(0, 10));
    const d15 = sUsd.find((p) => p.key === new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 10));
    check('colocar para render não derruba o patrimônio (as moedas continuam suas)', d15 && d16 && d15.ref / d16.ref > 0.97, `${d16?.ref.toFixed(3)} → ${d15?.ref.toFixed(3)}`);
    // Depois de tirar do render (com o POL convertido em dólar dentro da pool) não sobra POL "fantasma"
    const d4 = sUsd.find((p) => p.key === new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10));
    const expectD4 = (1000 - 300 - 100 + 210 + 5 - 0.08) * histPrice('0x0d500b1d', 4) + (28 - 10 + 50 - 20 + 18);
    check('ao tirar do render, o patrimônio volta a ser só o que está na carteira (sem saldo fantasma)', d4 && near(d4.ref, expectD4, 1e-6), `${d4?.ref} esperado ${expectD4}`);
    check('sem saldo histórico na rede (servidor sem arquivo), o gráfico usa a reconstrução sem quebrar', (await ui(() => window.RdeskHistory.getState().nativeDays)) === 0);
    const maxRef = Math.max(...sUsd.map((p) => p.ref));
    check('o patrimônio nunca passa do que realmente entrou + ganhos plausíveis', maxRef < 160, `máximo ${maxRef.toFixed(2)} dólares`);
    check('o último ponto é o valor ao vivo de agora', sUsd[sUsd.length - 1].live && near(sUsd[sUsd.length - 1].ref, liveUsd, 1e-6));
    await ui(() => window.RdeskHistory.setRef('BTC'));
    void series;

    const canvas = page.locator('#home-chart canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await page.touchscreen.tap(box.x + box.width * 0.02, box.y + box.height / 2);
    await page.waitForTimeout(300);
    ch = await ui(() => window.RdeskHistory.getState().chart);
    check('tocar no gráfico mostra data, valor na régua e em reais, e o que entrou no dia', ch.hover === 0 && /BTC/.test(ch.tip) && /R\$/.test(ch.tip) && /entrou/.test(ch.tip), ch.tip);
    await page.screenshot({ path: 'tests/artifacts-hist-inicio.png', fullPage: true });
    const head = await page.locator('#home-chart-card h2, #home-chart-card .card-title, #home-chart-card').first().boundingBox();
    await page.touchscreen.tap(head.x + 20, head.y + 12);
    await page.waitForTimeout(250);
    check('tocar fora do gráfico esconde o balão', (await ui(() => window.RdeskHistory.getState().chart.hover)) === null && (await ui(() => document.querySelector('#home-chart .eq-tip').hidden)));
    await page.touchscreen.tap(box.x + box.width * 0.02, box.y + box.height / 2);
    await page.waitForTimeout(200);
    { const lb = await page.locator('.balance-label').boundingBox(); await page.touchscreen.tap(lb.x + 4, lb.y + lb.height / 2); }
    await page.waitForTimeout(250);
    check('tocar em qualquer lugar da tela também esconde', (await ui(() => window.RdeskHistory.getState().chart.hover)) === null);
    await page.click('#home-chart-range [data-range="7"]');
    check('"7 dias" mostra só a última semana', (await ui(() => window.RdeskHistory.getState().chart.points)) === 8);
    await page.click('#home-chart-range [data-range="all"]');

    // O ponto "agora" acompanha o preço ao vivo
    const before = await ui(() => window.RdeskHistory.getState().chart.last);
    chain.tick += 600;
    await waitFn(page, (b) => Math.abs(window.RdeskHistory.getState().chart.last - b) > 1e-12, before, { timeout: 30000 }).catch(() => {});
    const after = await ui(() => window.RdeskHistory.getState().chart.last);
    check('o gráfico se move sozinho quando o preço muda (sem recarregar)', Math.abs(after - before) > 1e-12, `${before} → ${after}`);
    chain.tick -= 600;

    // ================================================================ 4. Moeda de referência
    await page.click('#btn-ref-picker');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'tests/artifacts-hist-regua.png' });
    const picker = (await page.innerText('.ref-picker')).replace(/\s+/g, ' ');
    const squeezed = await page.$$eval('.ref-picker .ref-txt', (els) => els.some((e) => e.getBoundingClientRect().width < 200));
    check('opções da régua com texto em largura normal (sem espremer)', !squeezed);
    check('escolher a régua: Real (BRLS) (padrão), Bitcoin, Dólar e Ether, com explicação', ['Real (BRLS) (padrão)', 'Bitcoin', 'Dólar (USDT)', 'Ether'].every((s) => picker.includes(s)), picker.slice(0, 160));
    const polRow = () => page.innerText('#wallet-assets-list [data-asset-symbol="POL"]');
    const usdtRow = () => page.innerText('#wallet-assets-list [data-asset-chain="137"][data-asset-symbol="USDT"]');
    await page.click('.ref-picker [data-ref="BTC"]');
    await page.waitForTimeout(300);
    check('frente ao Bitcoin: POL +3% e BTC −2% em 24 h → POL +5,1%; dólar +2,04%', /\+5,1%/.test(await polRow()) && /\+2,04%/.test(await usdtRow()), `${(await polRow()).replace(/\s+/g, ' ')} | ${(await usdtRow()).replace(/\s+/g, ' ')}`);
    check('saldo em bitcoins sempre com 8 casas (0,00000000), com a variação frente ao Bitcoin', /≈ \d,\d{8} BTC$/.test(await page.innerText('#hero-total-usd')) && /frente ao Bitcoin/.test(await page.innerText('#hero-ref-change')),
        `${await page.innerText('#hero-total-usd')} | ${await page.innerText('#hero-ref-change')}`);
    await page.click('#btn-ref-picker');
    await page.click('.ref-picker [data-ref="BRL"]');
    await page.waitForTimeout(300);
    check('frente ao Real (BRLS): o dólar sobe quando o real cai (+1,01%)', /\+1,01%/.test(await usdtRow()), (await usdtRow()).replace(/\s+/g, ' '));
    check('régua escolhida fica salva', await ui(() => localStorage.getItem('rdesk_ref_currency_v1')) === 'BRL');
    await ui(() => window.RdeskHistory.setRef('BTC'));

    // ================================================================ 5. Extrato
    await page.click('.nav-tab-btn[data-tab="audit"]');
    await page.waitForSelector('.extrato-row');
    const rows = await page.$$eval('.extrato-row', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
    check('extrato lista todas as transações, da mais nova para a mais antiga', rows.length === 9 && /falhou/.test(rows[0]) && /Recebeu POL/.test(rows[8]), rows.map((x) => x.slice(0, 26)).join(' | '));
    const days = await page.$$eval('.extrato-day', (els) => els.map((e) => e.textContent));
    check('agrupado por dia, com "Ontem" e datas por extenso', days[0] === 'Ontem' && days.length === 9 && /de/.test(days[1]), days.join(', '));
    check('entradas mostram o valor em reais da data, com sinal', rows.some((x) => /Recebeu USDT.*\+R\$ 270,00/.test(x)), rows.find((x) => /Recebeu USDT/.test(x)));
    const pnlText = await page.innerText('#audit-kpi-pnl');
    check('resultado aparece na régua (Bitcoin, 8 casas) com o valor em reais embaixo', /^[+−]\d,\d{8} BTC/.test(pnlText) && /Em reais/.test(await page.innerText('#audit-kpi-pnl-brl')), `${pnlText} | ${await page.innerText('#audit-kpi-pnl-brl')}`);
    await page.screenshot({ path: 'tests/artifacts-hist-extrato.png', fullPage: true });
    for (const [f, n] of [['IN', 2], ['OUT', 1], ['SWAP', 2], ['RENDER', 2]]) {
        await page.click(`#extrato-filters [data-xf="${f}"]`);
        const c = await page.locator('.extrato-row').count();
        check(`filtro "${await page.innerText(`#extrato-filters [data-xf="${f}"]`)}" mostra ${n}`, c === n, String(c));
    }
    await page.click('#extrato-filters [data-xf="ALL"]');

    // Detalhe e reclassificação
    const pnlBefore = (await ui(() => window.RdeskHistory.getResult())).pnlRef;
    await page.locator('.extrato-row', { hasText: 'Trocou POL por USDT' }).click();
    await page.waitForSelector('.ex-detail');
    const det = (await page.innerText('.ex-detail')).replace(/\s+/g, ' ');
    check('detalhe mostra o que entrou e saiu, a taxa da rede e o link do explorador', /−300 POL/.test(det) && /\+28 USDT/.test(det) && /Taxa da rede/.test(det) && (await page.getAttribute('.ex-link', 'href')).startsWith('https://polygonscan.com/tx/0x'), det.slice(0, 160));
    await page.click('.ex-class [data-cls="IN"]');
    const pnlAfter = (await ui(() => window.RdeskHistory.getResult())).pnlRef;
    check('mudar a troca para "Entrada de dinheiro" muda o lucro e marca a linha como ajustada', pnlAfter < pnlBefore && /ajustado/.test(await page.locator('.extrato-row', { hasText: 'Trocou POL por USDT' }).innerText()));
    await page.click('[data-cls-reset]');
    check('voltar para a classificação automática desfaz o ajuste', near((await ui(() => window.RdeskHistory.getResult())).pnlRef, pnlBefore, 1e-9));
    await page.click('[data-close]');

    // Planilha
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-audit-csv')]);
    const csv = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
    check('baixar planilha traz todas as transações com data, tipo, valor em reais e hash', csv.split('\n').length === 10 && /Recebeu POL/.test(csv) && /Entrada de dinheiro/.test(csv), csv.split('\n')[1]);

    // Atalho da tela inicial
    await page.click('.nav-tab-btn[data-tab="wallet"]');
    await page.click('#btn-open-extrato');
    check('"Ver extrato completo" leva ao extrato', await ui(() => document.getElementById('tab-panel-audit').classList.contains('active')));
    check('sem servidor de arquivo, o gráfico avisa que alguns dias são estimativa', (await ui(() => window.RdeskHistory.getState().nativeMissing)) > 0 && /estimativa/.test(await ui(() => document.getElementById('home-chart-status').textContent)));

    check('sem erros de JavaScript nem violação de CSP', pageErrors.length === 0 && cspViolations.length === 0, [...pageErrors, ...cspViolations].slice(0, 3).join(' | '));
    await context.close();

    // ================================================================ 6b. Saldo real de POL lido da rede (servidor com arquivo)
    const ctxN = await browser.newContext(MOBILE);
    const nat = await openApp(ctxN, url, chain, { history: netOpts.history, receipts: netOpts.receipts, balancesAt: () => (777n * 10n ** 18n).toString() });
    await importWalletViaUi(nat.page);
    await waitFn(nat.page, () => window.RdeskHistory.getState().events > 0 && window.RdeskHistory.getState().seriesReady && !window.RdeskHistory.getState().loading, null, { timeout: 30000 });
    await nat.page.evaluate(() => window.RdeskHistory.setRef('USD'));
    const sN = await nat.page.evaluate(() => window.RdeskHistory.getSeries());
    const d3 = sN.find((p) => p.key === new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10));
    const expD3 = 777 * histPrice('0x0d500b1d', 3) + (28 - 10 + 50 - 20 + 18);
    check('com saldo histórico disponível, o gráfico usa o POL real de cada dia (não só a reconstrução)', d3 && near(d3.ref, expD3, 1e-6) && (await nat.page.evaluate(() => window.RdeskHistory.getState().nativeDays)) > 0, `${d3?.ref} esperado ${expD3}`);
    check('com todos os dias conferidos, nenhum aviso de estimativa', (await nat.page.evaluate(() => window.RdeskHistory.getState().nativeMissing)) === 0 && !/estimativa/.test(await nat.page.evaluate(() => document.getElementById('home-chart-status').textContent)));
    await ctxN.close();

    // ================================================================ 6. Serviço de histórico fora do ar
    const ctx2 = await browser.newContext(MOBILE);
    const down = await openApp(ctx2, url, chain, { historyDown: true });
    await importWalletViaUi(down.page);
    await waitFn(down.page, () => !window.RdeskHistory.getState().loading && window.RdeskHistory.getState().error, null, { timeout: 30000 });
    await down.page.click('.nav-tab-btn[data-tab="audit"]');
    await waitFn(down.page, () => !window.RdeskHistory.getState().loading, null, { timeout: 30000 });
    check('se o serviço de histórico cair, o extrato explica e oferece "Atualizar", sem travar', /não respondeu/.test(await down.page.innerText('#audit-status-text')) && down.pageErrors.length === 0, await down.page.innerText('#audit-status-text'));
    await ctx2.close();
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
