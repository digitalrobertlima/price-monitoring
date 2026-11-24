// Várias redes, Bitcoin nativo, moeda personalizada, contratos visíveis, botões de voltar,
// cotações e leitor de QR — tudo com cliques reais em tela de celular e redes simuladas.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, waitFn, TEST_MNEMONIC, USD_BRL, ROOT } from './helpers.mjs';
import { MockChain, ADDR, ethers } from './mock-chain.mjs';

const require = createRequire(import.meta.url);
globalThis.window = globalThis; globalThis.ethers = ethers;
require(path.join(ROOT, 'bitcoin.js'));
const BTC = globalThis.RdeskBitcoin;

const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' };
const OWNER = ethers.Wallet.fromMnemonic(TEST_MNEMONIC).address;
const OWNER_BTC = BTC.deriveFromMnemonic(TEST_MNEMONIC, 0).address;
const FRESH_BTC = BTC.deriveAtPath(TEST_MNEMONIC, "m/84'/0'/0'/0/1").address;   // 1º endereço novo (o antigo já recebeu)
const CHANGE_BTC = BTC.deriveAtPath(TEST_MNEMONIC, "m/84'/0'/0'/1/0").address;  // 1º endereço de troco
const DEST = '0x000000000000000000000000000000000000dEaD';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const GOLD = '0x1111111111111111111111111111111111111111';

// ---- redes simuladas ----
const polygon = new MockChain({ polPriceUsd: 0.09 });
polygon.fundNative(OWNER, 50);
polygon.fundToken(ADDR.USDT0, OWNER, 120);
polygon.registerToken(GOLD, { symbol: 'GOLD', name: 'Gold Test Token', decimals: 9 });
polygon.fundToken(GOLD, OWNER, 42.5);
polygon.registerToken('0x2222222222222222222222222222222222222222', { symbol: 'USDT', name: 'Tether falso', decimals: 6 });
const base = new MockChain({ chainId: 8453 });
base.fundNative(OWNER, 0.05);
base.registerToken(BASE_USDC, { symbol: 'USDC', name: 'USD Coin', decimals: 6 });
base.fundToken(BASE_USDC, OWNER, 75);
const arbitrum = new MockChain({ chainId: 42161 });
arbitrum.fundNative(OWNER, 0.4);
const chains = { 137: polygon, 8453: base, 42161: arbitrum, 10: new MockChain({ chainId: 10 }), 1: new MockChain({ chainId: 1 }), 42220: new MockChain({ chainId: 42220 }), 56: new MockChain({ chainId: 56 }) };
const btc = {
    fees: { fastestFee: 12, halfHourFee: 8, hourFee: 6, economyFee: 3, minimumFee: 1 },
    utxos: [{ txid: 'ab'.repeat(32), vout: 1, value: 250000 }, { txid: 'cd'.repeat(32), vout: 0, value: 80000 }, { txid: 'ef'.repeat(32), vout: 3, value: 40000, confirmed: false }],
    broadcasts: [], txid: '9'.repeat(64)
};

const { server, url } = await startStaticServer(8768);
const browser = await launch();
const sheet = async (page) => (await page.innerText('#rdesk-mw-sheet')).replace(/\s+/g, ' ');
const describe = (t) => `${t.contract}.${t.fn}${t.status ? '' : ' [REVERTEU: ' + t.revertReason + ']'}`;

