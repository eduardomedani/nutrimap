-- ===========================================================================
-- ETAPA 4A — RLS EXERCITADA DE VERDADE, com quatro identidades
-- ---------------------------------------------------------------------------
-- RODE DEPOIS de db/multiusuario_comercial_planos_rls.sql.
--
-- NAO DEIXA RASTRO. Cria uma fixture na organizacao do Caio, exercita a RLS
-- sob quatro contextos diferentes e desfaz tudo antes de terminar.
--
-- ===========================================================================
-- O QUE ESTE SCRIPT PROVA, E O QUE ELE NAO PROVA
-- ---------------------------------------------------------------------------
-- PROVA  : o motor de RLS do PostgreSQL. Papel `authenticated`, auth.uid()
--          vindo das claims, organizacao_do_auth(), tem_permissao(), os
--          predicados USING e WITH CHECK, e o isolamento entre as duas
--          organizacoes.
--
-- NAO PROVA : a camada PostgREST — grants, embeds, formato de erro — nem o
--          navegador, nem o token real do Supabase Auth de ninguem.
--
-- Classificacao correta do resultado:
--   APROVADO — MOTOR RLS POSTGRESQL
-- e NAO:
--   APROVADO E2E/POSTGREST
--
-- O proprietario e a Recepcao TAMBEM sao testados pela interface, com login de
-- verdade. So o Caio depende deste atalho, porque nao temos a senha dele — e
-- um teste que exigisse a senha de outra pessoa nao seria um teste, seria um
-- problema.
--
-- ===========================================================================
-- POR QUE `set role authenticated` E O SUFICIENTE E O NECESSARIO
-- ---------------------------------------------------------------------------
-- No SQL Editor a sessao e do papel `postgres`, que tem BYPASSRLS: policy
-- nenhuma se aplica a ele. Todo teste de RLS feito assim passa por construcao,
-- e nao mede nada.
--
-- `set local role authenticated` troca o papel corrente para o MESMO papel que
-- o PostgREST usa quando alguem chega com um JWT valido. A partir dali a RLS
-- vale integralmente. As claims entram por set_config, e e de la que auth.uid()
-- as le — a mesma coisa que o PostgREST faz.
--
-- Isso NAO e service_role, e nao poderia ser: service_role tambem ignora RLS,
-- entao usa-lo como prova de RLS seria o mesmo erro do postgres com outro nome.
--
-- ---------------------------------------------------------------------------
-- COMO TUDO VOLTA AO LUGAR
-- ---------------------------------------------------------------------------
-- O bloco de teste e uma subtransacao que termina levantando a propria
-- excecao. A fixture e revertida, e o `set local role` tambem — SET LOCAL e
-- desfeito junto com a subtransacao, entao o papel volta a postgres sozinho.
-- O `reset role` no handler e cinto e suspensorio.
--
-- Os resultados sobrevivem porque ficam em `v_log`, variavel de memoria.
-- Variavel nao e transacional. Gravar em conf88 dentro do bloco apagaria o
-- resultado junto com o teste — e `authenticated` nem teria permissao de
-- escrever na tabela temporaria, que pertence ao postgres.
--
-- Para colar no SQL Editor, use db/conferencia/88_comercial_planos_rls_real_LIMPO.sql
-- ===========================================================================

drop table if exists conf88;
create temp table conf88 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_dono    uuid;
  v_caio    uuid;
  v_recep   uuid;
  v_fix     uuid;
  v_n       int;
  v_dono_n  int;
  v_caio_n  int;
  v_log     text[] := '{}';
  v_p       text[];
  v_i       int;
  v_err     text;
