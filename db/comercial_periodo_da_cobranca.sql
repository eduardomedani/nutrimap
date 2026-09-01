-- ===========================================================================
-- COMERCIAL — MIGRATION C: O PERIODO DA COBRANCA
-- ---------------------------------------------------------------------------
-- Roda DEPOIS de db/conferencia/101, 102 e 103, nesta ordem. Para colar, use
-- comercial_periodo_da_cobranca_LIMPO.sql
--
-- ATENCAO — AS DUAS RPCs DAQUI FORAM SUBSTITUIDAS EM 01/09/2026. A versao em
-- vigor esta em db/multiusuario_etapa4b_rpc.sql, que e este mesmo texto MENOS
-- os blocos "TETO TEMPORARIO". A Etapa 4B migrou `comercial_assinaturas` e
-- `financeiro_lancamentos` para a organizacao, que era a condicao escrita no
-- proprio teto para ele sair.
--
-- NAO APLIQUE ESTE ARQUIVO SOZINHO depois da 4B: o `create or replace`
-- reporia o teto, e a Recepcao voltaria a nao conseguir registrar pagamento —
-- em silencio, porque a tela continuaria listando tudo. Se precisar reaplicar
-- a Migration C, rode db/multiusuario_etapa4b_rpc.sql logo em seguida.
--
-- Ele fica aqui na integra porque e dele que db/multiusuario_etapa4b_rpc.sql e
-- extraido, e e dele que o desfazer da 4B tira o texto com o teto.
--
-- O QUE ESTA MIGRATION CONSERTA
--
-- Em 13/08/2026 a cobranca criada a mao passou a vencer em `criacao + 30 dias`,
-- e nao mais no fim do periodo. A mudanca estava certa — a cobranca da CASO_MENSAL_ATRASADO,
-- emitida em 13/08 para um periodo encerrado em 16/07, nascia "Vencida ha 28
-- dias". Mas duas coisas dependiam em silencio da amarracao antiga:
--
--   1. A UNICIDADE. `uq_comercial_cobranca_periodo` era (assinatura_id,
--      vencimento). Ela se chamava "periodo" porque vencimento ERA o fim do
--      periodo. Deixou de ser, e passou a errar dos dois lados: deixa passar
--      duas cobrancas do mesmo periodo com vencimentos diferentes, e REJEITA
--      duas cobrancas de periodos diferentes criadas no mesmo dia — as duas
--      nascem com `hoje + 30`. Virou uma regra falsa, e por isso sai.
--
--   2. A COMPETENCIA. Saia de `date_trunc('month', vencimento)`, e com a regra
--      nova o mes viraria funcao do prazo de pagamento.
--
-- A IDENTIDADE REAL DE UMA COBRANCA e o periodo que ela cobre, e nenhuma coluna
-- representava isso. `data`, `competencia` e `vencimento` eram as tres datas
-- que existiam; `competencia` e mensal e nao distingue dois atendimentos de um
-- plano Diaria no mesmo mes. Dai as duas colunas novas.
--
-- O BACKFILL NAO COPIA O VENCIMENTO. A primeira versao desta migration fazia
-- isso, apoiada em "ate 12/08 todo caminho gravava vencimento = fim do
-- periodo". A conferencia 101 barrou e a 102 mostrou por que: das 43 cobrancas,
-- 29 vieram da planilha com o vencimento na data do PAGAMENTO, que e o INICIO
-- do periodo. Copiar dali erraria o periodo por um ciclo inteiro.
--
-- A classificacao das 43, por evidencia local a cada linha, deu:
--
--   9  vencimento = fim_periodo vigente            -> periodo vigente
--   5  vencimento = fim do periodo ANTERIOR        -> periodo da auditoria
--   27 vencimento = inicio_periodo                 -> periodo vigente
--   2  pago_em    = inicio_periodo                 -> periodo vigente
--
-- Tres das quatro classes chegam no mesmo lugar. Por isso o backfill sao dois
-- updates: o periodo VIGENTE para todas, e depois a correcao das que cobrem um
-- periodo que a renovacao deixou para tras — o unico caso em que o periodo nao
-- esta mais na assinatura, e sim no `antes` da auditoria.
--
-- A COMPETENCIA PASSA A SAIR DO INICIO DO PERIODO. Decidido em 14/08/2026, com
-- a conferencia 103 na mesa:
--
--   . numa mensalidade 09/08->08/09, 23 dos 30 dias caem em AGOSTO;
--   . em 28 das 31 cobrancas pagas, o mes do inicio e o mes em que o dinheiro
--     entrou. Pelo fim do periodo, 3 de 31.
--
-- 14 das 43 mudam de mes. NAO E EFEITO COLATERAL: e a decisao, e por isso a
-- migration GUARDA a competencia atual de todas antes de mexer. O valor antigo
-- nao e recomputavel — o CASO_PAGAMENTO_ANTECIPADO tem competencia julho e vencimento 11/09,
-- porque a importacao gravou a data da venda. Sem a copia, nao haveria volta.
--
-- O QUE ESTA MIGRATION NAO FAZ
--
--   - nao altera pagamento nenhum ja registrado
--   - NAO ALTERA O VENCIMENTO DE NADA. Nem das linhas antigas, nem da cobranca
--     automatica pos-pagamento, que continua vencendo no fim do periodo novo
--     (decisao de 14/08/2026 — um Trimestral nao vira cobranca de 30 dias)
--
-- AS QUATRO DATAS, agora que nao ha mais regra unica:
--
--   fim do periodo vigente               -> assinatura.fim_periodo
--   cobranca MANUAL de periodo corrido   -> criacao + 30 dias
--   primeira cobranca de nova assinatura -> fim do periodo, piso de hoje + 30
--   cobranca AUTOMATICA pos-pagamento    -> fim do periodo novo
--
-- Cada uma tem um evento de negocio diferente atras dela. Isso e proposital.
--
-- Desfazer: db/comercial_periodo_da_cobranca_desfazer.sql
-- ===========================================================================


