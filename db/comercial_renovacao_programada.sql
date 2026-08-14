-- ===========================================================================
-- Evollo · COMERCIAL — MIGRATION A: renovacao programada
-- ---------------------------------------------------------------------------
-- Depende de db/comercial_etapa2_planos.sql e db/organizacao_schema.sql.
--
-- ATENCAO — `comercial_criar_cobranca_do_periodo` FOI SUBSTITUIDA. A versao em
-- vigor esta em db/comercial_periodo_da_cobranca.sql (Migration C), que fez a
-- funcao gravar `periodo_inicio`/`periodo_fim` e tirar a competencia do
-- vencimento. O resto deste arquivo — as cinco colunas, a auditoria e
-- `comercial_cancelar_cobranca` — continua sendo a fonte.
--
-- Ele fica aqui na integra porque e dele que o desfazer da Migration C tira o
-- texto anterior das funcoes. Nao aplique este arquivo depois da C sem aplicar
-- a C de novo em seguida: o `create or replace` sobrescreveria a versao nova.
--
-- O PROBLEMA QUE ELA RESOLVE. "Criar cobranca do periodo" criava a cobranca
-- num clique, assumindo que o cliente seguiria no mesmo plano. Nao segue: na
-- renovacao ele pode trocar de plano, de frequencia ou de preco. Mas trocar o
-- plano da assinatura NA HORA DA COBRANCA seria pior — faria o periodo que
-- ainda esta correndo parecer pertencer ao plano novo.
--
-- A SEPARACAO QUE ESTE SCRIPT INTRODUZ:
--
--   a assinatura            -> o que esta VIGENTE agora
--   a renovacao programada  -> o que ENTRA no proximo ciclo
--
-- Nenhum dos dois escreve no outro ate o pagamento acontecer.
--
-- O QUE DELIBERADAMENTE NAO EXISTE AQUI, e por que:
--
--   tabela de renovacao   -> ela so teria valor pelo HISTORICO das decisoes, e
--                            isso e o que a auditoria guarda. Duas tabelas para
--                            a mesma pergunta e a segunda verdade que este
--                            modulo evita desde a Etapa 2.
--   campos na cobranca    -> a intencao e do CONTRATO, nao do recebivel.
--                            Remover um lancamento por erro de digitacao nao
--                            pode apagar em silencio a decisao comercial.
--   parcelas              -> FORA DE ESCOPO. "3x" e "5x" sao frequencia
--                            SEMANAL (comercial_planos.frequencia_semanal), nao
--                            parcelamento. Nao ha modelo de parcela no projeto
--                            e nao se inventa um a partir do nome do plano.
--   renovacao_aplicada,
--   plano_alterado        -> seriam um segundo evento para o mesmo fato. Uma
--                            linha por evento; o `antes`/`depois` conta o que
--                            mudou.
--
-- ESTA MIGRATION NAO TOCA `registrarPagamento`. Isso e a Migration B, e ela so
-- entra depois da conferencia desta (db/conferencia/93_renovacao_programada.sql).
--
-- JANELA ENTRE A E B: com A aplicada e B ainda nao, uma renovacao programada
-- fica GRAVADA mas nao e consumida no pagamento — quem aplica e a RPC da B.
-- Por isso as duas rodam na mesma sessao, e a conferencia cobra "renovacoes
-- programadas pendentes = 0" antes de liberar a B.
--
-- ADITIVO. Nenhuma linha existente e alterada: as cinco colunas nascem NULL
-- nas 94 assinaturas e o comportamento no primeiro segundo depois desta
-- migration e identico ao de antes dela.
--
-- 100% re-executavel.
-- Desfazer: db/comercial_renovacao_programada_desfazer.sql
-- Para colar no SQL Editor, use db/comercial_renovacao_programada_LIMPO.sql
-- ===========================================================================


-- ===========================================================================
-- 1) AS CINCO COLUNAS DA INTENCAO
-- ---------------------------------------------------------------------------
-- Todas anulaveis, e "sem renovacao programada" e o estado normal — nao o
-- excepcional. Elas so ganham conteudo quando a proxima vigencia for MESMO
-- diferente da atual.
--
-- `proximo_plano_id` com ON DELETE RESTRICT, igual a `plano_id`: nao da para
-- apagar um plano que e o futuro de alguem sem antes resolver o que acontece
-- com esse cliente.
--
-- `renovacao_origem_id` com ON DELETE SET NULL: se o lancamento sumir do
-- banco, a intencao sobrevive sem origem em vez de sumir junto. O caminho
-- normal — cancelar a cobranca — limpa as cinco de proposito, na RPC.
-- ===========================================================================
alter table public.comercial_assinaturas
  add column if not exists proximo_plano_id         uuid references public.comercial_planos(id) on delete restrict;

