#!/usr/bin/env bash
# Copia o app web para dentro do APK e liga a ponte do Tor.
# - injeta android/bridge/native-bridge.js como o PRIMEIRO script da página;
# - fecha o CSP: o WebView só fala com o próprio app (connect-src 'self').
#   Tudo que vai para fora passa pela ponte nativa, pelo Tor.
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
echo "Arquivos no APK: $(find "$OUT" -type f | wc -l)"
