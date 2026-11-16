# RDESK SENTINEL

Carteira de autocustódia no navegador com piloto de liquidez Uniswap V3 (pool WPOL/USDT0 0,05% na Polygon).
Site 100% estático, sem servidor: **https://digitalrobertlima.github.io/price-monitoring/**

## O que funciona hoje

- **Cofre local:** cria ou importa uma frase de 12/24 palavras, cifrada com AES-256-GCM (PBKDF2, 600 mil iterações) e guardada em `localStorage` + IndexedDB. Senha mínima de 8 caracteres, bloqueio automático em 10 minutos.
- **Leitura:** saldos em 5 redes, cotações em R$, posições Uniswap V3 da carteira.
- **Piloto Uniswap V3 (Polygon):** calcula a faixa Sniper, converte o saldo, abre a posição, colhe tarifas, rebalanceia e saca. Toda operação mostra um recibo em R$ antes de assinar, usa aprovações de valor exato, proteção de slippage de 1,5% e mantém 3 POL de reserva para gás.
- **Carteira externa:** Rabby/MetaMask via extensão, ou modo "apenas observar" com um endereço `0x`.

## O que ainda NÃO está validado

- Nenhuma transação foi testada na Polygon real nem em fork. O fluxo foi validado contra uma **Polygon simulada** (`tests/mock-chain.mjs`), que confere a lógica da app e as transações assinadas, não os contratos reais. **Comece com valores pequenos.**
- Trocas entre redes (LI.FI), ranking PIX e auditoria histórica não têm testes.
- Não existe biometria. Não existe robô: nada acontece com a página fechada.

## Segurança: leia antes de guardar dinheiro

- A frase fica cifrada **neste navegador**. Sem o backup em papel das palavras, limpar os dados do navegador significa perder a carteira.
- Use o cofre como **carteira operacional**, só com o valor que está nas pools.
- O endereço `github.io` é compartilhado por todos os repositórios publicados da conta: outra página sua publicada ali consegue ler o armazenamento desta.
- O gráfico de velas ainda é carregado de um CDN externo (`unpkg.com`). As demais bibliotecas estão em `vendor/` com hash de integridade.

## Arquivos

| Arquivo | Papel |
|---|---|
| `index.html`, `styles.css` | Interface |
| `vault-core.js` | Cofre, redes, saldos, cotações, assinatura |
| `gateway-pix.js` | Cotação e execução de trocas (Uniswap V3, LI.FI) |
| `sentinel-engine.js` | Faixa Sniper, piloto automático, posições, telas |
| `ledger-advisor.js` | Auditoria de aportes e patrimônio |
| `vendor/` | ethers 5.7.2, Chart.js 4.4.1, QRCode 1.0.0 |
| `tests/` | Testes automáticos |

## Testes

```bash
npm install && npx playwright install chromium
npm test            # interface do cofre + fluxo de pool na Polygon simulada (sem internet)
npm run test:smoke  # página, cofre e leitura de saldos contra a Polygon real (precisa de internet)
```

Regra do projeto: nenhuma mudança entra na `main` sem `npm test` passando.

Licença MIT.
