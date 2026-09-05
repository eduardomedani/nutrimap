// ═══════════════════════════════════════════════════════════
// GERADOR — os arquivos _LIMPO, a partir dos originais
// ═══════════════════════════════════════════════════════════
// Uso:  node db/gerar_limpos.mjs [nome-ou-pedaço-do-nome]
//
// Um `_LIMPO.sql` é o mesmo SQL sem as linhas de comentário, para colar no SQL
// Editor do Supabase — onde um `--` que perde a quebra de linha vira comando.
// Eles são derivados e ficam fora do git (.gitignore), como o seed.
//
// ESTE ARQUIVO EXISTE POR CAUSA DE UM INCIDENTE, em 05/09/2026. O
// db/financeiro_folha_despesa.sql ganhou a regra que faz o espelho da folha
// ceder a vez à FOPAG importada da planilha; o `_LIMPO` foi gerado ANTES dessa
// mudança e não foi refeito. Rodado no banco, ele criou 32 espelhos — 29 deles
// em competências que a planilha já respondia, contando a folha duas vezes.
//
// Nada no SQL denunciava isso: os dois arquivos existiam, ambos rodavam, e o
// que estava desatualizado era justamente o que se cola. Regenerar à mão é
// exatamente o passo que se esquece.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

/** O SQL sem os comentários e sem linhas em branco repetidas. */
export function limpar(sql) {
  return String(sql)
    .split(/\r?\n/)
    .filter(l => !/^\s*--/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '');
}

/** Todo .sql de db/ e db/conferencia/ que não é, ele mesmo, um _LIMPO. */
function originais(pasta) {
  const fora = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) {
      if (nome === 'conferencia') fora.push(...originais(caminho));
      continue;
    }
    if (!nome.endsWith('.sql') || nome.endsWith('_LIMPO.sql')) continue;
    fora.push(caminho);
  }
  return fora;
}

const comoScript = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (comoScript) {
  const filtro = process.argv[2] || '';
  let escritos = 0;

  for (const caminho of originais(AQUI)) {
    if (filtro && !caminho.includes(filtro)) continue;
    const destino = caminho.replace(/\.sql$/, '_LIMPO.sql');
    // SÓ REESCREVE O QUE JÁ EXISTE, a menos que se peça um arquivo pelo nome.
    // Gerar `_LIMPO` para os 150 SQLs do repositório encheria a pasta de
    // arquivos que ninguém pediu e esconderia os que se usa de verdade.
    let existe = true;
    try { statSync(destino); } catch { existe = false; }
    if (!existe && !filtro) continue;

    writeFileSync(destino, limpar(readFileSync(caminho, 'utf8')), 'utf8');
    console.log(`  ${destino.replace(AQUI + '\\', '').replace(AQUI + '/', '')}`);
    escritos++;
  }

  console.log(`  ${escritos} arquivo(s) _LIMPO regenerado(s)`);
}
