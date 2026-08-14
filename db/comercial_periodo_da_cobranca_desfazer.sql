-- ===========================================================================
-- COMERCIAL — DESFAZER A MIGRATION C
-- ---------------------------------------------------------------------------
-- Para colar, use comercial_periodo_da_cobranca_desfazer_LIMPO.sql
--
-- O QUE ELE DESFAZ, e em que ordem:
--
--   1. a competencia volta ao retrato guardado  (exato, linha a linha)
--   2. o indice novo sai e o antigo volta       (reversivel, sem perda)
--   3. as duas RPCs voltam ao texto anterior    (reversivel, sem perda)
--   4. as colunas FICAM, inertes                (mesmo padrao da Migration A)
--
-- A COMPETENCIA SO VOLTA PORQUE FOI GUARDADA. Ela nao e recomputavel: para as
-- cobrancas criadas pela tela era o mes do vencimento, mas para as importadas
-- era o mes da VENDA — o CASO_PAGAMENTO_ANTECIPADO tem competencia 2026-07 com vencimento
-- 2026-09-11. Se `comercial_competencia_antes` estiver vazia, PARE: o passo 1
-- nao tem de onde restaurar, e seguir sem ele deixa o banco num terceiro estado
-- que ninguem escreveu de proposito.
--
-- POR QUE AS COLUNAS FICAM. `drop column` joga fora o backfill, e ele e a parte
-- que nao se refaz sozinha depois: o periodo das cobrancas que cobrem um ciclo
-- anterior so existe enquanto a auditoria daquela renovacao existir. Deixadas
-- de pe, elas nao custam nada — nenhuma consulta as le depois deste script — e
-- o caminho de volta continua aberto. O `drop` esta no fim, comentado.
-- ===========================================================================


-- ── 1) a competencia, do retrato ───────────────────────────────────────────
-- Confira ANTES de rodar: esta contagem tem de bater com o numero de cobrancas
-- de assinatura. Se der 0, nao siga.
select count(*) as competencias_guardadas from public.comercial_competencia_antes;

update public.financeiro_lancamentos l
   set competencia = c.competencia
  from public.comercial_competencia_antes c
 where c.lancamento_id = l.id
   and l.competencia is distinct from c.competencia;


-- ── 2) o indice ────────────────────────────────────────────────────────────

drop index if exists public.uq_comercial_cobranca_do_periodo;

create unique index if not exists uq_comercial_cobranca_periodo
  on public.financeiro_lancamentos (assinatura_id, vencimento)
  where assinatura_id is not null and status <> 'cancelado';

drop index if exists public.idx_financeiro_lancamentos_assinatura;

create index if not exists idx_financeiro_lancamentos_assinatura
  on public.financeiro_lancamentos (assinatura_id, vencimento desc)
  where assinatura_id is not null;


-- ── 3) as duas RPCs, no texto de antes ─────────────────────────────────────

