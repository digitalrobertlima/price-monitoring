// Fluxo completo de dinheiro contra a Polygon simulada (tests/mock-chain.mjs), com cliques reais:
// importar carteira -> piloto automático abre pool -> colher tarifas -> rebalancear -> encerrar.
// Confere as transações que a app realmente assina.
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, TEST_MNEMONIC, POL_USD, USD_BRL } from './helpers.mjs';
import { MockChain, ADDR, ethers } from './mock-chain.mjs';

const OWNER = ethers.Wallet.fromMnemonic(TEST_MNEMONIC).address.toLowerCase();
const START_POL = 800;

const chain = new MockChain({ polPriceUsd: POL_USD });
chain.fundNative(OWNER, START_POL);

const { server, url } = await startStaticServer(8766);
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
const { page, pageErrors, dialogs, cspViolations } = await openApp(context, url, chain);

const ui = (fn, arg) => page.evaluate(fn, arg);
const fmtPol = (wei) => Number(ethers.utils.formatEther(wei.toString()));
const fmtUsdt = (v) => Number(v) / 1e6;
const describe = (t) => `${t.contract}.${t.fn}${t.status ? '' : ' [REVERTEU: ' + t.revertReason + ']'}`;
const innerCalls = (batch) => batch.flatMap((t) => (t.fn === 'multicall' ? t.args[0].map((d) => chain.describeTx(ADDR.NFPM, d, 0)) : [t]));
const idle = () => chain.txs.length;

async function confirmReceipt(titleRe) {
    await page.waitForFunction(() => { const m = document.getElementById('modal-receipt'); return m && getComputedStyle(m).display !== 'none'; }, null, { timeout: 60000 });
    const title = await page.textContent('#rcp-title');
    const body = (await page.innerText('#modal-receipt')).replace(/\s+/g, ' ');
    check(`recibo antes de assinar: ${title}`, titleRe.test(title), body.slice(0, 230));
    await page.click('#btn-rcp-confirm');
}
// Espera a rede ficar parada (nenhuma transação nova por alguns segundos) depois de pelo menos `min` transações.
async function waitTxsSettled(mark, min, timeoutMs = 240000) {
    const start = Date.now(); let last = idle(); let lastChange = Date.now();
    while (Date.now() - start < timeoutMs) {
        await page.waitForTimeout(1000);
        if (idle() !== last) { last = idle(); lastChange = Date.now(); }
        if (idle() - mark >= min && Date.now() - lastChange > 9000) break;
        if (dialogs.length && Date.now() - lastChange > 9000) break;
    }
    return chain.txs.slice(mark);
}
const clickPosButton = (label) => page.locator('#active-positions-list button', { hasText: label }).first().click();

