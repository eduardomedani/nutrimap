-- ===========================================================================
-- COMERCIAL — QUEM QUEBRARIA COM O FAIL-FAST DE PLANO
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. E a consulta de bloqueio de
-- db/comercial_renovacao_sem_plano.sql, isolada para rodar sozinha.
--
-- UM COMANDO SO, de proposito: o SQL Editor do Supabase devolve apenas o
-- resultado do ULTIMO comando. A primeira versao deste arquivo tinha tres
-- selects, e as duas secoes que importavam se perderam no caminho.
--
-- A PERGUNTA: existe alguma assinatura viva cujo plano que ENTRA nao pode ser
-- resolvido? Hoje a RPC renova essas com 30 dias e tolerancia 5 inventados, em
-- silencio. Com o fail-fast, o proximo pagamento delas passa a FALHAR.
--
-- REGRA DE DECISAO, definida antes de olhar o resultado:
--
--   VEREDITO 'NINGUEM QUEBRA'  -> o fail-fast pode ser aplicado
--   VEREDITO 'NAO APLICAR'     -> cada linha listada precisa de plano ANTES,
--                                 senao o proximo pagamento dela para na tela
--
-- O plano que ENTRA e `coalesce(proximo_plano_id, plano_id)` — a mesma conta
-- da RPC. Uma assinatura com renovacao programada para um plano que sumiu
-- aparece aqui mesmo tendo `plano_id` valido, e esta certo: quem rege o
-- periodo novo e o que entra.
--
-- Assinatura CANCELADA fica de fora: ela nao renova, entao o fail-fast nunca
-- chega nela.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/105_assinaturas_sem_plano_LIMPO.sql
-- ===========================================================================

drop table if exists conf105;
create temp table conf105 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_n     int;
  v_vivas int;
  r       record;
