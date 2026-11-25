// Confere, pelo Tor (como o app Android), cada servidor que o app usa para ler saldos e cotações.
// Roda no GitHub Actions com o "tor" do sistema em 127.0.0.1:9050. Cada pedido usa um circuito
// próprio (usuário SOCKS diferente) e cada servidor é testado em 3 circuitos diferentes,
// porque alguns bloqueiam só certas saídas do Tor.
//   node tools/saldos-pelo-tor.mjs            -> tabela no terminal + resumo do GitHub
//   SAIDA_JSON=arquivo.json                   -> grava o resultado
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import vm from 'node:vm';

const SOCKS = process.env.SOCKS || '127.0.0.1:9050';
const RODADAS = Number(process.env.RODADAS || 3);
const ADDR = '0x2833a1C3dDe3B5d2265F057301a89bEf1BB50fe3'; // endereço público de teste (só leitura)
const BTC_ADDR = 'bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h'; // endereço público conhecido
const DASH_ADDR = 'XpESxaUmonkq8RaLLp46Brx2K39ggQe226'; // endereço público conhecido

// Redes e moedas exatamente como o app Android vê (RDESK_NATIVE ligado)
const ctx = { window: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, console };
ctx.window = ctx; ctx.RDESK_NATIVE = true; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../registry.js', import.meta.url), 'utf8'), ctx);
const REG = ctx.RdeskRegistry;

// Candidatos extras (gratuitos, sem chave) para comparar
const EXTRAS = {
    137: ['https://polygon.llamarpc.com', 'https://polygon-rpc.com', 'https://polygon.meowrpc.com', 'https://gateway.tenderly.co/public/polygon', 'https://polygon-public.nodies.app', 'https://polygon.api.onfinality.io/public', 'https://rpc-mainnet.matic.quiknode.pro', 'https://polygon.rpc.subquery.network/public', 'https://poly.api.pocket.network'],
    1: ['https://eth.llamarpc.com', 'https://rpc.mevblocker.io', 'https://eth.merkle.io', 'https://gateway.tenderly.co/public/mainnet', 'https://ethereum-public.nodies.app', 'https://cloudflare-eth.com', 'https://eth.api.pocket.network'],
    8453: ['https://base.llamarpc.com', 'https://base.drpc.org', 'https://gateway.tenderly.co/public/base', 'https://base-public.nodies.app', 'https://base.meowrpc.com'],
    42161: ['https://arbitrum.llamarpc.com', 'https://arbitrum.drpc.org', 'https://gateway.tenderly.co/public/arbitrum', 'https://arbitrum-one-public.nodies.app'],
    10: ['https://optimism.llamarpc.com', 'https://optimism.drpc.org', 'https://gateway.tenderly.co/public/optimism', 'https://optimism-public.nodies.app'],
    42220: ['https://rpc.ankr.com/celo', 'https://celo-json-rpc.stakely.io'],
    56: ['https://bsc-dataseed1.binance.org', 'https://bsc-dataseed2.defibit.io', 'https://bsc.meowrpc.com', 'https://binance.llamarpc.com', 'https://bsc-public.nodies.app'],
    999: ['https://rpc.hypurrscan.io', 'https://hyperliquid-json-rpc.stakely.io']
};

let circuito = 0;
function curl(url, { body, timeout = 30 } = {}) {
    const user = `rdesk${Date.now()}x${++circuito}`;
    const args = ['-sS', '-o', '-', '-w', '\n%{http_code} %{time_total}', '--max-time', String(timeout),
        '--socks5-hostname', `${user}:x@${SOCKS}`, '-A', 'Mozilla/5.0 (Android 14; Mobile) AppleWebKit/537.36', url];
    if (body) args.push('-H', 'Content-Type: application/json', '--data', body);
    return new Promise((res) => {
        execFile('curl', args, { maxBuffer: 8 << 20 }, (err, out = '', errOut = '') => {
            const i = out.lastIndexOf('\n');
            const [code, t] = out.slice(i + 1).split(' ');
            res({ code: Number(code) || 0, t: Number(t) || 0, text: out.slice(0, i), err: err ? (errOut || err.message).trim().slice(0, 120) : '' });
        });
    });
}

