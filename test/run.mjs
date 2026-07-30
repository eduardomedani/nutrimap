// Entrada do `npm test`. Importa todo *.test.mjs desta pasta e roda.
// Ordem alfabética, para a saída ser sempre a mesma.

import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rodar } from './runner.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));

const arquivos = readdirSync(AQUI).filter(f => f.endsWith('.test.mjs')).sort();
if (!arquivos.length) {
  console.log('  nenhum arquivo .test.mjs encontrado em test/');
  process.exit(1);
}

console.log(`\n  Evollo — ${arquivos.length} arquivos de teste`);
for (const f of arquivos) await import(pathToFileURL(`${AQUI}/${f}`).href);

await rodar();
