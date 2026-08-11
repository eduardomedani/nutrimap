-- ===========================================================================
-- Evollo · ORGANIZACAO PROPRIA PARA A SEGUNDA CONTA DE NUTRICIONISTA
-- ---------------------------------------------------------------------------
-- NAO APLICADO. Preparado para revisao; so rode depois de aprovar.
--
-- Decisao registrada: opcao A — organizacao propria, sem mover nenhum dado.
--
-- 100% re-executavel. Desfazer: db/organizacao_caio_bootstrap_desfazer.sql
--
-- ===========================================================================
-- A IDEIA INTEIRA CABE EM UMA LINHA: organizacoes.id = auth.uid() do dono
-- ---------------------------------------------------------------------------
-- E a mesma estrategia da organizacao principal, e existe por um motivo so:
-- todo dado do Caio ja aponta para o uuid da conta dele via `nutri_id`. Se a
-- organizacao nascer com ESSE MESMO uuid como id, entao no dia em que a policy
-- trocar `nutri_id = auth.uid()` por `nutri_id = organizacao_do_auth()`, os
-- dois lados continuam devolvendo o mesmo valor.
--
-- Consequencia pratica: ZERO UPDATE. O paciente dele nao e tocado, o evento de
-- timeline nao e tocado, o registro em codigos_uso nao e tocado. Nao ha
-- migracao de dado — ha criacao de duas linhas de metadado.
--
-- Storage: ele nao tem nenhum objeto (script 73, `objetos no Storage = 0`).
-- Nao ha caminho de arquivo para reescrever. Se um dia tiver, o caminho ja
-- comeca pelo uuid dele, e pela mesma razao continuaria valendo.
--
-- ===========================================================================
-- O QUE ESTE SCRIPT NAO FAZ, DE PROPOSITO
-- ---------------------------------------------------------------------------
-- . NAO adiciona ninguem a public.admins. `admins` e o painel do SaaS, nao o
--   papel de dono da propria clinica. O Caio nao esta la hoje, e criar a
--   organizacao dele nao e motivo para colocar — seriam duas coisas diferentes
--   decididas por um comando so.
-- . NAO mexe em pacientes, avaliacoes, respostas, codigos_uso nem em nenhuma
--   tabela de dado. Nenhum `update` neste arquivo.
-- . NAO altera a organizacao principal.
-- . NAO cria perfil novo: usa o perfil padrao `proprietario`, o mesmo da
--   organizacao principal, cujo pacote e o catalogo inteiro por construcao
--   (`cross join public.permissoes`).
--
-- ===========================================================================
-- DUAS CONSEQUENCIAS QUE PRECISAM SER DITAS ANTES, NAO DEPOIS
-- ---------------------------------------------------------------------------
-- 1) `organizacoes.proprietario_user_id` tem `on delete restrict`. Depois deste
--    script, APAGAR A CONTA DO CAIO passa a ser bloqueado enquanto a
--    organizacao existir. Isso e desejado — hoje apagar a conta levaria o
--    paciente dele junto, por cascata de nutricionistas -> pacientes — mas e
--    uma porta que se fecha, e desfazer exige rodar o par de desfazer.
--
-- 2) Passa a haver DUAS linhas em public.organizacoes. Scripts de conferencia
--    que resolvem "a organizacao" com `order by criado_em limit 1` continuam
--    pegando a principal, porque ela nasceu antes — mas passam a depender
--    dessa ordem, o que antes era irrelevante. Os que fazem isso hoje: 77 e
--    83. Nenhum dos dois decide nada; so leem.
-- ===========================================================================


do $$
declare
  -- A conta, identificada por e-mail e conferida contra o uuid. Os dois juntos
  -- porque um sozinho e fragil: e-mail pode ter sido trocado, uuid colado a mao
  -- pode estar errado. Se os dois nao baterem, o script para.
  v_email  constant text := 'caio.eduardo88@hotmail.com';
  v_uid    constant uuid := 'bc631909-3c59-459d-817a-fd0fd218879c';

  v_achado uuid;
  v_nome   text;
  v_perfil uuid;
  v_org    uuid;
  v_n      integer;
