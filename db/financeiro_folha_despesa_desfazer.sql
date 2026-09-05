-- ===========================================================================
-- DESFAZER · db/financeiro_folha_despesa.sql
-- ---------------------------------------------------------------------------
-- TIRE O FRONTEND PRIMEIRO. js/folha-ui.js chama `financeiro_lancar_folha` ao
-- fechar e ao reabrir a folha; sem a funcao, o fechamento continua funcionando
-- (a chamada e tolerante a falha, de proposito) mas avisa em toda tentativa.
--
-- O QUE ESTE ARQUIVO APAGA: os lancamentos com `origem = 'folha'` — os
-- espelhos. Nenhum deles e fonte de nada: o custo da equipe continua apurado em
-- folhas/folha_itens, e js/financeiro.js volta a le-lo pela view
-- `folha_resumo_mensal`, que e como era antes. O total de cada mes fica igual;
-- o que muda e de onde ele vem.
--
-- SE ALGUEM CLASSIFICOU ALGUM DESSES ESPELHOS a mao (centro de custo,
-- observacao, forma de pagamento), esse trabalho vai junto. E o unico dado
-- proprio que essas linhas podem ter.
--
-- A categoria "Folha de Pagamento" NAO e apagada: se houver despesa manual
-- classificada nela, apaga-la deixaria aquelas linhas sem categoria — e a
-- categoria vazia nao atrapalha nada.
-- ===========================================================================

delete from public.financeiro_lancamentos where origem = 'folha';

drop function if exists public.financeiro_lancar_folha(uuid);
drop function if exists public.financeiro_folha_sincronizar(uuid);

drop index if exists uniq_financeiro_lancamentos_folha;

alter table public.financeiro_lancamentos drop column if exists folha_id;

-- O CHECK volta a lista de tres. Vem DEPOIS do delete: com espelho na tabela,
-- a constraint nao seria aceita.
alter table public.financeiro_lancamentos drop constraint if exists financeiro_lancamentos_origem_check;
alter table public.financeiro_lancamentos add  constraint financeiro_lancamentos_origem_check
  check (origem in ('manual', 'planilha', 'vendas'));

select
  (select count(*) from public.financeiro_lancamentos where origem = 'folha') as espelhos_restantes,
  (select count(*) from public.folha_resumo_mensal)                           as competencias_apuradas;
