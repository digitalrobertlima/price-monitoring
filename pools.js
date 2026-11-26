/* =========================================================================
   RDESK — FUNDOS DE TROCA EM QUALQUER REDE (interface própria, sem abrir a Uniswap)
   Conversa direto com os contratos oficiais da Uniswap V3 em cada rede:
   - lista as suas posições em todas as redes (valor, faixa, ganhos a colher);
   - abre posição com qualquer par de moedas da rede (inclusive moedas que você adicionou);
   - CRIA o fundo quando ele ainda não existe (você define o preço inicial);
   - colhe os ganhos e tira tudo, sem sair do app.
   Tudo assinado aqui; aprovação exata (nunca "ilimitada"); mínimos garantidos de 5%.
   ========================================================================= */
(function (global) {
    'use strict';

    const E = () => global.ethers;
    const W = () => global.RdeskWallet;
    const REG = () => global.RdeskRegistry;
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // Contratos oficiais da Uniswap V3 (docs.uniswap.org → Deployments)
    const UNI = {
        1: { factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984', nfpm: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88' },
        137: { factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984', nfpm: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88' },
        42161: { factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984', nfpm: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88' },
        10: { factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984', nfpm: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88' },
        8453: { factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD', nfpm: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1' },
        56: { factory: '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7', nfpm: '0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613' },
        42220: { factory: '0xAfE208a311B21f13EF87E33A90049fC17A7acDEc', nfpm: '0x3d79EdAaBC0EaB6F08ED885C05Fc0B014290D95A' }
    };
    // Moeda da rede "embrulhada" (o fundo só aceita tokens)
    const WRAPPED = {
        137: { symbol: 'WPOL', address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270' },
        1: { symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
        8453: { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006' },
        42161: { symbol: 'WETH', address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' },
        10: { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006' },
        56: { symbol: 'WBNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
        42220: { symbol: 'CELO', address: '0x471EcE3750Da237f93B8E339c536989b8978a438' }
    };
    const FEES = [{ fee: 100, spacing: 1, label: '0,01%', hint: 'moedas que andam juntas (dólar com dólar)' }, { fee: 500, spacing: 10, label: '0,05%', hint: 'pares muito negociados' }, { fee: 3000, spacing: 60, label: '0,3%', hint: 'o mais comum' }, { fee: 10000, spacing: 200, label: '1%', hint: 'moedas novas e arriscadas' }];
    const spacingOf = (fee) => FEES.find((f) => f.fee === Number(fee))?.spacing || 60;
    const MIN_TICK = -887272, MAX_TICK = 887272;
    const MAX_U128 = '0xffffffffffffffffffffffffffffffff';
    const SLIP = 0.05;

    const ABI = {
        factory: ['function getPool(address,address,uint24) view returns (address)'],
        pool: ['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)', 'function liquidity() view returns (uint128)'],
        erc20: ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function deposit() payable'],
        nfpm: [
            'function balanceOf(address) view returns (uint256)',
            'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
            'function positions(uint256) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256, uint256, uint128 tokensOwed0, uint128 tokensOwed1)',
            'function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) payable returns (address pool)',
            'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
            'function increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)',
            'function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) payable returns (uint256 amount0, uint256 amount1)',
            'function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) payable returns (uint256 amount0, uint256 amount1)',
            'function multicall(bytes[] data) payable returns (bytes[] results)'
        ]
    };
    const iface = (k) => new (E().utils.Interface)(ABI[k]);

    // ---------------------------------------------------------------- matemática da Uniswap V3
    // preço "humano" = quantas unidades de token1 por 1 token0
    const rawFromHuman = (p, dec0, dec1) => p * 10 ** (dec1 - dec0);
    const humanFromRaw = (p, dec0, dec1) => p / 10 ** (dec1 - dec0);
    const tickFromRaw = (p) => Math.floor(Math.log(p) / Math.log(1.0001));
    const rawFromTick = (t) => Math.pow(1.0001, t);
    const alignTick = (t, spacing, up = false) => {
        const a = (up ? Math.ceil : Math.floor)(t / spacing) * spacing;
        return Math.max(Math.ceil(MIN_TICK / spacing) * spacing, Math.min(Math.floor(MAX_TICK / spacing) * spacing, a));
    };
    function sqrtX96FromRaw(pRaw) {
        // √p × 2^96 em inteiro (precisão de ~15 dígitos: suficiente para o preço inicial)
        const s = Math.sqrt(pRaw);
        const exp = Math.floor(Math.log2(s));
        const mant = s / 2 ** exp; // 1..2
        const m = BigInt(Math.round(mant * 2 ** 52));
        const shift = 96 + exp - 52;
        return shift >= 0 ? m << BigInt(shift) : m >> BigInt(-shift);
    }
    // Quanto de cada moeda uma liquidez L vale (unidades brutas)
    function amountsFor(L, sqrtP, tickLower, tickUpper) {
        const sa = Math.sqrt(rawFromTick(tickLower)), sb = Math.sqrt(rawFromTick(tickUpper));
        if (sqrtP <= sa) return [L * (1 / sa - 1 / sb), 0];
        if (sqrtP >= sb) return [0, L * (sb - sa)];
        return [L * (1 / sqrtP - 1 / sb), L * (sqrtP - sa)];
    }
    // Dado o quanto de uma moeda, quanto precisa da outra (unidades brutas)
    function pairAmount(side, amountRaw, sqrtP, tickLower, tickUpper) {
        const sa = Math.sqrt(rawFromTick(tickLower)), sb = Math.sqrt(rawFromTick(tickUpper));
        if (sqrtP <= sa) return side === 0 ? { a0: amountRaw, a1: 0, only: 0 } : { a0: 0, a1: 0, only: 0, wrongSide: true };
        if (sqrtP >= sb) return side === 1 ? { a0: 0, a1: amountRaw, only: 1 } : { a0: 0, a1: 0, only: 1, wrongSide: true };
        if (side === 0) { const L = amountRaw / (1 / sqrtP - 1 / sb); return { a0: amountRaw, a1: L * (sqrtP - sa), L }; }
        const L = amountRaw / (sqrtP - sa); return { a0: L * (1 / sqrtP - 1 / sb), a1: amountRaw, L };
    }
    const toUnits = (x) => E().BigNumber.from(BigInt(Math.max(0, Math.floor(x))).toString());

    // ---------------------------------------------------------------- leitura
    const provider = (chainId) => W().getReadProvider(chainId);
    // Poucas perguntas por vez: servidores públicos recusam rajadas
    async function inChunks(list, fn, size = 6) {
        const out = [];
        for (let i = 0; i < list.length; i += size) out.push(...await Promise.all(list.slice(i, i + size).map(fn)));
        return out;
    }
    // Servidor público às vezes responde lixo: tenta o principal e depois cada servidor da lista da rede
    // Cada tentativa tem prazo: um servidor que não responde não trava a tela (nem o teste)
    const PRAZO = global.RDESK_NATIVE ? 90000 : 45000; // uma tentativa pode ter várias consultas (ex.: listar posições)
    const prazo = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('o servidor demorou demais')), PRAZO))]);
    async function withRpcs(chainId, fn) {
        let last;
        try { await Promise.race([REG().rankRpcs?.(chainId), new Promise((r) => setTimeout(r, global.RDESK_NATIVE ? 26000 : 6500))]); } catch (e) {}
        try { return await prazo(fn(provider(chainId))); } catch (e) { last = e; }
        for (const url of (REG().getChain(chainId)?.rpcs || [])) {
            await new Promise((r) => setTimeout(r, 250));
            try { return await prazo(fn(new (E().providers.StaticJsonRpcProvider)(url, Number(chainId)))); } catch (e) { last = e; }
        }
        throw last;
    }
    const tokenCache = {};
    async function tokenMeta(chainId, address) {
        const k = `${chainId}:${address.toLowerCase()}`;
        if (tokenCache[k]) return tokenCache[k];
        const known = (REG().getTokens(chainId) || []).find((t) => t.address && t.address.toLowerCase() === address.toLowerCase())
            || (WRAPPED[chainId]?.address.toLowerCase() === address.toLowerCase() ? { symbol: WRAPPED[chainId].symbol, decimals: 18, priceKey: REG().getChain(chainId).native === 'BNB' ? 'BNB' : REG().getChain(chainId).native } : null);
        if (known) return (tokenCache[k] = { symbol: known.symbol, decimals: known.decimals, address, priceKey: known.priceKey });
        const c = new (E().Contract)(address, ABI.erc20, provider(chainId));
        const [symbol, decimals] = await Promise.all([c.symbol().catch(() => '???'), c.decimals()]);
        return (tokenCache[k] = { symbol: String(symbol).slice(0, 12), decimals: Number(decimals), address });
    }
    function usdOf(chainId, meta) {
        if (!meta) return 0;
        const w = W();
        if (meta.priceKey) return w.unitUsdFor(meta.priceKey, chainId, meta.address);
        return w.unitUsdFor(null, chainId, meta.address);
    }
    function poolInfo(chainId, tokenA, tokenB, fee) { return withRpcs(chainId, (pr) => poolInfoWith(pr, chainId, tokenA, tokenB, fee)); }
    async function poolInfoWith(prov, chainId, tokenA, tokenB, fee) {
        const u = UNI[chainId];
        const [t0, t1] = tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
        const factory = new (E().Contract)(u.factory, ABI.factory, prov);
        const addr = await factory.getPool(t0, t1, fee);
        if (!addr || /^0x0{40}$/i.test(addr)) return { exists: false, token0: t0, token1: t1, fee };
        const pool = new (E().Contract)(addr, ABI.pool, prov);
        const [s0, liq] = await Promise.all([pool.slot0(), pool.liquidity()]);
        const sqrtP = Number(s0.sqrtPriceX96.toString()) / 2 ** 96;
        return { exists: true, address: addr, token0: t0, token1: t1, fee, tick: Number(s0.tick), sqrtP, liquidity: Number(liq.toString()), initialized: sqrtP > 0 };
    }

    // Posições em todas as redes
    async function listPositions(owner) {
        const out = [];
        const chains = Object.keys(UNI).map(Number).filter((c) => !global.RdeskAnon || global.RdeskAnon.chainAllowed(c));
        await Promise.all(chains.map(async (chainId) => {
            try {
                const { nfpm, ids } = await withRpcs(chainId, async (pr) => {
                    const c = new (E().Contract)(UNI[chainId].nfpm, ABI.nfpm, pr);
                    const n = Number(await c.balanceOf(owner));
                    // as mais novas primeiro (as abertas costumam ser as últimas)
                    const idx = Array.from({ length: Math.min(n, 40) }, (_, i) => n - 1 - i);
                    return { nfpm: c, ids: await inChunks(idx, (i) => c.tokenOfOwnerByIndex(owner, i)) };
                });
                await inChunks(ids, (idBn) => (async () => {
                    const id = idBn.toString();
                    // uma posição com erro de servidor tenta de novo pela lista; se ainda falhar, as outras seguem
                    const p = await nfpm.positions(id).catch(() => withRpcs(chainId, (pr) => new (E().Contract)(UNI[chainId].nfpm, ABI.nfpm, pr).positions(id))).catch(() => null);
                    if (!p) return;
                    const liquidity = Number(p.liquidity.toString());
                    const [m0, m1] = await Promise.all([tokenMeta(chainId, p.token0), tokenMeta(chainId, p.token1)]);
                    const pool = await poolInfo(chainId, p.token0, p.token1, Number(p.fee)).catch(() => null);
                    // ganhos a colher: simula o "colher" (não gasta nada)
                    let fee0 = Number(p.tokensOwed0.toString()), fee1 = Number(p.tokensOwed1.toString());
                    try {
                        const data = iface('nfpm').encodeFunctionData('collect', [{ tokenId: id, recipient: owner, amount0Max: MAX_U128, amount1Max: MAX_U128 }]);
                        const res = await provider(chainId).call({ from: owner, to: UNI[chainId].nfpm, data });
                        const [c0, c1] = iface('nfpm').decodeFunctionResult('collect', res);
                        fee0 = Number(c0.toString()); fee1 = Number(c1.toString());
                    } catch (e) {}
                    const [a0, a1] = pool?.sqrtP ? amountsFor(liquidity, pool.sqrtP, Number(p.tickLower), Number(p.tickUpper)) : [0, 0];
                    const h = (x, m) => x / 10 ** m.decimals;
                    const u0 = usdOf(chainId, m0), u1 = usdOf(chainId, m1);
                    const inRange = pool ? pool.tick >= Number(p.tickLower) && pool.tick < Number(p.tickUpper) : false;
                    out.push({
                        chainId, id, token0: m0, token1: m1, fee: Number(p.fee), tickLower: Number(p.tickLower), tickUpper: Number(p.tickUpper), liquidity, liquidityBn: p.liquidity.toString(),
                        amount0: h(a0, m0), amount1: h(a1, m1), fees0: h(fee0, m0), fees1: h(fee1, m1), inRange, closed: liquidity === 0,
                        usd: h(a0, m0) * u0 + h(a1, m1) * u1, feesUsd: h(fee0, m0) * u0 + h(fee1, m1) * u1, priced: u0 > 0 && u1 > 0,
                        min: humanFromRaw(rawFromTick(Number(p.tickLower)), m0.decimals, m1.decimals), max: humanFromRaw(rawFromTick(Number(p.tickUpper)), m0.decimals, m1.decimals),
                        price: pool?.sqrtP ? humanFromRaw(pool.sqrtP ** 2, m0.decimals, m1.decimals) : 0
                    });
                })().catch(() => { /* uma posição com erro não esconde as outras */ }));
            } catch (e) { /* rede sem resposta: tenta de novo na próxima atualização */ }
        }));
        return out.sort((a, b) => Number(b.closed === false) - Number(a.closed === false) || b.usd - a.usd);
    }

    // ---------------------------------------------------------------- escrita
    async function approveExact(signer, chainId, token, spender, amount) {
        const owner = await signer.getAddress();
        const c = new (E().Contract)(token, ABI.erc20, signer);
        const reader = new (E().Contract)(token, ABI.erc20, provider(chainId));
        const cur = await reader.allowance(owner, spender);
        if (cur.gte(amount)) return;
        if (!cur.isZero()) await W().confirmTx(await c.approve(spender, 0), chainId);
        await W().confirmTx(await c.approve(spender, amount), chainId);
    }
    // Monta a abertura de posição (e a criação do fundo, se preciso). Devolve tudo para conferência.
    async function planMint({ chainId, tokenA, tokenB, fee, minPrice, maxPrice, fullRange, amountA, initialPrice, owner }) {
        if (!UNI[chainId]) throw new Error('Esta rede ainda não tem fundos de troca no app.');
        if (tokenA.address.toLowerCase() === tokenB.address.toLowerCase()) throw new Error('Escolha duas moedas diferentes.');
        const pool = await poolInfo(chainId, tokenA.address, tokenB.address, fee);
        const aIs0 = tokenA.address.toLowerCase() === pool.token0.toLowerCase();
        const m0 = aIs0 ? tokenA : tokenB, m1 = aIs0 ? tokenB : tokenA;
        const spacing = spacingOf(fee);
        // Preço na direção do fundo (token1 por token0); a pessoa digita "B por A"
        const toPool = (pBperA) => (aIs0 ? pBperA : 1 / pBperA);
        let sqrtP, create = null;
        if (pool.exists && pool.initialized) sqrtP = pool.sqrtP;
        else {
            if (!(initialPrice > 0)) throw new Error('Este fundo ainda não existe. Diga o preço inicial (quantos ' + tokenB.symbol + ' vale 1 ' + tokenA.symbol + ').');
            const raw = rawFromHuman(toPool(initialPrice), m0.decimals, m1.decimals);
            sqrtP = Math.sqrt(raw);
            create = { sqrtPriceX96: sqrtX96FromRaw(raw).toString() };
        }
        let tickLower, tickUpper;
        if (fullRange) { tickLower = alignTick(MIN_TICK, spacing, true); tickUpper = alignTick(MAX_TICK, spacing); }
        else {
            if (!(minPrice > 0 && maxPrice > minPrice)) throw new Error('Faixa inválida: o mínimo precisa ser menor que o máximo.');
            const lo = rawFromHuman(toPool(aIs0 ? minPrice : maxPrice), m0.decimals, m1.decimals);
            const hi = rawFromHuman(toPool(aIs0 ? maxPrice : minPrice), m0.decimals, m1.decimals);
            tickLower = alignTick(tickFromRaw(lo), spacing);
            tickUpper = alignTick(tickFromRaw(hi), spacing, true);
            if (tickUpper <= tickLower) tickUpper = tickLower + spacing;
        }
        const rawA = Number(amountA) * 10 ** tokenA.decimals;
        if (!(rawA > 0)) throw new Error('Digite quanto de ' + tokenA.symbol + ' quer colocar.');
        const r = pairAmount(aIs0 ? 0 : 1, rawA, sqrtP, tickLower, tickUpper);
        if (r.wrongSide) throw new Error(`Com o preço fora da faixa, este fundo só aceita ${aIs0 ? m1.symbol : m0.symbol}. Mude a faixa ou a moeda.`);
        const a0 = r.a0, a1 = r.a1;
        const inRange = sqrtP > Math.sqrt(rawFromTick(tickLower)) && sqrtP < Math.sqrt(rawFromTick(tickUpper));
        const d0 = toUnits(a0 * 1.000001 + (a0 > 0 ? 1 : 0)), d1 = toUnits(a1 * 1.000001 + (a1 > 0 ? 1 : 0));
        const params = {
            token0: pool.token0, token1: pool.token1, fee, tickLower, tickUpper,
            amount0Desired: d0, amount1Desired: d1,
            amount0Min: create ? 0 : toUnits(a0 * (1 - SLIP)), amount1Min: create ? 0 : toUnits(a1 * (1 - SLIP)),
            recipient: owner, deadline: Math.floor(Date.now() / 1000) + 1200
        };
        const human = (x, m) => x / 10 ** m.decimals;
        const amt0 = human(a0, m0), amt1 = human(a1, m1);
        const usd = amt0 * usdOf(chainId, m0) + amt1 * usdOf(chainId, m1);
        return { chainId, pool, create, params, m0, m1, amt0, amt1, usd, inRange, tickLower, tickUpper,
            min: humanFromRaw(rawFromTick(tickLower), m0.decimals, m1.decimals), max: humanFromRaw(rawFromTick(tickUpper), m0.decimals, m1.decimals),
            price: humanFromRaw(sqrtP * sqrtP, m0.decimals, m1.decimals) };
    }
    async function executeMint(plan, { wrapNative = 0 } = {}) {
        const chainId = plan.chainId;
        const signer = await W().getSigner(chainId);
        const owner = await signer.getAddress();
        if (owner.toLowerCase() !== plan.params.recipient.toLowerCase()) throw new Error('A carteira mudou. Monte a posição de novo.');
        // Moeda da rede: embrulha antes (o fundo só aceita a versão embrulhada)
        if (wrapNative > 0) {
            const wr = new (E().Contract)(WRAPPED[chainId].address, ABI.erc20, signer);
            await W().confirmTx(await wr.deposit({ value: E().utils.parseUnits(String(wrapNative.toFixed(18)).replace(/0+$/, '').replace(/\.$/, ''), 18) }), chainId);
        }
        const nfpmAddr = UNI[chainId].nfpm;
        // Saldo de verdade, lido agora na rede (o da tela pode estar atrasado, ex.: logo depois de outra posição)
        await conferirSaldos(plan, owner, wrapNative);
        if (plan.params.amount0Desired.gt(0)) await approveExact(signer, chainId, plan.params.token0, nfpmAddr, plan.params.amount0Desired);
        if (plan.params.amount1Desired.gt(0)) await approveExact(signer, chainId, plan.params.token1, nfpmAddr, plan.params.amount1Desired);
        const nfpm = new (E().Contract)(nfpmAddr, ABI.nfpm, signer);
        const I = iface('nfpm');
        const calls = [];
        if (plan.create) calls.push(I.encodeFunctionData('createAndInitializePoolIfNecessary', [plan.params.token0, plan.params.token1, plan.params.fee, plan.create.sqrtPriceX96]));
        calls.push(I.encodeFunctionData('mint', [plan.params]));
        // Simula antes de enviar: se a Uniswap recusar, diz o motivo em português em vez de "cannot estimate gas"
        try {
            if (calls.length === 1) await nfpm.callStatic.mint(plan.params, { from: owner });
            else await nfpm.callStatic.multicall(calls, { from: owner });
        } catch (e) { throw new Error(motivoUniswap(e, plan)); }
        const tx = calls.length === 1 ? await nfpm.mint(plan.params) : await nfpm.multicall(calls);
        await W().confirmTx(tx, chainId);
        return tx.hash;
    }
    // Confere na rede se a carteira tem cada moeda que a posição vai puxar (com o que será embrulhado).
    async function conferirSaldos(plan, owner, wrapNative = 0) {
        const chainId = plan.chainId;
        const faltas = [];
        for (const [m, need] of [[plan.m0, plan.params.amount0Desired], [plan.m1, plan.params.amount1Desired]]) {
            if (!need || need.isZero()) continue;
            let tem;
            try { tem = await withRpcs(chainId, (p) => new (E().Contract)(m.address, ABI.erc20, p).balanceOf(owner)); } catch (e) { continue; } // sem leitura: a simulação ainda confere
            const vaiEmbrulhar = WRAPPED[chainId] && m.address.toLowerCase() === WRAPPED[chainId].address.toLowerCase() && wrapNative > 0
                ? E().utils.parseUnits(wrapNative.toFixed(18).replace(/0+$/, '').replace(/\.$/, ''), 18) : E().constants.Zero;
            if (tem.add(vaiEmbrulhar).lt(need)) {
                const f = (v) => Number(E().utils.formatUnits(v, m.decimals)).toLocaleString('pt-BR', { maximumFractionDigits: 6 });
                faltas.push(`${m.symbol}: você tem ${f(tem.add(vaiEmbrulhar))}, a posição precisa de ${f(need)}`);
            }
        }
        if (faltas.length) throw new Error(`Saldo insuficiente — ${faltas.join('; ')}. Diminua a quantidade e tente de novo (nada foi enviado).`);
    }
    // Traduz a recusa da Uniswap (o "cannot estimate gas" esconde o motivo de verdade)
    function motivoUniswap(e, plan) {
        const txt = [e?.reason, e?.error?.message, e?.error?.data?.message, e?.data?.message, e?.message].filter(Boolean).join(' | ');
        const nomes = `${plan.m0.symbol} ou ${plan.m1.symbol}`;
        if (/\bSTF\b|transfer amount exceeds|insufficient|exceeds balance|TRANSFER_FROM_FAILED/i.test(txt)) return `A Uniswap não conseguiu puxar ${nomes} da sua carteira: o saldo ou a autorização não cobre a quantidade. Diminua um pouco e tente de novo (nada foi enviado).`;
        if (/Price slippage check/i.test(txt)) return 'O preço do fundo mudou enquanto você conferia. Revise a posição de novo (nada foi enviado).';
        if (/Transaction too old/i.test(txt)) return 'A posição demorou demais para ser enviada. Revise de novo (nada foi enviado).';
        if (/\bTLU\b|\bTLM\b|\bTUM\b|tick/i.test(txt)) return 'Faixa de preço inválida para este fundo. Escolha outra faixa (nada foi enviado).';
        if (/blacklist|blocked|frozen|paused|pausable/i.test(txt)) return `A emissora de ${nomes} bloqueou esta movimentação (moeda pausada ou carteira bloqueada). Nada foi enviado.`;
        if (/insufficient funds/i.test(txt)) return 'Falta POL para pagar a taxa da rede.';
        const curto = String(e?.reason || e?.error?.message || '').replace(/^execution reverted:?\s*/i, '').slice(0, 120);
        return `A Uniswap recusou abrir a posição${curto ? ` (${curto})` : ''}. Nada foi enviado.`;
    }
    async function collect(pos) {
        const signer = await W().getSigner(pos.chainId);
        const owner = await signer.getAddress();
        const nfpm = new (E().Contract)(UNI[pos.chainId].nfpm, ABI.nfpm, signer);
        const tx = await nfpm.collect({ tokenId: pos.id, recipient: owner, amount0Max: MAX_U128, amount1Max: MAX_U128 });
        await W().confirmTx(tx, pos.chainId);
        return tx.hash;
    }
    async function withdrawAll(pos) {
        const signer = await W().getSigner(pos.chainId);
        const owner = await signer.getAddress();
        const I = iface('nfpm');
        const m0 = Math.floor(pos.amount0 * 10 ** pos.token0.decimals * (1 - SLIP)), m1 = Math.floor(pos.amount1 * 10 ** pos.token1.decimals * (1 - SLIP));
        const calls = [];
        if (pos.liquidity > 0) calls.push(I.encodeFunctionData('decreaseLiquidity', [{ tokenId: pos.id, liquidity: pos.liquidityBn, amount0Min: toUnits(m0), amount1Min: toUnits(m1), deadline: Math.floor(Date.now() / 1000) + 1200 }]));
        calls.push(I.encodeFunctionData('collect', [{ tokenId: pos.id, recipient: owner, amount0Max: MAX_U128, amount1Max: MAX_U128 }]));
        const nfpm = new (E().Contract)(UNI[pos.chainId].nfpm, ABI.nfpm, signer);
        const tx = await nfpm.multicall(calls);
        await W().confirmTx(tx, pos.chainId);
        return tx.hash;
    }

    // Colocar mais numa posição que já existe (mesma faixa). `lado` 0 = quantia em token0, 1 = em token1.
    async function planAdd(pos, lado, quantia) {
        const pool = await poolInfo(pos.chainId, pos.token0.address, pos.token1.address, pos.fee);
        if (!pool.exists || !pool.sqrtP) throw new Error('Não consegui ler o fundo agora. Tente de novo.');
        const m = lado === 0 ? pos.token0 : pos.token1;
        const raw = Number(quantia) * 10 ** m.decimals;
        if (!(raw > 0)) throw new Error(`Digite quanto de ${m.symbol} quer colocar.`);
        const r = pairAmount(lado, raw, pool.sqrtP, pos.tickLower, pos.tickUpper);
        if (r.wrongSide) throw new Error(`Com o preço fora da faixa, esta posição só aceita ${lado === 0 ? pos.token1.symbol : pos.token0.symbol}.`);
        const d0 = toUnits(r.a0 * 1.000001 + (r.a0 > 0 ? 1 : 0)), d1 = toUnits(r.a1 * 1.000001 + (r.a1 > 0 ? 1 : 0));
        return {
            chainId: pos.chainId, pos, m0: pos.token0, m1: pos.token1,
            amt0: r.a0 / 10 ** pos.token0.decimals, amt1: r.a1 / 10 ** pos.token1.decimals,
            params: { tokenId: pos.id, amount0Desired: d0, amount1Desired: d1, amount0Min: toUnits(r.a0 * (1 - SLIP)), amount1Min: toUnits(r.a1 * (1 - SLIP)), deadline: Math.floor(Date.now() / 1000) + 1200 }
        };
    }
    async function executeAdd(plan, { wrapNative = 0 } = {}) {
        const chainId = plan.chainId;
        const signer = await W().getSigner(chainId);
        const owner = await signer.getAddress();
        if (wrapNative > 0) {
            const wr = new (E().Contract)(WRAPPED[chainId].address, ABI.erc20, signer);
            await W().confirmTx(await wr.deposit({ value: E().utils.parseUnits(String(wrapNative.toFixed(18)).replace(/0+$/, '').replace(/\.$/, ''), 18) }), chainId);
        }
        await conferirSaldos(plan, owner, 0);
        const nfpmAddr = UNI[chainId].nfpm;
        if (plan.params.amount0Desired.gt(0)) await approveExact(signer, chainId, plan.m0.address, nfpmAddr, plan.params.amount0Desired);
        if (plan.params.amount1Desired.gt(0)) await approveExact(signer, chainId, plan.m1.address, nfpmAddr, plan.params.amount1Desired);
        const nfpm = new (E().Contract)(nfpmAddr, ABI.nfpm, signer);
        try { await nfpm.callStatic.increaseLiquidity(plan.params, { from: owner }); } catch (e) { throw new Error(motivoUniswap(e, plan)); }
        const tx = await nfpm.increaseLiquidity(plan.params);
        await W().confirmTx(tx, chainId);
        return tx.hash;
    }
    // Tirar uma parte (1–100%). Os ganhos acumulados vêm junto. 100% = tirar tudo.
    async function withdrawPart(pos, pct) {
        pct = Math.max(1, Math.min(100, Math.round(pct)));
        if (pct === 100) return withdrawAll(pos);
        const signer = await W().getSigner(pos.chainId);
        const owner = await signer.getAddress();
        const I = iface('nfpm');
        const liq = (BigInt(pos.liquidityBn) * BigInt(pct)) / 100n;
        if (liq <= 0n) throw new Error('Quantia pequena demais para tirar.');
        const f = pct / 100;
        const m0 = Math.floor(pos.amount0 * f * 10 ** pos.token0.decimals * (1 - SLIP)), m1 = Math.floor(pos.amount1 * f * 10 ** pos.token1.decimals * (1 - SLIP));
        const calls = [
            I.encodeFunctionData('decreaseLiquidity', [{ tokenId: pos.id, liquidity: liq.toString(), amount0Min: toUnits(m0), amount1Min: toUnits(m1), deadline: Math.floor(Date.now() / 1000) + 1200 }]),
            I.encodeFunctionData('collect', [{ tokenId: pos.id, recipient: owner, amount0Max: MAX_U128, amount1Max: MAX_U128 }])
        ];
        const nfpm = new (E().Contract)(UNI[pos.chainId].nfpm, ABI.nfpm, signer);
        try { await nfpm.callStatic.multicall(calls, { from: owner }); } catch (e) { throw new Error(motivoUniswap(e, { m0: pos.token0, m1: pos.token1 })); }
        const tx = await nfpm.multicall(calls);
        await W().confirmTx(tx, pos.chainId);
        return tx.hash;
    }
    const UNI_SLUG = { 1: 'ethereum', 137: 'polygon', 42161: 'arbitrum', 10: 'optimism', 8453: 'base', 56: 'bnb', 42220: 'celo' };
    const linkUniswap = (pos) => `https://app.uniswap.org/positions/v3/${UNI_SLUG[pos.chainId] || 'ethereum'}/${pos.id}`;

    // ---------------------------------------------------------------- telas
    const fmt = (v) => W().formatBRL(v);
    const brl = (usd) => fmt(usd * (W().getPrices().USD_BRL || 5.4));
    const num = (x, d = 6) => Number(x).toLocaleString('pt-BR', { maximumFractionDigits: x >= 1000 ? 2 : x >= 1 ? 4 : d });
    function sheet(html) {
        const root = document.getElementById('ob-root');
        if (!root) return null;
        root.replaceChildren();
        const wrap = document.createElement('div');
        wrap.className = 'ob-overlay pools-overlay';
        wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true');
        wrap.innerHTML = `<div class="ob-sheet mk-sheet pools-sheet">${html}</div>`;
        wrap.addEventListener('click', (ev) => { if (ev.target === wrap || ev.target.closest('[data-close]')) root.replaceChildren(); });
        root.appendChild(wrap);
        requestAnimationFrame(() => wrap.classList.add('open'));
        return wrap;
    }
    let lastList = [];
    // A seção "Fundos" (aba própria): a lista fica na tela, as ações abrem folhas por cima.
    function open() {
        document.getElementById('ob-root')?.replaceChildren();
        const btn = document.querySelector('.nav-tab-btn[data-tab="earn"]');
        if (btn && btn.getAttribute('aria-selected') !== 'true') btn.click();
        mostrarAba('posicoes');
        return renderLista();
    }
    function mostrarAba(qual) {
        document.querySelectorAll('[data-fundos-aba]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.fundosAba === qual)));
        document.querySelectorAll('[data-fundos-vista]').forEach((v) => { v.hidden = v.dataset.fundosVista !== qual; });
        if (qual === 'piloto') requestAnimationFrame(() => global.dispatchEvent(new Event('resize'))); // gráfico estava escondido
        if (qual === 'posicoes') renderLista();
    }
    let listando = null;
    function renderLista() {
        const box = document.getElementById('fundos-lista');
        if (!box) return Promise.resolve();
        if (listando) return listando;
        listando = desenharLista(box).finally(() => { listando = null; });
        return listando;
    }
    async function desenharLista(box) {
        const resumo = document.getElementById('fundos-resumo');
        const owner = W()?.getAddress?.();
        if (!owner) {
            box.innerHTML = '<div class="empty-state">Abra uma carteira para ver e abrir posições.</div>';
            if (resumo) resumo.innerHTML = '';
            return;
        }
        if (!lastList.length) box.innerHTML = '<div class="skeleton-row"></div><div class="skeleton-row"></div>';
        const list = await listPositions(owner).catch(() => []);
        lastList = list;
        if (!box.isConnected) return;
        const abertas = list.filter((p) => !p.closed);
        if (resumo) {
            const total = abertas.reduce((n, p) => n + (p.priced ? p.usd : 0), 0);
            const ganhos = list.reduce((n, p) => n + (p.priced ? p.feesUsd : 0), 0);
            const fora = abertas.filter((p) => !p.inRange).length;
            resumo.innerHTML = abertas.length ? `
                <div class="fundos-num"><span>Nos fundos</span><strong class="money">${esc(brl(total))}</strong></div>
                <div class="fundos-num"><span>Para colher</span><strong class="money">${esc(brl(ganhos))}</strong></div>
                <div class="fundos-num"><span>Posições</span><strong>${abertas.length}${fora ? ` <small class="fora">· ${fora} fora da faixa</small>` : ''}</strong></div>` : '';
        }
        if (!list.length) { box.innerHTML = '<div class="empty-state">Nenhuma posição ainda. Toque em "Nova posição" para colocar duas moedas num fundo.</div>'; return; }
        const isOld = (p) => p.closed && !(p.fees0 > 0 || p.fees1 > 0);
        const temGanho = (p) => p.feesUsd > 0 || p.fees0 > 0 || p.fees1 > 0;
        const card = (p, i) => `
            <article class="pl-card ${p.closed ? 'closed' : p.inRange ? 'in' : 'out'}">
                <div class="pl-head">${REG().tokenBadge(p.token0.symbol, 28)}${REG().tokenBadge(p.token1.symbol, 28)}
                    <strong>${esc(p.token0.symbol)} / ${esc(p.token1.symbol)}</strong>
                    <span class="pl-fee">${esc(FEES.find((f) => f.fee === p.fee)?.label || p.fee)}</span>
                    ${REG().chainBadge(p.chainId)}</div>
                <div class="pl-status">${p.closed ? '⚪ Encerrada' : p.inRange ? '🟢 Recebendo taxas' : '🟠 Fora da faixa: parou de receber'}</div>
                <div class="pl-grid">
                    <div><span>Valor</span><strong class="money">${p.priced ? esc(brl(p.usd)) : `${num(p.amount0)} ${esc(p.token0.symbol)} + ${num(p.amount1)} ${esc(p.token1.symbol)}`}</strong></div>
                    <div><span>Para colher</span><strong class="money">${p.priced ? esc(brl(p.feesUsd)) : `${num(p.fees0)} + ${num(p.fees1)}`}</strong></div>
                    <div class="wide"><span>Faixa (${esc(p.token1.symbol)} por ${esc(p.token0.symbol)})</span><strong>${num(p.min)} – ${num(p.max)} · agora ${num(p.price)}</strong></div>
                </div>
                <div class="pl-acoes">
                    <button type="button" class="btn-soft" data-acao="add" data-i="${i}" ${p.closed ? 'disabled' : ''}>＋ Colocar</button>
                    <button type="button" class="btn-soft" data-acao="tirar" data-i="${i}" ${p.closed ? 'disabled' : ''}>− Tirar</button>
                    <button type="button" class="btn-soft" data-acao="colher" data-i="${i}" ${temGanho(p) ? '' : 'disabled'}>Colher</button>
                    <button type="button" class="btn-soft" data-acao="mais" data-i="${i}" aria-label="Mais opções">⋯</button>
                </div>
                <div class="pl-msg" data-msg="${i}" role="status"></div>
            </article>`;
        const active = list.map((p, i) => [p, i]).filter(([p]) => !isOld(p));
        const old = list.map((p, i) => [p, i]).filter(([p]) => isOld(p));
        box.innerHTML = (active.length ? active.map(([p, i]) => card(p, i)).join('') : '<div class="empty-state">Nenhuma posição aberta agora.</div>')
            + (old.length ? `<details class="more-fold"><summary>Encerradas (${old.length})</summary><div class="fold-content pl-list">${old.map(([p, i]) => card(p, i)).join('')}</div></details>` : '');
        box.querySelectorAll('[data-acao]').forEach((b) => {
            b.onclick = () => {
                const p = list[Number(b.dataset.i)];
                const msg = box.querySelector(`[data-msg="${b.dataset.i}"]`);
                if (b.dataset.acao === 'add') return folhaColocar(p);
                if (b.dataset.acao === 'tirar') return folhaTirar(p);
                if (b.dataset.acao === 'colher') return colherComRecibo(p, msg);
                if (b.dataset.acao === 'mais') return folhaMais(p);
            };
        });
    }
    const feito = (texto) => { global.dispatchEvent(new CustomEvent('rdesk:success', { detail: { text: texto } })); W().refreshBalances?.(); };
    const linkTx = (chainId, hash) => `<a href="${esc(REG().explorerTxUrl(chainId, hash))}" target="_blank" rel="noopener noreferrer">Ver transação ↗</a>`;
    async function colherComRecibo(p, msg) {
        const ok = await global.RdeskReceipt.confirm({
            title: 'Colher ganhos', sendVal: `${p.token0.symbol}/${p.token1.symbol} na ${REG().getChain(p.chainId).name}`, sendBrl: p.priced ? brl(p.feesUsd) : '',
            recvVal: `${num(p.fees0)} ${p.token0.symbol} + ${num(p.fees1)} ${p.token1.symbol}`, recvBrl: p.priced ? brl(p.feesUsd) : '',
            route: 'Uniswap V3 (contrato oficial, direto do app)', fee: 'R$ 0,00 (sem taxa do app)',
            gas: `Paga em ${REG().getChain(p.chainId).native} na rede ${REG().getChain(p.chainId).name}`, shield: 'Só os ganhos saem; a posição continua no fundo.'
        });
        if (!ok) return;
        try {
            if (msg) msg.textContent = 'Assinando…';
            const hash = await collect(p);
            if (msg) msg.innerHTML = `✓ Ganhos colhidos. ${linkTx(p.chainId, hash)}`;
            feito('Ganhos colhidos!');
            renderLista();
        } catch (e) { if (msg) msg.textContent = `❌ ${e?.reason || e?.message || e}`.slice(0, 200); }
    }
    const tituloPos = (p) => `${esc(p.token0.symbol)} / ${esc(p.token1.symbol)} <small>${esc(FEES.find((f) => f.fee === p.fee)?.label || '')} · ${esc(REG().getChain(p.chainId).name)}</small>`;

    // ---------- colocar mais ----------
    function folhaColocar(p) {
        const el = sheet(`
            <div class="mk-top"><h2>Colocar mais</h2><button type="button" class="icon-btn" data-close aria-label="Fechar">✕</button></div>
            <p class="pl-titulo">${tituloPos(p)}</p>
            <p class="muted-sm">Entra na mesma faixa (${num(p.min)} – ${num(p.max)}). Você diz quanto de uma moeda; o app calcula quanto vai da outra, no preço de agora.</p>
            <label class="field-label">Moeda que você vai digitar
                <select id="pa-lado" class="field-input"><option value="0">${esc(p.token0.symbol)}</option><option value="1">${esc(p.token1.symbol)}</option></select></label>
            <label class="field-label">Quanto<input type="text" inputmode="decimal" id="pa-qtd" class="field-input" autocomplete="off" placeholder="0,00"></label>
            <div id="pa-preview" aria-live="polite"></div>
            <button type="button" class="btn-primary" id="pa-go" disabled>Revisar e colocar</button>
            <div id="pa-msg" class="pl-msg" role="status"></div>`);
        if (!el) return;
        const $ = (q) => el.querySelector(q);
        let plano = null, t = null;
        // Saldos lidos na rede ao abrir (a lista da tela pode estar atrasada)
        const saldos = {};
        const dono = W().getAddress();
        const lerSaldos = Promise.all([
            ...[p.token0, p.token1].map((m) => withRpcs(p.chainId, (pr) => new (E().Contract)(m.address, ABI.erc20, pr).balanceOf(dono))
                .then((v) => { saldos[m.address.toLowerCase()] = Number(E().utils.formatUnits(v, m.decimals)); }).catch(() => {})),
            withRpcs(p.chainId, (pr) => pr.getBalance(dono)).then((v) => { saldos.nativo = Number(E().utils.formatEther(v)); }).catch(() => {})
        ]);
        const saldoDe = (m) => saldos[m.address.toLowerCase()] ?? Number((W().getBalances() || []).find((b) => b.chainId === p.chainId && b.symbol === m.symbol)?.amount || 0);
        const nativo = () => saldos.nativo ?? 0;
        const ehEmbrulhada = (m) => WRAPPED[p.chainId] && m.address.toLowerCase() === WRAPPED[p.chainId].address.toLowerCase();
        const previa = () => {
            clearTimeout(t);
            t = setTimeout(async () => {
                $('#pa-go').disabled = true; plano = null;
                const q = Number(String($('#pa-qtd').value).replace(/\./g, '').replace(',', '.'));
                if (!(q > 0)) { $('#pa-preview').innerHTML = ''; return; }
                try {
                    await lerSaldos;
                    plano = await planAdd(p, Number($('#pa-lado').value), q);
                    const falta = [[p.token0, plano.amt0], [p.token1, plano.amt1]].filter(([m, need]) => need > 0 && saldoDe(m) + (ehEmbrulhada(m) ? Math.max(0, nativo() - 3) : 0) + 1e-12 < need);
                    const u0 = usdOf(p.chainId, p.token0), u1 = usdOf(p.chainId, p.token1);
                    $('#pa-preview').innerHTML = `<div class="pl-need"><span>Você coloca</span><strong>${num(plano.amt0)} ${esc(p.token0.symbol)} + ${num(plano.amt1)} ${esc(p.token1.symbol)}</strong>${u0 > 0 && u1 > 0 ? `<small class="money">≈ ${esc(brl(plano.amt0 * u0 + plano.amt1 * u1))}</small>` : ''}</div>`
                        + (falta.length ? `<p class="warn-text">Falta ${falta.map(([m, need]) => `${esc(m.symbol)} (você tem ${num(saldoDe(m))}, precisa de ${num(need)})`).join(' e ')}.</p>` : '');
                    $('#pa-go').disabled = falta.length > 0;
                } catch (e) { $('#pa-preview').innerHTML = `<p class="warn-text">${esc(e.message)}</p>`; }
            }, 250);
        };
        $('#pa-qtd').addEventListener('input', previa);
        $('#pa-lado').addEventListener('change', previa);
        $('#pa-go').onclick = async () => {
            if (!plano) return;
            const u0 = usdOf(p.chainId, p.token0), u1 = usdOf(p.chainId, p.token1);
            const ok = await global.RdeskReceipt.confirm({
                title: 'Colocar mais na posição', sendVal: `${num(plano.amt0)} ${p.token0.symbol} + ${num(plano.amt1)} ${p.token1.symbol}`,
                sendBrl: u0 > 0 && u1 > 0 ? brl(plano.amt0 * u0 + plano.amt1 * u1) : '', recvVal: `Mais dinheiro na posição ${p.token0.symbol}/${p.token1.symbol}`,
                recvBrl: p.inRange ? 'recebe taxas enquanto o preço ficar na faixa' : 'a faixa está fora do preço: fica parado',
                route: `Uniswap V3 oficial • ${REG().getChain(p.chainId).name}`, fee: 'R$ 0,00 (sem taxa do app)',
                gas: `Paga em ${REG().getChain(p.chainId).native}`, shield: 'Mínimo garantido: 95% do calculado. Aprovação só do valor exato.'
            });
            if (!ok) return;
            try {
                $('#pa-go').disabled = true;
                $('#pa-msg').textContent = 'Assinando… (aprovar cada moeda e depois colocar)';
                const emb = [[p.token0, plano.amt0], [p.token1, plano.amt1]].filter(([m]) => ehEmbrulhada(m)).map(([m, need]) => Math.max(0, need - saldoDe(m)))[0] || 0;
                const hash = await executeAdd(plano, { wrapNative: emb > 0 ? emb * 1.000001 : 0 });
                $('#pa-msg').innerHTML = `✅ Colocado! ${linkTx(p.chainId, hash)}`;
                feito('Posição aumentada!');
                setTimeout(() => { if ($('#pa-msg').isConnected) open(); }, 1600);
            } catch (e) { $('#pa-msg').textContent = `❌ ${e?.reason || e?.message || e}`.slice(0, 220); $('#pa-go').disabled = false; }
        };
    }

    // ---------- tirar parte ou tudo ----------
    function folhaTirar(p) {
        const el = sheet(`
            <div class="mk-top"><h2>Tirar do fundo</h2><button type="button" class="icon-btn" data-close aria-label="Fechar">✕</button></div>
            <p class="pl-titulo">${tituloPos(p)}</p>
            <div class="chip-group" id="pt-pcts">${[25, 50, 75, 100].map((v) => `<button type="button" class="chip" data-pct="${v}">${v === 100 ? 'Tudo' : v + '%'}</button>`).join('')}</div>
            <label class="field-label">Quanto tirar: <strong id="pt-val">50%</strong><input type="range" id="pt-range" min="1" max="100" value="50" class="pt-range"></label>
            <div id="pt-preview" class="pl-need" aria-live="polite"></div>
            <p class="muted-sm">Os ganhos que estavam para colher vêm junto. Com "Tudo", a posição fica encerrada (dá para abrir outra depois).</p>
            <button type="button" class="btn-primary" id="pt-go">Revisar e tirar</button>
            <div id="pt-msg" class="pl-msg" role="status"></div>`);
        if (!el) return;
        const $ = (q) => el.querySelector(q);
        const pct = () => Number($('#pt-range').value);
        const u0 = usdOf(p.chainId, p.token0), u1 = usdOf(p.chainId, p.token1);
        const prev = () => {
            const f = pct() / 100;
            $('#pt-val').textContent = pct() === 100 ? 'tudo' : `${pct()}%`;
            $('#pt-preview').innerHTML = `<span>Volta para a carteira (aprox.)</span><strong>${num(p.amount0 * f + p.fees0)} ${esc(p.token0.symbol)} + ${num(p.amount1 * f + p.fees1)} ${esc(p.token1.symbol)}</strong>${p.priced ? `<small class="money">≈ ${esc(brl(p.usd * f + p.feesUsd))}</small>` : ''}`;
            el.querySelectorAll('[data-pct]').forEach((b) => b.classList.toggle('active', Number(b.dataset.pct) === pct()));
        };
        $('#pt-range').addEventListener('input', prev);
        el.querySelectorAll('[data-pct]').forEach((b) => { b.onclick = () => { $('#pt-range').value = b.dataset.pct; prev(); }; });
        prev();
        $('#pt-go').onclick = async () => {
            const v = pct(), f = v / 100;
            const ok = await global.RdeskReceipt.confirm({
                title: v === 100 ? 'Tirar tudo do fundo' : `Tirar ${v}% do fundo`, sendVal: `${p.token0.symbol}/${p.token1.symbol} na ${REG().getChain(p.chainId).name}`,
                sendBrl: p.priced ? brl(p.usd * f) : '', recvVal: `~${num(p.amount0 * f + p.fees0)} ${p.token0.symbol} + ~${num(p.amount1 * f + p.fees1)} ${p.token1.symbol}`,
                recvBrl: p.priced ? brl(p.usd * f + p.feesUsd) : '', route: 'Uniswap V3 (contrato oficial, direto do app)', fee: 'R$ 0,00 (sem taxa do app)',
                gas: `Paga em ${REG().getChain(p.chainId).native}`, shield: 'Mínimo garantido: 95% do valor de hoje. As moedas voltam para a sua carteira.'
            });
            if (!ok) return;
            try {
                $('#pt-go').disabled = true; $('#pt-msg').textContent = 'Assinando…';
                const hash = await withdrawPart(p, v);
                $('#pt-msg').innerHTML = `✅ Feito! ${linkTx(p.chainId, hash)}`;
                feito(v === 100 ? 'Dinheiro tirado do fundo!' : 'Parte tirada do fundo!');
                setTimeout(() => { if ($('#pt-msg').isConnected) open(); }, 1600);
            } catch (e) { $('#pt-msg').textContent = `❌ ${e?.reason || e?.message || e}`.slice(0, 220); $('#pt-go').disabled = false; }
        };
    }

    // ---------- mais opções ----------
    function folhaMais(p) {
        const el = sheet(`
            <div class="mk-top"><h2>Mais opções</h2><button type="button" class="icon-btn" data-close aria-label="Fechar">✕</button></div>
            <p class="pl-titulo">${tituloPos(p)}</p>
            <div class="pl-menu">
                ${p.closed ? '' : `<button type="button" class="btn-soft" id="pm-faixa">↔ Mudar a faixa<small>Tira tudo desta posição e abre outra no mesmo fundo, com a faixa nova</small></button>`}
                <button type="button" class="btn-soft" id="pm-novo">＋ Outra posição neste fundo<small>Mesmo par e mesma taxa, com outra faixa</small></button>
                <a class="btn-soft" href="${esc(linkUniswap(p))}" target="_blank" rel="noopener noreferrer">Ver no site da Uniswap ↗<small>Posição nº ${esc(p.id)}</small></a>
            </div>
            <div id="pm-msg" class="pl-msg" role="status"></div>`);
        if (!el) return;
        const pre = { chainId: p.chainId, a: p.token0.symbol, b: p.token1.symbol, fee: p.fee };
        el.querySelector('#pm-novo').onclick = () => openNew(pre);
        const fx = el.querySelector('#pm-faixa');
        if (fx) fx.onclick = async () => {
            const ok = await global.RdeskReceipt.confirm({
                title: 'Mudar a faixa (passo 1 de 2: tirar tudo)', sendVal: `${p.token0.symbol}/${p.token1.symbol} na ${REG().getChain(p.chainId).name}`,
                sendBrl: p.priced ? brl(p.usd) : '', recvVal: `~${num(p.amount0 + p.fees0)} ${p.token0.symbol} + ~${num(p.amount1 + p.fees1)} ${p.token1.symbol}`,
                recvBrl: 'depois você escolhe a faixa nova', route: 'Uniswap V3 (contrato oficial, direto do app)', fee: 'R$ 0,00 (sem taxa do app)',
                gas: `Paga em ${REG().getChain(p.chainId).native}`, shield: 'Mínimo garantido: 95% do valor de hoje.'
            });
            if (!ok) return;
            try {
                el.querySelector('#pm-msg').textContent = 'Tirando da faixa antiga…';
                await withdrawAll(p);
                feito('Faixa antiga encerrada. Agora escolha a nova.');
                W().refreshBalances?.();
                openNew(pre);
            } catch (e) { el.querySelector('#pm-msg').textContent = `❌ ${e?.reason || e?.message || e}`.slice(0, 200); }
        };
    }

    function tokensFor(chainId) {
        const list = (REG().getTokens(chainId) || []).filter((t) => t.address || t.isNative);
        return list.map((t) => (t.isNative ? { ...t, wrapOf: WRAPPED[chainId] } : t));
    }
    function openNew(prefill = {}) {
        const chains = Object.keys(UNI).map(Number);
        let chainId = prefill.chainId && UNI[prefill.chainId] ? prefill.chainId : 137;
        const feeInicial = FEES.some((f) => f.fee === prefill.fee) ? prefill.fee : null;
        const el = sheet(`
            <div class="mk-top"><button type="button" class="icon-btn" id="pl-back" aria-label="Voltar">←</button><h2>Nova posição</h2><button type="button" class="icon-btn" data-close aria-label="Fechar">✕</button></div>
            <label class="field-label">Rede<select id="pl-chain" class="field-input">${chains.map((c) => `<option value="${c}" ${c === chainId ? 'selected' : ''}>${esc(REG().getChain(c).name)}</option>`).join('')}</select></label>
            <div class="pl-pair">
                <label class="field-label">Moeda A<select id="pl-a" class="field-input"></select></label>
                <label class="field-label">Moeda B<select id="pl-b" class="field-input"></select></label>
            </div>
            <div id="pl-colar" class="pl-colar" hidden>
                <label class="field-label">Contrato da moeda (<span id="pl-colar-lado">A</span>) nesta rede
                    <input type="text" id="pl-colar-end" class="field-input" placeholder="0x…" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
                <button type="button" class="btn-soft" id="pl-colar-ok">Usar esta moeda</button>
                <p class="muted-sm">O app lê o nome e as casas decimais direto da blockchain. Confira o contrato numa fonte oficial: qualquer pessoa consegue criar uma moeda com o mesmo nome de outra.</p>
                <div id="pl-colar-msg" class="pl-msg" role="status"></div>
            </div>
            <label class="field-label">Taxa do fundo (quanto cada troca paga)</label>
            <div class="chip-group" id="pl-fees">${FEES.map((f) => `<button type="button" class="chip" data-fee="${f.fee}">${f.label}<small>${esc(f.hint)}</small></button>`).join('')}</div>
            <div id="pl-poolinfo" class="pl-poolinfo muted-sm"></div>
            <label class="field-label" id="pl-init-wrap" hidden>Preço inicial: quanto vale 1 <span data-sym-a></span> em <span data-sym-b></span>
                <input type="text" inputmode="decimal" id="pl-init" class="field-input" autocomplete="off"></label>
            <label class="field-label">Faixa de preço (<span data-sym-b></span> por 1 <span data-sym-a></span>)</label>
            <div class="chip-group" id="pl-widths">${[['3', '±1,5%'], ['8', '±4%'], ['20', '±10%'], ['50', '±25%'], ['full', 'Cheia']].map(([w, l]) => `<button type="button" class="chip" data-w="${w}">${l}</button>`).join('')}</div>
            <div class="range-fields"><label>Mínimo<input type="text" inputmode="decimal" id="pl-min" class="field-input" autocomplete="off"></label><label>Máximo<input type="text" inputmode="decimal" id="pl-max" class="field-input" autocomplete="off"></label></div>
            <label class="field-label">Quanto de <span data-sym-a></span> colocar<input type="text" inputmode="decimal" id="pl-amt" class="field-input" placeholder="0,00" autocomplete="off"></label>
            <div id="pl-preview" class="pl-preview" aria-live="polite"></div>
            <button type="button" class="btn-primary" id="pl-go" disabled>Revisar e abrir posição</button>
            <div id="pl-msg" class="pl-msg" role="status"></div>
            <p class="muted-sm">Risco: se o preço sair da faixa, a posição para de render e fica toda numa moeda só. Fundo novo, com pouca gente, rende pouco. Use só uma parte do dinheiro.</p>`);
        if (!el) return;
        const $ = (s) => el.querySelector(s);
        const st = { fee: feeInicial || 3000, width: '8', pool: null, plan: null, seq: 0, extras: [], ladoColar: 'a', anterior: { a: '', b: '' }, vivos: {} };
        const COLAR = '__colar';
        const todos = () => [...tokensFor(chainId), ...st.extras.filter((t) => t.chainId === chainId)];
        const num2 = (s) => { const v = REG().parseBRL(String(s || '').trim()); return v === null ? NaN : v; };
        const fillTokens = (selA, selB) => {
            const toks = todos();
            const opt = (t, sel) => `<option value="${esc(t.symbol)}" ${t.symbol === sel ? 'selected' : ''}>${esc(t.symbol)}${t.isNative ? ' (embrulha sozinho)' : ''}</option>`;
            const defA = selA || prefill.a || toks.find((t) => t.isNative)?.symbol || toks[0]?.symbol;
            const defB = selB || prefill.b || toks.find((t) => /USDC|USDT/.test(t.symbol) && t.symbol !== defA)?.symbol || toks[1]?.symbol;
            const colar = `<option value="${COLAR}">➕ Outra moeda: colar o contrato…</option>`;
            $('#pl-a').innerHTML = toks.map((t) => opt(t, defA)).join('') + colar;
            $('#pl-b').innerHTML = toks.map((t) => opt(t, defB)).join('') + colar;
            st.anterior = { a: $('#pl-a').value, b: $('#pl-b').value };
        };
        const metaOf = (sym) => {
            const t = todos().find((x) => x.symbol === sym);
            if (!t) return null;
            if (t.isNative) return { symbol: t.wrapOf.symbol, address: t.wrapOf.address, decimals: 18, priceKey: t.priceKey, native: t.symbol };
            return { symbol: t.symbol, address: t.address, decimals: t.decimals, priceKey: t.priceKey, isCustom: t.isCustom };
        };
        // Lê na rede o saldo das moedas escolhidas (no máximo a cada 15 s por moeda)
        const atualizarSaldosVivos = async (cid, metas) => {
            const dono = W().getAddress();
            await Promise.all(metas.filter((m) => m && m.address && !m.native).map(async (m) => {
                const k = `${cid}:${m.address.toLowerCase()}`;
                if (st.vivos[k] && Date.now() - st.vivos[k].em < 15000) return;
                try {
                    const v = await withRpcs(cid, (p) => new (E().Contract)(m.address, ABI.erc20, p).balanceOf(dono));
                    st.vivos[k] = { v: Number(E().utils.formatUnits(v, m.decimals)), em: Date.now() };
                } catch (e) { /* sem leitura: usa o saldo da lista */ }
            }));
        };
        const syms = () => { el.querySelectorAll('[data-sym-a]').forEach((x) => { x.textContent = $('#pl-a').value; }); el.querySelectorAll('[data-sym-b]').forEach((x) => { x.textContent = $('#pl-b').value; }); };
        const marketPrice = () => { // B por A pelo preço de mercado (para fundo novo)
            const A = metaOf($('#pl-a').value), B = metaOf($('#pl-b').value);
            const ua = usdOf(chainId, A), ub = usdOf(chainId, B);
            return ua > 0 && ub > 0 ? ua / ub : 0;
        };
        const currentPrice = () => {
            const p = st.pool; const A = metaOf($('#pl-a').value), B = metaOf($('#pl-b').value);
            if (p?.exists && p.initialized) {
                const aIs0 = A.address.toLowerCase() === p.token0.toLowerCase();
                const h = humanFromRaw(p.sqrtP ** 2, aIs0 ? A.decimals : B.decimals, aIs0 ? B.decimals : A.decimals);
                return aIs0 ? h : 1 / h;
            }
            return num2($('#pl-init').value) || marketPrice();
        };
        const applyWidth = () => {
            el.querySelectorAll('#pl-widths [data-w]').forEach((b) => b.classList.toggle('active', b.dataset.w === st.width));
            const full = st.width === 'full';
            $('#pl-min').disabled = full; $('#pl-max').disabled = full;
            if (full) { $('#pl-min').value = '0'; $('#pl-max').value = '∞'; return; }
            const p = currentPrice();
            if (!(p > 0)) return;
            const w = Number(st.width) / 100;
            $('#pl-min').value = String(+(p * (1 - w / 2)).toPrecision(6)).replace('.', ',');
            $('#pl-max').value = String(+(p * (1 + w / 2)).toPrecision(6)).replace('.', ',');
        };
        const loadPool = async () => {
            const seq = ++st.seq;
            el.querySelectorAll('#pl-fees [data-fee]').forEach((b) => b.classList.toggle('active', Number(b.dataset.fee) === st.fee));
            syms();
            const A = metaOf($('#pl-a').value), B = metaOf($('#pl-b').value);
            const info = $('#pl-poolinfo');
            if (!A || !B || A.address.toLowerCase() === B.address.toLowerCase()) { info.textContent = 'Escolha duas moedas diferentes.'; st.pool = null; return preview(); }
            info.textContent = 'Procurando o fundo…';
            try {
                const p = await poolInfo(chainId, A.address, B.address, st.fee);
                if (seq !== st.seq) return;
                st.pool = p;
                $('#pl-init-wrap').hidden = p.exists && p.initialized;
                if (!(p.exists && p.initialized)) {
                    const mp = marketPrice();
                    if (!$('#pl-init').value && mp > 0) $('#pl-init').value = String(+mp.toPrecision(6)).replace('.', ',');
                    info.innerHTML = `🆕 Este fundo ainda não existe nesta taxa. <b>Você vai criá-lo</b> com o preço inicial abaixo${mp > 0 ? ' (sugerido pelo preço de mercado)' : ''}. Preço errado = alguém compra barato de você na hora.`;
                } else {
                    info.textContent = `✅ Fundo encontrado. Preço agora: 1 ${A.symbol} = ${num(currentPrice())} ${B.symbol}.${p.liquidity < 1e6 ? ' ⚠️ Quase sem dinheiro dentro: rende pouco.' : ''}`;
                }
            } catch (e) { if (seq === st.seq) { info.textContent = 'Não deu para consultar o fundo agora.'; st.pool = null; } }
            applyWidth(); preview();
        };
        let pvTimer = null;
        const preview = () => {
            clearTimeout(pvTimer);
            pvTimer = setTimeout(async () => {
                const out = $('#pl-preview'); const go = $('#pl-go');
                go.disabled = true; st.plan = null;
                const A = metaOf($('#pl-a').value), B = metaOf($('#pl-b').value);
                const amt = num2($('#pl-amt').value);
                if (!st.pool || !(amt > 0)) { out.innerHTML = ''; return; }
                try {
                    const plan = await planMint({ chainId, tokenA: A, tokenB: B, fee: st.fee, fullRange: st.width === 'full', minPrice: num2($('#pl-min').value), maxPrice: num2($('#pl-max').value), amountA: amt, initialPrice: num2($('#pl-init').value), owner: W().getAddress() });
                    st.plan = plan;
                    // Saldo lido na rede (guardado por 15 s); o da lista pode estar atrasado logo depois de outra posição
                    await atualizarSaldosVivos(chainId, [A, B]);
                    const bal = (sym) => {
                        const meta = metaOf(sym);
                        const vivo = meta?.address && !meta.native && st.vivos[`${chainId}:${meta.address.toLowerCase()}`];
                        if (vivo && Date.now() - vivo.em < 15000) return vivo.v;
                        const ex = st.extras.find((t) => t.chainId === chainId && t.symbol === sym);
                        if (ex) return ex.saldo || 0;
                        return Number((W().getBalances() || []).find((b) => b.chainId === chainId && b.symbol === sym)?.amount || 0);
                    };
                    const needA = plan.m0.address.toLowerCase() === A.address.toLowerCase() ? plan.amt0 : plan.amt1;
                    const needB = plan.m0.address.toLowerCase() === A.address.toLowerCase() ? plan.amt1 : plan.amt0;
                    const haveA = bal($('#pl-a').value) + (A.native ? bal(A.symbol) : 0), haveB = bal($('#pl-b').value) + (B.native ? bal(B.symbol) : 0);
                    const short = (haveA + 1e-12 < needA) ? A : (haveB + 1e-12 < needB) ? B : null;
                    out.innerHTML = `<div class="pl-need"><span>Você coloca</span><strong>${num(needA)} ${esc($('#pl-a').value)} + ${num(needB)} ${esc($('#pl-b').value)}</strong><small class="money">${plan.usd > 0 ? '≈ ' + esc(brl(plan.usd)) : 'sem cotação para mostrar em reais'}</small></div>
                        ${plan.inRange ? '' : '<p class="warn-text">O preço de hoje está fora desta faixa: a posição começa parada (sem render) e entra com uma moeda só.</p>'}
                        ${plan.create ? '<p class="warn-text">Você vai criar este fundo. Confira o preço inicial com calma.</p>' : ''}
                        ${short ? `<p class="warn-text">Falta ${esc(short === A ? $('#pl-a').value : $('#pl-b').value)}: você tem ${num(short === A ? haveA : haveB)} e esta posição precisa de ${num(short === A ? needA : needB)}. Diminua a quantidade.</p>` : ''}`;
                    go.disabled = Boolean(short);
                } catch (e) { out.innerHTML = `<p class="warn-text">${esc(e.message)}</p>`; }
            }, 250);
        };
        fillTokens(); syms();
        $('#pl-back').onclick = () => open();
        $('#pl-chain').onchange = () => { chainId = Number($('#pl-chain').value); prefill = {}; fillTokens(); $('#pl-init').value = ''; loadPool(); };
        const aoEscolher = (lado) => () => {
            const sel = $(`#pl-${lado}`);
            if (sel.value === COLAR) {
                st.ladoColar = lado;
                $('#pl-colar-lado').textContent = lado.toUpperCase();
                $('#pl-colar').hidden = false;
                $('#pl-colar-msg').textContent = '';
                sel.value = st.anterior[lado];
                $('#pl-colar-end').focus();
                return;
            }
            st.anterior[lado] = sel.value;
            $('#pl-init').value = '';
            loadPool();
        };
        $('#pl-a').onchange = aoEscolher('a');
        $('#pl-b').onchange = aoEscolher('b');
        $('#pl-colar-ok').onclick = async () => {
            const msg = $('#pl-colar-msg');
            const end = $('#pl-colar-end').value.trim();
            if (!E().utils.isAddress(end)) { msg.textContent = 'Isso não é um contrato válido (começa com 0x e tem 42 caracteres).'; return; }
            msg.textContent = 'Lendo a moeda na blockchain…';
            try {
                const endereco = E().utils.getAddress(end);
                const ja = todos().find((t) => (t.address || '').toLowerCase() === endereco.toLowerCase());
                let simbolo;
                if (ja) simbolo = ja.symbol;
                else {
                    const m = await tokenMeta(chainId, endereco);
                    if (!(m.decimals >= 0 && m.decimals <= 36)) throw new Error('casas decimais inválidas');
                    simbolo = m.symbol || 'MOEDA';
                    if (todos().some((t) => t.symbol === simbolo)) simbolo = `${simbolo}·${endereco.slice(2, 6)}`; // não confunde com uma oficial
                    let saldo = 0;
                    try {
                        const c = new (E().Contract)(endereco, ABI.erc20, provider(chainId));
                        saldo = Number(E().utils.formatUnits(await c.balanceOf(W().address), m.decimals));
                    } catch (e) { /* sem saldo lido */ }
                    st.extras.push({ chainId, symbol: simbolo, address: endereco, decimals: m.decimals, isCustom: true, colada: true, saldo });
                }
                const lado = st.ladoColar;
                fillTokens(lado === 'a' ? simbolo : $('#pl-a').value, lado === 'b' ? simbolo : $('#pl-b').value);
                $('#pl-colar').hidden = true;
                $('#pl-colar-end').value = '';
                $('#pl-init').value = '';
                loadPool();
            } catch (e) {
                msg.textContent = 'Não consegui ler uma moeda nesse contrato nesta rede. Confira o endereço e a rede.';
            }
        };
        el.querySelectorAll('#pl-fees [data-fee]').forEach((b) => { b.onclick = () => { st.fee = Number(b.dataset.fee); $('#pl-init').value = ''; loadPool(); }; });
        el.querySelectorAll('#pl-widths [data-w]').forEach((b) => { b.onclick = () => { st.width = b.dataset.w; applyWidth(); preview(); }; });
        ['#pl-min', '#pl-max', '#pl-amt'].forEach((s) => $(s).addEventListener('input', preview));
        $('#pl-init').addEventListener('input', () => { applyWidth(); preview(); });
        $('#pl-go').onclick = async () => {
            const plan = st.plan;
            if (!plan) return;
            const A = metaOf($('#pl-a').value);
            const B = metaOf($('#pl-b').value);
            const aIs0 = plan.m0.address.toLowerCase() === A.address.toLowerCase();
            const needA = aIs0 ? plan.amt0 : plan.amt1, needB = aIs0 ? plan.amt1 : plan.amt0;
            const ok = await global.RdeskReceipt.confirm({
                title: plan.create ? 'Criar o fundo e abrir posição' : 'Abrir posição no fundo',
                sendVal: `${num(needA)} ${$('#pl-a').value} + ${num(needB)} ${$('#pl-b').value} (${REG().getChain(chainId).name})`,
                sendBrl: plan.usd > 0 ? brl(plan.usd) : 'sem cotação',
                recvVal: `Posição ${plan.m0.symbol}/${plan.m1.symbol} • faixa ${num(plan.min)} – ${num(plan.max)}`,
                recvBrl: plan.inRange ? 'rende enquanto o preço ficar na faixa' : 'começa fora da faixa (parada)',
                route: `Uniswap V3 oficial • taxa ${FEES.find((f) => f.fee === st.fee).label}${plan.create ? ' • fundo novo' : ''}`,
                fee: 'R$ 0,00 (sem taxa do app)',
                gas: `Paga em ${REG().getChain(chainId).native} na rede ${REG().getChain(chainId).name}`,
                shield: plan.create ? 'Fundo novo: o preço inicial é o que você definiu.' : 'Mínimo garantido: 95% do que foi calculado. Aprovação só do valor exato.'
            });
            if (!ok) return;
            const msg = $('#pl-msg');
            try {
                $('#pl-go').disabled = true;
                msg.textContent = 'Assinando… (pode pedir 2 a 4 confirmações: embrulhar, aprovar e abrir)';
                // Embrulha só o que falta (se já tem a versão embrulhada, usa ela)
                const balOf = (sym) => Number((W().getBalances() || []).find((b) => b.chainId === chainId && b.symbol === sym)?.amount || 0);
                const wrapNative = (A.native ? Math.max(0, needA - balOf(A.symbol)) : 0) + (B.native ? Math.max(0, needB - balOf(B.symbol)) : 0);
                const hash = await executeMint(plan, { wrapNative: wrapNative > 0 ? wrapNative * 1.000001 : 0 });
                msg.innerHTML = `✅ Posição aberta! <a href="${esc(REG().explorerTxUrl(chainId, hash))}" target="_blank" rel="noopener noreferrer">Ver transação ↗</a>`;
                global.dispatchEvent(new CustomEvent('rdesk:success', { detail: { text: 'Posição aberta: seu dinheiro já está trabalhando!' } }));
                W().refreshBalances?.();
                setTimeout(() => { if (msg.isConnected) open(); }, 1800); // só volta para a lista se a pessoa ainda estiver nesta tela
            } catch (e) { msg.textContent = `❌ ${e?.reason || e?.message || e}`.slice(0, 220); $('#pl-go').disabled = false; }
        };
        loadPool();
    }

    // Ligações da seção Fundos
    function ligar() {
        document.querySelectorAll('[data-fundos-aba]').forEach((b) => { b.onclick = () => mostrarAba(b.dataset.fundosAba); });
        document.getElementById('btn-fundos-atualizar')?.addEventListener('click', () => { lastList = []; renderLista(); });
        document.getElementById('btn-fundos-trocar')?.addEventListener('click', () => document.querySelector('.nav-tab-btn[data-tab="pixswap"]')?.click());
        document.querySelector('.nav-tab-btn[data-tab="earn"]')?.addEventListener('click', () => {
            const aba = document.querySelector('[data-fundos-aba][aria-selected="true"]')?.dataset.fundosAba || 'posicoes';
            if (aba === 'posicoes') renderLista();
        });
        global.addEventListener('rdesk:account-changed', () => { lastList = []; });
    }
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligar);
        else ligar();
    }

    global.RdeskPools = { withRpcs, open, openNew, mostrarAba, renderLista, planAdd, executeAdd, withdrawPart, listPositions, planMint, executeMint, collect, withdrawAll, poolInfo, UNI, WRAPPED, _math: { sqrtX96FromRaw, amountsFor, pairAmount, alignTick, tickFromRaw, rawFromHuman, humanFromRaw }, _last: () => lastList };
})(window);
