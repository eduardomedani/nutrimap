-- ===========================================================================
-- AS 90 PENDENTES DA PLANILHA — quais sao fantasma e quais sao dinheiro
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- POR QUE ESTE SCRIPT EXISTE. A conferencia 120 achou 90 receitas pendentes de
-- origem 'vendas', R$ 21.686,97 — 74% de todo o "em aberto" do Financeiro. A
-- 121 abriu uma delas e mostrou o que ela e: o
-- MESMO dinheiro que ja estava registrado como pago, gravado de novo pela
-- importacao da planilha.
--
-- O MOLDE, confirmado no dado:
--
--   pago    25/08  "<plano> — <nome do cliente>"  cobranca da tela
--   pendente 25/08 "<nome do cliente>"            importacao
--
-- A guarda anti-duplicata do import compara `descricao = nome`, e a cobranca
-- criada pela tela se chama "<plano> — <nome>". Os nomes nao batem, a guarda
-- nao casa, e a linha entra como se fosse dinheiro novo.
--
-- MAS UMA ANDORINHA NAO FAZ VERAO. Antes de arquivar 90 linhas e preciso saber
-- quantas tem mesmo um par pago do outro lado — e quantas sao dinheiro que
-- ninguem registrou, onde arquivar seria SUMIR COM RECEITA DE VERDADE.
--
-- ===========================================================================
-- OS CINCO BALDES, e por que sao cinco e nao dois
-- ---------------------------------------------------------------------------
--   DUPLICATA        ha um PAGO do mesmo cliente, mesmo valor, ate 10 dias, e
--                    esse pago NAO veio da planilha (veio da tela: cobranca de
--                    assinatura ou lancamento manual). E a forma exata do
--                    caso que originou o script. Candidata a arquivar.
--
--   PAR NA PLANILHA  ha um pago igual por perto, mas ele TAMBEM e origem
--                    'vendas'. Dois lancamentos da mesma importacao com o
--                    mesmo valor podem ser dois pagamentos de verdade — nao da
--                    para chamar de duplicata sem olhar. Fica separado de
--                    proposito.
--
--   PARECIDO         ha pago por perto, mas o valor difere. A regua e a mesma
--                    que o proprio gerador usou para avisar: ate 10 dias e
--                    diferenca menor que 5% ou R$ 15. Olhar uma a uma.
--
--   SEM PAR          nao ha pago nenhum na janela. Aqui a hipotese se inverte:
--                    pode ser dinheiro que entrou no caixa e nunca foi
--                    registrado. ARQUIVAR ESTAS SERIA APAGAR RECEITA.
--
--   SEM CLIENTE      `paciente_id` nulo. Sem cliente nao ha com o que cruzar,
--                    entao nao entra em balde nenhum dos outros.
--
--                    CUIDADO AO LER ESTE BALDE. Ele NAO quer dizer "a
--                    importacao nao achou a pessoa": quem trouxe estas linhas
--                    foi o gerador ANTIGO (db/gerador_vendas.mjs), e ele nunca
--                    ligou paciente — o mapa dele e "Nome -> descricao", so
--                    isso. Paciente vinculado so passou a existir na
--                    importacao de agosto/2026. Entao `paciente_id` nulo aqui
--                    e a marca de "veio do import velho", nao de falha.
--
--                    E O STATUS DELAS TAMBEM SIGNIFICA OUTRA COISA. No gerador
--                    antigo, `pago: !/^n/i.test(...)` — BRANCO E RECEBIDO, e so
--                    "Nao" vira pendente. O contrario da importacao nova. Logo
--                    uma pendente destas nao e "ninguem conferiu": e uma venda
--                    que a planilha marcou explicitamente como NAO PAGA.
--
-- A ORDEM DOS BALDES E DE DECISAO, nao de tamanho: da esquerda (arquivar sem
-- medo) para a direita (nao toque sem olhar).
--
-- ===========================================================================
-- O QUE FAZER COM O RESULTADO
-- ---------------------------------------------------------------------------
-- Fantasma NAO deve virar 'pago'. O dinheiro ja esta no caixa pelo outro lado;
-- marcar as duas contaria a mesma receita duas vezes e estragaria o fluxo de
-- caixa e o balanco do mes. O caminho e `arquivado_em`, que tira da tela sem
-- apagar o historico da importacao.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/122_as_90_da_planilha_LIMPO.sql
-- ===========================================================================

drop table if exists conf122;
drop table if exists conf122_cls;
create temp table conf122 (ordem int, secao text, item text, valor text, resultado text);
create temp table conf122_cls (
  balde text, cliente text, data date, valor numeric, detalhe text);

