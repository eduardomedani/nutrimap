-- ===========================================================================
-- CONFERENCIA DA ETAPA 3 — Usuarios e acessos
-- ---------------------------------------------------------------------------
-- NAO PERSISTE NADA. Toda mutacao roda em subtransacao que se desfaz sozinha.
--
-- Confere o ESTADO REAL DO BANCO, e nao o que o arquivo de migration diz. As
-- guardas de test/usuarios-acessos.test.mjs leem SQL; estas leem catalogo e
-- executam comportamento. Aprovar uma coisa pela outra seria trocar evidencia
-- por intencao.
--
-- ACL EM ESPECIAL: nao basta existir REVOKE no arquivo. Aqui se pergunta ao
-- Postgres quem realmente pode executar cada funcao. E ha uma armadilha que so
-- o catalogo revela — `proacl` NULO significa o DEFAULT do Postgres, que para
-- funcao e EXECUTE PARA PUBLIC. Uma funcao "sem grant nenhum" e uma funcao
-- aberta para todo mundo.
--
-- Para colar no SQL Editor, use db/conferencia/74_organizacao_usuarios_admin_LIMPO.sql
-- ===========================================================================

drop table if exists conf74;
create temp table conf74 (ordem int, teste text, resultado text, detalhe text);

do $$
declare
  v_org      uuid;
  v_owner    uuid;
  v_usuario  uuid;
  v_perfil   uuid;
  v_recep    uuid;
  v_codigo   text;
  v_conv     uuid;
  v_orfao    uuid;
  v_ok       boolean;
  v_det      text;
  v_n        integer;
  v_total    integer;
