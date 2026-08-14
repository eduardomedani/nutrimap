-- ===========================================================================
-- COMERCIAL — QUAIS COBRANCAS JA EXISTEM
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- POR QUE ESTE SCRIPT EXISTE. db/comercial_atualizar_pagamentos.sql foi escrito
-- assumindo que NENHUMA cobranca estava ligada a uma assinatura — foi o que o
-- seed do Comercial deixou, de proposito. Em 13/08/2026 ele esbarrou no indice
-- uq_comercial_cobranca_periodo: alguem criou cobranca pela tela desde entao.
--
-- Isto muda o conserto. Se existe cobranca PENDENTE para o periodo que a
-- planilha diz que foi pago, a venda importada e a MESMA receita: lancar as
-- duas conta o dinheiro duas vezes. O certo nesse caso e quitar a cobranca que
-- ja existe, nao criar outra ao lado.
--
-- COMO LER:
--
--   TOTAL / cobrancas de assinatura
--       quantas existem. Se for 0, o erro veio de outro lugar e vale reler.
--
--   POR CLIENTE
--       uma linha por cobranca, com a situacao dela e se a venda equivalente
--       ja esta no Financeiro vinda da planilha. A coluna `conflito` marca as
--       que colidem com o que a atualizacao quer gravar.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/92_cobrancas_que_ja_existem_LIMPO.sql
-- ===========================================================================

drop table if exists conf92;
create temp table conf92 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_dono uuid;
  v_n    int;
  r      record;
begin
  select o.proprietario_user_id into v_dono
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  -- ═══════════ TOTAL ═══════════
  select count(*) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and assinatura_id is not null;
  insert into conf92 values (10, 'TOTAL', 'cobrancas de assinatura', v_n::text,
    case when v_n = 0 then 'o seed nao criou nenhuma' else 'a tela ja foi usada' end);

  select count(*) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and assinatura_id is not null and status = 'pendente';
  insert into conf92 values (11, 'TOTAL', 'pendentes', v_n::text, '');

  select count(*) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and assinatura_id is not null and status = 'pago';
  insert into conf92 values (12, 'TOTAL', 'pagas', v_n::text, '');

  select count(*) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and assinatura_id is not null and origem = 'vendas';
  insert into conf92 values (13, 'TOTAL', 'que vieram da planilha', v_n::text,
    'estas a atualizacao ja tinha ligado numa tentativa anterior');

  -- ═══════════ ASSINATURAS QUE ANDARAM SOZINHAS ═══════════
  -- Se a tela renovou alguem, o periodo dela nao e mais o que o seed gravou, e
  -- a atualizacao vai pular essa linha (o WHERE exige o periodo velho). Isto
  -- diz quantas ja estao nesse estado.
  select count(*) into v_n
    from public.comercial_assinaturas
   where nutri_id = v_dono
     and atualizado_em > criado_em + interval '1 minute';
  insert into conf92 values (20, 'ASSINATURAS', 'editadas depois de criadas', v_n::text,
    case when v_n = 0 then 'nenhuma mexida pela tela' else 'a atualizacao vai pular estas' end);

  -- ═══════════ UMA LINHA POR COBRANCA ═══════════
  for r in
    select p.nome,
           l.vencimento,
           l.valor,
           l.status,
           l.origem,
           l.data,
           a.inicio_periodo,
           a.fim_periodo,
           -- colide com a atualizacao? Ela quer gravar vencimento = fim do
           -- periodo vigente em cada assinatura que vai renovar.
           (l.vencimento = a.fim_periodo and l.origem <> 'vendas') as conflito
      from public.financeiro_lancamentos l
      join public.comercial_assinaturas a on a.id = l.assinatura_id
      join public.pacientes p             on p.id = a.paciente_id
     where l.nutri_id = v_dono
     order by p.nome, l.vencimento
  loop
    insert into conf92 values (30, 'POR CLIENTE', r.nome,
      'vence ' || r.vencimento
      || ' | R$ ' || to_char(coalesce(r.valor, 0), 'FM999G990D00')
      || ' | ' || r.status
      || ' | origem ' || r.origem
      || ' | periodo ' || r.inicio_periodo || ' -> ' || r.fim_periodo,
      case when r.conflito then 'COLIDE com a atualizacao' else '' end);
  end loop;

  -- ═══════════ A VENDA EQUIVALENTE JA ESTA LANCADA? ═══════════
  -- Para cada cobranca pendente, procura no Financeiro uma receita da planilha
  -- do mesmo cliente e do mesmo valor, com data proxima do vencimento. Se
  -- achar, as duas sao o MESMO dinheiro.
  for r in
    select p.nome,
           l.vencimento,
           l.valor,
           (select count(*)
              from public.financeiro_lancamentos v
             where v.nutri_id = v_dono
               and v.origem = 'vendas'
               and v.assinatura_id is null
               and lower(trim(v.descricao)) = lower(trim(p.nome))
               and v.valor = l.valor
               and v.data between l.vencimento - 10 and l.vencimento + 10) as vendas_iguais
      from public.financeiro_lancamentos l
      join public.comercial_assinaturas a on a.id = l.assinatura_id
      join public.pacientes p             on p.id = a.paciente_id
     where l.nutri_id = v_dono
       and l.status = 'pendente'
     order by p.nome
  loop
    insert into conf92 values (40, 'RECEITA EM DOBRO?', r.nome,
      'cobranca de R$ ' || to_char(coalesce(r.valor, 0), 'FM999G990D00')
      || ' vencendo ' || r.vencimento
      || ' | vendas iguais na planilha: ' || r.vendas_iguais,
      case when r.vendas_iguais > 0 then 'MESMO DINHEIRO — quitar a cobranca, nao lancar outra'
           else 'sem venda equivalente' end);
  end loop;
end $$;

select ordem, secao, item, valor, resultado from conf92 order by ordem, item, valor;
