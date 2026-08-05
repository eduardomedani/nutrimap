select tablename, indexname, indexdef
  from pg_indexes
 where schemaname = 'public'
   and tablename in ('colaborador_documentos', 'documentos_pendentes', 'documento_auditoria')
 order by tablename, indexname;
