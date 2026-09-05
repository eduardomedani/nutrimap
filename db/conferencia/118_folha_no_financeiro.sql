-- ===========================================================================
-- A FOLHA E O CAIXA CONTAM A MESMA HISTORIA?
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- Depois de db/financeiro_folha_despesa.sql, cada folha FECHADA tem um espelho
-- em `financeiro_lancamentos` (origem = 'folha'). Este script responde as tres
-- perguntas que decidem se dar para confiar no custo do mes:
--
--   1. TODA folha fechada tem espelho?    Faltando um, o mes aparece no
--      Financeiro pela apuracao — o numero certo, por outro caminho. Nao e
--      erro grave, mas quer dizer que aquele fechamento nao completou.
--
--   2. ALGUM espelho discorda da folha?   O espelho e recalculado a cada
--      fechamento; se ele diverge, alguem editou o valor no Financeiro depois.
--      A tela passa a mostrar o valor do CAIXA (js/financeiro.js,
--      `folhaDoPeriodo`) — que e a decisao certa, e precisa ser deliberada.
--
--   3. ALGUMA competencia tem DOIS?       Nao deveria ser possivel: o indice
--      unico `uniq_financeiro_lancamentos_folha` proibe dois por folha. Duas
--      FOLHAS do mesmo mes, sim, seriam possiveis se a migration de
--      db/folha_apagar_fantasmas.sql nao tiver rodado — e ai o mes conta duas
--      vezes.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

select
  f.competencia,
  f.status                                              as folha,
  f.data_pagamento,
  m.total                                               as apurado_na_folha,
  l.valor                                               as no_caixa,
  l.status                                              as status_no_caixa,
  case
    when f.status <> 'fechada' and l.id is null then 'rascunho — ainda nao e despesa'
    when f.status <> 'fechada' and l.status = 'cancelado' then 'reaberta — espelho cancelado'
    when f.status <> 'fechada' then 'REABERTA COM ESPELHO ATIVO'
    when l.id is null then 'FECHADA SEM ESPELHO'
    when l.status = 'cancelado' then 'FECHADA COM ESPELHO CANCELADO'
    when coalesce(l.valor, -1) <> coalesce(m.total, -2) then 'VALOR DIVERGE'
    else 'ok'
  end                                                   as resultado
from public.folhas f
left join public.folha_resumo_mensal m
       on m.competencia = f.competencia and m.nutri_id = f.nutri_id
left join public.financeiro_lancamentos l
       on l.folha_id = f.id
order by f.competencia desc;

-- ---------------------------------------------------------------------------
-- O resumo, em numeros. Esperado: divergentes = 0, fechadas_sem_espelho = 0,
-- competencias_com_dois = 0, e orfaos = 0 (espelho cuja folha foi apagada).
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.folhas where status = 'fechada')                as folhas_fechadas,
  (select count(*) from public.financeiro_lancamentos
    where origem = 'folha' and status <> 'cancelado')                          as espelhos_ativos,
  (select count(*) from public.folhas f
    where f.status = 'fechada'
      and not exists (select 1 from public.financeiro_lancamentos l
                       where l.folha_id = f.id and l.status <> 'cancelado'))   as fechadas_sem_espelho,
  (select count(*) from public.folhas f
     join public.folha_resumo_mensal m
       on m.competencia = f.competencia and m.nutri_id = f.nutri_id
     join public.financeiro_lancamentos l on l.folha_id = f.id
    where f.status = 'fechada' and l.status <> 'cancelado'
      and coalesce(l.valor, -1) <> coalesce(m.total, -2))                      as divergentes,
  (select count(*) from (
     select competencia from public.financeiro_lancamentos
      where origem = 'folha' and status <> 'cancelado'
      group by nutri_id, competencia having count(*) > 1) x)                   as competencias_com_dois,
  (select count(*) from public.financeiro_lancamentos
    where origem = 'folha' and folha_id is null)                               as orfaos;
