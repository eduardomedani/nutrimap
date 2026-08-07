with f as (
  select
    p.oid,
    p.proname                                      as funcao,
    pg_get_function_identity_arguments(p.oid)      as args,
    has_function_privilege('anon', p.oid, 'execute')          as anon,
    has_function_privilege('authenticated', p.oid, 'execute') as auth,
    p.prosecdef                                    as definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
),
precisam_de_anon as (
  select unnest(array[
    'rpc_buscar_paciente_por_codigo',
    'rpc_salvar_respostas',
    'rpc_marcar_completo',
    'validar_codigo_convite',
    'registrar_uso_codigo'
  ]) as funcao
)
select
  case when pa.funcao is not null then 'PRECISA de anon' else 'nao precisa' end as papel,
  f.funcao,
  f.args,
  f.anon  as anon_executa,
  f.auth  as auth_executa,
  f.definer
from f
left join precisam_de_anon pa on pa.funcao = f.funcao
order by (pa.funcao is null), f.funcao;

select
  count(*)                                    as total_funcoes,
  count(*) filter (where anon)                as anon_executa,
  count(*) filter (where auth)                as auth_executa,
  count(*) filter (where definer)             as security_definer
from (
  select
    has_function_privilege('anon', p.oid, 'execute')          as anon,
    has_function_privilege('authenticated', p.oid, 'execute') as auth,
    p.prosecdef                                               as definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
) x;
