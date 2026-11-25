// Trocar Bitcoin dentro do app (LI.FI escolhe o serviço: LayerSwap, Relay, THORChain…), com as
// conferências de segurança antes de assinar e todas as taxas em reais. Rede e serviços simulados.
import { createRequire } from 'node:module';
import path from 'node:path';
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, waitFn, unlockViaDoor, TEST_MNEMONIC, USD_BRL, ROOT, deslizar } from './helpers.mjs';
import { MockChain, ADDR, ethers } from './mock-chain.mjs';
import { buildPsbt, decodeTx } from './psbt.mjs';

const require = createRequire(import.meta.url);
globalThis.window = globalThis; globalThis.ethers = ethers;
require(path.join(ROOT, 'bitcoin.js'));
const BTC = globalThis.RdeskBitcoin;

const OWNER = ethers.Wallet.fromMnemonic(TEST_MNEMONIC).address;
const OWNER_BTC = BTC.deriveFromMnemonic(TEST_MNEMONIC, 0).address;
const FRESH_BTC = BTC.deriveAtPath(TEST_MNEMONIC, "m/84'/0'/0'/0/1").address; // onde chega Bitcoin agora (endereço novo)
const MY_SCRIPT = BTC.addressToScript(OWNER_BTC).script;
const DEP = 'bc1plxa9q77gz9r33g8pd4c2ygzezchjffuedtzdrkclyceseyw8v80qasmquf';
const FEE_ADDR = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';
const LIFI = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE';
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' };

const polygon = new MockChain({ polPriceUsd: 0.09 });
polygon.fundNative(OWNER, 50);
polygon.fundToken(ADDR.USDT0, OWNER, 400);
const btc = {
    fees: { fastestFee: 12, halfHourFee: 8, hourFee: 6, economyFee: 3, minimumFee: 1 },
    utxos: [{ txid: 'ab'.repeat(32), vout: 1, value: 800000 }],
    broadcasts: [], txid: '7'.repeat(64)
};

