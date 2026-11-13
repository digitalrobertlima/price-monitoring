# 🛡️ RDESK SENTINEL — Terminal DeFi & Monitor de Liquidez (Uniswap V3)

![HTML5](https://img.shields.io/badge/HTML5-10.4%25-E34F26?style=flat&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-15.7%25-1572B6?style=flat&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-73.9%25-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Rede](https://img.shields.io/badge/Polygon-Mainnet%20(137)-8247E5?style=flat&logo=polygon&logoColor=white)
![DEX](https://img.shields.io/badge/Uniswap-V3%20Nativo-FF007A?style=flat)
![Licença MIT](https://img.shields.io/badge/Licença-MIT-green?style=flat)
![Dependências](https://img.shields.io/badge/Build%20%26%20Servidor-Zero-blue?style=flat)

O **RDESK SENTINEL** é um terminal tático em tempo real para acompanhar cotações cripto, gerenciar posições de liquidez concentrada (**POL/USDT0 — 0.05%**) na **Uniswap V3 (Rede Polygon)** e calcular lucros líquidos reais em moeda brasileira (**BRZ, BRLA e BRL**) — rodando 100% no seu navegador, sem servidores intermediários e sem necessidade de instalar programas.

---

## 🧭 Sumário

1. [Para Quem é Esta Ferramenta?](#-para-quem-é-esta-ferramenta)
2. [Guia Rápido para Usuários (Sem Conhecimento Técnico)](#-guia-rápido-para-usuários-sem-conhecimento-técnico)
3. [Como Usar Cada Módulo no Dia a Dia](#-como-usar-cada-módulo-no-dia-a-dia)
4. [Guia Técnico para Desenvolvedores](#-guia-técnico-para-desenvolvedores)
5. [Contratos Inteligentes e Fontes de Dados](#-contratos-inteligentes-e-fontes-de-dados)
6. [Estrutura dos Arquivos](#-estrutura-dos-arquivos)
7. [Perguntas Frequentes e Solução de Problemas](#-perguntas-frequentes-e-solução-de-problemas)
8. [Como Contribuir e Licença](#-como-contribuir-e-licença)

---

## 🎯 Para Quem é Esta Ferramenta?

* **Investidores e Provedores de Liquidez (perfil não técnico):** Querem acompanhar o gráfico ao vivo, simular faixas de preço sem risco, montar pools na Uniswap V3 com 1 clique, ver quanto estão ganhando por minuto em Reais (`R$/min`) já descontando taxas de gás e descobrir a rota mais barata para sacar via PIX.
* **Desenvolvedores e Auditores Web3 (perfil técnico):** Buscam uma base transparente em Vanilla JavaScript (`sentinel-engine.js`) com Ethers.js v5 e TradingView Lightweight Charts, dotada de aprovações ERC-20 exatas (sem `MAX_UINT256`), simulação `callStatic` anti-revert/anti-MEV e redundância de 3 camadas para leitura on-chain.

---

## 🚀 Guia Rápido para Usuários (Sem Conhecimento Técnico)

Você **não** precisa saber programar, abrir terminal nem instalar nada para usar o RDESK SENTINEL.

### Passo 1: Baixar o projeto
1. No topo desta página do GitHub, clique no botão verde **`<> Code`**.
2. No menu que abrir, clique em **`Download ZIP`**.
3. Aguarde o arquivo terminar de baixar no seu computador.

### Passo 2: Extrair a pasta
1. Abra a sua pasta **Downloads** e localize o arquivo `price-monitoring-v21-LT.zip` (ou similar).
2. Clique com o botão direito sobre ele e escolha **"Extrair Tudo..."** (no Windows) ou dê um duplo clique (no Mac).

### Passo 3: Abrir no navegador
1. Entre na pasta extraída.
2. Dê um **duplo clique** no arquivo **`index.html`**.
3. O painel abrirá imediatamente no seu navegador (Chrome, Brave, Edge, Firefox ou Safari).

> **💡 Dica de Segurança:** Você pode testar toda a ferramenta **sem conectar carteira** (usando o modo de simulação de faixa manual ou colando apenas o endereço público `0x...` para leitura). Quando quiser executar operações reais na Polygon, basta clicar em **`CONECTAR RABBY`** no canto superior direito (compatível com Rabby Wallet e MetaMask).

---

## 🖥️ Como Usar Cada Módulo no Dia a Dia

A tela é dividida em **3 colunas redimensionáveis** (arraste as divisórias verticais entre elas para ajustar ao seu monitor):

### 1. Barra Superior e Alertas Sonoros
* **Status de Risco (`SEGURO` / `BORDA DO RANGE` / `FORA DO RANGE`):** Avisa visualmente e por bipe sonoro quando o preço se aproxima (margem de 8%) ou sai da sua faixa de liquidez.
* **Oráculo Moeda Mãe:** Exibe em tempo real a cotação do **Dólar Comercial (BRL)** e a paridade real on-chain de **1 USDT0 em BRZ e BRLA**.
* **Controles Rápidos:** Ative o alerta sonoro (`SOM: ON/OFF`), gere um link compartilhável da sua configuração (`LINK`) ou salve/restaure seus dados locais em arquivo (`JSON ↓` / `JSON ↑`).

### 2. Coluna Esquerda e Central (Gráfico + Lucro Líquido Real)
* **Painel OHLC (Esquerda):** Mostra a variação percentual do ativo em 11 tempos gráficos diferentes (de `1 MIN` a `1 MÊS`).
* **Gráfico Interativo (Centro):** Gráfico estilo TradingView (`1m`, `5m`, `15m`, `1H`, `4H`) com linhas tracejadas indicando o preço mínimo e máximo das suas posições.
* **Patrimônio e Tarifas Live:** Mostra o valor total da posição focada, o percentual atual entre `POL` e `USDT` e as tarifas acumuladas em tempo real.
* **Calculadora de Lucro Líquido Real (Rodapé Central):** Informe seu **Aporte inicial em BRZ** e o **Gás de abertura em POL** — o sistema desconta automaticamente o custo do gás de abertura e fechamento para mostrar o lucro líquido verdadeiro em `BRZ` e `R$`.

### 3. Coluna Direita (3 Abas Operacionais + Fluxo ao Vivo)
* **Aba `1. PILOTO & NFT`:**
  * **Escultor de Meta (`META R$/MIN`):** Digite quanto deseja buscar por minuto (ou use os atalhos `SNIPER 1x`, `META 1.5x`, `TURBO 2.5x`, `SCALP 4x`). O sistema calcula a largura exata da faixa com base no volume real da pool e desenha uma prévia no gráfico.
  * **Piloto Automático V3 (`COMEÇAR A GANHAR`):** Reserva automaticamente **1.5 POL** para gás na sua carteira, converte/equilibra o saldo livre entre `WPOL` e `USDT0` na proporção exata da faixa e abre a posição NFT na Uniswap V3.
  * **Scanner Web3 & Range Manual:** Cole qualquer carteira `0x...` e clique em `SCAN` para carregar posições ativas, ou crie faixas de estudo offline em `Range Manual (Offline)`.
  * **Gestão Direta no Card do NFT:** Permite executar **`+ ADICIONAR`** (injeta saldo livre sem fechar a pool), **`COLHER`** (recolhe tarifas para a carteira), **`REBALANCEAR`** (fecha, ajusta proporção e reabre na nova faixa) e **`WITHDRAW`** (encerra 100% da posição).
* **Aba `2. SWAP DEX`:**
  * Realiza trocas diretas nos contratos oficiais da Uniswap V3 na Polygon entre `POL`, `WPOL`, `USDT0`, `BRZ` e `BRLA` (incluindo conversão 1:1 `POL ↔ WPOL` sem taxa de pool).
* **Aba `3. PIX INTELIGENTE`:**
  * Simula quanto cai **líquido na sua conta bancária em Reais** ao sacar suas criptos, descontando spread implícito de câmbio, taxa da DEX e taxa de saque entre **NakPix (c/ Cupom e Padrão)**, **DePix / Liquid**, **PagFinance**, **Bipa** e **Binance Spot**. Inclui botão **`FILTRO: 100% SEM KYC`**.
* **Fluxo DEX (0.05%) (Rodapé Direito):** Feed ao vivo conectado diretamente à blockchain Polygon exibindo cada compra e venda que ocorre na pool em tempo real.

---

## 🛠️ Guia Técnico para Desenvolvedores

O projeto adota uma arquitetura **Zero-Build / Zero-Backend**: todo o motor matemático, leitura on-chain, assinatura EIP-1193 e renderização gráfica ocorrem no cliente (`sentinel-engine.js`).

### Clonando o Repositório

```bash
git clone [https://github.com/digitalrobertlima/price-monitoring.git](https://github.com/digitalrobertlima/price-monitoring.git)
cd price-monitoring
```

### Executando com Servidor HTTP Local (Recomendado)

Embora o `index.html` funcione via protocolo `file://`, servir via HTTP local evita bloqueios de políticas de navegador para Web Audio API e provedores injetados (`window.ethereum`):

```bash
# Opção 1: Python 3
python -m http.server 8080

# Opção 2: Node.js
npx serve .
```

Acesse `http://localhost:8080` no navegador.

### Publicação Gratuita via GitHub Pages

1. No repositório, acesse **Settings** > **Pages**.
2. Em **Build and deployment**, selecione **Deploy from a branch**.
3. Selecione a branch principal (`v21-LT` ou `main`) e a pasta `/ (root)`.
4. Clique em **Save** para gerar a URL pública HTTPS.

### Arquitetura e Camadas de Resiliência (`sentinel-engine.js`)

* **Redundância de Leitura Web3 (3 Camadas):**
  1. *Rota 1:* Multi-RPC Ethers.js consultando `NonfungiblePositionManager` (`balanceOf`, `tokenOfOwnerByIndex`, `positions`).
  2. *Rota 2:* Chamada JSON-RPC bruta (`eth_call` direto no seletor `0x70a08231`).
  3. *Rota 3:* Fallback via Subgraph (`uniswap-v3-polygon` no The Graph).
* **Motor Sniper Pro & Solver Inverso:**
  * Calcula `ATR(14)` e viés direcional `EMA(9) / EMA(21)` em candles de `15m` para ajustar assimetricamente o range (`downWeight` / `upWeight`).
  * Utiliza busca binária (`solveRangeForTargetBrlPerMin`) alinhada ao `tickSpacing = 10` da pool para encontrar a faixa correspondente a uma meta em `R$/min`.
* **Segurança On-Chain e Persistência Local:**
  * **Aprovações Exatas:** Solicita `approve(spender, exactAmount)` em vez de `MAX_UINT256`.
  * **Proteção Anti-Revert / Anti-MEV:** Simula transações previamente via `callStatic.mint` e `callStatic.increaseLiquidity` aplicando tolerância controlada (`amountMin` de 98.5% da simulação).
  * **Sanitização e Backup Triplo:** Sanitiza entradas contra XSS (`sanitizeLabel`, `sanitizePosition`) e persiste o estado localmente em `localStorage`, `IndexedDB` (`RDESK_VAULT`) e exportação JSON.

---

## 🔗 Contratos Inteligentes e Fontes de Dados

Todos os endereços abaixo pertencem à **Polygon Mainnet (Chain ID: `137`)**:

| Componente | Identificador / Contrato | Observação |
| :--- | :--- | :--- |
| **Pool Principal (POL/USDT0)** | `0x9b08288c3be4f62bbf8d1c20ac9c5e6f9467d8b7` | Fee Tier `500` (0.05%) • Tick Spacing `10` |
| **Uniswap V3 NFPM** | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | Gerenciamento de posições NFT |
| **Uniswap V3 SwapRouter02** | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | Execução de swaps single e multihop |
| **Uniswap V3 QuoterV2** | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` | Simulação de cotação on-chain |
| **WPOL (Wrapped POL)** | `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270` | 18 decimais (`deposit` / `withdraw`) |
| **USDT0 (Tether Polygon)** | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | 6 decimais |
| **BRZ (Brazilian Digital)** | `0x4eD141110F6EeeAbA9A1df36d8c26f684d2475Dc` | 18 decimais |
| **BRLA (BRLA Digital)** | `0xE6A537a407488807F0bbeb0038B79004f19DDDFb` | 18 decimais |

**Feeds Públicos Utilizados (Sem Chave de API):**
* **Binance WebSocket & REST:** Preço global `POLUSDT`, book `USDTBRL` e klines históricos.
* **Polygon PublicNode WebSocket:** Assinatura de logs `Swap` da pool em tempo real.
* **GeckoTerminal API:** Volume USD (`24h` e `5m`) da pool na Polygon.
* **AwesomeAPI:** Cotação comercial `USD-BRL`.

---

## 📁 Estrutura dos Arquivos

```text
price-monitoring/
├── index.html          # Estrutura da interface de 3 colunas, abas e imports de CDN
├── sentinel-engine.js  # Motor Web3, Piloto Automático, Sniper Pro, Swap V3 e Ranker PIX
├── styles.css          # Tema escuro (Dekton Copper), layout flexível e alertas visuais
├── LICENSE             # Licença MIT
└── README.md           # Documentação completa (usuário final e desenvolvedor)
```

---

## ❓ Perguntas Frequentes e Solução de Problemas

* **Cliquei em "COMEÇAR A GANHAR", mas apareceu saldo insuficiente mesmo tendo POL na carteira.**
  Por segurança, o sistema bloqueia automaticamente **1.5 POL** como reserva de gás para que você nunca fique preso sem conseguir aprovar, colher tarifas ou fechar sua posição. O capital investido será o saldo excedente acima dessa reserva.
* **O preço saiu da faixa, mas não ouvi nenhum alerta sonoro.**
  Navegadores bloqueiam áudio automático até que haja interação na página. Clique no botão **`SOM: OFF`** na barra superior para ativar o áudio (`SOM: ON`).
* **Posso usar sem conectar minha carteira?**
  Sim. Você pode colar qualquer endereço público `0x...` no campo de scanner para auditar posições em modo leitura ou adicionar faixas manuais para simular distribuição entre POL e USDT0.
* **Preciso pagar alguma assinatura ou configurar chaves de API?**
  Não. Todo o sistema consome endpoints públicos gratuitos e interage diretamente com os contratos da Uniswap V3 na Polygon.

---

## 🤝 Como Contribuir e Licença

Contribuições, melhorias de interface e otimizações de rota são bem-vindas:

1. Faça um **Fork** do projeto.
2. Crie uma branch para sua alteração (`git checkout -b feature/minha-melhoria`).
3. Faça o commit (`git commit -m 'Adiciona melhoria X'`).
4. Envie para o seu fork (`git push origin feature/minha-melhoria`) e abra um **Pull Request**.

Distribuído sob a licença **MIT**. Consulte o arquivo [LICENSE](LICENSE) para mais informações.

Desenvolvido por **Robert Lima** ([@digitalrobertlima](https://github.com/digitalrobertlima)) © 2026.
