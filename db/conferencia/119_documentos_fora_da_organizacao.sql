-- ===========================================================================
-- DOCUMENTO DO COLABORADOR — O QUE FICOU FORA DA ORGANIZACAO
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- POR QUE ESTE SCRIPT EXISTE. O fechamento da folha falha, para UMA pessoa,
-- com:
--
--   duplicate key value violates unique constraint "uniq_cd_atual"
--
-- e continua falhando depois de a ordem de troca de versao ser corrigida no
-- frontend. Isso so acontece por um motivo: a versao atual daquele documento
-- EXISTE na tabela e NAO E VISIVEL para quem esta publicando.
--
--   . `uniq_cd_atual (colaborador_id, competencia, tipo_documento) where atual`
--     e um indice da TABELA: enxerga toda linha, de todo dono.
--   . o SELECT que o app faz antes de publicar passa pela RLS, que desde a
--     Etapa 4C e `nutri_id = organizacao_do_auth()`.
--
-- Um documento publicado ANTES da 4C por um membro que nao e o proprietario
-- ficou com `nutri_id` = uuid da PESSOA (a policy de entao era
-- `nutri_id = auth.uid()`). Hoje ele nao aparece na tela para ninguem — e
-- continua ocupando a vaga de "versao atual" daquela competencia.
--
-- E o mesmo defeito das folhas fantasma (db/conferencia/111 e
-- db/folha_apagar_fantasmas.sql), na tabela de documentos. La a consequencia
-- era uma folha duplicada e invisivel; aqui e um fechamento que nao completa.
--
-- ===========================================================================
-- COMO LER
-- ---------------------------------------------------------------------------
--   DOCUMENTOS FORA DA ORGANIZACAO
--       zero = a causa e outra (veja ORFAOS DE VERDADE abaixo). Qualquer
--       numero > 0 e o estrago, e db/documentos_trazer_para_organizacao.sql
--       corrige.
--
--   BLOQUEANDO PUBLICACAO
--       o subconjunto que importa hoje: os que estao `atual` e cuja
--       competencia/colaborador/tipo NAO tem nenhuma linha da organizacao.
--       Cada um destes e um fechamento que vai falhar.
--
--   ORFAOS DE VERDADE
--       documento cujo colaborador tambem nao e da organizacao. Este script
--       NAO propoe correcao automatica para eles: sem saber de quem e o
--       colaborador, mover o documento seria adivinhar dono de holerite.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

do $$
declare
  v_org uuid;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;
  raise notice 'organizacao: %', v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) O retrato, linha a linha
-- ---------------------------------------------------------------------------
with org as (
  select o.id
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id
)
select
  u.nome                                       as colaborador,
  d.competencia,
  d.tipo_documento,
  d.versao,
  d.atual,
  d.status,
  d.nutri_id                                   as dono_gravado,
  (d.nutri_id = (select id from org))          as e_da_organizacao,
  (u.nutri_id = (select id from org))          as colaborador_e_da_organizacao,
  exists (
    select 1 from public.colaborador_documentos o2
     where o2.colaborador_id = d.colaborador_id
       and o2.competencia    = d.competencia
       and o2.tipo_documento = d.tipo_documento
       and o2.nutri_id       = (select id from org))
                                               as ja_ha_versao_da_organizacao,
  case
    when d.nutri_id = (select id from org) then 'ok'
    when u.nutri_id is distinct from (select id from org) then 'ORFAO DE VERDADE'
    when d.atual then 'BLOQUEANDO PUBLICACAO'
    else 'fora da organizacao, mas nao bloqueia'
  end                                          as resultado,
  d.caminho_storage
from public.colaborador_documentos d
left join public.funcionarios u on u.id = d.colaborador_id
where d.nutri_id is distinct from (select id from org)
order by d.competencia desc, u.nome;

-- ---------------------------------------------------------------------------
-- 2) O resumo. Esperado depois da correcao: fora_da_organizacao = 0.
-- ---------------------------------------------------------------------------
with org as (
  select o.id
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id
)
select
  (select count(*) from public.colaborador_documentos)                          as documentos,
  (select count(*) from public.colaborador_documentos d
    where d.nutri_id is distinct from (select id from org))                     as fora_da_organizacao,
  (select count(*) from public.colaborador_documentos d
    where d.nutri_id is distinct from (select id from org) and d.atual)         as fora_e_atual,
  (select count(*) from public.colaborador_documentos d
     join public.funcionarios u on u.id = d.colaborador_id
    where d.nutri_id is distinct from (select id from org)
      and u.nutri_id is distinct from (select id from org))                     as orfaos_de_verdade,
  (select count(*) from (
     select colaborador_id, competencia, tipo_documento
       from public.colaborador_documentos where atual
      group by 1, 2, 3 having count(*) > 1) x)                                  as chaves_com_dois_atuais;