begin
  select o.id, o.proprietario_user_id into v_org, v_owner
    -- A organizacao da INSTALACAO, e nao "a primeira que aparecer". Desde que a
    -- conta do Caio ganhou organizacao propria, ha DUAS linhas em organizacoes, e
    -- `order by criado_em limit 1` deixou de dizer qual delas e — passou a depender
    -- de quem nasceu antes. O vinculo com public.admins e o mesmo sinal que a Etapa
    -- 2 usou para descobrir o proprietario da instalacao, e entrar em admins e um
    -- ato explicito. O Caio nao esta la.
    from public.organizacoes o join public.admins a on a.user_id = o.proprietario_user_id;
  select ou.id into v_usuario from public.organizacao_usuarios ou where ou.auth_user_id = v_owner;
  select p.id into v_perfil  from public.perfis p where p.organizacao_id is null and p.chave = 'proprietario';
  select p.id into v_recep   from public.perfis p where p.organizacao_id is null and p.chave = 'recepcao';
  select count(*) into v_total from public.permissoes;

  if v_org is null or v_usuario is null then
    insert into conf74 values (0, 'pre-requisito', 'FALHOU', 'Fundacao da Etapa 2 ausente');
    return;
  end if;

  -- ═══════════════ ESTRUTURA ═══════════════
  select count(*) into v_n from information_schema.tables
   where table_schema = 'public' and table_name in ('organizacao_convites','organizacao_auditoria');
  insert into conf74 values (1, 'as duas tabelas novas existem',
    case when v_n = 2 then 'OK' else 'FALHOU' end, v_n || ' de 2');

  select count(*) filter (where c.relrowsecurity) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('organizacao_convites','organizacao_auditoria');
  insert into conf74 values (2, 'RLS ativa nas duas',
    case when v_n = 2 then 'OK' else 'FALHOU' end, v_n || ' de 2');

  select count(*) filter (where c.relforcerowsecurity) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('organizacao_convites','organizacao_auditoria');
  insert into conf74 values (3, 'sem FORCE RLS',
    case when v_n = 0 then 'OK' else 'FALHOU' end, v_n || ' com force');

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename in ('organizacao_convites','organizacao_auditoria');
  insert into conf74 values (4, 'zero policies — so DEFINER entra',
    case when v_n = 0 then 'OK' else 'FALHOU' end, v_n || ' policy(s)');

  insert into conf74
  select 5, 'constraints de organizacao_convites',
    case when count(*) >= 4 then 'OK' else 'FALHOU' end,
    string_agg(conname, ', ' order by conname)
    from pg_constraint where conrelid = 'public.organizacao_convites'::regclass;

  insert into conf74
  select 6, 'indices de convite: unico, por organizacao e um aberto por e-mail',
    case when count(*) >= 3 then 'OK' else 'FALHOU' end,
    string_agg(indexname, ', ' order by indexname)
    from pg_indexes where schemaname = 'public' and tablename = 'organizacao_convites';

  insert into conf74
  select 7, 'CHECK das sete acoes de auditoria',
    case when count(*) = 1 then 'OK' else 'FALHOU' end,
    coalesce(string_agg(conname, ', '), '(ausente)')
    from pg_constraint
   where conrelid = 'public.organizacao_auditoria'::regclass
     and conname = 'organizacao_auditoria_acao_check';

  insert into conf74
  select 8, 'trigger do ultimo proprietario, antes de update e delete',
    case when count(*) = 1 then 'OK' else 'FALHOU' end,
    coalesce(string_agg(pg_get_triggerdef(oid), ' '), '(ausente)')
    from pg_trigger
   where tgrelid = 'public.organizacao_usuarios'::regclass
     and tgname = 'trg_protege_ultimo_proprietario' and not tgisinternal;

  -- ═══════════════ FUNCOES ═══════════════
  insert into conf74
  select 9, 'as 15 funcoes existem, definer e com search_path',
    case when count(*) = 15
          and bool_and(p.prosecdef)
          and bool_and(exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
         then 'OK' else 'FALHOU' end,
    count(*) || ' de 15'
      || case when bool_and(p.prosecdef) then '' else ' / ALGUMA E INVOKER' end
      || case when bool_and(exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
              then '' else ' / ALGUMA SEM SEARCH_PATH' end
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('gerar_codigo_organizacao','fn_protege_ultimo_proprietario','exige_permissao',
                       'usuario_convidar','usuario_vincular','usuario_definir_perfil',
                       'usuario_definir_status','usuario_definir_permissao','usuario_convite_revogar',
                       'usuarios_da_organizacao','convites_pendentes','permissoes_do_usuario',
                       'registrar_meu_acesso','contas_fora_da_organizacao','conta_externa_detalhe');

  -- ═══════════════ ACL REAL ═══════════════
  -- proacl NULO = default do Postgres = EXECUTE para PUBLIC. Uma funcao sem
  -- grant nenhum e uma funcao aberta, e so o catalogo mostra isso.
  insert into conf74
  select 10, 'INTERNAS: anon nao, PUBLIC nao, authenticated nao',
    case when bool_and(
           not has_function_privilege('anon', p.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and p.proacl is not null
       and not exists (select 1 from unnest(p.proacl) a where a::text like '=%')
    ) then 'OK' else 'FALHOU' end,
    string_agg(p.proname || ': anon=' ||
      case when has_function_privilege('anon', p.oid, 'EXECUTE') then 'SIM' else 'nao' end ||
      ' auth=' ||
      case when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'SIM' else 'nao' end ||
      ' public=' ||
      case when p.proacl is null then 'SIM(acl nula)'
           when exists (select 1 from unnest(p.proacl) a where a::text like '=%') then 'SIM'
           else 'nao' end, ' | ' order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('exige_permissao','gerar_codigo_organizacao','fn_protege_ultimo_proprietario');

  insert into conf74
  select 11, 'EXPOSTAS: anon nao, PUBLIC nao, authenticated SIM',
    case when bool_and(
           not has_function_privilege('anon', p.oid, 'EXECUTE')
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and p.proacl is not null
       and not exists (select 1 from unnest(p.proacl) a where a::text like '=%')
    ) then 'OK' else 'FALHOU' end,
    string_agg(p.proname || ': anon=' ||
      case when has_function_privilege('anon', p.oid, 'EXECUTE') then 'SIM' else 'nao' end ||
      ' auth=' ||
      case when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'sim' else 'NAO' end ||
      ' public=' ||
      case when p.proacl is null then 'SIM(acl nula)'
           when exists (select 1 from unnest(p.proacl) a where a::text like '=%') then 'SIM'
           else 'nao' end, ' | ' order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('usuario_convidar','usuario_vincular','usuario_definir_perfil',
                       'usuario_definir_status','usuario_definir_permissao','usuario_convite_revogar',
                       'usuarios_da_organizacao','convites_pendentes','permissoes_do_usuario',
                       'registrar_meu_acesso','contas_fora_da_organizacao','conta_externa_detalhe');

  -- ═══════════════ ULTIMO PROPRIETARIO ═══════════════
  -- Direto por SQL, sem RPC: e o trigger que precisa provar que segura
  -- qualquer caminho, inclusive o SQL Editor.

  v_ok := false; v_det := '';
  begin
    update public.organizacao_usuarios set status = 'bloqueado' where id = v_usuario;
    v_det := 'NAO estourou — o ultimo proprietario foi bloqueado';
    raise exception 'REVERTER';
  exception when others then
    if sqlerrm = 'ultimo_proprietario' then v_ok := true; v_det := 'recusado: ultimo_proprietario';
    elsif sqlerrm <> 'REVERTER' then v_det := 'erro inesperado: ' || sqlerrm; end if;
  end;
  insert into conf74 values (12, 'BLOQUEAR o ultimo proprietario e recusado',
    case when v_ok then 'OK' else 'FALHOU' end, v_det);

  v_ok := false; v_det := '';
  begin
    delete from public.organizacao_usuarios where id = v_usuario;
    v_det := 'NAO estourou — o ultimo proprietario foi excluido';
    raise exception 'REVERTER';
  exception when others then
    if sqlerrm = 'ultimo_proprietario' then v_ok := true; v_det := 'recusado: ultimo_proprietario';
    elsif sqlerrm <> 'REVERTER' then v_det := 'erro inesperado: ' || sqlerrm; end if;
  end;
  insert into conf74 values (13, 'EXCLUIR o ultimo proprietario e recusado',
    case when v_ok then 'OK' else 'FALHOU' end, v_det);

  v_ok := false; v_det := '';
  begin
    update public.organizacao_usuarios set perfil_id = v_recep where id = v_usuario;
    v_det := 'NAO estourou — o ultimo proprietario foi rebaixado';
    raise exception 'REVERTER';
  exception when others then
    if sqlerrm = 'ultimo_proprietario' then v_ok := true; v_det := 'recusado: ultimo_proprietario';
    elsif sqlerrm <> 'REVERTER' then v_det := 'erro inesperado: ' || sqlerrm; end if;
  end;
  insert into conf74 values (14, 'REBAIXAR o ultimo proprietario e recusado',
    case when v_ok then 'OK' else 'FALHOU' end, v_det);

  -- ═══════════════ AUTOBLOQUEIO ═══════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

  v_ok := false; v_det := '';
  begin
    perform public.usuario_definir_status(v_usuario, 'bloqueado');
    v_det := 'NAO estourou — o proprietario bloqueou a si mesmo';
    raise exception 'REVERTER';
  exception when others then
    if sqlerrm = 'nao_pode_bloquear_a_si_mesmo' then
      v_ok := true; v_det := 'recusado: nao_pode_bloquear_a_si_mesmo';
    elsif sqlerrm = 'ultimo_proprietario' then
      v_ok := true; v_det := 'recusado pelo trigger: ultimo_proprietario';
    elsif sqlerrm <> 'REVERTER' then v_det := 'erro inesperado: ' || sqlerrm; end if;
  end;
  insert into conf74 values (15, 'ninguem bloqueia a si mesmo',
    case when v_ok then 'OK' else 'FALHOU' end, v_det);

  -- ═══════════════ CODIGO EVL ═══════════════
  -- UM convite, nao dezenas: tudo o que precisa ser provado sobre o codigo se
  -- prova com um, e o resto se prova alterando a linha dele.

  v_ok := false; v_det := '';
  begin
    v_codigo := public.usuario_convidar('Teste Conferencia', 'conferencia74@exemplo.invalido', 'recepcao', null);

    select id into v_conv from public.organizacao_convites where upper(codigo) = upper(v_codigo);

    if v_codigo !~ '^EVL-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$' then
      v_det := 'formato ou alfabeto errado: ' || v_codigo;
    elsif not exists (select 1 from public.organizacao_convites c
                       where c.id = v_conv and c.organizacao_id = v_org
                         and c.perfil_id = v_recep
                         and c.email = 'conferencia74@exemplo.invalido') then
      v_det := 'convite gravado com organizacao, perfil ou e-mail errados';
    elsif (select count(*) from public.organizacao_convites where upper(codigo) = upper(v_codigo)) <> 1 then
      v_det := 'codigo repetido';
    else
      v_ok := true;
      v_det := v_codigo || ' / organizacao e perfil corretos / alfabeto sem 0-O-1-I-L';
    end if;
    raise exception 'REVERTER';
  exception when others then
    if sqlerrm <> 'REVERTER' then v_ok := false; v_det := 'erro: ' || sqlerrm; end if;
  end;
  insert into conf74 values (16, 'codigo EVL-XXXXX: formato, alfabeto, organizacao, perfil, e-mail',
    case when v_ok then 'OK' else 'FALHOU' end, v_det);

  -- Uso unico, expiracao e revogacao: um convite por vez, com um uid que NAO e
  -- membro (senao `conta_ja_vinculada` dispara antes e nao se testa nada).
  v_orfao := gen_random_uuid();

  v_ok := false; v_det := '';
  begin
    v_codigo := public.usuario_convidar('Teste Usado', 'usado74@exemplo.invalido', 'recepcao', null);
    update public.organizacao_convites set usado_em = now() where upper(codigo) = upper(v_codigo);
    perform set_config('request.jwt.claims', json_build_object('sub', v_orfao)::text, true);
    begin
      perform public.usuario_vincular(v_codigo);
      v_det := 'NAO estourou — codigo usado foi aceito de novo';
    exception when others then
      if sqlerrm = 'codigo_usado' then v_ok := true; v_det := 'recusado: codigo_usado';
      else v_det := 'erro inesperado: ' || sqlerrm; end if;
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
    raise exception 'REVERTER';
  exception when others then
    if sqlerrm <> 'REVERTER' then v_ok := false; v_det := 'erro: ' || sqlerrm; end if;
  end;
  insert into conf74 values (17, 'codigo e de USO UNICO',
    case when v_ok then 'OK' else 'FALHOU' end, v_det);

  v_ok := false; v_det := '';
  begin
    v_codigo := public.usuario_convidar('Teste Expirado', 'expirado74@exemplo.invalido', 'recepcao', null);
    update public.organizacao_convites set expira_em = now() - interval '1 day'
     where upper(codigo) = upper(v_codigo);
    perform set_config('request.jwt.claims', json_build_object('sub', v_orfao)::text, true);
    begin
      perform public.usuario_vincular(v_codigo);
      v_det := 'NAO estourou — codigo expirado foi aceito';
    exception when others then
      if sqlerrm = 'codigo_expirado' then v_ok := true; v_det := 'recusado: codigo_expirado';
      else v_det := 'erro inesperado: ' || sqlerrm; end if;
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
    raise exception 'REVERTER';
  exception when others then
    if sqlerrm <> 'REVERTER' then v_ok := false; v_det := 'erro: ' || sqlerrm; end if;
  end;
  insert into conf74 values (18, 'codigo EXPIRA',
    case when v_ok then 'OK' else 'FALHOU' end, v_det);

  v_ok := false; v_det := '';
  begin
    v_codigo := public.usuario_convidar('Teste Revogado', 'revogado74@exemplo.invalido', 'recepcao', null);
    select id into v_conv from public.organizacao_convites where upper(codigo) = upper(v_codigo);
    perform public.usuario_convite_revogar(v_conv);
    perform set_config('request.jwt.claims', json_build_object('sub', v_orfao)::text, true);
    begin
      perform public.usuario_vincular(v_codigo);
      v_det := 'NAO estourou — codigo revogado foi aceito';
    exception when others then
      if sqlerrm = 'codigo_revogado' then v_ok := true; v_det := 'recusado: codigo_revogado';
      else v_det := 'erro inesperado: ' || sqlerrm; end if;
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
    raise exception 'REVERTER';
  exception when others then
    if sqlerrm <> 'REVERTER' then v_ok := false; v_det := 'erro: ' || sqlerrm; end if;
  end;
  insert into conf74 values (19, 'codigo pode ser REVOGADO',
    case when v_ok then 'OK' else 'FALHOU' end, v_det);

  -- ═══════════════ SEM PERMISSAO, SEM NADA ═══════════════
  v_ok := false; v_det := '';
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, true);
  begin
    perform public.usuario_convidar('Intruso', 'intruso@exemplo.invalido', 'recepcao', null);
    v_det := 'NAO estourou — quem nao e da organizacao convidou';
  exception when others then
    if sqlerrm in ('sem_organizacao','sem_permissao') then
      v_ok := true; v_det := 'recusado: ' || sqlerrm;
    else v_det := 'erro inesperado: ' || sqlerrm; end if;
  end;
  insert into conf74 values (20, 'quem nao e membro nao convida',
    case when v_ok then 'OK' else 'FALHOU' end, v_det);

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

  -- ═══════════════ NADA PERSISTIU ═══════════════
  select count(*) into v_n from public.organizacao_convites;
  insert into conf74 values (21, 'nenhum convite ficou gravado',
    case when v_n = 0 then 'OK' else 'ATENCAO' end,
    v_n || ' convite(s) na tabela');

  select count(*) into v_n from public.minhas_permissoes();
  select ou.status into v_det from public.organizacao_usuarios ou where ou.id = v_usuario;
  insert into conf74 values (22, 'proprietario intacto: ativo, Proprietario, catalogo completo',
    case when v_n = v_total and v_det = 'ativo'
          and exists (select 1 from public.organizacao_usuarios ou
                       join public.perfis p on p.id = ou.perfil_id
                      where ou.id = v_usuario and p.chave = 'proprietario')
         then 'OK' else 'FALHOU' end,
    v_n || '/' || v_total || ' permissoes / status=' || v_det);

  insert into conf74
  select 23, 'perfil Financeiro com as 5 aprovadas',
    case when string_agg(pp.permissao_chave, ',' order by pp.permissao_chave) =
              'clientes.visualizar,comercial.visualizar,financeiro.editar,financeiro.lancar,financeiro.visualizar'
         then 'OK' else 'FALHOU' end,
    coalesce(string_agg(pp.permissao_chave, ', ' order by pp.permissao_chave), '(vazio)')
    from public.perfil_permissoes pp
    join public.perfis p on p.id = pp.perfil_id
   where p.organizacao_id is null and p.chave = 'financeiro';

  insert into conf74 values (24, 'organizacao_do_auth() = auth.uid() para o proprietario',
    case when public.organizacao_do_auth() = v_owner then 'OK' else 'FALHOU' end,
    coalesce(public.organizacao_do_auth()::text, 'null') || ' / ' || v_owner::text);

end $$;

insert into conf74
select 99, 'VEREDITO',
  case when exists (select 1 from conf74 where resultado = 'FALHOU')
       then (select count(*)::text from conf74 where resultado = 'FALHOU') || ' FALHA(S)'
       when exists (select 1 from conf74 where resultado = 'ATENCAO')
       then (select count(*)::text from conf74 where resultado = 'ATENCAO') || ' ATENCAO'
       else 'ETAPA 3 VALIDADA NO BANCO' end,
  case when exists (select 1 from conf74 where resultado <> 'OK')
       then (select string_agg(ordem::text, ', ' order by ordem) from conf74 where resultado <> 'OK')
       else 'os 24 testes passaram' end;

select ordem, teste, resultado, detalhe from conf74 order by ordem;
