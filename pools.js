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
        if (plan.params.amount0Desired.gt(0)) await approveExact(signer, chainId, plan.params.token0, nfpmAddr, plan.params.amount0Desired);
        if (plan.params.amount1Desired.gt(0)) await approveExact(signer, chainId, plan.params.token1, nfpmAddr, plan.params.amount1Desired);
        const nfpm = new (E().Contract)(nfpmAddr, ABI.nfpm, signer);
        const I = iface('nfpm');
        const calls = [];
        if (plan.create) calls.push(I.encodeFunctionData('createAndInitializePoolIfNecessary', [plan.params.token0, plan.params.token1, plan.params.fee, plan.create.sqrtPriceX96]));
        calls.push(I.encodeFunctionData('mint', [plan.params]));
        const tx = calls.length === 1 ? await nfpm.mint(plan.params) : await nfpm.multicall(calls);
        await W().confirmTx(tx, chainId);
        return tx.hash;
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
    async function open() {
        const owner = W()?.getAddress?.();
        const el = sheet(`
            <div class="mk-top"><h2>Fundos de troca</h2><button type="button" class="icon-btn" data-close aria-label="Fechar">✕</button></div>
            <p class="muted-sm">Seu dinheiro trabalha em qualquer rede, com qualquer par de moedas. O app fala direto com os contratos oficiais da Uniswap: você não precisa abrir outro site.</p>
            <button type="button" class="btn-primary" id="pl-new">＋ Abrir uma posição nova</button>
            <h3 class="view-subtitle">Suas posições em todas as redes</h3>
            <div id="pl-list" class="pl-list"><div class="skeleton-row"></div><div class="skeleton-row"></div></div>`);
        if (!el) return;
        el.querySelector('#pl-new').onclick = () => openNew();
        const box = el.querySelector('#pl-list');
        if (!owner) { box.innerHTML = '<div class="empty-state">Abra uma carteira para ver e abrir posições.</div>'; return; }
        const list = await listPositions(owner).catch(() => []);
        lastList = list;
        if (!box.isConnected) return;
        if (!list.length) { box.innerHTML = '<div class="empty-state">Nenhuma posição ainda. Toque em "Abrir uma posição nova".</div>'; return; }
        // Encerradas e sem nada para colher ficam guardadas numa dobra (não poluem a lista)
        const isOld = (p) => p.closed && !(p.fees0 > 0 || p.fees1 > 0);
        const card = (p, i) => `
            <div class="pl-card ${p.closed ? 'closed' : p.inRange ? 'in' : 'out'}">
                <div class="pl-head">${REG().tokenBadge(p.token0.symbol, 28)}${REG().tokenBadge(p.token1.symbol, 28)}
                    <strong>${esc(p.token0.symbol)} / ${esc(p.token1.symbol)}</strong>
                    <span class="pl-fee">${esc(FEES.find((f) => f.fee === p.fee)?.label || p.fee)}</span>
                    ${REG().chainBadge(p.chainId)}</div>
                <div class="pl-status">${p.closed ? '⚪ Encerrada' : p.inRange ? '🟢 Rendendo' : '🟠 Fora da faixa: parou de render'}</div>
                <div class="pl-grid">
                    <div><span>Valor</span><strong class="money">${p.priced ? esc(brl(p.usd)) : `${num(p.amount0)} ${esc(p.token0.symbol)} + ${num(p.amount1)} ${esc(p.token1.symbol)}`}</strong></div>
                    <div><span>Ganhos para colher</span><strong class="money">${p.priced ? esc(brl(p.feesUsd)) : `${num(p.fees0)} + ${num(p.fees1)}`}</strong></div>
                    <div class="wide"><span>Faixa (${esc(p.token1.symbol)} por ${esc(p.token0.symbol)})</span><strong>${num(p.min)} – ${num(p.max)} · agora ${num(p.price)}</strong></div>
                </div>
                <div class="two-btn-row">
                    <button type="button" class="btn-soft" data-collect="${i}" ${p.feesUsd > 0 || p.fees0 > 0 || p.fees1 > 0 ? '' : 'disabled'}>Colher ganhos</button>
                    <button type="button" class="btn-soft" data-exit="${i}" ${p.closed && !(p.fees0 > 0 || p.fees1 > 0) ? 'disabled' : ''}>Tirar tudo</button>
                </div>
                <div class="pl-msg" data-msg="${i}" role="status"></div>
            </div>`;
        const active = list.map((p, i) => [p, i]).filter(([p]) => !isOld(p));
        const old = list.map((p, i) => [p, i]).filter(([p]) => isOld(p));
        box.innerHTML = (active.length ? active.map(([p, i]) => card(p, i)).join('') : '<div class="empty-state">Nenhuma posição aberta agora.</div>')
            + (old.length ? `<details class="more-fold"><summary>Encerradas (${old.length})</summary><div class="fold-content pl-list">${old.map(([p, i]) => card(p, i)).join('')}</div></details>` : '');
        const run = async (i, kind) => {
            const p = list[i];
            const msg = box.querySelector(`[data-msg="${i}"]`);
            const ok = await global.RdeskReceipt.confirm({
                title: kind === 'collect' ? 'Colher ganhos' : 'Tirar tudo do fundo',
                sendVal: `${p.token0.symbol}/${p.token1.symbol} na ${REG().getChain(p.chainId).name}`,
                sendBrl: p.priced ? brl(kind === 'collect' ? p.feesUsd : p.usd + p.feesUsd) : '',
                recvVal: kind === 'collect' ? `${num(p.fees0)} ${p.token0.symbol} + ${num(p.fees1)} ${p.token1.symbol}` : `~${num(p.amount0 + p.fees0)} ${p.token0.symbol} + ~${num(p.amount1 + p.fees1)} ${p.token1.symbol}`,
                recvBrl: p.priced ? brl(kind === 'collect' ? p.feesUsd : p.usd + p.feesUsd) : '',
                route: 'Uniswap V3 (contrato oficial, direto do app)',
                fee: 'R$ 0,00 (sem taxa do app)',
                gas: `Paga em ${REG().getChain(p.chainId).native} na rede ${REG().getChain(p.chainId).name}`,
                shield: kind === 'collect' ? 'Só os ganhos saem; a posição continua rendendo.' : `Mínimo garantido: 95% do valor de hoje. As moedas voltam para a sua carteira.`
            });
            if (!ok) return;
            try {
                msg.textContent = 'Assinando…';
                const hash = kind === 'collect' ? await collect(p) : await withdrawAll(p);
                msg.innerHTML = `✓ Feito. <a href="${esc(REG().explorerTxUrl(p.chainId, hash))}" target="_blank" rel="noopener noreferrer">Ver transação ↗</a>`;
                global.dispatchEvent(new CustomEvent('rdesk:success', { detail: { text: kind === 'collect' ? 'Ganhos colhidos!' : 'Dinheiro tirado do fundo!' } }));
                W().refreshBalances?.();
            } catch (e) { msg.textContent = `❌ ${e?.reason || e?.message || e}`.slice(0, 200); }
        };
        box.querySelectorAll('[data-collect]').forEach((b) => { b.onclick = () => run(Number(b.dataset.collect), 'collect'); });
        box.querySelectorAll('[data-exit]').forEach((b) => { b.onclick = () => run(Number(b.dataset.exit), 'exit'); });
    }

    function tokensFor(chainId) {
        const list = (REG().getTokens(chainId) || []).filter((t) => t.address || t.isNative);
        return list.map((t) => (t.isNative ? { ...t, wrapOf: WRAPPED[chainId] } : t));
    }
    function openNew(prefill = {}) {
        const chains = Object.keys(UNI).map(Number);
        let chainId = prefill.chainId && UNI[prefill.chainId] ? prefill.chainId : 137;
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
        const st = { fee: 3000, width: '8', pool: null, plan: null, seq: 0, extras: [], ladoColar: 'a', anterior: { a: '', b: '' } };
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
                    const bal = (sym) => {
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
                        ${short ? `<p class="warn-text">Falta ${esc(short === A ? $('#pl-a').value : $('#pl-b').value)} na carteira para essa quantidade.</p>` : ''}`;
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

    global.RdeskPools = { withRpcs, open, openNew, listPositions, planMint, executeMint, collect, withdrawAll, poolInfo, UNI, WRAPPED, _math: { sqrtX96FromRaw, amountsFor, pairAmount, alignTick, tickFromRaw, rawFromHuman, humanFromRaw }, _last: () => lastList };
})(window);
