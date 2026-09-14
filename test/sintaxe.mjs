// `node --check` em todo módulo do projeto (parte do `npm run check`).
// Não executa nada: só confirma que cada arquivo parseia. Num projeto servido
// direto ao navegador, um erro de sintaxe é uma tela branca sem aviso.
//
// Exporta `varrer()` para o teste usar; roda sozinho como script — o mesmo
// desenho de test/check-imports.mjs. Sem isso, o único jeito de testar a
// varredura seria disparar o script inteiro (260 subprocessos `node --check`),
// e uma suíte de 200ms não pode pagar isso para provar uma condição de pasta.

import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function varrer(dir, saida = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    // `nativo/` é a casca Capacitor, e fica FORA: o `www/` de lá é gerado (e
    // nem versionado), e o projeto Android traz JS de terceiros. Varrê-lo fazia
    // a ferramenta da árvore web depender de arquivo que não está no git — num
    // clone novo o número muda sozinho — e dava "check limpo" para quem editasse
    // uma cópia gerada, que é justamente o que ninguém deve editar.
    if (e.name === 'nativo') continue;
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) varrer(p, saida);
    else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) saida.push(p);
  }
  return saida;
}

// Execução direta: node test/sintaxe.mjs
// pathToFileURL, e não string concatenada: no Windows o caminho vira
// file:///C:/... (três barras), e a comparação ingênua nunca bateria.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
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
}
