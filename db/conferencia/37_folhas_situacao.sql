select fo.competencia,
       fo.status,
       fo.data_pagamento,
       count(i.id) as linhas,
       sum(i.valor_base) as soma_valor_base
  from public.folhas fo
  left join public.folha_itens i on i.folha_id = fo.id
 group by fo.competencia, fo.status, fo.data_pagamento
 order by fo.competencia desc;
