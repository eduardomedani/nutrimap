-- ===========================================================================
-- Evollo · DIETA — DESFAZER a leitura do paciente no PWA
-- ---------------------------------------------------------------------------
-- Volta as policies ao que db/dieta_schema.sql deixou: sem o `and ativo`, e
-- sem leitura de foods/food_measures.
--
-- ATENCAO ao que isto significa: depois de desfazer, o paciente volta a ver
-- QUALQUER plano atribuido a ele, inclusive desativado e pela metade. E os
-- alimentos proprios do nutri voltam a aparecer sem nome na tela do PWA.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

drop policy if exists foods_paciente_read on public.foods;
drop policy if exists food_measures_paciente_read on public.food_measures;

drop policy if exists planos_paciente_read on public.planos_alimentares;
create policy planos_paciente_read on public.planos_alimentares
  for select to authenticated
  using (paciente_id = public.paciente_do_auth());

drop policy if exists refeicoes_paciente_read on public.plano_refeicoes;
create policy refeicoes_paciente_read on public.plano_refeicoes
  for select to authenticated
  using (plano_id in (
    select id from public.planos_alimentares where paciente_id = public.paciente_do_auth()
  ));

drop policy if exists ritens_paciente_read on public.refeicao_itens;
create policy ritens_paciente_read on public.refeicao_itens
  for select to authenticated
  using (refeicao_id in (
    select r.id
      from public.plano_refeicoes r
      join public.planos_alimentares p on p.id = r.plano_id
     where p.paciente_id = public.paciente_do_auth()
  ));

drop policy if exists alimentos_paciente_read on public.alimentos;
create policy alimentos_paciente_read on public.alimentos
  for select to authenticated
  using (id in (
    select i.alimento_id
      from public.refeicao_itens i
      join public.plano_refeicoes r on r.id = i.refeicao_id
      join public.planos_alimentares p on p.id = r.plano_id
     where p.paciente_id = public.paciente_do_auth()
  ));


-- ===========================================================================
-- Conferencia. Esperado: 4 policies de paciente (as originais), 0 em foods.
-- ===========================================================================
select
  count(*)                                            as policies_paciente,
  count(*) filter (where tablename = 'foods')         as foods,
  count(*) filter (where tablename = 'food_measures') as medidas
from pg_policies
where schemaname = 'public' and policyname like '%paciente_read';
