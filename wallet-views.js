/* =========================================================================
   RDESK SENTINEL — TELAS DE RECEBER, ENVIAR, MOEDA E ADICIONAR MOEDA
   Várias redes (Polygon, Ethereum, Base, Arbitrum, Optimism, Celo) e Bitcoin
   nativo. Sempre mostra o contrato da moeda para conferência antes de enviar.
   ========================================================================= */
(function (global) {
    'use strict';

    const REG = global.RdeskRegistry;
    const W = () => global.RdeskWallet;
    const BTC = () => global.RdeskBitcoin;
    const esc = REG.esc;
    const ERC20 = [
        'function balanceOf(address) view returns (uint256)',
        'function transfer(address to, uint256 amount) returns (bool)'
    ];

    const fmtAmount = (n, max = 8) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: max });
    const normChain = (v) => (v === 'btc' || v === 'BTC' ? 'btc' : v === 'dash' || v === 'DASH' ? 'dash' : Number(v));

    function networksFor(acc) {
        const list = REG.CHAINS.map((c) => c.id);
        if (acc && (acc.type === 'seed' || acc.type === 'pk')) { list.unshift('btc'); if (acc.dashAddress) list.splice(1, 0, 'dash'); } // Bitcoin primeiro
        return list;
    }
    function tokensFor(chainId) {
        if (chainId === 'btc') return [{ symbol: 'BTC', name: 'Bitcoin', address: null, decimals: 8, isNative: true, priceKey: 'BTC' }];
        if (chainId === 'dash') return [{ symbol: 'DASH', name: 'Dash', address: null, decimals: 8, isNative: true, priceKey: 'DASH' }];
        return REG.getTokens(chainId);
    }
    function balanceOf(ctx, chainId, symbol) {
        const row = ctx.getBalances().find((b) => String(b.chainId) === String(chainId) && b.symbol === symbol);
        return row ? row.amount : 0;
    }
    function contractLine(chainId, token) {
        if (chainId === 'btc') return '<span class="contract-native">Bitcoin on-chain (não é contrato; não aceita Lightning)</span>';
        if (chainId === 'dash') return '<span class="contract-native">Dash na rede própria (não é contrato). Endereços começam com X.</span>';
        if (!token || !token.address) return `<span class="contract-native">Moeda nativa da rede ${esc(REG.getChain(chainId).name)} (sem contrato)</span>`;
        return `
            <span class="contract-label">Contrato${token.isCustom ? ' (moeda adicionada por você)' : ' oficial'}</span>
            <code class="contract-code" data-contract>${esc(token.address)}</code>
            <span class="contract-actions">
                <button type="button" class="mini-link-btn" data-copy-contract="${esc(token.address)}">Copiar</button>
                <a class="mini-link-btn" href="${esc(REG.explorerTokenUrl(chainId, token.address))}" target="_blank" rel="noopener noreferrer">Conferir no explorador ↗</a>
            </span>`;
    }
    function bindCopyButtons(sheet, ctx) {
        sheet.querySelectorAll('[data-copy-contract]').forEach((btn) => {
            btn.onclick = async () => {
                await ctx.copy(btn.getAttribute('data-copy-contract'));
                const old = btn.textContent;
                btn.textContent = '✓ Copiado';
                setTimeout(() => { btn.textContent = old; }, 1500);
            };
        });
    }
    function header(title) {
        return `
            <div class="rmw-header">
                <div class="rmw-title">${title}</div>
                <button class="rmw-icon-btn" id="rmw-close-btn" aria-label="Fechar">✕</button>
            </div>`;
    }
    // Explica, em uma frase, quão consolidada é a rede (Bitcoin e Ethereum x redes jovens)
    function riskNote(chainId) {
        const m = REG.maturity(chainId);
        return `<div class="net-risk ${m.level}" data-net-risk="${esc(m.level)}">${REG.maturityBadge(chainId)}<span>${esc(m.note)}</span></div>`;
    }
    function chipsHtml(networks, selected) {
        return `<div class="net-chips" role="tablist">${networks.map((id) => `
            <button type="button" role="tab" class="net-chip${String(id) === String(selected) ? ' active' : ''}" data-net="${esc(id)}" aria-selected="${String(id) === String(selected)}">
                ${REG.chainBadge(id, true)}
            </button>`).join('')}</div>`;
    }

    // =====================================================================
    // RECEBER
    // =====================================================================
    function renderReceive(sheet, ctx) {
        const acc = ctx.getActiveAccount();
        if (!acc) { ctx.navigate('add'); return; }
        const networks = networksFor(acc);
        let chainId = normChain(ctx.params.chainId || 137);
        if (!networks.some((n) => String(n) === String(chainId))) chainId = 137;
        const chain = REG.getChain(chainId);
        const isBtc = chainId === 'btc';
        // Bitcoin: um endereço novo a cada recebimento (quem te paga não vê os seus outros pagamentos)
        const isDash = chainId === 'dash';
        const address = isBtc ? (ctx.btcReceiveAddress?.() || acc.btcAddress || '') : isDash ? (acc.dashAddress || '') : acc.address;

        sheet.innerHTML = `
            ${header('↓ Receber')}
            <button type="button" class="pix-cta" id="rmw-rec-pix"><span>💸</span><span><strong>Receber em reais por Pix</strong><small>Cai direto no seu banco, só com a sua chave</small></span></button>
            <div class="view-hint">Ou receba moedas digitais. Escolha a rede por onde vão te enviar:</div>
            ${chipsHtml(networks, chainId)}
            ${address ? `
            <div class="receive-box">
                <div class="receive-qr"><div id="rmw-rec-qr"></div></div>
                <div class="receive-net">${REG.chainBadge(chainId, true)} ${REG.maturityBadge(chainId)}</div>
                <code class="receive-address" id="rmw-rec-address">${esc(address)}</code>
                <button class="rmw-btn-primary" id="rmw-rec-copy">📋 Copiar endereço</button>
                ${isBtc && acc.type === 'seed' ? '<button type="button" class="rmw-btn-secondary" id="rmw-rec-new">🔄 Gerar endereço novo</button><small class="muted-sm rec-fresh">🕵️ Este endereço muda sozinho depois que receber. Assim quem te paga não vê seus outros pagamentos nem o seu saldo.</small>' : ''}
            </div>
            <div class="rec-ask">
                <label class="rmw-label" for="rmw-rec-brl">Quer pedir um valor? Digite em reais</label>
                <div class="brl-field"><span>R$</span><input type="text" inputmode="decimal" class="rmw-input" id="rmw-rec-brl" placeholder="0,00" autocomplete="off"></div>
                <select class="rmw-select" id="rmw-rec-coin" aria-label="Moeda que você quer receber">
                    ${tokensFor(chainId).map((t) => `<option value="${esc(t.symbol)}">${esc(t.symbol)}</option>`).join('')}
                </select>
                <div class="rec-ask-out" id="rmw-rec-ask"></div>
            </div>
            <div class="rmw-alert-warn" id="rmw-rec-warning">
                ${isDash ? 'Envie <strong>somente DASH pela rede Dash</strong>. Este endereço não recebe outras moedas.' : isBtc
                    ? 'Envie <strong>somente Bitcoin pela rede Bitcoin (on-chain)</strong>. Este endereço não recebe por Lightning nem por outras redes.'
                    : `Envie <strong>somente pela rede ${esc(chain.name)}</strong>. Se a corretora mandar por outra rede, o dinheiro pode se perder.`}
            </div>
            ${riskNote(chainId)}` : `
            <div class="rmw-alert-warn">Desbloqueie o cofre uma vez para gerar o seu endereço Bitcoin.</div>`}
            <div class="view-subtitle">Moedas que este app mostra nesta rede</div>
            <div class="token-list" id="rmw-rec-tokens">
                ${tokensFor(chainId).map((t) => `
                    <div class="token-line">
                        ${REG.tokenBadge(t.symbol, 28)}
                        <span class="token-line-name"><strong>${esc(t.symbol)}</strong><small>${esc(t.name || '')}</small></span>
                        ${t.address
                            ? `<button type="button" class="token-line-contract" data-copy-contract="${esc(t.address)}" title="Copiar contrato">${esc(REG.shortAddress(t.address, 8, 6))}</button>`
                            : '<span class="token-line-native">nativa</span>'}
                    </div>`).join('')}
            </div>`;

        sheet.querySelector('#rmw-close-btn').onclick = ctx.close;
        sheet.querySelector('#rmw-rec-pix').onclick = () => ctx.navigate('pix');
        sheet.querySelectorAll('[data-net]').forEach((b) => { b.onclick = () => ctx.navigate('receive', { chainId: b.getAttribute('data-net') }); });
        if (address) {
            ctx.drawQr(sheet.querySelector('#rmw-rec-qr'), address, 190);
            const nb = sheet.querySelector('#rmw-rec-new');
            if (nb) nb.onclick = async () => {
                try { await ctx.newBitcoinAddress(); ctx.navigate('receive', { chainId: 'btc' }); }
                catch (e) { nb.textContent = e.message; }
            };
            sheet.querySelector('#rmw-rec-copy').onclick = async () => {
                await ctx.copy(address);
                sheet.querySelector('#rmw-rec-copy').textContent = '✓ Endereço copiado';
            };
            // Pedir um valor em reais: mostra quanto da moeda pedir (no Bitcoin, o valor vai junto no QR)
            const askOut = sheet.querySelector('#rmw-rec-ask');
            let lastAsk = '';
            const updateAsk = () => {
                const brl = REG.parseBRL(sheet.querySelector('#rmw-rec-brl').value);
                const t = tokensFor(chainId).find((x) => x.symbol === sheet.querySelector('#rmw-rec-coin').value) || tokensFor(chainId)[0];
                const unit = W().unitUsdFor(t.priceKey, chainId, t.address);
                const coin = REG.coinFromBrl(brl, unit, ctx.prices().usdBrl, t.decimals);
                const qrText = isBtc && coin ? `bitcoin:${address}?amount=${coin}` : address;
                if (qrText !== lastAsk) { lastAsk = qrText; ctx.drawQr(sheet.querySelector('#rmw-rec-qr'), qrText, 190); }
                if (!brl) { askOut.textContent = ''; return; }
                if (!coin) { askOut.textContent = 'Sem cotação agora para converter.'; return; }
                askOut.innerHTML = `Peça para enviarem <strong>${esc(coin.replace('.', ','))} ${esc(t.symbol)}</strong> (≈ ${esc(ctx.formatBRL(brl))}) pela rede ${esc(chain.name)}.${isBtc ? ' O valor já vai junto no QR Code.' : ''} <button type="button" class="btn-text small" id="rmw-rec-copyask">Copiar pedido</button>`;
                sheet.querySelector('#rmw-rec-copyask').onclick = () => ctx.copy(`Me envie ${coin.replace('.', ',')} ${t.symbol} (≈ ${ctx.formatBRL(brl)}) pela rede ${chain.name} para:\n${address}`);
            };
            sheet.querySelector('#rmw-rec-brl').addEventListener('input', updateAsk);
            sheet.querySelector('#rmw-rec-coin').addEventListener('change', updateAsk);
        }
        bindCopyButtons(sheet, ctx);
    }

    // =====================================================================
    // RECEBER EM REAIS POR PIX (QR Code estático, sem cadastro nem API)
    // =====================================================================
    const PIX_KEY = 'rdesk_pix_v1';
    const loadPix = () => { try { return JSON.parse(localStorage.getItem(PIX_KEY) || 'null'); } catch (e) { return null; } };
    function renderPix(sheet, ctx) {
        const P = global.RdeskPix;
        const saved = loadPix() || {};
        const sel = (v) => (saved.type || 'doc') === v ? ' selected' : '';
        sheet.innerHTML = `
            ${header('💸 Receber por Pix')}
            <div class="view-hint">O dinheiro cai <strong>direto na sua conta do banco</strong>, como qualquer Pix. Não precisa de cadastro: é só a sua chave.</div>
            <label class="rmw-label" for="rmw-pix-type">Tipo da chave</label>
            <select class="rmw-select" id="rmw-pix-type">
                <option value="doc"${sel('doc')}>CPF ou CNPJ</option>
                <option value="phone"${sel('phone')}>Celular</option>
                <option value="email"${sel('email')}>E-mail</option>
                <option value="random"${sel('random')}>Chave aleatória</option>
            </select>
            <label class="rmw-label" for="rmw-pix-key">Sua chave Pix</label>
            <input class="rmw-input" id="rmw-pix-key" autocomplete="off" value="${esc(saved.raw || '')}" placeholder="Ex.: 000.000.000-00">
            <label class="rmw-label" for="rmw-pix-name">Seu nome (aparece para quem paga)</label>
            <input class="rmw-input" id="rmw-pix-name" maxlength="25" value="${esc(saved.name || '')}" placeholder="Ex.: Maria Silva">
            <label class="rmw-label" for="rmw-pix-city">Cidade</label>
            <input class="rmw-input" id="rmw-pix-city" maxlength="15" value="${esc(saved.city || '')}" placeholder="Ex.: Belo Horizonte">
            <label class="rmw-label" for="rmw-pix-amt">Valor (opcional)</label>
            <input class="rmw-input" id="rmw-pix-amt" inputmode="decimal" placeholder="Deixe vazio para quem paga digitar">
            <label class="rmw-label" for="rmw-pix-desc">Descrição (opcional)</label>
            <input class="rmw-input" id="rmw-pix-desc" maxlength="40" placeholder="Ex.: pastel e caldo de cana">
            <label class="toggle-inline"><input type="checkbox" id="rmw-pix-save" ${saved.raw ? 'checked' : ''}> Lembrar minha chave neste aparelho</label>
            <div id="rmw-pix-msg"></div>
            <button class="rmw-btn-primary" id="rmw-pix-go">Gerar QR Code do Pix</button>
            <div id="rmw-pix-out" style="display:none">
                <div class="receive-box">
                    <div class="receive-qr"><div id="rmw-pix-qr"></div></div>
                    <div class="receive-net" id="rmw-pix-summary"></div>
                    <code class="receive-address" id="rmw-pix-code"></code>
                    <button class="rmw-btn-primary" id="rmw-pix-copy">📋 Copiar Pix Copia e Cola</button>
                </div>
                <div class="rmw-alert-warn">O app <strong>não fica sabendo</strong> se o Pix foi pago. Confira sempre no app do seu banco antes de entregar o produto.</div>
            </div>
            ${saved.raw ? '<button class="btn-text small" id="rmw-pix-forget">Esquecer minha chave deste aparelho</button>' : ''}`;
        sheet.querySelector('#rmw-close-btn').onclick = ctx.close;
        const $ = (s) => sheet.querySelector(s);
        const placeholders = { doc: 'Ex.: 000.000.000-00', phone: 'Ex.: (31) 99999-9999', email: 'Ex.: voce@email.com', random: 'Cole a chave do app do banco' };
        $('#rmw-pix-type').onchange = () => { $('#rmw-pix-key').placeholder = placeholders[$('#rmw-pix-type').value]; };
        $('#rmw-pix-type').onchange();
        const msg = (text) => { $('#rmw-pix-msg').innerHTML = text ? `<div class="rmw-alert-err">${esc(text)}</div>` : ''; };
        $('#rmw-pix-go').onclick = () => {
            msg('');
            try {
                const type = $('#rmw-pix-type').value;
                const raw = $('#rmw-pix-key').value.trim();
                const key = P.normalizeKey(type, raw);
                const name = $('#rmw-pix-name').value.trim();
                if (!name) throw new Error('Digite seu nome.');
                const city = $('#rmw-pix-city').value.trim();
                const amtTxt = $('#rmw-pix-amt').value.trim();
                const amount = amtTxt ? REG.parseBRL(amtTxt) : undefined;
                if (amtTxt && !(amount > 0)) throw new Error('Valor inválido. Exemplos: 25 ou 25,50');
                const code = P.buildPayload({ key, name, city, amount, description: $('#rmw-pix-desc').value.trim() });
                if ($('#rmw-pix-save').checked) localStorage.setItem(PIX_KEY, JSON.stringify({ type, raw, name, city }));
                else localStorage.removeItem(PIX_KEY);
                $('#rmw-pix-out').style.display = '';
                $('#rmw-pix-qr').replaceChildren();
                ctx.drawQr($('#rmw-pix-qr'), code, 190);
                $('#rmw-pix-code').textContent = code;
                $('#rmw-pix-summary').textContent = `${amount ? ctx.formatBRL(amount) : 'Valor livre'} • para ${name}`;
                $('#rmw-pix-copy').textContent = '📋 Copiar Pix Copia e Cola';
                $('#rmw-pix-copy').onclick = async () => { await ctx.copy(code); $('#rmw-pix-copy').textContent = '✓ Copiado'; };
                $('#rmw-pix-out').scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (err) { msg(err.message); }
        };
        const forget = $('#rmw-pix-forget');
        if (forget) forget.onclick = () => { localStorage.removeItem(PIX_KEY); ctx.navigate('pix'); };
    }

    // =====================================================================
    // COMPRAR COM PIX: manda um Pix, recebe BRZ (real digital) na carteira
    // =====================================================================
    let pixBuyPoll = null;
    function renderBuyPix(sheet, ctx) {
        clearInterval(pixBuyPoll);
        const endpoint = REG.pixBuyEndpoint();
        const acc = W().getActiveAccount();
        if (!endpoint) {
            sheet.innerHTML = `${header('💸 Comprar com Pix')}
                <div class="pb-soon">
                    <div class="pixbuy-art big" aria-hidden="true"><span class="pb-pix">PIX</span><span class="pb-arrow">➜</span><span class="pb-coin">₿</span></div>
                    <h2>Em breve!</h2>
                    <p>Você vai poder comprar cripto <b>só mandando um Pix</b>, do jeito que já está acostumado.</p>
                    <div class="ks-rules"><span>1️⃣ Escolhe o valor</span><span>2️⃣ Paga o Pix</span><span>3️⃣ Cai na carteira</span></div>
                    <p class="muted-sm">Enquanto isso: peça para alguém te enviar cripto em <b>Receber</b>.</p>
                </div>`;
            sheet.querySelector('#rmw-close-btn').onclick = ctx.close;
            return;
        }
        if (!acc) { ctx.navigate('add'); return; }
        sheet.innerHTML = `${header('💸 Comprar com Pix')}
            <div class="pb-flow" id="pb-step-amount">
                <div class="pixbuy-art big" aria-hidden="true"><span class="pb-pix">PIX</span><span class="pb-arrow">➜</span><span class="pb-coin">R$</span></div>
                <p class="ks-sub" style="margin:0;">Você manda um Pix e recebe <b>BRZ</b>, o real digital (1 BRZ = R$ 1), na sua carteira.</p>
                <div class="pb-chips">${[20, 50, 100, 200].map((v) => `<button type="button" class="chip" data-pb-amt="${v}">R$ ${v}</button>`).join('')}</div>
                <div class="brl-field"><span>R$</span><input type="text" inputmode="decimal" class="rmw-input" id="pb-amount" placeholder="0,00"></div>
                <div class="pb-receive" id="pb-receive"></div>
                <div id="pb-msg"></div>
                <button class="rmw-btn-primary ks-cta" id="pb-go">Gerar o Pix</button>
                <p class="view-footnote">Cai em: ${esc(REG.shortAddress(acc.address, 8, 6))} (${esc(acc.name || 'sua carteira')}) • rede Polygon</p>
            </div>
            <div class="pb-flow" id="pb-step-pay" hidden>
                <div class="receive-box">
                    <div class="receive-qr"><div id="pb-qr"></div></div>
                    <div class="receive-net" id="pb-summary"></div>
                    <code class="receive-address" id="pb-code"></code>
                    <button class="rmw-btn-primary" id="pb-copy">📋 Copiar Pix Copia e Cola</button>
                </div>
                <div class="pb-status" id="pb-status"><span class="pb-dot"></span><span id="pb-status-text">Esperando o pagamento…</span></div>
            </div>`;
        sheet.querySelector('#rmw-close-btn').onclick = () => { clearInterval(pixBuyPoll); ctx.close(); };
        const $ = (s) => sheet.querySelector(s);
        let cfg = { minBrl: 10, maxBrl: 500, feeBps: 0 };
        fetch(`${endpoint}/pix/config`).then((r) => r.json()).then((c) => { cfg = { ...cfg, ...c }; showReceive(); }).catch(() => {});
        const amount = () => REG.parseBRL($('#pb-amount').value);
        const showReceive = () => {
            const a = amount();
            $('#pb-receive').textContent = a ? `Você recebe ≈ ${(a * (1 - (cfg.feeBps || 0) / 10000)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BRZ${cfg.feeBps ? ` (taxa de ${(cfg.feeBps / 100).toLocaleString('pt-BR')}%)` : ''}` : `De R$ ${cfg.minBrl} a R$ ${cfg.maxBrl} por compra`;
        };
        sheet.querySelectorAll('[data-pb-amt]').forEach((b) => { b.onclick = () => { $('#pb-amount').value = b.getAttribute('data-pb-amt'); showReceive(); }; });
        $('#pb-amount').addEventListener('input', showReceive);
        showReceive();
        $('#pb-go').onclick = async () => {
            const a = amount();
            const msg = (text) => { $('#pb-msg').innerHTML = text ? `<div class="rmw-alert-err">${esc(text)}</div>` : ''; };
            if (!a || a < cfg.minBrl || a > cfg.maxBrl) return msg(`Escolha um valor entre R$ ${cfg.minBrl} e R$ ${cfg.maxBrl}.`);
            msg('');
            $('#pb-go').disabled = true; $('#pb-go').textContent = 'Gerando o Pix…';
            try {
                const res = await fetch(`${endpoint}/pix/order`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amountBrl: a, address: acc.address }) });
                const order = await res.json();
                if (!res.ok || !order.pixCode) throw new Error(order.error || 'Não deu para gerar o Pix agora.');
                // Confere o Pix antes de mostrar (código válido e valor certo)
                const parsed = global.RdeskPix.parsePayload(order.pixCode);
                if (parsed.amount !== null && Math.abs(parsed.amount - a) > 0.001) throw new Error('O valor do Pix não confere. Tente de novo.');
                $('#pb-step-amount').hidden = true;
                $('#pb-step-pay').hidden = false;
                ctx.drawQr($('#pb-qr'), order.pixCode, 190);
                $('#pb-code').textContent = order.pixCode;
                $('#pb-summary').textContent = `${ctx.formatBRL(a)} • você recebe ${Number(order.receive).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} BRZ`;
                $('#pb-copy').onclick = async () => { await ctx.copy(order.pixCode); $('#pb-copy').textContent = '✓ Copiado! Agora pague no app do banco'; };
                const setStatus = (cls, text) => { $('#pb-status').className = `pb-status ${cls}`; $('#pb-status-text').textContent = text; };
                pixBuyPoll = setInterval(async () => {
                    try {
                        const s = await (await fetch(`${endpoint}/pix/order/${encodeURIComponent(order.orderId)}`)).json();
                        if (s.status === 'approved') setStatus('paid', 'Pix recebido! As moedas estão a caminho da sua carteira.');
                        if (s.status === 'delivered') {
                            clearInterval(pixBuyPoll);
                            setStatus('done', `Pronto! ${Number(s.receive).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} BRZ chegaram na sua carteira.`);
                            global.dispatchEvent(new CustomEvent('rdesk:success', { detail: { text: 'Sua primeira compra com Pix chegou!' } }));
                            W().refreshBalances?.();
                        }
                        if (s.status === 'expired') { clearInterval(pixBuyPoll); setStatus('expired', 'Este Pix expirou. Gere outro quando quiser.'); }
                    } catch (e) { /* tenta de novo no próximo ciclo */ }
                }, 4000);
            } catch (err) {
                msg(err.message);
                $('#pb-go').disabled = false; $('#pb-go').textContent = 'Gerar o Pix';
            }
        };
    }

    // =====================================================================
    // ENVIAR
    // =====================================================================
    function renderSend(sheet, ctx) {
        const acc = ctx.getActiveAccount();
        if (!acc) { ctx.navigate('add'); return; }
        const networks = networksFor(acc);
        let chainId = normChain(ctx.params.chainId || 137);
        if (!networks.some((n) => String(n) === String(chainId))) chainId = 137;
        const isBtc = chainId === 'btc';
        const isDash = chainId === 'dash';
        const tokens = tokensFor(chainId);
        let token = tokens.find((t) => t.symbol === ctx.params.symbol) || tokens[0];
        const prefill = { to: ctx.params.to || '', amount: ctx.params.amount || '' };

        sheet.innerHTML = `
            ${header('↑ Enviar')}
            <label class="rmw-label" for="rmw-snd-chain">Rede</label>
            <select class="rmw-select" id="rmw-snd-chain">
                ${networks.map((id) => `<option value="${esc(id)}"${String(id) === String(chainId) ? ' selected' : ''}>${esc(REG.getChain(id).name)}</option>`).join('')}
            </select>

            <label class="rmw-label" for="rmw-snd-token">Moeda</label>
            <div class="send-token-row">
                <span id="rmw-snd-badge">${REG.tokenOnChainBadge(token.symbol, chainId, 40)}</span>
                <select class="rmw-select" id="rmw-snd-token">
                    ${tokens.map((t) => `<option value="${esc(t.symbol)}"${t.symbol === token.symbol ? ' selected' : ''}>${esc(t.symbol)} — saldo ${fmtAmount(balanceOf(ctx, chainId, t.symbol))}</option>`).join('')}
                </select>
            </div>
            <div class="contract-box" id="rmw-snd-contract">${contractLine(chainId, token)}</div>

            <label class="rmw-label" for="rmw-snd-to">Endereço de destino${isBtc ? ' (bc1…, 1… ou 3…)' : isDash ? ' (X…)' : ' (0x…)'}</label>
            <div class="input-with-actions">
                <input type="text" class="rmw-input" id="rmw-snd-to" placeholder="${isBtc ? 'bc1q…' : isDash ? 'X…' : '0x…'}" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(prefill.to)}">
                <button type="button" class="rmw-icon-btn" id="rmw-snd-paste" title="Colar" aria-label="Colar endereço">📋</button>
                <button type="button" class="rmw-icon-btn" id="rmw-snd-scan" title="Ler QR Code" aria-label="Ler QR Code">📷</button>
            </div>

            <label class="rmw-label" for="rmw-snd-brl">Valor em reais</label>
            <div class="brl-field"><span>R$</span><input type="text" inputmode="decimal" class="rmw-input" id="rmw-snd-brl" placeholder="0,00" autocomplete="off"></div>
            <label class="rmw-label" for="rmw-snd-amt">ou quantidade em ${esc(token.symbol)}</label>
            <div class="input-with-actions">
                <input type="text" inputmode="decimal" class="rmw-input" id="rmw-snd-amt" placeholder="0,00" autocomplete="off" value="${esc(prefill.amount)}">
                <button type="button" class="rmw-btn-secondary send-max-btn" id="rmw-snd-max">Máx</button>
            </div>
            <div class="send-fiat" id="rmw-snd-fiat"></div>

            ${isBtc ? `
            <label class="rmw-label" for="rmw-snd-fee">Velocidade (taxa da rede Bitcoin)</label>
            <select class="rmw-select" id="rmw-snd-fee"><option value="">Buscando taxas…</option></select>` : ''}

            <div id="rmw-snd-msg"></div>
            <button class="rmw-btn-primary" id="rmw-snd-exec">Revisar e enviar</button>
            <p class="view-footnote">Envios em blockchain não têm estorno. Confira rede, moeda e endereço.</p>`;

        const $ = (id) => sheet.querySelector(id);
        const msgBox = $('#rmw-snd-msg');
        const showErr = (text) => { msgBox.innerHTML = `<div class="rmw-alert-err">${esc(text)}</div>`; };
        const showOk = (html) => { msgBox.innerHTML = `<div class="rmw-alert-ok">${html}</div>`; };
        const parseAmount = () => {
            const txt = $('#rmw-snd-amt').value.trim().replace(/\s/g, '').replace(',', '.');
            return /^\d*\.?\d+$/.test(txt) ? txt : null;
        };
        const keep = () => ({ chainId, symbol: token.symbol, to: $('#rmw-snd-to').value.trim(), amount: $('#rmw-snd-amt').value.trim() });

        $('#rmw-close-btn').onclick = ctx.close;
        $('#rmw-snd-chain').onchange = () => ctx.navigate('send', { ...keep(), chainId: $('#rmw-snd-chain').value, symbol: undefined, to: '', amount: '' });
        $('#rmw-snd-token').onchange = () => ctx.navigate('send', { ...keep(), symbol: $('#rmw-snd-token').value });
        bindCopyButtons(sheet, ctx);

        // Reais <-> moeda: digita em qualquer um dos dois e o outro acompanha
        const unitNow = () => W().unitUsdFor(token.priceKey, chainId, token.address);
        const updateFiat = () => {
            const amt = parseAmount();
            const unit = unitNow();
            const brl = amt && unit > 0 ? Number(amt) * unit * ctx.prices().usdBrl : 0;
            if (document.activeElement !== $('#rmw-snd-brl')) $('#rmw-snd-brl').value = brl > 0 ? brl.toFixed(2).replace('.', ',') : '';
            $('#rmw-snd-fiat').textContent = unit > 0 ? `1 ${token.symbol} ≈ ${ctx.formatBRL(unit * ctx.prices().usdBrl)}` : 'Sem cotação agora: digite a quantidade da moeda.';
        };
        $('#rmw-snd-amt').addEventListener('input', updateFiat);
        $('#rmw-snd-brl').addEventListener('input', () => {
            const coin = REG.coinFromBrl(REG.parseBRL($('#rmw-snd-brl').value), unitNow(), ctx.prices().usdBrl, token.decimals);
            $('#rmw-snd-amt').value = coin ? coin.replace('.', ',') : '';
        });
        $('#rmw-snd-brl').addEventListener('blur', updateFiat);
        updateFiat();

        $('#rmw-snd-paste').onclick = async () => {
            try { $('#rmw-snd-to').value = (await navigator.clipboard.readText()).trim(); } catch (e) { showErr('O navegador não liberou a área de transferência. Cole manualmente no campo.'); }
        };

        $('#rmw-snd-scan').onclick = async () => {
            const text = await global.RdeskQrScanner.scan({ title: 'Ler endereço de destino' });
            if (text === null) return;
            const p = global.RdeskQrScanner.parsePayload(text);
            if (p.kind === 'lightning') return showErr('Este QR é um pedido Lightning. O app envia Bitcoin on-chain e moedas das redes listadas; Lightning ainda não é suportado.');
            if (p.kind === 'dash') {
                if (!networks.includes('dash')) return showErr('Este QR é de um endereço Dash, mas esta carteira ainda não tem Dash (destranque o cofre uma vez).');
                if (!isDash) return ctx.navigate('send', { chainId: 'dash', to: p.address, amount: p.amount || '' });
                $('#rmw-snd-to').value = p.address;
                if (p.amount) { $('#rmw-snd-amt').value = p.amount; updateFiat(); }
                return;
            }
            if (p.kind === 'bitcoin') {
                if (!networks.includes('btc')) return showErr('Este QR é de um endereço Bitcoin, mas esta carteira não tem Bitcoin (use uma carteira criada ou importada no app).');
                if (!isBtc) return ctx.navigate('send', { chainId: 'btc', to: p.address, amount: p.amount || '' });
                $('#rmw-snd-to').value = p.address;
                if (p.amount) { $('#rmw-snd-amt').value = p.amount; updateFiat(); }
                return;
            }
            if (p.kind === 'evm') {
                // Cobrança de uma moeda específica: já escolhe essa moeda (se o app conhece o contrato)
                if (p.tokenAddress) {
                    const cid = p.chainId && REG.getChain(p.chainId) ? p.chainId : chainId;
                    const tok = (REG.getTokens(cid) || []).find((t) => t.address && t.address.toLowerCase() === p.tokenAddress.toLowerCase());
                    if (!tok) return showErr('Este QR pede uma moeda que o app não conhece nesta rede. Adicione a moeda antes ou confira com quem cobrou.');
                    if (cid !== chainId || tok.symbol !== token.symbol) return ctx.navigate('send', { ...keep(), chainId: cid, symbol: tok.symbol, to: p.address });
                    $('#rmw-snd-to').value = p.address;
                    return;
                }
                if (isBtc) return ctx.navigate('send', { chainId: p.chainId && REG.getChain(p.chainId) ? p.chainId : 137, to: p.address });
                if (p.chainId && p.chainId !== chainId && REG.getChain(p.chainId)) return ctx.navigate('send', { ...keep(), chainId: p.chainId, symbol: undefined, to: p.address });
                $('#rmw-snd-to').value = p.address;
                return;
            }
            showErr('O QR lido não é um endereço de carteira.');
        };

        // ---------------------------------------------------------------- Bitcoin
        let feeRates = null;
        if (isBtc) {
            BTC().fetchFeeRates().then((r) => {
                feeRates = r;
                const sel = $('#rmw-snd-fee');
                if (!sel) return;
                // Taxa típica de um envio (1 entrada, destino + troco) já em reais, para escolher sabendo quanto custa
                const vs = BTC().estimateVsize(1, ['p2wpkh', 'p2wpkh']);
                const reais = (rate) => {
                    const p = ctx.prices();
                    return p.BTC && p.usdBrl ? ` ≈ ${ctx.formatBRL((rate * vs / 1e8) * p.BTC * p.usdBrl)}` : '';
                };
                sel.innerHTML = `
                    <option value="${r.normal}">Normal — ~30 min${reais(r.normal)} (${r.normal} sat/vB)</option>
                    <option value="${r.fast}">Rápida — próximo bloco${reais(r.fast)} (${r.fast} sat/vB)</option>
                    <option value="${r.slow}">Econômica — horas${reais(r.slow)} (${r.slow} sat/vB)</option>`;
            }).catch(() => {
                const sel = $('#rmw-snd-fee');
                if (sel) sel.innerHTML = '<option value="">Taxas indisponíveis agora</option>';
            });
        }

        $('#rmw-snd-max').onclick = async () => {
            msgBox.replaceChildren();
            try {
                if (isDash) {
                    const D = global.RdeskDash;
                    const utxos = await D.fetchUtxos(acc.dashAddress);
                    const dest = D.isAddress($('#rmw-snd-to').value.trim()) ? $('#rmw-snd-to').value.trim() : acc.dashAddress;
                    const plan = D.plan({ utxos, toAddress: dest, changeAddress: acc.dashAddress, max: true });
                    $('#rmw-snd-amt').value = (plan.amount / 1e8).toFixed(8);
                } else if (isBtc) {
                    const rate = Number($('#rmw-snd-fee').value);
                    if (!rate) throw new Error('Aguarde as taxas da rede carregarem.');
                    const utxos = await ctx.gatherBitcoinUtxos();
                    const dest = BTC().isValidAddress($('#rmw-snd-to').value.trim()) ? $('#rmw-snd-to').value.trim() : acc.btcAddress;
                    const plan = BTC().planTransaction({ utxos, toAddress: dest, feeRate: rate, changeAddress: ctx.btcChangeAddress(), sendMax: true });
                    $('#rmw-snd-amt').value = (plan.amount / 1e8).toFixed(8);
                } else if (token.isNative) {
                    const provider = await ctx.getHealthyProvider(chainId);
                    const [bal, fee] = await Promise.all([provider.getBalance(acc.address), provider.getFeeData()]);
                    const perGas = fee.maxFeePerGas || fee.gasPrice;
                    const floor = global.ethers.utils.parseUnits(String(REG.getChain(chainId).minTipGwei || 0), 'gwei');
                    // Folga para a taxa deste envio: gás estimado pela própria rede (em L2 passa de 21000) x 2,
                    // com um piso que cobre a parcela de publicação na Ethereum (Base/Optimism).
                    const toTxt = $('#rmw-snd-to').value.trim();
                    const probeTo = global.ethers.utils.isAddress(toTxt) ? toTxt : acc.address;
                    let gas = global.ethers.BigNumber.from(21000);
                    try { const est = await provider.estimateGas({ from: acc.address, to: probeTo, value: 1 }); if (est.gt(gas)) gas = est; } catch (e) {}
                    let reserve = perGas.add(floor).mul(gas).mul(2);
                    const minReserve = global.ethers.utils.parseUnits('0.00002', 18);
                    if (reserve.lt(minReserve)) reserve = minReserve;
                    const max = bal.sub(reserve);
                    if (max.lte(0)) throw new Error('Saldo insuficiente para cobrir a taxa da rede.');
                    $('#rmw-snd-amt').value = global.ethers.utils.formatUnits(max, 18);
                } else {
                    const provider = await ctx.getHealthyProvider(chainId);
                    const raw = await new global.ethers.Contract(token.address, ERC20, provider).balanceOf(acc.address);
                    $('#rmw-snd-amt').value = global.ethers.utils.formatUnits(raw, token.decimals);
                }
                updateFiat();
            } catch (err) {
                showErr(err.message || 'Não foi possível calcular o máximo.');
            }
        };

        $('#rmw-snd-exec').onclick = async () => {
            const btn = $('#rmw-snd-exec');
            msgBox.replaceChildren();
            const to = $('#rmw-snd-to').value.trim();
            const amtStr = parseAmount();
            try {
                if (!amtStr || !(Number(amtStr) > 0)) throw new Error('Informe uma quantidade válida.');

                if (isDash) {
                    const D = global.RdeskDash;
                    D.decodeAddress(to); // erro claro se não for endereço Dash
                    const duffs = Math.round(Number(amtStr) * 1e8);
                    btn.disabled = true;
                    showOk('Lendo saldo disponível…');
                    const utxos = await D.fetchUtxos(acc.dashAddress);
                    const total = utxos.reduce((n, u) => n + u.value, 0);
                    const plan = D.plan({ utxos, toAddress: to, amountDuffs: duffs, changeAddress: acc.dashAddress, max: duffs >= total });
                    const brl = (d) => ctx.formatBRL((d / 1e8) * (ctx.prices().DASH || 0) * ctx.prices().usdBrl);
                    if (!confirm(`Enviar ${(plan.amount / 1e8).toFixed(8)} DASH (${brl(plan.amount)}) pela rede Dash para:\n\n${to}\n\nTaxa da rede: ${plan.fee} duffs (${brl(plan.fee)})\n\nConfira o endereço inteiro. Este envio não pode ser desfeito.`)) { msgBox.replaceChildren(); btn.disabled = false; return; }
                    const key = ctx.getDashKey();
                    const signed = D.sign(plan, key.privateKey);
                    showOk('Transmitindo para a rede Dash…');
                    const txid = await D.broadcast(signed.hex);
                    global.dispatchEvent(new CustomEvent('rdesk:success', { detail: { text: 'Dash enviado!' } }));
                    showOk(`✅ Dash enviado! <a href="${esc(REG.explorerTxUrl('dash', txid))}" target="_blank" rel="noopener noreferrer">Ver transação ↗</a>`);
                    ctx.refreshBalances();
                    return;
                }
                if (isBtc) {
                    BTC().addressToScript(to); // lança erro claro se não for endereço Bitcoin válido
                    const rate = Number($('#rmw-snd-fee').value);
                    if (!rate) throw new Error('Taxas da rede Bitcoin indisponíveis. Tente de novo em instantes.');
                    const sats = Math.round(Number(amtStr) * 1e8);
                    btn.disabled = true;
                    showOk('Lendo saldo disponível…');
                    // Moedas de todos os endereços do cofre; o troco vai para um endereço novo (troco)
                    const utxos = await ctx.gatherBitcoinUtxos();
                    const spendable = utxos.filter((u) => u.confirmed).reduce((n, u) => n + u.value, 0);
                    const plan = BTC().planTransaction({ utxos, toAddress: to, amountSats: sats, feeRate: rate, changeAddress: ctx.btcChangeAddress(), sendMax: sats >= spendable });
                    const brl = (s) => ctx.formatBRL((s / 1e8) * ctx.prices().BTC * ctx.prices().usdBrl);
                    if (plan.fee > plan.amount * 0.2 && plan.fee > 5000) throw new Error(`A taxa (${plan.fee} sat) passaria de 20% do valor enviado. Escolha uma velocidade mais barata ou envie um valor maior.`);
                    if (!confirm(`Enviar ${(plan.amount / 1e8).toFixed(8)} BTC (${brl(plan.amount)}) pela rede Bitcoin para:\n\n${to}\n\nTaxa da rede: ${plan.fee} sat (${brl(plan.fee)})\nTotal: ${((plan.amount + plan.fee) / 1e8).toFixed(8)} BTC\n\nConfira o endereço inteiro. Este envio não pode ser desfeito.`)) { msgBox.replaceChildren(); return; }
                    const signed = ctx.signBitcoinPlan(plan, utxos);
                    showOk('Transmitindo para a rede Bitcoin…');
                    const txid = await BTC().broadcast(signed.hex);
                    ctx.afterBitcoinSpend(plan).catch(() => {});
                    global.dispatchEvent(new CustomEvent('rdesk:success', { detail: { text: 'Bitcoin enviado!' } }));
                    showOk(`✅ Bitcoin enviado! Aguarde a confirmação na rede. <a href="${esc(REG.explorerTxUrl('btc', txid))}" target="_blank" rel="noopener noreferrer">Ver transação ↗</a>`);
                    ctx.refreshBalances();
                    return;
                }

                if (!global.ethers.utils.isAddress(to)) throw new Error('Endereço de destino inválido.');
                const dest = global.ethers.utils.getAddress(to);
                if (token.address && dest.toLowerCase() === token.address.toLowerCase()) {
                    throw new Error('Este é o endereço do CONTRATO da moeda, não de uma carteira. Enviar para ele queima os fundos.');
                }
                if (REG.getTokens(chainId).some((t) => t.address && t.address.toLowerCase() === dest.toLowerCase())) {
                    throw new Error('O destino é o contrato de uma moeda, não uma carteira. Envio bloqueado.');
                }
                const [, frac = ''] = amtStr.split('.');
                if (frac.length > token.decimals) throw new Error(`${token.symbol} aceita no máximo ${token.decimals} casas depois da vírgula.`);
                const amountWei = global.ethers.utils.parseUnits(amtStr, token.decimals);
                const chainName = REG.getChain(chainId).name;

                // Última conferência antes de assinar: envio em blockchain não tem estorno.
                const contractInfo = token.address ? `\nContrato da moeda: ${token.address}` : '';
                if (!confirm(`Enviar ${amtStr} ${token.symbol} na rede ${chainName} para:\n\n${dest}\n${contractInfo}\n\nConfira o endereço inteiro. Este envio não pode ser desfeito.`)) return;

                btn.disabled = true;
                const signer = await ctx.getSigner(chainId);
                showOk('Aguardando assinatura…');
                const tx = token.address
                    ? await new global.ethers.Contract(token.address, ERC20, signer).transfer(dest, amountWei)
                    : await signer.sendTransaction({ to: dest, value: amountWei });
                showOk(`Transação enviada (${esc(tx.hash.slice(0, 10))}…). Confirmando…`);
                await global.RdeskWallet.confirmTx(tx, chainId);
                global.dispatchEvent(new CustomEvent('rdesk:success', { detail: { text: 'Envio confirmado!' } }));
                showOk(`✅ Envio confirmado na ${esc(chainName)}! <a href="${esc(REG.explorerTxUrl(chainId, tx.hash))}" target="_blank" rel="noopener noreferrer">Ver transação ↗</a>`);
                ctx.refreshBalances();
            } catch (err) {
                showErr(global.RdeskWallet.friendlyTxError(err, { native: tokensFor(chainId).find((t) => t.isNative)?.symbol }));
            } finally {
                btn.disabled = false;
            }
        };
    }

    // =====================================================================
    // DETALHE DA MOEDA (contrato completo para conferência)
    // =====================================================================
    function renderAsset(sheet, ctx) {
        const acc = ctx.getActiveAccount();
        const chainId = normChain(ctx.params.chainId);
        const token = tokensFor(chainId).find((t) => t.symbol === ctx.params.symbol);
        if (!acc || !token) { ctx.back(); return; }
        const row = ctx.getBalances().find((b) => String(b.chainId) === String(chainId) && b.symbol === token.symbol);
        const amount = row ? row.amount : 0;
        const address = chainId === 'btc' ? (ctx.btcReceiveAddress?.() || acc.btcAddress) : chainId === 'dash' ? acc.dashAddress : acc.address;

        sheet.innerHTML = `
            ${header('Moeda')}
            <div class="asset-hero">
                ${REG.tokenOnChainBadge(token.symbol, chainId, 56)}
                <div>
                    <div class="asset-hero-symbol">${esc(token.symbol)} ${REG.chainBadge(chainId, true)}</div>
                    <div class="asset-hero-name">${esc(token.name || '')}</div>
                </div>
            </div>
            <div class="asset-balance money">
                <strong id="rmw-asset-amount">${fmtAmount(amount)} ${esc(token.symbol)}</strong>
                <span>${row && row.hasPrice ? ctx.formatBRL(row.brlValue) : 'sem cotação disponível'}</span>
                ${row && row.pending ? `<small>inclui ${fmtAmount(row.pending)} ainda não confirmado</small>` : ''}
            </div>
            <div class="asset-chart-box" id="rmw-asset-chart"></div>
            <div id="rmw-asset-facts" class="asset-facts-box"></div>
            ${riskNote(chainId)}
            <div class="contract-box">${contractLine(chainId, token)}</div>
            ${address ? `<a class="rmw-btn-secondary link-btn" href="${esc(REG.explorerAddressUrl(chainId, address))}" target="_blank" rel="noopener noreferrer">Ver minha carteira no explorador ↗</a>` : ''}
            <div class="two-btn-row">
                <button class="rmw-btn-primary" id="rmw-asset-send">↑ Enviar</button>
                <button class="rmw-btn-secondary" id="rmw-asset-receive">↓ Receber</button>
            </div>
            ${token.isCustom ? '<button class="rmw-btn-danger" id="rmw-asset-remove">Remover esta moeda da lista</button><p class="view-footnote">Remover só tira da lista. Seu saldo continua na blockchain.</p>' : ''}`;

        sheet.querySelector('#rmw-close-btn').onclick = ctx.close;
        global.RdeskAssetInfo?.fill(sheet.querySelector('#rmw-asset-facts'), { symbol: token.symbol, chainId, address: token.address, isCustom: token.isCustom, priceConfidence: token.address ? ctx.getPriceConfidence?.(chainId, token.address) : undefined });
        global.RdeskMarket?.mountCoinChart(sheet.querySelector('#rmw-asset-chart'), { symbol: token.symbol, chainId, address: token.address });
        sheet.querySelector('#rmw-asset-send').onclick = () => ctx.navigate('send', { chainId, symbol: token.symbol });
        sheet.querySelector('#rmw-asset-receive').onclick = () => ctx.navigate('receive', { chainId });
        sheet.querySelector('#rmw-asset-remove')?.addEventListener('click', () => {
            if (!confirm(`Tirar ${token.symbol} da sua lista?`)) return;
            REG.removeCustomToken(chainId, token.address);
            ctx.refreshBalances();
            ctx.close();
        });
        bindCopyButtons(sheet, ctx);
    }

    // =====================================================================
    // ADICIONAR QUALQUER MOEDA EM QUALQUER REDE
    // =====================================================================
    function renderAddToken(sheet, ctx) {
        const acc = ctx.getActiveAccount();
        const startChain = Number(ctx.params.chainId || 137);
        const custom = REG.loadCustomTokens();

        sheet.innerHTML = `
            ${header('+ Adicionar moeda')}
            <div class="view-hint">Cole o endereço do contrato da moeda. O app lê o nome e as casas decimais direto da blockchain.</div>
            <label class="rmw-label" for="rmw-tok-chain">Rede</label>
            <select class="rmw-select" id="rmw-tok-chain">
                ${REG.CHAINS.map((c) => `<option value="${c.id}"${c.id === startChain ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
            <label class="rmw-label" for="rmw-tok-addr">Endereço do contrato (0x…)</label>
            <div class="input-with-actions">
                <input type="text" class="rmw-input" id="rmw-tok-addr" placeholder="0x…" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(ctx.params.address || '')}">
                <button type="button" class="rmw-icon-btn" id="rmw-tok-scan" title="Ler QR Code" aria-label="Ler QR Code">📷</button>
            </div>
            <button class="rmw-btn-secondary" id="rmw-tok-check">Verificar contrato</button>
            <div id="rmw-tok-msg"></div>
            <div id="rmw-tok-info"></div>
            <div class="rmw-alert-warn">Qualquer pessoa pode criar uma moeda com qualquer nome. Pegue o endereço do contrato no site oficial do projeto.</div>
            ${custom.length ? `
            <div class="view-subtitle">Moedas que você adicionou</div>
            <div class="token-list">
                ${custom.map((t) => `
                    <div class="token-line">
                        ${REG.tokenOnChainBadge(t.symbol, t.chainId, 28)}
                        <span class="token-line-name"><strong>${esc(t.symbol)}</strong><small>${esc(REG.getChain(t.chainId).name)} • ${esc(REG.shortAddress(t.address, 8, 6))}</small></span>
                        <button type="button" class="mini-link-btn" data-remove-token="${esc(t.chainId)}:${esc(t.address)}">Remover</button>
                    </div>`).join('')}
            </div>` : ''}`;

        const $ = (id) => sheet.querySelector(id);
        const msg = $('#rmw-tok-msg'), info = $('#rmw-tok-info');
        $('#rmw-close-btn').onclick = ctx.close;
        global.RdeskQrScanner.attach($('#rmw-tok-scan'), $('#rmw-tok-addr'), { title: 'Ler endereço do contrato' });
        sheet.querySelectorAll('[data-remove-token]').forEach((b) => {
            b.onclick = () => {
                const [cid, addr] = b.getAttribute('data-remove-token').split(':');
                REG.removeCustomToken(cid, addr);
                ctx.refreshBalances();
                ctx.navigate('addtoken', { chainId: $('#rmw-tok-chain').value });
            };
        });

        $('#rmw-tok-check').onclick = async () => {
            const chainId = Number($('#rmw-tok-chain').value);
            const btn = $('#rmw-tok-check');
            msg.replaceChildren(); info.replaceChildren();
            btn.disabled = true;
            try {
                const provider = await ctx.getHealthyProvider(chainId);
                const found = await REG.inspectTokenContract(chainId, $('#rmw-tok-addr').value.trim(), provider);
                let balance = null;
                if (acc) {
                    try {
                        const raw = await new global.ethers.Contract(found.address, ERC20, provider).balanceOf(acc.address);
                        balance = global.ethers.utils.formatUnits(raw, found.decimals);
                    } catch (e) {}
                }
                const already = REG.getTokens(chainId).find((t) => t.address && t.address.toLowerCase() === found.address.toLowerCase());
                info.innerHTML = `
                    <div class="token-found">
                        <div class="asset-hero">
                            ${REG.tokenOnChainBadge(found.symbol, chainId, 48)}
                            <div>
                                <div class="asset-hero-symbol" id="rmw-tok-symbol">${esc(found.symbol)} ${REG.chainBadge(chainId, true)}</div>
                                <div class="asset-hero-name">${esc(found.name)} • ${found.decimals} casas decimais</div>
                            </div>
                        </div>
                        <code class="contract-code">${esc(found.address)}</code>
                        <div class="token-age" id="rmw-tok-age">Conferindo quando este contrato foi criado…</div>
                        ${balance !== null ? `<div class="token-found-balance">Seu saldo: <strong class="money">${fmtAmount(balance)} ${esc(found.symbol)}</strong></div>` : ''}
                        <a class="mini-link-btn" href="${esc(REG.explorerTokenUrl(chainId, found.address))}" target="_blank" rel="noopener noreferrer">Conferir no explorador ↗</a>
                        ${already
                            ? `<div class="rmw-alert-ok">${esc(already.symbol)} já está na sua lista desta rede.</div>`
                            : '<button class="rmw-btn-primary" id="rmw-tok-add">Adicionar à minha lista</button>'}
                    </div>`;
                global.RdeskAssetInfo?.contractInfo(chainId, found.address).then((c) => {
                    const el = info.querySelector('#rmw-tok-age');
                    if (!el) return;
                    if (c?.created) {
                        const d = new Date(c.created * 1000);
                        const young = (Date.now() / 1000 - c.created) < 365 * 86400;
                        el.className = `token-age ${young ? 'warn' : ''}`;
                        el.textContent = `📅 Contrato criado em ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}${young ? ' — tem menos de 1 ano, cuidado redobrado' : ''}${c.holders ? ` · ${c.holders.toLocaleString('pt-BR')} carteiras têm esta moeda` : ''}.`;
                    } else el.textContent = c?.unavailable ? 'Esta rede não tem explorador gratuito para conferir a data do contrato.' : 'Não deu para conferir a data do contrato agora.';
                });
                info.querySelector('#rmw-tok-add')?.addEventListener('click', async () => {
                    try {
                        const added = REG.addCustomToken(found);
                        ctx.refreshPrices?.().then(() => ctx.refreshBalances()).catch(() => {});
                        await ctx.refreshBalances();
                        ctx.navigate('asset', { chainId, symbol: added.symbol });
                    } catch (err) {
                        msg.innerHTML = `<div class="rmw-alert-err">${esc(err.message)}</div>`;
                    }
                });
            } catch (err) {
                msg.innerHTML = `<div class="rmw-alert-err">${esc(err.message || 'Não foi possível ler o contrato.')}</div>`;
            } finally {
                btn.disabled = false;
            }
        };
    }

    function register() {
        const wallet = W();
        wallet.registerView('receive', renderReceive);
        wallet.registerView('pix', renderPix);
        wallet.registerView('buy-pix', renderBuyPix);
        wallet.registerView('send', renderSend);
        wallet.registerView('asset', renderAsset);
        wallet.registerView('addtoken', renderAddToken);
    }
    if (W()) register();
    else document.addEventListener('DOMContentLoaded', register);
})(window);
