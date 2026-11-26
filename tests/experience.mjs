// Experiência de uso: primeira abertura (tutorial), primeiros passos, dicas na hora certa, menu,
// tela inicial simples (sem endereço técnico e sem Pix), gráfico com toque e faixa própria,
// e o Render abrindo exatamente a faixa que a pessoa escolheu. Cliques reais, tela de celular.
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, waitFn, TEST_MNEMONIC, POL_USD, deslizar } from './helpers.mjs';
import { MockChain, ADDR, ethers } from './mock-chain.mjs';

const OWNER = ethers.Wallet.fromMnemonic(TEST_MNEMONIC).address;
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' };
const chain = new MockChain({ polPriceUsd: POL_USD });
chain.fundNative(OWNER, 400);

const { server, url } = await startStaticServer(8769);
const browser = await launch();
const visibleText = (page, sel) => page.evaluate((s) => {
    const out = [];
    const walk = (el) => {
        for (const n of el.childNodes) {
            if (n.nodeType === 3) { const p = n.parentElement; if (p && p.offsetParent !== null && getComputedStyle(p).visibility !== 'hidden') out.push(n.textContent); }
            else if (n.nodeType === 1) walk(n);
        }
    };
    walk(document.querySelector(s) || document.body);
    return out.join(' ').replace(/\s+/g, ' ');
}, sel);