alter table public.comercial_assinaturas
  add column if not exists proximo_valor_contratado numeric(12,2);

alter table public.comercial_assinaturas
  add column if not exists renovacao_definida_em    timestamptz;

-- AUTOR, nao dono. `nutri_id` guarda a organizacao; esta coluna guarda a
-- pessoa que decidiu a troca. Sao perguntas diferentes e nao se resolvem na
-- mesma coluna.
alter table public.comercial_assinaturas
  add column if not exists renovacao_definida_por   uuid;

alter table public.comercial_assinaturas
  add column if not exists renovacao_origem_id      uuid references public.financeiro_lancamentos(id) on delete set null;

-- Renovacao programada SEMPRE nomeia o plano que entra, mesmo quando so o
-- preco muda. Sem isso existiria um estado "tem valor futuro e nao se sabe de
-- que plano", e o pagamento teria que adivinhar a duracao do periodo.
alter table public.comercial_assinaturas drop constraint if exists comercial_assinaturas_renovacao_check;
alter table public.comercial_assinaturas add  constraint comercial_assinaturas_renovacao_check
  check ((renovacao_definida_em is null) = (proximo_plano_id is null));

alter table public.comercial_assinaturas drop constraint if exists comercial_assinaturas_proximo_valor_check;
alter table public.comercial_assinaturas add  constraint comercial_assinaturas_proximo_valor_check
  check (proximo_valor_contratado is null or proximo_valor_contratado >= 0);

-- Indice PARCIAL: a esmagadora maioria das assinaturas nao tem renovacao
-- programada, e um indice cheio de NULL seria peso sem uso.
create index if not exists idx_comercial_assinaturas_renovacao
  on public.comercial_assinaturas (nutri_id)
  where proximo_plano_id is not null;


-- ===========================================================================
-- 2) A AUDITORIA DA ASSINATURA
-- ---------------------------------------------------------------------------
-- Mesmo formato de public.financeiro_auditoria, que ja funciona ha meses. NAO
-- reaproveitei aquela tabela: a chave dela e `lancamento_id` e o trigger dela
-- e de `financeiro_lancamentos`. Alargar o schema do dinheiro para caber
-- contrato poria em risco algo em producao para ganhar uma tabela.
--
-- `antes` e `depois` guardam SO os campos que mudaram. Gravar a linha inteira
-- encheria a tabela de ruido e esconderia a mudanca no meio dele.
--
-- E ela que responde as perguntas do historico:
--   qual plano estava vigente naquele periodo?   -> `antes` da renovacao
--   quando a troca foi DECIDIDA?                 -> renovacao_programada
--   quando ela entrou em VIGOR?                  -> renovada
-- ===========================================================================
create table if not exists public.comercial_assinatura_auditoria (
  id            uuid primary key default gen_random_uuid(),
  -- DONO: a organizacao. Mesma semantica de `nutri_id` no resto do modulo.
  nutri_id      uuid not null,
  assinatura_id uuid not null references public.comercial_assinaturas(id) on delete cascade,
  acao          text not null,
  -- AUTOR: a pessoa. auth.uid(), nunca a organizacao.
  usuario_id    uuid,
  antes         jsonb not null default '{}'::jsonb,
  depois        jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now()
);

-- Tres acoes, e so as tres que esta funcionalidade escreve. Um CHECK com valor
-- que nada grava seria promessa nao cumprida — quando a Migration B precisar
-- de outra, ela mesma amplia (o drop/add abaixo e re-executavel).
alter table public.comercial_assinatura_auditoria drop constraint if exists comercial_assinatura_auditoria_acao_check;
alter table public.comercial_assinatura_auditoria add  constraint comercial_assinatura_auditoria_acao_check
  check (acao in ('renovacao_programada', 'renovacao_cancelada', 'renovada'));

create index if not exists idx_caa_assinatura
  on public.comercial_assinatura_auditoria (assinatura_id, criado_em desc);
create index if not exists idx_caa_nutri
  on public.comercial_assinatura_auditoria (nutri_id, criado_em desc);


