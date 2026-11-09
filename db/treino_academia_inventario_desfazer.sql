-- ===========================================================================
-- Evollo · DESFAZ db/treino_academia_inventario.sql
-- ---------------------------------------------------------------------------
-- Remove a tabela inteira — policies e inventário de TODAS as contas vão junto.
-- O gerador de treinos volta a escolher sem restrição de equipamento (o front
-- trata a ausência da tabela como "sem inventário").
-- ===========================================================================

drop table if exists public.academia_inventario;

-- Esperado: uma linha com tabela = NULL.
select to_regclass('public.academia_inventario') as tabela;
