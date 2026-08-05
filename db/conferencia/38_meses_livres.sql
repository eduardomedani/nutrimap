select g.mes::date as competencia_livre
  from generate_series(date '2026-01-01', date '2027-06-01', interval '1 month') as g(mes)
 where not exists (select 1 from public.folhas fo where fo.competencia = g.mes::date)
 order by g.mes;
