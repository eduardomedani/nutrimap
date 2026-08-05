select d.id, d.tipo_documento, d.competencia, d.caminho_storage
  from public.colaborador_documentos d
 where not exists (select 1 from storage.objects o
                    where o.bucket_id = 'colaborador-documentos'
                      and o.name = d.caminho_storage);
