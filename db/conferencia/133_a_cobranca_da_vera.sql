-- ===========================================================================
-- COMERCIAL — A COBRANCA DA VERA: O QUE A TELA PEDIU E O QUE O BANCO RESPONDEU
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. Nao chama a RPC, nao chama
-- `comercial_categoria_do_plano` (ela CRIA categoria quando nao acha) — so
-- olha o que existe.
--
-- POR QUE ESTE SCRIPT EXISTE. Em 11/09/2026, na assinatura da Vera Lucia
-- Guarise de Oliveira (periodo 05/08 -> 04/09, ja pago em 06/08), foram duas
-- tentativas:
--
--   1. "criar uma cobranca de 06/09 ate 06/10" -> "Ja existe uma cobranca
--      ativa para este vencimento"
--   2. vencimento 06/10                        -> "Nao foi possivel concluir.
--      Tente novamente."
--
-- O QUE O CODIGO JA DIZ:
--
--   . O FORMULARIO NAO ESCOLHE PERIODO. "Cobranca do periodo" tem vencimento,
--     valor e a renovacao futura — o periodo e LEITURA, e a RPC grava sempre o
--     periodo VIGENTE da assinatura. Qualquer vencimento que se digite, a
--     cobranca seria de 05/08 -> 04/09, que ja tem a paga de 06/08. Por isso a
--     tentativa 1 bateu no indice (conferencia 132).
--
--   . A TENTATIVA 2 NAO FOI O INDICE. O indice produz "duplicate key", que a
--     tela traduz como "Ja existe...". "Nao foi possivel concluir" e o que
--     sobra quando o erro NAO casa com nenhum padrao conhecido
--     (js/comercial-drawer.js:53-62). Mudar so o vencimento para 06/10 daria
--     de novo "Ja existe...". Entao algo mais mudou, ou o erro veio antes do
--     insert. Candidatos, todos lidos aqui:
--       - a funcao em vigor ter o TETO TEMPORARIO (a versao de
--         db/comercial_rotulo_da_cobranca.sql ainda tem) e quem clicou nao ser
--         o proprietario;
--       - duas versoes da funcao convivendo (chamada ambigua);
--       - "plano inativo" escolhido em "Plano a partir da proxima renovacao";
--       - "sem permissao comercial.editar";
--       - falha dentro de `comercial_categoria_do_plano`.
--
--   . 06/09 -> 06/10 NAO E UM PERIODO QUE ESTA ASSINATURA TENHA. O periodo
--     seguinte so nasce quando um pagamento e registrado, e a regra do plano
--     decide onde ele comeca (secao RENOVACAO).
--
-- COMO LER:
--   ASSINATURA  o estado de hoje e o plano.
--   FORMULARIO  que periodo a tela cobraria, e o que o banco responderia.
--   RPC         a funcao que esta de fato em vigor.
--   CATEGORIA   se a categoria do plano ja existe.
--   PLANOS      os inativos da organizacao.
--   VESTIGIO    se alguma tentativa deixou linha no banco desde 01/09.
--   RENOVACAO   que periodo nasce pagando em cada data.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/133_a_cobranca_da_vera_LIMPO.sql
-- ===========================================================================

drop table if exists conf133;
create temp table conf133 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_org   uuid;
  v_dono  uuid;
  v_seq   int := 0;
  v_n     int;
  v_src   text;
  v_args  text;
  v_ini   date;
  v_fim   date;
  a       record;
  r       record;