begin

  -- ═══════════ IDENTIDADES ═══════════
  select o.proprietario_user_id into v_dono
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  select o.proprietario_user_id into v_caio
    from public.organizacoes o
   where not exists (select 1 from public.admins a where a.user_id = o.proprietario_user_id);

  select ou.auth_user_id into v_recep
    from public.organizacao_usuarios ou
    join public.perfis pf on pf.id = ou.perfil_id
   where ou.organizacao_id = v_dono and pf.chave = 'recepcao';

  if v_dono is null or v_caio is null or v_recep is null then
    insert into conf88 values (0, 'GUARDA', 'identidades',
      'faltou proprietario, Caio ou Recepcao', 'FALHOU');
    return;
  end if;

  insert into conf88 values (1, 'IDENTIDADES', 'organizacao principal', left(v_dono::text, 8), 'ok');
  insert into conf88 values (2, 'IDENTIDADES', 'organizacao do Caio',   left(v_caio::text, 8), 'ok');
  insert into conf88 values (3, 'IDENTIDADES', 'Recepcao (auth.uid)',   left(v_recep::text, 8), 'ok');

  -- ═══════════ A MIGRATION ESTA APLICADA? ═══════════
  -- Sem esta guarda o script rodaria contra as policies antigas e devolveria
  -- resultados que parecem bons: o Caio veria a propria fixture do mesmo jeito,
  -- porque para ele auth.uid() ja e a organizacao. O que NAO apareceria e a
  -- prova da permissao — e ninguem notaria a diferenca.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'comercial_planos'
     and coalesce(qual, '') || coalesce(with_check, '') like '%tem_permissao%';
  insert into conf88 values (4, 'GUARDA', 'policies com tem_permissao', v_n || ' de 4',
    case when v_n = 4 then 'OK' else 'FALHOU (rode a migration antes)' end);
  if v_n <> 4 then return; end if;

  -- Contagem real, ainda como postgres, para comparar com o que cada contexto
  -- consegue enxergar.
  select count(*) into v_dono_n from public.comercial_planos where nutri_id = v_dono;
  select count(*) into v_caio_n from public.comercial_planos where nutri_id = v_caio;
  insert into conf88 values (5, 'BASE', 'planos da organizacao principal', v_dono_n::text, 'ok');
  insert into conf88 values (6, 'BASE', 'planos da organizacao do Caio',   v_caio_n::text, 'ok');

  -- ═══════════════════════════════════════════════════════════
  -- O TESTE, EM SUBTRANSACAO
  -- ═══════════════════════════════════════════════════════════
  begin
    perform set_config('role', 'authenticated', true);

    -- ── 1) CONTEXTO DO CAIO — ele cria a propria fixture ──────────────────
    -- O insert e feito POR ELE, sob RLS. Se o WITH CHECK ou o default
    -- estiverem errados, falha aqui — e falhar aqui e informacao.
    perform set_config('request.jwt.claims', json_build_object('sub', v_caio)::text, true);

    insert into public.comercial_planos (nome, preco_padrao, ativo, ordem)
    values ('[FIXTURE 4A] plano de teste de isolamento', 0, false, 999)
    returning id into v_fix;

    v_log := v_log || ('Caio cria plano' || E'\t' || 'id ' || left(v_fix::text, 8) || E'\t' || 'OK');

    -- O dono gravado tem que ser a organizacao dele, e o autor tambem — para
    -- o Caio os dois coincidem, porque ele E o proprietario da organizacao
    -- dele. E justamente por isso ele NAO serve para provar dono <> autor;
    -- essa prova e da Recepcao, pela interface.
    select count(*) into v_n from public.comercial_planos
     where id = v_fix and nutri_id = v_caio and criado_por = v_caio;
    v_log := v_log || ('dono e autor da fixture' || E'\t'
      || 'nutri_id e criado_por = Caio' || E'\t'
      || case when v_n = 1 then 'OK' else 'FALHOU' end);

    select count(*) into v_n from public.comercial_planos;
    v_log := v_log || ('Caio enxerga' || E'\t'
      || v_n || ' plano(s) — esperado ' || (v_caio_n + 1) || ' (os dele + a fixture)' || E'\t'
      || case when v_n = v_caio_n + 1 then 'OK' else 'FALHOU' end);

    select count(*) into v_n from public.comercial_planos where nutri_id = v_dono;
    v_log := v_log || ('Caio ve a organizacao principal?' || E'\t'
      || v_n || ' de ' || v_dono_n || ' plano(s)' || E'\t'
      || case when v_n = 0 then 'OK (isolado)' else 'FALHOU — VAZAMENTO' end);

    -- ── 2) CONTEXTO DO PROPRIETARIO ──────────────────────────────────────
    perform set_config('request.jwt.claims', json_build_object('sub', v_dono)::text, true);

    select count(*) into v_n from public.comercial_planos;
    v_log := v_log || ('proprietario enxerga' || E'\t'
      || v_n || ' plano(s) — esperado ' || v_dono_n || E'\t'
      || case when v_n = v_dono_n then 'OK' else 'FALHOU' end);

    select count(*) into v_n from public.comercial_planos where id = v_fix;
    v_log := v_log || ('proprietario ve a fixture do Caio?' || E'\t' || v_n::text || E'\t'
      || case when v_n = 0 then 'OK (isolado)' else 'FALHOU — VAZAMENTO' end);

    -- ── 3) CONTEXTO DA RECEPCAO ──────────────────────────────────────────
    perform set_config('request.jwt.claims', json_build_object('sub', v_recep)::text, true);

    select count(*) into v_n from public.comercial_planos;
    v_log := v_log || ('Recepcao enxerga' || E'\t'
      || v_n || ' plano(s) — esperado ' || v_dono_n || ' (os MESMOS do proprietario)' || E'\t'
      || case when v_n = v_dono_n then 'OK — auth.uid() diferente, mesma organizacao' else 'FALHOU' end);

    select count(*) into v_n from public.comercial_planos where id = v_fix;
    v_log := v_log || ('Recepcao ve a fixture do Caio?' || E'\t' || v_n::text || E'\t'
      || case when v_n = 0 then 'OK (isolado)' else 'FALHOU — VAZAMENTO' end);

    -- ── 4) TENANT FORJADO ────────────────────────────────────────────────
    -- Ainda como Recepcao: mandar explicitamente o uuid da outra organizacao,
    -- que e o que um request adulterado no DevTools faria.
    begin
      insert into public.comercial_planos (nutri_id, nome, ativo)
      values (v_caio, '[FIXTURE 4A] tenant forjado', false);
      v_log := v_log || ('Recepcao grava na organizacao do Caio?' || E'\t'
        || 'ACEITOU — a linha foi criada' || E'\t' || 'FALHOU — FURO GRAVE');
    exception when others then
      v_log := v_log || ('Recepcao grava na organizacao do Caio?' || E'\t'
        || sqlerrm || E'\t' || 'OK (recusado pelo with check)');
    end;

    -- ── 5) A RECEPCAO GRAVA NA PROPRIA ORGANIZACAO, SEM MANDAR O DONO ────
    -- Esta e a prova central do piloto: o banco preenche o tenant pelo default
    -- e o autor pelo dele. Duas colunas vizinhas com valores diferentes.
    begin
      insert into public.comercial_planos (nome, preco_padrao, ativo, ordem)
      values ('[FIXTURE 4A] criado pela Recepcao', 0, false, 999)
      returning id into v_fix;

      select count(*) into v_n from public.comercial_planos
       where id = v_fix and nutri_id = v_dono and criado_por = v_recep;
      v_log := v_log || ('DONO <> AUTOR' || E'\t'
        || 'nutri_id = organizacao, criado_por = Recepcao' || E'\t'
        || case when v_n = 1 then 'OK' else 'FALHOU' end);
    exception when others then
      v_log := v_log || ('DONO <> AUTOR' || E'\t' || sqlerrm || E'\t' || 'FALHOU');
    end;

    execute 'reset role';
    raise exception 'ROLLBACK_DA_PROVA';

  exception when others then
    v_err := sqlerrm;
    execute 'reset role';
    if v_err <> 'ROLLBACK_DA_PROVA' then
      v_log := v_log || ('INTERROMPIDO' || E'\t' || v_err || E'\t' || 'FALHOU');
    end if;
  end;

  for v_i in 1 .. coalesce(array_length(v_log, 1), 0) loop
    v_p := string_to_array(v_log[v_i], E'\t');
    insert into conf88 values (100 + v_i, 'RLS REAL', v_p[1], v_p[2], v_p[3]);
  end loop;

  -- ═══════════ NADA SOBROU ═══════════
  select count(*) into v_n from public.comercial_planos where nome like '[FIXTURE 4A]%';
  insert into conf88 values (200, 'SEM RASTRO', 'fixtures restantes', v_n::text,
    case when v_n = 0 then 'OK' else 'FALHOU (sobrou fixture)' end);

  select count(*) into v_n from public.comercial_planos where nutri_id = v_dono;
  insert into conf88 values (201, 'SEM RASTRO', 'planos da organizacao principal',
    v_n || ' — antes eram ' || v_dono_n,
    case when v_n = v_dono_n then 'OK' else 'FALHOU' end);

  select count(*) into v_n from public.comercial_planos where nutri_id = v_caio;
  insert into conf88 values (202, 'SEM RASTRO', 'planos da organizacao do Caio',
    v_n || ' — antes eram ' || v_caio_n,
    case when v_n = v_caio_n then 'OK' else 'FALHOU' end);

  insert into conf88 values (203, 'SEM RASTRO', 'papel atual', current_user,
    case when current_user = 'postgres' then 'OK' else 'ATENCAO' end);
end $$;

insert into conf88
select 999, 'VEREDITO',
  case when exists (select 1 from conf88 where resultado like 'FALHOU%') then 'HA FALHAS'
       when exists (select 1 from conf88 where resultado like 'ATENCAO%') then 'ATENCAO'
       else 'APROVADO — MOTOR RLS POSTGRESQL (nao e E2E/PostgREST)' end,
  coalesce((select string_agg(distinct item, ', ') from conf88
             where resultado like 'FALHOU%' or resultado like 'ATENCAO%'), 'nada a apontar'),
  '';

select ordem, secao, item, valor, resultado from conf88 order by ordem, item;
