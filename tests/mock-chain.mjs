// Polygon simulada em memória para testar o fluxo completo da app sem internet.
// Implementa só o necessário: saldos, WPOL, USDT0, a pool WPOL/USDT0 0,05%,
// QuoterV2, SwapRouter02 e o NonfungiblePositionManager da Uniswap V3.
// NÃO substitui um teste em fork real: valida a lógica da app e as transações
// que ela assina (contrato, função, parâmetros), não os contratos em si.
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const require = createRequire(import.meta.url);
export const ethers = require(path.join(ROOT, 'vendor/ethers-5.7.2.umd.min.js'));

export const ADDR = {
    WPOL: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
    USDT0: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
    POOL: '0x9b08288c3be4f62bbf8d1c20ac9c5e6f9467d8b7',
    NFPM: '0xc36442b4a4522e871399cd717abdd847ab11fe88',
    ROUTER: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
    QUOTER: '0x61ffe014ba17989e743c5f6cb21bf9697530b21e',
    USDC: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    BRZ: '0x4ed141110f6eeeaba9a1df36d8c26f684d2475dc',
    BRLA: '0xe6a537a407488807f0bbeb0038b79004f19dddfb'
};
const DECIMALS = { [ADDR.USDT0]: 6, [ADDR.USDC]: 6 };
const decimalsOf = (token) => DECIMALS[token.toLowerCase()] ?? 18;

const I = {
    erc20: new ethers.utils.Interface([
        'function balanceOf(address) view returns (uint256)',
        'function allowance(address,address) view returns (uint256)',
        'function approve(address,uint256) returns (bool)',
        'function transfer(address,uint256) returns (bool)',
        'function decimals() view returns (uint8)',
        'function deposit() payable',
        'function withdraw(uint256)'
    ]),
    pool: new ethers.utils.Interface([
        'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
        'function liquidity() view returns (uint128)',
        'function feeGrowthGlobal0X128() view returns (uint256)',
        'function feeGrowthGlobal1X128() view returns (uint256)',
        'function ticks(int24) view returns (uint128, int128, uint256, uint256, int56, uint160, uint32, bool)'
    ]),
    quoter: new ethers.utils.Interface([
        'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
        'function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)'
    ]),
    router: new ethers.utils.Interface([
        'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
        'function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum)) payable returns (uint256 amountOut)'
    ]),
    nfpm: new ethers.utils.Interface([
        'function balanceOf(address) view returns (uint256)',
        'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
        'function positions(uint256) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
        'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
        'function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) payable returns (uint256 amount0, uint256 amount1)',
        'function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) payable returns (uint256 amount0, uint256 amount1)',
        'function multicall(bytes[] data) payable returns (bytes[] results)',
        'function burn(uint256 tokenId) payable'
    ])
};

class Revert extends Error {}
const big = (v) => BigInt(v.toString());
const hex = (n) => '0x' + BigInt(n).toString(16);
const lower = (a) => String(a).toLowerCase();

