// v43: palavra inteira na cópia da chave, ficha e idade de cada moeda, cotação confiável, livro-caixa
// de todas as redes (BNB no extrato), som de dinheiro entrando, mercado em reais e "tudo clicável".
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, waitFn } from './helpers.mjs';
import { MockChain } from './mock-chain.mjs';

const AAVE = '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9';
const MOBILE = { viewport: { width: 320, height: 760 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' };
const { server, url } = await startStaticServer(8793);
const browser = await launch();
try {
    const ctx = await browser.newContext(MOBILE);
    const { page, pageErrors, cspViolations } = await openApp(ctx, url, { 137: new MockChain({}) }, {});
    // Fontes extras simuladas: CoinGecko (mercado em reais) e Blockscout da Ethereum (data do contrato)
    const cgHits = [];
    await page.route(/api\.coingecko\.com/, (route) => {
        const u = route.request().url(); cgHits.push(u);
        const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
        if (/coins\/markets/.test(u)) return json(['bitcoin', 'ethereum', 'tether', 'binancecoin', 'usd-coin', 'ripple', 'solana', 'tron', 'hyperliquid', 'zcash'].map((id, i) => ({ id, symbol: id.slice(0, 3), name: id, current_price: 1000 / (i + 1), price_change_percentage_24h: i % 2 ? -1.5 : 2.5, market_cap: 1e12 / (i + 1), market_cap_rank: i + 1 })));
        if (/market_chart/.test(u)) { const now = Date.now(); return json({ prices: Array.from({ length: 50 }, (_, i) => [now - (50 - i) * 3600e3, 500000 + i * 1000]) }); }
        if (/simple\/price/.test(u)) return json({ bitcoin: { brl: 543210, brl_24h_change: 1.2 } });
        return route.abort();
    });
    await page.route(/eth\.blockscout\.com/, (route) => {
        const u = route.request().url();
        const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
        if (/addresses\//.test(u)) return json({ creation_transaction_hash: '0xabc', is_verified: true });
        if (/tokens\//.test(u)) return json({ holders_count: '180000' });
        if (/transactions\/0xabc/.test(u)) return json({ timestamp: '2020-10-02T12:00:00Z' });
        return route.abort();
    });

    // ------------------------------------------------------------ chave: palavra inteira, sem cortar
    await page.evaluate(() => window.RdeskWallet.openModal());
    await page.waitForSelector('#rdesk-mw-sheet');
    const cut = await page.evaluate(() => {
        const sheet = document.getElementById('rdesk-mw-sheet');
        const words = 'cristal abstract accident acoustic'.split(' ');
        sheet.innerHTML = `<div class="ks"><div class="ks-words revealed"><div class="rmw-words-grid">${words.map((w, i) => `<div class="rmw-word-pill"><span class="rmw-word-num">${i + 1}</span><span class="rmw-word-txt">${w}</span></div>`).join('')}</div></div></div>`;
        return [...sheet.querySelectorAll('.rmw-word-txt')].map((el) => { const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect(); return { w: el.textContent, ok: r.right <= p.right + 0.5 && r.height < 30 }; });
    });
    check('palavras da chave inteiras numa tela de 320 px (sem cortar nem quebrar)', cut.every((c) => c.ok), JSON.stringify(cut));
    await page.evaluate(() => window.RdeskWallet.closeModal());

    // ------------------------------------------------------------ carteira com BNB e AAVE adicionada
    await importWalletViaUi(page);
    const tags = await page.evaluate(async (aave) => {
        const AI = window.RdeskAssetInfo;
        const eth = AI.tag({ chainId: 1, symbol: 'ETH' });
        const usdtEth = AI.tag({ chainId: 1, symbol: 'USDT', address: '0xdac17f958d2ee523a2206206994597c13d831ec7' });
        const ethOnBase = AI.tag({ chainId: 8453, symbol: 'ETH' });
        await AI.contractInfo(1, aave);
        const aaveTag = AI.tag({ chainId: 1, symbol: 'AAVE', address: aave, isCustom: true });
        return { eth, usdtEth, ethOnBase, aaveTag };
    }, AAVE);
    check('Ether na Ethereum: "desde 2015" com escudo', /🛡 Consolidada · desde 2015/.test(tags.eth), tags.eth);
    check('USDT na Ethereum NÃO herda 2015 da rede: mostra 2014 (idade do USDT)', /desde 2014/.test(tags.usdtEth) && !/2015/.test(tags.usdtEth), tags.usdtEth);
    check('Ether em outra rede não ganha escudo de consolidada', !/🛡/.test(tags.ethOnBase), tags.ethOnBase);
    check('AAVE adicionada mostra a data real do contrato (out/2020), não 2015', /contrato de out.*2020/.test(tags.aaveTag) && !/2015/.test(tags.aaveTag), tags.aaveTag);

    // Ficha da moeda: data do contrato e quantas carteiras têm
    const facts = await page.evaluate(async (aave) => {
        const box = document.createElement('div'); document.body.appendChild(box);
        await window.RdeskAssetInfo.fill(box, { symbol: 'AAVE', chainId: 1, address: aave, isCustom: true });
        const t = box.innerText; box.remove(); return t;
    }, AAVE);
    check('ficha da moeda: data do contrato, carteiras e aviso de que a idade da rede não é a da moeda', /2 de outubro de 2020/.test(facts) && /180\.000/.test(facts) && /não é a idade desta moeda/.test(facts), facts.replace(/\s+/g, ' ').slice(0, 300));

    // ------------------------------------------------------------ livro-caixa: BNB entra no extrato e toca som de dinheiro
    const led = await page.evaluate(async () => {
        const W = window.RdeskWallet;
        const real = W.getBalances.bind(W);
        let bnb = 0.01;
        W.getBalances = () => [...real(), { chainId: 56, symbol: 'BNB', amount: bnb, usdValue: bnb * 600, brlValue: bnb * 600 * 5.4 }];
        window.RdeskLedger._onBalances();               // primeira vez: "Saldo encontrado"
        bnb = 0.03; window.RdeskLedger._onBalances();   // entrou 0,02 BNB
        await new Promise((r) => setTimeout(r, 300));
        const entries = window.RdeskLedger.getEntries().filter((e) => e.sym === 'BNB');
        return { entries: entries.map((e) => `${e.title}|${e.amt}`), sound: window.RdeskFeel._state().lastSound, toast: document.getElementById('rdesk-toasts')?.innerText || '' };
    });
    check('BNB aparece no livro-caixa: as duas entradas (0,01 e depois 0,02)', led.entries.length === 2 && /Recebeu BNB\|0\.01$/.test(led.entries[0]) && /Recebeu BNB\|0\.02$/.test(led.entries[1]), led.entries.join(' ; '));
    const found = await page.evaluate(() => {
        const W = window.RdeskWallet; const base = W.getBalances.bind(W);
        W.getBalances = () => [...base(), { chainId: 8453, symbol: 'ZZZ', amount: 5, usdValue: 1, isCustom: true }];
        window.RdeskLedger._onBalances();
        W.getBalances = base;
        return window.RdeskLedger.getEntries().filter((e) => e.sym === 'ZZZ').map((e) => e.title);
    });
    check('moeda vista pela primeira vez com saldo vira "Saldo encontrado"', found.length === 1 && /Saldo encontrado/.test(found[0]), found.join());
    check('dinheiro entrando: som de moedas e aviso na tela', led.sound === 'money' && /Entrou 0,02 BNB/.test(led.toast), `${led.sound} ${led.toast}`);
    await page.click('.nav-tab-btn[data-tab="audit"]');
    await page.evaluate(() => window.RdeskHistory.renderAll());
    await waitFn(page, () => /BNB Chain/.test(document.getElementById('extrato-list')?.innerText || ''), null, { timeout: 10000 }).catch(() => {});
    const ex = await page.innerText('#extrato-list');
    check('extrato mostra o BNB com a rede (BNB Chain)', /Recebeu BNB/.test(ex) && /BNB Chain/.test(ex), ex.replace(/\s+/g, ' ').slice(0, 200));
    await page.locator('.extrato-row[data-lid]').first().click();
    await page.waitForSelector('.ex-detail');
    check('lançamento do extrato abre detalhe e pode ser reclassificado', await page.locator('.ex-detail [data-cls="DEFI"]').count() === 1);
    await page.evaluate(() => document.getElementById('ob-root').replaceChildren());

    // ------------------------------------------------------------ queda momentânea não vira "saiu"
    const blip = await page.evaluate(() => {
        const W = window.RdeskWallet; const base = W.getBalances.bind(W);
        const before = window.RdeskLedger.getEntries().length;
        W.getBalances = () => base().map((b) => (b.symbol === 'BNB' ? { ...b, amount: 0, usdValue: 0 } : b));
        window.RdeskLedger._onBalances();
        W.getBalances = base;
        window.RdeskLedger._onBalances();
        return window.RdeskLedger.getEntries().length - before;
    });
    check('saldo zerado por um instante (falha de rede) não cria lançamento falso', blip === 0, `${blip}`);

    // ------------------------------------------------------------ patrimônio de hoje
    await page.click('.nav-tab-btn[data-tab="wallet"]');
    await page.evaluate(() => { const c = document.getElementById('home-chart-card'); if (c) c.hidden = false; });
    await page.click('#home-chart-range [data-range="day"]');
    await waitFn(page, () => (window.RdeskHistory.getState().chart.points || 0) > 10, null, { timeout: 15000 }).catch(() => {});
    const dayState = await page.evaluate(() => ({ s: window.RdeskHistory.getState().chart, msg: document.getElementById('home-chart-status')?.textContent }));
    check('patrimônio "Hoje": movimento das últimas 24 h, hora a hora', dayState.s.points >= 20 && /24 horas/.test(dayState.msg), JSON.stringify(dayState));

    // ------------------------------------------------------------ mercado em reais
    await page.click('#btn-open-market');
    await page.waitForSelector('.mk-row', { timeout: 15000 });
    check('mercado lista as 10 maiores moedas em reais', (await page.locator('.mk-row').count()) === 10);
    await waitFn(page, () => document.querySelector('#mk-btc')?.dataset.ready === '1', null, { timeout: 15000 });
    check('gráfico do Bitcoin em reais desenhado (com preço e variação do período)', /R\$/.test(await page.innerText('#mk-btc .mk-price')) && (await page.locator('#mk-btc canvas').count()) === 1);
    await page.locator('.mk-row').nth(6).click();
    await page.waitForSelector('#mk-coin');
    const coin = await page.innerText('.mk-sheet');
    check('tocar numa moeda abre gráfico e ficha; moeda que o cofre ainda não guarda é avisada', /Posição no mundo/.test(coin) && /ainda não guarda/.test(coin), coin.replace(/\s+/g, ' ').slice(0, 200));
    await page.evaluate(() => document.getElementById('ob-root').replaceChildren());

    // ------------------------------------------------------------ "tudo clicável": selo explica
    const tagEl = page.locator('#wallet-assets-list .asset-tag').first();
    const tagCount = await tagEl.count();
    const tip = await page.evaluate(() => {
        const el = document.createElement('span'); el.className = 'net-tag young'; el.textContent = 'Rede jovem · desde 2020'; document.getElementById('balance-card').appendChild(el);
        el.click(); const t = document.querySelector('.info-pop')?.innerText || ''; document.getElementById('ob-root').replaceChildren(); el.remove(); return t;
    });
    check('tocar num selo explica o que ele quer dizer', /Rede nova/.test(tip), tip.slice(0, 120));
    void tagCount;

    // ------------------------------------------------------------ som do cofre trancando
    await page.evaluate(() => window.RdeskWallet.lockVault());
    await waitFn(page, () => window.RdeskFeel._state().lastSound === 'lock', null, { timeout: 3000 }).catch(() => {});
    check('trancar o cofre toca o som do cofre trancando', (await page.evaluate(() => window.RdeskFeel._state().lastSound)) === 'lock');

    check('sem erros de JavaScript nem violação de CSP', pageErrors.length === 0 && cspViolations.length === 0, [...pageErrors, ...cspViolations].slice(0, 3).join(' | '));
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
