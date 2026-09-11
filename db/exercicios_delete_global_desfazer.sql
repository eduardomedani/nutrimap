-- ===========================================================================
-- Evollo · DESFAZER o conserto do DELETE em exercicios
-- ---------------------------------------------------------------------------
-- Devolve a policy unica `exercicios_owner`, exatamente como estava.
--
-- ATENCAO — LEIA ANTES DE RODAR. Voltar atras REABRE o furo: com a policy
-- unica, qualquer usuario autenticado pode APAGAR uma linha global e pode
-- TOMAR POSSE dela por UPDATE.
--
-- Se ja existir acervo global em `exercicios` quando isto rodar, o dado fica
-- exposto no mesmo instante. Rodar so se a correcao tiver quebrado algo — e,
-- nesse caso, e melhor corrigir a correcao do que reabrir o furo.
--
-- 100% re-executavel.
-- Para colar, use db/exercicios_delete_global_desfazer_LIMPO.sql
-- ===========================================================================

drop policy if exists exercicios_owner_select on public.exercicios;
drop policy if exists exercicios_owner_insert on public.exercicios;
drop policy if exists exercicios_owner_update on public.exercicios;
drop policy if exists exercicios_owner_delete on public.exercicios;

drop policy if exists exercicios_owner on public.exercicios;
create policy exercicios_owner on public.exercicios
  for all
  using (nutri_id = auth.uid() or nutri_id is null)
  with check (nutri_id = auth.uid());

select p.polname                               as politica,
       p.polcmd                                as comando,
       pg_get_expr(p.polqual, p.polrelid)      as usando,
       pg_get_expr(p.polwithcheck, p.polrelid) as com_check
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'exercicios'
order by p.polcmd, p.polname;
