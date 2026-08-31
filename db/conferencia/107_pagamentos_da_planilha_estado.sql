-- ===========================================================================
-- PAGAMENTOS DA PLANILHA — O QUE O BANCO JA TEM, ANTES DE ATUALIZAR
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- POR QUE ESTE SCRIPT EXISTE. db/gerador_atualizacao_pagamentos.mjs compara a
-- planilha com os DOIS seeds do repositorio, e casa cada venda pelo NUMERO DA
-- LINHA na planilha (que virou `origem_linha` no banco). Duas coisas quebram
-- esse caminho para a planilha "Pagamentos":
--
--   1. os seeds nao estao mais na maquina (estao no .gitignore, sao dado
--      pessoal), entao nao ha com o que comparar;
--   2. a planilha "Pagamentos" tem 79 linhas, e a "Vendas" importada em
--      05/08/2026 ia ate a linha 2179. As linhas 2..79 desta planilha NAO sao
--      as linhas 2..79 daquela. Casar por numero aqui aponta para a pessoa
--      errada, e `uniq_financeiro_lancamentos_origem` recusaria a insercao.
--
-- Entao, em vez de supor pelo arquivo, este script pergunta ao banco. Ele nao
-- traz nome de cliente escrito no proprio arquivo — os nomes aparecem no
-- RESULTADO, que e o retrato de hoje. Por isso ele pode ser versionado, ao
-- contrario dos seeds.
--
-- COMO LER. Tres decisoes saem daqui:
--
--   NUMERACAO / proxima linha livre por origem
--       diz com que `origem_linha` as receitas novas podem entrar sem colidir
--       com o que ja foi importado. `origem` so aceita 'manual', 'planilha' e
--       'vendas' (CHECK em db/financeiro_lancamentos.sql).
--
--   NUMERACAO / ocupadas no intervalo 2..79
--       se for > 0, confirma que reaproveitar o numero da linha da planilha
--       "Pagamentos" colidiria. Esperado: colide, e por isso a numeracao das
--       novas tem que continuar de onde a importacao parou.
--
--   JA LANCADO / uma linha por receita de 01/08/2026 em diante
--       e o que se compara com a planilha, por nome + data + valor. O que
--       estiver aqui NAO deve ser inserido de novo: seria dinheiro em dobro.
--
-- A secao ASSINATURAS diz de onde cada renovacao vai partir, e COBRANCAS EM
-- ABERTO diz quais pagamentos da planilha sao a MESMA receita de uma cobranca
-- que ja existe — nesses casos o certo e quitar a cobranca pela RPC, nao
-- lancar uma receita ao lado.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/107_pagamentos_da_planilha_estado_LIMPO.sql
-- ===========================================================================

drop table if exists conf107;
create temp table conf107 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_dono  uuid;
  v_n     int;
  v_max   int;
  r       record;
  -- primeiro dia da planilha "Pagamentos"; tudo daqui para frente e o que
  -- pode colidir com ela.
  v_corte date := date '2026-08-01';
