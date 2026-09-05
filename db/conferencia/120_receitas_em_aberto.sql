-- ===========================================================================
-- AS RECEITAS EM ABERTO — quais sao, e onde a cadeia de cobranca parou
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- POR QUE ESTE SCRIPT EXISTE. Em 05/09/2026 o Financeiro apareceu com varias
-- receitas em aberto, e veio a pergunta: o sistema esta gerando a proxima
-- cobranca sozinho?
--
-- A resposta que o codigo da e NAO — nao ha cron nem Edge Function que crie
-- cobranca. A proxima nasce dentro de `comercial_registrar_pagamento`, no passo
-- 10, e so quando TRES condicoes valem ao mesmo tempo:
--
--   p_criar_proxima            marcado na tela ao dar baixa
--   renovacao_automatica       ligada na assinatura
--   valor_contratado           preenchido
--
-- ISSO TEM UMA CONSEQUENCIA QUE E O ASSUNTO DESTE SCRIPT: cobranca em aberto
-- TRAVA A CADEIA. Enquanto setembro nao e baixado, outubro nao existe — e o
-- cliente pode estar treinando, ativo, sem cobranca nenhuma no sistema. Cada
-- mes que passa e um periodo que nunca foi faturado, e nao ha nada na tela
-- gritando isso: a ausencia de uma linha nao aparece em lugar nenhum.
--
-- Entao "receita em aberto" e duas coisas diferentes, e elas nao se resolvem
-- do mesmo jeito:
--
--   INADIMPLENCIA    o periodo foi cobrado e o cliente nao pagou.
--                    Some quando o dinheiro entra.
--   CADEIA PARADA    o periodo seguinte nunca virou cobranca.
--                    NAO some sozinha nem quando o cliente paga em dia, se a
--                    renovacao estiver desligada ou o valor faltando.
--
-- As secoes abaixo separam as duas.
--
-- ===========================================================================
-- 1. PANORAMA e ATRASO
-- ---------------------------------------------------------------------------
-- Quanto ha em aberto e ha quanto tempo. Atraso longo em cobranca de assinatura
-- quase sempre significa cadeia parada tambem, e nao so cliente devendo.
--
-- ===========================================================================
-- 2. A CADEIA PAROU AQUI
-- ---------------------------------------------------------------------------
-- O coracao do script. Para cada assinatura com cobranca em aberto, pergunta se
-- existe cobranca do periodo SEGUINTE. Se nao existe, o faturamento daquele
-- cliente esta parado no ultimo periodo cobrado — e `periodos_sem_cobrar` diz
-- ha quantos meses.
--
-- ===========================================================================
-- 3. POR QUE NAO VAI NASCER
-- ---------------------------------------------------------------------------
-- Assinatura viva com `renovacao_automatica = false` ou sem `valor_contratado`:
-- nestas, dar baixa no pagamento NAO cria a proxima. Sao as que precisam de
-- conserto no cadastro antes, senao a cadeia para de novo no mes seguinte.
--
-- ===========================================================================
-- 4. RECEITA SEM ASSINATURA
-- ---------------------------------------------------------------------------
-- Pendente com `assinatura_id` nulo nao pertence a ciclo nenhum — veio da
-- planilha, da importacao de vendas ou foi digitada a mao. Ela nunca vai gerar
-- proxima, e isso esta certo. Esta aqui para nao ser confundida com as outras.
--
-- ===========================================================================
-- 5. ATIVA E DESCOBERTA
-- ---------------------------------------------------------------------------
-- O caso silencioso: assinatura ATIVA cujo periodo ja terminou e que nao tem
-- nenhuma cobranca em aberto. Ninguem deve nada, nao ha linha vermelha na tela
-- — e o cliente esta treinando de graca desde `fim_periodo`.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/120_receitas_em_aberto_LIMPO.sql
-- ===========================================================================

