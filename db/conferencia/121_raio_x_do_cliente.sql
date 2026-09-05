-- ===========================================================================
-- RAIO-X DE UM CLIENTE — todo lancamento, a assinatura e a trilha
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- POR QUE ESTE SCRIPT EXISTE. Em 05/09/2026, olhando as receitas em aberto da
-- conferencia 120, um cliente apareceu com DOIS lancamentos em
-- 25/08: um em aberto e um pago sem categoria. A pergunta e por que.
--
-- A SUSPEITA, que este script confirma ou derruba: e o MESMO dinheiro gravado
-- duas vezes, por dois caminhos que nao se enxergam.
--
--   CAMINHO 1 — a tela do Comercial. Quem da baixa chama
--   `comercial_registrar_pagamento`. A cobranca dele nasceu em
--   `criarCobranca` (js/comercial-data.js:203), que grava
--   `categoria_id: categoriaId` com DEFAULT NULL — cobranca de assinatura
--   nasce sem categoria de proposito, e por isso o lancamento pago aparece
--   sem categoria na tela do Financeiro.
--
--   CAMINHO 2 — a importacao da planilha de vendas
--   (db/comercial_pagamentos_da_planilha.sql, linha 2231). Ela lancou
--   25/08, R$ 385,00, pacote "Mensal - 5x", pix — e como a coluna "Pago" da
--   planilha estava em BRANCO, entrou como `pendente`. Branco e "ainda nao
--   conferi", nao "recebi", e essa decisao esta certa.
--
-- POR QUE A GUARDA NAO PEGOU. A importacao tem protecao contra duplicar, mas
-- ela compara `lower(trim(descricao)) = lower(trim(r.nome))` — ou seja, espera
-- que a receita ja existente se chame exatamente "<nome do cliente>".
-- A cobranca criada pela tela se chama "<plano> — <nome do cliente>" (o
-- padrao de `criarCobranca`). Os nomes nao batem, a guarda nao
-- casa, e a linha entra como se fosse dinheiro novo.
--
-- O EFEITO EM CADEIA e o que interessa: essa pendente extra nao pertence a
-- assinatura nenhuma (`assinatura_id` nulo) e nao tem vencimento. Ela infla o
-- "a receber" da tela, nao gera proxima cobranca e nunca vai sumir sozinha —
-- e o mesmo perfil das 90 linhas de origem 'vendas' da conferencia 120.
--
-- ===========================================================================
-- COMO USAR EM OUTRO CLIENTE
-- ---------------------------------------------------------------------------
-- Troque `v_nome` na primeira linha do bloco. A busca ignora acento, porque a
-- planilha e o cadastro discordam no acento de varios nomes.
--
-- ===========================================================================
-- O QUE CADA SECAO RESPONDE
-- ---------------------------------------------------------------------------
--   CADASTRO      quem e, e em que periodo a assinatura esta parada
--   LANCAMENTOS   TODOS, pagos e pendentes, com a origem de cada um. A coluna
--                 `resultado` diz por qual caminho a linha entrou.
--   DUPLICATA     pares do mesmo valor a menos de 10 dias com status
--                 diferente. E o formato exato do caso que originou o script.
--   TRILHA        o que a assinatura registrou de renovacao, com data.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/121_raio_x_do_cliente_LIMPO.sql
-- ===========================================================================

