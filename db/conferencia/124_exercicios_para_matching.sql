-- ===========================================================================
-- OS EXERCICIOS DO EVOLLO, PARA CRUZAR COM O ACERVO DE GIFS
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- POR QUE ESTE SCRIPT EXISTE. O inventario do acervo esta em CSV no Desktop
-- (612 GIFs, 2,0 GB). O outro lado do cruzamento — a lista de exercicios —
-- mora no banco, e nenhum arquivo do repositorio a contem.
--
-- O RESULTADO E PARA EXPORTAR EM CSV e entregar ao matching. No SQL Editor do
-- Supabase: rodar, depois "Download CSV" no canto do resultado.
--
-- ===========================================================================
-- O QUE VAI JUNTO, E POR QUE CADA COISA
-- ---------------------------------------------------------------------------
--   nome, grupo_muscular, equipamento
--       os tres campos que o matching compara com o nome do arquivo. O acervo
--       traz o grupo embutido no proprio nome do GIF
--       ("Ring-Hip-Bridge-(male)_Hips__converted.gif"), entao `grupo_muscular`
--       serve de desempate quando dois exercicios tem nome parecido.
--
--   tem_video
--       quem ja tem `video_url` nao precisa de GIF. Sao os 25 clipes da amostra
--       (db/exercicios_video_amostra.sql) e o que tiver sido preenchido a mao.
--
--   prescricoes, alunos, ultima_prescricao
--       O QUE DECIDE A PRIMEIRA LEVA. Converter 612 GIFs para atender exercicio
--       que ninguem prescreve e gastar banda no que nao vai ser aberto. A
--       ordem de conversao sai daqui, nao do tamanho do arquivo.
--
--       `prescricoes` conta linhas em treino_exercicios; `alunos` conta
--       pacientes DISTINTOS que receberam o exercicio — os dois separados
--       porque um treino repetido para o mesmo aluno nao e a mesma coisa que
--       dez alunos diferentes fazendo o movimento.
--
--   execucoes
--       quantas vezes o aluno REGISTROU a serie (treino_progressao). E o sinal
--       mais forte que existe: nao e o que foi prescrito, e o que foi feito.
--
-- Rodar no SQL Editor do Supabase e exportar como CSV.
-- ===========================================================================

-- ===========================================================================
-- A ORDEM DOS DOIS SELECTS IMPORTA, e nao e capricho: o SQL Editor do Supabase
-- mostra o resultado do ULTIMO comando executado. Com a lista em primeiro
-- lugar, rodar o arquivo inteiro exibia o resumo e o "Download CSV" baixava
-- seis numeros em vez dos 746 exercicios. O resumo vem antes; a lista, que e o
-- que se exporta, fica por ultimo.
-- ===========================================================================

-- ===========================================================================
-- 1) O resumo, para conferir os numeros.
-- ===========================================================================
select
  (select count(*) from public.exercicios)                                as exercicios,
  (select count(*) from public.exercicios
    where video_url is not null and video_url <> '')                      as ja_com_video,
  (select count(distinct exercicio_id) from public.treino_exercicios)     as ja_prescritos,
  (select count(*) from public.treino_exercicios)                         as prescricoes,
  (select count(distinct grupo_muscular) from public.exercicios
    where coalesce(grupo_muscular, '') <> '')                             as grupos_distintos,
  (select count(distinct equipamento) from public.exercicios
    where coalesce(equipamento, '') <> '')                                as equipamentos_distintos;


-- ===========================================================================
-- 2) A LISTA — e este o resultado que se exporta em "Download CSV".
-- ===========================================================================
select
  e.id,
  e.nome,
  coalesce(e.grupo_muscular, '')                                as grupo_muscular,
  coalesce(e.equipamento, '')                                   as equipamento,
  (e.video_url is not null and e.video_url <> '')               as tem_video,
  count(distinct te.id)                                         as prescricoes,
  count(distinct t.paciente_id)                                 as alunos,
  count(distinct tp.id)                                         as execucoes,
  max(t.criado_em)::date                                        as ultima_prescricao
from public.exercicios e
left join public.treino_exercicios te on te.exercicio_id = e.id
left join public.treinos t             on t.id = te.treino_id
left join public.treino_progressao tp  on tp.treino_exercicio_id = te.id
group by e.id, e.nome, e.grupo_muscular, e.equipamento, e.video_url
order by count(distinct te.id) desc, e.nome;
