// Aprender com a Duda e o Bit: primeira abertura guiada, lições com voz e desenho, quiz,
// ação real no fim, trilha na aba Aprender, e "Comprar com Pix" (em breve / ligado).
import { startStaticServer, launch, openApp, check, finish, waitFn } from './helpers.mjs';
import { MockChain, ethers } from './mock-chain.mjs';

const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' };
// Voz simulada: guarda o que foi falado e termina rápido
const VOICE = () => {
    window.__spoken = [];
    window.__played = [];
    // Áudio gravado: registra o arquivo e termina rápido
    HTMLMediaElement.prototype.play = function () { window.__played.push(this.src); setTimeout(() => this.dispatchEvent(new Event('ended')), 150); return Promise.resolve(); };
    // O que foi dito (por voz gravada ou do celular), já como texto
    window.__said = () => {
        const L = window.RDESK_LESSONS.allLines();
        return [...window.__spoken.map((s) => ({ text: s.text, who: null, how: 'tts' })),
            ...window.__played.map((src) => { const l = L.find((x) => src.includes(`/${x.key}.mp3`)); return { text: l ? l.text : src, who: l?.who, how: 'audio' }; })];
    };
    const fake = {
        speaking: false, onvoiceschanged: null,
        getVoices: () => [{ name: 'Luciana', lang: 'pt-BR' }],
        cancel() {}, speak(u) { window.__spoken.push({ text: u.text, pitch: u.pitch, lang: u.lang }); setTimeout(() => u.onend && u.onend(), 150); }
    };
    Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
};

