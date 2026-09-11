-- ===========================================================================
-- 130 · O SEED BATE COM A CURADORIA E COM O STORAGE?
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. Rodar DEPOIS do seed e DEPOIS do upload.
--
-- Sao cinco perguntas independentes. No SQL Editor, o painel mostra so o
-- resultado da ULTIMA quando o arquivo roda inteiro — entao rode um bloco por
-- vez, ou aceite ver apenas a quinta.
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


-- ---------------------------------------------------------------------------
-- 2) TODA MIDIA TEM ARQUIVO? TODO ARQUIVO TEM MIDIA?
-- ---------------------------------------------------------------------------
-- As duas metades da mesma pergunta, e as duas doem de jeitos diferentes:
--
--   midia sem arquivo  -> o app mostra o exercicio e o video nao toca;
--   arquivo sem midia  -> ninguem consegue ver (a policy do bucket delega a
--                         `midias`), e o arquivo ocupa espaco sem servir.
--
-- ESPERADO: NENHUMA LINHA. Antes do upload, o lado "sem arquivo" vai listar as
-- 68 — o que e correto, e some quando os MP4 subirem.
--
-- O lado "arquivo sem midia" tem que dar ZERO SEMPRE, inclusive depois do
-- upload: ha 8 MP4 em disco FORA do seed, e nenhum deles pode subir.
-- ---------------------------------------------------------------------------
select 'midia sem arquivo' as problema, m.chave as ref, m.caminho
  from public.midias m
 where m.bucket = 'exercicio-midias'
   and not exists (select 1 from storage.objects o
                    where o.bucket_id = m.bucket and o.name = m.caminho)
union all
select 'arquivo sem midia', o.name, o.name
  from storage.objects o
 where o.bucket_id = 'exercicio-midias'
   and not exists (select 1 from public.midias m
                    where m.bucket = o.bucket_id and m.caminho = o.name)
order by 1, 2;


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
