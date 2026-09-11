-- ===========================================================================
-- Evollo · COMERCIAL — A PAGA DE INICIO DE PERIODO COBRE O PERIODO QUE ELA
-- ENCERROU
-- ---------------------------------------------------------------------------
-- Roda DEPOIS de db/conferencia/134_pagas_de_inicio.sql, com RESUMO
-- `colisoes = 0`.
--
-- O PROBLEMA (conferencias 132 e 134). A classe INICIO do backfill da
-- Migration C deu o periodo VIGENTE a cobrancas PAGAS da planilha cujo
-- vencimento e a data do pagamento — o INICIO do periodo. O resto do sistema
-- segue outra convencao: a cobranca do periodo P e paga no fim de P, e o
-- pagamento ABRE P+1 (comercial_registrar_pagamento). As duas convencoes
-- ficaram defasadas em um ciclo, e em 29 assinaturas o periodo atual aparece
-- ocupado por uma paga — 27 com vencimento = inicio do periodo, 2 (Gessica,
-- Natalino) com pago_em = inicio do periodo, a classe irma do mesmo backfill:
--
--   . o drawer diz "Nenhuma cobranca em aberto" e oferece criar;
--   . `uq_comercial_cobranca_do_periodo` recusa, com razao;
--   . o cliente fica SEM SAIDA: nao ha pendente para pagar e nao se cria uma.
--
-- Casos reais: Nilca Rosa da Silva e Vera Lucia Guarise de Oliveira.
--
-- A CORRECAO. A paga passa a cobrir o periodo que ela ENCERROU — e o que o
-- pagamento dela abriu e o periodo atual, exatamente como a RPC de pagamento
-- teria registrado:
--
--   periodo_fim    = inicio do periodo atual da assinatura
--   periodo_inicio = esse dia menos a duracao do plano atual, mas NUNCA antes
--                    de `data_inicio_original`. Quem estreou naquele
--                    pagamento fica com periodo de um dia so, em vez de um mes
--                    anterior ao contrato.
--
-- Depois disto, "Criar cobranca do periodo" cria a cobranca do periodo atual,
-- e o pagamento dela renova pela regra de sempre.
--
-- O QUE NAO MUDA: vencimento, pago_em, valor, valor_pago, status, forma de
-- pagamento, categoria, descricao e COMPETENCIA. Nenhuma assinatura e tocada.
--
-- CONSEQUENCIA DE MANTER A COMPETENCIA: quando a cobranca do periodo atual
-- for criada, ela nasce com a competencia do inicio desse periodo — o mesmo
-- mes da paga. Esses clientes terao duas receitas no mesmo mes e nenhuma no
-- anterior. A conferencia 134 conta quantos (`competencia repetida depois`).
--
-- A TRILHA. O trigger de auditoria do financeiro nao olha `periodo_*`, entao o
-- periodo antigo vai no `metadata` de cada linha:
--   periodo_antes         { inicio, fim }
--   periodo_corrigido_por 'comercial_periodo_das_pagas_de_inicio'
--   periodo_corrigido_em  now()
-- E dali que o desfazer le.
--
-- AS GUARDAS. Tudo roda numa transacao: se qualquer guarda parar, nada muda.
--   . 0 candidatas         -> ja aplicado, ou os dados mudaram
--   . mais de 27           -> apareceu caso novo; rode a 134 de novo
--   . duas numa assinatura -> nao sei qual corrigir
--   . colisao              -> o periodo anterior ja tem cobranca viva
--   . o update tocou menos -> o banco andou no meio
--
-- Desfazer: db/comercial_periodo_das_pagas_de_inicio_desfazer.sql
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/comercial_periodo_das_pagas_de_inicio_LIMPO.sql
-- ===========================================================================

drop table if exists corr_cand;
create temp table corr_cand (
  lancamento_id uuid, assinatura_id uuid,
  ini_antes date, fim_antes date, ini_novo date, fim_novo date
);

