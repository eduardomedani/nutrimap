-- ===========================================================================
-- Evollo · Financeiro da empresa — LANCAMENTOS
-- ---------------------------------------------------------------------------
-- O que entra e o que sai do caixa. NAO e a folha de pagamento: o custo de
-- colaborador e apurado em folhas/folha_itens (db/folha_schema.sql) e o
-- Financeiro LE aquele numero em vez de guardar uma segunda copia dele.
--
-- POR QUE ISSO IMPORTA: a planilha de custos trazia 88 linhas de FOPAG e
-- pagamento nominal, R$ 162.869,74, que o modulo Equipe ja apura a partir do
-- ponto. Importar as duas coisas faria o custo de equipe existir em dois
-- lugares, e duas fontes do mesmo numero divergem — nao no dia da importacao,
-- mas no primeiro mes em que alguem corrigir um lado so. Aqui entram as
-- despesas de operacao; a folha continua sendo respondida por quem a calcula.
--
-- Requer: nada alem do auth do Supabase. 100% re-executavel.
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================


-- ===========================================================================
-- 1) financeiro_categorias — o plano de contas
-- ---------------------------------------------------------------------------
-- `tipo` separa receita de despesa porque a MESMA palavra pode existir dos dois
-- lados (uma "Manutencao" cobrada de terceiro e receita; a do proprio aparelho
-- e despesa). Sem o tipo, o relatorio somaria os dois no mesmo balde.
--
-- Categoria e do profissional, nao global: cada academia classifica o proprio
-- gasto do jeito que le o proprio negocio.
-- ===========================================================================
create table if not exists public.financeiro_categorias (
  id            uuid primary key default gen_random_uuid(),
  nutri_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,

  nome          text not null,
  tipo          text not null default 'despesa',
  ativo         boolean not null default true,
  ordem         integer not null default 0,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.financeiro_categorias add column if not exists nome          text;
alter table public.financeiro_categorias add column if not exists tipo          text not null default 'despesa';
alter table public.financeiro_categorias add column if not exists ativo         boolean not null default true;
alter table public.financeiro_categorias add column if not exists ordem         integer not null default 0;
alter table public.financeiro_categorias add column if not exists criado_em     timestamptz not null default now();
alter table public.financeiro_categorias add column if not exists atualizado_em timestamptz not null default now();

alter table public.financeiro_categorias drop constraint if exists financeiro_categorias_tipo_check;
alter table public.financeiro_categorias add  constraint financeiro_categorias_tipo_check
  check (tipo in ('receita', 'despesa'));

-- Duas categorias com o mesmo nome sao a mesma categoria escrita duas vezes, e
-- o relatorio racharia o total entre elas sem ninguem perceber. Case-insensitive
-- porque "Energia" e "ENERGIA" sao o mesmo assunto para quem le o balanco.
create unique index if not exists uniq_financeiro_categorias_nome
  on public.financeiro_categorias (nutri_id, tipo, lower(nome));


-- ===========================================================================
-- 2) financeiro_lancamentos — cada movimento do caixa
-- ---------------------------------------------------------------------------
-- `data` e o dia do movimento (o dia em que saiu ou entrou o dinheiro).
-- `competencia` e o primeiro dia do mes desse movimento e fica GRAVADA em vez
-- de calculada na leitura: e por ela que a tela agrupa 30 meses de uma vez, e
-- um date_trunc por linha em cada consulta e trabalho repetido a cada abertura.
--
-- `valor` ACEITA NULO de proposito. A planilha de origem tem uma linha real
-- ("REFORMA INTERNA - CP", 30/04/2026) que nunca teve o valor preenchido.
-- Descartar a linha some com uma despesa que existiu; inventar zero mente no
-- total. Ela entra sem valor e a tela cobra o preenchimento.
--
-- `categoria_id` tambem aceita nulo: 22 linhas da planilha chegaram sem centro
-- de custo. Classificar por adivinhacao seria escrever no balanco uma opiniao
-- minha; sem categoria elas entram, aparecem como pendencia e sao resolvidas
-- por quem sabe o que cada uma foi.
--
-- `origem` + `origem_linha` guardam de onde a linha veio. E o que torna a
-- importacao re-executavel sem duplicar e o que permite, meses depois,
-- responder "de onde saiu esse numero" apontando a linha da planilha.
-- ===========================================================================
create table if not exists public.financeiro_lancamentos (
  id            uuid primary key default gen_random_uuid(),
  nutri_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,

  tipo          text not null default 'despesa',
  data          date not null,
  competencia   date not null,
  descricao     text not null,
  valor         numeric(12,2),
  pago          boolean not null default true,
  categoria_id  uuid references public.financeiro_categorias(id) on delete set null,
  observacoes   text,

  origem        text not null default 'manual',
  origem_linha  integer,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por    uuid default auth.uid()
);

