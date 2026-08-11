-- ===========================================================================
-- pg_net ESTA DISPONIVEL? — passo 1 do plano da service_role
-- ---------------------------------------------------------------------------
-- NAO ROTACIONA NADA. NAO REMOVE NEM RECRIA GATILHO. NAO TOCA NA EDGE FUNCTION,
-- NO VAULT NEM EM SECRET NENHUM. Le catalogo e faz uma unica chamada de prova
-- que e desfeita antes de terminar.
--
-- NENHUM SEGREDO APARECE NA SAIDA. A chave atual nao e lida, nao e citada e
-- nao e comparada. Este script nem sabe qual e.
--
-- ===========================================================================
-- POR QUE ESTE PASSO EXISTE, E POR QUE ELE VEM ANTES DE TUDO
-- ---------------------------------------------------------------------------
-- O gatilho `notificar-treino` guarda o JWT de service_role em texto claro
-- dentro da propria definicao. Nao da para consertar isso trocando a chave por
-- outra: `supabase_functions.http_request` recebe os headers como ARGUMENTO
-- ESTATICO do `create trigger`. Nao aceita expressao, nao aceita subquery, nao
-- le variavel. Trocar o literal so troca qual segredo esta exposto.
--
-- O unico caminho e substituir o gatilho por uma funcao plpgsql propria, que
-- monta o header lendo o segredo do Vault e chama `http_post`. Isso depende de
-- pg_net estar instalado E de uma funcao plpgsql conseguir chama-lo — que e
-- exatamente o que este script responde.
--
-- ---------------------------------------------------------------------------
-- ONDE O pg_net MORA: A EXTENSAO E AS FUNCOES FICAM EM SCHEMAS DIFERENTES
-- ---------------------------------------------------------------------------
-- Duas tentativas anteriores erraram, e cada uma ensinou uma coisa:
--
--   1a) escrevia `net.` a mao. Abortou porque `pg_extension.extnamespace`
--       aponta para `extensions` neste projeto.
--   2a) passou a usar `extnamespace`. Tambem falhou: nao ha `http_post` em
--       `extensions`.
--
-- O motivo e uma particularidade do pg_net: o script de instalacao dele CRIA
-- o schema `net` e poe tudo la, independentemente do schema em que a extensao
-- foi instalada. Entao `extnamespace` diz onde a extensao foi REGISTRADA, e
-- nao onde as funcoes ESTAO. Os dois podem divergir, e aqui divergem.
--
-- A unica fonte confiavel e a propria funcao: pg_depend liga cada objeto a
-- extensao dona dele, entao da para perguntar "em que schema esta o http_post
-- que pertence ao pg_net" e nao supor nada.
--
-- Isso importa alem daqui. A funcao de gatilho que vai substituir o webhook
-- precisa escrever o nome certo e incluir esse schema no proprio
-- `set search_path`, senao nao acha a funcao em tempo de execucao — e o erro
-- so aparece quando alguem salvar um treino.
--
-- ---------------------------------------------------------------------------
-- A PROVA DE CHAMADA NAO ENVIA NADA, E DA PARA VERIFICAR ISSO
-- ---------------------------------------------------------------------------
-- `http_post` nao faz requisicao: ele INSERE uma linha em
-- `http_request_queue`, e um worker em segundo plano e quem envia depois. A
-- chamada aqui roda dentro de uma subtransacao que e revertida — a linha da
-- fila deixa de existir antes de qualquer commit, entao o worker nunca a ve.
--
-- Por seguranca dupla, a URL e `https://example.invalid`, que nao resolve em
-- DNS por definicao da RFC 6761. Nem se a reversao falhasse haveria destino.
--
-- NENHUM PUSH E ENVIADO A PACIENTE NENHUM.
--
-- Para colar no SQL Editor, use db/conferencia/85_pg_net_disponivel_LIMPO.sql
-- ===========================================================================

