-- ===========================================================================
-- Evollo · DESFAZER o seed do acervo
-- ---------------------------------------------------------------------------
-- ATENCAO — LEIA ANTES DE RODAR.
--
-- Apaga as 70 midias globais e os 70 vinculos de curadoria. Os MP4 no Storage
-- NAO sao tocados — mas o mapa que diz qual arquivo pertence a qual exercicio
-- some, e refaze-lo significa refazer a curadoria inteira.
--
-- So apaga o que e GLOBAL (`nutri_id is null`). Video proprio de profissional,
-- se existir, fica onde esta: este script e do acervo do produto, nao de todo
-- mundo.
--
-- A ordem importa: `exercicio_midias` referencia `midias` com `on delete
-- restrict`, entao o vinculo cai primeiro. Se a segunda instrucao falhar por
-- violacao de chave, e porque alguma midia global esta em uso por um vinculo
-- PRIVADO — um profissional ligou o exercicio dele ao acervo. Nesse caso pare
-- e decida: o vinculo dele nao e seu para apagar.
--
-- 100% re-executavel.
-- Para colar, use db/exercicio_midias_seed_desfazer_LIMPO.sql
-- ===========================================================================

delete from public.exercicio_midias where nutri_id is null;

delete from public.midias where nutri_id is null;

-- Esperado: tudo zero.
select
  (select count(*) from public.midias where nutri_id is null)           as midias_globais,
  (select count(*) from public.exercicio_midias where nutri_id is null) as vinculos_globais,
  (select count(*) from public.midias)                                  as midias_no_total,
  (select count(*) from public.exercicio_midias)                        as vinculos_no_total;
