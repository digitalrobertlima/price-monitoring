/**
 * RDESK SENTINEL V22 — GATEWAY PIX & ROTEADOR CROSS-CHAIN (6º de 9 arquivos)
 * 1. Swap Intra-Rede & Cross-Chain (5 Redes EVM / 8 Ativos) com Redundância Tripla:
 *    - Rota 1: Uniswap V3 SwapRouter02 + QuoterV2 On-Chain + Wrap/Unwrap 1:1 (Taxa 0%)
 *    - Rota 2: LI.FI Smart Order & Bridge Router (0% taxa para o dono; 0.20% integrador p/ terceiros)
 *    - Rota 3: ParaSwap API v5 / SideShift Non-Custodial Instant Exchange
 * 2. Recibo Humano Pré-Assinatura em Reais (R$) + Aprovação ERC-20 Exata (nunca MAX_UINT256)
 * 3. Comprar com PIX (Entrada BRL -> Autocustódia) & Ranker PIX Líquido (Saída Cripto -> Banco)
 */
(function (global) {
    'use strict';

    // =========================================================================
    // 1. CONFIGURAÇÃO DE RECEITA DO INTEGRADOR E ISENÇÃO TOTAL PARA O DONO
    // =========================================================================
    const OWNER_TREASURY_ADDRESS = '0x2833c7c0a42080a9407f82524c79c8442a7e0fe3';
    const INTEGRATOR_ID = 'rdesk-sentinel-v22';
    const EXTERNAL_USER_FEE_RATIO = 0.002; // 0.20% cobrado apenas de terceiros em pontes/rotas LI.FI

    // Contratos Oficiais Verificados Uniswap V3 por Rede
    const UNISWAP_V3_CONTRACTS = {
        137: {
            swapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
            quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
            nfpm: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
            wrappedNativeSymbol: 'WPOL',
            wrappedNativeAddress: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
        },
        1: {
            swapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
            quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
            nfpm: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
            wrappedNativeSymbol: 'WETH',
            wrappedNativeAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
        },
        42161: {
            swapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
            quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
            nfpm: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
            wrappedNativeSymbol: 'WETH',
            wrappedNativeAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
        },
        8453: {
            swapRouter02: '0x2626664c2603336E57B271c5C0b26F421741e481',
            quoterV2: '0x3d4e44Eb1374240CE5F1B136041212E6B3B8Df87',
            nfpm: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
            wrappedNativeSymbol: 'WETH',
            wrappedNativeAddress: '0x4200000000000000000000000000000000000006'
        },
        10: {
            swapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
            quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
            nfpm: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
            wrappedNativeSymbol: 'WETH',
            wrappedNativeAddress: '0x4200000000000000000000000000000000000006'
        }
    };

    const QUOTER_V2_ABI = [
        'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'
    ];

    const SWAP_ROUTER_02_ABI = [
        'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)'
    ];

    const WRAPPED_NATIVE_ABI = [
        'function deposit() external payable',
        'function withdraw(uint256 wad) external'
    ];

    const FEE_TIERS_TO_PROBE = [500, 3000, 100, 10000];

    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de cotação')), ms))
        ]);
    }

    function getAssetContractMeta(chainId, symbol) {
        const asset = global.RdeskVault?.ASSET_REGISTRY?.[symbol];
        return asset?.contracts?.[chainId] || null;
    }

    function resolveErc20AddressForPool(chainId, symbol) {
        const meta = getAssetContractMeta(chainId, symbol);
        if (!meta) return null;
        if (meta.isNative) {
            return UNISWAP_V3_CONTRACTS[chainId]?.wrappedNativeAddress || null;
        }
        return meta.address;
    }

    // =========================================================================
    // 2. COTAÇÃO COM REDUNDÂNCIA TRIPLA (WRAP 1:1 / UNISWAP V3 / LI.FI / PARASWAP)
    // =========================================================================
    async function quoteUniswapV3Direct(chainId, fromSymbol, toSymbol, amountInFloat) {
        const uni = UNISWAP_V3_CONTRACTS[chainId];
        if (!uni) throw new Error('Uniswap V3 não mapeada nesta rede.');

        const fromMeta = getAssetContractMeta(chainId, fromSymbol);
        const toMeta = getAssetContractMeta(chainId, toSymbol);
        if (!fromMeta || !toMeta) throw new Error('Ativo não disponível nesta rede.');

        const tokenInAddr = resolveErc20AddressForPool(chainId, fromSymbol);
        const tokenOutAddr = resolveErc20AddressForPool(chainId, toSymbol);
        if (!tokenInAddr || !tokenOutAddr || tokenInAddr.toLowerCase() === tokenOutAddr.toLowerCase()) {
            throw new Error('Par inválido para pool.');
        }

        const amountInWei = ethers.utils.parseUnits(
            Number(amountInFloat).toFixed(fromMeta.decimals),
            fromMeta.decimals
        );

        return global.RdeskVault.callWithRpcFailover(chainId, async (provider) => {
            const quoter = new ethers.Contract(uni.quoterV2, QUOTER_V2_ABI, provider);
            let bestOutWei = ethers.BigNumber.from(0);
            let bestFee = 500;

            await Promise.all(
                FEE_TIERS_TO_PROBE.map(async (feeTier) => {
                    try {
                        const res = await quoter.callStatic.quoteExactInputSingle({
                            tokenIn: tokenInAddr,
                            tokenOut: tokenOutAddr,
                            amountIn: amountInWei,
                            fee: feeTier,
                            sqrtPriceLimitX96: 0
                        });
                        if (res?.amountOut && res.amountOut.gt(bestOutWei)) {
                            bestOutWei = res.amountOut;
                            bestFee = feeTier;
                        }
                    } catch (e) {}
                })
            );

            if (bestOutWei.lte(0)) {
                throw new Error('Nenhuma pool direta com liquidez encontrada na Uniswap V3.');
            }

            const amountOutFloat = parseFloat(ethers.utils.formatUnits(bestOutWei, toMeta.decimals));
            return {
                routeEngine: `UNISWAP V3 (${(bestFee / 10000).toFixed(2)}%)`,
                kind: 'UNISWAP_V3_DIRECT',
                fromChainId: chainId,
                toChainId: chainId,
                fromSymbol,
                toSymbol,
                amountInFloat: Number(amountInFloat),
                amountOutFloat,
                amountInWei: amountInWei.toString(),
                amountOutWei: bestOutWei.toString(),
                feeTier: bestFee,
                tokenInAddr,
                tokenOutAddr,
                fromIsNative: fromMeta.isNative,
                toIsNative: toMeta.isNative,
                appFeePct: 0, // Contratos imutáveis Uniswap V3: 0% taxa de app para todos
                estimatedGasNative: chainId === 137 ? 0.035 : 0.00045
            };
        }, 5000);
    }

    async function quoteLifiCrossOrSameChain({ fromChainId, toChainId, fromSymbol, toSymbol, amountInFloat }) {
        const vaultSnap = global.RdeskVault?.getState();
        const userAddress = vaultSnap?.address || OWNER_TREASURY_ADDRESS;
        const fromMeta = getAssetContractMeta(fromChainId, fromSymbol);
        const toMeta = getAssetContractMeta(toChainId, toSymbol);

        if (!fromMeta || !toMeta) {
            throw new Error('Par não suportado nas redes selecionadas.');
        }

        const amountInWei = ethers.utils.parseUnits(
            Number(amountInFloat).toFixed(fromMeta.decimals),
            fromMeta.decimals
        ).toString();

        const isOwner = global.RdeskVault?.isOwnerExempt(userAddress) === true;
        const feeRatio = isOwner ? 0 : EXTERNAL_USER_FEE_RATIO;

        const url = new URL('https://li.quest/v1/quote');
        url.searchParams.set('fromChain', String(fromChainId));
        url.searchParams.set('toChain', String(toChainId));
        url.searchParams.set('fromToken', fromMeta.address);
        url.searchParams.set('toToken', toMeta.address);
        url.searchParams.set('fromAmount', amountInWei);
        url.searchParams.set('fromAddress', userAddress);
        url.searchParams.set('toAddress', userAddress);
        url.searchParams.set('slippage', '0.01');
        url.searchParams.set('integrator', INTEGRATOR_ID);
        if (feeRatio > 0) {
            url.searchParams.set('fee', String(feeRatio));
        }

        const res = await withTimeout(fetch(url.toString()), 7500);
        if (!res.ok) throw new Error(`LI.FI HTTP ${res.status}`);
        const data = await res.json();

        const toAmountWei = data?.estimate?.toAmount;
        if (!toAmountWei) throw new Error('LI.FI não retornou estimativa válida.');

        const amountOutFloat = parseFloat(ethers.utils.formatUnits(toAmountWei, toMeta.decimals));
        const toolName = data?.toolDetails?.name || data?.tool || 'LI.FI Bridge';

        return {
            routeEngine: fromChainId === toChainId ? `LI.FI (${toolName})` : `PONTE ${toolName}`,
            kind: 'LIFI_TX',
            fromChainId,
            toChainId,
            fromSymbol,
            toSymbol,
            amountInFloat: Number(amountInFloat),
            amountOutFloat,
            amountInWei,
            amountOutWei: toAmountWei,
            approvalAddress: data?.estimate?.approvalAddress || null,
            fromTokenAddress: fromMeta.address,
            fromIsNative: fromMeta.isNative,
            transactionRequest: data?.transactionRequest || null,
            appFeePct: feeRatio * 100,
            estimatedGasNative: fromChainId === 137 ? 0.06 : 0.0009
        };
    }

    async function quoteParaswapFallback(chainId, fromSymbol, toSymbol, amountInFloat) {
        const fromMeta = getAssetContractMeta(chainId, fromSymbol);
        const toMeta = getAssetContractMeta(chainId, toSymbol);
        if (!fromMeta || !toMeta) throw new Error('Ativo inválido.');

        const srcToken = fromMeta.isNative ? '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' : fromMeta.address;
        const destToken = toMeta.isNative ? '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' : toMeta.address;
        const srcAmount = ethers.utils.parseUnits(Number(amountInFloat).toFixed(fromMeta.decimals), fromMeta.decimals).toString();

        const url = new URL('https://apiv5.paraswap.io/prices');
        url.searchParams.set('srcToken', srcToken);
        url.searchParams.set('destToken', destToken);
        url.searchParams.set('amount', srcAmount);
        url.searchParams.set('srcDecimals', String(fromMeta.decimals));
        url.searchParams.set('destDecimals', String(toMeta.decimals));
        url.searchParams.set('side', 'SELL');
        url.searchParams.set('network', String(chainId));

        const res = await withTimeout(fetch(url.toString()), 5500);
        if (!res.ok) throw new Error('ParaSwap indisponível');
        const json = await res.json();
        const destAmount = json?.priceRoute?.destAmount;
        if (!destAmount) throw new Error('ParaSwap sem rota');

        return {
            routeEngine: 'PARASWAP SOR (FALLBACK)',
            kind: 'QUOTE_ONLY_FALLBACK',
            fromChainId: chainId,
            toChainId: chainId,
            fromSymbol,
            toSymbol,
            amountInFloat: Number(amountInFloat),
            amountOutFloat: parseFloat(ethers.utils.formatUnits(destAmount, toMeta.decimals)),
            amountInWei: srcAmount,
            amountOutWei: destAmount,
            appFeePct: 0,
            estimatedGasNative: chainId === 137 ? 0.045 : 0.0006
        };
    }

    async function quoteBestSwapOrBridge({ fromChainId, toChainId, fromSymbol, toSymbol, amountIn }) {
        const qty = parseFloat(amountIn);
        if (!Number.isFinite(qty) || qty <= 0) {
            throw new Error('Informe uma quantidade maior que zero.');
        }

        const cFrom = Number(fromChainId);
        const cTo = Number(toChainId);

        if (cFrom === cTo && fromSymbol === toSymbol) {
            throw new Error('Escolha moedas ou redes diferentes para converter.');
        }

        // Caso Especial 1: Wrap / Unwrap 1:1 na mesma rede (POL <-> WPOL ou ETH <-> WETH)
        const isWrapPol = cFrom === 137 && cTo === 137 && fromSymbol === 'POL' && toSymbol === 'WPOL';
        const isUnwrapPol = cFrom === 137 && cTo === 137 && fromSymbol === 'WPOL' && toSymbol === 'POL';
        const isWrapEth = cFrom === cTo && cFrom !== 137 && fromSymbol === 'ETH' && toSymbol === 'WETH';
        const isUnwrapEth = cFrom === cTo && cFrom !== 137 && fromSymbol === 'WETH' && toSymbol === 'ETH';

        if (isWrapPol || isUnwrapPol || isWrapEth || isUnwrapEth) {
            const isWrap = isWrapPol || isWrapEth;
            const wrappedAddr = UNISWAP_V3_CONTRACTS[cFrom].wrappedNativeAddress;
            const weiStr = ethers.utils.parseUnits(qty.toFixed(18), 18).toString();
            return {
                routeEngine: 'EMBRULHO NATIVO 1:1 (TAXA 0%)',
                kind: isWrap ? 'WRAP_NATIVE' : 'UNWRAP_NATIVE',
                fromChainId: cFrom,
                toChainId: cTo,
                fromSymbol,
                toSymbol,
                amountInFloat: qty,
                amountOutFloat: qty,
                amountInWei: weiStr,
                amountOutWei: weiStr,
                wrappedAddress: wrappedAddr,
                appFeePct: 0,
                estimatedGasNative: cFrom === 137 ? 0.012 : 0.00018
            };
        }

        // Caso 2: Mesma rede -> Tenta Uniswap V3 On-Chain -> LI.FI -> ParaSwap
        if (cFrom === cTo) {
            try {
                return await quoteUniswapV3Direct(cFrom, fromSymbol, toSymbol, qty);
            } catch (e1) {
                try {
                    return await quoteLifiCrossOrSameChain({ fromChainId: cFrom, toChainId: cTo, fromSymbol, toSymbol, amountInFloat: qty });
                } catch (e2) {
                    return await quoteParaswapFallback(cFrom, fromSymbol, toSymbol, qty);
                }
            }
        }

        // Caso 3: Cross-Chain entre redes diferentes -> LI.FI Bridge Router
        return await quoteLifiCrossOrSameChain({
            fromChainId: cFrom,
            toChainId: cTo,
            fromSymbol,
            toSymbol,
            amountInFloat: qty
        });
    }

    // =========================================================================
    // 3. RECIBO HUMANO PRÉ-ASSINATURA EM REAIS (R$) & EXECUÇÃO SEGURA
    // =========================================================================
    function buildSwapReceiptPreview(quote) {
        const snap = global.RdeskVault?.getState();
        const fx = snap?.usdBrlRate || 5.65;
        const prices = snap?.pricesUsd || {};

        const netFrom = global.RdeskVault?.NETWORKS?.[quote.fromChainId];
        const netTo = global.RdeskVault?.NETWORKS?.[quote.toChainId];

        const spendable = global.RdeskVault?.getSpendableBalance(quote.fromChainId, quote.fromSymbol) || 0;
        if (quote.amountInFloat > spendable + 1e-9) {
            throw new Error(
                `Saldo disponível insuficiente na ${netFrom?.name}. Máximo liberado (preservando escudo de gás): ${spendable.toFixed(4)} ${quote.fromSymbol}.`
            );
        }

        const outBrl = quote.amountOutFloat * (prices[quote.toSymbol] || 0) * fx;
        const inBrl = quote.amountInFloat * (prices[quote.fromSymbol] || 0) * fx;

        const gasCoin = netFrom?.nativeSymbol || 'POL';
        const gasBrl = (quote.estimatedGasNative || 0.02) * (prices[gasCoin] || 0) * fx;

        const isOwner = snap?.isOwnerExempt === true;
        const appFeeText = isOwner || quote.appFeePct === 0
            ? 'R$ 0,00 (Isento — Carteira Proprietária / On-Chain)'
            : `${quote.appFeePct.toFixed(2)}% (~R$ ${(inBrl * (quote.appFeePct / 100)).toFixed(2)})`;

        return {
            actionTitle: quote.fromChainId === quote.toChainId
                ? `Trocar ${quote.fromSymbol} → ${quote.toSymbol} (${netFrom?.name})`
                : `Ponte ${quote.fromSymbol} (${netFrom?.name}) → ${quote.toSymbol} (${netTo?.name})`,
            outSummary: `${quote.amountInFloat.toFixed(quote.fromSymbol === 'WBTC' ? 6 : 4)} ${quote.fromSymbol} (${netFrom?.name})`,
            outBrl: inBrl,
            inSummary: `~${quote.amountOutFloat.toFixed(quote.toSymbol === 'WBTC' ? 6 : 4)} ${quote.toSymbol} (${netTo?.name})`,
            inBrl: outBrl,
            routeLabel: quote.routeEngine,
            appFeeText,
            estimatedGasText: `${(quote.estimatedGasNative || 0.02).toFixed(5)} ${gasCoin}`,
            estimatedGasBrl: gasBrl,
            gasReserveText: `${netFrom?.gasReserve || 3.0} ${gasCoin} protegidos`,
            quote
        };
    }

    async function ensureExactErc20Approval(signer, ownerAddr, tokenAddress, spenderAddress, exactAmountWei, onStatus) {
        const erc20 = new ethers.Contract(tokenAddress, global.RdeskVault.ERC20_MIN_ABI, signer);
        const currentAllowance = await erc20.allowance(ownerAddr, spenderAddress);
        const neededBN = ethers.BigNumber.from(exactAmountWei);

        if (currentAllowance.gte(neededBN)) return;

        if (typeof onStatus === 'function') {
            onStatus('Etapa 1/2: Aprovando o valor exato da operação (sem aprovação infinita)...');
        }

        // Alguns tokens (como USDT na Ethereum Mainnet) exigem zerar antes de alterar allowance não-zero
        if (!currentAllowance.isZero()) {
            const resetTx = await erc20.approve(spenderAddress, 0);
            await resetTx.wait(1);
        }

        const appTx = await erc20.approve(spenderAddress, neededBN);
        await appTx.wait(1);
    }

    async function executePreparedSwapOrBridge(quote, onStepStatus) {
        const signer = await global.RdeskVault.getSignerForChain(quote.fromChainId);
        const ownerAddr = await signer.getAddress();

        if (quote.kind === 'WRAP_NATIVE') {
            if (typeof onStepStatus === 'function') onStepStatus('Embrulhando 1:1 sem taxa...');
            const wContract = new ethers.Contract(quote.wrappedAddress, WRAPPED_NATIVE_ABI, signer);
            const tx = await wContract.deposit({ value: quote.amountInWei });
            const receipt = await tx.wait(1);
            global.RdeskVault.refreshAllBalancesAndPrices();
            return receipt;
        }

        if (quote.kind === 'UNWRAP_NATIVE') {
            if (typeof onStepStatus === 'function') onStepStatus('Desembrulhando 1:1 sem taxa...');
            const wContract = new ethers.Contract(quote.wrappedAddress, WRAPPED_NATIVE_ABI, signer);
            const tx = await wContract.withdraw(quote.amountInWei);
            const receipt = await tx.wait(1);
            global.RdeskVault.refreshAllBalancesAndPrices();
            return receipt;
        }

        if (quote.kind === 'UNISWAP_V3_DIRECT') {
            const uni = UNISWAP_V3_CONTRACTS[quote.fromChainId];
            if (!quote.fromIsNative) {
                await ensureExactErc20Approval(
                    signer,
                    ownerAddr,
                    quote.tokenInAddr,
                    uni.swapRouter02,
                    quote.amountInWei,
                    onStepStatus
                );
            }

            if (typeof onStepStatus === 'function') {
                onStepStatus('Executando troca direta na Uniswap V3 com proteção anti-slippage...');
            }

            const router = new ethers.Contract(uni.swapRouter02, SWAP_ROUTER_02_ABI, signer);
            const minOutBN = ethers.BigNumber.from(quote.amountOutWei).mul(985).div(1000); // 1.5% slippage máx

            const params = {
                tokenIn: quote.tokenInAddr,
                tokenOut: quote.tokenOutAddr,
                fee: quote.feeTier,
                recipient: ownerAddr,
                amountIn: quote.amountInWei,
                amountOutMinimum: minOutBN,
                sqrtPriceLimitX96: 0
            };

            const overrides = quote.fromIsNative ? { value: quote.amountInWei } : {};
            await router.callStatic.exactInputSingle(params, overrides);
            const tx = await router.exactInputSingle(params, overrides);
            const receipt = await tx.wait(1);
            global.RdeskVault.refreshAllBalancesAndPrices();
            return receipt;
        }

        if (quote.kind === 'LIFI_TX' && quote.transactionRequest) {
            if (!quote.fromIsNative && quote.approvalAddress) {
                await ensureExactErc20Approval(
                    signer,
                    ownerAddr,
                    quote.fromTokenAddress,
                    quote.approvalAddress,
                    quote.amountInWei,
                    onStepStatus
                );
            }

            if (typeof onStepStatus === 'function') {
                onStepStatus('Enviando transação para o roteador cross-chain...');
            }

            const txReq = {
                to: quote.transactionRequest.to,
                data: quote.transactionRequest.data,
                value: quote.transactionRequest.value || '0x0'
            };

            await signer.call(txReq);
            const tx = await signer.sendTransaction(txReq);
            const receipt = await tx.wait(1);
            global.RdeskVault.refreshAllBalancesAndPrices();
            return receipt;
        }

        throw new Error('Esta rota é apenas informativa no momento. Tente novamente em alguns segundos.');
    }

    // =========================================================================
    // 4. COMPRAR COM PIX (BRL -> AUTOCUSTÓDIA) & RANKER PIX LÍQUIDO (SAQUE)
    // =========================================================================
    function evaluatePixBuyRoutes({ brlAmount, targetSymbol = 'USDT', targetChainId = 137 }) {
        const brl = parseFloat(brlAmount);
        if (!Number.isFinite(brl) || brl <= 0) return [];

        const snap = global.RdeskVault?.getState();
        const fx = snap?.usdBrlRate || 5.65;
        const prices = snap?.pricesUsd || {};
        const addr = snap?.address || '';
        const net = global.RdeskVault?.NETWORKS?.[targetChainId] || global.RdeskVault?.NETWORKS?.[137];

        const tokenPriceBrl = (prices[targetSymbol] || (1 / fx)) * fx;

        const routes = [
            {
                id: 'depix-liquid-polygon',
                name: 'DePix / Liquid → Polygon (Direto Autocustódia)',
                badge: 'SEM CADASTRO / SEM KYC',
                noKyc: true,
                spreadPct: 0.90,
                fixedFeeBrl: 0.0,
                etaText: '2 a 5 min',
                url: 'https://sideshift.ai/liquid/polygon',
                note: 'Você paga o PIX em Reais e recebe direto no seu endereço 0x... sem passar por corretora.'
            },
            {
                id: 'transak-pix-widget',
                name: 'Checkout PIX Direto (Transak On-Ramp)',
                badge: 'CARTÃO / PIX INSTANTÂNEO',
                noKyc: false,
                spreadPct: 1.45,
                fixedFeeBrl: 0.0,
                etaText: '1 a 3 min',
                url: `https://global.transak.com/?defaultPaymentMethod=pix&fiatCurrency=BRL&fiatAmount=${brl.toFixed(2)}&cryptoCurrencyCode=${targetSymbol}&network=${net.key}&walletAddress=${addr}`,
                note: 'Abre o QR Code PIX preenchendo automaticamente sua carteira e rede.'
            },
            {
                id: 'bipa-brz-pix',
                name: 'Bipa / Transfero BRZ via PIX',
                badge: 'SPREAD BAIXO PARA VALORES MENORES',
                noKyc: false,
                spreadPct: 1.15,
                fixedFeeBrl: 0.0,
                etaText: '3 a 8 min',
                url: 'https://bipa.app',
                note: 'Ideal para compras fracionadas (ex: R$ 50 a R$ 300) sem tarifa fixa de saque.'
            }
        ];

        return routes.map((r) => {
            const netBrl = Math.max(0, brl * (1 - r.spreadPct / 100) - r.fixedFeeBrl);
            const netTokens = tokenPriceBrl > 0 ? netBrl / tokenPriceBrl : 0;
            return {
                ...r,
                grossBrl: brl,
                netBrl,
                netTokens,
                targetSymbol,
                walletAddress: addr
            };
        }).sort((a, b) => b.netBrl - a.netBrl);
    }

    function rankPixCashoutRoutes({ symbol = 'USDT', amount = 50, chainId = 137, onlyNoKyc = false }) {
        const qty = parseFloat(amount);
        if (!Number.isFinite(qty) || qty <= 0) return [];

        const snap = global.RdeskVault?.getState();
        const fx = snap?.usdBrlRate || 5.65;
        const prices = snap?.pricesUsd || {};

        const unitUsd = prices[symbol] || 0;
        const grossUsd = qty * unitUsd;
        const grossBrl = grossUsd * fx;

        // Custo de conversão DEX na Polygon se o ativo ainda não for USDT/BRZ
        const needsDexSwap = symbol !== 'USDT' && symbol !== 'USDC' && symbol !== 'BRZ' && symbol !== 'BRLA';
        const dexSwapCostPct = needsDexSwap ? 0.08 : 0.0;

        const providers = [
            {
                id: 'nakpix-cupom',
                name: 'NakPix (c/ Cupom Parceiro)',
                noKyc: true,
                tag: '100% SEM KYC',
                spreadPct: 0.65,
                fixedFeeBrl: 0.0,
                eta: '~2 min',
                url: 'https://nakpix.com'
            },
            {
                id: 'depix-offramp',
                name: 'DePix / Ponte PIX Direta',
                noKyc: true,
                tag: '100% SEM KYC',
                spreadPct: 0.95,
                fixedFeeBrl: 0.0,
                eta: '~3 min',
                url: 'https://depix.info'
            },
            {
                id: 'pagfinance',
                name: 'PagFinance PIX',
                noKyc: true,
                tag: 'SEM KYC ATÉ LIMITE',
                spreadPct: 1.20,
                fixedFeeBrl: 0.0,
                eta: '~2 min',
                url: 'https://pagfinance.com'
            },
            {
                id: 'bipa-pix',
                name: 'Bipa (Saída PIX Grátis)',
                noKyc: false,
                tag: 'KYC • ZERO TAXA FIXA',
                spreadPct: 1.55,
                fixedFeeBrl: 0.0,
                eta: '~4 min',
                url: 'https://bipa.app'
            },
            {
                id: 'binance-pix',
                name: 'Binance Spot (PIX R$ 3,50 fixo)',
                noKyc: false,
                tag: 'KYC • TAXA FIXA R$ 3,50',
                spreadPct: 0.55,
                fixedFeeBrl: 3.50,
                eta: '~5 min',
                url: 'https://www.binance.com/pt-BR/fiat/withdraw/BRL'
            }
        ];

        const filtered = onlyNoKyc ? providers.filter((p) => p.noKyc) : providers;

        return filtered.map((p) => {
            const totalPctLoss = (dexSwapCostPct + p.spreadPct) / 100;
            const netBrl = Math.max(0, grossBrl * (1 - totalPctLoss) - p.fixedFeeBrl);
            const effectiveLossPct = grossBrl > 0 ? ((grossBrl - netBrl) / grossBrl) * 100 : 0;
            const smallAmountWarning = p.fixedFeeBrl > 0 && grossBrl < 350
                ? `Taxa fixa de R$ ${p.fixedFeeBrl.toFixed(2)} consome ${((p.fixedFeeBrl / Math.max(1, grossBrl)) * 100).toFixed(1)}% neste valor.`
                : '';

            return {
                ...p,
                symbol,
                amount: qty,
                chainId,
                grossBrl,
                netBrl,
                effectiveLossPct,
                smallAmountWarning
            };
        }).sort((a, b) => b.netBrl - a.netBrl);
    }

    global.RdeskGateway = {
        OWNER_TREASURY_ADDRESS,
        UNISWAP_V3_CONTRACTS,
        quoteBestSwapOrBridge,
        buildSwapReceiptPreview,
        executePreparedSwapOrBridge,
        evaluatePixBuyRoutes,
        rankPixCashoutRoutes
    };
})(window);
