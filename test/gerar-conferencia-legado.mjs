// ═══════════════════════════════════════════════════════════
// GERADOR DA CONFERÊNCIA DO BASELINE LEGADO
// ═══════════════════════════════════════════════════════════
// Lê os cinco baselines de db/*_legacy_baseline.sql e emite
// db/conferencia/70_legacy_baseline_comparacao.sql — um script que roda no
// SQL Editor e devolve, por item, se o banco continua igual ao repositório.
//
// POR QUE UM GERADOR, E NÃO UM .sql ESCRITO À MÃO.
//
// A conferência precisa saber o que ESPERAR: 100+ colunas, 20 constraints,
// 10 índices, 8 estados de RLS, 7 policies, 6 funções. Escrever isso à mão
// num segundo arquivo criaria uma segunda fonte para a mesma verdade — e a
// segunda fonte envelhece calada. Este projeto já pagou por isso: a reserva
// da barra do PWA existia em dois lugares e o vão embaixo do último cartão
// voltou três vezes.
//
// Aqui o baseline é a única fonte. O .sql é derivado, e regerá-lo é um
// comando. Uma guarda em test/legacy-baseline.test.mjs confere que o arquivo
// gerado está em dia com os baselines.
//
// O QUE É NORMALIZADO, E O QUE NÃO É.
//
// O catálogo do Postgres devolve o texto na representação DELE, não na que
// foi escrita. Comparar cru daria divergência em tudo. Então:
//
//   sempre        minúsculas e espaços colapsados (representação pura)
//   constraints   remove `public.` (o catálogo não qualifica)
//   índices       remove `if not exists`
//   predicados    remove parênteses e `public.` — ver a ressalva abaixo
//   corpo         só espaços colapsados
//
// NÃO é normalizado: default, tipo, precisão, nullability, role, comando da
// policy, privilégio, volatilidade, security, search_path. Uma diferença em
// qualquer um deles aparece como DIFF.
//
// A RESSALVA, e ela é honesta: nos PREDICADOS de policy, remover parênteses
// pode em tese esconder uma mudança de precedência (`a and b or c`). Foi a
// escolha possível — o Postgres reescreve `exists (select 1 from
// public.pacientes p ...)` como `(EXISTS ( SELECT 1 FROM pacientes p ...))`,
// e sem isso toda policy com subconsulta daria falso DIFF. Trocar `=` por
// `<>`, mudar coluna ou trocar `auth.uid()` continua aparecendo.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const raiz = new URL('../', import.meta.url);
const lerDb = f => readFileSync(new URL(`db/${f}`, raiz), 'utf8');

// `_baseline.sql`, e não `_legacy_baseline.sql`: o arquivo das RPCs se chama
// auth_legacy_rpcs_baseline.sql e ficava de fora do filtro mais estreito — o
// gerador rodava feliz e emitia zero funções.
export const BASELINES = readdirSync(new URL('db/', raiz))
  .filter(f => f.endsWith('_baseline.sql'))
  .sort();

// ── normalização ───────────────────────────────────────────
const espacos = s => s.replace(/\s+/g, ' ').trim().toLowerCase();
const semSchema = s => s.replace(/public\./g, '');
const semParens = s => s.replace(/[()]/g, ' ');

const normPadrao    = s => espacos(s);
const normConstraint = s => espacos(semSchema(s));
// `;` fora: pg_indexes.indexdef vem sem o ponto e vírgula, e a captura do
// baseline trazia o do fim da instrução. Eram 8 falsos DIFF.
const normIndice     = s => espacos(semSchema(s.replace(/if not exists /i, '').replace(/;\s*$/, '')));
const normPredicado  = s => espacos(semParens(semSchema(s)));
const normCorpo      = s => espacos(s);

