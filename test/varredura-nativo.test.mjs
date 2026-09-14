// ═══════════════════════════════════════════════════════════
// AS FERRAMENTAS DA RAIZ NÃO DESCEM NA CASCA NATIVA
// ═══════════════════════════════════════════════════════════
// Quando `nativo/` nasceu, o `npm run check` pulou de 220 para 261 arquivos: o
// varredor de sintaxe passou a parsear o `www/` gerado e o JS do projeto
// Android. Passou — e era errado por dois motivos. A ferramenta da árvore web
// passou a depender de arquivo que nem está no git (num clone novo o número
// muda sozinho), e quem editasse uma cópia dentro de `www/` veria "check
// limpo", quando `www/` é exatamente o que ninguém deve editar.
//
// Estes testes plantam uma ISCA dentro de `nativo/` — um arquivo que não
// parseia e um import que não resolve — e exigem que as duas varreduras passem
// ao largo. Provar por comportamento, e não procurando a palavra "nativo" no
// código: uma guarda que se satisfaz com texto se resolve apagando o texto.

import { grupo, teste, ok, igual, contem } from './runner.mjs';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { varrer as varrerSintaxe } from './sintaxe.mjs';
import { conferirImports } from './check-imports.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ISCA = `${RAIZ}/nativo/__teste_varredura__`;

function comIsca(fn) {
  mkdirSync(ISCA, { recursive: true });
  // Sintaxe inválida de propósito.
  writeFileSync(`${ISCA}/quebrado.js`, 'export const x = ;\n', 'utf8');
  // Import de um nome que o vizinho não exporta.
  writeFileSync(`${ISCA}/import-ruim.js`, "import { naoExiste } from './quebrado.js';\n", 'utf8');
  try { return fn(); } finally { rmSync(ISCA, { recursive: true, force: true }); }
}

grupo('varredura · a casca nativa fica fora das ferramentas da raiz', () => {
  teste('o varredor de sintaxe não desce em nativo/', () => {
    comIsca(() => {
      const lista = varrerSintaxe(RAIZ);
      // Controle: um varredor que devolvesse lista vazia passaria por engano.
      ok(lista.some((p) => p.endsWith('/js/paciente-ui.js')), 'o varredor não achou nem o app do aluno');
      ok(!lista.some((p) => p.includes('/nativo/')), 'a varredura de sintaxe entrou em nativo/');
    });
  });

  teste('o varredor de imports não desce em nativo/, nem varrendo a raiz', () => {
    comIsca(() => {
      // A raiz EXPLÍCITA: no uso normal ele começa em `js/` e nem chegaria lá.
      // É justamente o caso futuro que a condição defensiva cobre.
      const { arquivos, problemas } = conferirImports(RAIZ);
      ok(arquivos > 0, 'o varredor não achou arquivo nenhum');
      ok(!problemas.some((p) => p.includes('nativo')), `a varredura de imports entrou em nativo/: ${problemas.find((p) => p.includes('nativo'))}`);
    });
  });

  teste('a isca é válida — ela SERIA pega se estivesse na árvore web', () => {
    // Sem isto, os dois testes acima passariam mesmo com uma isca inofensiva.
    comIsca(() => {
      const { problemas } = conferirImports(ISCA);
      ok(problemas.length > 0, 'a isca não é acusada nem quando a varredura aponta direto para ela');
    });
  });

  teste('a condição está escrita em cada varredor', () => {
    contem(readFileSync(`${RAIZ}/test/sintaxe.mjs`, 'utf8'), "e.name === 'nativo'");
    contem(readFileSync(`${RAIZ}/test/check-imports.mjs`, 'utf8'), "e.name === 'nativo'");
  });

  teste('o que sobrou fora de nativo/ continua sendo varrido', () => {
    const lista = varrerSintaxe(RAIZ);
    for (const esperado of ['/js/paciente-ui.js', '/js/acesso-painel.js', '/test/runner.mjs', '/sw.js']) {
      ok(lista.some((p) => p.endsWith(esperado)), `${esperado} saiu da varredura`);
    }
  });
});
