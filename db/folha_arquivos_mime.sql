-- ===========================================================================
-- Evollo · O BUCKET PRECISA ACEITAR PLANILHA
-- ---------------------------------------------------------------------------
-- 100% re-executavel. Desfazer: db/folha_arquivos_mime_desfazer.sql
--
-- O QUE ACONTECEU. O bucket `colaborador-documentos` nasceu para PDF de ponto e
-- contracheque, e tem `allowed_mime_types` com essa lista curta. As planilhas
-- do bonus por presenca chegaram depois e bateram na porta:
--
--   mime type application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
--   is not supported
--
-- A restricao esta certa em existir — ela e o que impede alguem de usar o
-- repositorio de documentos como hospedagem de qualquer coisa. O que faltava
-- era ela conhecer o formato novo.
--
-- ===========================================================================
-- POR QUE ACRESCENTAR E NAO SUBSTITUIR
-- ---------------------------------------------------------------------------
-- Escrever a lista inteira aqui significaria adivinhar o que ja esta la. Se o
-- bucket aceitar algum tipo que este arquivo nao conhece — uma imagem de
-- assinatura, um XML de eSocial —, sobrescrever apagaria em silencio, e o erro
-- apareceria semanas depois num upload que sempre funcionou.
--
-- `null` em `allowed_mime_types` significa "aceita tudo". Nesse caso NAO se
-- monta lista nenhuma: transformar "tudo" numa lista de tres itens seria
-- apertar a regra sem ninguem ter pedido.
-- ===========================================================================

update storage.buckets
   set allowed_mime_types = (
     select array(
       select distinct t
         from unnest(
           allowed_mime_types || array[
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
-- Conferencia. Esperado: aceita_xlsx = true
-- ===========================================================================
select
  id,
  allowed_mime_types is null as aceita_qualquer_coisa,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    = any(coalesce(allowed_mime_types, array['*'])) as aceita_xlsx,
  coalesce(array_length(allowed_mime_types, 1), 0)  as tipos_na_lista,
  array_to_string(allowed_mime_types, ', ')         as lista
  from storage.buckets
 where id = 'colaborador-documentos';
