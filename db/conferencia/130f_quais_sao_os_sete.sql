-- ===========================================================================
-- 130f · QUAIS SAO OS PRESCRITOS QUE FICARAM SEM NADA
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. UMA consulta so.
--
-- POR QUE ELE EXISTE. O 130e conta 7. Contagem nao e identidade: sete podem
-- ser OUTROS sete, e o total continuaria batendo. Esta consulta nomeia cada um,
-- para que a conferencia seja "sao exatamente estes" e nao "sao sete".
--
-- ESPERADO — exatamente estes sete, e nenhum a mais:
--
--   sem match desde a curadoria (nao ha candidato defensavel no acervo)
--     Elevacoes parciais (power partials)
--     Rosca Scott no banco inclinado
--
--   parceiros de compartilhamento pendentes de decisao
--     Desenvolvimento na maquina articulada
--     Supino na maquina articulada
--     Rosca inclinada com halteres
--
--   derrubados pela revisao humana do 130c
--     Elevacao lateral sentado na polia   (so ha lateral medial EM PE)
--     Mergulho na maquina                 (falta saber qual maquina)
--
-- Um oitavo nome aqui significa que algum vinculo se perdeu entre o seed e o
-- banco — e ai o problema nao e a lista, e o processo.
-- ===========================================================================
select e.nome,
       e.grupo_muscular,
       e.equipamento,
       count(*)                        as linhas_de_prescricao,
       count(distinct t.paciente_id)   as alunos
from public.treino_exercicios te
join public.exercicios e on e.id = te.exercicio_id
join public.treinos t    on t.id = te.treino_id
where (e.video_url is null or e.video_url = '')
  and not exists (select 1 from public.exercicio_midias em
                   where em.exercicio_id = e.id)
group by e.nome, e.grupo_muscular, e.equipamento
order by count(*) desc, e.nome;
