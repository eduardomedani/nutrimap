-- ===========================================================================
-- COMERCIAL — "CLIENTE DESDE": ESTRUTURA E OS QUATRO CASOS, EXECUTADOS
-- ---------------------------------------------------------------------------
-- Roda DEPOIS de db/comercial_cliente_desde.sql.
--
-- ESTE SCRIPT ESCREVE — E DESFAZ TUDO SOZINHO. Os casos rodam dentro de um
-- bloco que termina com uma excecao proposital ('desfazer_teste_137'): o
-- Postgres desfaz tudo o que o bloco gravou — a data, a trilha, a variavel de
-- sessao. O que sobrevive sao as variaveis do PL/pgSQL, que nao sao
-- transacionais, e e delas que sai o resultado. A ultima secao prova que nao
-- ficou rastro.
--
-- A SESSAO e simulada como na conferencia 97: `request.jwt.claims` com o
-- proprietario, o mesmo mecanismo que o PostgREST usa quando a tela chama.
--
-- A COBAIA e a assinatura ativa mais antiga da organizacao.
--
-- OS CASOS
--   A  data valida (30 dias antes)  -> altera; so a coluna muda; cobrancas
--                                      identicas; UMA linha na trilha, com
--                                      antes, depois e quem
--   B  data depois do inicio do     -> recusa com frase; a data nao muda
--      periodo atual
--   C  a mesma data de novo         -> `alterou: false`; nenhuma linha nova
--   D  update direto, sem a funcao  -> o gatilho recusa
--
-- "So a coluna muda" e literal: a linha inteira da assinatura e comparada
-- antes e depois, menos `data_inicio_original` e `atualizado_em`. As cobrancas
-- e pagamentos da assinatura sao comparados por um md5 das linhas inteiras.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/137_cliente_desde_LIMPO.sql
-- ===========================================================================

drop table if exists conf137;
create temp table conf137 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_org     uuid;
  v_dono    uuid;
  v_ass     public.comercial_assinaturas%rowtype;
  v_nova    date;
  v_foto    jsonb;
  v_cob     text;
  v_trilha0 int;
  v_r       jsonb;
  v_erro    text;
  -- resultados — sobrevivem ao desfazer do bloco interno
  a_alterou text;  a_data date;  a_resto boolean;  a_cob boolean;
  a_trilha  int;   a_antes_depois boolean;  a_quem boolean;
  b_erro    text;  b_data_intacta boolean;
  c_alterou text;  c_trilha int;
  d_erro    text;
  z_data    boolean;  z_trilha boolean;
