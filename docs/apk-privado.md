# APK privado: como fazer o app nativo sem deixar rastro

Pesquisa feita em 24/11/2026, antes de começar o APK descrito em `app-android.md`.
Junta o que existe hoje para esconder o usuário e os pontos onde o app ou o celular ainda podem entregá-lo.

## 1. Primeiro, a verdade: "irrastreável" absoluto não existe

Nenhum app consegue garantir 100%. O que dá para fazer é tirar todas as pistas que dependem **do app**
e deixar claro para o usuário as que dependem **dele** (o celular, o Pix, o que ele faz na blockchain).

Quem pode tentar rastrear, e o que cada um vê hoje:

| Quem | O que vê hoje (PWA no navegador comum) | Meta no APK |
|---|---|---|
| Operadora / Wi-Fi | Que o celular fala com servidores de cripto | Só vê que usa Tor (ou nem isso, com ponte) |
| Servidores de RPC e exploradores | O IP **e** todos os endereços consultados juntos | Nunca vê o IP; cada endereço por um caminho diferente |
| Serviços de preço e cotação | O IP e o horário de uso | Não vê o IP |
| Google | Nada do app, mas vê o celular | Nada: sem Play Services, sem Firebase, sem loja |
| Outro app malicioso no celular | Tela, teclado, área de transferência | Bloqueios de tela, teclado próprio, limpeza automática |
| Quem pega o celular | Depende da senha | Cofre cifrado, travamento, apagar tudo |
| Quem baixa o APK | Que ele baixou do GitHub | Download possível via Tor; APK conferível |
| A própria blockchain | Tudo que é público na rede | **Não tem como esconder.** O app só pode educar |

## 2. Como o APK deve ser montado

### 2.1 A rede inteira passa por um "porteiro" nativo, e fecha se o Tor cair

O plano atual usa Capacitor: o nosso app web roda dentro de um WebView no APK.
O WebView, sozinho, é o maior risco de vazamento:

- O Android permite forçar um proxy SOCKS no WebView (`androidx.webkit.ProxyController`), mas isso já falhou no passado.
  Houve versões do WebView que *pareciam* usar o proxy e não usavam.
- Bibliotecas, imagens, fontes e WebSockets podem tentar sair por fora.

Por isso a proposta é **não confiar no WebView para a rede**:

1. O WebView fica sem rede nenhuma: CSP com `connect-src` só para o próprio app e um proxy morto via `ProxyController`.
   Se algo tentar sair por fora, falha em vez de vazar.
2. Toda chamada (RPC, preço, histórico) vai para um plugin nativo nosso, o `RdeskRede`.
   Ele faz o pedido **por dentro do Tor embutido**.
3. **Fecha se falhar:** se o Tor ainda não conectou ou caiu, o app mostra "conectando com privacidade…" e não manda nada.
   Nunca existe um "tenta direto então".
4. O DNS também vai pelo Tor: quem resolve o nome é a saída do Tor, nunca o DNS da operadora.

### 2.2 Tor dentro do app (sem precisar instalar Orbot)

- **Arti** é o Tor reescrito em Rust pelo Tor Project, feito para ser embutido em apps.
  - Já há caminho pronto para Android: o *Arti Mobile* do Guardian Project e wrappers que entregam um SOCKS local sem JNI manual.
  - O próprio Tor Project lançou o *Tor VPN* para Android em cima do Arti, com builds reproduzíveis e no F-Droid. É um bom sinal de maturidade.
  - Ponto fraco: ainda é mais lento que o Tor clássico (falta controle de congestionamento). Para carteira, onde os pedidos são pequenos, isso é aceitável.
- **Alternativa mais antiga:** `tor-android` (o Tor em C do Guardian Project, usado pelo Orbot). É mais testado e mais pesado.
- **Pontes (obfs4, WebTunnel, Snowflake)** escondem da operadora até o fato de usar Tor. Ficam como opção nas configurações.

### 2.3 Um caminho por endereço (o ponto que quase todo app esquece)

Mesmo com Tor, se o app pergunta o saldo de 10 endereços seguidos ao **mesmo** servidor e pelo **mesmo** caminho,
o servidor não sabe *quem* você é, mas sabe que os 10 são **da mesma pessoa**.
Pesquisas acadêmicas mostram que as chamadas de RPC das carteiras ligam endereços entre si e permitem descobrir o IP de quem consulta.

