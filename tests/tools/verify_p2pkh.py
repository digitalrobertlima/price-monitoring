#!/usr/bin/env python3
"""Verificador independente (Python puro) de transação P2PKH clássica: lê a transação crua,
refaz o hash de assinatura (SIGHASH_ALL) de cada entrada e confere a assinatura ECDSA secp256k1.
Uso: verify_p2pkh.py <tx_hex> <prev_script_hex>   -> imprime OK ou o erro."""
import sys, hashlib
P = 2**256 - 2**32 - 977; N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798, 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)
def add(a, b):
    if a is None: return b
    if b is None: return a
    if a[0] == b[0] and (a[1] + b[1]) % P == 0: return None
    l = ((3 * a[0] * a[0]) * pow(2 * a[1], -1, P)) % P if a == b else ((b[1] - a[1]) * pow(b[0] - a[0], -1, P)) % P
    x = (l * l - a[0] - b[0]) % P
    return (x, (l * (a[0] - x) - a[1]) % P)
def mul(k, pt):
    r = None
    while k:
        if k & 1: r = add(r, pt)
        pt = add(pt, pt); k >>= 1
    return r
def dsha(b): return hashlib.sha256(hashlib.sha256(b).digest()).digest()
def rd(b, i, n): return b[i:i+n], i + n
def varint(b, i):
    v = b[i]
    if v < 0xfd: return v, i + 1
    if v == 0xfd: return int.from_bytes(b[i+1:i+3], 'little'), i + 3
    return int.from_bytes(b[i+1:i+5], 'little'), i + 5
def enc_varint(n): return bytes([n]) if n < 0xfd else b'\xfd' + n.to_bytes(2, 'little')
tx = bytes.fromhex(sys.argv[1]); prev = bytes.fromhex(sys.argv[2])
i = 0; ver, i = rd(tx, i, 4); n_in, i = varint(tx, i); ins = []
for _ in range(n_in):
    op, i = rd(tx, i, 36); l, i = varint(tx, i); sc, i = rd(tx, i, l); seq, i = rd(tx, i, 4); ins.append((op, sc, seq))
n_out, i = varint(tx, i); outs_start = i
for _ in range(n_out):
    _, i = rd(tx, i, 8); l, i = varint(tx, i); _, i = rd(tx, i, l)
outs = tx[outs_start:i]; lock, i = rd(tx, i, 4)
assert i == len(tx), 'bytes sobrando'
for k, (op, sc, seq) in enumerate(ins):
    sl = sc[0]; sig = sc[1:1+sl]; pl = sc[1+sl]; pub = sc[2+sl:2+sl+pl]
    assert sig[-1] == 1, 'sighash não é ALL'
    der = sig[:-1]; assert der[0] == 0x30
    rl = der[3]; r = int.from_bytes(der[4:4+rl], 'big'); s = int.from_bytes(der[6+rl:6+rl+der[5+rl]], 'big')
    assert s <= N // 2, 's alto (não padrão)'
    body = ver + enc_varint(len(ins))
    for j, (op2, _, seq2) in enumerate(ins):
        sc2 = prev if j == k else b''
        body += op2 + enc_varint(len(sc2)) + sc2 + seq2
    body += enc_varint(n_out) + outs + lock + (1).to_bytes(4, 'little')
    z = int.from_bytes(dsha(body), 'big')
    x = int.from_bytes(pub[1:], 'big'); y2 = (pow(x, 3, P) + 7) % P; y = pow(y2, (P + 1) // 4, P)
    if y % 2 != pub[0] - 2: y = P - y
    w = pow(s, -1, N); pt = add(mul(z * w % N, G), mul(r * w % N, (x, y)))
    assert pt and pt[0] % N == r, f'assinatura inválida na entrada {k}'
    h = hashlib.new('ripemd160', hashlib.sha256(pub).digest()).digest()
    assert prev == bytes([0x76, 0xa9, 0x14]) + h + bytes([0x88, 0xac]), 'chave pública não é a dona da moeda'
print('OK', n_in, 'entradas', n_out, 'saídas')