do $$
declare
  v_org  uuid;
  v_n    int;
  v_v    numeric;
  v_tot  numeric;
  r      record;
  m      record;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  -- ═══════════ CLASSIFICACAO ═══════════
  for r in
    select l.id, l.data, l.valor, l.descricao, l.paciente_id, l.origem_linha,
           p.nome as cliente
      from public.financeiro_lancamentos l
      left join public.pacientes p on p.id = l.paciente_id
     where l.nutri_id = v_org and l.tipo = 'receita'
       and l.status = 'pendente' and l.arquivado_em is null
       and l.origem = 'vendas' and l.assinatura_id is null
     order by l.data, p.nome
  loop
    -- Sem cliente nao ha cruzamento possivel: o par so pode ser procurado por
    -- pessoa, porque valor e data sozinhos casariam gente diferente.
    if r.paciente_id is null then
      insert into conf122_cls values ('5 SEM CLIENTE', coalesce(r.descricao, '(sem nome)'),
        r.data, r.valor,
        'import ANTIGO (nunca ligou paciente) — pendente aqui = planilha dizia "Nao"'
        || case when r.valor is null then ' | SEM VALOR na planilha' else '' end);
      continue;
    end if;

    -- O par: pago do MESMO cliente, na janela de 10 dias. Ordenado pelo mais
    -- proximo em valor e depois em data, para o primeiro achado ser o melhor
    -- candidato, e nao um qualquer.
    select l2.valor, l2.data, l2.origem, l2.assinatura_id, l2.descricao
      into m
      from public.financeiro_lancamentos l2
     where l2.nutri_id = v_org and l2.tipo = 'receita'
       and l2.status = 'pago' and l2.arquivado_em is null
       and l2.paciente_id = r.paciente_id
       and l2.id <> r.id
       and abs(l2.data - r.data) <= 10
     order by abs(l2.valor - r.valor), abs(l2.data - r.data)
     limit 1;

    -- `found` e nao `m is null`: um record de campos todos nulos tambem
    -- satisfaz `is null`, e ai um pago legitimo com colunas vazias viraria
    -- "sem par" sem ninguem notar.
    if not found then
      insert into conf122_cls values ('4 SEM PAR', r.cliente, r.data, r.valor,
        'nenhum pago deste cliente em 10 dias — pode ser receita nao registrada');
    elsif m.valor = r.valor and m.origem <> 'vendas' then
      insert into conf122_cls values ('1 DUPLICATA', r.cliente, r.data, r.valor,
        'pago ' || m.data || ' (' || m.origem
        || case when m.assinatura_id is not null then ', assinatura' else '' end
        || ') — ' || left(m.descricao, 40));
    elsif m.valor = r.valor then
      insert into conf122_cls values ('2 PAR NA PLANILHA', r.cliente, r.data, r.valor,
        'pago ' || m.data || ' tambem veio da planilha — podem ser dois pagamentos');
    elsif abs(m.valor - r.valor) <= greatest(15, r.valor * 0.05) then
      insert into conf122_cls values ('3 PARECIDO', r.cliente, r.data, r.valor,
        'pago ' || m.data || ' de R$ ' || to_char(m.valor, 'FM999G990D00')
        || ' (' || m.origem || ') — diferenca de R$ ' || to_char(abs(m.valor - r.valor), 'FM999G990D00'));
    else
      insert into conf122_cls values ('4 SEM PAR', r.cliente, r.data, r.valor,
        'o pago mais proximo e de R$ ' || to_char(m.valor, 'FM999G990D00')
        || ' em ' || m.data || ' — longe demais para ser o mesmo');
    end if;
  end loop;

  -- ═══════════ RESUMO ═══════════
  select coalesce(sum(valor), 0) into v_tot from conf122_cls;

  insert into conf122 values (10, 'RESUMO', 'total classificado',
    (select count(*) from conf122_cls)::text,
    'R$ ' || to_char(v_tot, 'FM999G990D00'));

  for r in
    select balde, count(*) as n, coalesce(sum(valor), 0) as total
      from conf122_cls group by balde order by balde
  loop
    insert into conf122 values (11, 'RESUMO', r.balde,
      r.n || ' linha(s) — R$ ' || to_char(r.total, 'FM999G990D00'),
      case when v_tot > 0
           then round(r.total * 100 / v_tot) || '% do valor'
           else '' end);
  end loop;

  -- A conta que decide o tamanho do trabalho: quanto sai da tela sem risco.
  select count(*), coalesce(sum(valor), 0) into v_n, v_v
    from conf122_cls where balde = '1 DUPLICATA';
  insert into conf122 values (12, 'RESUMO', 'arquivaveis sem duvida', v_n::text,
    'R$ ' || to_char(v_v, 'FM999G990D00') || ' saem do "a receber" sem tocar no caixa');

  select count(*), coalesce(sum(valor), 0) into v_n, v_v
    from conf122_cls where balde in ('2 PAR NA PLANILHA', '3 PARECIDO', '4 SEM PAR', '5 SEM CLIENTE');
  insert into conf122 values (13, 'RESUMO', 'precisam de olho humano', v_n::text,
    'R$ ' || to_char(v_v, 'FM999G990D00') || ' — nao arquivar no automatico');

  -- ═══════════ AS LINHAS, balde por balde ═══════════
  for r in
    select balde, cliente, data, valor, detalhe from conf122_cls
     order by balde, data, cliente
  loop
    insert into conf122 values (
      case r.balde when '1 DUPLICATA'       then 20
                   when '2 PAR NA PLANILHA' then 30
                   when '3 PARECIDO'        then 40
                   when '4 SEM PAR'         then 50
                   else 60 end,
      r.balde, coalesce(r.cliente, '(sem cliente)'),
      r.data || ' — R$ ' || to_char(r.valor, 'FM999G990D00'),
      r.detalhe);
  end loop;
end $$;

select ordem, secao, item, valor, resultado from conf122 order by ordem, item;
