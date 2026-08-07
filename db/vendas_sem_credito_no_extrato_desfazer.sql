-- ===========================================================================
-- Evollo · DESFAZER — as 15 vendas sem credito no extrato
-- ---------------------------------------------------------------------------
-- Devolve as 15 linhas para `pago`, com a data do proprio lancamento como
-- data de pagamento — que e como a importacao de 05/08/2026 as gravou.
--
-- Rode isto se a conciliacao estiver errada: se voce achar os creditos no
-- extrato de 2023 que falta, ou se lembrar que foram pagas em dinheiro.
--
-- A observacao acrescentada pelo script tambem sai, para a linha nao ficar
-- carregando um aviso que deixou de valer.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

update public.financeiro_lancamentos
   set status  = 'pago',
       pago    = true,
       pago_em = data,
       observacoes = nullif(
                       trim(both ' · ' from
                         replace(coalesce(observacoes, ''),
                                 ' · sem credito compativel no extrato (conciliacao de 07/08/2026)',
                                 '')), ''),
       atualizado_em = now()
 where origem = 'vendas'
   and tipo = 'receita'
   and origem_linha in (1019, 1031, 1042, 1043, 1065, 1088, 1232,
                        1443, 1601, 1602, 1603, 1604, 1605, 1921, 1922);


-- Conferencia: esperado pagas 15, com_aviso 0.
select
  count(*) filter (where status = 'pago')                                  as pagas,
  count(*) filter (where observacoes like '%sem credito compativel%')      as com_aviso
from public.financeiro_lancamentos
where origem = 'vendas'
  and tipo = 'receita'
  and origem_linha in (1019, 1031, 1042, 1043, 1065, 1088, 1232,
                       1443, 1601, 1602, 1603, 1604, 1605, 1921, 1922);
