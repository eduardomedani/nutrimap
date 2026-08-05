select d.defaclrole::regrole::text as dono,
       n.nspname as schema,
       d.defaclobjtype as tipo_objeto,
       array_to_string(d.defaclacl, ' | ') as privilegios_padrao
  from pg_default_acl d
  left join pg_namespace n on n.oid = d.defaclnamespace
 where d.defaclobjtype = 'f'
 order by dono, schema;
