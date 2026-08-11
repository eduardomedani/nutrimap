-- ===========================================================================
-- CHECK-INS APLICADO — conferencia estrutural e teste funcional revertido
-- ---------------------------------------------------------------------------
-- RODE DEPOIS de db/checkin_schema_LIMPO.sql.
--
-- NAO DEIXA RASTRO. A parte estrutural so le catalogo. A parte funcional cria
-- modelo, pergunta, atribuicao, ocorrencia e resposta de verdade — e desfaz
-- tudo antes de terminar.
--
-- ===========================================================================
-- COMO O TESTE SE DESFAZ, E POR QUE ISSO E CONFIAVEL
-- ---------------------------------------------------------------------------
-- O bloco de teste roda dentro de `begin ... exception ... end`, que em plpgsql
-- e uma SUBTRANSACAO. No fim do caminho feliz ele levanta uma excecao propria
-- (`ROLLBACK_DO_TESTE`); a subtransacao inteira volta atras, e o handler la
-- fora engole a excecao. Nao existe caminho em que a linha permaneca: se o
-- teste passar, o `raise` reverte; se falhar no meio, a excecao reverte igual.
--
-- Os resultados sobrevivem porque nao estao em tabela — estao em `v_log`, uma
-- variavel de memoria. Variavel nao e transacional. Gravar o resultado em
-- conf83 dentro do bloco apagaria o resultado junto com o teste.
--
-- ---------------------------------------------------------------------------
-- POR QUE O PACIENTE DO TESTE E O PROPRIO PROPRIETARIO
-- ---------------------------------------------------------------------------
-- `finalizar_checkin` e a escrita DO PACIENTE: ela resolve quem esta chamando
-- por `paciente_do_auth()`, que le `pacientes.auth_user_id = auth.uid()`. Para
-- exercitar a funcao de ponta a ponta e preciso uma identidade que seja, ao
-- mesmo tempo, dona da atribuicao e paciente da ocorrencia.
--
-- O proprietario e as duas coisas: ele tem 93 pacientes E e paciente de si
-- mesmo ("Eduardo Medani Aliprandi"). Isso ja tinha sido registrado como um
-- risco de policies OR'd; aqui vira a unica forma de testar o ciclo completo
-- sem tocar em paciente de terceiro. Nenhum outro paciente e lido ou alterado.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTE SCRIPT NAO TESTA, E E IMPORTANTE DIZER
-- ---------------------------------------------------------------------------
-- AS POLICIES. No SQL Editor a sessao e do papel `postgres`, que ignora RLS.
-- As policies sao CONFERIDAS (existem, com o predicado certo) mas nao sao
-- EXERCITADAS. Testar RLS de verdade exige entrar pela API com um JWT real —
-- e o que a Etapa 3 fez com o segundo login.
--
-- Para colar no SQL Editor, use db/conferencia/83_checkin_aplicado_LIMPO.sql
-- ===========================================================================

drop table if exists conf83;
create temp table conf83 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  TABELAS text[] := array['checkin_modelos','checkin_perguntas','checkin_atribuicoes',
                          'checkin_ocorrencias','checkin_respostas','checkin_auditoria'];
  v_n     int;
  v_txt   text;
  v_dono  uuid;
  v_pac   uuid;
  r       record;

  v_mod   uuid;
  v_perg  uuid;
  v_atr   uuid;
  v_oc    public.checkin_ocorrencias;
  v_oc2   public.checkin_ocorrencias;
  v_res   jsonb;
  v_log   text[] := '{}';
  v_p     text[];
  v_i     int;
  v_ok    boolean;
