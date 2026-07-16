-- ===========================================================================
-- NutriMap - Banco de Alimentos Profissional (foods)
-- ---------------------------------------------------------------------------
-- Estrutura escalavel (100k+ alimentos) preparada para importar TACO, TBCA,
-- USDA e Open Food Facts sem alterar o schema.
--
-- Convencoes (iguais ao resto do projeto):
--   . PK uuid default gen_random_uuid()
--   . nutri_id uuid -> auth.users(id). NULL = catalogo GLOBAL (compartilhado,
--     importado); preenchido = alimento PROPRIO do nutri. RLS: todos leem o
--     global + os proprios; so editam os proprios.
--   . criado_em timestamptz default now() (PT-BR)
--   . comentarios em linha propria e ASCII puro (nao quebram no SQL Editor)
--
-- Busca: nome_normalizado (sem acento/minusculo) + indices GIN trigram.
-- Nutrientes: colunas fixas por 100 g + nutrientes_extra jsonb (fontes novas).
--
-- 100% re-executavel. Rodar no SQL Editor do Supabase (projeto jdtplud...).
-- Aditivo: NAO altera a tabela `alimentos` nem o modulo de dieta atual.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0) Extensoes + normalizacao de texto (para busca sem acento/maiusculo)
-- ---------------------------------------------------------------------------
-- No Supabase as extensoes ficam no schema `extensions` (nao em public).
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- unaccent 1-arg via search_path e marcado IMMUTABLE (permite usar em coluna
-- gerada e em indice funcional). gen_random_uuid() e core (PG13+), sem extensao.
create or replace function public.f_unaccent(text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select extensions.unaccent('extensions.unaccent', $1);
$$;

-- Normaliza: sem acento, minusculo, espacos colapsados. Base da busca.
create or replace function public.normalizar_texto(text)
returns text
language sql
immutable
parallel safe
as $$
  select trim(regexp_replace(lower(public.f_unaccent(coalesce($1, ''))), '\s+', ' ', 'g'));
$$;

-- Atualiza atualizado_em automaticamente.
create or replace function public.set_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 1) food_categories -- categorias globais (referencia)
-- ---------------------------------------------------------------------------
create table if not exists public.food_categories (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  ordem      smallint not null default 0,
  criado_em  timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 2) foods -- alimento (identidade + nutrientes por 100 g + caracteristicas)
-- ---------------------------------------------------------------------------
create table if not exists public.foods (
  id                uuid primary key default gen_random_uuid(),
  -- NULL = catalogo global; preenchido = alimento proprio do nutri
  nutri_id          uuid references auth.users(id) on delete cascade,
  nome              text not null,
  -- coluna gerada para busca (sem acento/minusculo)
  nome_normalizado  text generated always as (public.normalizar_texto(nome)) stored,
  marca             text,
  categoria_id      uuid references public.food_categories(id) on delete set null,
  subcategoria      text,
  fonte_dados       text not null default 'Proprio',
  codigo_barras     text,
  descricao         text,
  imagem            text,

  -- nutrientes por 100 g
  calorias          numeric,
  proteina          numeric,
  carboidrato       numeric,
  gordura           numeric,
  fibra             numeric,
  acucar            numeric,
  sodio             numeric,
  potassio          numeric,
  calcio            numeric,
  ferro             numeric,
  magnesio          numeric,
  fosforo           numeric,
  zinco             numeric,
  colesterol        numeric,
  gordura_saturada  numeric,
  gordura_mono      numeric,
  gordura_poli      numeric,
  gordura_trans     numeric,
  omega3            numeric,
  omega6            numeric,
  vitamina_a        numeric,
  vitamina_c        numeric,
  vitamina_d        numeric,
  vitamina_e        numeric,
  vitamina_k        numeric,
  vitamina_b1       numeric,
  vitamina_b2       numeric,
  vitamina_b3       numeric,
  vitamina_b6       numeric,
  vitamina_b12      numeric,
  folato            numeric,
  -- nutrientes fora do conjunto fixo (USDA/OFF) sem alterar o schema
  nutrientes_extra  jsonb,

  -- caracteristicas (filtros rapidos)
  sem_gluten        boolean,
  sem_lactose       boolean,
  vegano            boolean,
  vegetariano       boolean,
  kosher            boolean,
  halal             boolean,
  low_carb          boolean,
  cetogenico        boolean,
  rico_proteina     boolean,
  rico_fibras       boolean,
  integral          boolean,
  organico          boolean,
  atributos_extra   jsonb,

  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),

  constraint foods_fonte_dados_check
    check (fonte_dados in ('TACO','TBCA','USDA','OpenFoodFacts','Proprio'))
);

