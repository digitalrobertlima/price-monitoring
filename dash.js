/* =========================================================================
   RDESK — DASH (rede própria, desde 2014)
   - Endereço tirado da MESMA chave do cofre (BIP44, m/44'/5'/0'/0/0), começa com "X".
   - Transação clássica (P2PKH, igual ao Bitcoin antigo), assinada aqui no aparelho.
   - Saldo, moedas e envio por serviços públicos e gratuitos, sem cadastro:
     insight.dash.org (principal) e Blockchair (reserva).
   - Valores em "duffs": 1 DASH = 100.000.000 duffs.
   ========================================================================= */
(function (global) {
    'use strict';

    const E = () => global.ethers;
    const U = () => E().utils;
    const VERSION_P2PKH = 0x4c, VERSION_P2SH = 0x10;
    const DUST = 1000;               // duffs
    const FEE_RATE = 1;              // duff por byte (mínimo da rede: 1.000 duffs/kB)
    const MAX_FEE_DUFFS = 200000;    // 0,002 DASH: acima disso algo está errado
    const INSIGHT = 'https://insight.dash.org/insight-api';
    const BLOCKCHAIR = 'https://api.blockchair.com/dash';

    // ---------------------------------------------------------------- endereços
    const hexToBytes = (h) => U().arrayify(h.startsWith('0x') ? h : '0x' + h);
    const bytesToHex = (b) => U().hexlify(b).slice(2);
    const sha256d = (b) => hexToBytes(U().sha256(U().sha256(b)));
    const hash160 = (b) => hexToBytes(U().ripemd160(U().sha256(b)));
    function b58check(version, payload) {
        const body = U().concat([[version], payload]);
        return U().base58.encode(U().concat([body, sha256d(body).slice(0, 4)]));
    }
    function decodeAddress(addr) {
        let raw;
        try { raw = U().base58.decode(String(addr || '').trim()); } catch (e) { throw new Error('Endereço Dash inválido.'); }
        if (raw.length !== 25) throw new Error('Endereço Dash inválido.');
        const body = raw.slice(0, 21), sum = raw.slice(21);
        const want = sha256d(body).slice(0, 4);
        if (bytesToHex(sum) !== bytesToHex(want)) throw new Error('Endereço Dash com erro de digitação (o código de conferência não bate).');
        if (body[0] !== VERSION_P2PKH && body[0] !== VERSION_P2SH) throw new Error('Este endereço não é da rede Dash (endereços Dash começam com X ou 7).');
        return { version: body[0], hash: body.slice(1) };
    }
    const isAddress = (a) => { try { decodeAddress(a); return true; } catch (e) { return false; } };
    function scriptFor(addr) {
        const { version, hash } = decodeAddress(addr);
        return version === VERSION_P2PKH
            ? U().concat([[0x76, 0xa9, 0x14], hash, [0x88, 0xac]])   // OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
            : U().concat([[0xa9, 0x14], hash, [0x87]]);              // OP_HASH160 <20> OP_EQUAL
    }
    function fromPrivateKey(pk) {
        const sk = new (E().utils.SigningKey)(pk);
        const pub = hexToBytes(U().computePublicKey(sk.publicKey, true));
        return { address: b58check(VERSION_P2PKH, hash160(pub)), privateKey: sk.privateKey, publicKey: bytesToHex(pub) };
    }
    function deriveFromMnemonic(mnemonic, index = 0, passphrase = '') {
        const wl = global.RdeskWordlists ? global.RdeskWordlists.forPhrase(mnemonic) : undefined;
        const node = U().HDNode.fromMnemonic(mnemonic, passphrase || undefined, wl).derivePath(`m/44'/5'/0'/0/${index}`);
        return fromPrivateKey(node.privateKey);
    }

    // ---------------------------------------------------------------- transação clássica (P2PKH)
    function varint(n) {
        if (n < 0xfd) return Uint8Array.of(n);
        if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8);
        return Uint8Array.of(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
    }
    const u32 = (n) => Uint8Array.of(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
    function u64(n) { const out = new Uint8Array(8); let v = BigInt(n); for (let i = 0; i < 8; i++) { out[i] = Number(v & 0xffn); v >>= 8n; } return out; }
    const txidLE = (txid) => hexToBytes(txid).slice().reverse();
    function serialize(tx, scripts) {
        const parts = [u32(tx.version), varint(tx.inputs.length)];
        tx.inputs.forEach((inp, i) => { const sc = scripts[i] || new Uint8Array(0); parts.push(txidLE(inp.txid), u32(inp.vout), varint(sc.length), sc, u32(0xffffffff)); });
        parts.push(varint(tx.outputs.length));
        tx.outputs.forEach((o) => { parts.push(u64(o.value), varint(o.script.length), o.script); });
        parts.push(u32(0));
        return U().concat(parts);
    }
    const estimateSize = (nIn, nOut) => 10 + nIn * 148 + nOut * 34;
    function plan({ utxos, toAddress, amountDuffs, changeAddress, max = false }) {
        decodeAddress(toAddress);
        const spendable = (utxos || []).filter((u) => u.value > 0).sort((a, b) => b.value - a.value);
        if (!spendable.length) throw new Error('Sem DASH disponível neste endereço.');
        if (!max && !(Number.isInteger(amountDuffs) && amountDuffs >= DUST)) throw new Error('Valor muito pequeno para a rede Dash.');
        const chosen = []; let sum = 0;
        if (max) { chosen.push(...spendable); sum = spendable.reduce((s, u) => s + u.value, 0); }
        else for (const u of spendable) { chosen.push(u); sum += u.value; if (sum >= amountDuffs + estimateSize(chosen.length, 2) * FEE_RATE) break; }
        let fee = Math.max(226, estimateSize(chosen.length, max ? 1 : 2) * FEE_RATE);
        const amount = max ? sum - fee : amountDuffs;
        if (amount < DUST) throw new Error('Saldo insuficiente para pagar a taxa da rede Dash.');
        if (sum < amount + fee) throw new Error('Saldo insuficiente (contando a taxa da rede).');
        const outputs = [{ address: toAddress, value: amount, script: scriptFor(toAddress) }];
        let change = sum - amount - fee;
        if (!max && change >= DUST) outputs.push({ address: changeAddress, value: change, script: scriptFor(changeAddress), change: true });
        else { fee += change; change = 0; }
        if (fee > MAX_FEE_DUFFS) throw new Error('Taxa alta demais para a rede Dash. Algo está errado: cancelado.');
        return { inputs: chosen.map((u) => ({ txid: u.txid, vout: u.vout, value: u.value })), outputs, fee, amount, change, version: 2 };
    }
    function der(r, s) {
        const enc = (x) => { let b = hexToBytes(x); let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); if (b[0] & 0x80) b = U().concat([[0], b]); return U().concat([[0x02, b.length], b]); };
        const R = enc(r), S = enc(s);
        return U().concat([[0x30, R.length + S.length], R, S]);
    }
    function sign(p, privateKey) {
        const me = fromPrivateKey(privateKey);
        const myScript = scriptFor(me.address);
        const sk = new (E().utils.SigningKey)(privateKey);
        const pub = hexToBytes(me.publicKey);
        const tx = { version: p.version || 2, inputs: p.inputs, outputs: p.outputs };
        const sigScripts = p.inputs.map((_, i) => {
            const scripts = p.inputs.map((__, j) => (j === i ? myScript : new Uint8Array(0)));
            const pre = U().concat([serialize(tx, scripts), u32(1)]);   // SIGHASH_ALL
            const digest = sha256d(pre);
            const sig = sk.signDigest(digest);                             // ethers já devolve o "s" baixo (padrão)
            const d = U().concat([der(sig.r, sig.s), [0x01]]);
            return U().concat([[d.length], d, [pub.length], pub]);
        });
        const raw = serialize(tx, sigScripts);
        const txid = bytesToHex(sha256d(raw).slice().reverse());
        return { hex: bytesToHex(raw), txid, size: raw.length };
    }

    // ---------------------------------------------------------------- serviços públicos
    const getJson = async (u, opt) => { const r = await fetch(u, opt); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
    async function fetchUtxos(address) {
        try {
            const list = await getJson(`${INSIGHT}/addr/${address}/utxo`);
            if (!Array.isArray(list)) throw new Error('resposta estranha');
            return list.map((u) => ({ txid: u.txid, vout: Number(u.vout), value: Number(u.satoshis), confirmed: Number(u.confirmations) > 0 }));
        } catch (e) {
            const j = await getJson(`${BLOCKCHAIR}/dashboards/address/${address}?limit=100`);
            const d = j?.data?.[address];
            return (d?.utxo || []).map((u) => ({ txid: u.transaction_hash, vout: Number(u.index), value: Number(u.value), confirmed: Number(u.block_id) > 0 }));
        }
    }
    async function fetchBalance(address) {
        const utxos = await fetchUtxos(address);
        const total = utxos.reduce((s, u) => s + u.value, 0);
        const pending = utxos.filter((u) => !u.confirmed).reduce((s, u) => s + u.value, 0);
        return { totalDuffs: total, pendingDuffs: pending, utxos };
    }
    async function broadcast(hex) {
        try {
            const j = await getJson(`${INSIGHT}/tx/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawtx: hex }) });
            if (j?.txid) return j.txid;
            throw new Error('sem txid');
        } catch (e) {
            const body = new URLSearchParams({ data: hex });
            const j = await getJson(`${BLOCKCHAIR}/push/transaction`, { method: 'POST', body });
            const id = j?.data?.transaction_hash;
            if (!id) throw new Error('A rede Dash recusou a transação.');
            return id;
        }
    }

    global.RdeskDash = { deriveFromMnemonic, fromPrivateKey, isAddress, decodeAddress, plan, sign, fetchUtxos, fetchBalance, broadcast, DUST, explorer: (txid) => `https://blockchair.com/dash/transaction/${txid}`, _serialize: serialize };
})(window);
