-- ===========================================================================
-- Evollo · COMERCIAL — MIGRATION B: o pagamento numa transacao so
-- ---------------------------------------------------------------------------
-- Depende de db/comercial_renovacao_programada.sql (Migration A).
--
-- ATENCAO — `comercial_registrar_pagamento` FOI SUBSTITUIDA. A versao em vigor
-- esta em db/comercial_periodo_da_cobranca.sql (Migration C), que acrescentou
-- `periodo_inicio`/`periodo_fim` a cobranca automatica. O VENCIMENTO dela nao
-- mudou e nao muda: continua sendo o fim do periodo novo (decisao de
-- 14/08/2026 — um Trimestral nao vira cobranca de 30 dias).
--
-- Ele fica aqui na integra porque e dele que o desfazer da Migration C tira o
-- texto anterior. Nao aplique este arquivo depois da C sem aplicar a C de novo
-- em seguida: o `create or replace` sobrescreveria a versao nova.
--
-- DESDE 01/09/2026 A CADEIA TEM MAIS UM ELO. A versao em vigor passou a ser
-- db/multiusuario_etapa4b_rpc.sql (Etapa 4B), que e a Migration C sem os
-- blocos "TETO TEMPORARIO". A ordem de reaplicacao, se um dia for preciso, e
-- B -> C -> 4B. Parar em qualquer ponto antes do fim repoe o teto e tira da
-- Recepcao a capacidade de registrar pagamento, sem nenhum erro na tela.
--
-- NAO APLICAR antes de os casos funcionais A-E da Migration A passarem e de a
-- origem das cobrancas de 13/08 estar esclarecida.
--
-- O QUE ELA RESOLVE. `registrarPagamento()` em js/comercial-data.js faz TRES
-- escritas sequenciais pelo PostgREST — quitar, renovar, cobrar o proximo — e
-- o proprio comentario dela ja dizia que nao e transacao. A ordem foi escolhida
-- para falhar de forma conservadora, mas conservador nao e integro: uma falha
-- entre a 1a e a 2a deixa dinheiro registrado com periodo velho, e o cliente
-- aparece vencido tendo pago.
--
-- Com a renovacao programada da Migration A o problema piorou: agora sao
-- QUATRO escritas (a quarta e consumir a intencao), e uma falha no meio pode
-- deixar uma troca de plano pendurada depois de o pagamento dela ter entrado.
--
-- A REGRA QUE ESTA FUNCAO EXISTE PARA GARANTIR:
--
--   UM PAGAMENTO = EXATAMENTE UMA RENOVACAO.
--
-- E o periodo so avanca AQUI. Nao ha um segundo lugar no sistema que chame a
-- regra de renovacao — nem o frontend, nem outra RPC.
--
-- ONDE A REGRA DE NEGOCIO MORA. As contas sao as MESMAS de js/comercial.js, e
-- estao reescritas aqui em SQL porque a transacao tem que ser do banco:
--
--   inicioDaRenovacao()  -> atraso <= tolerancia ? fim_vigente : data_pagamento
--   fimDoPeriodo()       -> inicio + duracao (dias corridos ou meses)
--
-- As duas implementacoes precisam concordar para sempre. test/comercial.test.mjs
-- prende o lado JS; test/comercial-drawer.test.mjs prende este lado contra o
-- texto desta funcao. Divergir aqui e o erro que so aparece trinta dias depois.
--
-- O QUE NAO MUDA DE COMPORTAMENTO, de proposito:
--
--   a proxima cobranca  -> mesma regra de hoje: nasce so se `criar_proxima` e
--                          `renovacao_automatica`, vence no fim do periodo
--                          novo, com o valor novo e a categoria da cobranca
--                          que acabou de ser paga.
--   cobranca repetida   -> continua sendo ignorada em silencio, como hoje. E o
--                          UNICO ponto em que uma falha nao derruba a
--                          transacao, e a razao esta no bloco 4.
--
-- ESTA MIGRATION NAO MUDA NENHUMA LINHA DE DADO. Ela so cria uma funcao. O
-- frontend so passa a usa-la num commit posterior — ate la, `registrarPagamento`
-- continua no caminho antigo e nada no sistema chama esta funcao.
--
-- 100% re-executavel.
-- Desfazer: db/comercial_pagamento_transacional_desfazer.sql
-- Conferencia: db/conferencia/95_pagamento_transacional.sql
-- Para colar no SQL Editor, use db/comercial_pagamento_transacional_LIMPO.sql
-- ===========================================================================


