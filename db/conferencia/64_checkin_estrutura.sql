-- Check-ins · estrutura. Rodar depois de db/checkin_schema.sql.

-- 64.1 As seis tabelas existem e nascem vazias.
-- Esperado: tabelas = 6, e zero em tudo.
select
  (select count(*) from pg_tables
    where schemaname='public' and tablename like 'checkin\_%')  as tabelas,
  (select count(*) from public.checkin_modelos)                 as modelos,
  (select count(*) from public.checkin_perguntas)               as perguntas,
  (select count(*) from public.checkin_atribuicoes)             as atribuicoes,
  (select count(*) from public.checkin_ocorrencias)             as ocorrencias,
  (select count(*) from public.checkin_respostas)               as respostas;

-- 64.2 Os CHECKs de cada tabela.
select conrelid::regclass as tabela, conname, pg_get_constraintdef(oid) as regra
  from pg_constraint
 where conrelid::regclass::text like 'checkin\_%' and contype = 'c'
 order by tabela, conname;

-- 64.3 As FKs. O que importa:
--   checkin_respostas.pergunta_id -> checkin_perguntas  ON DELETE RESTRICT
--   (pergunta usada em resposta NAO pode ser apagada — a identidade
--    longitudinal depende de ela continuar existindo)
select conrelid::regclass as tabela, conname,
       pg_get_constraintdef(oid) as regra
  from pg_constraint
 where conrelid::regclass::text like 'checkin\_%' and contype = 'f'
 order by tabela, conname;

-- 64.4 Os indices unicos parciais — a idempotencia da materializacao e a
-- atribuicao ativa unica. Esperado: os dois com `WHERE`.
select indexname, indexdef
  from pg_indexes
 where schemaname='public' and tablename like 'checkin\_%' and indexdef like '%UNIQUE%'
 order by indexname;

-- 64.5 Todos os indices, para conferir que nao ha redundancia.
select tablename, indexname, indexdef
  from pg_indexes
 where schemaname='public' and tablename like 'checkin\_%'
 order by tablename, indexname;
