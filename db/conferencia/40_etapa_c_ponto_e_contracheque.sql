select f.nome as colaborador,
       max(case when d.tipo_documento = 'folha_ponto' then d.mime_type end) as ponto_mime,
       max(case when d.tipo_documento = 'folha_ponto' then d.origem end) as ponto_origem,
       max(case when d.tipo_documento = 'folha_ponto' then d.versao end) as ponto_versao,
       max(case when d.tipo_documento = 'contracheque' then d.mime_type end) as contracheque_mime,
       max(case when d.tipo_documento = 'contracheque' then d.origem end) as contracheque_origem,
       max(case when d.tipo_documento = 'contracheque' then d.versao end) as contracheque_versao,
       count(*) filter (where d.atual and d.status = 'disponivel') as atuais_disponiveis
  from public.colaborador_documentos d
  join public.funcionarios f on f.id = d.colaborador_id
 where d.competencia = date '2027-06-01'
 group by f.nome
 order by f.nome;
