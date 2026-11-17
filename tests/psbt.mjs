// Monta um PSBT (BIP174) mínimo, igual ao que os serviços de troca devolvem: transação sem
// assinatura + witness_utxo de cada entrada. Usado só nos testes.
const hex = (u8) => Buffer.from(u8).toString('hex');
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const varint = (n) => (n < 0xfd ? Buffer.from([n]) : Buffer.concat([Buffer.from([0xfd]), Buffer.from([n & 0xff, n >> 8])]));
const kv = (k, v) => Buffer.concat([varint(k.length), k, varint(v.length), v]);

export function buildPsbt({ inputs, outputs, version = 2, locktime = 0 }) {
    const tx = Buffer.concat([
        u32(version), varint(inputs.length),
        ...inputs.map((i) => Buffer.concat([Buffer.from(i.txid, 'hex').reverse(), u32(i.vout), Buffer.from([0]), u32(i.sequence ?? 0xfffffffd)])),
        varint(outputs.length),
        ...outputs.map((o) => Buffer.concat([u64(o.value), varint(o.script.length), Buffer.from(o.script)])),
        u32(locktime)
    ]);
    const parts = [Buffer.from('70736274ff', 'hex'), kv(Buffer.from([0x00]), tx), Buffer.from([0])];
    inputs.forEach((i) => {
        const wu = Buffer.concat([u64(i.value), varint(i.script.length), Buffer.from(i.script)]);
        parts.push(kv(Buffer.from([0x01]), wu), Buffer.from([0]));
    });
    outputs.forEach(() => parts.push(Buffer.from([0])));
    return hex(Buffer.concat(parts));
}

// Lê uma transação assinada (segwit) e devolve entradas e saídas
export function decodeTx(txHex) {
    const raw = Buffer.from(txHex, 'hex'); let o = 4;
    const seg = raw[o] === 0 && raw[o + 1] === 1; if (seg) o += 2;
    const rv = () => { const f = raw[o++]; if (f < 0xfd) return f; const v = raw.readUInt16LE(o); o += 2; return v; };
    const nIn = rv(); const ins = [];
    for (let i = 0; i < nIn; i++) { const txid = Buffer.from(raw.subarray(o, o + 32)).reverse().toString('hex'); o += 32; const vout = raw.readUInt32LE(o); o += 4; const sl = rv(); o += sl; const sequence = raw.readUInt32LE(o); o += 4; ins.push({ txid, vout, sequence }); }
    const nOut = rv(); const outs = [];
    for (let i = 0; i < nOut; i++) { const value = Number(raw.readBigUInt64LE(o)); o += 8; const sl = rv(); outs.push({ value, script: raw.subarray(o, o + sl).toString('hex') }); o += sl; }
    return { ins, outs };
}
