-- ===========================================================================
-- COMERCIAL — A PREVIA DA CORRECAO DAS PAGAS DE INICIO DE PERIODO
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. Mostra, linha a linha, o que
-- db/comercial_periodo_das_pagas_de_inicio.sql faria.
--
-- O PROBLEMA (conferencia 132). A classe INICIO do backfill da Migration C deu
-- o periodo VIGENTE a cobrancas PAGAS da planilha cujo vencimento e a data do
-- pagamento, que e o INICIO do periodo. O resto do sistema segue outra
-- convencao: a cobranca do periodo P e paga no fim de P, e o pagamento ABRE
-- P+1. Resultado: em 27 assinaturas o periodo atual aparece ocupado por uma
-- paga, a tela oferece "Criar cobranca do periodo" e o indice recusa. Nilca e
-- Vera estao entre elas.
--
-- A CORRECAO PROPOSTA. A paga passa a cobrir o periodo que ela ENCERROU — o
-- que o pagamento dela abriu e o periodo atual:
--
--   periodo_fim    = inicio do periodo atual da assinatura
--   periodo_inicio = esse dia menos a duracao do plano, mas NUNCA antes do
--                    "cliente desde". Quem estreou naquele pagamento fica com
--                    um periodo de um dia so: "este pagamento abriu o
--                    contrato", sem inventar um mes que nao existiu.
--
-- NAO MUDA: vencimento, pago_em, valor, status, forma de pagamento,
-- COMPETENCIA. O periodo antigo fica no `metadata`, que e de onde o desfazer
-- le.
--
-- COMO LER:
--   PROPOSTA  uma linha por paga: periodo de hoje -> periodo proposto.
--             `resultado` avisa colisao e "periodo de um dia".
--   RESUMO    totais. `colisoes` tem de ser 0 para a correcao rodar.
--             `competencia repetida` conta quem vai ter DUAS cobrancas no
--             mesmo mes depois que a cobranca do periodo atual for criada: a
--             paga (competencia mantida) e a nova (mes do inicio do periodo).
--   FORA      assinaturas travadas que esta correcao NAO pega. Olhar uma a
--             uma.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/134_pagas_de_inicio_LIMPO.sql
-- ===========================================================================

drop table if exists conf134;
drop table if exists conf134_cand;
create temp table conf134 (ordem int, secao text, item text, valor text, resultado text);
create temp table conf134_cand (
  lancamento_id uuid, assinatura_id uuid, cliente text,
  pago_em date, vencimento date, competencia date,
  ini_antes date, fim_antes date, ini_novo date, fim_novo date,
  desde date, colide boolean
);

