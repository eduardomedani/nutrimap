-- ===========================================================================
-- DESFAZER db/comercial_renovacao_programada.sql (Migration A)
-- ---------------------------------------------------------------------------
-- ROLLBACK PADRAO — NAO DESTRUTIVO.
--
-- Ele devolve o COMPORTAMENTO ao de antes da migration, sem devolver o schema.
-- Depois de rodar:
--
--   . as duas RPCs deixam de existir       -> o frontend antigo volta a valer
--   . nenhuma renovacao fica programada    -> o pagamento renova como sempre
--   . a auditoria e esvaziada e a tabela sai
--   . AS CINCO COLUNAS FICAM, vazias e inertes
--
-- POR QUE AS COLUNAS FICAM. `drop column` numa tabela com 94 assinaturas vivas
-- e irreversivel: se houver uma renovacao programada que ninguem conferiu, ela
-- vai junto e nao volta. Coluna anulavel e sem ninguem lendo nao custa nada —
-- o custo de apaga-la por engano e permanente. Quem quiser o schema idêntico
-- ao de antes tem o bloco 5, comentado, para colar de proposito.
--
-- A ORDEM importa: as funcoes saem antes da tabela de auditoria, senao elas
-- ficariam apontando para um objeto que nao existe mais.
--
-- 100% re-executavel.
-- Para colar no SQL Editor, use db/comercial_renovacao_programada_desfazer_LIMPO.sql
-- ===========================================================================


-- ===========================================================================
-- 1) AS RPCs
-- ---------------------------------------------------------------------------
-- Sem elas, `js/comercial-data.js` no estado anterior volta a fazer o insert
-- direto na tabela — que continua funcionando, porque esta migration nao mexeu
-- em nenhuma policy de `financeiro_lancamentos`.
-- ===========================================================================
drop function if exists public.comercial_criar_cobranca_do_periodo(uuid, date, numeric, uuid, text, uuid, numeric);
drop function if exists public.comercial_cancelar_cobranca(uuid);


-- ===========================================================================
-- 2) AS RENOVACOES PROGRAMADAS
-- ---------------------------------------------------------------------------
-- Limpa a INTENCAO, nunca o contrato: `plano_id`, `valor_contratado`,
-- `inicio_periodo` e `fim_periodo` nao sao tocados aqui, e nunca foram por
-- esta funcionalidade. O que estava vigente continua vigente.
--
-- Quantas linhas isto zera aparece na conferencia do fim.
-- ===========================================================================
update public.comercial_assinaturas
   set proximo_plano_id         = null,
       proximo_valor_contratado = null,
       renovacao_definida_em    = null,
       renovacao_definida_por   = null,
       renovacao_origem_id      = null
 where proximo_plano_id is not null
    or proximo_valor_contratado is not null
    or renovacao_definida_em is not null
    or renovacao_definida_por is not null
    or renovacao_origem_id is not null;


-- ===========================================================================
-- 3) A AUDITORIA
-- ---------------------------------------------------------------------------
-- A tabela sai inteira. Ela nasceu com esta migration e nao guarda nada que
-- exista fora dela — diferente das cinco colunas, aqui nao ha risco de levar
-- junto dado de outra origem.
-- ===========================================================================
drop policy if exists comercial_assinatura_auditoria_select on public.comercial_assinatura_auditoria;
drop table if exists public.comercial_assinatura_auditoria;


-- ===========================================================================
-- 4) INDICE E CONSTRAINTS
-- ---------------------------------------------------------------------------
-- Saem porque so fazem sentido com a funcionalidade no ar. As colunas ficam
-- sem CHECK, o que e inofensivo: nada escreve nelas depois do passo 1.
-- ===========================================================================
drop index if exists public.idx_comercial_assinaturas_renovacao;

alter table public.comercial_assinaturas drop constraint if exists comercial_assinaturas_renovacao_check;
alter table public.comercial_assinaturas drop constraint if exists comercial_assinaturas_proximo_valor_check;


-- ===========================================================================
-- 5) ROLLBACK DESTRUTIVO — NAO RODA SOZINHO, DE PROPOSITO
-- ---------------------------------------------------------------------------
-- Descomente e cole SO se voce quer o schema exatamente como estava antes da
-- Migration A, e ja conferiu que nao ha renovacao programada que importe.
--
-- Depois disto nao ha como recuperar quem tinha troca de plano marcada: o
-- passo 2 acima ja limpou o conteudo, mas enquanto as colunas existem a
-- auditoria do passo 3 ainda contava a historia. Rodando o bloco abaixo, os
-- dois lados somem.
--
--   alter table public.comercial_assinaturas drop column if exists proximo_plano_id;
--   alter table public.comercial_assinaturas drop column if exists proximo_valor_contratado;
--   alter table public.comercial_assinaturas drop column if exists renovacao_definida_em;
--   alter table public.comercial_assinaturas drop column if exists renovacao_definida_por;
--   alter table public.comercial_assinaturas drop column if exists renovacao_origem_id;
--
-- ===========================================================================


-- ===========================================================================
-- Conferencia. Esperado: 0 funcoes, 0 tabela de auditoria, 0 programadas,
-- 5 colunas (as inertes) e 94 assinaturas intactas.
-- ===========================================================================
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('comercial_criar_cobranca_do_periodo',
                        'comercial_cancelar_cobranca'))                      as funcoes,
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name = 'comercial_assinatura_auditoria')                     as tabela_auditoria,
  (select count(*) from public.comercial_assinaturas
    where proximo_plano_id is not null)                                      as renovacoes_programadas,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'comercial_assinaturas'
      and column_name in ('proximo_plano_id', 'proximo_valor_contratado',
                          'renovacao_definida_em', 'renovacao_definida_por',
                          'renovacao_origem_id'))                            as colunas_inertes,
  (select count(*) from public.comercial_assinaturas)                        as assinaturas,
  (select count(*) from public.financeiro_lancamentos
    where assinatura_id is not null)                                         as cobrancas_de_assinatura;
