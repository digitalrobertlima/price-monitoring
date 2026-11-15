# 🛡️ RDESK SENTINEL — Autocustódia, Pools Uniswap V3, PIX Líquido & Auditoria Real

> ### 🌐 SITE OFICIAL PARA USAR O PROJETO:
> ### 👉 **[https://digitalrobertlima.github.io/price-monitoring/](https://digitalrobertlima.github.io/price-monitoring/)**

![Arquitetura](https://img.shields.io/badge/Arquitetura-100%25%20Client--Side%20(Zero%20Backend)-00e676?style=flat-square)
![Segurança](https://img.shields.io/badge/Cofre-AES--256--GCM%20%2B%20Biometria%20WebAuthn-38bdf8?style=flat-square)
![DeFi](https://img.shields.io/badge/DeFi-Uniswap%20V3%20%2B%20LI.FI%20Multi--Chain-eab308?style=flat-square)
![PWA](https://img.shields.io/badge/App-Android%20%26%20Windows%20PWA-10b981?style=flat-square)
![Licença](https://img.shields.io/badge/Licença-MIT-white?style=flat-square)

O **RDESK SENTINEL** é uma carteira Web3 de autocustódia completa e aplicativo financeiro descentralizado que roda **100% no seu navegador** — sem servidores intermediários, sem cadastro, sem coleta de dados e com código aberto auditável.

Ele reúne em uma única interface limpa (estilo banco digital moderno) tudo o que você precisa para guardar, movimentar, fazer render e auditar suas criptomoedas em **Reais (`R$`)** e **Dólares (`US$`)**.

---

## 🧭 Sumário

* **Parte 1 — Para Todos os Usuários (Sem Conhecimento Técnico)**
  1. [O que o RDESK SENTINEL faz por você?](#-1-o-que-o-rdesk-sentinel-faz-por-você)
  2. [Como acessar ou instalar no Celular e PC](#-2-como-acessar-ou-instalar-no-celular-e-pc)
  3. [Passo a Passo das 4 Telas do Aplicativo](#-3-passo-a-passo-das-4-telas-do-aplicativo)
  4. [Segurança e Biometria Explicadas de Forma Simples](#-4-segurança-e-biometria-explicadas-de-forma-simples)
* **Parte 2 — Documentação Ultra-Técnica (Desenvolvedores & Auditores Web3)**
  5. [Arquitetura de Software & Mapa dos 7 Módulos](#-5-arquitetura-de-software--mapa-dos-7-módulos)
  6. [Criptografia do Cofre BIP-39 & Biometria WebAuthn](#-6-criptografia-do-cofre-bip-39--biometria-webauthn)
  7. [Descoberta Multi-Carteira EIP-6963 & Fluxo Rabby Mobile](#-7-descoberta-multi-carteira-eip-6963--fluxo-rabby-mobile)
  8. [Motor Uniswap V3, Matemática de Liquidez & Proteções Anti-MEV](#-8-motor-uniswap-v3-matemática-de-liquidez--proteções-anti-mev)
  9. [Roteamento Cross-Chain (LI.FI) & Comparador PIX Líquido](#-9-roteamento-cross-chain-lifi--comparador-pix-líquido)
  10. [Auditoria Forense Contábil desde a 1ª Transação](#-10-auditoria-forense-contábil-desde-a-1ª-transação)
  11. [Execução Local, Desenvolvimento & Contribuição](#-11-execução-local-desenvolvimento--contribuição)

---

# PARTE 1 — Guia Completo para Usuários

## 🌟 1. O que o RDESK SENTINEL faz por você?

A maioria das plataformas cripto obriga você a escolher entre deixar seu dinheiro preso em corretoras ou usar sites técnicos cheios de gráficos confusos. O **RDESK SENTINEL** resolve isso unindo **4 ferramentas essenciais** em um só lugar:

* **💳 Sua Carteira Multi-Rede:** Guarda e mostra seu saldo consolidado em **Reais (`R$`)** nas redes **Polygon, Arbitrum, Base, Optimism e Ethereum**, com botões diretos para **Receber (QR Code)** e **Enviar**.
* **⚡ Rendimento Automático (Pools Uniswap V3):** Coloca seu saldo livre para trabalhar gerando tarifas de negociação minuto a minuto na Polygon, mantendo sempre uma reserva automática de gás para você nunca ficar travado.
* **🇧🇷 PIX Líquido & Trocas:** Mostra na hora quanto cai **líquido** na sua carteira (ao comprar com PIX) ou na sua conta bancária (ao sacar via PIX), ordenando do melhor retorno para o pior e permitindo filtrar opções **100% Sem KYC**.
* **📊 Auditoria de Lucro Real (desde o 1º dia):** Vasculha todo o histórico da sua carteira desde a primeira transação da vida dela e responde com precisão: *"No total, descontando taxas e movimentações internas, estou no lucro ou no prejuízo?"*.

---

## 📱 2. Como acessar ou instalar no Celular e PC

Você **não** precisa baixar códigos nem configurar nada para começar:

1. **Acesse pelo navegador:** Abra **[https://digitalrobertlima.github.io/price-monitoring/](https://digitalrobertlima.github.io/price-monitoring/)** no Chrome, Brave, Edge ou Safari.
2. **Instale como Aplicativo (Opcional, mas recomendado):**
   * **No Android:** Toque no botão **`📲 Instalar`** no topo da tela (ou no menu `⋮` do Chrome $\rightarrow$ *"Instalar aplicativo"*). Ele ganha ícone próprio na tela inicial e abre em tela cheia.
   * **No Windows / Mac:** Clique no ícone de instalação na barra de endereços do Chrome/Edge ou no botão **`📲 Instalar`**.

---

## 🗺️ 3. Passo a Passo das 4 Telas do Aplicativo

### Primeiro Passo: Conectando ou Criando sua Carteira
Ao abrir o site, toque em **`Conectar / Criar Carteira`** no canto superior direito. Você tem **3 caminhos**:
1. **Criar Nova Carteira (12 ou 24 palavras):** Gera uma frase de recuperação padrão mundial (compatível com Rabby, MetaMask e Trust Wallet), pede a confirmação de 3 palavras para garantir que você anotou, cria sua senha/PIN e ativa o desbloqueio por **Impressão Digital / FaceID / Windows Hello**.
2. **Usar Rabby Wallet:**
   * *No Computador:* Conecta em 1 clique pela extensão Rabby.
   * *No Celular Android:* Toque em **`📋 Copiar Link p/ Rabby Mobile`**, abra o aplicativo **Rabby Wallet** no celular, toque na aba **DApps / Navegador** e cole o link.
3. **Apenas Observar (`0x...`):** Cole qualquer endereço público para acompanhar saldos, pools e histórico de lucro/prejuízo sem precisar assinar nada.

---

### Aba 1: `💳 Carteira` (Visão Geral, Receber e Enviar)
* **Patrimônio Consolidado:** Exibe no topo a soma exata do que está **livre na carteira** + o que está **rendendo em pools**, convertido em **Reais (`R$`)** ao vivo.
* **`↓ Receber`:** Abre seu **QR Code** e endereço único `0x...` com botão de copiar e compartilhar em 1 toque.
* **`↑ Enviar`:** Escolha a rede, a moeda, cole o destino `0x...` e toque em `25%`, `50%` ou `Máx` (o sistema já desconta automaticamente a reserva de gás para você não ficar sem taxa de rede).
* **Recibo Humano antes de Assinar:** Antes de qualquer envio ou operação, uma tela clara mostra em **Reais (`R$`)** quanto sai, quanto chega, qual contrato será usado e o custo aproximado de gás.

### Aba 2: `⚡ Render V3` (Piloto Automático Uniswap V3)
* **Colocar Saldo para Render:** O sistema analisa a volatilidade recente do mercado (`15m`, `1H` ou `4H`), desenha a **Faixa Sniper** no gráfico e calcula quanto você pode ganhar por minuto. Se quiser, você pode digitar uma meta opcional em **`R$/min`**.
* **Gerenciar Posições Ativas:** Cada posição aparece como um cartão com status colorido (**Verde = Rendendo**, **Amarelo = Perto da Borda**, **Vermelho = Fora da Faixa**) e 3 botões diretos:
  * **`Colher Tarifas`:** Saca apenas o lucro acumulado para sua carteira sem fechar a pool.
  * **`Rebalancear`:** Encerra a faixa antiga e abre uma nova centralizada no preço atual.
  * **`Encerrar Pool`:** Devolve 100% do seu capital + tarifas para sua carteira.

### Aba 3: `🇧🇷 PIX & Trocas`
* **Comprar com PIX (`R$` $\rightarrow$ Cripto):** Digite quanto quer investir em Reais e veja quanto cai líquido em `USDT`, `POL`, `BRZ`, `BRLA` ou `USDC`.
* **Sacar PIX (`Cripto` $\rightarrow$ Conta Bancária):** Digite a quantidade de moedas e veja o ranking ordenado do maior valor líquido em `R$` (NakPix, DePix/Liquid, PagFinance, Bipa, Binance). Use o botão **`Filtro: Todas / 100% Sem KYC`** para exibir apenas rotas sem envio de documentos.
* **Trocar / Ponte (`⇄`):** Troque moedas na mesma rede (ex.: `POL` $\leftrightarrow$ `USDT0` na Polygon) ou transfira ativos entre redes diferentes (ex.: `Polygon` $\rightarrow$ `Arbitrum` ou `Base`).

### Aba 4: `📊 Lucro Real` (Auditoria desde a 1ª Transação)
* **Contabilidade Inteligente:** O sistema lê todas as transações da carteira desde o primeiro dia e separa automaticamente o que foi **Aporte Real** (dinheiro entrando de fora) e **Saque Real** (dinheiro saindo para fora) do que foi apenas movimentação interna em pools ou swaps.
* **Gráfico Visual & Extrato:** Compare a linha dourada (**Capital Líquido Investido**) com a linha azul (**Patrimônio Atual**). Você pode alternar entre **BRL (`R$`)** e **USD (`$`)**, ajustar manualmente a classificação de qualquer linha e exportar tudo em **CSV**.

---

## 🔒 4. Segurança e Biometria Explicadas de Forma Simples

* **Autocustódia Absoluta:** Suas 12 ou 24 palavras nunca são enviadas para nenhum servidor. Elas ficam criptografadas apenas dentro do armazenamento privado do seu navegador.
* **Desbloqueio por Impressão Digital / Windows Hello:** Ao ativar a biometria, o próprio chip de segurança do seu celular ou computador protege o desbloqueio da carteira. Ninguém consegue abrir seu cofre sem sua digital/rosto ou sua senha mestra.
* **Bloqueio Rápido:** Sempre que terminar de usar em um computador compartilhado, toque em **`🔒 Bloquear`** no topo para apagar a chave da memória instantaneamente.

---
---

# PARTE 2 — Documentação Ultra-Técnica (Engenharia & Auditoria)

## 🏗️ 5. Arquitetura de Software & Mapa dos 7 Módulos

O projeto adota uma arquitetura **Zero-Backend, Zero-Build, Vanilla ES2022**, eliminando vulnerabilidades de *supply chain* de bundlers e garantindo audibilidade direta linha a linha no navegador:

```text
price-monitoring/
├── index.html            # Estrutura semântica das 4 views, modais e recibo pré-assinatura
├── styles.css            # Design system responsivo (Mobile-First thumb-zone + Desktop)
├── wallet-service.js     # Cofre BIP-39, WebAuthn Biometrics, EIP-6963, RPC Multi-Chain, Envio/Recebimento
├── defi-pix-service.js   # Uniswap V3 NFPM/SwapRouter02, LI.FI Bridge, PIX Ranker, Auditoria Blockscout v2
├── app.js                # Orquestrador de rotas SPA, Micro-Mentor tooltips e ciclo de vida PWA
├── manifest.json         # Manifesto Web App com ícones vetoriais SVG inline
├── sw.js                 # Service Worker com estratégia Network-First e limpeza de cache por versão
├── LICENSE               # Licença MIT
└── README.md             # Documentação completa (Usuário & Engenharia)
```

### Contratos de Interface entre Módulos (`window.*`)
* **`window.RdeskWallet` (`wallet-service.js`):** Expõe `getAddress()`, `getMode()`, `getBalances()`, `getPrices()`, `getReadProvider(chainId)`, `getSigner(chainId)`, `refreshBalances()`, `setLpUsdTotal(usd)` e dispara o evento customizado `rdesk:wallet-updated`.
* **`window.RdeskReceipt` (`wallet-service.js`):** Expõe `confirm(spec)` retornando uma `Promise<boolean>` que bloqueia qualquer chamada `signer.sendTransaction` ou método de contrato até confirmação explícita no recibo em `R$`.
* **`window.RdeskDefi` (`defi-pix-service.js`):** Expõe `refreshPoolAndPositions()`, `refreshPixAndSwap()`, `runAudit(force)` e `resizeChart()`.

---

## 🔐 6. Criptografia do Cofre BIP-39 & Biometria WebAuthn

### Camada 1: Criptografia em Repouso (Senha / PIN Mestro)
1. A entropia criptográfica (`128 bits` para 12 palavras ou `256 bits` para 24 palavras) é gerada via `ethers.utils.randomBytes` (backed by `crypto.getRandomValues`) e convertida via `ethers.utils.entropyToMnemonic`.
2. A derivação da chave simétrica utiliza **Web Crypto API (`SubtleCrypto`)**:
   * **KDF:** `PBKDF2` com `SHA-256`, **`600.000` iterações** e `salt` aleatório de `16 bytes`.
   * **Cifra:** `AES-256-GCM` (`extractable: false`) com vetor de inicialização (`IV`) único de `12 bytes` por gravação.
3. O payload cifrado (`salt`, `iv`, `cipher`) é persistido em `localStorage` sob a chave `rdesk_v22_encrypted_vault`. Ao acionar `lockLocalVault()`, a instância `ethers.Wallet` em memória é nulificada.

### Camada 2: Autenticação Biométrica Nativa (WebAuthn Platform + IndexedDB)
Para evitar redigitação constante de senha sem expor a *seed* em texto puro:
1. O registro chama `navigator.credentials.create` exigindo `authenticatorAttachment: 'platform'` e `userVerification: 'required'` (suportando algoritmos `ES256` (`-7`) para Android/iOS e `RS256` (`-257`) para Windows Hello TPM).
2. Uma chave de envelopamento de dispositivo (`deviceAesKey`) é gerada com **`extractable: false`** e armazenada como objeto opaco `CryptoKey` no **IndexedDB** (`RDESK_BIO_KEYSTORE`), impedindo que scripts leiam os bytes brutos da chave.
3. No desbloqueio (`unlockVaultWithBiometrics()`), `navigator.credentials.get` valida a presença biométrica do usuário no hardware antes de decifrar a mnemônica em memória.

---

## 🦊 7. Descoberta Multi-Carteira EIP-6963 & Fluxo Rabby Mobile

* **EIP-6963 (`initEip6963Discovery`):** Registra o listener `eip6963:announceProvider` antes de despachar `eip6963:requestProvider`. Quando múltiplos provedores estão instalados, o resolvedor prioriza `info.rdns === 'io.rabby'`, evitando colisões no objeto legado `window.ethereum`.
* **Fallback Mobile sem Redirecionamento para Loja:** Em navegadores móveis onde extensões EIP-1193 não são injetadas, o sistema evita *deep links* que jogam o usuário na Play Store e copia `window.location.href` para a área de transferência, orientando a abertura direta no navegador DApp interno da Rabby Wallet.
* **Multi-Chain RPC Failover:** Cada rede (`137` Polygon, `42161` Arbitrum, `8453` Base, `10` Optimism, `1` Ethereum) possui múltiplos endpoints RPC públicos com `withTimeout(..., 3000ms)` e validação `getBlockNumber()`.

---

## ⚙️ 8. Motor Uniswap V3, Matemática de Liquidez & Proteções Anti-MEV

### Contratos Oficiais na Polygon Mainnet (`Chain ID 137`)
| Componente | Endereço Verificado | Função no Sistema |
| :--- | :--- | :--- |
| **Pool WPOL / USDT0 (0.05%)** | `0x9b08288c3be4f62bbf8d1c20ac9c5e6f9467d8b7` | Leitura de `slot0()` (`sqrtPriceX96`, `tick`), `tickSpacing = 10` |
| **NonfungiblePositionManager** | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | `mint`, `positions`, `decreaseLiquidity`, `collect` |
| **SwapRouter02** | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | Rebalanceamento automático `exactInputSingle` e Swap DEX |
| **QuoterV2** | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` | Cotação simulada on-chain via `callStatic` |
| **WPOL (Wrapped POL)** | `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270` | `deposit()` e `withdraw()` 1:1 sem taxa |
| **USDT0 (Tether USD)** | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | Ativo cotação (6 decimais) |
| **USDC (Native)** | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | Stablecoin USD nativa (6 decimais) |
| **BRZ / BRLA** | `0x4eD141110F6EeeAbA9A1df36d8c26f684d2475Dc` / `0xE6A537a407488807F0bbeb0038B79004f19DDDFb` | Stablecoins pareadas ao Real Brasileiro (`R$ 1,00`) |

### Matemática de Precisão (18 Decimais WPOL vs. 6 Decimais USDT0)
A conversão entre o preço humano $P$ (em USDT por 1 POL) e o `tick` alinhado ao espaçamento da pool ($\Delta_{\text{tick}} = 10$) aplica o fator de escala decimal $10^{6 - 18} = 10^{-12}$:

$$\text{tick}_{\text{aligned}} = \text{round}\left(\frac{\lfloor \log_{1.0001}(P \cdot 10^{-12}) \rfloor}{10}\right) \times 10$$

Para o balanceamento ótimo antes do `mint` na faixa $[P_a, P_b]$ dado o preço atual $P \in (P_a, P_b)$, as quantidades virtuais por unidade de liquidez $L$ são calculadas via:

$$\Delta x_{\text{WPOL}} = \frac{1}{\sqrt{P}} - \frac{1}{\sqrt{P_b}}, \qquad \Delta y_{\text{USDT0}} = \sqrt{P} - \sqrt{P_a}$$

### Garantias de Segurança On-Chain
1. **Escudo de Gás Nativo (`GAS_RESERVE_POL = 3.0`):** O Piloto Automático e os botões de `Máx` nunca consomem os últimos `3.0 POL` da carteira.
2. **Aprovações ERC-20 Exatas (`ensureExactErc20Approval`):** O contrato recebe `approve(spender, requiredAmountBN)` estritamente no valor da operação — **nunca** `MAX_UINT256`.
3. **Simulação Pré-Voo (`callStatic.mint`):** Antes de enviar a transação real, o contrato simula o `mint` via `callStatic` para obter os montantes exatos (`sim.amount0`, `sim.amount1`) e injeta tolerância máxima de slippage de `1.5%` (`mul(985).div(1000)`).
4. **Tarifas Não Colhidas em Tempo Real:** O leitor de posições executa `nfpm.callStatic.collect(...)` com `MAX_U128` para exibir os rendimentos acumulados ainda não reivindicados sem gastar gás.

---

## 🌉 9. Roteamento Cross-Chain (LI.FI) & Comparador PIX Líquido

* **Swap Intra-Chain vs. Cross-Chain:** Quando `fromChain === toChain === 137`, o sistema roteia diretamente pelo `SwapRouter02` da Uniswap V3 (ou `deposit`/`withdraw` no contrato `WPOL` para pares `POL/WPOL`). Quando as redes diferem (ex.: Polygon $\rightarrow$ Arbitrum/Base/Optimism/Ethereum), consulta `https://li.quest/v1/quote` e executa a transação retornada após aprovação exata.
* **Cálculo de PIX Líquido:** Para cada trilho (`NakPix`, `DePix/Liquid`, `PagFinance`, `Bipa`, `Binance`), o motor computa o valor líquido real pós-spread percentual ($s$) e tarifa fixa ($f_{\text{BRL}}$):

$$\text{Líquido}_{\text{Saque (BRL)}} = \max\Big(0,\; (Q_{\text{ativo}} \cdot P_{\text{BRL}}) \cdot (1 - s) - f_{\text{BRL}}\Big)$$

---

## 📒 10. Auditoria Forense Contábil desde a 1ª Transação

O módulo de auditoria (`runFullHistoryAudit`) reconstrói o livro-razão cronológico completo da carteira sem exigir chaves de API proprietárias:

1. **Ingestão Paginada Multi-Endpoint (Blockscout v2):** Varre via `next_page_params` os endpoints `/transactions`, `/token-transfers` e `/internal-transactions` (capturando inclusive *unwraps* internos `WPOL` $\rightarrow$ `POL` e custos de gás de transações revertidas).
2. **Filtro Anti-Spam & Allowlist:** Descarta transferências marcadas com `token.is_spam === true` e restringe a contabilização aos contratos verificados em `VERIFIED_AUDIT_TOKENS`, neutralizando ataques de *airdrop phishing*.
3. **Heurística Determinística `EOA` vs. `Smart Contract`:** Verifica `is_contract` (e *fallback* via `provider.getCode(addr)`) para cada contraparte e endereço de destino `tx.to`. Interações com contratos DeFi (abertura/fechamento de pools, swaps, aprovações) são classificadas como `DEFI`, impedindo que capital alocado em liquidez seja confundido com saque externo. Apenas transferências diretas com contas externas (**EOA**) alteram os fluxos de entrada (`IN`) e saída (`OUT`).
4. **Valoração Histórica em Lote:** Cruza cada evento com a série oficial **PTAX de venda do Banco Central do Brasil** (`olinda.bcb.gov.br`) e as cotações históricas diárias em lote da **DefiLlama** (`coins.llama.fi/chart/`), consolidando o resultado líquido em tempo real:

$$\text{Lucro / Prejuízo Líquido Real} = \left(\text{Patrimônio Livre} + \text{Liquidez & Tarifas V3} + \sum \text{Saques}_{\text{EOA}}\right) - \sum \text{Aportes}_{\text{EOA}}$$

---

## 💻 11. Execução Local, Desenvolvimento & Contribuição

### Rodando Localmente
Como o projeto não possui etapa de compilação (*build*), basta servir a pasta raiz via HTTP local (necessário para habilitar `WebAuthn` e `Service Worker` em `localhost`):

```bash
# 1. Clone o repositório
git clone https://github.com/digitalrobertlima/price-monitoring.git
cd price-monitoring

# 2. Inicie um servidor HTTP estático (escolha uma opção)
python -m http.server 8080
# ou via Node.js:
npx serve .

# 3. Acesse no navegador:
# http://localhost:8080
```

### Como Contribuir
1. Faça um **Fork** do repositório.
2. Crie uma branch para sua melhoria (`git checkout -b feat/nova-funcionalidade`).
3. Faça o commit das alterações (`git commit -m 'feat: descreva sua melhoria'`).
4. Envie para o seu fork (`git push origin feat/nova-funcionalidade`) e abra um **Pull Request**.

---

## 📄 Licença

Distribuído sob a licença **MIT**. Consulte o arquivo [LICENSE](LICENSE) para mais detalhes.

Desenvolvido por **Robert Lima** ([@digitalrobertlima](https://github.com/digitalrobertlima)) • **Site Oficial:** [https://digitalrobertlima.github.io/price-monitoring/](https://digitalrobertlima.github.io/price-monitoring/)