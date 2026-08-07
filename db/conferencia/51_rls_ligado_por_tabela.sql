select
  c.relname                                            as tabela,
  case when c.relrowsecurity then 'LIGADO' else 'DESLIGADO' end as rls,
  case when c.relforcerowsecurity then 'sim' else 'nao' end     as forcado,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname)  as policies,
  case
    when not c.relrowsecurity then 'EXPOSTA — qualquer conta autenticada le tudo'
    when (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = c.relname) = 0
      then 'TRANCADA — RLS ligado e nenhuma policy: ninguem le'
    else 'ok'
  end                                                  as situacao
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by
  case
    when not c.relrowsecurity then 0
    when (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = c.relname) = 0 then 1
    else 2
  end,
  c.relname;
