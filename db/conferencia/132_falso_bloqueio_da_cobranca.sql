-- ===========================================================================
-- COMERCIAL — POR QUE "JA EXISTE UMA COBRANCA ATIVA" SEM COBRANCA ATIVA
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. Nao ha insert, update nem delete em tabela real —
-- so na tabela temporaria do proprio resultado.
--
-- POR QUE ESTE SCRIPT EXISTE. Em 11/09/2026, Nilca Rosa da Silva e Vera Lucia
-- abrem "Criar cobranca do periodo", salvam, e a tela responde "Ja existe uma
-- cobranca ativa para este vencimento" — sem nenhuma cobranca ativa visivel.
--
-- O QUE O CODIGO JA DIZ, antes de olhar os dados:
--
--   1. O AVISO NAO SABE DE QUAL INDICE VEIO. `traduzirErroCobranca`
--      (js/comercial-drawer.js:55) devolve a mesma frase para QUALQUER
--      "duplicate key". A frase fala em vencimento; o indice em vigor desde a
--      Migration C e por PERIODO.
--
--   2. O INDICE. `uq_comercial_cobranca_do_periodo` =
--      (assinatura_id, periodo_fim) where assinatura_id is not null
--      and periodo_fim is not null and status <> 'cancelado'.
--      Cancelada libera. ARQUIVADA NAO libera — o predicado nao olha
--      `arquivado_em`. Paga tambem ocupa o periodo.
--
--   3. A RPC grava periodo_inicio/periodo_fim = periodo VIGENTE da assinatura,
--      nunca de parametro. Entao o insert colide com qualquer linha viva cujo
--      periodo_fim = assinatura.fim_periodo, seja qual for o vencimento.
--
--   4. O BOTAO. O drawer so oferece "Criar cobranca do periodo" quando nao acha
--      cobranca "aberta" (js/comercial-drawer.js:400-401):
--        pendente de QUALQUER periodo
--        ou pago com vencimento = fim_periodo      <- regra de antes da C
--      Uma PAGA do periodo vigente com vencimento <> fim_periodo nao casa com
--      nenhuma das duas: a tela diz "Nenhuma cobranca em aberto" e oferece
--      criar, e o indice recusa.
--
-- A SUSPEITA PRINCIPAL, que este script confirma ou derruba: a classe INICIO
-- do backfill da Migration C (conferencia 102). Cobranca PAGA da planilha, com
-- vencimento = data do pagamento = INICIO do periodo, recebeu o periodo
-- VIGENTE. Em assinatura que nao renovou desde entao, o periodo atual ja tem
-- uma cobranca viva — paga, vencida no inicio — que o drawer nao reconhece.
--
-- AS OUTRAS SUSPEITAS, todas testadas linha a linha:
--   . cobranca ARQUIVADA do mesmo periodo (o indice nao a libera)
--   . cobranca com nutri_id fora da organizacao (o drawer filtra nutri_id e
--     nao a ve; o indice e global e a enxerga)
--   . periodo devolvido por "desfazer cortesia" para um periodo que ja tinha
--     cobranca (aparece na TRILHA)
--   . outro indice unico que dispare "duplicate key" (aparece em INDICE)
--
-- COMO LER:
--   INDICE       todo unico de financeiro_lancamentos, com a definicao REAL do
--                banco. O de periodo tem de dizer "ARQUIVADO NAO libera".
--   RPC          de onde a funcao em vigor tira o periodo.
--   BUSCA        quantos pacientes cada nome encontrou.
--   ASSINATURA   id, periodo atual, cliente desde.
--   COBRANCA     TODAS as ligadas a assinatura — pendente, paga, cancelada,
--                arquivada, de qualquer nutri_id. A coluna `resultado` diz se
--                a linha BLOQUEIA e se o drawer a enxerga.
--   DIAGNOSTICO  uma linha por assinatura: quem ocupa o periodo e por que o
--                drawer nao percebeu.
--   TRILHA       o que a assinatura registrou (renovada, bonificada...).
--   ALCANCE      quantas assinaturas ativas estao no MESMO buraco.
--   CENARIO      os cinco casos do pedido, pela regra do indice (B), pela
--                regra antiga por vencimento (A) e pelo botao do drawer atual.
--                Sao linhas sinteticas em VALUES: testam o PREDICADO, e a
--                secao INDICE prova que o predicado e esse mesmo.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/132_falso_bloqueio_da_cobranca_LIMPO.sql
-- ===========================================================================

