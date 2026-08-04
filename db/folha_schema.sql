-- ===========================================================================
-- Evollo · Financeiro (Fase 2) — Folha de pagamento
-- ---------------------------------------------------------------------------
-- Traducao direta da planilha "Ponto - PONTO" para o banco. Uma linha da
-- planilha (Data / Mes / Ano / Colaborador / Horas / Valor(h) / Total /
-- TOTAL + BONUS / Observacoes) vira:
--
--   folhas          = a competencia (o mes que esta sendo pago)
--   folha_itens     = a linha do colaborador naquela competencia
--   folha_adicionais= o que entra ou sai depois do calculo por hora
--                     (alunos ativos, feriado, hora extra, desconto)
--
-- O CALCULO: minutos / 60 * valor_hora, arredondado em 2 casas — exatamente
-- como a planilha fazia. `valor_base` fica GRAVADO em vez de recalculado na
-- leitura: o valor/hora muda com o tempo, e uma folha antiga tem que continuar
-- mostrando o que foi pago de verdade, nao o que daria com a tabela de hoje.
--
-- POR QUE ADICIONAL E TABELA E NAO COLUNA: os bonus nao tem forma fixa. Num mes
-- e "58 alunos ativos", noutro "10% de bonus", noutro "R$ 351,90 CREF + R$ 80
-- ATESTADO", e as vezes e desconto (ferias). Uma coluna "bonus" perderia a
-- descricao — e a descricao e o unico registro de por que o valor foi aquele.
--
-- Valor NEGATIVO em folha_adicionais e desconto. E de proposito que nao ha
-- CHECK proibindo: "PAGAMENTO DE FERIAS" no historico reduz o total.
--
-- Requer funcionarios_schema.sql. 100% re-executavel.
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================


-- ===========================================================================
-- 1) O cadastro do funcionario ganha o que a folha precisa
-- ---------------------------------------------------------------------------
-- valor_hora e o PADRAO, nao a verdade historica: cada folha grava o valor que
-- usou. Reajuste no cadastro nao reescreve o passado.
-- ===========================================================================
alter table public.funcionarios add column if not exists valor_hora  numeric(10,2);
alter table public.funcionarios add column if not exists chave_pix   text;
alter table public.funcionarios add column if not exists salario_fixo numeric(12,2);

alter table public.funcionarios drop constraint if exists funcionarios_valor_hora_check;
alter table public.funcionarios add  constraint funcionarios_valor_hora_check
  check (valor_hora is null or valor_hora >= 0);

alter table public.funcionarios drop constraint if exists funcionarios_salario_fixo_check;
alter table public.funcionarios add  constraint funcionarios_salario_fixo_check
  check (salario_fixo is null or salario_fixo >= 0);


-- ===========================================================================
-- 2) folhas — uma por competencia
-- ---------------------------------------------------------------------------
-- `competencia` guarda o primeiro dia do mes (2026-08-01 = agosto/2026) e segue
-- a convencao da planilha: e o mes do PAGAMENTO, e as horas apuradas costumam
-- ser as do ponto do mes anterior. `data_pagamento` e o dia em que saiu o Pix.
-- ===========================================================================
create table if not exists public.folhas (
  id             uuid primary key default gen_random_uuid(),
  nutri_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,

  competencia    date not null,
  data_pagamento date,
  status         text not null default 'rascunho',
  observacoes    text,

  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  criado_por     uuid default auth.uid()
);

alter table public.folhas add column if not exists competencia    date;
alter table public.folhas add column if not exists data_pagamento date;
alter table public.folhas add column if not exists status         text not null default 'rascunho';
alter table public.folhas add column if not exists observacoes    text;
alter table public.folhas add column if not exists criado_em      timestamptz not null default now();
alter table public.folhas add column if not exists atualizado_em  timestamptz not null default now();
alter table public.folhas add column if not exists criado_por     uuid default auth.uid();

alter table public.folhas drop constraint if exists folhas_status_check;
alter table public.folhas add  constraint folhas_status_check
  check (status in ('rascunho', 'fechada'));

-- Duas folhas do mesmo mes seriam dois pagamentos paralelos do mesmo periodo.
create unique index if not exists uniq_folhas_competencia
  on public.folhas (nutri_id, competencia);


