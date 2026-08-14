-- ===========================================================================
-- COMERCIAL — QUAL DATA DEVE DETERMINAR A COMPETENCIA
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. Ele existe para a decisao ser tomada com numero na
-- frente, e nao com a prosa de quem propoe.
--
-- O QUE ACONTECEU. Eu afirmei que tirar a competencia do FIM do periodo nao
-- moveria receita nenhuma de mes. Era consequencia de uma premissa que a
-- conferencia 102 derrubou. Pela regra do fim, R$ 5.585 saem de agosto/2026 e
-- vao para setembro, e os R$ 373,66 do CASO_PAGAMENTO_ANTECIPADO, recebidos em julho, vao parar em
-- DEZEMBRO. Este script poe as tres candidatas lado a lado.
--
-- AS TRES CANDIDATAS:
--
--   HOJE    mes do vencimento. E o que esta gravado. Para o que veio da
--           planilha, o vencimento e a data do pagamento — entao "hoje" e, na
--           pratica, regime de caixa. Para o que a tela criou, o vencimento era
--           o fim do periodo. Duas regras convivendo sem ninguem ter decidido.
--
--   INICIO  mes em que o periodo COMECA. Para uma mensalidade paga no dia 09/08
--           que cobre 09/08 -> 08/09, a receita e de agosto. Coincide com o
--           caixa em quase tudo que veio da planilha.
--
--   FIM     mes em que o periodo TERMINA. Foi o que propus. Empurra toda
--           mensalidade um mes para a frente, e um semestral seis.
--
-- COMO LER:
--
--   POR MES     as tres colunas, mes a mes, em quantidade e valor. A pergunta e
--               simples: qual dessas tres tabelas voce reconhece como o
--               faturamento da GoUp?
--
--   QUEM MUDA   quantas cobrancas cada regra tira do mes em que estao hoje.
--
--   OS CASOS    os extremos, nome a nome — onde a escolha aparece inteira.
--
-- A classificacao do periodo e a mesma da conferencia 102, com uma correcao: as
-- duas ORFAS (CASO_PAGO_EM_ABRE_PERIODO e CASO_PAGO_EM_ABRE_PERIODO) tem `pago_em` igual ao inicio do periodo, e
-- por isso entram na classe INICIO. Nao sobrou nenhuma sem evidencia.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/103_qual_competencia_LIMPO.sql
-- ===========================================================================

drop table if exists conf103;
drop table if exists conf103_map;
create temp table conf103 (ordem int, secao text, item text, valor text, resultado text);

create temp table conf103_map (
  lancamento_id  uuid,
  cliente        text,
  classe         text,
  periodo_inicio date,
  periodo_fim    date
);

do $$
declare
  v_dono uuid;
  v_n    int;
  v_tot  int;
  r      record;
