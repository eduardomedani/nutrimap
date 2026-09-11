-- ===========================================================================
-- Evollo · DESFAZER midias e exercicio_midias
-- ---------------------------------------------------------------------------
-- ATENCAO — LEIA ANTES DE RODAR.
--
-- Este script APAGA as duas tabelas e TUDO que estiver nelas: as linhas de
-- midia e os vinculos de curadoria. Os arquivos MP4 no Storage NAO sao
-- tocados — mas o mapa que diz qual arquivo pertence a qual exercicio some, e
-- reconstrui-lo significa refazer a curadoria.
--
-- ANTES DE RODAR, exporte:
--     select * from public.midias;
--     select * from public.exercicio_midias;
--
-- `video_url` nao e tocado por este script, nem pela migration. As 40 URLs
-- externas continuam onde sempre estiveram.
--
-- A ordem importa: `exercicio_midias` referencia `midias` com `on delete
-- restrict`, entao o vinculo cai primeiro.
--
-- 100% re-executavel.
-- Para colar, use db/exercicio_midias_desfazer_LIMPO.sql
-- ===========================================================================

drop policy if exists exercicio_midias_read   on public.exercicio_midias;
drop policy if exists exercicio_midias_insert on public.exercicio_midias;
drop policy if exists exercicio_midias_update on public.exercicio_midias;
drop policy if exists exercicio_midias_delete on public.exercicio_midias;

drop policy if exists midias_read   on public.midias;
drop policy if exists midias_insert on public.midias;
drop policy if exists midias_update on public.midias;
drop policy if exists midias_delete on public.midias;

drop table if exists public.exercicio_midias;
drop table if exists public.midias;

-- Esperado: nenhuma linha.
select c.relname as tabela_que_sobrou
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('midias', 'exercicio_midias');
