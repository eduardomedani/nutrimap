-- ===========================================================================
-- NutriMap · Hub do Paciente (Fase 1B) — metas e tarefas
-- Tabelas: paciente_metas, paciente_tarefas
-- ---------------------------------------------------------------------------
-- Padrao do projeto: PK uuid, nutri_id default auth.uid(), criado_em em PT-BR,
-- RLS por nutri_id = auth.uid() e insert exigindo paciente do proprio nutri.
--
-- Sem organization_id: o sistema e single-tenant por nutricionista.
--
-- Nao ha backfill: metas e tarefas so existem quando o profissional cria.
-- Este arquivo so cria estrutura, entao pode rodar de uma vez.
-- 100% re-executavel. Rodar no SQL Editor do Supabase.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) paciente_metas
-- ---------------------------------------------------------------------------
-- valor_atual NAO fica aqui: e lido das avaliacoes na hora (fonte unica).
-- Guardar uma copia so criaria dois numeros divergentes.
--
-- tipo: peso | gordura | massa_magra | cintura | frequencia_treino | agua | habito
--   . os cinco primeiros sao medidos automaticamente pela avaliacao;
--   . frequencia_treino, agua e habito sao acompanhados manualmente hoje
--     (viram automaticos quando os check-ins existirem, na Fase 3).
--
-- status: o que o PROFISSIONAL definiu. "Vencida" e "Proxima da meta" sao
-- derivados na tela (prazo + progresso) — nao precisam de job para atualizar.
create table if not exists public.paciente_metas (
  id             uuid primary key default gen_random_uuid(),
  nutri_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  paciente_id    uuid not null references public.pacientes(id) on delete cascade,
  tipo           text not null,
  titulo         text,
  valor_inicial  numeric,
  valor_alvo     numeric,
  unidade        text,
  data_inicio    date not null default current_date,
  prazo          date,
  status         text not null default 'em_andamento',
  observacoes    text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  criado_por     uuid default auth.uid()
);

alter table public.paciente_metas add column if not exists nutri_id      uuid;
alter table public.paciente_metas add column if not exists paciente_id   uuid;
alter table public.paciente_metas add column if not exists tipo          text;
alter table public.paciente_metas add column if not exists titulo        text;
alter table public.paciente_metas add column if not exists valor_inicial numeric;
alter table public.paciente_metas add column if not exists valor_alvo    numeric;
alter table public.paciente_metas add column if not exists unidade       text;
alter table public.paciente_metas add column if not exists data_inicio   date not null default current_date;
alter table public.paciente_metas add column if not exists prazo         date;
alter table public.paciente_metas add column if not exists status        text not null default 'em_andamento';
alter table public.paciente_metas add column if not exists observacoes   text;
alter table public.paciente_metas add column if not exists criado_em     timestamptz not null default now();
alter table public.paciente_metas add column if not exists atualizado_em timestamptz not null default now();
alter table public.paciente_metas add column if not exists criado_por    uuid default auth.uid();

alter table public.paciente_metas drop constraint if exists paciente_metas_status_check;
alter table public.paciente_metas add  constraint paciente_metas_status_check
  check (status in ('nao_iniciada', 'em_andamento', 'atingida', 'pausada', 'cancelada'));

alter table public.paciente_metas drop constraint if exists paciente_metas_tipo_check;
alter table public.paciente_metas add  constraint paciente_metas_tipo_check
  check (tipo in ('peso', 'gordura', 'massa_magra', 'cintura', 'frequencia_treino', 'agua', 'habito'));

create index if not exists idx_metas_paciente on public.paciente_metas (paciente_id, status);
create index if not exists idx_metas_nutri    on public.paciente_metas (nutri_id);


-- ---------------------------------------------------------------------------
-- 2) paciente_tarefas
-- ---------------------------------------------------------------------------
-- Tarefa e o que o profissional decide fazer e quer guardar. Convive com os
-- alertas automaticos (esses sao derivados do estado e nao ficam no banco).
--
-- origem: manual | alerta | timeline | consulta   (de onde ela nasceu)
create table if not exists public.paciente_tarefas (
  id            uuid primary key default gen_random_uuid(),
  nutri_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  paciente_id   uuid not null references public.pacientes(id) on delete cascade,
  titulo        text not null,
  descricao     text,
  categoria     text,
  prioridade    text not null default 'normal',
  prazo         date,
  status        text not null default 'pendente',
  origem        text not null default 'manual',
  entidade_tipo text,
  entidade_id   uuid,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por    uuid default auth.uid(),
  concluida_em  timestamptz
);