try {
    // ------------------------------------------------------------ 1. Carteira + leitura
    await importWalletViaUi(page);
    check('carteira importada pelo modal', (await ui(() => window.RdeskWallet.getAddress().toLowerCase())) === OWNER);
    await ui(() => window.RdeskWallet.refreshBalances());
    const bal = await ui(() => window.RdeskWallet.getBalances().filter((b) => b.chainId === 137).map((b) => [b.symbol, b.amount]));
    check('saldo lido da rede', Math.abs((Object.fromEntries(bal).POL || 0) - START_POL) < 1e-9, JSON.stringify(bal));
    await page.waitForTimeout(1500);
    const heroText = (await page.innerText('#tab-panel-wallet')).replace(/\s+/g, ' ');
    const expectedBrl = (START_POL * chain.priceUsd * USD_BRL).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    check('patrimônio em R$ na tela inicial', heroText.includes(expectedBrl), `esperado R$ ${expectedBrl}; tela: ${heroText.slice(0, 160)}`);

    // ------------------------------------------------------------ 2. Aba Render: faixa Sniper visível
    await page.click('.nav-tab-btn[data-tab="earn"]');
    await page.waitForFunction(() => window.RdeskDefi.getState().poolPrice > 0, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const st0 = await ui(() => window.RdeskDefi.getState());
    check('preço lido da pool Uniswap', Math.abs(st0.poolPrice - chain.priceUsd) / chain.priceUsd < 1e-6, `$${st0.poolPrice.toFixed(5)}`);
    check('faixa Sniper calculada em volta do preço', st0.sniper.min < st0.poolPrice && st0.poolPrice < st0.sniper.max,
        `$${st0.sniper.min.toFixed(4)} – $${st0.sniper.max.toFixed(4)}`);
    const chartLabel = await page.getAttribute('#earn-chart-container canvas', 'aria-label');
    check('gráfico mostra a faixa Sniper e o preço atual', /Faixa Sniper/.test(chartLabel || '') && /Preço atual/.test(chartLabel || ''), chartLabel);
    await page.screenshot({ path: 'tests/artifacts-render-antes.png', fullPage: true });

    // ------------------------------------------------------------ 3. Piloto automático abre a pool
    let mark = idle();
    await page.click('#btn-start-autopilot');
    await confirmReceipt(/Piloto Autom/);
    await page.waitForFunction(() => /Posição aberta|insuficiente|cancelad|rro|revert|diferente/i.test(document.getElementById('autopilot-feedback')?.textContent || ''), null, { timeout: 240000 }).catch(() => {});
    const apMsg = await page.textContent('#autopilot-feedback');
    let batch = chain.txs.slice(mark);
    console.log('   transações:', batch.map(describe).join(' -> '));
    check('piloto automático concluiu a abertura', /Posição aberta/.test(apMsg), apMsg);
    check('nenhuma transação reverteu na abertura', batch.length > 0 && batch.every((t) => t.status === 1), batch.filter((t) => !t.status).map(describe).join('; '));

    const positions = chain.positionsOf(OWNER);
    check('uma posição NFT criada para a carteira', positions.length === 1 && positions[0].liquidity > 0n, `qtd=${positions.length}`);
    const pos = positions[0];
    check('faixa contém o preço e respeita o espaçamento de ticks',
        pos.tickLower < chain.tick && chain.tick < pos.tickUpper && pos.tickLower % 10 === 0 && pos.tickUpper % 10 === 0,
        `[${pos.tickLower}, ${pos.tickUpper}] tick=${chain.tick}`);
    const mint = batch.find((t) => t.fn === 'mint');
    check('mint com proteção de slippage (mínimos > 0) e NFT para a própria carteira',
        Boolean(mint) && mint.args[0].amount0Min.gt(0) && mint.args[0].amount1Min.gt(0) && mint.args[0].recipient.toLowerCase() === OWNER,
        mint ? `min0=${mint.args[0].amount0Min} min1=${mint.args[0].amount1Min}` : 'sem mint');
    const swap = batch.find((t) => t.fn === 'exactInputSingle');
    check('swap de equilíbrio com mínimo de saída', Boolean(swap) && swap.args[0].amountOutMinimum.gt(0) && swap.args[0].recipient.toLowerCase() === OWNER,
        swap ? `minOut=${swap.args[0].amountOutMinimum}` : 'sem swap');
    const approvals = batch.filter((t) => t.fn === 'approve');
    check('aprovações de valor exato (nenhuma infinita)', approvals.length > 0 && approvals.every((t) => t.args[1].lt(ethers.constants.MaxUint256.div(2))), `${approvals.length} aprovações`);
    const nativeAfterOpen = fmtPol(chain.nativeOf(OWNER));
    check('reserva de gás preservada (~3 POL)', nativeAfterOpen > 2.7 && nativeAfterOpen <= 3.0001, `${nativeAfterOpen.toFixed(4)} POL`);
    const leftoverUsd = fmtPol(chain.balOf(ADDR.WPOL, OWNER)) * POL_USD + fmtUsdt(chain.balOf(ADDR.USDT0, OWNER));
    const deployedUsd = (START_POL - 3) * POL_USD;
    check('pelo menos 97% do capital entrou na pool', leftoverUsd / deployedUsd < 0.03, `sobrou $${leftoverUsd.toFixed(3)} de $${deployedUsd.toFixed(2)}`);

    await page.waitForFunction(() => document.querySelectorAll('#active-positions-list .position-card').length === 1, null, { timeout: 60000 }).catch(() => {});
    const card = (await page.innerText('#active-positions-list')).replace(/\s+/g, ' ');
    check('posição aparece na tela como RENDENDO, com os 3 botões', /RENDENDO/.test(card) && /Colher Tarifas/.test(card) && /Rebalancear/.test(card) && /Encerrar Pool/.test(card), card.slice(0, 160));
    const chartLabel2 = await page.getAttribute('#earn-chart-container canvas', 'aria-label');
    check('gráfico passa a mostrar a faixa da posição', new RegExp(`NFT #${pos.id}`).test(chartLabel2 || ''), chartLabel2);
    await page.screenshot({ path: 'tests/artifacts-render-posicao.png', fullPage: true });

    // ------------------------------------------------------------ 4. Colher tarifas
    chain.accrueFees(pos.id, ethers.utils.parseEther('2').toBigInt(), 150000n); // 2 WPOL + 0,15 USDT0
    await ui(() => window.RdeskDefi.refreshPoolAndPositions());
    const feesShown = (await page.innerText('#active-positions-list')).replace(/\s+/g, ' ');
    const feesBrl = ((2 * POL_USD + 0.15) * USD_BRL).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    check('tarifas acumuladas aparecem em R$ no cartão', feesShown.includes(feesBrl), `esperado R$ ${feesBrl}`);
    const w0 = chain.balOf(ADDR.WPOL, OWNER), u0 = chain.balOf(ADDR.USDT0, OWNER);
    mark = idle();
    await clickPosButton('Colher Tarifas');
    await confirmReceipt(/Colher Tarifas/);
    batch = await waitTxsSettled(mark, 1);
    console.log('   transações:', batch.map(describe).join(' -> '));
    check('colher: 2 WPOL + 0,15 USDT0 chegaram à carteira',
        chain.balOf(ADDR.WPOL, OWNER) - w0 === ethers.utils.parseEther('2').toBigInt() && chain.balOf(ADDR.USDT0, OWNER) - u0 === 150000n);
    check('colher não mexe na liquidez da posição', chain.state.positions[pos.id].liquidity === pos.liquidity);

    // ------------------------------------------------------------ 5. Preço sai da faixa -> rebalancear
    chain.tick = pos.tickUpper + 150;
    const newPrice = chain.priceUsd;
    await ui(async () => { await window.RdeskWallet.refreshBalances(); await window.RdeskDefi.refreshPoolAndPositions(); });
    console.log('   preço de mercado na app:', await ui(() => window.RdeskWallet.getPrices().POL), '| pool:', newPrice);
    const outCard = (await page.innerText('#active-positions-list')).replace(/\s+/g, ' ');
    check('posição passa a aparecer como FORA DA FAIXA', /FORA DA FAIXA/.test(outCard), outCard.slice(0, 120));
    await page.screenshot({ path: 'tests/artifacts-render-fora.png', fullPage: true });
    mark = idle();
    await ui(() => { document.getElementById('autopilot-feedback').textContent = ''; });
    await clickPosButton('Rebalancear');
    await confirmReceipt(/Rebalancear/);
    await page.waitForFunction(() => /Posição aberta|insuficiente|cancelad|rro|revert|diferente/i.test(document.getElementById('autopilot-feedback')?.textContent || ''), null, { timeout: 240000 }).catch(() => {});
    batch = chain.txs.slice(mark);
    console.log('   transações:', batch.map(describe).join(' -> '), '|', await page.textContent('#autopilot-feedback'));
    check('nenhuma transação reverteu no rebalanceamento', batch.length > 0 && batch.every((t) => t.status === 1), batch.filter((t) => !t.status).map(describe).join('; ') || dialogs.join(' | '));
    check('rebalanceamento pede uma única confirmação', !(await ui(() => { const m = document.getElementById('modal-receipt'); return getComputedStyle(m).display !== 'none'; })));
    const fresh = chain.positionsOf(OWNER).find((p) => p.id !== pos.id && p.liquidity > 0n);
    check('posição antiga esvaziada', chain.state.positions[pos.id].liquidity === 0n);
    check('nova posição aberta em torno do novo preço', Boolean(fresh) && fresh.tickLower < chain.tick && chain.tick < fresh.tickUpper,
        fresh ? `[${fresh.tickLower}, ${fresh.tickUpper}] tick=${chain.tick} ($${newPrice.toFixed(5)})` : 'não encontrada');
    const dec = innerCalls(batch).find((d) => d?.fn === 'decreaseLiquidity');
    check('retirada de liquidez com mínimos por simulação', Boolean(dec) && (dec.args[0].amount0Min.gt(0) || dec.args[0].amount1Min.gt(0)),
        dec ? `min0=${dec.args[0].amount0Min} min1=${dec.args[0].amount1Min}` : 'sem decreaseLiquidity');

    // ------------------------------------------------------------ 6. Encerrar a pool
    if (fresh) {
        await page.waitForFunction(() => document.querySelectorAll('#active-positions-list .position-card').length === 1, null, { timeout: 60000 }).catch(() => {});
        mark = idle();
        await clickPosButton('Encerrar Pool');
        await confirmReceipt(/Encerrar/);
        batch = await waitTxsSettled(mark, 1);
        console.log('   transações:', batch.map(describe).join(' -> '));
        check('encerrar: posição zerada sem reverter', batch.length > 0 && batch.every((t) => t.status === 1) && chain.state.positions[fresh.id].liquidity === 0n, dialogs.join(' | '));
        const finalUsd = (fmtPol(chain.balOf(ADDR.WPOL, OWNER)) + fmtPol(chain.nativeOf(OWNER))) * newPrice + fmtUsdt(chain.balOf(ADDR.USDT0, OWNER));
        check('fundos de volta na carteira', finalUsd > 60, `≈ $${finalUsd.toFixed(2)} (WPOL ${fmtPol(chain.balOf(ADDR.WPOL, OWNER)).toFixed(2)}, USDT0 ${fmtUsdt(chain.balOf(ADDR.USDT0, OWNER)).toFixed(2)}, POL ${fmtPol(chain.nativeOf(OWNER)).toFixed(3)})`);

        await page.waitForFunction((u) => {
            const b = window.RdeskWallet.getBalances().find((x) => x.chainId === 137 && x.symbol === 'USDT');
            return b && Math.abs(b.amount - u) < 0.01;
        }, fmtUsdt(chain.balOf(ADDR.USDT0, OWNER)), { timeout: 30000 }).catch(() => {});
        const endBal = Object.fromEntries(await ui(() => window.RdeskWallet.getBalances().filter((b) => b.chainId === 137).map((b) => [b.symbol, b.amount])));
        check('saldos na tela iguais aos da rede após as operações',
            Math.abs(endBal.USDT - fmtUsdt(chain.balOf(ADDR.USDT0, OWNER))) < 0.01 && Math.abs(endBal.WPOL - fmtPol(chain.balOf(ADDR.WPOL, OWNER))) < 0.01, JSON.stringify(endBal));
        check('lista de posições fica vazia', (await page.locator('#active-positions-list .position-card').count()) === 0);
        await page.click('.nav-tab-btn[data-tab="wallet"]');
        await page.waitForTimeout(600);
        const walletText = (await page.innerText('#tab-panel-wallet')).replace(/\s+/g, ' ');
        check('tela inicial mostra pools zeradas e o WPOL devolvido', /Pools: R\$\s?0,00/.test(walletText) && /WPOL/.test(walletText), walletText.slice(0, 200));
    }

    check('nenhum alerta de erro durante o fluxo', dialogs.length === 0, dialogs.join(' | '));

    // ------------------------------------------------------------ 7. Trocar (Uniswap V3)
    await page.click('.nav-tab-btn[data-tab="pixswap"]');
    await page.click('.submode-btn[data-sub="dex-swap"]');
    const doSwap = async (from, to, amount) => {
        await page.selectOption('#swap-from-token', from);
        await page.selectOption('#swap-to-token', to);
        await page.fill('#swap-amount-in', amount);
        await page.waitForFunction(() => parseFloat(document.getElementById('swap-amount-out').value) > 0, null, { timeout: 30000 });
        await page.waitForTimeout(1200); // cotação estabiliza (digitação dispara mais de uma)
        const quoted = parseFloat(await page.inputValue('#swap-amount-out'));
        const m = idle();
        await ui(() => { document.getElementById('swap-feedback').textContent = ''; });
        await page.click('#btn-execute-swap');
        await confirmReceipt(/Confirmar Troca/);
        await page.waitForFunction(() => /concluída|rro|cancelad|insuf|revert|Too little/i.test(document.getElementById('swap-feedback')?.textContent || ''), null, { timeout: 120000 }).catch(() => {});
        return { quoted, txs: chain.txs.slice(m), msg: await page.textContent('#swap-feedback') };
    };
    let usdtBefore = fmtUsdt(chain.balOf(ADDR.USDT0, OWNER));
    const s1 = await doSwap('WPOL', 'USDT', '100');
    console.log('   transações:', s1.txs.map(describe).join(' -> '));
    const got1 = fmtUsdt(chain.balOf(ADDR.USDT0, OWNER)) - usdtBefore;
    check('trocar 100 WPOL por USDT: recebe o cotado, com mínimo de saída',
        /concluída/.test(s1.msg) && s1.txs.every((x) => x.status === 1) && Math.abs(got1 - s1.quoted) / s1.quoted < 0.002 &&
        s1.txs.find((x) => x.fn === 'exactInputSingle')?.args[0].amountOutMinimum.gt(0), `cotado ${s1.quoted} recebido ${got1.toFixed(4)} | ${s1.msg}`);

    const polBefore = fmtPol(chain.nativeOf(OWNER)), wpolBefore = chain.balOf(ADDR.WPOL, OWNER);
    const s2 = await doSwap('USDT', 'POL', '5');
    console.log('   transações:', s2.txs.map(describe).join(' -> '));
    const polGain = fmtPol(chain.nativeOf(OWNER)) - polBefore;
    check('trocar 5 USDT por POL entrega POL nativo (não WPOL)',
        /concluída/.test(s2.msg) && s2.txs.every((x) => x.status === 1) && polGain > s2.quoted * 0.97 && chain.balOf(ADDR.WPOL, OWNER) === wpolBefore,
        `cotado ${s2.quoted} POL; POL nativo +${polGain.toFixed(4)} (já descontado o gás) | ${s2.msg}`);

    await page.selectOption('#swap-from-token', 'BRZ').catch(() => {});
    await page.selectOption('#swap-to-token', 'USDT');
    await page.fill('#swap-amount-in', '10');
    await page.waitForTimeout(2500);
    check('par sem pool direta não oferece troca que reverteria', (await page.inputValue('#swap-amount-out')) === '--', await page.textContent('#swap-quote-info'));
    await page.click('.nav-tab-btn[data-tab="wallet"]');

    // ------------------------------------------------------------ 8. Enviar cripto
    const DEST = '0x000000000000000000000000000000000000dEaD';
    for (const [sym, amount, read] of [
        ['USDT0', '1.5', () => fmtUsdt(chain.balOf(ADDR.USDT0, DEST))],
        ['POL', '0.25', () => fmtPol(chain.nativeOf(DEST))]
    ]) {
        dialogs.length = 0;
        await page.click('#btn-action-send');
        await page.waitForSelector('#rmw-snd-to');
        await page.selectOption('#rmw-snd-token', sym);
        await page.fill('#rmw-snd-to', DEST);
        await page.fill('#rmw-snd-amt', amount);
        await page.click('#rmw-snd-exec');
        await page.waitForFunction(() => /confirmado|rro|insuf|inválid|revert/i.test(document.getElementById('rmw-snd-msg')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
        const msg = await page.innerText('#rmw-snd-msg');
        check(`enviar ${amount} ${sym}: pede confirmação com o endereço e chega ao destino`,
            dialogs.length === 1 && dialogs[0].includes(DEST) && /confirmado/i.test(msg) && Math.abs(read() - Number(amount)) < 1e-9, `${msg} | destino tem ${read()}`);
        await ui(() => window.RdeskWallet.closeModal());
    }
    dialogs.length = 0;
    await page.click('#btn-action-send');
    await page.fill('#rmw-snd-to', '0x1234');
    await page.fill('#rmw-snd-amt', '1');
    await page.click('#rmw-snd-exec');
    check('endereço inválido é recusado antes de assinar', /inválido/i.test(await page.innerText('#rmw-snd-msg')) && dialogs.length === 0);
    await ui(() => window.RdeskWallet.closeModal());
    check('nenhuma violação da política de segurança de conteúdo (CSP)', cspViolations.length === 0, cspViolations.slice(0, 3).join(' | '));
    check('sem erros de JavaScript durante todo o fluxo', pageErrors.length === 0, [...new Set(pageErrors)].slice(0, 5).join(' | '));
    check('a simulação conhecia todas as chamadas feitas pela app', chain.unknownCalls.length === 0, JSON.stringify(chain.unknownCalls.slice(0, 6)));
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
    console.log('   piloto:', await page.textContent('#autopilot-feedback').catch(() => ''));
    console.log('   alertas:', dialogs.join(' | '));
    console.log('   transações até aqui:', chain.txs.map(describe).join(' -> '));
    console.log('   falhas RPC:', JSON.stringify((chain.failures || []).slice(0, 6)));
    console.log('   chamadas desconhecidas:', JSON.stringify(chain.unknownCalls.slice(0, 8)));
} finally {
    await page.screenshot({ path: 'tests/artifacts-flow-fim.png' }).catch(() => {});
    await browser.close();
    server.close();
    finish();
}