function deepClone(v) {
    if (typeof v === 'bigint' || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(deepClone);
    const out = {};
    for (const k of Object.keys(v)) out[k] = deepClone(v[k]);
    return out;
}

export class MockChain {
    constructor({ polPriceUsd = 0.09, chainId = 137 } = {}) {
        this.chainId = chainId;
        // Outras pools além da principal WPOL/USDT0 0,05%: { a, b, fee, rate = quantas unidades de b por 1 de a }
        this.extraPools = chainId !== 137 ? [] : [
            { a: ADDR.USDT0, b: ADDR.BRLA, fee: 100, rate: 5.4 },   // pool saudável
            { a: ADDR.USDT0, b: ADDR.USDC, fee: 100, rate: 1 },
            { a: ADDR.USDT0, b: ADDR.BRZ, fee: 500, rate: 4.0 }     // pool rasa: paga 26% abaixo do mercado
        ];
        this.block = 70000000;
        this.gasPrice = 120n * 10n ** 9n; // base fee realista em horário movimentado
        this.tick = Math.floor(Math.log(polPriceUsd * 1e-12) / Math.log(1.0001));
        this.state = { native: {}, erc20: { [ADDR.WPOL]: {}, [ADDR.USDT0]: {} }, allow: {}, positions: {}, owned: {}, nextId: 2700001, nonces: {} };
        this.receipts = {};
        this.txs = [];          // transações assinadas pela app, já decodificadas
        this.unknownCalls = []; // chamadas que a simulação não conhece (para diagnóstico)
    }

    get price() { return Math.pow(1.0001, this.tick); } // token1/token0 em unidades brutas
    get priceUsd() { return this.price * 1e12; }        // dólares por POL
    sqrtAt(tick) { return Math.sqrt(Math.pow(1.0001, tick)); }

    // ------------------------------------------------------------ utilidades de saldo
    fundToken(token, addr, humanAmount) {
        const t = lower(token);
        this.state.erc20[t] ??= {};
        this.state.erc20[t][lower(addr)] = BigInt(Math.round(humanAmount * 10 ** Math.min(decimalsOf(t), 9))) * 10n ** BigInt(Math.max(0, decimalsOf(t) - 9));
    }
    fundNative(addr, pol) { this.state.native[lower(addr)] = ethers.utils.parseEther(String(pol)).toBigInt(); }
    nativeOf(addr, s = this.state) { return s.native[lower(addr)] || 0n; }
    balOf(token, addr, s = this.state) { return s.erc20[lower(token)]?.[lower(addr)] || 0n; }
    allowanceOf(token, owner, spender, s = this.state) { return s.allow[lower(token)]?.[lower(owner)]?.[lower(spender)] || 0n; }
    _credit(s, token, addr, amt) { const t = s.erc20[lower(token)]; t[lower(addr)] = (t[lower(addr)] || 0n) + amt; }
    _debit(s, token, addr, amt, why = 'saldo insuficiente') {
        const t = s.erc20[lower(token)]; const cur = t[lower(addr)] || 0n;
        if (cur < amt) throw new Revert(why);
        t[lower(addr)] = cur - amt;
    }
    _pull(s, token, owner, spender, amt) {
        const cur = this.allowanceOf(token, owner, spender, s);
        if (cur < amt) throw new Revert('STF (aprovação insuficiente)');
        s.allow[lower(token)][lower(owner)][lower(spender)] = cur - amt;
        this._debit(s, token, owner, amt, 'STF (saldo insuficiente)');
    }
    // Registra um token qualquer (para testar "adicionar moeda")
    registerToken(address, { symbol, name, decimals }) {
        (this.contracts ??= {})[lower(address)] = { symbol, name, decimals };
        DECIMALS[lower(address)] = decimals;
    }
    accrueFees(tokenId, owed0, owed1) {
        const p = this.state.positions[String(tokenId)];
        p.owed0 += BigInt(owed0); p.owed1 += BigInt(owed1);
    }
    positionsOf(addr) { return (this.state.owned[lower(addr)] || []).map((id) => ({ id, ...this.state.positions[id] })); }

    amountsForLiquidity(L, tickLower, tickUpper) {
        const sp = this.sqrtAt(this.tick), sa = this.sqrtAt(tickLower), sb = this.sqrtAt(tickUpper);
        const l = Number(L);
        let a0 = 0, a1 = 0;
        if (sp <= sa) a0 = l * (1 / sa - 1 / sb);
        else if (sp >= sb) a1 = l * (sb - sa);
        else { a0 = l * (1 / sp - 1 / sb); a1 = l * (sp - sa); }
        return [BigInt(Math.floor(a0)), BigInt(Math.floor(a1))];
    }

    // ------------------------------------------------------------ execução de chamadas
    exec(s, { from, to, data, value = 0n }) {
        from = lower(from || ethers.constants.AddressZero); to = lower(to);
        const sel = (data || '0x').slice(0, 10);

        if (!data || data === '0x') { // envio simples de POL para uma conta
            s.native[to] = (s.native[to] || 0n) + value;
            return '0x';
        }
        const special = [ADDR.POOL, ADDR.NFPM, ADDR.ROUTER, ADDR.QUOTER].includes(to);
        const meta = this.contracts?.[to];
        if (meta && (sel === '0x95d89b41' || sel === '0x06fdde03' || sel === '0x313ce567')) { // symbol(), name(), decimals() de um token registrado no teste
            if (sel === '0x313ce567') return ethers.utils.defaultAbiCoder.encode(['uint8'], [meta.decimals]);
            return ethers.utils.defaultAbiCoder.encode(['string'], [sel === '0x95d89b41' ? meta.symbol : meta.name]);
        }
        const isErc20Call = !special && Object.keys(I.erc20.functions).some((sig) => I.erc20.getSighash(sig) === sel);
        if (isErc20Call) {
            s.erc20[to] ??= {}; // qualquer outro token (USDC, BRZ, WETH...) existe com saldo zero
            const f = I.erc20.getFunction(sel);
            const a = I.erc20.decodeFunctionData(f, data);
            const enc = (v) => I.erc20.encodeFunctionResult(f, v);
            switch (f.name) {
                case 'balanceOf': return enc([this.balOf(to, a[0], s)]);
                case 'allowance': return enc([this.allowanceOf(to, a[0], a[1], s)]);
                case 'decimals': return enc([decimalsOf(to)]);
                case 'approve': {
                    const cur = this.allowanceOf(to, from, a[0], s);
                    // USDT clássico: não permite trocar aprovação não-zero por outra não-zero
                    if (to === ADDR.USDT0 && cur !== 0n && big(a[1]) !== 0n) throw new Revert('USDT: zere a aprovação antes');
                    s.allow[to] ??= {}; s.allow[to][from] ??= {};
                    s.allow[to][from][lower(a[0])] = big(a[1]);
                    return enc([true]);
                }
                case 'transfer': this._debit(s, to, from, big(a[1])); this._credit(s, to, a[0], big(a[1])); return enc([true]);
                case 'deposit':
                    if (to !== ADDR.WPOL) throw new Revert('sem deposit');
                    this._credit(s, to, from, value); return '0x';
                case 'withdraw':
                    if (to !== ADDR.WPOL) throw new Revert('sem withdraw');
                    this._debit(s, to, from, big(a[0])); s.native[from] = (s.native[from] || 0n) + big(a[0]); return '0x';
            }
        }

        if (to === ADDR.POOL) {
            const f = I.pool.getFunction(sel);
            const enc = (v) => I.pool.encodeFunctionResult(f, v);
            const sqrtX96 = BigInt(Math.floor(this.sqrtAt(this.tick) * 2 ** 64)) * (2n ** 32n);
            switch (f.name) {
                case 'slot0': return enc([sqrtX96, this.tick, 0, 1, 1, 0, true]);
                case 'liquidity': return enc([5n * 10n ** 21n]);
                case 'feeGrowthGlobal0X128': case 'feeGrowthGlobal1X128': return enc([0]);
                case 'ticks': return enc([0, 0, 0, 0, 0, 0, 0, true]);
            }
        }

        const quote = (tokenIn, tokenOut, amountIn, fee) => {
            tokenIn = lower(tokenIn); tokenOut = lower(tokenOut);
            const net = Number(amountIn) * (1 - Number(fee) / 1e6);
            if (Number(fee) === 500 && tokenIn === ADDR.WPOL && tokenOut === ADDR.USDT0) return BigInt(Math.floor(net * this.price));
            if (Number(fee) === 500 && tokenIn === ADDR.USDT0 && tokenOut === ADDR.WPOL) return BigInt(Math.floor(net / this.price));
            const pool = this.extraPools.find((p) => p.fee === Number(fee) && ((p.a === tokenIn && p.b === tokenOut) || (p.b === tokenIn && p.a === tokenOut)));
            if (!pool) throw new Revert('pool inexistente neste fee tier');
            const human = net / 10 ** decimalsOf(tokenIn);
            const outHuman = pool.a === tokenIn ? human * pool.rate : human / pool.rate;
            return BigInt(Math.floor(outHuman * 10 ** decimalsOf(tokenOut)));
        };
        // Caminho da Uniswap: token(20) + fee(3) + token(20) [+ fee(3) + token(20)]
        const decodePath = (pathHex) => {
            const raw = pathHex.slice(2);
            const hops = [];
            let pos = 0;
            let tokenIn = '0x' + raw.slice(0, 40); pos = 40;
            while (pos < raw.length) {
                const fee = parseInt(raw.slice(pos, pos + 6), 16); pos += 6;
                const tokenOut = '0x' + raw.slice(pos, pos + 40); pos += 40;
                hops.push({ tokenIn, fee, tokenOut });
                tokenIn = tokenOut;
            }
            if (!hops.length) throw new Revert('caminho inválido');
            return hops;
        };
        const quotePath = (hops, amountIn) => hops.reduce((amt, h) => quote(h.tokenIn, h.tokenOut, amt, h.fee), amountIn);

        if (to === ADDR.QUOTER) {
            const f = I.quoter.getFunction(sel);
            if (f.name === 'quoteExactInput') {
                const [pathHex, amountIn] = I.quoter.decodeFunctionData(f, data);
                return I.quoter.encodeFunctionResult(f, [quotePath(decodePath(pathHex), big(amountIn)), [], [], 200000]);
            }
            const [p] = I.quoter.decodeFunctionData(f, data);
            return I.quoter.encodeFunctionResult(f, [quote(p.tokenIn, p.tokenOut, big(p.amountIn), p.fee), 0, 0, 120000]);
        }

        if (to === ADDR.ROUTER) {
            const f = I.router.getFunction(sel);
            const [p] = I.router.decodeFunctionData(f, data);
            const hops = f.name === 'exactInput' ? decodePath(p.path) : [{ tokenIn: p.tokenIn, fee: p.fee, tokenOut: p.tokenOut }];
            const amountIn = big(p.amountIn);
            const out = quotePath(hops, amountIn);
            if (out < big(p.amountOutMinimum)) throw new Revert('Too little received');
            const tokenIn = lower(hops[0].tokenIn), tokenOut = lower(hops[hops.length - 1].tokenOut);
            if (value > 0n) {
                if (tokenIn !== ADDR.WPOL || value !== amountIn) throw new Revert('valor nativo incoerente');
            } else {
                s.erc20[tokenIn] ??= {};
                this._pull(s, tokenIn, from, ADDR.ROUTER, amountIn);
            }
            s.erc20[tokenOut] ??= {};
            this._credit(s, tokenOut, p.recipient, out);
            return I.router.encodeFunctionResult(f, [out]);
        }

        if (to === ADDR.NFPM) return this.execNfpm(s, from, data, value);

        this.unknownCalls.push({ to, sel });
        throw new Revert(`chamada desconhecida ${to} ${sel}`);
    }

    execNfpm(s, from, data, value) {
        const sel = data.slice(0, 10);
        const f = I.nfpm.getFunction(sel);
        const a = I.nfpm.decodeFunctionData(f, data);
        const enc = (v) => I.nfpm.encodeFunctionResult(f, v);
        const now = Math.floor(Date.now() / 1000);
        const getPos = (id) => { const p = s.positions[String(id)]; if (!p) throw new Revert('Invalid token ID'); return p; };
        const onlyOwner = (p) => { if (p.owner !== from) throw new Revert('Not approved'); };

        switch (f.name) {
            case 'balanceOf': return enc([(s.owned[lower(a[0])] || []).length]);
            case 'tokenOfOwnerByIndex': {
                const id = (s.owned[lower(a[0])] || [])[Number(a[1])];
                if (id === undefined) throw new Revert('index fora do limite');
                return enc([id]);
            }
            case 'positions': {
                const p = getPos(a[0]);
                return enc([0, ethers.constants.AddressZero, ADDR.WPOL, ADDR.USDT0, 500, p.tickLower, p.tickUpper, p.liquidity, 0, 0, p.owed0, p.owed1]);
            }
            case 'mint': {
                const m = a[0];
                if (lower(m.token0) !== ADDR.WPOL || lower(m.token1) !== ADDR.USDT0) throw new Revert('token0/token1 fora de ordem');
                if (Number(m.fee) !== 500) throw new Revert('fee tier inesperado');
                if (m.tickLower >= m.tickUpper) throw new Revert('TLU');
                if (m.tickLower % 10 !== 0 || m.tickUpper % 10 !== 0) throw new Revert('tick fora do espaçamento 10');
                if (Number(m.deadline) < now) throw new Revert('Transaction too old');
                const sp = this.sqrtAt(this.tick), sa = this.sqrtAt(m.tickLower), sb = this.sqrtAt(m.tickUpper);
                const d0 = Number(big(m.amount0Desired)), d1 = Number(big(m.amount1Desired));
                let L;
                if (sp <= sa) L = d0 / (1 / sa - 1 / sb);
                else if (sp >= sb) L = d1 / (sb - sa);
                else L = Math.min(d0 / (1 / sp - 1 / sb), d1 / (sp - sa));
                const liq = BigInt(Math.floor(L));
                if (liq <= 0n) throw new Revert('liquidez zero');
                const [u0, u1] = this.amountsForLiquidity(liq, m.tickLower, m.tickUpper);
                if (u0 < big(m.amount0Min) || u1 < big(m.amount1Min)) throw new Revert('Price slippage check');
                this._pull(s, ADDR.WPOL, from, ADDR.NFPM, u0);
                this._pull(s, ADDR.USDT0, from, ADDR.NFPM, u1);
                const id = String(s.nextId++);
                const owner = lower(m.recipient);
                s.positions[id] = { owner, tickLower: m.tickLower, tickUpper: m.tickUpper, liquidity: liq, owed0: 0n, owed1: 0n };
                (s.owned[owner] ??= []).push(id);
                return enc([id, liq, u0, u1]);
            }
            case 'decreaseLiquidity': {
                const d = a[0]; const p = getPos(d.tokenId); onlyOwner(p);
                if (Number(d.deadline) < now) throw new Revert('Transaction too old');
                const liq = big(d.liquidity);
                if (liq <= 0n || liq > p.liquidity) throw new Revert('liquidez inválida');
                const [o0, o1] = this.amountsForLiquidity(liq, p.tickLower, p.tickUpper);
                if (o0 < big(d.amount0Min) || o1 < big(d.amount1Min)) throw new Revert('Price slippage check');
                p.liquidity -= liq; p.owed0 += o0; p.owed1 += o1;
                return enc([o0, o1]);
            }
            case 'collect': {
                const c = a[0]; const p = getPos(c.tokenId); onlyOwner(p);
                const g0 = p.owed0 < big(c.amount0Max) ? p.owed0 : big(c.amount0Max);
                const g1 = p.owed1 < big(c.amount1Max) ? p.owed1 : big(c.amount1Max);
                p.owed0 -= g0; p.owed1 -= g1;
                this._credit(s, ADDR.WPOL, c.recipient, g0); this._credit(s, ADDR.USDT0, c.recipient, g1);
                return enc([g0, g1]);
            }
            case 'burn': {
                const p = getPos(a[0]); onlyOwner(p);
                if (p.liquidity > 0n || p.owed0 > 0n || p.owed1 > 0n) throw new Revert('Not cleared');
                s.owned[p.owner] = s.owned[p.owner].filter((x) => x !== String(a[0]));
                delete s.positions[String(a[0])];
                return '0x';
            }
            case 'multicall':
                return enc([a[0].map((inner) => this.execNfpm(s, from, inner, 0n))]);
        }
        throw new Revert('função NFPM não simulada');
    }

    describeTx(to, data, value) {
        to = lower(to);
        const tryIface = (iface, label) => {
            try {
                const parsed = iface.parseTransaction({ data, value });
                return { contract: label, fn: parsed.name, args: parsed.args };
            } catch (e) { return null; }
        };
        if (to === ADDR.NFPM) return tryIface(I.nfpm, 'NFPM');
        if (to === ADDR.ROUTER) return tryIface(I.router, 'SwapRouter02');
        if (to === ADDR.WPOL) return tryIface(I.erc20, 'WPOL');
        if (to === ADDR.USDT0) return tryIface(I.erc20, 'USDT0');
        if (data && data.length >= 10 && tryIface(I.erc20, 'ERC20')) return { ...tryIface(I.erc20, 'ERC20'), contract: `ERC20(${to.slice(0, 8)})` };
        if (!data || data === '0x') return { contract: 'POL', fn: 'envio', args: [to, value] };
        return { contract: to, fn: data.slice(0, 10), args: [] };
    }

    // ------------------------------------------------------------ JSON-RPC
    handle(body) {
        if (Array.isArray(body)) return body.map((b) => this.handle(b));
        const ok = (result) => ({ jsonrpc: '2.0', id: body.id, result });
        const fail = (message, code = -32000, data) => { if (code !== 3) (this.failures ??= []).push(`${body.method}: ${message}`); return failObj(message, code, data); };
        const failObj = (message, code, data) => ({ jsonrpc: '2.0', id: body.id, error: { code, message, ...(data ? { data } : {}) } });
        const p = body.params || [];
        try {
            switch (body.method) {
                case 'eth_chainId': return ok(hex(this.chainId));
                case 'net_version': return ok(String(this.chainId));
                case 'eth_blockNumber': return ok(hex(this.block));
                case 'eth_gasPrice': return ok(hex(this.gasPrice));
                case 'eth_maxPriorityFeePerGas': return ok(hex(2n * 10n ** 9n)); // alguns RPCs sugerem menos que o mínimo aceito
                case 'eth_getBalance': return ok(hex(this.nativeOf(p[0])));
                case 'eth_getTransactionCount': return ok(hex(this.state.nonces[lower(p[0])] || 0));
                case 'eth_getCode': return ok(Object.values(ADDR).includes(lower(p[0])) || this.contracts?.[lower(p[0])] ? '0x60' : '0x');
                case 'eth_getLogs': return ok([]);
                case 'eth_getBlockByNumber': return ok({
                    number: hex(this.block), hash: ethers.utils.hexZeroPad(hex(this.block), 32), parentHash: ethers.constants.HashZero,
                    timestamp: hex(Math.floor(Date.now() / 1000)), nonce: '0x0000000000000000', difficulty: '0x0', gasLimit: hex(30000000),
                    gasUsed: '0x0', miner: ethers.constants.AddressZero, extraData: '0x', transactions: [], baseFeePerGas: hex(this.gasPrice / 2n)
                });
                case 'eth_call':
                case 'eth_estimateGas': {
                    const tx = p[0];
                    const sim = deepClone(this.state);
                    const value = tx.value ? BigInt(tx.value) : 0n;
                    try {
                        if (value > 0n) {
                            if (this.nativeOf(tx.from, sim) < value) throw new Revert('saldo nativo insuficiente');
                            sim.native[lower(tx.from)] -= value;
                        }
                        const ret = this.exec(sim, { from: tx.from, to: tx.to, data: tx.data || tx.input || '0x', value });
                        return ok(body.method === 'eth_call' ? ret : hex(300000));
                    } catch (e) {
                        if (!(e instanceof Revert)) throw e;
                        const data = '0x08c379a0' + ethers.utils.defaultAbiCoder.encode(['string'], [e.message]).slice(2);
                        return fail(`execution reverted: ${e.message}`, 3, data);
                    }
                }
                case 'eth_sendRawTransaction': {
                    const tx = ethers.utils.parseTransaction(p[0]);
                    const from = lower(tx.from);
                    const value = tx.value.toBigInt();
                    const gasUsed = (!tx.data || tx.data === '0x') ? 21000n : 180000n;
                    // Regra real da Polygon: gorjeta abaixo de 25 gwei é recusada pelos nós.
                    const tipCap = (tx.maxPriorityFeePerGas || tx.gasPrice).toBigInt();
                    if (this.chainId === 137 && tipCap < 25n * 10n ** 9n) return fail(`transaction underpriced: gas tip cap ${tipCap}, minimum needed 25000000000`);
                    const maxFee = (tx.maxFeePerGas || tx.gasPrice).toBigInt();
                    if (maxFee < this.gasPrice / 2n) return fail('max fee per gas less than block base fee');
                    const price = this.gasPrice / 2n + tipCap < maxFee ? this.gasPrice / 2n + tipCap : maxFee;
                    const gasCost = gasUsed * price;
                    // Nó de verdade exige saldo para o pior caso: limite de gás x taxa máxima + valor.
                    if (this.nativeOf(from) < value + tx.gasLimit.toBigInt() * maxFee) return fail('insufficient funds for gas * price + value');
                    const expectedNonce = this.state.nonces[from] || 0;
                    if (tx.nonce !== expectedNonce) return fail(`nonce incorreto: veio ${tx.nonce}, esperado ${expectedNonce}`);
                    this.state.nonces[from] = expectedNonce + 1;
                    this.state.native[from] -= gasCost;
                    this.block += 1;
                    let status = 1; let revertReason = '';
                    const trial = deepClone(this.state);
                    try {
                        trial.native[from] -= value;
                        this.exec(trial, { from, to: tx.to, data: tx.data, value });
                        this.state = trial;
                    } catch (e) {
                        if (!(e instanceof Revert)) throw e;
                        status = 0; revertReason = e.message;
                    }
                    this.txs.push({ hash: tx.hash, from, to: lower(tx.to), value, status, revertReason, ...this.describeTx(tx.to, tx.data, tx.value) });
                    this.receipts[tx.hash] = {
                        transactionHash: tx.hash, transactionIndex: '0x0', blockNumber: hex(this.block),
                        blockHash: ethers.utils.hexZeroPad(hex(this.block), 32), from, to: lower(tx.to), contractAddress: null,
                        cumulativeGasUsed: hex(gasUsed), gasUsed: hex(gasUsed), effectiveGasPrice: hex(price),
                        logs: [], logsBloom: '0x' + '0'.repeat(512), status: hex(status), type: '0x2'
                    };
                    this.rawTx ??= {}; this.rawTx[tx.hash] = tx;
                    return ok(tx.hash);
                }
                case 'eth_getTransactionReceipt': return ok(this.receipts[p[0]] || null);
                case 'eth_getTransactionByHash': {
                    const tx = this.rawTx?.[p[0]]; const r = this.receipts[p[0]];
                    if (!tx) return ok(null);
                    return ok({
                        hash: tx.hash, nonce: hex(tx.nonce), from: lower(tx.from), to: lower(tx.to), value: tx.value.toHexString(),
                        input: tx.data, gas: tx.gasLimit.toHexString(), gasPrice: hex(this.gasPrice), blockNumber: r.blockNumber,
                        blockHash: r.blockHash, transactionIndex: '0x0', chainId: hex(this.chainId), type: '0x2',
                        v: hex(tx.v), r: tx.r, s: tx.s
                    });
                }
                default:
                    this.unknownCalls.push({ method: body.method });
                    return fail(`método não simulado: ${body.method}`, -32601);
            }
        } catch (e) {
            this.unknownCalls.push({ method: body.method, error: e.message });
            return fail(`erro interno da simulação: ${e.message}`);
        }
    }
}
