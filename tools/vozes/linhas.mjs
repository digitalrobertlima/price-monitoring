// Lista todas as falas das lições (quem fala + texto + nome do arquivo) a partir de lessons.js
import fs from 'node:fs';
import vm from 'node:vm';
const code = fs.readFileSync(new URL('../../lessons.js', import.meta.url), 'utf8');
const ctx = { window: {} };
vm.runInNewContext(code, ctx);
const lines = ctx.window.RDESK_LESSONS.allLines();
process.stdout.write(JSON.stringify(lines, null, 1));
