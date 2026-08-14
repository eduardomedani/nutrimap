-- ===========================================================================
-- COMERCIAL — VALIDACAO DA MIGRATION C
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. Rodar DEPOIS de aplicar a Migration C.
--
-- A PORTA DE ENTRADA MUDOU. A primeira versao deste script era o gate ANTES da
-- migration, e barrava com base em "cobrancas criadas de 13/08 em diante".
-- Aquele criterio nao separava nada — 35 das 43 nasceram em 13/08, porque a
-- importacao, o seed e o E2E aconteceram todos naquele dia. Quem separa por
-- evidencia sao a 102 (de onde vem o periodo de cada cobranca) e a 103 (qual
-- data determina a competencia). O gate e delas; este script fecha a conta.
--
-- O QUE ELE CONFERE:
--
--   COLUNAS      periodo_inicio e periodo_fim, date, nulas, sem default
--   RETRATO      a tabela guardada antes de mexer na competencia. Sem ela nao
--                ha desfazer, entao ela e conferida primeiro
--   PERIODO      toda cobranca de assinatura tem periodo, nenhuma despesa tem,
--                e nenhum periodo esta invertido
--   INDICE       o novo existe com o predicado certo, o antigo saiu
--   COMPETENCIA  toda cobranca com periodo tem competencia = mes do INICIO, e
--                a lista do que mudou de mes, com o antes e o depois
--   RPCS         as duas gravam o periodo e nenhuma deriva competencia de
--                vencimento nem do fim do periodo
--   VENCIMENTO   nenhum vencimento se mexeu, e a cobranca automatica continua
--                vencendo no fim do periodo novo
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/101_periodo_da_cobranca_LIMPO.sql
-- ===========================================================================

drop table if exists conf101;
create temp table conf101 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_dono    uuid;
  v_n       int;
  v_m       int;
  v_tem_col boolean;
  v_falhas  int := 0;
  r         record;
