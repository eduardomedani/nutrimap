select p.proname,
       case when p.proacl is null then 'sem acl explicita'
            when a.grantee = 0 then 'PUBLIC'
            else a.grantee::regrole::text end as quem,
       coalesce(a.privilege_type, 'EXECUTE por padrao') as privilegio
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  left join lateral aclexplode(p.proacl) a on true
 where n.nspname = 'public'
   and p.proname in ('funcionario_do_auth', 'documento_e_meu', 'marcar_documento_visualizado',
                     'vincular_documento_pendente', 'vincular_funcionario',
                     'vincular_funcionario_por_email', 'registrar_auditoria_documento')
 order by p.proname, quem;
