/* =========================================================================
   RDESK SENTINEL — BITCOIN NATIVO (SegWit, endereços bc1q…)
   Deriva o endereço da mesma frase-semente (BIP84), lê saldo, monta, assina
   e transmite transações. Usa só o ethers (secp256k1, SHA-256, RIPEMD-160).
   Validado contra os vetores oficiais BIP84, BIP143, BIP173 e BIP350.
   Lightning NÃO é suportado (exige um nó ou serviço de custódia).
   ========================================================================= */
(function (global) {
    'use strict';

    const API_HOSTS = ['https://mempool.space/api', 'https://blockstream.info/api'];
    const DUST_SATS = 294;          // abaixo disso um troco P2WPKH não é aceito pela rede
    const MAX_FEE_RATE = 500;       // sat/vB — trava contra taxa absurda
    const SEQUENCE = 0xfffffffd;    // permite acelerar depois (RBF)

    const E = () => global.ethers;
    const bytes = (hex) => E().utils.arrayify(hex.startsWith('0x') ? hex : '0x' + hex);
    const toHex = (arr) => E().utils.hexlify(arr).slice(2);
    const concat = (...parts) => {
        const total = parts.reduce((n, p) => n + p.length, 0);
        const out = new Uint8Array(total);
        let o = 0;
        parts.forEach((p) => { out.set(p, o); o += p.length; });
        return out;
    };
    const sha256 = (data) => bytes(E().utils.sha256(data));
    const dsha256 = (data) => sha256(sha256(data));
    const hash160 = (data) => bytes(E().utils.ripemd160(sha256(data)));

    // ---------------------------------------------------------------- inteiros little-endian
    function u32le(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; }
    function u64le(value) {
        let v = BigInt(value);
        const b = new Uint8Array(8);
        for (let i = 0; i < 8; i++) { b[i] = Number(v & 0xffn); v >>= 8n; }
        return b;
    }
    function varint(n) {
        if (n < 0xfd) return Uint8Array.of(n);
        if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8);
        return concat(Uint8Array.of(0xfe), u32le(n));
    }
    const reverseHex = (hex) => toHex(bytes(hex).reverse());

    // ---------------------------------------------------------------- bech32 / bech32m (BIP173, BIP350)
    const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    const BECH32M_CONST = 0x2bc830a3;
    function polymod(values) {
        const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
        let chk = 1;
        for (const v of values) {
            const top = chk >>> 25;
            chk = ((chk & 0x1ffffff) << 5) ^ v;
            for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
        }
        return chk >>> 0;
    }
    function hrpExpand(hrp) {
        const out = [];
        for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
        out.push(0);
        for (const c of hrp) out.push(c.charCodeAt(0) & 31);
        return out;
    }
    function convertBits(data, from, to, pad) {
        let acc = 0, bits = 0;
        const out = [];
        const maxv = (1 << to) - 1;
        for (const value of data) {
            if (value < 0 || value >> from) return null;
            acc = (acc << from) | value;
            bits += from;
            while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); }
        }
        if (pad) { if (bits > 0) out.push((acc << (to - bits)) & maxv); }
        else if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
        return out;
    }
    function bech32Encode(hrp, words, constant) {
        const values = hrpExpand(hrp).concat(words, [0, 0, 0, 0, 0, 0]);
        const mod = polymod(values) ^ constant;
        const checksum = [];
        for (let i = 0; i < 6; i++) checksum.push((mod >> (5 * (5 - i))) & 31);
        return hrp + '1' + words.concat(checksum).map((w) => CHARSET[w]).join('');
    }
    function bech32Decode(str) {
        if (str.length < 8 || str.length > 90) return null;
        if (str !== str.toLowerCase() && str !== str.toUpperCase()) return null;
        const s = str.toLowerCase();
        const pos = s.lastIndexOf('1');
        if (pos < 1 || pos + 7 > s.length) return null;
        const hrp = s.slice(0, pos);
        const words = [];
        for (const c of s.slice(pos + 1)) {
            const idx = CHARSET.indexOf(c);
            if (idx === -1) return null;
            words.push(idx);
        }
        const mod = polymod(hrpExpand(hrp).concat(words));
        const encoding = mod === 1 ? 'bech32' : mod === BECH32M_CONST ? 'bech32m' : null;
        if (!encoding) return null;
        return { hrp, words: words.slice(0, -6), encoding };
    }
    function segwitEncode(hrp, version, program) {
        const words = [version].concat(convertBits(Array.from(program), 8, 5, true));
        return bech32Encode(hrp, words, version === 0 ? 1 : BECH32M_CONST);
    }
    function segwitDecode(addr) {
        const dec = bech32Decode(addr);
        if (!dec || !dec.words.length) return null;
        const version = dec.words[0];
        if (version > 16) return null;
        const program = convertBits(dec.words.slice(1), 5, 8, false);
        if (!program || program.length < 2 || program.length > 40) return null;
        if (version === 0 && program.length !== 20 && program.length !== 32) return null;
        if ((version === 0 && dec.encoding !== 'bech32') || (version !== 0 && dec.encoding !== 'bech32m')) return null;
        return { hrp: dec.hrp, version, program: Uint8Array.from(program) };
    }

    // ---------------------------------------------------------------- endereços
    // Converte um endereço de destino (mainnet) no script de saída. Erro claro se não for Bitcoin válido.
    function addressToScript(address) {
        const addr = String(address || '').trim();
        if (/^ln(bc|tb|bcrt)/i.test(addr) || /^lnurl/i.test(addr)) {
            throw new Error('Isto é um pedido Lightning. O app envia apenas Bitcoin on-chain (endereços bc1…, 1… ou 3…).');
        }
        const sw = segwitDecode(addr);
        if (sw) {
            if (sw.hrp !== 'bc') throw new Error('Endereço de rede de teste. Use um endereço Bitcoin da rede principal.');
            if (sw.version === 0) return { script: concat(Uint8Array.of(0x00, sw.program.length), sw.program), type: sw.program.length === 20 ? 'p2wpkh' : 'p2wsh' };
            if (sw.version === 1 && sw.program.length === 32) return { script: concat(Uint8Array.of(0x51, 0x20), sw.program), type: 'p2tr' };
            throw new Error('Tipo de endereço Bitcoin ainda não suportado.');
        }
        if (/^(bc1|tb1)/i.test(addr)) throw new Error('Endereço Bitcoin inválido (erro de digitação detectado pelo código de verificação).');
        let raw;
        try { raw = E().utils.base58.decode(addr); } catch (e) { throw new Error('Endereço Bitcoin inválido.'); }
        if (raw.length !== 25) throw new Error('Endereço Bitcoin inválido.');
        const payload = raw.slice(0, 21), checksum = raw.slice(21);
        const expected = dsha256(payload).slice(0, 4);
        if (toHex(checksum) !== toHex(expected)) throw new Error('Endereço Bitcoin inválido (erro de digitação detectado pelo código de verificação).');
        const h = payload.slice(1);
        if (payload[0] === 0x00) return { script: concat(Uint8Array.of(0x76, 0xa9, 0x14), h, Uint8Array.of(0x88, 0xac)), type: 'p2pkh' };
        if (payload[0] === 0x05) return { script: concat(Uint8Array.of(0xa9, 0x14), h, Uint8Array.of(0x87)), type: 'p2sh' };
        throw new Error('Endereço não é da rede principal do Bitcoin.');
    }
    function isValidAddress(address) {
        try { addressToScript(address); return true; } catch (e) { return false; }
    }

    function publicKeyToAddress(compressedPubKeyHex) {
        return segwitEncode('bc', 0, hash160(bytes(compressedPubKeyHex)));
    }
    // BIP84: m/84'/0'/0'/0/índice
    function deriveFromMnemonic(mnemonic, index = 0) {
        const node = E().utils.HDNode.fromMnemonic(mnemonic).derivePath(`m/84'/0'/0'/0/${index}`);
        return { privateKey: node.privateKey, publicKey: node.publicKey.slice(2), address: publicKeyToAddress(node.publicKey) };
    }
    function deriveFromPrivateKey(privateKey) {
        const publicKey = E().utils.computePublicKey(privateKey, true).slice(2);
        return { privateKey, publicKey, address: publicKeyToAddress(publicKey) };
    }

    // ---------------------------------------------------------------- transação
    const OUTPUT_VBYTES = { p2wpkh: 31, p2wsh: 43, p2tr: 43, p2pkh: 34, p2sh: 32 };
    function estimateVsize(inputCount, outputTypes) {
        return Math.ceil(10.5 + inputCount * 68 + outputTypes.reduce((n, t) => n + OUTPUT_VBYTES[t], 0));
    }
    function serializeOutput(valueSats, script) {
        return concat(u64le(valueSats), varint(script.length), script);
    }
    function outpoint(utxo) {
        return concat(bytes(utxo.txid).reverse(), u32le(utxo.vout));
    }

    // Hash de assinatura BIP143 para uma entrada P2WPKH
    function bip143Sighash({ version, inputs, outputsSerialized, inputIndex, pubKeyHash, valueSats, locktime }) {
        const hashPrevouts = dsha256(concat(...inputs.map((i) => outpoint(i))));
        const hashSequence = dsha256(concat(...inputs.map((i) => u32le(i.sequence))));
        const hashOutputs = dsha256(outputsSerialized);
        const scriptCode = concat(Uint8Array.of(0x19, 0x76, 0xa9, 0x14), pubKeyHash, Uint8Array.of(0x88, 0xac));
        const preimage = concat(
            u32le(version), hashPrevouts, hashSequence,
            outpoint(inputs[inputIndex]), scriptCode, u64le(valueSats), u32le(inputs[inputIndex].sequence),
            hashOutputs, u32le(locktime), u32le(1)
        );
        return dsha256(preimage);
    }

    function derSignature(privateKey, digest) {
        const sig = new (E().utils.SigningKey)(privateKey).signDigest(digest); // ethers já devolve S baixo (canônico)
        const enc = (hex) => {
            let b = Array.from(bytes(hex));
            while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b.shift();
            if (b[0] & 0x80) b.unshift(0);
            return [0x02, b.length, ...b];
        };
        const r = enc(sig.r), s = enc(sig.s);
        return Uint8Array.from([0x30, r.length + s.length, ...r, ...s, 0x01]); // 0x01 = SIGHASH_ALL
    }

    // Escolhe entradas, calcula taxa e troco. Não assina. Tudo em satoshis (inteiros).
    function planTransaction({ utxos, toAddress, amountSats, feeRate, changeAddress, sendMax = false }) {
        const dest = addressToScript(toAddress);
        const change = addressToScript(changeAddress);
        const rate = Number(feeRate);
        if (!(rate >= 1) || rate > MAX_FEE_RATE) throw new Error(`Taxa fora do limite seguro (1 a ${MAX_FEE_RATE} sat/vB).`);
        const spendable = utxos.filter((u) => u.confirmed !== false).map((u) => ({ txid: u.txid, vout: u.vout, value: Number(u.value) }))
            .sort((a, b) => b.value - a.value);
        if (!spendable.length) throw new Error('Sem saldo confirmado em Bitcoin para enviar (aguarde a confirmação dos recebimentos).');
        const total = spendable.reduce((n, u) => n + u.value, 0);

        if (sendMax) {
            const fee = Math.ceil(estimateVsize(spendable.length, [dest.type]) * rate);
            const amount = total - fee;
            if (amount < DUST_SATS) throw new Error('Saldo insuficiente para cobrir a taxa da rede.');
            return { inputs: spendable, outputs: [{ script: dest.script, value: amount, address: toAddress }], amount, fee, change: 0, total, vsize: estimateVsize(spendable.length, [dest.type]) };
        }

        const amount = Math.round(Number(amountSats));
        if (!(amount >= DUST_SATS)) throw new Error(`Valor muito baixo: o mínimo aceito pela rede é ${DUST_SATS} satoshis.`);
        const picked = [];
        let sum = 0;
        for (const u of spendable) {
            picked.push(u);
            sum += u.value;
            const feeWithChange = Math.ceil(estimateVsize(picked.length, [dest.type, change.type]) * rate);
            if (sum >= amount + feeWithChange) break;
        }
        const feeNoChange = Math.ceil(estimateVsize(picked.length, [dest.type]) * rate);
        const feeWithChange = Math.ceil(estimateVsize(picked.length, [dest.type, change.type]) * rate);
        if (sum < amount + feeNoChange) {
            throw new Error(`Saldo insuficiente: faltam ${amount + feeNoChange - sum} satoshis para valor + taxa.`);
        }
        const changeValue = sum - amount - feeWithChange;
        const outputs = [{ script: dest.script, value: amount, address: toAddress }];
        let fee, vsize;
        if (changeValue >= DUST_SATS) {
            outputs.push({ script: change.script, value: changeValue, address: changeAddress, isChange: true });
            fee = feeWithChange;
            vsize = estimateVsize(picked.length, [dest.type, change.type]);
        } else {
            fee = sum - amount; // troco menor que o mínimo da rede vira taxa
            vsize = estimateVsize(picked.length, [dest.type]);
        }
        return { inputs: picked, outputs, amount, fee, change: changeValue >= DUST_SATS ? changeValue : 0, total: sum, vsize };
    }

    // Assina um plano (todas as entradas P2WPKH da mesma chave) e devolve { hex, txid }.
    function signTransaction(plan, privateKey) {
        const pubKey = bytes(E().utils.computePublicKey(privateKey, true));
        const pubKeyHash = hash160(pubKey);
        const version = 2, locktime = 0;
        const inputs = plan.inputs.map((u) => ({ ...u, sequence: SEQUENCE }));

        // Conferência final: o que entra = o que sai + taxa. Nunca assina se a conta não fechar.
        const inSum = inputs.reduce((n, u) => n + u.value, 0);
        const outSum = plan.outputs.reduce((n, o) => n + o.value, 0);
        if (inSum !== outSum + plan.fee || plan.fee < 0) throw new Error('Erro interno: entradas, saídas e taxa não fecham. Transação cancelada.');

        const outputsSerialized = concat(...plan.outputs.map((o) => serializeOutput(o.value, o.script)));
        const witnesses = inputs.map((input, index) => {
            const digest = bip143Sighash({ version, inputs, outputsSerialized, inputIndex: index, pubKeyHash, valueSats: input.value, locktime });
            const sig = derSignature(privateKey, digest);
            return concat(Uint8Array.of(0x02, sig.length), sig, Uint8Array.of(pubKey.length), pubKey);
        });
        const inputsSerialized = concat(...inputs.map((i) => concat(outpoint(i), Uint8Array.of(0x00), u32le(i.sequence))));
        const base = concat(u32le(version), varint(inputs.length), inputsSerialized, varint(plan.outputs.length), outputsSerialized, u32le(locktime));
        const full = concat(u32le(version), Uint8Array.of(0x00, 0x01), varint(inputs.length), inputsSerialized,
            varint(plan.outputs.length), outputsSerialized, ...witnesses, u32le(locktime));
        return { hex: toHex(full), txid: toHex(dsha256(base).reverse()) };
    }

    // ---------------------------------------------------------------- rede (API pública estilo Esplora)
    async function api(path, options) {
        let lastError;
        for (const host of API_HOSTS) {
            try {
                const res = await fetch(host + path, { cache: 'no-store', ...options });
                const text = await res.text();
                if (!res.ok) throw new Error(text.slice(0, 160) || `HTTP ${res.status}`);
                return text;
            } catch (e) { lastError = e; }
        }
        throw new Error(`Servidores de Bitcoin indisponíveis (${lastError?.message || 'sem resposta'}).`);
    }
    async function fetchBalance(address) {
        const info = JSON.parse(await api(`/address/${address}`));
        const c = info.chain_stats, m = info.mempool_stats;
        const confirmed = c.funded_txo_sum - c.spent_txo_sum;
        const pending = m.funded_txo_sum - m.spent_txo_sum;
        return { confirmedSats: confirmed, pendingSats: pending, totalSats: confirmed + pending, btc: (confirmed + pending) / 1e8 };
    }
    async function fetchUtxos(address) {
        const list = JSON.parse(await api(`/address/${address}/utxo`));
        return list.map((u) => ({ txid: u.txid, vout: u.vout, value: u.value, confirmed: Boolean(u.status?.confirmed) }));
    }
    // Taxa em sat/vB: { fast, normal, slow }
    async function fetchFeeRates() {
        try {
            const r = JSON.parse(await (await fetch(`${API_HOSTS[0]}/v1/fees/recommended`, { cache: 'no-store' })).text());
            return { fast: r.fastestFee, normal: r.halfHourFee, slow: Math.max(r.economyFee, r.minimumFee, 1) };
        } catch (e) {
            const r = JSON.parse(await api('/fee-estimates'));
            return { fast: Math.ceil(r['1'] || 20), normal: Math.ceil(r['3'] || 10), slow: Math.ceil(r['144'] || 2) };
        }
    }
    async function broadcast(hex) {
        const txid = await api('/tx', { method: 'POST', body: hex });
        if (!/^[0-9a-f]{64}$/.test(txid.trim())) throw new Error(`A rede recusou a transação: ${txid.slice(0, 120)}`);
        return txid.trim();
    }

    global.RdeskBitcoin = {
        DUST_SATS,
        deriveFromMnemonic, deriveFromPrivateKey, publicKeyToAddress,
        isValidAddress, addressToScript,
        planTransaction, signTransaction, estimateVsize,
        fetchBalance, fetchUtxos, fetchFeeRates, broadcast,
        _internals: { bip143Sighash, derSignature, segwitEncode, segwitDecode, bech32Decode, hash160, bytes, toHex }
    };
})(window);