begin
  select o.proprietario_user_id into v_dono
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  -- ═══════════ A CLASSIFICACAO, ja com as orfas resolvidas ═══════════
  for r in
    select l.id, l.vencimento, l.pago_em, p.nome,
           a.id as ass_id, a.inicio_periodo, a.fim_periodo,
           (select (aud.antes ->> 'inicio_periodo')::date
              from public.comercial_assinatura_auditoria aud
             where aud.assinatura_id = a.id and aud.acao = 'renovada'
               and (aud.antes ->> 'fim_periodo')::date = l.vencimento
             order by aud.criado_em limit 1) as ant_inicio,
           (select (aud.antes ->> 'fim_periodo')::date
              from public.comercial_assinatura_auditoria aud
             where aud.assinatura_id = a.id and aud.acao = 'renovada'
               and (aud.antes ->> 'fim_periodo')::date = l.vencimento
             order by aud.criado_em limit 1) as ant_fim
      from public.financeiro_lancamentos l
      join public.comercial_assinaturas a on a.id = l.assinatura_id
      join public.pacientes p             on p.id = a.paciente_id
     where l.nutri_id = v_dono
  loop
    if r.vencimento = r.fim_periodo then
      insert into conf103_map values (r.id, r.nome, 'FIM', r.inicio_periodo, r.fim_periodo);
    elsif r.ant_fim is not null then
      insert into conf103_map values (r.id, r.nome, 'FIM ANTIGO', r.ant_inicio, r.ant_fim);
    elsif r.vencimento = r.inicio_periodo then
      insert into conf103_map values (r.id, r.nome, 'INICIO', r.inicio_periodo, r.fim_periodo);
    elsif r.pago_em is not null and r.pago_em = r.inicio_periodo then
      -- CASO_PAGO_EM_ABRE_PERIODO e CASO_PAGO_EM_ABRE_PERIODO: a planilha trazia uma data de vencimento propria, e
      -- quem abriu o periodo foi o PAGAMENTO.
      insert into conf103_map values (r.id, r.nome, 'INICIO (por pago_em)', r.inicio_periodo, r.fim_periodo);
    else
      insert into conf103_map values (r.id, r.nome, 'ORFA', null, null);
    end if;
  end loop;

  select count(*) into v_tot from conf103_map;
  select count(*) into v_n from conf103_map where classe = 'ORFA';
  insert into conf103 values (1, 'CLASSIFICACAO', 'cobrancas classificadas', (v_tot - v_n) || ' de ' || v_tot,
    case when v_n = 0 then 'nenhuma sem evidencia — nada e atribuido a mao'
         else 'ainda restam ' || v_n || ' sem evidencia' end);

  -- ═══════════ POR MES ═══════════
  for r in
    with base as (
      select l.id, l.valor, l.competencia, m.periodo_inicio, m.periodo_fim
        from conf103_map m
        join public.financeiro_lancamentos l on l.id = m.lancamento_id
       where m.periodo_fim is not null
    ),
    meses as (
      select to_char(competencia, 'YYYY-MM') as mes from base
      union select to_char(date_trunc('month', periodo_inicio), 'YYYY-MM') from base
      union select to_char(date_trunc('month', periodo_fim),    'YYYY-MM') from base
    )
    select s.mes,
           (select count(*)               from base b where to_char(b.competencia, 'YYYY-MM') = s.mes) as n_hoje,
           (select coalesce(sum(valor),0) from base b where to_char(b.competencia, 'YYYY-MM') = s.mes) as v_hoje,
           (select count(*)               from base b where to_char(date_trunc('month', b.periodo_inicio), 'YYYY-MM') = s.mes) as n_ini,
           (select coalesce(sum(valor),0) from base b where to_char(date_trunc('month', b.periodo_inicio), 'YYYY-MM') = s.mes) as v_ini,
           (select count(*)               from base b where to_char(date_trunc('month', b.periodo_fim), 'YYYY-MM') = s.mes) as n_fim,
           (select coalesce(sum(valor),0) from base b where to_char(date_trunc('month', b.periodo_fim), 'YYYY-MM') = s.mes) as v_fim
      from meses s
     order by s.mes
  loop
    insert into conf103 values (10, 'POR MES', r.mes,
      'HOJE ' || r.n_hoje || ' / R$ ' || to_char(r.v_hoje, 'FM999G990D00')
      || '  |  INICIO ' || r.n_ini || ' / R$ ' || to_char(r.v_ini, 'FM999G990D00')
      || '  |  FIM ' || r.n_fim || ' / R$ ' || to_char(r.v_fim, 'FM999G990D00'),
      case when r.v_hoje = r.v_ini and r.v_hoje = r.v_fim then 'as tres concordam'
           when r.v_hoje = r.v_ini then 'INICIO mantem o que esta gravado'
           when r.v_hoje = r.v_fim then 'FIM mantem o que esta gravado'
           else '' end);
  end loop;

  -- ═══════════ QUEM MUDA ═══════════
  select count(*) into v_n
    from conf103_map m join public.financeiro_lancamentos l on l.id = m.lancamento_id
   where m.periodo_fim is not null
     and l.competencia is distinct from date_trunc('month', m.periodo_inicio)::date;
  insert into conf103 values (20, 'QUEM MUDA', 'pela regra do INICIO', v_n || ' de ' || v_tot, '');

  select count(*) into v_n
    from conf103_map m join public.financeiro_lancamentos l on l.id = m.lancamento_id
   where m.periodo_fim is not null
     and l.competencia is distinct from date_trunc('month', m.periodo_fim)::date;
  insert into conf103 values (21, 'QUEM MUDA', 'pela regra do FIM', v_n || ' de ' || v_tot, '');

  -- Quantas tem periodo dentro de UM mes so: nessas as duas regras dao igual.
  select count(*) into v_n from conf103_map
   where periodo_fim is not null
     and date_trunc('month', periodo_inicio) = date_trunc('month', periodo_fim);
  insert into conf103 values (22, 'QUEM MUDA', 'periodos que comecam e terminam no mesmo mes', v_n::text,
    'nessas INICIO e FIM concordam, e a escolha nao muda nada');

  -- ═══════════ OS CASOS ═══════════
  -- Onde a diferenca entre as duas regras e maior. Se a escolha esta certa, ela
  -- tem de parecer certa AQUI, e nao so na media.
  for r in
    select m.cliente, m.classe, m.periodo_inicio, m.periodo_fim, l.valor, l.pago_em, l.status,
           to_char(l.competencia, 'YYYY-MM') as hoje,
           to_char(date_trunc('month', m.periodo_inicio), 'YYYY-MM') as pelo_inicio,
           to_char(date_trunc('month', m.periodo_fim), 'YYYY-MM') as pelo_fim,
           (date_trunc('month', m.periodo_fim) - date_trunc('month', m.periodo_inicio)) as vao
      from conf103_map m
      join public.financeiro_lancamentos l on l.id = m.lancamento_id
     where m.periodo_fim is not null
       and date_trunc('month', m.periodo_inicio) <> date_trunc('month', m.periodo_fim)
     order by (date_trunc('month', m.periodo_fim) - date_trunc('month', m.periodo_inicio)) desc,
              m.cliente
     limit 12
  loop
    insert into conf103 values (30, 'OS CASOS', r.cliente,
      'periodo ' || r.periodo_inicio || ' -> ' || r.periodo_fim
      || ' | R$ ' || to_char(coalesce(r.valor, 0), 'FM999G990D00')
      || ' | pago_em ' || coalesce(r.pago_em::text, '-')
      || ' | HOJE ' || r.hoje || ' | INICIO ' || r.pelo_inicio || ' | FIM ' || r.pelo_fim,
      'classe ' || r.classe);
  end loop;

  -- ═══════════ O CAIXA ═══════════
  -- A prova mais direta: para as cobrancas PAGAS, qual regra fica mais perto do
  -- mes em que o dinheiro efetivamente entrou?
  select count(*) into v_n
    from conf103_map m join public.financeiro_lancamentos l on l.id = m.lancamento_id
   where m.periodo_fim is not null and l.pago_em is not null
     and date_trunc('month', l.pago_em) = date_trunc('month', m.periodo_inicio);
  insert into conf103 values (40, 'O CAIXA', 'pagas em que INICIO = mes do pagamento', v_n::text, '');

  select count(*) into v_n
    from conf103_map m join public.financeiro_lancamentos l on l.id = m.lancamento_id
   where m.periodo_fim is not null and l.pago_em is not null
     and date_trunc('month', l.pago_em) = date_trunc('month', m.periodo_fim);
  insert into conf103 values (41, 'O CAIXA', 'pagas em que FIM = mes do pagamento', v_n::text, '');

  select count(*) into v_n
    from conf103_map m join public.financeiro_lancamentos l on l.id = m.lancamento_id
   where m.periodo_fim is not null and l.pago_em is not null;
  insert into conf103 values (42, 'O CAIXA', 'total de cobrancas pagas com periodo', v_n::text,
    'as pendentes nao entram: nelas nao ha caixa para comparar');
end $$;

select ordem, secao, item, valor, resultado from conf103 order by ordem, item, valor;
