-- ===========================================================================
-- DUAS ORGANIZACOES — cada uma resolve para si, e nada mudou de dono
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. Le, e simula a identidade de cada proprietario dentro da
-- transacao para calcular o que o banco calcularia para ele. Nada e gravado.
--
-- POR QUE SIMULAR A IDENTIDADE. No SQL Editor a sessao e do papel `postgres` e
-- auth.uid() e nulo, entao organizacao_do_auth() devolveria null para qualquer
-- um. `set_config(..., is_local => true)` poe a claim que auth.uid() le, vale
-- so ate o fim desta transacao e nao concede privilegio nenhum.
--
-- ===========================================================================
-- O QUE ESTE SCRIPT PRECISA PROVAR
-- ---------------------------------------------------------------------------
-- 1) o Caio resolve para a organizacao DELE, e ela e o proprio uuid dele;
-- 2) ele tem as 34 permissoes, porque o perfil e Proprietario;
-- 3) o proprietario da instalacao continua resolvendo para a organizacao DELE;
-- 4) NENHUM dado mudou de dono — os dois lados continuam com a mesma contagem
--    que tinham antes do bootstrap;
-- 5) as duas organizacoes nao se enxergam.
--
-- O item 4 e o que justifica a estrategia inteira. `organizacoes.id` = uuid da
-- conta significa que nenhum `update` foi necessario; se algum dado tivesse
-- mudado de dono, a contagem denunciaria.
--
-- ---------------------------------------------------------------------------
-- E O QUE ELE TESTA POR TABELA, EM VEZ DE POR LISTA
-- ---------------------------------------------------------------------------
-- A contagem por tabela e descoberta em information_schema e feita com
-- query_to_xml. Uma lista escrita a mao das tabelas com `nutri_id` envelhece
-- no primeiro modulo novo — e este script existe justamente para ser rodado de
-- novo depois da Etapa 4.
--
-- Para colar no SQL Editor, use db/conferencia/86_duas_organizacoes_LIMPO.sql
-- ===========================================================================

drop table if exists conf86;
create temp table conf86 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_dono   uuid;
  v_caio   uuid;
  v_res    uuid;
  v_n      integer;
  v_total  integer;
  r        record;
