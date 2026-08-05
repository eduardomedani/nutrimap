select t.tgname,
       c.relname as tabela,
       case t.tgenabled when 'O' then 'ativo'
                        when 'D' then 'DESABILITADO'
                        else t.tgenabled::text end as estado,
       pg_get_triggerdef(t.oid) as definicao
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname = 'colaborador_documentos'
   and not t.tgisinternal
 order by t.tgname;
