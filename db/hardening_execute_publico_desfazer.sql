-- ===========================================================================
-- Evollo · DESFAZER — devolver EXECUTE a PUBLIC no schema public
-- ---------------------------------------------------------------------------
-- Devolve o estado anterior: todas as funcoes de `public` executaveis por
-- qualquer um, inclusive `anon`, e o default privilege de volta.
--
-- PENSE ANTES DE RODAR. Isto reabre 33 funcoes SECURITY DEFINER para chamada
-- anonima. Elas passam por cima do RLS, e a unica coisa que as segura passa a
-- ser o `if` escrito dentro de cada uma.
--
-- SE ALGO QUEBROU, o conserto quase sempre e MENOR que isto: falta `anon` numa
-- funcao especifica. Descubra qual pelo erro no console do navegador
-- (`permission denied for function X`) e devolva so ela:
--
--   grant execute on function public.NOME(ARGS) to anon;
--
-- As cinco que o script original devolve a anon sao:
--   rpc_buscar_paciente_por_codigo, rpc_salvar_respostas, rpc_marcar_completo,
--   validar_codigo_convite, registrar_uso_codigo
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

do $$
declare
  r record;
begin
  for r in
    select quote_ident(n.nspname) || '.' || quote_ident(p.proname) as nome,
           pg_get_function_identity_arguments(p.oid)               as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('grant execute on function %s(%s) to public', r.nome, r.args);
  end loop;
end $$;

alter default privileges in schema public grant execute on functions to public;
alter default privileges for role postgres in schema public grant execute on functions to public;

do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public grant execute on functions to public';
exception when others then
  raise notice 'Default de supabase_admin nao ajustado (%).', sqlerrm;
end $$;


-- Conferencia: anon_executa volta a ser igual a total_funcoes.
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f')                 as total_funcoes,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute'))         as anon_executa;
