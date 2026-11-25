// v48: apps dentro da carteira (ponte com o BRLS). Testa as travas do lado da Caixa Forte, sem navegador.
import { check, finish } from './helpers.mjs';
import { ethers } from './mock-chain.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const require = createRequire(import.meta.url);
const carteira = ethers.Wallet.createRandom();
globalThis.window = globalThis;
globalThis.ethers = ethers;
globalThis.document = { readyState: 'complete', getElementById: () => null, body: { classList: { add() {}, remove() {} } } };
globalThis.RdeskWallet = { address: carteira.address, getSigner: async () => carteira, isLocked: () => false, isWatchOnly: () => false };
require(path.join(ROOT, 'apps.js'));
const A = globalThis.RdeskApps;
const app = A.lista()[0];
const pedido = (method, params) => ({ method, params, descricao: 'teste' });
const recusa = async (p) => { try { await A._tratar(app, p); return null; } catch (e) { return e; } };

check('só um app de confiança, na origem do BRLS', app.origem === 'https://digitalrobertlima.github.io' && app.chainId === 137);
check('contas: devolve só a carteira ativa', JSON.stringify(await A._tratar(app, pedido('eth_requestAccounts'))) === JSON.stringify([carteira.address]));
check('rede: Polygon', (await A._tratar(app, pedido('eth_chainId'))) === '0x89');
check('recusa trocar para outra rede', (await recusa(pedido('wallet_switchEthereumChain', [{ chainId: '0x1' }])))?.code === 4902);
check('recusa transação em nome de outra carteira', (await recusa(pedido('eth_sendTransaction', [{ from: ethers.Wallet.createRandom().address, to: carteira.address }])))?.code === 4100);
const tipado = JSON.stringify({ domain: { name: 'x', version: '1', chainId: 1, verifyingContract: carteira.address }, types: { EIP712Domain: [], A: [{ name: 'a', type: 'uint256' }] }, primaryType: 'A', message: { a: 1 } });
check('recusa assinatura para outra rede (anti-reuso)', !!(await recusa(pedido('eth_signTypedData_v4', [carteira.address, tipado]))));
check('recusa método desconhecido (ex.: exportar chave)', (await recusa(pedido('eth_getPrivateKey', [])))?.code === 4200);
const pub = await A._tratar(app, pedido('brls_chavePublica', []));
check('chave pública da conversa = a da carteira (sem expor a privada)', pub === '0x' + carteira.publicKey.slice(4));
const outro = ethers.Wallet.createRandom();
const seg = await A._tratar(app, pedido('brls_segredo', ['0x' + outro.publicKey.slice(4)]));
const esperado = new ethers.utils.SigningKey(outro.privateKey).computeSharedSecret(carteira.publicKey);
check('segredo da conversa bate dos dois lados (ECDH)', seg === esperado);
check('recusa chave malformada', !!(await recusa(pedido('brls_segredo', ['0x1234']))));
// v48.2: rede do app pelo APK (Tor). Só GET/POST, nunca a origem do próprio cofre.
globalThis.location = { origin: 'https://appassets.androidplatform.net' };
globalThis.fetch = async (url, init) => ({ status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ url, metodo: init.method, corpo: init.body ?? null }) });
const ok = await A._rede({ url: 'https://polygon.drpc.org', method: 'POST', headers: { 'content-type': 'application/json', cookie: 'x' }, corpo: '{"id":1}' });
check('rede do app: repassa o pedido e devolve a resposta', ok.status === 200 && JSON.parse(ok.corpo).corpo === '{"id":1}' && ok.conteudo === 'application/json');
check('rede do app: recusa métodos fora de GET/POST', !!(await A._rede({ url: 'https://polygon.drpc.org', method: 'DELETE' })).erro);
check('rede do app: recusa a origem do próprio cofre', !!(await A._rede({ url: 'https://appassets.androidplatform.net/assets/www/index.html' })).erro);
check('rede do app: recusa endereço que não é http(s)', !!(await A._rede({ url: 'file:///etc/passwd' })).erro);
finish();