alter table public.financeiro_lancamentos add column if not exists tipo          text not null default 'despesa';
alter table public.financeiro_lancamentos add column if not exists data          date;
alter table public.financeiro_lancamentos add column if not exists competencia   date;
alter table public.financeiro_lancamentos add column if not exists descricao     text;
alter table public.financeiro_lancamentos add column if not exists valor         numeric(12,2);
alter table public.financeiro_lancamentos add column if not exists pago          boolean not null default true;
alter table public.financeiro_lancamentos add column if not exists categoria_id  uuid references public.financeiro_categorias(id) on delete set null;
alter table public.financeiro_lancamentos add column if not exists observacoes   text;
alter table public.financeiro_lancamentos add column if not exists origem        text not null default 'manual';
alter table public.financeiro_lancamentos add column if not exists origem_linha  integer;
alter table public.financeiro_lancamentos add column if not exists criado_em     timestamptz not null default now();
alter table public.financeiro_lancamentos add column if not exists atualizado_em timestamptz not null default now();
alter table public.financeiro_lancamentos add column if not exists criado_por    uuid default auth.uid();

alter table public.financeiro_lancamentos drop constraint if exists financeiro_lancamentos_tipo_check;
alter table public.financeiro_lancamentos add  constraint financeiro_lancamentos_tipo_check
  check (tipo in ('receita', 'despesa'));

-- CADA IMPORTACAO TEM MARCA PROPRIA, e isso nao e cosmetico: os seeds apagam e
-- recriam o que trouxeram, filtrando por `origem`. Se custos e vendas
-- dividissem a marca 'planilha', reimportar os custos apagaria as vendas em
-- silencio — e o estrago so apareceria no total do mes seguinte.
--   'planilha' = custos.csv        (db/gerador_custos.mjs)
--   'vendas'   = Vendas.xlsx       (db/gerador_vendas.mjs)
alter table public.financeiro_lancamentos drop constraint if exists financeiro_lancamentos_origem_check;
alter table public.financeiro_lancamentos add  constraint financeiro_lancamentos_origem_check
  check (origem in ('manual', 'planilha', 'vendas'));

-- Valor negativo em lancamento seria uma despesa que devolve dinheiro — isso e
-- um estorno, que se registra como receita, com data e descricao propria.
alter table public.financeiro_lancamentos drop constraint if exists financeiro_lancamentos_valor_check;
alter table public.financeiro_lancamentos add  constraint financeiro_lancamentos_valor_check
  check (valor is null or valor >= 0);

-- A COMPETENCIA E ESCOLHIDA, NAO DERIVADA — e por isso NAO existe CHECK
-- amarrando-a ao mes de `data`.
--
-- Existiu um, e estava errado: nasceu quando `data` era a unica data da tabela
-- e a competencia saia dela. Depois vieram `vencimento` e `pago_em`, e o caso
-- mais comum do modulo passou a ser justamente o que a trava recusava — uma
-- despesa de AGOSTO que vence em SETEMBRO grava competencia 2026-08-01 com
-- data 2026-09-20. O cadastro devolvia
-- "violates check constraint financeiro_lancamentos_competencia_check" e nao
-- gravava.
--
-- Quem garante a coerencia agora e a tela: o campo de competencia so aceita
-- mes, e `competenciaDeData()` normaliza para o dia 1. Ver
-- js/financeiro-lancamento-validacao.js.
alter table public.financeiro_lancamentos drop constraint if exists financeiro_lancamentos_competencia_check;

-- Dia 1 do mes, sempre. Isto sim continua valendo: competencia no dia 15
-- quebraria todo agrupamento por mes, que compara a data inteira.
alter table public.financeiro_lancamentos drop constraint if exists financeiro_lancamentos_competencia_dia1;
alter table public.financeiro_lancamentos add  constraint financeiro_lancamentos_competencia_dia1
  check (competencia = date_trunc('month', competencia)::date);

-- Reimportar a planilha nao pode criar uma segunda copia da mesma linha.
create unique index if not exists uniq_financeiro_lancamentos_origem
  on public.financeiro_lancamentos (nutri_id, origem, origem_linha)
  where origem <> 'manual';

create index if not exists idx_financeiro_lancamentos_competencia
  on public.financeiro_lancamentos (nutri_id, competencia);
create index if not exists idx_financeiro_lancamentos_categoria
  on public.financeiro_lancamentos (categoria_id);