Regras para o APK:

- **Isolamento de circuito:** cada endereço (e cada conta) usa um circuito Tor diferente.
  No Tor isso se faz mudando o "usuário" do SOCKS, que gera um caminho separado.
- **Espalhar servidores:** endereço A vai no publicnode, endereço B no drpc, e assim por diante. Nenhum servidor vê o conjunto.
- **Atraso aleatório** entre consultas e **nada de pedidos em lote** misturando endereços.
- **Enviar transação** por um circuito e servidor diferentes dos usados para ler o saldo.
- **Histórico (Blockscout/mempool):** só quando o usuário abrir o extrato, nunca em segundo plano. Guardar em cache local.

### 2.4 Não perguntar nada a ninguém: clientes leves

- **Bitcoin: Kyoto (BIP157/158, "filtros de bloco").** O app baixa filtros de todos os blocos e verifica sozinho quais interessam.
  O servidor nunca recebe a lista de endereços. Funciona por SOCKS (Tor) e com conexões cifradas BIP324.
  - É o salto maior de privacidade para BTC.
  - Custo: mais dados e bateria na primeira sincronização. Dá para começar só a partir da data de criação da carteira.
- **Ethereum e redes EVM: Helios.** Cliente leve que **confere** as respostas do RPC (o servidor não consegue mentir saldo).
  Mas ele ainda pergunta pelos seus endereços, então resolve *confiança*, não *privacidade*. Ainda é experimental. Fica para depois.

### 2.5 Mixnet (Nym) em vez de, ou junto com, o Tor

- O Nym lançou em 05/11/2026 um SDK para carteiras: tráfego por 5 saltos com atrasos e ruído, o que protege até contra quem observa o horário dos pacotes.
- Já está em produção em carteiras como Edge, Zingo e Zkool.
- Está no começo e o uso do SDK é grátis para desenvolvimento e teste. Vale como **opção avançada** numa fase posterior, depois do Tor estar firme.

### 2.6 E VPN?

VPN comercial **não é anonimato**: só troca quem vê tudo (a operadora pela empresa da VPN), e geralmente a VPN tem seu pagamento.
Para o nosso app, o caminho é o Tor ou a mixnet **embutidos**.
Quem já usa Orbot ou Tor VPN no celular continua protegido. O app só não pode depender disso.

## 3. O celular também entrega

| Vazamento | O que fazer no APK |
|---|---|
| Teclado do sistema aprende e às vezes envia o que você digita para a nuvem | Palavras-semente só pelo nosso teclado/grade (já temos o `seed-grid`). Campos sensíveis com `IME_FLAG_NO_PERSONALIZED_LEARNING` e sem sugestões |
| Print, gravação de tela, miniatura no "recentes" | `FLAG_SECURE` em todo o app |
| Ataques que leem a tela por canal lateral (ex.: "Pixnapping", 2025) | Mostrar a semente em partes e pelo menor tempo possível. Avisar que celular não substitui carteira física para valores altos |
| Backup automático do Google | `allowBackup="false"` e regras de extração vazias. O cofre nunca vai para a nuvem |
| Área de transferência | Endereço copiado marcado como sensível e apagado sozinho em 60 s. Semente nunca vai para a área de transferência |
| Google Play Services, Firebase, notificação por servidor, relatório de erro | **Nenhum.** Avisos são locais (como já fazemos), sem push de servidor |
| Permissões | INTERNET; câmera só na hora de ler QR; USE_BIOMETRIC para a digital (não dá acesso a dados biométricos, só pede ao Android a verificação). Nada de localização, contatos ou identificador do aparelho |
| Logs | Nada no logcat na versão final |
| Chave do cofre | Senha do usuário + chave no Keystore do Android (StrongBox quando houver). Travar ao sair do app (já fazemos) |
| Apps de "acessibilidade" maliciosos | Avisar quando algum estiver ativo. Não dá para bloquear 100% |

## 4. O que o app consulta hoje (e o destino de cada coisa no APK)

Levantamento do código atual: são cerca de **50 servidores diferentes**.

- **RPC das redes** (publicnode, drpc, 1rpc, RPCs oficiais de Base/Optimism/Arbitrum/Celo/BNB/HyperEVM):
  passam pelo Tor, com um circuito e um servidor por endereço.
