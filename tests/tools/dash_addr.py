#!/usr/bin/env python3
"""Endereço Dash (BIP44 m/44'/5'/0'/0/i) calculado de forma independente, em Python puro.
Uso: dash_addr.py "<palavras>" <indice>  -> endereço X..."""
import sys, hashlib, hmac, unicodedata
P = 2**256 - 2**32 - 977; N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798, 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)
def add(a, b):
    if a is None: return b
    if b is None: return a
    if a[0] == b[0] and (a[1] + b[1]) % P == 0: return None
    l = ((3*a[0]*a[0]) * pow(2*a[1], -1, P)) % P if a == b else ((b[1]-a[1]) * pow(b[0]-a[0], -1, P)) % P
    x = (l*l - a[0] - b[0]) % P
    return (x, (l*(a[0]-x) - a[1]) % P)
def mul(k, pt):
    r = None
    while k:
        if k & 1: r = add(r, pt)
        pt = add(pt, pt); k >>= 1
    return r
def ser(pt): return bytes([2 + (pt[1] & 1)]) + pt[0].to_bytes(32, 'big')
seed = hashlib.pbkdf2_hmac('sha512', unicodedata.normalize('NFKD', sys.argv[1]).encode(), b'mnemonic', 2048)
I = hmac.new(b'Bitcoin seed', seed, hashlib.sha512).digest(); k, c = int.from_bytes(I[:32], 'big'), I[32:]
for idx in [44 | 2**31, 5 | 2**31, 0 | 2**31, 0, int(sys.argv[2])]:
    data = (b'\x00' + k.to_bytes(32, 'big') if idx >= 2**31 else ser(mul(k, G))) + idx.to_bytes(4, 'big')
    I = hmac.new(c, data, hashlib.sha512).digest(); k, c = (int.from_bytes(I[:32], 'big') + k) % N, I[32:]
h = hashlib.new('ripemd160', hashlib.sha256(ser(mul(k, G))).digest()).digest()
body = b'\x4c' + h; full = body + hashlib.sha256(hashlib.sha256(body).digest()).digest()[:4]
A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; n = int.from_bytes(full, 'big'); s = ''
while n: n, r = divmod(n, 58); s = A[r] + s
print('1' * (len(full) - len(full.lstrip(b'\x00'))) + s)
