-- ===========================================================================
-- NutriMap · Modulo de Consultas (Fase 2A)
-- Tabela: consultas
-- ---------------------------------------------------------------------------
-- Fundacao do atendimento: e daqui que saem "ultima consulta", "proximo
-- retorno", a conduta registrada e, na Fase 2B, o Modo Consulta.
--
-- Padrao do projeto: PK uuid, nutri_id default auth.uid(), criado_em em PT-BR,
-- RLS por nutri_id e insert exigindo paciente do proprio profissional.
--
-- HISTORICO IMUTAVEL: consulta finalizada nao pode mais ser editada nem
-- apagada. Isso e garantido no BANCO (policy de update/delete com
-- status <> 'finalizada'), nao apenas na tela — o que a UI esconde, a API
-- ainda aceitaria.
--
-- So estrutura, sem INSERT. 100% re-executavel.
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

create table if not exists public.consultas (
  id               uuid primary key default gen_random_uuid(),
  nutri_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  paciente_id      uuid not null references public.pacientes(id) on delete cascade,

  data_hora        timestamptz not null default now(),
  tipo             text not null default 'retorno',
  modalidade       text not null default 'presencial',
  duracao_min      integer,
  status           text not null default 'agendada',

  motivo           text,      -- por que o paciente veio
  relato           text,      -- o que o paciente contou (na voz dele)
  observacoes      text,      -- notas do profissional durante o atendimento
  conduta          text,      -- o que foi decidido
  orientacoes      text,      -- o que o paciente leva de orientacao
  retorno_sugerido date,      -- quando voltar (vira agendamento na Fase 6)

  iniciada_em      timestamptz,
  finalizada_em    timestamptz,
  resumo           text,      -- fechamento da consulta, escrito na finalizacao

  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  criado_por       uuid default auth.uid()
);

alter table public.consultas add column if not exists nutri_id         uuid;
alter table public.consultas add column if not exists paciente_id      uuid;
alter table public.consultas add column if not exists data_hora        timestamptz not null default now();
alter table public.consultas add column if not exists tipo             text not null default 'retorno';
alter table public.consultas add column if not exists modalidade       text not null default 'presencial';
alter table public.consultas add column if not exists duracao_min      integer;
alter table public.consultas add column if not exists status           text not null default 'agendada';
alter table public.consultas add column if not exists motivo           text;
alter table public.consultas add column if not exists relato           text;
alter table public.consultas add column if not exists observacoes      text;
alter table public.consultas add column if not exists conduta          text;
alter table public.consultas add column if not exists orientacoes      text;
alter table public.consultas add column if not exists retorno_sugerido date;
alter table public.consultas add column if not exists iniciada_em      timestamptz;
alter table public.consultas add column if not exists finalizada_em    timestamptz;
alter table public.consultas add column if not exists resumo           text;
alter table public.consultas add column if not exists criado_em        timestamptz not null default now();
alter table public.consultas add column if not exists atualizado_em    timestamptz not null default now();
alter table public.consultas add column if not exists criado_por       uuid default auth.uid();

alter table public.consultas drop constraint if exists consultas_status_check;
alter table public.consultas add  constraint consultas_status_check
  check (status in ('agendada', 'em_andamento', 'finalizada', 'cancelada'));

alter table public.consultas drop constraint if exists consultas_tipo_check;
alter table public.consultas add  constraint consultas_tipo_check
  check (tipo in ('primeira', 'retorno', 'avaliacao', 'acompanhamento', 'outro'));

alter table public.consultas drop constraint if exists consultas_modalidade_check;
alter table public.consultas add  constraint consultas_modalidade_check
  check (modalidade in ('presencial', 'online'));

create index if not exists idx_consultas_paciente on public.consultas (paciente_id, data_hora desc);
create index if not exists idx_consultas_nutri    on public.consultas (nutri_id, status, data_hora desc);


-- ===========================================================================
-- RLS
-- ---------------------------------------------------------------------------
-- . SELECT/INSERT como nas demais tabelas do Hub;
-- . UPDATE e DELETE bloqueados quando a consulta JA esta finalizada — o USING
--   olha a linha antiga, entao o proprio ato de finalizar continua permitido;
-- . cancelar uma consulta finalizada tambem fica barrado: o registro do
--   atendimento e historico clinico, nao rascunho.
-- ===========================================================================
alter table public.consultas enable row level security;

drop policy if exists consultas_select on public.consultas;
drop policy if exists consultas_insert on public.consultas;
drop policy if exists consultas_update on public.consultas;
drop policy if exists consultas_delete on public.consultas;

create policy consultas_select on public.consultas
  for select to authenticated
  using (nutri_id = auth.uid());

create policy consultas_insert on public.consultas
  for insert to authenticated
  with check (
    nutri_id = auth.uid()
    and exists (select 1 from public.pacientes p where p.id = paciente_id and p.nutri_id = auth.uid())
  );

create policy consultas_update on public.consultas
  for update to authenticated
  using (nutri_id = auth.uid() and status <> 'finalizada')
  with check (nutri_id = auth.uid());

create policy consultas_delete on public.consultas
  for delete to authenticated
  using (nutri_id = auth.uid() and status <> 'finalizada');


-- ===========================================================================
-- Conferencia: deve voltar 0 (a tabela nasce vazia).
-- ===========================================================================
select count(*) as consultas from public.consultas;
