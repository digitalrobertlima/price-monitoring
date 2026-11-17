// Receber por Pix: QR Code estático no padrão BR Code (sem cadastro nem API).
// Confere o código com o exemplo oficial do Banco Central e lê o QR gerado na tela como um banco leria.
import { createRequire } from 'node:module';
import path from 'node:path';
import { startStaticServer, launch, openApp, importWalletViaUi, check, finish, waitFn, ROOT } from './helpers.mjs';
import { MockChain } from './mock-chain.mjs';

const require = createRequire(import.meta.url);
require(path.join(ROOT, 'pix.js'));
const P = globalThis.RdeskPix;

// ---------------------------------------------------------------- 1. padrão oficial
const EX = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';
check('código de conferência (CRC) igual ao exemplo oficial do Banco Central', P.crc16(EX.slice(0, -4)) === '1D3D');
const built = P.buildPayload({ key: '123e4567-e12b-12d1-a456-426655440000', name: 'Fulano de Tal', city: 'Brasília' });
const parsed = P.parsePayload(built);
check('Pix gerado tem a mesma estrutura do exemplo oficial', built.startsWith('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913FULANO DE TAL6008BRASILIA62070503***6304') && parsed.key === '123e4567-e12b-12d1-a456-426655440000', built);
check('CPF válido aceito e inválido recusado', P.normalizeKey('doc', '529.982.247-25') === '52998224725' && (() => { try { P.normalizeKey('doc', '529.982.247-26'); return false; } catch (e) { return /CPF inválido/.test(e.message); } })());
check('celular vira +55 com DDD; e-mail em minúsculas', P.normalizeKey('phone', '(31) 99999-8888') === '+5531999998888' && P.normalizeKey('email', 'Ana@Email.com') === 'ana@email.com');
const withAmt = P.parsePayload(P.buildPayload({ key: '52998224725', name: 'José Pastel', city: 'Belo Horizonte', amount: 12.5, description: 'pastel de queijo' }));
check('valor, nome sem acento, cidade e descrição entram no código', withAmt.amount === 12.5 && withAmt.name === 'JOSE PASTEL' && withAmt.city === 'BELO HORIZONTE' && withAmt.description === 'PASTEL DE QUEIJO', JSON.stringify(withAmt));
check('código adulterado é recusado na leitura', (() => { try { P.parsePayload(built.replace('FULANO', 'FULAN0')); return false; } catch (e) { return true; } })());

// ---------------------------------------------------------------- 2. na tela
const { server, url } = await startStaticServer(8773);
const browser = await launch();
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const polygon = new MockChain({ polPriceUsd: 0.09 });
    const { page, pageErrors, cspViolations } = await openApp(context, url, { 137: polygon }, {});
    await importWalletViaUi(page);
    await page.click('#btn-action-receive');
    await page.click('#rmw-rec-pix');
    await page.waitForSelector('#rmw-pix-key');
    await page.fill('#rmw-pix-key', '529.982.247-26');
    await page.fill('#rmw-pix-name', 'Ana Souza');
    await page.click('#rmw-pix-go');
    check('na tela, CPF errado mostra aviso claro', /CPF inválido/.test(await page.innerText('#rmw-pix-msg')));
    await page.fill('#rmw-pix-key', '529.982.247-25');
    await page.fill('#rmw-pix-city', 'Belo Horizonte');
    await page.fill('#rmw-pix-amt', '15,50');
    await page.fill('#rmw-pix-desc', 'Pastel e caldo');
    await page.click('#rmw-pix-go');
    await page.waitForSelector('#rmw-pix-qr canvas, #rmw-pix-qr img', { timeout: 10000, state: 'attached' });
    const code = await page.innerText('#rmw-pix-code');
    const p2 = P.parsePayload(code);
    check('tela gera Pix Copia e Cola válido com a chave, o valor e o nome', p2.key === '52998224725' && p2.amount === 15.5 && p2.name === 'ANA SOUZA', JSON.stringify(p2));
    // Lê o QR desenhado na tela, como o app do banco faria
    await page.addScriptTag({ url: url + '/vendor/jsqr-1.4.0.js' });
    const scanned = await page.evaluate(() => {
        const box = document.querySelector('#rmw-pix-qr');
        const src = box.querySelector('canvas');
        const c = document.createElement('canvas'); c.width = 400; c.height = 400;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 400); g.drawImage(src, 50, 50, 300, 300);
        const img = g.getImageData(0, 0, 400, 400);
        const r = window.jsQR(img.data, 400, 400);
        return r ? r.data : null;
    });
    check('QR Code da tela, lido como um banco leria, é igual ao Copia e Cola', scanned === code, String(scanned).slice(0, 60));
    check('resumo mostra valor e nome; aviso de que o app não sabe se foi pago', /R\$\s15,50/.test((await page.innerText('#rmw-pix-summary')).replace(/ /g, ' ')) && /não fica sabendo/.test(await page.innerText('#rmw-pix-out')));
    await page.screenshot({ path: 'tests/artifacts-pix.png', fullPage: false });
    // Lembrar a chave
    await page.click('#rmw-close-btn');
    await page.click('#btn-menu').catch(() => {});
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rdesk_pix_v1') || 'null'));
    check('chave lembrada só quando a pessoa pede (neste aparelho)', saved === null, JSON.stringify(saved));
    check('sem erros de JavaScript nem violação de CSP', pageErrors.length === 0 && cspViolations.length === 0, [...pageErrors, ...cspViolations].slice(0, 3).join(' | '));
    void waitFn;
} catch (err) {
    check('execução do teste sem exceções', false, err.stack || String(err));
} finally {
    await browser.close();
    server.close();
    finish();
}
