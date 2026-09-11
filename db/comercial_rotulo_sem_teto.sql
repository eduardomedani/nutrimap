-- ===========================================================================
-- Evollo · COMERCIAL — O TETO TEMPORARIO SAI DE NOVO
-- ---------------------------------------------------------------------------
-- GERADO a partir de db/comercial_rotulo_da_cobranca.sql: o corpo das duas
-- funcoes e o MESMO que esta em producao, menos os dois blocos de TETO. Nenhuma
-- outra linha foi escrita a mao.
--
-- O QUE ACONTECEU
--
--   01/09/2026  Etapa 4B (554bd40, db/multiusuario_etapa4b_rpc.sql) tira o
--               TETO TEMPORARIO de comercial_criar_cobranca_do_periodo e de
--               comercial_registrar_pagamento. Quem passa a decidir o acesso e
--               organizacao + `comercial.editar`, igual a RLS.
--
--   05/09/2026  O rotulo da cobranca (290d062) reescreve as duas funcoes. O
--               texto de partida foi o da Migration C, que ainda tinha o teto —
--               e nao o da 4B. O teto voltou, em silencio. O cabecalho da
--               Migration C avisava exatamente disto.
--
--   11/09/2026  Conferencia 133: `TETO TEMPORARIO no corpo = SIM`. Desde o dia 5,
--               so o proprietario da organizacao cria cobranca ou registra
--               pagamento pela tela. Qualquer outro login recebe o TETO, que a
--               tela mostra como "Nao foi possivel concluir. Tente novamente."
--
-- O diff entre 4B e rotulo prova que a diferenca e so esta: as duas travas, a
-- funcao de categoria e as duas linhas de descricao/categoria. Este arquivo
-- tira as travas e mantem o resto do rotulo.
--
-- O QUE ESTE ARQUIVO FAZ
--
--   0. GUARDA. So segue se as duas funcoes em producao forem as do rotulo, COM
--      teto. Se alguem ja mexeu nelas, ele para antes de qualquer alteracao e
--      nao passa por cima. O editor roda tudo numa transacao so: se a guarda
--      parar, nada muda.
--   1. `create or replace` das duas funcoes, com o corpo do rotulo menos o
--      teto. Assinatura, grants e SECURITY DEFINER iguais.
--
-- O QUE ELE NAO FAZ
--
--   - nao altera dado nenhum: nem cobranca, nem assinatura, nem pagamento
--   - nao mexe em comercial_categoria_do_plano
--   - NAO MEXE EM comercial_cancelar_cobranca. Ela tem o mesmo teto desde a
--     Migration A (db/comercial_renovacao_programada.sql), e a 4B nunca a
--     reescreveu. A conferencia do fim diz se ela ainda o tem em producao
--     (coluna `outras_com_teto`). Tirar dela e decisao separada.
--
-- QUEM PASSA DEPOIS DISTO: quem tem sessao, pertence a organizacao da
-- assinatura e tem `comercial.editar`. As tres checagens continuam nos passos
-- 1 a 4 de cada funcao.
--
-- Desfazer: db/comercial_rotulo_sem_teto_desfazer.sql
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/comercial_rotulo_sem_teto_LIMPO.sql
-- ===========================================================================

-- ===========================================================================
-- 0) A GUARDA — so segue se producao for o rotulo COM teto
-- ===========================================================================
do $guarda$
declare
  v_n int;
begin
  select count(*) into v_n
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('comercial_criar_cobranca_do_periodo', 'comercial_registrar_pagamento')
     and p.prosrc like '%comercial_categoria_do_plano%'
     and p.prosrc like '%Cobranca de assinatura%'
     and (p.prosrc like '%TETO TEMPORARIO%');
  if v_n <> 2 then
    raise exception 'As duas funcoes em producao nao estao no estado esperado (rotulo COM teto): % de 2. Nada foi alterado. Rode a conferencia do fim deste arquivo e me mostre.', v_n;
  end if;
end $guarda$;

-- ===========================================================================
-- 1) AS DUAS FUNCOES — o corpo do rotulo, menos os dois blocos de TETO
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

  -- ── 5) (sem teto) ───────────────────────────────────────
  -- A trava de proprietario saiu na Etapa 4B e voltou por engano com o rotulo
  -- (db/comercial_rotulo_sem_teto.sql). Quem decide o acesso e o passo 3:
  -- organizacao + comercial.editar, igual a RLS.

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
     coalesce(nullif(btrim(coalesce(v_nome, '')), ''), 'Cobranca de assinatura'),
     p_valor, coalesce(p_categoria_id, public.comercial_categoria_do_plano(v_ass.nutri_id, v_ass.plano_id)), nullif(btrim(coalesce(p_observacoes, '')), ''),
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
-- 3) O pagamento — a proxima cobranca nasce com o mesmo rotulo
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

  -- ── 4) (sem teto) ───────────────────────────────────────
  -- A trava de proprietario saiu na Etapa 4B e voltou por engano com o rotulo
  -- (db/comercial_rotulo_sem_teto.sql). Quem decide o acesso e o passo 3:
  -- organizacao + comercial.editar, igual a RLS.

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
         coalesce(nullif(btrim(coalesce(v_nome, '')), ''), 'Cobranca de assinatura'),
         v_ass.valor_contratado, coalesce(v_lanc.categoria_id, public.comercial_categoria_do_plano(v_ass.nutri_id, v_ass.plano_id)), v_ass.paciente_id, v_ass.id)
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
-- GRANTS. `create or replace` preserva privilegios; repetidos para quem le a
-- migration nao precisar saber disso.
-- ===========================================================================
revoke all on function public.comercial_criar_cobranca_do_periodo(uuid, date, numeric, uuid, text, uuid, numeric) from public, anon;
revoke all on function public.comercial_registrar_pagamento(uuid, date, numeric, text, boolean)                    from public, anon;

grant execute on function public.comercial_criar_cobranca_do_periodo(uuid, date, numeric, uuid, text, uuid, numeric) to authenticated;
grant execute on function public.comercial_registrar_pagamento(uuid, date, numeric, text, boolean)                    to authenticated;


-- ===========================================================================
-- CONFERENCIA. Esperado: funcoes 2 · com_teto 0 · com_organizacao 2 ·
-- com_permissao 2 · com_categoria 2 · com_rotulo 2 · definer 2
-- ===========================================================================
select
  count(*)                                                         as funcoes,
  count(*) filter (where p.prosrc like '%TETO TEMPORARIO%')        as com_teto,
  count(*) filter (where p.prosrc like '%fora da organizacao%')    as com_organizacao,
  count(*) filter (where p.prosrc like '%comercial.editar%')       as com_permissao,
  count(*) filter (where p.prosrc like '%comercial_categoria_do_plano%') as com_categoria,
  count(*) filter (where p.prosrc like '%Cobranca de assinatura%') as com_rotulo,
  count(*) filter (where p.prosecdef)                              as definer,
  (select coalesce(string_agg(o.proname, ', ' order by o.proname), 'nenhuma')
     from pg_proc o
     join pg_namespace ons on ons.oid = o.pronamespace
    where ons.nspname = 'public'
      and o.prosrc like '%TETO TEMPORARIO%'
      and o.proname not in ('comercial_criar_cobranca_do_periodo', 'comercial_registrar_pagamento')
  )                                                                as outras_com_teto
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname = 'public'
   and p.proname in ('comercial_criar_cobranca_do_periodo', 'comercial_registrar_pagamento');
