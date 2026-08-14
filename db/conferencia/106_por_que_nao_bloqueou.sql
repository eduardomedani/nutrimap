-- ===========================================================================
-- COMERCIAL — POR QUE A SEGUNDA COBRANCA NAO FOI BARRADA
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. Um comando so.
--
-- O FATO: em 14/08/2026, criar duas cobrancas para o mesmo periodo do mesmo
-- cliente pela tela PASSOU. Deveria ter sido recusado por
-- `uq_comercial_cobranca_do_periodo`, que a conferencia 101 confirmou existir
-- com o predicado certo.
--
-- Duas linhas vivas com o mesmo (assinatura_id, periodo_fim) sao impossiveis
-- enquanto o indice existir. Logo, ALGUMA COISA NAS DUAS DIFERE — e este
-- script procura o quê, sem chutar.
--
-- AS HIPOTESES, cada uma com sua secao:
--
--   H1  periodo_fim diferente entre as duas. A RPC tira de `v_ass.fim_periodo`,
--       entao so difere se a assinatura tiver andado entre uma e outra.
--   H2  periodo_fim NULO em alguma. O predicado exige `is not null`: linha com
--       periodo nulo nao participa do indice, e duas delas nao colidem.
--   H3  assinatura_id NULO em alguma. Mesma coisa — sai do indice.
--   H4  status NULO. `status <> 'cancelado'` com NULL da NULL, nao TRUE, e a
--       linha fica de fora. E o classico do indice parcial.
--   H5  a primeira ficou CANCELADA, e ai a segunda esta certa em passar.
--   H6  as duas sao de CLIENTES diferentes, e nunca houve colisao.
--   H7  o indice sumiu ou mudou depois da conferencia 101.
--   H8  a insercao nao passou pela RPC (a RPC grava o periodo; um insert
--       direto pelo PostgREST sem as colunas deixaria periodo_fim nulo).
--
-- COMO LER: a secao VEREDITO diz qual hipotese os dados sustentam. As secoes
-- HOJE e POR CLIENTE trazem as linhas cruas para conferir a olho.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/106_por_que_nao_bloqueou_LIMPO.sql
-- ===========================================================================

drop table if exists conf106;
create temp table conf106 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_dono uuid;
  v_n    int;
  v_par  int;
  r      record;