// ── leitura dos baselines ──────────────────────────────────
/** Tudo o que o baseline declara, como (objeto, item, valor) já normalizado. */
export function esperados() {
  const linhas = [];
  const add = (objeto, item, valor) => linhas.push({ objeto, item, valor });

  for (const arq of BASELINES) {
    const sql = lerDb(arq);

    // create table … ( … );
    const tabelas = sql.matchAll(/create table if not exists public\.([a-z_]+) \(([\s\S]*?)\n\);/g);
    for (const [, tabela, corpo] of tabelas) {
      const cols = corpo.split('\n')
        .map(l => l.trim().replace(/,$/, ''))
        .filter(l => l && !l.startsWith('--'));
      cols.forEach((c, i) => add(tabela, `coluna:${String(i + 1).padStart(2, '0')}`, normPadrao(c)));
      add(tabela, 'colunas:total', String(cols.length));
    }

    // alter table … add constraint NOME <definição>;
    for (const [, tabela, nome, def] of
         sql.matchAll(/alter table public\.([a-z_]+) add\s+constraint (\S+)\s+([\s\S]*?);\n/g)) {
      add(tabela, `constraint:${nome}`, normConstraint(def));
    }

    // create [unique] index if not exists NOME on public.TABELA …;
    for (const [inteiro, , nome, tabela] of
         sql.matchAll(/(create (?:unique )?index if not exists (\S+)\s+on public\.([a-z_]+)[\s\S]*?);\n/g)) {
      add(tabela, `indice:${nome}`, normIndice(inteiro));
    }

    // RLS
    for (const [, tabela] of sql.matchAll(/alter table public\.([a-z_]+) enable row level security/g)) {
      add(tabela, 'rls', 'enabled');
    }

    // create policy NOME on public.TABELA for CMD to ROLES [using (…)] [with check (…)]
    for (const [, nomeCru, tabela, resto] of
         sql.matchAll(/create policy ("[^"]+"|\S+) on public\.([a-z_]+)\s*([\s\S]*?);\n/g)) {
      const nome = nomeCru.replace(/^"|"$/g, '');
      const cmd   = (resto.match(/for\s+(all|select|insert|update|delete)/i) || [])[1] || '?';
      const roles = (resto.match(/to\s+([a-z_,\s]+?)(?:\s+using|\s+with check|$)/i) || [])[1] || '?';
      const usar  = extrairParenteses(resto, /using\s*\(/i);
      const check = extrairParenteses(resto, /with check\s*\(/i);
      add(tabela, `policy:${nome}:cmd`,   normPadrao(cmd));
      add(tabela, `policy:${nome}:roles`, normPadrao(roles.replace(/\s/g, '')));
      add(tabela, `policy:${nome}:using`, usar  ? normPredicado(usar)  : '(nenhum)');
      add(tabela, `policy:${nome}:check`, check ? normPredicado(check) : '(nenhum)');
    }

    // CREATE OR REPLACE FUNCTION public.NOME(args) … $function$ corpo $function$;
    for (const [, nome, args, cabecalho, corpo] of
         sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(([^)]*)\)\n([\s\S]*?)AS \$function\$([\s\S]*?)\$function\$;/g)) {
      const f = `fn:${nome}`;
      add(f, 'assinatura', normPadrao(args));
      add(f, 'linguagem',  normPadrao((cabecalho.match(/LANGUAGE (\w+)/) || [])[1] || '?'));
      add(f, 'security',   /SECURITY DEFINER/.test(cabecalho) ? 'definer' : 'invoker');
      add(f, 'search_path', (cabecalho.match(/SET search_path TO '([^']+)'/) || [])[1] || '(sem set)');
      add(f, 'corpo',      normCorpo(corpo));
    }

    // create trigger NOME … on public.TABELA …;
    for (const [inteiro, nome] of sql.matchAll(/create trigger (\S+)[\s\S]*?;\n/g)) {
      add(`trg:${nome}`, 'definicao', normPadrao(semSchema(inteiro.replace(/;\s*$/, ''))));
      // O baseline não tem como declarar "habilitado" — um trigger criado
      // nasce habilitado, e `alter table … disable trigger` é outra coisa. A
      // expectativa é implícita, e precisa ser explicitada aqui: sem isto o
      // banco devolvia `enabled` e a conferência dizia SO NO BANCO.
      add(`trg:${nome}`, 'enabled', 'habilitado');
    }
  }
  return linhas;
}

/** O conteúdo de um `(...)` equilibrado a partir de onde a marca casar. */
function extrairParenteses(texto, marca) {
  const m = texto.match(marca);
  if (!m) return null;
  let i = m.index + m[0].length, nivel = 1, saida = '';
  while (i < texto.length && nivel > 0) {
    const c = texto[i];
    if (c === '(') nivel++;
    else if (c === ')') { nivel--; if (!nivel) break; }
    saida += c;
    i++;
  }
  return nivel === 0 ? saida : null;
}

// ── inventário, para as guardas ────────────────────────────
export function inventario() {
  const linhas = esperados();
  const tabelas = [...new Set(linhas.filter(l => l.item === 'rls').map(l => l.objeto))].sort();
  const funcoes = [...new Set(linhas.filter(l => l.objeto.startsWith('fn:')).map(l => l.objeto.slice(3)))].sort();
  const triggers = [...new Set(linhas.filter(l => l.objeto.startsWith('trg:')).map(l => l.objeto.slice(4)))].sort();
  return { tabelas, funcoes, triggers, itens: linhas.length };
}

// ── geração do SQL ─────────────────────────────────────────
const aspas = s => "'" + String(s).replace(/'/g, "''") + "'";

export function gerarSql() {
  const linhas = esperados();
  const { tabelas, funcoes, triggers } = inventario();

  const valores = linhas
    .map(l => `    (${aspas(l.objeto)}, ${aspas(l.item)}, ${aspas(l.valor)})`)
    .join(',\n');

  const listaTabelas = tabelas.map(aspas).join(', ');
  const listaFuncoes = funcoes.map(aspas).join(', ');
  const listaTriggers = triggers.map(aspas).join(', ');

  return `with esperado(objeto, item, valor) as (
  values
${valores}
),
tabelas(nome) as (values (${listaTabelas.split(', ').join('), (')})),
funcoes(nome) as (values (${listaFuncoes.split(', ').join('), (')})),
gatilhos(nome) as (values (${listaTriggers.split(', ').join('), (')})),

reg as (select t.nome, to_regclass('public.' || t.nome) as rel from tabelas t),

atual_colunas as (
  select r.nome as objeto,
         'coluna:' || lpad((row_number() over (partition by r.nome order by a.attnum))::text, 2, '0') as item,
         lower(regexp_replace(
           a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
           || case when a.attnotnull then ' not null' else '' end
           || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), ''),
           '\\s+', ' ', 'g')) as valor
  from reg r
  join pg_attribute a on a.attrelid = r.rel and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where r.rel is not null
),
atual_total as (
  select r.nome, 'colunas:total', count(*)::text
  from reg r join pg_attribute a on a.attrelid = r.rel and a.attnum > 0 and not a.attisdropped
  where r.rel is not null group by r.nome
),
atual_constraints as (
  select r.nome, 'constraint:' || c.conname,
         lower(regexp_replace(replace(pg_get_constraintdef(c.oid), 'public.', ''), '\\s+', ' ', 'g'))
  from reg r join pg_constraint c on c.conrelid = r.rel
  where r.rel is not null
),
atual_indices as (
  select r.nome, 'indice:' || i.indexname,
         lower(regexp_replace(replace(i.indexdef, 'public.', ''), '\\s+', ' ', 'g'))
  from reg r
  join pg_indexes i on i.schemaname = 'public' and i.tablename = r.nome
  where r.rel is not null
    and not exists (select 1 from pg_constraint c
                     where c.conrelid = r.rel and c.conname = i.indexname)
),
atual_rls as (
  select r.nome, 'rls',
         case when c.relrowsecurity then 'enabled' else 'disabled' end
  from reg r join pg_class c on c.oid = r.rel where r.rel is not null
),
atual_policies as (
  select p.tablename, 'policy:' || p.policyname || ':cmd', lower(p.cmd)
  from pg_policies p where p.schemaname = 'public' and p.tablename in (select nome from tabelas)
  union all
  select p.tablename, 'policy:' || p.policyname || ':roles',
         lower(replace(array_to_string(p.roles, ','), ' ', ''))
  from pg_policies p where p.schemaname = 'public' and p.tablename in (select nome from tabelas)
  union all
  select p.tablename, 'policy:' || p.policyname || ':using',
         case when p.qual is null then '(nenhum)'
              else lower(regexp_replace(translate(replace(p.qual, 'public.', ''), '()', '  '), '\\s+', ' ', 'g')) end
  from pg_policies p where p.schemaname = 'public' and p.tablename in (select nome from tabelas)
  union all
  select p.tablename, 'policy:' || p.policyname || ':check',
         case when p.with_check is null then '(nenhum)'
              else lower(regexp_replace(translate(replace(p.with_check, 'public.', ''), '()', '  '), '\\s+', ' ', 'g')) end
  from pg_policies p where p.schemaname = 'public' and p.tablename in (select nome from tabelas)
),
atual_funcoes as (
  select 'fn:' || p.proname, 'assinatura',
         lower(regexp_replace(pg_get_function_identity_arguments(p.oid), '\\s+', ' ', 'g'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (select nome from funcoes)
  union all
  select 'fn:' || p.proname, 'linguagem', l.lanname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public' and p.proname in (select nome from funcoes)
  union all
  select 'fn:' || p.proname, 'security',
         case when p.prosecdef then 'definer' else 'invoker' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (select nome from funcoes)
  union all
  select 'fn:' || p.proname, 'search_path',
         coalesce((select replace(c, 'search_path=', '')
                     from unnest(p.proconfig) c where c like 'search_path=%'), '(sem set)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (select nome from funcoes)
  union all
  select 'fn:' || p.proname, 'corpo',
         lower(regexp_replace(p.prosrc, '\\s+', ' ', 'g'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (select nome from funcoes)
),
atual_triggers as (
  select 'trg:' || t.tgname, 'definicao',
         lower(regexp_replace(replace(pg_get_triggerdef(t.oid), 'public.', ''), '\\s+', ' ', 'g'))
  from pg_trigger t
  where not t.tgisinternal and t.tgname in (select nome from gatilhos)
),
atual_enabled as (
  select 'trg:' || t.tgname, 'enabled',
         case t.tgenabled when 'D' then 'DESABILITADO' else 'habilitado' end
  from pg_trigger t
  where not t.tgisinternal and t.tgname in (select nome from gatilhos)
),
atual(objeto, item, valor) as (
  select objeto, item, btrim(valor) from (
    select * from atual_colunas
    union all select * from atual_total
    union all select * from atual_constraints
    union all select * from atual_indices
    union all select * from atual_rls
    union all select * from atual_policies
    union all select * from atual_funcoes
    union all select * from atual_triggers
    union all select * from atual_enabled
  ) t(objeto, item, valor)
),
comparado as (
  select
    coalesce(e.objeto, a.objeto) as objeto,
    coalesce(e.item, a.item)     as item,
    case
      when a.valor is null then 'AUSENTE NO BANCO'
      when e.valor is null then 'SO NO BANCO'
      when e.valor = a.valor then 'OK'
      else 'DIFF'
    end as resultado,
    e.valor as baseline,
    a.valor as banco
  from esperado e
  full outer join atual a on a.objeto = e.objeto and a.item = e.item
),
resumo as (
  select
    'zz TOTAL' as objeto,
    (select count(distinct objeto) from comparado where objeto not like 'fn:%' and objeto not like 'trg:%')::text
      || ' tabelas / '
      || (select count(distinct objeto) from comparado where objeto like 'fn:%')::text
      || ' RPCs / '
      || (select count(distinct objeto) from comparado where objeto like 'trg:%')::text
      || ' triggers' as item,
    case when exists (select 1 from comparado where resultado <> 'OK')
         then (select count(*)::text from comparado where resultado <> 'OK') || ' DIVERGENCIA(S)'
         else 'SEM DIVERGENCIAS' end as resultado,
    null::text as baseline,
    null::text as banco
)
select * from comparado where resultado <> 'OK'
union all
select * from (
  select objeto, 'z ' || count(*)::text || ' itens conferidos' as item,
         'OK' as resultado, null::text, null::text
  from comparado where resultado = 'OK' group by objeto
) ok
union all
select * from resumo
order by objeto, item;
`;
}

// ── escrita ────────────────────────────────────────────────
const ALVO = 'conferencia/70_legacy_baseline_comparacao.sql';

const CABECALHO = `-- ===========================================================================
-- CONFERENCIA DO BASELINE LEGADO — repositorio x banco
-- ---------------------------------------------------------------------------
-- ARQUIVO GERADO. Nao edite a mao: regenere com
--
--     node test/gerar-conferencia-legado.mjs
--
-- A fonte e db/*_legacy_baseline.sql. Editar aqui cria a segunda fonte que o
-- gerador existe para evitar.
--
-- NAO ALTERA NADA. So le catalogo. Pode rodar em producao sem risco.
--
-- COMO LER A SAIDA:
--   linhas com resultado OK    contagem de itens conferidos por objeto
--   linhas com DIFF            baseline e banco divergem — as duas aparecem
--   AUSENTE NO BANCO           o objeto sumiu ou foi renomeado
--   SO NO BANCO                apareceu algo que o baseline nao conhece
--   ultima linha (zz TOTAL)    o veredito
--
-- Qualquer coisa diferente de SEM DIVERGENCIAS **para a Etapa 2**. A migracao
-- multiusuario precisa saber o que mudou antes de comecar.
--
-- Para colar no SQL Editor, use db/conferencia/70_legacy_baseline_comparacao_LIMPO.sql
-- ===========================================================================

`;

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('gerar-conferencia-legado.mjs')) {
  const sql = gerarSql();
  writeFileSync(new URL(`db/${ALVO}`, raiz), CABECALHO + sql);
  writeFileSync(new URL(`db/conferencia/70_legacy_baseline_comparacao_LIMPO.sql`, raiz), sql);
  const inv = inventario();
  console.log(`gerado db/${ALVO}`);
  console.log(`  ${inv.tabelas.length} tabelas : ${inv.tabelas.join(', ')}`);
  console.log(`  ${inv.funcoes.length} RPCs    : ${inv.funcoes.join(', ')}`);
  console.log(`  ${inv.triggers.length} trigger : ${inv.triggers.join(', ')}`);
  console.log(`  ${inv.itens} itens conferidos`);
}