- **Histórico** (Blockscout, mempool.space, blockstream, blockchair, insight.dash.org):
  pelo Tor, sob demanda. Para BTC, trocar por Kyoto.
- **Preços e câmbio** (DefiLlama, CoinGecko, GeckoTerminal, Banco Central/PTAX, er-api, frankfurter, awesomeapi):
  pelo Tor. Não contêm endereços, então podem compartilhar circuito.
- **Binance WebSocket ao vivo:** sai do APK em modo privado (WebSocket longo é uma "impressão digital" de horário). No lugar, preço a cada X minutos pelo Tor.
- **LI.FI (trocas):** recebe endereço, valor e destino. Pelo Tor e com aviso de que esse serviço vê a troca.
- **Pix (DePix, NakPix, Bipa, PagFinance):** **esses identificam você de propósito** (CPF, banco). O app deve avisar com clareza:
  "esta etapa liga seu nome a este endereço". Privacidade na rede não apaga isso.
- **Relayer do seu token:** pelo Tor e sem guardar IP. Mesmo assim, ele vê as transferências que paga.

Muitos servidores públicos bloqueiam ou limitam saídas do Tor (por exemplo, atrás do Cloudflare).
O APK precisa testar cada um via Tor e manter só os que aceitam.

## 5. Distribuição sem deixar pista

- **Assinatura do APK:** o certificado tem campos de nome e organização. Usar um nome neutro do projeto, nunca seu nome pessoal.
- **GitHub:** as Releases ficam na sua conta (isso já é público) e o GitHub vê o IP de quem baixa. Oferecer o link `.onion`/Tor Browser e o hash SHA-256 para conferir.
- **Build reproduzível:** qualquer pessoa compila o código e chega ao **mesmo** APK, byte a byte. Prova que não tem nada escondido. É o padrão do F-Droid.
  Cuidados: versões fixas das ferramentas, datas zeradas e partes em Rust (Arti) compiladas sempre no mesmo ambiente.
- **F-Droid** como segunda loja. Não exige cadastro no Google.
- **Atualizações:** o app nunca checa sozinho por fora do Tor. Checagem opcional, pelo Tor, ou via Obtainium.
- **Google:** sem registro, o usuário instala pelo "modo avançado". Bate com a proposta do app.

## 6. Risco jurídico (importante)

Em novembro de 2025, os criadores da Samourai Wallet foram condenados nos EUA a 5 e 4 anos de prisão por "operar transmissão de dinheiro sem licença".
A carteira deles não tinha custódia. O que pesou contra eles:
- tinham **servidores próprios** (o coordenador do mixer);
- **cobravam taxas**;
- fizeram **propaganda para quem queria fugir da lei**.

Lições para nós:
- O app continua **sem custódia e sem mixer**. Privacidade de rede (Tor) é diferente de misturar moedas de terceiros.
- O **relayer que cobra taxa** é a parte que mais se parece com "serviço". Antes de lançar o token, vale conversar com um advogado de cripto no Brasil.
- O discurso é **privacidade e segurança**, nunca "fugir de fiscalização".

(Isto não é parecer jurídico.)

## 7. O que nem o melhor app resolve

- Celular já infectado.
- O Pix e as corretoras, que identificam por lei.
- A análise da blockchain: tudo o que é feito na rede é público para sempre. Endereços reaproveitados e valores redondos ligam as coisas.
- Comportamento: postar o endereço, usar sempre no mesmo horário.

## 8. Plano em fases

1. **APK base privado:** Capacitor + plugin `RdeskRede` + Arti embutido + "fecha se falhar".
   Junto: `FLAG_SECURE`, sem backup, só INTERNET, assinatura neutra e build no GitHub Actions.
2. **Anti-ligação:** um circuito por endereço, servidores espalhados, atrasos e envio separado da leitura.
   Também: teste automático de "zero pacotes fora do Tor" (um emulador no CI com rede bloqueada exceto o Tor).
3. **Bitcoin sem perguntar:** Kyoto (filtros BIP157) no lugar do mempool.space.
4. **Extras:** pontes do Tor, Helios para conferir as respostas, opção Nym mixnet.
5. **Confiança pública:** build reproduzível e F-Droid.

O teste que define "pronto": abrir o app num celular sem internet além do Tor e confirmar, com captura de rede,
**zero** pacote ou DNS fora do Tor do início ao fim, inclusive no primeiro uso.
