-- ===========================================================================
-- Evollo · BONIFICACAO PELA TELA — tornar e desfazer
-- ---------------------------------------------------------------------------
-- Requer db/comercial_bonificar_assinatura.sql (dele vem a acao 'bonificada'
-- no CHECK da auditoria). 100% re-executavel.
--
-- POR QUE ISTO EXISTE. Ate agora virar cortesia era um script por pessoa
-- (db/comercial_bonificar_assinatura.sql). Funciona uma vez; nao funciona como
-- rotina — ninguem abre o SQL Editor para dar cortesia a um aluno.
--
-- CLIENTE NOVO JA DAVA PELA TELA: basta criar o plano "Bonificacao" em
-- Comercial > Planos e escolher esse plano na nova assinatura. O que faltava
-- era converter uma assinatura QUE JA EXISTE, porque o formulario de edicao
-- nao deixa trocar plano nem periodo — de proposito, ja que o periodo tem uma
-- porta so (js/comercial-formularios.js, cabecalho de edicaoAssinaturaVazia).
--
-- Estas duas RPCs sao essa porta, estreita e com trilha.
--
-- ===========================================================================
-- AS DUAS ANDAM JUNTAS, E NAO E ENFEITE
-- ---------------------------------------------------------------------------
-- Sem `comercial_desfazer_bonificacao`, o botao seria so de ida: quem clicasse
-- por engano nao teria como voltar pela tela — trocar o plano de volta e
-- exatamente o que o formulario de edicao nao faz. Um botao irreversivel numa
-- ficha de cliente e uma armadilha, nao uma funcionalidade.
--
-- O desfazer le o `antes` da trilha, que vai gravado como JSON estruturado
-- justamente para isso. Remontar plano, valor e periodo de uma frase erraria
-- no primeiro plano cujo nome tivesse uma barra.
--
-- ===========================================================================
-- O QUE ELAS NAO FAZEM
-- ---------------------------------------------------------------------------
--   NAO CRIAM NEM APAGAM COBRANCA. Cortesia nao gera cobranca porque
--   `renovacao_automatica` fica desligada; cobranca que ja exista continua
--   onde esta. Apagar cobranca e decisao de quem olha o Financeiro, nao efeito
--   colateral de trocar um plano.
--
--   NAO MEXEM EM `data_inicio_original`. Virar cortesia nao faz a pessoa
--   cliente nova, e "cliente desde" nao pode mentir.
--
--   NAO APAGAM O PLANO "Bonificacao" no desfazer. Ele pode estar em uso por
--   outra pessoa.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/comercial_bonificacao_rpc_LIMPO.sql
-- ===========================================================================