-- ===========================================================================
-- 3) folha_itens — a linha de cada colaborador
-- ---------------------------------------------------------------------------
-- modo = 'horas' (paga por hora trabalhada) ou 'fixo' (mensalista: Josely e
-- Rafael entram assim no historico, com as horas em branco).
-- ===========================================================================
create table if not exists public.folha_itens (
  id             uuid primary key default gen_random_uuid(),
  nutri_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  folha_id       uuid not null references public.folhas(id) on delete cascade,
  funcionario_id uuid not null references public.funcionarios(id) on delete restrict,

  modo           text not null default 'horas',
  minutos        integer,
  valor_hora     numeric(10,2),
  valor_base     numeric(12,2) not null default 0,
  observacoes    text,

  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

alter table public.folha_itens add column if not exists modo        text not null default 'horas';
alter table public.folha_itens add column if not exists minutos     integer;
alter table public.folha_itens add column if not exists valor_hora  numeric(10,2);
alter table public.folha_itens add column if not exists valor_base  numeric(12,2) not null default 0;
alter table public.folha_itens add column if not exists observacoes text;
alter table public.folha_itens add column if not exists criado_em   timestamptz not null default now();
alter table public.folha_itens add column if not exists atualizado_em timestamptz not null default now();

alter table public.folha_itens drop constraint if exists folha_itens_modo_check;
alter table public.folha_itens add  constraint folha_itens_modo_check
  check (modo in ('horas', 'fixo'));

alter table public.folha_itens drop constraint if exists folha_itens_minutos_check;
alter table public.folha_itens add  constraint folha_itens_minutos_check
  check (minutos is null or minutos >= 0);

-- Um colaborador aparece uma vez por folha. Turno da manha e turno da noite com
-- valores diferentes viram um adicional, nao uma segunda linha.
create unique index if not exists uniq_folha_itens_funcionario
  on public.folha_itens (folha_id, funcionario_id);

create index if not exists idx_folha_itens_funcionario
  on public.folha_itens (funcionario_id);


-- ===========================================================================
-- 4) folha_adicionais — bonus e descontos, com a descricao junto
-- ===========================================================================
create table if not exists public.folha_adicionais (
  id          uuid primary key default gen_random_uuid(),
  nutri_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id     uuid not null references public.folha_itens(id) on delete cascade,

  descricao   text not null,
  valor       numeric(12,2) not null default 0,
  ordem       integer not null default 0,

  criado_em   timestamptz not null default now()
);

alter table public.folha_adicionais add column if not exists descricao text;
alter table public.folha_adicionais add column if not exists valor     numeric(12,2) not null default 0;
alter table public.folha_adicionais add column if not exists ordem     integer not null default 0;
alter table public.folha_adicionais add column if not exists criado_em timestamptz not null default now();

create index if not exists idx_folha_adicionais_item
  on public.folha_adicionais (item_id, ordem);


-- ===========================================================================
-- 5) Visao de conferencia: o total de cada item ja somado
-- ---------------------------------------------------------------------------
-- Existe para o relatorio e para conferir importacao sem repetir a soma em
-- cada consulta. A tela continua somando no navegador o que ja tem em maos.
-- ===========================================================================
-- security_invoker: a view roda com os privilegios de QUEM CONSULTA. Sem isso
-- ela roda com os de quem a criou (o `postgres` do SQL Editor) e passa por
-- cima do RLS das tabelas de baixo — qualquer usuario logado leria a folha de
-- pagamento de todos os profissionais do projeto.
create or replace view public.folha_itens_totais
with (security_invoker = on) as
select
  i.id,
  i.nutri_id,
  i.folha_id,
  i.funcionario_id,
  i.modo,
  i.minutos,
  i.valor_hora,
  i.valor_base,
  coalesce((select sum(a.valor) from public.folha_adicionais a where a.item_id = i.id), 0) as adicionais,
  i.valor_base + coalesce((select sum(a.valor) from public.folha_adicionais a where a.item_id = i.id), 0) as total
from public.folha_itens i;


