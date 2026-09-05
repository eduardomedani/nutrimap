-- ===========================================================================
-- Evollo · TRAZER OS DOCUMENTOS DE VOLTA PARA A ORGANIZACAO
-- ---------------------------------------------------------------------------
-- 100% re-executavel. Rodar de novo depois de corrigido nao muda mais nada.
-- Diagnostico ANTES: db/conferencia/119_documentos_fora_da_organizacao.sql
-- Desfazer: db/documentos_trazer_para_organizacao_desfazer.sql
--
-- O QUE ESTE ARQUIVO CONSERTA. Documento de colaborador gravado antes da Etapa
-- 4C, quando a policy era `nutri_id = auth.uid()` e quem publicava era um
-- membro que nao e o proprietario: a linha ficou com o uuid da PESSOA no lugar
-- do da organizacao. Hoje ela nao aparece na tela para ninguem — e o indice
-- `uniq_cd_atual`, que e da tabela e nao passa por RLS, continua contando com
-- ela. O sintoma e o fechamento da folha falhando com "duplicate key value
-- violates unique constraint uniq_cd_atual" para UMA pessoa, sempre a mesma.
--
-- ===========================================================================
-- AS TRAVAS
-- ---------------------------------------------------------------------------
-- Documento de colaborador e holerite. Este script so move a linha que
-- satisfaz TODAS as condicoes — nao ha uuid escrito a mao:
--
--   1. `nutri_id` NAO e a organizacao        -> so o que esta fora
--   2. o COLABORADOR e da organizacao        -> a prova de que o documento e
--                                               nosso. Sem ela, mover seria
--                                               adivinhar dono de holerite; o
--                                               119 chama esses de "orfaos de
--                                               verdade" e eles ficam como
--                                               estao.
--
-- E UMA SO DECISAO ALEM DE MOVER: se a organizacao JA tem uma versao atual
-- daquela competencia/tipo, a linha que chega entra com `atual = false`. Duas
-- atuais violariam o indice, e entre a que a organizacao ja via e a que estava
-- invisivel, quem continua valendo e a que estava a vista.
--
-- ===========================================================================
-- O QUE ESTE ARQUIVO NAO CONSERTA
-- ---------------------------------------------------------------------------
-- O ARQUIVO NO STORAGE CONTINUA ONDE ESTA. O caminho e
-- `{nutri_id}/{colaborador}/{AAAA-MM}/{tipo}/arquivo`, com o dono ANTIGO na
-- primeira pasta, e a policy `cd_storage_nutri` so abre a pasta da
-- organizacao. Ou seja: a linha volta a ser visivel e gerenciavel, e o arquivo
-- daquela versao antiga nao abre.
--
-- Nao mexo nisso aqui de proposito: renomear objeto do Storage por SQL e
-- operacao do servico de arquivos, nao da tabela — e o proximo fechamento
-- publica a versao nova no caminho certo, que e o documento que o colaborador
-- precisa ver. `metadata.tenancy_corrigida` guarda o dono antigo, entao o
-- arquivo continua localizavel se um dia for preciso.
-- ===========================================================================

do $$
declare
  v_org        uuid;
  r            record;
  v_movidos    int := 0;
  v_rebaixados int := 0;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  if v_org is null then
    raise exception 'nao achei a organizacao do proprietario';
  end if;

  for r in
    select d.id, d.nutri_id, d.colaborador_id, d.competencia, d.tipo_documento, d.atual
      from public.colaborador_documentos d
      join public.funcionarios u on u.id = d.colaborador_id
     where d.nutri_id is distinct from v_org
       and u.nutri_id = v_org
     order by d.competencia, d.versao
  loop
    -- A vaga de "atual" ja esta ocupada por uma linha da organizacao? Entao a
    -- que chega desce para historico.
    if r.atual and exists (
      select 1 from public.colaborador_documentos o2
       where o2.colaborador_id = r.colaborador_id
         and o2.competencia    = r.competencia
         and o2.tipo_documento = r.tipo_documento
         and o2.nutri_id       = v_org
         and o2.atual
         and o2.id <> r.id)
    then
      update public.colaborador_documentos
         set nutri_id = v_org,
             atual    = false,
             metadata = metadata || jsonb_build_object(
               'tenancy_corrigida', now(),
               'nutri_id_anterior', r.nutri_id,
               'rebaixada_por', 'ja_havia_versao_atual_da_organizacao'),
             atualizado_em = now()
       where id = r.id;
      v_rebaixados := v_rebaixados + 1;
    else
      update public.colaborador_documentos
         set nutri_id = v_org,
             metadata = metadata || jsonb_build_object(
               'tenancy_corrigida', now(),
               'nutri_id_anterior', r.nutri_id),
             atualizado_em = now()
       where id = r.id;
      v_movidos := v_movidos + 1;
    end if;
  end loop;

  raise notice 'documentos trazidos para a organizacao: % (dos quais % rebaixados a historico)',
    v_movidos + v_rebaixados, v_rebaixados;
end;
$$;


-- ===========================================================================
-- Conferencia. Esperado: `ainda_por_mover` = 0 e `chaves_com_dois_atuais` = 0.
-- `fora_da_organizacao` so continua > 0 se houver "orfao de verdade" — aquele
-- cujo colaborador tambem nao e da organizacao, que este script nao toca.
-- ===========================================================================
with org as (
  select o.id
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id
)
select
  (select count(*) from public.colaborador_documentos d
    where d.nutri_id is distinct from (select id from org))                     as fora_da_organizacao,
  (select count(*) from public.colaborador_documentos d
     join public.funcionarios u on u.id = d.colaborador_id
    where d.nutri_id is distinct from (select id from org)
      and u.nutri_id = (select id from org))                                    as ainda_por_mover,
  (select count(*) from public.colaborador_documentos
    where metadata ? 'tenancy_corrigida')                                       as corrigidos,
  (select count(*) from (
     select colaborador_id, competencia, tipo_documento
       from public.colaborador_documentos where atual
      group by 1, 2, 3 having count(*) > 1) x)                                  as chaves_com_dois_atuais;
