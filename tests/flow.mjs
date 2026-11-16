// Teste do fluxo completo de dinheiro contra a Polygon simulada (tests/mock-chain.mjs):
// importar cofre -> piloto automático abre pool -> colher tarifas -> rebalancear -> sacar.
// Verifica as transações que a app realmente assina.
import { startStaticServer, launch, check, finish } from './helpers.mjs';
import { MockChain, ADDR, ethers } from './mock-chain.mjs';

const MNEMONIC = 'test test test test test test test test test test test junk'; // seed pública de testes
const PASSWORD = 'senha-de-teste-123';
const OWNER = ethers.Wallet.fromMnemonic(MNEMONIC).address.toLowerCase();
const START_POL = 800;
const POL_USD = 0.09;
const USD_BRL = 5.4;

const chain = new MockChain({ polPriceUsd: POL_USD });
chain.fundNative(OWNER, START_POL);

const { server, url } = await startStaticServer(8766);
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('dialog', (d) => d.accept().catch(() => {}));

const candles = (n, stepSec) => {
    const now = Math.floor(Date.now() / 1000 / stepSec) * stepSec;
    return Array.from({ length: n }, (_, i) => {
        const t = (now - (n - 1 - i) * stepSec) * 1000;
        const o = POL_USD * (1 + 0.004 * Math.sin(i / 3)), c = POL_USD * (1 + 0.004 * Math.sin((i + 1) / 3));
        return [t, String(o), String(Math.max(o, c) * 1.002), String(Math.min(o, c) * 0.998), String(c), '1000', t + stepSec * 1000 - 1, '90', 10, '500', '45', '0'];
    });
};
const chartStub = `(function(){const U=new Proxy(function(){},{get:(t,p)=>p===Symbol.toPrimitive?()=>0:(p==='then'?undefined:U),apply:()=>U,construct:()=>U});window.LightweightCharts=U;})();`;

await page.route((u) => !u.href.startsWith('http://localhost'), async (route) => {
    const req = route.request();
    const u = req.url();
    const json = (obj) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (/publicnode\.com|1rpc\.io|drpc\.org/.test(u) && req.method() === 'POST') {
        if (!/polygon|matic/.test(u)) return route.abort();
        return json(chain.handle(JSON.parse(req.postData())));
    }
    if (/lightweight-charts/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: chartStub });
    if (/awesomeapi.*last\/USD-BRL/.test(u)) return json({ USDBRL: { bid: String(USD_BRL), ask: String(USD_BRL) } });
    if (/api\.binance\.com\/api\/v3\/ticker\/price/.test(u)) return json([{ symbol: 'POLUSDT', price: String(POL_USD) }, { symbol: 'ETHUSDT', price: '3000' }, { symbol: 'BTCUSDT', price: '90000' }]);
    if (/api\.binance\.com\/api\/v3\/klines/.test(u)) return json(candles(Number(new URL(u).searchParams.get('limit')) || 100, 900));
    return route.abort();
});

const ui = (fn, arg) => page.evaluate(fn, arg);
const clickId = (id) => ui((i) => document.getElementById(i).click(), id);
const confirmReceipt = async (titleRe) => {
    await page.waitForFunction(() => document.getElementById('receipt-modal')?.classList.contains('open'), null, { timeout: 60000 });
    const title = await ui(() => document.getElementById('receipt-title').textContent);
    const body = await ui(() => document.getElementById('receipt-modal').innerText.replace(/\s+/g, ' '));
    check(`recibo antes de assinar: ${title}`, titleRe.test(title), body.slice(0, 220));
    await clickId('btn-receipt-confirm');
};
const clickPosButton = (label) => ui((l) => {
    const b = Array.from(document.querySelectorAll('.pos-act-btn')).find((x) => x.textContent.includes(l));
    if (!b) throw new Error('botão não encontrado: ' + l);
    b.click();
}, label);
const feedback = () => ui(() => (document.getElementById('nft-tx-feedback')?.textContent || ''));
const waitFeedback = (re, ms = 120000) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('nft-tx-feedback')?.textContent || ''), re.source, { timeout: ms });
const fmtPol = (wei) => Number(ethers.utils.formatEther(wei.toString()));
const fmtUsdt = (v) => Number(v) / 1e6;
const txsSince = (n) => chain.txs.slice(n);
const describe = (t) => `${t.contract}.${t.fn}${t.status ? '' : ' [REVERTEU: ' + t.revertReason + ']'}`;

