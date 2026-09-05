-- ===========================================================================
-- DESFAZER · db/documentos_trazer_para_organizacao.sql
-- ---------------------------------------------------------------------------
-- Devolve cada documento ao dono que tinha antes, lido de
-- `metadata.nutri_id_anterior` — nao ha uuid escrito a mao aqui tambem.
--
-- O `atual` das linhas rebaixadas NAO volta a true: religa-lo criaria duas
-- versoes atuais da mesma competencia e o indice `uniq_cd_atual` recusaria o
-- update. Quem foi rebaixado continua no historico, que e onde ele ja estava
-- na pratica — invisivel para a organizacao.
--
-- Depois disto o fechamento da folha volta a falhar com "duplicate key value
-- violates unique constraint uniq_cd_atual" para a mesma pessoa, que era
-- exatamente o estado anterior.
-- ===========================================================================

update public.colaborador_documentos
   set nutri_id = (metadata ->> 'nutri_id_anterior')::uuid,
       metadata = metadata - 'tenancy_corrigida' - 'nutri_id_anterior' - 'rebaixada_por',
       atualizado_em = now()
 where metadata ? 'nutri_id_anterior';

select
  (select count(*) from public.colaborador_documentos
    where metadata ? 'tenancy_corrigida') as ainda_marcados;
