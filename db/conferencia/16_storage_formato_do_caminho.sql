select array_length(storage.foldername(name), 1) as niveis,
       case when (storage.foldername(name))[2] = '_pendentes' then 'sala de espera'
            else 'documento de colaborador' end as familia,
       count(*) as arquivos
  from storage.objects
 where bucket_id = 'colaborador-documentos'
 group by 1, 2
 order by 2, 1;
