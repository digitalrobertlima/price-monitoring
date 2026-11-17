// Bitcoin nativo conferido contra os vetores oficiais (BIP84, BIP143, BIP173, BIP350). Roda só com Node, sem internet.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ethers = require(path.join(ROOT, 'vendor/ethers-5.7.2.umd.min.js'));
globalThis.window = globalThis;
globalThis.ethers = ethers;
require(path.join(ROOT, 'bitcoin.js'));
const BTC = globalThis.RdeskBitcoin;
const { bip143Sighash, derSignature, segwitDecode, bytes, toHex, hash160 } = BTC._internals;

let pass = 0; const failed = [];
function check(name, cond, detail = '') {
    if (cond) pass++; else failed.push(`${name} ${detail}`);
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
}
const throwsWith = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

// ---------------------------------------------------------------- BIP84: frase -> endereços
const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const a0 = BTC.deriveFromMnemonic(M, 0), a1 = BTC.deriveFromMnemonic(M, 1);
check('BIP84: 1º endereço e chave pública do vetor oficial',
    a0.address === 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu' && a0.publicKey === '0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c', a0.address);
check('BIP84: 2º endereço do vetor oficial', a1.address === 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g', a1.address);
check('chave privada isolada gera o mesmo endereço', BTC.deriveFromPrivateKey(a0.privateKey).address === a0.address);

// ---------------------------------------------------------------- BIP173 / BIP350: endereços
const vec = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/vectors/bech32.json'), 'utf8'));
const scriptOf = (d) => toHex(Uint8Array.of(d.version === 0 ? 0 : 0x50 + d.version, d.program.length)) + toHex(d.program);
const validOk = vec.bip350_valid.every(([addr, script]) => { const d = segwitDecode(addr); return d && scriptOf(d) === script; });
check(`BIP350: ${vec.bip350_valid.length} endereços válidos decodificam para o script oficial`, validOk);
const v0 = vec.bip173_valid.filter(([, s]) => s.startsWith('00'));
check(`BIP173: ${v0.length} endereços SegWit v0 válidos decodificam certo`, v0.length >= 2 && v0.every(([addr, script]) => { const d = segwitDecode(addr); return d && scriptOf(d) === script; }));
const okHrp = (d) => d && (d.hrp === 'bc' || d.hrp === 'tb');
const invalidAll = [...vec.bip350_invalid, ...vec.bip173_invalid];
const wronglyAccepted = invalidAll.filter((addr) => okHrp(segwitDecode(addr)));
check(`BIP173/350: ${invalidAll.length} endereços inválidos são todos recusados`, wronglyAccepted.length === 0, wronglyAccepted.join(', '));
check('app recusa endereço de rede de teste', throwsWith(() => BTC.addressToScript('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'), /rede de teste/));
check('app recusa endereço com um caractere trocado', !BTC.isValidAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv') && !BTC.isValidAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3'));
check('app aceita os 4 formatos da rede principal (bc1q, bc1p, 1…, 3…)',
    ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy']
        .map((a) => BTC.addressToScript(a).type).join(',') === 'p2wpkh,p2tr,p2pkh,p2sh');
check('pedido Lightning é reconhecido e recusado com explicação', throwsWith(() => BTC.addressToScript('lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq'), /Lightning/));

// ---------------------------------------------------------------- BIP143: hash de assinatura e assinatura
const inputs143 = [
    { txid: toHex(bytes('fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f').reverse()), vout: 0, sequence: 0xffffffee },
    { txid: toHex(bytes('ef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a').reverse()), vout: 1, sequence: 0xffffffff }
];
const outputs143 = bytes('202cb206000000001976a9148280b37df378db99f66f85c95a783a76ac7a6d5988ac9093510d000000001976a9143bde42dbee7e4dbe6a21b2d50ce2f0167faa815988ac');
const priv143 = '0x619c335025c7f4012e556c2a58b2506e30b8511b53ade95ea316fd8c3286feb9';
const digest = bip143Sighash({ version: 1, inputs: inputs143, outputsSerialized: outputs143, inputIndex: 1,
    pubKeyHash: bytes('1d0f172a0ecb48aee1be1f2687d2963ae33f71a1'), valueSats: 600000000, locktime: 0x11 });
check('BIP143: hash de assinatura igual ao vetor oficial', toHex(digest) === 'c37af31116d1b27caf68aae9e3ac82f1477929014d5b917657d0eb49478cb670', toHex(digest));
const sig = toHex(derSignature(priv143, digest));
check('BIP143: assinatura idêntica à do vetor oficial',
    sig === '304402203609e17b84f6a7d30c80bfa610b5b4542f32a8a0d5447a12fb1366d7f01cc44a0220573a954c4518331561406f90300e8f3358f51928d43c212a8caed02de67eebee01', sig);

// ---------------------------------------------------------------- montar e assinar uma transação
const me = BTC.deriveFromMnemonic(M, 0);
const utxos = [
    { txid: 'a'.repeat(64), vout: 0, value: 60000, confirmed: true },
    { txid: 'b'.repeat(64), vout: 2, value: 25000, confirmed: true },
    { txid: 'c'.repeat(64), vout: 1, value: 900000, confirmed: false } // ainda não confirmado: não pode ser gasto
];
const dest = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';
const plan = BTC.planTransaction({ utxos, toAddress: dest, amountSats: 30000, feeRate: 10, changeAddress: me.address });
check('plano usa só saldo confirmado e a conta fecha (entradas = envio + troco + taxa)',
    plan.inputs.every((u) => u.value !== 900000) && plan.total === plan.amount + plan.change + plan.fee, JSON.stringify({ total: plan.total, envio: plan.amount, troco: plan.change, taxa: plan.fee }));
check('taxa segue a tarifa pedida (10 sat/vB)', plan.fee === Math.ceil(plan.vsize * 10) && plan.vsize === 141, `vsize=${plan.vsize} taxa=${plan.fee}`);
check('troco volta para o próprio endereço', plan.outputs.length === 2 && plan.outputs[1].address === me.address && plan.outputs[1].value === plan.change);

const signed = BTC.signTransaction(plan, me.privateKey);
// Lê a transação assinada de volta, byte a byte, e confere tudo.
const raw = bytes(signed.hex); let o = 0;
const take = (n) => { const s = raw.slice(o, o + n); o += n; return s; };
const le = (b) => b.reduceRight((acc, x) => acc * 256 + x, 0);
const version = le(take(4)); const marker = toHex(take(2)); const nIn = take(1)[0];
const ins = []; for (let i = 0; i < nIn; i++) ins.push({ txid: toHex(take(32).reverse()), vout: le(take(4)), scriptLen: take(1)[0], seq: le(take(4)) });
const nOut = take(1)[0]; const outsStart = o;
const outs = []; for (let i = 0; i < nOut; i++) { const value = le(take(8)); const len = take(1)[0]; outs.push({ value, script: toHex(take(len)) }); }
const outsBytes = raw.slice(outsStart, o);
const wits = []; for (let i = 0; i < nIn; i++) { const items = take(1)[0]; const sLen = take(1)[0]; const s = take(sLen); const pLen = take(1)[0]; wits.push({ items, sig: s, pub: toHex(take(pLen)) }); }
const locktime = le(take(4));
check('transação assinada tem formato SegWit correto e nada sobrando',
    version === 2 && marker === '0001' && o === raw.length && locktime === 0 && ins.every((i) => i.scriptLen === 0) && wits.every((w) => w.items === 2 && w.pub === me.publicKey));
check('saídas: valor exato ao destino e troco ao próprio endereço',
    outs[0].value === 30000 && outs[0].script === toHex(BTC.addressToScript(dest).script) && outs[1].value === plan.change && outs[1].script === '0014' + toHex(hash160(bytes(me.publicKey))));
const sigsValid = wits.every((w, i) => {
    const d = bip143Sighash({ version: 2, inputs: plan.inputs.map((u) => ({ ...u, sequence: 0xfffffffd })), outputsSerialized: outsBytes, inputIndex: i,
        pubKeyHash: hash160(bytes(me.publicKey)), valueSats: plan.inputs[i].value, locktime: 0 });
    const der = Array.from(w.sig.slice(0, -1)); // tira o byte SIGHASH_ALL
    const rLen = der[3]; const r = der.slice(4, 4 + rLen); const sLen = der[5 + rLen]; const s = der.slice(6 + rLen, 6 + rLen + sLen);
    const pad = (arr) => '0x' + toHex(Uint8Array.from(arr)).replace(/^00/, '').padStart(64, '0');
    return [0, 1].some((v) => { try { return ethers.utils.computePublicKey(ethers.utils.recoverPublicKey(d, { r: pad(r), s: pad(s), recoveryParam: v }), true).slice(2) === me.publicKey; } catch (e) { return false; } })
        && w.sig[w.sig.length - 1] === 1;
});
check('cada entrada tem assinatura válida da chave dona dos fundos', sigsValid);
check('txid tem 64 caracteres hexadecimais', /^[0-9a-f]{64}$/.test(signed.txid));

const max = BTC.planTransaction({ utxos, toAddress: dest, feeRate: 5, changeAddress: me.address, sendMax: true });
check('"enviar tudo": sem troco, valor = saldo confirmado − taxa', max.outputs.length === 1 && max.amount === 85000 - max.fee && max.change === 0, `envia ${max.amount}, taxa ${max.fee}`);
const tiny = BTC.planTransaction({ utxos: [{ txid: 'd'.repeat(64), vout: 0, value: 31600, confirmed: true }], toAddress: dest, amountSats: 30000, feeRate: 10, changeAddress: me.address });
check('troco menor que o mínimo da rede não cria saída inválida', tiny.outputs.length === 1 && tiny.fee === 1600 && tiny.change === 0, `taxa ${tiny.fee}`);
check('saldo insuficiente é recusado com a quantia que falta', throwsWith(() => BTC.planTransaction({ utxos, toAddress: dest, amountSats: 85000, feeRate: 10, changeAddress: me.address }), /faltam \d+ satoshis/));
check('taxa absurda (acima de 500 sat/vB) é recusada', throwsWith(() => BTC.planTransaction({ utxos, toAddress: dest, amountSats: 30000, feeRate: 5000, changeAddress: me.address }), /limite seguro/));
check('plano adulterado (conta que não fecha) não é assinado', throwsWith(() => BTC.signTransaction({ ...plan, fee: plan.fee + 1 }, me.privateKey), /não fecham/));


// ---------------------------------------------------------------- Troca de Bitcoin: anotação e PSBT
{
    const { buildPsbt, decodeTx } = await import('./psbt.mjs');
    const me = a0.address;
    const myScript = BTC.addressToScript(me).script;
    const utxos = [{ txid: 'aa'.repeat(32), vout: 0, value: 600000 }, { txid: 'bb'.repeat(32), vout: 2, value: 50000 }];
    // anotação (THORChain e afins): [depósito, OP_RETURN, troco]
    const plan = BTC.planTransaction({ utxos, toAddress: 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g', amountSats: 500000, feeRate: 5, changeAddress: me, memo: '=:ETH.ETH:0x2833a1C3dDe3B5d2265F057301a89bEf1BB50fe3' });
    const desc = plan.outputs.map((o) => BTC.describeScript(o.script));
    check('troca com anotação: saídas na ordem depósito, OP_RETURN, troco', desc[0].address === 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g' && desc[1].type === 'op_return' && desc[1].memo.startsWith('=:ETH.ETH:0x2833') && desc[2].address === me && plan.outputs[1].value === 0);
    check('anotação maior que 80 bytes é recusada', throwsWith(() => BTC.planTransaction({ utxos, toAddress: me, amountSats: 1000, feeRate: 2, changeAddress: me, memo: 'x'.repeat(81) }), /80 bytes/));

    // PSBT no formato da LI.FI/LayerSwap: [depósito p2tr, OP_RETURN, troco p2wpkh, taxa do serviço]
    const DEP = 'bc1plxa9q77gz9r33g8pd4c2ygzezchjffuedtzdrkclyceseyw8v80qasmquf';
    const depScript = BTC.addressToScript(DEP).script;
    const feeScript = BTC.addressToScript('bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g').script;
    const mk = (over = {}) => buildPsbt({
        inputs: over.inputs || [{ txid: 'aa'.repeat(32), vout: 0, value: 600000, script: myScript }],
        outputs: over.outputs || [{ value: 500000, script: depScript }, { value: 0, script: BTC.opReturnScript('17f8f75;=|lifi') }, { value: 97450, script: myScript }, { value: 1250, script: feeScript }]
    });
    const ok = BTC.checkSwapPsbt(mk(), { ownAddress: me, depositAddress: DEP, depositValue: '500000' });
    check('PSBT de troca válido: depósito, troco e taxas lidos certo', ok.fee === 1300 && ok.change === 97450 && ok.extras === 1250 && ok.memo === '17f8f75;=|lifi' && ok.outputs.length === 4, JSON.stringify({ fee: ok.fee, change: ok.change, extras: ok.extras }));
    const signed = BTC.signTransaction(ok, a0.privateKey);
    const dec = decodeTx(signed.hex);
    check('assinatura mantém exatamente as saídas e entradas do PSBT', dec.outs.length === 4 && dec.outs[0].value === 500000 && dec.outs[0].script === toHex(depScript) && dec.outs[3].value === 1250 && dec.ins[0].txid === 'aa'.repeat(32) && dec.ins[0].sequence === 0xfffffffd);
    check('PSBT com depósito diferente da cotação é recusado', throwsWith(() => BTC.checkSwapPsbt(mk(), { ownAddress: me, depositAddress: DEP, depositValue: '400000' }), /não confere/));
    check('PSBT que gasta moedas de outra pessoa é recusado', throwsWith(() => BTC.checkSwapPsbt(mk({ inputs: [{ txid: 'cc'.repeat(32), vout: 1, value: 600000, script: feeScript }] }), { ownAddress: me, depositAddress: DEP, depositValue: '500000' }), /não são suas/));
    check('PSBT que desvia o troco para outra pessoa é recusado', throwsWith(() => BTC.checkSwapPsbt(mk({ outputs: [{ value: 500000, script: depScript }, { value: 0, script: BTC.opReturnScript('m') }, { value: 98700, script: feeScript }] }), { ownAddress: me, depositAddress: DEP, depositValue: '500000' }), /taxa do serviço/));
    check('PSBT com taxa da rede absurda é recusado', throwsWith(() => BTC.checkSwapPsbt(mk({ outputs: [{ value: 500000, script: depScript }, { value: 0, script: BTC.opReturnScript('m') }, { value: 40000, script: myScript }] }), { ownAddress: me, depositAddress: DEP, depositValue: '500000' }), /alta demais/));
    check('PSBT sem anotação é recusado', throwsWith(() => BTC.checkSwapPsbt(mk({ outputs: [{ value: 500000, script: depScript }, { value: 98700, script: myScript }] }), { ownAddress: me, depositAddress: DEP, depositValue: '500000' }), /anotação/));
}

console.log(`\n${pass}/${pass + failed.length} verificações passaram.`);
if (failed.length) { console.log('Falharam:\n - ' + failed.join('\n - ')); process.exitCode = 1; }
