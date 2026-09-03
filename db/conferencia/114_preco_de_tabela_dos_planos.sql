-- ===========================================================================
-- QUAL E O PRECO DE TABELA DE CADA PLANO
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- POR QUE ESTE SCRIPT EXISTE. Quatro dos seis planos estao com
-- `preco_padrao` NULO — inclusive `Mensal - 5x`, que sozinho tem 49
-- assinaturas ativas. Sem esse valor nao existe base para calcular desconto, e
-- o bonus por numero de alunos derruba metade da base pelo motivo errado:
-- gente que paga o valor cheio sai junto com quem tem bolsa.
--
-- O preco podia ser digitado de memoria. Mas ele ESTA no dado: quem paga a
-- tabela e a maioria, entao o valor contratado que MAIS SE REPETE num plano e o
-- preco dele. Este script mostra a distribuicao para a decisao ser conferida,
-- nao lembrada.
--
-- COMO LER:
--
--   SUGESTAO      o valor mais comum entre os contratos ATIVOS do plano, e
--                 quantos contratos o confirmam. Quanto maior a concentracao,
--                 mais seguro.
--
--   DISTRIBUICAO  todos os valores praticados, do mais comum ao menos. E aqui
--                 que se ve se o "mais comum" e maioria folgada ou se o plano
--                 tem dois precos disputando — caso em que a memoria decide,
--                 nao a estatistica.
--
-- O QUE MUDA AO PREENCHER: nada nos contratos existentes. `valor_contratado`
-- ja esta gravado em cada assinatura e nao e tocado por mexer no plano — essa
-- separacao e proposital desde a Etapa 2 ("alterar a tabela de precos nao pode
-- mexer em contrato feito"). O preco padrao passa a valer para assinatura NOVA
-- e para o calculo de desconto.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/114_preco_de_tabela_dos_planos_LIMPO.sql
-- ===========================================================================

drop table if exists conf114;
create temp table conf114 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_org uuid;
  r     record;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  -- ═══════════ O ESTADO DE HOJE ═══════════
  for r in
    select p.id, p.nome, p.preco_padrao, p.duracao_valor, p.duracao_unidade,
           (select count(*) from public.comercial_assinaturas a
             where a.plano_id = p.id and a.status = 'ativa') as ativas
      from public.comercial_planos p
     where p.nutri_id = v_org and p.ativo
     order by p.nome
  loop
    insert into conf114 values (10, 'HOJE', r.nome,
      'preco ' || coalesce(r.preco_padrao::text, 'NULO')
      || ' | ' || r.duracao_valor || ' ' || r.duracao_unidade
      || ' | ' || r.ativas || ' ativa(s)',
      case when r.preco_padrao is null then 'PRECISA PREENCHER' else 'ok' end);
  end loop;

  -- ═══════════ A SUGESTAO, TIRADA DO DADO ═══════════
  for r in
    select p.nome,
           m.valor,
           m.quantos,
           t.total,
           round(100.0 * m.quantos / nullif(t.total, 0)) as concentracao
      from public.comercial_planos p
      cross join lateral (
        select count(*) as total from public.comercial_assinaturas a
         where a.plano_id = p.id and a.status = 'ativa' and a.valor_contratado is not null
      ) t
      cross join lateral (
        select a.valor_contratado as valor, count(*) as quantos
          from public.comercial_assinaturas a
         where a.plano_id = p.id and a.status = 'ativa' and a.valor_contratado is not null
         group by a.valor_contratado
         order by count(*) desc, a.valor_contratado desc
         limit 1
      ) m
     where p.nutri_id = v_org and p.ativo and p.preco_padrao is null
     order by p.nome
  loop
    insert into conf114 values (20, 'SUGESTAO', r.nome,
      'R$ ' || r.valor || '  (' || r.quantos || ' de ' || r.total || ' contratos)',
      case when r.concentracao >= 50 then 'maioria — seguro'
           when r.concentracao >= 30 then 'maior grupo, mas confira'
           else 'DISPERSO — decida de memoria' end);
  end loop;

  -- ═══════════ A DISTRIBUICAO INTEIRA ═══════════
  -- Sem ela a sugestao e um numero sem defesa. Aqui se ve se o plano tem um
  -- preco com desconto em volta, ou dois precos disputando.
  for r in
    select p.nome, a.valor_contratado as valor, count(*) as quantos
      from public.comercial_planos p
      join public.comercial_assinaturas a on a.plano_id = p.id
     where p.nutri_id = v_org and p.ativo and p.preco_padrao is null
       and a.status = 'ativa'
     group by p.nome, a.valor_contratado
     order by p.nome, count(*) desc, a.valor_contratado desc
  loop
    insert into conf114 values (30, 'DISTRIBUICAO', r.nome,
      'R$ ' || coalesce(r.valor::text, '(sem valor)') || ' — ' || r.quantos || ' contrato(s)', '');
  end loop;

  -- ═══════════ O QUE MUDA COM O PRECO PREENCHIDO ═══════════
  -- Quantos passariam a ser avaliaveis por desconto, e quantos desses ficariam
  -- ACIMA de 20% — os que sairiam da contagem do bonus por bolsa, e nao por
  -- falta de cadastro.
  for r in
    select p.nome,
           count(*) filter (where a.valor_contratado is not null) as avaliaveis,
           count(*) filter (
             where a.valor_contratado is not null
               and m.valor > 0
               and (1 - a.valor_contratado / m.valor) > 0.20)                as acima_de_20
      from public.comercial_planos p
      join public.comercial_assinaturas a on a.plano_id = p.id and a.status = 'ativa'
      cross join lateral (
        select a2.valor_contratado as valor
          from public.comercial_assinaturas a2
         where a2.plano_id = p.id and a2.status = 'ativa' and a2.valor_contratado is not null
         group by a2.valor_contratado
         order by count(*) desc, a2.valor_contratado desc
         limit 1
      ) m
     where p.nutri_id = v_org and p.ativo and p.preco_padrao is null
     group by p.nome
     order by p.nome
  loop
    insert into conf114 values (40, 'EFEITO', r.nome,
      r.avaliaveis || ' passam a ser avaliaveis | ' || r.acima_de_20 || ' sairiam por desconto',
      'usando a sugestao acima como base');
  end loop;
end $$;

select ordem, secao, item, valor, resultado from conf114 order by ordem, item, valor desc;
