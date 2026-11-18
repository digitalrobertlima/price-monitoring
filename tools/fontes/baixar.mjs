// Baixa as fontes (Inter, Plus Jakarta Sans, JetBrains Mono — licença SIL OFL) para dentro do site.
// Assim o app não chama o Google a cada visita (que veria o IP de quem usa) e funciona offline, no Tor e no Tails.
// Roda no GitHub Actions (tools/fontes → .github/workflows/fontes.yml).
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const KEEP = new Set(['latin', 'latin-ext']); // português precisa só destes

const css = await (await fetch(URL, { headers: { 'User-Agent': UA } })).text();
const blocks = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*{[^}]+})/g)];
if (!blocks.length) throw new Error('CSS das fontes veio vazio');
await mkdir('fonts', { recursive: true });
let out = '/* Fontes servidas pelo próprio site (SIL Open Font License). Gerado por tools/fontes/baixar.mjs */\n';
let n = 0;
for (const [, subset, face] of blocks) {
    if (!KEEP.has(subset)) continue;
    const src = face.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    if (!src) continue;
    const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
    const fam = face.match(/font-family:\s*'([^']+)'/)[1].replace(/\s+/g, '');
    const w = face.match(/font-weight:\s*(\d+)/)[1];
    const name = `${fam}-${w}-${subset}-${createHash('sha1').update(buf).digest('hex').slice(0, 8)}.woff2`;
    await writeFile(`fonts/${name}`, buf);
    out += `/* ${subset} */\n${face.replace(src, `./${name}`)}\n`;
    n++;
}
await writeFile('fonts/fonts.css', out);
console.log(`${n} arquivos de fonte salvos em fonts/`);