// O site (PWA) só pode usar servidores que aceitam pedidos de outra origem (CORS)
function cors(url) {
    const args = ['-sS', '-o', '/dev/null', '-D', '-', '--max-time', '30', '--socks5-hostname', `rdesk${Date.now()}c${++circuito}:x@${SOCKS}`, '-X', 'OPTIONS',
        '-H', 'Origin: https://digitalrobertlima.github.io', '-H', 'Access-Control-Request-Method: POST', '-H', 'Access-Control-Request-Headers: content-type', url];
    return new Promise((res) => execFile('curl', args, (err, out = '') => res(/access-control-allow-origin:\s*(\*|https:\/\/digitalrobertlima\.github\.io)/i.test(out))));
}
const pad = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
async function rpcProva(url, chainId, token) {
    // Igual ao app: saldo nativo + saldo de um token (eth_call balanceOf) num pedido em lote
    const body = JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
        { jsonrpc: '2.0', id: 2, method: 'eth_getBalance', params: [ADDR, 'latest'] },
        { jsonrpc: '2.0', id: 3, method: 'eth_call', params: [{ to: token, data: `0x70a08231${pad(ADDR)}` }, 'latest'] }
    ]);
    const r = await curl(url, { body });
    if (r.code !== 200) return { ok: false, t: r.t, motivo: r.err || `HTTP ${r.code} ${r.text.slice(0, 60).replace(/\s+/g, ' ')}` };
    try {
        const j = JSON.parse(r.text);
        const arr = Array.isArray(j) ? j : [j];
        const byId = Object.fromEntries(arr.map((x) => [x.id, x]));
        if (Number(byId[1]?.result) !== Number(chainId)) return { ok: false, t: r.t, motivo: `rede errada/erro: ${JSON.stringify(arr[0]).slice(0, 80)}` };
        if (!byId[2]?.result || !byId[3]?.result) return { ok: false, t: r.t, motivo: `sem saldo: ${JSON.stringify(byId[2]?.error || byId[3]?.error || arr).slice(0, 80)}` };
        return { ok: true, t: r.t };
    } catch (e) { return { ok: false, t: r.t, motivo: `resposta não é JSON: ${r.text.slice(0, 60).replace(/\s+/g, ' ')}` }; }
}
async function rpcSimples(url, chainId) {
    // Reserva quando o servidor não aceita lote: um pedido por vez
    const r = await curl(url, { body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [ADDR, 'latest'] }) });
    try { return r.code === 200 && JSON.parse(r.text).result ? { ok: true, t: r.t } : { ok: false, t: r.t, motivo: r.err || `HTTP ${r.code}` }; } catch (e) { return { ok: false, t: r.t, motivo: 'não é JSON' }; }
}
async function getProva(url, check) {
    const r = await curl(url);
    if (r.code !== 200) return { ok: false, t: r.t, motivo: r.err || `HTTP ${r.code} ${r.text.slice(0, 60).replace(/\s+/g, ' ')}` };
    try { return check(r.text) ? { ok: true, t: r.t } : { ok: false, t: r.t, motivo: `conteúdo inesperado: ${r.text.slice(0, 60)}` }; } catch (e) { return { ok: false, t: r.t, motivo: `não é JSON: ${r.text.slice(0, 60).replace(/\s+/g, ' ')}` }; }
}

