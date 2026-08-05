select f.nome, d.tipo_documento, count(*) as documentos,
       count(*) filter (where d.atual) as versoes_atuais,
       max(d.competencia) as competencia_mais_recente
  from public.colaborador_documentos d
  join public.funcionarios f on f.id = d.colaborador_id
 group by f.nome, d.tipo_documento
 order by f.nome, d.tipo_documento;