// Serviço de rotas simulado (formato real da LI.FI, conferido na rede de verdade)
let lifiMode = 'ok';
const lifiCalls = [];
function lifi(q) {
    lifiCalls.push(Object.fromEntries(q.entries()));
    const fromBtc = q.get('fromChain') === 'BTC' || q.get('fromChain') === '20000000000001';
    const amount = Number(q.get('fromAmount'));
    if (fromBtc) {
        if (lifiMode === 'noutxo') return { status: 404, body: { message: 'No UTXOs found for any sender addresses' } };
        const depositTo = lifiMode === 'tamper' ? FEE_ADDR : DEP; // adulterado: PSBT manda o depósito para outro lugar
        const psbt = buildPsbt({
            inputs: [{ txid: 'ab'.repeat(32), vout: 1, value: 800000, script: MY_SCRIPT }],
            outputs: [{ value: amount - Math.round(amount * 0.0025), script: BTC.addressToScript(depositTo).script }, { value: 0, script: BTC.opReturnScript('17f8f75;=|lifi') }, { value: 800000 - amount - 1400, script: MY_SCRIPT }, { value: Math.round(amount * 0.0025), script: BTC.addressToScript(FEE_ADDR).script }]
        });
        const usd = (amount / 1e8) * 90000 * 0.996 - 1.35; // taxas do serviço saem do valor
        return {
            action: { fromAmount: String(amount), fromAddress: q.get('fromAddress'), toAddress: q.get('toAddress') },
            tool: 'layerswap', toolDetails: { name: 'LayerSwap' },
            estimate: { toAmount: String(Math.round(usd * 1e6)), toAmountMin: String(Math.round(usd * 0.99 * 1e6)), executionDuration: 1620,
                feeCosts: [{ name: 'LIFI Fixed Fee', amountUSD: '0.80' }, { name: 'LayerSwap fee', amountUSD: '0.55' }], gasCosts: [{ amountUSD: '0.50' }] },
            transactionRequest: { to: DEP, value: String(amount), data: psbt }
        };
    }
    // Polygon -> Bitcoin (Relay)
    const sats = Math.round((Number(q.get('fromAmount')) / 1e6) / 90000 * 1e8 * 0.995);
    polygon.lifiPull = { token: ADDR.USDT0, amount: BigInt(q.get('fromAmount')) };
    return {
        action: { fromAmount: q.get('fromAmount'), fromAddress: q.get('fromAddress'), toAddress: lifiMode === 'evilto' ? 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g' : q.get('toAddress') },
        tool: 'relaydepository', toolDetails: { name: 'Relay' },
        estimate: { toAmount: String(sats), toAmountMin: String(Math.round(sats * 0.99)), executionDuration: 1500, approvalAddress: LIFI,
            feeCosts: [{ name: 'LIFI Fixed Fee', amountUSD: '0.75' }, { name: 'Relayer fee', amountUSD: '0.70' }], gasCosts: [{ amountUSD: '0.02' }] },
        transactionRequest: { to: lifiMode === 'evilcontract' ? '0x000000000000000000000000000000000000bEEF' : LIFI, data: '0xa3443faa' + '00'.repeat(64), value: '0x0', chainId: 137 }
    };
}

const { server, url } = await startStaticServer(8772);
const browser = await launch();
const brl = (usd) => (usd * USD_BRL).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');

try {
    const context = await browser.newContext(MOBILE);
    const { page, pageErrors, cspViolations, dialogs } = await openApp(context, url, { 137: polygon }, { btc, lifi });
    const ui = (fn, arg) => page.evaluate(fn, arg);
    await importWalletViaUi(page);
    await ui(() => window.RdeskWallet.refreshBalances());
    await page.click('.nav-tab-btn[data-tab="pixswap"]');

    const quote = async (fc, ft, tc, tt, amt) => {
        await page.selectOption('#swap-from-chain', fc);
        await page.selectOption('#swap-from-token', ft);
        await page.selectOption('#swap-to-chain', tc);
        await page.selectOption('#swap-to-token', tt);
        await page.fill('#swap-amount-in', amt);
        await page.waitForTimeout(700);
        await waitFn(page, () => !/Consultando|…/.test(document.getElementById('swap-quote-info').textContent + document.getElementById('swap-amount-out').value), null, { timeout: 20000 }).catch(() => {});
        return { out: await page.inputValue('#swap-amount-out'), info: (await page.textContent('#swap-quote-info')).replace(/\u00a0/g, ' ') };
    };

    // ================================================================ 1. Bitcoin na lista de redes
    const chains = await page.$$eval('#swap-from-chain option', (o) => o.map((x) => x.textContent));
    check('Bitcoin aparece primeiro na lista de redes da troca', chains[0] === 'Bitcoin', chains.join(','));
    await page.selectOption('#swap-to-chain', '137');
    const polyOpts = await page.$$eval('#swap-to-token option', (o) => o.map((x) => x.textContent));
    await page.selectOption('#swap-from-chain', 'btc');
    check('troca diferencia "BTC — Bitcoin nativo" de "WBTC — Bitcoin pareado (token)"', (await page.$$eval('#swap-from-token option', (o) => o.map((x) => x.textContent)))[0] === 'BTC — Bitcoin nativo' && polyOpts.includes('WBTC — Bitcoin pareado (token)'), polyOpts.join(','));

    // ================================================================ 2. BTC -> USDT na Polygon
    const q1 = await quote('btc', 'BTC', '137', 'USDT', '0.005');
    const fees1 = (0.80 + 0.55) + (1400 / 1e8) * 90000;
    check('cotação BTC → USDT mostra serviço, tempo e taxas em reais', /LayerSwap/.test(q1.info) && /27 min/.test(q1.info) && q1.info.includes(brl(fees1)) && parseFloat(q1.out.replace(',', '.')) > 440,
        `${q1.out} | ${q1.info} (esperado ${brl(fees1)})`);
    check('pedido ao serviço usa o endereço Bitcoin como origem e o 0x como destino', lifiCalls.at(-1).fromAddress === OWNER_BTC && lifiCalls.at(-1).toAddress === OWNER && lifiCalls.at(-1).fromToken === 'bitcoin' && lifiCalls.at(-1).fromAmount === '500000');

    await page.click('#btn-execute-swap');
    await waitFn(page, () => getComputedStyle(document.getElementById('modal-receipt')).display !== 'none', null, { timeout: 20000 });
    const rcp = (await page.innerText('#modal-receipt')).replace(/\s+/g, ' ');
    check('recibo: taxa da rede Bitcoin em sat e em reais, taxa do serviço em reais e aviso de custódia',
        /1\.400 sat ≈ R\$/.test(rcp) && rcp.includes(brl(0.80 + 0.55)) && /fica com o LayerSwap/.test(rcp) && /devolve/.test(rcp), rcp.slice(0, 400));
    await page.screenshot({ path: 'tests/artifacts-btcswap-recibo.png' });
    await deslizar(page, '#modal-receipt');
    await waitFn(page, () => /Bitcoin enviado|rro|Cancel/i.test(document.getElementById('swap-feedback').textContent), null, { timeout: 30000 });
    const fb1 = await page.innerText('#swap-feedback');
    const sent = btc.broadcasts[0] ? decodeTx(btc.broadcasts[0]) : null;
    check('transação assinada mantém exatamente o depósito, a anotação, o troco e a taxa do serviço',
        sent && sent.outs.length === 4 && sent.outs[0].value === 498750 && sent.outs[3].value === 1250 && sent.outs[0].script === Buffer.from(BTC.addressToScript(DEP).script).toString('hex') &&
        Buffer.from(sent.outs[1].script, 'hex').toString('latin1').includes('lifi') && sent.outs[2].script === Buffer.from(MY_SCRIPT).toString('hex'), JSON.stringify(sent?.outs?.map((o) => o.value)));
    check('depois de enviar: aviso de quando chega e link para acompanhar', /chega na Polygon em cerca de 27 min/.test(fb1) && (await page.getAttribute('#swap-feedback a', 'href')) === `https://mempool.space/tx/${btc.txid}`, fb1);

    // ================================================================ 3. Segurança
    lifiMode = 'tamper';
    const q2 = await quote('btc', 'BTC', '137', 'USDC', '0.004');
    const before = btc.broadcasts.length;
    await page.click('#btn-execute-swap');
    await page.waitForTimeout(1500);
    check('PSBT com depósito diferente do cotado é recusado antes de assinar', /não confere/.test(q2.info) && btc.broadcasts.length === before, q2.info);
    lifiMode = 'noutxo';
    const q3 = await quote('btc', 'BTC', '137', 'USDT', '0.003');
    check('sem bitcoin confirmado: mensagem clara', /Sem bitcoin confirmado/.test(q3.info), q3.info);
    lifiMode = 'ok';
    const q4 = await quote('btc', 'BTC', '137', 'USDT', '0.0001');
    check('valor pequeno demais: avisa quanto as taxas levariam', /As taxas levariam \d+%/.test(q4.info), q4.info);

    // ================================================================ 4. USDT na Polygon -> BTC
    lifiMode = 'evilcontract';
    const qe1 = await quote('137', 'USDT', 'btc', 'BTC', '101');
    check('rota da LI.FI com contrato desconhecido é recusada antes de assinar', /contrato desconhecido/.test(qe1.info), qe1.info);
    lifiMode = 'evilto';
    const qe2 = await quote('137', 'USDT', 'btc', 'BTC', '102');
    check('rota que entregaria o BTC em outro endereço é recusada', /outro endereço/.test(qe2.info), qe2.info);
    lifiMode = 'ok';
    const q5 = await quote('137', 'USDT', 'btc', 'BTC', '100');
    check('cotação USDT (Polygon) → BTC nativo sem mostrar seus endereços (só endereços neutros)', /Relay/.test(q5.info) && parseFloat(q5.out.replace(',', '.')) > 0.001 && lifiCalls.at(-1).toAddress !== OWNER_BTC && /^0x0+dEaD$/i.test(lifiCalls.at(-1).fromAddress) && lifiCalls.at(-1).toToken === 'bitcoin', `${q5.out} | ${q5.info} | ${lifiCalls.at(-1).fromAddress} → ${lifiCalls.at(-1).toAddress}`);
    await page.click('#btn-execute-swap');
    await waitFn(page, () => getComputedStyle(document.getElementById('modal-receipt')).display !== 'none', null, { timeout: 20000 });
    const rcp2 = (await page.innerText('#modal-receipt')).replace(/\s+/g, ' ');
    check('recibo da ida para o Bitcoin deixa claro que chega BTC nativo no endereço bc1', /Chega como BTC nativo \(rede Bitcoin\) no seu endereço bc1q/.test(rcp2), rcp2.slice(0, 500));
        check('recibo da ida para o Bitcoin: taxas em reais e aviso de custódia', rcp2.includes(brl(0.75 + 0.70)) && /≈ R\$ 0,11 em POL/.test(rcp2) && /fica com o Relay/.test(rcp2), rcp2.slice(0, 300));
    const beforeConfirm = lifiCalls.length;
    const realBefore = lifiCalls.some((c) => c.toAddress === FRESH_BTC || String(c.fromAddress).toLowerCase() === OWNER.toLowerCase());
    await deslizar(page, '#modal-receipt');
    await waitFn(page, () => /chega|rro/i.test(document.getElementById('swap-feedback').textContent), null, { timeout: 60000 });
    const lifiTx = (polygon.lifiCalls || []).at(-1);
    const realAfter = lifiCalls.slice(beforeConfirm).filter((c) => c.toAddress === FRESH_BTC && String(c.fromAddress).toLowerCase() === OWNER.toLowerCase());
    check('o endereço bc1 de verdade (um endereço NOVO) só vai ao serviço quando você confirma', !realBefore && realAfter.length === 1, `antes: ${realBefore} | depois: ${realAfter.length} | ${JSON.stringify(lifiCalls.slice(beforeConfirm)).slice(0, 200)}`);
    check('aprova o valor exato, envia para o contrato da LI.FI e avisa quando o BTC chega', Boolean(lifiTx) && polygon.balOf(ADDR.USDT0, OWNER) === 300000000n && /BTC chega na Bitcoin em cerca de 25 min/.test(await page.innerText('#swap-feedback')),
        `${await page.innerText('#swap-feedback')} | USDT ${polygon.balOf(ADDR.USDT0, OWNER)}`);

    // ================================================================ 5. Enviar BTC: taxas em reais
    await page.click('.nav-tab-btn[data-tab="wallet"]');
    await page.click('#btn-action-send');
    await page.selectOption('#rmw-snd-chain', 'btc');
    await waitFn(page, () => /R\$/.test(document.getElementById('rmw-snd-fee')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
    const feeOpts = await page.$$eval('#rmw-snd-fee option', (o) => o.map((x) => x.textContent.replace(/\u00a0/g, ' ')));
    check('ao enviar Bitcoin, cada velocidade mostra a taxa estimada em reais', feeOpts.length === 3 && feeOpts.every((x) => /≈ R\$ \d/.test(x)), feeOpts.join(' | '));
    await page.screenshot({ path: 'tests/artifacts-btc-envio-taxas.png' });

    // ================================================================ 6. Bitcoin no centro
    await page.goto(url + '/index.html');
    await unlockViaDoor(page);
    await page.waitForSelector('#wallet-assets-list .asset-row', { timeout: 20000 });
    const first = await page.$$eval('#wallet-assets-list .asset-row', (r) => r.slice(0, 1).map((x) => x.innerText.replace(/\s+/g, ' ')));
    check('Bitcoin vem primeiro na lista de moedas, com selo "A mais consolidada"', /Bitcoin/.test(first[0]) && /A mais consolidada · desde 2009/.test(first[0]), first[0]);
    const cta = await page.evaluate(() => getComputedStyle(document.querySelector('.nav-tab-btn.active')).color);
    check('cor da marca é o laranja do Bitcoin (verde fica só para ganhos)', cta === 'rgb(255, 179, 92)', cta);
    await page.screenshot({ path: 'tests/artifacts-btc-inicio.png' });
    await page.click('#btn-action-receive');
    await page.click('[data-net="137"]');
    const young = await page.innerText('[data-net-risk]');
    check('receber pela Polygon avisa que é rede jovem e para não guardar tudo', /Rede jovem · desde 2020/.test(young) && /não para guardar tudo/.test(young), young);
    await page.click('[data-net="btc"]');
    check('receber pelo Bitcoin explica que é o lugar mais seguro para guardar', /mais seguro para guardar/.test(await page.innerText('[data-net-risk]')));
    await page.click('#rmw-close-btn');
    await page.click('.nav-tab-btn[data-tab="earn"]');
    check('aba Render avisa que roda numa rede jovem e sugere usar só uma parte', /rede nova e mais arriscada/.test(await page.innerText('#render-network-risk')));

    check('sem erros de JavaScript nem violação de CSP', pageErrors.length === 0 && cspViolations.length === 0, [...pageErrors, ...cspViolations].slice(0, 3).join(' | '));
    void dialogs;
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