-- ===========================================================================
-- 1) A ACAO `renovada` NA AUDITORIA
-- ---------------------------------------------------------------------------
-- Ja estava no CHECK da Migration A. Este bloco existe para o caso de a A ter
-- sido aplicada numa versao anterior — o drop/add e re-executavel e alinha as
-- duas migrations sem depender da ordem em que foram coladas.
-- ===========================================================================
alter table public.comercial_assinatura_auditoria drop constraint if exists comercial_assinatura_auditoria_acao_check;
alter table public.comercial_assinatura_auditoria add  constraint comercial_assinatura_auditoria_acao_check
  check (acao in ('renovacao_programada', 'renovacao_cancelada', 'renovada'));


-- ===========================================================================
-- 2) RPC — REGISTRAR O PAGAMENTO E RENOVAR
-- ---------------------------------------------------------------------------
-- SEM `assinatura` NO PARAMETRO. Ela sai de `financeiro_lancamentos.assinatura_id`,
-- que e o vinculo que o banco ja tem. O frontend antigo passava a assinatura
-- inteira, e isso significava confiar na versao que a tela carregou — que pode
-- estar velha, e cujo `fim_periodo` e justamente o que decide o periodo novo.
--
-- SEM `nutri_id`. Dono e organizacao_do_auth(); autor e auth.uid().
-- ===========================================================================
create or replace function public.comercial_registrar_pagamento(
  p_lancamento_id   uuid,
  p_pago_em         date,
  p_valor_pago      numeric,
  p_forma_pagamento text    default null,
  p_criar_proxima   boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org        uuid;
  v_lanc       public.financeiro_lancamentos%rowtype;
  v_ass        public.comercial_assinaturas%rowtype;
  v_plano      public.comercial_planos%rowtype;
  v_prox       public.financeiro_lancamentos%rowtype;

  -- O que ENTRA no periodo novo.
  v_plano_id   uuid;
  v_valor      numeric(12,2);
  v_duracao    integer := 30;
  v_unidade    text    := 'dia';
  v_tolerancia integer := 5;

  v_atraso     integer;
  v_inicio     date;
  v_fim        date;

  -- Retrato de ANTES, para a auditoria. Capturado em variaveis porque o
  -- `update` abaixo sobrescreve v_ass, e comparar depois seria comparar a
  -- linha nova com ela mesma.
  v_de_plano   uuid;
  v_de_valor   numeric(12,2);
  v_de_inicio  date;
  v_de_fim     date;
  v_consumiu   boolean := false;
  v_nome       text;
  v_plano_nm   text;
begin
  -- ── 1) sessao ──────────────────────────────────────────────
  if auth.uid() is null then
    raise exception 'sem sessao' using errcode = '42501';
  end if;

  v_org := public.organizacao_do_auth();
  if v_org is null then
    raise exception 'sem organizacao' using errcode = '42501';
  end if;

  if not public.tem_permissao('comercial.editar') then
    raise exception 'sem permissao comercial.editar' using errcode = '42501';
  end if;

  -- ── 2) o lancamento ────────────────────────────────────────
  select * into v_lanc from public.financeiro_lancamentos where id = p_lancamento_id;
  if not found then
    raise exception 'cobranca nao encontrada' using errcode = 'P0002';
  end if;

  if v_lanc.assinatura_id is null then
    raise exception 'lancamento nao e cobranca de assinatura' using errcode = '23514';
  end if;

  -- A TRAVA CONTRA A DUPLA RENOVACAO, e ela e do banco.
  --
  -- Duas abas, dois cliques rapidos ou um retry de rede chegariam aqui duas
  -- vezes. A segunda nao encontra a cobranca pendente e sai sem renovar nada —
  -- por isso "um pagamento = uma renovacao" nao depende de o frontend se
  -- comportar. Devolve estruturado em vez de erro: a tela esta velha, nao
  -- quebrada.
  if v_lanc.status is distinct from 'pendente' then
    return jsonb_build_object('pagou', false, 'motivo', 'nao_pendente');
  end if;

  -- ── 3) a assinatura, pelo vinculo do proprio lancamento ────
  select * into v_ass from public.comercial_assinaturas where id = v_lanc.assinatura_id;
  if not found then
    raise exception 'assinatura nao encontrada' using errcode = 'P0002';
  end if;
  if v_ass.nutri_id is distinct from v_org then
    raise exception 'cobranca fora da organizacao' using errcode = '42501';
  end if;

  -- ── 4) TETO TEMPORARIO ─────────────────────────────────────
  -- A mesma trava da Migration A, pelo mesmo motivo: SECURITY DEFINER passa
  -- por cima da RLS, e enquanto as duas tabelas estiverem em auth.uid() esta
  -- funcao nao pode conceder a Recepcao o que a RLS ainda nega.
  if v_ass.nutri_id is distinct from auth.uid() then
    raise exception 'TETO TEMPORARIO — REMOVER NA SUBETAPA QUE MIGRAR COMERCIAL_ASSINATURAS + FINANCEIRO_LANCAMENTOS. Enquanto elas estiverem em auth.uid(), esta RPC nao concede mais do que a RLS de hoje.'
      using errcode = '42501';
  end if;

  -- ── 5) o pagamento ─────────────────────────────────────────
  if p_pago_em is null then
    raise exception 'informe a data do pagamento' using errcode = '23514';
  end if;
  if p_valor_pago is null or p_valor_pago <= 0 then
    raise exception 'informe quanto foi recebido' using errcode = '23514';
  end if;
  -- Receber MENOS que o cobrado nao e quitacao. Pagamento parcial esta
  -- modelado (`valor_pago`) e nao implementado — a mesma regra que
  -- validarPagamento() aplica na tela, agora tambem no banco, onde duas abas
  -- nao passam por cima.
  if v_lanc.valor is not null and p_valor_pago < v_lanc.valor then
    raise exception 'valor menor que a cobranca; pagamento parcial nao esta disponivel' using errcode = '23514';
  end if;

  update public.financeiro_lancamentos
     set status          = 'pago',
         pago_em         = p_pago_em,
         valor_pago      = p_valor_pago,
         forma_pagamento = coalesce(p_forma_pagamento, forma_pagamento)
   where id = v_lanc.id
     and status = 'pendente'
  returning * into v_lanc;

  if not found then
    return jsonb_build_object('pagou', false, 'motivo', 'nao_pendente');
  end if;

  -- ── 6) o que ENTRA no periodo novo ─────────────────────────
  -- Com renovacao programada, entra o plano e o valor programados. Sem ela,
  -- entram os vigentes — e o resultado tem que ser identico ao do fluxo
  -- antigo, que e o principal teste de regressao desta migration.
  v_de_plano  := v_ass.plano_id;
  v_de_valor  := v_ass.valor_contratado;
  v_de_inicio := v_ass.inicio_periodo;
  v_de_fim    := v_ass.fim_periodo;

  if v_ass.proximo_plano_id is not null then
    v_plano_id := v_ass.proximo_plano_id;
    v_valor    := coalesce(v_ass.proximo_valor_contratado, v_ass.valor_contratado);
    v_consumiu := true;
  else
    v_plano_id := v_ass.plano_id;
    v_valor    := v_ass.valor_contratado;
  end if;

  -- A DURACAO E A TOLERANCIA SAO DO PLANO QUE ENTRA, nunca do que sai. E ele
  -- que rege o periodo novo: um cliente que sai de Trimestral para Mensal
  -- ganha 30 dias, e o atraso dele e julgado pela regra do Mensal.
  --
  -- Plano inativo continua valendo aqui: "inativo" quer dizer "nao oferecer
  -- mais", nao "desfazer o que foi combinado".
  if v_plano_id is not null then
    select * into v_plano from public.comercial_planos where id = v_plano_id;
    if found then
      v_duracao    := coalesce(v_plano.duracao_valor, 30);
      v_unidade    := coalesce(v_plano.duracao_unidade, 'dia');
      v_tolerancia := coalesce(v_plano.tolerancia_dias, 5);
    end if;
  end if;
  -- Sem plano nenhum, vale o PLANO_PADRAO de js/comercial.js: 30 dias, dia, 5.

  -- ── 7) o periodo novo ──────────────────────────────────────
  -- Copia fiel de inicioDaRenovacao(): dentro da tolerancia, o periodo novo
  -- continua do termino anterior — pagar adiantado nunca encurta o que ja foi
  -- comprado. Passando dela, comeca na data do pagamento: quem sumiu por um
  -- mes nao recebe um mes retroativo que nao usou.
  v_atraso := p_pago_em - v_ass.fim_periodo;
  if v_atraso <= v_tolerancia then
    v_inicio := v_ass.fim_periodo;
  else
    v_inicio := p_pago_em;
  end if;

  -- fimDoPeriodo(). `+ interval 'N months'` no Postgres preserva o fim do mes
  -- igual ao somarMeses() do JS: 31/01 + 1 mes = 28/02, nao 03/03.
  if v_unidade = 'mes' then
    v_fim := (v_inicio + (v_duracao || ' months')::interval)::date;
  else
    v_fim := v_inicio + v_duracao;
  end if;

  -- ── 8) a assinatura anda, e a intencao e CONSUMIDA ─────────
  -- As cinco colunas voltam a NULL no mesmo update que aplica a troca. Nenhuma
  -- intencao pode sobreviver ao pagamento que a realizou — se sobrevivesse,
  -- ela trocaria o plano de novo na renovacao seguinte.
  update public.comercial_assinaturas
     set plano_id                 = v_plano_id,
         valor_contratado         = v_valor,
         inicio_periodo           = v_inicio,
         fim_periodo              = v_fim,
         status                   = 'ativa',
         proximo_plano_id         = null,
         proximo_valor_contratado = null,
         renovacao_definida_em    = null,
         renovacao_definida_por   = null,
         renovacao_origem_id      = null
   where id = v_ass.id
  returning * into v_ass;

  -- ── 9) auditoria: UM evento, com o diff contando o que mudou ──
  -- Uma linha por fato. `plano_alterado` seria um segundo evento para o mesmo
  -- acontecimento, e o `antes`/`depois` ja permite ver se o plano mudou.
  insert into public.comercial_assinatura_auditoria
    (nutri_id, assinatura_id, acao, usuario_id, antes, depois)
  values
    (v_ass.nutri_id, v_ass.id, 'renovada', auth.uid(),
     jsonb_build_object('plano_id', v_de_plano,
                        'valor_contratado', v_de_valor,
                        'inicio_periodo', v_de_inicio,
                        'fim_periodo', v_de_fim),
     jsonb_build_object('plano_id', v_ass.plano_id,
                        'valor_contratado', v_ass.valor_contratado,
                        'inicio_periodo', v_ass.inicio_periodo,
                        'fim_periodo', v_ass.fim_periodo,
                        'renovacao_consumida', v_consumiu,
                        'lancamento_id', v_lanc.id));

  -- ── 10) a proxima cobranca ─────────────────────────────────
  -- MESMA REGRA DE HOJE, sem invencao: so nasce com `criar_proxima` e
  -- `renovacao_automatica`, vence no fim do periodo novo, com o valor novo e a
  -- categoria da cobranca que acabou de ser paga.
  --
  -- O BLOCO COM EXCEPTION E O UNICO PONTO EM QUE UMA FALHA NAO DERRUBA TUDO, e
  -- e deliberado: `uq_comercial_cobranca_periodo` disparar aqui significa que a
  -- cobranca daquele periodo JA EXISTE — o resultado desejado ja esta no banco.
  -- Derrubar a transacao por isso desfaria um pagamento legitimo por causa de
  -- uma cobranca que nao precisava ser criada. O `registrarPagamento` antigo
  -- engolia exatamente este erro, pela mesma razao.
  --
  -- O bloco cria um savepoint implicito: so o insert volta atras, nunca os
  -- passos 5 a 9.
  if p_criar_proxima and v_ass.renovacao_automatica and v_ass.valor_contratado is not null then
    select p.nome  into v_nome     from public.pacientes p        where p.id = v_ass.paciente_id;
    select pl.nome into v_plano_nm from public.comercial_planos pl where pl.id = v_ass.plano_id;
    begin
      insert into public.financeiro_lancamentos
        (nutri_id, tipo, status, data, vencimento, competencia, descricao, valor,
         categoria_id, paciente_id, assinatura_id)
      values
        (v_ass.nutri_id, 'receita', 'pendente', v_ass.fim_periodo, v_ass.fim_periodo,
         date_trunc('month', v_ass.fim_periodo)::date,
         btrim(coalesce(v_plano_nm, 'Mensalidade') || ' — ' || coalesce(v_nome, '')),
         v_ass.valor_contratado, v_lanc.categoria_id, v_ass.paciente_id, v_ass.id)
      returning * into v_prox;
    exception when unique_violation then
      v_prox := null;
    end;
  end if;

  -- ── 11) o estado confirmado pelo banco ─────────────────────
  -- Os mesmos tres campos que o `registrarPagamento` antigo devolvia, para a
  -- troca no frontend nao mexer em quem consome.
  return jsonb_build_object(
    'pagou',      true,
    'lancamento', to_jsonb(v_lanc),
    'assinatura', to_jsonb(v_ass),
    'proxima',    case when v_prox.id is null then null else to_jsonb(v_prox) end,
    'renovacao_consumida', v_consumiu
  );
end;
$fn$;


-- ===========================================================================
-- 3) ACL
-- ---------------------------------------------------------------------------
-- Mesma convencao da Migration A: nasce fechada para anon.
-- ===========================================================================
revoke all on function public.comercial_registrar_pagamento(uuid, date, numeric, text, boolean) from public, anon;
grant execute on function public.comercial_registrar_pagamento(uuid, date, numeric, text, boolean) to authenticated;


-- ===========================================================================
-- Conferencia rapida. A completa e db/conferencia/95_pagamento_transacional.sql
-- Esperado: 1 funcao, definer, anon sem execute, e NENHUM dado alterado —
-- esta migration nao escreve em tabela nenhuma.
-- ===========================================================================
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'comercial_registrar_pagamento')   as funcao,
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'comercial_registrar_pagamento')   as definer,
  (select has_function_privilege('anon', p.oid, 'execute')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'comercial_registrar_pagamento')   as anon_executa,
  (select count(*) from public.comercial_assinaturas)                            as assinaturas,
  (select count(*) from public.comercial_assinatura_auditoria)                    as auditoria,
  (select count(*) from public.financeiro_lancamentos where assinatura_id is not null) as cobrancas;
