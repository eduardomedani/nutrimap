select count(*) as arquivos,
       count(distinct (storage.foldername(name))[1]) as contas,
       min(created_at) as primeiro,
       max(created_at) as ultimo
  from storage.objects
 where bucket_id = 'colaborador-documentos';
