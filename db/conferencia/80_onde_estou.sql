-- ===========================================================================
-- ONDE ESTOU — o chao firme antes de qualquer conclusao
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. Quatro linhas de leitura.
--
-- O script 73 falhou com "relation public.nutricionistas does not exist", e
-- isso contradiz tudo o que foi medido hoje: o 76 leu a tabela, o 77 mostrou
-- 93 pacientes, e pacientes.nutri_id tem FK para ela com ON DELETE CASCADE —
-- se ela tivesse sumido, os pacientes teriam ido junto.
--
-- Duas explicacoes possiveis, e elas levam a lugares muito diferentes:
--   a) a aba do SQL Editor esta apontando para OUTRO projeto Supabase
--   b) algo removeu a tabela neste projeto
--
-- Este script distingue as duas antes de agir. `to_regclass` devolve o nome se
-- o objeto existe e NULL se nao existe, sem estourar erro — que e justamente o
-- que se precisa quando a pergunta e "existe?".
--
-- Para colar no SQL Editor, use db/conferencia/80_onde_estou_LIMPO.sql
-- ===========================================================================

select
  current_database()                                as banco,
  current_user                                      as papel,
  (select count(*) from information_schema.tables
    where table_schema = 'public')                  as tabelas_em_public,
  to_regclass('public.nutricionistas')::text        as nutricionistas,
  to_regclass('public.pacientes')::text             as pacientes,
  to_regclass('public.organizacoes')::text          as organizacoes,
  to_regclass('public.organizacao_usuarios')::text  as organizacao_usuarios,
  to_regclass('public.checkin_ocorrencias')::text   as checkin_ocorrencias,
  (select count(*) from auth.users)                 as contas_auth;
