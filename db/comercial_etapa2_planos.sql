-- ===========================================================================
-- Evollo · COMERCIAL — Etapa 2: planos e assinaturas
-- ---------------------------------------------------------------------------
-- Depende de db/comercial_etapa1_vinculo.sql.
--
-- Duas tabelas novas e tres colunas. Nenhuma delas guarda dinheiro: o dinheiro
-- continua inteiro em `financeiro_lancamentos`. O que entra aqui e o CONTRATO
-- — o que foi combinado — que hoje nao existe em lugar nenhum.
--
-- O QUE DELIBERADAMENTE NAO EXISTE AQUI, e por que:
--
--   dias_vencidos    -> e conta, nao dado. `hoje - fim_periodo`, calculado na
--                       hora. Guardado, estaria errado no dia seguinte.
--   mes, ano         -> derivam da data. Duas colunas a mais para discordar.
--   contato_zapi     -> e formatacao do mesmo telefone. Ver js/comercial.js.
--   status do cliente-> deriva de fim_periodo e do pagamento. So o que NAO da
--                       para calcular (pausado, cancelado) e gravado.
--
-- ADITIVO: nada do financeiro ou do cadastro clinico muda de comportamento.
-- 100% re-executavel.
-- Desfazer: db/comercial_etapa2_planos_desfazer.sql
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================


-- ===========================================================================
-- 1) CATALOGO DE PLANOS
-- ---------------------------------------------------------------------------
-- Duracao e preco sao DADO, nunca codigo: mudar de "Mensal - 3x" por R$ 330
-- para R$ 350 tem que ser um update, nao um deploy.
--
-- `duracao_unidade` aceita 'dia' e 'mes' porque as duas regras existem no
-- mundo. A GoUp hoje roda em DIA: a planilha mostra 30 dias corridos no mensal
-- e 90 no trimestral, em 131 de 131 linhas conferidas. Mes calendario fica
-- disponivel para quando um plano precisar dele.
--
-- `tolerancia_dias` e a regra do pagamento em atraso: dentro dela, a renovacao
-- continua do termino anterior; passando dela, comeca na data do pagamento.
-- ===========================================================================
create table if not exists public.comercial_planos (
  id                uuid primary key default gen_random_uuid(),
  nutri_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,

  nome              text not null,
  descricao         text,

  frequencia_semanal smallint,
  duracao_valor     integer not null default 30,
  duracao_unidade   text    not null default 'dia',

  preco_padrao      numeric(12,2),
  tolerancia_dias   integer not null default 5,

  ativo             boolean not null default true,
  ordem             integer not null default 0,

  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  criado_por        uuid default auth.uid()
);

alter table public.comercial_planos drop constraint if exists comercial_planos_unidade_check;
alter table public.comercial_planos add  constraint comercial_planos_unidade_check
  check (duracao_unidade in ('dia', 'mes'));

alter table public.comercial_planos drop constraint if exists comercial_planos_duracao_check;
alter table public.comercial_planos add  constraint comercial_planos_duracao_check
  check (duracao_valor > 0);

alter table public.comercial_planos drop constraint if exists comercial_planos_tolerancia_check;
alter table public.comercial_planos add  constraint comercial_planos_tolerancia_check
  check (tolerancia_dias >= 0);

alter table public.comercial_planos drop constraint if exists comercial_planos_preco_check;
alter table public.comercial_planos add  constraint comercial_planos_preco_check
  check (preco_padrao is null or preco_padrao >= 0);

create index if not exists idx_comercial_planos_nutri
  on public.comercial_planos (nutri_id, ativo, ordem);


