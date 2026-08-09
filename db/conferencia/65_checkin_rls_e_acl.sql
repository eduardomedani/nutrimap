-- Check-ins · RLS e ACL. Rodar depois de db/checkin_schema.sql.

-- 65.1 RLS ligada nas seis. Esperado: rls = true em todas.
select relname as tabela, relrowsecurity as rls
  from pg_class
 where relname like 'checkin\_%' and relkind = 'r'
 order by relname;

-- 65.2 As policies. O que conferir com os proprios olhos:
--   . checkin_respostas NAO tem policy de INSERT/UPDATE/DELETE para ninguem
--     (quem grava e a RPC, como definer);
--   . cko_paciente_select filtra por paciente_do_auth() E por status;
--   . cka_nutri_insert tem os DOIS exists() (paciente e modelo da carteira);
--   . paciente nao tem policy nenhuma em modelos, perguntas e atribuicoes.
select tablename, policyname, cmd, roles, qual as usando, with_check as checando
  from pg_policies
 where schemaname='public' and tablename like 'checkin\_%'
 order by tablename, policyname;

-- 65.3 Escrita direta em respostas. Esperado: 0.
select count(*) as escrita_direta_em_respostas
  from pg_policies
 where schemaname='public' and tablename = 'checkin_respostas'
   and cmd in ('INSERT','UPDATE','DELETE');

-- 65.4 ACL das funcoes.
--
-- Esperado:
--   finalizar_checkin                 publico=f anon=f autenticado=t  definer=t
--   materializar_ocorrencia_checkin   publico=f anon=f autenticado=t  definer=t
--   registrar_auditoria_checkin       publico=f anon=f autenticado=f  definer=t
--   tocar_checkin                     publico=f anon=f autenticado=f
--
-- O `anon=f` e o que o modulo Documentos ensinou: o default privilege do
-- schema public concede EXECUTE a anon em toda funcao nova, e `revoke from
-- public` NAO tira um grant direto ao papel anon.
select p.proname as funcao,
       p.prosecdef as definer,
       p.proconfig  as search_path,
       coalesce(has_function_privilege('public',        p.oid, 'EXECUTE'), false) as publico,
       coalesce(has_function_privilege('anon',          p.oid, 'EXECUTE'), false) as anon,
       coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as autenticado
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public'
   and p.proname in ('finalizar_checkin','materializar_ocorrencia_checkin',
                     'registrar_auditoria_checkin','tocar_checkin')
 order by p.proname;

-- 65.5 Nada fora do modulo foi tocado. Compare com o valor de antes.
select count(*) as policies_dos_outros
  from pg_policies
 where schemaname in ('public','storage') and tablename not like 'checkin\_%';
