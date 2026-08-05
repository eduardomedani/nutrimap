select p.proname,
       pg_get_function_identity_arguments(p.oid) as argumentos,
       pg_get_function_result(p.oid) as retorno,
       p.prosecdef as security_definer,
       p.provolatile as volatilidade
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('funcionario_do_auth', 'documento_e_meu', 'marcar_documento_visualizado',
                     'vincular_documento_pendente', 'vincular_funcionario',
                     'vincular_funcionario_por_email', 'registrar_auditoria_documento')
 order by p.proname;