-- ===========================================================================
-- 1) Tornar bonificacao
-- ===========================================================================
create or replace function public.comercial_tornar_bonificacao(
  p_assinatura uuid,
  p_meses      integer default 12
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org   uuid;
  v_ass   public.comercial_assinaturas;
  v_plano uuid;
  v_antes jsonb;
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

  if p_meses is null or p_meses < 1 or p_meses > 120 then
    raise exception 'meses fora da faixa (1 a 120)';
  end if;

  -- `for update`: entre ler o estado anterior e grava-lo na trilha nao pode
  -- caber outra escrita, ou a trilha guardaria um "antes" que nunca existiu.
  select * into v_ass from public.comercial_assinaturas
   where id = p_assinatura and nutri_id = v_org
   for update;

  if v_ass.id is null then
    raise exception 'assinatura nao encontrada';
  end if;

  if v_ass.status = 'cancelada' then
    raise exception 'assinatura cancelada nao vira cortesia — reative antes';
  end if;

  -- ── o plano, encontrado antes de criado ────────────────────
  -- Dois planos "Bonificacao" rachariam a contagem de cortesias em duas sem
  -- ninguem perceber.
  select pl.id into v_plano
    from public.comercial_planos pl
   where pl.nutri_id = v_org and lower(pl.nome) = 'bonificacao'
   limit 1;

  if v_plano is null then
    insert into public.comercial_planos
      (nutri_id, nome, descricao, duracao_valor, duracao_unidade,
       preco_padrao, tolerancia_dias, ativo, ordem)
    values
      (v_org, 'Bonificacao', 'Cortesia — o cliente usa a academia e nao paga.',
       p_meses, 'mes', 0, 0, true, 99)
    returning id into v_plano;
  end if;

  -- Ja e cortesia: nao regrava a trilha nem estica o periodo de graca. Devolve
  -- o estado como esta, para a tela nao precisar tratar isso como erro.
  if v_ass.plano_id = v_plano then
    return jsonb_build_object('bonificou', false, 'ja_era', true,
                              'assinatura', to_jsonb(v_ass));
  end if;

  v_antes := jsonb_build_object(
    'plano_id',             v_ass.plano_id,
    'plano_nome',           (select pl.nome from public.comercial_planos pl where pl.id = v_ass.plano_id),
    'valor_contratado',     v_ass.valor_contratado,
    'inicio_periodo',       v_ass.inicio_periodo,
    'fim_periodo',          v_ass.fim_periodo,
    'status',               v_ass.status,
    'renovacao_automatica', v_ass.renovacao_automatica);

  -- O periodo recomeca HOJE. Continuar do termino anterior entregaria a
  -- cortesia ja parcialmente gasta por um atraso que nao foi de ninguem.
  update public.comercial_assinaturas a
     set plano_id             = v_plano,
         valor_contratado     = 0,
         inicio_periodo       = current_date,
         fim_periodo          = (current_date + (p_meses || ' months')::interval)::date,
         status               = 'ativa',
         renovacao_automatica = false,
         -- A intencao de troca de plano morre aqui: ela existia para a proxima
         -- renovacao, e nao ha proxima renovacao numa cortesia.
         proximo_plano_id         = null,
         proximo_valor_contratado = null,
         renovacao_definida_em    = null,
         renovacao_definida_por   = null,
         renovacao_origem_id      = null,
         atualizado_em        = now()
   where a.id = v_ass.id
  returning * into v_ass;

  insert into public.comercial_assinatura_auditoria
    (nutri_id, assinatura_id, acao, usuario_id, antes, depois)
  values
    (v_ass.nutri_id, v_ass.id, 'bonificada', auth.uid(), v_antes,
     jsonb_build_object('plano_id', v_ass.plano_id, 'valor_contratado', 0,
                        'inicio_periodo', v_ass.inicio_periodo,
                        'fim_periodo', v_ass.fim_periodo,
                        'meses', p_meses));

  return jsonb_build_object('bonificou', true, 'ja_era', false,
                            'assinatura', to_jsonb(v_ass));
end;
$fn$;


-- ===========================================================================
-- 2) Desfazer
-- ===========================================================================
create or replace function public.comercial_desfazer_bonificacao(
  p_assinatura uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org   uuid;
  v_ass   public.comercial_assinaturas;
  v_antes jsonb;
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

  select * into v_ass from public.comercial_assinaturas
   where id = p_assinatura and nutri_id = v_org
   for update;

  if v_ass.id is null then
    raise exception 'assinatura nao encontrada';
  end if;

  -- A ULTIMA bonificacao, e nao qualquer uma: se a pessoa foi bonificada,
  -- desfeita e bonificada de novo, o que se desfaz e a ultima.
  select au.antes into v_antes
    from public.comercial_assinatura_auditoria au
   where au.assinatura_id = v_ass.id and au.acao = 'bonificada'
   order by au.criado_em desc
   limit 1;

  if v_antes is null then
    raise exception 'esta assinatura nao tem bonificacao registrada para desfazer';
  end if;

  -- O PERIODO VOLTA COMO ESTAVA, inclusive vencido. Empurrar para a frente
  -- seria dar de presente um mes que ninguem decidiu dar.
  update public.comercial_assinaturas a
     set plano_id             = nullif(v_antes ->> 'plano_id', '')::uuid,
         valor_contratado     = nullif(v_antes ->> 'valor_contratado', '')::numeric,
         inicio_periodo       = (v_antes ->> 'inicio_periodo')::date,
         fim_periodo          = (v_antes ->> 'fim_periodo')::date,
         status               = coalesce(nullif(v_antes ->> 'status', ''), 'ativa'),
         renovacao_automatica = coalesce((v_antes ->> 'renovacao_automatica')::boolean, false),
         atualizado_em        = now()
   where a.id = v_ass.id
  returning * into v_ass;

  insert into public.comercial_assinatura_auditoria
    (nutri_id, assinatura_id, acao, usuario_id, antes, depois)
  values
    (v_ass.nutri_id, v_ass.id, 'bonificacao_desfeita', auth.uid(),
     jsonb_build_object('plano', 'Bonificacao', 'valor_contratado', 0),
     v_antes);

  return jsonb_build_object('desfez', true, 'assinatura', to_jsonb(v_ass));
end;
$fn$;


-- ===========================================================================
-- GRANTS. A anon-key nao tem o que fazer aqui: as duas escrevem contrato.
-- ===========================================================================
revoke all on function public.comercial_tornar_bonificacao(uuid, integer)   from public, anon;
revoke all on function public.comercial_desfazer_bonificacao(uuid)          from public, anon;

grant execute on function public.comercial_tornar_bonificacao(uuid, integer) to authenticated;
grant execute on function public.comercial_desfazer_bonificacao(uuid)        to authenticated;


-- ===========================================================================
-- CONFERENCIA. Esperado: rpcs = 2 · definer = true · acoes_na_trilha = true
-- ---------------------------------------------------------------------------
-- `acoes_na_trilha` confirma que o CHECK da auditoria aceita as duas acoes —
-- sem isso as RPCs estouram na hora de gravar, e so na hora de gravar.
-- ===========================================================================
select
  (select count(*) from pg_proc
    where proname in ('comercial_tornar_bonificacao', 'comercial_desfazer_bonificacao')) as rpcs,
  (select bool_and(prosecdef) from pg_proc
    where proname in ('comercial_tornar_bonificacao', 'comercial_desfazer_bonificacao')) as definer,
  (select pg_get_constraintdef(oid) like '%bonificada%'
       and pg_get_constraintdef(oid) like '%bonificacao_desfeita%'
     from pg_constraint
    where conname = 'comercial_assinatura_auditoria_acao_check')                          as acoes_na_trilha;
