# RDESK SENTINEL

Carteira de autocustódia no navegador, com várias contas, e piloto de liquidez Uniswap V3 (pool WPOL/USDT0 0,05% na Polygon) com faixa Sniper visível no gráfico.
Site 100% estático, sem servidor: **https://digitalrobertlima.github.io/price-monitoring/**

## O que funciona hoje

- **Carteiras:** criar (12 palavras, com prova de 3 palavras do backup), importar frase ou chave privada, conectar Rabby, endereço só de observação. Várias carteiras na lista, trocar com um toque, renomear, apagar.
- **Cofre:** tudo cifrado com AES-256-GCM (PBKDF2, 600 mil iterações) em `localStorage`, com cópia no IndexedDB. Senha mínima de 8 caracteres, bloqueio automático em 10 minutos. Ver a frase ou a chave exige digitar a senha de novo. Apagar uma carteira remove a chave do aparelho.
- **Biometria:** só em aparelhos com WebAuthn PRF (a chave nasce dentro do autenticador; nada fica guardado em claro). Onde não há PRF, a app avisa e continua com senha.
- **Render V3:** faixa Sniper calculada pela volatilidade (ATR), gráfico de velas com a faixa sugerida e a faixa de cada posição, medidor "preço dentro da faixa" por posição. Piloto automático abre a posição; depois dá para colher tarifas, rebalancear e encerrar.
- **Proteções em toda transação:** recibo em R$ antes de assinar, aprovações de valor exato, slippage de 1,5% calculado por simulação, 3 POL reservados para gás, e recusa de operar se o preço da pool divergir mais de 3% do mercado.
- **Várias redes:** Polygon, Ethereum, Base, Arbitrum, Optimism e Celo, além de **Bitcoin nativo** (endereço `bc1q…` derivado da mesma frase, BIP84). Moedas já cadastradas: POL, ETH, CELO, BTC, USDT, USDC, WETH, WBTC, BRZ e BRLA, cada uma com o contrato oficial visível para conferência e link para o explorador da rede.
- **Adicionar qualquer moeda:** cole o contrato e escolha a rede; a app lê nome, símbolo e casas decimais direto da blockchain. Moeda com símbolo igual a uma oficial ganha um sufixo para não confundir.
- **Receber e enviar:** escolha a rede, veja o QR e o endereço; ao enviar, a confirmação mostra rede, contrato da moeda e endereço inteiro. Enviar para o próprio contrato de uma moeda é bloqueado. Bitcoin com escolha de velocidade da taxa.
- **Leitor de QR Code** em todos os campos de endereço (câmera ou foto), entendendo `ethereum:` (com rede), `bitcoin:` (com valor) e endereço puro.
- **Botões de voltar** em todas as telas internas, e o voltar do celular fecha a janela sem sair do app.
- **Olho para esconder saldos:** esconde patrimônio, valores e quantidades; a escolha fica salva no aparelho.
- **Cotações em tempo real:** atualizadas a cada 10 s, com fontes de reserva para o dólar; quando nenhuma responde, a tela avisa que os valores são aproximados.
- **Troca:** Uniswap V3 na Polygon procurando a melhor tarifa e rotas em dois saltos (ex.: POL → USDT → BRLA numa só transação); bloqueia trocas que perderiam mais de 10% para o mercado. Seta de inverter troca rede, moeda e quantidade. Outras redes e pontes via LI.FI.
- **Ícones:** são selos gerados pela própria app (letra/símbolo e cor), não os logotipos oficiais.

## O que ainda NÃO está validado

- **Nenhuma transação foi testada na Polygon real nem em fork.** Os fluxos foram validados contra uma Polygon simulada (`tests/mock-chain.mjs`), que confere a lógica da app e as transações assinadas, não os contratos reais. Comece com valores pequenos.
- **Lightning não é suportado.** Receber e pagar por Lightning exige um nó ou um serviço custodiante, o que não cabe numa carteira estática de autocustódia. Pedidos `lnbc…` são recusados com explicação.
- Envio de Bitcoin e envios nas outras redes foram validados com vetores oficiais (BIP84/143/173/350) e redes simuladas, não com dinheiro real.
- Pontes entre redes (LI.FI), a aba Lucro Real (auditoria histórica) e o comparador PIX não têm testes.
- O comparador PIX usa taxas de referência escritas no código, não cotação ao vivo, e os provedores listados não foram verificados.
- O ganho estimado em R$/min é uma aproximação (volume de 24h e liquidez de referência).
- Não existe robô: nada acontece com a página fechada.

## Segurança: leia antes de guardar dinheiro

- Sem o backup em papel das palavras, limpar os dados do navegador significa perder a carteira.
- Use como **carteira operacional**, só com o valor que está nas pools.
- O endereço `github.io` é compartilhado por todos os repositórios publicados da conta: outra página sua publicada ali consegue ler o armazenamento desta.
- Nenhum script de terceiros é carregado (bibliotecas em `vendor/` com hash de integridade, política CSP `script-src 'self'`). As fontes vêm do Google Fonts.

## Arquivos

| Arquivo | Papel |
|---|---|
| `index.html`, `styles.css` | Interface (4 abas: Carteira, Render V3, PIX & Trocas, Lucro Real) |
| `registry.js` | Redes, moedas, contratos, moedas adicionadas, selos |
| `bitcoin.js` | Bitcoin nativo: endereço, montagem e assinatura da transação |
| `qr-scanner.js` | Leitor de QR Code (câmera ou foto) |
| `wallet-views.js` | Telas de receber, enviar, detalhe da moeda e adicionar moeda |
| `wallet-service.js` | Cofre, gerenciador de carteiras, biometria, redes, saldos, cotações, assinatura |
| `defi-pix-service.js` | Faixa Sniper, piloto automático, posições, trocas, comparador PIX, auditoria |
| `range-chart.js` | Gráfico de preço com as faixas (canvas próprio) |
| `app.js` | Navegação, ajuda, PWA |
| `vendor/` | ethers 5.7.2, Chart.js 4.4.1, QRCode 1.0.0, jsQR 1.4.0 |
| `tests/` | Testes automáticos |

## Testes

```bash
npm install && npx playwright install chromium
npm test            # Bitcoin (vetores oficiais) + carteiras + fluxo de dinheiro + várias redes/QR/olho, tudo simulado, sem internet
npm run test:smoke  # rede real: saldo, cotações, contratos de todas as moedas, cotações de troca (precisa de internet)
```

Regra do projeto: nenhuma mudança entra na `main` sem `npm test` passando.

## Origem do design

A interface vem da branch `v23-superapp` (commit `ede58c2`, com o `styles.css` do commit `803fa7b`), que tinha o gerenciador de carteiras e a aba Render V3. As demais branches ficam como arquivo.

Licença MIT.
