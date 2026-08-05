-- ===========================================================================
-- Evollo · DIETA — leitura do paciente no PWA
-- ---------------------------------------------------------------------------
-- Duas correcoes, e as duas so aparecem quando a tela do paciente existe.
--
-- 1) `ativo` VIRA A PUBLICACAO. Hoje a policy do paciente e so
--    `paciente_id = paciente_do_auth()`: no instante em que o nutri atribui um
--    plano, o paciente ja ve — desativado, pela metade, do jeito que estiver.
--    Nao ha estado de rascunho no schema, e criar coluna nova para isso seria
--    inventar um conceito quando ja existe um que serve: `ativo` passa a
--    significar "visivel para o paciente", que e como o nutri ja o usa.
--
-- 2) O PACIENTE NAO CONSEGUE LER O NOME DOS ALIMENTOS. db/foods_ligacao.sql
--    repontou refeicao_itens para `foods`, mas as policies de paciente cobrem
--    so a tabela LEGADA `alimentos`. Para `foods` vale a regra geral
--    (`nutri_id is null or nutri_id = auth.uid()`), e para o paciente
--    auth.uid() e a conta DELE — entao ele le apenas alimentos globais, e todo
--    alimento proprio do nutri aparece sem nome na tela.
--
-- O ALCANCE E O MINIMO: o paciente le apenas os foods e as medidas que
-- aparecem em alguma refeicao de algum plano DELE. Nao a biblioteca do nutri.
-- E o mesmo padrao que db/dieta_schema.sql ja adotou para `alimentos`.
--
-- Receitas ficam de fora de proposito: refeicao_itens nao tem recipe_id, entao
-- nao ha vinculo a proteger ainda. Entra na etapa que criar o vinculo.
--
-- ADITIVO no comportamento do nutri: nenhuma policy de escrita muda, nenhuma
-- linha e alterada. 100% re-executavel.
-- Desfazer: db/dieta_paciente_leitura_desfazer.sql
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================


-- ===========================================================================
-- 1) O plano so aparece para o paciente quando esta ATIVO
-- ===========================================================================
drop policy if exists planos_paciente_read on public.planos_alimentares;
create policy planos_paciente_read on public.planos_alimentares
  for select to authenticated
  using (paciente_id = public.paciente_do_auth() and ativo);


-- ===========================================================================
-- 2) Refeicoes e itens: so dos planos ATIVOS do proprio paciente
-- ---------------------------------------------------------------------------
-- Repetir o `and ativo` aqui nao e redundancia: sem ele, desativar um plano
-- esconderia o cabecalho e deixaria as refeicoes legiveis pela API.
-- ===========================================================================
drop policy if exists refeicoes_paciente_read on public.plano_refeicoes;
create policy refeicoes_paciente_read on public.plano_refeicoes
  for select to authenticated
  using (plano_id in (
    select id from public.planos_alimentares
     where paciente_id = public.paciente_do_auth() and ativo
  ));

drop policy if exists ritens_paciente_read on public.refeicao_itens;
create policy ritens_paciente_read on public.refeicao_itens
  for select to authenticated
  using (refeicao_id in (
    select r.id
      from public.plano_refeicoes r
      join public.planos_alimentares p on p.id = r.plano_id
     where p.paciente_id = public.paciente_do_auth() and p.ativo
  ));

drop policy if exists alimentos_paciente_read on public.alimentos;
create policy alimentos_paciente_read on public.alimentos
  for select to authenticated
  using (id in (
    select i.alimento_id
      from public.refeicao_itens i
      join public.plano_refeicoes r on r.id = i.refeicao_id
      join public.planos_alimentares p on p.id = r.plano_id
     where p.paciente_id = public.paciente_do_auth() and p.ativo
  ));


-- ===========================================================================
-- 3) foods e food_measures: SO o que esta no plano do paciente
-- ---------------------------------------------------------------------------
-- Policies SAO OR'd: esta soma-se a `foods_select`, que continua valendo para
-- o nutri. Um paciente que tambem seja nutri no mesmo projeto lera pelos dois
-- caminhos — e e por isso que a tela filtra por plano explicitamente em vez de
-- confiar so na RLS. Ver a memoria [[conta-nutri-e-paciente]].
-- ===========================================================================
drop policy if exists foods_paciente_read on public.foods;
create policy foods_paciente_read on public.foods
  for select to authenticated
  using (id in (
    select i.food_id
      from public.refeicao_itens i
      join public.plano_refeicoes r on r.id = i.refeicao_id
      join public.planos_alimentares p on p.id = r.plano_id
     where p.paciente_id = public.paciente_do_auth() and p.ativo
       and i.food_id is not null
  ));

-- A medida caseira ("1 fatia", "2 colheres de sopa") e o que torna a porcao
-- executavel para quem nao tem balanca. Sem esta policy, a tela mostraria
-- gramas e mais nada.
drop policy if exists food_measures_paciente_read on public.food_measures;
create policy food_measures_paciente_read on public.food_measures
  for select to authenticated
  using (food_id in (
    select i.food_id
      from public.refeicao_itens i
      join public.plano_refeicoes r on r.id = i.refeicao_id
      join public.planos_alimentares p on p.id = r.plano_id
     where p.paciente_id = public.paciente_do_auth() and p.ativo
       and i.food_id is not null
  ));


-- ===========================================================================
-- Conferencia. Rodando como NUTRI (SQL Editor), paciente_do_auth() e nulo e
-- as contagens do paciente vem zero — isso e o esperado, e prova que a policy
-- filtra. O que importa aqui e as SEIS policies existirem.
-- ===========================================================================
select
  count(*) filter (where tablename = 'planos_alimentares') as planos,
  count(*) filter (where tablename = 'plano_refeicoes')    as refeicoes,
  count(*) filter (where tablename = 'refeicao_itens')     as itens,
  count(*) filter (where tablename = 'alimentos')          as alimentos,
  count(*) filter (where tablename = 'foods')              as foods,
  count(*) filter (where tablename = 'food_measures')      as medidas
from pg_policies
where schemaname = 'public' and policyname like '%paciente_read';
