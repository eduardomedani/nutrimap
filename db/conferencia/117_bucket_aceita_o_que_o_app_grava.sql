-- ===========================================================================
-- O BUCKET ACEITA OS QUATRO TIPOS QUE O APP GRAVA?
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- O 116 perguntava por um tipo so, o da planilha. Este pergunta por todos, e
-- diz nominalmente qual esta faltando — foi assim que `text/html` sumiu sem
-- ninguem notar: a lista foi reescrita a mao para aceitar planilha, e o tipo
-- do contracheque nao entrou na lista nova.
-- ===========================================================================

select
  b.id,
  b.public                                           as bucket_publico,
  b.allowed_mime_types is null                       as aceita_qualquer_tipo,
  coalesce(array_length(b.allowed_mime_types, 1), 0) as quantos_tipos,
  coalesce(
    (select string_agg(exigido.t, E'\n' order by exigido.t)
       from unnest(array[
         'application/pdf',
         'text/html',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.ms-excel'
       ]) as exigido(t)
      where b.allowed_mime_types is not null
        and not (exigido.t = any(b.allowed_mime_types))),
    '(nenhum)'
  )                                                  as faltando,
  array_to_string(b.allowed_mime_types, E'\n')       as lista_completa,
  pg_size_pretty(b.file_size_limit)                  as tamanho_maximo
  from storage.buckets b
 where b.id = 'colaborador-documentos';

-- COMO LER:
--
--   nenhuma linha            o bucket nao existe com esse nome. Confira em
--                            Storage o nome exato.
--   aceita_qualquer_tipo=t   nao ha restricao, e o erro vem de OUTRO lugar.
--   faltando = (nenhum)      a lista esta completa. Se ainda der erro, e cache
--                            do navegador: Ctrl+Shift+R.
--   faltando = <uma lista>   rode db/documentos_mime_do_app_LIMPO.sql e confira
--                            se ele devolveu "UPDATE 1" — se devolver
--                            "UPDATE 0", o SQL Editor nao tem permissao de
--                            escrita em storage.buckets nesta instancia, e o
--                            caminho e o painel: Storage >
--                            colaborador-documentos > Settings >
--                            Allowed MIME types. Nesse caso ACRESCENTE os
--                            tipos que faltam aos que ja estao la; apagar a
--                            lista e digitar so o que falta e exatamente o
--                            que causou este problema.
