select c.relname as tabela,
       c.relrowsecurity as rls_ativa,
       c.relforcerowsecurity as rls_forcada,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('colaborador_documentos', 'documentos_pendentes', 'documento_auditoria',
                     'funcionarios', 'folhas', 'folha_itens', 'folha_adicionais')
 order by c.relname;