begin

  -- A organizacao da INSTALACAO se resolve por public.admins, e nao por
  -- "a primeira que aparecer": desde o bootstrap ha duas linhas em
  -- organizacoes, e `order by criado_em limit 1` deixou de dizer qual e.
  select o.proprietario_user_id into v_dono
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  select o.proprietario_user_id into v_caio
    from public.organizacoes o
   where not exists (select 1 from public.admins a where a.user_id = o.proprietario_user_id);

  if v_dono is null or v_caio is null then
    insert into conf86 values (0, 'GUARDA', 'as duas organizacoes',
      'nao achei uma com dono em admins e outra sem', 'FALHOU');
    return;
  end if;

  -- ═══════════ 1) QUEM E QUEM ═══════════
  for r in
    select o.id, o.nome, o.proprietario_user_id, o.ativo, u.email,
           exists (select 1 from public.admins a where a.user_id = o.proprietario_user_id) as e_admin
      from public.organizacoes o
      join auth.users u on u.id = o.proprietario_user_id
     order by o.criado_em
  loop
    insert into conf86 values (10, 'ORGANIZACOES', r.email,
      r.nome || ' | id ' || left(r.id::text, 8)
      || ' | ativa ' || r.ativo::text
      || ' | dono em admins ' || r.e_admin::text,
      case when r.id = r.proprietario_user_id then 'OK (id = uuid do dono)'
           else 'FALHOU (id diferente do dono)' end);
  end loop;

  -- ═══════════ 2) CADA UM RESOLVE PARA SI ═══════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_dono)::text, true);
  v_res := public.organizacao_do_auth();
  insert into conf86 values (20, 'RESOLUCAO', 'proprietario da instalacao',
    coalesce(left(v_res::text, 8), 'null'),
    case when v_res = v_dono then 'OK' else 'FALHOU' end);

  select count(*) into v_n from public.minhas_permissoes();
  insert into conf86 values (21, 'RESOLUCAO', 'permissoes do proprietario', v_n || ' de 34',
    case when v_n = 34 then 'OK' else 'FALHOU' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_caio)::text, true);
  v_res := public.organizacao_do_auth();
  insert into conf86 values (22, 'RESOLUCAO', 'Caio',
    coalesce(left(v_res::text, 8), 'null'),
    case when v_res = v_caio then 'OK (= o proprio uuid dele)' else 'FALHOU' end);

  select count(*) into v_n from public.minhas_permissoes();
  insert into conf86 values (23, 'RESOLUCAO', 'permissoes do Caio', v_n || ' de 34',
    case when v_n = 34 then 'OK' else 'FALHOU' end);

  -- Nenhuma chave a mais nem a menos que o proprietario: os dois sao
  -- Proprietario, e o pacote e o catalogo inteiro por construcao.
  insert into conf86 values (24, 'RESOLUCAO', 'as tres chaves novas de agenda',
    'visualizar=' || public.tem_permissao('agenda.visualizar')::text
    || ' criar=' || public.tem_permissao('agenda.criar')::text
    || ' editar=' || public.tem_permissao('agenda.editar')::text,
    case when public.tem_permissao('agenda.visualizar')
          and public.tem_permissao('agenda.criar')
          and public.tem_permissao('agenda.editar') then 'OK' else 'FALHOU' end);

  perform set_config('request.jwt.claims', null, true);

  -- ═══════════ 3) NADA MUDOU DE DONO ═══════════
  -- Uma linha por tabela com `nutri_id` que tenha dado de algum dos dois.
  v_total := 0;
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name = 'nutri_id'
       and t.table_type = 'BASE TABLE'
     order by c.table_name
  loop
    execute format('select count(*) from public.%I where nutri_id = %L', r.table_name, v_caio)
      into v_n;
    if v_n > 0 then
      v_total := v_total + v_n;
      insert into conf86 values (30, 'DADO DO CAIO', r.table_name, v_n::text, 'ok');
    end if;
  end loop;

  -- Tres, e nao dois: 1 paciente + 1 evento de timeline + 1 codigos_uso. O
  -- registro de uso do codigo tambem tem `nutri_id`, e o script 73 ja o
  -- contava — a primeira versao desta linha esperava 2 porque eu esqueci dele.
  insert into conf86 values (31, 'DADO DO CAIO', '~ total de linhas', v_total::text,
    case when v_total = 3 then 'OK (1 paciente + 1 evento + 1 codigos_uso, como antes)'
         else 'CONFERIR (esperado 3)' end);

  select count(*) into v_n from public.pacientes p where p.nutri_id = v_dono;
  insert into conf86 values (32, 'DADO DO PROPRIETARIO', 'pacientes', v_n::text,
    case when v_n = 93 then 'OK (93, como antes)' else 'CONFERIR (esperado 93)' end);

  select count(*) into v_n from public.codigos_uso cu where cu.nutri_id = v_caio;
  insert into conf86 values (33, 'DADO DO CAIO', 'codigos_uso', v_n::text,
    case when v_n = 1 then 'OK (intocado)' else 'CONFERIR (esperado 1)' end);

  -- ═══════════ 4) AS DUAS NAO SE ENXERGAM ═══════════
  -- Ainda nao ha isolamento por policy — a Etapa 4 e que troca o predicado.
  -- O que se confere aqui e o pre-requisito dele: os conjuntos de dado sao
  -- disjuntos, entao trocar `auth.uid()` por `organizacao_do_auth()` nao move
  -- nem uma linha de lado.
  select count(*) into v_n from public.pacientes p
   where p.nutri_id = v_caio and p.nutri_id = v_dono;
  insert into conf86 values (40, 'ISOLAMENTO', 'pacientes em comum', v_n::text,
    case when v_n = 0 then 'OK' else 'FALHOU' end);

  select count(*) into v_n from public.organizacao_usuarios ou
   where ou.organizacao_id = v_caio and ou.auth_user_id = v_dono;
  insert into conf86 values (41, 'ISOLAMENTO', 'o dono e membro da org do Caio?', v_n::text,
    case when v_n = 0 then 'OK (nao)' else 'FALHOU' end);

  select count(*) into v_n from public.organizacao_usuarios ou
   where ou.organizacao_id = v_dono and ou.auth_user_id = v_caio;
  insert into conf86 values (42, 'ISOLAMENTO', 'o Caio e membro da org principal?', v_n::text,
    case when v_n = 0 then 'OK (nao)' else 'FALHOU' end);

  select count(*) into v_n from public.organizacao_usuarios ou where ou.organizacao_id = v_dono;
  insert into conf86 values (43, 'ISOLAMENTO', 'membros da organizacao principal', v_n::text,
    case when v_n = 2 then 'OK (proprietario + conta de teste)' else 'CONFERIR' end);

end $$;

insert into conf86
select 99, 'VEREDITO',
  case when exists (select 1 from conf86 where resultado like 'FALHOU%') then 'HA FALHAS'
       when exists (select 1 from conf86 where resultado like 'CONFERIR%') then 'CONFERIR AS LINHAS MARCADAS'
       else 'DUAS ORGANIZACOES, ZERO DADO MOVIDO' end,
  coalesce((select string_agg(distinct item, ', ') from conf86
             where resultado like 'FALHOU%' or resultado like 'CONFERIR%'), 'nada a apontar'),
  '';

select ordem, secao, item, valor, resultado from conf86 order by ordem, item;
