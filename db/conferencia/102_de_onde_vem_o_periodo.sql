-- ===========================================================================
-- COMERCIAL — DE ONDE VEM O PERIODO DE CADA COBRANCA
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- POR QUE ESTE SCRIPT EXISTE. A conferencia 101 barrou a Migration C, e fez
-- bem: o backfill dela ia copiar `vencimento` para `periodo_fim` apoiado numa
-- premissa que os dados desmentem — "ate 12/08/2026 todo caminho gravava
-- vencimento = fim do periodo".
--
-- E falso para o que veio da planilha. CASO_MENSALIDADE_TIPICA vence 2026-08-09 e o
-- periodo dela e 2026-08-09 -> 2026-09-08: o vencimento e o INICIO, porque a
-- importacao gravou a data do PAGAMENTO. Copiar dali erraria o periodo por um
-- ciclo inteiro.
--
-- E a data de criacao nao separa nada: 35 das 43 cobrancas nasceram em 13/08,
-- porque a importacao, o seed e o E2E aconteceram todos naquele dia.
--
-- O QUE SEPARA E A EVIDENCIA, e ela e local a cada linha:
--
--   FIM        vencimento = fim_periodo da assinatura  -> periodo_fim = vencimento
--   FIM ANTIGO vencimento = fim do periodo ANTERIOR, recuperado da auditoria
--              da renovacao. E o caso da CASO_RENOVACAO_SIMPLES e da CASO_TROCA_DE_PLANO, que renovaram no
--              E2E: a cobranca cobre o periodo que a renovacao deixou para tras
--   INICIO     vencimento = inicio_periodo             -> periodo_fim = fim_periodo
--   ORFA       nao bate com nenhum. Atribuicao a mao, uma a uma
--
-- COMO LER:
--
--   CLASSES        quantas cobrancas em cada evidencia. A soma tem de dar o
--                  total, e ORFA tem de ser pequeno o bastante para caber numa
--                  decisao humana.
--
--   ORFA           uma linha por cobranca sem evidencia, com tudo que ajuda a
--                  decidir: origem, status, pago_em, descricao e o periodo da
--                  assinatura.
--
--   REPETIDAS      cobrancas que dividem assinatura e vencimento. Elas so
--                  existem porque `cancelado` fica fora do indice unico — se
--                  alguma estiver VIVA, o indice novo vai recusar a criacao e a
--                  Migration C para. E o unico ponto que pode travar a migracao.
--
--   COLISAO        o teste de verdade: aplicando a regra por classe, sobra
--                  algum (assinatura_id, periodo_fim) repetido entre as vivas?
--                  Se sobrar, o indice unico nao nasce.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/102_de_onde_vem_o_periodo_LIMPO.sql
-- ===========================================================================

drop table if exists conf102;
drop table if exists conf102_map;
create temp table conf102 (ordem int, secao text, item text, valor text, resultado text);

