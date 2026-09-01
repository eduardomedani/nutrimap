-- ===========================================================================
-- QUEM E O PACIENTE ORFAO QUE BARROU A ETAPA 4B
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- POR QUE ESTE SCRIPT EXISTE. db/conferencia/109_prontidao_4b.sql achou UMA
-- linha em `public.pacientes` cujo `nutri_id` nao e a organizacao. Enquanto a
-- RLS for `nutri_id = auth.uid()`, ela e visivel para quem tiver aquele uuid;
-- depois da 4B, a policy passa a exigir `nutri_id = organizacao_do_auth()` e a
-- linha some da tela para TODO MUNDO, inclusive para o proprietario.
--
-- Sumir da tela nao e sumir do banco: a linha continua la, com tudo o que
-- estiver pendurado nela. E pior que apagar, porque nao aparece em lugar
-- nenhum e ninguem lembra que existe.
--
-- O QUE DECIDIR. Sao tres saidas, e a escolha depende do que este script
-- mostrar:
--
--   a) E cliente de verdade desta organizacao -> mudar o `nutri_id` para a
--      organizacao. E um update de uma linha, e a Etapa 4B segue.
--   b) E fixture de teste ou cadastro duplicado -> apagar, com o que estiver
--      pendurado. Ver a secao O QUE ESTA PENDURADO antes.
--   c) E de OUTRA conta de verdade (o repositorio ja registrou mais de uma —
--      ver db/conferencia/73 e 82) -> deixar como esta, e aceitar que a 4B a
--      torne invisivel para esta organizacao. Ai a linha do 109 vira ruido
--      conhecido, e vale anotar.
--
-- Adivinhar aqui custa caro nos dois sentidos: reatribuir cliente de outra
-- conta e vazamento; apagar cliente de verdade e perda.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/110_paciente_orfao_LIMPO.sql
-- ===========================================================================