create or replace function public.comercial_criar_cobranca_do_periodo(
  p_assinatura_id    uuid,
  p_vencimento       date,
  p_valor            numeric,
  p_categoria_id     uuid    default null,
  p_observacoes      text    default null,
  p_proximo_plano_id uuid    default null,
  p_proximo_valor    numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org      uuid;
  v_ass      public.comercial_assinaturas%rowtype;
  v_plano    public.comercial_planos%rowtype;
  v_lanc     public.financeiro_lancamentos%rowtype;
  v_nome     text;
  v_plano_nm text;
  v_muda     boolean;
  v_prox_id  uuid;
begin
  -- ── 1) sessao ──────────────────────────────────────────────
  if auth.uid() is null then
    raise exception 'sem sessao' using errcode = '42501';
  end if;

  -- ── 2) organizacao ─────────────────────────────────────────
  v_org := public.organizacao_do_auth();
  if v_org is null then
    raise exception 'sem organizacao' using errcode = '42501';
  end if;

  -- ── 3) permissao ───────────────────────────────────────────
  if not public.tem_permissao('comercial.editar') then
    raise exception 'sem permissao comercial.editar' using errcode = '42501';
  end if;

  -- ── 4) assinatura ──────────────────────────────────────────
  select * into v_ass from public.comercial_assinaturas where id = p_assinatura_id;
  if not found then
    raise exception 'assinatura nao encontrada' using errcode = 'P0002';
  end if;
  if v_ass.nutri_id is distinct from v_org then
    raise exception 'assinatura fora da organizacao' using errcode = '42501';
  end if;

  -- ── 5) TETO TEMPORARIO ─────────────────────────────────────
  -- REMOVER NA SUBETAPA QUE MIGRAR COMERCIAL_ASSINATURAS + FINANCEIRO_LANCAMENTOS
  --
  -- Esta funcao e SECURITY DEFINER, entao ela passa por cima da RLS. Enquanto
  -- `comercial_assinaturas` e `financeiro_lancamentos` estiverem em
  -- `nutri_id = auth.uid()`, ela NAO pode conceder a Recepcao o que a RLS
  -- ainda nega — seria a Etapa 4 entrando pela porta dos fundos, semanas antes
  -- de a fundacao estar pronta. Hoje so o proprietario passa: exatamente quem
  -- ja passa pela RLS. A funcao nao concede um bit a mais do que existe.
  if v_ass.nutri_id is distinct from auth.uid() then
    raise exception 'TETO TEMPORARIO — REMOVER NA SUBETAPA QUE MIGRAR COMERCIAL_ASSINATURAS + FINANCEIRO_LANCAMENTOS. Enquanto elas estiverem em auth.uid(), esta RPC nao concede mais do que a RLS de hoje.'
      using errcode = '42501';
  end if;

  -- ── 6) plano futuro, se informado ──────────────────────────
  if p_proximo_plano_id is not null then
    select * into v_plano from public.comercial_planos where id = p_proximo_plano_id;
    if not found then
      raise exception 'plano nao encontrado' using errcode = 'P0002';
    end if;
    if v_plano.nutri_id is distinct from v_org then
      raise exception 'plano fora da organizacao' using errcode = '42501';
    end if;
    if not v_plano.ativo then
      raise exception 'plano inativo' using errcode = '23514';
    end if;
  end if;

  -- ── 7) valor e vencimento ──────────────────────────────────
  if p_vencimento is null then
    raise exception 'informe o vencimento' using errcode = '23514';
  end if;
  if p_valor is null or p_valor < 0 then
    raise exception 'valor invalido' using errcode = '23514';
  end if;
  if p_proximo_valor is not null and p_proximo_valor < 0 then
    raise exception 'valor futuro invalido' using errcode = '23514';
  end if;

  -- ── 8) a cobranca ──────────────────────────────────────────
  select p.nome into v_nome from public.pacientes p where p.id = v_ass.paciente_id;
  select pl.nome into v_plano_nm from public.comercial_planos pl where pl.id = v_ass.plano_id;

  insert into public.financeiro_lancamentos
    (nutri_id, tipo, status, data, vencimento, competencia, descricao, valor,
     categoria_id, observacoes, paciente_id, assinatura_id)
  values
    (v_ass.nutri_id, 'receita', 'pendente', p_vencimento, p_vencimento,
     date_trunc('month', p_vencimento)::date,
     btrim(coalesce(v_plano_nm, 'Mensalidade') || ' — ' || coalesce(v_nome, '')),
     p_valor, p_categoria_id, nullif(btrim(coalesce(p_observacoes, '')), ''),
     v_ass.paciente_id, v_ass.id)
  returning * into v_lanc;

  -- ── 9) a intencao, SO se mudar de verdade ──────────────────
  v_prox_id := coalesce(p_proximo_plano_id, v_ass.plano_id);
  v_muda :=
       (v_prox_id      is distinct from v_ass.plano_id)
    or (p_proximo_valor is not null and p_proximo_valor is distinct from v_ass.valor_contratado);

  if v_muda then
    -- ── 11) auditoria ANTES do update ────────────────────────
    -- A ordem importa para a leitura: `antes` sao o plano e o valor VIGENTES,
    -- e o update abaixo nao mexe em nenhum dos dois — mas escrever a trilha
    -- depois obrigaria quem le este codigo a provar isso de cabeca.
    insert into public.comercial_assinatura_auditoria
      (nutri_id, assinatura_id, acao, usuario_id, antes, depois)
    values
      (v_ass.nutri_id, v_ass.id, 'renovacao_programada', auth.uid(),
       jsonb_build_object('plano_id', v_ass.plano_id,
                          'valor_contratado', v_ass.valor_contratado),
       jsonb_build_object('proximo_plano_id', v_prox_id,
                          'proximo_valor_contratado', p_proximo_valor,
                          'renovacao_origem_id', v_lanc.id));

    update public.comercial_assinaturas
       set proximo_plano_id         = v_prox_id,
           proximo_valor_contratado = p_proximo_valor,
           renovacao_definida_em    = now(),
           renovacao_definida_por   = auth.uid(),
           renovacao_origem_id      = v_lanc.id
     where id = v_ass.id
    returning * into v_ass;
  end if;

  -- ── 12) o estado CONFIRMADO pelo banco ─────────────────────
  -- Devolve o que ficou gravado, nao o que se pediu: a tela redesenha a partir
  -- da verdade e nao da esperanca.
  return jsonb_build_object(
    'cobranca',   to_jsonb(v_lanc),
    'assinatura', to_jsonb(v_ass),
    'programou',  v_muda
  );
end;
$fn$;


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


revoke all on function public.comercial_criar_cobranca_do_periodo(uuid, date, numeric, uuid, text, uuid, numeric) from public, anon;
revoke all on function public.comercial_registrar_pagamento(uuid, date, numeric, text, boolean)                    from public, anon;

grant execute on function public.comercial_criar_cobranca_do_periodo(uuid, date, numeric, uuid, text, uuid, numeric) to authenticated;
grant execute on function public.comercial_registrar_pagamento(uuid, date, numeric, text, boolean)                    to authenticated;


-- ── 4) as colunas e o retrato, so se voce quiser mesmo ─────────────────────
-- Rode DEPOIS de conferir que o passo 1 restaurou tudo. A tabela de retrato e
-- a ultima a sair: enquanto ela existir, da para refazer o passo 1.
--
-- alter table public.financeiro_lancamentos drop column if exists periodo_inicio;
-- alter table public.financeiro_lancamentos drop column if exists periodo_fim;
-- drop table if exists public.comercial_competencia_antes;


select
  (select count(*) from pg_indexes
    where schemaname = 'public' and indexname = 'uq_comercial_cobranca_periodo')    as indice_antigo_de_volta,
  (select count(*) from pg_indexes
    where schemaname = 'public' and indexname = 'uq_comercial_cobranca_do_periodo') as indice_novo_saiu,
  (select count(*) from public.financeiro_lancamentos l
     join public.comercial_competencia_antes c on c.lancamento_id = l.id
    where l.competencia is distinct from c.competencia)                             as competencias_fora_do_retrato;