-- O periodo que CADA cobranca cobre, pela evidencia de cada uma. Esta tabela e
-- o resultado do script: e dela que sai a regra do backfill.
create temp table conf102_map (
  lancamento_id uuid,
  cliente       text,
  classe        text,
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

  -- ═══════════ A CLASSIFICACAO ═══════════
  for r in
    select l.id, l.vencimento, l.status, l.origem, l.pago_em,
           p.nome,
           a.id as ass_id, a.inicio_periodo, a.fim_periodo,
           -- O periodo ANTERIOR, quando a assinatura renovou pela RPC. O
           -- `antes` da auditoria e o unico lugar onde ele sobreviveu.
           (select (aud.antes ->> 'inicio_periodo')::date
              from public.comercial_assinatura_auditoria aud
             where aud.assinatura_id = a.id
               and aud.acao = 'renovada'
               and (aud.antes ->> 'fim_periodo')::date = l.vencimento
             order by aud.criado_em limit 1) as ant_inicio,
           (select (aud.antes ->> 'fim_periodo')::date
              from public.comercial_assinatura_auditoria aud
             where aud.assinatura_id = a.id
               and aud.acao = 'renovada'
               and (aud.antes ->> 'fim_periodo')::date = l.vencimento
             order by aud.criado_em limit 1) as ant_fim
      from public.financeiro_lancamentos l
      join public.comercial_assinaturas a on a.id = l.assinatura_id
      join public.pacientes p             on p.id = a.paciente_id
     where l.nutri_id = v_dono
  loop
    if r.vencimento = r.fim_periodo then
      insert into conf102_map values (r.id, r.nome, 'FIM', r.inicio_periodo, r.fim_periodo);
    elsif r.ant_fim is not null then
      insert into conf102_map values (r.id, r.nome, 'FIM ANTIGO', r.ant_inicio, r.ant_fim);
    elsif r.vencimento = r.inicio_periodo then
      insert into conf102_map values (r.id, r.nome, 'INICIO', r.inicio_periodo, r.fim_periodo);
    else
      insert into conf102_map values (r.id, r.nome, 'ORFA', null, null);
    end if;
  end loop;

  select count(*) into v_tot from conf102_map;
  insert into conf102 values (10, 'CLASSES', 'total de cobrancas de assinatura', v_tot::text, '');

  for r in select classe, count(*) as n from conf102_map group by 1 order by 2 desc loop
    insert into conf102 values (11, 'CLASSES', r.classe, r.n::text,
      case r.classe
        when 'FIM'        then 'periodo_fim = vencimento — o backfill original acerta'
        when 'FIM ANTIGO' then 'periodo recuperado da auditoria da renovacao'
        when 'INICIO'     then 'vencimento e a data do PAGAMENTO; o periodo e o da assinatura'
        else 'PRECISA DE DECISAO — uma a uma, na secao ORFA' end);
  end loop;

  -- ═══════════ AS ORFAS ═══════════
  for r in
    select m.cliente, l.id, l.vencimento, l.status, l.origem, l.pago_em, l.valor,
           l.descricao, a.inicio_periodo, a.fim_periodo,
           pl.nome as plano, pl.duracao_valor, pl.duracao_unidade
      from conf102_map m
      join public.financeiro_lancamentos l on l.id = m.lancamento_id
      join public.comercial_assinaturas a  on a.id = l.assinatura_id
      left join public.comercial_planos pl on pl.id = a.plano_id
     where m.classe = 'ORFA'
     order by m.cliente
  loop
    insert into conf102 values (20, 'ORFA', r.cliente,
      'vence ' || r.vencimento
      || ' | ' || r.status
      || ' | origem ' || coalesce(r.origem, '-')
      || ' | pago_em ' || coalesce(r.pago_em::text, '-')
      || ' | R$ ' || to_char(coalesce(r.valor, 0), 'FM999G990D00')
      || ' | periodo da assinatura ' || r.inicio_periodo || ' -> ' || r.fim_periodo
      || ' | plano ' || coalesce(r.plano, '-')
      || ' (' || coalesce(r.duracao_valor::text, '?') || ' ' || coalesce(r.duracao_unidade, '?') || ')',
      'id ' || r.id);
  end loop;

  -- O que a duracao do plano diria, se o vencimento fosse o inicio de um
  -- periodo. Nao e proposta: e uma pista para a decisao.
  for r in
    select m.cliente, l.vencimento,
           case when pl.duracao_unidade = 'mes'
                then (l.vencimento + (pl.duracao_valor || ' months')::interval)::date
                else l.vencimento + pl.duracao_valor end as fim_se_fosse_inicio,
           a.inicio_periodo, a.fim_periodo
      from conf102_map m
      join public.financeiro_lancamentos l on l.id = m.lancamento_id
      join public.comercial_assinaturas a  on a.id = l.assinatura_id
      join public.comercial_planos pl      on pl.id = a.plano_id
     where m.classe = 'ORFA'
     order by m.cliente
  loop
    insert into conf102 values (21, 'ORFA · PISTA', r.cliente,
      'se ' || r.vencimento || ' fosse inicio de periodo, o fim seria ' || r.fim_se_fosse_inicio,
      case when r.fim_se_fosse_inicio = r.fim_periodo then 'BATE com o periodo atual'
           when r.fim_se_fosse_inicio = r.inicio_periodo then 'termina onde o periodo atual comeca — periodo ANTERIOR'
           else 'nao bate com nada' end);
  end loop;

  -- ═══════════ REPETIDAS ═══════════
  select count(*) into v_n from (
    select assinatura_id, vencimento from public.financeiro_lancamentos
     where nutri_id = v_dono and assinatura_id is not null
     group by 1, 2 having count(*) > 1) d;
  insert into conf102 values (30, 'REPETIDAS', 'pares (assinatura, vencimento) com mais de uma', v_n::text,
    case when v_n = 0 then 'nenhuma' else 'so passaram pelo indice antigo se estiverem canceladas' end);

  for r in
    select p.nome, l.vencimento, count(*) as n,
           count(*) filter (where l.status <> 'cancelado') as vivas,
           string_agg(distinct l.status, ', ') as situacoes,
           string_agg(distinct coalesce(l.origem, '-'), ', ') as origens
      from public.financeiro_lancamentos l
      join public.comercial_assinaturas a on a.id = l.assinatura_id
      join public.pacientes p             on p.id = a.paciente_id
     where l.nutri_id = v_dono
     group by p.nome, l.assinatura_id, l.vencimento
    having count(*) > 1
     order by p.nome
  loop
    insert into conf102 values (31, 'REPETIDAS', r.nome,
      r.n || ' cobrancas vencendo ' || r.vencimento
      || ' | vivas: ' || r.vivas
      || ' | ' || r.situacoes || ' | origem ' || r.origens,
      case when r.vivas <= 1 then 'ok — as outras estao canceladas, fora do indice'
           else 'ATENCAO — mais de uma viva no mesmo vencimento' end);
  end loop;

  -- ═══════════ COLISAO ═══════════
  -- O teste que decide se o indice unico nasce.
  select count(*) into v_n from (
    select m.periodo_fim, l.assinatura_id
      from conf102_map m
      join public.financeiro_lancamentos l on l.id = m.lancamento_id
     where m.periodo_fim is not null and l.status <> 'cancelado'
     group by 1, 2 having count(*) > 1) d;
  insert into conf102 values (40, 'COLISAO', 'periodos cobrados duas vezes entre as VIVAS', v_n::text,
    case when v_n = 0 then 'o indice unico nasce sem forcar nada'
         else 'PARE — o create do indice vai falhar' end);

  for r in
    select p.nome, m.periodo_fim, count(*) as n,
           string_agg(l.id::text || ' (' || l.status || ', vence ' || l.vencimento || ')', ' | ') as quais
      from conf102_map m
      join public.financeiro_lancamentos l on l.id = m.lancamento_id
      join public.comercial_assinaturas a  on a.id = l.assinatura_id
      join public.pacientes p              on p.id = a.paciente_id
     where m.periodo_fim is not null and l.status <> 'cancelado'
     group by p.nome, l.assinatura_id, m.periodo_fim
    having count(*) > 1
     order by p.nome
  loop
    insert into conf102 values (41, 'COLISAO', r.nome,
      r.n || ' cobrancas para o periodo que termina em ' || r.periodo_fim, r.quais);
  end loop;

  -- ═══════════ COMPETENCIA ═══════════
  -- Quantas MUDARIAM de mes se a competencia passasse a sair do periodo. Eu
  -- disse que nenhuma mudaria; era consequencia da premissa que caiu.
  select count(*) into v_n
    from conf102_map m
    join public.financeiro_lancamentos l on l.id = m.lancamento_id
   where m.periodo_fim is not null
     and l.competencia is distinct from date_trunc('month', m.periodo_fim)::date;
  insert into conf102 values (50, 'COMPETENCIA', 'cobrancas que mudariam de mes', v_n::text || ' de ' || v_tot,
    case when v_n = 0 then 'nenhuma receita historica se move'
         else 'DECISAO SUA — a lista esta abaixo, com o antes e o depois' end);

  for r in
    select p.nome, m.classe, m.periodo_fim, l.valor,
           to_char(l.competencia, 'YYYY-MM') as hoje_esta,
           to_char(date_trunc('month', m.periodo_fim), 'YYYY-MM') as passaria_a_ser,
           l.status
      from conf102_map m
      join public.financeiro_lancamentos l on l.id = m.lancamento_id
      join public.pacientes p              on p.id = l.paciente_id
     where m.periodo_fim is not null
       and l.competencia is distinct from date_trunc('month', m.periodo_fim)::date
     order by p.nome
  loop
    insert into conf102 values (51, 'COMPETENCIA', r.nome,
      r.hoje_esta || ' -> ' || r.passaria_a_ser
      || ' | R$ ' || to_char(coalesce(r.valor, 0), 'FM999G990D00')
      || ' | ' || r.status || ' | periodo termina ' || r.periodo_fim,
      'classe ' || r.classe);
  end loop;

  for r in
    select to_char(date_trunc('month', m.periodo_fim), 'YYYY-MM') as mes,
           count(*) as n,
           to_char(coalesce(sum(l.valor), 0), 'FM999G990D00') as total
      from conf102_map m
      join public.financeiro_lancamentos l on l.id = m.lancamento_id
     where m.periodo_fim is not null
     group by 1 order by 1
  loop
    insert into conf102 values (52, 'COMPETENCIA', 'pela regra nova, ' || r.mes,
      r.n || ' cobranca(s) | R$ ' || r.total,
      'compare com o RETRATO da conferencia 101');
  end loop;
end $$;

select ordem, secao, item, valor, resultado from conf102 order by ordem, item, valor;
