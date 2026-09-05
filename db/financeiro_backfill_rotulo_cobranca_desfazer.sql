-- ===========================================================================
-- DESFAZER db/financeiro_backfill_rotulo_cobranca.sql
-- ---------------------------------------------------------------------------
-- Devolve a descricao exata que estava gravada antes, lendo
-- `metadata.descricao_anterior`, e apaga a marca.
--
-- SO MEXE NO QUE O BACKFILL MEXEU. Sem a marca, a linha nao e tocada — quem
-- nasceu ja no formato novo continua como esta, que e o certo: ela nunca teve
-- prefixo para devolver.
--
-- A CATEGORIA NAO VOLTA A SER NULA. Ela foi PREENCHIDA, nao trocada: antes nao
-- havia nada ali. Esvaziar de novo tiraria do relatorio por categoria uma
-- receita que agora esta classificada certo, e ninguem pediu isso. Se for
-- mesmo o desejado, e um update de uma linha, consciente:
--
--   update public.financeiro_lancamentos set categoria_id = null
--    where assinatura_id is not null and tipo = 'receita';
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/financeiro_backfill_rotulo_cobranca_desfazer_LIMPO.sql
-- ===========================================================================

do $desfaz$
declare
  v_org uuid;
  v_n   int;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  if v_org is null then
    raise exception 'organizacao nao encontrada — nada foi tocado';
  end if;

  update public.financeiro_lancamentos l
     set descricao     = l.metadata ->> 'descricao_anterior',
         atualizado_em = now(),
         metadata      = l.metadata - 'descricao_anterior'
   where l.nutri_id = v_org
     and nullif(btrim(coalesce(l.metadata ->> 'descricao_anterior', '')), '') is not null;

  get diagnostics v_n = row_count;
  raise notice 'descricoes restauradas: %', v_n;
end $desfaz$;


-- ===========================================================================
-- CONFERENCIA. Esperado: com_marca = 0
-- ===========================================================================
select
  (select count(*) from public.financeiro_lancamentos
    where metadata ? 'descricao_anterior') as com_marca;
