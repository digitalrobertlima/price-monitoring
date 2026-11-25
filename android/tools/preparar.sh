#!/usr/bin/env bash
# Copia o app web para dentro do APK e liga a ponte do Tor.
# - injeta android/bridge/native-bridge.js como o PRIMEIRO script da página;
# - fecha o CSP: o WebView só fala com o próprio app (connect-src 'self').
#   Tudo que vai para fora passa pela ponte nativa, pelo Tor.
# - embute a carteira BRLS (repositório digitalrobertlima/xBRL, na versão fixada em android/brls.txt):
#   ela abre dentro da Caixa Forte sem baixar nada, e a rede dela passa pela Caixa Forte (Tor).
#   Origem: BRLS_SRC=<pasta do repositório xBRL> (o CI baixa a versão fixada; local: ../xbrl).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/android/app/src/main/assets/www"
rm -rf "$OUT"
mkdir -p "$OUT"
cd "$ROOT"
cp index.html manifest.json LICENSE ./*.js ./*.css "$OUT/"
rm -f "$OUT/sw.js" "$OUT/package.json" "$OUT/package-lock.json"
cp -r vendor audio fonts icons "$OUT/"
cp android/bridge/native-bridge.js "$OUT/native-bridge.js"

python3 - "$OUT/index.html" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
csp_old = re.search(r'connect-src [^;"]*', s)
assert csp_old, 'CSP sem connect-src'
s = s.replace(csp_old.group(0), "connect-src 'self'", 1)
s = s.replace('<link rel="manifest" href="./manifest.json">', '', 1)
anchor = '<script src="vendor/ethers-5.7.2.umd.min.js"'
assert anchor in s, 'âncora dos scripts não encontrada'
s = s.replace(anchor, '<script src="native-bridge.js"></script>\n    ' + anchor, 1)
open(p, 'w', encoding='utf-8').write(s)
print('index.html do APK pronto:', "connect-src 'self'" in s and 'native-bridge.js' in s)
PY
# ---------------------------------------------------------------- BRLS (app dentro da carteira)
BRLS="${BRLS_SRC:-$ROOT/../xbrl}"
BRLS_OUT="$ROOT/android/app/src/main/assets/brls"
if [ ! -f "$BRLS/wallet/index.html" ] || [ ! -f "$BRLS/wallet/src/rede-ponte.js" ]; then
  echo "ERRO: falta a carteira BRLS em $BRLS (com wallet/src/rede-ponte.js)."
  echo "Baixe o repositório digitalrobertlima/xBRL na versão de android/brls.txt e rode com BRLS_SRC=<pasta>."
  exit 1
fi
rm -rf "$BRLS_OUT"
mkdir -p "$BRLS_OUT"
( cd "$BRLS/wallet" && cp index.html comprovante.html estilo.css manifest.json "$BRLS_OUT/" && cp -r icons src "$BRLS_OUT/" )
python3 - "$BRLS_OUT" <<'PY'
import re, sys, os
d = sys.argv[1]
for nome in ('index.html', 'comprovante.html'):
    p = os.path.join(d, nome)
    s = open(p, encoding='utf-8').read()
    m = re.search(r'connect-src [^;"]*', s)
    assert m, nome + ' sem connect-src'
    s = s.replace(m.group(0), "connect-src 'self'", 1)
    s = s.replace('<link rel="manifest" href="manifest.json">', '', 1)
    open(p, 'w', encoding='utf-8').write(s)
assert os.path.exists(os.path.join(d, 'src', 'deployments', '137.json')), 'BRLS sem implantação da Polygon'
print('BRLS no APK pronto (rede só pela Caixa Forte)')
PY

echo "Arquivos no APK: $(find "$OUT" -type f | wc -l) do cofre + $(find "$BRLS_OUT" -type f | wc -l) do BRLS"
