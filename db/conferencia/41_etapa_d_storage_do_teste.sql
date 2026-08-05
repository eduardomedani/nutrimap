select o.name,
       o.bucket_id,
       (o.metadata->>'size')::bigint as tamanho_bytes,
       o.metadata->>'mimetype' as mime_type,
       array_length(storage.foldername(o.name), 1) as niveis,
       (storage.foldername(o.name))[3] as pasta_competencia,
       (storage.foldername(o.name))[4] as pasta_tipo,
       o.created_at,
       o.updated_at
  from storage.objects o
 where o.bucket_id = 'colaborador-documentos'
   and o.name in (select d.caminho_storage from public.colaborador_documentos d
                   where d.competencia = date '2027-06-01')
 order by o.created_at;
