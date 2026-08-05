select fo.competencia,
       fo.status,
       fo.data_pagamento,
       f.nome as colaborador,
       i.modo,
       i.minutos,
       i.ponto_minutos,
       i.valor_hora,
       i.valor_base
  from public.folhas fo
  join public.folha_itens i on i.folha_id = fo.id
  join public.funcionarios f on f.id = i.funcionario_id
 where fo.competencia = date '2027-06-01'
 order by f.nome;
