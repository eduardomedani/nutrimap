select id, name, public, file_size_limit, allowed_mime_types, created_at
  from storage.buckets
 where id = 'colaborador-documentos';