do $$
declare
  v_org  uuid;
  v_seq  int := 100;
  v_n    int;
  v_ass  int;
  v_col  int;
  v_dia  int;
  v_rep  int;
  r      record;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins ad on ad.user_id = o.proprietario_user_id;

  -- AS CANDIDATAS — o mesmo recorte da migration.
  insert into conf134_cand
  select f.id, s.id, p.nome::text,
         f.pago_em, f.vencimento, f.competencia,
         f.periodo_inicio, f.periodo_fim,
         greatest(
           case when coalesce(pl.duracao_unidade, 'dia') = 'mes'
                then (s.inicio_periodo - (coalesce(pl.duracao_valor, 30) || ' months')::interval)::date
                else s.inicio_periodo - coalesce(pl.duracao_valor, 30) end,
           s.data_inicio_original),
         s.inicio_periodo,
         s.data_inicio_original,
         false
    from public.financeiro_lancamentos f
    join public.comercial_assinaturas s on s.id = f.assinatura_id
    join public.pacientes p on p.id = s.paciente_id
    left join public.comercial_planos pl on pl.id = s.plano_id
   where s.nutri_id = v_org
     and s.status in ('ativa', 'aguardando_inicio', 'pausada')
     and f.status = 'pago'
     and f.arquivado_em is null
     and f.vencimento = s.inicio_periodo
     and f.periodo_inicio = s.inicio_periodo
     and f.periodo_fim = s.fim_periodo
     and not (coalesce(f.metadata, '{}'::jsonb) ? 'periodo_antes')
     and not exists (select 1 from public.financeiro_lancamentos x
                      where x.assinatura_id = s.id and x.status = 'pendente');

  update conf134_cand c
     set colide = exists (
       select 1 from public.financeiro_lancamentos x
        where x.assinatura_id = c.assinatura_id
          and x.periodo_fim = c.fim_novo
          and x.status <> 'cancelado'
          and x.id <> c.lancamento_id);

  -- ═══════════ PROPOSTA ═══════════
  for r in select * from conf134_cand order by cliente loop
    v_seq := v_seq + 1;
    insert into conf134 values (v_seq, 'PROPOSTA', r.cliente,
      'periodo ' || r.ini_antes || ' a ' || r.fim_antes
      || '  ->  ' || r.ini_novo || ' a ' || r.fim_novo
      || ' | pago em ' || coalesce(r.pago_em::text, '—')
      || ' | comp ' || to_char(r.competencia, 'YYYY-MM') || ' (fica)'
      || ' | desde ' || r.desde,
      case when r.colide then 'COLIDE — o periodo anterior ja tem cobranca viva; a migration para'
           when r.ini_novo = r.fim_novo then 'periodo de UM DIA: foi o pagamento que abriu o contrato'
           else 'ok' end);
  end loop;

  -- ═══════════ RESUMO ═══════════
  select count(*), count(distinct assinatura_id),
         count(*) filter (where colide),
         count(*) filter (where ini_novo = fim_novo),
         count(*) filter (where date_trunc('month', fim_novo)::date = competencia)
    into v_n, v_ass, v_col, v_dia, v_rep
    from conf134_cand;

  insert into conf134 values
    (1, 'RESUMO', 'candidatas',               v_n::text,   'a 132 contou 27'),
    (2, 'RESUMO', 'assinaturas',              v_ass::text, case when v_ass = v_n then 'uma paga por assinatura' else 'ALGUMA TEM MAIS DE UMA — a migration para' end),
    (3, 'RESUMO', 'colisoes',                 v_col::text, case when v_col = 0 then 'ok' else 'a migration para' end),
    (4, 'RESUMO', 'periodo de um dia',        v_dia::text, 'estrearam naquele pagamento'),
    (5, 'RESUMO', 'competencia repetida depois', v_rep::text,
       'terao DUAS cobrancas no mesmo mes quando a do periodo atual for criada — efeito de manter a competencia');

  -- ═══════════ FORA ═══════════
  v_seq := 500;
  for r in
    select p.nome::text as cliente, s.inicio_periodo, s.fim_periodo,
           string_agg(upper(f.status) || ' venc ' || f.vencimento
                      || ' periodo ' || coalesce(f.periodo_inicio::text, '—') || ' a ' || coalesce(f.periodo_fim::text, '—')
                      || coalesce(' pago em ' || f.pago_em, '')
                      || case when f.arquivado_em is not null then ' ARQUIVADA' else '' end
                      || ' origem ' || coalesce(f.origem::text, '—'), ' ; ') as quem
      from public.comercial_assinaturas s
      join public.pacientes p on p.id = s.paciente_id
      join public.financeiro_lancamentos f
        on f.assinatura_id = s.id and f.periodo_fim = s.fim_periodo and f.status <> 'cancelado'
     where s.nutri_id = v_org
       and s.status in ('ativa', 'aguardando_inicio', 'pausada')
       and not exists (select 1 from public.financeiro_lancamentos x
                        where x.assinatura_id = s.id and x.nutri_id = v_org
                          and (x.status = 'pendente'
                               or (x.status = 'pago' and x.vencimento = s.fim_periodo)))
       and not exists (select 1 from conf134_cand c where c.assinatura_id = s.id)
     group by p.nome, s.inicio_periodo, s.fim_periodo
     order by p.nome
  loop
    v_seq := v_seq + 1;
    insert into conf134 values (v_seq, 'FORA', r.cliente,
      'periodo ' || r.inicio_periodo || ' a ' || r.fim_periodo,
      'quem ocupa: ' || r.quem);
  end loop;
end $$;

select ordem, secao, item, valor, resultado from conf134 order by ordem;