begin

  -- ═══════════ 1) AS SEIS TABELAS ═══════════
  foreach v_txt in array TABELAS loop
    insert into conf83 values (
      10, 'TABELAS', v_txt,
      case when to_regclass('public.' || v_txt) is null then 'NAO EXISTE'
           else 'existe' end,
      case when to_regclass('public.' || v_txt) is null then 'FALHOU' else 'OK' end);
  end loop;

  if exists (select 1 from conf83 where resultado = 'FALHOU') then
    insert into conf83 values (0, 'GUARDA', 'aplicacao', 'o schema NAO foi aplicado', 'FALHOU');
    return;
  end if;

  -- ═══════════ 2) RLS ═══════════
  select count(*) into v_n from pg_class
   where relnamespace = 'public'::regnamespace
     and relname = any(TABELAS) and relrowsecurity;
  insert into conf83 values (20, 'RLS', 'tabelas com row level security', v_n || ' de 6',
    case when v_n = 6 then 'OK' else 'FALHOU' end);

  -- ═══════════ 3) POLICIES ═══════════
  for r in
    select tablename, count(*) as n, string_agg(policyname, ', ' order by policyname) as nomes
      from pg_policies where schemaname = 'public' and tablename = any(TABELAS)
     group by tablename order by tablename
  loop
    insert into conf83 values (30, 'POLICIES', r.tablename, r.n || ': ' || r.nomes, 'ok');
  end loop;
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = any(TABELAS);
  insert into conf83 values (31, 'POLICIES', '~ total', v_n || ' de 11',
    case when v_n = 11 then 'OK' else 'FALHOU' end);

  -- ═══════════ 4) FUNCOES ═══════════
  for r in
    select p.proname,
           case when p.prosecdef then 'definer' else 'invoker' end as seg,
           coalesce(array_to_string(p.proconfig, ','), 'SEM search_path') as cfg
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('materializar_ocorrencia_checkin','finalizar_checkin',
                         'registrar_auditoria_checkin','tocar_checkin')
     order by p.proname
  loop
    insert into conf83 values (40, 'FUNCOES', r.proname, r.seg || ' | ' || r.cfg,
      case when r.cfg like 'search_path%' then 'OK' else 'ATENCAO' end);
  end loop;

  -- ═══════════ 5) TRIGGERS ═══════════
  select count(*), string_agg(t.tgname, ', ' order by t.tgname) into v_n, v_txt
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relnamespace = 'public'::regnamespace
     and c.relname = any(TABELAS) and not t.tgisinternal;
  insert into conf83 values (50, 'TRIGGERS', v_n || ' de 6', v_txt,
    case when v_n = 6 then 'OK' else 'FALHOU' end);

  -- ═══════════ 6) INDICES E CONSTRAINTS ═══════════
  select count(*) into v_n from pg_indexes
   where schemaname = 'public' and tablename = any(TABELAS);
  insert into conf83 values (60, 'INDICES', 'indices nas seis tabelas', v_n || ' (15 do schema + 6 de PK)',
    case when v_n >= 21 then 'OK' else 'ATENCAO' end);

  for r in
    -- contype::text antes de comparar: `contype` e do tipo "char", e comparar
    -- ou concatenar "char" com literal solto ja custou um
    -- `operator is not unique` neste projeto.
    select case con.contype::text when 'p' then 'primary key' when 'f' then 'foreign key'
                                  when 'c' then 'check' else con.contype::text end as tipo,
           count(*) as n
      from pg_constraint con join pg_class c on c.oid = con.conrelid
     where c.relnamespace = 'public'::regnamespace and c.relname = any(TABELAS)
     group by 1 order by 1
  loop
    insert into conf83 values (61, 'CONSTRAINTS', r.tipo, r.n::text, 'ok');
  end loop;

  -- ═══════════ 7) ACL DAS FUNCOES ═══════════
  -- O que importa aqui e o que anon NAO tem. As duas RPCs sao para
  -- `authenticated`; as duas de gatilho nao sao para ninguem.
  insert into conf83 values (70, 'ACL', 'finalizar_checkin',
    'anon=' || has_function_privilege('anon', 'public.finalizar_checkin(uuid,jsonb)', 'execute')::text
    || ' authenticated=' || has_function_privilege('authenticated', 'public.finalizar_checkin(uuid,jsonb)', 'execute')::text,
    case when not has_function_privilege('anon', 'public.finalizar_checkin(uuid,jsonb)', 'execute')
          and has_function_privilege('authenticated', 'public.finalizar_checkin(uuid,jsonb)', 'execute')
         then 'OK' else 'FALHOU' end);

  insert into conf83 values (71, 'ACL', 'materializar_ocorrencia_checkin',
    'anon=' || has_function_privilege('anon', 'public.materializar_ocorrencia_checkin(uuid,date,timestamptz,timestamptz)', 'execute')::text
    || ' authenticated=' || has_function_privilege('authenticated', 'public.materializar_ocorrencia_checkin(uuid,date,timestamptz,timestamptz)', 'execute')::text,
    case when not has_function_privilege('anon', 'public.materializar_ocorrencia_checkin(uuid,date,timestamptz,timestamptz)', 'execute')
          and has_function_privilege('authenticated', 'public.materializar_ocorrencia_checkin(uuid,date,timestamptz,timestamptz)', 'execute')
         then 'OK' else 'FALHOU' end);

  insert into conf83 values (72, 'ACL', 'funcoes de gatilho',
    'registrar_auditoria_checkin authenticated=' || has_function_privilege('authenticated', 'public.registrar_auditoria_checkin()', 'execute')::text
    || ' | tocar_checkin authenticated=' || has_function_privilege('authenticated', 'public.tocar_checkin()', 'execute')::text,
    case when not has_function_privilege('authenticated', 'public.registrar_auditoria_checkin()', 'execute')
          and not has_function_privilege('authenticated', 'public.tocar_checkin()', 'execute')
         then 'OK' else 'ATENCAO (grant que nao serve para nada)' end);

  -- ═══════════ 8) GRANTS DE TABELA ═══════════
  -- O schema nao concede nada explicitamente: depende do default privileges do
  -- Supabase. Sem grant para `authenticated`, o front leva permission denied
  -- mesmo com a policy certa — e o erro nao menciona grant nenhum.
  foreach v_txt in array TABELAS loop
    insert into conf83 values (80, 'GRANTS', v_txt,
      'authenticated: ' ||
        case when has_table_privilege('authenticated', 'public.' || v_txt, 'select') then 'select ' else '' end ||
        case when has_table_privilege('authenticated', 'public.' || v_txt, 'insert') then 'insert ' else '' end ||
        case when has_table_privilege('authenticated', 'public.' || v_txt, 'update') then 'update ' else '' end ||
        case when has_table_privilege('authenticated', 'public.' || v_txt, 'delete') then 'delete' else '' end
      || ' | anon: ' ||
        case when has_table_privilege('anon', 'public.' || v_txt, 'select') then 'SELECT' else 'nada' end,
      case when not has_table_privilege('authenticated', 'public.' || v_txt, 'select') then 'FALHOU (front nao le)'
           when has_table_privilege('anon', 'public.' || v_txt, 'select') then 'ATENCAO (anon tem grant)'
           else 'OK' end);
  end loop;

  -- ═══════════ 9) AS SEIS NASCEM VAZIAS ═══════════
  foreach v_txt in array TABELAS loop
    execute format('select count(*) from public.%I', v_txt) into v_n;
    insert into conf83 values (90, 'VAZIAS', v_txt, v_n::text,
      case when v_n = 0 then 'OK' else 'ATENCAO (ja tem linha)' end);
  end loop;

  -- ═══════════════════════════════════════════════════════════
  -- 10) TESTE FUNCIONAL — criado e desfeito
  -- ═══════════════════════════════════════════════════════════
  select o.proprietario_user_id into v_dono
    -- A organizacao da INSTALACAO, e nao "a primeira que aparecer". Desde que a
    -- conta do Caio ganhou organizacao propria, ha DUAS linhas em organizacoes, e
    -- `order by criado_em limit 1` deixou de dizer qual delas e — passou a depender
    -- de quem nasceu antes. O vinculo com public.admins e o mesmo sinal que a Etapa
    -- 2 usou para descobrir o proprietario da instalacao, e entrar em admins e um
    -- ato explicito. O Caio nao esta la.
    from public.organizacoes o join public.admins a on a.user_id = o.proprietario_user_id;

  select count(*) into v_n
    from public.organizacoes o join public.admins a on a.user_id = o.proprietario_user_id;
  if v_n <> 1 then
    insert into conf83 values (198, 'TESTE FUNCIONAL', 'guarda',
      v_n || ' organizacoes com proprietario em admins (esperado 1)', 'FALHOU');
    v_dono := null;
  end if;

  select p.id into v_pac from public.pacientes p where p.auth_user_id = v_dono limit 1;

  if v_pac is null then
    insert into conf83 values (199, 'TESTE FUNCIONAL', 'guarda',
      'o proprietario nao tem linha propria em pacientes; sem paciente com login nao da para exercitar finalizar_checkin',
      'PULADO');
  else
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_dono)::text, true);

      insert into public.checkin_modelos (nome, descricao, frequencia_padrao)
        values ('[TESTE 83] modelo', 'criado e desfeito pela conferencia', 'semanal')
        returning id into v_mod;
      v_log := v_log || ('modelo criado' || E'\t' || v_mod::text || E'\t' || 'OK');

      insert into public.checkin_perguntas (modelo_id, texto, tipo, obrigatoria, ordem, configuracao)
        values (v_mod, 'Como esteve sua fome?', 'escala', true, 1,
                '{"min": 1, "max": 5}'::jsonb)
        returning id into v_perg;
      v_log := v_log || ('pergunta criada' || E'\t' || 'escala 1..5, obrigatoria' || E'\t' || 'OK');

      insert into public.checkin_atribuicoes (paciente_id, modelo_id, frequencia, dia_semana)
        values (v_pac, v_mod, 'semanal', 1)
        returning id into v_atr;
      v_log := v_log || ('atribuicao criada' || E'\t' || 'semanal, dia 1, paciente do proprio dono' || E'\t' || 'OK');

      -- materializar
      v_oc := public.materializar_ocorrencia_checkin(v_atr, current_date);
      v_log := v_log || ('materializar_ocorrencia_checkin' || E'\t'
        || 'status=' || v_oc.status || ' perguntas no snapshot='
        || jsonb_array_length(v_oc.snapshot -> 'perguntas')::text || E'\t'
        || case when v_oc.id is not null and v_oc.status = 'disponivel'
                 and jsonb_array_length(v_oc.snapshot -> 'perguntas') = 1
                then 'OK' else 'FALHOU' end);

      -- idempotencia: a segunda chamada devolve A MESMA ocorrencia, sem erro
      v_oc2 := public.materializar_ocorrencia_checkin(v_atr, current_date);
      v_log := v_log || ('idempotencia da materializacao' || E'\t'
        || 'segunda chamada devolveu ' || case when v_oc2.id = v_oc.id then 'a mesma ocorrencia' else 'OUTRA' end
        || E'\t' || case when v_oc2.id = v_oc.id then 'OK' else 'FALHOU' end);

      select count(*) into v_n from public.checkin_ocorrencias where atribuicao_id = v_atr;
      v_log := v_log || ('ocorrencias criadas' || E'\t' || v_n::text || E'\t'
        || case when v_n = 1 then 'OK' else 'FALHOU (duplicou)' end);

      -- validacao contra o snapshot: valor fora do intervalo tem que ser recusado
      begin
        v_res := public.finalizar_checkin(v_oc.id, jsonb_build_object(v_perg::text, 99));
        v_log := v_log || ('recusa valor fora do intervalo' || E'\t' || 'ACEITOU 99 num escala 1..5' || E'\t' || 'FALHOU');
      exception when others then
        v_log := v_log || ('recusa valor fora do intervalo' || E'\t' || sqlerrm || E'\t'
          || case when sqlerrm like 'checkin_fora_do_intervalo%' then 'OK' else 'FALHOU' end);
      end;

      -- finalizar de verdade
      v_res := public.finalizar_checkin(v_oc.id, jsonb_build_object(v_perg::text, 3));
      v_log := v_log || ('finalizar_checkin' || E'\t' || v_res::text || E'\t'
        || case when (v_res ->> 'respostas')::int = 1 then 'OK' else 'FALHOU' end);

      select status into v_txt from public.checkin_ocorrencias where id = v_oc.id;
      select count(*) into v_n from public.checkin_respostas where ocorrencia_id = v_oc.id;
      v_log := v_log || ('estado depois de finalizar' || E'\t'
        || 'status=' || v_txt || ' respostas=' || v_n::text || E'\t'
        || case when v_txt = 'respondido' and v_n = 1 then 'OK' else 'FALHOU' end);

      -- dupla finalizacao tem que ser recusada
      begin
        v_res := public.finalizar_checkin(v_oc.id, jsonb_build_object(v_perg::text, 4));
        v_log := v_log || ('recusa dupla finalizacao' || E'\t' || 'ACEITOU finalizar duas vezes' || E'\t' || 'FALHOU');
      exception when others then
        v_log := v_log || ('recusa dupla finalizacao' || E'\t' || sqlerrm || E'\t'
          || case when sqlerrm like 'checkin_ja_finalizado%' then 'OK' else 'FALHOU' end);
      end;

      -- auditoria escrita pelos gatilhos
      select count(*), string_agg(acao, ', ' order by criado_em) into v_n, v_txt
        from public.checkin_auditoria where modelo_id = v_mod;
      v_log := v_log || ('auditoria pelos gatilhos' || E'\t' || v_n || ': ' || coalesce(v_txt, '(vazio)') || E'\t'
        || case when v_n >= 4 then 'OK' else 'FALHOU (esperado modelo_criado, atribuicao_criada, ocorrencia_materializada, checkin_finalizado)' end);

      raise exception 'ROLLBACK_DO_TESTE';

    exception when others then
      if sqlerrm <> 'ROLLBACK_DO_TESTE' then
        v_log := v_log || ('INTERROMPIDO' || E'\t' || sqlerrm || E'\t' || 'FALHOU');
      end if;
    end;

    for v_i in 1 .. coalesce(array_length(v_log, 1), 0) loop
      v_p := string_to_array(v_log[v_i], E'\t');
      insert into conf83 values (200 + v_i, 'TESTE FUNCIONAL', v_p[1], v_p[2], v_p[3]);
    end loop;

    -- ═══════════ 11) O TESTE NAO DEIXOU RASTRO ═══════════
    v_ok := true;
    foreach v_txt in array TABELAS loop
      execute format('select count(*) from public.%I', v_txt) into v_n;
      if v_n <> 0 then v_ok := false; end if;
      insert into conf83 values (300, 'SEM RASTRO', v_txt, v_n::text,
        case when v_n = 0 then 'OK' else 'FALHOU (sobrou linha do teste)' end);
    end loop;
  end if;
end $$;

insert into conf83
select 999, 'VEREDITO',
  case when exists (select 1 from conf83 where resultado like 'FALHOU%') then 'HA FALHAS'
       when exists (select 1 from conf83 where resultado like 'PULADO%')  then 'TESTE FUNCIONAL NAO RODOU'
       when exists (select 1 from conf83 where resultado like 'ATENCAO%') then 'APLICADO COM RESSALVA'
       else 'CHECK-INS APLICADO E FUNCIONANDO' end,
  coalesce((select string_agg(distinct item, ', ') from conf83
             where resultado like 'FALHOU%' or resultado like 'ATENCAO%'), 'nada a apontar'),
  '';

select ordem, secao, item, valor, resultado from conf83 order by ordem, item;
