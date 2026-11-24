# Token do criador + relayer ("enviar como um Pix")

O app já está pronto para isto (arquivo `relayer.js`). O recurso fica desligado até o token existir.

## Como funciona para a pessoa

1. Ela escolhe o seu token, digita o destino e o valor, como num Pix.
2. O app pergunta ao seu relayer quanto ele cobra, no próprio token (exemplo: 1 RDK).
3. A pessoa confere e assina **duas autorizações**. Assinar não gasta nada e não precisa de BNB, ETH ou POL:
   - o pagamento: X tokens para o destino;
   - a taxa: Y tokens para o relayer.
4. O app manda as duas assinaturas para o seu relayer. O relayer envia a transação, paga a taxa da rede com BNB, ETH ou POL dele e fica com os Y tokens.

**Segurança:** cada autorização amarra o destino, o valor, o prazo e um número único. O relayer não consegue mudar nada disso nem usar a mesma autorização duas vezes. Além disso, o app recusa uma taxa acima de 2% do envio. Esse teto está em `maxFeeBps`.

## O que o contrato do token precisa ter

- **EIP-3009**: `transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)` e `authorizationState(from, nonce)`. É o mesmo padrão do USDC. Implementação de referência: o FiatTokenV2 da Circle ou o `EIP3009` da OpenZeppelin Community.
- **EIP-712**: o `name` e a `version` do domínio precisam ser **iguais** aos configurados no app.
- Opcional, mas recomendado: **EIP-2612** (`permit`), para outras integrações.
- Mantenha o contrato simples. Evite taxa sobre transferência e evite botão de congelar, se a ideia é o token ser "sem confisco".

## API do relayer (o seu servidor na Oracle)

`GET /quote?chainId=56&token=0x…&value=<inteiro>`

```json
{ "fee": "1000000000000000000", "feeRecipient": "0xSuaCarteiraDeTaxas", "validSeconds": 600 }
```

`POST /relay` recebe:

```json
{ "chainId": 56, "token": "0x…",
  "payment": { "from": "0x…", "to": "0x…", "value": "…", "validAfter": 0, "validBefore": 1790000000, "nonce": "0x…", "signature": "0x…" },
  "fee":     { "from": "0x…", "to": "0xSuaCarteiraDeTaxas", "value": "…", "validAfter": 0, "validBefore": 1790000000, "nonce": "0x…", "signature": "0x…" } }
```

E responde `{ "txHash": "0x…" }` ou `{ "error": "mensagem para a pessoa" }`.

**O que o relayer precisa conferir antes de enviar:**
- `fee.to` é a sua carteira;
- `fee.value` é a taxa cotada;
- as duas assinaturas são válidas;
- o prazo não venceu;
- o saldo cobre pagamento + taxa.

Envie as duas autorizações **na mesma transação**, por um contrato "lote" simples ou por uma função do próprio token (por exemplo, `transferWithAuthorizationAndFee`). Assim nunca acontece de a taxa sair sem o pagamento.

**Proteção do relayer:**
- limite de pedidos por IP;
- teto de taxa da rede por envio: se a rede estiver cara, recuse em vez de pagar caro;
- registro do que foi enviado.

## Como ligar no app

Em `relayer.js`, preencha `CONFIG`: `enabled: true`, `chainId`, `address`, `symbol`, `name`, `version`, `decimals` e `relayerUrl` (https). Adicione o token à lista da rede em `registry.js`. Na tela Enviar desse token aparece o botão "⚡ Enviar sem moeda da rede".

O teste `tests/v45.mjs` simula um relayer e confere as assinaturas.
