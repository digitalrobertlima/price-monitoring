/* =========================================================================
   RDESK — ENVIAR SEM MOEDA DA REDE (preparado para o token do criador)
   Ideia: a pessoa transfere o token do criador como quem faz um Pix. Ela NÃO
   precisa ter BNB, ETH ou POL: assina uma autorização (sem gastar nada) e o
   "relayer" do criador (servidor dele) envia a transação e paga a taxa da rede.
   Em troca, o relayer recebe uma taxinha no próprio token.

   Padrão usado: EIP-3009 (transferWithAuthorization), o mesmo do USDC.
   A autorização assinada amarra destino, valor, prazo e um número único:
   o relayer NÃO consegue mudar o destino nem o valor, nem usar duas vezes.
   São duas autorizações: (1) o pagamento para quem recebe; (2) a taxa do
   relayer, com o valor que a pessoa viu e aceitou.

   Fica DESLIGADO até o criador configurar o token (REDE, CONTRATO, RELAYER).
   Detalhes do contrato e da API do relayer: docs/token-e-relayer.md
   ========================================================================= */
(function (global) {
    'use strict';

    const E = () => global.ethers;
    // Preencher quando o token existir (ou via RdeskRelayer.configure em teste)
    let CONFIG = {
        enabled: false,
        chainId: null,           // ex.: 56 (BNB Chain), 137 (Polygon), 8453 (Base)…
        address: '',             // contrato do token (precisa implementar EIP-3009 + EIP-712)
        symbol: '',              // ex.: 'RDK'
        name: '',                // nome do token no domínio EIP-712 (igual ao do contrato)
        version: '1',            // versão do domínio EIP-712 (igual ao do contrato)
        decimals: 18,
        relayerUrl: '',          // ex.: 'https://relayer.seudominio.com' (Oracle Cloud)
        maxFeeBps: 200           // teto de segurança: a taxa do relayer nunca passa de 2% do envio
    };
    const configured = () => Boolean(CONFIG.enabled && CONFIG.chainId && /^0x[0-9a-fA-F]{40}$/.test(CONFIG.address) && /^https:\/\//.test(CONFIG.relayerUrl) && CONFIG.name);

    const TYPES = {
        TransferWithAuthorization: [
            { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
            { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }
        ]
    };
    const domain = () => ({ name: CONFIG.name, version: CONFIG.version, chainId: Number(CONFIG.chainId), verifyingContract: CONFIG.address });

    // Pergunta ao relayer quanto ele cobra (no próprio token) e para onde vai a taxa
    async function quote(valueRaw) {
        if (!configured()) throw new Error('Envio sem taxa da rede ainda não está ligado.');
        const r = await fetch(`${CONFIG.relayerUrl}/quote?chainId=${CONFIG.chainId}&token=${CONFIG.address}&value=${valueRaw.toString()}`);
        if (!r.ok) throw new Error('O serviço de envio sem taxa não respondeu.');
        const j = await r.json();
        const fee = E().BigNumber.from(String(j.fee));
        if (!/^0x[0-9a-fA-F]{40}$/.test(j.feeRecipient || '')) throw new Error('Resposta estranha do serviço. Cancelado.');
        if (fee.mul(10000).gt(E().BigNumber.from(valueRaw).mul(CONFIG.maxFeeBps))) throw new Error(`A taxa pedida passa de ${CONFIG.maxFeeBps / 100}% do envio. Cancelado.`);
        return { fee, feeRecipient: j.feeRecipient, validSeconds: Math.min(Number(j.validSeconds) || 600, 3600) };
    }

    // Assina as duas autorizações (não gasta nada, não precisa de BNB/ETH/POL)
    async function signTransfer({ signer, to, valueRaw, fee, feeRecipient, validSeconds = 600 }) {
        const from = await signer.getAddress();
        if (!E().utils.isAddress(to)) throw new Error('Endereço de destino inválido.');
        const now = Math.floor(Date.now() / 1000);
        const base = { from, validAfter: 0, validBefore: now + validSeconds };
        const rnd = () => E().utils.hexlify(E().utils.randomBytes(32));
        const pay = { ...base, to: E().utils.getAddress(to), value: E().BigNumber.from(valueRaw).toString(), nonce: rnd() };
        const tip = { ...base, to: E().utils.getAddress(feeRecipient), value: E().BigNumber.from(fee).toString(), nonce: rnd() };
        const sign = (msg) => signer._signTypedData(domain(), TYPES, msg);
        const [paySig, tipSig] = [await sign(pay), await sign(tip)];
        return { chainId: Number(CONFIG.chainId), token: CONFIG.address, payment: { ...pay, signature: paySig }, fee: { ...tip, signature: tipSig } };
    }

    async function relay(bundle) {
        const r = await fetch(`${CONFIG.relayerUrl}/relay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !/^0x[0-9a-fA-F]{64}$/.test(j.txHash || '')) throw new Error(j.error || 'O serviço não conseguiu enviar agora. Nada saiu da sua carteira.');
        return j.txHash;
    }

    // Fluxo completo: cota, mostra, assina e entrega ao relayer
    async function sendGasless({ to, amountText, confirm = global.confirm }) {
        if (!configured()) throw new Error('Envio sem taxa da rede ainda não está ligado.');
        const valueRaw = E().utils.parseUnits(String(amountText).replace(',', '.'), CONFIG.decimals);
        const q = await quote(valueRaw);
        const fmt = (v) => E().utils.formatUnits(v, CONFIG.decimals);
        if (!confirm(`Enviar ${fmt(valueRaw)} ${CONFIG.symbol} para:\n\n${to}\n\nTaxa do serviço: ${fmt(q.fee)} ${CONFIG.symbol} (você não precisa de moeda da rede).\n\nConfira o endereço. Este envio não pode ser desfeito.`)) return null;
        const signer = await global.RdeskWallet.getSigner(Number(CONFIG.chainId));
        const bundle = await signTransfer({ signer, to, valueRaw, fee: q.fee, feeRecipient: q.feeRecipient, validSeconds: q.validSeconds });
        return relay(bundle);
    }

    global.RdeskRelayer = {
        isEnabled: configured,
        config: () => ({ ...CONFIG }),
        configure: (c) => { CONFIG = { ...CONFIG, ...c }; return configured(); },
        quote, signTransfer, relay, sendGasless, TYPES, domain
    };
})(window);
