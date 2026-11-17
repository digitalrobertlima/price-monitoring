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
    const normChain = (v) => (v === 'btc' || v === 'BTC' ? 'btc' : Number(v));

    function networksFor(acc) {
        const list = REG.CHAINS.map((c) => c.id);
        if (acc && (acc.type === 'seed' || acc.type === 'pk')) list.push('btc');
        return list;
    }
    function tokensFor(chainId) {
        if (chainId === 'btc') return [{ symbol: 'BTC', name: 'Bitcoin', address: null, decimals: 8, isNative: true, priceKey: 'BTC' }];
        return REG.getTokens(chainId);
    }
    function balanceOf(ctx, chainId, symbol) {
        const row = ctx.getBalances().find((b) => String(b.chainId) === String(chainId) && b.symbol === symbol);
        return row ? row.amount : 0;
    }
    function contractLine(chainId, token) {
        if (chainId === 'btc') return '<span class="contract-native">Bitcoin on-chain (não é contrato; não aceita Lightning)</span>';
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
        const address = isBtc ? (acc.btcAddress || '') : acc.address;

        sheet.innerHTML = `
            ${header('↓ Receber')}
            <div class="view-hint">Escolha a rede por onde vão te enviar:</div>
            ${chipsHtml(networks, chainId)}
            ${address ? `
            <div class="receive-box">
                <div class="receive-qr"><div id="rmw-rec-qr"></div></div>
                <div class="receive-net">${REG.chainBadge(chainId, true)} <span>${esc(acc.name)}</span></div>
                <code class="receive-address" id="rmw-rec-address">${esc(address)}</code>
                <button class="rmw-btn-primary" id="rmw-rec-copy">📋 Copiar endereço</button>
            </div>
            <div class="rmw-alert-warn" id="rmw-rec-warning">
                ${isBtc
                    ? 'Envie <strong>somente Bitcoin pela rede Bitcoin (on-chain)</strong>. Este endereço não recebe por Lightning nem por outras redes.'
                    : `Envie <strong>somente pela rede ${esc(chain.name)}</strong>. Se a corretora mandar por outra rede, o dinheiro pode se perder.`}
            </div>` : `
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
        sheet.querySelectorAll('[data-net]').forEach((b) => { b.onclick = () => ctx.navigate('receive', { chainId: b.getAttribute('data-net') }); });
        if (address) {
            ctx.drawQr(sheet.querySelector('#rmw-rec-qr'), address, 190);
            sheet.querySelector('#rmw-rec-copy').onclick = async () => {
                await ctx.copy(address);
                sheet.querySelector('#rmw-rec-copy').textContent = '✓ Endereço copiado';
            };
        }
        bindCopyButtons(sheet, ctx);
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

            <label class="rmw-label" for="rmw-snd-to">Endereço de destino${isBtc ? ' (bc1…, 1… ou 3…)' : ' (0x…)'}</label>
            <div class="input-with-actions">
                <input type="text" class="rmw-input" id="rmw-snd-to" placeholder="${isBtc ? 'bc1q…' : '0x…'}" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(prefill.to)}">
                <button type="button" class="rmw-icon-btn" id="rmw-snd-paste" title="Colar" aria-label="Colar endereço">📋</button>
                <button type="button" class="rmw-icon-btn" id="rmw-snd-scan" title="Ler QR Code" aria-label="Ler QR Code">📷</button>
            </div>

            <label class="rmw-label" for="rmw-snd-amt">Quantidade</label>
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

        const updateFiat = () => {
            const amt = parseAmount();
            const unit = W().unitUsdFor(token.priceKey, chainId, token.address);
            $('#rmw-snd-fiat').textContent = amt && unit > 0 ? `≈ ${ctx.formatBRL(Number(amt) * unit * ctx.prices().usdBrl)}` : '';
        };
        $('#rmw-snd-amt').addEventListener('input', updateFiat);
        updateFiat();

        $('#rmw-snd-paste').onclick = async () => {
            try { $('#rmw-snd-to').value = (await navigator.clipboard.readText()).trim(); } catch (e) { showErr('O navegador não liberou a área de transferência. Cole manualmente no campo.'); }
        };

        $('#rmw-snd-scan').onclick = async () => {
            const text = await global.RdeskQrScanner.scan({ title: 'Ler endereço de destino' });
            if (text === null) return;
            const p = global.RdeskQrScanner.parsePayload(text);
            if (p.kind === 'lightning') return showErr('Este QR é um pedido Lightning. O app envia Bitcoin on-chain e moedas das redes listadas; Lightning ainda não é suportado.');
            if (p.kind === 'bitcoin') {
                if (!networks.includes('btc')) return showErr('Este QR é de um endereço Bitcoin, mas esta carteira não tem Bitcoin (use uma carteira criada ou importada no app).');
                if (!isBtc) return ctx.navigate('send', { chainId: 'btc', to: p.address, amount: p.amount || '' });
                $('#rmw-snd-to').value = p.address;
                if (p.amount) { $('#rmw-snd-amt').value = p.amount; updateFiat(); }
                return;
            }
            if (p.kind === 'evm') {
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
                sel.innerHTML = `
                    <option value="${r.normal}">Normal — ~30 min (${r.normal} sat/vB)</option>
                    <option value="${r.fast}">Rápida — próximo bloco (${r.fast} sat/vB)</option>
                    <option value="${r.slow}">Econômica — horas (${r.slow} sat/vB)</option>`;
            }).catch(() => {
                const sel = $('#rmw-snd-fee');
                if (sel) sel.innerHTML = '<option value="">Taxas indisponíveis agora</option>';
            });
        }

        $('#rmw-snd-max').onclick = async () => {
            msgBox.replaceChildren();
            try {
                if (isBtc) {
                    const rate = Number($('#rmw-snd-fee').value);
                    if (!rate) throw new Error('Aguarde as taxas da rede carregarem.');
                    const utxos = await BTC().fetchUtxos(acc.btcAddress);
                    const dest = BTC().isValidAddress($('#rmw-snd-to').value.trim()) ? $('#rmw-snd-to').value.trim() : acc.btcAddress;
                    const plan = BTC().planTransaction({ utxos, toAddress: dest, feeRate: rate, changeAddress: acc.btcAddress, sendMax: true });
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

                if (isBtc) {
                    BTC().addressToScript(to); // lança erro claro se não for endereço Bitcoin válido
                    const rate = Number($('#rmw-snd-fee').value);
                    if (!rate) throw new Error('Taxas da rede Bitcoin indisponíveis. Tente de novo em instantes.');
                    const sats = Math.round(Number(amtStr) * 1e8);
                    btn.disabled = true;
                    showOk('Lendo saldo disponível…');
                    const utxos = await BTC().fetchUtxos(acc.btcAddress);
                    const spendable = utxos.filter((u) => u.confirmed).reduce((n, u) => n + u.value, 0);
                    const plan = BTC().planTransaction({ utxos, toAddress: to, amountSats: sats, feeRate: rate, changeAddress: acc.btcAddress, sendMax: sats >= spendable });
                    const brl = (s) => ctx.formatBRL((s / 1e8) * ctx.prices().BTC * ctx.prices().usdBrl);
                    if (plan.fee > plan.amount * 0.2 && plan.fee > 5000) throw new Error(`A taxa (${plan.fee} sat) passaria de 20% do valor enviado. Escolha uma velocidade mais barata ou envie um valor maior.`);
                    if (!confirm(`Enviar ${(plan.amount / 1e8).toFixed(8)} BTC (${brl(plan.amount)}) pela rede Bitcoin para:\n\n${to}\n\nTaxa da rede: ${plan.fee} sat (${brl(plan.fee)})\nTotal: ${((plan.amount + plan.fee) / 1e8).toFixed(8)} BTC\n\nConfira o endereço inteiro. Este envio não pode ser desfeito.`)) { msgBox.replaceChildren(); return; }
                    const key = ctx.getBitcoinKey();
                    const signed = BTC().signTransaction(plan, key.privateKey);
                    showOk('Transmitindo para a rede Bitcoin…');
                    const txid = await BTC().broadcast(signed.hex);
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
        const address = chainId === 'btc' ? acc.btcAddress : acc.address;

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
            <div class="contract-box">${contractLine(chainId, token)}</div>
            ${address ? `<a class="rmw-btn-secondary link-btn" href="${esc(REG.explorerAddressUrl(chainId, address))}" target="_blank" rel="noopener noreferrer">Ver minha carteira no explorador ↗</a>` : ''}
            <div class="two-btn-row">
                <button class="rmw-btn-primary" id="rmw-asset-send">↑ Enviar</button>
                <button class="rmw-btn-secondary" id="rmw-asset-receive">↓ Receber</button>
            </div>
            ${token.isCustom ? '<button class="rmw-btn-danger" id="rmw-asset-remove">Remover esta moeda da lista</button><p class="view-footnote">Remover só tira da lista. Seu saldo continua na blockchain.</p>' : ''}`;

        sheet.querySelector('#rmw-close-btn').onclick = ctx.close;
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
                        ${balance !== null ? `<div class="token-found-balance">Seu saldo: <strong class="money">${fmtAmount(balance)} ${esc(found.symbol)}</strong></div>` : ''}
                        <a class="mini-link-btn" href="${esc(REG.explorerTokenUrl(chainId, found.address))}" target="_blank" rel="noopener noreferrer">Conferir no explorador ↗</a>
                        ${already
                            ? `<div class="rmw-alert-ok">${esc(already.symbol)} já está na sua lista desta rede.</div>`
                            : '<button class="rmw-btn-primary" id="rmw-tok-add">Adicionar à minha lista</button>'}
                    </div>`;
                info.querySelector('#rmw-tok-add')?.addEventListener('click', async () => {
                    try {
                        const added = REG.addCustomToken(found);
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
        wallet.registerView('send', renderSend);
        wallet.registerView('asset', renderAsset);
        wallet.registerView('addtoken', renderAddToken);
    }
    if (W()) register();
    else document.addEventListener('DOMContentLoaded', register);
})(window);