-- ===========================================================================
-- 1) AS DUAS COLUNAS
-- ---------------------------------------------------------------------------
-- Nulas e sem default, no mesmo padrao das cinco da Migration A: uma despesa
-- ou um lancamento avulso nao tem periodo, e forcar um seria inventar dado.
-- ===========================================================================

alter table public.financeiro_lancamentos
  add column if not exists periodo_inicio date,
  add column if not exists periodo_fim    date;

comment on column public.financeiro_lancamentos.periodo_inicio is
  'Inicio do periodo que esta cobranca cobre. Origem da competencia. Nula fora do Comercial.';
comment on column public.financeiro_lancamentos.periodo_fim is
  'Fim do periodo coberto. E a identidade da cobranca, junto com assinatura_id.';


-- ===========================================================================
-- 2) A COMPETENCIA DE HOJE, GUARDADA ANTES DE QUALQUER COISA
-- ---------------------------------------------------------------------------
-- Sem esta tabela nao ha desfazer. A competencia antiga NAO e recomputavel a
-- partir de nenhuma coluna: para as cobrancas da tela ela e o mes do
-- vencimento, mas para as importadas e o mes da VENDA — o CASO_PAGAMENTO_ANTECIPADO tem
-- competencia 2026-07 com vencimento 2026-09-11.
--
-- Sem policy nenhuma e com RLS ligada, ela fica inacessivel pelo PostgREST.
-- Quem le e o script de desfazer, rodando no SQL Editor.
-- ===========================================================================

create table if not exists public.comercial_competencia_antes (
  lancamento_id uuid primary key
    references public.financeiro_lancamentos(id) on delete cascade,
  competencia   date        not null,
  guardado_em   timestamptz not null default now()
);

alter table public.comercial_competencia_antes enable row level security;
revoke all on table public.comercial_competencia_antes from public, anon, authenticated;

comment on table public.comercial_competencia_antes is
  'Retrato da competencia das cobrancas de assinatura antes da Migration C. Existe para o desfazer.';

insert into public.comercial_competencia_antes (lancamento_id, competencia)
select l.id, l.competencia
  from public.financeiro_lancamentos l
 where l.assinatura_id is not null
   and l.competencia is not null
on conflict (lancamento_id) do nothing;


-- ===========================================================================
-- 3) O PERIODO DE CADA COBRANCA
-- ---------------------------------------------------------------------------
-- 3a) o padrao: o periodo VIGENTE da assinatura. Cobre 38 das 43, porque tres
--     das quatro classes da conferencia 102 chegam no mesmo lugar.
-- ===========================================================================

update public.financeiro_lancamentos l
   set periodo_inicio = a.inicio_periodo,
       periodo_fim    = a.fim_periodo
  from public.comercial_assinaturas a
 where a.id = l.assinatura_id
   and l.periodo_fim is null;