try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.ethers && window.RdeskVault && window.RdeskGateway);

    // ------------------------------------------------------------ 1. Cofre + leitura
    const addr = await ui(async ({ mnemonic, password }) =>
        window.RdeskVault.commitVaultFromMnemonic({ mnemonic, password, isImport: true }), { mnemonic: MNEMONIC, password: PASSWORD });
    check('cofre importado com a seed de teste', addr === OWNER, addr);
    await ui(() => window.RdeskVault.refreshAllBalancesAndPrices());
    const snap = await ui(() => window.RdeskVault.getState());
    check('saldo lido da rede', Math.abs((snap.balancesByChain[137]?.POL || 0) - START_POL) < 1e-9, JSON.stringify(snap.balancesByChain[137]));
    check('patrimônio em R$ coerente', Math.abs(snap.totalPortfolioBrl - START_POL * POL_USD * USD_BRL) < 0.5, `R$ ${snap.totalPortfolioBrl?.toFixed(2)}`);
    await page.waitForTimeout(4000);

    // ------------------------------------------------------------ 2. Piloto automático abre a pool
    let mark = chain.txs.length;
    await clickId('btn-start-earning');
    await confirmReceipt(/Piloto Autom/);
    await page.waitForFunction(() => {
        const t = (document.getElementById('ap-status-log')?.textContent || '') + (document.getElementById('sereno-autopilot-log')?.textContent || '');
        return /Posição aberta|insuficiente|Erro|erro|revert|cancelad|parcial|inválid|Timeout|falh/i.test(t);
    }, null, { timeout: 240000 }).catch(() => {});
    const apLog = await ui(() => document.getElementById('ap-status-log')?.textContent || document.getElementById('sereno-autopilot-log')?.textContent || '');
    let batch = txsSince(mark);
    console.log('   transações:', batch.map(describe).join(' -> '));
    check('piloto automático concluiu a abertura', /Posição aberta/.test(apLog), apLog);
    check('nenhuma transação reverteu na abertura', batch.every((t) => t.status === 1), batch.filter((t) => !t.status).map(describe).join('; '));

    const positions = chain.positionsOf(OWNER);
    check('uma posição NFT criada para a carteira', positions.length === 1 && positions[0].liquidity > 0n, `qtd=${positions.length}`);
    const pos = positions[0];
    if (pos) {
        check('faixa contém o preço atual e respeita o espaçamento de ticks',
            pos.tickLower < chain.tick && chain.tick < pos.tickUpper && pos.tickLower % 10 === 0 && pos.tickUpper % 10 === 0,
            `[${pos.tickLower}, ${pos.tickUpper}] tick=${chain.tick}  preço ${(1.0001 ** pos.tickLower * 1e12).toFixed(5)} – ${(1.0001 ** pos.tickUpper * 1e12).toFixed(5)}`);
    }
    const mint = batch.find((t) => t.fn === 'mint');
    if (mint) {
        const m = mint.args[0];
        check('mint com proteção de slippage (mínimos > 0)', m.amount0Min.gt(0) && m.amount1Min.gt(0), `min0=${m.amount0Min} min1=${m.amount1Min}`);
        check('mint envia o NFT para a própria carteira', m.recipient.toLowerCase() === OWNER);
    } else check('transação de mint enviada', false);
    const swap = batch.find((t) => t.fn === 'exactInputSingle');
    if (swap) {
        const s = swap.args[0];
        check('swap com mínimo de saída (anti-sandwich)', s.amountOutMinimum.gt(0) && s.recipient.toLowerCase() === OWNER, `minOut=${s.amountOutMinimum}`);
    }
    const approvals = batch.filter((t) => t.fn === 'approve');
    check('aprovações de valor exato (nenhuma infinita)', approvals.length > 0 && approvals.every((t) => t.args[1].lt(ethers.constants.MaxUint256.div(2))), `${approvals.length} aprovações`);
    const nativeAfterOpen = fmtPol(chain.nativeOf(OWNER));
    check('reserva de gás preservada (~3 POL)', nativeAfterOpen > 2.8 && nativeAfterOpen <= 3.0001, `${nativeAfterOpen.toFixed(4)} POL`);
    const idle = fmtPol(chain.balOf(ADDR.WPOL, OWNER)) * POL_USD + fmtUsdt(chain.balOf(ADDR.USDT0, OWNER));
    const deployedUsd = (START_POL - 3) * POL_USD;
    check('pelo menos 97% do capital entrou na pool', idle / deployedUsd < 0.03, `sobrou $${idle.toFixed(3)} de $${deployedUsd.toFixed(2)}`);

    await page.waitForFunction(() => document.querySelectorAll('.pos-act-btn').length >= 3, null, { timeout: 60000 }).catch(() => {});
    check('posição aparece na interface com os botões de ação', (await ui(() => document.querySelectorAll('.pos-act-btn').length)) >= 3);

    // ------------------------------------------------------------ 3. Colher tarifas
    chain.accrueFees(pos.id, ethers.utils.parseEther('2').toBigInt(), 150000n); // 2 WPOL + 0,15 USDT0
    const w0 = chain.balOf(ADDR.WPOL, OWNER), u0 = chain.balOf(ADDR.USDT0, OWNER);
    mark = chain.txs.length;
    await clickPosButton('COLHER');
    await confirmReceipt(/Colher Tarifas/);
    await waitFeedback(/colhidas|Erro|erro|revert|insuf/).catch(() => {});
    batch = txsSince(mark);
    console.log('   transações:', batch.map(describe).join(' -> '), '|', await feedback());
    check('colher tarifas: 2 WPOL + 0,15 USDT0 chegaram à carteira',
        chain.balOf(ADDR.WPOL, OWNER) - w0 === ethers.utils.parseEther('2').toBigInt() && chain.balOf(ADDR.USDT0, OWNER) - u0 === 150000n,
        await feedback());
    check('colher não mexe na liquidez da posição', chain.state.positions[pos.id].liquidity === pos.liquidity);

    // ------------------------------------------------------------ 4. Rebalancear (preço saiu da faixa)
    chain.tick = pos.tickUpper + 150; // preço sobe além do topo da faixa
    const newPrice = 1.0001 ** chain.tick * 1e12;
    await ui(() => window.RdeskVault.refreshAllBalancesAndPrices());
    mark = chain.txs.length;
    await clickPosButton('REBALANCEAR');
    await confirmReceipt(/Rebalance/i);
    await page.waitForFunction((n) => {
        const t = document.getElementById('nft-tx-feedback')?.textContent || '';
        return /sucesso|conclu|reaberta|nova faixa|Erro|erro|revert|insuf|inválid|parcial/i.test(t) && !/^\s*[123]\/3/.test(t);
    }, null, { timeout: 240000 }).catch(() => {});
    batch = txsSince(mark);
    console.log('   transações:', batch.map(describe).join(' -> '), '|', await feedback());
    check('nenhuma transação reverteu no rebalanceamento', batch.length > 0 && batch.every((t) => t.status === 1), batch.filter((t) => !t.status).map(describe).join('; ') || await feedback());
    const after = chain.positionsOf(OWNER);
    const fresh = after.find((p) => p.id !== pos.id && p.liquidity > 0n);
    check('posição antiga esvaziada', chain.state.positions[pos.id].liquidity === 0n);
    check('nova posição aberta em torno do novo preço', Boolean(fresh) && fresh.tickLower < chain.tick && chain.tick < fresh.tickUpper,
        fresh ? `[${fresh.tickLower}, ${fresh.tickUpper}] tick=${chain.tick} (preço $${newPrice.toFixed(5)})` : 'não encontrada');
    const dec = batch.flatMap((t) => (t.fn === 'multicall' ? t.args[0] : [])).map((d) => { try { return chain.describeTx(ADDR.NFPM, d, 0); } catch (e) { return null; } }).find((d) => d?.fn === 'decreaseLiquidity');
    if (dec) check('retirada de liquidez com mínimos > 0', dec.args[0].amount0Min.gt(0) || dec.args[0].amount1Min.gt(0), `min0=${dec.args[0].amount0Min} min1=${dec.args[0].amount1Min}`);

    // ------------------------------------------------------------ 5. Sacar a pool
    if (fresh) {
        await page.waitForFunction(() => document.querySelectorAll('.pos-act-btn').length >= 3, null, { timeout: 60000 }).catch(() => {});
        mark = chain.txs.length;
        await clickPosButton('SACAR POOL');
        await confirmReceipt(/Sacar|Encerrar|Retirar/i);
        await waitFeedback(/encerrada|Erro|erro|revert|insuf/).catch(() => {});
        batch = txsSince(mark);
        console.log('   transações:', batch.map(describe).join(' -> '), '|', await feedback());
        check('saque: posição encerrada sem reverter', batch.length > 0 && batch.every((t) => t.status === 1) && chain.state.positions[fresh.id].liquidity === 0n, await feedback());
        const finalUsd = (fmtPol(chain.balOf(ADDR.WPOL, OWNER)) + fmtPol(chain.nativeOf(OWNER))) * newPrice + fmtUsdt(chain.balOf(ADDR.USDT0, OWNER));
        check('fundos de volta na carteira', finalUsd > 50, `≈ $${finalUsd.toFixed(2)} (WPOL ${fmtPol(chain.balOf(ADDR.WPOL, OWNER)).toFixed(2)}, USDT0 ${fmtUsdt(chain.balOf(ADDR.USDT0, OWNER)).toFixed(2)}, POL ${fmtPol(chain.nativeOf(OWNER)).toFixed(3)})`);
    }

    // ------------------------------------------------------------ 6. A tela reflete a rede
    await page.waitForFunction((u) => Math.abs((window.RdeskVault.getState().balancesByChain[137]?.USDT || 0) - u) < 0.01,
        fmtUsdt(chain.balOf(ADDR.USDT0, OWNER)), { timeout: 30000 }).catch(() => {});
    const endSnap = await ui(() => window.RdeskVault.getState());
    const endUi = await ui(() => ({
        split: document.getElementById('sereno-equity-split')?.textContent || '',
        tiles: Array.from(document.querySelectorAll('#multi-asset-grid .asset-sym')).map((e) => e.textContent)
    }));
    check('saldos na tela iguais aos da rede após as operações',
        Math.abs(endSnap.balancesByChain[137].USDT - fmtUsdt(chain.balOf(ADDR.USDT0, OWNER))) < 0.01 &&
        Math.abs(endSnap.balancesByChain[137].WPOL - fmtPol(chain.balOf(ADDR.WPOL, OWNER))) < 0.01,
        JSON.stringify(endSnap.balancesByChain[137]));
    check('total "Rendendo em Pools" zera depois do saque', /Pools: R\$\s?0,00/.test(endUi.split), endUi.split);
    check('WPOL devolvido aparece no portfólio', endUi.tiles.includes('WPOL'), endUi.tiles.join(','));

    check('sem erros de JavaScript durante todo o fluxo', pageErrors.length === 0, [...new Set(pageErrors)].slice(0, 5).join(' | '));
    check('a simulação conhecia todas as chamadas feitas pela app', chain.unknownCalls.length === 0, JSON.stringify(chain.unknownCalls.slice(0, 6)));
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
    console.log('   log piloto:', await ui(() => document.getElementById('ap-status-log')?.textContent).catch(() => ''));
    console.log('   transações até aqui:', chain.txs.map(describe).join(' -> '));
    console.log('   falhas RPC:', JSON.stringify((chain.failures || []).slice(0, 6)));
    console.log('   chamadas desconhecidas:', JSON.stringify(chain.unknownCalls.slice(0, 8)));
} finally {
    await page.screenshot({ path: 'tests/artifacts-flow.png' }).catch(() => {});
    await browser.close();
    server.close();
    finish();
}