drop table if exists conf132;
create temp table conf132 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_org    uuid;
  v_seq    int := 0;
  v_venc   date := current_date + 30;
  v_src    text;
  v_n      int;
  v_bloq   int;
  v_aberta int;
  v_quem   text;
  a        record;
  l        record;
  r        record;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins ad on ad.user_id = o.proprietario_user_id;

  -- ═══════════ INDICE ═══════════
  for r in
    select c.relname::text as nome, pg_get_indexdef(c.oid) as def
      from pg_index x
      join pg_class c on c.oid = x.indexrelid
     where x.indrelid = 'public.financeiro_lancamentos'::regclass
       and x.indisunique
     order by 1
  loop
    v_seq := v_seq + 1;
    insert into conf132 values (v_seq, 'INDICE', r.nome, r.def,
      case
        when r.nome = 'uq_comercial_cobranca_do_periodo' then
          case when r.def like '%(assinatura_id, periodo_fim)%'
                and r.def like '%status <> ''cancelado''%'
                and r.def not like '%arquivado_em%'
               then 'identidade = assinatura + periodo_fim; so CANCELADO libera; ARQUIVADO NAO libera; PAGO ocupa'
               else 'DIVERGE da Migration C — ler o predicado' end
        when r.nome = 'uq_comercial_cobranca_periodo'
          then 'O ANTIGO, por vencimento, AINDA EXISTE — ele tambem bloqueia'
        when r.def like '%assinatura_id%' or r.def like '%vencimento%'
          then 'outro unico que envolve assinatura/vencimento — ler'
        else 'nao envolve assinatura nem vencimento' end);
  end loop;

  select count(*) into v_n
    from pg_constraint
   where conrelid = 'public.financeiro_lancamentos'::regclass and contype = 'x';
  v_seq := v_seq + 1;
  insert into conf132 values (v_seq, 'INDICE', 'constraints de exclusao', v_n::text,
    case when v_n = 0 then 'nenhuma' else 'HA EXCLUSAO — ler pg_constraint' end);

  -- ═══════════ RPC ═══════════
  select p.prosrc into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'comercial_criar_cobranca_do_periodo'
   limit 1;
  v_seq := v_seq + 1;
  insert into conf132 values (v_seq, 'RPC', 'comercial_criar_cobranca_do_periodo',
    case when v_src is null then 'NAO EXISTE'
         when v_src ~ 'v_ass\.inicio_periodo,\s*v_ass\.fim_periodo'
           then 'periodo da cobranca = periodo VIGENTE da assinatura'
         else 'nao achei de onde sai o periodo — ler o corpo' end,
    case when v_src ~* 'if\s+exists' then 'a funcao pre-checa algo — ler'
         else 'nao pre-checa: quem recusa e o indice, com 23505' end);

  -- ═══════════ BUSCA ═══════════
  for r in select unnest(array['%nilca rosa%', '%vera lucia%']) as padrao loop
    select count(*) into v_n
      from public.pacientes p
     where lower(translate(p.nome,
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) like r.padrao;
    v_seq := v_seq + 1;
    insert into conf132 values (v_seq, 'BUSCA', r.padrao, v_n || ' paciente(s)',
      case when v_n = 0 then 'NAO ENCONTRADO — conferir a grafia'
           when v_n > 1 then 'MAIS DE UM — as secoes abaixo trazem todos; conferir qual e o caso'
           else '' end);
  end loop;

  -- ═══════════ POR ASSINATURA ═══════════
  for a in
    select p.nome::text as cliente, s.id, s.nutri_id, s.status,
           s.data_inicio_original, s.inicio_periodo, s.fim_periodo,
           s.renovacao_automatica, s.criado_em, pl.nome::text as plano
      from public.pacientes p
      join public.comercial_assinaturas s on s.paciente_id = p.id
      left join public.comercial_planos pl on pl.id = s.plano_id
     where lower(translate(p.nome,
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
           like any (array['%nilca rosa%', '%vera lucia%'])
     order by p.nome, s.criado_em desc
  loop
    -- ASSINATURA
    v_seq := v_seq + 1;
    insert into conf132 values (v_seq, 'ASSINATURA', a.cliente,
      a.id || ' | ' || a.status
      || ' | periodo ' || a.inicio_periodo || ' a ' || a.fim_periodo
      || ' | desde ' || coalesce(a.data_inicio_original::text, '—')
      || ' | ' || coalesce(a.plano, '(sem plano)')
      || ' | renovacao ' || case when a.renovacao_automatica then 'ligada' else 'DESLIGADA' end,
      case when a.nutri_id is distinct from v_org then 'FORA DA ORGANIZACAO'
           when a.status not in ('ativa', 'aguardando_inicio', 'pausada')
             then 'status ' || a.status || ' — nao e a assinatura que a tela abre'
           when a.fim_periodo < current_date
             then 'periodo terminou ha ' || (current_date - a.fim_periodo) || ' dias'
           else 'periodo vigente' end);

    -- COBRANCA — todas, sem filtro nenhum
    for l in
      select f.*
        from public.financeiro_lancamentos f
       where f.assinatura_id = a.id
       order by coalesce(f.periodo_fim, f.vencimento) desc nulls last, f.criado_em desc
    loop
      v_seq := v_seq + 1;
      insert into conf132 values (v_seq, 'COBRANCA', a.cliente,
        l.id || ' | ' || upper(l.status)
        || ' | venc ' || coalesce(l.vencimento::text, '—')
        || ' | periodo ' || coalesce(l.periodo_inicio::text, '—') || ' a ' || coalesce(l.periodo_fim::text, '—')
        || ' | comp ' || coalesce(to_char(l.competencia, 'YYYY-MM'), '—')
        || ' | arquivado ' || coalesce(l.arquivado_em::date::text, '—')
        || ' | origem ' || coalesce(l.origem::text, '—') || coalesce(' #' || l.origem_linha, '')
        || ' | pago em ' || coalesce(l.pago_em::text, '—')
        || ' | R$ ' || coalesce(to_char(l.valor, 'FM999G990D00'), '—')
        || ' | criada ' || l.criado_em::date,
        coalesce(nullif(concat_ws(' · ',
          case when l.periodo_fim = a.fim_periodo and l.status <> 'cancelado'
               then 'BLOQUEIA (mesmo periodo_fim, nao cancelada)' end,
          case when l.periodo_fim is null and l.status <> 'cancelado'
               then 'sem periodo — fora do indice' end,
          case when l.nutri_id is distinct from v_org
               then 'INVISIVEL ao drawer (nutri_id fora da organizacao)' end,
          case when l.arquivado_em is not null
               then 'ARQUIVADA — o indice nao olha arquivado_em' end,
          case when l.nutri_id = v_org
                and (l.status = 'pendente' or (l.status = 'pago' and l.vencimento = a.fim_periodo))
               then 'o drawer a trata como cobranca aberta' end,
          case when l.status = 'pago' and l.vencimento = a.inicio_periodo
               then 'PAGA com vencimento = INICIO do periodo' end,
          case when l.status <> 'cancelado' and l.vencimento = v_venc
               then 'mesmo vencimento que o formulario sugere hoje' end), ''), '—'));
    end loop;

    -- DIAGNOSTICO
    select count(*) filter (where f.periodo_fim = a.fim_periodo and f.status <> 'cancelado'),
           count(*) filter (where f.nutri_id = v_org
                              and (f.status = 'pendente'
                                   or (f.status = 'pago' and f.vencimento = a.fim_periodo))),
           string_agg(
             case when f.periodo_fim = a.fim_periodo and f.status <> 'cancelado' then
               case when f.nutri_id is distinct from v_org then 'fora da organizacao, status ' || f.status
                    when f.arquivado_em is not null then 'ARQUIVADA com status ' || f.status
                    when f.status = 'pago' and f.vencimento = a.inicio_periodo
                      then 'PAGA em ' || coalesce(f.pago_em::text, '?') || ', vencimento = INICIO do periodo (' || f.vencimento || ')'
                    when f.status = 'pago'
                      then 'PAGA em ' || coalesce(f.pago_em::text, '?') || ', vencimento ' || f.vencimento || ' <> fim do periodo'
                    else upper(f.status) || ' venc ' || f.vencimento end
               || ', origem ' || coalesce(f.origem::text, '—') || ', id ' || f.id
             end, ' ; ')
      into v_bloq, v_aberta, v_quem
      from public.financeiro_lancamentos f
     where f.assinatura_id = a.id;

    v_seq := v_seq + 1;
    insert into conf132 values (v_seq, 'DIAGNOSTICO', a.cliente,
      'vivas no periodo ' || a.inicio_periodo || ' a ' || a.fim_periodo || ': ' || v_bloq
      || ' | o drawer acha cobranca aberta: ' || v_aberta,
      case
        when v_bloq = 0
          then 'NADA ocupa o periodo hoje — se o aviso aparece, vem de OUTRO unico (ver INDICE) ou a assinatura mudou depois'
        when v_aberta = 0
          then 'FALSO "sem cobranca": o drawer oferece criar e o indice recusa. Quem ocupa: ' || v_quem
        else 'o drawer ja mostra cobranca aberta e nao ofereceria o botao — conferir se foi esta assinatura' end);

    -- TRILHA
    for r in
      select au.acao, au.criado_em::date as quando,
             au.antes  ->> 'inicio_periodo' as de_ini, au.antes  ->> 'fim_periodo' as de_fim,
             au.depois ->> 'inicio_periodo' as pa_ini, au.depois ->> 'fim_periodo' as pa_fim
        from public.comercial_assinatura_auditoria au
       where au.assinatura_id = a.id
       order by au.criado_em desc
       limit 20
    loop
      v_seq := v_seq + 1;
      insert into conf132 values (v_seq, 'TRILHA', a.cliente, r.quando || ' ' || r.acao,
        'periodo ' || coalesce(r.de_ini, '—') || ' a ' || coalesce(r.de_fim, '—')
        || '  ->  ' || coalesce(r.pa_ini, '—') || ' a ' || coalesce(r.pa_fim, '—'));
    end loop;
  end loop;

  -- ═══════════ ALCANCE ═══════════
  -- Toda assinatura da tela em que o drawer ofereceria criar e o indice
  -- recusaria. Se Nilca e Vera forem o padrao, elas aparecem aqui junto.
  select count(*),
         count(*) filter (where exists (
           select 1 from public.financeiro_lancamentos f
            where f.assinatura_id = s.id and f.periodo_fim = s.fim_periodo
              and f.status = 'pago' and f.vencimento = s.inicio_periodo)),
         string_agg(p.nome, ', ' order by p.nome)
    into v_n, v_bloq, v_quem
    from public.comercial_assinaturas s
    join public.pacientes p on p.id = s.paciente_id
   where s.nutri_id = v_org
     and s.status in ('ativa', 'aguardando_inicio', 'pausada')
     and exists (select 1 from public.financeiro_lancamentos f
                  where f.assinatura_id = s.id and f.periodo_fim = s.fim_periodo
                    and f.status <> 'cancelado')
     and not exists (select 1 from public.financeiro_lancamentos f
                      where f.assinatura_id = s.id and f.nutri_id = v_org
                        and (f.status = 'pendente'
                             or (f.status = 'pago' and f.vencimento = s.fim_periodo)));
  v_seq := v_seq + 1;
  insert into conf132 values (v_seq, 'ALCANCE', 'assinaturas no mesmo buraco',
    v_n || ' (das quais ' || v_bloq || ' pela PAGA com vencimento = inicio)',
    coalesce(v_quem, '—'));
end $$;

-- ═══════════ CENARIO ═══════════
-- Assinatura sintetica: periodo 2026-08-09 a 2026-09-08. O formulario manda
-- vencimento 2026-10-11 (hoje + 30). Cada linha e a UNICA cobranca da
-- assinatura, e as tres colunas respondem:
--   B      o indice em vigor (periodo)          -> e o que o banco faz
--   A      a regra antiga (vencimento)          -> e o que a frase afirma
--   botao  o drawer atual ofereceria criar?
insert into conf132
select 900 + s.n, 'CENARIO', s.rotulo,
       'B indice: ' || case when s.b then 'BLOQUEIA' else 'permite' end
       || ' | A vencimento: ' || case when s.av then 'bloquearia' else 'permitiria' end
       || ' | drawer atual: ' || case when s.botao then 'OFERECE criar' else 'nao oferece' end,
       case when s.b = s.esperado then 'OK' else 'ERRADO' end
       || ' — ' || case when s.esperado then 'deve bloquear' else 'deve permitir' end
       || case when s.botao and s.b then ' · FALSO BLOQUEIO: a tela oferece e o banco recusa' else '' end
       || case when s.av is distinct from s.b then ' · A e B DISCORDAM' else '' end
  from (
    select v.n, v.rotulo, v.esperado,
           (v.pf = date '2026-09-08' and v.st <> 'cancelado')                        as b,
           (v.venc = date '2026-10-11' and v.st <> 'cancelado')                      as av,
           not (v.st = 'pendente' or (v.st = 'pago' and v.venc = date '2026-09-08')) as botao
      from (values
        (1, 'cancelada do mesmo periodo',                               'cancelado', date '2026-10-11', date '2026-09-08', false),
        (2, 'pendente do mesmo periodo, vencimento diferente',          'pendente',  date '2026-09-20', date '2026-09-08', true),
        (3, 'pendente de OUTRO periodo, mesmo vencimento',              'pendente',  date '2026-10-11', date '2026-08-08', false),
        (4, 'paga do mesmo periodo, vencimento = inicio (planilha)',    'pago',      date '2026-08-09', date '2026-09-08', true),
        (5, 'paga do periodo anterior, vencimento = fim dele',          'pago',      date '2026-08-08', date '2026-08-08', false)
      ) as v(n, rotulo, st, venc, pf, esperado)
  ) s;

select ordem, secao, item, valor, resultado from conf132 order by ordem;