try {
    const context = await browser.newContext({ ...MOBILE, permissions: ['clipboard-read', 'clipboard-write'] });
    const { page, pageErrors, dialogs, external, cspViolations } = await openApp(context, url, chains, { btc, customPrices: { [GOLD.toLowerCase()]: 2 } });
    const ui = (fn, arg) => page.evaluate(fn, arg);
    await importWalletViaUi(page);
    await ui(() => window.RdeskWallet.refreshBalances());
    await page.waitForTimeout(800);

    // ================================================================ 1. Lista de moedas: selos, rede, contrato, Bitcoin
    const rows = await page.$$eval('#wallet-assets-list .asset-row-btn', (els) => els.map((e) => ({
        chain: e.getAttribute('data-asset-chain'), symbol: e.getAttribute('data-asset-symbol'), text: e.innerText.replace(/\s+/g, ' '),
        badge: Boolean(e.querySelector('.coin-badge')), chainBadge: e.querySelector('.chain-badge')?.textContent.trim()
    })));
    const row = (c, s) => rows.find((r) => r.chain === String(c) && r.symbol === s);
    check('lista mostra saldos de várias redes ao mesmo tempo (Polygon, Base, Arbitrum, Bitcoin)',
        Boolean(row(137, 'POL') && row(137, 'USDT') && row(8453, 'USDC') && row(8453, 'ETH') && row(42161, 'ETH') && row('btc', 'BTC')), rows.map((r) => `${r.symbol}@${r.chain}`).join(' '));
    check('cada linha tem o selo da moeda e diz em que rede ela está', rows.length > 0 && rows.every((r) => r.badge && /· (Polygon|Base|Arbitrum|Ethereum|Optimism|Celo|Bitcoin)/.test(r.text)), rows.map((r) => r.text.slice(0, 40)).join(' | '));
    check('linha usa nome que qualquer um entende e esconde o contrato (fica no detalhe)', /Dólar digital \(Tether\)/.test(row(137, 'USDT')?.text || '') && !/0x/.test(row(137, 'USDT')?.text || ''), row(137, 'USDT')?.text);
    const btcBrl = (0.0037 * 90000 * USD_BRL).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    check('saldo de Bitcoin (inclui o que ainda não confirmou) aparece em R$', (row('btc', 'BTC')?.text || '').includes(btcBrl) && /0,0037/.test(row('btc', 'BTC')?.text || ''), row('btc', 'BTC')?.text);
    const filterOpts = await page.$$eval('#wallet-chain-filter option', (o) => o.map((x) => x.textContent));
    check('filtro de rede lista as 7 redes e Bitcoin', ['Polygon', 'Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Celo', 'BNB Chain', 'Bitcoin'].every((n) => filterOpts.includes(n)), filterOpts.join(','));
    await page.click('#assets-options summary');
    await page.selectOption('#wallet-chain-filter', '8453');
    const onlyBase = await page.$$eval('#wallet-assets-list .asset-row-btn', (els) => els.map((e) => e.getAttribute('data-asset-chain')));
    check('filtrar por Base mostra só moedas da Base', onlyBase.length === 2 && onlyBase.every((c) => c === '8453'), onlyBase.join(','));
    await page.selectOption('#wallet-chain-filter', 'ALL');
    await page.check('#wallet-show-zero');
    const withZero = await page.$$eval('#wallet-assets-list .asset-row-btn', (els) => els.length);
    check('"Mostrar moedas sem saldo" lista todas as moedas suportadas', withZero >= 24, `${withZero} linhas`);
    await page.uncheck('#wallet-show-zero');
    check('cotações aparecem como ao vivo', /ao vivo/.test(await page.innerText('#hero-quote-status')), await page.innerText('#hero-quote-status'));
    await page.screenshot({ path: 'tests/artifacts-mc-lista.png', fullPage: true });

    // Olho: esconde todos os valores e lembra a escolha
    const visibleText = async () => page.evaluate(() => {
        // texto que a pessoa realmente enxerga (ignora o que ficou transparente)
        const out = [];
        const walk = (el) => {
            for (const n of el.childNodes) {
                if (n.nodeType === 3) {
                    const cs = getComputedStyle(n.parentElement);
                    if (cs.visibility !== 'hidden' && cs.color !== 'rgba(0, 0, 0, 0)' && n.parentElement.offsetParent !== null) out.push(n.textContent);
                } else if (n.nodeType === 1 && !n.hasAttribute('data-public')) walk(n); // preço de mercado não é dado seu
            }
        };
        walk(document.querySelector('.tab-panel.active') || document.body);
        return out.join(' ').replace(/\s+/g, ' ');
    });
    const before = await visibleText();
    await page.click('#btn-toggle-balances');
    const hiddenTxt = await visibleText();
    await page.screenshot({ path: 'tests/artifacts-mc-saldos-ocultos.png' });
    check('olho esconde patrimônio, valores em R$ e quantidades de cada moeda',
        /R\$ \d/.test(before) && !/R\$\s?\d/.test(hiddenTxt) && !/\d+(,\d+)? (USDT|BTC|ETH|USDC|POL)\b/.test(hiddenTxt) && (await page.getAttribute('#btn-toggle-balances', 'aria-pressed')) === 'true',
        hiddenTxt.match(/R\$\s?[\d.,]+|\d+(,\d+)? (USDT|BTC|ETH|USDC|POL)/g)?.slice(0, 5).join(' | ') || 'ok');
    await ui(() => window.RdeskWallet.refreshBalances());
    check('saldos continuam escondidos depois de atualizar', !/R\$\s?\d/.test(await visibleText()));
    const second = await context.newPage();
    await second.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await second.goto(url, { waitUntil: 'load' });
    await waitFn(second, () => Boolean(window.RdeskPrivacy), null, { timeout: 20000 });
    check('a escolha de esconder fica salva ao reabrir o app', await second.evaluate(() => document.body.classList.contains('privacy-on')));
    await second.close();
    await page.click('#btn-toggle-balances');
    check('tocar de novo mostra os saldos', !(await ui(() => document.body.classList.contains('privacy-on'))) && (await page.getAttribute('#btn-toggle-balances', 'aria-pressed')) === 'false');
    await ui(() => window.RdeskWallet.refreshBalances());
    await page.waitForTimeout(600);

    // ================================================================ 2. Detalhe da moeda: contrato completo + voltar
    await page.click('#wallet-assets-list [data-asset-chain="8453"][data-asset-symbol="USDC"]');
    await page.waitForSelector('#rmw-asset-send');
    const assetText = await sheet(page);
    check('detalhe mostra o contrato inteiro e link do explorador da rede certa',
        assetText.includes(BASE_USDC) && (await page.getAttribute('#rdesk-mw-sheet .contract-actions a', 'href')) === `https://basescan.org/token/${BASE_USDC}`, assetText.slice(0, 150));
    await page.screenshot({ path: 'tests/artifacts-mc-moeda.png' });
    await page.click('#rmw-asset-send');
    await page.waitForSelector('#rmw-snd-exec');
    check('"Enviar" a partir da moeda já abre na rede e moeda certas',
        (await page.inputValue('#rmw-snd-chain')) === '8453' && (await page.inputValue('#rmw-snd-token')) === 'USDC' && (await sheet(page)).includes(BASE_USDC));
    check('tela de enviar tem botão de voltar', (await page.locator('#rdesk-mw-sheet [data-rmw-back]').count()) === 1);
    await page.click('#rdesk-mw-sheet [data-rmw-back]');
    check('voltar retorna para a tela da moeda', (await page.locator('#rmw-asset-send').count()) === 1);
    await page.goBack();
    await page.waitForTimeout(400);
    check('botão voltar do celular fecha o modal sem sair do app',
        !(await ui(() => document.getElementById('rdesk-mw-overlay').classList.contains('open'))) && page.url().startsWith(url) && (await ui(() => window.RdeskWallet.isConnected())));

    // ================================================================ 3. Enviar USDC na Base
    await page.click('#btn-action-send');
    await page.waitForSelector('#rmw-snd-chain');
    await page.selectOption('#rmw-snd-chain', '8453');
    await page.selectOption('#rmw-snd-token', 'USDC');
    await page.fill('#rmw-snd-to', BASE_USDC);
    await page.fill('#rmw-snd-amt', '10');
    dialogs.length = 0;
    await page.click('#rmw-snd-exec');
    await page.waitForTimeout(500);
    check('enviar para o endereço do próprio contrato é bloqueado', /CONTRATO/.test(await page.innerText('#rmw-snd-msg')) && dialogs.length === 0 && base.txs.length === 0, await page.innerText('#rmw-snd-msg'));
    await page.fill('#rmw-snd-to', DEST);
    await page.fill('#rmw-snd-amt', '10,5');
    await page.click('#rmw-snd-exec');
    await waitFn(page, () => /confirmado|rro|insuf|inválid/i.test(document.getElementById('rmw-snd-msg')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
    const baseMsg = await page.innerText('#rmw-snd-msg');
    console.log('   Base:', base.txs.map(describe).join(' -> '));
    check('10,5 USDC enviados na Base (vírgula aceita), contrato certo, nada na Polygon',
        /confirmado na Base/.test(baseMsg) && base.txs.length === 1 && base.txs[0].to === BASE_USDC.toLowerCase() && base.txs[0].status === 1 &&
        Number(base.balOf(BASE_USDC, DEST)) === 10.5e6 && polygon.txs.length === 0, baseMsg);
    check('confirmação mostra rede, contrato da moeda e endereço de destino',
        dialogs.length === 1 && dialogs[0].includes('rede Base') && dialogs[0].includes(BASE_USDC) && dialogs[0].includes(DEST), dialogs[0]?.replace(/\s+/g, ' ').slice(0, 160));
    check('link da transação aponta para o explorador da Base', (await page.getAttribute('#rmw-snd-msg a', 'href') || '').startsWith('https://basescan.org/tx/0x'));

    // ETH nativo na Arbitrum com "Máx"
    await page.selectOption('#rmw-snd-chain', '42161');
    await page.waitForSelector('#rmw-snd-token');
    await page.fill('#rmw-snd-to', DEST);
    await page.click('#rmw-snd-max');
    await waitFn(page, () => parseFloat(document.getElementById('rmw-snd-amt').value) > 0, null, { timeout: 30000 });
    const maxEth = parseFloat(await page.inputValue('#rmw-snd-amt'));
    dialogs.length = 0;
    await page.click('#rmw-snd-exec');
    await waitFn(page, () => /confirmado|rro|insuf|inválid/i.test(document.getElementById('rmw-snd-msg')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
    const arbLeft = Number(ethers.utils.formatEther(arbitrum.nativeOf(OWNER).toString()));
    check('"Máx" de ETH na Arbitrum envia quase tudo e ainda sobra para a taxa',
        /confirmado na Arbitrum/.test(await page.innerText('#rmw-snd-msg')) && maxEth > 0.3 && maxEth < 0.4 && arbLeft > 0 && arbLeft < 0.1 &&
        Math.abs(Number(ethers.utils.formatEther(arbitrum.nativeOf(DEST).toString())) - maxEth) < 1e-9, `enviou ${maxEth}, sobrou ${arbLeft} | ${await page.innerText('#rmw-snd-msg')} | ${arbitrum.txs.map(describe).join(',')} ${JSON.stringify(arbitrum.failures||[])} ${dialogs.join('/')}`);
    await ui(() => window.RdeskWallet.closeModal());

    // ================================================================ 4. Receber: redes, endereços, QR, contratos
    await page.click('#btn-action-receive');
    await page.waitForSelector('#rmw-rec-qr img[src]', { state: 'attached' });
    const chips = await page.$$eval('#rdesk-mw-sheet .net-chip', (els) => els.map((e) => e.textContent.trim()));
    check('receber oferece Bitcoin primeiro + 7 redes', chips.join(',') === 'Bitcoin,Polygon,Ethereum,Base,Arbitrum,Optimism,Celo,BNB Chain', chips.join(','));
    check('rede Polygon: endereço 0x da carteira e aviso de rede', (await page.innerText('#rmw-rec-address')) === OWNER && /somente pela rede Polygon/.test(await page.innerText('#rmw-rec-warning')));
    await page.click('#rdesk-mw-sheet .net-chip[data-net="42220"]');
    await page.waitForSelector('#rmw-rec-qr img[src]', { state: 'attached' });
    const celoText = await sheet(page);
    check('rede Celo: mesmo endereço, aviso da Celo e contratos de USDT/USDC da Celo',
        (await page.innerText('#rmw-rec-address')) === OWNER && /somente pela rede Celo/.test(celoText) && /0x48065f…483D5e/.test(celoText) && /0xcebA93…32118C/.test(celoText), celoText.slice(-160));
    await page.click('#rdesk-mw-sheet .net-chip[data-net="btc"]');
    await page.waitForSelector('#rmw-rec-qr img[src]', { state: 'attached' });
    check('rede Bitcoin: endereço bc1q NOVO da mesma frase (BIP84, o antigo já recebeu) e aviso sobre Lightning',
        (await page.innerText('#rmw-rec-address')) === FRESH_BTC && /não recebe por Lightning/.test(await page.innerText('#rmw-rec-warning')), await page.innerText('#rmw-rec-address'));
    await page.screenshot({ path: 'tests/artifacts-mc-receber-btc.png' });
    await ui(() => window.RdeskWallet.closeModal());

    // ================================================================ 5. Enviar Bitcoin
    const BTC_DEST = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';
    await page.click('#btn-action-send');
    await page.selectOption('#rmw-snd-chain', 'btc');
    await waitFn(page, () => /sat\/vB/.test(document.getElementById('rmw-snd-fee')?.textContent || ''), null, { timeout: 30000 });
    await page.fill('#rmw-snd-amt', '0.001');
    await page.fill('#rmw-snd-to', 'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq');
    await page.click('#rmw-snd-exec');
    await page.waitForTimeout(400);
    check('pedido Lightning no destino é recusado com explicação', /Lightning/.test(await page.innerText('#rmw-snd-msg')) && btc.broadcasts.length === 0, await page.innerText('#rmw-snd-msg'));
    await page.fill('#rmw-snd-to', 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9h');
    await page.click('#rmw-snd-exec');
    await page.waitForTimeout(400);
    check('endereço Bitcoin com erro de digitação é recusado', /inválido/.test(await page.innerText('#rmw-snd-msg')) && btc.broadcasts.length === 0);
    await page.fill('#rmw-snd-to', BTC_DEST);
    dialogs.length = 0;
    await page.click('#rmw-snd-exec');
    await waitFn(page, () => /enviado|rro|insuf|recus/i.test(document.getElementById('rmw-snd-msg')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
    const btcMsg = await page.innerText('#rmw-snd-msg');
    check('confirmação do Bitcoin mostra valor, taxa em satoshis e total', dialogs.length === 1 && /0\.00100000 BTC/.test(dialogs[0]) && /Taxa da rede: \d+ sat/.test(dialogs[0]) && dialogs[0].includes(BTC_DEST), dialogs[0]?.replace(/\s+/g, ' ').slice(0, 200));
    // Decodifica o que foi transmitido
    const hex = btc.broadcasts[0] || '';
    const raw = Buffer.from(hex, 'hex'); let o = 6; // versão(4) + marcador(2)
    const le = (n) => { let v = 0; for (let i = n - 1; i >= 0; i--) v = v * 256 + raw[o + i]; o += n; return v; };
    const nIn = raw[o++]; const ins = [];
    for (let i = 0; i < nIn; i++) { const txid = Buffer.from(raw.subarray(o, o + 32)).reverse().toString('hex'); o += 32; ins.push({ txid, vout: le(4) }); o += 1; o += 4; }
    const nOut = raw[o++]; const outs = [];
    for (let i = 0; i < nOut; i++) { const value = le(8); const len = raw[o++]; outs.push({ value, script: raw.subarray(o, o + len).toString('hex') }); o += len; }
    const spent = ins.reduce((n, i) => n + btc.utxos.find((u) => u.txid === i.txid).value, 0);
    const fee = spent - outs.reduce((n, x) => n + x.value, 0);
    const toHex = (u8) => Buffer.from(u8).toString('hex');
    check('transação Bitcoin transmitida: 0,001 BTC ao destino, troco num endereço de troco meu (novo), só saldo confirmado',
        btc.broadcasts.length === 1 && /enviado/i.test(btcMsg) && outs.length === 2 && outs[0].value === 100000 && outs[0].script === toHex(BTC.addressToScript(BTC_DEST).script) &&
        outs[1].script === toHex(BTC.addressToScript(CHANGE_BTC).script) && ins.every((i) => i.txid !== 'ef'.repeat(32)), `${ins.length} entrada(s), saídas ${outs.map((x) => x.value).join('+')}, taxa ${fee} sat | ${btcMsg}`);
    check('taxa do Bitcoin segue a velocidade escolhida (8 sat/vB) e a conta fecha', fee === Math.ceil(BTC.estimateVsize(ins.length, ['p2wpkh', 'p2wpkh']) * 8), `taxa ${fee} sat`);
    check('link aponta para a transação no explorador de Bitcoin', (await page.getAttribute('#rmw-snd-msg a', 'href')) === `https://mempool.space/tx/${btc.txid}`);
    await ui(() => window.RdeskWallet.closeModal());

    // ================================================================ 6. Adicionar qualquer moeda em qualquer rede
    await page.click('#btn-add-token');
    await page.waitForSelector('#rmw-tok-addr');
    await page.fill('#rmw-tok-addr', DEST);
    await page.click('#rmw-tok-check');
    await waitFn(page, () => (document.getElementById('rmw-tok-msg')?.textContent || '').length > 0, null, { timeout: 30000 });
    check('endereço sem contrato é recusado com a rede no aviso', /Não existe contrato neste endereço na rede Polygon/.test(await page.innerText('#rmw-tok-msg')), await page.innerText('#rmw-tok-msg'));
    await page.fill('#rmw-tok-addr', GOLD);
    await page.click('#rmw-tok-check');
    await page.waitForSelector('#rmw-tok-add');
    const found = (await page.innerText('#rmw-tok-info')).replace(/\s+/g, ' ');
    check('app lê símbolo, nome, casas decimais e meu saldo direto do contrato', /GOLD/.test(found) && /Gold Test Token • 9 casas decimais/.test(found) && /42,5 GOLD/.test(found), found.slice(0, 170));
    await page.screenshot({ path: 'tests/artifacts-mc-adicionar.png' });
    await page.click('#rmw-tok-add');
    await page.waitForSelector('#rmw-asset-send');
    await ui(() => window.RdeskWallet.closeModal());
    await ui(() => window.RdeskWallet.refreshBalances());
    await page.waitForTimeout(600);
    const goldRow = (await page.innerText('#wallet-assets-list [data-asset-symbol="GOLD"]')).replace(/\s+/g, ' ');
    const goldBrl = (42.5 * 2 * USD_BRL).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    check('moeda adicionada aparece na lista com nome lido do contrato, saldo e valor em R$', /42,5 GOLD/.test(goldRow) && /Gold Test Token/.test(goldRow) && goldRow.includes(goldBrl), goldRow);
    check('moeda adicionada fica disponível na tela de troca', (await page.$$eval('#swap-from-token option', (o) => o.map((x) => x.value))).includes('GOLD'));

    await page.click('#wallet-assets-list [data-asset-symbol="GOLD"]');
    await page.click('#rmw-asset-send');
    await page.fill('#rmw-snd-to', DEST);
    await page.fill('#rmw-snd-amt', '2.5');
    dialogs.length = 0;
    await page.click('#rmw-snd-exec');
    await waitFn(page, () => /confirmado|rro|insuf/i.test(document.getElementById('rmw-snd-msg')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
    check('enviar a moeda adicionada usa as casas decimais lidas do contrato (2,5 GOLD = 2500000000 unidades)',
        /confirmado/.test(await page.innerText('#rmw-snd-msg')) && polygon.balOf(GOLD, DEST) === 2500000000n, String(polygon.balOf(GOLD, DEST)));
    await ui(() => window.RdeskWallet.closeModal());

    await page.click('#btn-add-token');
    await page.fill('#rmw-tok-addr', '0x2222222222222222222222222222222222222222');
    await page.click('#rmw-tok-check');
    await page.waitForSelector('#rmw-tok-add');
    await page.click('#rmw-tok-add');
    await page.waitForSelector('#rmw-asset-send');
    const fakeName = (await page.innerText('#rdesk-mw-sheet .asset-hero-symbol')).trim();
    check('moeda com símbolo igual a uma oficial ganha sufixo e nunca se confunde com o USDT real', /^USDT-2222/.test(fakeName), fakeName);
    await page.click('#rmw-asset-remove');
    await page.waitForTimeout(500);
    check('remover a moeda tira da lista', !(await ui(() => window.RdeskRegistry.getTokens(137).some((t) => t.symbol.startsWith('USDT-')))));

    // ================================================================ 7. Cotações: fonte de reserva e aviso honesto
    await context.close();
    const fxCtx = await browser.newContext(MOBILE);
    const fx = await openApp(fxCtx, url, chains, { btc, failFx: true });
    await importWalletViaUi(fx.page);
    await fx.page.evaluate(() => window.RdeskWallet.refreshBalances());
    const fxPrices = await fx.page.evaluate(() => window.RdeskWallet.getPrices());
    check('se a 1ª fonte do dólar cai, a app usa a 2ª e continua "ao vivo"', fxPrices.USD_BRL === USD_BRL && fxPrices.usdBrlLive && /ao vivo/.test(await fx.page.innerText('#hero-quote-status')));
    polygon.tick += 300;
    await waitFn(fx.page, (p) => Math.abs(window.RdeskWallet.getPrices().POL - p) < 1e-9, polygon.priceUsd, { timeout: 20000 }).catch(() => {});
    check('preço muda sozinho em até 10 s, sem recarregar', Math.abs((await fx.page.evaluate(() => window.RdeskWallet.getPrices().POL)) - polygon.priceUsd) < 1e-9, `POL=$${polygon.priceUsd.toFixed(5)}`);
    polygon.tick -= 300;
    await fxCtx.close();
    const deadCtx = await browser.newContext(MOBILE);
    const dead = await openApp(deadCtx, url, chains, { btc, failFx: 'all' });
    await importWalletViaUi(dead.page);
    await dead.page.evaluate(() => window.RdeskWallet.refreshBalances());
    check('sem nenhuma fonte de dólar, a tela avisa que o valor em R$ é aproximado', /aproximados/.test(await dead.page.innerText('#hero-quote-status')), await dead.page.innerText('#hero-quote-status'));
    await deadCtx.close();

    check('nenhum script de terceiros e nenhuma violação de CSP', external.filter((u) => /\.js(\?|$)/.test(u)).length === 0 && cspViolations.length === 0, cspViolations.slice(0, 2).join(' | '));
    check('sem erros de JavaScript', pageErrors.length === 0, [...new Set(pageErrors)].slice(0, 4).join(' | '));

    // ================================================================ 8. Leitor de QR Code (foto e câmera)
    const qrCtx = await browser.newContext({ ...MOBILE, permissions: ['camera'] });
    const qr = await openApp(qrCtx, url, chains, { btc });
    await importWalletViaUi(qr.page);
    const parsed = await qr.page.evaluate(() => {
        const p = window.RdeskQrScanner.parsePayload;
        return [p('ethereum:0x000000000000000000000000000000000000dEaD@8453'), p('bitcoin:bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g?amount=0.002'),
            p('lightning:lnbc1pvjluez'), p('0x000000000000000000000000000000000000dEaD'), p('bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g'), p('olá')];
    });
    check('leitor entende QR de pagamento (rede EVM, bitcoin: com valor, Lightning, endereço puro)',
        parsed[0].kind === 'evm' && parsed[0].chainId === 8453 && parsed[1].kind === 'bitcoin' && parsed[1].amount === '0.002' && parsed[2].kind === 'lightning' &&
        parsed[3].kind === 'evm' && parsed[4].kind === 'bitcoin' && parsed[5].kind === 'text', parsed.map((x) => x.kind).join(','));

    // Gera um QR de verdade (com a biblioteca do próprio app) e salva como foto
    const makeQrPng = (text) => qr.page.evaluate(async (t) => {
        const holder = document.createElement('div');
        new QRCode(holder, { text: t, width: 360, height: 360, correctLevel: QRCode.CorrectLevel.M });
        const src = holder.querySelector('canvas');
        const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 480;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 480, 480); ctx.drawImage(src, 60, 60);
        return canvas.toDataURL('image/png').split(',')[1];
    }, text);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rdesk-qr-'));
    const pngEvm = path.join(tmp, 'evm.png');
    fs.writeFileSync(pngEvm, Buffer.from(await makeQrPng(`ethereum:${DEST}@8453`), 'base64'));
    const pngBtc = path.join(tmp, 'btc.png');
    fs.writeFileSync(pngBtc, Buffer.from(await makeQrPng(`bitcoin:${BTC_DEST}?amount=0.0005`), 'base64'));

    await qr.page.click('#btn-action-send');
    await qr.page.waitForSelector('#rmw-snd-scan');
    await qr.page.click('#rmw-snd-scan');
    await qr.page.waitForSelector('.qr-scan-overlay input[type=file]', { state: 'attached' });
    check('leitor de QR abre com botão de voltar e opção de ler de uma foto',
        (await qr.page.locator('.qr-scan-overlay [data-qr-cancel]').count()) === 1 && /Ler de uma foto/.test(await qr.page.innerText('.qr-scan-overlay')));
    await qr.page.setInputFiles('.qr-scan-overlay input[type=file]', pngEvm);
    await waitFn(qr.page, () => !document.querySelector('.qr-scan-overlay') && document.getElementById('rmw-snd-to')?.value.length > 0, null, { timeout: 20000 });
    check('QR com endereço e rede preenche o destino e já troca para a rede do QR (Base)',
        (await qr.page.inputValue('#rmw-snd-to')) === DEST && (await qr.page.inputValue('#rmw-snd-chain')) === '8453');
    await qr.page.click('#rmw-snd-scan');
    await qr.page.setInputFiles('.qr-scan-overlay input[type=file]', pngBtc);
    await waitFn(qr.page, () => !document.querySelector('.qr-scan-overlay') && document.getElementById('rmw-snd-chain')?.value === 'btc', null, { timeout: 20000 });
    check('QR de Bitcoin muda para a rede Bitcoin e preenche endereço e valor',
        (await qr.page.inputValue('#rmw-snd-to')) === BTC_DEST && (await qr.page.inputValue('#rmw-snd-amt')) === '0.0005');
    await qr.page.click('#rmw-snd-scan');
    await qr.page.click('.qr-scan-overlay [data-qr-cancel]');
    check('voltar no leitor fecha a câmera sem mexer no formulário', (await qr.page.locator('.qr-scan-overlay').count()) === 0 && (await qr.page.inputValue('#rmw-snd-to')) === BTC_DEST);
    await qr.page.evaluate(() => window.RdeskWallet.closeModal());

    // leitor nos outros campos: endereço de observação e contrato de moeda
    await qr.page.evaluate(() => window.RdeskWallet.openModal('add'));
    if (await qr.page.locator('.more-opts:not([open]) > summary').count()) await qr.page.click('.more-opts > summary');
    await qr.page.locator('#rdesk-mw-sheet .rmw-opt-btn', { hasText: 'observação' }).click();
    await qr.page.click('[data-scan-for="rmw-f-watch-input"]');
    await qr.page.setInputFiles('.qr-scan-overlay input[type=file]', pngEvm);
    await waitFn(qr.page, () => document.getElementById('rmw-f-watch-input')?.value.length > 0, null, { timeout: 20000 });
    check('leitor de QR também preenche o endereço de observação', (await qr.page.inputValue('#rmw-f-watch-input')) === DEST);
    check('telas de importar têm botão de ler QR (chave privada e frase)', await qr.page.evaluate(() => {
        window.RdeskWallet.openModal('add'); return true;
    }) && (await (async () => {
        if (await qr.page.locator('.more-opts:not([open]) > summary').count()) await qr.page.click('.more-opts > summary');
        await qr.page.locator('#rdesk-mw-sheet .rmw-opt-btn', { hasText: 'Importar chave privada' }).click();
        const pk = await qr.page.locator('[data-scan-for="rmw-f-pk-input"]').count();
        await qr.page.evaluate(() => window.RdeskWallet.openModal('add'));
        await qr.page.locator('#rdesk-mw-sheet .rmw-opt-btn', { hasText: 'Importar frase-semente' }).click();
        return pk === 1 && (await qr.page.locator('[data-scan-for="rmw-f-seed-input"]').count()) === 1;
    })()));
    await qr.page.evaluate(() => window.RdeskWallet.closeModal());
    await qr.page.click('#btn-add-token');
    await qr.page.click('#rmw-tok-scan');
    await qr.page.setInputFiles('.qr-scan-overlay input[type=file]', pngEvm);
    await waitFn(qr.page, () => document.getElementById('rmw-tok-addr')?.value.length > 0, null, { timeout: 20000 });
    check('leitor de QR também preenche o contrato em "Adicionar moeda"', (await qr.page.inputValue('#rmw-tok-addr')) === DEST);
    check('leitor: sem erros de JavaScript nem violação de CSP', qr.pageErrors.length === 0 && qr.cspViolations.length === 0, [...qr.pageErrors, ...qr.cspViolations].slice(0, 3).join(' | '));
    await qrCtx.close();
    fs.writeFileSync(path.join(ROOT, 'tests/artifacts-qr-evm.png'), fs.readFileSync(pngEvm));
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
    console.log('   polygon:', polygon.txs.map(describe).join(' -> '), '| falhas:', JSON.stringify((polygon.failures || []).slice(0, 4)), JSON.stringify(polygon.unknownCalls.slice(0, 4)));
    console.log('   base:', base.txs.map(describe).join(' -> '), '| falhas:', JSON.stringify((base.failures || []).slice(0, 4)), JSON.stringify(base.unknownCalls.slice(0, 4)));
} finally {
    await browser.close();
    server.close();
    finish();
}
