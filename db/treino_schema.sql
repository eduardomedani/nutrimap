-- ===========================================================================
-- NutriMap · Modulo de Prescricao de Treino
-- Schema: 4 tabelas (exercicios, treinos, treino_exercicios, treino_progressao)
-- ---------------------------------------------------------------------------
-- Padrao seguido (igual a pacientes / avaliacoes):
--   . PK uuid com gen_random_uuid()
--   . nutri_id uuid, default auth.uid()  (single-tenant por nutri)
--   . criado_em timestamptz default now()   (o banco usa PT-BR, nao "created_at")
--   . RLS ligado; politicas filtram por nutri_id = auth.uid()
--   . nutri_id gravado direto em TODAS as tabelas (mesmo padrao de avaliacoes)
--
-- 100% re-executavel: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
-- DROP POLICY IF EXISTS antes de CREATE POLICY.
-- Rodar no SQL Editor do Supabase (projeto jdtpludqkpvhnzkekrgm).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) exercicios -- biblioteca de exercicios do nutri
-- ---------------------------------------------------------------------------
-- video_url: reservado para futuro (demonstracao em video)
create table if not exists public.exercicios (
  id              uuid primary key default gen_random_uuid(),
  nutri_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome            text not null,
  grupo_muscular  text,
  equipamento     text,
  video_url       text,
  observacoes     text,
  criado_em       timestamptz not null default now()
);

alter table public.exercicios add column if not exists nutri_id       uuid;
alter table public.exercicios add column if not exists nome           text;
alter table public.exercicios add column if not exists grupo_muscular text;
alter table public.exercicios add column if not exists equipamento    text;
alter table public.exercicios add column if not exists video_url      text;
alter table public.exercicios add column if not exists observacoes    text;
alter table public.exercicios add column if not exists criado_em      timestamptz not null default now();

create index if not exists idx_exercicios_nutri on public.exercicios (nutri_id);


-- ---------------------------------------------------------------------------
-- 2) treinos -- MODELO (biblioteca) OU PRESCRICAO (treino de um aluno)
-- ---------------------------------------------------------------------------
-- paciente_id NULL       = modelo reutilizavel da biblioteca
-- paciente_id preenchido = treino atribuido a um paciente
create table if not exists public.treinos (
  id            uuid primary key default gen_random_uuid(),
  nutri_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  paciente_id   uuid references public.pacientes(id) on delete cascade,
  nome          text not null,
  divisao       text,
  data_inicio   date,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

alter table public.treinos add column if not exists nutri_id     uuid;
alter table public.treinos add column if not exists paciente_id  uuid;
alter table public.treinos add column if not exists nome         text;
alter table public.treinos add column if not exists divisao      text;
alter table public.treinos add column if not exists data_inicio  date;
alter table public.treinos add column if not exists ativo        boolean not null default true;
alter table public.treinos add column if not exists criado_em    timestamptz not null default now();

create index if not exists idx_treinos_nutri    on public.treinos (nutri_id);
create index if not exists idx_treinos_paciente on public.treinos (paciente_id);


-- ---------------------------------------------------------------------------
-- 3) treino_exercicios -- liga treino e exercicio (corpo da prescricao)
-- ---------------------------------------------------------------------------
-- Organizado por dia (A/B/C...) e ordem. Tipos flexiveis na prescricao:
--   series      smallint  = normalmente numero (3, 4)
--   repeticoes  text      = aceita faixas/textos ("8-12", "ate a falha")
--   carga       text      = aceita "20kg", "peso corporal", "elastico medio"
--   descanso    text      = "60s", "90s", "2min"
-- FK treino_id cascade: apagar o treino remove os itens.
-- FK exercicio_id restrict: protege exercicio em uso.
create table if not exists public.treino_exercicios (
  id           uuid primary key default gen_random_uuid(),
  nutri_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  treino_id    uuid not null references public.treinos(id) on delete cascade,
  exercicio_id uuid not null references public.exercicios(id) on delete restrict,
  dia          text not null default 'A' check (dia in ('A','B','C','D','E','F','G')),
  ordem        smallint not null default 0,
  series       smallint,
  repeticoes   text,
  carga        text,
  cadencia     text,
  descanso     text,
  rir          text,
  metodo       text,
  observacao   text,
  criado_em    timestamptz not null default now()
);

