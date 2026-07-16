-- ===========================================================================
-- LIGACAO: conecta o modulo de dieta ao catalogo profissional `foods`.
-- refeicao_itens passa a referenciar foods (food_id). `quantidade` continua
-- sendo multiplicador de 100 g (macros = food.<nutriente> * quantidade),
-- entao NAO ha conversao de valores dos itens existentes.
--
-- Passos:
--   1) refeicao_itens ganha food_id (mantem alimento_id p/ transicao)
--   2) copia alimentos PROPRIOS (nao-TACO) para foods como owned
--   3) repointa os itens existentes: TACO por nome, proprios pelo vinculo
--
-- Idempotente. Aditivo (nao apaga nada). Rodar no SQL Editor apos foods_schema.
-- ===========================================================================

-- 1) coluna food_id + alimento_id passa a ser opcional (itens novos usam food_id)
alter table public.refeicao_itens
  add column if not exists food_id uuid references public.foods(id) on delete restrict;
create index if not exists idx_ritens_food on public.refeicao_itens (food_id);
alter table public.refeicao_itens alter column alimento_id drop not null;

-- 2) alimentos PROPRIOS do nutri -> foods (owned). Guarda o vinculo em
--    foods.atributos_extra->>'origem_alimento_id' (idempotente).
insert into public.foods
  (nutri_id, nome, subcategoria, fonte_dados, calorias, proteina, carboidrato, gordura, descricao, atributos_extra)
select a.nutri_id, a.nome, a.grupo, 'Proprio', a.kcal, a.proteina, a.carboidrato, a.gordura, a.observacoes,
       jsonb_build_object('origem_alimento_id', a.id::text)
from public.alimentos a
where coalesce(a.fonte, '') <> 'TACO'
  and not exists (
    select 1 from public.foods f
    where f.atributos_extra->>'origem_alimento_id' = a.id::text
  );

-- 3) mapeia alimento -> food e repointa os itens ainda sem food_id
with mapa as (
  select a.id as alimento_id, f.id as food_id
    from public.alimentos a
    join public.foods f on f.atributos_extra->>'origem_alimento_id' = a.id::text
   where coalesce(a.fonte, '') <> 'TACO'
  union all
  select a.id as alimento_id, f.id as food_id
    from public.alimentos a
    join public.foods f
      on f.fonte_dados = 'TACO' and f.nutri_id is null and f.nome = a.nome
   where coalesce(a.fonte, '') = 'TACO'
)
update public.refeicao_itens ri
   set food_id = m.food_id
  from mapa m
 where ri.alimento_id = m.alimento_id
   and ri.food_id is null;

-- Checagem: quantos itens ficaram ligados a foods.
select
  (select count(*) from public.refeicao_itens)                          as itens_total,
  (select count(*) from public.refeicao_itens where food_id is not null) as itens_com_food,
  (select count(*) from public.refeicao_itens where food_id is null)     as itens_sem_food;

-- ===========================================================================
-- FIM
-- ===========================================================================