-- ===========================================================================
-- 6) RLS — cada profissional so ve a propria folha
-- ===========================================================================
alter table public.folhas           enable row level security;
alter table public.folha_itens      enable row level security;
alter table public.folha_adicionais enable row level security;

drop policy if exists folhas_select on public.folhas;
drop policy if exists folhas_insert on public.folhas;
drop policy if exists folhas_update on public.folhas;
drop policy if exists folhas_delete on public.folhas;

create policy folhas_select on public.folhas
  for select to authenticated using (nutri_id = auth.uid());
create policy folhas_insert on public.folhas
  for insert to authenticated with check (nutri_id = auth.uid());
create policy folhas_update on public.folhas
  for update to authenticated using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());
create policy folhas_delete on public.folhas
  for delete to authenticated using (nutri_id = auth.uid() and status <> 'fechada');

drop policy if exists folha_itens_select on public.folha_itens;
drop policy if exists folha_itens_insert on public.folha_itens;
drop policy if exists folha_itens_update on public.folha_itens;
drop policy if exists folha_itens_delete on public.folha_itens;

create policy folha_itens_select on public.folha_itens
  for select to authenticated using (nutri_id = auth.uid());
create policy folha_itens_insert on public.folha_itens
  for insert to authenticated
  with check (
    nutri_id = auth.uid()
    and exists (select 1 from public.folhas f
                 where f.id = folha_id and f.nutri_id = auth.uid() and f.status <> 'fechada')
    and exists (select 1 from public.funcionarios u where u.id = funcionario_id and u.nutri_id = auth.uid())
  );
-- Folha FECHADA nao aceita mais mexer nas linhas — e isso vale no BANCO, nao
-- so na tela. Reabrir continua possivel: quem muda de status e a tabela
-- `folhas`, que nao tem essa trava. Corrigir pagamento e legitimo; corrigir
-- sem deixar rastro de que a folha foi reaberta, nao.
create policy folha_itens_update on public.folha_itens
  for update to authenticated
  using (
    nutri_id = auth.uid()
    and exists (select 1 from public.folhas f where f.id = folha_id and f.status <> 'fechada')
  )
  with check (nutri_id = auth.uid());
create policy folha_itens_delete on public.folha_itens
  for delete to authenticated
  using (
    nutri_id = auth.uid()
    and exists (select 1 from public.folhas f where f.id = folha_id and f.status <> 'fechada')
  );

drop policy if exists folha_adicionais_select on public.folha_adicionais;
drop policy if exists folha_adicionais_insert on public.folha_adicionais;
drop policy if exists folha_adicionais_update on public.folha_adicionais;
drop policy if exists folha_adicionais_delete on public.folha_adicionais;

create policy folha_adicionais_select on public.folha_adicionais
  for select to authenticated using (nutri_id = auth.uid());
-- Mesma regra dos itens: adicional de folha fechada nao entra, nao muda e nao
-- sai. A trava mora no estado da folha, uma consulta acima.
create policy folha_adicionais_insert on public.folha_adicionais
  for insert to authenticated
  with check (
    nutri_id = auth.uid()
    and exists (
      select 1 from public.folha_itens i join public.folhas f on f.id = i.folha_id
       where i.id = item_id and i.nutri_id = auth.uid() and f.status <> 'fechada')
  );
create policy folha_adicionais_update on public.folha_adicionais
  for update to authenticated
  using (
    nutri_id = auth.uid()
    and exists (
      select 1 from public.folha_itens i join public.folhas f on f.id = i.folha_id
       where i.id = item_id and f.status <> 'fechada')
  )
  with check (nutri_id = auth.uid());
create policy folha_adicionais_delete on public.folha_adicionais
  for delete to authenticated
  using (
    nutri_id = auth.uid()
    and exists (
      select 1 from public.folha_itens i join public.folhas f on f.id = i.folha_id
       where i.id = item_id and f.status <> 'fechada')
  );


-- ===========================================================================
-- Conferencia: deve voltar 0, 0, 0 (as tabelas nascem vazias).
-- ===========================================================================
select
  (select count(*) from public.folhas)           as folhas,
  (select count(*) from public.folha_itens)      as itens,
  (select count(*) from public.folha_adicionais) as adicionais;
