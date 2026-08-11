-- ===========================================================================
-- CONFERENCIA DA ETAPA 3 — estado da conta de teste
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. Le, e simula a identidade da conta de teste dentro da
-- transacao para calcular permissao efetiva do jeito que o banco calcularia
-- para ela. Nada e gravado.
--
-- RODE DEPOIS DE CADA PASSO. Ele foi feito para ser executado varias vezes:
-- depois de trocar o perfil, depois de conceder, depois de voltar ao padrao,
-- depois de bloquear, depois de reativar. Cada execucao mostra o estado
-- naquele instante, com o veredito no fim.
--
-- Substitui o 75 para esta conta: o 75 procurava `+recepcao3`, que nunca foi
-- criada. A conta de teste real e a do EVL-WVAMZ.
--
-- POR QUE SIMULAR A IDENTIDADE. No SQL Editor a sessao e a do papel `postgres`
-- e auth.uid() e nulo, entao organizacao_do_auth() devolveria null para
-- qualquer um. set_config(..., is_local => true) poe a claim que auth.uid() le,
-- vale so ate o fim desta transacao e nao concede privilegio nenhum.
--
-- Para colar no SQL Editor, use db/conferencia/77_estado_conta_teste_LIMPO.sql
-- ===========================================================================

drop table if exists conf77;
create temp table conf77 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_email   text := 'eduardomedani@gmail.com';
  v_uid     uuid;
  v_org     uuid;
  v_membro  uuid;
  v_perfil  text;
  v_status  text;
  v_org_res uuid;
  v_exc     integer;
  v_perms   text;
  v_n       integer;
  r         record;
  -- A matriz aprovada de Recepcao, e o que se espera de cada chave.
  chaves    text[] := array['clientes.visualizar','clientes.criar','clientes.editar',
                            'comercial.visualizar','comercial.editar',
                            'financeiro.visualizar','anamnese.visualizar','avaliacoes.visualizar',
                            'documentos.visualizar','checkins.visualizar',
                            'usuarios.visualizar','usuarios.gerenciar'];
  esperado  boolean[] := array[true,true,true,true,true,false,false,false,false,false,false,false];
  v_tem     boolean;
  v_todas   boolean := true;
