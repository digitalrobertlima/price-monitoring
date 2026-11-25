# Modo teste (testnets)

Menu → **🧪 Modo teste**. O app inteiro passa a usar as redes de teste; as moedas são de graça e não valem nada.

| Rede | ID | Moedas | Faucet |
|---|---|---|---|
| Polygon Amoy | 80002 | POL, USDC de teste (Circle) | faucet.polygon.technology |
| Sepolia (Ethereum) | 11155111 | ETH, USDC de teste | Google Cloud Web3 faucet |
| Base Sepolia | 84532 | ETH, USDC de teste | Alchemy |
| Arbitrum Sepolia | 421614 | ETH, USDC de teste | Alchemy |
| OP Sepolia | 11155420 | ETH, USDC de teste | console.optimism.io |
| Celo Sepolia | 11142220 | CELO | faucet.celo.org |
| BNB testnet | 97 | BNB | bnbchain.org |
| HyperEVM testnet | 998 | HYPE | app.hyperliquid-testnet.xyz |
| Bitcoin testnet4 | — | BTC de teste (`tb1…`, `m/84'/1'/…`) | mempool.space/testnet4/faucet |
| Dash testnet | — | DASH de teste (`y…`, `m/44'/1'/…`) | testnet-faucet.dash.org |

## Como funciona
- **Cofre separado.** Tudo que o app guarda no aparelho fica com o prefixo `rdeskT_` (`modo-teste.js` troca as chaves do `localStorage` e o nome do banco do IndexedDB). O cofre real não é lido nem alterado; ao sair, ele volta exatamente como estava (conferido em `tests/modo-teste.mjs`).
- **Sem valor.** Preço zero para tudo: o total em R$ fica em R$ 0,00 e cada moeda mostra "teste · sem valor".
- **Proteção.** No modo teste o app recusa endereço Bitcoin/Dash da rede principal, e na rede principal recusa endereço de teste.
- **Desligado no modo teste:** trocas, Pix, fundos (render), pagador de taxas, histórico detalhado da Polygon, digital (a chave no chip é a do cofre real) e o Bitcoin sem servidor (Kyoto).
- **Servidores** conferidos pelo workflow *Saldos pelo Tor* (`tools/saldos-pelo-tor.mjs`), inclusive os endereços de USDC de teste lidos na própria rede.
