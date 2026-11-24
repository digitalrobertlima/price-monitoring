// v44: Dash (endereço, saldo, envio assinado e conferido por um verificador independente),
// troca Bitcoin ↔ real digital em 2 etapas, calculadora de rendimento e Aprender cobrindo o app.
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, waitFn, ROOT, TEST_MNEMONIC } from './helpers.mjs';
import { MockChain, ethers } from './mock-chain.mjs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const py = (script, ...args) => execFileSync('python3', [path.join(ROOT, 'tests/tools', script), ...args.map(String)], { encoding: 'utf8' }).trim();

// ---------------------------------------------------------------- Dash sem navegador
const require = createRequire(import.meta.url);
globalThis.window = globalThis; globalThis.ethers = ethers;
require(path.join(ROOT, 'wordlist-pt.js'));
require(path.join(ROOT, 'dash.js'));
const D = globalThis.RdeskDash;
const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const a0 = D.deriveFromMnemonic(ABANDON, 0).address;
check('endereço Dash igual ao calculado de forma independente (Python, BIP44 m/44\'/5\'/0\'/0/0)', a0 === py('dash_addr.py', ABANDON, 0) && a0 === 'XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5', a0);
const pt = 'imitador vinheta sogro xerife veleiro pomar volumoso tratador imitador vinheta sogro xingar';
check('chave em português também gera o Dash certo', D.deriveFromMnemonic(pt, 0).address === py('dash_addr.py', pt, 0));
check('endereço Dash: aceita X…, recusa Bitcoin e erro de digitação', D.isAddress(a0) && !D.isAddress('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh') && !D.isAddress(a0.slice(0, -1) + (a0.endsWith('5') ? '6' : '5')));
const key = D.deriveFromMnemonic(ABANDON, 0);
const utxos = [{ txid: 'aa'.repeat(32), vout: 1, value: 3000000 }, { txid: 'bb'.repeat(32), vout: 0, value: 500000 }];
const dest = D.deriveFromMnemonic(ABANDON, 1).address;
const plan = D.plan({ utxos, toAddress: dest, amountDuffs: 3200000, changeAddress: a0 });
const signed = D.sign(plan, key.privateKey);
const prevScript = '76a914' + ethers.utils.ripemd160(ethers.utils.sha256(ethers.utils.computePublicKey(key.publicKey.startsWith('0x') ? key.publicKey : '0x' + key.publicKey, true))).slice(2) + '88ac';
let verdict = '';
try { verdict = py('verify_p2pkh.py', signed.hex, prevScript); } catch (e) { verdict = String(e.stdout || e.message); }
check('transação Dash assinada é válida para um verificador independente (2 entradas, assinatura e dono conferidos)', /^OK 2 entradas 2 saídas/.test(verdict), verdict);
check('troco volta para o próprio endereço e taxa mínima da rede', plan.outputs[1]?.address === a0 && plan.fee >= 226 && plan.fee < 2000, JSON.stringify({ fee: plan.fee, change: plan.change }));
let refused = '';
try { D.plan({ utxos, toAddress: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', amountDuffs: 10000, changeAddress: a0 }); } catch (e) { refused = e.message; }
check('enviar Dash para endereço de Bitcoin é recusado', /Dash/.test(refused), refused);

// ---------------------------------------------------------------- no app
const testDash = D.deriveFromMnemonic(TEST_MNEMONIC, 0).address;
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' };
const { server, url } = await startStaticServer(8795);
const browser = await launch();
try {
    const ctx = await browser.newContext(MOBILE);
    const { page, pageErrors, cspViolations } = await openApp(ctx, url, { 137: new MockChain({}) }, {});
    const sent = [];
    await page.route(/insight\.dash\.org/, (route) => {
        const u = route.request().url();
        const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
        if (/\/utxo$/.test(u)) return json(u.includes(testDash) ? [{ txid: 'cc'.repeat(32), vout: 0, satoshis: 5000000, confirmations: 10 }] : []);
        if (/tx\/send/.test(u)) { sent.push(JSON.parse(route.request().postData()).rawtx); return json({ txid: 'dd'.repeat(32) }); }
        return route.abort();
    });
    await importWalletViaUi(page);
    await waitFn(page, () => window.RdeskWallet.getDashAddress?.(), null, { timeout: 15000 });
    const dashAddr = await page.evaluate(() => window.RdeskWallet.getDashAddress());
    check('carteira importada ganha endereço Dash da mesma chave', dashAddr === testDash, dashAddr);
    await page.evaluate(() => window.RdeskWallet.refreshBalances());
    await waitFn(page, () => (window.RdeskWallet.getBalances() || []).some((b) => b.chainId === 'dash' && b.amount > 0), null, { timeout: 15000 }).catch(() => {});
    const dashBal = await page.evaluate(() => (window.RdeskWallet.getBalances() || []).find((b) => b.chainId === 'dash'));
    check('saldo de Dash aparece na carteira (0,05 DASH)', dashBal && Math.abs(dashBal.amount - 0.05) < 1e-9, JSON.stringify(dashBal));

    await page.evaluate(() => window.RdeskWallet.openView('receive', { chainId: 'dash' }));
    await page.waitForSelector('#rmw-rec-address');
    check('Receber Dash mostra o endereço X… e o aviso da rede', (await page.innerText('#rmw-rec-address')) === testDash && /somente DASH/.test(await page.innerText('#rmw-rec-warning')));

    await page.evaluate(() => window.RdeskWallet.openView('send', { chainId: 'dash' }));
    await page.waitForSelector('#rmw-snd-to');
    const to = D.deriveFromMnemonic(ABANDON, 2).address;
    await page.fill('#rmw-snd-to', to);
    await page.fill('#rmw-snd-amt', '0,01');
    await page.click('#rmw-snd-exec');
    await waitFn(page, () => /Dash enviado/.test(document.getElementById('rmw-snd-msg')?.innerText || ''), null, { timeout: 15000 }).catch(() => {});
    const myKey = D.deriveFromMnemonic(TEST_MNEMONIC, 0);
    const myScript = '76a914' + ethers.utils.ripemd160(ethers.utils.sha256('0x' + myKey.publicKey)).slice(2) + '88ac';
    let v2 = '';
    try { v2 = sent[0] ? py('verify_p2pkh.py', sent[0], myScript) : 'nada transmitido'; } catch (e) { v2 = String(e.stdout || e.message); }
    check('envio de Dash pelo app: transação transmitida e válida (verificador independente)', /^OK 1 entradas 2 saídas/.test(v2), v2);

    // ------------------------------------------------------------ troca BTC -> BRZ em 2 etapas
    await page.evaluate(() => window.RdeskWallet.closeModal());
    await page.click('.nav-tab-btn[data-tab="pixswap"]');
    await page.evaluate(() => window.RdeskDefi._twoStep.setSwapForm({ fromChain: 'btc', fromSym: 'BTC', toChain: 8453, toSym: 'BRZ', amount: '0.001' }));
    await page.waitForSelector('#swap-two-step', { timeout: 20000 }).catch(() => {});
    check('sem rota direta BTC → BRZ: o app oferece fazer em 2 etapas pelo USDC', (await page.locator('#swap-two-step').count()) === 1 && /2 etapas/.test(await page.innerText('#swap-quote-info')));
    await page.click('#btn-two-step');
    const form = await page.evaluate(() => ({ fc: document.getElementById('swap-from-chain').value, ft: document.getElementById('swap-from-token').value, tc: document.getElementById('swap-to-chain').value, tt: document.getElementById('swap-to-token').value, leg: window.RdeskDefi._twoStep.readLeg() }));
    check('etapa 1 preenchida: BTC → USDC na Base, etapa 2 guardada (USDC → BRZ)', form.fc === 'btc' && form.tt === 'USDC' && form.tc === '8453' && form.leg?.toSym === 'BRZ' && form.leg?.fromChain === 8453, JSON.stringify(form));
    const leg2 = await page.evaluate(async () => {
        window.RdeskDefi._twoStep.armLeg2IfMatches({ toSym: 'USDC', toChain: 8453 });
        const W = window.RdeskWallet; const base = W.getBalances.bind(W);
        W.getBalances = () => [...base().filter((b) => !(b.chainId === 8453 && b.symbol === 'USDC')), { chainId: 8453, symbol: 'USDC', amount: 61.25, usdValue: 61.25 }];
        window.dispatchEvent(new CustomEvent('rdesk:balancesUpdated'));
        await new Promise((r) => setTimeout(r, 400));
        return document.getElementById('swap-leg2')?.innerText || '';
    });
    check('quando o USDC chega, o app avisa e oferece a etapa 2', /Etapa 1 concluída/.test(leg2) && /61,25 USDC/.test(leg2) && /BRZ/.test(leg2), leg2);
    await page.click('#swap-leg2 [data-go]');
    const f2 = await page.evaluate(() => ({ ft: document.getElementById('swap-from-token').value, tt: document.getElementById('swap-to-token').value, amt: document.getElementById('swap-amount-in').value, leg: window.RdeskDefi._twoStep.readLeg() }));
    check('etapa 2 preenchida com o valor que chegou (61,25 USDC → BRZ)', f2.ft === 'USDC' && f2.tt === 'BRZ' && f2.amt === '61.25' && f2.leg === null, JSON.stringify(f2));

    // ------------------------------------------------------------ calculadora do Render
    await page.click('.nav-tab-btn[data-tab="earn"]');
    const calc = await page.evaluate(() => {
        const st = window.RdeskDefi._earn.state();
        st.poolVol24hUsd = 2000000; st.poolLiquidity = 5e17; st.poolPrice = 0.2;
        document.getElementById('calc-target').value = '10';
        document.getElementById('calc-period').value = 'dia';
        document.getElementById('calc-have').value = '1000';
        window.RdeskDefi._earn.renderEarnCalc();
        const m = window.RdeskDefi._earn.earnModel(0.08);
        return { text: document.getElementById('earn-calc-out').innerText, need: m.needUsd(10 / 5.4), gain: m.usdPerDay(1000 / 5.4), pool: m.poolDayUsd, narrow: window.RdeskDefi._earn.earnModel(0.03).usdPerDay(200), wide: window.RdeskDefi._earn.earnModel(0.2).usdPerDay(200) };
    });
    check('calculadora mostra quanto precisa colocar e quanto ganha em cada faixa', /Precisa colocar/.test(calc.text) && /Estreita/.test(calc.text) && /Larga/.test(calc.text) && /por dia|\/dia/.test(calc.text), calc.text.slice(0, 200));
    check('conta coerente: faixa estreita rende mais por real colocado; meta maior que o fundo é "impossível"', calc.narrow > calc.wide && calc.need > 0 && Number.isFinite(calc.need)
        && (await page.evaluate(() => window.RdeskDefi._earn.earnModel(0.08).needUsd(1e9))) === Infinity, JSON.stringify(calc));
    const used = await page.evaluate(() => { document.querySelector('[data-calc-use="0.2"]').click(); return document.getElementById('earn-range-mode').textContent; });
    check('"Usar" leva a faixa da calculadora para o gráfico', /Sua faixa/.test(used) && /(19,9|20,0|20,1|20)% de largura/.test(used), used);

    // ------------------------------------------------------------ Aprender cobre o app
    const lessons = await page.evaluate(() => window.RDESK_LESSONS.LESSONS.map((l) => l.id));
    const need = ['app-inicio', 'app-enviar', 'app-trocar', 'app-calculadora', 'app-extrato', 'app-avisos', 'app-semnet', 'app-portugues'];
    check('Aprender tem uma lição para cada parte do app', need.every((id) => lessons.includes(id)), lessons.join(','));

    check('sem erros de JavaScript nem violação de CSP', pageErrors.length === 0 && cspViolations.length === 0, [...pageErrors, ...cspViolations].slice(0, 3).join(' | '));
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
