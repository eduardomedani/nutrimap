-- ===========================================================================
-- DIAGNOSTICO — por que a troca de perfil nao chegou ao banco
-- ---------------------------------------------------------------------------
-- NAO PERSISTE NADA. A tentativa de troca roda em subtransacao e e desfeita.
--
-- O 77 mostrou o perfil ainda em `administrador` e NENHUM evento
-- `perfil_alterado` na auditoria. Como toda acao bem-sucedida grava auditoria,
-- a ausencia do evento prova que a RPC nao rodou — nao e atraso nem cache.
--
-- Faltava saber ONDE parou: na RPC ou na tela. Este script responde isso pelo
-- lado do banco, simulando a identidade do proprietario e chamando a MESMA
-- funcao que o botao chama, com os mesmos argumentos.
--
--   se aqui funcionar  -> a RPC esta boa, o defeito e no frontend
--   se aqui falhar     -> a mensagem diz qual validacao recusou
--
-- Para colar no SQL Editor, use db/conferencia/78_diagnostico_troca_perfil_LIMPO.sql
-- ===========================================================================

drop table if exists conf78;
create temp table conf78 (ordem int, item text, valor text, resultado text);

do $$
declare
  v_org      uuid;
  v_owner    uuid;
  v_alvo     uuid;
  v_alvo_uid uuid;
  v_recepcao uuid;
  v_perfil   text;
  v_ok       boolean;
  v_det      text;
  v_n        integer;
begin
  select o.id, o.proprietario_user_id into v_org, v_owner
    -- A organizacao da INSTALACAO, e nao "a primeira que aparecer". Desde que a
    -- conta do Caio ganhou organizacao propria, ha DUAS linhas em organizacoes, e
    -- `order by criado_em limit 1` deixou de dizer qual delas e — passou a depender
    -- de quem nasceu antes. O vinculo com public.admins e o mesmo sinal que a Etapa
    -- 2 usou para descobrir o proprietario da instalacao, e entrar em admins e um
    -- ato explicito. O Caio nao esta la.
    from public.organizacoes o join public.admins a on a.user_id = o.proprietario_user_id;

  select ou.id, ou.auth_user_id, p.chave into v_alvo, v_alvo_uid, v_perfil
    from public.organizacao_usuarios ou
    join auth.users u on u.id = ou.auth_user_id
    join public.perfis p on p.id = ou.perfil_id
   where lower(u.email) = 'eduardomedani@gmail.com';

  select p.id into v_recepcao
    from public.perfis p where p.organizacao_id is null and p.chave = 'recepcao';

  insert into conf78 values (1, 'usuario alvo (linha em organizacao_usuarios)',
    coalesce(v_alvo::text, 'NAO ENCONTRADO'), case when v_alvo is null then 'FALHOU' else 'ok' end);
  insert into conf78 values (2, 'perfil atual dele', coalesce(v_perfil, '-'),
    case when v_perfil = 'recepcao' then 'JA E RECEPCAO' else 'ok' end);
  insert into conf78 values (3, 'perfil Recepcao existe',
    coalesce(v_recepcao::text, 'NAO EXISTE'), case when v_recepcao is null then 'FALHOU' else 'ok' end);

  -- ── O que a TELA consegue oferecer no campo Perfil ──────────────────────
  -- A tela le `perfis` direto, sob RLS. Se vier vazio, o campo aparece sem
  -- opcao nenhuma e nao ha o que selecionar — isso sozinho explicaria tudo.
  select count(*), string_agg(p.chave, ', ' order by p.chave) into v_n, v_det
    from public.perfis p
   where p.organizacao_id is null and p.ativo and p.chave <> 'proprietario';
  insert into conf78 values (4, 'opcoes que a tela deveria oferecer (' || v_n || ')',
    coalesce(v_det, '(nenhuma)'), case when v_n = 5 then 'ok' else 'ATENCAO' end);

  -- A policy de leitura de perfis: `organizacao_id is null or = organizacao_do_auth()`.
  -- Os padrao tem organizacao_id nulo, entao o primeiro ramo ja os libera.
  insert into conf78 values (5, 'os perfis padrao passam pela RLS?',
    case when exists (select 1 from public.perfis where organizacao_id is null)
         then 'sim (organizacao_id nulo satisfaz a policy)' else 'NAO HA PERFIL PADRAO' end,
    'ok');

  -- ── O proprietario pode gerenciar? ──────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  insert into conf78 values (6, 'proprietario tem usuarios.gerenciar',
    case when public.tem_permissao('usuarios.gerenciar') then 'sim' else 'NAO' end,
    case when public.tem_permissao('usuarios.gerenciar') then 'ok' else 'FALHOU' end);

  insert into conf78 values (7, 'usuarios_da_organizacao() devolve quantos',
    (select count(*)::text from public.usuarios_da_organizacao()), 'ok');

  -- ── A MESMA CHAMADA QUE O BOTAO FAZ ─────────────────────────────────────
  v_ok := false; v_det := '';
  begin
    perform public.usuario_definir_perfil(v_alvo, v_recepcao);

    select p.chave into v_det
      from public.organizacao_usuarios ou
      join public.perfis p on p.id = ou.perfil_id
     where ou.id = v_alvo;

    if v_det = 'recepcao' then
      v_ok := true;
      v_det := 'a RPC trocou para recepcao (revertido em seguida)';
    else
      v_det := 'a RPC rodou sem erro mas o perfil ficou ' || v_det;
    end if;

    select count(*) into v_n from public.organizacao_auditoria
     where usuario_alvo = v_alvo and acao = 'perfil_alterado';
    v_det := v_det || ' / auditoria gravou ' || v_n || ' evento(s)';

    raise exception 'REVERTER';
  exception when others then
    if sqlerrm <> 'REVERTER' then v_ok := false; v_det := 'A RPC RECUSOU: ' || sqlerrm; end if;
  end;
  insert into conf78 values (8, 'usuario_definir_perfil(alvo, recepcao)',
    v_det, case when v_ok then 'OK — a RPC funciona' else 'FALHOU' end);

  insert into conf78 values (9, 'conclusao',
    case when v_ok then 'a RPC esta boa; o que nao funcionou foi a TELA'
         else 'o problema esta na propria RPC — ver a mensagem acima' end,
    case when v_ok then 'FRONTEND' else 'BANCO' end);
end $$;

select ordem, item, valor, resultado from conf78 order by ordem;