begin
  select o.proprietario_user_id into v_dono
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  select count(*) = 2 into v_tem_col
    from information_schema.columns
   where table_schema = 'public' and table_name = 'financeiro_lancamentos'
     and column_name in ('periodo_inicio', 'periodo_fim');

  if not v_tem_col then
    insert into conf101 values (1, 'ONDE ESTAMOS', 'a Migration C ja rodou?', 'nao',
      'este script so vale depois dela. O gate ANTES sao as conferencias 102 e 103');
    insert into conf101 values (999, 'VEREDITO', 'MIGRATION C NAO APLICADA', '', '');
    return;
  end if;

  -- ═══════════ COLUNAS ═══════════
  for r in
    select column_name, data_type, is_nullable, column_default
      from information_schema.columns
     where table_schema = 'public' and table_name = 'financeiro_lancamentos'
       and column_name in ('periodo_inicio', 'periodo_fim')
     order by column_name
  loop
    insert into conf101 values (10, 'COLUNAS', r.column_name,
      r.data_type || ' | nula: ' || r.is_nullable || ' | default: ' || coalesce(r.column_default, 'nenhum'),
      case when r.data_type = 'date' and r.is_nullable = 'YES' and r.column_default is null
           then 'ok' else 'FALHOU — esperava date, nula, sem default' end);
    if not (r.data_type = 'date' and r.is_nullable = 'YES' and r.column_default is null) then
      v_falhas := v_falhas + 1;
    end if;
  end loop;

  -- ═══════════ RETRATO ═══════════
  -- Primeiro de tudo: sem ele, um desfazer nao restaura a competencia. Ela nao
  -- e recomputavel — o CASO_PAGAMENTO_ANTECIPADO tem competencia 2026-07 com vencimento 2026-09-11.
  select count(*) into v_n from public.comercial_competencia_antes;
  select count(*) into v_m from public.financeiro_lancamentos
   where assinatura_id is not null and competencia is not null;
  insert into conf101 values (20, 'RETRATO', 'competencias guardadas', v_n || ' de ' || v_m,
    case when v_n >= v_m and v_n > 0 then 'ok — o desfazer tem de onde restaurar'
         else 'FALHOU — sem retrato completo nao ha volta' end);
  if not (v_n >= v_m and v_n > 0) then v_falhas := v_falhas + 1; end if;

  select count(*) into v_n from pg_tables
   where schemaname = 'public' and tablename = 'comercial_competencia_antes' and rowsecurity;
  insert into conf101 values (21, 'RETRATO', 'RLS ligada na tabela de retrato', v_n::text,
    case when v_n = 1 then 'ok — sem policy, ela nao aparece pelo PostgREST'
         else 'FALHOU — tabela exposta' end);
  if v_n <> 1 then v_falhas := v_falhas + 1; end if;

  -- ═══════════ PERIODO ═══════════
  select count(*) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and assinatura_id is not null and periodo_fim is null;
  insert into conf101 values (30, 'PERIODO', 'cobrancas SEM periodo_fim', v_n::text,
    case when v_n = 0 then 'ok — todas preenchidas'
         else 'FALHOU — estas escapam do indice unico' end);
  if v_n <> 0 then v_falhas := v_falhas + 1; end if;

  select count(*) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and assinatura_id is not null and periodo_inicio is null;
  insert into conf101 values (31, 'PERIODO', 'cobrancas SEM periodo_inicio', v_n::text,
    case when v_n = 0 then 'ok' else 'FALHOU — sem inicio nao ha competencia' end);
  if v_n <> 0 then v_falhas := v_falhas + 1; end if;

  select count(*) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and assinatura_id is null and periodo_fim is not null;
  insert into conf101 values (32, 'PERIODO', 'despesas/avulsos COM periodo', v_n::text,
    case when v_n = 0 then 'ok — o backfill nao vazou' else 'FALHOU — o WHERE pegou demais' end);
  if v_n <> 0 then v_falhas := v_falhas + 1; end if;

  select count(*) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and periodo_inicio is not null and periodo_fim is not null
     and periodo_inicio >= periodo_fim;
  insert into conf101 values (33, 'PERIODO', 'periodos invertidos ou de duracao zero', v_n::text,
    case when v_n = 0 then 'ok' else 'FALHOU — inicio >= fim' end);
  if v_n <> 0 then v_falhas := v_falhas + 1; end if;

  -- As que cobrem um periodo que a renovacao deixou para tras: o 3b da
  -- migration. Se der 0, ou nenhuma assinatura renovou, ou o update nao pegou.
  select count(*) into v_n
    from public.financeiro_lancamentos l
    join public.comercial_assinaturas a on a.id = l.assinatura_id
   where l.nutri_id = v_dono and l.periodo_fim is not null
     and l.periodo_fim <> a.fim_periodo;
  insert into conf101 values (34, 'PERIODO', 'cobrancas de um ciclo ANTERIOR', v_n::text,
    'vieram do `antes` da auditoria; a conferencia 102 contou 5');

  -- ═══════════ INDICE ═══════════
  select count(*) into v_n from pg_indexes
   where schemaname = 'public' and indexname = 'uq_comercial_cobranca_do_periodo';
  insert into conf101 values (40, 'INDICE', 'uq_comercial_cobranca_do_periodo', v_n::text,
    case when v_n = 1 then 'ok' else 'FALHOU — o indice novo nao existe' end);
  if v_n <> 1 then v_falhas := v_falhas + 1; end if;

  select count(*) into v_n from pg_indexes
   where schemaname = 'public' and indexname = 'uq_comercial_cobranca_periodo';
  insert into conf101 values (41, 'INDICE', 'uq_comercial_cobranca_periodo (o antigo)', v_n::text,
    case when v_n = 0 then 'ok — saiu, como tinha de sair'
         else 'FALHOU — mantido, ele rejeita duas cobrancas legitimas criadas no mesmo dia' end);
  if v_n <> 0 then v_falhas := v_falhas + 1; end if;

  for r in
    select indexdef from pg_indexes
     where schemaname = 'public' and indexname = 'uq_comercial_cobranca_do_periodo'
  loop
    insert into conf101 values (42, 'INDICE', 'definicao', r.indexdef,
      case when r.indexdef like '%status <> ''cancelado''%'
            and r.indexdef like '%periodo_fim IS NOT NULL%'
           then 'ok — cancelado de fora, e periodo nulo nao participa'
           else 'FALHOU — confira o predicado' end);
    if not (r.indexdef like '%status <> ''cancelado''%' and r.indexdef like '%periodo_fim IS NOT NULL%') then
      v_falhas := v_falhas + 1;
    end if;
  end loop;

  select count(*) into v_n from (
    select assinatura_id, periodo_fim
      from public.financeiro_lancamentos
     where nutri_id = v_dono and assinatura_id is not null
       and periodo_fim is not null and status <> 'cancelado'
     group by 1, 2 having count(*) > 1) d;
  insert into conf101 values (43, 'INDICE', 'periodos cobrados duas vezes entre as vivas', v_n::text,
    case when v_n = 0 then 'ok' else 'FALHOU' end);
  if v_n <> 0 then v_falhas := v_falhas + 1; end if;

  -- ═══════════ COMPETENCIA ═══════════
  select count(*) into v_n
    from public.financeiro_lancamentos
   where nutri_id = v_dono and assinatura_id is not null and periodo_inicio is not null
     and competencia is distinct from date_trunc('month', periodo_inicio)::date;
  insert into conf101 values (50, 'COMPETENCIA', 'divergentes do mes do INICIO', v_n::text,
    case when v_n = 0 then 'ok — a regra vale para todas'
         else 'FALHOU — o update do passo 4 nao pegou estas' end);
  if v_n <> 0 then v_falhas := v_falhas + 1; end if;

  select count(*) into v_n
    from public.financeiro_lancamentos l
    join public.comercial_competencia_antes c on c.lancamento_id = l.id
   where l.competencia is distinct from c.competencia;
  insert into conf101 values (51, 'COMPETENCIA', 'mudaram de mes', v_n::text,
    'a conferencia 103 previu 14. Nao e efeito colateral: e a decisao');

  for r in
    select p.nome, l.periodo_inicio, l.periodo_fim, l.valor, l.status,
           to_char(c.competencia, 'YYYY-MM') as antes,
           to_char(l.competencia, 'YYYY-MM') as agora
      from public.financeiro_lancamentos l
      join public.comercial_competencia_antes c on c.lancamento_id = l.id
      join public.pacientes p on p.id = l.paciente_id
     where l.competencia is distinct from c.competencia
     order by p.nome
  loop
    insert into conf101 values (52, 'COMPETENCIA', r.nome,
      r.antes || ' -> ' || r.agora
      || ' | R$ ' || to_char(coalesce(r.valor, 0), 'FM999G990D00')
      || ' | ' || r.status
      || ' | periodo ' || r.periodo_inicio || ' -> ' || r.periodo_fim, '');
  end loop;

  for r in
    select to_char(l.competencia, 'YYYY-MM') as mes, count(*) as n,
           to_char(coalesce(sum(l.valor), 0), 'FM999G990D00') as total
      from public.financeiro_lancamentos l
     where l.nutri_id = v_dono and l.assinatura_id is not null
     group by 1 order by 1
  loop
    insert into conf101 values (53, 'COMPETENCIA', 'agora, ' || r.mes,
      r.n || ' cobranca(s) | R$ ' || r.total,
      'compare com a coluna INICIO da conferencia 103');
  end loop;

  -- ═══════════ RPCS ═══════════
  for r in
    select p.proname, pg_get_functiondef(p.oid) as corpo
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('comercial_criar_cobranca_do_periodo', 'comercial_registrar_pagamento')
  loop
    insert into conf101 values (60, 'RPCS', r.proname,
      case when r.corpo like '%periodo_inicio%' and r.corpo like '%periodo_fim%'
           then 'grava o periodo' else 'NAO grava o periodo' end
      || ' | competencia de '
      || case when r.corpo like '%date_trunc(''month'', v_ass.inicio_periodo)%' then 'INICIO do periodo'
              when r.corpo like '%date_trunc(''month'', v_ass.fim_periodo)%'    then 'FIM do periodo'
              when r.corpo like '%date_trunc(''month'', p_vencimento)%'         then 'VENCIMENTO'
              else 'origem desconhecida' end,
      case when r.corpo like '%periodo_inicio%' and r.corpo like '%periodo_fim%'
            and r.corpo like '%date_trunc(''month'', v_ass.inicio_periodo)%'
            and r.corpo not like '%date_trunc(''month'', p_vencimento)%'
            and r.corpo not like '%date_trunc(''month'', v_ass.fim_periodo)%'
           then 'ok' else 'FALHOU' end);
    if not (r.corpo like '%periodo_inicio%' and r.corpo like '%periodo_fim%'
            and r.corpo like '%date_trunc(''month'', v_ass.inicio_periodo)%'
            and r.corpo not like '%date_trunc(''month'', p_vencimento)%'
            and r.corpo not like '%date_trunc(''month'', v_ass.fim_periodo)%') then
      v_falhas := v_falhas + 1;
    end if;
  end loop;

  -- ═══════════ VENCIMENTO ═══════════
  -- Regra aprovada em 14/08/2026: a automatica nao muda.
  for r in
    select pg_get_functiondef(p.oid) as corpo
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'comercial_registrar_pagamento'
  loop
    insert into conf101 values (70, 'VENCIMENTO', 'a automatica vence no fim do periodo novo',
      case when r.corpo like '%v_ass.fim_periodo, v_ass.fim_periodo,%' then 'sim' else 'NAO' end,
      case when r.corpo like '%v_ass.fim_periodo, v_ass.fim_periodo,%'
           then 'ok — intocada, como voce decidiu'
           else 'FALHOU — a regra da cobranca automatica foi alterada sem aprovacao' end);
    if r.corpo not like '%v_ass.fim_periodo, v_ass.fim_periodo,%' then v_falhas := v_falhas + 1; end if;
  end loop;

  -- Nenhum vencimento pode ter se mexido: a Migration C nao emite update em
  -- `vencimento`. Se algum divergir do que a competencia guardada sugeria, nao
  -- e prova de nada — por isso a conferencia e sobre o que a migration TOCA.
  select count(*) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and assinatura_id is not null and vencimento is null;
  insert into conf101 values (71, 'VENCIMENTO', 'cobrancas sem vencimento', v_n::text,
    case when v_n = 0 then 'ok' else 'FALHOU' end);
  if v_n <> 0 then v_falhas := v_falhas + 1; end if;

  insert into conf101 values (999, 'VEREDITO',
    case when v_falhas = 0 then 'MIGRATION C VALIDADA' else 'HA FALHAS — ' || v_falhas end,
    '', '');
end $$;

select ordem, secao, item, valor, resultado from conf101 order by ordem, item, valor;
