-- ===========================================================================
-- ETAPA 4A — RETRATO DEPOIS da migration de public.comercial_planos
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. Mesmas perguntas do script 87, para comparar lado a lado.
--
-- COMO LER. As secoes DADOS, PLANO e IDENTIDADES tem que estar IDENTICAS as do
-- 87. As secoes ESTRUTURA e POLICY tem que estar diferentes, e o script diz
-- exatamente como esperava que estivessem.
--
-- Se DADOS ou PLANO mudarem, alguma coisa moveu dado de dono — e a migration
-- nao tem um unico `update` em nenhum lugar, entao seria sintoma de outra
-- coisa. Nesse caso, PARE.
--
-- Para colar no SQL Editor, use db/conferencia/89_comercial_planos_depois_LIMPO.sql
-- ===========================================================================

drop table if exists conf89;
create temp table conf89 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_dono uuid;
  v_caio uuid;
  r      record;
  v_n    int;
  v_txt  text;
begin
  select o.proprietario_user_id into v_dono
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  select o.proprietario_user_id into v_caio
    from public.organizacoes o
   where not exists (select 1 from public.admins a where a.user_id = o.proprietario_user_id);

  -- ═══════════ ESTRUTURA — TEM que ter mudado ═══════════
  insert into conf89 values (10, 'ESTRUTURA', 'RLS ligada',
    (select c.relrowsecurity::text from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relname = 'comercial_planos'),
    'esperado true, igual ao 87');

  select column_default into v_txt from information_schema.columns
   where table_schema = 'public' and table_name = 'comercial_planos' and column_name = 'nutri_id';
  insert into conf89 values (11, 'ESTRUTURA', 'default de nutri_id', v_txt,
    case when v_txt like '%organizacao_do_auth%' then 'OK (mudou, como esperado)'
         else 'FALHOU (ainda e o antigo)' end);

  select column_default into v_txt from information_schema.columns
   where table_schema = 'public' and table_name = 'comercial_planos' and column_name = 'criado_por';
  insert into conf89 values (12, 'ESTRUTURA', 'default de criado_por', v_txt,
    case when v_txt like '%auth.uid%' then 'OK (INTOCADO — e o autor)'
         else 'FALHOU (nao deveria ter mudado)' end);

  insert into conf89 values (13, 'ESTRUTURA', 'grants de authenticated',
    case when has_table_privilege('authenticated', 'public.comercial_planos', 'select') then 'select ' else '' end ||
    case when has_table_privilege('authenticated', 'public.comercial_planos', 'insert') then 'insert ' else '' end ||
    case when has_table_privilege('authenticated', 'public.comercial_planos', 'update') then 'update ' else '' end ||
    case when has_table_privilege('authenticated', 'public.comercial_planos', 'delete') then 'delete' else '' end,
    'esperado igual ao 87 — a migration nao mexe em grant');

  -- ═══════════ POLICIES ═══════════
  for r in
    select policyname, cmd, roles::text as papeis, qual, with_check
      from pg_policies
     where schemaname = 'public' and tablename = 'comercial_planos'
     order by policyname
  loop
    insert into conf89 values (20, 'POLICY', r.policyname,
      r.cmd || ' to ' || r.papeis
      || ' | using: '      || coalesce(r.qual, '(nenhum)')
      || ' | with check: ' || coalesce(r.with_check, '(nenhum)'),
      case when coalesce(r.qual, '') || coalesce(r.with_check, '') like '%organizacao_do_auth%'
            and coalesce(r.qual, '') || coalesce(r.with_check, '') like '%tem_permissao%'
           then 'OK (tenancy + permissao)'
           else 'FALHOU (falta organizacao ou permissao)' end);
  end loop;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'comercial_planos';
  insert into conf89 values (21, 'POLICY', '~ total', v_n::text,
    case when v_n = 4 then 'OK' else 'FALHOU' end);

  -- A chave certa em cada operacao. Sem isto, uma policy de SELECT pedindo
  -- `comercial.editar` passaria nas conferencias acima e so apareceria quando
  -- alguem com leitura reclamasse que nao ve nada.
  for r in
    select policyname, cmd,
           coalesce(qual, '') || coalesce(with_check, '') as texto
      from pg_policies
     where schemaname = 'public' and tablename = 'comercial_planos'
     order by policyname
  loop
    insert into conf89 values (22, 'CHAVE POR OPERACAO', r.policyname,
      case when r.texto like '%comercial.visualizar%' then 'comercial.visualizar'
           when r.texto like '%comercial.editar%'     then 'comercial.editar'
           else '(nenhuma)' end,
      case when r.cmd = 'SELECT' and r.texto like '%comercial.visualizar%' then 'OK'
           when r.cmd <> 'SELECT' and r.texto like '%comercial.editar%'    then 'OK'
           else 'FALHOU' end);
  end loop;

  -- ═══════════ OS DADOS — TEM que estar identicos ao 87 ═══════════
  insert into conf89 values (30, 'DADOS', 'linhas no total',
    (select count(*)::text from public.comercial_planos), 'comparar com o 87');
  insert into conf89 values (31, 'DADOS', 'donos distintos',
    (select count(distinct nutri_id)::text from public.comercial_planos), 'comparar com o 87');
  insert into conf89 values (32, 'DADOS', 'da organizacao principal',
    (select count(*)::text from public.comercial_planos where nutri_id = v_dono), 'comparar com o 87');
  insert into conf89 values (33, 'DADOS', 'da organizacao do Caio',
    (select count(*)::text from public.comercial_planos where nutri_id = v_caio), 'comparar com o 87');
  insert into conf89 values (34, 'DADOS', 'de nenhuma das duas',
    (select count(*)::text from public.comercial_planos
      where nutri_id is distinct from v_dono and nutri_id is distinct from v_caio), 'comparar com o 87');

  select count(*) into v_n from public.comercial_planos where nome like '[FIXTURE 4A]%';
  insert into conf89 values (35, 'DADOS', 'fixtures de teste restantes', v_n::text,
    case when v_n = 0 then 'OK' else 'FALHOU (limpar antes de encerrar)' end);

  for r in
    select p.id, p.nome, p.nutri_id, p.criado_por, p.ativo
      from public.comercial_planos p
     order by p.ordem, p.nome
  loop
    insert into conf89 values (40, 'PLANO', r.nome,
      'id ' || left(r.id::text, 8)
      || ' | dono ' || left(r.nutri_id::text, 8)
      || ' | autor ' || coalesce(left(r.criado_por::text, 8), '(nulo)')
      || ' | ativo ' || r.ativo::text,
      'comparar com o 87');
  end loop;

  insert into conf89 values (50, 'IDENTIDADES', 'organizacao principal', v_dono::text, 'comparar com o 87');
  insert into conf89 values (51, 'IDENTIDADES', 'organizacao do Caio',   v_caio::text, 'comparar com o 87');
end $$;

insert into conf89
select 999, 'VEREDITO',
  case when exists (select 1 from conf89 where resultado like 'FALHOU%') then 'HA FALHAS'
       else 'ESTRUTURA MIGRADA — conferir DADOS e PLANO contra o 87' end,
  coalesce((select string_agg(distinct item, ', ') from conf89
             where resultado like 'FALHOU%'), 'nada a apontar'),
  '';

select ordem, secao, item, valor, resultado from conf89 order by ordem, item;