-- Indices de busca e filtro (rapidos em 100k+ linhas)
create index if not exists idx_foods_nome_trgm    on public.foods using gin (nome_normalizado public.gin_trgm_ops);
create index if not exists idx_foods_marca_trgm    on public.foods using gin (public.normalizar_texto(marca) public.gin_trgm_ops);
create index if not exists idx_foods_codigo_barras on public.foods (codigo_barras);
create index if not exists idx_foods_categoria     on public.foods (categoria_id);
create index if not exists idx_foods_nutri         on public.foods (nutri_id);
create index if not exists idx_foods_fonte         on public.foods (fonte_dados);

drop trigger if exists trg_foods_atualizado on public.foods;
create trigger trg_foods_atualizado
  before update on public.foods
  for each row execute function public.set_atualizado_em();


-- ---------------------------------------------------------------------------
-- 3) food_measures -- medidas caseiras por alimento
-- ---------------------------------------------------------------------------
create table if not exists public.food_measures (
  id         uuid primary key default gen_random_uuid(),
  nutri_id   uuid references auth.users(id) on delete cascade,
  food_id    uuid not null references public.foods(id) on delete cascade,
  descricao  text not null,
  gramas     numeric not null,
  ordem      smallint not null default 0,
  criado_em  timestamptz not null default now()
);
create index if not exists idx_food_measures_food on public.food_measures (food_id);


-- ---------------------------------------------------------------------------
-- 4) food_aliases -- sinonimos (aipim = mandioca = macaxeira)
-- ---------------------------------------------------------------------------
create table if not exists public.food_aliases (
  id                uuid primary key default gen_random_uuid(),
  nutri_id          uuid references auth.users(id) on delete cascade,
  food_id           uuid not null references public.foods(id) on delete cascade,
  nome              text not null,
  nome_normalizado  text generated always as (public.normalizar_texto(nome)) stored,
  criado_em         timestamptz not null default now()
);
create index if not exists idx_food_aliases_food      on public.food_aliases (food_id);
create index if not exists idx_food_aliases_norm_trgm on public.food_aliases using gin (nome_normalizado public.gin_trgm_ops);


-- ---------------------------------------------------------------------------
-- 5) food_substitutions -- substituicoes (100 g arroz ~ 120 g batata)
-- ---------------------------------------------------------------------------
-- equivalence_factor: gramas do substituto equivalentes a 1 g do original
-- (ex.: arroz -> batata = 1.2). Guardado no sentido food -> substitute.
create table if not exists public.food_substitutions (
  id                  uuid primary key default gen_random_uuid(),
  nutri_id            uuid references auth.users(id) on delete cascade,
  food_id             uuid not null references public.foods(id) on delete cascade,
  substitute_food_id  uuid not null references public.foods(id) on delete cascade,
  equivalence_factor  numeric not null default 1,
  criado_em           timestamptz not null default now(),
  constraint food_subs_diferentes check (food_id <> substitute_food_id),
  constraint food_subs_unicos unique (food_id, substitute_food_id)
);
create index if not exists idx_food_subs_food on public.food_substitutions (food_id);


-- ---------------------------------------------------------------------------
-- 6) recipes / recipe_items -- receitas (compostas por varios alimentos)
-- ---------------------------------------------------------------------------
create table if not exists public.recipes (
  id           uuid primary key default gen_random_uuid(),
  nutri_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome         text not null,
  descricao    text,
  porcoes      numeric not null default 1,
  modo_preparo text,
  criado_em    timestamptz not null default now()
);
create index if not exists idx_recipes_nutri on public.recipes (nutri_id);

