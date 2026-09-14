-- ===========================================================================
-- Evollo · ONBOARDING DO SaaS — conta + organizacao ativa + vinculo ativo,
--          na mesma transacao do cadastro
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE. Substitui a funcao do gatilho do cadastro, amplia uma
-- CHECK e fecha uma RPC que ficou sem chamador.
-- Desfazer:    db/onboarding_saas_desfazer.sql
-- Conferencia: db/conferencia/141_onboarding_saas_confere.sql
--
-- 100% re-executavel. Tudo dentro de UMA transacao (`begin` ... `commit`): se
-- qualquer parte falhar, nada muda.
--
-- ===========================================================================
-- O DEFEITO
-- ---------------------------------------------------------------------------
-- O cadastro pelo convite do SaaS criava a conta (`auth.signUp`) e, pelo
-- gatilho, a linha em `nutricionistas`. NADA criava a organizacao nem o
-- vinculo: `registrar_uso_codigo` so contava o uso do convite, e era
-- best-effort. O profissional novo entrava num painel vazio que a RLS nao
-- deixava usar — e, desde o portao do painel (a68c25e), recebia o aviso "sem
-- acesso". Tentar de novo dava "e-mail ja cadastrado". Beco sem saida.
--
-- De quebra, validar e consumir eram separados (validar ANTES do signUp,
-- consumir DEPOIS): dois cadastros simultaneos passavam na validacao de um
-- convite de uso unico.
--
-- ===========================================================================
-- A REGRA — decidida pelo Eduardo
-- ---------------------------------------------------------------------------
--   cadastro profissional concluido = conta + organizacao ativa + vinculo ativo
--   se uma das tres partes falhar, o onboarding NAO esta concluido
--
-- A UNICA forma de as tres serem tudo-ou-nada e acontecerem na MESMA
-- transacao. O gatilho `on_auth_user_created` e AFTER INSERT em auth.users —
-- roda dentro da transacao que cria a conta. Um `raise` aqui desfaz tambem o
-- insert em auth.users: a conta nao chega a existir.
--
-- O Auth esconde a mensagem do `raise` e devolve so "Database error saving new
-- user"; a tela traduz (mensagemAmigavel, no index.html). Os casos comuns
-- (convite invalido, expirado, esgotado) ja sao pegos ANTES, por
-- `validar_codigo_convite` — o gatilho e a guarda final contra a corrida.
--
-- ===========================================================================
-- QUEM PASSA PELO RAMO NOVO — e quem NAO passa
-- ---------------------------------------------------------------------------
-- O ramo so roda quando o signUp manda `convite` no metadata, e so o caminho
-- do SaaS no index.html manda. Aluno (app.html), colaborador (equipe.html),
-- convite de organizacao `EVL-` e "Add user" do painel do Supabase NAO mandam
-- — e para eles o gatilho faz EXATAMENTE o que fazia: uma linha em
-- `nutricionistas`, com o mesmo `coalesce(nome, email)`.
--
-- ===========================================================================
-- A ORGANIZACAO NASCE COM O ID DA CONTA DO DONO
-- ---------------------------------------------------------------------------
-- E a estrategia da fundacao (db/organizacao_schema.sql, Etapa 2) e do
-- bootstrap manual: `organizacoes.id = auth.uid()` do proprietario. O vinculo
-- usa o perfil `proprietario`, que e GLOBAL e ja recebe todas as permissoes
-- (perfis x permissoes) — organizacao nova nao precisa de carga propria.
--
-- ===========================================================================
-- TRES COISAS NESTE ARQUIVO, NA ORDEM EM QUE PRECISAM ACONTECER
-- ---------------------------------------------------------------------------
--   1) a CHECK de organizacao_auditoria ganha 'organizacao_criada_no_cadastro'.
--      ANTES da funcao: com a lista antiga, o insert de auditoria violaria a
--      CHECK, o `raise` desfaria tudo, e NENHUM cadastro do SaaS completaria.
--      As 7 acoes que ja existiam continuam todas.
--
--   2) handle_new_user() com o ramo novo e `set search_path = public`. O
--      search_path fecha o achado 1 do baseline (db/auth_signup_baseline.sql):
--      definer sem search_path fixo resolve nomes pelo search_path de quem
--      dispara — e agora a funcao grava organizacao, vinculo e consumo de
--      convite com privilegio elevado.
--
--   3) registrar_uso_codigo sai de anon e authenticated. Ela ficou sem
--      chamador (o consumo passou para o gatilho) e, aberta a anon, deixava
--      qualquer um gastar usos de convite e gravar log com id e e-mail
--      inventados. O hardening (db/hardening_execute_publico.sql) foi ajustado
--      junto, senao a proxima execucao dele a reabriria.
--
-- ===========================================================================
-- A FONTE DA VERDADE DE handle_new_user PASSA A SER ESTE ARQUIVO
-- ---------------------------------------------------------------------------
-- db/auth_signup_baseline.sql continua como retrato de 11/08/2026. A
-- conferencia 70 deixou de comparar a funcao (senao ficaria vermelha para
-- sempre); a 141 compara o banco com este arquivo. O gatilho
-- `on_auth_user_created` nao muda, e continua comparado pela 70.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/onboarding_saas_LIMPO.sql
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) A CHECK DA AUDITORIA — as 7 de antes + a do cadastro
-- ---------------------------------------------------------------------------
alter table public.organizacao_auditoria drop constraint if exists organizacao_auditoria_acao_check;
alter table public.organizacao_auditoria add  constraint organizacao_auditoria_acao_check
  check (acao in ('codigo_gerado', 'codigo_revogado', 'vinculo_realizado',
                  'perfil_alterado', 'permissao_alterada',
                  'usuario_bloqueado', 'usuario_reativado',
                  'organizacao_criada_no_cadastro'));


