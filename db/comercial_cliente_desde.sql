-- ===========================================================================
-- Evollo · COMERCIAL — "CLIENTE DESDE" GANHA ACAO PROPRIA, COM TRILHA
-- ---------------------------------------------------------------------------
-- 100% re-executavel. Desfazer: db/comercial_cliente_desde_desfazer.sql
-- Conferencia (com teste funcional que se desfaz sozinho):
--   db/conferencia/137_cliente_desde.sql
--
-- O QUE E. `comercial_assinaturas.data_inicio_original` responde "cliente
-- desde": dado CADASTRAL/HISTORICO. Nenhuma funcao do banco a le para calcular
-- nada — nem periodo, nem cobranca, nem pagamento, nem competencia, nem bonus
-- (levantamento de 11/09/2026). O unico vinculo e o CHECK
-- `inicio_periodo >= data_inicio_original`.
--
-- O QUE ESTAVA ERRADO. Ela era um campo do "Editar assinatura", gravado por
-- update direto do PostgREST: sem confirmacao e sem registro de quem mudou.
--
-- O QUE ESTE ARQUIVO FAZ
--
--   0. GUARDA: o CHECK de `acao` da trilha tem de ser o esperado (as cinco
--      acoes de hoje). Se for outro, para antes de alterar qualquer coisa.
--   1. O CHECK aprende a acao `inicio_contrato_alterado`.
--   2. comercial_alterar_cliente_desde(assinatura, data) — a UNICA porta:
--        . sessao, organizacao e `comercial.editar` (a mesma regra de editar
--          a assinatura)
--        . a data nao pode passar do inicio do periodo atual (o CHECK)
--        . mesma data: nao grava nada, devolve `alterou: false`
--        . grava a trilha ANTES do update: quem (usuario_id = auth.uid()),
--          quando (criado_em), antes e depois
--        . o update muda SO `data_inicio_original`. Nao toca em
--          inicio_periodo, fim_periodo, plano, valor contratado, nem em
--          `financeiro_lancamentos` (cobrancas, pagamentos, competencias,
--          vencimentos). `atualizado_em` anda pelo gatilho de sempre
--          (trg_comercial_assinaturas_touch).
--   3. TRAVA NO BANCO: um gatilho recusa mudar `data_inicio_original` por
--      qualquer outro caminho. Sem ela, o update direto continuaria valido pela
--      RLS e a trilha seria opcional. A funcao se autoriza com uma variavel de
--      transacao (`comercial.cliente_desde_pela_rpc`); pelo PostgREST a tela
--      nao consegue liga-la, porque so o schema `public` e exposto. Um
--      administrador no SQL Editor consegue, se um dia precisar corrigir em lote.
--      O INSERT (nova assinatura) nao passa pelo gatilho: ele e so de UPDATE.
--
-- NAO ALTERA DADO NENHUM.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/comercial_cliente_desde_LIMPO.sql
-- ===========================================================================


-- ===========================================================================
-- 0) A GUARDA
-- ===========================================================================
do $guarda$
declare
  v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.comercial_assinatura_auditoria'::regclass
     and c.conname  = 'comercial_assinatura_auditoria_acao_check';

  if v_def is null then
    raise exception 'O CHECK comercial_assinatura_auditoria_acao_check nao existe. Nada foi alterado.';
  end if;

  if v_def like '%inicio_contrato_alterado%' then
    raise notice 'O CHECK ja conhece inicio_contrato_alterado — re-execucao, seguindo.';
  elsif not (v_def like '%''renovacao_programada''%'
         and v_def like '%''renovacao_cancelada''%'
         and v_def like '%''renovada''%'
         and v_def like '%''bonificada''%'
         and v_def like '%''bonificacao_desfeita''%') then
    raise exception 'O CHECK de acao da trilha nao e o esperado: %. Nada foi alterado.', v_def;
  end if;

  if exists (select 1 from public.comercial_assinatura_auditoria
              where acao not in ('renovacao_programada', 'renovacao_cancelada', 'renovada',
                                 'bonificada', 'bonificacao_desfeita', 'inicio_contrato_alterado')) then
    raise exception 'Ha acao gravada na trilha fora da lista conhecida. Nada foi alterado.';
  end if;
end $guarda$;


-- ===========================================================================
-- 1) A TRILHA APRENDE A ACAO
-- ===========================================================================
alter table public.comercial_assinatura_auditoria drop constraint if exists comercial_assinatura_auditoria_acao_check;
alter table public.comercial_assinatura_auditoria add  constraint comercial_assinatura_auditoria_acao_check
  check (acao in ('renovacao_programada', 'renovacao_cancelada', 'renovada',
                  'bonificada', 'bonificacao_desfeita', 'inicio_contrato_alterado'));


