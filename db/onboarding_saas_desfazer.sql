-- ===========================================================================
-- Evollo · DESFAZER O ONBOARDING DO SaaS — o gatilho volta ao que era
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE. Devolve handle_new_user() ao corpo de antes e reabre
-- registrar_uso_codigo como estava.
-- Desfaz: db/onboarding_saas.sql
--
-- O CORPO ABAIXO E O DO BASELINE, COPIADO — nao reescrito de memoria. E o
-- retrato lido do banco em 11/08/2026 (db/auth_signup_baseline.sql): SECURITY
-- DEFINER, SEM search_path, uma linha em nutricionistas e mais nada. O teste
-- test/onboarding-saas.test.mjs confere que os dois continuam iguais.
--
-- `create or replace` sem `set search_path` LIMPA o search_path que a migration
-- fixou — e isso e o desfazer correto: volta exatamente ao estado de antes.
--
-- ===========================================================================
-- A CHECK DA AUDITORIA VOLTA — QUANDO DER
-- ---------------------------------------------------------------------------
-- O desfazer restaura a lista de 7 acoes SE nenhuma linha de auditoria estiver
-- usando 'organizacao_criada_no_cadastro'. Se alguma estiver, a CHECK fica
-- ampliada e o script AVISA quantas sao: estreitar falharia, e apagar
-- auditoria para conseguir desfazer e o contrario de auditoria. Manter a lista
-- ampliada nao quebra nada — ela contem a antiga, e so aceita uma acao que,
-- sem o gatilho novo, ninguem mais grava.
--
-- NAO apaga as organizacoes criadas pelo cadastro enquanto a migration esteve
-- no ar. Elas sao de clientes reais; desfazer o gatilho nao desfaz o cliente.
--
-- DEPOIS DE RODAR: volte a chamada `registrarUsoCodigo` no index.html (git
-- revert do commit do front), senao o convite deixa de ser consumido.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/onboarding_saas_desfazer_LIMPO.sql
-- ===========================================================================

begin;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.nutricionistas (id, nome, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', NEW.email),
    NEW.email
  );
  RETURN NEW;
END;
$function$;

-- O estado de antes: anon e authenticated executavam (hardening, passo 3).
grant execute on function public.registrar_uso_codigo(text, uuid, text) to anon, authenticated;

-- A CHECK da auditoria volta a ter as 7 acoes — se nenhuma linha usar a oitava.
do $volta_check$
declare
  n int;
begin
  select count(*) into n
    from public.organizacao_auditoria
   where acao = 'organizacao_criada_no_cadastro';

  if n > 0 then
    raise notice 'CHECK MANTIDA AMPLIADA: % linha(s) de auditoria usam organizacao_criada_no_cadastro. Estreitar falharia, e apagar auditoria para desfazer e o contrario de auditoria.', n;
    return;
  end if;

  alter table public.organizacao_auditoria drop constraint if exists organizacao_auditoria_acao_check;
  alter table public.organizacao_auditoria add  constraint organizacao_auditoria_acao_check
    check (acao in ('codigo_gerado', 'codigo_revogado', 'vinculo_realizado',
                    'perfil_alterado', 'permissao_alterada',
                    'usuario_bloqueado', 'usuario_reativado'));
  raise notice 'CHECK restaurada com as 7 acoes de antes.';
end;
$volta_check$;

commit;


-- ---------------------------------------------------------------------------
-- CONFERENCIA — esperado: search_path_fixo false · ramo_convite false ·
--               anon_registra true · auth_registra true
--
-- `check_ampliada` depende do que existir: false quando a CHECK voltou as 7
-- acoes, true quando ficou ampliada porque ja havia auditoria usando a oitava
-- (o bloco acima avisa qual dos dois aconteceu).
-- ---------------------------------------------------------------------------
select coalesce('search_path=public' = any (p.proconfig), false)                   as search_path_fixo,
       p.prosrc ilike '%raw_user_meta_data->>''convite''%'                          as ramo_convite,
       (select pg_get_constraintdef(k.oid) ilike '%organizacao_criada_no_cadastro%'
          from pg_constraint k
         where k.conname = 'organizacao_auditoria_acao_check')                      as check_ampliada,
       has_function_privilege('authenticated', 'public.registrar_uso_codigo(text, uuid, text)', 'execute') as auth_registra,
       has_function_privilege('anon', 'public.registrar_uso_codigo(text, uuid, text)', 'execute') as anon_registra
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'handle_new_user';
