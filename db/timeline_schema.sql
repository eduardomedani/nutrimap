-- ===========================================================================
-- NutriMap · Timeline do Paciente
-- Tabela: paciente_eventos (linha do tempo do acompanhamento)
-- ---------------------------------------------------------------------------
-- Padrao seguido (igual a treinos / planos_alimentares / avaliacoes):
--   . PK uuid com gen_random_uuid()
--   . nutri_id uuid, default auth.uid()  (single-tenant por nutri)
--   . criado_em timestamptz default now()  (o banco usa PT-BR, nao "created_at")
--   . RLS ligado; politicas filtram por nutri_id = auth.uid()
--
-- Por que nao existe organization_id: o sistema e single-tenant POR NUTRI.
-- Nao ha tabela de organizacoes e todo o isolamento do projeto e feito por
-- nutri_id = auth.uid(). Uma coluna de organizacao aqui ficaria sempre nula.
--
-- Nomes: colunas em PT-BR (padrao do projeto), mas os VALORES de `tipo` sao as
-- constantes em ingles do catalogo (MEAL_PLAN_PUBLISHED, WORKOUT_CREATED...),
-- que sao o contrato compartilhado com js/timeline-config.js.
--
-- 100% re-executavel: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
-- DROP POLICY IF EXISTS antes de CREATE POLICY.
--
-- ORDEM: rodar este arquivo PRIMEIRO e, depois, db/timeline_backfill.sql.
-- Os dois estao separados de proposito: no SQL Editor do Supabase o lote
-- inteiro e analisado junto, entao um INSERT na tabela criada no MESMO lote
-- falha com "relation does not exist". Estrutura e carga inicial em execucoes
-- separadas resolvem isso -- e o backfill fica re-executavel sozinho.
-- Rodar no SQL Editor do Supabase (projeto jdtpludqkpvhnzkekrgm).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) paciente_eventos
-- ---------------------------------------------------------------------------
-- data_evento  = quando o fato aconteceu (ordena a timeline)
-- criado_em    = quando a linha foi gravada (auditoria)
-- chave_dedup  = idempotencia. Duas formas de uso:
--                  . backfill: "TIPO:<uuid da entidade>"
--                  . eventos do dia: "TIPO:<uuid>:<AAAA-MM-DD>", que agrupa
--                    varios salvamentos do mesmo item no mesmo dia em 1 evento
--                UNIQUE simples: NULLs nao conflitam entre si (padrao SQL),
--                entao eventos sem chave sempre entram.
create table if not exists public.paciente_eventos (
  id                   uuid primary key default gen_random_uuid(),
  nutri_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  paciente_id          uuid not null references public.pacientes(id) on delete cascade,
  tipo                 text not null,
  modulo               text not null default 'paciente',
  titulo               text not null,
  descricao            text,
  data_evento          timestamptz not null default now(),
  criado_em            timestamptz not null default now(),
  criado_por           uuid default auth.uid(),
  entidade_tipo        text,
  entidade_id          uuid,
  metadata             jsonb not null default '{}'::jsonb,
  importancia          text not null default 'normal',
  gerado_pelo_sistema   boolean not null default true,
  visivel              boolean not null default true,
  editado_em           timestamptz,
  chave_dedup          text unique
);

alter table public.paciente_eventos add column if not exists nutri_id            uuid;
alter table public.paciente_eventos add column if not exists paciente_id         uuid;
alter table public.paciente_eventos add column if not exists tipo                text;
alter table public.paciente_eventos add column if not exists modulo              text not null default 'paciente';
alter table public.paciente_eventos add column if not exists titulo              text;
alter table public.paciente_eventos add column if not exists descricao           text;
alter table public.paciente_eventos add column if not exists data_evento         timestamptz not null default now();
alter table public.paciente_eventos add column if not exists criado_em           timestamptz not null default now();
alter table public.paciente_eventos add column if not exists criado_por          uuid default auth.uid();
alter table public.paciente_eventos add column if not exists entidade_tipo       text;
alter table public.paciente_eventos add column if not exists entidade_id         uuid;
alter table public.paciente_eventos add column if not exists metadata            jsonb not null default '{}'::jsonb;
alter table public.paciente_eventos add column if not exists importancia         text not null default 'normal';
alter table public.paciente_eventos add column if not exists gerado_pelo_sistema boolean not null default true;
alter table public.paciente_eventos add column if not exists visivel             boolean not null default true;
alter table public.paciente_eventos add column if not exists editado_em          timestamptz;
alter table public.paciente_eventos add column if not exists chave_dedup         text;

-- Importancia: usada so para destacar (fundo sutil) os eventos relevantes.
alter table public.paciente_eventos drop constraint if exists paciente_eventos_importancia_check;
alter table public.paciente_eventos add  constraint paciente_eventos_importancia_check
  check (importancia in ('baixa', 'normal', 'alta'));

-- UNIQUE da chave de deduplicacao (idempotencia do backfill e do "1x por dia").
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'paciente_eventos_chave_dedup_key'
  ) then
    alter table public.paciente_eventos add constraint paciente_eventos_chave_dedup_key unique (chave_dedup);
  end if;
end $$;

-- Consulta principal: eventos de um paciente, mais recentes primeiro (keyset).
create index if not exists idx_pe_paciente_data on public.paciente_eventos (paciente_id, data_evento desc, id desc);
create index if not exists idx_pe_nutri        on public.paciente_eventos (nutri_id);
create index if not exists idx_pe_modulo       on public.paciente_eventos (paciente_id, modulo);
create index if not exists idx_pe_entidade     on public.paciente_eventos (entidade_tipo, entidade_id);


-- ===========================================================================
-- RLS
-- ---------------------------------------------------------------------------
-- . leitura/escrita apenas dos proprios eventos (nutri_id = auth.uid());
-- . INSERT so com paciente_id que pertence ao proprio nutri (impede criar
--   evento pendurado no paciente de outro profissional);
-- . o log automatico e imutavel: UPDATE/DELETE so em registro manual
--   (gerado_pelo_sistema = false).
-- ===========================================================================
alter table public.paciente_eventos enable row level security;

drop policy if exists paciente_eventos_owner       on public.paciente_eventos;
drop policy if exists paciente_eventos_select      on public.paciente_eventos;
drop policy if exists paciente_eventos_insert      on public.paciente_eventos;
drop policy if exists paciente_eventos_update      on public.paciente_eventos;
drop policy if exists paciente_eventos_delete      on public.paciente_eventos;

create policy paciente_eventos_select on public.paciente_eventos
  for select to authenticated
  using (nutri_id = auth.uid());

create policy paciente_eventos_insert on public.paciente_eventos
  for insert to authenticated
  with check (
    nutri_id = auth.uid()
    and exists (
      select 1 from public.pacientes p
      where p.id = paciente_id and p.nutri_id = auth.uid()
    )
  );

create policy paciente_eventos_update on public.paciente_eventos
  for update to authenticated
  using (nutri_id = auth.uid() and gerado_pelo_sistema = false)
  with check (nutri_id = auth.uid() and gerado_pelo_sistema = false);

create policy paciente_eventos_delete on public.paciente_eventos
  for delete to authenticated
  using (nutri_id = auth.uid() and gerado_pelo_sistema = false);


-- ===========================================================================
-- FIM DA ESTRUTURA
-- Confira com:  select count(*) from public.paciente_eventos;
-- Depois rode:  db/timeline_backfill.sql
-- ===========================================================================
