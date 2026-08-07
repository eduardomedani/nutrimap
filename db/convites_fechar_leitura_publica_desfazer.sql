-- ===========================================================================
-- Evollo · DESFAZER — leitura publica dos codigos de convite
-- ---------------------------------------------------------------------------
-- Recria a policy que db/convites_fechar_leitura_publica.sql removeu.
--
-- SO RODE ISTO SE ALGO QUEBROU. A policy devolve a leitura de TODOS os codigos
-- de convite para qualquer um que consulte a tabela com a anon-key — que e
-- publica, porque vive no JavaScript do site.
--
-- Se o cadastro parou de funcionar depois da remocao, a causa provável e
-- validar_codigo_convite ter deixado de ser SECURITY DEFINER. Nesse caso o
-- conserto certo e devolver o `security definer` a funcao, nao reabrir a
-- tabela: a funcao valida um codigo por vez, a policy entrega a lista inteira.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

drop policy if exists "Publico le codigos" on public.codigos_convite;
create policy "Publico le codigos" on public.codigos_convite
  for select
  using (true);


-- Conferencia: devolve 1.
select count(*) as leitura_publica
from pg_policies
where schemaname = 'public' and tablename = 'codigos_convite'
  and cmd = 'SELECT' and qual = 'true';
