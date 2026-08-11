-- ===========================================================================
-- SIGNUP AUTOMATICO E O OBJETO pedcrm — diagnostico, sem alterar nada
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. Leitura pura sobre o catalogo do Postgres.
--
-- POR QUE ESTE SCRIPT EXISTE. O script 79 acusou tres objetos vivos no banco
-- que o repositorio nao conhece: `handle_new_user`, `pedcrm_novo_membro` e o
-- gatilho `notificar-treino`. Nenhum dos tres aparece em NENHUM arquivo deste
-- repositorio — conferido com busca em js, html, sql e mjs, resultado zero.
-- Nao ha como saber o que eles fazem sem ler o banco.
--
-- E ISSO BLOQUEIA A ETAPA 4 por um motivo especifico. Se `handle_new_user`
-- insere em `public.nutricionistas` a cada `auth.users` novo, entao TODA conta
-- criada no projeto vira nutricionista automaticamente. Isso muda a leitura
-- das quatro contas externas do script 73: elas deixariam de ser "cadastros de
-- nutricionista sem codigo" e passariam a ser "qualquer conta que existiu".
-- Sao diagnosticos diferentes e levam a decisoes diferentes.
--
-- ---------------------------------------------------------------------------
-- TUDO CAI NUMA TABELA TEMPORARIA, E ISSO NAO E ESTILO
-- ---------------------------------------------------------------------------
-- A primeira versao deste script tinha sete `select` soltos. O SQL Editor do
-- Supabase mostra APENAS o resultado do ultimo comando — os seis primeiros
-- foram executados e descartados sem aviso. O mesmo ja aconteceu no script 72.
-- Uma tabela temporaria com um unico `select` no fim resolve de vez.
--
-- ---------------------------------------------------------------------------
-- A CHAVE service_role SAI MASCARADA
-- ---------------------------------------------------------------------------
-- O gatilho `notificar-treino` guarda o JWT de service_role em texto claro na
-- propria definicao. Essa chave IGNORA TODO O RLS. O bloco G a substitui por
-- um marcador antes de devolver, para que a saida deste script possa ser
-- colada em qualquer lugar sem vazar acesso total ao banco.
--
-- O BLOCO D E O QUE SEPARA SIGNUP DE CONVITE DE VINCULO. Se o intervalo entre
-- `auth.users.created_at` e `nutricionistas.criado_em` for de milissegundos, a
-- linha nasceu por gatilho na mesma transacao do cadastro. Se for de minutos
-- ou dias, nasceu por outro caminho. Nao e prova formal, mas separa as duas
-- hipoteses com folga.
--
-- Para colar no SQL Editor, use db/conferencia/81_signup_e_pedcrm_LIMPO.sql
-- ===========================================================================

drop table if exists conf81;
create temp table conf81 (ordem int, bloco text, item text, valor text);

do $$
declare
  v_n    int := 0;
  r      record;
  l      record;
  v_def  text;
  v_alvo text[] := array['handle_new_user', 'pedcrm_novo_membro'];
