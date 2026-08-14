-- ===========================================================================
-- DESFAZER db/comercial_pagamento_transacional.sql (Migration B)
-- ---------------------------------------------------------------------------
-- ROLLBACK LIMPO, e ele e trivial por construcao: a Migration B nao escreve em
-- nenhuma tabela. Ela cria UMA funcao, e mais nada.
--
-- Depois de rodar, `registrarPagamento()` em js/comercial-data.js volta a
-- valer — ele nunca deixou de existir, porque a troca no frontend e um commit
-- separado da aplicacao desta migration.
--
-- O QUE NAO E DESFEITO, e por que:
--
--   os pagamentos que a RPC ja registrou -> sao pagamentos legitimos, com
--      periodo renovado e cobranca seguinte criada. Desfaze-los seria apagar
--      dinheiro recebido. Se a RPC produziu um resultado ERRADO, o caminho e
--      corrigir aquela assinatura pela tela, nao reverter a migration.
--
--   as linhas `renovada` da auditoria -> sao o registro de que aquelas
--      renovacoes aconteceram. Some a funcao, fica a trilha.
--
--   o CHECK da acao -> ele ja vinha da Migration A. Derruba-lo aqui deixaria a
--      auditoria sem trava enquanto a A continua aplicada.
--
-- 100% re-executavel.
-- Para colar no SQL Editor, use db/comercial_pagamento_transacional_desfazer_LIMPO.sql
-- ===========================================================================

drop function if exists public.comercial_registrar_pagamento(uuid, date, numeric, text, boolean);


-- ===========================================================================
-- Conferencia. Esperado: 0 funcoes, e todo o resto igual — nenhum dado desta
-- migration para desfazer.
-- ===========================================================================
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'comercial_registrar_pagamento') as funcao,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('comercial_criar_cobranca_do_periodo',
                        'comercial_cancelar_cobranca'))                          as funcoes_da_migration_a,
  (select count(*) from public.comercial_assinaturas)                            as assinaturas,
  (select count(*) from public.comercial_assinatura_auditoria)                   as auditoria,
  (select count(*) from public.comercial_assinatura_auditoria where acao = 'renovada') as renovacoes_registradas;