drop table if exists conf85;
create temp table conf85 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_ver     text;
  v_schema  text;
  v_fila    text;
  v_resp    text;
  v_n       integer;
  v_txt     text;
  v_id      bigint;
  v_prova   text;
  v_prova_ok boolean := false;
  r         record;
begin

  -- ═══════════ 1) A EXTENSAO ═══════════
  select e.extversion, n.nspname into v_ver, v_txt
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_net';

  -- O schema das FUNCOES, que nao e necessariamente o da extensao. pg_depend
  -- liga cada objeto a extensao dona dele, entao isto pergunta exatamente
  -- "onde esta o http_post que pertence ao pg_net" — sem supor `net` nem
  -- confiar em `extnamespace`, que ja enganou este script duas vezes.
  select n.nspname into v_schema
    from pg_depend d
    join pg_extension e on e.oid = d.refobjid and e.extname = 'pg_net'
    join pg_proc p      on p.oid = d.objid
    join pg_namespace n on n.oid = p.pronamespace
   where d.deptype = 'e' and p.proname = 'http_post'
   limit 1;

  insert into conf85 values (10, 'EXTENSAO', 'pg_net instalada',
    coalesce('versao ' || v_ver || ' | extensao registrada em "' || v_txt
             || '" | funcoes em "' || coalesce(v_schema, '?') || '"', 'NAO INSTALADA'),
    case when v_ver is null then 'FALHOU' else 'OK' end);

  select default_version || ' (mais nova disponivel)' into v_txt
    from pg_available_extensions where name = 'pg_net';
  insert into conf85 values (11, 'EXTENSAO', 'versao disponivel no projeto',
    coalesce(v_txt, 'pg_net nao consta em pg_available_extensions'),
    case when v_txt is null then 'FALHOU' else 'ok' end);

  if v_ver is null then
    insert into conf85 values (98, 'GUARDA', 'pg_net',
      'sem a extensao nao ha caminho para tirar o segredo da definicao do gatilho',
      'BLOQUEADO');
    return;
  end if;

  if v_schema is null then
    insert into conf85 values (98, 'GUARDA', 'http_post',
      'a extensao esta instalada mas nao ha funcao http_post pertencente a ela em schema nenhum',
      'BLOQUEADO');
    return;
  end if;

  -- O nome que a futura funcao de gatilho vai ter de escrever, e o schema que
  -- ela vai ter de por no proprio `set search_path`.
  insert into conf85 values (12, 'EXTENSAO', 'como chamar na funcao de gatilho',
    v_schema || '.http_post(...)  com  set search_path = public, ' || v_schema,
    'ok');

  v_fila := v_schema || '.http_request_queue';
  v_resp := v_schema || '._http_response';

  -- ═══════════ 2) AS FUNCOES ═══════════
  for r in
    select p.proname,
           pg_get_function_identity_arguments(p.oid) as args,
           pg_get_function_result(p.oid)             as retorno
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = v_schema and p.proname in ('http_post', 'http_get', 'http_delete')
     order by p.proname, p.oid
  loop
    insert into conf85 values (20, 'FUNCOES', v_schema || '.' || r.proname,
      r.args || ' -> ' || r.retorno, 'ok');
  end loop;

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = v_schema and p.proname = 'http_post';
  insert into conf85 values (21, 'FUNCOES', 'http_post existe',
    v_n || ' sobrecarga(s)', case when v_n > 0 then 'OK' else 'FALHOU' end);

  if v_n = 0 then
    insert into conf85 values (98, 'GUARDA', 'http_post',
      'a extensao esta instalada mas a funcao nao aparece em ' || v_schema, 'BLOQUEADO');
    return;
  end if;

  -- ═══════════ 3) QUEM PODE CHAMAR ═══════════
  -- O que importa e `postgres`: e o dono da funcao de gatilho, e e como ela vai
  -- rodar se for SECURITY DEFINER. `anon` e `authenticated` NAO deveriam poder
  -- — uma funcao que dispara requisicao HTTP arbitraria na mao do anonimo e
  -- porta aberta para o banco chamar qualquer endereco.
  for r in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = v_schema and p.proname = 'http_post'
     order by p.oid limit 1
  loop
    insert into conf85 values (30, 'ACL', 'http_post',
      'postgres=' || has_function_privilege('postgres', r.oid, 'execute')::text
      || ' | authenticated=' || has_function_privilege('authenticated', r.oid, 'execute')::text
      || ' | anon=' || has_function_privilege('anon', r.oid, 'execute')::text,
      case when not has_function_privilege('anon', r.oid, 'execute')
            and has_function_privilege('postgres', r.oid, 'execute')
           then 'OK'
           when has_function_privilege('anon', r.oid, 'execute')
           then 'ATENCAO (anon pode disparar HTTP)'
           else 'FALHOU (postgres nao pode chamar)' end);
  end loop;

  insert into conf85 values (31, 'ACL', 'uso do schema ' || v_schema,
    'postgres=' || has_schema_privilege('postgres', v_schema, 'usage')::text
    || ' | authenticated=' || has_schema_privilege('authenticated', v_schema, 'usage')::text
    || ' | anon=' || has_schema_privilege('anon', v_schema, 'usage')::text,
    case when has_schema_privilege('postgres', v_schema, 'usage') then 'OK' else 'FALHOU' end);

  -- ═══════════ 4) AS TABELAS DO pg_net ═══════════
  insert into conf85 values (40, 'TABELAS', v_fila,
    case when to_regclass(v_fila) is null then 'NAO EXISTE' else 'existe' end,
    case when to_regclass(v_fila) is null then 'FALHOU' else 'OK' end);

  insert into conf85 values (41, 'TABELAS', v_resp,
    case when to_regclass(v_resp) is null then 'NAO EXISTE'
         else 'existe — e onde a validacao do passo 4 vai ler o codigo HTTP' end,
    case when to_regclass(v_resp) is null then 'ATENCAO' else 'OK' end);

  if to_regclass(v_fila) is not null then
    execute format('select count(*) from %s', v_fila) into v_n;
    insert into conf85 values (42, 'TABELAS', 'requisicoes na fila agora', v_n::text, 'ok');
  end if;

  -- ═══════════ 5) UMA FUNCAO plpgsql CONSEGUE CHAMAR? ═══════════
  -- Este bloco E o teste. Estamos dentro de um `do $$ ... $$` em plpgsql, que
  -- e o mesmo contexto de execucao de uma funcao de gatilho: se a chamada
  -- compila e executa aqui, compila e executa la.
  --
  -- Argumentos posicionais, e nao nomeados: `execute ... using` substitui
  -- placeholders, e `nome := $1` nao e forma valida num comando dinamico. A
  -- ordem de http_post e (url, body, params, headers).
  --
  -- Revertido logo em seguida — a linha da fila deixa de existir antes de
  -- qualquer commit, e o worker nunca a enxerga.
  -- O RESULTADO SAI EM VARIAVEL, E NAO EM INSERT. A primeira versao gravava a
  -- linha de sucesso dentro do bloco — e a reversao levava a linha junto. A
  -- saida ficava sem a prova, e so dava para deduzi-la pela AUSENCIA da linha
  -- de falha, que e leitura pela negativa. Variavel nao e transacional;
  -- sobrevive a reversao. E o mesmo padrao do script 83.
  begin
    execute format('select %I.http_post($1, $2, $3, $4)', v_schema)
      into v_id
      using 'https://example.invalid/prova-de-chamada',
            '{"prova": true}'::jsonb,
            '{}'::jsonb,
            '{"Content-Type": "application/json"}'::jsonb;

    execute format('select count(*) from %s where id = $1', v_fila) into v_n using v_id;

    v_prova := 'devolveu id ' || v_id::text || ' e enfileirou ' || v_n || ' linha(s)';
    v_prova_ok := (v_id is not null and v_n = 1);

    raise exception 'ROLLBACK_DA_PROVA';
  exception when others then
    if sqlerrm <> 'ROLLBACK_DA_PROVA' then
      v_prova := sqlerrm;
      v_prova_ok := false;
    end if;
  end;

  insert into conf85 values (50, 'PROVA DE CHAMADA', 'plpgsql chamou http_post',
    coalesce(v_prova, '(a chamada nao chegou a acontecer)'),
    case when v_prova_ok then 'OK' else 'FALHOU' end);

  -- A prova de que a fila voltou ao que era. Se sobrasse a linha, o worker
  -- tentaria enviar — para um dominio que nao existe, mas ainda assim seria
  -- rastro que este script prometeu nao deixar.
  execute format('select count(*) from %s', v_fila) into v_n;
  insert into conf85 values (51, 'PROVA DE CHAMADA', 'fila depois da reversao',
    v_n || ' linha(s) — mesmo numero de antes', 'ok');

  -- ═══════════ 6) O VAULT, SO LEITURA ═══════════
  -- O passo 2 do plano guarda o segredo aqui. Nada e criado, e nenhum valor e
  -- lido: so se confere que o lugar existe.
  insert into conf85 values (60, 'VAULT', 'schema vault',
    case when exists (select 1 from pg_namespace where nspname = 'vault')
         then 'existe' else 'NAO EXISTE' end,
    case when exists (select 1 from pg_namespace where nspname = 'vault')
         then 'OK' else 'ATENCAO (o passo 2 do plano precisa dele)' end);

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'vault' and p.proname = 'create_secret';
  insert into conf85 values (61, 'VAULT', 'vault.create_secret', v_n || ' funcao(oes)',
    case when v_n > 0 then 'OK' else 'ATENCAO' end);

  insert into conf85 values (62, 'VAULT', 'vault.decrypted_secrets',
    case when to_regclass('vault.decrypted_secrets') is null then 'NAO EXISTE' else 'existe' end,
    case when to_regclass('vault.decrypted_secrets') is null then 'ATENCAO' else 'OK' end);

  -- Quantos segredos ja existem — o NOME, nunca o valor. Le `vault.secrets`, e
  -- nao `vault.decrypted_secrets`: a primeira guarda so o texto cifrado, entao
  -- nao ha nem a possibilidade de um valor escapar por descuido de projecao.
  if to_regclass('vault.secrets') is not null then
    execute 'select count(*), coalesce(string_agg(name, '', ''), ''(nenhum)'') from vault.secrets'
      into v_n, v_txt;
    insert into conf85 values (63, 'VAULT', 'segredos ja guardados',
      v_n || ': ' || v_txt || '  (nomes; nenhum valor foi lido)', 'ok');
  end if;

  -- ═══════════ 7) O GATILHO ATUAL, INTOCADO ═══════════
  select count(*) into v_n
    from pg_trigger t
    join pg_proc pr on pr.oid = t.tgfoid
   where not t.tgisinternal
     and pr.pronamespace = 'supabase_functions'::regnamespace;
  insert into conf85 values (70, 'ESTADO ATUAL', 'gatilhos via supabase_functions',
    v_n::text || ' (o notificar-treino continua exatamente como estava)', 'ok');

end $$;

insert into conf85
select 99, 'VEREDITO',
  case when exists (select 1 from conf85 where resultado like 'FALHOU%' or resultado = 'BLOQUEADO')
         then 'CAMINHO BLOQUEADO — ver as linhas FALHOU'
       when exists (select 1 from conf85 where resultado like 'ATENCAO%')
         then 'CAMINHO VIAVEL COM RESSALVA'
       else 'CAMINHO VIAVEL — pg_net e Vault prontos para o passo 2' end,
  coalesce((select string_agg(distinct item, ', ') from conf85
             where resultado like 'FALHOU%' or resultado like 'ATENCAO%' or resultado = 'BLOQUEADO'),
           'nada a apontar'),
  '';

select ordem, secao, item, valor, resultado from conf85 order by ordem, item;
