-- ===========================================================================
-- Evollo · O BUCKET PRECISA ACEITAR TUDO QUE O APP GRAVA
-- ---------------------------------------------------------------------------
-- 100% re-executavel. Desfazer: nao tem, e e de proposito — ver o fim.
--
-- O QUE ACONTECEU. Ao fechar a folha, os contracheques nao publicaram:
--
--   Nao publiquei 6: <nome do colaborador>: mime type text/html is not supported
--
-- O contracheque e um HTML autossuficiente (js/contracheque-arquivo.js), e
-- `text/html` estava na lista do bucket desde db/documentos_limites_bucket.sql.
-- Ele saiu de la depois: quando as planilhas do bonus deram o mesmo erro, a
-- lista foi reescrita a mao — pelo painel ou por um update que a substituiu —
-- e o tipo do contracheque nao entrou na lista nova. O erro so apareceu agora
-- porque publicar contracheque so acontece no fechamento da folha.
--
-- ===========================================================================
-- POR QUE ESTE ARQUIVO ACRESCENTA, E POR QUE ELE LISTA OS QUATRO TIPOS
-- ---------------------------------------------------------------------------
-- Acrescenta, e nao substitui, pela mesma razao de db/folha_arquivos_mime.sql:
-- sobrescrever apagaria em silencio um tipo que este arquivo nao conhece.
--
-- E lista os QUATRO tipos que o app grava neste bucket, nao so o que faltou
-- hoje. Uma migration por tipo que quebrou reproduz o problema: cada uma
-- conserta o formato da vez e deixa os outros a merce da proxima edicao manual
-- da lista. Aqui a lista canonica do app fica escrita num lugar so, e rodar
-- este arquivo de novo — depois de qualquer mexida no painel — devolve o
-- bucket ao estado em que o sistema inteiro funciona.
--
-- A lista espelha o codigo:
--   . application/pdf  e  text/html  -> MIMES_ACEITOS em js/documentos.js
--   . os dois de planilha            -> importacao do bonus por presenca
-- Ao aceitar um formato novo no JavaScript, acrescente-o aqui no mesmo commit.
--
-- `null` em `allowed_mime_types` significa "aceita tudo". Nesse caso NAO se
-- monta lista nenhuma: transformar "tudo" numa lista de quatro itens seria
-- apertar a regra sem ninguem ter pedido.
-- ===========================================================================

update storage.buckets
   set allowed_mime_types = (
     select array(
       select distinct t
         from unnest(
           allowed_mime_types || array[
             -- espelho de ponto e documentos enviados a mao
             'application/pdf',
             -- o contracheque publicado no fechamento da folha
             'text/html',
             -- .xlsx moderno, que e o que os dois relatorios exportam
             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             -- .xls antigo. Alguns geradores ainda marcam o xlsx assim, e o
             -- navegador repassa o que o gerador disser.
             'application/vnd.ms-excel'
           ]
         ) as t
        order by t
     )
   )
 where id = 'colaborador-documentos'
   and allowed_mime_types is not null;


-- ===========================================================================
-- SEM DESFAZER, DE PROPOSITO
-- ---------------------------------------------------------------------------
-- Tirar qualquer um destes quatro tipos quebra um fluxo que esta no ar hoje.
-- Um rollback pronto seria um botao para reproduzir o erro que este arquivo
-- conserta. Se um formato deixar de ser usado, o commit que o tirar do
-- JavaScript tira daqui tambem.
-- ===========================================================================


-- ===========================================================================
-- Conferencia. Esperado: falta_algum = false
-- ===========================================================================
select
  id,
  allowed_mime_types is null                       as aceita_qualquer_coisa,
  exists (
    select 1
      from unnest(array[
        'application/pdf',
        'text/html',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
      ]) as exigido
     where allowed_mime_types is not null
       and not (exigido = any(allowed_mime_types))
  )                                                as falta_algum,
  coalesce(array_length(allowed_mime_types, 1), 0) as tipos_na_lista,
  array_to_string(allowed_mime_types, ', ')        as lista
  from storage.buckets
 where id = 'colaborador-documentos';
