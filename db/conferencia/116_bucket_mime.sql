-- ===========================================================================
-- O BUCKET ACEITA PLANILHA?
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- Rode isto quando a importacao das planilhas do bonus responder
-- "mime type ... is not supported" mesmo depois de db/folha_arquivos_mime.sql.
-- Ele diz em qual dos tres casos voce esta.
-- ===========================================================================

select
  id,
  public                                        as bucket_publico,
  allowed_mime_types is null                    as aceita_qualquer_tipo,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    = any(coalesce(allowed_mime_types, array[]::text[]))  as aceita_xlsx,
  coalesce(array_length(allowed_mime_types, 1), 0)        as quantos_tipos,
  array_to_string(allowed_mime_types, E'\n')              as lista_completa,
  pg_size_pretty(file_size_limit)               as tamanho_maximo
  from storage.buckets
 where id = 'colaborador-documentos';

-- COMO LER:
--
--   nenhuma linha            o bucket nao existe com esse nome. Confira em
--                            Storage o nome exato.
--   aceita_qualquer_tipo=t   nao ha restricao, e o erro vem de OUTRO lugar.
--   aceita_xlsx = t          a lista ja tem o tipo. Se ainda der erro, e cache
--                            do navegador: Ctrl+Shift+R.
--   aceita_xlsx = f          o update nao pegou. Rode de novo o
--                            db/folha_arquivos_mime_LIMPO.sql e confira se ele
--                            devolveu "UPDATE 1" — se devolver "UPDATE 0", o
--                            SQL Editor nao tem permissao de escrita em
--                            storage.buckets nesta instancia, e o caminho e o
--                            painel: Storage > colaborador-documentos >
--                            Settings > Allowed MIME types.
