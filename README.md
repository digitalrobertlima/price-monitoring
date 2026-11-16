# 🛡️ RDESK SENTINEL — Super App Web3 PWA de Autocustódia

> **Versão:** `v0.01` (`superapp-v0.01`)  
> **Rede:** Polygon Mainnet (`Chain ID: 137`)  
> **Stack:** HTML5, CSS3, Vanilla JS Modular, `ethers.js v5.7.2`, `Chart.js v4.4.3` (100% estático — zero Node/bundlers)

O **RDESK SENTINEL** é um Super App Web3 PWA de autocustódia projetado para rodar diretamente no **GitHub Pages** sem dependências de backend, servidores intermediários ou processos de build. Ele reúne cofre criptográfico blindado, gestão de liquidez concentrada na **Uniswap V3**, comparador de entrada **PIX → USDT0** e auditoria contábil histórica indexada pela **PTAX oficial do Banco Central do Brasil**.

---

## 🔒 Arquitetura de Segurança Bancária

1. **Zero Aprovação Ilimitada (`No MaxUint256`)**  
   Todas as chamadas ERC-20 `approve()` para `NonfungiblePositionManager` e `SwapRouter02` aprovam **exclusivamente a quantia exata** necessária para a operação (zerando antes caso exista allowance residual inferior).
2. **Recibo Humano + Slide-to-Confirm**  
   Nenhuma transação é assinada sem passar pelo modal de **Recibo Humano** exibindo ação, valores em `R$` e `USD`, estimativa de gás em `R$`, endereço do contrato destino, barra deslizante anti-clique acidental (**Arraste para Confirmar**) e autenticação via **WebAuthn/Biometria** ou **PIN**.
3. **Escudo de Gás Intransponível (`3.0 POL`)**  
   O botão `MÁX` e o validador pré-assinatura bloqueiam qualquer envio, swap, wrap ou abertura de pool que reduza o saldo nativo abaixo de **3,00 POL**, garantindo reserva permanente para emergências e encerramento de posições.
4. **Cofre Criptográfico Blindado (`AES-256-GCM` + `PBKDF2`)**  
   - Chaves privadas e frases-semente BIP-39 (12 ou 24 palavras) são cifradas localmente com **AES-256-GCM** e derivação **PBKDF2** (`150.000` iterações, `SHA-256`).
   - Solicita armazenamento persistente via `navigator.storage.persist()` para evitar limpeza automática em navegadores Android/iOS.
   - **Prova de Backup Obrigatória:** Ao gerar nova seed, o usuário precisa preencher 3 palavras aleatórias em campos individuais antes de ativar o cofre.
   - **Auto-Limpeza de Clipboard:** Ao copiar frases-semente, a área de transferência é sobrescrita automaticamente após **45 segundos**.
5. **Anti-XSS & Content Security Policy (CSP) Estrita**  
   - CSP configurada via `<meta>` bloqueando scripts inline (`script-src 'self' https://cdnjs.cloudflare.com`) e restringindo `connect-src` exclusivamente aos RPCs e oráculos auditados.
   - Renderização segura de DOM (`textContent` / `replaceChildren`), filtro `is_spam` e whitelist estrita de tokens verificados.

---

## 🧩 Estrutura Modular (9 Micro-Arquivos)

```text
├── index.html          # Shell PWA, CSP estrita, 4 abas e modais (Cofre + Recibo Humano)
├── styles.css          # Tema escuro fintech mobile-first, barra inferior fixa e slider
├── manifest.json       # Configuração PWA com ícones SVG embutidos
├── sw.js               # Service Worker Network-First com skipWaiting() e clients.claim()
├── crypto-vault.js     # Cofre AES-256-GCM, BIP-39/BIP-44 (#0, #1...), WebAuthn e clipboard 45s
├── oracle-rpc.js       # Failover entre 4 RPCs Polygon, AwesomeAPI, DefiLlama e Rabby EIP-6963
├── wallet-ui.js        # Gaveta Multi-Carteira, QR Code Receber, Envio e controlador do Recibo
├── defi-pools.js       # Uniswap V3 (slot0, NFTs, Wrap POL, Multicall), Break-Even e PIX Líquido
└── forensic-audit.js   # Auditoria desde a 1ª TX (Blockscout v2 + PTAX BCB + Chart.js)