alter table public.treino_exercicios add column if not exists nutri_id     uuid;
alter table public.treino_exercicios add column if not exists treino_id    uuid;
alter table public.treino_exercicios add column if not exists exercicio_id uuid;
alter table public.treino_exercicios add column if not exists dia          text;
alter table public.treino_exercicios add column if not exists ordem        smallint;
alter table public.treino_exercicios add column if not exists series       smallint;
alter table public.treino_exercicios add column if not exists repeticoes   text;
alter table public.treino_exercicios add column if not exists carga        text;
alter table public.treino_exercicios add column if not exists cadencia     text;
alter table public.treino_exercicios add column if not exists descanso     text;
alter table public.treino_exercicios add column if not exists rir          text;
alter table public.treino_exercicios add column if not exists metodo       text;
alter table public.treino_exercicios add column if not exists observacao   text;
alter table public.treino_exercicios add column if not exists criado_em    timestamptz not null default now();

-- Amplia o CHECK do dia de A-F para A-G (suporta treinos de ate 7 dias).
-- Drop + add torna re-executavel.
alter table public.treino_exercicios drop constraint if exists treino_exercicios_dia_check;
alter table public.treino_exercicios add constraint treino_exercicios_dia_check check (dia in ('A','B','C','D','E','F','G'));

create index if not exists idx_te_nutri     on public.treino_exercicios (nutri_id);
create index if not exists idx_te_treino    on public.treino_exercicios (treino_id);
create index if not exists idx_te_exercicio on public.treino_exercicios (exercicio_id);


-- ---------------------------------------------------------------------------
-- 4) treino_progressao -- historico de cargas realizadas (evolucao do aluno)
-- ---------------------------------------------------------------------------
-- carga_realizada/reps_realizadas em numeric para permitir graficos de evolucao.
create table if not exists public.treino_progressao (
  id                  uuid primary key default gen_random_uuid(),
  nutri_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  treino_exercicio_id uuid not null references public.treino_exercicios(id) on delete cascade,
  data                date not null default current_date,
  carga_realizada     numeric,
  reps_realizadas     smallint,
  observacao          text,
  criado_em           timestamptz not null default now()
);

alter table public.treino_progressao add column if not exists nutri_id            uuid;
alter table public.treino_progressao add column if not exists treino_exercicio_id uuid;
alter table public.treino_progressao add column if not exists data                date;
alter table public.treino_progressao add column if not exists carga_realizada     numeric;
alter table public.treino_progressao add column if not exists reps_realizadas     smallint;
alter table public.treino_progressao add column if not exists observacao          text;
alter table public.treino_progressao add column if not exists criado_em           timestamptz not null default now();

create index if not exists idx_tp_nutri on public.treino_progressao (nutri_id);
create index if not exists idx_tp_te    on public.treino_progressao (treino_exercicio_id);


-- ===========================================================================
-- RLS -- single-tenant por nutricionista (nutri_id = auth.uid())
-- Uma policy FOR ALL por tabela (USING no acesso + WITH CHECK no insert/update).
-- ===========================================================================
alter table public.exercicios         enable row level security;
alter table public.treinos            enable row level security;
alter table public.treino_exercicios  enable row level security;
alter table public.treino_progressao  enable row level security;

drop policy if exists exercicios_owner on public.exercicios;
create policy exercicios_owner on public.exercicios
  for all to authenticated
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

drop policy if exists treinos_owner on public.treinos;
create policy treinos_owner on public.treinos
  for all to authenticated
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

drop policy if exists treino_exercicios_owner on public.treino_exercicios;
create policy treino_exercicios_owner on public.treino_exercicios
  for all to authenticated
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

drop policy if exists treino_progressao_owner on public.treino_progressao;
create policy treino_progressao_owner on public.treino_progressao
  for all to authenticated
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

-- ===========================================================================
-- FIM
-- ===========================================================================
