# Caixa Forte (RDESK)

**White paper · versão 1.0 (beta) · novembro de 2026**

> **Aviso.** A Caixa Forte é uma carteira de **autocustódia** em beta. Ela não guarda o seu dinheiro: quem guarda
> é você, com as suas palavras. Não houve auditoria externa. Use valores pequenos, guarde as palavras em papel e
> leia a seção de riscos. Este documento não é oferta de investimento nem aconselhamento jurídico ou financeiro.

---

## Sumário

1. [Resumo](#1-resumo)
2. [O problema](#2-o-problema)
3. [Princípios](#3-princípios)
4. [Arquitetura](#4-arquitetura)
5. [O cofre: como a chave é protegida](#5-o-cofre-como-a-chave-é-protegida)
6. [Redes e moedas](#6-redes-e-moedas)
7. [Enviar, receber e confirmar](#7-enviar-receber-e-confirmar)
8. [Trocas e melhor rota](#8-trocas-e-melhor-rota)
9. [Fundos da Uniswap](#9-fundos-da-uniswap)
10. [Bitcoin nativo e pontes](#10-bitcoin-nativo-e-pontes)
11. [App Android com Tor embutido](#11-app-android-com-tor-embutido)
12. [Apps dentro da carteira (BRLS)](#12-apps-dentro-da-carteira-brls)
13. [Extrato, lucro e régua](#13-extrato-lucro-e-régua)
14. [Educação: Duda e Bit](#14-educação-duda-e-bit)
15. [Modelo econômico](#15-modelo-econômico)
16. [Segurança](#16-segurança)
17. [Privacidade](#17-privacidade)
18. [Riscos e limites](#18-riscos-e-limites)
19. [Testes](#19-testes)
20. [Roteiro](#20-roteiro)

---

## 1. Resumo

A **Caixa Forte** é uma carteira de cripto para o brasileiro comum, que roda no navegador (PWA) e como app
Android. A chave nasce e fica no aparelho, cifrada. A carteira cobre várias redes (Polygon, Ethereum, Base,
Arbitrum, Optimism, Celo) e **Bitcoin nativo**, faz trocas na Uniswap pela melhor rota, administra posições de
liquidez e abre apps parceiros — como o **BRLS (Real Soberano)** — sem nunca entregar a chave a eles. No
Android, toda a comunicação passa pela rede **Tor**, embutida no próprio app.

## 2. O problema

- Carteiras custodiais podem bloquear saldos e exigem confiança na empresa.
- Carteiras de autocustódia costumam ser difíceis: jargão, telas cheias, risco de erro ao enviar.
- Cada consulta à blockchain revela, a quem responde, qual endereço é seu e de onde você acessa.
- Apps de cripto pedem a chave ou uma aprovação infinita de tokens, abrindo brecha para perdas.

## 3. Princípios

1. **Sua chave, seu dinheiro.** Nada de custódia, nada de servidor próprio.
2. **Pouca coisa por tela e linguagem simples.** Sem "gás", "seed" ou "pool" na tela principal.
3. **Confirmar dinheiro é sério.** Todo envio é "deslize até o fim", com recibo em reais antes.
4. **Privacidade por padrão no Android** (Tor), e nenhum script de terceiros no app.
5. **Proteções que não dependem da atenção da pessoa:** aprovação de valor exato, simulação, limites de perda.

## 4. Arquitetura

- **Site 100% estático** (GitHub Pages): HTML, CSS e JavaScript próprios; bibliotecas em `vendor/` com hash de
  integridade (ethers 5.7.2, Chart.js, QRCode, jsQR); CSP `script-src 'self'`.
- **Atualização forçada:** o app confere a versão (`version.js`) ao abrir, ao voltar e a cada 5 min, e se
  atualiza sozinho (nunca no meio de uma transação).
- **Android:** WebView endurecido (`SecureWebView`), arquivos servidos de dentro do APK, ponte nativa mínima
  (`Bridge`) e Tor (`tor-android` do Guardian Project) como único caminho de rede.

## 5. O cofre: como a chave é protegida

- Frase de 12 palavras (BIP-39) criada pelo app, com conferência de 3 palavras do backup; importa frase ou
  chave privada, conecta Rabby, ou adiciona endereço só de observação. Várias carteiras na mesma Caixa Forte.
- Tudo cifrado com **AES-256-GCM**, chave derivada da senha com **PBKDF2 (600 mil iterações)**; cópia no
  IndexedDB.
- **Biometria só com WebAuthn PRF:** a chave nasce dentro do autenticador; nada fica em claro.
- Bloqueio automático; ver a frase exige a senha de novo; tentativas erradas fazem esperar (30 s, dobrando até
  1 h), mesmo recarregando.
- O cofre recusa abrir dentro de moldura (iframe) de outro site.

## 6. Redes e moedas

- EVM: Polygon, Ethereum, Base, Arbitrum, Optimism, Celo (e testnets num cofre separado, "modo teste").
- Bitcoin nativo (`bc1q…`, BIP84), derivado da mesma frase.
- Moedas cadastradas com o contrato oficial visível (POL, ETH, BTC, USDT, USDC, WETH, WBTC, BRZ, BRLA, BRLS…);
  qualquer outra moeda pode ser adicionada colando o contrato (o app lê nome, símbolo e casas da blockchain e
  marca símbolos repetidos para não confundir).

## 7. Enviar, receber e confirmar

- Receber: QR e endereço por rede. Enviar: a confirmação mostra rede, contrato da moeda e endereço inteiro;
  enviar para o próprio contrato de uma moeda é bloqueado. Leitor de QR em todo campo de endereço.
- **Deslizar para confirmar:** a trilha trava em "Enviando…" até a rede responder, uma confirmação por vez, e
  um pedido igual nos últimos 3 min mostra aviso antes (proteção contra envio duplicado).
- Recibo em R$ antes de assinar; 3 POL reservados para a taxa da rede.

## 8. Trocas e melhor rota

- Uniswap V3 na Polygon. O app lê na fábrica oficial quais fundos existem **e têm dinheiro** entre as moedas
  da troca e as moedas-ponte (WPOL, USDT, USDC, USDC.e, WETH, BRZ, BRLA, BRL1, BRLS, DAI, WBTC), cota todos os
  caminhos de até 3 trocas e usa o que paga mais (cada troca a mais precisa compensar 0,3%). Fundo novo aparece
  sozinho.
- Bloqueia trocas que perderiam mais de 10% para o mercado e avisa quando a melhor rota está abaixo do mercado.
- Slippage calculado por simulação; aprovações sempre do valor exato.
- Pelo Tor, pergunta só aos servidores que estão respondendo e espera mais, para não travar em "buscando rota".

## 9. Fundos da Uniswap

- Minhas posições em todas as redes: colocar mais, tirar uma parte ou tudo, colher tarifas, mudar a faixa,
  outra posição no mesmo fundo, ver na Uniswap.
- Piloto automático: faixa sugerida pela volatilidade (ATR), gráfico de velas interativo com a faixa.
- Recusa operar se o preço do fundo divergir mais de 3% do mercado; simula antes de assinar e explica o motivo
  de falhas em português.

## 10. Bitcoin nativo e pontes

- Envio de Bitcoin com escolha de velocidade da taxa, já em reais.
- Trocas entre Bitcoin e as outras redes pela LI.FI. Antes de assinar, o app confere a rota (contrato oficial,
  valor, origem e destino) e o PSBT recebido (moedas suas, depósito no endereço cotado, troco de volta, taxa
  razoável). O recibo avisa que, por ~25 min, o valor fica com o serviço de ponte.
- Lightning não é suportado (exigiria nó ou custódia).

## 11. App Android com Tor embutido

- APK gerado e testado num emulador pelo GitHub Actions, sem Play Store.
- **Toda a rede passa pelo Tor**; se o Tor cair, nada sai. Um teste automático no emulador verifica que nenhum
  domínio é contatado fora do Tor.
- O WebView não tem internet direta: cada pedido passa pela ponte nativa (`TorNet`).
- Não envia métricas do WebView nem consulta o Safe Browsing; sem backup em nuvem.
- **Plantão do BRLS:** durante corrida, motorista online ou loja recebendo pedidos, um aviso fixo e visível
  mantém o app vivo em segundo plano para avisar pedido novo, motorista a caminho etc. Some quando acaba.
- Abrir um ponto no Waze, Google Maps ou GPS do celular, e "Estou aqui" no mapa (localização lida no aparelho,
  nunca enviada), só para o BRLS e com permissão do Android.

## 12. Apps dentro da carteira (BRLS)

Apps parceiros abrem numa janela da Caixa Forte e usam a carteira ativa **sem receber a chave**:

- O app só pode **pedir**. Toda transação ou assinatura abre a confirmação da Caixa Forte (o que o app pede,
  em qual contrato, quanto POL sai, a taxa máxima).
- A ponte (`apps.js`) só conversa com a janela do app aberto e com a origem cadastrada, só na Polygon, e recusa
  pedido em nome de outra carteira, assinatura para outra rede e qualquer método fora da lista.
- Conversa cifrada do BRLS: a Caixa Forte calcula o segredo compartilhado (ECDH) e devolve só o resultado.
- No APK, o BRLS vem dentro do app (commit fixo em `android/brls.txt`) e toda a rede dele passa pela Caixa
  Forte, pelo Tor (imagens do mapa incluídas).

## 13. Extrato, lucro e régua

- Extrato de todas as transações da Polygon, em linguagem simples, agrupado por dia.
- Moeda de referência (régua): Real (BRLS) por padrão; ou Bitcoin, Dólar, Ether.
- Lucro desde a 1ª transação e gráfico do patrimônio reconstruído dia a dia com os preços de cada dia.

## 14. Educação: Duda e Bit

Lições curtas antes de mexer no dinheiro: o que é dinheiro, inflação, Bitcoin, a chave e o cofre, como
receber, golpes, fundos e Pix — com personagens, voz do próprio celular e uma ação real no fim de cada lição.

## 15. Modelo econômico

- A carteira é gratuita. Existe uma **taxa do criador pronta e desligada** (`rateBps: 0`), com teto fixo de 1%,
  que só poderia incidir em trocas e no rendimento colhido de fundos — nunca em enviar ou receber — e sempre
  aparece no recibo antes de confirmar.
- Não há venda de dados nem publicidade.

## 16. Segurança

- Revisão completa de segurança na v42, com verificação de cada correção em `tests/seguranca.mjs`.
- Aprovações de valor exato, simulação antes de assinar, conferência de rotas e PSBT, bloqueio de envio ao
  contrato da própria moeda, limites de perda em trocas e fundos.
- Nenhum script de terceiros; fontes no próprio site.
- **Pendente:** auditoria externa e programa de recompensa por falhas.

## 17. Privacidade

- No Android: Tor obrigatório, nada de tráfego fora dele.
- Sem analytics nem rastreadores.
- Plano de privacidade avançada (um circuito por endereço, clientes leves, mixnet) em `docs/apk-privado.md`.

## 18. Riscos e limites

- **Sem as palavras em papel, limpar os dados do navegador ou perder o celular significa perder a carteira.**
- Beta sem auditoria externa; várias trocas e pontes foram validadas em redes simuladas antes do uso real.
- O endereço `github.io` é compartilhado por todos os repositórios publicados da conta.
- Redes "jovens" (todas exceto Bitcoin e Ethereum) servem para movimentar, não para guardar tudo.
- Serviços de terceiros (RPCs, LI.FI, Uniswap, Tor) podem ficar lentos ou indisponíveis.
- Não existe robô: nada acontece com a página fechada (no Android, só o plantão do BRLS, sempre visível).

## 19. Testes

- `npm test`: Bitcoin (vetores oficiais), carteiras, dinheiro, várias redes, QR, experiência, deslizar,
  rotas, fundos e a ponte de apps — tudo contra redes simuladas.
- `npm run test:smoke`: leitura da rede real (saldos, cotações, contratos).
- APK: emulador no GitHub Actions, com teste de vazamento de rede fora do Tor e abertura do BRLS pela ponte.

## 20. Roteiro

- **Agora (beta):** uso real com valores pequenos, BRLS dentro do APK, avisos com o app em segundo plano.
- **Antes de divulgação ampla:** auditoria externa, recompensa por falhas, termos de uso.
- **Depois:** um circuito Tor por endereço, cliente leve (Helios/Kyoto), assinatura sem internet (BC-UR/PSBT).

Licença: MIT.