do $corr$
declare
  v_org uuid;
  v_n   int;
  v_ass int;
  v_col int;
  v_upd int;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins ad on ad.user_id = o.proprietario_user_id;
  if v_org is null then
    raise exception 'Nao encontrei a organizacao principal. Nada foi alterado.';
  end if;

  -- As candidatas: o mesmo recorte da conferencia 134.
  insert into corr_cand
  select f.id, s.id,
         f.periodo_inicio, f.periodo_fim,
         greatest(
           case when coalesce(pl.duracao_unidade, 'dia') = 'mes'
                then (s.inicio_periodo - (coalesce(pl.duracao_valor, 30) || ' months')::interval)::date
                else s.inicio_periodo - coalesce(pl.duracao_valor, 30) end,
           s.data_inicio_original),
         s.inicio_periodo
    from public.financeiro_lancamentos f
    join public.comercial_assinaturas s on s.id = f.assinatura_id
    left join public.comercial_planos pl on pl.id = s.plano_id
   where s.nutri_id = v_org
     and s.status in ('ativa', 'aguardando_inicio', 'pausada')
     and f.status = 'pago'
     and f.arquivado_em is null
     and (f.vencimento = s.inicio_periodo or f.pago_em = s.inicio_periodo)
     and f.periodo_inicio = s.inicio_periodo
     and f.periodo_fim = s.fim_periodo
     and not (coalesce(f.metadata, '{}'::jsonb) ? 'periodo_antes')
     and not exists (select 1 from public.financeiro_lancamentos x
                      where x.assinatura_id = s.id and x.status = 'pendente');

  select count(*), count(distinct assinatura_id) into v_n, v_ass from corr_cand;

  if v_n = 0 then
    raise exception 'Nenhuma candidata: ja aplicado, ou os dados mudaram. Nada foi alterado.';
  end if;
  if v_n > 29 then
    raise exception 'Esperava ate 29 candidatas (27 pelo vencimento + 2 pelo pago_em, conferencias 132 e 134, 11/09/2026) e achei %. Rode a conferencia 134 de novo. Nada foi alterado.', v_n;
  end if;
  if v_ass <> v_n then
    raise exception 'Alguma assinatura tem mais de uma candidata (% linhas, % assinaturas). Nada foi alterado.', v_n, v_ass;
  end if;

  select count(*) into v_col
    from corr_cand c
   where exists (select 1 from public.financeiro_lancamentos x
                  where x.assinatura_id = c.assinatura_id
                    and x.periodo_fim = c.fim_novo
                    and x.status <> 'cancelado'
                    and x.id <> c.lancamento_id);
  if v_col > 0 then
    raise exception '% candidata(s) colidiriam com cobranca viva do periodo anterior. Rode a conferencia 134. Nada foi alterado.', v_col;
  end if;

  -- O update leva o estado esperado no WHERE: se a linha mudou desde o
  -- recorte, ela nao e tocada e a contagem abaixo para tudo.
  update public.financeiro_lancamentos f
     set periodo_inicio = c.ini_novo,
         periodo_fim    = c.fim_novo,
         metadata       = coalesce(f.metadata, '{}'::jsonb) || jsonb_build_object(
                            'periodo_antes', jsonb_build_object('inicio', c.ini_antes, 'fim', c.fim_antes),
                            'periodo_corrigido_por', 'comercial_periodo_das_pagas_de_inicio',
                            'periodo_corrigido_em', now()),
         atualizado_em  = now()
    from corr_cand c
   where f.id = c.lancamento_id
     and f.status = 'pago'
     and f.periodo_inicio = c.ini_antes
     and f.periodo_fim    = c.fim_antes;
  get diagnostics v_upd = row_count;

  if v_upd <> v_n then
    raise exception 'O update tocaria % de % linhas: o banco andou no meio. Nada foi alterado.', v_upd, v_n;
  end if;

  raise notice 'periodos corrigidos: %', v_upd;
end $corr$;


-- ===========================================================================
-- CONFERENCIA. Esperado: corrigidas 29 · ainda_travadas 0 · colisoes 0
-- ---------------------------------------------------------------------------
-- `ainda_travadas` e o ALCANCE da 132 depois da correcao. Se vier maior que
-- zero, ha caso de outra natureza — rode a 132 e olhe um a um.
-- ===========================================================================
with org as (
  select o.id
    from public.organizacoes o
    join public.admins ad on ad.user_id = o.proprietario_user_id
)
select
  (select count(*) from public.financeiro_lancamentos
    where metadata ->> 'periodo_corrigido_por' = 'comercial_periodo_das_pagas_de_inicio') as corrigidas,
  (select count(*)
     from public.comercial_assinaturas s, org
    where s.nutri_id = org.id
      and s.status in ('ativa', 'aguardando_inicio', 'pausada')
      and exists (select 1 from public.financeiro_lancamentos f
                   where f.assinatura_id = s.id and f.periodo_fim = s.fim_periodo
                     and f.status <> 'cancelado')
      and not exists (select 1 from public.financeiro_lancamentos f
                       where f.assinatura_id = s.id and f.nutri_id = org.id
                         and (f.status = 'pendente'
                              or (f.status = 'pago' and f.vencimento = s.fim_periodo))))  as ainda_travadas,
  (select count(*) from (
     select assinatura_id, periodo_fim
       from public.financeiro_lancamentos
      where assinatura_id is not null and periodo_fim is not null and status <> 'cancelado'
      group by 1, 2 having count(*) > 1) d)                                            as colisoes;
