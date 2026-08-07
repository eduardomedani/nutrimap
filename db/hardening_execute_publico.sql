-- ===========================================================================
-- Evollo · SEGURANCA — tirar EXECUTE de PUBLIC no schema public
-- ---------------------------------------------------------------------------
-- Conferido em 07/08/2026: as 77 funcoes de `public` sao executaveis por
-- `anon`. TODAS. Os `grant execute ... to authenticated` escritos nas
-- migracoes nao restringem nada, porque `PUBLIC` ja tem EXECUTE por padrao no
-- Supabase e ninguem revogou.
--
-- 33 dessas funcoes sao SECURITY DEFINER: elas passam por cima do RLS, e o
-- grant e o unico portao. Hoje o que segura e o `if` dentro de cada uma — o
-- que funciona enquanto todo autor lembrar de escrever o `if`.
--
-- O QUE ESTE SCRIPT FAZ:
--   1. revoga EXECUTE de PUBLIC e de anon em TODAS as funcoes de public
--   2. concede EXECUTE a authenticated em todas — preserva exatamente o
--      comportamento de hoje para quem esta logado (as 77 ja tinham)
--   3. devolve anon as CINCO que precisam, nomeadas uma a uma
--   4. muda o DEFAULT PRIVILEGE, para funcao nova nao nascer aberta
--
-- O passo 4 e o que separa isto de encenacao. Sem ele, o proximo
-- `create function` recria o grant para PUBLIC e o trabalho se desfaz sozinho.
--
-- AS CINCO QUE PRECISAM DE anon, e por que (rastreado no codigo, nao suposto):
--
--   rpc_buscar_paciente_por_codigo  anamnese.html -> js/pacientes.js:33
--   rpc_salvar_respostas            anamnese.html -> js/respostas.js:39
--   rpc_marcar_completo             anamnese.html -> js/pacientes.js:138
--     O questionario e preenchido pelo PACIENTE, por link, SEM LOGIN.
--
--   validar_codigo_convite          js/auth.js:40
--   registrar_uso_codigo            js/auth.js:49
--     O cadastro de profissional acontece ANTES de existir sessao.
--
-- Nenhum outro caminho publico existe: `api/*.js` nao tocam o Supabase (falam
-- so com a Anthropic), `dashboard.html` e estatica, e as demais paginas exigem
-- login.
--
-- O RISCO DESTE SCRIPT e assimetrico: revogar demais nao da erro na tela de
-- quem roda — da erro no paciente que nao consegue enviar o questionario, ou
-- no profissional novo que nao consegue se cadastrar. Por isso a conferencia
-- no fim NOMEIA as cinco em vez de so contar.
--
-- Desfazer: db/hardening_execute_publico_desfazer.sql
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

do $$
declare
  r          record;
  v_anon     int := 0;
  v_revogadas int := 0;
begin
  -- 1 e 2) Fecha tudo, e devolve a quem esta logado.
  for r in
    select p.oid,
           quote_ident(n.nspname) || '.' || quote_ident(p.proname) as nome,
           pg_get_function_identity_arguments(p.oid)               as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s(%s) from public', r.nome, r.args);
    execute format('revoke all on function %s(%s) from anon', r.nome, r.args);
    execute format('grant execute on function %s(%s) to authenticated', r.nome, r.args);
    v_revogadas := v_revogadas + 1;
  end loop;

  -- 3) Devolve anon so ao que roda sem sessao. As assinaturas sao resolvidas
  -- aqui e nao escritas a mao: errar um tipo de argumento faria o grant cair
  -- numa sobrecarga que nao existe, sem erro visivel.
  for r in
    select quote_ident(n.nspname) || '.' || quote_ident(p.proname) as nome,
           pg_get_function_identity_arguments(p.oid)               as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname in ('rpc_buscar_paciente_por_codigo',
                        'rpc_salvar_respostas',
                        'rpc_marcar_completo',
                        'validar_codigo_convite',
                        'registrar_uso_codigo')
  loop
    execute format('grant execute on function %s(%s) to anon', r.nome, r.args);
    v_anon := v_anon + 1;
  end loop;

  raise notice 'Funcoes fechadas: %. Devolvidas a anon: %.', v_revogadas, v_anon;

  if v_anon < 5 then
    raise exception
      'Esperava devolver anon a 5 funcoes e devolvi a %. Alguma nao existe com esse nome — NAO deixe assim: o cadastro ou a anamnese vao quebrar.', v_anon;
  end if;
end $$;


-- ===========================================================================
-- 4) DEFAULT PRIVILEGES — para funcao nova nao nascer aberta
-- ---------------------------------------------------------------------------
-- Sem isto o proximo `create function` recria o grant para PUBLIC.
-- `supabase_admin` vai separado porque exige ser membro do papel; se falhar,
-- o aviso aparece e o resto continua valendo.
-- ===========================================================================
alter default privileges in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from public;

do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke execute on functions from public';
  raise notice 'Default privilege de supabase_admin ajustado.';
exception when others then
  raise notice 'Nao consegui ajustar o default de supabase_admin (%). Funcao criada por ele ainda nascera aberta.', sqlerrm;
end $$;


-- ===========================================================================
-- Conferencia. Esperado: anon_executa 5, e as cinco NOMEADAS abaixo.
-- ===========================================================================
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f')                        as total_funcoes,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute'))                as anon_executa,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and has_function_privilege('authenticated', p.oid, 'execute'))       as auth_executa;

select p.proname as ainda_aberta_para_anon
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and has_function_privilege('anon', p.oid, 'execute')
order by p.proname;
