-- ===========================================================================
-- 141 · O ONBOARDING DO SaaS ESTA NO BANCO COMO A MIGRATION DIZ?
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. UMA consulta so.
--
-- POR QUE ELE EXISTE. A partir de db/onboarding_saas.sql, a fonte da verdade
-- de handle_new_user() e a migration, nao o baseline de 11/08. A conferencia
-- 70 deixou de comparar a funcao; esta aqui assume a comparacao.
--
-- Nao compara o corpo inteiro caractere a caractere: confere as marcas que,
-- se faltarem, quebram a REGRA — conta + organizacao ativa + vinculo ativo na
-- mesma transacao, e nada disso para quem nao manda convite.
--
-- ---------------------------------------------------------------------------
-- ESPERADO — uma linha, e todas as colunas assim:
--
--   definer                 true    a funcao grava com privilegio de dono
--   search_path_fixo        true    `set search_path = public`
--   ramo_convite            true    le raw_user_meta_data->>'convite'
--   sem_convite_sai_cedo    true    `if v_convite is null then return new`
--   trava_convite           true    `for update` em codigos_convite
--   confere_a_regra         true    `onboarding_incompleto`
--   consumo_so_se_criou     true    `returning id into v_vinculo` — o uso do
--                                   convite so e somado quando o vinculo nasce
--                                   naquela execucao, nunca quando ja existia
--   autor_explicito         true    usuario_autor = new.id (auth.uid() e NULL aqui)
--   gatilho_habilitado      true    on_auth_user_created segue ligado
--   check_aceita_cadastro   true    a auditoria aceita a acao nova
--   check_mantem_as_7       true    ...sem perder nenhuma das 7 de antes
--   perfil_proprietario     true    o perfil global que o vinculo usa
--   anon_registra           false   registrar_uso_codigo fechada
--   auth_registra           false   ...para authenticated tambem
--   anon_valida             true    validar_codigo_convite continua publica
--                                   (o cadastro valida ANTES de ter sessao)
-- ===========================================================================
select p.prosecdef                                                               as definer,
       coalesce('search_path=public' = any (p.proconfig), false)                 as search_path_fixo,
       p.prosrc ilike '%raw_user_meta_data->>''convite''%'                        as ramo_convite,
       p.prosrc ilike '%if v_convite is null then%return new;%'                  as sem_convite_sai_cedo,
       p.prosrc ilike '%from public.codigos_convite%for update%'                 as trava_convite,
       p.prosrc ilike '%onboarding_incompleto%'                                  as confere_a_regra,
       p.prosrc ilike '%returning id into v_vinculo%'                            as consumo_so_se_criou,
       p.prosrc ilike '%usuario_autor%new.id, new.id, new.id%'                   as autor_explicito,
       (select t.tgenabled = 'O'
          from pg_trigger t
         where t.tgname = 'on_auth_user_created' and not t.tgisinternal)         as gatilho_habilitado,
       (select pg_get_constraintdef(k.oid) ilike '%organizacao_criada_no_cadastro%'
          from pg_constraint k
         where k.conname = 'organizacao_auditoria_acao_check')                   as check_aceita_cadastro,
       (select bool_and(pg_get_constraintdef(k.oid) ilike '%' || a || '%')
          from pg_constraint k,
               unnest(array['codigo_gerado', 'codigo_revogado', 'vinculo_realizado',
                            'perfil_alterado', 'permissao_alterada',
                            'usuario_bloqueado', 'usuario_reativado']) as a
         where k.conname = 'organizacao_auditoria_acao_check')                   as check_mantem_as_7,
       exists (select 1 from public.perfis
                where organizacao_id is null and chave = 'proprietario')         as perfil_proprietario,
       has_function_privilege('anon', 'public.registrar_uso_codigo(text, uuid, text)', 'execute')          as anon_registra,
       has_function_privilege('authenticated', 'public.registrar_uso_codigo(text, uuid, text)', 'execute') as auth_registra,
       has_function_privilege('anon', 'public.validar_codigo_convite(text)', 'execute')                    as anon_valida
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'handle_new_user';
