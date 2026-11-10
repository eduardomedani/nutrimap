-- ===========================================================================
-- Evollo · DESFAZ db/treino_orientacoes.sql
-- ---------------------------------------------------------------------------
-- Remove treinos.orientacoes. Os treinos continuam; perde-se o texto de
-- orientações de cada um, e o cartão "Como fazer este treino" some do app.
-- ===========================================================================

alter table public.treinos drop column if exists orientacoes;

-- Esperado: nenhuma linha.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'treinos' and column_name = 'orientacoes';
