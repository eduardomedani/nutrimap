-- ===========================================================================
-- COMERCIAL — APOIO AO ROTEIRO DE TELA DA MIGRATION C
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. Rodar ANTES de comecar os testes na tela, e de novo
-- DEPOIS, para conferir o que a tela gravou.
--
-- POR QUE ELE EXISTE. O teste "criar cobranca do periodo" so prova alguma coisa
-- se o cliente escolhido AINDA NAO TIVER cobranca viva para o periodo vigente.
-- Se tiver, o indice unico recusa — e recusar e o comportamento certo, mas quem
-- esta testando le como bug. Este script diz em quem clicar.
--
-- COMO LER:
--
--   CANDIDATOS    clientes cujo periodo vigente NAO tem cobranca viva. Sao os
--                 bons para os testes 1, 2 e 3. Vem com o vencimento e a
--                 competencia que a tela DEVE gravar, calculados aqui pelas
--                 mesmas regras — se a tela divergir, a divergencia e da tela.
--
--   JA TEM        clientes cujo periodo vigente ja tem cobranca viva. Nesses o
--                 botao vai recusar, e esta certo. Servem de teste 2 direto.
--
--   SEM ASSINATURA  pacientes disponiveis para o teste 4 (Nova assinatura).
--
--   PLANOS        os planos ativos com duracao, para escolher um Trimestral no
--                 teste 4 — num Mensal as duas regras de vencimento coincidem,
--                 e o teste nao discrimina nada.
--
--   O QUE A TELA GRAVOU   as cobrancas mais recentes, com as cinco datas lado a
--                 lado. E a secao para rodar DEPOIS de cada teste.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/104_roteiro_de_tela_LIMPO.sql
-- ===========================================================================

drop table if exists conf104;
create temp table conf104 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_dono  uuid;
  v_hoje  date := current_date;
  v_n     int;
  r       record;