-- ===========================================================================
-- 2) A FUNCAO — a unica porta para "cliente desde"
-- ===========================================================================
create or replace function public.comercial_alterar_cliente_desde(
  p_assinatura_id uuid,
  p_data          date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org   uuid;
  v_ass   public.comercial_assinaturas%rowtype;
  v_antes date;
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

  if p_data is null then
    raise exception 'informe a data de cliente desde' using errcode = '23514';
  end if;

  -- `for update`: entre ler o "antes" e grava-lo na trilha nao cabe outra
  -- escrita, ou a trilha guardaria um antes que nunca existiu.
  select * into v_ass from public.comercial_assinaturas where id = p_assinatura_id for update;
  if not found then
    raise exception 'assinatura nao encontrada' using errcode = 'P0002';
  end if;
  if v_ass.nutri_id is distinct from v_org then
    raise exception 'assinatura fora da organizacao' using errcode = '42501';
  end if;

  -- O mesmo limite do CHECK da tabela, com frase em vez de erro cru.
  if p_data > v_ass.inicio_periodo then
    raise exception 'cliente desde nao pode ser depois do inicio do periodo atual (%)',
      to_char(v_ass.inicio_periodo, 'DD/MM/YYYY') using errcode = '23514';
  end if;

  v_antes := v_ass.data_inicio_original;

  -- Mesma data: nada a registrar. A trilha so conta o que mudou.
  if p_data = v_antes then
    return jsonb_build_object('alterou', false, 'assinatura', to_jsonb(v_ass));
  end if;

  -- A TRILHA ANTES DO UPDATE: quem, quando, de que para que.
  insert into public.comercial_assinatura_auditoria
    (nutri_id, assinatura_id, acao, usuario_id, antes, depois)
  values
    (v_ass.nutri_id, v_ass.id, 'inicio_contrato_alterado', auth.uid(),
     jsonb_build_object('data_inicio_original', v_antes),
     jsonb_build_object('data_inicio_original', p_data));

  -- SO a coluna. Periodo, plano, valor e o financeiro ficam onde estao.
  perform set_config('comercial.cliente_desde_pela_rpc', 'sim', true);
  update public.comercial_assinaturas
     set data_inicio_original = p_data
   where id = v_ass.id
  returning * into v_ass;
  perform set_config('comercial.cliente_desde_pela_rpc', '', true);

  return jsonb_build_object(
    'alterou',    true,
    'antes',      v_antes,
    'depois',     p_data,
    'assinatura', to_jsonb(v_ass)
  );
end;
$fn$;

revoke all on function public.comercial_alterar_cliente_desde(uuid, date) from public, anon;
grant execute on function public.comercial_alterar_cliente_desde(uuid, date) to authenticated;


-- ===========================================================================
-- 3) A TRAVA — "cliente desde" nao muda por outro caminho
-- ===========================================================================
create or replace function public.fn_comercial_cliente_desde_so_pela_rpc()
returns trigger
language plpgsql
as $trg$
begin
  if new.data_inicio_original is distinct from old.data_inicio_original
     and coalesce(current_setting('comercial.cliente_desde_pela_rpc', true), '') <> 'sim' then
    raise exception 'cliente desde so muda pela acao propria, que registra quem alterou'
      using errcode = '42501';
  end if;
  return new;
end;
$trg$;

drop trigger if exists trg_comercial_cliente_desde_so_pela_rpc on public.comercial_assinaturas;
create trigger trg_comercial_cliente_desde_so_pela_rpc
  before update of data_inicio_original on public.comercial_assinaturas
  for each row execute function public.fn_comercial_cliente_desde_so_pela_rpc();


-- ===========================================================================
-- CONFERENCIA. Esperado: funcao 1 · definer true · anon_executa false ·
-- authenticated_executa true · check_tem_acao true · gatilho 1
-- A prova de funcionamento e a conferencia 137.
-- ===========================================================================
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'comercial_alterar_cliente_desde')      as funcao,
  (select bool_and(p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'comercial_alterar_cliente_desde')      as definer,
  has_function_privilege('anon', 'public.comercial_alterar_cliente_desde(uuid, date)', 'execute')          as anon_executa,
  has_function_privilege('authenticated', 'public.comercial_alterar_cliente_desde(uuid, date)', 'execute') as authenticated_executa,
  (select pg_get_constraintdef(c.oid) like '%inicio_contrato_alterado%'
     from pg_constraint c
    where c.conrelid = 'public.comercial_assinatura_auditoria'::regclass
      and c.conname  = 'comercial_assinatura_auditoria_acao_check')                   as check_tem_acao,
  (select count(*) from pg_trigger
    where tgrelid = 'public.comercial_assinaturas'::regclass
      and tgname  = 'trg_comercial_cliente_desde_so_pela_rpc'
      and tgenabled <> 'D')                                                             as gatilho;
