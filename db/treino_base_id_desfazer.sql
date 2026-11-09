-- ===========================================================================
-- Evollo · DESFAZ db/treino_base_id.sql
-- ---------------------------------------------------------------------------
-- Remove a coluna treinos.base_id. Os treinos continuam; perde-se só a
-- lembrança de qual modelo da Base Evollo cada um veio (Evoluir volta a não
-- usar a base, e "Novo ciclo" passa a escolher sem excluir o modelo atual).
-- ===========================================================================

alter table public.treinos drop column if exists base_id;

-- Esperado: nenhuma linha.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'treinos' and column_name = 'base_id';
