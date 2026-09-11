-- ===========================================================================
-- Evollo · DESFAZER — A PAGA DE INICIO VOLTA AO PERIODO VIGENTE
-- ---------------------------------------------------------------------------
-- Desfaz db/comercial_periodo_das_pagas_de_inicio.sql. Le o periodo antigo do
-- `metadata` de cada linha que a correcao marcou, devolve e tira a marca.
--
-- ATENCAO: se, depois da correcao, alguem criou a cobranca do periodo atual
-- (o que a correcao existe para permitir), a paga NAO pode voltar para aquele
-- periodo — o indice recusaria duas cobrancas vivas nele. A guarda para antes
-- e diz quantas. Cancele ou remova essas cobrancas novas primeiro, se o
-- desfazer for mesmo o que voce quer.
--
-- Tudo numa transacao: se a guarda parar, nada muda.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/comercial_periodo_das_pagas_de_inicio_desfazer_LIMPO.sql
-- ===========================================================================

do $desf$
declare
  v_n   int;
  v_col int;
  v_upd int;
begin
  select count(*) into v_n
    from public.financeiro_lancamentos f
   where f.metadata ->> 'periodo_corrigido_por' = 'comercial_periodo_das_pagas_de_inicio';
  if v_n = 0 then
    raise exception 'Nada a desfazer: nenhuma linha marcada pela correcao.';
  end if;

  select count(*) into v_col
    from public.financeiro_lancamentos f
   where f.metadata ->> 'periodo_corrigido_por' = 'comercial_periodo_das_pagas_de_inicio'
     and exists (select 1 from public.financeiro_lancamentos x
                  where x.assinatura_id = f.assinatura_id
                    and x.id <> f.id
                    and x.status <> 'cancelado'
                    and x.periodo_fim = (f.metadata -> 'periodo_antes' ->> 'fim')::date);
  if v_col > 0 then
    raise exception '% linha(s) nao podem voltar: o periodo antigo ja tem outra cobranca viva, criada depois da correcao. Nada foi alterado.', v_col;
  end if;

  update public.financeiro_lancamentos f
     set periodo_inicio = (f.metadata -> 'periodo_antes' ->> 'inicio')::date,
         periodo_fim    = (f.metadata -> 'periodo_antes' ->> 'fim')::date,
         metadata       = f.metadata - 'periodo_antes' - 'periodo_corrigido_por' - 'periodo_corrigido_em',
         atualizado_em  = now()
   where f.metadata ->> 'periodo_corrigido_por' = 'comercial_periodo_das_pagas_de_inicio';
  get diagnostics v_upd = row_count;

  raise notice 'desfeitas: % de %', v_upd, v_n;
end $desf$;


-- ===========================================================================
-- CONFERENCIA. Esperado: ainda_marcadas 0
-- ===========================================================================
select count(*) as ainda_marcadas
  from public.financeiro_lancamentos
 where metadata ->> 'periodo_corrigido_por' = 'comercial_periodo_das_pagas_de_inicio';
