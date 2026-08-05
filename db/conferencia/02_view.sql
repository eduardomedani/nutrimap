select table_name, view_definition is not null as tem_definicao
  from information_schema.views
 where table_schema = 'public'
   and table_name = 'documentos_por_competencia';
