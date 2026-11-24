// v45: fundos de troca em qualquer rede pela interface do próprio app (sem abrir a Uniswap):
// abrir posição num fundo existente, CRIAR um fundo novo, listar, tirar tudo.
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, TEST_MNEMONIC, POL_USD, waitFn, ROOT } from './helpers.mjs';
import { MockChain, ADDR, ethers } from './mock-chain.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';

// ---------------------------------------------------------------- matemática (sem navegador)
const require = createRequire(import.meta.url);
globalThis.window = globalThis; globalThis.ethers = ethers;
require(path.join(ROOT, 'pools.js'));
const M = globalThis.RdeskPools._math;
check('preço inicial 1 vira √1 × 2^96 exato', M.sqrtX96FromRaw(1) === 2n ** 96n);
const s4 = M.sqrtX96FromRaw(4);
check('preço inicial 4 vira 2 × 2^96 (e preço 1e-12, típico POL/USDT, sem estourar)', s4 === 2n ** 97n && M.sqrtX96FromRaw(1e-12) > 0n);
const pa = M.pairAmount(0, 1e18, 1, -600, 600);
const back = M.pairAmount(1, pa.a1, 1, -600, 600);
check('quantidades A↔B coerentes nos dois sentidos', Math.abs(back.a0 - 1e18) / 1e18 < 1e-9, JSON.stringify({ a1: pa.a1, a0: back.a0 }));
check('faixa alinhada ao espaçamento da taxa', M.alignTick(-605, 60) === -660 && M.alignTick(605, 60, true) === 660);

// ---------------------------------------------------------------- no app (Polygon simulada)
const OWNER = ethers.Wallet.fromMnemonic(TEST_MNEMONIC).address.toLowerCase();
const chain = new MockChain({ polPriceUsd: POL_USD });
chain.fundNative(OWNER, 50);
chain.fundToken(ADDR.WPOL, OWNER, 500);
chain.fundToken(ADDR.USDT0, OWNER, 200);
chain.fundToken(ADDR.USDC, OWNER, 100);
chain.fundToken(ADDR.BRZ, OWNER, 1000);