begin
  -- A organizacao da INSTALACAO, e nao "a primeira que aparecer". Desde que a
  -- conta do Caio ganhou organizacao propria, ha DUAS linhas em organizacoes, e
  -- `order by criado_em limit 1` deixou de dizer qual delas e — passou a depender
  -- de quem nasceu antes. O vinculo com public.admins e o mesmo sinal que a Etapa
  -- 2 usou para descobrir o proprietario da instalacao, e entrar em admins e um
  -- ato explicito. O Caio nao esta la.
  select count(*) into v_n
    from public.organizacoes o join public.admins a on a.user_id = o.proprietario_user_id;
  if v_n <> 1 then
    insert into conf77 values (0, 'GUARDA', 'organizacao da instalacao',
      v_n || ' organizacoes com proprietario em admins (esperado 1)',
      'FALHOU');
    return;
  end if;

  select o.id into v_org from public.organizacoes o join public.admins a on a.user_id = o.proprietario_user_id;
  select u.id into v_uid from auth.users u where lower(u.email) = v_email;

  if v_uid is null then
    insert into conf77 values (0, 'GUARDA', 'conta de teste', 'NAO ENCONTRADA: ' || v_email, 'FALHOU');
    return;
  end if;

  select ou.id, p.chave, ou.status into v_membro, v_perfil, v_status
    from public.organizacao_usuarios ou
    join public.perfis p on p.id = ou.perfil_id
   where ou.auth_user_id = v_uid;

  if v_membro is null then
    insert into conf77 values (0, 'GUARDA', 'vinculo', 'A conta existe mas NAO e membro da organizacao', 'FALHOU');
    return;
  end if;

  -- ═══════════ IDENTIDADE ═══════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  v_org_res := public.organizacao_do_auth();

  insert into conf77 values (1, 'IDENTIDADE', 'auth.uid da conta de teste', v_uid::text, 'ok');
  insert into conf77 values (2, 'IDENTIDADE', 'organizacao da instalacao', v_org::text, 'ok');
  insert into conf77 values (3, 'IDENTIDADE', 'os dois sao iguais?',
    case when v_uid = v_org then 'SIM' else 'nao' end,
    case when v_uid = v_org then 'FALHOU' else 'OK' end);
  insert into conf77 values (4, 'IDENTIDADE', 'organizacao_do_auth() para ela',
    coalesce(v_org_res::text, 'null'),
    case when v_status = 'bloqueado' then
           case when v_org_res is null then 'OK (bloqueada)' else 'FALHOU' end
         when v_org_res = v_org then 'OK' else 'FALHOU' end);

  -- ═══════════ PERFIL E ESTADO ═══════════
  insert into conf77 values (10, 'PERFIL', 'perfil', v_perfil,
    case when v_perfil = 'recepcao' then 'OK' else 'PENDENTE (esperado recepcao)' end);
  insert into conf77 values (11, 'PERFIL', 'status', v_status,
    case when v_status = 'ativo' then 'OK' else 'ATENCAO' end);

  select count(*) into v_exc from public.usuario_permissoes where usuario_id = v_membro;
  select string_agg(permissao_chave || '=' || case when concede then 'permitir' else 'bloquear' end, ', ')
    into v_perms from public.usuario_permissoes where usuario_id = v_membro;
  insert into conf77 values (12, 'PERFIL', 'excecoes individuais',
    v_exc || case when v_exc > 0 then ': ' || v_perms else '' end,
    case when v_exc = 0 then 'OK' else 'ATENCAO (o estado final pede 0)' end);

  -- ═══════════ PACOTE DO PERFIL ═══════════
  select count(*), string_agg(pp.permissao_chave, ', ' order by pp.permissao_chave)
    into v_n, v_perms
    from public.perfil_permissoes pp
    join public.organizacao_usuarios ou on ou.perfil_id = pp.perfil_id
   where ou.id = v_membro;
  insert into conf77 values (13, 'PERFIL', 'pacote do perfil (' || v_n || ')', v_perms, 'ok');

  -- ═══════════ PERMISSOES EFETIVAS ═══════════
  select count(*) into v_n from public.minhas_permissoes();
  select string_agg(m, ', ' order by m) into v_perms from public.minhas_permissoes() m;
  insert into conf77 values (20, 'EFETIVAS', 'minhas_permissoes() (' || v_n || ')',
    coalesce(v_perms, '(vazio)'),
    case when v_status = 'bloqueado' then
           case when v_n = 0 then 'OK (bloqueada)' else 'FALHOU' end
         else 'ok' end);

  for i in 1 .. array_length(chaves, 1) loop
    v_tem := public.tem_permissao(chaves[i]);
    if v_status = 'ativo' and v_perfil = 'recepcao' and v_tem is distinct from esperado[i] then
      v_todas := false;
    end if;
    insert into conf77 values (
      20 + i, 'CHAVES',
      chaves[i],
      case when v_tem then 'true' else 'false' end,
      case when v_status <> 'ativo' then
             case when v_tem then 'FALHOU (bloqueada nao pode ter permissao)' else 'OK (bloqueada)' end
           when v_perfil <> 'recepcao' then 'perfil ainda e ' || v_perfil
           when v_tem is not distinct from esperado[i] then 'OK'
           else 'DIVERGE (esperado ' || esperado[i]::text || ')' end);
  end loop;

  -- ═══════════ AUDITORIA ═══════════
  -- `ordem` cresce a cada evento: sem isso todos ficavam com 50 e o
  -- `order by ordem, item` os devolvia em ordem ALFABETICA. Com quatro
  -- `permissao_alterada` seguidos — conceder, voltar, revogar, voltar — a
  -- sequencia virava um amontoado, e e justamente a sequencia que se quer ler.
  v_n := 50;
  for r in
    select a.acao, a.antes, a.depois, a.criado_em, a.usuario_autor, a.usuario_alvo, a.organizacao_id
      from public.organizacao_auditoria a
     where a.usuario_alvo = v_membro
        or a.usuario_alvo in (select c.id from public.organizacao_convites c
                               where lower(c.email) = v_email)
     order by a.criado_em
  loop
    v_n := v_n + 1;
    insert into conf77 values (
      v_n, 'AUDITORIA', r.acao,
      'autor=' || case when r.usuario_autor = (select proprietario_user_id from public.organizacoes where id = v_org)
                       then 'proprietario'
                       when r.usuario_autor = v_uid then 'a propria conta de teste'
                       else left(r.usuario_autor::text, 8) end
        || case when r.antes  is not null then ' / antes=' || r.antes::text  else '' end
        || case when r.depois is not null then ' / depois=' || r.depois::text else '' end
        || ' / ' || r.criado_em::timestamp(0)::text,
      case when r.organizacao_id = v_org and r.usuario_alvo is not null then 'OK' else 'FALHOU' end);
  end loop;

  select count(*) into v_n from public.organizacao_auditoria a where a.usuario_alvo = v_membro;
  insert into conf77 values (49, 'AUDITORIA', 'eventos com alvo = conta de teste', v_n::text,
    case when v_n > 0 then 'ok' else 'ATENCAO (nenhum evento registrado)' end);

  -- ═══════════ O QUE NAO PODE TER MUDADO ═══════════
  insert into conf77
  select 90, 'INTOCADO', 'pacientes do proprietario',
    (select count(*)::text from public.pacientes p
      where p.nutri_id = (select proprietario_user_id from public.organizacoes where id = v_org)),
    'ok';
  insert into conf77
  select 91, 'INTOCADO', 'pacientes visiveis para a conta de teste',
    (select count(*)::text from public.pacientes p where p.nutri_id = v_uid),
    'ok (esperado 0 ate a Etapa 4)';
  insert into conf77
  select 92, 'INTOCADO', 'proprietarios ativos na organizacao',
    (select count(*)::text from public.organizacao_usuarios ou
       join public.perfis p on p.id = ou.perfil_id
      where ou.organizacao_id = v_org and p.chave = 'proprietario' and ou.status = 'ativo'),
    case when (select count(*) from public.organizacao_usuarios ou
                 join public.perfis p on p.id = ou.perfil_id
                where ou.organizacao_id = v_org and p.chave = 'proprietario' and ou.status = 'ativo') = 1
         then 'OK' else 'FALHOU' end;

  insert into conf77 values (98, 'ESTADO FINAL', 'perfil recepcao + ativo + zero excecoes',
    v_perfil || ' / ' || v_status || ' / ' || v_exc || ' excecoes',
    case when v_perfil = 'recepcao' and v_status = 'ativo' and v_exc = 0
         then 'OK' else 'ainda nao' end);
end $$;

insert into conf77
select 99, 'VEREDITO',
  case when exists (select 1 from conf77 where resultado like 'FALHOU%') then 'HA FALHAS'
       when exists (select 1 from conf77 where resultado like 'DIVERGE%') then 'HA DIVERGENCIAS'
       when exists (select 1 from conf77 where resultado like 'PENDENTE%'
                                           or resultado like 'perfil ainda%') then 'FALTA TROCAR O PERFIL'
       when exists (select 1 from conf77 where resultado like 'ATENCAO%') then 'ATENCAO'
       else 'ESTADO CORRETO' end,
  coalesce((select string_agg(distinct item, ', ') from conf77
             where resultado like 'FALHOU%' or resultado like 'DIVERGE%'), 'nada a apontar'),
  '';

select ordem, secao, item, valor, resultado from conf77 order by ordem, item;