-- ===========================================================================
-- 3) RLS DA AUDITORIA — leitura e mais nada
-- ---------------------------------------------------------------------------
-- SO SELECT tem policy. Insert, update e delete nao tem nenhuma, de proposito:
-- quem escreve a trilha sao as funcoes SECURITY DEFINER deste arquivo. Uma
-- trilha que o proprio usuario pode editar pela anon-key nao e trilha.
--
-- O TETO TEMPORARIO tambem vale aqui. Sem ele, a Recepcao leria a auditoria de
-- assinaturas que a RLS de `comercial_assinaturas` ainda nao deixa ela ver.
-- ===========================================================================
alter table public.comercial_assinatura_auditoria enable row level security;

drop policy if exists comercial_assinatura_auditoria_select on public.comercial_assinatura_auditoria;
create policy comercial_assinatura_auditoria_select on public.comercial_assinatura_auditoria
  for select to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('comercial.visualizar')
    -- REMOVER NA SUBETAPA QUE MIGRAR COMERCIAL_ASSINATURAS + FINANCEIRO_LANCAMENTOS
    and nutri_id = auth.uid()
  );

-- REVOGA DE authenticated TAMBEM, e nao so de anon. O Supabase aplica default
-- privileges que dao ALL nas tabelas novas do schema public para anon,
-- authenticated e service_role — entao a tabela NASCE aberta, e um `grant
-- select` sozinho nao tira nada. Sem este revoke, `authenticated` fica com
-- insert, update e delete na propria trilha.
--
-- A RLS ja seguraria (nao ha policy de INSERT, e sem policy nada passa), mas
-- grant e RLS sao duas fechaduras e a trilha merece as duas: e o unico
-- registro de quem trocou o plano de quem.
revoke all    on table public.comercial_assinatura_auditoria from public, anon, authenticated;
grant  select on table public.comercial_assinatura_auditoria to authenticated;


-- ===========================================================================
-- 4) RPC — CRIAR A COBRANCA DO PERIODO E PROGRAMAR A RENOVACAO
-- ---------------------------------------------------------------------------
-- Uma transacao, tres tabelas: `financeiro_lancamentos` (a cobranca),
-- `comercial_assinaturas` (a intencao) e a auditoria. Falhando qualquer passo,
-- nada fica.
--
-- SEM `nutri_id` NO PARAMETRO. O dono sai de organizacao_do_auth(); o autor,
-- de auth.uid(). O frontend manda dado de negocio e nada mais — assim nao
-- existe caminho em que uma tela escolha o dono de um registro.
--
-- A INTENCAO SO E GRAVADA SE HOUVER MUDANCA REAL. Plano igual e valor igual
-- deixam as cinco colunas NULL, o caminho comum segue identico ao de hoje e a
-- auditoria nao ganha uma linha dizendo que nada mudou.
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


