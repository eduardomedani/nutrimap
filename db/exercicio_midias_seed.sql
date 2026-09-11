-- ===========================================================================
-- Evollo · SEED DO ACERVO — 68 midias globais, 68 vinculos
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE. Desfazer: db/exercicio_midias_seed_desfazer.sql
-- Conferencia: db/conferencia/130_seed_confere.sql
--
-- 100% RE-EXECUTAVEL. `on conflict` em `chave` e em `(exercicio_id,
-- midia_id)`: rodar duas vezes atualiza, nao duplica.
--
-- ===========================================================================
-- ARQUIVO GERADO. NAO EDITAR A MAO.
-- ---------------------------------------------------------------------------
-- Fonte: Desktop/vinculo-primeira-leva.csv + os dois manifestos de conversao.
-- Gerador: scratchpad/gerar-seed.mjs
--
-- Sao 68 vinculos com 68 UUID de exercicio. Datilografar isso a mao
-- reintroduziria, no ultimo passo, o risco que o gate 126 existiu para
-- eliminar: um caractere trocado num UUID nao falha em lugar nenhum — aponta
-- para OUTRO exercicio, e o aluno recebe a animacao de um movimento que nao e
-- o dele.
--
-- Os UUID abaixo foram conferidos contra o banco no gate 126 (54/54, duas
-- consultas isoladas, zero divergencias).
--
-- ===========================================================================
-- O QUE ESTE SEED NAO FAZ
-- ---------------------------------------------------------------------------
-- NAO sobe arquivo. Ele registra que o MP4 <caminho> vive no bucket
-- 'exercicio-midias'. Se o arquivo nao estiver la, a linha existe e o video
-- nao toca — por isso a conferencia 130 compara as duas listas.
--
-- NAO toca em `video_url`. As 40 URLs externas continuam funcionando como
-- hoje; os conjuntos sao disjuntos (colisao 0, medida em 127b).
--
-- NAO inclui os TRES compartilhamentos pendentes de decisao:
--     Desenvolvimento na máquina articulada  ->  smith-shoulder-press-shoulder.mp4
--     Rosca inclinada com halteres  ->  dumbbell-incline-curl-upper-arms-fix.mp4
--     Supino na máquina articulada  ->  lever-chest-press-chest-fix.mp4
-- Um seed que ja deixa pronto "para caso aprove" e uma decisao tomada. Eles
-- entram por um segundo seed, se e quando forem aprovados.
--
-- ===========================================================================
-- POR QUE nutri_id = NULL EM TUDO
-- ---------------------------------------------------------------------------
-- Decisao do Eduardo: o acervo e catalogo global do produto, e o mesmo MP4 nao
-- se duplica por organizacao. O vinculo tambem e global — assim outra
-- organizacao cria o SEU exercicio e aponta para a MESMA midia.
--
-- Isto so pode rodar como `service_role`. A policy `midias_insert` exige
-- `nutri_id = auth.uid()`, e auth.uid() nunca e NULL numa sessao autenticada:
-- pelo app, ninguem cria linha global. Provado em 128, prova 7.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/exercicio_midias_seed_LIMPO.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) AS MIDIAS — 68 arquivos, 69.4 MB
-- ---------------------------------------------------------------------------
insert into public.midias
  (nutri_id, chave, tipo, bucket, caminho, genero,
   origem_arquivo, origem_pasta, largura, altura, duracao_s, frames, bytes)
select null, v.chave, 'animacao', v.bucket, v.caminho, v.genero,
       v.origem_arquivo, v.origem_pasta, v.largura, v.altura, v.duracao_s, v.frames, v.bytes