begin
  select o.proprietario_user_id into v_dono
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  insert into conf104 values (1, 'HOJE', 'data do banco', v_hoje::text,
    'o vencimento sugerido pela tela sai daqui + 30 = ' || (v_hoje + 30));

  -- ═══════════ CANDIDATOS ═══════════
  for r in
    select p.nome, a.id,
           a.inicio_periodo, a.fim_periodo, a.valor_contratado, a.status,
           pl.nome as plano, pl.duracao_valor, pl.duracao_unidade
      from public.comercial_assinaturas a
      join public.pacientes p              on p.id = a.paciente_id
      left join public.comercial_planos pl on pl.id = a.plano_id
     where a.nutri_id = v_dono
       and a.status = 'ativa'
       and a.valor_contratado is not null
       and not exists (
         select 1 from public.financeiro_lancamentos l
          where l.assinatura_id = a.id
            and l.periodo_fim = a.fim_periodo
            and l.status <> 'cancelado')
     order by p.nome
     limit 8
  loop
    insert into conf104 values (10, 'CANDIDATOS', r.nome,
      'periodo ' || r.inicio_periodo || ' -> ' || r.fim_periodo
      || ' | ' || coalesce(r.plano, '-')
      || ' | R$ ' || to_char(coalesce(r.valor_contratado, 0), 'FM999G990D00'),
      'a tela deve gravar: vencimento ' || (v_hoje + 30)
      || ' | competencia ' || to_char(date_trunc('month', r.inicio_periodo), 'YYYY-MM')
      || ' | periodo ' || r.inicio_periodo || ' -> ' || r.fim_periodo);
  end loop;

  select count(*) into v_n
    from public.comercial_assinaturas a
   where a.nutri_id = v_dono and a.status = 'ativa' and a.valor_contratado is not null
     and not exists (select 1 from public.financeiro_lancamentos l
                      where l.assinatura_id = a.id and l.periodo_fim = a.fim_periodo
                        and l.status <> 'cancelado');
  insert into conf104 values (11, 'CANDIDATOS', 'total sem cobranca viva no periodo vigente', v_n::text,
    case when v_n = 0 then 'nenhum — use a secao JA TEM para o teste 2 e pule o 1'
         else 'escolha um da lista acima para os testes 1, 2 e 3' end);

  -- ═══════════ JA TEM ═══════════
  for r in
    select p.nome, l.vencimento, l.status, l.valor,
           a.inicio_periodo, a.fim_periodo
      from public.financeiro_lancamentos l
      join public.comercial_assinaturas a on a.id = l.assinatura_id
      join public.pacientes p             on p.id = a.paciente_id
     where l.nutri_id = v_dono
       and l.periodo_fim = a.fim_periodo
       and l.status <> 'cancelado'
     order by p.nome
     limit 6
  loop
    insert into conf104 values (20, 'JA TEM', r.nome,
      'cobranca ' || r.status || ' vencendo ' || r.vencimento
      || ' | R$ ' || to_char(coalesce(r.valor, 0), 'FM999G990D00')
      || ' | periodo ' || r.inicio_periodo || ' -> ' || r.fim_periodo,
      'criar outra AQUI deve ser recusada — e o teste 2');
  end loop;

  -- ═══════════ SEM ASSINATURA ═══════════
  select count(*) into v_n
    from public.pacientes p
   where p.nutri_id = v_dono
     and not exists (select 1 from public.comercial_assinaturas a
                      where a.paciente_id = p.id and a.status in ('ativa', 'aguardando_inicio'));
  insert into conf104 values (30, 'SEM ASSINATURA', 'pacientes disponiveis para o teste 4', v_n::text,
    case when v_n = 0 then 'nenhum — o teste 4 precisa de um paciente sem assinatura'
         else 'eles e que aparecem no seletor de Nova assinatura' end);

  for r in
    select p.nome from public.pacientes p
     where p.nutri_id = v_dono
       and not exists (select 1 from public.comercial_assinaturas a
                        where a.paciente_id = p.id and a.status in ('ativa', 'aguardando_inicio'))
     order by p.nome limit 5
  loop
    insert into conf104 values (31, 'SEM ASSINATURA', r.nome, '', '');
  end loop;

  -- ═══════════ PLANOS ═══════════
  for r in
    select pl.nome, pl.duracao_valor, pl.duracao_unidade, pl.preco_padrao, pl.tolerancia_dias
      from public.comercial_planos pl
     where pl.nutri_id = v_dono and pl.ativo
     order by pl.duracao_valor desc, pl.nome
  loop
    insert into conf104 values (40, 'PLANOS', r.nome,
      r.duracao_valor || ' ' || r.duracao_unidade
      || ' | preco ' || coalesce(to_char(r.preco_padrao, 'FM999G990D00'), 'NAO DEFINIDO')
      || ' | tolerancia ' || coalesce(r.tolerancia_dias::text, '-'),
      case when r.duracao_valor >= 60 then 'BOM PARA O TESTE 4 — num Mensal as duas regras coincidem'
           when r.preco_padrao is null then 'sem preco padrao: a sugestao ao trocar de plano fica vazia'
           else '' end);
  end loop;

  -- ═══════════ O QUE A TELA GRAVOU ═══════════
  -- Rodar DEPOIS de cada teste. As cinco datas lado a lado.
  for r in
    select p.nome, l.id, l.status, l.criado_em,
           l.data, l.vencimento, l.periodo_inicio, l.periodo_fim, l.competencia, l.valor
      from public.financeiro_lancamentos l
      left join public.pacientes p on p.id = l.paciente_id
     where l.nutri_id = v_dono and l.assinatura_id is not null
     order by l.criado_em desc
     limit 6
  loop
    insert into conf104 values (50, 'O QUE A TELA GRAVOU', coalesce(r.nome, '(sem paciente)'),
      'criada ' || to_char(r.criado_em, 'DD/MM HH24:MI')
      || ' | vence ' || r.vencimento
      || ' | periodo ' || coalesce(r.periodo_inicio::text, '?') || ' -> ' || coalesce(r.periodo_fim::text, '?')
      || ' | competencia ' || to_char(r.competencia, 'YYYY-MM')
      || ' | R$ ' || to_char(coalesce(r.valor, 0), 'FM999G990D00')
      || ' | ' || r.status,
      case when r.periodo_inicio is null or r.periodo_fim is null
             then 'FALHOU — a tela nao gravou o periodo'
           when r.competencia is distinct from date_trunc('month', r.periodo_inicio)::date
             then 'FALHOU — competencia nao e o mes do inicio'
           when r.data is distinct from r.vencimento
             then 'ATENCAO — `data` deixou de acompanhar o vencimento'
           else 'ok' end);
  end loop;
end $$;

select ordem, secao, item, valor, resultado from conf104 order by ordem, item, valor;
