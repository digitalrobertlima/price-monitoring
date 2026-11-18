// Servidor do "Comprar com Pix" (Mercado Pago): pedido, assinatura do aviso, consulta e entrega.
// Roda o código do Worker de verdade, com o Mercado Pago e a rede simulados.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { check, finish, ROOT } from './helpers.mjs';

// "ethers" do Worker aponta para a cópia do app (no deploy, o wrangler usa o pacote do npm)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixw-'));
fs.mkdirSync(path.join(dir, 'node_modules/ethers'), { recursive: true });
fs.writeFileSync(path.join(dir, 'node_modules/ethers/package.json'), JSON.stringify({ name: 'ethers', type: 'module', main: 'index.mjs' }));
fs.writeFileSync(path.join(dir, 'node_modules/ethers/index.mjs'), `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const e = require(${JSON.stringify(path.join(ROOT, 'vendor/ethers-5.7.2.umd.min.js'))});
export const ethers = e.ethers || e; export default ethers;`);
fs.copyFileSync(path.join(ROOT, 'server/pix-worker.js'), path.join(dir, 'pix-worker.js'));
const { default: worker, verifyMpSignature } = await import(path.join(dir, 'pix-worker.js'));

const SECRET = 'segredo-do-webhook';
const kv = new Map();
const env = {
    APP_ORIGIN: 'https://digitalrobertlima.github.io', MIN_BRL: '10', MAX_BRL: '500', FEE_BPS: '150', DELIVERY_ENABLED: 'false',
    MP_ACCESS_TOKEN: 'APP_USR-teste', MP_WEBHOOK_SECRET: SECRET,
    ORDERS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } }
};
// Mercado Pago simulado
const mpCalls = [];
let payStatus = 'pending';
globalThis.fetch = async (url, init = {}) => {
    mpCalls.push({ url: String(url), init });
    if (String(url).endsWith('/v1/payments') && init.method === 'POST') {
        const b = JSON.parse(init.body);
        return new Response(JSON.stringify({ id: 1234567, status: 'pending', external_reference: b.external_reference, transaction_amount: b.transaction_amount,
            point_of_interaction: { transaction_data: { qr_code: '00020126580014br.gov.bcb.pix0136teste5204000053039865405' + b.transaction_amount.toFixed(2) + '5802BR6304ABCD', ticket_url: 'https://www.mercadopago.com.br/payments/1234567/ticket' } } }), { status: 201 });
    }
    if (/\/v1\/payments\/1234567$/.test(String(url))) {
        const order = [...kv.values()].map((v) => { try { return JSON.parse(v); } catch (e) { return null; } }).find((o) => o?.paymentId === '1234567');
        return new Response(JSON.stringify({ id: 1234567, status: payStatus, external_reference: order?.orderId, transaction_amount: order?.amountBrl }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
};
const call = (method, p, body, headers = {}) => worker.fetch(new Request(`https://rdesk-pix.exemplo.workers.dev${p}`, {
    method, headers: { origin: 'https://digitalrobertlima.github.io', 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined
}), env);
const ADDR = '0x2833a1C3dDe3B5d2265F057301a89bEf1BB50fe3';

// 1. Assinatura (exemplo no formato da documentação)
const ts = String(Date.now());
const manifest = `id:1234567;request-id:req-abc;ts:${ts};`;
const v1 = crypto.createHmac('sha256', SECRET).update(manifest).digest('hex');
check('assinatura certa do Mercado Pago é aceita', await verifyMpSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: 'req-abc', dataId: '1234567', secret: SECRET }));
check('assinatura adulterada é recusada', !(await verifyMpSignature({ xSignature: `ts=${ts},v1=${v1.replace(/.$/, '0')}`, xRequestId: 'req-abc', dataId: '1234567', secret: SECRET })));
check('aviso antigo (repetido depois de muito tempo) é recusado', !(await verifyMpSignature({ xSignature: `ts=${Date.now() - 3600e3},v1=${v1}`, xRequestId: 'req-abc', dataId: '1234567', secret: SECRET })));

// 2. Pedido
const bad = await call('POST', '/pix/order', { amountBrl: 5, address: ADDR });
check('valor abaixo do mínimo é recusado', bad.status === 400 && /entre R\$ 10/.test((await bad.json()).error));
const other = await worker.fetch(new Request('https://x.workers.dev/pix/order', { method: 'POST', headers: { origin: 'https://site-estranho.com', 'content-type': 'application/json' }, body: JSON.stringify({ amountBrl: 50, address: ADDR }) }), env);
check('outro site não consegue criar pedidos', other.status === 403);
const res = await call('POST', '/pix/order', { amountBrl: 50, address: ADDR });
const order = await res.json();
const created = mpCalls.find((c) => c.url.endsWith('/v1/payments'));
const sent = JSON.parse(created.init.body);
check('cria o Pix no Mercado Pago com chave de idempotência, valor, referência e aviso de volta',
    res.status === 200 && created.init.headers['x-idempotency-key'] === order.orderId && sent.payment_method_id === 'pix' && sent.transaction_amount === 50 &&
    sent.external_reference === order.orderId && /\/pix\/webhook$/.test(sent.notification_url) && created.init.headers.authorization === 'Bearer APP_USR-teste', JSON.stringify(sent));
check('devolve o Pix Copia e Cola e quanto a pessoa recebe (R$ 50 - 1,5% = 49,25 BRZ)', /^000201/.test(order.pixCode) && order.receive === 49.25 && order.amountBrl === 50);
check('o Access Token nunca volta para o app', !JSON.stringify(order).includes('APP_USR'));
const st1 = await (await call('GET', `/pix/order/${order.orderId}`)).json();
check('status começa "aguardando pagamento"', st1.status === 'pending');

// 3. Aviso do Mercado Pago
const hook = async (sigOk = true) => {
    const t = String(Date.now());
    const sig = crypto.createHmac('sha256', SECRET).update(`id:1234567;request-id:req-1;ts:${t};`).digest('hex');
    return worker.fetch(new Request('https://rdesk-pix.exemplo.workers.dev/pix/webhook?data.id=1234567&type=payment', {
        method: 'POST', headers: { 'x-signature': `ts=${t},v1=${sigOk ? sig : 'f'.repeat(64)}`, 'x-request-id': 'req-1', 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'payment', data: { id: '1234567' } })
    }), env);
};
check('aviso com assinatura falsa é recusado (401)', (await hook(false)).status === 401);
payStatus = 'pending';
await hook();
check('aviso de pagamento ainda pendente não muda nada', (await (await call('GET', `/pix/order/${order.orderId}`)).json()).status === 'pending');
payStatus = 'approved';
const before = mpCalls.length;
await hook();
check('confere o pagamento direto na API (não confia no aviso)', mpCalls.slice(before).some((c) => /\/v1\/payments\/1234567$/.test(c.url)));
const st2 = await (await call('GET', `/pix/order/${order.orderId}`)).json();
check('pago e entrega automática desligada: fica "pago, aguardando entrega"', st2.status === 'approved', JSON.stringify(st2));
check('sem a entrega ligada, nenhuma moeda é enviada', !mpCalls.some((c) => /polygon/.test(c.url)));

fs.rmSync(dir, { recursive: true, force: true });
finish();
