-- ===========================================================================
-- Evollo · DESFAZER — Comercial Etapa 2
-- ---------------------------------------------------------------------------
-- Desfaz db/comercial_etapa2_planos.sql.
--
-- ATENCAO: derruba as duas tabelas e TODO o historico de contratos junto —
-- planos, assinaturas, periodos e precos contratados. Os lancamentos
-- financeiros permanecem intactos (o dinheiro nao mora aqui), mas perdem o
-- `assinatura_id` e o `valor_pago`.
--
-- A ordem importa: as colunas de `financeiro_lancamentos` referenciam
-- `comercial_assinaturas`, entao saem antes das tabelas.
--
-- NAO desfaz a Etapa 1. Para isso, rode
-- db/comercial_etapa1_vinculo_desfazer.sql depois deste.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

drop index if exists public.uq_comercial_cobranca_periodo;
drop index if exists public.idx_financeiro_lancamentos_assinatura;

alter table public.financeiro_lancamentos drop constraint if exists financeiro_lancamentos_valor_pago_check;
alter table public.financeiro_lancamentos drop column if exists assinatura_id;
alter table public.financeiro_lancamentos drop column if exists valor_pago;

drop trigger if exists trg_comercial_assinaturas_touch on public.comercial_assinaturas;
drop trigger if exists trg_comercial_planos_touch      on public.comercial_planos;

drop table if exists public.comercial_assinaturas;
drop table if exists public.comercial_planos;

drop function if exists public.fn_comercial_touch();


-- Conferencia: devolve 0 em tudo.
select
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('comercial_planos', 'comercial_assinaturas'))  as tabelas,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'financeiro_lancamentos'
      and column_name in ('assinatura_id', 'valor_pago'))               as colunas;