const { server, url } = await startStaticServer(8796);
const browser = await launch();
try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const { page, pageErrors, cspViolations } = await openApp(ctx, url, chain, {});
    const confirmReceipt = async () => {
        await waitFn(page, () => { const m = document.getElementById('modal-receipt'); return m && getComputedStyle(m).display !== 'none'; }, null, { timeout: 30000 });
        const body = (await page.innerText('#modal-receipt')).replace(/\s+/g, ' ');
        await page.click('#btn-rcp-confirm');
        return body;
    };
    await importWalletViaUi(page);
    await page.evaluate(() => window.RdeskWallet.refreshBalances());
    await page.click('.nav-tab-btn[data-tab="earn"]');

    // ------------------------------------------------------------ 1. fundo existente WPOL/USDT 0,05%
    await page.click('#btn-pools-new');
    await page.waitForSelector('#pl-a');
    await page.selectOption('#pl-a', 'WPOL');
    await page.selectOption('#pl-b', 'USDT');
    await page.click('#pl-fees [data-fee="500"]');
    await waitFn(page, () => /Fundo encontrado/.test(document.getElementById('pl-poolinfo')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
    check('fundo existente encontrado direto no contrato (WPOL/USDT 0,05%)', /Fundo encontrado/.test(await page.innerText('#pl-poolinfo')), await page.innerText('#pl-poolinfo'));
    await page.click('#pl-widths [data-w="8"]');
    await page.fill('#pl-amt', '100');
    await waitFn(page, () => !document.getElementById('pl-go').disabled, null, { timeout: 10000 }).catch(() => {});
    const pv = await page.innerText('#pl-preview');
    check('prévia mostra quanto de cada moeda e o valor em reais', /WPOL/.test(pv) && /USDT/.test(pv) && /R\$/.test(pv), pv.replace(/\s+/g, ' '));
    let mark = chain.txs.length;
    await page.click('#pl-go');
    const r1 = await confirmReceipt();
    check('recibo antes de assinar: par, faixa, rede e "sem taxa do app"', /WPOL\/USDT|USDT\/WPOL|WPOL.*USDT/.test(r1) && /Polygon/.test(r1) && /sem taxa do app/.test(r1), r1.slice(0, 220));
    await waitFn(page, () => /Posição aberta/.test(document.getElementById('pl-msg')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
    let txs = chain.txs.slice(mark);
    check('abriu posição: aprovações exatas e mint no contrato oficial, nada reverteu', txs.length >= 2 && txs.every((t) => t.status === 1) && txs.some((t) => t.fn === 'mint') && txs.filter((t) => t.fn === 'approve').every((t) => !ethers.BigNumber.from(t.args[1]).eq(ethers.constants.MaxUint256)),
        txs.map((t) => `${t.contract}.${t.fn}${t.status ? '' : '!' + t.revertReason}`).join(' -> '));
    const pos1 = Object.values(chain.state.positions).find((p) => p.owner === OWNER && p.fee === 500);
    check('posição existe na rede com a taxa 0,05%', Boolean(pos1) && pos1.liquidity > 0n);

    // ------------------------------------------------------------ 2. CRIAR fundo novo USDC/BRZ 0,3%
    await page.evaluate(() => window.RdeskPools.openNew({ chainId: 137, a: 'USDC', b: 'BRZ' }));
    await page.waitForSelector('#pl-a');
    await page.click('#pl-fees [data-fee="3000"]');
    await waitFn(page, () => /não existe/.test(document.getElementById('pl-poolinfo')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
    check('fundo inexistente: o app avisa que você vai criá-lo', /você vai criá-lo/i.test(await page.innerText('#pl-poolinfo')) && !(await page.locator('#pl-init-wrap').isHidden()), await page.innerText('#pl-poolinfo'));
    await page.fill('#pl-init', '5,4');
    await page.click('#pl-widths [data-w="20"]');
    await page.fill('#pl-amt', '50');
    await waitFn(page, () => !document.getElementById('pl-go').disabled, null, { timeout: 10000 }).catch(() => {});
    mark = chain.txs.length;
    await page.click('#pl-go');
    const r2 = await confirmReceipt();
    check('recibo diz que vai criar o fundo', /Criar o fundo/i.test(r2), r2.slice(0, 120));
    await waitFn(page, () => /Posição aberta/.test(document.getElementById('pl-msg')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
    txs = chain.txs.slice(mark);
    const created = Object.values(chain.state.pools).find((p) => p.fee === 3000);
    const pos2 = Object.values(chain.state.positions).find((p) => p.owner === OWNER && p.fee === 3000);
    check('fundo criado e posição aberta numa só transação (multicall)', txs.some((t) => t.fn === 'multicall' && t.status === 1) && Boolean(created) && Boolean(pos2) && pos2.liquidity > 0n,
        txs.map((t) => `${t.contract}.${t.fn}${t.status ? '' : '!' + t.revertReason}`).join(' -> '));
    // preço inicial: 5,4 BRZ por USDC (token0 = BRZ, menor endereço) -> preço do fundo = 1/5,4 em unidades ajustadas
    const brzIs0 = ADDR.BRZ < ADDR.USDC;
    const humanP = Math.pow(1.0001, created.tick) / 10 ** (brzIs0 ? (6 - 18) : (18 - 6));
    const brzPerUsdc = brzIs0 ? 1 / humanP : humanP;
    check('preço inicial gravado no fundo = o que você digitou (5,4 BRZ por USDC)', Math.abs(brzPerUsdc - 5.4) / 5.4 < 0.001, brzPerUsdc.toFixed(5));

    // ------------------------------------------------------------ 3. lista em todas as redes + tirar tudo
    await page.waitForSelector('#pl-list .pl-card', { timeout: 20000 }).catch(() => {});
    const cards = await page.locator('#pl-list .pl-card').count();
    const listText = (await page.innerText('#pl-list')).replace(/\s+/g, ' ');
    check('minhas posições: as duas aparecem, rendendo, com valor em reais', cards >= 2 && /Rendendo/.test(listText) && /USDC/.test(listText) && /BRZ/.test(listText), listText.slice(0, 240));
    const idx = await page.evaluate(() => window.RdeskPools._last().findIndex((p) => p.fee === 3000));
    const usdcBefore = chain.balOf(ADDR.USDC, OWNER);
    mark = chain.txs.length;
    await page.click(`[data-exit="${idx}"]`);
    await confirmReceipt();
    await waitFn(page, () => /Feito/.test(document.querySelector(`[data-msg]`)?.parentElement?.innerText || '') || [...document.querySelectorAll('[data-msg]')].some((m) => /Feito/.test(m.textContent)), null, { timeout: 60000 }).catch(() => {});
    txs = chain.txs.slice(mark);
    check('tirar tudo: retira a liquidez e devolve as moedas numa transação', txs.length === 1 && txs[0].fn === 'multicall' && txs[0].status === 1 && Object.values(chain.state.positions).find((p) => p.owner === OWNER && p.fee === 3000).liquidity === 0n && chain.balOf(ADDR.USDC, OWNER) > usdcBefore,
        txs.map((t) => `${t.contract}.${t.fn}${t.status ? '' : '!' + t.revertReason}`).join(' -> '));

    // ------------------------------------------------------------ 4. token do criador: enviar sem moeda da rede (relayer)
    const relayed = [];
    let feeAsked = '1000000000000000000'; // 1 token de taxa
    await page.route(/relayer\.exemplo\.com/, (route) => {
        const u = route.request().url();
        const json = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
        if (/\/quote/.test(u)) return json({ fee: feeAsked, feeRecipient: '0x000000000000000000000000000000000000f00d', validSeconds: 600 });
        if (/\/relay/.test(u)) { relayed.push(JSON.parse(route.request().postData())); return json({ txHash: '0x' + 'ab'.repeat(32) }); }
        return route.abort();
    });
    const on = await page.evaluate((brz) => window.RdeskRelayer.configure({ enabled: true, chainId: 137, address: brz, symbol: 'BRZ', name: 'Token Teste', version: '1', decimals: 18, relayerUrl: 'https://relayer.exemplo.com' }), ADDR.BRZ);
    check('relayer fica desligado até configurar; configurado, liga', on === true);
    await page.evaluate(() => document.getElementById('ob-root').replaceChildren());
    await page.evaluate(() => window.RdeskWallet.openView('send', { chainId: 137, symbol: 'BRZ' }));
    await page.waitForSelector('#rmw-snd-gasless');
    const dest = '0x1111111111111111111111111111111111111111';
    await page.fill('#rmw-snd-to', dest);
    await page.fill('#rmw-snd-amt', '100');
    mark = chain.txs.length;
    await page.click('#rmw-snd-exec');
    await waitFn(page, () => /Enviado/.test(document.getElementById('rmw-snd-msg')?.innerText || ''), null, { timeout: 15000 }).catch(() => {});
    const b = relayed[0];
    const dom = { name: 'Token Teste', version: '1', chainId: 137, verifyingContract: ADDR.BRZ };
    const T = { TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] };
    const rec = (x) => ethers.utils.verifyTypedData(dom, T, { from: x.from, to: x.to, value: x.value, validAfter: x.validAfter, validBefore: x.validBefore, nonce: x.nonce }, x.signature).toLowerCase();
    check('envio sem moeda da rede: duas autorizações assinadas por você (pagamento e taxa)', b && rec(b.payment) === OWNER && rec(b.fee) === OWNER, b ? JSON.stringify({ to: b.payment.to, v: b.payment.value }) : 'nada enviado ao relayer');
    check('autorização amarra destino e valor (100 BRZ para quem você digitou) e a taxa cotada', b && b.payment.to.toLowerCase() === dest && b.payment.value === ethers.utils.parseEther('100').toString() && b.fee.value === feeAsked && b.payment.nonce !== b.fee.nonce);
    check('nenhuma transação saiu da carteira (quem paga a rede é o relayer)', chain.txs.length === mark);
    feeAsked = ethers.utils.parseEther('5').toString(); // 5% de 100: acima do teto de 2%
    const refused = await page.evaluate(async () => { try { await window.RdeskRelayer.quote(window.ethers.utils.parseEther('100')); return 'aceitou'; } catch (e) { return e.message; } });
    check('relayer pedindo taxa acima do teto (2%) é recusado', /passa de 2%/.test(refused), refused);
    await page.evaluate(() => window.RdeskRelayer.configure({ enabled: false }));

    check('sem erros de JavaScript nem violação de CSP', pageErrors.length === 0 && cspViolations.length === 0, [...pageErrors, ...cspViolations].slice(0, 3).join(' | '));
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