drop table if exists conf120;
create temp table conf120 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_org uuid;
  v_n   int;
  v_v   numeric;
  r     record;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  -- ═══════════ 1) PANORAMA ═══════════
  select count(*), coalesce(sum(l.valor), 0) into v_n, v_v
    from public.financeiro_lancamentos l
   where l.nutri_id = v_org and l.tipo = 'receita'
     and l.status = 'pendente' and l.arquivado_em is null;
  insert into conf120 values (10, 'PANORAMA', 'receitas em aberto', v_n::text,
    'R$ ' || to_char(v_v, 'FM999G990D00'));

  select count(*), coalesce(sum(l.valor), 0) into v_n, v_v
    from public.financeiro_lancamentos l
   where l.nutri_id = v_org and l.tipo = 'receita'
     and l.status = 'pendente' and l.arquivado_em is null
     and l.vencimento < current_date;
  insert into conf120 values (11, 'PANORAMA', 'dessas, ja vencidas', v_n::text,
    'R$ ' || to_char(v_v, 'FM999G990D00'));

  -- Pendente sem vencimento nao entra em nenhuma regua de atraso e some dos
  -- relatorios de contas a receber. Vale saber se existem.
  select count(*) into v_n
    from public.financeiro_lancamentos l
   where l.nutri_id = v_org and l.tipo = 'receita'
     and l.status = 'pendente' and l.arquivado_em is null
     and l.vencimento is null;
  insert into conf120 values (12, 'PANORAMA', 'em aberto SEM vencimento', v_n::text,
    case when v_n > 0 then 'nao aparecem em nenhuma regua de atraso' else '' end);

  -- Faixas de atraso: o desenho da divida. Muitas na faixa longa e sinal de
  -- cadeia parada, nao de cliente que atrasou o mes.
  for r in
    select faixa, count(*) as n, coalesce(sum(valor), 0) as total
      from (
        select l.valor,
               case when l.vencimento is null              then '(sem vencimento)'
                    when l.vencimento >= current_date      then 'a vencer'
                    when current_date - l.vencimento <= 30 then 'vencida ate 30 dias'
                    when current_date - l.vencimento <= 60 then 'vencida 31 a 60 dias'
                    when current_date - l.vencimento <= 90 then 'vencida 61 a 90 dias'
                    else 'vencida ha mais de 90 dias' end as faixa
          from public.financeiro_lancamentos l
         where l.nutri_id = v_org and l.tipo = 'receita'
           and l.status = 'pendente' and l.arquivado_em is null
      ) x
     group by faixa
     order by faixa
  loop
    insert into conf120 values (13, 'ATRASO', r.faixa,
      r.n || ' cobranca(s) — R$ ' || to_char(r.total, 'FM999G990D00'), '');
  end loop;

  -- ═══════════ 2) A CADEIA PAROU AQUI ═══════════
  -- Uma linha por cobranca em aberto de assinatura. `proxima` responde a
  -- pergunta que originou o script: existe a cobranca do periodo seguinte?
  for r in
    select p.nome as cliente,
           l.descricao, l.valor, l.vencimento,
           l.periodo_inicio, l.periodo_fim,
           a.status as ass_status,
           a.renovacao_automatica,
           a.valor_contratado,
           a.fim_periodo as ass_fim,
           (select count(*) from public.financeiro_lancamentos n
             where n.assinatura_id = a.id and n.status <> 'cancelado'
               and n.periodo_fim > l.periodo_fim)                     as posteriores,
           case when a.fim_periodo is null then null
                else greatest(0, (current_date - a.fim_periodo) / 30) end as periodos_sem_cobrar
      from public.financeiro_lancamentos l
      join public.comercial_assinaturas a on a.id = l.assinatura_id
      left join public.pacientes p        on p.id = l.paciente_id
     where l.nutri_id = v_org and l.tipo = 'receita'
       and l.status = 'pendente' and l.arquivado_em is null
     order by l.vencimento nulls last
  loop
    insert into conf120 values (20, 'EM ABERTO',
      coalesce(r.cliente, '(sem cliente)'),
      'R$ ' || to_char(r.valor, 'FM999G990D00')
      || ' | vence ' || coalesce(r.vencimento::text, '—')
      || ' | cobre ' || coalesce(r.periodo_inicio::text, '?') || ' a ' || coalesce(r.periodo_fim::text, '?')
      || ' | assinatura ' || r.ass_status,
      case when r.posteriores > 0 then 'a proxima ja existe — so falta o cliente pagar'
           when not r.renovacao_automatica then 'CADEIA PARADA: renovacao automatica DESLIGADA'
           when r.valor_contratado is null then 'CADEIA PARADA: assinatura sem valor contratado'
           when coalesce(r.periodos_sem_cobrar, 0) >= 1
             then 'CADEIA PARADA ha ~' || r.periodos_sem_cobrar || ' periodo(s) — baixar esta cria a proxima'
           else 'no prazo — baixar esta cria a proxima' end);
  end loop;

  -- ═══════════ 3) POR QUE NAO VAI NASCER ═══════════
  -- Consertar o cadastro ANTES de dar baixa: quem baixa com a renovacao
  -- desligada nao ganha a proxima cobranca, e o buraco se repete no mes que vem.
  for r in
    select p.nome as cliente, a.status, a.renovacao_automatica, a.valor_contratado, a.fim_periodo
      from public.comercial_assinaturas a
      left join public.pacientes p on p.id = a.paciente_id
     where a.nutri_id = v_org
       and a.status in ('ativa', 'pausada')
       and (not a.renovacao_automatica or a.valor_contratado is null)
     order by p.nome
  loop
    insert into conf120 values (30, 'NAO VAI NASCER', coalesce(r.cliente, '(sem cliente)'),
      r.status || ' | periodo ate ' || coalesce(r.fim_periodo::text, '—')
      || ' | valor ' || coalesce('R$ ' || to_char(r.valor_contratado, 'FM999G990D00'), 'NULO'),
      case when not r.renovacao_automatica then 'renovacao automatica desligada'
           else 'sem valor contratado' end);
  end loop;

  select count(*) into v_n
    from public.comercial_assinaturas a
   where a.nutri_id = v_org and a.status in ('ativa', 'pausada')
     and (not a.renovacao_automatica or a.valor_contratado is null);
  insert into conf120 values (31, 'NAO VAI NASCER', 'total', v_n::text,
    case when v_n = 0 then 'nenhuma — toda assinatura viva gera a proxima ao dar baixa' else '' end);

  -- ═══════════ 4) RECEITA SEM ASSINATURA ═══════════
  for r in
    select l.origem, count(*) as n, coalesce(sum(l.valor), 0) as total
      from public.financeiro_lancamentos l
     where l.nutri_id = v_org and l.tipo = 'receita'
       and l.status = 'pendente' and l.arquivado_em is null
       and l.assinatura_id is null
     group by l.origem
     order by l.origem
  loop
    insert into conf120 values (40, 'SEM ASSINATURA', r.origem,
      r.n || ' cobranca(s) — R$ ' || to_char(r.total, 'FM999G990D00'),
      'fora de ciclo: nunca gera proxima, e esta certo');
  end loop;

  -- ═══════════ 5) ATIVA E DESCOBERTA ═══════════
  -- O caso que nao aparece em tela nenhuma: nada em aberto, nada vermelho, e o
  -- periodo terminou faz tempo.
  for r in
    select p.nome as cliente, a.fim_periodo, a.valor_contratado,
           current_date - a.fim_periodo as dias
      from public.comercial_assinaturas a
      left join public.pacientes p on p.id = a.paciente_id
     where a.nutri_id = v_org
       and a.status = 'ativa'
       and a.fim_periodo < current_date
       and not exists (
         select 1 from public.financeiro_lancamentos l
          where l.assinatura_id = a.id
            and l.status = 'pendente' and l.arquivado_em is null)
     order by a.fim_periodo
  loop
    insert into conf120 values (50, 'ATIVA E DESCOBERTA', coalesce(r.cliente, '(sem cliente)'),
      'periodo terminou em ' || r.fim_periodo || ' — ha ' || r.dias || ' dias',
      'ativa, sem cobranca em aberto e sem periodo vigente');
  end loop;

  select count(*) into v_n
    from public.comercial_assinaturas a
   where a.nutri_id = v_org and a.status = 'ativa' and a.fim_periodo < current_date
     and not exists (
       select 1 from public.financeiro_lancamentos l
        where l.assinatura_id = a.id
          and l.status = 'pendente' and l.arquivado_em is null);
  insert into conf120 values (51, 'ATIVA E DESCOBERTA', 'total', v_n::text,
    case when v_n = 0 then 'nenhuma — todo periodo vencido tem cobranca' else 'estas treinam sem cobranca' end);
end $$;

select ordem, secao, item, valor, resultado from conf120 order by ordem, item;
