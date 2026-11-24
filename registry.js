/* =========================================================================
   RDESK SENTINEL — REGISTRO DE REDES E MOEDAS
   Fonte única de: redes suportadas, contratos oficiais de cada moeda,
   moedas personalizadas adicionadas pelo usuário, exploradores de blocos e
   os selos visuais (moeda + rede) usados em todo o app.
   ========================================================================= */
(function (global) {
    'use strict';

    const CUSTOM_KEY = 'rdesk_custom_tokens_v1';

    // Ordem = ordem de exibição
    const CHAINS = [
        { id: 137, key: 'polygon', name: 'Polygon', short: 'POL', color: '#8247e5', native: 'POL', explorer: 'https://polygonscan.com', llama: 'polygon', minTipGwei: 30,
          rpcs: ['https://polygon-bor-rpc.publicnode.com', 'https://1rpc.io/matic', 'https://polygon.drpc.org'] },
        { id: 1, key: 'ethereum', name: 'Ethereum', short: 'ETH', color: '#627eea', native: 'ETH', explorer: 'https://etherscan.io', llama: 'ethereum',
          rpcs: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'] },
        { id: 8453, key: 'base', name: 'Base', short: 'BASE', color: '#0052ff', native: 'ETH', explorer: 'https://basescan.org', llama: 'base',
          rpcs: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'] },
        { id: 42161, key: 'arbitrum', name: 'Arbitrum', short: 'ARB', color: '#28a0f0', native: 'ETH', explorer: 'https://arbiscan.io', llama: 'arbitrum',
          rpcs: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'] },
        { id: 10, key: 'optimism', name: 'Optimism', short: 'OP', color: '#ff0420', native: 'ETH', explorer: 'https://optimistic.etherscan.io', llama: 'optimism',
          rpcs: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'] },
        { id: 42220, key: 'celo', name: 'Celo', short: 'CELO', color: '#35d07f', native: 'CELO', explorer: 'https://celoscan.io', llama: 'celo',
          rpcs: ['https://forno.celo.org', 'https://celo.drpc.org'] },
        { id: 56, key: 'bnb', name: 'BNB Chain', short: 'BNB', color: '#f0b90b', native: 'BNB', explorer: 'https://bscscan.com', llama: 'bsc',
          rpcs: ['https://bsc-dataseed.bnbchain.org', 'https://bsc-rpc.publicnode.com', 'https://bsc.drpc.org'] },
        { id: 999, key: 'hyperevm', name: 'HyperEVM', short: 'HYPE', color: '#50e3c2', native: 'HYPE', explorer: 'https://hyperevmscan.io', llama: 'hyperliquid',
          rpcs: ['https://rpc.hyperliquid.xyz/evm', 'https://hyperliquid.drpc.org'] }
    ];

    // Rede Bitcoin (não é EVM: tratada pelo módulo bitcoin.js)
    const BITCOIN = { id: 'btc', key: 'bitcoin', name: 'Bitcoin', short: 'BTC', color: '#f7931a', native: 'BTC', explorer: 'https://mempool.space' };

    // priceKey: POL | ETH | BTC | CELO | USD | BRL (moedas pareadas) — define como o saldo vira R$
    const BUILTIN_TOKENS = {
        137: [
            { symbol: 'POL', name: 'POL (moeda da rede)', address: null, decimals: 18, isNative: true, priceKey: 'POL' },
            { symbol: 'WPOL', name: 'POL embrulhado', address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', decimals: 18, priceKey: 'POL' },
            { symbol: 'USDT', name: 'Tether USD (USDT0)', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6, priceKey: 'USD' },
            { symbol: 'USDC', name: 'USD Coin', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6, priceKey: 'USD' },
            { symbol: 'BRZ', name: 'Brazilian Digital Token', address: '0x4eD141110F6EeeAbA9A1df36d8c26f684d2475Dc', decimals: 18, priceKey: 'BRL' },
            { symbol: 'BRLA', name: 'BRLA Digital', address: '0xE6A537a407488807F0bbeb0038B79004f19DDDFb', decimals: 18, priceKey: 'BRL' },
            { symbol: 'WETH', name: 'Ether embrulhado', address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18, priceKey: 'ETH' },
            { symbol: 'WBTC', name: 'Bitcoin pareado (token, não é BTC nativo)', address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', decimals: 8, priceKey: 'BTC' }
        ],
        1: [
            { symbol: 'ETH', name: 'Ether (moeda da rede)', address: null, decimals: 18, isNative: true, priceKey: 'ETH' },
            { symbol: 'WETH', name: 'Ether embrulhado', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18, priceKey: 'ETH' },
            { symbol: 'USDT', name: 'Tether USD', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, priceKey: 'USD' },
            { symbol: 'USDC', name: 'USD Coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, priceKey: 'USD' },
            { symbol: 'WBTC', name: 'Bitcoin pareado (token, não é BTC nativo)', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8, priceKey: 'BTC' }
        ],
        8453: [
            { symbol: 'ETH', name: 'Ether (moeda da rede)', address: null, decimals: 18, isNative: true, priceKey: 'ETH' },
            { symbol: 'WETH', name: 'Ether embrulhado', address: '0x4200000000000000000000000000000000000006', decimals: 18, priceKey: 'ETH' },
            { symbol: 'USDC', name: 'USD Coin', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, priceKey: 'USD' },
            { symbol: 'BRZ', name: 'Brazilian Digital Token', address: '0xE9185Ee218cae427aF7B9764A011bb89FeA761B4', decimals: 18, priceKey: 'BRL' }
        ],
        42161: [
            { symbol: 'ETH', name: 'Ether (moeda da rede)', address: null, decimals: 18, isNative: true, priceKey: 'ETH' },
            { symbol: 'WETH', name: 'Ether embrulhado', address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18, priceKey: 'ETH' },
            { symbol: 'USDT', name: 'Tether USD', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6, priceKey: 'USD' },
            { symbol: 'USDC', name: 'USD Coin', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, priceKey: 'USD' },
            { symbol: 'WBTC', name: 'Bitcoin pareado (token, não é BTC nativo)', address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', decimals: 8, priceKey: 'BTC' }
        ],
        10: [
            { symbol: 'ETH', name: 'Ether (moeda da rede)', address: null, decimals: 18, isNative: true, priceKey: 'ETH' },
            { symbol: 'WETH', name: 'Ether embrulhado', address: '0x4200000000000000000000000000000000000006', decimals: 18, priceKey: 'ETH' },
            { symbol: 'USDT', name: 'Tether USD', address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6, priceKey: 'USD' },
            { symbol: 'USDC', name: 'USD Coin', address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6, priceKey: 'USD' }
        ],
        42220: [
            { symbol: 'CELO', name: 'Celo (moeda da rede)', address: null, decimals: 18, isNative: true, priceKey: 'CELO' },
            { symbol: 'USDT', name: 'Tether USD', address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', decimals: 6, priceKey: 'USD' },
            { symbol: 'USDC', name: 'USD Coin', address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', decimals: 6, priceKey: 'USD' },
            { symbol: 'BRLA', name: 'BRLA Digital', address: '0xFECB3F7c54E2CAAE9dC6Ac9060A822D47E053760', decimals: 18, priceKey: 'BRL' }
        ],
        999: [
            { symbol: 'HYPE', name: 'HYPE (moeda da rede Hyperliquid)', address: null, decimals: 18, isNative: true, priceKey: 'HYPE' },
            { symbol: 'USDT', name: 'Tether USD (USDT0)', address: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', decimals: 6, priceKey: 'USD' }
        ],
        56: [
            { symbol: 'BNB', name: 'BNB (moeda da rede)', address: null, decimals: 18, isNative: true, priceKey: 'BNB' },
            { symbol: 'USDT', name: 'Tether USD', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, priceKey: 'USD' },
            { symbol: 'USDC', name: 'USD Coin', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18, priceKey: 'USD' }
        ]
    };

    // Cores e glifos dos selos (letras e símbolos de moeda; não são logotipos oficiais)
    const TOKEN_STYLE = {
        BTC: { bg: '#f7931a', fg: '#1a1205', glyph: '₿' },
        WBTC: { bg: '#3b2a12', fg: '#f7931a', glyph: '₿' },
        ETH: { bg: '#627eea', fg: '#ffffff', glyph: 'Ξ' },
        WETH: { bg: '#232a4d', fg: '#9db1ff', glyph: 'Ξ' },
        POL: { bg: '#8247e5', fg: '#ffffff', glyph: 'P' },
        WPOL: { bg: '#2c1a52', fg: '#c7a8ff', glyph: 'P' },
        USDT: { bg: '#26a17b', fg: '#ffffff', glyph: '₮' },
        USDC: { bg: '#2775ca', fg: '#ffffff', glyph: '$' },
        BRZ: { bg: '#0f7a3d', fg: '#ffe14d', glyph: 'R$' },
        BRLA: { bg: '#f4c20d', fg: '#0d3b1e', glyph: 'R$' },
        CELO: { bg: '#fcff52', fg: '#1a1a05', glyph: 'C' },
        BNB: { bg: '#f0b90b', fg: '#1a1405', glyph: 'B' },
        DASH: { bg: '#008de4', fg: '#ffffff', glyph: 'D' },
        HYPE: { bg: '#0f3d36', fg: '#50e3c2', glyph: 'H' }
    };

    function esc(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function hashColor(text) {
        let h = 0;
        for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) % 360;
        return `hsl(${h}, 55%, 42%)`;
    }

    const DASH = { id: 'dash', key: 'dash', name: 'Dash', short: 'DASH', color: '#008de4', native: 'DASH', explorer: 'https://blockchair.com/dash' };
    function getChain(chainId) {
        if (chainId === 'btc') return BITCOIN;
        if (chainId === 'dash') return DASH;
        return CHAINS.find((c) => c.id === Number(chainId)) || null;
    }

    // ---------------------------------------------------------------- moedas personalizadas
    function loadCustomTokens() {
        try {
            const list = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
            return Array.isArray(list) ? list.filter((t) => t && getChain(t.chainId) && /^0x[0-9a-fA-F]{40}$/.test(t.address) && t.symbol && Number.isInteger(t.decimals)) : [];
        } catch (e) {
            return [];
        }
    }

    function saveCustomTokens(list) {
        localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
    }

    function getTokens(chainId) {
        const id = Number(chainId);
        const custom = loadCustomTokens().filter((t) => Number(t.chainId) === id).map((t) => ({
            symbol: t.symbol, name: t.name || t.symbol, address: t.address, decimals: t.decimals, priceKey: null, isCustom: true
        }));
        return [...(BUILTIN_TOKENS[id] || []), ...custom];
    }

    function findToken(chainId, symbolOrAddress) {
        const key = String(symbolOrAddress || '').toLowerCase();
        return getTokens(chainId).find((t) => t.symbol.toLowerCase() === key || (t.address && t.address.toLowerCase() === key)) || null;
    }

    // Lê símbolo, nome e casas decimais direto do contrato antes de aceitar a moeda.
    async function inspectTokenContract(chainId, address, provider) {
        if (!getChain(chainId) || chainId === 'btc') throw new Error('Rede não suportada.');
        if (!global.ethers.utils.isAddress(address)) throw new Error('Endereço de contrato inválido.');
        const checksummed = global.ethers.utils.getAddress(address);
        const code = await provider.getCode(checksummed);
        if (!code || code === '0x') throw new Error(`Não existe contrato neste endereço na rede ${getChain(chainId).name}. Confira a rede escolhida.`);
        const erc20 = new global.ethers.Contract(checksummed, [
            'function symbol() view returns (string)',
            'function name() view returns (string)',
            'function decimals() view returns (uint8)'
        ], provider);
        let symbol, decimals, name;
        try {
            [symbol, decimals] = await Promise.all([erc20.symbol(), erc20.decimals()]);
        } catch (e) {
            throw new Error('Este contrato não responde como uma moeda ERC-20 (sem símbolo ou casas decimais).');
        }
        try { name = await erc20.name(); } catch (e) { name = symbol; }
        symbol = String(symbol).trim().slice(0, 12);
        if (!symbol) throw new Error('O contrato não informa um símbolo.');
        return { chainId: Number(chainId), address: checksummed, symbol, name: String(name).trim().slice(0, 40), decimals: Number(decimals) };
    }

    function addCustomToken(token) {
        const chainId = Number(token.chainId);
        const address = global.ethers.utils.getAddress(token.address);
        const existing = getTokens(chainId).find((t) => t.address && t.address.toLowerCase() === address.toLowerCase());
        if (existing) throw new Error(`${existing.symbol} já está na lista da rede ${getChain(chainId).name}.`);
        let symbol = String(token.symbol).trim().slice(0, 12);
        // Símbolo repetido na mesma rede (ex.: um "USDT" falso) ganha sufixo para nunca se confundir com o oficial
        if (getTokens(chainId).some((t) => t.symbol.toLowerCase() === symbol.toLowerCase())) {
            symbol = `${symbol}-${address.slice(2, 6)}`;
        }
        const entry = { chainId, address, symbol, name: String(token.name || symbol).slice(0, 40), decimals: Number(token.decimals) };
        if (!Number.isInteger(entry.decimals) || entry.decimals < 0 || entry.decimals > 36) throw new Error('Casas decimais inválidas.');
        const list = loadCustomTokens();
        list.push(entry);
        saveCustomTokens(list);
        return { ...entry, priceKey: null, isCustom: true };
    }

    function removeCustomToken(chainId, address) {
        saveCustomTokens(loadCustomTokens().filter((t) => !(Number(t.chainId) === Number(chainId) && t.address.toLowerCase() === String(address).toLowerCase())));
    }

    // ---------------------------------------------------------------- exploradores
    function explorerTokenUrl(chainId, address) {
        const chain = getChain(chainId);
        return chain && address ? `${chain.explorer}/token/${address}` : null;
    }
    function explorerAddressUrl(chainId, address) {
        const chain = getChain(chainId);
        return chain ? `${chain.explorer}/address/${address}` : null;
    }
    function explorerTxUrl(chainId, hash) {
        const chain = getChain(chainId);
        if (chainId === 'dash') return `${DASH.explorer}/transaction/${hash}`;
        return chain ? `${chain.explorer}/tx/${hash}` : null;
    }

    // ---------------------------------------------------------------- selos visuais
    function tokenBadge(symbol, size = 34) {
        const base = String(symbol || '?').split('-')[0].toUpperCase();
        const style = TOKEN_STYLE[base] || { bg: hashColor(base), fg: '#ffffff', glyph: base.slice(0, 3) };
        const fontSize = Math.round(size * (style.glyph.length >= 3 ? 0.3 : style.glyph.length === 2 ? 0.38 : 0.5));
        return `<span class="coin-badge" aria-hidden="true" style="width:${size}px;height:${size}px;background:${style.bg};color:${style.fg};font-size:${fontSize}px;">${esc(style.glyph)}</span>`;
    }

    function chainBadge(chainId, withName = false) {
        const chain = getChain(chainId);
        if (!chain) return '';
        return `<span class="chain-badge" style="--chain-color:${chain.color};"><span class="chain-dot" aria-hidden="true"></span>${esc(withName ? chain.name : chain.short)}</span>`;
    }

    // Selo da moeda com o selo da rede no canto (ex.: USDT na Arbitrum)
    function tokenOnChainBadge(symbol, chainId, size = 34) {
        const chain = getChain(chainId);
        const dot = chain ? `<span class="coin-chain-dot" title="${esc(chain.name)}" style="background:${chain.color};"></span>` : '';
        return `<span class="coin-badge-wrap" style="width:${size}px;height:${size}px;">${tokenBadge(symbol, size)}${dot}</span>`;
    }

    // Maturidade de cada rede: o app incentiva guardar patrimônio onde o histórico é mais longo
    const MATURITY = {
        btc: { level: 'solid', since: 2009, label: 'A mais consolidada', note: 'Funciona sem parar desde 2009. É o lugar mais seguro para guardar patrimônio a longo prazo.' },
        1: { level: 'solid', since: 2015, label: 'Consolidada', note: 'Funciona desde 2015 e é a base de quase todo o ecossistema. Boa para guardar.' },
        137: { level: 'young', since: 2020, label: 'Rede jovem', note: 'Rede de 2020: barata e rápida, mas mais nova e mais centralizada. Já teve paradas e mudanças grandes. Use para movimentar, não para guardar tudo.' },
        8453: { level: 'young', since: 2023, label: 'Rede jovem', note: 'Rede de 2023, controlada por uma empresa (Coinbase). Prática, mas ainda nova. Use para movimentar, não para guardar tudo.' },
        42161: { level: 'young', since: 2021, label: 'Rede jovem', note: 'Rede de 2021 que depende da Ethereum e de um operador central. Prática, mas ainda nova.' },
        10: { level: 'young', since: 2021, label: 'Rede jovem', note: 'Rede de 2021 que depende da Ethereum e de um operador central. Prática, mas ainda nova.' },
        42220: { level: 'young', since: 2020, label: 'Rede jovem', note: 'Rede de 2020 com pouco uso e liquidez. Mais riscos que as redes grandes.' },
        999: { level: 'young', since: 2025, label: 'Rede jovem', note: 'Rede de 2025 da Hyperliquid, com poucos validadores ligados ao projeto. Nova e centralizada: use para movimentar, não para guardar.' },
        dash: { level: 'mid', since: 2014, label: 'Rede de 2014', note: 'Rede própria desde 2014, feita para pagamentos rápidos e baratos. Mais antiga que as redes novas, mas bem menor que o Bitcoin.' },
        56: { level: 'young', since: 2020, label: 'Rede jovem', note: 'Rede de 2020 ligada à corretora Binance, com poucos validadores. Muito usada e barata, mas centralizada. Use para movimentar, não para guardar tudo.' }
    };
    const maturity = (chainId) => MATURITY[chainId === 'btc' || chainId === 'BTC' ? 'btc' : chainId === 'dash' ? 'dash' : Number(chainId)] || { level: 'young', label: 'Rede jovem', note: 'Rede nova: mais riscos.' };
    function maturityBadge(chainId) {
        const m = maturity(chainId);
        return `<span class="net-tag ${m.level}" title="${esc(m.note)}">${m.level === 'solid' ? '🛡 ' : ''}${esc(m.label)}${m.since ? ` · desde ${m.since}` : ''}</span>`;
    }

    function shortAddress(address, head = 6, tail = 4) {
        const a = String(address || '');
        return a.length > head + tail + 3 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a;
    }

    // =====================================================================
    // TAXA DO CRIADOR — pronta e DESLIGADA. Para ligar: rateBps > 0 (100 = 1%) e as carteiras de destino.
    // Só vale onde o app agrega valor (trocas e Render). Nunca em enviar, receber ou Pix.
    // Limite máximo fixo de 1%; sempre aparece no recibo antes de confirmar.
    // =====================================================================
    const CREATOR_FEE = Object.freeze({
        rateBps: 0,          // ex.: 20 = 0,2%
        evmAddress: '',      // sua carteira 0x… (recebe nas trocas da Uniswap e no Render)
        lifiIntegrator: 'rdesk-sentinel' // nas rotas da LI.FI a taxa vai para a carteira cadastrada no portal deles para este nome
    });
    const MAX_CREATOR_BPS = 100;
    function creatorFee() {
        // Testes automáticos podem injetar uma configuração antes do app carregar (nunca fica salva)
        const c = Object.assign({}, CREATOR_FEE, global.__RDESK_CREATOR_FEE_TEST__ || {});
        const rateBps = Math.floor(Number(c.rateBps) || 0);
        const okAddr = Boolean(c.evmAddress && global.ethers?.utils.isAddress(c.evmAddress));
        const active = rateBps > 0 && rateBps <= MAX_CREATOR_BPS && okAddr;
        return { active, rateBps: active ? rateBps : 0, rate: active ? rateBps / 10000 : 0, evmAddress: okAddr ? global.ethers.utils.getAddress(c.evmAddress) : '', lifiIntegrator: c.lifiIntegrator };
    }

    // =====================================================================
    // COMPRAR COM PIX (Mercado Pago) — pronto e DESLIGADO.
    // Para ligar: publique o servidor em server/ (Cloudflare Worker) e coloque o endereço dele aqui.
    // =====================================================================
    const PIX_BUY = Object.freeze({ endpoint: '' }); // ex.: 'https://rdesk-pix.SEU-USUARIO.workers.dev'
    const pixBuyEndpoint = () => String(global.__RDESK_PIX_BUY_TEST__ || PIX_BUY.endpoint || '').replace(/\/$/, '');

    // Valores em reais do jeito brasileiro: "1.234,56", "R$ 10", "0,5"
    function parseBRL(text) {
        let s = String(text || '').replace(/R\$|\s/g, '');
        if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');           // 1.234,56
        else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');        // 1.234 = mil duzentos e trinta e quatro
        return /^\d*\.?\d+$/.test(s) ? Number(s) : null;                          // 10.50 = dez e cinquenta
    }
    // Quantidade de moeda equivalente a um valor em reais (texto com ponto, sem zeros sobrando)
    function coinFromBrl(brl, unitUsd, usdBrl, decimals) {
        if (!(brl > 0) || !(unitUsd > 0) || !(usdBrl > 0)) return '';
        const places = Math.min(Number(decimals) || 8, 8);
        return (brl / (unitUsd * usdBrl)).toFixed(places).replace(/\.?0+$/, '');
    }

    global.RdeskRegistry = {
        CHAINS, BITCOIN, BUILTIN_TOKENS,
        getChain, getTokens, findToken,
        loadCustomTokens, inspectTokenContract, addCustomToken, removeCustomToken,
        explorerTokenUrl, explorerAddressUrl, explorerTxUrl,
        tokenBadge, chainBadge, tokenOnChainBadge, shortAddress, esc, maturity, maturityBadge, creatorFee, MAX_CREATOR_BPS, parseBRL, coinFromBrl, pixBuyEndpoint
    };
})(window);
