-- ===========================================================================
-- DESFAZ db/food_measures_padrao.sql
-- ---------------------------------------------------------------------------
-- Apaga TODAS as medidas globais (nutri_id NULL). Antes da carga padrão o
-- repositório não tinha nenhuma; se alguém criou outras globais à mão depois,
-- elas vão junto — confira a contagem antes.
--
-- Medidas da clínica (nutri_id preenchido) não são tocadas. Os itens das
-- dietas não perdem nada: `refeicao_itens.medida` é texto e o peso está em
-- `quantidade`; o que estava prescrito em uma medida global volta a aparecer
-- em gramas (js/dieta-calc.js, medidaDoItem).
-- ===========================================================================

select count(*) as medidas_globais_a_apagar from public.food_measures where nutri_id is null;

delete from public.food_measures where nutri_id is null;