-- ===========================================================================
-- 2) ASSINATURAS
-- ---------------------------------------------------------------------------
-- Uma assinatura por vinculo comercial vigente do cliente. O cadastro clinico
-- (public.pacientes) NAO ganha nenhuma coluna: a camada comercial se relaciona
-- com ele, nao o engorda.
--
-- `valor_contratado` e o preco DAQUELE cliente, copiado do plano no momento da
-- contratacao e nunca mais tocado por mudanca de tabela de precos. Um cliente
-- de 2024 pagando R$ 330 continua pagando R$ 330 quando o plano virar R$ 350.
--
-- `data_inicio_original` nunca muda. E ela que responde "cliente desde".
-- `inicio_periodo` e `fim_periodo` sao o periodo VIGENTE, e mudam a cada
-- renovacao. Guardar so um dos tres perderia informacao diferente em cada caso.
-- ===========================================================================
create table if not exists public.comercial_assinaturas (
  id                   uuid primary key default gen_random_uuid(),
  nutri_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  paciente_id          uuid not null references public.pacientes(id) on delete cascade,
  plano_id             uuid references public.comercial_planos(id) on delete restrict,

  valor_contratado     numeric(12,2),

  data_inicio_original date not null default current_date,
  inicio_periodo       date not null default current_date,
  fim_periodo          date not null,

  horario              text,

  status               text not null default 'ativa',
  renovacao_automatica boolean not null default true,
  observacoes          text,

  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),
  criado_por           uuid default auth.uid()
);

-- 'ativa', 'pausada', 'cancelada' e 'aguardando_inicio' sao os unicos estados
-- GRAVADOS. "Vencido" e "vence em breve" NAO entram aqui: os dois sao conta
-- entre `fim_periodo` e hoje, e gravar conta e criar uma segunda verdade que
-- envelhece sozinha (foi assim que a planilha passou a ter "Dias Vencidos"
-- desatualizado sempre que ninguem abria o arquivo).
alter table public.comercial_assinaturas drop constraint if exists comercial_assinaturas_status_check;
alter table public.comercial_assinaturas add  constraint comercial_assinaturas_status_check
  check (status in ('ativa', 'pausada', 'cancelada', 'aguardando_inicio'));

alter table public.comercial_assinaturas drop constraint if exists comercial_assinaturas_periodo_check;
alter table public.comercial_assinaturas add  constraint comercial_assinaturas_periodo_check
  check (fim_periodo >= inicio_periodo);

alter table public.comercial_assinaturas drop constraint if exists comercial_assinaturas_origem_check;
alter table public.comercial_assinaturas add  constraint comercial_assinaturas_origem_check
  check (inicio_periodo >= data_inicio_original);

alter table public.comercial_assinaturas drop constraint if exists comercial_assinaturas_valor_check;
alter table public.comercial_assinaturas add  constraint comercial_assinaturas_valor_check
  check (valor_contratado is null or valor_contratado >= 0);

create index if not exists idx_comercial_assinaturas_nutri
  on public.comercial_assinaturas (nutri_id, status, fim_periodo);

create index if not exists idx_comercial_assinaturas_paciente
  on public.comercial_assinaturas (paciente_id, status);

-- Um cliente nao pode ter duas assinaturas VIGENTES ao mesmo tempo. Cancelada
-- e pausada podem se repetir — sao historico.
create unique index if not exists uq_comercial_assinatura_ativa
  on public.comercial_assinaturas (paciente_id)
  where status in ('ativa', 'aguardando_inicio');


-- ===========================================================================
-- 3) O LANCAMENTO APONTA PARA A ASSINATURA
-- ---------------------------------------------------------------------------
-- Com isto o lancamento passa a ser, ao mesmo tempo, a cobranca do periodo e a
-- receita do caixa. Uma linha so, os dois papeis.
--
-- `valor_pago` entra AGORA e fica sem uso: pagamento parcial nao esta
-- implementado nesta etapa. A coluna existe desde ja porque acrescenta-la
-- depois obrigaria a reescrever o significado de "cobranca paga" no meio de
-- dados reais — e porque, sem ela, receber R$ 200 de uma cobranca de R$ 350
-- so poderia ser gravado como quitacao, que e falso.
-- ===========================================================================
alter table public.financeiro_lancamentos
  add column if not exists assinatura_id uuid references public.comercial_assinaturas(id) on delete set null;

alter table public.financeiro_lancamentos
  add column if not exists valor_pago numeric(12,2);

alter table public.financeiro_lancamentos drop constraint if exists financeiro_lancamentos_valor_pago_check;
alter table public.financeiro_lancamentos add  constraint financeiro_lancamentos_valor_pago_check
  check (valor_pago is null or valor_pago >= 0);

