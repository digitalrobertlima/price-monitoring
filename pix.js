// Pix "Copia e Cola" / QR Code estático (padrão BR Code do Banco Central, que é aberto).
// Não usa nenhuma API nem cadastro: o código só diz "pague para esta chave", e o dinheiro cai
// direto no banco do dono da chave. O app NÃO fica sabendo se o Pix foi pago.
(function (global) {
    'use strict';

    const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

    function validCpf(cpf) {
        const d = onlyDigits(cpf);
        if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
        const dv = (len) => {
            let sum = 0;
            for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
            const r = (sum * 10) % 11;
            return r === 10 ? 0 : r;
        };
        return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
    }
    function validCnpj(cnpj) {
        const d = onlyDigits(cnpj);
        if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
        const dv = (len) => {
            const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
            const r = w.reduce((s, x, i) => s + x * Number(d[i]), 0) % 11;
            return r < 2 ? 0 : 11 - r;
        };
        return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
    }

    // Normaliza a chave como o Pix espera. type: 'doc' (CPF/CNPJ), 'phone', 'email', 'random'
    function normalizeKey(type, raw) {
        const v = String(raw || '').trim();
        if (type === 'doc') {
            const d = onlyDigits(v);
            if (d.length === 11) { if (!validCpf(d)) throw new Error('CPF inválido. Confira os números.'); return d; }
            if (d.length === 14) { if (!validCnpj(d)) throw new Error('CNPJ inválido. Confira os números.'); return d; }
            throw new Error('Digite um CPF (11 números) ou CNPJ (14 números).');
        }
        if (type === 'phone') {
            let d = onlyDigits(v);
            if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
            if (d.length !== 11 && d.length !== 10) throw new Error('Digite o celular com DDD, ex.: (31) 99999-9999.');
            return '+55' + d;
        }
        if (type === 'email') {
            const e = v.toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 77) throw new Error('E-mail inválido.');
            return e;
        }
        if (type === 'random') {
            const e = v.toLowerCase();
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(e)) throw new Error('Chave aleatória inválida. Copie do app do seu banco.');
            return e;
        }
        throw new Error('Escolha o tipo da chave.');
    }

    // Nome e cidade vão sem acento e em maiúsculas (alguns bancos recusam acentos)
    const plain = (s, max) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .\-]/g, '').trim().toUpperCase().slice(0, max);

    function crc16(str) {
        let crc = 0xFFFF;
        const bytes = new TextEncoder().encode(str);
        for (const b of bytes) {
            crc ^= b << 8;
            for (let i = 0; i < 8; i++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
        }
        return crc.toString(16).toUpperCase().padStart(4, '0');
    }
    const field = (id, value) => {
        const len = new TextEncoder().encode(value).length;
        if (len > 99) throw new Error('Informação longa demais para o Pix.');
        return id + String(len).padStart(2, '0') + value;
    };

    // Monta o "Pix Copia e Cola". amount em reais (opcional); sem valor, quem paga digita.
    function buildPayload({ key, name, city, amount, description, txid }) {
        if (!key) throw new Error('Falta a chave Pix.');
        const nm = plain(name, 25) || 'RECEBEDOR';
        const ct = plain(city, 15) || 'BRASIL';
        const desc = description ? plain(description, 40) : '';
        let account = field('00', 'br.gov.bcb.pix') + field('01', key);
        if (desc) account += field('02', desc);
        let p = field('00', '01') + field('26', account) + field('52', '0000') + field('53', '986');
        if (amount !== undefined && amount !== null && amount !== '') {
            const n = Number(amount);
            if (!(n > 0) || n > 1e9) throw new Error('Valor inválido.');
            p += field('54', n.toFixed(2));
        }
        p += field('58', 'BR') + field('59', nm) + field('60', ct);
        const id = String(txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
        p += field('62', field('05', txid ? id : '***'));
        p += '6304';
        return p + crc16(p);
    }

    // Lê um Pix Copia e Cola e devolve os campos (para conferir antes de pagar no banco)
    function parsePayload(code) {
        const s = String(code || '').trim();
        if (s.length < 20 || crc16(s.slice(0, -4)) !== s.slice(-4).toUpperCase()) throw new Error('Código Pix inválido ou incompleto.');
        const read = (str) => {
            const out = {};
            let i = 0;
            while (i + 4 <= str.length) {
                const id = str.slice(i, i + 2); const len = Number(str.slice(i + 2, i + 4));
                out[id] = str.slice(i + 4, i + 4 + len); i += 4 + len;
            }
            return out;
        };
        const top = read(s);
        const acc = read(top['26'] || '');
        return { key: acc['01'] || null, url: acc['25'] || null, description: acc['02'] || '', amount: top['54'] ? Number(top['54']) : null, name: top['59'] || '', city: top['60'] || '' };
    }

    global.RdeskPix = { buildPayload, parsePayload, normalizeKey, validCpf, validCnpj, crc16 };
})(typeof window !== 'undefined' ? window : globalThis);
