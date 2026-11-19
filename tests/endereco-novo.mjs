// Bitcoin com endereço novo a cada recebimento: soma todos os endereços, mostra um endereço nunca usado,
// gasta de vários endereços numa transação só e manda o troco para um endereço novo.
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, waitFn, unlockViaDoor, TEST_MNEMONIC, BTC_TEST_OWNER, ROOT } from './helpers.mjs';
import { MockChain, ethers } from './mock-chain.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
globalThis.window = globalThis; globalThis.ethers = ethers;
require(path.join(ROOT, 'bitcoin.js'));
const B = globalThis.RdeskBitcoin;
const at = (c, i) => B.deriveAtPath(TEST_MNEMONIC, `m/84'/0'/0'/${c}/${i}`).address;
const EXT1 = at(0, 1), EXT2 = at(0, 2), EXT3 = at(0, 3), INT0 = at(1, 0), INT1 = at(1, 1);
const DEST = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' };
const btc = {
    fees: { fastestFee: 6, halfHourFee: 4, hourFee: 3, economyFee: 2, minimumFee: 1 },
    utxos: [
        { txid: 'a1'.repeat(32), vout: 0, value: 100000, addr: BTC_TEST_OWNER },
        { txid: 'b2'.repeat(32), vout: 1, value: 50000, addr: EXT1 },
        { txid: 'c3'.repeat(32), vout: 0, value: 20000, addr: INT0 }
    ],
    broadcasts: [], txid: '5'.repeat(64)
};
const { server, url } = await startStaticServer(8784);
const browser = await launch();
try {
    const ctx = await browser.newContext(MOBILE);
    const { page, pageErrors, cspViolations } = await openApp(ctx, url, { 137: new MockChain({}) }, { btc });
    await importWalletViaUi(page);
    await waitFn(page, () => (window.RdeskWallet.getBalances().find((b) => b.chainId === 'btc')?.amount || 0) > 0, null, { timeout: 20000 });
    const total = await page.evaluate(() => window.RdeskWallet.getBalances().find((b) => b.chainId === 'btc').amount);
    check('saldo soma os três endereços (antigo, recebimento e troco)', Math.round(total * 1e8) === 170000, `${total}`);
    const list = await page.evaluate(() => window.RdeskWallet.getBitcoinAddresses());
    check('caminho padrão BIP84 (recupera em qualquer carteira Bitcoin)', list.includes(EXT1) && list.includes(INT0) && list[0] === BTC_TEST_OWNER);
    await waitFn(page, (a) => window.RdeskWallet.getBitcoinAddress() === a, EXT2, { timeout: 10000 });
    check('receber mostra um endereço nunca usado (o 3º)', true);
    await page.click('#btn-action-receive');
    await page.click('[data-net="btc"]');
    await page.waitForSelector('#rmw-rec-new');
    check('tela de receber explica que o endereço muda sozinho', (await page.innerText('#rmw-rec-address')) === EXT2 && /muda sozinho/.test(await page.innerText('.rec-fresh')));
    await page.click('#rmw-rec-new');
    await waitFn(page, (a) => document.getElementById('rmw-rec-address')?.textContent === a, EXT3, { timeout: 10000 });
    check('"Gerar endereço novo" dá outro endereço', true);
    await page.screenshot({ path: 'tests/artifacts-endereco-novo.png' });
    await page.evaluate(() => window.RdeskWallet.closeModal());

    // ---------------------------------------------------- enviar gastando de vários endereços
    await page.click('#btn-action-send');
    await page.selectOption('#rmw-snd-chain', 'btc');
    await waitFn(page, () => Number(document.getElementById('rmw-snd-fee')?.value) > 0, null, { timeout: 15000 });
    await page.fill('#rmw-snd-to', DEST);
    await page.fill('#rmw-snd-amt', '0.00160000');
    await page.click('#rmw-snd-exec');
    await waitFn(page, () => /enviado/i.test(document.querySelector('#rdesk-mw-sheet')?.textContent || ''), null, { timeout: 20000 });
    const d = B.decodeTx(btc.broadcasts.at(-1));
    const outs = d.outputs.map((o) => o.address);
    check('uma transação só gasta moedas dos três endereços', d.inputs.length === 3, `${d.inputs.length} entradas`);
    check('troco vai para um endereço de troco NOVO (não reaproveita)', outs[0] === DEST && outs[1] === INT1 && !outs.includes(BTC_TEST_OWNER), outs.join(' '));
    // assinatura de cada entrada confere com a chave do endereço dela (recalcula com a mesma biblioteca)
    const keys = { [`${'a1'.repeat(32)}:0`]: B.deriveAtPath(TEST_MNEMONIC, "m/84'/0'/0'/0/0"), [`${'b2'.repeat(32)}:1`]: B.deriveAtPath(TEST_MNEMONIC, "m/84'/0'/0'/0/1"), [`${'c3'.repeat(32)}:0`]: B.deriveAtPath(TEST_MNEMONIC, "m/84'/0'/0'/1/0") };
    const plan = { inputs: d.inputs.map((x) => ({ txid: x.txid, vout: x.vout, value: btc.utxos.find((u) => u.txid === x.txid).value, privateKey: keys[`${x.txid}:${x.vout}`].privateKey })), outputs: d.outputs.map((o) => ({ value: o.value, script: B.addressToScript(o.address).script })), fee: 170000 - d.outputs.reduce((s, o) => s + o.value, 0) };
    check('cada moeda foi assinada pela chave do seu próprio endereço', B.signTransaction(plan, null).hex === btc.broadcasts.at(-1));
    const nextChange = await page.evaluate(() => window.RdeskWallet.getBitcoinChangeAddress());
    check('depois de gastar, o próximo troco já é outro endereço', nextChange !== INT1, nextChange);

    // ---------------------------------------------------- continua depois de fechar e abrir
    await page.reload({ waitUntil: 'load' });
    await unlockViaDoor(page);
    check('endereço de receber continua o novo depois de fechar e abrir o app', (await page.evaluate(() => window.RdeskWallet.getBitcoinAddress())) === EXT3);
    // Pular endereços tem limite: quem restaurar as palavras em outro aparelho precisa enxergar todos
    const gap = await page.evaluate(async () => {
        const got = [];
        for (let i = 0; i < 4; i++) { try { got.push(await window.RdeskWallet.newBitcoinAddress()); } catch (e) { got.push('ERRO: ' + e.message); } }
        return got;
    });
    check('"endereço novo" para antes de sair da área que a restauração vigia', gap.slice(0, 2).every((a) => a.startsWith('bc1')) && gap[3].startsWith('ERRO') && /restaurar/.test(gap[3]), gap.join(' | '));
    const lastOk = gap.filter((a) => a.startsWith('bc1')).at(-1);
    const restoreWindow = [2, 3, 4, 5].map((i) => at(0, i)); // usado até o índice 1 -> restauração vigia 2..5
    check('o último endereço novo ainda está dentro da área vigiada ao restaurar', restoreWindow.includes(lastOk), lastOk);
    check('sem erros de JavaScript nem violação de CSP', pageErrors.length === 0 && cspViolations.length === 0, [...pageErrors, ...cspViolations].slice(0, 3).join(' | '));
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
