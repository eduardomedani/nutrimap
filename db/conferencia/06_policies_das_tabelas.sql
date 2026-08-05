select tablename, policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename in ('colaborador_documentos', 'documentos_pendentes', 'documento_auditoria')
 order by tablename, policyname;
