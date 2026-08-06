-- ===========================================================================
-- Evollo · DESFAZER — Comercial Etapa 1
-- ---------------------------------------------------------------------------
-- Desfaz db/comercial_etapa1_vinculo.sql.
--
-- ATENCAO: derrubar a coluna `paciente_id` APAGA o vinculo de todos os
-- lancamentos ja ligados a clientes. O dinheiro fica (as linhas de
-- financeiro_lancamentos nao sao tocadas), mas saber de quem era, nao.
--
-- Se a intencao for so parar de usar, basta nao preencher a coluna. Rode isto
-- apenas para voltar o schema ao estado anterior de verdade.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

drop trigger if exists trg_lancamento_paciente_do_nutri on public.financeiro_lancamentos;
drop function if exists public.fn_lancamento_paciente_do_nutri();

drop index if exists public.idx_financeiro_lancamentos_paciente;
drop index if exists public.idx_financeiro_lancamentos_a_receber;

alter table public.financeiro_lancamentos drop column if exists paciente_id;


-- Conferencia: devolve 0 em tudo.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'financeiro_lancamentos'
      and column_name = 'paciente_id')                           as coluna,
  (select count(*) from pg_trigger
    where tgname = 'trg_lancamento_paciente_do_nutri')           as gatilho;
