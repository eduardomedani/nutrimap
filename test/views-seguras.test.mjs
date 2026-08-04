// Toda view do projeto tem que respeitar o RLS de quem consulta.
//
// POR QUE ISTO É UM TESTE E NÃO UMA LEMBRANÇA:
// no Postgres, uma view roda com os privilégios de QUEM A CRIOU. Criada pelo
// `postgres` do SQL Editor, ela ignora o RLS das tabelas de baixo — e o
// Supabase publica objetos novos do schema public para `anon` e
// `authenticated`. Uma view esquecida vira "select * from ..." devolvendo a
// folha de pagamento de todos os profissionais do projeto.
//
// Aconteceu: `folha_itens_totais` e `documentos_por_competencia` nasceram sem a
// cláusula, mesmo com `recipe_macros` já fazendo certo desde antes. Nada na
// tela denunciava — o RLS das tabelas continuava correto, a view é que passava
// por cima. Este teste existe para a terceira vez não acontecer.

import { grupo, teste, ok, igual } from './runner.mjs';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../db/', import.meta.url);

/** Toda `create view` dos arquivos SQL, com o arquivo e a linha. */
function todasAsViews() {
  const achadas = [];
  for (const arquivo of readdirSync(DIR).filter(f => f.endsWith('.sql'))) {
    const sql = readFileSync(new URL(arquivo, DIR), 'utf8');
    const linhas = sql.split(/\r?\n/);

    linhas.forEach((linha, i) => {
      const m = /^\s*create (?:or replace )?view\s+([\w.]+)/i.exec(linha);
      if (!m) return;
      // A cláusula pode vir na mesma linha ou nas duas seguintes, antes do AS.
      const trecho = linhas.slice(i, i + 3).join(' ');
      achadas.push({
        arquivo,
        linha: i + 1,
        nome: m[1],
        invoker: /security_invoker\s*=\s*(on|true)/i.test(trecho),
      });
    });
  }
  return achadas;
}

grupo('segurança · views respeitam o RLS', () => {
  const views = todasAsViews();

  teste('achei as views do projeto', () => {
    ok(views.length >= 3, `só achei ${views.length} views — o varredor deve estar quebrado`);
  });

  teste('TODA view declara security_invoker', () => {
    const vazando = views
      .filter(v => !v.invoker)
      .map(v => `${v.arquivo}:${v.linha} — ${v.nome}`);
    igual(vazando, [], 'view sem security_invoker ignora o RLS de quem consulta');
  });

  teste('as duas views do financeiro estão na lista conferida', () => {
    // Se alguém renomear ou remover, é para o teste avisar, não passar batido.
    const nomes = views.map(v => v.nome);
    ok(nomes.includes('public.folha_itens_totais'), 'sumiu folha_itens_totais');
    ok(nomes.includes('public.documentos_por_competencia'), 'sumiu documentos_por_competencia');
  });

  teste('existe a migração que corrige o que já está no banco', () => {
    // Corrigir só o arquivo de origem não muda o banco de quem já rodou.
    const correcao = readFileSync(new URL('views_seguras.sql', DIR), 'utf8');
    for (const v of ['folha_itens_totais', 'documentos_por_competencia']) {
      ok(correcao.includes(v), `a correção não recria ${v}`);
    }
    ok(/security_invoker = on/.test(correcao));
    ok(correcao.includes('pg_options_to_table'), 'faltou a consulta que confirma o resultado');
  });
});
