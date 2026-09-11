-- ===========================================================================
-- Evollo · A CORRECAO QUE A REVISAO HUMANA DO 130c PEDIU
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE. Remove 4 midias e 4 vinculos que o seed ja criou.
--
-- NAO apaga arquivo nenhum: os MP4 continuam em disco, convertidos e
-- validados, e nunca chegaram a subir para o bucket.
--
-- 100% re-executavel.
--
-- ===========================================================================
-- O QUE A LEITURA DAS 70 LINHAS PEGOU
-- ---------------------------------------------------------------------------
-- Nenhum dos quatro foi barrado por guarda automatica. Nome, equipamento,
-- grupo e pasta batiam o suficiente para passar por todas elas. So a leitura
-- humana das 70 linhas do 130c pegou — e e por isso que aquela conferencia
-- existe.
--
--   Elevacao lateral sentado na polia  <- Cable Seated REAR Lateral Raise
--       "rear" e deltoide POSTERIOR; "elevacao lateral" e MEDIAL. Musculo
--       errado. Pior: o exercicio posterior de verdade (Crucifixo invertido na
--       polia, prescrito 3x) ja tinha recebido a sua propria animacao.
--
--   Mergulho na maquina  <- Chest Dip (M e F)
--       O arquivo declara PEITO no proprio nome; o cadastro diz Triceps /
--       Maquina.
--
--   Remada alta na maquina articulada  <- Smith Upright Row
--       Errado duas vezes. Smith nao e maquina articulada; e o cadastro diz
--       grupo COSTAS, enquanto upright row e ombro/trapezio. As outras duas
--       "remada alta" do catalogo confirmam: `na polia` e Trapezio, `com
--       barra` e Ombros. So esta e Costas — ou seja, e HIGH ROW de maquina,
--       nao puxada ao queixo.
--
-- ===========================================================================
-- OS TRES EXERCICIOS FICAM SEM VIDEO, E ISSO E O CERTO
-- ---------------------------------------------------------------------------
-- Video errado e pior que video nenhum: sem video o aluno pergunta ao
-- professor; com o video errado ele treina errado achando que esta certo.
--
-- Dois seguem PENDENTES de uma decisao que nao e minha — qual maquina o
-- cadastro representa, e se o Lever High Row serve. O terceiro (elevacao
-- lateral) e SEM MATCH por decisao: so existe lateral medial EM PE no acervo,
-- e o cadastro especifica sentado.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/exercicio_midias_correcao_130c_LIMPO.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) OS VINCULOS SAEM PRIMEIRO
-- ---------------------------------------------------------------------------
-- `midias` tem `on delete restrict` vindo daqui: apagar a midia antes falharia,
-- que e a protecao funcionando.
-- ---------------------------------------------------------------------------
delete from public.exercicio_midias em
 using public.midias m
 where m.id = em.midia_id
   and m.chave in ('mid_3ab551ae',   -- cable-seated-rear-lateral-raise-shoulders.mp4
                   'mid_f67760c9',   -- chest-dip-chest.mp4
                   'mid_ea38a491',   -- chest-dip-female-chest.mp4
                   'mid_0abd9b3d');  -- smith-upright-row-shoulders.mp4


-- ---------------------------------------------------------------------------
-- 2) DEPOIS AS MIDIAS
-- ---------------------------------------------------------------------------
delete from public.midias
 where chave in ('mid_3ab551ae', 'mid_f67760c9', 'mid_ea38a491', 'mid_0abd9b3d');


-- ---------------------------------------------------------------------------
-- 3) CONFERENCIA
-- ---------------------------------------------------------------------------
-- Esperado: 66 midias, 66 vinculos, 48 exercicios distintos, 66,4 MB.
--
-- 48 e nao 51: os tres corrigidos ficaram sem animacao. E nao 54, porque os
-- tres compartilhamentos pendentes continuam fora desde o seed.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.midias)                                  as midias,
  (select count(*) from public.midias where nutri_id is null)           as midias_globais,
  (select count(*) from public.exercicio_midias)                        as vinculos,
  (select count(distinct exercicio_id) from public.exercicio_midias)    as exercicios_distintos,
  (select round(sum(bytes) / 1048576.0, 1) from public.midias)          as mb,
  (select count(*) from public.midias
    where chave in ('mid_3ab551ae','mid_f67760c9','mid_ea38a491','mid_0abd9b3d')) as sobraram_dos_4;
