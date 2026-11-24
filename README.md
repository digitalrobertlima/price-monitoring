# RDESK

Carteira de autocustódia no navegador, com várias contas, e piloto de liquidez Uniswap V3 (pool WPOL/USDT0 0,05% na Polygon) com faixa Sniper visível no gráfico.
Site 100% estático, sem servidor: **https://digitalrobertlima.github.io/price-monitoring/**

## Como o app foi desenhado

O redesenho de novembro/2026 segue o que a pesquisa de usabilidade mostra:

- **Pouca coisa por tela.** A tela inicial tem só o saldo, três ações (Receber, Enviar, Trocar) e a lista de moedas. O resto aparece quando a pessoa precisa (filtros, contratos, endereço técnico).
- **Linguagem simples.** Sem "gás", "pool", "seed" ou "Sniper" na tela principal; quando o termo é necessário, vem explicado ("rede é o caminho por onde a moeda viaja").
- **Zona do polegar.** Navegação e botões principais na parte de baixo, alvos de toque grandes.
- **Ajuda na hora certa.** Boas-vindas curtas (3 cartões) só na primeira abertura, "Primeiros passos" com progresso na tela inicial e uma dica curta na primeira vez em cada tela. Dá para rever em Menu → "Rever o tutorial".
- **Fim marcante.** Envio, troca e render concluídos mostram uma comemoração curta.
- **Controle total no Render.** O gráfico responde ao toque (arrastar, pinça, tocar para ver o preço) e a faixa tem alças azuis para arrastar; também dá para digitar mínimo e máximo ou usar os atalhos Estreita/Média/Larga.
- Sem Pix: a carteira não transaciona em Pix, e a interface não sugere isso.
- **Extrato:** todas as transações da rede Polygon desde a primeira, agrupadas por dia e em linguagem simples (Recebeu, Enviou, Trocou, Colocou para render…). Cada linha abre o detalhe, o link do explorador e a opção de mudar como ela entra na conta do lucro.
- **Moeda de referência (régua):** Bitcoin por padrão; dá para trocar por Real (BRZ), Dólar ou Ether. O lucro, o gráfico e a variação de 24 h de cada moeda são medidos nela.
- **Gráfico do patrimônio na tela inicial:** reconstruído dia a dia com os preços de cada dia, com entradas e saídas marcadas; o último ponto é o valor ao vivo.
- **Lucro desde a 1ª transação:** tem hoje + tudo que você tirou − tudo que você colocou, cada valor convertido pela cotação do dia em que aconteceu.

## O que funciona hoje

