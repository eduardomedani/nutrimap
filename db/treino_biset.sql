-- ===========================================================================
-- NutriMap · Bi-set (exercicios agrupados) na prescricao
-- ---------------------------------------------------------------------------
-- Um Bi-set = 2 linhas em treino_exercicios que compartilham o mesmo grupo_id.
--   grupo_id  uuid  -> id do exercicio ANCORA (A). A e B apontam para ele.
--                      NULL = exercicio normal (single).
--   grupo_pos text  -> 'A' (ancora) ou 'B' (parceiro). NULL = single.
--   grupo_obs text  -> observacao GERAL do conjunto (fica na linha A).
--
-- O exercicio B guarda series/reps/carga/cadencia/observacao proprios; o
-- descanso do conjunto fica na linha A (o B nao tem descanso individual).
-- Preparado para tri-set/circuito no futuro (grupo_pos 'C', 'D'...).
--
-- Compat: registros antigos tem grupo_id/grupo_pos NULL e seguem como singles.
-- Rodar no SQL Editor do Supabase (projeto jdtpludqkpvhnzkekrgm). Re-executavel.
-- ===========================================================================

alter table public.treino_exercicios
  add column if not exists grupo_id  uuid,
  add column if not exists grupo_pos text,
  add column if not exists grupo_obs text;

-- Posicao valida dentro do grupo (livre p/ singles = NULL).
alter table public.treino_exercicios drop constraint if exists treino_exercicios_grupo_pos_check;
alter table public.treino_exercicios
  add constraint treino_exercicios_grupo_pos_check
  check (grupo_pos is null or grupo_pos in ('A','B','C','D','E'));

create index if not exists idx_te_grupo on public.treino_exercicios (grupo_id);

-- ===========================================================================
-- FIM
-- ===========================================================================
