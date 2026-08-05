update storage.buckets
   set file_size_limit = 15728640,
       allowed_mime_types = array['application/pdf', 'text/html']
 where id = 'colaborador-documentos';

select id, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id = 'colaborador-documentos';