const { server, url } = await startStaticServer(8777);
const browser = await launch();
try {
    // ================================================================ 1. Primeira abertura guiada
    const ctx = await browser.newContext(MOBILE);
    await ctx.addInitScript(VOICE);
    const { page, pageErrors, cspViolations } = await openApp(ctx, url, { 137: new MockChain({ polPriceUsd: 0.09 }) }, { onboarding: true });
    await page.waitForSelector('#learn-stage', { timeout: 10000 });
    const t0 = await page.innerText('#learn-stage');
    check('primeira abertura: Duda e Bit aparecem antes de qualquer coisa', /Duda/.test(t0) && (await page.locator('#learn-stage .av-duda .av-layer').count()) === 4 && (await page.locator('#learn-stage .av-bit .av-layer').count()) === 4);
    await waitFn(page, () => window.__said().length > 0, null, { timeout: 5000 });
    const first = await page.evaluate(() => window.__said()[0]);
    const hasAudio = await page.evaluate(async () => (await (await fetch('./audio/index.json')).json()).length > 0);
    check(`a Duda fala em voz alta (${hasAudio ? 'voz natural gravada' : 'voz do celular, sem áudios gravados ainda'})`, /Eu sou a Duda/.test(first.text) && (!hasAudio || first.how === 'audio'), JSON.stringify(first));
    // Personagens com degradês próprios (cada cópia tem ids únicos: senão a cor some)
    const ids = await page.evaluate(() => [...document.querySelectorAll('[id^="dg-skin"]')].map((e) => e.id));
    check('cada cópia da Duda tem cores próprias (sem ids repetidos)', new Set(ids).size === ids.length && ids.length >= 2, ids.join(','));
    await page.click('#ls-next');
    await waitFn(page, () => window.__said().some((s) => /eu sou o Bit/i.test(s.text)), null, { timeout: 5000 });
    const bitVoice = await page.evaluate(() => window.__said().find((s) => /eu sou o Bit/i.test(s.text)));
    check('o Bit fala com a voz dele e o balão aponta pra ele', (bitVoice.how === 'tts' || bitVoice.who === 'bit') && await page.evaluate(() => document.getElementById('ls-bubble').classList.contains('from-bit')), JSON.stringify(bitVoice));
    // Interação: tocar no Bit faz ele girar; mexer o dedo inclina os personagens (3D)
    await page.click('#learn-stage .av-bit');
    check('tocar no Bit faz ele girar', await page.evaluate(() => document.querySelector('#learn-stage .av-bit').classList.contains('spin')));
    const box = await page.locator('#learn-stage').boundingBox();
    await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * 0.5);
    check('mexer o dedo inclina os personagens em 3D', await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#learn-stage .av-duda')).getPropertyValue('--ry')) > 10));
    await page.screenshot({ path: 'tests/artifacts-aprender-boasvindas.png' });

    // Termina as boas-vindas e entra na lição 1
    for (let k = 0; k < 3; k++) await page.click("#ls-next");
    await waitFn(page, () => /O que é dinheiro/.test(document.querySelector('.ls-title')?.textContent || ''), null, { timeout: 5000 });
    check('depois das boas-vindas, a trilha começa sozinha: "O que é dinheiro?"', true);
    check('cada cena tem um desenho que explica (galinha ⇄ milho)', /🐔/.test(await page.innerText('#ls-art')));
    for (let k = 0; k < 4; k++) await page.click('#ls-next');
    await page.waitForSelector('.ls-opt');
    await page.screenshot({ path: 'tests/artifacts-aprender-quiz.png' });
    await page.locator('.ls-opt', { hasText: 'Só para enfeitar' }).click();
    check('resposta errada: botão treme e a Duda incentiva a tentar de novo', await page.evaluate(() => document.querySelector('.ls-opt.wrong') !== null) && await waitFn(page, () => window.__said().some((s) => /Tenta de novo/.test(s.text)), null, { timeout: 3000 }).then(() => true).catch(() => false));
    await page.locator('.ls-opt', { hasText: 'Trocar por coisas' }).click();
    await page.waitForSelector('.art-medal', { timeout: 5000 });
    check('acertou: medalha, estrela e comemoração', /Lição concluída/.test(await page.innerText('#ls-bubble')) && (await page.evaluate(() => window.RdeskLearn.getState().stars)) === 1);
    await page.click('#ls-next');

    // Lições 2, 3 e 4 da trilha de boas-vindas
    const answer = { inflacao: 'Fica mais caro', bitcoin: '21 milhões' };
    for (const id of ['inflacao', 'bitcoin']) {
        for (let k = 0; k < 8; k++) {
            if (await page.locator('.ls-opt').count()) break;
            await page.click('#ls-next');
        }
        if (id === 'bitcoin') check('lição do Bitcoin mostra o contador até 21 milhões', await waitFn(page, () => /21\.000\.000/.test(document.getElementById('ls-art').textContent), null, { timeout: 4000 }).then(() => true).catch(() => false));
        await page.locator('.ls-opt', { hasText: answer[id] }).click();
        await page.waitForSelector('.art-medal', { timeout: 5000 });
        await page.click('#ls-next');
    }
    await waitFn(page, () => /A chave e o cofre/.test(document.querySelector('.ls-title')?.textContent || ''), null, { timeout: 5000 });
    for (let k = 0; k < 4; k++) { if (await page.locator('.ls-opt').count()) break; await page.click('#ls-next'); }
    await page.locator('.ls-opt', { hasText: 'Não passa de jeito nenhum' }).click();
    await page.waitForSelector('#ls-action', { timeout: 5000 });
    check('lição da chave termina numa ação real: "Criar meu cofre agora"', /Criar meu cofre agora/.test(await page.innerText('#ls-action')));
    await page.click('#ls-action');
    await page.waitForSelector('#rdesk-mw-sheet .rmw-opt-btn', { timeout: 5000 });
    const st = await page.evaluate(() => ({ learn: window.RdeskLearn.getState(), ob: window.RdeskOnboarding.getState() }));
    check('ação abre a criação do cofre; trilha de boas-vindas concluída (4 lições)', /Criar meu cofre/.test(await page.innerText('#rdesk-mw-sheet')) && st.learn.welcomeDone && ['dinheiro', 'inflacao', 'bitcoin', 'chave'].every((k) => st.learn.done[k]) && st.ob.introDone, JSON.stringify(st));
    await page.evaluate(() => window.RdeskWallet.closeModal());

    // ================================================================ 2. Aba Aprender
    await page.click('.nav-tab-btn[data-tab="learn"]');
    await page.waitForSelector('#learn-path .lp-node');
    const nodes = await page.$$eval('#learn-path .lp-node', (els) => els.map((e) => e.className));
    check('aba Aprender mostra a trilha: 18 lições, 4 feitas, próxima destacada (Satoshi)', nodes.length === 18 && nodes.filter((c) => /done/.test(c)).length === 4 && /next/.test(nodes[3]), nodes.join(' | '));
    check('progresso visível: "4 de 18" e estrelas', /4 de 18/.test(await page.innerText('#learn-progress')));
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    check('trilha não empurra a tela para o lado no celular', o.sw <= o.iw + 1, `${o.sw} em ${o.iw}`);
    await page.screenshot({ path: 'tests/artifacts-aprender-aba.png', fullPage: true });
    // Lição nova: real, dólar e Bitcoin com a cotação de agora
    await page.evaluate(() => window.RdeskLearn.openLesson('real-dolar'));
    await page.waitForSelector('#learn-stage');
    await page.click('#ls-next');
    const fx = await page.innerText('#ls-art');
    const px = await page.evaluate(() => window.RdeskWallet.getPrices());
    check('"Real, dólar e Bitcoin" mostra quanto custa o dólar agora (ao vivo)', fx.includes(Number(px.USD_BRL).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\u00a0/g, ' ').replace(/\s/g, ' ')) || /US\$ 1\s*=\s*R\$\s*\d/.test(fx.replace(/\u00a0/g, ' ')), fx);
    await page.click('#ls-next'); await page.click('#ls-next');
    const fxb = (await page.innerText('#ls-art')).replace(/\u00a0/g, ' ');
    check('e faz a conta: bitcoin em dólar × dólar = bitcoin em reais', /₿ 1 = US\$/.test(fxb) && /× R\$/.test(fxb) && /= R\$/.test(fxb), fxb);
    await page.click('#ls-close');
    await page.evaluate((x) => window.RdeskLearn.openLesson(x), 'stablecoins');
    await page.waitForSelector('#learn-stage');
    for (let k = 0; k < 2; k++) await page.click('#ls-next');
    check('"Dólar e real digitais" compara USDT e USDC', /USDT/.test(await page.innerText('#ls-art')) && /USDC/.test(await page.innerText('#ls-art')) && /Tether/.test(await page.innerText('#ls-bubble')));
    for (let k = 0; k < 2; k++) await page.click('#ls-next');
    check('e BRZ × BRLA (dois reais digitais de empresas diferentes)', /BRZ/.test(await page.innerText('#ls-art')) && /BRLA/.test(await page.innerText('#ls-art')) && /Transfero/.test(await page.innerText('#ls-bubble')));
    await page.screenshot({ path: 'tests/artifacts-aprender-stablecoins.png' });
    await page.click('#ls-close');
    await page.evaluate((x) => window.RdeskLearn.openLesson(x), 'receber');
    await page.waitForSelector('#learn-stage');
    for (let k = 0; k < 3; k++) await page.click('#ls-next');
    check('lição "Receber" termina com o botão para ver o próprio código', /Ver meu código de receber/.test(await page.innerText('#ls-action')));
    // Som desligado: para de falar
    await page.click('#ls-sound');
    const before = await page.evaluate(() => window.__said().length);
    await page.click('#ls-again');
    await page.waitForTimeout(800);
    check('botão de som desliga a voz (e fica lembrado)', (await page.evaluate(() => window.__said().length)) === before && (await page.evaluate(() => window.RdeskLearn.getState().muted)));
    await page.click('#ls-close');
    check('sem erros de JavaScript nem violação de CSP', pageErrors.length === 0 && cspViolations.length === 0, [...pageErrors, ...cspViolations].slice(0, 3).join(' | '));

    // ================================================================ 2b. No computador: personagens nunca por cima do texto
    const desk = await browser.newContext({ viewport: { width: 1600, height: 820 }, serviceWorkers: 'block' });
    await desk.addInitScript(VOICE);
    const dk = await openApp(desk, url, { 137: new MockChain({ polPriceUsd: 0.09 }) }, {});
    await dk.page.evaluate(() => window.RdeskLearn.openLesson('dinheiro'));
    for (let k = 0; k < 4; k++) await dk.page.click('#ls-next');
    await dk.page.waitForSelector('.ls-opt');
    const geo = await dk.page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const b = r('#ls-bubble'), d = r('#learn-stage .av-duda'), c = r('#learn-stage .av-bit');
        const over = (x, y) => !(x.right <= y.left || y.right <= x.left || x.bottom <= y.top || y.bottom <= x.top);
        return { overDuda: over(b, d), overBit: over(b, c), width: b.width };
    });
    check('no computador: balão não fica embaixo dos personagens e o palco tem largura de celular', !geo.overDuda && !geo.overBit && geo.width <= 560, JSON.stringify(geo));
    await dk.page.screenshot({ path: 'tests/artifacts-aprender-computador.png' });
    await desk.close();

    // ================================================================ 3. Comprar com Pix: "Em breve"
    await page.click('.nav-tab-btn[data-tab="pixswap"]');
    check('aba Trocar mostra "Comprar com Pix — Em breve"', /Em breve/.test(await page.innerText('#btn-buy-pix')));
    await page.click('#btn-buy-pix');
    await page.waitForSelector('.pb-soon');
    check('sem servidor ligado, a tela explica como vai funcionar (3 passos)', /só mandando um Pix/.test(await page.innerText('.pb-soon')) && /Paga o Pix/.test(await page.innerText('.pb-soon')));
    await ctx.close();

    // ================================================================ 4. Comprar com Pix ligado (servidor simulado)
    const ctx2 = await browser.newContext(MOBILE);
    const END = 'https://rdesk-pix.teste.workers.dev';
    await ctx2.addInitScript((e) => { window.__RDESK_PIX_BUY_TEST__ = e; }, END);
    const pixCode = await (async () => {
        const p = await ctx2.newPage(); await p.goto(url); await p.waitForFunction(() => window.RdeskPix);
        const c = await p.evaluate(() => window.RdeskPix.buildPayload({ key: 'f2c1e0a4-1111-4222-8333-944455556666', name: 'RDESK', city: 'BH', amount: 50 }));
        await p.close(); return c;
    })();
    let status = 'pending'; const orders = [];
    const p2 = await openApp(ctx2, url, { 137: new MockChain({ polPriceUsd: 0.09 }) }, {});
    await p2.page.route(`${END}/**`, async (route) => {
        const u = route.request().url();
        const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
        if (/\/pix\/config$/.test(u)) return json({ enabled: true, minBrl: 10, maxBrl: 500, feeBps: 150 });
        if (/\/pix\/order$/.test(u)) { orders.push(JSON.parse(route.request().postData())); return json({ orderId: '11111111-2222-3333-4444-555555555555', pixCode, amountBrl: 50, receive: 49.25 }); }
        if (/\/pix\/order\//.test(u)) return json({ status, receive: 49.25 });
        return route.fulfill({ status: 404, body: '{}' });
    });
    const wallet = ethers.Wallet.createRandom();
    await p2.page.evaluate((a) => window.RdeskWallet.openModal('add'), wallet.address);
    await p2.page.click('.more-opts > summary');
    await p2.page.locator('#rdesk-mw-sheet .rmw-opt-btn', { hasText: 'observação' }).click();
    await p2.page.fill('#rmw-f-watch-input', wallet.address);
    await p2.page.click('#rmw-f-submit');
    await waitFn(p2.page, () => window.RdeskWallet.getAccounts().length === 1, null, { timeout: 10000 });
    await p2.page.evaluate(() => window.RdeskWallet.closeModal());
    await p2.page.click('.nav-tab-btn[data-tab="pixswap"]');
    check('com o servidor ligado, o cartão vira "Novo"', /Novo/.test(await p2.page.innerText('#btn-buy-pix')));
    await p2.page.click('#btn-buy-pix');
    await p2.page.click('[data-pb-amt="50"]');
    await waitFn(p2.page, () => /49,25 BRZ/.test(document.getElementById('pb-receive').textContent), null, { timeout: 5000 });
    check('mostra quanto vai receber em BRZ, já com a taxa', /49,25 BRZ/.test(await p2.page.innerText('#pb-receive')) && /1,5%/.test(await p2.page.innerText('#pb-receive')));
    await p2.page.click('#pb-go');
    await p2.page.waitForSelector('#pb-step-pay:not([hidden])', { timeout: 5000 });
    check('gera o Pix: QR Code + Copia e Cola, para o endereço desta carteira', (await p2.page.innerText('#pb-code')) === pixCode && orders[0].address === wallet.address && orders[0].amountBrl === 50);
    await p2.page.screenshot({ path: 'tests/artifacts-aprender-pix.png' });
    status = 'approved';
    await waitFn(p2.page, () => /Pix recebido/.test(document.getElementById('pb-status-text').textContent), null, { timeout: 10000 });
    status = 'delivered';
    await waitFn(p2.page, () => /chegaram na sua carteira/.test(document.getElementById('pb-status-text').textContent), null, { timeout: 10000 });
    check('acompanha sozinho: "Pix recebido" → "chegaram na sua carteira"', true);
    check('sem erros de JavaScript (Pix ligado)', p2.pageErrors.length === 0, p2.pageErrors.slice(0, 3).join(' | '));
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