begin

  -- ═══════════ A) A DEFINICAO EXATA DOS DOIS OBJETOS ═══════════
  -- pg_get_functiondef devolve o `create function` completo, do jeito que o
  -- banco o guarda. E esta saida que vira o baseline versionado — copiada, nao
  -- reescrita de memoria. O corpo sai quebrado linha a linha porque uma celula
  -- unica de 60 linhas e ilegivel no grid do editor.
  for r in
    select p.oid, ns.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) as args,
           pg_get_function_result(p.oid)             as retorno,
           lg.lanname                                as linguagem,
           p.prosecdef, p.proconfig,
           pg_get_userbyid(p.proowner)               as dono,
           p.proacl::text                            as acl
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      join pg_language  lg on lg.oid = p.prolang
     where p.proname = any(v_alvo)
     order by p.proname
  loop
    v_n := v_n + 1;
    insert into conf81 values (v_n, 'A DEFINICAO', r.nspname || '.' || r.proname,
      'argumentos: ' || coalesce(nullif(r.args, ''), '(nenhum)')
      || ' | retorna ' || r.retorno || ' | ' || r.linguagem);
    v_n := v_n + 1;
    insert into conf81 values (v_n, 'A DEFINICAO', r.nspname || '.' || r.proname,
      case when r.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end
      || ' | ' || coalesce(array_to_string(r.proconfig, ' , '), 'SEM search_path')
      || ' | dono ' || r.dono
      || ' | acl ' || coalesce(r.acl, '(privilegio padrao)'));

    for l in
      select linha, ordinalidade
        from unnest(string_to_array(pg_get_functiondef(r.oid), chr(10)))
             with ordinality as t(linha, ordinalidade)
    loop
      v_n := v_n + 1;
      insert into conf81 values (v_n, 'A CORPO', r.proname,
        lpad(l.ordinalidade::text, 3, ' ') || '  ' || l.linha);
    end loop;
  end loop;

  if v_n = 0 then
    v_n := 1;
    insert into conf81 values (1, 'A DEFINICAO', 'as duas funcoes',
      'NENHUMA DAS DUAS EXISTE NESTE BANCO');
  end if;

  -- ═══════════ B) QUEM CHAMA CADA UMA ═══════════
  -- Uma funcao de gatilho sozinha nao faz nada. O que importa e onde ela esta
  -- amarrada: `auth.users` significa "roda em todo cadastro"; outra tabela
  -- significa outra coisa inteiramente.
  v_n := 1000;
  for r in
    select c.relnamespace::regnamespace::text || '.' || c.relname as tabela,
           t.tgname, pr.proname, t.tgenabled,
           pg_get_triggerdef(t.oid) as def
      from pg_trigger t
      join pg_class c  on c.oid = t.tgrelid
      join pg_proc pr  on pr.oid = t.tgfoid
     where not t.tgisinternal and pr.proname = any(v_alvo)
     order by 1, 2
  loop
    v_n := v_n + 1;
    insert into conf81 values (v_n, 'B QUEM CHAMA', r.proname,
      r.tabela || ' / ' || r.tgname
      || ' / ' || case when r.tgenabled = 'D' then 'DESLIGADO' else 'ativo' end
      || ' / ' || r.def);
  end loop;
  if v_n = 1000 then
    insert into conf81 values (1001, 'B QUEM CHAMA', 'gatilhos',
      'NENHUM GATILHO CHAMA AS DUAS FUNCOES (podem ser chamadas por RPC ou por nada)');
  end if;

  -- ═══════════ C) TODO O CAMINHO DO CADASTRO ═══════════
  -- Nao so os dois procurados: TUDO que dispara quando uma conta nasce. E aqui
  -- que aparece um terceiro gatilho que ninguem lembrava.
  v_n := 2000;
  for r in
    select t.tgname,
           pr.pronamespace::regnamespace::text || '.' || pr.proname as funcao,
           t.tgenabled, pg_get_triggerdef(t.oid) as def
      from pg_trigger t
      join pg_proc pr on pr.oid = t.tgfoid
     where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
     order by t.tgname
  loop
    v_n := v_n + 1;
    insert into conf81 values (v_n, 'C GATILHOS DO CADASTRO', r.tgname,
      r.funcao || ' / ' || case when r.tgenabled = 'D' then 'DESLIGADO' else 'ativo' end
      || ' / ' || regexp_replace(r.def, 'Bearer [A-Za-z0-9._-]+', 'Bearer <SERVICE_ROLE_OMITIDO>', 'g'));
  end loop;
  if v_n = 2000 then
    insert into conf81 values (2001, 'C GATILHOS DO CADASTRO', 'auth.users',
      'NENHUM GATILHO EM auth.users — nada dispara quando uma conta nasce');
  end if;

  -- ═══════════ D) A EVIDENCIA: nutricionista nasceu junto com a conta? ═══════════
  -- Uma linha por conta de nutricionista.
  --   'GATILHO (mesmo instante)'  -> nasceu na transacao do cadastro
  --   'depois do cadastro'        -> nasceu por outro caminho
  --   'ANTES do cadastro'         -> importada, ou a conta foi recriada
  -- `codigo` diz se a conta passou pelo convite de SaaS. Conta com gatilho e
  -- SEM codigo e o retrato que se procura: signup direto, sem convite.
  v_n := 3000;
  for r in
    select u.email, n.nome, u.created_at, n.criado_em, n.id
      from public.nutricionistas n
      join auth.users u on u.id = n.id
     order by u.created_at
  loop
    v_n := v_n + 1;
    insert into conf81 values (v_n, 'D ORIGEM DA LINHA', r.email,
      case
        when r.criado_em <  r.created_at                          then 'ANTES do cadastro'
        when r.criado_em <= r.created_at + interval '5 seconds'    then 'GATILHO (mesmo instante)'
        else                                                           'depois do cadastro'
      end
      || ' | atraso ' || justify_interval(r.criado_em - r.created_at)::text
      || ' | nome ' || case when r.nome = r.email then '= EMAIL (sem nome real)'
                            else '"' || coalesce(r.nome, '(nulo)') || '"' end
      || ' | codigo SaaS ' || (select count(*) from public.codigos_uso cu where cu.nutri_id = r.id)
      || ' | na organizacao ' || case when exists (select 1 from public.organizacao_usuarios ou
                                                    where ou.auth_user_id = r.id) then 'SIM' else 'nao' end
      || ' | pacientes ' || (select count(*) from public.pacientes p where p.nutri_id = r.id));
  end loop;

  -- ═══════════ E) CONTAS SEM LINHA DE NUTRICIONISTA ═══════════
  -- O contraponto do bloco D, e o teste decisivo da hipotese do gatilho: se
  -- TODA conta de auth.users tem linha em nutricionistas, o gatilho e
  -- universal. Se existem contas sem linha, ele nao dispara para todo mundo.
  v_n := 4000;
  for r in
    select u.id, u.email, u.created_at
      from auth.users u
     where not exists (select 1 from public.nutricionistas n where n.id = u.id)
     order by u.created_at
  loop
    v_n := v_n + 1;
    insert into conf81 values (v_n, 'E CONTA SEM NUTRICIONISTA', r.email,
      r.created_at::date::text
      || ' | ' || coalesce(nullif(btrim(
           case when exists (select 1 from public.pacientes p where p.auth_user_id = r.id)
                then 'paciente do PWA ' else '' end
        || case when exists (select 1 from public.funcionarios f where f.auth_user_id = r.id)
                then 'colaborador ' else '' end
        || case when exists (select 1 from public.organizacao_usuarios ou where ou.auth_user_id = r.id)
                then 'membro da organizacao ' else '' end), ''), '(nao e nada conhecido)'));
  end loop;
  insert into conf81 values (4000, 'E CONTA SEM NUTRICIONISTA', '~ total',
    (select count(*)::text from auth.users u
      where not exists (select 1 from public.nutricionistas n where n.id = u.id))
    || ' de ' || (select count(*)::text from auth.users)
    || ' contas de auth.users NAO tem linha em nutricionistas');

  -- ═══════════ F) O BANCO E COMPARTILHADO COM OUTRO PRODUTO? ═══════════
  -- O prefixo `pedcrm_` da funcao sugere um segundo produto no mesmo projeto
  -- Supabase. Se houver tabela com o mesmo prefixo, ou qualquer objeto que o
  -- Evollo nao conheca, a hipotese vira fato — e ai `auth.users` e
  -- compartilhado entre os dois, e um gatilho global de cadastro de um afeta
  -- o outro. Os nomes saem agregados numa linha so para o grid nao explodir.
  insert into conf81 values (5001, 'F INVENTARIO', 'tabelas em public',
    (select count(*)::text from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relkind = 'r'));
  insert into conf81 values (5002, 'F INVENTARIO', 'nomes das tabelas',
    (select string_agg(c.relname, ', ' order by c.relname)
       from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relkind = 'r'));
  insert into conf81 values (5003, 'F INVENTARIO', 'funcoes proprias em public',
    (select count(*)::text from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.prokind = 'f'
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')));
  insert into conf81 values (5004, 'F INVENTARIO', 'objetos com cara de outro produto',
    coalesce((select string_agg(nome, ', ' order by nome) from (
       select c.relname as nome from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public' and c.relkind = 'r'
          and (c.relname ilike '%pedcrm%' or c.relname ilike '%ped!_%' escape '!' or c.relname ilike '%crm%')
       union all
       select p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.prokind = 'f'
          and (p.proname ilike '%pedcrm%' or p.proname ilike '%crm%')
    ) s), 'NENHUM — so a funcao pedcrm_novo_membro'));
  insert into conf81 values (5005, 'F INVENTARIO', 'outros schemas nao padrao',
    coalesce((select string_agg(nspname, ', ' order by nspname) from pg_namespace
      where nspname not in ('public','pg_catalog','information_schema','auth','storage',
                            'extensions','graphql','graphql_public','realtime','vault',
                            'supabase_functions','supabase_migrations','pgbouncer',
                            'net','cron','pgsodium','pgsodium_masks')
        and nspname not like 'pg!_%' escape '!'), '(nenhum)'));

  -- ═══════════ G) O TERCEIRO OBJETO — o gatilho notificar-treino ═══════════
  -- Fecha a lista dos tres nao versionados. O hifen no nome indica criacao
  -- pela interface do Supabase. A chave sai mascarada.
  v_n := 6000;
  for r in
    select t.tgname, c.relname as tabela,
           pr.pronamespace::regnamespace::text || '.' || pr.proname as funcao,
           t.tgenabled, pg_get_triggerdef(t.oid) as def
      from pg_trigger t
      join pg_class c  on c.oid = t.tgrelid
      join pg_proc pr  on pr.oid = t.tgfoid
      join pg_namespace ns on ns.oid = c.relnamespace
     where not t.tgisinternal and ns.nspname = 'public'
       and pr.pronamespace::regnamespace::text = 'supabase_functions'
     order by c.relname, t.tgname
  loop
    v_n := v_n + 1;
    v_def := regexp_replace(r.def, 'Bearer [A-Za-z0-9._-]+', 'Bearer <SERVICE_ROLE_OMITIDO>', 'g');
    insert into conf81 values (v_n, 'G WEBHOOK', r.tabela || ' / ' || r.tgname,
      r.funcao || ' / ' || case when r.tgenabled = 'D' then 'DESLIGADO' else 'ativo' end
      || ' / ' || v_def);
  end loop;
  if v_n = 6000 then
    insert into conf81 values (6001, 'G WEBHOOK', 'webhooks', '(nenhum)');
  end if;

end $$;

select ordem, bloco, item, valor from conf81 order by ordem;