- **Carteiras:** criar (12 palavras, com prova de 3 palavras do backup), importar frase ou chave privada, conectar Rabby, endereço só de observação. Várias carteiras na lista, trocar com um toque, renomear, apagar.
- **Cofre:** tudo cifrado com AES-256-GCM (PBKDF2, 600 mil iterações) em `localStorage`, com cópia no IndexedDB. Senha mínima de 8 caracteres, bloqueio automático em 10 minutos. Ver a frase ou a chave exige digitar a senha de novo. Apagar uma carteira remove a chave do aparelho.
- **Biometria:** só em aparelhos com WebAuthn PRF (a chave nasce dentro do autenticador; nada fica guardado em claro). Onde não há PRF, a app avisa e continua com senha.
- **Render V3:** faixa Sniper calculada pela volatilidade (ATR), gráfico de velas com a faixa sugerida e a faixa de cada posição, medidor "preço dentro da faixa" por posição. Piloto automático abre a posição; depois dá para colher tarifas, rebalancear e encerrar.
- **Proteções em toda transação:** recibo em R$ antes de assinar, aprovações de valor exato, slippage de 1,5% calculado por simulação, 3 POL reservados para gás, e recusa de operar se o preço da pool divergir mais de 3% do mercado.
- **Várias redes:** Polygon, Ethereum, Base, Arbitrum, Optimism e Celo, além de **Bitcoin nativo** (endereço `bc1q…` derivado da mesma frase, BIP84). Moedas já cadastradas: POL, ETH, CELO, BTC, USDT, USDC, WETH, WBTC, BRZ e BRLA, cada uma com o contrato oficial visível para conferência e link para o explorador da rede.
- **Adicionar qualquer moeda:** cole o contrato e escolha a rede; a app lê nome, símbolo e casas decimais direto da blockchain. Moeda com símbolo igual a uma oficial ganha um sufixo para não confundir.
- **Aprender com a Duda e o Bit:** uma aba própria e a primeira abertura do app ensinam o básico antes de mexer no dinheiro: o que é dinheiro, por que tudo fica mais caro, o que é o Bitcoin, a chave e o cofre, como receber, redes novas, golpes, render e Pix. A Duda (guia) e o Bit (uma moeda de Bitcoin) conversam com voz do próprio celular, em personagens desenhados em camadas que viram 3D ao inclinar. Cada lição tem desenho animado, pergunta para tocar e termina numa ação real no app.
- **Atualização forçada:** o app confere sem cache (`version.js`) se existe versão nova ao abrir, ao voltar para a tela e a cada 5 minutos, e se atualiza sozinho (nunca no meio de uma transação). A cada publicação, aumente o número em `version.js`.
- **Comprar com Pix (pronto, "Em breve"):** tela e servidor prontos para o Mercado Pago. Veja `server/LEIAME.md`.
- **O cofre:** trancado, o app mostra só a porta de um cofre em 3D (sem saldo, sem botões). "Abrir" pede a digital ou a senha; a roda gira, a maçaneta destrava e a porta abre revelando o app. Ao trancar, a porta fecha.
- **Criar o cofre em 4 passos visuais:** o que é a chave (12 palavras que o app cria; você não escolhe), ver a chave (escondida até tocar), conferir (3 perguntas "qual é a palavra nº X?") e proteger (senha deste celular + digital). No fim, a porta do cofre abre comemorando.
- **Bitcoin no centro:** o Bitcoin vem primeiro em tudo (lista de moedas, receber, troca) e é a cor da marca (laranja). Cada rede mostra um selo de maturidade: Bitcoin "a mais consolidada, desde 2009", Ethereum "consolidada, desde 2015" e as demais "rede jovem", com aviso para usar essas redes para movimentar e não para guardar tudo. O Render avisa que roda na Polygon.
- **Segurança das rotas:** antes de mostrar o recibo, o app confere a resposta da LI.FI: contrato oficial, valor, carteira de origem e endereço de destino. Rota adulterada é recusada.
- **Trocar Bitcoin dentro do app:** BTC nativo ⇄ moedas das outras redes, nos dois sentidos, pela LI.FI (que escolhe o serviço: LayerSwap, Relay…). Antes de assinar, o app confere o PSBT recebido: as moedas gastas são suas, o depósito vai para o endereço e valor cotados, existe a anotação da troca, o troco volta para você e a taxa não é absurda. O recibo mostra a taxa da rede (sat e R$), a taxa do serviço em R$ e o aviso de que, durante ~25 min, o valor fica com o serviço de ponte.
- **Receber e enviar:** escolha a rede, veja o QR e o endereço; ao enviar, a confirmação mostra rede, contrato da moeda e endereço inteiro. Enviar para o próprio contrato de uma moeda é bloqueado. Bitcoin com escolha de velocidade da taxa, cada uma já com o valor estimado em reais.
- **Leitor de QR Code** em todos os campos de endereço (câmera ou foto), entendendo `ethereum:` (com rede), `bitcoin:` (com valor) e endereço puro.
- **Botões de voltar** em todas as telas internas, e o voltar do celular fecha a janela sem sair do app.
- **Olho para esconder saldos:** esconde patrimônio, valores e quantidades; a escolha fica salva no aparelho.
- **Cotações em tempo real:** atualizadas a cada 10 s, com fontes de reserva para o dólar; quando nenhuma responde, a tela avisa que os valores são aproximados.
- **Troca:** Uniswap V3 na Polygon procurando a melhor tarifa e rotas em dois saltos (ex.: POL → USDT → BRLA numa só transação); bloqueia trocas que perderiam mais de 10% para o mercado. Seta de inverter troca rede, moeda e quantidade. Outras redes e pontes via LI.FI.
- **Ícones:** são selos gerados pela própria app (letra/símbolo e cor), não os logotipos oficiais.

## Taxa do criador (pronta e desligada)
Fica em `registry.js` (`CREATOR_FEE`). Vem com `rateBps: 0`, ou seja, desligada. Para ligar:
1. `rateBps`: 20 = 0,2% (limite máximo fixo de 1%; acima disso o app ignora e desliga).
2. `evmAddress`: a carteira 0x que recebe nas trocas da Uniswap e no Render.
3. Nas rotas da LI.FI (entre redes e Bitcoin) a taxa vai para a carteira cadastrada no portal da LI.FI para o integrador `rdesk-sentinel`.

Só cobra onde o app agrega valor: trocas (sobre o valor trocado) e Render (só sobre o que rendeu, ao colher). Nunca em enviar, receber ou Pix. Sempre aparece no recibo, em reais, antes de confirmar.

## O que ainda NÃO está validado

