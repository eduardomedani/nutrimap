-- ===========================================================================
-- Evollo · Financeiro — a COMPETENCIA deixa de ser amarrada a `data`
-- ---------------------------------------------------------------------------
-- CORRIGE UM ERRO MEU. O CHECK abaixo existia desde o primeiro schema:
--
--   check (competencia = date_trunc('month', data)::date)
--
-- Ele fazia sentido quando `data` era a unica data da tabela e a competencia
-- era DERIVADA dela. Depois vieram `vencimento` e `pago_em`, e a competencia
-- passou a ser ESCOLHIDA — que e o ponto inteiro de separar as tres datas.
--
-- O caso mais comum do modulo passou a ser exatamente o que a trava recusava:
-- uma despesa de AGOSTO que vence em SETEMBRO grava competencia 2026-08-01 e
-- data 2026-09-20. O cadastro devolvia
-- "violates check constraint financeiro_lancamentos_competencia_check"
-- e simplesmente nao gravava.
--
-- O QUE ENTRA NO LUGAR: a competencia continua obrigada a ser o dia 1 do mes.
-- Essa parte da regra e real — competencia no dia 15 quebraria todo agrupamento
-- por mes, que compara a data inteira. O que sai e a amarracao ao mes de `data`.
--
-- Nenhuma linha e alterada: as 2.487 ja gravadas satisfazem a regra nova, que e
-- mais frouxa que a antiga. So a trava muda.
--
-- 100% re-executavel. Rodar no SQL Editor do Supabase.
-- ===========================================================================

alter table public.financeiro_lancamentos
  drop constraint if exists financeiro_lancamentos_competencia_check;

alter table public.financeiro_lancamentos
  drop constraint if exists financeiro_lancamentos_competencia_dia1;
alter table public.financeiro_lancamentos
  add  constraint financeiro_lancamentos_competencia_dia1
  check (competencia = date_trunc('month', competencia)::date);


-- ===========================================================================
-- Conferencia. Esperado: a trava antiga sumiu (0), a nova existe (1), e
-- nenhuma linha ficou fora da regra (0).
-- ===========================================================================
select
  (select count(*) from pg_constraint
    where conrelid = 'public.financeiro_lancamentos'::regclass
      and conname = 'financeiro_lancamentos_competencia_check')            as trava_antiga,
  (select count(*) from pg_constraint
    where conrelid = 'public.financeiro_lancamentos'::regclass
      and conname = 'financeiro_lancamentos_competencia_dia1')             as trava_nova,
  (select count(*) from public.financeiro_lancamentos
    where competencia <> date_trunc('month', competencia)::date)          as fora_da_regra,
  (select count(*) from public.financeiro_lancamentos
    where competencia <> date_trunc('month', data)::date)                 as competencia_difere_da_data;
