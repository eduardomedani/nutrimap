-- ===========================================================================
-- 130d · O SEED PISOU EM ALGUM video_url?
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. UMA consulta so — o painel do SQL Editor mostra
-- apenas o resultado da ultima instrucao, e um arquivo por pergunta e a
-- unica forma de nao confundir qual resposta e de quem.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 4) O SEED PISOU EM ALGUM video_url?
-- ---------------------------------------------------------------------------
-- Nao deveria: os conjuntos sao disjuntos (colisao 0, medida em 127b). Se
-- aparecer linha, algum exercicio ganhou animacao nossa E tem link externo, e
-- alguem precisa decidir qual o app mostra.
--
-- ESPERADO: NENHUMA LINHA.
-- ---------------------------------------------------------------------------
select e.nome, e.video_url, count(em.id) as midias_vinculadas
from public.exercicios e
join public.exercicio_midias em on em.exercicio_id = e.id
where e.video_url is not null and e.video_url <> ''
group by e.nome, e.video_url
order by e.nome;
