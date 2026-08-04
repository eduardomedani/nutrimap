-- ===========================================================================
-- Evollo · Financeiro — VISOES DE RESUMO
-- ---------------------------------------------------------------------------
-- Os numeros ja estao no banco desde a importacao da planilha: 31 competencias,
-- 133 pagamentos. O que faltava era um lugar onde eles pudessem ser lidos
-- JUNTOS — quanto a equipe custou mes a mes, quanto foi hora e quanto foi
-- bonus, quanto cada pessoa representou no periodo.
--
-- Agregar no banco, e nao no navegador, porque a tela precisa de 24 meses de
-- uma vez: trazer as 133 linhas com seus adicionais para somar em JavaScript
-- funcionaria hoje e nao funcionaria no terceiro ano.
--
-- security_invoker = on nas DUAS. Sem isso a view roda com os privilegios de
-- quem a criou e ignora o RLS — foi exatamente o defeito corrigido em
-- db/views_seguras.sql, e nao vai se repetir aqui.
--
-- Requer folha_schema.sql. 100% re-executavel. So leitura: nenhuma tabela nova.
-- ===========================================================================


-- ===========================================================================
-- 1) Uma linha por competencia
-- ---------------------------------------------------------------------------
-- `base` e o que saiu do calculo por hora (ou do valor fixo do mensalista);
-- `adicionais` e tudo que entrou ou saiu depois. base + adicionais = total, e
-- e essa soma que a barra empilhada mostra.
-- ===========================================================================
create or replace view public.folha_resumo_mensal
with (security_invoker = on) as
select
  f.nutri_id,
  f.competencia,
  f.status,
  f.data_pagamento,
  count(i.id)                                              as pessoas,
  coalesce(sum(i.minutos), 0)                              as minutos,
  coalesce(sum(i.valor_base), 0)                           as base,
  coalesce(sum(
    (select coalesce(sum(a.valor), 0)
       from public.folha_adicionais a where a.item_id = i.id)
  ), 0)                                                    as adicionais,
  coalesce(sum(
    i.valor_base + (select coalesce(sum(a.valor), 0)
                      from public.folha_adicionais a where a.item_id = i.id)
  ), 0)                                                    as total
from public.folhas f
left join public.folha_itens i on i.folha_id = f.id
group by f.nutri_id, f.competencia, f.status, f.data_pagamento;


-- ===========================================================================
-- 2) Uma linha por colaborador por competencia
-- ---------------------------------------------------------------------------
-- O nome vem junto para a tela nao precisar de uma segunda consulta so para
-- resolver 9 ids.
-- ===========================================================================
create or replace view public.folha_resumo_colaborador
with (security_invoker = on) as
select
  i.nutri_id,
  i.funcionario_id                                   as colaborador_id,
  u.nome,
  u.cargo,
  u.ativo,
  f.competencia,
  f.status,
  i.modo,
  coalesce(i.minutos, 0)                             as minutos,
  i.valor_base                                       as base,
  (select coalesce(sum(a.valor), 0)
     from public.folha_adicionais a where a.item_id = i.id) as adicionais,
  i.valor_base + (select coalesce(sum(a.valor), 0)
                    from public.folha_adicionais a where a.item_id = i.id) as total
from public.folha_itens i
join public.folhas f       on f.id = i.folha_id
join public.funcionarios u on u.id = i.funcionario_id;


-- ===========================================================================
-- Conferencia: 31 competencias e o total do periodo importado.
-- ===========================================================================
select
  (select count(*) from public.folha_resumo_mensal)                       as competencias,
  (select to_char(sum(total), 'FM999G999G990D00')
     from public.folha_resumo_mensal)                                     as total_periodo;
