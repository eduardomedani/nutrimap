-- ===========================================================================
-- CONFERENCIA DA ETAPA 2 — a PROVA de equivalencia e o motor de permissao
-- ---------------------------------------------------------------------------
-- NAO PERSISTE NADA. Simula identidade e testa comportamento dentro de
-- subtransacoes que se desfazem sozinhas.
--
-- Prova o invariante que e a licenca para a Etapa 4 existir:
--
--     para o proprietario atual,  organizacao_do_auth()  =  auth.uid()
--
-- Enquanto isso for verdade, trocar `nutri_id = auth.uid()` por
-- `nutri_id = organizacao_do_auth()` numa policy nao muda comportamento
-- nenhum — e por isso a migracao pode ser feita modulo a modulo.
--
-- ===========================================================================
-- POR QUE HA UMA TABELA TEMPORARIA AQUI
-- ---------------------------------------------------------------------------
-- Bloco DO nao devolve grade de resultado: a saida dele so aparece na aba de
-- mensagens do SQL Editor, e a grade diz "Success. No rows returned". A
-- primeira versao deste script era assim, e a evidencia se perdia.
--
-- Agora o DO grava numa tabela TEMPORARIA e o `select` do fim a devolve como
-- tabela — igual a todos os outros scripts de conferencia. Temp table vive so
-- nesta sessao e some quando ela fecha: nao e objeto do schema, nao entra em
-- backup, nao aparece para mais ninguem.
--
-- ===========================================================================
-- POR QUE UM DO, E NAO SELECTS SOLTOS
-- ---------------------------------------------------------------------------
-- auth.uid() le `request.jwt.claims`, que no SQL Editor esta vazio: a sessao
-- ali e a do papel `postgres`, sem JWT. Um select direto devolveria NULL e nao
-- provaria nada. A claim e posta com set_config(..., is_local => true), que
-- vale so ate o fim desta transacao e nao concede privilegio nenhum — e apenas
-- o texto que auth.uid() le.
--
-- E os seis testes de comportamento precisam ALTERAR (revogar, bloquear,
-- inativar) para ler o efeito. Cada um roda dentro de um bloco
-- `begin ... exception ... end`, que no plpgsql e uma subtransacao: a
-- alteracao acontece, o teste le, e um `raise` proposital desfaz antes do
-- proximo. O resultado sobrevive porque fica numa VARIAVEL, que nao e
-- transacional; a alteracao, nao.
--
-- Se o script for interrompido no meio, a subtransacao aberta cai junto e o
-- proprietario NAO fica bloqueado. O teste 11 existe para provar isso.
--
-- Para colar no SQL Editor, use db/conferencia/72_organizacao_equivalencia_LIMPO.sql
-- ===========================================================================

drop table if exists conf72;
create temp table conf72 (ordem int, teste text, resultado text, detalhe text);

do $$
declare
  v_owner    uuid;
  v_org      uuid;
  v_uid      uuid;
  v_usuario  uuid;
  v_orfao    uuid;
  v_total    integer;
  v_efetivas integer;
  v_status   text;
  v_ok       boolean;
  v_det      text;
