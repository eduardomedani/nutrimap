-- ===========================================================================
-- DESFAZER db/comercial_alunos_por_turno.sql
-- ---------------------------------------------------------------------------
-- Remove a funcao de contagem por turno. 100% re-executavel.
--
-- ANTES DE RODAR: o fechamento da folha CHAMA esta funcao para mostrar o resumo
-- por turno e calcular o bonus. Removendo-a sem tirar o frontend, a tela passa
-- a mostrar o aviso de "nao consegui contar" — ela nao quebra, mas tambem nao
-- serve. Se a ideia e desfazer a etapa inteira, tire o frontend primeiro.
--
-- Nenhuma linha de DADO e tocada: a funcao so le.
-- ===========================================================================

drop function if exists public.comercial_alunos_por_turno(date, numeric);


-- ===========================================================================
-- Conferencia. Esperado: 0.
-- ===========================================================================
select count(*) as ainda_existe
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'comercial_alunos_por_turno';