drop table if exists conf110;
create temp table conf110 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_org  uuid;
  v_n    int;
  r      record;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  insert into conf110 values (0, 'ORGANIZACAO', 'id', v_org::text, '');

  -- ═══════════ QUEM SAO OS DONOS DE PACIENTE ═══════════
  -- Se houver mais de um uuid aqui, a base tem mais de uma conta com cadastro
  -- proprio — e o orfao provavelmente e de uma delas.
  for r in
    select p.nutri_id,
           count(*) as quantos,
           min(p.criado_em)::date as primeiro,
           max(p.criado_em)::date as ultimo
      from public.pacientes p
     group by p.nutri_id
     order by count(*) desc
  loop
    insert into conf110 values (10, 'DONOS DE PACIENTE', r.nutri_id::text,
      r.quantos || ' paciente(s) | de ' || r.primeiro || ' a ' || r.ultimo,
      case when r.nutri_id = v_org then 'a organizacao' else 'FORA DA ORGANIZACAO' end);
  end loop;

  -- ═══════════ O DONO DO ORFAO EXISTE? ═══════════
  -- O uuid pode apontar para uma conta viva, para uma conta apagada, ou para
  -- nada. Cada caso muda a decisao.
  for r in
    select distinct p.nutri_id,
           (select count(*) from auth.users u where u.id = p.nutri_id)           as em_auth,
           (select count(*) from public.nutricionistas n where n.id = p.nutri_id) as em_nutricionistas,
           (select count(*) from public.organizacoes o where o.id = p.nutri_id)   as em_organizacoes,
           (select count(*) from public.admins a where a.user_id = p.nutri_id)    as em_admins
      from public.pacientes p
     where p.nutri_id <> v_org
  loop
    insert into conf110 values (20, 'O DONO DO ORFAO', r.nutri_id::text,
      'auth.users: ' || r.em_auth
      || ' | nutricionistas: ' || r.em_nutricionistas
      || ' | organizacoes: ' || r.em_organizacoes
      || ' | admins: ' || r.em_admins,
      case when r.em_auth = 0 then 'CONTA NAO EXISTE MAIS — orfao de verdade'
           when r.em_admins > 0 then 'e uma conta de profissional ATIVA'
           else 'conta existe, mas nao e admin' end);
  end loop;

  -- O email da conta dona, que e o que identifica de quem e.
  for r in
    select distinct p.nutri_id, u.email, u.created_at::date as conta_criada
      from public.pacientes p
      join auth.users u on u.id = p.nutri_id
     where p.nutri_id <> v_org
  loop
    insert into conf110 values (21, 'O DONO DO ORFAO', 'email da conta',
      coalesce(r.email, '(sem email)') || ' | conta de ' || r.conta_criada, '');
  end loop;

  -- ═══════════ A LINHA ═══════════
  for r in
    select p.id, p.codigo, p.nome, p.email, p.telefone, p.status,
           p.criado_em::date as criado, p.completado_em::date as completado,
           p.auth_user_id
      from public.pacientes p
     where p.nutri_id <> v_org
     order by p.criado_em
  loop
    insert into conf110 values (30, 'O PACIENTE', coalesce(r.nome, '(sem nome)'),
      'codigo ' || coalesce(r.codigo, '-')
      || ' | status ' || coalesce(r.status, '-')
      || ' | criado ' || coalesce(r.criado::text, '-')
      || ' | anamnese ' || coalesce(r.completado::text, 'nao respondeu')
      || ' | contato ' || coalesce(nullif(r.telefone, ''), nullif(r.email, ''), 'nenhum'),
      case when r.auth_user_id is not null then 'TEM LOGIN NO APP DO ALUNO'
           else 'sem login proprio' end);
    insert into conf110 values (31, 'O PACIENTE', 'id', r.id::text, '');
  end loop;

  -- ═══════════ O QUE ESTA PENDURADO ═══════════
  -- Decide se apagar e barato ou caro. Cada numero aqui some junto, por
  -- CASCADE, se a saida escolhida for apagar.
  for r in
    select p.id, p.nome
      from public.pacientes p
     where p.nutri_id <> v_org
  loop
    select count(*) into v_n from public.comercial_assinaturas where paciente_id = r.id;
    insert into conf110 values (40, 'PENDURADO', 'assinaturas', v_n::text, '');

    select count(*) into v_n from public.financeiro_lancamentos where paciente_id = r.id;
    insert into conf110 values (41, 'PENDURADO', 'lancamentos financeiros', v_n::text,
      case when v_n > 0 then 'apagar o paciente NAO apaga estes (SET NULL), mas desliga' else '' end);

    select count(*) into v_n from public.respostas where paciente_id = r.id;
    insert into conf110 values (42, 'PENDURADO', 'respostas de anamnese', v_n::text, '');

    begin
      execute 'select count(*) from public.avaliacoes where paciente_id = $1' into v_n using r.id;
      insert into conf110 values (43, 'PENDURADO', 'avaliacoes', v_n::text, '');
    exception when undefined_table then null;
    end;

    begin
      execute 'select count(*) from public.paciente_documentos where paciente_id = $1' into v_n using r.id;
      insert into conf110 values (44, 'PENDURADO', 'documentos', v_n::text, '');
    exception when undefined_table then null;
    end;

    begin
      execute 'select count(*) from public.consultas where paciente_id = $1' into v_n using r.id;
      insert into conf110 values (45, 'PENDURADO', 'consultas', v_n::text, '');
    exception when undefined_table then null;
    end;
  end loop;

  -- ═══════════ HA CADASTRO PARECIDO NA ORGANIZACAO? ═══════════
  -- Se o mesmo nome ja existe do lado certo, o orfao e duplicata e a saida (b)
  -- fica obvia — nao se perde nada apagando.
  for r in
    select o.nome as orfao, p.nome as na_organizacao, p.codigo, p.status
      from public.pacientes o
      join public.pacientes p
        on p.nutri_id = v_org
       and lower(trim(p.nome)) = lower(trim(o.nome))
     where o.nutri_id <> v_org
  loop
    insert into conf110 values (50, 'DUPLICATA?', r.orfao,
      'ja existe na organizacao: ' || r.na_organizacao
      || ' | codigo ' || coalesce(r.codigo, '-')
      || ' | ' || coalesce(r.status, '-'),
      'MESMO NOME dos dois lados');
  end loop;
  if not exists (select 1 from conf110 where secao = 'DUPLICATA?') then
    insert into conf110 values (50, 'DUPLICATA?', 'nome igual na organizacao', 'nenhum',
      'o orfao nao e copia de ninguem');
  end if;
end $$;

select ordem, secao, item, valor, resultado from conf110 order by ordem, item;