-- ---------------------------------------------------------------------------
-- 2) O GATILHO DO CADASTRO
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_convite text := nullif(btrim(new.raw_user_meta_data->>'convite'), '');
  v_nome    text := coalesce(nullif(btrim(new.raw_user_meta_data->>'nome'), ''), new.email);
  c         record;
  v_perfil  uuid;
  v_vinculo uuid;
begin
  -- O que o gatilho sempre fez, igual: toda conta nova ganha a linha em
  -- nutricionistas, com o mesmo coalesce de antes.
  insert into public.nutricionistas (id, nome, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', new.email), new.email);

  -- Sem convite no metadata: aluno, colaborador, EVL-, painel do Supabase.
  -- Termina aqui, exatamente como antes.
  if v_convite is null then
    return new;
  end if;

  -- O CONVITE, travado. `for update` e o que resolve a corrida: o segundo
  -- cadastro simultaneo espera o primeiro terminar e ja encontra o uso somado.
  select * into c
    from public.codigos_convite
   where upper(codigo) = upper(v_convite)
   for update;

  if c.id is null or c.ativo is not true then
    raise exception 'onboarding_convite_invalido';
  end if;
  if c.expira_em is not null and c.expira_em < now() then
    raise exception 'onboarding_convite_expirado';
  end if;
  if coalesce(c.usos_atuais, 0) >= coalesce(c.usos_maximo, 1) then
    raise exception 'onboarding_convite_esgotado';
  end if;

  select id into v_perfil
    from public.perfis
   where organizacao_id is null and chave = 'proprietario';
  if v_perfil is null then
    raise exception 'onboarding_sem_perfil_proprietario';
  end if;

  -- A ORGANIZACAO e o VINCULO. `on conflict do nothing` nos dois: uma conta
  -- recem-criada nao tem como colidir, mas se colidir a conferencia logo abaixo
  -- decide — nada e dado como pronto so porque o insert nao reclamou.
  insert into public.organizacoes (id, nome, proprietario_user_id, ativo)
  values (new.id, v_nome, new.id, true)
  on conflict (id) do nothing;

  -- `returning` separa "existe" de "NASCEU AQUI". Sem ele, um disparo repetido
  -- para a mesma conta encontraria o vinculo pronto, passaria pela conferencia
  -- da regra e somaria o uso do convite DE NOVO. Com ele, o consumo la embaixo
  -- so acontece quando esta linha foi criada nesta execucao.
  insert into public.organizacao_usuarios (organizacao_id, auth_user_id, nome, perfil_id, status)
  values (new.id, new.id, v_nome, v_perfil, 'ativo')
  on conflict (auth_user_id) do nothing
  returning id into v_vinculo;

  -- A REGRA, conferida: organizacao ativa + vinculo ativo DELA. Qualquer
  -- outra coisa e onboarding incompleto — e o raise desfaz a conta junto.
  if not exists (
    select 1
      from public.organizacao_usuarios ou
      join public.organizacoes o on o.id = ou.organizacao_id
     where ou.auth_user_id   = new.id
       and ou.organizacao_id = new.id
       and ou.status = 'ativo'
       and o.ativo
  ) then
    raise exception 'onboarding_incompleto';
  end if;

  -- IDEMPOTENCIA: se o vinculo ja existia, a organizacao e o vinculo estao
  -- certos (a conferencia acima acabou de provar) e NAO ha uso novo a
  -- registrar. Sair aqui e o que impede consumo duplicado.
  if v_vinculo is null then
    return new;
  end if;

  -- O CONSUMO so acontece quando o vinculo nasceu — nunca antes.
  update public.codigos_convite
     set usos_atuais = coalesce(usos_atuais, 0) + 1
   where id = c.id;

  insert into public.codigos_uso (codigo_id, nutri_id, email)
  values (c.id, new.id, new.email);

  -- `usuario_autor` EXPLICITO: o default e auth.uid(), que e NULL dentro deste
  -- gatilho (quem insere e o Auth, nao o usuario). Sem isto, a coluna NOT NULL
  -- derrubaria o cadastro.
  insert into public.organizacao_auditoria (organizacao_id, usuario_alvo, usuario_autor, acao, depois)
  values (new.id, new.id, new.id, 'organizacao_criada_no_cadastro',
          jsonb_build_object('convite', c.id, 'email', new.email));

  return new;
end;
$function$;


-- ---------------------------------------------------------------------------
-- 3) A RPC QUE FICOU SEM CHAMADOR
-- ---------------------------------------------------------------------------
revoke all on function public.registrar_uso_codigo(text, uuid, text) from public, anon, authenticated;

commit;


-- ---------------------------------------------------------------------------
-- CONFERENCIA RAPIDA — a completa e a 141
-- ---------------------------------------------------------------------------
-- Esperado: search_path_fixo true · ramo_convite true · check_aceita true ·
--           anon_registra false · auth_registra false · anon_valida true
-- ---------------------------------------------------------------------------
select coalesce('search_path=public' = any (p.proconfig), false)                            as search_path_fixo,
       p.prosrc ilike '%raw_user_meta_data->>''convite''%'                                   as ramo_convite,
       (select pg_get_constraintdef(k.oid) ilike '%organizacao_criada_no_cadastro%'
          from pg_constraint k
         where k.conname = 'organizacao_auditoria_acao_check')                               as check_aceita,
       has_function_privilege('anon', 'public.registrar_uso_codigo(text, uuid, text)', 'execute')          as anon_registra,
       has_function_privilege('authenticated', 'public.registrar_uso_codigo(text, uuid, text)', 'execute') as auth_registra,
       has_function_privilege('anon', 'public.validar_codigo_convite(text)', 'execute')                    as anon_valida
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'handle_new_user';
