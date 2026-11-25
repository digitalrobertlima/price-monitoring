// Modo teste (testnets): redes de teste, endereços de teste (tb1… / y…), cofre separado do real,
// moedas sem valor, e nada do cofre real é lido ou alterado.
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, TEST_MNEMONIC, POL_USD, waitFn, ROOT } from './helpers.mjs';
import { MockChain, ADDR, ethers } from './mock-chain.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// ---------------------------------------------------------------- endereços de teste (vetores oficiais)
const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
function load(teste) {
    const ctx = { ethers, console, Uint8Array, TextEncoder, TextDecoder };
    ctx.window = ctx; ctx.globalThis = ctx; ctx.RDESK_TESTE = teste;
    vm.createContext(ctx);
    for (const f of ['bitcoin.js', 'dash.js']) vm.runInContext(readFileSync(path.join(ROOT, f), 'utf8'), ctx);
    return ctx;
}
const T = load(true), M = load(false);
const tb = T.RdeskBitcoin.deriveFromMnemonic(ABANDON, 0).address;
check('Bitcoin testnet: BIP84 m/84\'/1\'/0\'/0/0 confere com o vetor oficial', tb === 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl', tb);
check('Bitcoin real continua igual (vetor BIP84 da rede principal)', M.RdeskBitcoin.deriveFromMnemonic(ABANDON, 0).address === 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
check('modo teste recusa endereço da rede principal (proteção contra enviar dinheiro real)', !T.RdeskBitcoin.isValidAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu') && T.RdeskBitcoin.isValidAddress(tb));
check('rede real recusa endereço de teste', !M.RdeskBitcoin.isValidAddress(tb));
const yd = T.RdeskDash.deriveFromMnemonic(ABANDON, 0).address;
// BIP44 testnet m/44'/1'/0'/0/0 da frase "abandon … about" = mkpZhYtJu2r87Js3pDiWJDmPte2NRZ8bJV (Bitcoin testnet);
// a Dash testnet usa a mesma chave com o prefixo 0x8c (endereço começa com "y")
const hashOf = (a) => ethers.utils.hexlify(ethers.utils.base58.decode(a).slice(1, 21));
check('Dash testnet: m/44\'/1\'/0\'/0/0 com prefixo "y" e a mesma chave do vetor BIP44', yd.startsWith('y') && hashOf(yd) === hashOf('mkpZhYtJu2r87Js3pDiWJDmPte2NRZ8bJV'), yd);
check('Dash testnet recusa endereço da Dash real', !T.RdeskDash.isAddress(M.RdeskDash.deriveFromMnemonic(ABANDON, 0).address));

// ---------------------------------------------------------------- no app
const OWNER = ethers.Wallet.fromMnemonic(TEST_MNEMONIC).address.toLowerCase();
const chain = new MockChain({ polPriceUsd: POL_USD });
chain.fundNative(OWNER, 50);
chain.fundToken(ADDR.USDC, OWNER, 100);

const { server, url } = await startStaticServer(8795);
const browser = await launch();
try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const a = await openApp(ctx, url, chain, {});
    let page = a.page;
    await importWalletViaUi(page);
    const real = await page.evaluate(() => ({ vault: localStorage.getItem('rdesk_multi_vault_v2'), btc: window.RdeskWallet.getBitcoinAddress() }));
    check('cofre real criado (rede principal)', Boolean(real.vault) && /^bc1/.test(real.btc), real.btc);
    await page.close();

    // Entra no modo teste (como pelo botão do menu: grava a marca e recarrega)
    const b = await openApp(ctx, url, chain, {});
    page = b.page;
    check('menu tem a entrada "Modo teste"', await page.evaluate(() => typeof window.RdeskTeste?.open === 'function'));
    await page.evaluate(() => window.RdeskTeste.set(true)); // o mesmo que o botão "Entrar no modo teste" faz
    await page.waitForLoadState('load');
    await waitFn(page, () => window.RdeskWallet && window.RDESK_TESTE === true, null, { timeout: 60000 });
    await page.waitForTimeout(800);
    check('faixa "MODO TESTE" visível', await page.locator('#rdesk-teste-faixa').isVisible());
    const ids = await page.evaluate(() => window.RdeskRegistry.CHAINS.map((c) => c.id).join(','));
    check('só redes de teste (Amoy, Sepolia, Base/Arb/OP Sepolia, Celo Sepolia, BNB, HyperEVM)', ids === '80002,11155111,84532,421614,11155420,11142220,97,998', ids);
    check('cofre separado: nenhuma carteira aberta no modo teste', await page.evaluate(() => !window.RdeskWallet.isConnected() && window.RdeskWallet.getAccounts().length === 0));
    check('trocar e render escondidos', !(await page.locator('.nav-tab-btn[data-tab="pixswap"]').isVisible()) && !(await page.locator('.nav-tab-btn[data-tab="earn"]').isVisible()));

    await importWalletViaUi(page);
    await page.evaluate(() => window.RdeskWallet.refreshBalances());
    await waitFn(page, () => window.RdeskWallet.getSyncState?.()?.done, null, { timeout: 60000 }).catch(() => {});
    const t = await page.evaluate(() => ({ btc: window.RdeskWallet.getBitcoinAddress(), dash: window.RdeskWallet.getDashAddress(), evm: window.RdeskWallet.getAddress(), bal: window.RdeskWallet.getBalances().filter((x) => x.amount > 0).map((x) => `${x.chainId}:${x.symbol}=${x.amount}:${x.usdValue}`) }));
    check('endereço Bitcoin de teste (tb1…)', /^tb1q/.test(t.btc), t.btc);
    check('endereço Dash de teste (y…)', /^y/.test(t.dash), t.dash);
    check('mesmo endereço EVM da frase (redes EVM de teste usam o mesmo endereço)', t.evm.toLowerCase() === OWNER);
    check('saldo de teste lido da rede de teste', t.bal.some((x) => x.startsWith('80002:POL=50')), t.bal.join(' '));
    check('moedas de teste não valem nada (nada em R$)', t.bal.every((x) => x.endsWith(':0')), t.bal.join(' '));
    const total = await page.innerText('#hero-total-brl');
    check('total em R$ fica zero no modo teste', /R\$\s*0,00/.test(total), total);
    check('linha da moeda diz "teste · sem valor"', (await page.locator('.asset-row', { hasText: 'teste · sem valor' }).count()) > 0);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    check('dados do modo teste guardados à parte (rdeskT_…)', keys.includes('rdeskT_rdesk_multi_vault_v2'), keys.filter((k) => /vault/.test(k)).join(','));

    // Sai do modo teste: o cofre real volta intacto
    await page.click('#rdesk-teste-sair');
    await page.waitForLoadState('load');
    await waitFn(page, () => window.RdeskWallet && window.RDESK_TESTE === false, null, { timeout: 60000 });
    await page.waitForTimeout(800);
    const back = await page.evaluate(() => ({ vault: localStorage.getItem('rdesk_multi_vault_v2'), faixa: Boolean(document.getElementById('rdesk-teste-faixa')), ids: window.RdeskRegistry.CHAINS.map((c) => c.id)[0] }));
    check('ao sair, o cofre real está exatamente como antes', back.vault === real.vault);
    check('ao sair, sem faixa e de volta às redes reais', !back.faixa && back.ids === 137);
    check('sem erros de JavaScript', !a.pageErrors.length && !b.pageErrors.length, [...a.pageErrors, ...b.pageErrors].join(' | ').slice(0, 300));
} finally {
    await browser.close();
    server.close();
}
finish();
