/* =========================================================================
   COMPRAR CRIPTO COM PIX — servidor (Cloudflare Worker)
   O app (site estático) NUNCA vê o Access Token do Mercado Pago: ele fica aqui,
   como segredo do Worker.

   Fluxo:
   1. App -> POST /pix/order {amountBrl, address}        -> cria o Pix no Mercado Pago
      <- {orderId, pixCode, ticketUrl, expiresAt, receive}  (o app desenha o QR)
   2. Pessoa paga no banco
   3. Mercado Pago -> POST /pix/webhook  (assinatura x-signature conferida)
      -> servidor CONSULTA o pagamento direto na API (nunca confia no corpo do aviso)
      -> se "approved": entrega BRZ na Polygon (se DELIVERY_ENABLED) e marca o pedido
   4. App -> GET /pix/order/:id  (a cada poucos segundos) -> status para a tela

   Documentação usada:
   - Pagamento Pix: POST https://api.mercadopago.com/v1/payments (payment_method_id "pix",
     header X-Idempotency-Key) -> point_of_interaction.transaction_data.{qr_code, qr_code_base64, ticket_url}
   - Notificações: header x-signature "ts=...,v1=..." ; manifesto
     "id:[data.id];request-id:[x-request-id];ts:[ts];" ; HMAC-SHA256 com a assinatura secreta.
   ========================================================================= */
import { ethers } from 'ethers';

const MP_API = 'https://api.mercadopago.com';
const ORDER_TTL = 60 * 60 * 24 * 30; // pedidos ficam 30 dias no KV

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', ...extra }
});

function cors(env, req) {
    const origin = req.headers.get('origin') || '';
    const allowed = origin === env.APP_ORIGIN || /^http:\/\/localhost(:\d+)?$/.test(origin);
    return allowed ? {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'vary': 'origin'
    } : {};
}

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmacHex(secret, text) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}
function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

// Confere a assinatura do aviso do Mercado Pago. Exportada para o teste.
export async function verifyMpSignature({ xSignature, xRequestId, dataId, secret, nowMs = Date.now(), toleranceMs = 10 * 60 * 1000 }) {
    if (!xSignature || !secret) return false;
    const parts = Object.fromEntries(String(xSignature).split(',').map((p) => p.trim().split('=').map((s) => s.trim())));
    const ts = parts.ts, v1 = parts.v1;
    if (!ts || !v1) return false;
    // ts pode vir em segundos ou milissegundos
    const tsMs = Number(ts) < 1e12 ? Number(ts) * 1000 : Number(ts);
    if (!Number.isFinite(tsMs) || Math.abs(nowMs - tsMs) > toleranceMs) return false;
    // Ids alfanuméricos vão em minúsculas no manifesto
    const id = dataId ? (/^[0-9]+$/.test(String(dataId)) ? String(dataId) : String(dataId).toLowerCase()) : '';
    let manifest = '';
    if (id) manifest += `id:${id};`;
    if (xRequestId) manifest += `request-id:${xRequestId};`;
    manifest += `ts:${ts};`;
    return safeEqual(await hmacHex(secret, manifest), v1);
}

async function mp(env, path, init = {}) {
    const res = await fetch(`${MP_API}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'content-type': 'application/json', ...(init.headers || {}) }
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Mercado Pago ${res.status}: ${body.message || 'erro'}`);
    return body;
}

const feeBps = (env) => Math.max(0, Math.min(1000, Number(env.FEE_BPS || 0)));
const brzFor = (env, amountBrl) => Math.floor(amountBrl * (1 - feeBps(env) / 10000) * 100) / 100;

async function createOrder(req, env) {
    const body = await req.json().catch(() => ({}));
    const amountBrl = Math.round(Number(body.amountBrl) * 100) / 100;
    const min = Number(env.MIN_BRL || 10), max = Number(env.MAX_BRL || 500);
    if (!(amountBrl >= min && amountBrl <= max)) return json({ error: `Valor entre R$ ${min} e R$ ${max}.` }, 400);
    if (!ethers.utils.isAddress(body.address || '')) return json({ error: 'Endereço da carteira inválido.' }, 400);
    const orderId = crypto.randomUUID();
    const receive = brzFor(env, amountBrl);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const workerUrl = new URL(req.url).origin;
    const payment = await mp(env, '/v1/payments', {
        method: 'POST',
        headers: { 'x-idempotency-key': orderId },
        body: JSON.stringify({
            transaction_amount: amountBrl,
            description: `Compra de ${receive.toFixed(2)} BRZ`,
            payment_method_id: 'pix',
            external_reference: orderId,
            notification_url: `${workerUrl}/pix/webhook`,
            date_of_expiration: expiresAt.replace('Z', '-00:00'),
            // O Mercado Pago pede um e-mail do pagador; usamos um e-mail técnico do pedido (sem dado pessoal)
            payer: { email: body.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ? body.email : `pedido-${orderId.slice(0, 8)}@pagador.invalid` }
        })
    });
    const tx = payment.point_of_interaction?.transaction_data || {};
    const order = { orderId, paymentId: String(payment.id), address: ethers.utils.getAddress(body.address), amountBrl, receive, status: 'pending', createdAt: Date.now(), expiresAt };
    await env.ORDERS.put(`order:${orderId}`, JSON.stringify(order), { expirationTtl: ORDER_TTL });
    await env.ORDERS.put(`payment:${order.paymentId}`, orderId, { expirationTtl: ORDER_TTL });
    return json({ orderId, pixCode: tx.qr_code, ticketUrl: tx.ticket_url, expiresAt, amountBrl, receive, feeBps: feeBps(env) });
}

