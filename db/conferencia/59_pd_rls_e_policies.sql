-- Documentos do paciente · RLS ligada e as cinco policies no lugar.
-- Esperado: rls_ativa = true nas duas tabelas.
select relname as tabela, relrowsecurity as rls_ativa, relforcerowsecurity as rls_forcada
  from pg_class
 where oid in ('public.paciente_documentos'::regclass,
               'public.paciente_documento_auditoria'::regclass);

-- Esperado: 4 policies de nutri (select/insert/update/delete) + 1 do paciente.
-- A do paciente TEM que trazer visivel_paciente e arquivado_em na condicao —
-- sem isso, documento privado apareceria no PWA.
select policyname, cmd, qual as usando, with_check as checando
  from pg_policies
 where schemaname = 'public' and tablename = 'paciente_documentos'
 order by policyname;

-- A auditoria: leitura do nutri e NENHUMA policy de insert (quem escreve e o
-- gatilho, como definer). Esperado: 1 linha, cmd = SELECT.
select policyname, cmd
  from pg_policies
 where schemaname = 'public' and tablename = 'paciente_documento_auditoria';
