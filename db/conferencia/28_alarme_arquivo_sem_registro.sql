select o.name, o.created_at
  from storage.objects o
 where o.bucket_id = 'colaborador-documentos'
   and (storage.foldername(o.name))[2] <> '_pendentes'
   and not exists (select 1 from public.colaborador_documentos d
                    where d.caminho_storage = o.name)
 order by o.created_at desc;