begin
  -- A organizacao da INSTALACAO, e nao "a primeira que aparecer". Desde que a
  -- conta do Caio ganhou organizacao propria, ha DUAS linhas em organizacoes, e
  -- `order by criado_em limit 1` deixou de dizer qual delas e — passou a depender
  -- de quem nasceu antes. O vinculo com public.admins e o mesmo sinal que a Etapa
  -- 2 usou para descobrir o proprietario da instalacao, e entrar em admins e um
  -- ato explicito. O Caio nao esta la.
  select proprietario_user_id into v_owner from public.organizacoes o join public.admins a on a.user_id = o.proprietario_user_id;
  if v_owner is null then
    insert into conf72 values (0, 'pre-requisito', 'FALHOU', 'nao ha organizacao — rode db/organizacao_schema.sql antes');
    return;
  end if;

  select count(*) into v_total from public.permissoes;
  select ou.id into v_usuario from public.organizacao_usuarios ou where ou.auth_user_id = v_owner;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  v_uid := auth.uid();
  v_org := public.organizacao_do_auth();

  -- ── 1. A PROVA CENTRAL ───────────────────────────────────────────────────
  insert into conf72 values (1, 'organizacao_do_auth() = auth.uid()',
    case when v_uid = v_owner and v_org = v_uid then 'OK' else 'FALHOU' end,
    'auth.uid()=' || coalesce(v_uid::text,'null') || ' / organizacao=' || coalesce(v_org::text,'null'));

  -- ── 2. proprietario resolve para a organizacao correta ───────────────────
  insert into conf72 values (2, 'proprietario resolve para a organizacao correta',
    case when v_org = (select id from public.organizacoes where proprietario_user_id = v_owner)
         then 'OK' else 'FALHOU' end,
    coalesce(v_org::text, 'null'));

  -- ── 3. perfil Proprietario com catalogo completo ─────────────────────────
  select count(*) into v_efetivas from public.minhas_permissoes();
  insert into conf72 values (3, 'perfil Proprietario tem o catalogo completo',
    case when v_efetivas = v_total then 'OK' else 'FALHOU' end,
    v_efetivas || ' de ' || v_total);

  -- ── 4. tem_permissao responde pelo pacote ────────────────────────────────
  insert into conf72 values (4, 'tem_permissao() responde pelo pacote do perfil',
    case when public.tem_permissao('financeiro.visualizar') then 'OK' else 'FALHOU' end,
    'financeiro.visualizar');

  -- ── 5. chave desconhecida nega ───────────────────────────────────────────
  insert into conf72 values (5, 'chave fora do catalogo nega (deny by default)',
    case when public.tem_permissao('modulo.inexistente.' || gen_random_uuid()::text)
         then 'FALHOU' else 'OK' end,
    'chave aleatoria');

  -- ── 6. EXCECAO INDIVIDUAL REVOGA ─────────────────────────────────────────
  v_ok := false; v_det := '';
  begin
    insert into public.usuario_permissoes (usuario_id, permissao_chave, concede)
    values (v_usuario, 'financeiro.visualizar', false);

    if public.tem_permissao('financeiro.visualizar') then
      v_det := 'concede=false nao revogou';
    elsif exists (select 1 from public.minhas_permissoes() m where m = 'financeiro.visualizar') then
      v_det := 'revogada ainda aparece em minhas_permissoes()';
    else
      select count(*) into v_efetivas from public.minhas_permissoes();
      if v_efetivas <> v_total - 1 then
        v_det := 'esperava ' || (v_total - 1) || ' permissoes, vieram ' || v_efetivas;
      else
        v_ok := true;
        v_det := v_total || ' -> ' || v_efetivas || ', e a chave sumiu da lista';
      end if;
    end if;
    raise exception 'REVERTER';
  exception when others then
    if sqlerrm <> 'REVERTER' then v_ok := false; v_det := 'erro: ' || sqlerrm; end if;
  end;
  insert into conf72 values (6, 'excecao individual REVOGA o que o perfil dava',
    case when v_ok then 'OK' else 'FALHOU' end, v_det);

  -- ── 7 e 8. AUSENCIA NEGA, e EXCECAO CONCEDE sobre a ausencia ─────────────
  v_ok := false; v_det := '';
  begin
    delete from public.perfil_permissoes pp
     using public.perfis p
     where p.id = pp.perfil_id
       and p.organizacao_id is null and p.chave = 'proprietario'
       and pp.permissao_chave = 'equipe.folha';

    if public.tem_permissao('equipe.folha') then
      v_det := 'sem linha no perfil, ainda concedeu';
    else
      v_det := 'sem linha no perfil: negou';
      v_ok := true;
    end if;
    raise exception 'REVERTER';
  exception when others then
    if sqlerrm <> 'REVERTER' then v_ok := false; v_det := 'erro: ' || sqlerrm; end if;
  end;
  insert into conf72 values (7, 'ausencia de linha NEGA',
    case when v_ok then 'OK' else 'FALHOU' end, v_det);

  v_ok := false; v_det := '';
  begin
    delete from public.perfil_permissoes pp
     using public.perfis p
     where p.id = pp.perfil_id
       and p.organizacao_id is null and p.chave = 'proprietario'
       and pp.permissao_chave = 'equipe.folha';

    insert into public.usuario_permissoes (usuario_id, permissao_chave, concede)
    values (v_usuario, 'equipe.folha', true);

    if not public.tem_permissao('equipe.folha') then
      v_det := 'concede=true nao concedeu';
    elsif not exists (select 1 from public.minhas_permissoes() m where m = 'equipe.folha') then
      v_det := 'concedida por excecao nao apareceu em minhas_permissoes()';
    else
      v_ok := true;
      v_det := 'perfil sem a chave + excecao concede = permitido';
    end if;
    raise exception 'REVERTER';
  exception when others then
    if sqlerrm <> 'REVERTER' then v_ok := false; v_det := 'erro: ' || sqlerrm; end if;
  end;
  insert into conf72 values (8, 'excecao individual CONCEDE sobre a ausencia',
    case when v_ok then 'OK' else 'FALHOU' end, v_det);

  -- ── 9. USUARIO BLOQUEADO ─────────────────────────────────────────────────
  v_ok := false; v_det := '';
  begin
    update public.organizacao_usuarios set status = 'bloqueado' where id = v_usuario;

    select count(*) into v_efetivas from public.minhas_permissoes();
    if public.organizacao_do_auth() is not null then
      v_det := 'bloqueado continuou recebendo organizacao';
    elsif public.tem_permissao('clientes.visualizar') then
      v_det := 'bloqueado continuou com permissao';
    elsif v_efetivas <> 0 then
      v_det := 'bloqueado recebeu ' || v_efetivas || ' permissoes';
    else
      v_ok := true;
      v_det := 'organizacao null, tem_permissao false, zero permissoes';
    end if;
    raise exception 'REVERTER';
  exception when others then
    if sqlerrm <> 'REVERTER' then v_ok := false; v_det := 'erro: ' || sqlerrm; end if;
  end;
  insert into conf72 values (9, 'usuario bloqueado -> organizacao_do_auth() null',
    case when v_ok then 'OK' else 'FALHOU' end, v_det);

  -- ── 10. ORGANIZACAO INATIVA ──────────────────────────────────────────────
  v_ok := false; v_det := '';
  begin
    update public.organizacoes set ativo = false where id = v_owner;

    if public.organizacao_do_auth() is not null then
      v_det := 'organizacao inativa continuou sendo resolvida';
    elsif public.tem_permissao('clientes.visualizar') then
      v_det := 'organizacao inativa continuou concedendo permissao';
    else
      v_ok := true;
      v_det := 'organizacao null, zero permissao';
    end if;
    raise exception 'REVERTER';
  exception when others then
    if sqlerrm <> 'REVERTER' then v_ok := false; v_det := 'erro: ' || sqlerrm; end if;
  end;
  insert into conf72 values (10, 'organizacao inativa -> organizacao_do_auth() null',
    case when v_ok then 'OK' else 'FALHOU' end, v_det);

  -- ── 11. ISOLAMENTO: quem nao e membro nao recebe nada ────────────────────
  v_orfao := gen_random_uuid();
  perform set_config('request.jwt.claims', json_build_object('sub', v_orfao)::text, true);
  select count(*) into v_efetivas from public.minhas_permissoes();
  insert into conf72 values (11, 'usuario sem vinculo: sem organizacao, sem permissao',
    case when public.organizacao_do_auth() is null
          and not public.tem_permissao('clientes.visualizar')
          and v_efetivas = 0
         then 'OK' else 'FALHOU' end,
    'organizacao=' || coalesce(public.organizacao_do_auth()::text, 'null')
      || ' / permissoes=' || v_efetivas);

  -- ── 12. NADA PERSISTIU ───────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  select count(*) into v_efetivas from public.minhas_permissoes();
  select status into v_status from public.organizacao_usuarios where id = v_usuario;
  insert into conf72 values (12, 'estado voltou ao anterior: nada dos testes persistiu',
    case when public.organizacao_do_auth() = v_owner
          and v_efetivas = v_total
          and v_status = 'ativo'
          and (select ativo from public.organizacoes where id = v_owner)
          and not exists (select 1 from public.usuario_permissoes where usuario_id = v_usuario)
         then 'OK' else 'FALHOU' end,
    'permissoes=' || v_efetivas || '/' || v_total || ' / status=' || v_status
      || ' / excecoes gravadas=' || (select count(*) from public.usuario_permissoes where usuario_id = v_usuario));

  -- ── 13. o perfil Financeiro, depois do ajuste ────────────────────────────
  insert into conf72
  select 13, 'perfil Financeiro com as 5 permissoes aprovadas',
    case when string_agg(pp.permissao_chave, ',' order by pp.permissao_chave) =
              'clientes.visualizar,comercial.visualizar,financeiro.editar,financeiro.lancar,financeiro.visualizar'
         then 'OK' else 'FALHOU' end,
    coalesce(string_agg(pp.permissao_chave, ', ' order by pp.permissao_chave), '(vazio)')
    from public.perfil_permissoes pp
    join public.perfis p on p.id = pp.perfil_id
   where p.organizacao_id is null and p.chave = 'financeiro';

  -- ── 14. ACL efetiva das tres funcoes ─────────────────────────────────────
  insert into conf72
  select 14, 'ACL: anon sem execute, authenticated com execute',
    case when bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE'))
          and bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
         then 'OK' else 'FALHOU' end,
    string_agg(p.proname || ': anon=' ||
      case when has_function_privilege('anon', p.oid, 'EXECUTE') then 'SIM' else 'nao' end ||
      ' auth=' ||
      case when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'sim' else 'NAO' end,
      ' | ' order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('organizacao_do_auth','tem_permissao','minhas_permissoes');

end $$;

insert into conf72
select 99, 'VEREDITO',
  case when exists (select 1 from conf72 where resultado <> 'OK')
       then (select count(*)::text from conf72 where resultado <> 'OK') || ' FALHA(S) — NAO iniciar a Etapa 4'
       else 'EQUIVALENCIA PROVADA' end,
  case when exists (select 1 from conf72 where resultado <> 'OK')
       then (select string_agg(ordem::text, ', ' order by ordem) from conf72 where resultado <> 'OK')
       else 'os 14 testes passaram' end;

select ordem, teste, resultado, detalhe from conf72 order by ordem;