try {
    const context = await browser.newContext(MOBILE);
    const { page, pageErrors, cspViolations } = await openApp(context, url, chain, { onboarding: true });
    const ui = (fn, arg) => page.evaluate(fn, arg);

    // ================================================================ 1. Primeira abertura
    // A primeira abertura agora é a Duda ensinando (a trilha completa é testada em tests/aprender.mjs)
    await page.waitForSelector('#learn-stage', { timeout: 10000 });
    const intro1 = (await page.innerText('#learn-stage')).replace(/\s+/g, ' ');
    check('primeira abertura: a Duda se apresenta antes de qualquer coisa', /Duda/.test(intro1) && (await page.locator('#learn-stage .av-duda').count()) === 1 && (await page.locator('#learn-stage .av-bit').count()) === 1, intro1.slice(0, 120));
    await page.screenshot({ path: 'tests/artifacts-xp-boasvindas.png' });
    await page.click('#ls-close');
    check('dá para pular as lições e olhar o app', !(await page.locator('#learn-stage').count()) && (await ui(() => window.RdeskOnboarding.getState().introDone)));

    // Sem carteira: convite, não painel
    check('sem carteira, a tela inicial mostra um convite e esconde o saldo', await ui(() => !document.getElementById('welcome-card').hidden && getComputedStyle(document.getElementById('balance-card')).display === 'none'));
    const steps0 = (await page.innerText('#getting-started')).replace(/\s+/g, ' ');
    check('"Primeiros passos" aparece com 0 de 4 e o próximo passo explicado', /0 de 4/.test(steps0) && /Tenha papel e caneta/.test(steps0), steps0.slice(0, 140));
    const allText = await visibleText(page, 'body');
    check('nenhuma menção a Pix na interface', !/\bpix\b/i.test(allText), (allText.match(/.{30}pix.{30}/i) || [''])[0]);

    // A pessoa não vê o tutorial de novo ao reabrir
    const again = await context.newPage();
    await again.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await again.goto(url, { waitUntil: 'load' });
    await again.waitForTimeout(1200);
    check('ao abrir de novo, o tutorial não aparece mais', (await again.locator('.ob-intro').count()) === 0);
    await again.close();

    // ================================================================ 2. Primeiros passos se completam usando o app
    await importWalletViaUi(page);
    await ui(() => window.RdeskWallet.refreshBalances());
    await page.waitForTimeout(800);
    await ui(() => window.RdeskOnboarding.renderSteps());
    const steps1 = (await page.innerText('#getting-started')).replace(/\s+/g, ' ');
    check('depois de abrir a carteira com saldo: 2 de 4 (carteira e primeira moeda)', /2 de 4/.test(steps1), steps1.slice(0, 120));

    const header = await page.innerText('#btn-wallet-trigger');
    check('cabeçalho mostra o nome da carteira, sem endereço 0x', /Principal/.test(header) && !/0x/i.test(header), header + ' :: ' + JSON.stringify(await page.evaluate(() => (window.RdeskWallet.getAccounts() || []).map((a) => [a.name, a.type, a.hdIndex]))));
    const homeText = await visibleText(page, '#tab-panel-wallet');
    check('tela inicial não mostra endereço técnico nem jargão (0x, cofre, pool, gás)', !/0x[0-9a-f]{3}|cofre|pool|gás/i.test(homeText), homeText.slice(0, 200));
    check('tela inicial tem só 3 ações principais: Receber, Enviar, Trocar',
        (await page.$$eval('.primary-actions .action-btn', (b) => b.map((x) => x.innerText.trim()))).join(',') === 'Receber,Enviar,Trocar');
    const sizes = await page.$$eval('.primary-actions .action-btn, .main-nav .nav-tab-btn, #btn-open-menu, #btn-toggle-balances', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
    check('botões principais e menu com alvo de toque de pelo menos 40 px', sizes.every((s) => s >= 40), sizes.map((s) => Math.round(s)).join(','));
    const navBox = await page.$eval('.main-nav', (n) => n.getBoundingClientRect().top);
    check('navegação fica na parte de baixo da tela (zona do polegar)', navBox > 844 * 0.8, `topo da barra em ${Math.round(navBox)} px`);

    // Receber marca o passo e mostra a dica uma única vez
    await page.click('#btn-action-receive');
    await page.waitForSelector('#rmw-rec-address');
    await page.waitForSelector('#ob-coach.show', { timeout: 5000 });
    check('primeira vez em Receber: dica explica o que é o endereço e a rede', /número da sua carteira/.test(await page.innerText('#ob-coach')));
    await page.click('[data-coach-ok]');
    await ui(() => window.RdeskWallet.closeModal());
    await page.click('#btn-action-receive');
    await page.waitForTimeout(900);
    check('segunda vez em Receber: sem a dica de novo', !(await ui(() => document.getElementById('ob-coach').classList.contains('show'))));
    await ui(() => window.RdeskWallet.closeModal());
    check('passo "Conhecer o seu endereço" marcado', /3 de 4/.test(await page.innerText('#getting-started')));

    // Render: último passo -> comemoração e o card some
    await page.click('.nav-tab-btn[data-tab="earn"]');
    await page.waitForSelector('#ob-coach.show', { timeout: 5000 });
    check('primeira vez nos Fundos: dica explica as posições e as alças do piloto', /alças azuis/.test(await page.innerText('#ob-coach')) && /colher/.test(await page.innerText('#ob-coach')));
    await page.click('[data-coach-ok]');
    await page.waitForSelector('#ob-toast.show', { timeout: 5000 });
    check('ao completar os primeiros passos: comemoração', /Primeiros passos concluídos/.test(await page.innerText('#ob-toast')));
    check('o card de primeiros passos some depois de concluído', await ui(() => document.getElementById('getting-started').hidden));

    // ================================================================ 3. Gráfico com toque e faixa própria
    await page.click('[data-fundos-aba="piloto"]');
    await waitFn(page, () => window.RdeskDefi.getState().poolPrice > 0 && window.RdeskDefi.getState().chart?.candles > 20, null, { timeout: 30000 });
    await page.waitForTimeout(800);
    const canvas = page.locator('#earn-chart-container canvas');
    await canvas.scrollIntoViewIfNeeded();
    let box = await canvas.boundingBox();
    let st = await ui(() => window.RdeskDefi.getState());
    const sug = { ...st.sniper };
    check('Render começa com a faixa sugerida, editável no gráfico', st.chart.editable && Math.abs(st.chart.editable.min - sug.min) < 1e-9 && !st.customRange);

    // Arrastar a alça do máximo para cima
    const yMax = box.y + st.chart.yOf.max;
    await page.mouse.move(box.x + box.width - 120, yMax);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 120, yMax - 25, { steps: 5 });
    await page.mouse.move(box.x + box.width - 120, yMax - 50, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    st = await ui(() => window.RdeskDefi.getState());
    const maxInput = parseFloat(await page.inputValue('#earn-range-max'));
    check('arrastar a alça "máx" para cima aumenta o máximo da faixa', st.customRange && st.sniper.max > sug.max * 1.002 && Math.abs(st.sniper.min - sug.min) < sug.min * 0.002,
        `máx ${sug.max.toFixed(4)} → ${st.sniper.max.toFixed(4)}`);
    check('o campo "Máximo" acompanha o arraste e o texto avisa "Sua faixa"', Math.abs(maxInput - st.sniper.max) < 0.0001 && /Sua faixa/.test(await page.innerText('#earn-range-mode')), `${maxInput}`);
    await page.screenshot({ path: 'tests/artifacts-xp-faixa.png' });

    // Digitar a faixa
    await page.fill('#earn-range-min', '0,0850');
    await page.fill('#earn-range-max', '0.0960');
    await page.press('#earn-range-max', 'Enter');
    await page.locator('#earn-range-max').blur();
    await page.waitForTimeout(400);
    st = await ui(() => window.RdeskDefi.getState());
    check('digitar mínimo e máximo (vírgula ou ponto) define a faixa e move as alças no gráfico',
        Math.abs(st.sniper.min - 0.085) < 0.0002 && Math.abs(st.sniper.max - 0.096) < 0.0002 && Math.abs(st.chart.editable.min - st.sniper.min) < 1e-9, `${st.sniper.min.toFixed(5)} – ${st.sniper.max.toFixed(5)}`);

    // Atalho "Larga"
    await page.locator('.range-chip', { hasText: 'Larga' }).click();
    await page.waitForTimeout(300);
    st = await ui(() => window.RdeskDefi.getState());
    const width = (st.sniper.max - st.sniper.min) / st.poolPrice;
    check('atalho "Larga ±10%" cria uma faixa de ~20% em volta do preço', width > 0.19 && width < 0.21 && st.sniper.min < st.poolPrice && st.poolPrice < st.sniper.max, `${(width * 100).toFixed(1)}%`);

    // Faixa fora do preço: aviso claro
    await page.fill('#earn-range-min', '0.1000');
    await page.fill('#earn-range-max', '0.1100');
    await page.locator('#earn-range-max').blur();
    await page.waitForTimeout(300);
    check('faixa que não contém o preço atual mostra aviso de que não vai render', /fora dela/.test(await page.innerText('#earn-range-mode')), `${await page.innerText('#earn-range-mode')} | ${JSON.stringify((await ui(() => window.RdeskDefi.getState())).sniper)}`);
    await page.click('#btn-earn-reset-sniper');
    await page.waitForTimeout(300);
    st = await ui(() => window.RdeskDefi.getState());
    check('"Voltar para a faixa sugerida" desfaz a escolha', !st.customRange && Math.abs(st.sniper.min - sug.min) < sug.min * 0.003);

    // Navegar no tempo: arrastar para o lado (a página rolou ao digitar: mede de novo onde está o gráfico)
    await canvas.scrollIntoViewIfNeeded();
    box = await canvas.boundingBox();
    const before = st.chart;
    await page.mouse.move(box.x + 60, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 180, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    // pinça com dois dedos (dois ponteiros)
    await page.evaluate(() => {
        const c = document.querySelector('#earn-chart-container canvas');
        const r = c.getBoundingClientRect();
        const ev = (type, id, x) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 11, clientX: r.left + x, clientY: r.top + r.height / 2, bubbles: true }));
        ev('pointerdown', 11, 120); ev('pointerdown', 12, 170);
        for (let k = 1; k <= 6; k++) { ev('pointermove', 11, 120 - k * 14); ev('pointermove', 12, 170 + k * 14); }
        ev('pointerup', 11, 36); ev('pointerup', 12, 254);
    });
    await page.waitForTimeout(300);
    const after = await ui(() => window.RdeskDefi.getState().chart);
    check('arrastar para o lado volta no tempo e a pinça aproxima (menos velas na tela)', after.viewEnd < before.viewEnd && after.visible < before.visible,
        `velas visíveis ${before.visible} → ${after.visible}; fim ${before.viewEnd} → ${after.viewEnd}`);
    // tocar mostra o preço
    await canvas.scrollIntoViewIfNeeded();
    box = await canvas.boundingBox();
    const yo = (await ui(() => window.RdeskDefi.getState().chart)).yOf;
    await page.touchscreen.tap(box.x + box.width / 3, box.y + (yo.max + yo.min) / 2);
    await page.waitForTimeout(400);
    const tapped = await ui(() => window.RdeskDefi.getState().chart.cross);
    check('tocar no gráfico mostra data e preço daquele ponto', Boolean(tapped && tapped.close > 0) && /fechou em \$/.test(await page.innerText('.rc-tip')), await page.innerText('.rc-tip'));
    await page.click('#btn-chart-reset-view');
    await page.waitForTimeout(300);
    const reset = await ui(() => window.RdeskDefi.getState().chart);
    check('"Ver tudo" volta a mostrar todas as velas', reset.visible === reset.candles && reset.viewEnd === reset.candles);

    // ================================================================ 4. O Render abre exatamente a faixa escolhida
    await page.fill('#earn-range-min', '0.0860');
    await page.fill('#earn-range-max', '0.0950');
    await page.locator('#earn-range-max').blur();
    await page.waitForTimeout(400);
    const chosen = await ui(() => window.RdeskDefi.getState().sniper);
    const mark = chain.txs.length;
    await page.click('#btn-start-autopilot');
    await waitFn(page, () => getComputedStyle(document.getElementById('modal-receipt')).display !== 'none', null, { timeout: 60000 });
    const receipt = (await page.innerText('#modal-receipt')).replace(/\s+/g, ' ');
    check('recibo mostra a faixa escolhida e fala em "Taxa da rede"', receipt.includes(chosen.min.toFixed(4)) && receipt.includes(chosen.max.toFixed(4)) && /Taxa da rede/.test(receipt), receipt.slice(0, 200));
    await deslizar(page, '#modal-receipt');
    await waitFn(page, () => /Posição aberta|insuficiente|cancelad|rro|revert/i.test(document.getElementById('autopilot-feedback')?.textContent || ''), null, { timeout: 240000 }).catch(() => {});
    const mint = chain.txs.slice(mark).find((t) => t.fn === 'mint');
    check('posição aberta com os ticks exatos da faixa que a pessoa escolheu',
        Boolean(mint) && mint.args[0].tickLower === chosen.tickLower && mint.args[0].tickUpper === chosen.tickUpper,
        mint ? `[${mint.args[0].tickLower}, ${mint.args[0].tickUpper}] esperado [${chosen.tickLower}, ${chosen.tickUpper}]` : await page.textContent('#autopilot-feedback'));
    await page.waitForSelector('#ob-toast.show', { timeout: 8000 }).catch(() => {});
    check('ao começar a render: comemoração', /rendendo/i.test(await page.innerText('#ob-toast')), await page.innerText('#ob-toast'));

    // ================================================================ 5. Menu e explicações
    await page.click('#btn-open-menu');
    const menu = (await page.innerText('.ob-menu')).replace(/\s+/g, ' ');
    check('menu tem carteiras, adicionar moeda, esconder saldos, aprender, boas-vindas e explicações', ['Minhas carteiras', 'Adicionar uma moeda', 'Esconder saldos', 'Aprender com a Duda', 'Rever as boas-vindas', 'protegida', 'Render funciona'].every((s) => menu.includes(s)), menu);
    await page.locator('.ob-menu button', { hasText: 'Render funciona' }).click();
    check('explicação do Render mostra os riscos em linguagem simples', /Riscos/.test(await page.innerText('.ob-explain')) && /estimativas/.test(await page.innerText('.ob-explain')));
    await page.click('#ob-close');
    await page.click('#btn-open-menu');
    await page.locator('.ob-menu button', { hasText: 'Rever as boas-vindas' }).click();
    await page.waitForSelector('#learn-stage', { timeout: 5000 });
    check('"Rever as boas-vindas" traz a Duda de novo', /Duda/.test(await page.innerText('#learn-stage')));
    await page.click('#ls-close');

    check('sem erros de JavaScript nem violação de CSP', pageErrors.length === 0 && cspViolations.length === 0, [...pageErrors, ...cspViolations].slice(0, 3).join(' | '));
    await context.close();
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