from (values
  ('mid_829fdba5', 'exercicio-midias', 'barbell-bent-over-row-back.mp4', 'masculino',
   'Barbell-Bent-Over-Row_Back__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS COM BARRAS/COSTAS',
   1920, 1080, 5.80, 58, 1278930),
  ('mid_588fcaf8', 'exercicio-midias', 'barbell-bent-over-row-female-back.mp4', 'feminino',
   'Barbell-Bent-Over-Row-(female)_Back_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS COM BARRAS/COSTAS',
   1920, 1080, 6.60, 66, 990804),
  ('mid_d319d6aa', 'exercicio-midias', 'barbell-preacher-curl-female-upper-arms.mp4', 'feminino',
   'Barbell-Preacher-Curl-(female)_Upper-Arms__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS COM BARRAS/BICEPS',
   1920, 1080, 5.20, 52, 731323),
  ('mid_d0c5574d', 'exercicio-midias', 'barbell-preacher-curl-upper-arms.mp4', 'masculino',
   'Barbell-Preacher-Curl_Upper-Arms_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS COM BARRAS/BICEPS',
   1920, 1080, 6.50, 65, 1750681),
  ('mid_55eaba0d', 'exercicio-midias', 'barbell-romanian-deadlift-female-hips.mp4', 'feminino',
   'Barbell-Romanian-Deadlift-(female)_Hips_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS COM BARRAS/PERNA',
   1920, 1080, 6.60, 66, 2082337),
  ('mid_d7384f60', 'exercicio-midias', 'barbell-romanian-deadlift-hips-fix.mp4', 'masculino',
   'Barbell-Romanian-Deadlift_Hips-FIX__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS COM BARRAS/PERNA',
   1920, 1080, 6.00, 60, 1757426),
  ('mid_a1fc0f86', 'exercicio-midias', 'cable-45-degrees-reverse-fly-male-shoulders.mp4', 'masculino',
   'Cable-45-degrees-Reverse-Fly-(male)_Shoulders__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NO CABO  OU POLIA/COSTAS',
   1920, 1080, 6.00, 60, 776405),
  ('mid_d0916d3f', 'exercicio-midias', 'cable-close-grip-front-lat-pulldown-back.mp4', 'masculino',
   'Cable-Close-Grip-Front-Lat-Pulldown_Back_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NO CABO  OU POLIA/COSTAS',
   1920, 1080, 6.60, 66, 1389482),
  ('mid_41fc79b7', 'exercicio-midias', 'cable-close-grip-front-lat-pulldown-female-back.mp4', 'feminino',
   'Cable-Close-Grip-Front-Lat-Pulldown-(female)_Back_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS NO CABO OU POLIA/COSTAS',
   1920, 1080, 5.90, 59, 882929),
  ('mid_2fef5280', 'exercicio-midias', 'cable-front-raise-female-shoulders.mp4', 'feminino',
   'Cable-Front-Raise-(female)_Shoulders_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS NO CABO OU POLIA/OMBRO',
   1920, 1080, 6.60, 66, 956848),
  ('mid_4b589063', 'exercicio-midias', 'cable-front-raise-shoulders-fix.mp4', 'masculino',
   'Cable-Front-Raise_Shoulders-FIX__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NO CABO  OU POLIA/OMBRO',
   1920, 1080, 6.00, 60, 929494),
  ('mid_67f49c80', 'exercicio-midias', 'cable-high-pulley-overhead-tricep-extension-female-upper-arms.mp4', 'feminino',
   'Cable-High-Pulley-Overhead-Tricep-Extension-(female)_Upper-Arms_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS NO CABO OU POLIA/TRICEPS',
   1920, 1080, 6.60, 66, 861892),
  ('mid_dc001230', 'exercicio-midias', 'cable-high-pulley-overhead-tricep-extension-upper-arms.mp4', 'masculino',
   'Cable-High-Pulley-Overhead-Tricep-Extension_Upper-Arms_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NO CABO  OU POLIA/TRICEPS',
   1920, 1080, 6.60, 66, 911702),
  ('mid_6b240d6b', 'exercicio-midias', 'cable-low-fly-chest-fix2.mp4', 'masculino',
   'Cable-Low-Fly_Chest-FIX2__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NO CABO  OU POLIA/PEITO',
   1920, 1080, 6.00, 60, 946847),
  ('mid_e8aac923', 'exercicio-midias', 'cable-low-fly-female-chest.mp4', 'feminino',
   'Cable-Low-Fly-(female)_Chest__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS NO CABO OU POLIA/OMBRO',
   1920, 1080, 5.20, 52, 854940),
  ('mid_5fa9b211', 'exercicio-midias', 'cable-one-arm-curl-female-upper-arms.mp4', 'feminino',
   'Cable-One-Arm-Curl-(female)_Upper-Arms_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS NO CABO OU POLIA/BICEPS',
   1920, 1080, 6.60, 66, 640737),
  ('mid_e2326bdb', 'exercicio-midias', 'cable-one-arm-curl-upper-arms.mp4', 'masculino',
   'Cable-One-Arm-Curl_Upper-Arms_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NO CABO  OU POLIA/BICEPS',
   1920, 1080, 6.60, 66, 1055027),
  ('mid_9c8b94b6', 'exercicio-midias', 'cable-one-arm-pulldown-back.mp4', 'masculino',
   'Cable-One-Arm-Pulldown_Back__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NO CABO  OU POLIA/COSTAS',
   1920, 1080, 6.00, 60, 692545),
  ('mid_54d177e6', 'exercicio-midias', 'cable-one-arm-tricep-pushdown-female-upper-arms.mp4', 'feminino',
   'Cable-One-Arm-Tricep-Pushdown-(female)_Upper-Arms__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS NO CABO OU POLIA/TRICEPS',
   1920, 1080, 6.00, 60, 492098),
  ('mid_8a22faf0', 'exercicio-midias', 'cable-one-arm-tricep-pushdown-upper-arms.mp4', 'masculino',
   'Cable-One-Arm-Tricep-Pushdown_Upper-Arms__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NO CABO  OU POLIA/TRICEPS',
   1920, 1080, 6.00, 60, 597946),
  ('mid_da99bc6c', 'exercicio-midias', 'cable-overhead-triceps-extension-rope-attachment-female-upper-arms.mp4', 'feminino',
   'Cable-Overhead-Triceps-Extension-(rope-attachment)-(female)_Upper-Arms_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS NO CABO OU POLIA/TRICEPS',
   1920, 1080, 6.60, 66, 775381),
  ('mid_0c4aea09', 'exercicio-midias', 'cable-overhead-triceps-extension-rope-attachment-upper-arms-fix.mp4', 'masculino',
   'Cable-Overhead-Triceps-Extension-(rope-attachment)_Upper-Arms-FIX__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NO CABO  OU POLIA/TRICEPS',
   1920, 1080, 6.00, 60, 729111),
  ('mid_2e9e073e', 'exercicio-midias', 'cable-pushdown-with-rope-attachment-female-upper-arms.mp4', 'feminino',
   'Cable-Pushdown-(with-rope-attachment)-(female)_Upper-Arms_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS NO CABO OU POLIA/TRICEPS',
   1920, 1080, 5.40, 54, 631172),
  ('mid_ac9f167f', 'exercicio-midias', 'cable-pushdown-with-rope-attachment-upper-arms-fix.mp4', 'masculino',
   'Cable-Pushdown-(with-rope-attachment)_Upper-Arms-FIX__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NO CABO  OU POLIA/TRICEPS',
   1920, 1080, 6.00, 60, 605539),
  ('mid_61e8d574', 'exercicio-midias', 'cable-seated-row-back-fix.mp4', 'masculino',
   'Cable-Seated-Row_Back-FIX__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NO CABO  OU POLIA/COSTAS',
   1920, 1080, 6.00, 60, 1383462),
  ('mid_02f98bda', 'exercicio-midias', 'cable-seated-row-female-back.mp4', 'feminino',
   'Cable-Seated-Row-(female)_Back__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS NO CABO OU POLIA/COSTAS',
   1920, 1080, 6.00, 60, 1135142),
  ('mid_acbf5714', 'exercicio-midias', 'cable-seated-single-arm-row-female-back.mp4', 'feminino',
   'Cable-Seated-Single-Arm-Row-(female)_Back__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS NO CABO OU POLIA/COSTAS',
   1920, 1080, 6.00, 60, 784325),
  ('mid_89b8ae99', 'exercicio-midias', 'cable-standing-crossover-male-chest.mp4', 'masculino',
   'Cable-Standing-Crossover-(male)_Chest__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NO CABO  OU POLIA/PEITO',
   1920, 1080, 6.00, 60, 995632),
  ('mid_b63d2eb7', 'exercicio-midias', 'cable-standing-face-pull-with-rope-shoulders.mp4', 'masculino',
   'Cable-Standing-Face-Pull-(with-rope)_Shoulders_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NO CABO  OU POLIA/COSTAS',
   1920, 1080, 6.00, 60, 843405),
  ('mid_eb37901a', 'exercicio-midias', 'cable-standing-one-arm-triceps-extension-female-upper-arms.mp4', 'feminino',
   'Cable-Standing-One-Arm-Triceps-Extension-(female)_Upper-Arms_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS NO CABO OU POLIA/TRICEPS',
   1920, 1080, 6.60, 66, 692094),
  ('mid_39a86cd2', 'exercicio-midias', 'cable-standing-one-arm-triceps-extension-upper-arms.mp4', 'masculino',
   'Cable-Standing-One-Arm-Triceps-Extension_Upper-Arms_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NO CABO  OU POLIA/TRICEPS',
   1920, 1080, 6.60, 66, 1057758),
  ('mid_62b4f440', 'exercicio-midias', 'cable-straight-arm-pulldown-back-fix.mp4', 'masculino',
   'Cable-Straight-Arm-Pulldown_Back-FIX__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NO CABO  OU POLIA/COSTAS',
   1920, 1080, 5.80, 58, 818498),
  ('mid_b4b3b4fe', 'exercicio-midias', 'cable-straight-arm-pulldown-with-rope-back.mp4', 'masculino',
   'Cable-Straight-Arm-Pulldown-(with-rope)_Back_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NO CABO  OU POLIA/COSTAS',
   1920, 1080, 6.60, 66, 1340990),
  ('mid_45593a2e', 'exercicio-midias', 'cable-triceps-pushdown-v-bar-female-upper-arms.mp4', 'feminino',
   'Cable-Triceps-Pushdown-(V-bar)-(female)_Upper-Arms_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS NO CABO OU POLIA/TRICEPS',
   1920, 1080, 6.60, 66, 815445),
  ('mid_f0c330d7', 'exercicio-midias', 'cable-underhand-pulldown-back.mp4', 'masculino',
   'Cable-Underhand-Pulldown_Back_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NO CABO  OU POLIA/COSTAS',
   1920, 1080, 6.60, 66, 1352216),
  ('mid_9bf13b3d', 'exercicio-midias', 'cable-upright-row-female-shoulders.mp4', 'feminino',
   'Cable-Upright-Row-(female)_Shoulders__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS NO CABO OU POLIA/OMBRO',
   1920, 1080, 5.20, 52, 721974),
  ('mid_1fad7219', 'exercicio-midias', 'cable-upright-row-shoulder.mp4', 'masculino',
   'Cable-Upright-Row_shoulder_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NO CABO  OU POLIA/TRAPÉZIO',
   1920, 1080, 6.60, 66, 1296823),
  ('mid_29245264', 'exercicio-midias', 'cable-wide-grip-lat-pulldown-female-back.mp4', 'feminino',
   'Cable-Wide-Grip-Lat-Pulldown-(female)_Back_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS NO CABO OU POLIA/COSTAS',
   1920, 1080, 6.60, 66, 1430598),
  ('mid_e36ec7b9', 'exercicio-midias', 'dumbbell-concentration-curl-female-upper-arms.mp4', 'feminino',
   'Dumbbell-Concentration-Curl-(female)_Upper-Arms_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS COM HALTERES/BICEPS',
   1920, 1080, 6.60, 66, 912280),
  ('mid_9e92fd04', 'exercicio-midias', 'dumbbell-concentration-curl-upper-arms-fix.mp4', 'masculino',
   'Dumbbell-Concentration-Curl_Upper-Arms-FIX__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS COM HALTERES/BICEPS',
   1920, 1080, 5.90, 59, 732736),
  ('mid_7ddba9e0', 'exercicio-midias', 'dumbbell-incline-alternate-bicep-curl-upper-arms.mp4', 'masculino',
   'Dumbbell-Incline-Alternate-Bicep-Curl_Upper-Arms__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS COM HALTERES/BICEPS',
   1920, 1080, 8.00, 80, 619566),
  ('mid_22d5f885', 'exercicio-midias', 'dumbbell-incline-bench-press-female-chest.mp4', 'feminino',
   'Dumbbell-Incline-Bench-Press-(female)_Chest_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS COM HALTERES/PEITO',
   1920, 1080, 6.60, 66, 895710),
  ('mid_6a59b611', 'exercicio-midias', 'dumbbell-incline-curl-upper-arms-fix.mp4', 'masculino',
   'Dumbbell-Incline-Curl_Upper-Arms-FIX__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS COM HALTERES/BICEPS',
   1920, 1080, 8.10, 81, 646760),
  ('mid_38b6d35e', 'exercicio-midias', 'dumbbell-kickback-female-upper-arms.mp4', 'feminino',
   'Dumbbell-Kickback-(female)_Upper-arms_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS COM HALTERES/TRICEPS',
   1920, 1080, 6.60, 66, 795055),
  ('mid_48cf737e', 'exercicio-midias', 'dumbbell-kickback-upper-arms.mp4', 'masculino',
   'Dumbbell-Kickback_Upper-Arms_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS COM HALTERES/TRICEPS',
   1920, 1080, 6.60, 66, 1130543),
  ('mid_893208dd', 'exercicio-midias', 'dumbbell-one-arm-lateral-raise-female-shoulder.mp4', 'feminino',
   'Dumbbell-One-Arm-Lateral-Raise-(female)_Shoulder_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS COM HALTERES/OMBRO',
   1920, 1080, 6.60, 66, 632484),
  ('mid_62c351cf', 'exercicio-midias', 'dumbbell-one-arm-lateral-raise-shoulder.mp4', 'masculino',
   'Dumbbell-One-Arm-Lateral-Raise_Shoulder_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS COM HALTERES/OMBRO',
   1920, 1080, 6.60, 66, 732516),
  ('mid_3e131c95', 'exercicio-midias', 'dumbbell-pullover-chest.mp4', 'masculino',
   'Dumbbell-Pullover_Chest_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS COM HALTERES/PEITO',
   1920, 1080, 6.60, 66, 1728451),
  ('mid_b0d9beb6', 'exercicio-midias', 'dumbbell-rear-delt-fly-female-shoulders.mp4', 'feminino',
   'Dumbbell-Rear-Delt-Fly-(female)_Shoulders_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS COM HALTERES/COSTAS',
   1920, 1080, 6.60, 66, 1678239),
  ('mid_0e59f36b', 'exercicio-midias', 'dumbbell-seated-shoulder-press-female-shoulders.mp4', 'feminino',
   'Dumbbell-Seated-Shoulder-Press-(female)_Shoulders_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS COM HALTERES/OMBRO',
   1920, 1080, 6.60, 66, 937524),
  ('mid_789833d2', 'exercicio-midias', 'dumbbell-shrug-back-fix.mp4', 'masculino',
   'Dumbbell-Shrug_Back-FIX__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS COM HALTERES/TRAPÉZIO',
   1920, 1080, 6.00, 60, 761823),
  ('mid_6fc0d055', 'exercicio-midias', 'dumbbell-shrug-female-back.mp4', 'feminino',
   'Dumbbell-Shrug-(female)_Back_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS COM HALTERES/OMBRO',
   1920, 1080, 6.60, 66, 727841),
  ('mid_5782679c', 'exercicio-midias', 'dumbbell-single-arm-preacher-curl-female-upper-arms.mp4', 'feminino',
   'Dumbbell-Single-Arm-Preacher-Curl-(female)_Upper-Arms_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS COM HALTERES/BICEPS',
   1920, 1080, 6.60, 66, 716562),
  ('mid_cad798eb', 'exercicio-midias', 'lever-chest-press-chest-fix.mp4', 'masculino',
   'Lever-Chest-Press_Chest-FIX__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NA MAQUINA - HACK - BANCO/PEITO',
   1920, 1080, 6.00, 60, 1152720),
  ('mid_517b722a', 'exercicio-midias', 'lever-high-row-plate-loaded-back.mp4', 'masculino',
   'Lever-High-Row-(plate-loaded)_Back_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NA MAQUINA - HACK - BANCO/COSTAS',
   1920, 1080, 6.60, 66, 1689113),
  ('mid_c296f752', 'exercicio-midias', 'lever-lying-t-bar-row-back.mp4', 'masculino',
   'Lever-Lying-T-bar-Row_Back_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NA MAQUINA - HACK - BANCO/COSTAS',
   1920, 1080, 6.60, 66, 1377738),
  ('mid_ebfc1d57', 'exercicio-midias', 'lever-one-leg-extension-thighs.mp4', 'masculino',
   'Lever-One-Leg-Extension_Thighs__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NA MAQUINA - HACK - BANCO/PERNA',
   1920, 1080, 5.80, 58, 927583),
  ('mid_e0460126', 'exercicio-midias', 'lever-preacher-curl-upper-arms-fix.mp4', 'masculino',
   'Lever-Preacher-Curl_Upper-Arms-FIX__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NA MAQUINA - HACK - BANCO/BICEPS',
   1920, 1080, 5.90, 59, 982797),
  ('mid_e0db3c69', 'exercicio-midias', 'lever-seated-calf-raise-plate-loaded.mp4', 'masculino',
   'Lever-Seated-Calf-Raise-(plate-loaded)_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NA MAQUINA - HACK - BANCO/PANTURRILHA',
   1920, 1080, 6.60, 66, 1681090),
  ('mid_0b98c303', 'exercicio-midias', 'lever-seated-hip-adduction-thighs.mp4', 'masculino',
   'Lever-Seated-Hip-Adduction_Thighs_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NA MAQUINA - HACK - BANCO/PERNA',
   1920, 1080, 6.60, 66, 1513050),
  ('mid_07b0cf9e', 'exercicio-midias', 'lever-seated-leg-curl-thighs-fix.mp4', 'masculino',
   'Lever-Seated-Leg-Curl_Thighs-FIX__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NA MAQUINA - HACK - BANCO/PERNA',
   1920, 1080, 6.00, 60, 1406397),
  ('mid_fbbdf8e2', 'exercicio-midias', 'lever-seated-leg-press-thighs.mp4', 'masculino',
   'Lever-Seated-Leg-Press_Thighs_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NA MAQUINA - HACK - BANCO/PERNA',
   1920, 1080, 6.60, 66, 1929488),
  ('mid_ca1022b6', 'exercicio-midias', 'lever-triceps-extension-female-upper-arms.mp4', 'feminino',
   'Lever-Triceps-Extension-(female)_Upper-Arms_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/ACADEMIA/EXERCÍCIOS NA MAQUINA - HACK - BANCO/TRICEPS',
   1920, 1080, 6.60, 66, 1066437),
  ('mid_1675c6b6', 'exercicio-midias', 'lever-triceps-extension-upper-arms.mp4', 'masculino',
   'Lever-Triceps-Extension_Upper-Arms_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NA MAQUINA - HACK - BANCO/TRICEPS',
   1920, 1080, 6.60, 66, 1504914),
  ('mid_54535979', 'exercicio-midias', 'lever-unilateral-row-back.mp4', 'masculino',
   'Lever-Unilateral-Row_Back_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NA MAQUINA - HACK - BANCO/COSTAS',
   1920, 1080, 6.60, 66, 1537826),
  ('mid_6e648d5e', 'exercicio-midias', 'pull-up-back-fix2.mp4', 'masculino',
   'Pull-up_Back-FIX2__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NA MAQUINA - HACK - BANCO/COSTAS',
   1920, 1080, 3.30, 33, 852732),
  ('mid_f18ad993', 'exercicio-midias', 'smith-shoulder-press-shoulder.mp4', 'masculino',
   'Smith-Shoulder-Press_shoulder_converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/MASCULINO/ACADEMIA/EXERCÍCIOS NA MAQUINA - HACK - BANCO/OMBRO',
   1920, 1080, 6.60, 66, 1320023),
  ('mid_bc326d24', 'exercicio-midias', 'walking-lunge-female-thighs-fix.mp4', 'feminino',
   'Walking-Lunge-(female)_Thighs-FIX__converted.gif', 'GIFS PLANEJADOR - ORGANIZADOS/FEMININO/FUNCIONAL',
   1920, 1080, 8.10, 81, 2178499)
) as v(chave, bucket, caminho, genero, origem_arquivo, origem_pasta,
       largura, altura, duracao_s, frames, bytes)
