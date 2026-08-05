update storage.buckets
   set file_size_limit = null,
       allowed_mime_types = null
 where id = 'colaborador-documentos';

select id, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id = 'colaborador-documentos';
