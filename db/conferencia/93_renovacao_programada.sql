-- ===========================================================================
-- MIGRATION A — CONFERENCIA DA RENOVACAO PROGRAMADA
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- E o portao da Migration B: enquanto esta conferencia nao disser
-- "MIGRATION A VALIDADA", a RPC de pagamento nao entra.
--
-- COMO LER. Tudo que estiver marcado FALHOU precisa de resposta antes de
-- seguir. O VEREDITO no fim resume.
--
-- A linha mais importante e a de RENOVACOES PROGRAMADAS: ela tem que ser ZERO
-- antes de aplicar a B. Entre A e B existe uma janela em que a intencao e
-- gravada mas ainda nao e consumida no pagamento — quem consome e a RPC da B.
-- Uma intencao pendurada nessa janela seria aplicada no periodo errado.
--
-- Para colar no SQL Editor, use db/conferencia/93_renovacao_programada_LIMPO.sql
-- ===========================================================================

drop table if exists conf93;
create temp table conf93 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_dono uuid;
  v_n    int;
  v_txt  text;
  r      record;
begin
  select o.proprietario_user_id into v_dono
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  -- ═══════════ O QUE NAO PODE TER MUDADO ═══════════
  select count(*) into v_n from public.comercial_assinaturas;
  insert into conf93 values (10, 'INTACTO', 'assinaturas no total', v_n::text,
    case when v_n = 94 then 'OK' else 'FALHOU (esperado 94)' end);

  select count(*) into v_n from public.comercial_assinaturas
   where proximo_plano_id is not null
      or proximo_valor_contratado is not null
      or renovacao_definida_em is not null
      or renovacao_definida_por is not null
      or renovacao_origem_id is not null;
  insert into conf93 values (11, 'INTACTO', 'assinaturas com alguma coluna nova preenchida', v_n::text,
    case when v_n = 0 then 'OK (as 94 nasceram NULL)'
         else 'CONFERIR — ver a secao RENOVACOES' end);

  -- As cobrancas de antes da migration nao podem ter mudado de estado. O
  -- numero sai da conferencia 92 + o que a atualizacao de 13/08 criou.
  select count(*) into v_n from public.financeiro_lancamentos where assinatura_id is not null;
  insert into conf93 values (12, 'INTACTO', 'cobrancas de assinatura', v_n::text,
    case when v_n = 31 then 'OK (29 do import + 2 canceladas do teste manual de 13/08)'
         else 'mudou — ver db/conferencia/94_origem_das_cobrancas.sql' end);

  select count(*) into v_n from public.financeiro_lancamentos
   where assinatura_id is not null and status = 'cancelado';
  insert into conf93 values (13, 'INTACTO', 'cobrancas canceladas', v_n::text,
    case when v_n = 2 then 'OK (as 2 da CASO_CANCELAMENTO, 13/08 14:34, investigadas na 94)'
         else 'mudou — ver db/conferencia/94_origem_das_cobrancas.sql' end);

  -- ═══════════ ESTRUTURA ═══════════
  for r in
    select column_name, is_nullable, data_type
      from information_schema.columns
     where table_schema = 'public' and table_name = 'comercial_assinaturas'
       and column_name in ('proximo_plano_id', 'proximo_valor_contratado',
                           'renovacao_definida_em', 'renovacao_definida_por',
                           'renovacao_origem_id')
     order by column_name
  loop
    insert into conf93 values (20, 'ESTRUTURA', r.column_name,
      r.data_type || ' | nullable ' || r.is_nullable,
      case when r.is_nullable = 'YES' then 'OK' else 'FALHOU (tem que ser anulavel)' end);
  end loop;

  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'comercial_assinaturas'
     and column_name in ('proximo_plano_id', 'proximo_valor_contratado',
                         'renovacao_definida_em', 'renovacao_definida_por',
                         'renovacao_origem_id');
  insert into conf93 values (21, 'ESTRUTURA', '~ total de colunas novas', v_n::text,
    case when v_n = 5 then 'OK' else 'FALHOU (esperado 5)' end);

  select count(*) into v_n from pg_constraint
   where conrelid = 'public.comercial_assinaturas'::regclass
     and conname in ('comercial_assinaturas_renovacao_check',
                     'comercial_assinaturas_proximo_valor_check');
  insert into conf93 values (22, 'ESTRUTURA', 'constraints da renovacao', v_n::text,
    case when v_n = 2 then 'OK' else 'FALHOU (esperado 2)' end);

  -- A chave estrangeira do plano futuro tem que ser RESTRICT: apagar um plano
  -- que e o futuro de alguem precisa doer.
  select rc.delete_rule into v_txt
    from information_schema.referential_constraints rc
    join information_schema.key_column_usage k on k.constraint_name = rc.constraint_name
   where k.table_schema = 'public' and k.table_name = 'comercial_assinaturas'
     and k.column_name = 'proximo_plano_id';
  insert into conf93 values (23, 'ESTRUTURA', 'FK de proximo_plano_id', coalesce(v_txt, '(nenhuma)'),
    case when v_txt = 'RESTRICT' then 'OK' else 'FALHOU (esperado RESTRICT)' end);

  select rc.delete_rule into v_txt
    from information_schema.referential_constraints rc
    join information_schema.key_column_usage k on k.constraint_name = rc.constraint_name
   where k.table_schema = 'public' and k.table_name = 'comercial_assinaturas'
     and k.column_name = 'renovacao_origem_id';
  insert into conf93 values (24, 'ESTRUTURA', 'FK de renovacao_origem_id', coalesce(v_txt, '(nenhuma)'),
    case when v_txt = 'SET NULL' then 'OK' else 'FALHOU (esperado SET NULL)' end);

  -- ═══════════ AUDITORIA ═══════════
  select count(*) into v_n from information_schema.tables
   where table_schema = 'public' and table_name = 'comercial_assinatura_auditoria';
  insert into conf93 values (30, 'AUDITORIA', 'tabela existe', v_n::text,
    case when v_n = 1 then 'OK' else 'FALHOU' end);

  select count(*) into v_n from public.comercial_assinatura_auditoria;
  insert into conf93 values (31, 'AUDITORIA', 'linhas', v_n::text,
    case when v_n = 0 then 'OK (comeca vazia, sem historico fabricado)'
         else 'CONFERIR — houve teste; limpar fixtures' end);

  select c.relrowsecurity::text into v_txt from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relname = 'comercial_assinatura_auditoria';
  insert into conf93 values (32, 'AUDITORIA', 'RLS ligada', coalesce(v_txt, '(sem tabela)'),
    case when v_txt = 'true' then 'OK' else 'FALHOU' end);

  -- SO select. Insert/update/delete pela anon-key transformariam a trilha em
  -- rascunho.
  for r in
    select policyname, cmd, coalesce(qual, '') as usando
      from pg_policies
     where schemaname = 'public' and tablename = 'comercial_assinatura_auditoria'
     order by policyname
  loop
    insert into conf93 values (33, 'AUDITORIA', 'policy ' || r.policyname,
      r.cmd || ' | ' || left(r.usando, 160),
      case when r.cmd = 'SELECT'
             and r.usando like '%organizacao_do_auth%'
             and r.usando like '%tem_permissao%'
             and r.usando like '%auth.uid%'
           then 'OK (org + permissao + teto)'
           else 'FALHOU' end);
  end loop;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'comercial_assinatura_auditoria';
  insert into conf93 values (34, 'AUDITORIA', '~ total de policies', v_n::text,
    case when v_n = 1 then 'OK (so SELECT)' else 'FALHOU (esperado 1)' end);

  insert into conf93 values (35, 'AUDITORIA', 'grants de anon',
    case when has_table_privilege('anon', 'public.comercial_assinatura_auditoria', 'select') then 'select ' else '' end ||
    case when has_table_privilege('anon', 'public.comercial_assinatura_auditoria', 'insert') then 'insert ' else '' end ||
    case when has_table_privilege('anon', 'public.comercial_assinatura_auditoria', 'update') then 'update ' else '' end ||
    case when has_table_privilege('anon', 'public.comercial_assinatura_auditoria', 'delete') then 'delete' else '' end,
    case when not has_table_privilege('anon', 'public.comercial_assinatura_auditoria', 'select')
          and not has_table_privilege('anon', 'public.comercial_assinatura_auditoria', 'insert')
         then 'OK (fechada)' else 'FALHOU (anon alcanca a trilha)' end);

  insert into conf93 values (36, 'AUDITORIA', 'grants de authenticated',
    case when has_table_privilege('authenticated', 'public.comercial_assinatura_auditoria', 'select') then 'select ' else '' end ||
    case when has_table_privilege('authenticated', 'public.comercial_assinatura_auditoria', 'insert') then 'insert ' else '' end ||
    case when has_table_privilege('authenticated', 'public.comercial_assinatura_auditoria', 'update') then 'update ' else '' end ||
    case when has_table_privilege('authenticated', 'public.comercial_assinatura_auditoria', 'delete') then 'delete' else '' end,
    case when has_table_privilege('authenticated', 'public.comercial_assinatura_auditoria', 'select')
          and not has_table_privilege('authenticated', 'public.comercial_assinatura_auditoria', 'insert')
         then 'OK (le, nao escreve)'
         else 'FALHOU (so a RPC pode escrever)' end);

  -- ═══════════ AS RPCs ═══════════
  for r in
    select p.proname,
           p.prosecdef,
           pg_get_function_identity_arguments(p.oid) as args,
           has_function_privilege('anon',          p.oid, 'execute') as anon_exec,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('comercial_criar_cobranca_do_periodo', 'comercial_cancelar_cobranca')
     order by p.proname
  loop
    insert into conf93 values (40, 'RPC', r.proname,
      'definer ' || r.prosecdef::text
      || ' | anon ' || r.anon_exec::text
      || ' | authenticated ' || r.auth_exec::text,
      case when r.prosecdef and not r.anon_exec and r.auth_exec then 'OK'
           when r.anon_exec then 'FALHOU (anon executa)'
           when not r.auth_exec then 'FALHOU (authenticated nao executa)'
           else 'FALHOU (nao e security definer)' end);
  end loop;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('comercial_criar_cobranca_do_periodo', 'comercial_cancelar_cobranca');
  insert into conf93 values (41, 'RPC', '~ total', v_n::text,
    case when v_n = 2 then 'OK' else 'FALHOU (esperado 2)' end);

  -- O TETO TEMPORARIO. Se ele sumir do corpo antes de a Etapa 4 migrar as duas
  -- tabelas, a RPC vira atalho para a Recepcao escrever onde a RLS ainda nega.
  --
  -- O MARCADOR VIVE NA MENSAGEM DA EXCECAO, nao num comentario. O arquivo
  -- _LIMPO tira toda linha `--` antes de ir para o SQL Editor, entao um aviso
  -- escrito como comentario chegaria ao banco apagado — foi o que a conferencia
  -- de 13/08/2026 pegou. Na mensagem ele sobrevive ao _LIMPO e ainda aparece
  -- para quem esbarrar na trava.
  for r in
    select p.proname, pg_get_functiondef(p.oid) as fonte
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('comercial_criar_cobranca_do_periodo', 'comercial_cancelar_cobranca')
     order by p.proname
  loop
    insert into conf93 values (42, 'TETO TEMPORARIO', r.proname,
      case when r.fonte like '%REMOVER NA SUBETAPA%' then 'marcador presente' else 'marcador AUSENTE' end
      || ' | ' ||
      case when r.fonte like '%is distinct from auth.uid()%' then 'trava presente' else 'trava AUSENTE' end,
      case when r.fonte like '%is distinct from auth.uid()%'
            and r.fonte like '%REMOVER NA SUBETAPA%'
            and r.fonte like '%organizacao_do_auth%'
            and r.fonte like '%tem_permissao%'
           then 'OK (as tres validacoes + marcador)'
           else 'FALHOU' end);
  end loop;

  -- ═══════════ ETAPA 4A INTACTA ═══════════
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'comercial_planos';
  insert into conf93 values (50, 'ETAPA 4A', 'policies de comercial_planos', v_n::text,
    case when v_n = 4 then 'OK (intacta)' else 'FALHOU (a migration nao devia toca-las)' end);

  select column_default into v_txt from information_schema.columns
   where table_schema = 'public' and table_name = 'comercial_planos' and column_name = 'nutri_id';
  insert into conf93 values (51, 'ETAPA 4A', 'default de comercial_planos.nutri_id', coalesce(v_txt, '(nenhum)'),
    case when v_txt like '%organizacao_do_auth%' then 'OK (intacta)' else 'FALHOU' end);

  -- E a RLS das tabelas que a Etapa 4 ainda NAO migrou continua como estava.
  for r in
    select tablename, count(*) filter (where coalesce(qual, '') like '%auth.uid()%') as com_uid,
           count(*) as total
      from pg_policies
     where schemaname = 'public'
       and tablename in ('comercial_assinaturas', 'financeiro_lancamentos')
     group by tablename
     order by tablename
  loop
    insert into conf93 values (52, 'ETAPA 4A', 'RLS de ' || r.tablename,
      r.com_uid || ' de ' || r.total || ' policies em auth.uid()',
      case when r.com_uid > 0 then 'OK (ainda nao migrada, como esperado)'
           else 'CONFERIR (mudou sem esta migration pedir)' end);
  end loop;

  -- ═══════════ RENOVACOES PROGRAMADAS — O PORTAO DA MIGRATION B ═══════════
  select count(*) into v_n from public.comercial_assinaturas where proximo_plano_id is not null;
  insert into conf93 values (60, 'RENOVACOES', 'programadas neste momento', v_n::text,
    case when v_n = 0 then 'OK — pode aplicar a Migration B'
         else 'PARE: limpe as fixtures antes de aplicar a B' end);

  for r in
    select p.nome,
           pa.nome as plano_atual,
           pn.nome as plano_futuro,
           a.valor_contratado,
           a.proximo_valor_contratado,
           a.renovacao_definida_em,
           a.renovacao_origem_id
      from public.comercial_assinaturas a
      join public.pacientes p             on p.id  = a.paciente_id
      left join public.comercial_planos pa on pa.id = a.plano_id
      left join public.comercial_planos pn on pn.id = a.proximo_plano_id
     where a.proximo_plano_id is not null
     order by p.nome
  loop
    insert into conf93 values (61, 'RENOVACOES', r.nome,
      coalesce(r.plano_atual, '—') || ' -> ' || coalesce(r.plano_futuro, '—')
      || ' | R$ ' || to_char(coalesce(r.valor_contratado, 0), 'FM999G990D00')
      || ' -> R$ ' || to_char(coalesce(r.proximo_valor_contratado, r.valor_contratado, 0), 'FM999G990D00')
      || ' | definida ' || to_char(r.renovacao_definida_em, 'DD/MM/YYYY HH24:MI'),
      case when r.renovacao_origem_id is null then 'ORFA (sem cobranca de origem)' else 'ligada a uma cobranca' end);
  end loop;
end $$;

insert into conf93
select 999, 'VEREDITO',
  case when exists (select 1 from conf93 where resultado like 'FALHOU%')  then 'HA FALHAS — nao aplicar a Migration B'
       when exists (select 1 from conf93 where resultado like 'PARE%')    then 'LIMPAR FIXTURES antes da Migration B'
       when exists (select 1 from conf93 where resultado like 'CONFERIR%') then 'MIGRATION A APLICADA — conferir os pontos marcados'
       else 'MIGRATION A VALIDADA — pode aplicar a Migration B' end,
  coalesce((select string_agg(distinct item, ', ') from conf93
             where resultado like 'FALHOU%' or resultado like 'PARE%'
                or resultado like 'CONFERIR%'), 'nada a apontar'),
  '';

select ordem, secao, item, valor, resultado from conf93 order by ordem, item;
