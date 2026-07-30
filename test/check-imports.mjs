// ═══════════════════════════════════════════════════════════
// Checagem estática de imports/exports  (npm run check)
// ═══════════════════════════════════════════════════════════
// Confere, SEM executar nada, se cada `import { x } from './y.js'` existe mesmo
// como export em y.js. Pega o erro mais comum de refactor num projeto sem
// bundler e sem type checker: mover uma função e esquecer de exportá-la — que
// no navegador só aparece como tela em branco, em tempo de execução.
//
// Exporta `conferirImports()` para o teste usar; roda sozinho como script.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function varrer(dir, saida = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) varrer(p, saida);
    else if (e.name.endsWith('.js')) saida.push(p);
  }
  return saida;
}

function exportsDe(src) {
  const set = new Set();
  for (const m of src.matchAll(/^\s*export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) set.add(m[1]);
  for (const m of src.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (const parte of m[1].split(',')) {
      const t = parte.trim();
      if (!t) continue;
      const alias = t.split(/\s+as\s+/);
      set.add((alias[1] || alias[0]).trim());
    }
  }
  if (/^\s*export\s+default/m.test(src)) set.add('default');
  if (/^\s*export\s+\*/m.test(src)) set.add('*');
  return set;
}

/** @returns {{arquivos: number, problemas: string[]}} */
export function conferirImports(pasta = `${RAIZ}/js`) {
  const arquivos = varrer(pasta);
  const cache = new Map();
  const pegar = (p) => {
    if (!cache.has(p)) cache.set(p, exportsDe(readFileSync(p, 'utf8')));
    return cache.get(p);
  };

  const problemas = [];
  for (const arq of arquivos) {
    const src = readFileSync(arq, 'utf8');
    const re = /import\s*(?:([\w$]+)\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
    for (const m of src.matchAll(re)) {
      const espec = m[3];
      if (!espec.startsWith('.')) continue;
      const destino = resolve(dirname(arq), espec).replace(/\\/g, '/');
      if (!existsSync(destino)) {
        problemas.push(`${relative(RAIZ, arq)} importa de "${espec}", que não existe`);
        continue;
      }
      const exp = pegar(destino);
      if (exp.has('*')) continue;
      const nomes = m[2].split(',').map(s => s.trim()).filter(Boolean).map(s => s.split(/\s+as\s+/)[0].trim());
      for (const n of nomes) {
        if (!exp.has(n)) problemas.push(`${relative(RAIZ, arq)} importa "${n}" de ${espec}, que não exporta esse nome`);
      }
    }
  }
  return { arquivos: arquivos.length, problemas };
}

// Execução direta: node test/check-imports.mjs
// pathToFileURL, e não string concatenada: no Windows o caminho vira
// file:///C:/... (três barras), e a comparação ingênua nunca bateria.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { arquivos, problemas } = conferirImports();
  if (problemas.length) {
    for (const p of problemas) console.log(`  ${p}`);
    console.log(`\n  ${problemas.length} problema(s) em ${arquivos} arquivos\n`);
    process.exit(1);
  }
  console.log(`  ok — ${arquivos} arquivos, todos os imports resolvem\n`);
}
