-- ===========================================================================
-- Evollo · DESFAZER — insercao publica na tabela exames
-- ---------------------------------------------------------------------------
-- Recria a policy que db/exames_fechar_insercao_publica.sql removeu.
--
-- PENSE ANTES DE RODAR ISTO. A policy original permite INSERT sem amarrar a
-- linha a ninguem: com a anon-key, que vive no JavaScript do site, qualquer
-- pessoa grava exame no prontuario de qualquer paciente.
--
-- Se o modulo de exames estiver sendo construido agora, a policy certa NAO e
-- esta — e uma escopada, no mesmo formato da de leitura:
--
--   create policy exames_nutri_insert on public.exames
--     for insert to authenticated
--     with check (exists (select 1 from public.pacientes p
--                          where p.id = paciente_id and p.nutri_id = auth.uid()));
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

drop policy if exists "Publico insere exames" on public.exames;
create policy "Publico insere exames" on public.exames
  for insert
  with check (true);


-- Conferencia: devolve 1.
select count(*) as insercao_publica
from pg_policies
where schemaname = 'public' and tablename = 'exames' and cmd = 'INSERT';