create table if not exists public.recipe_items (
  id            uuid primary key default gen_random_uuid(),
  nutri_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recipe_id     uuid not null references public.recipes(id) on delete cascade,
  food_id       uuid not null references public.foods(id) on delete restrict,
  quantidade_g  numeric not null,
  ordem         smallint not null default 0,
  criado_em     timestamptz not null default now()
);
create index if not exists idx_recipe_items_recipe on public.recipe_items (recipe_id);
create index if not exists idx_recipe_items_food   on public.recipe_items (food_id);

-- Macros calculados automaticamente (soma food x quantidade/100). Total e por porcao.
-- security_invoker: respeita o RLS de quem consulta.
create or replace view public.recipe_macros
with (security_invoker = true) as
select
  r.id                                                   as recipe_id,
  r.nutri_id,
  r.porcoes,
  coalesce(sum(f.calorias    * i.quantidade_g / 100.0), 0) as calorias,
  coalesce(sum(f.proteina    * i.quantidade_g / 100.0), 0) as proteina,
  coalesce(sum(f.carboidrato * i.quantidade_g / 100.0), 0) as carboidrato,
  coalesce(sum(f.gordura     * i.quantidade_g / 100.0), 0) as gordura,
  coalesce(sum(f.fibra       * i.quantidade_g / 100.0), 0) as fibra,
  coalesce(sum(i.quantidade_g), 0)                        as peso_total_g,
  coalesce(sum(f.calorias    * i.quantidade_g / 100.0), 0) / nullif(r.porcoes, 0) as calorias_por_porcao,
  coalesce(sum(f.proteina    * i.quantidade_g / 100.0), 0) / nullif(r.porcoes, 0) as proteina_por_porcao,
  coalesce(sum(f.carboidrato * i.quantidade_g / 100.0), 0) / nullif(r.porcoes, 0) as carboidrato_por_porcao,
  coalesce(sum(f.gordura     * i.quantidade_g / 100.0), 0) / nullif(r.porcoes, 0) as gordura_por_porcao
from public.recipes r
left join public.recipe_items i on i.recipe_id = r.id
left join public.foods f        on f.id = i.food_id
group by r.id, r.nutri_id, r.porcoes;


-- ---------------------------------------------------------------------------
-- 7) favorite_foods / recent_foods -- por nutricionista (user_id = nutri_id)
-- ---------------------------------------------------------------------------
create table if not exists public.favorite_foods (
  id         uuid primary key default gen_random_uuid(),
  nutri_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  food_id    uuid not null references public.foods(id) on delete cascade,
  criado_em  timestamptz not null default now(),
  constraint favorite_foods_unicos unique (nutri_id, food_id)
);
create index if not exists idx_favorite_foods_nutri on public.favorite_foods (nutri_id);

create table if not exists public.recent_foods (
  id            uuid primary key default gen_random_uuid(),
  nutri_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  food_id       uuid not null references public.foods(id) on delete cascade,
  last_used_at  timestamptz not null default now(),
  quantity      numeric,
  constraint recent_foods_unicos unique (nutri_id, food_id)
);
create index if not exists idx_recent_foods_recentes on public.recent_foods (nutri_id, last_used_at desc);


-- ===========================================================================
-- RLS
-- foods e filhos (measures/aliases/subs): le GLOBAL (nutri_id null) + PROPRIO;
-- escreve so o proprio. recipes/favoritos/recentes: so do dono.
-- categorias: leitura para todos os autenticados.
-- ===========================================================================
alter table public.food_categories    enable row level security;
alter table public.foods               enable row level security;
alter table public.food_measures       enable row level security;
alter table public.food_aliases        enable row level security;
alter table public.food_substitutions  enable row level security;
alter table public.recipes             enable row level security;
alter table public.recipe_items        enable row level security;
alter table public.favorite_foods      enable row level security;
alter table public.recent_foods        enable row level security;

