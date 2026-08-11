-- ===========================================================================
-- ETAPA 1B - EXTRACAO: todas as tabelas legadas, num script so
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le catalogo. Pode rodar em producao sem risco.
--
-- Substitui 66 e 67, que cobriam uma tabela cada. A lista cresceu quando o
-- dump de `pacientes` revelou quatro tabelas que nao estao em db/*.sql e que
-- ninguem sabia que existiam - todas apareceram pelas FKs que apontam para
-- pacientes:
--
--   pacientes          o cadastro (ja extraido)
--   nutricionistas     o pai de pacientes: nutri_id REFERENCES nutricionistas(id)
--   avaliacoes         dado clinico
--   exames             dado clinico
--   recordatorio_calc  dado clinico
--   respostas          as respostas do questionario, dado clinico
--
-- Para acrescentar outra tabela, basta incluir o nome no array de `alvo`.
-- Tabela que nao existir aparece como AUSENTE em vez de sumir do resultado.
--
-- Para colar no SQL Editor, use a versao sem comentarios:
--   db/conferencia/69_legacy_tabelas_LIMPO.sql
-- ===========================================================================

with alvo as (
  select unnest(array[
    'avaliacoes',
    'exames',
    'recordatorio_calc',
    'respostas',
    'codigos_convite',
    'codigos_uso'
  ]) as nome
),
reg as (
  select a.nome, to_regclass('public.' || a.nome) as rel
  from alvo a
),
ausentes as (
  select r.nome as tabela, 'AUSENTE' as secao, 0 as ordem,
         'nao existe em public' as linha
  from reg r where r.rel is null
),
colunas as (
  select
    r.nome as tabela,
    'COLUNA' as secao,
    a.attnum::int as ordem,
    a.attname
      || ' ' || format_type(a.atttypid, a.atttypmod)
      || case when a.attnotnull then ' not null' else '' end
      || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
      || case when a.attidentity::text <> '' then ' [identity]' else '' end
      || case when a.attgenerated::text <> '' then ' [generated]' else '' end
      as linha
  from reg r
  join pg_attribute a on a.attrelid = r.rel
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where r.rel is not null and a.attnum > 0 and not a.attisdropped
),
constraints as (
  select
    r.nome as tabela,
    'CONSTRAINT' as secao,
    row_number() over (partition by r.nome order by c.conname)::int as ordem,
    c.conname || ' :: ' || pg_get_constraintdef(c.oid) as linha
  from reg r
  join pg_constraint c on c.conrelid = r.rel
  where r.rel is not null
),
indices as (
  select
    r.nome as tabela,
    'INDICE' as secao,
    row_number() over (partition by r.nome order by i.indexname)::int as ordem,
    i.indexdef as linha
  from reg r
  join pg_indexes i on i.schemaname = 'public' and i.tablename = r.nome
  where r.rel is not null
),
rls as (
  select
    r.nome as tabela,
    'RLS' as secao,
    0 as ordem,
    'row level security = ' || case when c.relrowsecurity then 'ENABLED' else 'DISABLED' end
      || ' / forcada = ' || case when c.relforcerowsecurity then 'sim' else 'nao' end as linha
  from reg r
  join pg_class c on c.oid = r.rel
  where r.rel is not null
),
policies as (
  select
    r.nome as tabela,
    'POLICY' as secao,
    row_number() over (partition by r.nome order by p.policyname)::int as ordem,
    p.policyname
      || ' | cmd=' || p.cmd
      || ' | roles=' || array_to_string(p.roles, ',')
      || ' | using=' || coalesce(p.qual, '(nenhum)')
      || ' | check=' || coalesce(p.with_check, '(nenhum)')
      as linha
  from reg r
  join pg_policies p on p.schemaname = 'public' and p.tablename = r.nome
  where r.rel is not null
),
triggers as (
  select
    r.nome as tabela,
    'TRIGGER' as secao,
    row_number() over (partition by r.nome order by t.tgname)::int as ordem,
    pg_get_triggerdef(t.oid) as linha
  from reg r
  join pg_trigger t on t.tgrelid = r.rel and not t.tgisinternal
  where r.rel is not null
),
grants as (
  select
    r.nome as tabela,
    'GRANT' as secao,
    row_number() over (partition by r.nome order by g.grantee)::int as ordem,
    g.grantee || ' : ' || string_agg(g.privilege_type, ',' order by g.privilege_type) as linha
  from reg r
  join information_schema.role_table_grants g
    on g.table_schema = 'public' and g.table_name = r.nome
  where r.rel is not null
  group by r.nome, g.grantee
),
tudo as (
  select * from ausentes
  union all select * from colunas
  union all select * from constraints
  union all select * from indices
  union all select * from rls
  union all select * from policies
  union all select * from triggers
  union all select * from grants
)
select
  tabela,
  secao,
  ordem,
  linha
from tudo
order by
  tabela,
  case secao
    when 'AUSENTE' then 0
    when 'COLUNA' then 1
    when 'CONSTRAINT' then 2
    when 'INDICE' then 3
    when 'RLS' then 4
    when 'POLICY' then 5
    when 'TRIGGER' then 6
    when 'GRANT' then 7
  end,
  ordem;