-- ===========================================================================
-- 3) Visao de resumo: uma linha por mes e tipo
-- ---------------------------------------------------------------------------
-- A tela abre 30 meses de uma vez. Trazer 400 linhas para somar no navegador
-- funciona hoje e nao funciona no quinto ano de operacao.
--
-- `pendentes` conta o que ainda nao tem valor: e o numero que impede a tela de
-- apresentar um total como se fosse completo quando nao e.
--
-- security_invoker = on: a view roda com os privilegios de QUEM CONSULTA. Sem
-- isso ela roda com os de quem a criou (o `postgres` do SQL Editor) e passa por
-- cima do RLS — qualquer usuario logado leria o caixa de todas as empresas do
-- projeto. Foi o defeito corrigido em db/views_seguras.sql; nao se repete aqui.
-- ===========================================================================
create or replace view public.financeiro_resumo_mensal
with (security_invoker = on) as
select
  l.nutri_id,
  l.competencia,
  l.tipo,
  count(*)                                                     as lancamentos,
  count(*) filter (where l.valor is null)                      as pendentes,
  coalesce(sum(l.valor), 0)                                    as total,
  coalesce(sum(l.valor) filter (where l.pago), 0)              as total_pago,
  coalesce(sum(l.valor) filter (where not l.pago), 0)          as total_aberto
from public.financeiro_lancamentos l
group by l.nutri_id, l.competencia, l.tipo;


-- ===========================================================================
-- 4) RLS — cada profissional so ve o proprio caixa
-- ===========================================================================
alter table public.financeiro_categorias  enable row level security;
alter table public.financeiro_lancamentos enable row level security;

drop policy if exists financeiro_categorias_select on public.financeiro_categorias;
drop policy if exists financeiro_categorias_insert on public.financeiro_categorias;
drop policy if exists financeiro_categorias_update on public.financeiro_categorias;
drop policy if exists financeiro_categorias_delete on public.financeiro_categorias;

create policy financeiro_categorias_select on public.financeiro_categorias
  for select to authenticated using (nutri_id = auth.uid());
create policy financeiro_categorias_insert on public.financeiro_categorias
  for insert to authenticated with check (nutri_id = auth.uid());
create policy financeiro_categorias_update on public.financeiro_categorias
  for update to authenticated using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());
create policy financeiro_categorias_delete on public.financeiro_categorias
  for delete to authenticated using (nutri_id = auth.uid());

drop policy if exists financeiro_lancamentos_select on public.financeiro_lancamentos;
drop policy if exists financeiro_lancamentos_insert on public.financeiro_lancamentos;
drop policy if exists financeiro_lancamentos_update on public.financeiro_lancamentos;
drop policy if exists financeiro_lancamentos_delete on public.financeiro_lancamentos;

create policy financeiro_lancamentos_select on public.financeiro_lancamentos
  for select to authenticated using (nutri_id = auth.uid());
-- A categoria tem que ser do proprio profissional: sem esta checagem, um id de
-- categoria de outra conta entraria pela API e o relatorio dele passaria a
-- somar uma linha que nao e dele.
create policy financeiro_lancamentos_insert on public.financeiro_lancamentos
  for insert to authenticated
  with check (
    nutri_id = auth.uid()
    and (categoria_id is null or exists (
      select 1 from public.financeiro_categorias c
       where c.id = categoria_id and c.nutri_id = auth.uid()))
  );
create policy financeiro_lancamentos_update on public.financeiro_lancamentos
  for update to authenticated
  using (nutri_id = auth.uid())
  with check (
    nutri_id = auth.uid()
    and (categoria_id is null or exists (
      select 1 from public.financeiro_categorias c
       where c.id = categoria_id and c.nutri_id = auth.uid()))
  );
create policy financeiro_lancamentos_delete on public.financeiro_lancamentos
  for delete to authenticated using (nutri_id = auth.uid());


-- ===========================================================================
-- Conferencia: as duas tabelas com RLS ativa e a view com security_invoker.
-- ===========================================================================
select
  (select count(*) from pg_tables
    where schemaname = 'public'
      and tablename in ('financeiro_categorias', 'financeiro_lancamentos')
      and rowsecurity)                                          as tabelas_com_rls,
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('financeiro_categorias', 'financeiro_lancamentos')) as policies,
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     left join pg_options_to_table(c.reloptions) o on o.option_name = 'security_invoker'
    where n.nspname = 'public'
      and c.relname = 'financeiro_resumo_mensal'
      and o.option_value in ('on', 'true'))                     as view_segura;