async function deliver(env, order) {
    if (String(env.DELIVERY_ENABLED) !== 'true') return { status: 'approved' }; // entrega manual
    const provider = new ethers.providers.StaticJsonRpcProvider(env.DELIVERY_RPC, 137);
    const wallet = new ethers.Wallet(env.HOT_WALLET_KEY, provider);
    const token = new ethers.Contract(env.DELIVERY_TOKEN, ['function transfer(address,uint256) returns (bool)'], wallet);
    const amount = ethers.utils.parseUnits(order.receive.toFixed(2), Number(env.DELIVERY_DECIMALS || 18));
    const tx = await token.transfer(order.address, amount);
    return { status: 'delivered', txHash: tx.hash };
}

async function webhook(req, env) {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const dataId = url.searchParams.get('data.id') || body?.data?.id;
    const ok = await verifyMpSignature({ xSignature: req.headers.get('x-signature'), xRequestId: req.headers.get('x-request-id'), dataId, secret: env.MP_WEBHOOK_SECRET });
    if (!ok) return json({ error: 'assinatura inválida' }, 401);
    if ((body.type || url.searchParams.get('type')) !== 'payment' || !dataId) return json({ ok: true });

    // Nunca confia no corpo do aviso: consulta o pagamento direto na API
    const payment = await mp(env, `/v1/payments/${encodeURIComponent(dataId)}`);
    const orderId = payment.external_reference || await env.ORDERS.get(`payment:${dataId}`);
    const raw = orderId && await env.ORDERS.get(`order:${orderId}`);
    if (!raw) return json({ ok: true });
    const order = JSON.parse(raw);
    if (payment.status !== 'approved') {
        if (['cancelled', 'rejected', 'refunded', 'expired'].includes(payment.status)) {
            order.status = 'expired';
            await env.ORDERS.put(`order:${orderId}`, JSON.stringify(order), { expirationTtl: ORDER_TTL });
        }
        return json({ ok: true });
    }
    if (Math.abs(Number(payment.transaction_amount) - order.amountBrl) > 0.001) return json({ error: 'valor não confere' }, 409);
    if (order.status === 'delivered' || order.status === 'delivering') return json({ ok: true }); // já entregue (aviso repetido)
    order.status = 'delivering';
    await env.ORDERS.put(`order:${orderId}`, JSON.stringify(order), { expirationTtl: ORDER_TTL });
    try {
        Object.assign(order, await deliver(env, order), { paidAt: Date.now() });
    } catch (err) {
        order.status = 'approved'; // pago, entrega falhou: fica para entrega manual
        order.deliveryError = String(err.message || err).slice(0, 200);
    }
    await env.ORDERS.put(`order:${orderId}`, JSON.stringify(order), { expirationTtl: ORDER_TTL });
    return json({ ok: true });
}

async function getOrder(id, env) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'pedido inválido' }, 400);
    const raw = await env.ORDERS.get(`order:${id}`);
    if (!raw) return json({ error: 'pedido não encontrado' }, 404);
    const o = JSON.parse(raw);
    if (o.status === 'pending' && Date.parse(o.expiresAt) < Date.now()) o.status = 'expired';
    return json({ orderId: o.orderId, status: o.status, amountBrl: o.amountBrl, receive: o.receive, txHash: o.txHash || null });
}

export default {
    async fetch(req, env) {
        const url = new URL(req.url);
        const headers = cors(env, req);
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
        try {
            if (req.method === 'GET' && url.pathname === '/pix/config') {
                return json({ enabled: Boolean(env.MP_ACCESS_TOKEN), minBrl: Number(env.MIN_BRL || 10), maxBrl: Number(env.MAX_BRL || 500), feeBps: feeBps(env), asset: 'BRZ', chainId: 137 }, 200, headers);
            }
            if (req.method === 'POST' && url.pathname === '/pix/order') {
                if (!headers['access-control-allow-origin']) return json({ error: 'origem não permitida' }, 403);
                const r = await createOrder(req, env);
                return new Response(r.body, { status: r.status, headers: { ...Object.fromEntries(r.headers), ...headers } });
            }
            if (req.method === 'GET' && url.pathname.startsWith('/pix/order/')) {
                const r = await getOrder(url.pathname.split('/').pop(), env);
                return new Response(r.body, { status: r.status, headers: { ...Object.fromEntries(r.headers), ...headers } });
            }
            if (req.method === 'POST' && url.pathname === '/pix/webhook') return webhook(req, env);
            return json({ error: 'não encontrado' }, 404, headers);
        } catch (err) {
            return json({ error: 'Falha no servidor. Tente de novo.', detail: String(err.message || err).slice(0, 160) }, 502, headers);
        }
    }
};
