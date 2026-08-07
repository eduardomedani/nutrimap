select
  p.proname                        as funcao,
  case when p.prosecdef then 'SECURITY DEFINER' else 'security invoker' end as modo,
  pg_get_function_arguments(p.oid) as argumentos,
  has_function_privilege('anon', p.oid, 'execute')          as anon_executa,
  has_function_privilege('authenticated', p.oid, 'execute') as auth_executa
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('validar_codigo_convite', 'usar_codigo_convite', 'registrar_uso_codigo');

select
  tablename,
  policyname,
  cmd,
  roles::text  as papeis,
  qual         as using_condicao,
  with_check   as check_condicao
from pg_policies
where schemaname = 'public'
  and tablename in ('codigos_convite', 'exames', 'nutricionistas')
order by tablename, cmd, policyname;

select
  count(*)                                          as total_codigos,
  count(*) filter (where ativo)                     as ativos,
  count(*) filter (where not ativo)                 as inativos
from public.codigos_convite;
