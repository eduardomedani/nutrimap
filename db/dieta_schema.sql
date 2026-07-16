-- ===========================================================================
-- NutriMap · Modulo de Planejamento Alimentar
-- Schema: 4 tabelas (alimentos, planos_alimentares, plano_refeicoes, refeicao_itens)
-- ---------------------------------------------------------------------------
-- Espelha o modulo de treino (db/treino_schema.sql). Padrao:
--   . PK uuid com gen_random_uuid()
--   . nutri_id uuid, default auth.uid()  (single-tenant por nutri)
--   . criado_em timestamptz default now()  (PT-BR, nao "created_at")
--   . RLS ligado; policy _owner por tabela filtra por nutri_id = auth.uid()
--   . politicas de LEITURA do paciente (via public.paciente_do_auth()), como no treino
--
-- Estrutura template vs prescricao (igual treinos):
--   planos_alimentares.paciente_id NULL       = MODELO (biblioteca reutilizavel)
--   planos_alimentares.paciente_id preenchido = PLANO atribuido a um paciente
--
-- Macros ("estruturado"): cada alimento guarda kcal/proteina/carboidrato/gordura
-- por 1 medida_padrao. No item da refeicao, quantidade multiplica esses valores.
--
-- 100% re-executavel. Rodar no SQL Editor do Supabase (projeto jdtpludqkpvhnzkekrgm).
-- Depende de db/paciente_login_schema.sql (usa a funcao public.paciente_do_auth()).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) alimentos -- biblioteca de alimentos do nutri (com macros por porcao)
-- ---------------------------------------------------------------------------
-- Macros referem-se a 1 unidade de medida_padrao (ex.: "100 g", "1 unidade").
create table if not exists public.alimentos (
  id            uuid primary key default gen_random_uuid(),
  nutri_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome          text not null,
  grupo         text,
  medida_padrao text,
  kcal          numeric,
  proteina      numeric,
  carboidrato   numeric,
  gordura       numeric,
  observacoes   text,
  fonte         text,
  criado_em     timestamptz not null default now()
);

alter table public.alimentos add column if not exists nutri_id      uuid;
alter table public.alimentos add column if not exists fonte         text;
alter table public.alimentos add column if not exists nome          text;
alter table public.alimentos add column if not exists grupo         text;
alter table public.alimentos add column if not exists medida_padrao text;
alter table public.alimentos add column if not exists kcal          numeric;
alter table public.alimentos add column if not exists proteina      numeric;
alter table public.alimentos add column if not exists carboidrato   numeric;
alter table public.alimentos add column if not exists gordura       numeric;
alter table public.alimentos add column if not exists observacoes   text;
alter table public.alimentos add column if not exists criado_em     timestamptz not null default now();

create index if not exists idx_alimentos_nutri on public.alimentos (nutri_id);


-- ---------------------------------------------------------------------------
-- 2) planos_alimentares -- MODELO (biblioteca) OU PLANO de um aluno
-- ---------------------------------------------------------------------------
-- paciente_id NULL       = modelo reutilizavel da biblioteca
-- paciente_id preenchido = plano atribuido a um paciente
-- *_meta = metas diarias (calorias e macros) para comparar com o total do plano.
create table if not exists public.planos_alimentares (
  id           uuid primary key default gen_random_uuid(),
  nutri_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  paciente_id  uuid references public.pacientes(id) on delete cascade,
  nome         text not null,
  objetivo     text,
  kcal_meta    numeric,
  prot_meta    numeric,
  carb_meta    numeric,
  gord_meta    numeric,
  data_inicio  date,
  data_fim     date,
  ativo        boolean not null default true,
  observacoes  text,
  criado_em    timestamptz not null default now()
);

alter table public.planos_alimentares add column if not exists nutri_id     uuid;
alter table public.planos_alimentares add column if not exists paciente_id  uuid;
alter table public.planos_alimentares add column if not exists nome         text;
alter table public.planos_alimentares add column if not exists objetivo     text;
alter table public.planos_alimentares add column if not exists kcal_meta    numeric;
alter table public.planos_alimentares add column if not exists prot_meta    numeric;
alter table public.planos_alimentares add column if not exists carb_meta    numeric;
alter table public.planos_alimentares add column if not exists gord_meta    numeric;
alter table public.planos_alimentares add column if not exists data_inicio  date;
alter table public.planos_alimentares add column if not exists data_fim     date;
alter table public.planos_alimentares add column if not exists ativo        boolean not null default true;
alter table public.planos_alimentares add column if not exists observacoes  text;
alter table public.planos_alimentares add column if not exists criado_em    timestamptz not null default now();

create index if not exists idx_planos_nutri    on public.planos_alimentares (nutri_id);
create index if not exists idx_planos_paciente on public.planos_alimentares (paciente_id);


-- ---------------------------------------------------------------------------
-- 3) plano_refeicoes -- refeicoes do plano (Cafe, Almoco, Ceia...)
-- ---------------------------------------------------------------------------
-- Organizadas por ordem; horario opcional. FK cascade: apagar o plano remove.
create table if not exists public.plano_refeicoes (
  id          uuid primary key default gen_random_uuid(),
  nutri_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plano_id    uuid not null references public.planos_alimentares(id) on delete cascade,
  nome        text not null,
  horario     time,
  ordem       smallint not null default 0,
  observacao  text,
  criado_em   timestamptz not null default now()
);

