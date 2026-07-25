-- ===========================================================================
-- NutriMap · Drop set configurável por exercício
-- ---------------------------------------------------------------------------
-- Em quais séries o drop set se aplica (quando metodo = 'Drop-set').
--   drop_ultimas = 0  -> todas as séries (padrão, = comportamento anterior)
--   drop_ultimas = 1  -> somente a última série
--   drop_ultimas = 2  -> duas últimas séries
--   drop_ultimas = 3  -> três últimas séries
-- Guardamos "quantas das ÚLTIMAS" para funcionar com qualquer nº de séries.
--
-- Rodar no SQL Editor do Supabase (projeto jdtpludqkpvhnzkekrgm). Re-executável.
-- ===========================================================================

alter table public.treino_exercicios
  add column if not exists drop_ultimas smallint not null default 0;

-- ===========================================================================
-- FIM
-- ===========================================================================