alter table public.paciente_tarefas add column if not exists nutri_id      uuid;
alter table public.paciente_tarefas add column if not exists paciente_id   uuid;
alter table public.paciente_tarefas add column if not exists titulo        text;
alter table public.paciente_tarefas add column if not exists descricao     text;
alter table public.paciente_tarefas add column if not exists categoria     text;
alter table public.paciente_tarefas add column if not exists prioridade    text not null default 'normal';
alter table public.paciente_tarefas add column if not exists prazo         date;
alter table public.paciente_tarefas add column if not exists status        text not null default 'pendente';
alter table public.paciente_tarefas add column if not exists origem        text not null default 'manual';
alter table public.paciente_tarefas add column if not exists entidade_tipo text;
alter table public.paciente_tarefas add column if not exists entidade_id   uuid;
alter table public.paciente_tarefas add column if not exists criado_em     timestamptz not null default now();
alter table public.paciente_tarefas add column if not exists atualizado_em timestamptz not null default now();
alter table public.paciente_tarefas add column if not exists criado_por    uuid default auth.uid();
alter table public.paciente_tarefas add column if not exists concluida_em  timestamptz;

alter table public.paciente_tarefas drop constraint if exists paciente_tarefas_status_check;
alter table public.paciente_tarefas add  constraint paciente_tarefas_status_check
  check (status in ('pendente', 'em_andamento', 'concluida', 'adiada', 'cancelada'));

alter table public.paciente_tarefas drop constraint if exists paciente_tarefas_prioridade_check;
alter table public.paciente_tarefas add  constraint paciente_tarefas_prioridade_check
  check (prioridade in ('baixa', 'normal', 'alta'));

create index if not exists idx_tarefas_paciente on public.paciente_tarefas (paciente_id, status, prazo);
create index if not exists idx_tarefas_nutri    on public.paciente_tarefas (nutri_id, status);


-- ===========================================================================
-- RLS — mesmo desenho de paciente_eventos
-- ===========================================================================
alter table public.paciente_metas   enable row level security;
alter table public.paciente_tarefas enable row level security;

drop policy if exists paciente_metas_select on public.paciente_metas;
drop policy if exists paciente_metas_insert on public.paciente_metas;
drop policy if exists paciente_metas_write  on public.paciente_metas;
drop policy if exists paciente_metas_delete on public.paciente_metas;

create policy paciente_metas_select on public.paciente_metas
  for select to authenticated using (nutri_id = auth.uid());

create policy paciente_metas_insert on public.paciente_metas
  for insert to authenticated
  with check (
    nutri_id = auth.uid()
    and exists (select 1 from public.pacientes p where p.id = paciente_id and p.nutri_id = auth.uid())
  );

create policy paciente_metas_write on public.paciente_metas
  for update to authenticated
  using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

create policy paciente_metas_delete on public.paciente_metas
  for delete to authenticated using (nutri_id = auth.uid());

drop policy if exists paciente_tarefas_select on public.paciente_tarefas;
drop policy if exists paciente_tarefas_insert on public.paciente_tarefas;
drop policy if exists paciente_tarefas_write  on public.paciente_tarefas;
drop policy if exists paciente_tarefas_delete on public.paciente_tarefas;

create policy paciente_tarefas_select on public.paciente_tarefas
  for select to authenticated using (nutri_id = auth.uid());

create policy paciente_tarefas_insert on public.paciente_tarefas
  for insert to authenticated
  with check (
    nutri_id = auth.uid()
    and exists (select 1 from public.pacientes p where p.id = paciente_id and p.nutri_id = auth.uid())
  );

create policy paciente_tarefas_write on public.paciente_tarefas
  for update to authenticated
  using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

create policy paciente_tarefas_delete on public.paciente_tarefas
  for delete to authenticated using (nutri_id = auth.uid());

-- ===========================================================================
-- FIM
-- Confira com:
--   select count(*) from public.paciente_metas;
--   select count(*) from public.paciente_tarefas;
-- ===========================================================================
