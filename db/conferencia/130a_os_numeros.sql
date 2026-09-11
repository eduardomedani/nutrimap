-- ===========================================================================
-- 130a · OS NUMEROS
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. UMA consulta so — o painel do SQL Editor mostra
-- apenas o resultado da ultima instrucao, e um arquivo por pergunta e a
-- unica forma de nao confundir qual resposta e de quem.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) OS NUMEROS
-- ---------------------------------------------------------------------------
-- Esperado: 68 midias (todas globais), 68 vinculos (todos globais),
-- 49 exercicios distintos, 69,4 MB.
--
-- 49, e nao 54: tres compartilhamentos pendentes ficaram FORA do seed, e dois
-- aprovados ficaram SEM MATCH — 'Elevacao lateral sentado na polia' (so ha
-- lateral medial EM PE no acervo) e 'Mergulho na maquina' (falta saber qual
-- maquina o cadastro representa).
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.midias)                                  as midias,
  (select count(*) from public.midias where nutri_id is null)           as midias_globais,
  (select count(*) from public.exercicio_midias)                        as vinculos,
  (select count(*) from public.exercicio_midias where nutri_id is null) as vinculos_globais,
  (select count(distinct exercicio_id) from public.exercicio_midias)    as exercicios_distintos,
  (select round(sum(bytes) / 1048576.0, 1) from public.midias)          as mb;
