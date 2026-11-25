// v48.4: a troca descobre sozinha os fundos da Uniswap e cota todos os caminhos de até 3 trocas.
// Cenário de hoje: o BRLS só tem fundo com o BRLA. BRLS → POL precisa ir BRLS → BRLA → USDT → POL.
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, TEST_MNEMONIC, POL_USD, waitFn, deslizar } from './helpers.mjs';
import { MockChain, ADDR, ethers } from './mock-chain.mjs';

const OWNER = ethers.Wallet.fromMnemonic(TEST_MNEMONIC).address.toLowerCase();
const BRLS = '0x3f5fd15e3d5250ae6700bfd8f1adb6b74afca1d4';
const chain = new MockChain({ polPriceUsd: POL_USD });
chain.fundNative(OWNER, 50);
chain.extraPools.push({ a: BRLS, b: ADDR.BRLA, fee: 100, rate: 1 }); // único fundo do BRLS
chain.fundToken(BRLS, OWNER, 30);

const { server, url } = await startStaticServer(8798);
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
const { page, pageErrors } = await openApp(context, url, chain, {});
const pathHops = (hex) => (hex.length - 2 - 40) / 46;

try {
    await importWalletViaUi(page);
    await page.evaluate(() => window.RdeskWallet.refreshBalances());
    await page.click('.nav-tab-btn[data-tab="pixswap"]');
    await page.selectOption('#swap-from-token', 'BRLS');
    await page.selectOption('#swap-to-token', 'POL');
    await page.fill('#swap-amount-in', '10');
    await waitFn(page, () => parseFloat(document.getElementById('swap-amount-out').value.replace(',', '.')) > 0 && /Uniswap/.test(document.getElementById('swap-quote-info').textContent), null, { timeout: 45000 });
    await page.waitForTimeout(1200);
    const info = await page.textContent('#swap-quote-info');
    const quoted = parseFloat((await page.inputValue('#swap-amount-out')).replace(',', '.'));
    // 10 BRLS = 10 BRLA = 10/5,4 USDT = (10/5,4)/0,09 POL ≈ 20,6 POL (menos as tarifas)
    const esperado = (10 / 5.4) / POL_USD;
    check('BRLS → POL: acha o caminho BRLS → BRLA → USDT → POL sozinho', /via BRLA → USDT/.test(info), info);
    check('cotação do caminho de 3 trocas bate com os preços dos fundos', Math.abs(quoted - esperado) / esperado < 0.01, `cotado ${quoted}, esperado ≈ ${esperado.toFixed(3)}`);

    const m = chain.txs.length;
    const polAntes = Number(ethers.utils.formatEther(chain.nativeOf(OWNER).toString()));
    await page.click('#btn-execute-swap');
    await deslizar(page, '#modal-receipt', { timeout: 60000 });
    await waitFn(page, () => /concluída|rro|revert|Too little/i.test(document.getElementById('swap-feedback')?.textContent || ''), null, { timeout: 120000 }).catch(() => {});
    const msg = await page.textContent('#swap-feedback');
    const txs = chain.txs.slice(m);
    const troca = txs.find((t) => t.fn === 'exactInput');
    const ganho = Number(ethers.utils.formatEther(chain.nativeOf(OWNER).toString())) - polAntes;
    check('executa as 3 trocas numa só transação, com mínimo de saída', Boolean(troca) && troca.status === 1 && pathHops(troca.args[0].path) === 3 && troca.args[0].amountOutMinimum.gt(0), troca ? `${pathHops(troca.args[0].path)} trocas` : txs.map((t) => t.fn).join(','));
    check('recebe POL de verdade (≈ o cotado)', /concluída/.test(msg) && ganho > quoted * 0.97, `${msg} | +${ganho.toFixed(4)} POL`);

    // Fundo novo aparece sozinho: alguém cria BRLS/WPOL direto, com preço melhor → a troca passa a usar ele
    chain.extraPools.push({ a: BRLS, b: ADDR.WPOL, fee: 3000, rate: 1 / 0.45 }); // 1 BRLS ≈ 2,22 POL (melhor que ~2,06)
    await page.evaluate(() => { window.__RDESK_SEM_CACHE_FUNDOS__ = true; });
    await page.fill('#swap-amount-in', '5');
    await page.waitForTimeout(300);
    await page.fill('#swap-amount-in', '4');
    await waitFn(page, () => /direto/.test(document.getElementById('swap-quote-info').textContent), null, { timeout: 45000 }).catch(() => {});
    const info2 = await page.textContent('#swap-quote-info');
    check('fundo novo BRLS/POL entra sozinho e vira a melhor rota', /direto/.test(info2), info2);

    // Par sem nenhum caminho com dinheiro: avisa, não oferece troca que reverteria
    await page.selectOption('#swap-to-token', 'WETH');
    await waitFn(page, () => /Não há pool/.test(document.getElementById('swap-quote-info').textContent), null, { timeout: 45000 }).catch(() => {});
    check('sem caminho com dinheiro: avisa que não há fundo', /Não há pool/.test(await page.textContent('#swap-quote-info')), await page.textContent('#swap-quote-info'));
    check('sem erros na página', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
    await browser.close();
    server.close();
}
finish();
