-- ===========================================================================
-- O MAPA id → nome DOS EXERCICIOS, PARA VINCULAR AS MIDIAS
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. Nenhuma tabela e criada, nenhum `video_url` e tocado.
--
-- POR QUE ELE EXISTE. A curadoria da primeira leva casou 54 exercicios com 65
-- MP4, e o vinculo final precisa do UUID de cada exercicio. Transcrever 54
-- identificadores de uma mensagem de chat seria o pior lugar possivel para um
-- erro de digitacao: um UUID errado nao falha — ele aponta para OUTRO
-- exercicio, e o aluno recebe a animacao de um movimento que nao e o dele.
--
-- Entao o mapa sai daqui, do banco, e o cruzamento e feito por nome
-- NORMALIZADO, com as guardas da secao 2.
--
-- ===========================================================================
-- A NORMALIZACAO, E POR QUE ELA E ESTREITA
-- ---------------------------------------------------------------------------
-- `lower(unaccent(trim(...)))` e o suficiente: a curadoria copiou os nomes do
-- proprio CSV exportado deste banco, entao eles batem caractere a caractere,
-- e a normalizacao existe so para absorver espaco extra e diferenca de caixa.
--
-- NAO se faz aproximacao por similaridade aqui. Casar "Supino na maquina" com
-- "Supino na maquina articulada" por parecenca seria exatamente o erro que
-- este arquivo existe para impedir — e os dois SAO exercicios diferentes no
-- cadastro.
--
-- `unaccent` pode nao estar instalado. A secao 1 usa `translate`, que faz o
-- mesmo para as letras acentuadas do portugues e nao depende de extensao.
--
-- Rodar no SQL Editor do Supabase e exportar o resultado em CSV.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) AS GUARDAS — precisam passar ANTES de qualquer vinculo
-- ---------------------------------------------------------------------------
-- nomes_duplicados > 0 aborta o processo: com dois exercicios de mesmo nome
-- normalizado, o join por nome nao tem como escolher, e escolher errado e pior
-- que nao escolher.
-- ---------------------------------------------------------------------------
with normalizados as (
  select
    e.id,
    e.nome,
    lower(trim(translate(e.nome,
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
      'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'))) as chave
  from public.exercicios e
)
select
  (select count(*) from public.exercicios)                       as exercicios_no_banco,
  (select count(*) from (
     select chave from normalizados group by chave having count(*) > 1) d)
                                                                 as nomes_duplicados,
  (select count(distinct chave) from normalizados)               as chaves_distintas;


-- ---------------------------------------------------------------------------
-- 2) OS NOMES QUE SE REPETEM, se houver
-- ---------------------------------------------------------------------------
-- Se a consulta acima acusar duplicados, sao estes. Cada um precisa de decisao
-- humana antes de seguir: qual dos dois recebe a midia, ou se o catalogo deve
-- fundir os dois registros.
-- ---------------------------------------------------------------------------
with normalizados as (
  select
    e.id, e.nome, e.grupo_muscular, e.equipamento,
    lower(trim(translate(e.nome,
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
      'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'))) as chave
  from public.exercicios e
)
select n.chave, count(*) as quantos,
       string_agg(n.id::text || '  ' || n.grupo_muscular || '/' || n.equipamento, E'\n')
         as os_registros
from normalizados n
group by n.chave
having count(*) > 1
order by count(*) desc, n.chave;


-- ---------------------------------------------------------------------------
-- 3) O MAPA — e este o resultado que se exporta em CSV
-- ---------------------------------------------------------------------------
-- Vem com a chave normalizada JUNTO, e nao so o nome: e por ela que o script
-- local faz o join, e te-la aqui deixa o cruzamento conferivel dos dois lados
-- sem ninguem precisar reproduzir a normalizacao de cabeca.
--
-- Traz os 746, e nao so os 54: filtrar aqui obrigaria a repetir a lista da
-- curadoria dentro do SQL, e duas listas da mesma coisa divergem. O recorte e
-- feito no join, do lado que ja tem a curadoria.
-- ---------------------------------------------------------------------------
select
  e.id                                                        as exercicio_id,
  e.nome,
  lower(trim(translate(e.nome,
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')))       as chave_normalizada,
  coalesce(e.grupo_muscular, '')                              as grupo_muscular,
  coalesce(e.equipamento, '')                                 as equipamento,
  (e.video_url is not null and e.video_url <> '')              as ja_tem_video
from public.exercicios e
order by e.nome;