-- Duas cobrancas para o mesmo periodo da mesma assinatura sao erro de digitacao,
-- nao um caso de negocio. Cancelada fica de fora: um lancamento cancelado e
-- justamente o que se refaz.
create unique index if not exists uq_comercial_cobranca_periodo
  on public.financeiro_lancamentos (assinatura_id, vencimento)
  where assinatura_id is not null and status <> 'cancelado';

create index if not exists idx_financeiro_lancamentos_assinatura
  on public.financeiro_lancamentos (assinatura_id, vencimento desc)
  where assinatura_id is not null;


-- ===========================================================================
-- 4) RLS — o mesmo isolamento do resto do sistema
-- ===========================================================================
alter table public.comercial_planos      enable row level security;
alter table public.comercial_assinaturas enable row level security;

drop policy if exists comercial_planos_select on public.comercial_planos;
drop policy if exists comercial_planos_insert on public.comercial_planos;
drop policy if exists comercial_planos_update on public.comercial_planos;
drop policy if exists comercial_planos_delete on public.comercial_planos;

create policy comercial_planos_select on public.comercial_planos
  for select to authenticated using (nutri_id = auth.uid());
create policy comercial_planos_insert on public.comercial_planos
  for insert to authenticated with check (nutri_id = auth.uid());
create policy comercial_planos_update on public.comercial_planos
  for update to authenticated using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());
create policy comercial_planos_delete on public.comercial_planos
  for delete to authenticated using (nutri_id = auth.uid());

drop policy if exists comercial_assinaturas_select on public.comercial_assinaturas;
drop policy if exists comercial_assinaturas_insert on public.comercial_assinaturas;
drop policy if exists comercial_assinaturas_update on public.comercial_assinaturas;
drop policy if exists comercial_assinaturas_delete on public.comercial_assinaturas;

create policy comercial_assinaturas_select on public.comercial_assinaturas
  for select to authenticated using (nutri_id = auth.uid());
-- O paciente apontado tem que ser meu: sem isto, um insert com o paciente_id
-- de outro profissional passaria, porque a policy so olha o nutri_id da linha.
create policy comercial_assinaturas_insert on public.comercial_assinaturas
  for insert to authenticated
  with check (
    nutri_id = auth.uid()
    and exists (select 1 from public.pacientes p
                 where p.id = paciente_id and p.nutri_id = auth.uid())
  );
create policy comercial_assinaturas_update on public.comercial_assinaturas
  for update to authenticated
  using (nutri_id = auth.uid())
  with check (
    nutri_id = auth.uid()
    and exists (select 1 from public.pacientes p
                 where p.id = paciente_id and p.nutri_id = auth.uid())
  );
create policy comercial_assinaturas_delete on public.comercial_assinaturas
  for delete to authenticated using (nutri_id = auth.uid());


-- ===========================================================================
-- 5) atualizado_em
-- ===========================================================================
create or replace function public.fn_comercial_touch()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists trg_comercial_planos_touch on public.comercial_planos;
create trigger trg_comercial_planos_touch
  before update on public.comercial_planos
  for each row execute function public.fn_comercial_touch();

drop trigger if exists trg_comercial_assinaturas_touch on public.comercial_assinaturas;
create trigger trg_comercial_assinaturas_touch
  before update on public.comercial_assinaturas
  for each row execute function public.fn_comercial_touch();


-- ===========================================================================
-- Conferencia. Esperado: 2 tabelas, 2 colunas novas, 8 policies, 2 indices
-- unicos.
-- ===========================================================================
select
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('comercial_planos', 'comercial_assinaturas'))     as tabelas,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'financeiro_lancamentos'
      and column_name in ('assinatura_id', 'valor_pago'))                  as colunas,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename like 'comercial_%')          as policies,
  (select count(*) from pg_indexes
    where schemaname = 'public'
      and indexname in ('uq_comercial_assinatura_ativa',
                        'uq_comercial_cobranca_periodo'))                  as indices_unicos;