begin

  -- ── 1) A conta existe e e a que se espera ───────────────────────────────
  select u.id into v_achado from auth.users u where lower(u.email) = v_email;

  if v_achado is null then
    raise exception 'ABORTADO: nao existe conta com o e-mail %.', v_email;
  end if;

  if v_achado <> v_uid then
    raise exception 'ABORTADO: o e-mail % pertence a %, e nao a % como este script supunha. Confira antes de rodar.',
      v_email, v_achado, v_uid;
  end if;

  -- ── 2) Ele tem linha de nutricionista, e o nome vem de la ───────────────
  select nullif(btrim(n.nome), '') into v_nome
    from public.nutricionistas n where n.id = v_uid;

  if not found then
    raise exception 'ABORTADO: % nao tem linha em public.nutricionistas.', v_email;
  end if;

  -- Nome derivado do estado, nunca inventado. Mesma regra da fundacao.
  v_nome := coalesce(v_nome, v_email);

  -- ── 3) Ele NAO pode estar em admins ─────────────────────────────────────
  -- Guarda explicita porque `admins` foi o sinal que a Etapa 2 usou para
  -- descobrir o proprietario da instalacao. Se o Caio aparecesse la, este
  -- script estaria criando uma segunda organizacao para quem o banco considera
  -- dono do SaaS — e isso precisa de decisao humana, nao de `if`.
  if exists (select 1 from public.admins a where a.user_id = v_uid) then
    raise exception 'ABORTADO: % esta em public.admins. Decida o papel dele antes de criar organizacao.', v_email;
  end if;

  -- ── 4) Ele nao pode ja pertencer a uma organizacao ──────────────────────
  select ou.organizacao_id into v_achado
    from public.organizacao_usuarios ou where ou.auth_user_id = v_uid;

  if found then
    raise exception 'ABORTADO: % ja e membro da organizacao %. Este script nao move ninguem de organizacao.',
      v_email, v_achado;
  end if;

  -- ── 5) O perfil padrao de proprietario precisa existir ──────────────────
  select p.id into v_perfil
    from public.perfis p where p.organizacao_id is null and p.chave = 'proprietario';

  if v_perfil is null then
    raise exception 'ABORTADO: perfil padrao "proprietario" nao foi semeado. Rode db/organizacao_schema.sql antes.';
  end if;

  -- ── 6) A organizacao ────────────────────────────────────────────────────
  -- id = uuid da conta. E o que faz `nutri_id = organizacao_do_auth()` valer
  -- para os dados que ja existem, sem um unico update.
  insert into public.organizacoes (id, nome, proprietario_user_id, ativo)
  values (v_uid, v_nome, v_uid, true)
  on conflict (id) do nothing;

  -- ── 7) O vinculo ────────────────────────────────────────────────────────
  insert into public.organizacao_usuarios (organizacao_id, auth_user_id, nome, perfil_id, status)
  values (v_uid, v_uid, v_nome, v_perfil, 'ativo')
  on conflict (auth_user_id) do nothing;

  -- ── 8) Conferencia imediata, dentro da mesma transacao ──────────────────
  -- Se qualquer uma falhar, nada e gravado. Vale mais do que conferir depois:
  -- um `select` posterior nao desfaz um insert torto.
  select o.id into v_org from public.organizacoes o where o.id = v_uid;
  if v_org is null then
    raise exception 'ABORTADO: a organizacao nao foi criada.';
  end if;

  if not exists (
    select 1 from public.organizacao_usuarios ou
     where ou.auth_user_id = v_uid and ou.organizacao_id = v_uid
       and ou.perfil_id = v_perfil and ou.status = 'ativo'
  ) then
    raise exception 'ABORTADO: o vinculo nao ficou como esperado.';
  end if;

  select count(*) into v_n from public.pacientes p where p.nutri_id = v_uid;

  raise notice 'Organizacao criada: % (%). Proprietario %, % paciente(s) intocado(s).',
    v_nome, v_uid, v_email, v_n;
end $$;


-- ===========================================================================
-- Conferencia. Esperado:
--   organizacoes = 2 · a do Caio com id = proprietario_user_id
--   vinculo = proprietario / ativo
--   pacientes_do_caio = 1  (o MESMO de antes: nenhum update foi feito)
--   em_admins = false
-- ===========================================================================
select
  (select count(*) from public.organizacoes)                              as organizacoes,
  (select o.nome from public.organizacoes o
    where o.id = 'bc631909-3c59-459d-817a-fd0fd218879c')                  as nome_da_nova,
  (select o.id = o.proprietario_user_id from public.organizacoes o
    where o.id = 'bc631909-3c59-459d-817a-fd0fd218879c')                  as id_igual_ao_dono,
  (select p.chave from public.organizacao_usuarios ou
     join public.perfis p on p.id = ou.perfil_id
    where ou.auth_user_id = 'bc631909-3c59-459d-817a-fd0fd218879c')       as perfil,
  (select ou.status from public.organizacao_usuarios ou
    where ou.auth_user_id = 'bc631909-3c59-459d-817a-fd0fd218879c')       as status,
  (select count(*) from public.pacientes p
    where p.nutri_id = 'bc631909-3c59-459d-817a-fd0fd218879c')            as pacientes_do_caio,
  (select exists (select 1 from public.admins a
    where a.user_id = 'bc631909-3c59-459d-817a-fd0fd218879c'))            as em_admins;
