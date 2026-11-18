# Comprar cripto com Pix (Mercado Pago)

O app já tem a tela pronta, mostrando **"Em breve"**. Para ligar, você publica este pequeno servidor e coloca o endereço dele no app.

## Por que precisa de um servidor?

O **Access Token** do Mercado Pago é como a senha da sua conta: quem tem ele consegue criar cobranças e ver pagamentos. O app é um site aberto, então qualquer coisa colocada nele pode ser copiada por qualquer pessoa. Por isso o token fica **só no servidor**, guardado como segredo.

O servidor usa o plano **grátis** da Cloudflare (Workers): 100 mil pedidos por dia, sem cartão.

## Como funciona

1. A pessoa escolhe o valor no app, por exemplo R$ 50.
2. O app pede ao servidor um Pix. O servidor cria a cobrança no Mercado Pago e devolve o **Pix Copia e Cola**, e o app desenha o QR Code.
3. A pessoa paga no banco dela.
4. O Mercado Pago avisa o servidor. O servidor confere a **assinatura** do aviso e **consulta o pagamento direto na API**, para nunca confiar só no aviso.
5. Com o pagamento aprovado, o servidor envia **BRZ (o real digital, 1 BRZ = R$ 1)** na Polygon para a carteira da pessoa.
6. O app acompanha sozinho: "Esperando o pagamento…" → "Pix recebido!" → "Chegou na sua carteira!".

O servidor entrega **BRZ** porque ele vale sempre 1 real: não existe risco de o preço mudar entre o Pix e a entrega. Depois a pessoa troca no próprio app por Bitcoin, se quiser.

## Passo a passo

```bash
cd server
npm install
npx wrangler login                              # entra na sua conta Cloudflare (grátis)
npx wrangler kv namespace create ORDERS         # copie o id e cole no wrangler.toml
npx wrangler secret put MP_ACCESS_TOKEN         # Access Token de PRODUÇÃO (Mercado Pago > Suas integrações > Credenciais)
npx wrangler secret put MP_WEBHOOK_SECRET       # Mercado Pago > Suas integrações > Webhooks > "Assinatura secreta"
npx wrangler secret put HOT_WALLET_KEY          # só quando for ligar a entrega automática (veja abaixo)
npx wrangler deploy                             # mostra o endereço, ex.: https://rdesk-pix.SEU-USUARIO.workers.dev
```

No painel do Mercado Pago, em **Webhooks**, cadastre o endereço `https://rdesk-pix.SEU-USUARIO.workers.dev/pix/webhook` com o evento **Pagamentos**.

Por último, no app, em `registry.js`, coloque o endereço em `PIX_BUY.endpoint`, publique, e o cartão muda de "Em breve" para **"Novo"**.

## Entrega das moedas: comece no manual

O `wrangler.toml` vem com `DELIVERY_ENABLED = "false"`. Assim, quando alguém paga, o pedido fica como **"pago, aguardando entrega"** e **você envia o BRZ à mão** pelo app. Isso serve para testar com valores pequenos e ganhar confiança.

Para entregar automaticamente:

- Crie uma carteira **só para isso** (a "carteira de entrega").
- Deixe nela **pouco saldo**: BRZ suficiente para um dia de vendas e um pouco de POL para as taxas.
- Coloque a chave dela com `wrangler secret put HOT_WALLET_KEY`.
- Mude para `DELIVERY_ENABLED = "true"` e publique de novo.

Nunca use a sua carteira principal. Se o servidor for invadido, o prejuízo fica limitado ao saldo dessa carteira de entrega.

## Configurações (wrangler.toml)

| Item | Para que serve | Padrão |
|---|---|---|
| `MIN_BRL` / `MAX_BRL` | Valor mínimo e máximo por compra | R$ 10 a R$ 500 |
| `FEE_BPS` | Sua taxa na compra (100 = 1%), mostrada antes do Pix | 150 (1,5%) |
| `APP_ORIGIN` | Só o seu app pode criar pedidos | o endereço do GitHub Pages |
| `DELIVERY_ENABLED` | Entrega automática | `false` |

## Segurança já embutida

- O token do Mercado Pago **nunca** chega no app.
- Os avisos do Mercado Pago passam pela **assinatura** `x-signature` (HMAC-SHA256). Aviso falso ou antigo é recusado.
- O servidor **sempre consulta** o pagamento na API antes de entregar, e confere se o valor bate.
- Um aviso repetido não entrega duas vezes.
- Cada cobrança usa uma **chave de idempotência**, para não duplicar.
- Outros sites não conseguem criar pedidos (CORS).
- O app confere o Pix Copia e Cola antes de mostrar: código válido e valor certo.

## Antes de ligar: cuidados legais (importante)

- **Banco Central:** vender cripto em troca de reais, como serviço para outras pessoas, pode ser considerado atividade de **prestadora de serviços de ativos virtuais**. Pelas regras em vigor desde fevereiro de 2026 (Resoluções BCB 519, 520 e 521), isso exige autorização e identificação dos clientes. **Converse com um advogado antes de abrir para o público.**
- **Mercado Pago:** confirme se a sua conta e o seu tipo de negócio permitem esse tipo de venda.
- **Impostos:** guarde o registro das vendas; os pedidos ficam no KV por 30 dias.

O código do servidor tem testes automáticos (`tests/pix-servidor.mjs`), que rodam com o Mercado Pago simulado.
