-- ===========================================================================
-- ETAPA 4A — RETRATO ANTES da migration de public.comercial_planos
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. Le catalogo e conta linhas. Nenhum dado e modificado.
--
-- RODE ANTES de db/multiusuario_comercial_planos_rls.sql, e guarde a saida.
-- O script 89 devolve exatamente as mesmas linhas depois, e a comparacao entre
-- os dois e a prova de que a migracao nao moveu nada de dono.
--
-- POR QUE UM RETRATO EXPLICITO. "Nenhum dado mudou" e facil de afirmar e
-- dificil de provar depois do fato: sem o numero de antes, o numero de depois
-- nao significa nada. Este script existe para que o de depois signifique.
--
-- Para colar no SQL Editor, use db/conferencia/87_comercial_planos_antes_LIMPO.sql
-- ===========================================================================

drop table if exists conf87;
create temp table conf87 (ordem int, secao text, item text, valor text);

do $$
declare
  v_dono uuid;
  v_caio uuid;
  r      record;
  v_n    int;
begin
  select o.proprietario_user_id into v_dono
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  select o.proprietario_user_id into v_caio
    from public.organizacoes o
   where not exists (select 1 from public.admins a where a.user_id = o.proprietario_user_id);

  -- ═══════════ ESTRUTURA ═══════════
  insert into conf87 values (10, 'ESTRUTURA', 'RLS ligada',
    (select c.relrowsecurity::text from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relname = 'comercial_planos'));

  insert into conf87 values (11, 'ESTRUTURA', 'default de nutri_id',
    (select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'comercial_planos'
        and column_name = 'nutri_id'));

  insert into conf87 values (12, 'ESTRUTURA', 'default de criado_por',
    (select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'comercial_planos'
        and column_name = 'criado_por'));

  insert into conf87 values (13, 'ESTRUTURA', 'grants de authenticated',
    case when has_table_privilege('authenticated', 'public.comercial_planos', 'select') then 'select ' else '' end ||
    case when has_table_privilege('authenticated', 'public.comercial_planos', 'insert') then 'insert ' else '' end ||
    case when has_table_privilege('authenticated', 'public.comercial_planos', 'update') then 'update ' else '' end ||
    case when has_table_privilege('authenticated', 'public.comercial_planos', 'delete') then 'delete' else '' end);

  -- ═══════════ POLICIES, COM O TEXTO INTEIRO ═══════════
  -- E daqui que sai a fonte do rollback. Reconstruir de memoria e como o
  -- baseline da Etapa 1b existe para evitar.
  for r in
    select policyname, cmd, roles::text as papeis, qual, with_check
      from pg_policies
     where schemaname = 'public' and tablename = 'comercial_planos'
     order by policyname
  loop
    insert into conf87 values (20, 'POLICY', r.policyname,
      r.cmd || ' to ' || r.papeis
      || ' | using: '      || coalesce(r.qual, '(nenhum)')
      || ' | with check: ' || coalesce(r.with_check, '(nenhum)'));
  end loop;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'comercial_planos';
  insert into conf87 values (21, 'POLICY', '~ total', v_n::text);

  -- ═══════════ OS DADOS ═══════════
  insert into conf87 values (30, 'DADOS', 'linhas no total',
    (select count(*)::text from public.comercial_planos));
  insert into conf87 values (31, 'DADOS', 'donos distintos',
    (select count(distinct nutri_id)::text from public.comercial_planos));
  insert into conf87 values (32, 'DADOS', 'da organizacao principal',
    (select count(*)::text from public.comercial_planos where nutri_id = v_dono));
  insert into conf87 values (33, 'DADOS', 'da organizacao do Caio',
    (select count(*)::text from public.comercial_planos where nutri_id = v_caio));
  insert into conf87 values (34, 'DADOS', 'de nenhuma das duas',
    (select count(*)::text from public.comercial_planos
      where nutri_id is distinct from v_dono and nutri_id is distinct from v_caio));

  -- Uma linha por plano. E o unico jeito de provar depois que nenhum registro
  -- especifico trocou de dono — a contagem sozinha esconderia uma troca dupla.
  for r in
    select p.id, p.nome, p.nutri_id, p.criado_por, p.ativo
      from public.comercial_planos p
     order by p.ordem, p.nome
  loop
    insert into conf87 values (40, 'PLANO', r.nome,
      'id ' || left(r.id::text, 8)
      || ' | dono ' || left(r.nutri_id::text, 8)
      || ' | autor ' || coalesce(left(r.criado_por::text, 8), '(nulo)')
      || ' | ativo ' || r.ativo::text);
  end loop;

  -- ═══════════ IDENTIDADES DO TESTE ═══════════
  insert into conf87 values (50, 'IDENTIDADES', 'organizacao principal', v_dono::text);
  insert into conf87 values (51, 'IDENTIDADES', 'organizacao do Caio', v_caio::text);
  insert into conf87 values (52, 'IDENTIDADES', 'conta de Recepcao',
    coalesce((select ou.auth_user_id::text
                from public.organizacao_usuarios ou
                join public.perfis pf on pf.id = ou.perfil_id
               where ou.organizacao_id = v_dono and pf.chave = 'recepcao'), '(nao encontrada)'));
end $$;

select ordem, secao, item, valor from conf87 order by ordem, item;
