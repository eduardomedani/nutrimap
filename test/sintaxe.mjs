// `node --check` em todo módulo do projeto (parte do `npm run check`).
// Não executa nada: só confirma que cada arquivo parseia. Num projeto servido
// direto ao navegador, um erro de sintaxe é uma tela branca sem aviso.

import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function varrer(dir, saida = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) varrer(p, saida);
    else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) saida.push(p);
  }
  return saida;
}

const arquivos = varrer(RAIZ);
const falhas = [];
for (const arq of arquivos) {
  try {
    execFileSync(process.execPath, ['--check', arq], { stdio: 'pipe' });
  } catch (e) {
    falhas.push(`${relative(RAIZ, arq)}\n      ${String(e.stderr || e.message).split('\n').slice(0, 3).join('\n      ')}`);
  }
}

if (falhas.length) {
  for (const f of falhas) console.log(`  ${f}`);
  console.log(`\n  ${falhas.length} arquivo(s) com erro de sintaxe\n`);
  process.exit(1);
}
console.log(`  ok — ${arquivos.length} arquivos parseiam sem erro\n`);
