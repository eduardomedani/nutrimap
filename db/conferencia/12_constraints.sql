select c.relname as tabela, con.conname, pg_get_constraintdef(con.oid) as definicao
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('colaborador_documentos', 'documentos_pendentes')
   and con.contype = 'c'
 order by c.relname, con.conname;