-- ---------------------------------------------------------------------------
-- 3b) a correcao: as que cobrem um periodo que a renovacao deixou para tras.
--
-- Quando o pagamento renova, a assinatura anda e o periodo antigo some dela. A
-- cobranca daquele periodo continua existindo, e o unico lugar onde o periodo
-- sobreviveu e o `antes` da auditoria. O vinculo e o vencimento: aquelas
-- cobrancas venciam no fim do proprio periodo.
--
-- `l.vencimento <> l.periodo_fim` preserva a ordem das classes: se o vencimento
-- e o fim do periodo VIGENTE, 3a ja acertou e esta linha nao se aplica.
-- ---------------------------------------------------------------------------

update public.financeiro_lancamentos l
   set periodo_inicio = ant.inicio,
       periodo_fim    = ant.fim
  from (
    select distinct on (aud.assinatura_id, (aud.antes ->> 'fim_periodo'))
           aud.assinatura_id,
           (aud.antes ->> 'inicio_periodo')::date as inicio,
           (aud.antes ->> 'fim_periodo')::date    as fim
      from public.comercial_assinatura_auditoria aud
     where aud.acao = 'renovada'
       and (aud.antes ->> 'inicio_periodo') is not null
       and (aud.antes ->> 'fim_periodo')    is not null
     order by aud.assinatura_id, (aud.antes ->> 'fim_periodo'), aud.criado_em
  ) ant
 where ant.assinatura_id = l.assinatura_id
   and l.vencimento      = ant.fim
   and l.vencimento     <> l.periodo_fim;


-- ===========================================================================
-- 4) A COMPETENCIA, AGORA DO INICIO DO PERIODO
-- ---------------------------------------------------------------------------
-- So mexe onde diverge, e so em cobranca de assinatura. Despesa e lancamento
-- avulso nao tem periodo e nao entram.
-- ===========================================================================

update public.financeiro_lancamentos l
   set competencia = date_trunc('month', l.periodo_inicio)::date
 where l.assinatura_id  is not null
   and l.periodo_inicio is not null
   and l.competencia is distinct from date_trunc('month', l.periodo_inicio)::date;


-- ===========================================================================
-- 5) A UNICIDADE, AGORA POR PERIODO
-- ---------------------------------------------------------------------------
-- `cancelado` continua de fora: um lancamento cancelado e justamente o que se
-- refaz. `periodo_fim is not null` mantem despesas e avulsos fora — sem isso
-- eles participariam da unicidade pelo nulo.
--
-- A conferencia 102 mediu antes: COLISAO deu 0, e as tres cobrancas repetidas
-- (CASO_CANCELAMENTO, CASO_RENOVACAO_PROGRAMADA, CASO_TROCA_DE_PLANO) tem no maximo uma viva cada. O indice nasce
-- sem forcar nada. Se mesmo assim este `create` falhar, NAO force: rode a 102
-- de novo, que ela lista quais colidem.
-- ===========================================================================

drop index if exists public.uq_comercial_cobranca_periodo;

create unique index if not exists uq_comercial_cobranca_do_periodo
  on public.financeiro_lancamentos (assinatura_id, periodo_fim)
  where assinatura_id is not null and periodo_fim is not null and status <> 'cancelado';

-- O indice de leitura passa a ordenar pelo periodo, que e o que a tela mostra
-- no historico. O antigo, por vencimento, some junto com a regra que o criou.
drop index if exists public.idx_financeiro_lancamentos_assinatura;

create index if not exists idx_financeiro_lancamentos_assinatura
  on public.financeiro_lancamentos (assinatura_id, periodo_fim desc)
  where assinatura_id is not null;