alter table public.plano_refeicoes add column if not exists nutri_id    uuid;
alter table public.plano_refeicoes add column if not exists plano_id    uuid;
alter table public.plano_refeicoes add column if not exists nome        text;
alter table public.plano_refeicoes add column if not exists horario     time;
alter table public.plano_refeicoes add column if not exists ordem       smallint;
alter table public.plano_refeicoes add column if not exists observacao  text;
alter table public.plano_refeicoes add column if not exists criado_em   timestamptz not null default now();

create index if not exists idx_refeicoes_nutri on public.plano_refeicoes (nutri_id);
create index if not exists idx_refeicoes_plano on public.plano_refeicoes (plano_id);


-- ---------------------------------------------------------------------------
-- 4) refeicao_itens -- alimentos de cada refeicao (corpo do plano)
-- ---------------------------------------------------------------------------
-- quantidade: multiplicador da medida_padrao do alimento (ex.: 2 = 2 porcoes).
-- medida: rotulo opcional para exibir (sobrepoe a medida_padrao do alimento).
-- substituicoes: jsonb com alternativas [{nome, quantidade, medida}] (fase futura).
-- FK alimento_id restrict: protege alimento em uso na biblioteca.
create table if not exists public.refeicao_itens (
  id            uuid primary key default gen_random_uuid(),
  nutri_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  refeicao_id   uuid not null references public.plano_refeicoes(id) on delete cascade,
  alimento_id   uuid not null references public.alimentos(id) on delete restrict,
  quantidade    numeric not null default 1,
  medida        text,
  ordem         smallint not null default 0,
  substituicoes jsonb,
  observacao    text,
  criado_em     timestamptz not null default now()
);

alter table public.refeicao_itens add column if not exists nutri_id      uuid;
alter table public.refeicao_itens add column if not exists refeicao_id   uuid;
alter table public.refeicao_itens add column if not exists alimento_id   uuid;
alter table public.refeicao_itens add column if not exists quantidade    numeric not null default 1;
alter table public.refeicao_itens add column if not exists medida        text;
alter table public.refeicao_itens add column if not exists ordem         smallint not null default 0;
alter table public.refeicao_itens add column if not exists substituicoes jsonb;
alter table public.refeicao_itens add column if not exists observacao    text;
alter table public.refeicao_itens add column if not exists criado_em     timestamptz not null default now();

create index if not exists idx_ritens_nutri    on public.refeicao_itens (nutri_id);
create index if not exists idx_ritens_refeicao on public.refeicao_itens (refeicao_id);
create index if not exists idx_ritens_alimento on public.refeicao_itens (alimento_id);


-- ===========================================================================
-- RLS -- single-tenant por nutricionista (nutri_id = auth.uid())
-- Uma policy _owner FOR ALL por tabela (USING no acesso + WITH CHECK no insert).
-- ===========================================================================
alter table public.alimentos          enable row level security;
alter table public.planos_alimentares enable row level security;
alter table public.plano_refeicoes    enable row level security;
alter table public.refeicao_itens     enable row level security;

drop policy if exists alimentos_owner on public.alimentos;
create policy alimentos_owner on public.alimentos
  for all to authenticated
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

drop policy if exists planos_owner on public.planos_alimentares;
create policy planos_owner on public.planos_alimentares
  for all to authenticated
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

drop policy if exists refeicoes_owner on public.plano_refeicoes;
create policy refeicoes_owner on public.plano_refeicoes
  for all to authenticated
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

drop policy if exists ritens_owner on public.refeicao_itens;
create policy ritens_owner on public.refeicao_itens
  for all to authenticated
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());


-- ===========================================================================
-- Politicas de LEITURA do PACIENTE (somadas as do nutri via OR)
-- Usa public.paciente_do_auth(). Garantimos a funcao aqui (idempotente) para
-- o script nao depender do paciente_login_schema.sql ja ter sido rodado.
-- ===========================================================================

-- Vinculo conta<->paciente + helper (iguais ao paciente_login_schema.sql).
alter table public.pacientes
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create or replace function public.paciente_do_auth()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.pacientes where auth_user_id = auth.uid() limit 1;
$$;
grant execute on function public.paciente_do_auth() to authenticated;

-- planos_alimentares: le os proprios planos
drop policy if exists planos_paciente_read on public.planos_alimentares;
create policy planos_paciente_read on public.planos_alimentares
  for select to authenticated
  using (paciente_id = public.paciente_do_auth());

-- plano_refeicoes: le as refeicoes dos proprios planos
drop policy if exists refeicoes_paciente_read on public.plano_refeicoes;
create policy refeicoes_paciente_read on public.plano_refeicoes
  for select to authenticated
  using (plano_id in (
    select id from public.planos_alimentares where paciente_id = public.paciente_do_auth()
  ));

-- refeicao_itens: le os itens das refeicoes dos proprios planos
drop policy if exists ritens_paciente_read on public.refeicao_itens;
create policy ritens_paciente_read on public.refeicao_itens
  for select to authenticated
  using (refeicao_id in (
    select r.id
      from public.plano_refeicoes r
      join public.planos_alimentares p on p.id = r.plano_id
     where p.paciente_id = public.paciente_do_auth()
  ));

-- alimentos: le SOMENTE os alimentos que aparecem nos proprios planos
-- (nao expoe a biblioteca inteira do nutri)
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
-- FIM
-- ===========================================================================