const alvos = [];
for (const c of REG.CHAINS) {
    const tokens = REG.getTokens ? REG.getTokens(c.id) : [];
    const tk = (tokens.find((t) => !t.isNative) || {}).address || '0x0000000000000000000000000000000000000000';
    c.rpcs.forEach((u, i) => alvos.push({ grupo: c.name, nome: u, noApp: true, ordem: i + 1, prova: () => rpcProva(u, c.id, tk), simples: () => rpcSimples(u, c.id) }));
    (EXTRAS[c.id] || []).filter((u) => !c.rpcs.includes(u)).forEach((u) => alvos.push({ grupo: c.name, nome: u, noApp: false, prova: () => rpcProva(u, c.id, tk), simples: () => rpcSimples(u, c.id) }));
}
// Testnets (modo teste): RPCs e a moeda de teste conhecida de cada rede (USDC de teste da Circle)
const TESTNETS = [
    [80002, 'Polygon Amoy', ['https://polygon-amoy.drpc.org', 'https://polygon-amoy-bor-rpc.publicnode.com', 'https://rpc-amoy.polygon.technology', 'https://rpc.ankr.com/polygon_amoy', 'https://polygon-amoy.gateway.tenderly.co', 'https://polygon-amoy-public.nodies.app'], '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', 'https://amoy.polygonscan.com'],
    [11155111, 'Sepolia', ['https://ethereum-sepolia-rpc.publicnode.com', 'https://1rpc.io/sepolia', 'https://ethereum-sepolia-public.nodies.app', 'https://0xrpc.io/sep', 'https://rpc.ankr.com/eth_sepolia', 'https://sepolia.gateway.tenderly.co', 'https://eth-sepolia.api.onfinality.io/public', 'https://ethereum-sepolia.rpc.subquery.network/public'], '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', 'https://sepolia.etherscan.io'],
    [84532, 'Base Sepolia', ['https://sepolia.base.org', 'https://base-sepolia.drpc.org', 'https://base-sepolia-rpc.publicnode.com'], '0x036CbD53842c5426634e7929541eC2318f3dCF7e', 'https://sepolia.basescan.org'],
    [421614, 'Arbitrum Sepolia', ['https://sepolia-rollup.arbitrum.io/rpc', 'https://arbitrum-sepolia.drpc.org', 'https://arbitrum-sepolia-rpc.publicnode.com'], '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', 'https://sepolia.arbiscan.io'],
    [11155420, 'OP Sepolia', ['https://sepolia.optimism.io', 'https://optimism-sepolia.drpc.org', 'https://optimism-sepolia-rpc.publicnode.com'], '0x5fd84259d66Cd46123540766Be93DFE6D43130D7', 'https://sepolia-optimism.etherscan.io'],
    [11142220, 'Celo Sepolia', ['https://forno.celo-sepolia.celo-testnet.org', 'https://celo-sepolia.drpc.org'], null, 'https://celo-sepolia.blockscout.com'],
    [97, 'BNB testnet', ['https://data-seed-prebsc-1-s1.bnbchain.org:8545', 'https://bsc-testnet.drpc.org', 'https://bsc-testnet-rpc.publicnode.com', 'https://bsc-testnet.bnbchain.org'], null, 'https://testnet.bscscan.com'],
    [998, 'HyperEVM testnet', ['https://rpc.hyperliquid-testnet.xyz/evm', 'https://hyperliquid-testnet.drpc.org'], null, 'https://testnet.hyperevmscan.io']
];
for (const [id, nome, rpcs, tk, exp] of TESTNETS) {
    rpcs.forEach((u) => alvos.push({ grupo: `T ${nome}`, nome: u, noApp: false, prova: () => rpcProva(u, id, tk || '0x0000000000000000000000000000000000000000'), simples: () => rpcSimples(u, id) }));
    if (tk) alvos.push({ grupo: `T ${nome}`, nome: `${tk.slice(0, 8)}… é USDC?`, noApp: false, prova: async () => {
        let last = { ok: false, t: 0, motivo: 'nenhum RPC respondeu' };
        for (const u of rpcs) {
            const r = await curl(u, { body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: tk, data: '0x95d89b41' }, 'latest'] }) });
            try { const h = JSON.parse(r.text).result || ''; if (!h) continue; const txt = Buffer.from(h.slice(130), 'hex').toString('utf8').replace(/\0/g, ''); return /USDC/.test(txt) ? { ok: true, t: r.t } : { ok: false, t: r.t, motivo: `símbolo: ${txt || h.slice(0, 20)}` }; } catch (e) { /* próximo */ }
        }
        return last;
    } });
    alvos.push({ grupo: `T ${nome}`, nome: `explorador ${exp}`, noApp: false, prova: () => getProva(exp, () => true) });
}
const TBTC = 'tb1qerzrlxcfu24davlur5sqmgzzgsal6wusda40er'; // endereço público de testnet4 (faucet)
for (const h of ['https://mempool.space/testnet4/api', 'https://mempool.emzy.de/testnet4/api', 'https://mempool.bitcoin-austria.at/testnet4/api', 'https://blockstream.info/testnet/api']) {
    alvos.push({ grupo: 'T Bitcoin testnet', nome: h, noApp: false, prova: () => getProva(`${h}/blocks/tip/height`, (t) => /^\d+$/.test(t.trim())) });
}
const TDASH = 'yQgQMxSZiRwgPzPCzfAcskGvAqqGmZDy3V';
for (const h of ['https://insight.testnet.networks.dash.org/insight-api', 'https://testnet-insight.dashevo.org/insight-api', 'https://insight.testnet.networks.dash.org:3002/insight-api']) {
    alvos.push({ grupo: 'T Dash testnet', nome: h, noApp: false, prova: () => getProva(`${h}/status`, (t) => JSON.parse(t)) });
}
alvos.push({ grupo: 'T Dash testnet', nome: 'blockchair dash testnet?', noApp: false, prova: () => getProva('https://api.blockchair.com/dash/testnet/stats', (t) => JSON.parse(t).data) });
alvos.push({ grupo: 'T Dash testnet', nome: 'trezor tdash blockbook', noApp: false, prova: () => getProva(`https://tdash1.trezor.io/api/v2/address/${TDASH}`, (t) => JSON.parse(t)) });
const esplora = (j) => JSON.parse(j).chain_stats !== undefined;
for (const h of ['https://blockstream.info/api', 'https://mempool.space/api', 'https://mempool.emzy.de/api', 'https://mempool.bitcoin-austria.at/api']) {
    alvos.push({ grupo: 'Bitcoin', nome: h, noApp: /blockstream|mempool\.space/.test(h), prova: () => getProva(`${h}/address/${BTC_ADDR}`, esplora) });
}
alvos.push({ grupo: 'Bitcoin (onion)', nome: 'mempool .onion', noApp: false, prova: () => getProva(`http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/api/address/${BTC_ADDR}`, esplora) });
alvos.push({ grupo: 'Bitcoin (onion)', nome: 'blockstream .onion', noApp: false, prova: () => getProva(`http://explorerzydxu5ecjrkwceayqybizmpjjznk5izmitf2modhcusuqlid.onion/api/address/${BTC_ADDR}`, esplora) });
alvos.push({ grupo: 'Dash', nome: 'https://insight.dash.org/insight-api', noApp: true, prova: () => getProva(`https://insight.dash.org/insight-api/addr/${DASH_ADDR}/utxo`, (t) => Array.isArray(JSON.parse(t))) });
alvos.push({ grupo: 'Dash', nome: 'https://api.blockchair.com/dash', noApp: true, prova: () => getProva(`https://api.blockchair.com/dash/dashboards/address/${DASH_ADDR}?limit=1`, (t) => JSON.parse(t).data) });
alvos.push({ grupo: 'Dash', nome: 'https://explorer.dash.org/insight-api', noApp: false, prova: () => getProva(`https://explorer.dash.org/insight-api/addr/${DASH_ADDR}/utxo`, (t) => Array.isArray(JSON.parse(t))) });
alvos.push({ grupo: 'Dash', nome: 'https://dash.blockbook (trezor)', noApp: false, prova: () => getProva(`https://dash1.trezor.io/api/v2/utxo/${DASH_ADDR}`, (t) => Array.isArray(JSON.parse(t))) });
const cot = [
    ['CoinGecko', 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', (t) => JSON.parse(t).bitcoin],
    ['DefiLlama', 'https://coins.llama.fi/prices/current/coingecko:bitcoin', (t) => JSON.parse(t).coins],
    ['Binance', 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', (t) => JSON.parse(t).price],
    ['AwesomeAPI', 'https://economia.awesomeapi.com.br/last/USD-BRL', (t) => JSON.parse(t).USDBRL],
    ['open.er-api', 'https://open.er-api.com/v6/latest/USD', (t) => JSON.parse(t).rates],
    ['Frankfurter', 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL', (t) => JSON.parse(t).rates],
    ['BCB PTAX', "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@i,dataFinalCotacao=@f)?@i='11-01-2026'&@f='11-20-2026'&$format=json&$top=1", (t) => JSON.parse(t).value],
    ['Blockscout Polygon', `https://polygon.blockscout.com/api/v2/addresses/${ADDR}`, (t) => JSON.parse(t).hash]
];
cot.forEach(([n, u, c]) => alvos.push({ grupo: 'Cotações/histórico', nome: n, noApp: true, prova: () => getProva(u, c) }));

// Testa tudo, poucos de cada vez (o Tor não gosta de dezenas de circuitos novos de uma vez)
const res = [];
let i = 0;
async function trabalhador() {
    while (i < alvos.length) {
        const a = alvos[i++];
        const tentativas = [];
        for (let k = 0; k < RODADAS; k++) tentativas.push(await a.prova());
        let lote = true;
        if (!tentativas.some((x) => x.ok) && a.simples) { const s = await a.simples(); if (s.ok) { lote = false; tentativas.push(s); } }
        const oks = tentativas.filter((x) => x.ok);
        const site = a.simples && oks.length ? await cors(a.nome) : null;
        res.push({ ...a, site, ok: oks.length, de: tentativas.length, lote, t: oks.length ? oks.reduce((s, x) => s + x.t, 0) / oks.length : null, motivo: tentativas.find((x) => !x.ok)?.motivo || '' });
        console.log(`${oks.length ? '✅' : '❌'} ${a.grupo.padEnd(18)} ${a.nome.padEnd(48)} ${oks.length}/${tentativas.length} ${oks.length ? `${(res.at(-1).t).toFixed(1)}s` : ''} ${lote ? '' : '(sem lote)'} ${site === false ? '(sem CORS)' : ''} ${res.at(-1).motivo}`);
    }
}
await Promise.all(Array.from({ length: 6 }, trabalhador));

const ordem = alvos.map((a) => a.nome);
res.sort((a, b) => a.grupo.localeCompare(b.grupo) || (b.noApp - a.noApp) || ordem.indexOf(a.nome) - ordem.indexOf(b.nome));
let md = `## Saldos pelo Tor (${RODADAS} circuitos por servidor)\n\n| Grupo | Servidor | No app | Funcionou | Tempo médio | Site (CORS) | Observação |\n|---|---|---|---|---|---|---|\n`;
for (const r of res) md += `| ${r.grupo} | ${r.nome} | ${r.noApp ? `sim (${r.ordem || '·'})` : 'não'} | ${r.ok ? '✅' : '❌'} ${r.ok}/${r.de} | ${r.t ? `${r.t.toFixed(1)} s` : '—'} | ${r.site === null ? '—' : r.site ? '✅' : '❌'} | ${[r.lote ? '' : 'só pedido simples', r.ok < r.de ? r.motivo : ''].filter(Boolean).join(' · ').replace(/\|/g, '/')} |\n`;
console.log(`\n${md}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
if (process.env.SAIDA_JSON) writeFileSync(process.env.SAIDA_JSON, JSON.stringify(res.map(({ prova, simples, ...r }) => r), null, 2));