-- ===========================================================================
-- 6) A RPC DA COBRANCA MANUAL
-- ---------------------------------------------------------------------------
-- Corpo identico ao da Migration A, com tres mudancas: grava periodo_inicio e
-- periodo_fim, e tira a competencia do vencimento. Sem parametro novo — o
-- periodo sai de `v_ass`, dentro da funcao.
-- ===========================================================================

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
  -- TRES DATAS QUE NAO SE MISTURAM, e por isso estao separadas aqui:
  --
  --   vencimento  = p_vencimento. QUANDO o dinheiro entra. A tela manda
  --                 `criacao + 30 dias`, porque esta cobranca cobre um periodo
  --                 que JA CORREU e nao pode nascer vencida.
  --   periodo_*   = o que a cobranca cobre. Sai de `v_ass`, NUNCA de parametro:
  --                 o cliente nao tem como mentir sobre o periodo. E o par que
  --                 da identidade a linha — `uq_comercial_cobranca_do_periodo`.
  --   competencia = mes em que o periodo COMECA. DE QUE MES E essa receita.
  --                 Antes saia do vencimento; nao sai mais nem do fim do
  --                 periodo, que foi a primeira proposta e caiu na conferencia
  --                 103: numa mensalidade 09/08->08/09, 23 dos 30 dias sao de
  --                 agosto, e em 28 das 31 cobrancas pagas o mes do inicio e o
  --                 mes em que o dinheiro entrou.
  --
  -- `data` continua acompanhando o vencimento: e o dia do movimento previsto.
  -- Ela pode divergir da competencia sem problema — o CHECK que amarrava as
  -- duas foi removido em db/financeiro_lancamentos.sql, pelo caso da despesa
  -- de agosto que vence em setembro.
  select p.nome into v_nome from public.pacientes p where p.id = v_ass.paciente_id;
  select pl.nome into v_plano_nm from public.comercial_planos pl where pl.id = v_ass.plano_id;

  insert into public.financeiro_lancamentos
    (nutri_id, tipo, status, data, vencimento, competencia,
     periodo_inicio, periodo_fim, descricao, valor,
     categoria_id, observacoes, paciente_id, assinatura_id)
  values
    (v_ass.nutri_id, 'receita', 'pendente', p_vencimento, p_vencimento,
     date_trunc('month', v_ass.inicio_periodo)::date,
     v_ass.inicio_periodo, v_ass.fim_periodo,
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


-- ===========================================================================
-- 7) A RPC DO PAGAMENTO
-- ---------------------------------------------------------------------------
-- O `vencimento` da cobranca automatica continua em `v_ass.fim_periodo` — nao
-- se mexe nele. O que muda: as duas colunas novas, e a competencia, que passa
-- a sair do inicio do periodo como em todo o resto.
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
  -- e deliberado: `uq_comercial_cobranca_do_periodo` disparar aqui significa que a
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
        (nutri_id, tipo, status, data, vencimento, competencia,
         periodo_inicio, periodo_fim, descricao, valor,
         categoria_id, paciente_id, assinatura_id)
      values
        (v_ass.nutri_id, 'receita', 'pendente', v_ass.fim_periodo, v_ass.fim_periodo,
         date_trunc('month', v_ass.inicio_periodo)::date,
         v_ass.inicio_periodo, v_ass.fim_periodo,
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
-- 8) GRANTS
-- ---------------------------------------------------------------------------
-- As assinaturas nao mudaram, entao os grants antigos continuam valendo. Sao
-- repetidos aqui de proposito: `create or replace` preserva privilegios, mas
-- quem le a migration nao deveria precisar saber disso para dormir tranquilo.
-- ===========================================================================

revoke all on function public.comercial_criar_cobranca_do_periodo(uuid, date, numeric, uuid, text, uuid, numeric) from public, anon;
revoke all on function public.comercial_registrar_pagamento(uuid, date, numeric, text, boolean)                    from public, anon;

grant execute on function public.comercial_criar_cobranca_do_periodo(uuid, date, numeric, uuid, text, uuid, numeric) to authenticated;
grant execute on function public.comercial_registrar_pagamento(uuid, date, numeric, text, boolean)                    to authenticated;


-- ===========================================================================
-- CONFERENCIA RAPIDA
-- ---------------------------------------------------------------------------
-- A completa e db/conferencia/101_periodo_da_cobranca.sql, que agora fecha com
-- veredito. Esta so diz se a migration passou.
-- ===========================================================================

select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'financeiro_lancamentos'
      and column_name in ('periodo_inicio', 'periodo_fim'))                         as colunas,
  (select count(*) from pg_indexes
    where schemaname = 'public' and indexname = 'uq_comercial_cobranca_do_periodo') as indice_novo,
  (select count(*) from pg_indexes
    where schemaname = 'public' and indexname = 'uq_comercial_cobranca_periodo')    as indice_antigo,
  (select count(*) from public.financeiro_lancamentos
    where assinatura_id is not null and periodo_fim is null)                        as sem_periodo,
  (select count(*) from public.financeiro_lancamentos
    where assinatura_id is not null and periodo_fim is not null)                    as com_periodo,
  (select count(*) from public.comercial_competencia_antes)                         as competencias_guardadas,
  (select count(*) from public.financeiro_lancamentos l
    where l.assinatura_id is not null and l.periodo_inicio is not null
      and l.competencia is distinct from date_trunc('month', l.periodo_inicio)::date) as competencia_divergente;
