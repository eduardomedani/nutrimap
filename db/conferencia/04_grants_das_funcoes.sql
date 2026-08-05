select routine_name, grantee, privilege_type
  from information_schema.role_routine_grants
 where specific_schema = 'public'
   and grantee in ('authenticated', 'anon')
   and routine_name in ('funcionario_do_auth', 'documento_e_meu', 'marcar_documento_visualizado',
                        'vincular_documento_pendente', 'vincular_funcionario',
                        'vincular_funcionario_por_email')
 order by routine_name, grantee;
