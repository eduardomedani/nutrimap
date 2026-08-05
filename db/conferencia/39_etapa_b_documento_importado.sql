select d.id as documento_id,
       d.colaborador_id,
       f.nome as colaborador,
       d.competencia,
       d.tipo_documento,
       d.mime_type,
       d.caminho_storage,
       d.status,
       d.versao,
       d.atual,
       d.origem,
       d.tamanho_bytes,
       d.criado_em,
       d.disponibilizado_em,
       d.visualizado_pelo_colaborador
  from public.colaborador_documentos d
  join public.funcionarios f on f.id = d.colaborador_id
 where d.competencia = date '2027-06-01'
 order by d.tipo_documento, d.versao desc;
