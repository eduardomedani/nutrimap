-- ===========================================================================
-- Evollo · DESFAZER — A COMPETENCIA DAS 23 VOLTA AO QUE ERA
-- ---------------------------------------------------------------------------
-- Desfaz db/comercial_competencia_das_23.sql. Le a competencia anterior do
-- `metadata` de cada linha marcada (`competencia_corrigida_por =
-- 'comercial_competencia_das_23'`), devolve e tira a marca.
--
-- Toca so `competencia`, `metadata` e `atualizado_em`, com a mesma fotografia
-- do script de ida: se pagamento, status, periodo, vencimento ou valor
-- mudarem, tudo volta.
--
-- GUARDA: exatamente 23 linhas marcadas, somando R$ 6.922,00. Tudo numa
-- transacao.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/comercial_competencia_das_23_desfazer_LIMPO.sql
-- ===========================================================================

drop table if exists comp_foto;
create temp table comp_foto (id uuid primary key, competencia_antes date, pago_em date, valor_pago numeric(12,2),
                             status text, periodo_inicio date, periodo_fim date, vencimento date, valor numeric(12,2));

do $desf$
declare
  v_n     int;
  v_soma  numeric;
  v_upd   int;
  v_mudou int;
begin
  insert into comp_foto
  select f.id, (f.metadata ->> 'competencia_antes')::date,
         f.pago_em, f.valor_pago, f.status, f.periodo_inicio, f.periodo_fim, f.vencimento, f.valor
    from public.financeiro_lancamentos f
   where f.metadata ->> 'competencia_corrigida_por' = 'comercial_competencia_das_23';

  select count(*), coalesce(sum(valor), 0) into v_n, v_soma from comp_foto;
  if v_n <> 23 or v_soma <> 6922.00 then
    raise exception 'Esperava 23 linhas marcadas somando R$ 6922.00; achei % / R$ %. Nada foi alterado.', v_n, v_soma;
  end if;
  if exists (select 1 from comp_foto where competencia_antes is null) then
    raise exception 'Alguma linha marcada nao tem competencia_antes. Nada foi alterado.';
  end if;

  update public.financeiro_lancamentos f
     set competencia   = p.competencia_antes,
         metadata      = f.metadata - 'competencia_antes' - 'competencia_corrigida_por' - 'competencia_corrigida_em',
         atualizado_em = now()
    from comp_foto p
   where f.id = p.id;
  get diagnostics v_upd = row_count;
  if v_upd <> 23 then
    raise exception 'O update tocaria % de 23. Nada foi alterado.', v_upd;
  end if;

  select count(*) into v_mudou
    from comp_foto p
    join public.financeiro_lancamentos f on f.id = p.id
   where f.competencia    is distinct from p.competencia_antes
      or f.pago_em        is distinct from p.pago_em
      or f.valor_pago     is distinct from p.valor_pago
      or f.status         is distinct from p.status
      or f.periodo_inicio is distinct from p.periodo_inicio
      or f.periodo_fim    is distinct from p.periodo_fim
      or f.vencimento     is distinct from p.vencimento
      or f.valor          is distinct from p.valor;
  if v_mudou <> 0 then
    raise exception '% linha(s) nao voltaram ao estado esperado. Tudo volta atras.', v_mudou;
  end if;

  raise notice 'competencias devolvidas: 23 (R$ 6922.00)';
end $desf$;


-- ===========================================================================
-- CONFERENCIA. Esperado: ainda_marcadas 0 · devolvidas 23
-- ===========================================================================
select
  (select count(*) from public.financeiro_lancamentos
    where metadata ->> 'competencia_corrigida_por' = 'comercial_competencia_das_23') as ainda_marcadas,
  (select count(*) from comp_foto p
     join public.financeiro_lancamentos f on f.id = p.id
    where f.competencia = p.competencia_antes)                                     as devolvidas;
