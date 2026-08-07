-- ===========================================================================
-- Evollo · FINANCEIRO — as 15 vendas que o extrato nao confirma
-- ---------------------------------------------------------------------------
-- A importacao de 05/08/2026 leu "coluna Pago em branco" como recebido. Em
-- 07/08/2026 essa premissa foi testada contra a planilha e contra o banco:
--
--   1.587 das 1.663 linhas em branco TEM forma de pagamento na planilha
--         (sinal independente: ninguem anota "Pix" para dinheiro que nao veio)
--      76 nao tem nem Pago nem forma — R$ 14.303,24
--
-- Dessas 76, a conciliacao contra 42 arquivos OFX do Sicoob e do Bradesco
-- (8.554 transacoes, 4.683 creditos) achou:
--
--      59  fora do periodo dos extratos (2023 inteiro)  R$ 13.350,24
--       2  com credito compativel                       R$    100,00
--      15  SEM credito compativel                       R$    853,00
--
-- ESTE SCRIPT MEXE SO NAS 15. Nelas, nenhum credito daquele valor apareceu em
-- nenhum dia proximo (janela de 7 dias) em nenhuma das duas contas. E a
-- evidencia mais forte que existe de que o dinheiro nao entrou.
--
-- O QUE ELE FAZ: devolve as 15 para `pendente` e escreve o motivo na
-- observacao. NAO apaga nada, nao mexe em valor, e nao toca nas outras 2.163.
--
-- POR QUE `pendente` E NAO `cancelado`: a divida pode ter sido paga em
-- dinheiro sem registro, ou perdoada, ou esquecida. `pendente` diz "esta em
-- aberto ate alguem conferir", que e o que se sabe. `cancelado` afirmaria que
-- nao ha o que receber, e isso ninguem apurou.
--
-- O PREDICADO E `origem_linha`, nunca campo derivado. Em 05/08/2026 um
-- predicado escrito sobre `observacoes` marcou 82 receitas erradas: ele achou
-- que pegava as linhas de Pago vazio e pegou as sem FORMA DE PAGAMENTO.
-- `origem_linha` e o numero da linha no XLSX, gravado no import.
--
-- Desfazer: db/vendas_sem_credito_no_extrato_desfazer.sql
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

select
  origem_linha,
  data,
  descricao,
  valor,
  status         as status_hoje,
  pago_em
from public.financeiro_lancamentos
where origem = 'vendas'
  and tipo = 'receita'
  and origem_linha in (1019, 1031, 1042, 1043, 1065, 1088, 1232,
                       1443, 1601, 1602, 1603, 1604, 1605, 1921, 1922)
order by data;


update public.financeiro_lancamentos
   set status     = 'pendente',
       pago       = false,
       pago_em    = null,
       observacoes = trim(both ' · ' from
                       coalesce(observacoes, '') ||
                       ' · sem credito compativel no extrato (conciliacao de 07/08/2026)'),
       atualizado_em = now()
 where origem = 'vendas'
   and tipo = 'receita'
   and status = 'pago'
   and origem_linha in (1019, 1031, 1042, 1043, 1065, 1088, 1232,
                        1443, 1601, 1602, 1603, 1604, 1605, 1921, 1922);


-- ===========================================================================
-- Conferencia. Esperado: pendentes 15, e a soma R$ 853,00.
-- ===========================================================================
select
  count(*)                                          as pendentes,
  sum(valor)                                        as soma,
  count(*) filter (where status = 'pago')           as ainda_pagas
from public.financeiro_lancamentos
where origem = 'vendas'
  and tipo = 'receita'
  and origem_linha in (1019, 1031, 1042, 1043, 1065, 1088, 1232,
                       1443, 1601, 1602, 1603, 1604, 1605, 1921, 1922);