begin
  select count(*) into v_vivas from public.comercial_assinaturas
   where status in ('ativa', 'aguardando_inicio');

  -- ═══════════ AFETADAS ═══════════
  select count(*) into v_n
    from public.comercial_assinaturas a
   where a.status in ('ativa', 'aguardando_inicio')
     and not exists (select 1 from public.comercial_planos pl
                      where pl.id = coalesce(a.proximo_plano_id, a.plano_id));

  insert into conf105 values (10, 'AFETADAS', 'assinaturas que passariam a falhar', v_n::text,
    case when v_n = 0 then 'nenhuma' else 'listadas abaixo, uma a uma' end);

  for r in
    select a.id, p.nome as cliente, a.status, a.plano_id, a.proximo_plano_id,
           a.inicio_periodo, a.fim_periodo, a.valor_contratado,
           case when a.plano_id is null and a.proximo_plano_id is null
                  then 'SEM PLANO NENHUM'
                when a.proximo_plano_id is not null
                  then 'renovacao programada aponta para plano inexistente'
                else 'plano_id aponta para linha inexistente' end as motivo
      from public.comercial_assinaturas a
      join public.pacientes p on p.id = a.paciente_id
     where a.status in ('ativa', 'aguardando_inicio')
       and not exists (select 1 from public.comercial_planos pl
                        where pl.id = coalesce(a.proximo_plano_id, a.plano_id))
     order by p.nome
  loop
    insert into conf105 values (11, 'AFETADAS', r.cliente,
      r.motivo
      || ' | ' || r.status
      || ' | periodo ' || r.inicio_periodo || ' -> ' || r.fim_periodo
      || ' | R$ ' || to_char(coalesce(r.valor_contratado, 0), 'FM999G990D00')
      || ' | plano_id ' || coalesce(r.plano_id::text, 'null')
      || ' | proximo ' || coalesce(r.proximo_plano_id::text, 'null'),
      'id ' || r.id);
  end loop;

  -- ═══════════ OS DOIS MOTIVOS, SEPARADOS ═══════════
  -- `vivas_sem_plano_id = 0` elimina so o primeiro. O segundo e outro teste.
  select count(*) into v_n from public.comercial_assinaturas
   where status in ('ativa', 'aguardando_inicio') and plano_id is null;
  insert into conf105 values (20, 'MOTIVOS', 'vivas sem plano_id', v_n::text,
    case when v_n = 0 then 'ok' else 'estas nao tem duracao de onde sair' end);

  select count(*) into v_n
    from public.comercial_assinaturas a
   where a.status in ('ativa', 'aguardando_inicio')
     and a.plano_id is not null
     and not exists (select 1 from public.comercial_planos pl where pl.id = a.plano_id);
  insert into conf105 values (21, 'MOTIVOS', 'plano_id apontando para linha inexistente', v_n::text,
    case when v_n = 0 then 'ok' else 'a FK deveria impedir — investigar' end);

  select count(*) into v_n
    from public.comercial_assinaturas a
   where a.proximo_plano_id is not null
     and not exists (select 1 from public.comercial_planos pl where pl.id = a.proximo_plano_id);
  insert into conf105 values (22, 'MOTIVOS', 'proximo_plano_id apontando para linha inexistente', v_n::text,
    case when v_n = 0 then 'ok' else 'a renovacao programada rege o periodo novo — isto quebra' end);

  -- ═══════════ A RENOVACAO PROGRAMADA QUE EXISTE ═══════════
  -- Ha uma so, e ela e a que mais importa: e o `proximo_plano_id` dela que
  -- vai reger o periodo no proximo pagamento.
  for r in
    select p.nome as cliente, a.status, a.fim_periodo,
           a.proximo_plano_id, a.proximo_valor_contratado,
           pl.nome as plano_que_entra, pl.duracao_valor, pl.duracao_unidade, pl.tolerancia_dias,
           pa.nome as plano_vigente
      from public.comercial_assinaturas a
      join public.pacientes p               on p.id = a.paciente_id
      left join public.comercial_planos pl  on pl.id = a.proximo_plano_id
      left join public.comercial_planos pa  on pa.id = a.plano_id
     where a.proximo_plano_id is not null
     order by p.nome
  loop
    insert into conf105 values (30, 'PROGRAMADA', r.cliente,
      coalesce(r.plano_vigente, '?') || ' -> ' || coalesce(r.plano_que_entra, 'PLANO NAO ENCONTRADO')
      || ' | R$ ' || to_char(coalesce(r.proximo_valor_contratado, 0), 'FM999G990D00')
      || ' | periodo termina ' || r.fim_periodo
      || ' | duracao ' || coalesce(r.duracao_valor::text, '?') || ' ' || coalesce(r.duracao_unidade, '?')
      || ' | tolerancia ' || coalesce(r.tolerancia_dias::text, '?'),
      case when r.plano_que_entra is null then 'QUEBRA com o fail-fast' else 'ok — resolve' end);
  end loop;

  -- ═══════════ CONTEXTO ═══════════
  insert into conf105 values (40, 'CONTEXTO', 'assinaturas vivas', v_vivas::text,
    'para o zero acima nao ser lido como "a consulta nao rodou"');
  select count(*) into v_n from public.comercial_planos;
  insert into conf105 values (41, 'CONTEXTO', 'planos cadastrados', v_n::text, '');
  select count(*) into v_n from public.comercial_planos where ativo;
  insert into conf105 values (42, 'CONTEXTO', 'planos ativos', v_n::text,
    'plano inativo continua regendo quem ja esta nele');

  -- ═══════════ VEREDITO ═══════════
  select count(*) into v_n
    from public.comercial_assinaturas a
   where a.status in ('ativa', 'aguardando_inicio')
     and not exists (select 1 from public.comercial_planos pl
                      where pl.id = coalesce(a.proximo_plano_id, a.plano_id));
  insert into conf105 values (999, 'VEREDITO',
    case when v_n = 0 then 'NINGUEM QUEBRA — o fail-fast pode ser aplicado'
         else 'NAO APLICAR — ' || v_n || ' assinatura(s) precisam de plano antes' end,
    '', '');
end $$;

select ordem, secao, item, valor, resultado from conf105 order by ordem, item, valor;