begin
  -- ═══════════ ESTRUTURA ═══════════
  insert into conf137
  select 10, 'ESTRUTURA', 'funcao comercial_alterar_cliente_desde', count(*)::text,
         case when count(*) = 1 then 'ok' else 'FALTA — rode db/comercial_cliente_desde.sql' end
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'comercial_alterar_cliente_desde';

  if not exists (select 1 from conf137 where ordem = 10 and valor = '1') then
    return;
  end if;

  insert into conf137 values
    (11, 'ESTRUTURA', 'anon executa',
     has_function_privilege('anon', 'public.comercial_alterar_cliente_desde(uuid, date)', 'execute')::text,
     case when has_function_privilege('anon', 'public.comercial_alterar_cliente_desde(uuid, date)', 'execute')
          then 'ERRADO' else 'ok' end),
    (12, 'ESTRUTURA', 'authenticated executa',
     has_function_privilege('authenticated', 'public.comercial_alterar_cliente_desde(uuid, date)', 'execute')::text,
     case when has_function_privilege('authenticated', 'public.comercial_alterar_cliente_desde(uuid, date)', 'execute')
          then 'ok' else 'ERRADO' end);

  insert into conf137
  select 13, 'ESTRUTURA', 'gatilho trg_comercial_cliente_desde_so_pela_rpc', count(*)::text,
         case when count(*) = 1 then 'ok' else 'FALTA' end
    from pg_trigger
   where tgrelid = 'public.comercial_assinaturas'::regclass
     and tgname = 'trg_comercial_cliente_desde_so_pela_rpc' and tgenabled <> 'D';

  -- ═══════════ PREPARO ═══════════
  select o.id, o.proprietario_user_id into v_org, v_dono
    from public.organizacoes o
    join public.admins ad on ad.user_id = o.proprietario_user_id;

  select * into v_ass
    from public.comercial_assinaturas
   where nutri_id = v_org and status in ('ativa', 'aguardando_inicio', 'pausada')
   order by criado_em
   limit 1;

  if v_ass.id is null then
    insert into conf137 values (20, 'PREPARO', 'cobaia', '(nenhuma)', 'PAROU');
    return;
  end if;

  v_nova := least(v_ass.data_inicio_original, v_ass.inicio_periodo) - 30;
  v_foto := to_jsonb(v_ass) - 'data_inicio_original' - 'atualizado_em';
  select md5(coalesce(string_agg(to_jsonb(l)::text, '|' order by l.id), '')) into v_cob
    from public.financeiro_lancamentos l where l.assinatura_id = v_ass.id;
  select count(*) into v_trilha0
    from public.comercial_assinatura_auditoria where assinatura_id = v_ass.id;

  insert into conf137 values (20, 'PREPARO', 'cobaia',
    v_ass.id || ' | desde ' || v_ass.data_inicio_original || ' | periodo ' || v_ass.inicio_periodo || ' a ' || v_ass.fim_periodo,
    'data do teste: ' || v_nova);

  -- ═══════════ OS CASOS — dentro de um bloco que se desfaz ═══════════
  begin
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);

    -- A
    v_r := public.comercial_alterar_cliente_desde(v_ass.id, v_nova);
    a_alterou := v_r ->> 'alterou';
    select s.data_inicio_original, (to_jsonb(s) - 'data_inicio_original' - 'atualizado_em') = v_foto
      into a_data, a_resto
      from public.comercial_assinaturas s where s.id = v_ass.id;
    select md5(coalesce(string_agg(to_jsonb(l)::text, '|' order by l.id), '')) = v_cob into a_cob
      from public.financeiro_lancamentos l where l.assinatura_id = v_ass.id;
    select count(*) - v_trilha0 into a_trilha
      from public.comercial_assinatura_auditoria where assinatura_id = v_ass.id;
    select (au.antes ->> 'data_inicio_original')::date = v_ass.data_inicio_original
           and (au.depois ->> 'data_inicio_original')::date = v_nova,
           au.usuario_id = v_dono
      into a_antes_depois, a_quem
      from public.comercial_assinatura_auditoria au
     where au.assinatura_id = v_ass.id and au.acao = 'inicio_contrato_alterado'
     order by au.criado_em desc
     limit 1;

    -- B
    begin
      perform public.comercial_alterar_cliente_desde(v_ass.id, v_ass.inicio_periodo + 1);
      b_erro := '(nao recusou)';
    exception when others then
      b_erro := sqlerrm;
    end;
    select s.data_inicio_original = v_nova into b_data_intacta
      from public.comercial_assinaturas s where s.id = v_ass.id;

    -- C
    v_r := public.comercial_alterar_cliente_desde(v_ass.id, v_nova);
    c_alterou := v_r ->> 'alterou';
    select count(*) - v_trilha0 into c_trilha
      from public.comercial_assinatura_auditoria where assinatura_id = v_ass.id;

    -- D
    begin
      update public.comercial_assinaturas set data_inicio_original = v_nova - 1 where id = v_ass.id;
      d_erro := '(nao recusou)';
    exception when others then
      d_erro := sqlerrm;
    end;

    raise exception 'desfazer_teste_137';
  exception when others then
    if sqlerrm <> 'desfazer_teste_137' then v_erro := sqlerrm; end if;
  end;

  if v_erro is not null then
    insert into conf137 values (29, 'CASOS', 'erro inesperado', v_erro, 'PAROU — o bloco foi desfeito');
  end if;

  insert into conf137 values
    (30, 'CASO A', 'data valida altera',        coalesce(a_alterou, '—') || ' -> ' || coalesce(a_data::text, '—'),
         case when a_alterou = 'true' and a_data = v_nova then 'ok' else 'ERRADO' end),
    (31, 'CASO A', 'o resto da assinatura',     coalesce(a_resto::text, '—'),
         case when a_resto then 'ok — periodo, plano, valor, status intactos' else 'ERRADO' end),
    (32, 'CASO A', 'cobrancas e pagamentos',    coalesce(a_cob::text, '—'),
         case when a_cob then 'ok — md5 identico' else 'ERRADO' end),
    (33, 'CASO A', 'linhas novas na trilha',    coalesce(a_trilha::text, '—'),
         case when a_trilha = 1 then 'ok' else 'ERRADO' end),
    (34, 'CASO A', 'trilha: antes e depois',    coalesce(a_antes_depois::text, '—'),
         case when a_antes_depois then 'ok' else 'ERRADO' end),
    (35, 'CASO A', 'trilha: quem',              coalesce(a_quem::text, '—'),
         case when a_quem then 'ok — usuario_id da sessao' else 'ERRADO' end),
    (40, 'CASO B', 'depois do inicio do periodo', coalesce(b_erro, '—'),
         case when b_erro like 'cliente desde nao pode ser depois%' and b_data_intacta then 'ok — recusou, data intacta' else 'ERRADO' end),
    (50, 'CASO C', 'a mesma data de novo',      coalesce(c_alterou, '—') || ' | trilha ' || coalesce(c_trilha::text, '—'),
         case when c_alterou = 'false' and c_trilha = 1 then 'ok — nada novo na trilha' else 'ERRADO' end),
    (60, 'CASO D', 'update direto, sem a funcao', coalesce(d_erro, '—'),
         case when d_erro like 'cliente desde so muda pela acao propria%' then 'ok — o gatilho recusou' else 'ERRADO' end);

  -- ═══════════ SEM RASTRO ═══════════
  select s.data_inicio_original = v_ass.data_inicio_original into z_data
    from public.comercial_assinaturas s where s.id = v_ass.id;
  select count(*) = v_trilha0 into z_trilha
    from public.comercial_assinatura_auditoria where assinatura_id = v_ass.id;

  insert into conf137 values
    (90, 'SEM RASTRO', 'a data voltou ao original', z_data::text, case when z_data then 'ok' else 'FICOU ALTERADA' end),
    (91, 'SEM RASTRO', 'a trilha voltou ao tamanho', z_trilha::text, case when z_trilha then 'ok' else 'FICOU LINHA' end);
end $$;

select ordem, secao, item, valor, resultado from conf137 order by ordem;