begin
  select o.id, o.proprietario_user_id into v_org, v_dono
    from public.organizacoes o
    join public.admins ad on ad.user_id = o.proprietario_user_id;

  select s.id, s.nutri_id, s.paciente_id, s.status, s.plano_id,
         s.inicio_periodo, s.fim_periodo, s.renovacao_automatica,
         s.proximo_plano_id, s.proximo_valor_contratado, s.valor_contratado,
         p.nome::text as cliente, pl.nome::text as plano, pl.ativo as plano_ativo,
         coalesce(pl.duracao_valor, 30) as dur,
         coalesce(pl.duracao_unidade, 'dia') as uni,
         coalesce(pl.tolerancia_dias, 5) as tol
    into a
    from public.comercial_assinaturas s
    join public.pacientes p on p.id = s.paciente_id
    left join public.comercial_planos pl on pl.id = s.plano_id
   where s.id = '15c87ed7-d79e-4722-8345-9a071afeed24';

  if a.id is null then
    insert into conf133 values (0, 'ASSINATURA', 'Vera', 'NAO ENCONTRADA', 'a assinatura mudou de id?');
    return;
  end if;

  -- ═══════════ ASSINATURA ═══════════
  v_seq := v_seq + 1;
  insert into conf133 values (v_seq, 'ASSINATURA', a.cliente,
    a.status || ' | periodo ' || a.inicio_periodo || ' a ' || a.fim_periodo
    || ' | ' || coalesce(a.plano, '(sem plano)')
    || ' (' || a.dur || ' ' || a.uni || ', tolerancia ' || a.tol || ' dias)'
    || ' | R$ ' || coalesce(to_char(a.valor_contratado, 'FM999G990D00'), '—')
    || ' | renovacao ' || case when a.renovacao_automatica then 'ligada' else 'DESLIGADA' end,
    case when a.plano_ativo is false then 'o PLANO DELA ESTA INATIVO' else '' end
    || case when a.proximo_plano_id is not null then ' | ha renovacao programada' else '' end
    || case when a.fim_periodo < current_date
            then ' | vencida ha ' || (current_date - a.fim_periodo) || ' dias' else '' end);

  -- ═══════════ FORMULARIO ═══════════
  v_seq := v_seq + 1;
  insert into conf133 values (v_seq, 'FORMULARIO', 'periodo que a cobranca cobriria',
    a.inicio_periodo || ' a ' || a.fim_periodo,
    'SEMPRE o vigente, qualquer vencimento. 06/09 a 06/10 nao e alcancavel por esta tela');

  select count(*) into v_n
    from public.financeiro_lancamentos f
   where f.assinatura_id = a.id and f.periodo_fim = a.fim_periodo and f.status <> 'cancelado';
  v_seq := v_seq + 1;
  insert into conf133 values (v_seq, 'FORMULARIO', 'com vencimento 2026-10-06',
    v_n || ' cobranca(s) viva(s) ja ocupando o periodo',
    case when v_n > 0
         then 'o banco responderia duplicate key -> a tela diria "Ja existe...", NAO "Nao foi possivel concluir"'
         else 'o indice deixaria passar' end);

  -- ═══════════ RPC ═══════════
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'comercial_criar_cobranca_do_periodo';
  select string_agg(pg_get_function_identity_arguments(p.oid), '  //  ')
    into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'comercial_criar_cobranca_do_periodo';
  v_seq := v_seq + 1;
  insert into conf133 values (v_seq, 'RPC', 'versoes de comercial_criar_cobranca_do_periodo',
    v_n || ': ' || coalesce(v_args, '—'),
    case when v_n = 1 then 'uma so — sem ambiguidade'
         when v_n = 0 then 'NAO EXISTE'
         else 'MAIS DE UMA — a chamada pode falhar por ambiguidade' end);

  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'comercial_criar_cobranca_do_periodo'
   limit 1;
  v_seq := v_seq + 1;
  insert into conf133 values (v_seq, 'RPC', 'TETO TEMPORARIO no corpo',
    case when v_src ~ 'TETO TEMPORARIO' then 'SIM' else 'nao' end,
    case when v_src ~ 'TETO TEMPORARIO'
         then 'so o proprietario cria cobranca. Qualquer outro login recebe o TETO -> "Nao foi possivel concluir"'
         else 'qualquer login com comercial.editar passa' end);

  v_seq := v_seq + 1;
  insert into conf133 values (v_seq, 'RPC', 'categoria pelo plano no corpo',
    case when v_src ~ 'comercial_categoria_do_plano' then 'SIM' else 'nao' end,
    case when v_src ~ 'comercial_categoria_do_plano'
         then 'a funcao pode CRIAR categoria no meio do insert — ver CATEGORIA'
         else '' end);

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'comercial_categoria_do_plano';
  v_seq := v_seq + 1;
  insert into conf133 values (v_seq, 'RPC', 'comercial_categoria_do_plano existe',
    v_n::text,
    case when v_n = 0 and v_src ~ 'comercial_categoria_do_plano'
         then 'A RPC CHAMA UMA FUNCAO QUE NAO EXISTE -> erro -> "Nao foi possivel concluir"'
         else '' end);

  v_seq := v_seq + 1;
  insert into conf133 values (v_seq, 'RPC', 'proprietario da organizacao',
    coalesce(v_dono::text, '—'),
    'se o login que tentou for outro e houver TETO, a causa e essa');

  -- ═══════════ CATEGORIA ═══════════
  select count(*) into v_n
    from public.financeiro_categorias c
   where c.nutri_id = a.nutri_id and c.tipo = 'receita'
     and lower(trim(c.nome)) = lower(trim(coalesce(a.plano, '')));
  v_seq := v_seq + 1;
  insert into conf133 values (v_seq, 'CATEGORIA', coalesce(a.plano, '(sem plano)'),
    v_n || ' categoria(s) de receita com esse nome',
    case when v_n = 1 then 'a funcao so a le — nao cria nada'
         when v_n = 0 then 'a funcao tentaria CRIAR — se falhar ali, e o "Nao foi possivel"'
         else 'MAIS DE UMA — conferir' end);

  -- ═══════════ PLANOS ═══════════
  for r in
    select pl.nome::text as nome, pl.ativo
      from public.comercial_planos pl
     where pl.nutri_id = a.nutri_id
     order by pl.ativo desc, pl.nome
  loop
    v_seq := v_seq + 1;
    insert into conf133 values (v_seq, 'PLANOS', r.nome,
      case when r.ativo then 'ativo' else 'INATIVO' end,
      case when not r.ativo
           then 'se escolhido em "Plano a partir da proxima renovacao", a RPC recusa com "plano inativo" -> "Nao foi possivel"'
           else '' end);
  end loop;

  -- ═══════════ VESTIGIO ═══════════
  select count(*) into v_n
    from public.financeiro_lancamentos f
   where f.paciente_id = a.paciente_id and f.criado_em >= '2026-09-01';
  v_seq := v_seq + 1;
  insert into conf133 values (v_seq, 'VESTIGIO', 'lancamentos da Vera criados desde 01/09',
    v_n::text,
    case when v_n = 0 then 'nenhuma tentativa gravou nada — a RPC e uma transacao so'
         else 'HA LINHA NOVA — ver abaixo' end);

  for r in
    select f.id, f.status, f.vencimento, f.periodo_inicio, f.periodo_fim, f.assinatura_id, f.criado_em
      from public.financeiro_lancamentos f
     where f.paciente_id = a.paciente_id and f.criado_em >= '2026-09-01'
     order by f.criado_em
  loop
    v_seq := v_seq + 1;
    insert into conf133 values (v_seq, 'VESTIGIO', r.criado_em::text,
      r.id || ' | ' || r.status || ' | venc ' || coalesce(r.vencimento::text, '—')
      || ' | periodo ' || coalesce(r.periodo_inicio::text, '—') || ' a ' || coalesce(r.periodo_fim::text, '—'),
      case when r.assinatura_id is null then 'SEM assinatura' else '' end);
  end loop;

  select count(*) into v_n
    from public.comercial_assinatura_auditoria au
   where au.assinatura_id = a.id and au.criado_em >= '2026-09-01';
  v_seq := v_seq + 1;
  insert into conf133 values (v_seq, 'VESTIGIO', 'trilha da assinatura desde 01/09', v_n::text, '');

  -- ═══════════ RENOVACAO ═══════════
  -- A regra do pagamento (comercial_registrar_pagamento): ate `tolerancia`
  -- dias depois do fim, o periodo novo continua do fim; passando disso,
  -- comeca na data do pagamento.
  for r in
    select d::date as pago_em
      from (values (date '2026-09-06'), (date '2026-09-09'), (date '2026-09-10'), (current_date)) as t(d)
  loop
    if r.pago_em - a.fim_periodo <= a.tol then v_ini := a.fim_periodo; else v_ini := r.pago_em; end if;
    if a.uni = 'mes' then v_fim := (v_ini + (a.dur || ' months')::interval)::date;
    else v_fim := v_ini + a.dur; end if;
    v_seq := v_seq + 1;
    insert into conf133 values (v_seq, 'RENOVACAO', 'pagando em ' || r.pago_em,
      'periodo novo ' || v_ini || ' a ' || v_fim,
      case when r.pago_em - a.fim_periodo <= a.tol
           then (r.pago_em - a.fim_periodo) || ' dia(s) apos o fim: dentro da tolerancia, continua de ' || a.fim_periodo
           else (r.pago_em - a.fim_periodo) || ' dias apos o fim: passou da tolerancia, comeca no pagamento' end);
  end loop;
end $$;

select ordem, secao, item, valor, resultado from conf133 order by ordem;
