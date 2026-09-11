-- ===========================================================================
-- COMERCIAL — PREVIA DA COMPETENCIA DAS 29 PAGAS CORRIGIDAS
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- As 29 pagas que db/comercial_periodo_das_pagas_de_inicio.sql moveram para o
-- periodo que elas ENCERRARAM mantiveram a competencia. A regra da Migration
-- C e "competencia = mes do INICIO do periodo". Esta previa mostra, por linha:
--
--   competencia_atual     a que ficou (o mes em que o dinheiro entrou)
--   competencia_proposta  o mes do periodo_inicio corrigido
--   cobranca_seguinte     a cobranca do periodo que ela abriu, se ja existe
--   duas_no_mes_se_manter mes que fica com DUAS receitas se nada mudar
--   duas_no_mes_se_aplicar  idem, se a proposta for aplicada
--   obs                   periodo de um dia = pagamento que abriu o contrato;
--                         nao ha mes anterior, a proposta nao muda nada
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

select p.nome                                                           as cliente,
       f.id                                                             as cobranca_id,
       f.valor,
       to_char(f.competencia, 'YYYY-MM')                                as competencia_atual,
       to_char(date_trunc('month', f.periodo_inicio), 'YYYY-MM')        as competencia_proposta,
       f.periodo_inicio,
       f.periodo_fim,
       f.pago_em,
       (f.competencia <> date_trunc('month', f.periodo_inicio)::date)   as muda,
       coalesce(upper(n.status) || ' ' || n.id, 'ainda nao criada')     as cobranca_seguinte,
       to_char(coalesce(n.competencia, date_trunc('month', f.periodo_fim)::date), 'YYYY-MM') as competencia_seguinte,
       case when f.competencia = coalesce(n.competencia, date_trunc('month', f.periodo_fim)::date)
            then to_char(f.competencia, 'YYYY-MM') else '' end        as duas_no_mes_se_manter,
       case when date_trunc('month', f.periodo_inicio)::date
                 = coalesce(n.competencia, date_trunc('month', f.periodo_fim)::date)
            then to_char(date_trunc('month', f.periodo_inicio), 'YYYY-MM') else '' end as duas_no_mes_se_aplicar,
       case when f.periodo_inicio = f.periodo_fim
            then 'periodo de um dia: nao ha mes anterior no contrato' else '' end as obs
  from public.financeiro_lancamentos f
  join public.comercial_assinaturas s on s.id = f.assinatura_id
  join public.pacientes p on p.id = s.paciente_id
  left join lateral (
    select x.id, x.status, x.competencia
      from public.financeiro_lancamentos x
     where x.assinatura_id = f.assinatura_id
       and x.status <> 'cancelado'
       and x.periodo_inicio = f.periodo_fim
     order by x.criado_em desc
     limit 1
  ) n on true
 where f.metadata ->> 'periodo_corrigido_por' = 'comercial_periodo_das_pagas_de_inicio'
 order by p.nome;
