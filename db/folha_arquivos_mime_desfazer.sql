-- ===========================================================================
-- DESFAZER · db/folha_arquivos_mime.sql
-- ---------------------------------------------------------------------------
-- Tira os dois tipos de planilha da lista do bucket.
--
-- TIRE O FRONTEND PRIMEIRO, ou a zona de arraste das planilhas do bonus volta
-- a dar "mime type ... is not supported" — que foi o erro que originou a
-- migracao.
--
-- Os arquivos JA ENVIADOS continuam la e continuam baixaveis:
-- `allowed_mime_types` vale no upload, nao na leitura.
-- ===========================================================================

update storage.buckets
   set allowed_mime_types = (
     select array(
       select t from unnest(allowed_mime_types) as t
        where t not in (
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel'
        )
        order by t
     )
   )
 where id = 'colaborador-documentos'
   and allowed_mime_types is not null;

select array_to_string(allowed_mime_types, ', ') as lista
  from storage.buckets where id = 'colaborador-documentos';