- **Nenhuma transação foi testada na Polygon real nem em fork.** Os fluxos foram validados contra uma Polygon simulada (`tests/mock-chain.mjs`), que confere a lógica da app e as transações assinadas, não os contratos reais. Comece com valores pequenos.
- **Lightning não é suportado.** Receber e pagar por Lightning exige um nó ou um serviço custodiante, o que não cabe numa carteira estática de autocustódia. Pedidos `lnbc…` são recusados com explicação.
- A troca de Bitcoin foi validada com rede e serviço simulados e com PSBT real da LI.FI (só conferência, sem assinar); ainda não com dinheiro real.
- Envio de Bitcoin e envios nas outras redes foram validados com vetores oficiais (BIP84/143/173/350) e redes simuladas, não com dinheiro real.
- Pontes entre redes (LI.FI) não têm teste automático completo.
- O extrato e o gráfico usam o histórico da rede Polygon; as outras redes e o Bitcoin aparecem no saldo e entram no gráfico a partir do dia de hoje.
- O ganho estimado em R$/min é uma aproximação (volume de 24h e liquidez de referência).
- Não existe robô: nada acontece com a página fechada.

## Segurança: leia antes de guardar dinheiro

- Sem o backup em papel das palavras, limpar os dados do navegador significa perder a carteira.
- Use como **carteira operacional**, só com o valor que está nas pools.
- O endereço `github.io` é compartilhado por todos os repositórios publicados da conta: outra página sua publicada ali consegue ler o armazenamento desta.
- Nenhum script de terceiros é carregado (bibliotecas em `vendor/` com hash de integridade, política CSP `script-src 'self'`). As fontes ficam no próprio site (`fonts/`).
- PIN/senha: 5 tentativas livres; depois o app faz esperar (30 s, dobrando até 1 h), mesmo recarregando a página. Um PIN de 6 números protege de quem pega o celular; contra quem copia os arquivos do aparelho, uma senha longa é mais forte.
- O cofre se recusa a funcionar dentro de moldura (iframe) de outro site, e "Apagar tudo" apaga só os dados deste app.
- Revisão completa de segurança na v42; cada correção tem verificação em `tests/seguranca.mjs`.

## Arquivos

| Arquivo | Papel |
|---|---|
| `index.html`, `styles.css` | Interface (4 abas: Início, Trocar, Render, Resultados) |
| `registry.js` | Redes, moedas, contratos, moedas adicionadas, selos |
| `bitcoin.js` | Bitcoin nativo: endereço, montagem e assinatura da transação |
| `qr-scanner.js` | Leitor de QR Code (câmera ou foto) |
| `onboarding.js` | Boas-vindas, primeiros passos, dicas na primeira vez, menu e explicações |
| `history.js` | Histórico, extrato, resultado, gráfico do patrimônio e moeda de referência |
| `wallet-views.js` | Telas de receber, enviar, detalhe da moeda e adicionar moeda |
| `wallet-service.js` | Cofre, gerenciador de carteiras, biometria, redes, saldos, cotações, assinatura |
| `defi-pix-service.js` | Faixa sugerida e faixa própria, render (Uniswap), posições, trocas, resultados |
| `range-chart.js` | Gráfico de preço com as faixas (canvas próprio) |
| `app.js` | Navegação, ajuda, PWA |
| `vendor/` | ethers 5.7.2, Chart.js 4.4.1, QRCode 1.0.0, jsQR 1.4.0 |
| `tests/` | Testes automáticos |

## Testes

```bash
npm install && npx playwright install chromium
npm test            # Bitcoin (vetores oficiais) + carteiras + dinheiro + várias redes/QR/olho + experiência (tutorial, gráfico, faixa), tudo simulado
npm run test:smoke  # rede real: saldo, cotações, contratos de todas as moedas, cotações de troca (precisa de internet)
```

Regra do projeto: nenhuma mudança entra na `main` sem `npm test` passando.

## Próximo grande passo

- **App Android com Tor embutido (v46)**: APK gerado e testado num emulador pelo GitHub Actions, sem Play Store. Baixe em `releases/download/android/rdesk.apk`. Detalhes em [`docs/app-android.md`](docs/app-android.md).
- **APK privado**: Tor embutido, um caminho por endereço, nada sai se o Tor cair. Pesquisa e plano em [`docs/apk-privado.md`](docs/apk-privado.md).
- **Token do criador com relayer** (enviar sem moeda da rede, como um Pix): o app já está preparado. Ver [`docs/token-e-relayer.md`](docs/token-e-relayer.md).

## Ideias para o futuro (ainda não implementadas)

- **Tornado Cash em todas as redes**: só ideia, sem data. Antes de qualquer integração: rever o status jurídico. As sanções dos EUA foram retiradas em março de 2025, mas o processo criminal contra um dos desenvolvedores segue aberto (novo julgamento marcado para abril de 2027). Também é preciso entender o risco para quem opera e cobra taxa no app.
- **Assinatura sem internet compatível com outras carteiras** (QR animado no padrão BC-UR / PSBT).
- **Juntar moedas Bitcoin** de vários endereços com cuidado de privacidade.

## Origem do design

A interface vem da branch `v23-superapp` (commit `ede58c2`, com o `styles.css` do commit `803fa7b`), que tinha o gerenciador de carteiras e a aba Render V3. As demais branches ficam como arquivo.

Licença MIT.
