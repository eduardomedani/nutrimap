select table_name, table_type
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('colaborador_documentos', 'documentos_pendentes', 'documento_auditoria')
 order by table_name;
