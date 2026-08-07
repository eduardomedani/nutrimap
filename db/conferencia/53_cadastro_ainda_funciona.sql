select
  p.proname                                                 as funcao,
  case when p.prosecdef then 'definer' else 'invoker' end   as modo,
  has_function_privilege('anon', p.oid, 'execute')          as anon_executa,
  has_function_privilege('authenticated', p.oid, 'execute') as auth_executa,
  case
    when not p.prosecdef then 'QUEBRADO — invoker sem policy nao le a tabela'
    when not has_function_privilege('anon', p.oid, 'execute')
     and not has_function_privilege('authenticated', p.oid, 'execute')
      then 'QUEBRADO — ninguem pode executar'
    when has_function_privilege('anon', p.oid, 'execute')
      then 'ok — quem ainda nao tem conta consegue validar o codigo'
    else 'ATENCAO — so quem ja esta logado valida o codigo'
  end                                                       as situacao
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('validar_codigo_convite', 'admin_listar_codigos', 'admin_is')
order by p.proname;
