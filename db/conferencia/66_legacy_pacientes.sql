-- ===========================================================================
-- ETAPA 1B - EXTRACAO: public.pacientes
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le catalogo. Pode rodar em producao sem risco.
--
-- Devolve UM resultado com tudo o que a Etapa 1b precisa para escrever o
-- baseline: colunas, tipos, defaults, nullability, constraints, indices,
-- chaves estrangeiras, RLS, policies, triggers e grants.
--
-- Um select so, de proposito: o SQL Editor do Supabase mostra apenas o
-- ULTIMO resultado, e um script com varios selects perderia tudo menos o
-- ultimo em silencio.
--
-- Para colar no SQL Editor, use a versao sem comentarios:
--   db/conferencia/66_legacy_pacientes_LIMPO.sql
-- ===========================================================================

with colunas as (
  select
    'COLUNA' as secao,
    a.attnum::int as ordem,
    a.attname
      || ' ' || format_type(a.atttypid, a.atttypmod)
      || case when a.attnotnull then ' not null' else '' end
      || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
      || case when a.attidentity::text <> '' then ' [identity ' || a.attidentity::text || ']' else '' end
      || case when a.attgenerated::text <> '' then ' [generated]' else '' end
      as linha
  from pg_attribute a
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = 'public.pacientes'::regclass
    and a.attnum > 0
    and not a.attisdropped
),
constraints as (
  select
    'CONSTRAINT' as secao,
    row_number() over (order by c.conname)::int as ordem,
    c.conname || ' :: ' || pg_get_constraintdef(c.oid) as linha
  from pg_constraint c
  where c.conrelid = 'public.pacientes'::regclass
),
indices as (
  select
    'INDICE' as secao,
    row_number() over (order by i.indexname)::int as ordem,
    i.indexdef as linha
  from pg_indexes i
  where i.schemaname = 'public' and i.tablename = 'pacientes'
),
rls as (
  select
    'RLS' as secao,
    0 as ordem,
    'row level security = ' || case when c.relrowsecurity then 'ENABLED' else 'DISABLED' end
      || ' / forcada = ' || case when c.relforcerowsecurity then 'sim' else 'nao' end as linha
  from pg_class c
  where c.oid = 'public.pacientes'::regclass
),
policies as (
  select
    'POLICY' as secao,
    row_number() over (order by p.policyname)::int as ordem,
    p.policyname
      || ' | cmd=' || p.cmd
      || ' | roles=' || array_to_string(p.roles, ',')
      || ' | permissive=' || p.permissive
      || ' | using=' || coalesce(p.qual, '(nenhum)')
      || ' | check=' || coalesce(p.with_check, '(nenhum)')
      as linha
  from pg_policies p
  where p.schemaname = 'public' and p.tablename = 'pacientes'
),
triggers as (
  select
    'TRIGGER' as secao,
    row_number() over (order by t.tgname)::int as ordem,
    pg_get_triggerdef(t.oid) as linha
  from pg_trigger t
  where t.tgrelid = 'public.pacientes'::regclass
    and not t.tgisinternal
),
grants as (
  select
    'GRANT' as secao,
    row_number() over (order by grantee, privilege_type)::int as ordem,
    grantee || ' : ' || privilege_type as linha
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'pacientes'
),
referencias as (
  select
    'REFERENCIADA_POR' as secao,
    row_number() over (order by c.conrelid::regclass::text)::int as ordem,
    c.conrelid::regclass::text || ' :: ' || pg_get_constraintdef(c.oid) as linha
  from pg_constraint c
  where c.confrelid = 'public.pacientes'::regclass
),
tudo as (
  select * from colunas
  union all select * from constraints
  union all select * from indices
  union all select * from rls
  union all select * from policies
  union all select * from triggers
  union all select * from grants
  union all select * from referencias
)
select
  secao,
  ordem,
  linha
from tudo
order by
  case secao
    when 'COLUNA' then 1
    when 'CONSTRAINT' then 2
    when 'INDICE' then 3
    when 'RLS' then 4
    when 'POLICY' then 5
    when 'TRIGGER' then 6
    when 'GRANT' then 7
    when 'REFERENCIADA_POR' then 8
  end,
  ordem;
