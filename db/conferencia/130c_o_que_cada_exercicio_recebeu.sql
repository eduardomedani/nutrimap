-- ===========================================================================
-- 130c · ALGUM VINCULO APONTA PARA O EXERCICIO ERRADO?
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. UMA consulta so — o painel do SQL Editor mostra
-- apenas o resultado da ultima instrucao, e um arquivo por pergunta e a
-- unica forma de nao confundir qual resposta e de quem.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 3) ALGUM VINCULO APONTA PARA O EXERCICIO ERRADO?
-- ---------------------------------------------------------------------------
-- A conferencia que importa depois de tudo: o nome do exercicio ao lado do
-- arquivo que ele recebeu. Nao ha regra automatica que pegue "Leg press com o
-- video de agachamento" — isso se le com o olho.
--
-- 68 linhas. Vale a leitura uma vez — foi ela que pegou os quatro vinculos
-- errados que nenhuma guarda automatica viu.
-- ---------------------------------------------------------------------------
select e.nome                                as exercicio,
       e.grupo_muscular,
       m.genero,
       em.papel,
       m.caminho                             as mp4,
       m.origem_pasta
from public.exercicio_midias em
join public.exercicios e on e.id = em.exercicio_id
join public.midias m     on m.id = em.midia_id
order by e.nome, em.ordem, m.genero;