begin
  select o.proprietario_user_id into v_dono
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  insert into conf107 values (0, 'CONTA', 'proprietario', coalesce(v_dono::text, 'NAO ACHOU'),
    case when v_dono is null then 'sem dono nao da para ler nada abaixo' else '' end);

  -- ═══════════ NUMERACAO — onde as novas receitas cabem ═══════════
  for r in
    select l.origem,
           count(*)                  as n,
           max(l.origem_linha)       as ultima,
           min(l.data)               as primeira_data,
           max(l.data)               as ultima_data
      from public.financeiro_lancamentos l
     where l.nutri_id = v_dono
     group by l.origem
     order by l.origem
  loop
    insert into conf107 values (10, 'NUMERACAO', r.origem,
      r.n || ' lancamentos | ultima origem_linha: ' || coalesce(r.ultima::text, 'nenhuma')
      || ' | datas ' || r.primeira_data || ' -> ' || r.ultima_data,
      case when r.ultima is null then 'origem sem numeracao'
           else 'proxima livre: ' || (r.ultima + 1) end);
  end loop;

  -- As linhas 2..79 sao as que a planilha "Pagamentos" reivindicaria se o
  -- numero dela fosse reaproveitado. Quantas ja estao ocupadas?
  for r in
    select l.origem, count(*) as n
      from public.financeiro_lancamentos l
     where l.nutri_id = v_dono
       and l.origem <> 'manual'
       and l.origem_linha between 2 and 79
     group by l.origem
     order by l.origem
  loop
    insert into conf107 values (11, 'NUMERACAO', 'ocupadas no intervalo 2..79 (' || r.origem || ')',
      r.n::text,
      case when r.n > 0 then 'COLIDE — nao reaproveitar o numero da linha da planilha'
           else 'livre' end);
  end loop;

  -- ═══════════ JA LANCADO — receitas do periodo da planilha ═══════════
  select count(*) into v_n
    from public.financeiro_lancamentos l
   where l.nutri_id = v_dono and l.tipo = 'receita' and l.data >= v_corte;
  insert into conf107 values (20, 'JA LANCADO', 'receitas de ' || v_corte || ' em diante', v_n::text,
    case when v_n = 0 then 'nada lancado no periodo — a planilha inteira e novidade'
         else 'comparar uma a uma com a planilha antes de inserir' end);

  for r in
    select l.data,
           l.descricao,
           l.valor,
           l.status,
           l.origem,
           l.origem_linha,
           l.forma_pagamento,
           l.competencia,
           l.assinatura_id is not null as ligada,
           l.periodo_inicio,
           l.periodo_fim
      from public.financeiro_lancamentos l
     where l.nutri_id = v_dono
       and l.tipo = 'receita'
       and l.data >= v_corte
     order by l.data, l.descricao
  loop
    insert into conf107 values (21, 'JA LANCADO', coalesce(r.descricao, '(sem descricao)'),
      r.data
      || ' | R$ ' || to_char(coalesce(r.valor, 0), 'FM999G990D00')
      || ' | ' || r.status
      || ' | ' || r.origem || '/' || coalesce(r.origem_linha::text, '-')
      || ' | forma ' || coalesce(r.forma_pagamento, '-')
      || ' | competencia ' || r.competencia
      || case when r.periodo_inicio is null then ''
              else ' | periodo ' || r.periodo_inicio || ' -> ' || r.periodo_fim end,
      case when r.ligada then 'ligada a assinatura' else 'solta' end);
  end loop;

  -- ═══════════ ASSINATURAS — de onde cada renovacao parte ═══════════
  select count(*) into v_n from public.comercial_assinaturas where nutri_id = v_dono;
  insert into conf107 values (30, 'ASSINATURAS', 'total', v_n::text, '');

  select count(*) into v_n
    from public.comercial_assinaturas
   where nutri_id = v_dono and atualizado_em > criado_em + interval '1 minute';
  insert into conf107 values (31, 'ASSINATURAS', 'editadas depois de criadas', v_n::text,
    case when v_n = 0 then 'nenhuma mexida pela tela desde o seed'
         else 'estas ja andaram — o periodo delas nao e mais o do seed' end);

  for r in
    select p.nome,
           coalesce(pl.nome, '(sem plano)') as plano,
           a.valor_contratado,
           a.inicio_periodo,
           a.fim_periodo,
           a.status,
           pl.duracao_valor,
           pl.duracao_unidade,
           pl.tolerancia_dias
      from public.comercial_assinaturas a
      join public.pacientes p            on p.id = a.paciente_id
      left join public.comercial_planos pl on pl.id = a.plano_id
     where a.nutri_id = v_dono
       and a.status in ('ativa', 'aguardando_inicio')
     order by p.nome
  loop
    insert into conf107 values (32, 'ASSINATURAS', r.nome,
      r.plano
      || ' | R$ ' || to_char(coalesce(r.valor_contratado, 0), 'FM999G990D00')
      || ' | periodo ' || r.inicio_periodo || ' -> ' || r.fim_periodo
      || ' | ' || r.status
      || ' | duracao ' || coalesce(r.duracao_valor::text, '?') || ' ' || coalesce(r.duracao_unidade, '?')
      || ' | tolerancia ' || coalesce(r.tolerancia_dias::text, '?'),
      case when r.fim_periodo < current_date then 'VENCIDA' else '' end);
  end loop;

  -- ═══════════ COBRANCAS EM ABERTO — risco de receita em dobro ═══════════
  select count(*) into v_n
    from public.financeiro_lancamentos
   where nutri_id = v_dono and assinatura_id is not null and status = 'pendente';
  insert into conf107 values (40, 'COBRANCAS EM ABERTO', 'pendentes de assinatura', v_n::text,
    case when v_n = 0 then 'nenhuma — a planilha vira receita nova'
         else 'para estas, QUITAR a cobranca em vez de lancar receita ao lado' end);

  for r in
    select p.nome,
           l.vencimento,
           l.valor,
           l.periodo_inicio,
           l.periodo_fim,
           l.origem
      from public.financeiro_lancamentos l
      join public.comercial_assinaturas a on a.id = l.assinatura_id
      join public.pacientes p             on p.id = a.paciente_id
     where l.nutri_id = v_dono
       and l.status = 'pendente'
     order by p.nome, l.vencimento
  loop
    insert into conf107 values (41, 'COBRANCAS EM ABERTO', r.nome,
      'vence ' || r.vencimento
      || ' | R$ ' || to_char(coalesce(r.valor, 0), 'FM999G990D00')
      || ' | origem ' || r.origem
      || case when r.periodo_inicio is null then ''
              else ' | periodo ' || r.periodo_inicio || ' -> ' || r.periodo_fim end,
      '');
  end loop;

  -- ═══════════ PACIENTES — o casamento por nome ═══════════
  -- A planilha so tem o nome escrito. Se houver nome repetido no cadastro, o
  -- casamento por nome e ambiguo e a linha tem que ser resolvida a mao.
  select count(*) into v_n from public.pacientes where nutri_id = v_dono;
  insert into conf107 values (50, 'PACIENTES', 'total no cadastro', v_n::text, '');

  select count(*) into v_max
    from (select lower(trim(nome)) as n
            from public.pacientes
           where nutri_id = v_dono
           group by 1 having count(*) > 1) x;
  insert into conf107 values (51, 'PACIENTES', 'nomes repetidos', v_max::text,
    case when v_max = 0 then 'casamento por nome e seguro'
         else 'estes precisam ser resolvidos a mao' end);

  for r in
    select lower(trim(nome)) as n, count(*) as q
      from public.pacientes
     where nutri_id = v_dono
     group by 1 having count(*) > 1
     order by 1
  loop
    insert into conf107 values (52, 'PACIENTES', r.n, r.q || ' cadastros', 'AMBIGUO');
  end loop;
end $$;

select ordem, secao, item, valor, resultado from conf107 order by ordem, item, valor;