on conflict (chave) do update set
  bucket         = excluded.bucket,
  caminho        = excluded.caminho,
  genero         = excluded.genero,
  origem_arquivo = excluded.origem_arquivo,
  origem_pasta   = excluded.origem_pasta,
  largura        = excluded.largura,
  altura         = excluded.altura,
  duracao_s      = excluded.duracao_s,
  frames         = excluded.frames,
  bytes          = excluded.bytes;


-- ---------------------------------------------------------------------------
-- 2) OS VINCULOS — 68 pares exercicio x midia
-- ---------------------------------------------------------------------------
-- `ordem`: 0 para o principal, 1 para o equivalente. E o desempate quando o
-- app precisa escolher e o genero preferido nao existe.
--
-- A midia e resolvida pela `chave`, nao por UUID: o id de `midias` e gerado
-- pelo banco e muda a cada recriacao, enquanto a chave e deterministica.
-- ---------------------------------------------------------------------------
insert into public.exercicio_midias (nutri_id, exercicio_id, midia_id, papel, ordem)
select null, v.exercicio_id, m.id, v.papel, v.ordem
from (values
  ('a981ea9f-8fc5-4651-836d-612e436031ea'::uuid, 'mid_bc326d24', 'principal', 0),  -- Afundo caminhando livre (feminino)
  ('415d29f0-d14b-48a0-b369-82cecb0f9f15'::uuid, 'mid_6e648d5e', 'principal', 0),  -- Barra fixa (pegada pronada) (masculino)
  ('659d8da0-604c-4f79-b785-a831cb76fbf2'::uuid, 'mid_0b98c303', 'principal', 0),  -- Cadeira adutora (masculino)
  ('d27f8e5c-1808-402a-a196-1f05f5a45d20'::uuid, 'mid_ebfc1d57', 'principal', 0),  -- Cadeira extensora unilateral (masculino)
  ('2175d07d-e372-4335-9c8b-4f99b4e16002'::uuid, 'mid_07b0cf9e', 'principal', 0),  -- Cadeira flexora (masculino)
  ('299c08b8-1da5-48a9-9c9e-48c2f17af18e'::uuid, 'mid_89b8ae99', 'principal', 0),  -- Crossover na polia (masculino)
  ('6b93604d-4286-429f-9e36-863159d8aeb8'::uuid, 'mid_b0d9beb6', 'principal', 0),  -- Crucifixo invertido (feminino)
  ('ca7ac1bd-8cb2-4393-b0a7-6b993a7c0f6e'::uuid, 'mid_a1fc0f86', 'principal', 0),  -- Crucifixo invertido na polia (masculino)
  ('f1be6bdc-5c8e-4cf3-8e05-bf394c3f6097'::uuid, 'mid_e8aac923', 'equivalente', 1),  -- Crucifixo no banco reto na polia (feminino)
  ('f1be6bdc-5c8e-4cf3-8e05-bf394c3f6097'::uuid, 'mid_6b240d6b', 'principal', 0),  -- Crucifixo no banco reto na polia (masculino)
  ('4e4d479a-2111-48d7-9279-b0162bcde301'::uuid, 'mid_0e59f36b', 'principal', 0),  -- Desenvolvimento com halteres (feminino)
  ('b192f6ec-f363-426d-b580-69c41325452e'::uuid, 'mid_f18ad993', 'principal', 0),  -- Desenvolvimento militar na máquina (masculino)
  ('d5101a0c-96a0-4be7-8d41-e0300a48d601'::uuid, 'mid_4b589063', 'equivalente', 1),  -- Elevação frontal na polia (masculino)
  ('d5101a0c-96a0-4be7-8d41-e0300a48d601'::uuid, 'mid_2fef5280', 'principal', 0),  -- Elevação frontal na polia (feminino)
  ('4d0a863f-f24e-44a3-9ac9-89cec9bae769'::uuid, 'mid_62c351cf', 'equivalente', 1),  -- Elevação lateral unilateral (masculino)
  ('4d0a863f-f24e-44a3-9ac9-89cec9bae769'::uuid, 'mid_893208dd', 'principal', 0),  -- Elevação lateral unilateral (feminino)
  ('c9def201-d2a1-493e-9a18-2db92853ec24'::uuid, 'mid_6fc0d055', 'equivalente', 1),  -- Encolhimento com halteres (feminino)
  ('c9def201-d2a1-493e-9a18-2db92853ec24'::uuid, 'mid_789833d2', 'principal', 0),  -- Encolhimento com halteres (masculino)
  ('aee5bfa1-cbcc-4b25-8c82-f4fd9e9be46a'::uuid, 'mid_1675c6b6', 'equivalente', 1),  -- Extensão de tríceps na máquina (masculino)
  ('aee5bfa1-cbcc-4b25-8c82-f4fd9e9be46a'::uuid, 'mid_ca1022b6', 'principal', 0),  -- Extensão de tríceps na máquina (feminino)
  ('1e97482b-1b23-4ea9-a694-8ff63c351ceb'::uuid, 'mid_39a86cd2', 'equivalente', 1),  -- Extensão de tríceps unilateral em pé na polia baixa (masculino)
  ('1e97482b-1b23-4ea9-a694-8ff63c351ceb'::uuid, 'mid_eb37901a', 'principal', 0),  -- Extensão de tríceps unilateral em pé na polia baixa (feminino)
  ('8c2689d9-5bad-4cc4-b899-085154551dd5'::uuid, 'mid_8a22faf0', 'equivalente', 1),  -- Extensão de tríceps unilateral na polia (masculino)
  ('8c2689d9-5bad-4cc4-b899-085154551dd5'::uuid, 'mid_54d177e6', 'principal', 0),  -- Extensão de tríceps unilateral na polia (feminino)
  ('a035c5e1-a490-4359-ac8a-ed4d0210c479'::uuid, 'mid_b63d2eb7', 'principal', 0),  -- Face pull na polia (masculino)
  ('af5ed771-57ff-4da5-887f-a08adf5dca18'::uuid, 'mid_fbbdf8e2', 'principal', 0),  -- Leg press (masculino)
  ('d69e50f2-9800-4bd2-a2c1-ba33b164bc41'::uuid, 'mid_e0db3c69', 'principal', 0),  -- Panturrilha sentado na máquina (masculino)
  ('7dc456d0-d4a0-4eb1-bcee-4cbec8a9f0fa'::uuid, 'mid_62b4f440', 'principal', 0),  -- Pulldown com braços estendidos (polia) (masculino)
  ('887934a7-feee-4488-856d-4a18b28bb7b0'::uuid, 'mid_b4b3b4fe', 'principal', 0),  -- Pulldown com braços estendidos na corda (masculino)
  ('7568acc2-c139-4fd4-bad0-47aa3be61849'::uuid, 'mid_3e131c95', 'principal', 0),  -- Pullover com halter braços estendidos (masculino)
  ('6117b8ba-28c2-4261-971b-9a53dacad21b'::uuid, 'mid_29245264', 'principal', 0),  -- Puxada aberta (feminino)
  ('30406979-1cfe-406d-b75d-17fbe32ba73b'::uuid, 'mid_41fc79b7', 'equivalente', 1),  -- Puxada frontal fechada (feminino)
  ('30406979-1cfe-406d-b75d-17fbe32ba73b'::uuid, 'mid_d0916d3f', 'principal', 0),  -- Puxada frontal fechada (masculino)
  ('55080c43-c83e-4255-9f08-43ee45e233a2'::uuid, 'mid_f0c330d7', 'principal', 0),  -- Puxada pegada supinada na polia (masculino)
  ('fdbfd9bc-59f3-4c3f-9634-2dd60e53b6a3'::uuid, 'mid_9c8b94b6', 'principal', 0),  -- Puxada unilateral (masculino)
  ('691c1b8c-bf23-4bec-bb06-eb7a59bb3483'::uuid, 'mid_517b722a', 'principal', 0),  -- Remada alta na máquina articulada (masculino)
  ('8f86e729-4e5f-45e8-bc3c-ee358d8ff3e6'::uuid, 'mid_9bf13b3d', 'equivalente', 1),  -- Remada alta na polia (feminino)
  ('8f86e729-4e5f-45e8-bc3c-ee358d8ff3e6'::uuid, 'mid_1fad7219', 'principal', 0),  -- Remada alta na polia (masculino)
  ('1a3015e9-850d-4104-ade4-9f2cef109830'::uuid, 'mid_829fdba5', 'equivalente', 1),  -- Remada curvada com as duas mãos na barra (long bar) (masculino)
  ('1a3015e9-850d-4104-ade4-9f2cef109830'::uuid, 'mid_588fcaf8', 'principal', 0),  -- Remada curvada com as duas mãos na barra (long bar) (feminino)
  ('03b2ee7c-c7b9-46da-b299-03f71eb2ee48'::uuid, 'mid_54535979', 'principal', 0),  -- Remada isolateral na máquina articulada (masculino)
  ('98c7ac47-4540-48b0-a77d-bd1f5038d125'::uuid, 'mid_61e8d574', 'equivalente', 1),  -- Remada sentado na polia (remada baixa) (masculino)
  ('98c7ac47-4540-48b0-a77d-bd1f5038d125'::uuid, 'mid_02f98bda', 'principal', 0),  -- Remada sentado na polia (remada baixa) (feminino)
  ('76ef7bcd-8933-480d-bf00-bc9d777f4f24'::uuid, 'mid_c296f752', 'principal', 0),  -- Remada T deitado (masculino)
  ('9e4c8cb9-aaa2-4826-83c9-e7a3b55854b8'::uuid, 'mid_acbf5714', 'principal', 0),  -- Remada unilateral sentado na polia (feminino)
  ('baa0e367-2fab-419b-ae67-55790039b27c'::uuid, 'mid_7ddba9e0', 'principal', 0),  -- Rosca alternada inclinada com halteres (masculino)
  ('21876dce-4235-4f6e-990f-88485ae1efc2'::uuid, 'mid_e36ec7b9', 'equivalente', 1),  -- Rosca concentrada (feminino)
  ('21876dce-4235-4f6e-990f-88485ae1efc2'::uuid, 'mid_9e92fd04', 'principal', 0),  -- Rosca concentrada (masculino)
  ('78d17f3b-7e44-41da-894b-993b2b125e6d'::uuid, 'mid_6a59b611', 'principal', 0),  -- Rosca direta no banco inclinado (masculino)
  ('1a05b7f4-071e-4cf4-a37f-449016770f56'::uuid, 'mid_d0c5574d', 'equivalente', 1),  -- Rosca Scott com barra (masculino)
  ('1a05b7f4-071e-4cf4-a37f-449016770f56'::uuid, 'mid_d319d6aa', 'principal', 0),  -- Rosca Scott com barra (feminino)
  ('73aa6060-3f99-4d1b-b1ff-27ffaa41d01c'::uuid, 'mid_e0460126', 'principal', 0),  -- Rosca Scott na máquina (masculino)
  ('10df5f98-3717-4156-a98c-dd92f75d114d'::uuid, 'mid_5782679c', 'principal', 0),  -- Rosca Scott unilateral com halter (feminino)
  ('45412168-d0e3-4b3f-b356-6974af1e72e9'::uuid, 'mid_5fa9b211', 'equivalente', 1),  -- Rosca unilateral em pé na polia (feminino)
  ('45412168-d0e3-4b3f-b356-6974af1e72e9'::uuid, 'mid_e2326bdb', 'principal', 0),  -- Rosca unilateral em pé na polia (masculino)
  ('0abf18cd-e661-4a31-8dbf-ea7b671f01e1'::uuid, 'mid_d7384f60', 'equivalente', 1),  -- Stiff com barra (pernas estendidas) (masculino)
  ('0abf18cd-e661-4a31-8dbf-ea7b671f01e1'::uuid, 'mid_55eaba0d', 'principal', 0),  -- Stiff com barra (pernas estendidas) (feminino)
  ('274c8bdc-6c37-4f0d-86bd-e9e78463a3db'::uuid, 'mid_22d5f885', 'principal', 0),  -- Supino inclinado com halteres (feminino)
  ('9a9486d9-ca7c-4df7-a4db-5f450e75854f'::uuid, 'mid_cad798eb', 'principal', 0),  -- Supino na máquina (masculino)
  ('2f8774a0-2b65-4690-aeb5-b076c27ed2aa'::uuid, 'mid_48cf737e', 'equivalente', 1),  -- Tríceps coice com halter (masculino)
  ('2f8774a0-2b65-4690-aeb5-b076c27ed2aa'::uuid, 'mid_38b6d35e', 'principal', 0),  -- Tríceps coice com halter (feminino)
  ('ec7cd5e9-eec5-40f7-84d4-5cbecf2d1bb7'::uuid, 'mid_da99bc6c', 'equivalente', 1),  -- Tríceps francês na polia (feminino)
  ('ec7cd5e9-eec5-40f7-84d4-5cbecf2d1bb7'::uuid, 'mid_0c4aea09', 'principal', 0),  -- Tríceps francês na polia (masculino)
  ('97661a00-b1a9-4c94-9fab-914492f530ac'::uuid, 'mid_67f49c80', 'equivalente', 1),  -- Tríceps francês no cross (feminino)
  ('97661a00-b1a9-4c94-9fab-914492f530ac'::uuid, 'mid_dc001230', 'principal', 0),  -- Tríceps francês no cross (masculino)
  ('d53b8eb7-8d34-4518-aa9a-8f11adb16f4f'::uuid, 'mid_45593a2e', 'principal', 0),  -- Tríceps pulley com barra V (feminino)
  ('ea69001d-daaa-47c6-b97a-0af126ca8add'::uuid, 'mid_ac9f167f', 'equivalente', 1),  -- Tríceps pulley com corda (masculino)
  ('ea69001d-daaa-47c6-b97a-0af126ca8add'::uuid, 'mid_2e9e073e', 'principal', 0)   -- Tríceps pulley com corda (feminino)
) as v(exercicio_id, chave, papel, ordem)
join public.midias m on m.chave = v.chave
on conflict (exercicio_id, midia_id) do update set
  papel = excluded.papel,
  ordem = excluded.ordem;


-- ---------------------------------------------------------------------------
-- 3) CONFERENCIA RAPIDA
-- ---------------------------------------------------------------------------
-- Esperado: 68 midias (todas globais), 68 vinculos (todos globais),
-- 49 exercicios distintos.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.midias)                                as midias,
  (select count(*) from public.midias where nutri_id is null)         as midias_globais,
  (select count(*) from public.exercicio_midias)                      as vinculos,
  (select count(*) from public.exercicio_midias where nutri_id is null) as vinculos_globais,
  (select count(distinct exercicio_id) from public.exercicio_midias)  as exercicios_distintos;
