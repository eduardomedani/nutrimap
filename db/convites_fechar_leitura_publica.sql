-- ===========================================================================
-- Evollo · SEGURANCA — fechar a leitura publica dos codigos de convite
-- ---------------------------------------------------------------------------
-- A policy "Publico le codigos" em public.codigos_convite tem condicao `true`:
-- qualquer um que consulte a tabela recebe TODOS os codigos.
--
-- Isso e explorável, nao teorico. A anon-key do Supabase esta no JavaScript do
-- site por design — e a unica coisa que separa um estranho de virar
-- "profissional" no sistema e conhecer um codigo. Em 07/08/2026 havia 4
-- codigos cadastrados, os 4 ativos.
--
-- POR QUE DA PARA REMOVER SEM QUEBRAR NADA:
--
--   cadastro   js/auth.js:40 chama a RPC validar_codigo_convite, nao le a
--              tabela. Nenhum `.from('codigos_convite')` existe no projeto.
--   admin      admin.html:151 chama admin_listar_codigos(), que e
--              SECURITY DEFINER (db/admin_convites.sql:64) e passa por cima da
--              RLS depois de conferir admin_is().
--
-- A GUARDA. Este script NAO remove a policy as cegas: se
-- validar_codigo_convite nao existir, ou nao for SECURITY DEFINER, ele aborta
-- sem tocar em nada. Uma funcao `security invoker` precisaria da policy para
-- ler a tabela, e derrubá-la quebraria o cadastro de novos profissionais.
--
-- Desfazer: db/convites_fechar_leitura_publica_desfazer.sql
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

do $$
declare
  v_definer boolean;
begin
  select p.prosecdef into v_definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'validar_codigo_convite'
  limit 1;

  if v_definer is null then
    raise exception
      'validar_codigo_convite nao existe. Descubra como o cadastro le o codigo antes de fechar a leitura.';
  elsif not v_definer then
    raise exception
      'validar_codigo_convite NAO e security definer: sem a policy, o cadastro para de funcionar.';
  end if;

  execute 'drop policy if exists "Publico le codigos" on public.codigos_convite';
  raise notice 'Leitura publica fechada. Cadastro segue pela RPC, admin pela admin_listar_codigos().';
end $$;


-- ===========================================================================
-- Conferencia. Esperado: leitura_publica 0, e a tabela continua com RLS.
-- ===========================================================================
select
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'codigos_convite'
      and cmd = 'SELECT' and qual = 'true')                       as leitura_publica,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'codigos_convite') as policies_restantes,
  (select c.relrowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'codigos_convite')  as rls_ligado;