-- ===========================================================================
-- 5) RPC — CANCELAR A COBRANCA, LEVANDO A INTENCAO JUNTO
-- ---------------------------------------------------------------------------
-- Precisa ser RPC pelo mesmo motivo da outra: cancelar a cobranca que
-- PROGRAMOU uma troca tem que limpar a troca na MESMA transacao. Deixar a
-- intencao viva faria a proxima cobranca — criada por outro caminho — mudar o
-- plano do cliente sem ninguem ter pedido.
--
-- CANCELAR, NUNCA APAGAR: a cobranca e um lancamento de receita. Apagar a
-- linha sumiria com o registro de que ela existiu, e um contas-a-receber que
-- some sem rastro e o tipo de buraco que so aparece no fechamento do mes.
-- ===========================================================================
create or replace function public.comercial_cancelar_cobranca(p_lancamento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org  uuid;
  v_lanc public.financeiro_lancamentos%rowtype;
  v_ass  public.comercial_assinaturas%rowtype;
  v_limpou boolean := false;
begin
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

  select * into v_lanc from public.financeiro_lancamentos where id = p_lancamento_id;
  if not found then
    raise exception 'cobranca nao encontrada' using errcode = 'P0002';
  end if;

  -- So cobranca de assinatura. O Financeiro tem os proprios caminhos para
  -- lancamento avulso, e esta funcao nao pode virar atalho para eles.
  if v_lanc.assinatura_id is null then
    raise exception 'lancamento nao e cobranca de assinatura' using errcode = '23514';
  end if;

  select * into v_ass from public.comercial_assinaturas where id = v_lanc.assinatura_id;
  if not found then
    raise exception 'assinatura nao encontrada' using errcode = 'P0002';
  end if;
  if v_ass.nutri_id is distinct from v_org then
    raise exception 'cobranca fora da organizacao' using errcode = '42501';
  end if;

  -- REMOVER NA SUBETAPA QUE MIGRAR COMERCIAL_ASSINATURAS + FINANCEIRO_LANCAMENTOS
  if v_ass.nutri_id is distinct from auth.uid() then
    raise exception 'TETO TEMPORARIO — REMOVER NA SUBETAPA QUE MIGRAR COMERCIAL_ASSINATURAS + FINANCEIRO_LANCAMENTOS. Enquanto elas estiverem em auth.uid(), esta RPC nao concede mais do que a RLS de hoje.'
      using errcode = '42501';
  end if;

  -- A trava e do BANCO: cobranca paga nao casa aqui, e a funcao devolve
  -- `cancelou: false`. Nao da para cancelar um periodo ja recebido por dois
  -- cliques rapidos ou por duas abas.
  if v_lanc.status is distinct from 'pendente' then
    return jsonb_build_object('cancelou', false, 'motivo', 'nao_pendente');
  end if;

  update public.financeiro_lancamentos
     set status = 'cancelado'
   where id = v_lanc.id and status = 'pendente'
  returning * into v_lanc;

  if not found then
    return jsonb_build_object('cancelou', false, 'motivo', 'nao_pendente');
  end if;

  -- A intencao cai junto SE foi esta cobranca que a programou.
  if v_ass.renovacao_origem_id = v_lanc.id then
    insert into public.comercial_assinatura_auditoria
      (nutri_id, assinatura_id, acao, usuario_id, antes, depois)
    values
      (v_ass.nutri_id, v_ass.id, 'renovacao_cancelada', auth.uid(),
       jsonb_build_object('proximo_plano_id', v_ass.proximo_plano_id,
                          'proximo_valor_contratado', v_ass.proximo_valor_contratado,
                          'renovacao_origem_id', v_ass.renovacao_origem_id),
       jsonb_build_object('proximo_plano_id', null,
                          'proximo_valor_contratado', null,
                          'renovacao_origem_id', null));

    update public.comercial_assinaturas
       set proximo_plano_id         = null,
           proximo_valor_contratado = null,
           renovacao_definida_em    = null,
           renovacao_definida_por   = null,
           renovacao_origem_id      = null
     where id = v_ass.id
    returning * into v_ass;

    v_limpou := true;
  end if;

  return jsonb_build_object(
    'cancelou',   true,
    'cobranca',   to_jsonb(v_lanc),
    'assinatura', to_jsonb(v_ass),
    'limpou_renovacao', v_limpou
  );
end;
$fn$;


-- ===========================================================================
-- 6) ACL DAS FUNCOES
-- ---------------------------------------------------------------------------
-- A convencao do projeto desde o hardening de 07/08/2026: funcao nova nasce
-- fechada para anon. Estas escrevem dinheiro e contrato — anon nao tem o que
-- fazer com elas nem em teoria.
-- ===========================================================================
revoke all on function public.comercial_criar_cobranca_do_periodo(uuid, date, numeric, uuid, text, uuid, numeric) from public, anon;
revoke all on function public.comercial_cancelar_cobranca(uuid)                                                  from public, anon;

grant execute on function public.comercial_criar_cobranca_do_periodo(uuid, date, numeric, uuid, text, uuid, numeric) to authenticated;
grant execute on function public.comercial_cancelar_cobranca(uuid)                                                   to authenticated;


-- ===========================================================================
-- Conferencia rapida. A completa e db/conferencia/93_renovacao_programada.sql
-- Esperado: 5 colunas, 2 constraints, 1 tabela, 1 policy, 2 funcoes, 0 anon.
-- ===========================================================================
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'comercial_assinaturas'
      and column_name in ('proximo_plano_id', 'proximo_valor_contratado',
                          'renovacao_definida_em', 'renovacao_definida_por',
                          'renovacao_origem_id'))                            as colunas,
  (select count(*) from pg_constraint
    where conname in ('comercial_assinaturas_renovacao_check',
                      'comercial_assinaturas_proximo_valor_check'))          as constraints,
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name = 'comercial_assinatura_auditoria')                     as tabela_auditoria,
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename = 'comercial_assinatura_auditoria')                      as policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('comercial_criar_cobranca_do_periodo',
                        'comercial_cancelar_cobranca'))                      as funcoes,
  (select count(*) from public.comercial_assinaturas
    where proximo_plano_id is not null)                                      as renovacoes_programadas;