drop table if exists conf121;
create temp table conf121 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_nome text := 'NOME COMPLETO DO CLIENTE';   -- <<< troque aqui
  v_org  uuid;
  v_pac  uuid;
  v_n    int;
  r      record;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  -- Sem acento dos dois lados: a planilha e o cadastro discordam em varios
  -- nomes, e comparar cru nao acha a pessoa.
  select p.id into v_pac
    from public.pacientes p
   where p.nutri_id = v_org
     and lower(translate(trim(p.nome),
                 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
       = lower(translate(trim(v_nome),
                 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
   limit 1;

  if v_pac is null then
    insert into conf121 values (0, 'CADASTRO', v_nome, 'NAO ENCONTRADO',
      'confira a grafia — a busca ja ignora acento');
    return;
  end if;

  -- ═══════════ CADASTRO ═══════════
  for r in
    select a.status, a.inicio_periodo, a.fim_periodo, a.valor_contratado,
           a.renovacao_automatica, a.data_inicio_original,
           pl.nome as plano,
           current_date - a.fim_periodo as dias_vencido
      from public.comercial_assinaturas a
      left join public.comercial_planos pl on pl.id = a.plano_id
     where a.paciente_id = v_pac
     order by a.criado_em desc
  loop
    insert into conf121 values (10, 'CADASTRO', coalesce(r.plano, '(sem plano)'),
      r.status
      || ' | periodo ' || r.inicio_periodo || ' a ' || r.fim_periodo
      || ' | R$ ' || to_char(r.valor_contratado, 'FM999G990D00')
      || ' | renovacao ' || case when r.renovacao_automatica then 'ligada' else 'DESLIGADA' end,
      case when r.dias_vencido > 0 then 'periodo terminou ha ' || r.dias_vencido || ' dias'
           else 'periodo vigente' end);
  end loop;

  -- ═══════════ LANCAMENTOS ═══════════
  -- TODOS, nao so os pendentes: a duplicata so aparece quando o pago e o
  -- pendente estao lado a lado.
  for r in
    select l.data, l.vencimento, l.pago_em, l.status, l.valor, l.descricao,
           l.origem, l.origem_linha, l.forma_pagamento,
           c.nome as categoria,
           l.assinatura_id, l.periodo_inicio, l.periodo_fim,
           l.criado_em::date as criado
      from public.financeiro_lancamentos l
      left join public.financeiro_categorias c on c.id = l.categoria_id
     where l.nutri_id = v_org and l.paciente_id = v_pac and l.tipo = 'receita'
       and l.arquivado_em is null
     order by l.data desc, l.criado_em desc
  loop
    insert into conf121 values (20, 'LANCAMENTOS', r.data::text,
      upper(r.status)
      || ' R$ ' || to_char(r.valor, 'FM999G990D00')
      || ' | ' || left(r.descricao, 46)
      || ' | cat ' || coalesce(r.categoria, '—')
      || ' | venc ' || coalesce(r.vencimento::text, '—')
      || ' | pago em ' || coalesce(r.pago_em::text, '—'),
      case
        when r.origem = 'vendas' and r.assinatura_id is null
          then 'IMPORTACAO da planilha (linha ' || coalesce(r.origem_linha::text, '?') || ') — fora do ciclo'
        when r.assinatura_id is not null
          then 'cobranca da assinatura, cobre ' || coalesce(r.periodo_inicio::text, '?')
               || ' a ' || coalesce(r.periodo_fim::text, '?')
        else 'origem ' || r.origem || ', sem assinatura' end);
  end loop;

  -- ═══════════ DUPLICATA ═══════════
  -- Mesmo valor, ate 10 dias de distancia, status diferente. E a assinatura de
  -- "o mesmo dinheiro entrou por dois caminhos": um lado foi baixado na tela, o
  -- outro veio da planilha e ficou pendente para sempre.
  for r in
    select a.data as data_a, a.status as status_a, a.origem as origem_a,
           b.data as data_b, b.status as status_b, b.origem as origem_b,
           a.valor
      from public.financeiro_lancamentos a
      join public.financeiro_lancamentos b
        on b.paciente_id = a.paciente_id
       and b.id <> a.id
       and b.valor = a.valor
       and abs(b.data - a.data) <= 10
       and b.status <> a.status
     where a.nutri_id = v_org and a.paciente_id = v_pac
       and a.tipo = 'receita' and b.tipo = 'receita'
       and a.arquivado_em is null and b.arquivado_em is null
       and a.status = 'pendente'
     order by a.data desc
  loop
    insert into conf121 values (30, 'DUPLICATA',
      'R$ ' || to_char(r.valor, 'FM999G990D00'),
      'pendente ' || r.data_a || ' (' || r.origem_a || ')'
      || ' x ' || r.status_b || ' ' || r.data_b || ' (' || r.origem_b || ')',
      'mesmo valor, ' || abs(r.data_b - r.data_a) || ' dia(s) de distancia — provavel MESMO dinheiro');
  end loop;

  select count(*) into v_n from conf121 where secao = 'DUPLICATA';
  insert into conf121 values (31, 'DUPLICATA', 'pares encontrados', v_n::text,
    case when v_n = 0 then 'nenhum — os lancamentos sao dinheiros diferentes' else '' end);

  -- ═══════════ TRILHA ═══════════
  for r in
    select au.acao, au.criado_em::date as quando,
           au.antes ->> 'fim_periodo'  as de,
           au.depois ->> 'fim_periodo' as para
      from public.comercial_assinatura_auditoria au
      join public.comercial_assinaturas a on a.id = au.assinatura_id
     where a.paciente_id = v_pac
     order by au.criado_em desc
     limit 20
  loop
    insert into conf121 values (40, 'TRILHA', r.quando::text,
      r.acao || ' | fim do periodo ' || coalesce(r.de, '—') || ' -> ' || coalesce(r.para, '—'), '');
  end loop;
end $$;

select ordem, secao, item, valor, resultado from conf121 order by ordem, item desc;