-- categorias: somente leitura (seed roda como service, ignorando RLS)
drop policy if exists food_categories_read on public.food_categories;
create policy food_categories_read on public.food_categories
  for select to authenticated
  using (true);

-- foods: SELECT global+proprio, e um FOR ALL para escrever so o proprio
drop policy if exists foods_select on public.foods;
create policy foods_select on public.foods
  for select to authenticated
  using (nutri_id is null or nutri_id = auth.uid());

drop policy if exists foods_modify on public.foods;
create policy foods_modify on public.foods
  for all to authenticated
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

-- food_measures
drop policy if exists food_measures_select on public.food_measures;
create policy food_measures_select on public.food_measures
  for select to authenticated
  using (nutri_id is null or nutri_id = auth.uid());
drop policy if exists food_measures_modify on public.food_measures;
create policy food_measures_modify on public.food_measures
  for all to authenticated
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

-- food_aliases
drop policy if exists food_aliases_select on public.food_aliases;
create policy food_aliases_select on public.food_aliases
  for select to authenticated
  using (nutri_id is null or nutri_id = auth.uid());
drop policy if exists food_aliases_modify on public.food_aliases;
create policy food_aliases_modify on public.food_aliases
  for all to authenticated
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

-- food_substitutions
drop policy if exists food_subs_select on public.food_substitutions;
create policy food_subs_select on public.food_substitutions
  for select to authenticated
  using (nutri_id is null or nutri_id = auth.uid());
drop policy if exists food_subs_modify on public.food_substitutions;
create policy food_subs_modify on public.food_substitutions
  for all to authenticated
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

-- recipes / recipe_items / favorite_foods / recent_foods: so o dono
drop policy if exists recipes_owner on public.recipes;
create policy recipes_owner on public.recipes
  for all to authenticated using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

drop policy if exists recipe_items_owner on public.recipe_items;
create policy recipe_items_owner on public.recipe_items
  for all to authenticated using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

drop policy if exists favorite_foods_owner on public.favorite_foods;
create policy favorite_foods_owner on public.favorite_foods
  for all to authenticated using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

drop policy if exists recent_foods_owner on public.recent_foods;
create policy recent_foods_owner on public.recent_foods
  for all to authenticated using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());


-- ===========================================================================
-- BUSCA -- rapida, ignora acento/maiusculo, cobre nome/sinonimo/marca/barras
-- security invoker: respeita o RLS (retorna global + proprios do nutri).
-- ===========================================================================
create or replace function public.foods_buscar(p_termo text, p_limit int default 20)
returns setof public.foods
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with q as (select public.normalizar_texto(p_termo) as t)
  select f.*
  from public.foods f, q
  where q.t <> '' and (
        f.nome_normalizado ilike '%' || q.t || '%'
     or public.normalizar_texto(f.marca) ilike '%' || q.t || '%'
     or f.codigo_barras = p_termo
     or exists (
          select 1 from public.food_aliases a
          where a.food_id = f.id and a.nome_normalizado ilike '%' || q.t || '%'
        )
  )
  order by similarity(f.nome_normalizado, q.t) desc, f.nome asc
  limit greatest(p_limit, 1);
$$;
grant execute on function public.foods_buscar(text, int) to authenticated;


-- ===========================================================================
-- SEED -- categorias (idempotente)
-- ===========================================================================
insert into public.food_categories (nome, ordem) values
  ('Frutas', 1), ('Verduras', 2), ('Legumes', 3), ('Carnes', 4), ('Peixes', 5),
  ('Aves', 6), ('Laticinios', 7), ('Cereais', 8), ('Tuberculos', 9),
  ('Oleaginosas', 10), ('Bebidas', 11), ('Industrializados', 12), ('Fast Food', 13),
  ('Doces', 14), ('Suplementos', 15), ('Temperos', 16), ('Receitas', 17)
on conflict (nome) do nothing;

-- Checagem final: se tudo rodou, retorna 17.
select count(*) as categorias_criadas from public.food_categories;

-- ===========================================================================
-- FIM
-- ===========================================================================
