// Teste de fumaça com rede real: a página abre sem erros, o cofre guarda e
// recupera a seed, e a leitura de saldos bate com a Polygon.
import { startStaticServer, launch, openApp, check, finish, rpc } from './helpers.mjs';

const TARGET_URL = process.env.TARGET_URL || null; // ex.: URL do GitHub Pages
const WATCH_ADDRESS = (process.env.WATCH_ADDRESS || '0x2833a1C3dDe3B5d2265F057301a89bEf1BB50fe3').toLowerCase();
const POLYGON_RPCS = ['https://polygon-bor-rpc.publicnode.com', 'https://1rpc.io/matic', 'https://polygon.drpc.org'];
const PASSWORD = 'senha-de-teste-123';

const local = TARGET_URL ? null : await startStaticServer();
const url = TARGET_URL || local.url;
console.log(`Alvo: ${url}\n`);
const browser = await launch();

try {
    // ---------------------------------------------------------------- 1. Carregamento
    const context = await browser.newContext({ viewport: { width: 1366, height: 850 } });
    let { page, pageErrors } = await openApp(context, url);
    await page.waitForTimeout(8000);
    const libs = await page.evaluate(() => ({
        ethers: typeof ethers, charts: typeof LightweightCharts, chartjs: typeof Chart, qr: typeof QRCode
    }));
    check('bibliotecas carregadas (ethers, gráficos, Chart.js, QR)',
        libs.ethers === 'object' && libs.charts === 'object' && libs.chartjs === 'function' && libs.qr === 'function',
        JSON.stringify(libs));
    check('página abre sem erros de JavaScript', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '));

    const priceText = await page.evaluate(() => document.body.innerText);
    check('interface renderizada', /RDESK SENTINEL/.test(priceText));

    // ---------------------------------------------------------------- 2. Cofre
    const created = await page.evaluate(async (password) => {
        const V = window.RdeskVault;
        const mnemonic = V.generateDraftMnemonic(12);
        const challenge = V.createBackupChallenge(mnemonic);
        const words = mnemonic.split(' ');
        const challengeChecks = challenge.map((c) => ({ ...c, answer: words[c.index] }));
        const address = await V.commitVaultFromMnemonic({ mnemonic, password, challengeChecks });
        const expected = ethers.Wallet.fromMnemonic(mnemonic).address.toLowerCase();
        const stored = localStorage.getItem('rdesk_v22_encrypted_vault') || '';
        return {
            mnemonic, address, expected, mode: V.getState().mode,
            storedHasPlainWord: words.some((w) => w.length >= 5 && stored.includes(w)),
            storedLen: stored.length
        };
    }, PASSWORD);
    check('cofre criado e desbloqueado', created.mode === 'VAULT_UNLOCKED' && created.address === created.expected, created.address);
    check('seed não fica em texto puro no armazenamento', created.storedLen > 0 && !created.storedHasPlainWord);

    const badChallenge = await page.evaluate(async () => {
        const V = window.RdeskVault;
        const mnemonic = V.generateDraftMnemonic(12);
        const challenge = V.createBackupChallenge(mnemonic).map((c) => ({ ...c, answer: 'errada' }));
        try { await V.commitVaultFromMnemonic({ mnemonic, password: 'outra-senha-123', challengeChecks: challenge }); return 'aceitou'; }
        catch (e) { return 'rejeitou'; }
    });
    check('confirmação das 3 palavras rejeita resposta errada', badChallenge === 'rejeitou');

    const locked = await page.evaluate(async () => {
        const V = window.RdeskVault;
        V.lockVault();
        let signerError = '';
        try { await V.getSignerForChain(137); } catch (e) { signerError = e.message; }
        return { mode: V.getState().mode, signerError };
    });
    check('bloquear o cofre impede assinar', locked.mode === 'VAULT_LOCKED' && locked.signerError.length > 0, locked.signerError);

    // Recarrega a página: o cofre tem de voltar bloqueado, com o mesmo endereço.
    await page.close();
    ({ page, pageErrors } = await openApp(context, url));
    await page.waitForFunction(() => window.RdeskVault.getState().mode === 'VAULT_LOCKED', null, { timeout: 20000 }).catch(() => {});
    const afterReload = await page.evaluate(() => window.RdeskVault.getState());
    check('após recarregar, cofre volta bloqueado com o mesmo endereço',
        afterReload.mode === 'VAULT_LOCKED' && afterReload.address === created.address, `${afterReload.mode} ${afterReload.address}`);

    const wrong = await page.evaluate(async () => {
        try { await window.RdeskVault.unlockVault('senha-errada-000'); return 'abriu'; } catch (e) { return 'recusou'; }
    });
    check('senha errada não abre o cofre', wrong === 'recusou');

    const reopened = await page.evaluate(async (password) => {
        const V = window.RdeskVault;
        const address = await V.unlockVault(password);
        const mnemonic = await V.revealMnemonicWithPassword(password);
        const signer = await V.getSignerForChain(137);
        return { address, mnemonic, signerAddress: (await signer.getAddress()).toLowerCase() };
    }, PASSWORD);
    check('senha certa abre o cofre e recupera a mesma seed',
        reopened.address === created.address && reopened.mnemonic === created.mnemonic);
    check('assinador do cofre usa o endereço da seed', reopened.signerAddress === created.address);

    // Sobrevive à perda do localStorage (cópia redundante no IndexedDB).
    await page.evaluate(() => localStorage.removeItem('rdesk_v22_encrypted_vault'));
    await page.close();
    ({ page, pageErrors } = await openApp(context, url));
    await page.waitForFunction(() => window.RdeskVault.getState().mode === 'VAULT_LOCKED', null, { timeout: 20000 }).catch(() => {});
    const idbState = await page.evaluate(() => window.RdeskVault.getState());
    check('cofre recuperado do IndexedDB se o localStorage for apagado',
        idbState.mode === 'VAULT_LOCKED' && idbState.address === created.address, `${idbState.mode} ${idbState.address}`);
    await context.close();

    // ---------------------------------------------------------------- 3. Leitura on-chain
    const context2 = await browser.newContext({ viewport: { width: 1366, height: 850 } });
    const second = await openApp(context2, url);
    page = second.page;
    await page.evaluate(async (addr) => {
        window.RdeskVault.setWatchOnlyAddress(addr);
        await window.RdeskVault.refreshAllBalancesAndPrices();
    }, WATCH_ADDRESS);
    const snap = await page.evaluate(() => window.RdeskVault.getState());
    const appPol = snap.balancesByChain?.[137]?.POL;

    let chainPol = null;
    for (const r of POLYGON_RPCS) {
        try { chainPol = Number(BigInt(await rpc(r, 'eth_getBalance', [WATCH_ADDRESS, 'latest']))) / 1e18; break; } catch (e) {}
    }
    check('modo observação ativo para o endereço', snap.mode === 'WATCH_ONLY' && snap.address === WATCH_ADDRESS);
    check('saldo de POL lido pela app bate com a Polygon',
        typeof appPol === 'number' && chainPol !== null && Math.abs(appPol - chainPol) < 1e-6, `app=${appPol} rede=${chainPol}`);
    check('cotações carregadas (POL em USD e dólar em R$)',
        snap.pricesUsd?.POL > 0.001 && snap.pricesUsd?.POL < 100 && snap.usdBrlRate > 2 && snap.usdBrlRate < 20,
        `POL=$${snap.pricesUsd?.POL} USD/BRL=${snap.usdBrlRate}`);
    console.log('Saldos na Polygon:', JSON.stringify(snap.balancesByChain?.[137]));
    console.log('Patrimônio total: R$', snap.totalPortfolioBrl?.toFixed(2));

    const poolPrice = await page.evaluate(async () => window.RdeskVault.callWithRpcFailover(137, async (provider) => {
        const pool = new ethers.Contract('0x9b08288c3be4f62bbf8d1c20ac9c5e6f9467d8b7',
            ['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)'], provider);
        const s = await pool.slot0();
        return Math.pow(1.0001, Number(s.tick)) * 1e12;
    }, 8000));
    const ratio = poolPrice / snap.pricesUsd.POL;
    check('preço da pool Uniswap coerente com a cotação de mercado (±5%)', ratio > 0.95 && ratio < 1.05,
        `pool=$${poolPrice.toFixed(5)} mercado=$${snap.pricesUsd.POL}`);

    await page.waitForTimeout(6000);
    check('sem erros de JavaScript durante a leitura', second.pageErrors.length === 0, second.pageErrors.slice(0, 5).join(' | '));
    await page.screenshot({ path: 'tests/artifacts-smoke.png' }).catch(() => {});
    await context2.close();
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    if (local) local.server.close();
    finish();
}
