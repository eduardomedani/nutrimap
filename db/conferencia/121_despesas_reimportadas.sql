-- ===========================================================================
-- AS DESPESAS DEPOIS DA REIMPORTACAO — o caixa bate?
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- Rodar DEPOIS de db/financeiro_lancamentos_seed.sql (o arquivo que
-- db/gerador_custos.mjs gera a partir de Despesas.xlsx).
--
-- ===========================================================================
-- AS QUATRO PERGUNTAS
-- ---------------------------------------------------------------------------
--   1. A IMPORTACAO ENTROU INTEIRA?
--      360 linhas de origem 'planilha', das quais 37 de folha. Menos que isso
--      quer dizer que alguma linha da planilha nao virou lancamento.
--
--   2. ALGUM MES CONTA A FOLHA DUAS VEZES?
--      E a unica pergunta que pode custar dinheiro errado no relatorio. Tem que
--      dar ZERO em `folha_em_duplicidade`: nenhuma competencia pode ter, ao
--      mesmo tempo, FOPAG da planilha e espelho de folha ativo.
--
--      A regra vale em tres lugares e e sempre a mesma: planilha, depois
--      lancamento, depois apuracao. Na tela, `folhaDoPeriodo()`
--      (js/financeiro.js); no banco, `financeiro_folha_sincronizar`.
--
--   3. O QUE FICOU SEM CLASSIFICAR?
--      Centro de custo em branco e valor em branco entraram como estao — a
--      planilha nao informou, e adivinhar seria escrever no balanco uma
--      opiniao. Aparecem como pendencia na tela.
--
--   4. HA DESPESA MANUAL QUE A PLANILHA TAMBEM TROUXE?
--      A reimportacao apaga so `origem = 'planilha'`. O que foi digitado na
--      tela continua — e se a mesma despesa estiver nos dois lugares, ela conta
--      duas vezes. A ultima secao lista as candidatas (mesma data e mesmo
--      valor) para decisao humana. NENHUMA e apagada por semelhanca.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) O retrato por origem
-- ---------------------------------------------------------------------------
select
  coalesce(origem, '(nulo)')                                as origem,
  count(*)                                                  as linhas,
  count(*) filter (where metadata ->> 'folha' = 'true')     as de_folha,
  to_char(coalesce(sum(valor), 0), 'FM999G999G990D00')      as total,
  min(competencia)                                          as primeiro_mes,
  max(competencia)                                          as ultimo_mes
from public.financeiro_lancamentos
where tipo = 'despesa' and status <> 'cancelado' and arquivado_em is null
group by origem
order by origem;

-- ---------------------------------------------------------------------------
-- 2) Mes a mes: quem responde pela folha de cada competencia
-- ---------------------------------------------------------------------------
-- `fonte` diz qual das tres respondeu. `FOLHA EM DUPLICIDADE` e o unico
-- resultado que exige acao.
-- ---------------------------------------------------------------------------
with meses as (
  select distinct competencia from (
    select competencia from public.financeiro_lancamentos where tipo = 'despesa'
    union
    select competencia from public.folha_resumo_mensal
  ) x
)
select
  m.competencia,
  coalesce((select sum(l.valor) from public.financeiro_lancamentos l
             where l.competencia = m.competencia and l.tipo = 'despesa'
               and l.origem = 'planilha' and l.metadata ->> 'folha' = 'true'
               and l.status <> 'cancelado'), 0)                  as folha_da_planilha,
  coalesce((select sum(l.valor) from public.financeiro_lancamentos l
             where l.competencia = m.competencia and l.origem = 'folha'
               and l.status <> 'cancelado'), 0)                  as espelho_da_folha,
  coalesce((select sum(r.total) from public.folha_resumo_mensal r
             where r.competencia = m.competencia), 0)            as apurado_na_folha,
  case
    when exists (select 1 from public.financeiro_lancamentos l
                  where l.competencia = m.competencia and l.tipo = 'despesa'
                    and l.origem = 'planilha' and l.metadata ->> 'folha' = 'true'
                    and l.status <> 'cancelado')
     and exists (select 1 from public.financeiro_lancamentos l
                  where l.competencia = m.competencia and l.origem = 'folha'
                    and l.status <> 'cancelado')
      then 'FOLHA EM DUPLICIDADE'
    when exists (select 1 from public.financeiro_lancamentos l
                  where l.competencia = m.competencia and l.tipo = 'despesa'
                    and l.origem = 'planilha' and l.metadata ->> 'folha' = 'true'
                    and l.status <> 'cancelado')
      then 'planilha'
    when exists (select 1 from public.financeiro_lancamentos l
                  where l.competencia = m.competencia and l.origem = 'folha'
                    and l.status <> 'cancelado')
      then 'espelho da folha'
    when exists (select 1 from public.folha_resumo_mensal r where r.competencia = m.competencia)
      then 'apuracao'
    else 'sem folha'
  end                                                            as fonte
from meses m
order by m.competencia desc;

-- ---------------------------------------------------------------------------
-- 3) O resumo. Esperado: linhas_planilha = 360, de_folha = 37,
--    folha_em_duplicidade = 0.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.financeiro_lancamentos
    where origem = 'planilha' and tipo = 'despesa')                        as linhas_planilha,
  (select count(*) from public.financeiro_lancamentos
    where origem = 'planilha' and metadata ->> 'folha' = 'true')           as de_folha,
  (select to_char(coalesce(sum(valor), 0), 'FM999G999G990D00')
     from public.financeiro_lancamentos
    where origem = 'planilha' and metadata ->> 'folha' = 'true')           as total_de_folha,
  (select count(*) from public.financeiro_lancamentos
    where origem = 'planilha' and centro_custo_id is null)                 as sem_centro,
  (select count(*) from public.financeiro_lancamentos
    where origem = 'planilha' and valor is null)                           as sem_valor,
  (select count(*) from (
     select l.competencia
       from public.financeiro_lancamentos l
      where l.status <> 'cancelado'
        and (l.origem = 'folha' or l.metadata ->> 'folha' = 'true')
      group by l.competencia
     having count(distinct case when l.origem = 'folha' then 'espelho' else 'planilha' end) > 1
   ) x)                                                                    as folha_em_duplicidade;

-- ---------------------------------------------------------------------------
-- 4) Candidatas a duplicata com o que foi lancado a mao
-- ---------------------------------------------------------------------------
-- Mesma data e mesmo valor, uma de cada lado. NAO e prova de duplicata: pode
-- haver duas despesas iguais no mesmo dia. E lista para olhar, nao para apagar
-- em bloco.
-- ---------------------------------------------------------------------------
select
  p.data,
  p.valor,
  p.descricao                                   as da_planilha,
  m.descricao                                   as lancada_a_mao,
  m.id                                          as id_da_manual
from public.financeiro_lancamentos p
join public.financeiro_lancamentos m
  on m.nutri_id = p.nutri_id
 and m.tipo = 'despesa' and m.origem = 'manual'
 and m.data = p.data and m.valor is not distinct from p.valor
where p.tipo = 'despesa' and p.origem = 'planilha'
  and p.status <> 'cancelado' and m.status <> 'cancelado'
order by p.data desc;
