-- ===========================================================================
-- 130e · A COBERTURA, DEPOIS DE TUDO
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. UMA consulta so — o painel do SQL Editor mostra
-- apenas o resultado da ultima instrucao, e um arquivo por pergunta e a
-- unica forma de nao confundir qual resposta e de quem.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 5) A COBERTURA, DEPOIS DE TUDO
-- ---------------------------------------------------------------------------
-- Esperado: 70 prescritos, 14 com video_url, 49 com animacao, 7 sem nada.
--
-- Os 7: os 2 sem match desde a curadoria (Elevacoes parciais e Rosca Scott no
-- banco inclinado), os 3 parceiros dos compartilhamentos pendentes, e os 2 que
-- a revisao do 130c derrubou (Elevacao lateral sentado na polia e Mergulho na
-- maquina). Nenhum e falha de busca — todos sao decisao registrada.
-- ---------------------------------------------------------------------------
select count(distinct te.exercicio_id)                                as prescritos,
       count(distinct te.exercicio_id) filter
         (where e.video_url is not null and e.video_url <> '')         as com_video_url,
       count(distinct te.exercicio_id) filter
         (where exists (select 1 from public.exercicio_midias em
                         where em.exercicio_id = e.id))                as com_animacao,
       count(distinct te.exercicio_id) filter
         (where (e.video_url is null or e.video_url = '')
            and not exists (select 1 from public.exercicio_midias em
                             where em.exercicio_id = e.id))            as sem_nada
from public.treino_exercicios te
join public.exercicios e on e.id = te.exercicio_id;
