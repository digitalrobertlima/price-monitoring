/* =========================================================================
   RDESK — FICHA DE CADA MOEDA
   Cada moeda tem a sua história: o Bitcoin existe desde 2009, o Ether
   desde 2015 — mas um token que roda NA rede Ethereum não herda essa idade.
   Aqui cada moeda tem o seu ano, quem emite, o que garante o valor e se
   pode ser congelada. Para moedas adicionadas pela pessoa, o app busca a
   data em que o contrato foi publicado na blockchain.
   ========================================================================= */
(function (global) {
    'use strict';

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // since = ano em que a MOEDA começou (não a rede onde ela roda)
    const FACTS = {
        BTC: { name: 'Bitcoin', since: 2009, solid: true, cg: 'bitcoin', kind: 'Moeda própria, sem dono', backing: 'Ninguém emite: 21 milhões no máximo, regra fixa no código.', freeze: 'Ninguém consegue congelar. Só quem tem as palavras move.' },
        ETH: { name: 'Ether', since: 2015, solid: true, cg: 'ethereum', kind: 'Moeda da rede Ethereum', backing: 'Ninguém emite por conta própria: as regras da rede definem a emissão.', freeze: 'Ninguém consegue congelar o ETH da sua carteira.' },
        WETH: { name: 'Ether embrulhado', since: 2017, cg: 'ethereum', kind: 'Token que representa ETH', backing: '1 WETH = 1 ETH guardado no contrato.', freeze: 'O contrato não tem botão de congelar.' },
        USDT: { name: 'Tether (dólar digital)', since: 2014, cg: 'tether', kind: 'Dólar digital de empresa', backing: 'A Tether diz guardar títulos do governo americano, ouro e bitcoin.', freeze: 'A Tether PODE congelar qualquer carteira.' },
        USDT0: { name: 'Tether (USDT0)', since: 2025, cg: 'tether', kind: 'Dólar digital de empresa (versão entre redes)', backing: 'Mesmo lastro do USDT da Tether.', freeze: 'Pode ser congelado pela emissora.' },
        USDC: { name: 'USD Coin (dólar digital)', since: 2018, cg: 'usd-coin', kind: 'Dólar digital de empresa', backing: 'A Circle guarda dinheiro e títulos do governo americano.', freeze: 'A Circle PODE congelar qualquer carteira.' },
        'USDC.E': { name: 'USDC de ponte (antigo)', since: 2020, cg: 'usd-coin', kind: 'Dólar digital trazido por ponte', backing: 'USDC guardado na ponte.', freeze: 'Pode ser congelado.' },
        DAI: { name: 'Dai', since: 2019, cg: 'dai', kind: 'Dólar digital de protocolo', backing: 'Garantido por outras criptomoedas depositadas no protocolo Sky/Maker.', freeze: 'O DAI em si não tem congelamento, mas boa parte da garantia é USDC.' },
        BNB: { name: 'BNB', since: 2017, cg: 'binancecoin', kind: 'Moeda da rede BNB Chain', backing: 'Criada pela corretora Binance.', freeze: 'A rede tem poucos validadores ligados à Binance.' },
        POL: { name: 'POL (antigo MATIC)', since: 2019, cg: 'polygon-ecosystem-token', kind: 'Moeda da rede Polygon', backing: 'Emitida pelas regras da rede Polygon (MATIC de 2019, virou POL em 2024).', freeze: 'Não tem congelamento.' },
        WPOL: { name: 'POL embrulhado', since: 2020, cg: 'polygon-ecosystem-token', kind: 'Token que representa POL', backing: '1 WPOL = 1 POL guardado no contrato.', freeze: 'Não tem congelamento.' },
        BRZ: { name: 'BRZ (real digital)', since: 2019, cg: 'brz', kind: 'Real digital de empresa', backing: 'A Transfero diz guardar reais em títulos públicos brasileiros.', freeze: 'A emissora pode congelar.' },
        BRLA: { name: 'BRLA (real digital)', since: 2022, cg: 'brla-digital-brla', kind: 'Real digital de empresa', backing: 'A BRLA Digital diz guardar reais em conta e títulos.', freeze: 'A emissora pode congelar.' },
        BRLS: { name: 'Real Soberano (BRLS)', since: 2026, kind: 'Real digital de protocolo, sem empresa no meio', backing: 'Cada BRLS tem 1 real em BRZ, BRLA ou BRL1 guardado na Reserva, ou garantia em cripto no cofre. Dá para trocar de volta 1 por 1 a qualquer hora. Contratos ainda sem auditoria externa.', freeze: 'O contrato do BRLS não tem botão de congelar, bloquear nem pausar o resgate. As moedas de lastro (BRZ, BRLA, BRL1) têm emissoras que podem congelar.' },
        WBTC: { name: 'Bitcoin embrulhado (WBTC)', since: 2019, cg: 'wrapped-bitcoin', kind: 'Token que representa BTC', backing: 'BTC guardado por uma empresa custodiante (BitGo e parceiros).', freeze: 'Depende da custodiante: não é Bitcoin de verdade.' },
        CBBTC: { name: 'Bitcoin da Coinbase (cbBTC)', since: 2024, cg: 'coinbase-wrapped-btc', kind: 'Token que representa BTC', backing: 'BTC guardado pela Coinbase.', freeze: 'A Coinbase pode congelar.' },
        CELO: { name: 'Celo', since: 2020, cg: 'celo', kind: 'Moeda da rede Celo', backing: 'Emitida pelas regras da rede Celo.', freeze: 'Não tem congelamento.' },
        HYPE: { name: 'HYPE (Hyperliquid)', since: 2024, cg: 'hyperliquid', kind: 'Moeda da Hyperliquid, corretora descentralizada com rede própria', backing: 'Nada garante o preço: vale o que o mercado paga. Parte das taxas da corretora recompra HYPE.', freeze: 'A rede é nova e tem poucos validadores ligados ao projeto.' },
        DASH: { name: 'Dash', since: 2014, cg: 'dash', kind: 'Moeda da rede Dash, feita para pagamentos', backing: 'Ninguém emite por conta própria: regras da rede, com teto de cerca de 18,9 milhões.', freeze: 'Ninguém consegue congelar. Só quem tem as palavras move.' },
        AAVE: { name: 'Aave', since: 2020, cg: 'aave', kind: 'Token de protocolo de empréstimos', backing: 'Nada garante o preço: vale o que o mercado paga.', freeze: 'O contrato não tem congelamento, mas pode ser atualizado pela governança.' }
    };
    const NATIVE_HOME = { BTC: 'btc', DASH: 'dash', ETH: 1, BNB: 56, POL: 137, CELO: 42220, HYPE: 999 };

    // Exploradores Blockscout (gratuitos, sem cadastro) que dizem quando cada contrato foi criado
    const BLOCKSCOUT = { 1: 'https://eth.blockscout.com', 137: 'https://polygon.blockscout.com', 8453: 'https://base.blockscout.com', 42161: 'https://arbitrum.blockscout.com', 10: 'https://optimism.blockscout.com', 42220: 'https://celo.blockscout.com' };
    const CACHE_KEY = 'rdesk_contract_info_v1';
    let cache = {};
    try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (e) {}
    const saveCache = () => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) {} };
    const ck = (chainId, address) => `${chainId}:${String(address || '').toLowerCase()}`;

    function factsFor(symbol) { return FACTS[String(symbol || '').toUpperCase()] || null; }
    const isNativeHere = (symbol, chainId) => NATIVE_HOME[String(symbol || '').toUpperCase()] !== undefined && String(NATIVE_HOME[String(symbol).toUpperCase()]) === String(chainId);

    const inflight = {};
    async function contractInfo(chainId, address, { force = false } = {}) {
        if (!address) return null;
        const k = ck(chainId, address);
        // Sem a data (o explorador falhou), tenta de novo depois de 10 min — não guarda o erro por horas
        if (!force && cache[k] && (cache[k].created || cache[k].unavailable || Date.now() - (cache[k].at || 0) < 10 * 60 * 1000)) return cache[k];
        if (global.RdeskAnon?.isOn?.()) return cache[k] || null; // modo anônimo: não pergunta a ninguém
        const host = BLOCKSCOUT[Number(chainId)];
        if (!host) { cache[k] = { at: Date.now(), unavailable: true }; saveCache(); return cache[k]; }
        if (inflight[k]) return inflight[k];
        inflight[k] = (async () => {
            const out = { at: Date.now() };
            try {
                const get = async (u) => { const r = await fetch(u); return r.ok ? r.json() : null; };
                const [addr, tok] = await Promise.all([get(`${host}/api/v2/addresses/${address}`), get(`${host}/api/v2/tokens/${address}`)]);
                const h = addr?.creation_transaction_hash || addr?.creation_tx_hash;
                if (h) {
                    const tx = await get(`${host}/api/v2/transactions/${h}`);
                    const ts = tx?.timestamp ? Math.floor(new Date(tx.timestamp).getTime() / 1000) : 0;
                    if (ts > 1.2e9 && ts < Date.now() / 1000 + 86400) out.created = ts;
                }
                const holders = Number(tok?.holders_count ?? tok?.holders);
                if (Number.isFinite(holders)) out.holders = holders;
                if (addr && addr.is_verified !== undefined) out.verified = Boolean(addr.is_verified);
            } catch (e) { out.error = true; }
            cache[k] = out; saveCache();
            return out;
        })();
        try { return await inflight[k]; } finally { delete inflight[k]; }
    }
    const fmtMonth = (unix) => new Date(unix * 1000).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '');
    const ageYears = (unix) => (Date.now() / 1000 - unix) / (365.25 * 86400);

    // Selo curto para a lista de moedas
    function tag(b) {
        const sym = String(b.symbol || '').toUpperCase();
        const f = factsFor(sym);
        if (isNativeHere(sym, b.chainId) && f?.solid) return `<span class="asset-tag solid" data-info="${esc(`${f.name} funciona desde ${f.since}. ${f.freeze}`)}">🛡 ${sym === 'BTC' ? 'A mais consolidada' : 'Consolidada'} · desde ${f.since}</span>`;
        if (b.isCustom || !f) {
            const c = cache[ck(b.chainId, b.address)];
            if (c?.created) {
                const young = ageYears(c.created) < 1;
                return `<span class="asset-tag ${young ? 'warn' : ''}" data-info="${esc(`Contrato desta moeda publicado em ${new Date(c.created * 1000).toLocaleDateString('pt-BR')}. ${young ? 'Tem menos de 1 ano: cuidado redobrado.' : ''}`)}">contrato de ${esc(fmtMonth(c.created))}</span>`;
            }
            return `<span class="asset-tag muted" data-info="Moeda adicionada por você. O app ainda não conseguiu confirmar a data do contrato.">adicionada por você</span>`;
        }
        return `<span class="asset-tag" data-info="${esc(`${f.name}: existe desde ${f.since}. ${f.freeze}`)}">desde ${f.since}</span>`;
    }

    // Busca em segundo plano as datas que faltam e redesenha a lista
    let warmTimer = null;
    function warm(balances, onDone) {
        clearTimeout(warmTimer);
        warmTimer = setTimeout(async () => {
            const need = (balances || []).filter((b) => b.address && (b.isCustom || !factsFor(b.symbol)) && !cache[ck(b.chainId, b.address)]);
            if (!need.length) return;
            await Promise.all(need.slice(0, 6).map((b) => contractInfo(b.chainId, b.address)));
            onDone && onDone();
        }, 800);
    }

    // Ficha completa (tela da moeda)
    async function fill(box, { symbol, chainId, address, isCustom, priceConfidence }) {
        if (!box) return;
        const f = factsFor(symbol);
        const chain = global.RdeskRegistry?.getChain?.(chainId);
        const net = global.RdeskRegistry?.maturity?.(chainId);
        const rows = [];
        const native = isNativeHere(symbol, chainId);
        if (f && !isCustom) {
            rows.push(['O que é', f.kind]);
            rows.push(['Existe desde', String(f.since)]);
            rows.push(['O que garante o valor', f.backing]);
            rows.push(['Pode ser congelada?', f.freeze]);
        }
        if (chainId !== 'btc') rows.push(['Rede', `${chain?.name || chainId}${net?.since ? ` (rede de ${net.since})` : ''}${native ? '' : ' — a idade da rede não é a idade desta moeda'}`]);
        if (priceConfidence !== undefined && priceConfidence < 0.9) rows.push(['Cotação', '⚠️ Incerta: pouca negociação. Fica fora do total da carteira.']);
        const paint = (extra = []) => {
            box.innerHTML = `<h3 class="view-subtitle">Ficha da moeda</h3><dl class="asset-facts">${[...rows, ...extra].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
        };
        paint(address && !native ? [['Contrato publicado em', 'buscando…']] : []);
        if (!address || native) return;
        const c = await contractInfo(chainId, address);
        const extra = [];
        if (c?.created) {
            const y = ageYears(c.created);
            extra.push(['Contrato publicado em', `${new Date(c.created * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}${y < 1 ? ' (menos de 1 ano: cuidado)' : ''}`]);
        } else extra.push(['Contrato publicado em', c?.unavailable ? 'esta rede não tem explorador gratuito para conferir' : 'não foi possível conferir agora']);
        if (c?.holders) extra.push(['Carteiras que têm esta moeda', c.holders.toLocaleString('pt-BR')]);
        if (c && c.verified === false) extra.push(['Código do contrato', '⚠️ Não publicado (não dá para conferir o que ele faz)']);
        paint(extra);
    }

    global.RdeskAssetInfo = { FACTS, factsFor, tag, warm, fill, contractInfo, coingeckoId: (s) => factsFor(s)?.cg || null, _cache: () => cache };
})(window);
