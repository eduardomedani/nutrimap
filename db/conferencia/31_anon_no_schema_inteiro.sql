select count(*) as funcoes_com_execute_para_anon
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  left join lateral aclexplode(p.proacl) a on true
 where n.nspname = 'public'
   and a.grantee = 'anon'::regrole
   and a.privilege_type = 'EXECUTE';
