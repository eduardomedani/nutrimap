-- Documentos do paciente · a tabela existe e os tres conceitos estao separados.
-- Esperado: 1 linha, com visivel_paciente/status/visualizado_pelo_paciente
-- todos presentes e visivel_paciente com default false.
select
  (select count(*) from pg_tables
    where schemaname = 'public' and tablename = 'paciente_documentos')            as tabela,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'paciente_documentos')         as colunas,
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'paciente_documentos'
      and column_name = 'visivel_paciente')                                       as default_visivel,
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'paciente_documentos'
      and column_name = 'nutri_id')                                               as nutri_id_nulo,
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'paciente_documentos'
      and column_name = 'paciente_id')                                            as paciente_id_nulo;

-- Os CHECKs: tipo, origem, status, versao e as duas travas de coerencia.
select conname, pg_get_constraintdef(oid) as regra
  from pg_constraint
 where conrelid = 'public.paciente_documentos'::regclass
   and contype = 'c'
 order by conname;
