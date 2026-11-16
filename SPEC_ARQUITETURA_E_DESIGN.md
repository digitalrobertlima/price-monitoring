# RDESK SENTINEL V22 — Especificação de Arquitetura, Design & Segurança (Super App DeFi)

> **Princípios Fundamentais:** *Your keys, your coins; be your own bank.* • *Calm Finance* • *One Screen, One Action* • *Dependência Zero de Servidor*

---

## PARTE I — DESIGN SPEC (NEURO-DESIGN & EXPERIÊNCIA DO USUÁRIO)

### 1. Psicologia Cromática e Calma Cognitiva (*Calm Finance*)
Aplicativos financeiros tradicionais utilizam cores neon intermitentes e contadores acelerados que estimulam ansiedade e decisões impulsivas. O RDESK SENTINEL V22 aplica engenharia visual orientada à serenidade e ao domínio operacional:
* **Superfície Base (`#030303` e `#0B0B0D`):** Grafite profundo com contraste controlado para leitura prolongada sem fadiga ocular.
* **Cor de Comando (`#CDA434` — Cobre Dekton):** Reservada exclusivamente para ações intencionais de controle do usuário.
* **Semântica de Estado Calma:**
  * Verde Esmeralda (`#00D084`): Lucro líquido real confirmado e faixa ativa saudável.
  * Âmbar Sereno (`#F5A623`): Alerta preventivo de aproximação de borda ou ponto de equilíbrio ainda não atingido.
  * Vermelho Contido (`#E5484D`): Saída de faixa ou bloqueio de segurança.
* **Tipografia Tabular (`Space Mono` + `Rajdhani`):** Todos os valores financeiros utilizam largura fixa de dígito (`font-variant-numeric: tabular-nums`), impedindo que números "saltem" horizontalmente a cada atualização.

### 2. Divulgação Progressiva em Dois Perfis (`MODO SERENO` ↔ `TERMINAL PRO`)
Um interruptor discreto na barra superior alterna instantaneamente entre dois níveis de profundidade sem recarregar a página:
1. **Modo Sereno (Padrão — *One Screen, One Action*):**
   * Projetado para adoção imediata por usuários iniciantes e consulta rápida no celular.
   * Exibe **1 número âncora em Reais (`R$`)** com o patrimônio consolidado, a curva visual de evolução (capital aportado vs. patrimônio vivo) e 4 telas focadas, cada uma com **apenas 1 botão primário** na zona natural do polegar (`52px` no Android):
     * **Início:** Patrimônio em `R$`, saldo das 8 moedas e saúde da carteira.
     * **Ganhar (Piloto V3):** Quanto o saldo livre rende por minuto/dia + botão único de ativação ou rebalanceamento.
     * **Trocar (Swap & Cross-Chain):** Conversão direta entre moedas e redes.
     * **PIX (Entrar & Sair):** Compra via PIX para autocustódia e Ranker PIX Líquido.
2. **Terminal Pro (Cockpit Avançado):**
   * Revela com transição suave o ambiente tático completo: gráfico TradingView multi-timeframe (`1m` a `4H`), grade OHLC de 11 períodos, Sniper ATR (`15m`), Escultor de Meta (`R$/min`), fluxo de swaps da pool em tempo real e auditoria contábil desde a primeira transação.

### 3. Recibo Humano Pré-Assinatura em Reais (`R$`)
Nenhuma transação financeira é executada sem antes exibir um cartão de confirmação em Português claro contendo:
* **De onde sai:** Ativo, quantidade exata e equivalente em `R$`.
* **Para onde vai:** Destino (Carteira própria, Pool Uniswap V3, Ponte Cross-Chain ou Rota PIX) e valor líquido estimado em `R$`.
* **Custo de rede:** Taxa estimada do validador em `POL`/`ETH` e `R$` (taxa zero cobrada pelo app).
* **Escudo de Gás Preservado:** Confirmação visual de que a reserva obrigatória (`3.0 POL` na Polygon) permanece intacta.

### 4. Sistema Universal de Balões Explicativos (`MicroMentor`)
Qualquer botão, indicador, sigla ou métrica exibe explicação prática ao parar o mouse no PC (ou ao tocar no ícone `?` no Android), estruturada sempre em duas linhas objetivas:
* **O que é:** Definição direta sem jargão técnico.
* **Na prática:** Como aquele elemento afeta o seu dinheiro naquele momento.

---

## PARTE II — ARCHITECTURE SPEC (ENGENHARIA, CRIPTOGRAFIA & REDUNDÂNCIA)

### 1. Topologia Modular Zero-Backend (GitHub Pages)
```text
price-monitoring (branch: v22-superapp)
├── SPEC_ARQUITETURA_E_DESIGN.md  # Especificação técnica e visual
├── manifest.json                 # Manifesto PWA instalável no Android
├── sw.js                         # Service Worker (cache de UI + rede ao vivo para preços/RPC)
├── vault-core.js                 # Cofre BIP-39 (12/24 palavras), AES-GCM 256, 8 ativos, 5 redes
├── ledger-advisor.js             # Livro-razão desde a 1ª TX, curva de patrimônio e Break-Even
├── gateway-pix.js                # Swaps Cross-Chain (LI.FI) e fluxo PIX líquido
├── sentinel-engine.js            # Motor Uniswap V3, Rebalanceamento Autônomo e MicroMentor
├── styles.css                    # Tema Dekton Copper, Modo Sereno, Terminal Pro e Mobile Nav
└── index.html                    # Estrutura semântica, CSP estrita e Recibo Pré-Assinatura