begin
  select o.proprietario_user_id into v_dono
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  -- ═══════════ H7 — o indice ainda esta la? ═══════════
  select count(*) into v_n from pg_indexes
   where schemaname = 'public' and indexname = 'uq_comercial_cobranca_do_periodo';
  insert into conf106 values (10, 'H7 INDICE', 'uq_comercial_cobranca_do_periodo existe', v_n::text,
    case when v_n = 1 then 'ok — o indice esta de pe' else 'ACHOU — o indice sumiu' end);

  for r in select indexdef from pg_indexes
            where schemaname = 'public' and indexname = 'uq_comercial_cobranca_do_periodo'
  loop
    insert into conf106 values (11, 'H7 INDICE', 'definicao', r.indexdef, '');
  end loop;

  -- ═══════════ HOJE — tudo que a tela criou em 14/08 ═══════════
  for r in
    select coalesce(p.nome, '(sem paciente)') as cliente,
           l.id, l.status, l.origem, l.vencimento, l.data, l.competencia,
           l.periodo_inicio, l.periodo_fim, l.valor, l.assinatura_id,
           to_char(l.criado_em, 'DD/MM HH24:MI:SS') as criada
      from public.financeiro_lancamentos l
      left join public.pacientes p on p.id = l.paciente_id
     where l.nutri_id = v_dono
       and l.criado_em::date >= date '2026-08-14'
     order by l.criado_em
  loop
    insert into conf106 values (20, 'HOJE', r.cliente,
      'criada ' || r.criada
      || ' | ' || r.status
      || ' | origem ' || coalesce(r.origem, '-')
      || ' | vence ' || coalesce(r.vencimento::text, 'NULO')
      || ' | periodo ' || coalesce(r.periodo_inicio::text, 'NULO')
                       || ' -> ' || coalesce(r.periodo_fim::text, 'NULO')
      || ' | competencia ' || coalesce(to_char(r.competencia, 'YYYY-MM'), 'NULA')
      || ' | R$ ' || to_char(coalesce(r.valor, 0), 'FM999G990D00'),
      case when r.assinatura_id is null then 'H3 — assinatura_id NULO, fora do indice'
           when r.periodo_fim is null   then 'H2/H8 — periodo_fim NULO, fora do indice'
           when r.status is null        then 'H4 — status NULO, fora do indice'
           else 'participa do indice' end);
  end loop;

  select count(*) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and criado_em::date >= date '2026-08-14';
  insert into conf106 values (21, 'HOJE', 'total criado em 14/08', v_n::text,
    case when v_n = 0 then 'NENHUMA — as cobrancas do teste nao chegaram neste banco' else '' end);

  -- ═══════════ H2/H3/H4 — os nulos que furam o indice ═══════════
  select count(*) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and assinatura_id is not null and periodo_fim is null;
  insert into conf106 values (30, 'H2 NULOS', 'cobrancas com periodo_fim NULO', v_n::text,
    case when v_n = 0 then 'ok' else 'ACHOU — estas nao participam do indice' end);

  select count(*) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and status is null;
  insert into conf106 values (31, 'H4 NULOS', 'lancamentos com status NULO', v_n::text,
    case when v_n = 0 then 'ok' else 'ACHOU — `status <> cancelado` da NULL e a linha sai do indice' end);

  select count(*) into v_n from public.financeiro_lancamentos l
    join public.comercial_assinaturas a on a.id = l.assinatura_id
   where l.nutri_id = v_dono and l.periodo_fim is not null
     and l.periodo_fim <> a.fim_periodo
     and l.criado_em::date >= date '2026-08-14';
  insert into conf106 values (32, 'H1 PERIODO', 'criadas hoje com periodo != o vigente', v_n::text,
    case when v_n = 0 then 'ok' else 'ACHOU — a assinatura andou entre uma criacao e outra' end);

  -- ═══════════ H5/H6 — duas vivas no mesmo periodo? ═══════════
  select count(*) into v_par from (
    select l.assinatura_id, l.periodo_fim
      from public.financeiro_lancamentos l
     where l.nutri_id = v_dono and l.assinatura_id is not null
       and l.periodo_fim is not null and l.status <> 'cancelado'
     group by 1, 2 having count(*) > 1) d;
  insert into conf106 values (40, 'COLISAO', 'pares (assinatura, periodo_fim) com 2+ VIVAS', v_par::text,
    case when v_par = 0
         then 'o indice esta cumprindo o papel — a duplicata nao existe no banco'
         else 'IMPOSSIVEL com o indice de pe: leia a secao H7' end);

  -- Sem filtrar status: aqui aparecem as canceladas, que explicam a H5.
  for r in
    select p.nome, l.periodo_fim, count(*) as n,
           count(*) filter (where l.status <> 'cancelado') as vivas,
           string_agg(l.status || ' (vence ' || l.vencimento || ')', ' | ' order by l.criado_em) as quais
      from public.financeiro_lancamentos l
      join public.comercial_assinaturas a on a.id = l.assinatura_id
      join public.pacientes p             on p.id = a.paciente_id
     where l.nutri_id = v_dono and l.periodo_fim is not null
     group by p.nome, l.assinatura_id, l.periodo_fim
    having count(*) > 1
     order by p.nome
  loop
    insert into conf106 values (41, 'MESMO PERIODO', r.nome,
      r.n || ' cobrancas no periodo que termina ' || r.periodo_fim
      || ' | vivas: ' || r.vivas || ' | ' || r.quais,
      case when r.vivas <= 1 then 'H5 — as outras estao canceladas, e passar esta CERTO'
           else 'duas vivas: o indice foi furado' end);
  end loop;

  -- ═══════════ POR CLIENTE — a Celinea, nominalmente ═══════════
  for r in
    select p.nome, a.inicio_periodo, a.fim_periodo, a.status as ass_status,
           (select count(*) from public.financeiro_lancamentos l
             where l.assinatura_id = a.id and l.status <> 'cancelado') as vivas,
           (select count(*) from public.financeiro_lancamentos l
             where l.assinatura_id = a.id) as total
      from public.comercial_assinaturas a
      join public.pacientes p on p.id = a.paciente_id
     where a.nutri_id = v_dono
       and p.nome ilike '%celin%'
     order by p.nome
  loop
    insert into conf106 values (50, 'CELINEA', r.nome,
      'periodo ' || r.inicio_periodo || ' -> ' || r.fim_periodo
      || ' | assinatura ' || r.ass_status
      || ' | cobrancas: ' || r.total || ' (vivas ' || r.vivas || ')', '');
  end loop;

  for r in
    select p.nome, l.id, l.status, l.vencimento, l.periodo_inicio, l.periodo_fim,
           l.competencia, l.valor, to_char(l.criado_em, 'DD/MM HH24:MI:SS') as criada
      from public.financeiro_lancamentos l
      join public.comercial_assinaturas a on a.id = l.assinatura_id
      join public.pacientes p             on p.id = a.paciente_id
     where l.nutri_id = v_dono and p.nome ilike '%celin%'
     order by l.criado_em
  loop
    insert into conf106 values (51, 'CELINEA', 'cobranca',
      'criada ' || r.criada || ' | ' || r.status
      || ' | vence ' || r.vencimento
      || ' | periodo ' || coalesce(r.periodo_inicio::text, 'NULO')
                       || ' -> ' || coalesce(r.periodo_fim::text, 'NULO')
      || ' | competencia ' || to_char(r.competencia, 'YYYY-MM')
      || ' | R$ ' || to_char(coalesce(r.valor, 0), 'FM999G990D00'),
      'id ' || r.id);
  end loop;

  -- ═══════════ VEREDITO ═══════════
  select count(*) into v_n from pg_indexes
   where schemaname = 'public' and indexname = 'uq_comercial_cobranca_do_periodo';
  if v_n <> 1 then
    insert into conf106 values (999, 'VEREDITO', 'H7 — o indice nao esta la', '', '');
  elsif v_par > 0 then
    insert into conf106 values (999, 'VEREDITO', 'duas vivas no mesmo periodo COM o indice de pe — investigar a definicao', '', '');
  else
    insert into conf106 values (999, 'VEREDITO',
      'o banco NAO tem duplicata viva. A explicacao esta em HOJE e MESMO PERIODO: ou uma das linhas ficou fora do indice (periodo/status/assinatura nulos), ou a outra cobranca esta cancelada, ou sao clientes diferentes',
      '', '');
  end if;
end $$;

select ordem, secao, item, valor, resultado from conf106 order by ordem, item, valor;
