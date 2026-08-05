-- ===========================================================================
-- Evollo · Financeiro — DESFAZER a Etapa 1 das despesas
-- ---------------------------------------------------------------------------
-- Volta ao estado anterior: os centros de custo viram categorias de novo, os
-- lancamentos religam, e as colunas/tabelas novas saem.
--
-- A ORDEM IMPORTA. Devolver a categoria ANTES de apagar a coluna
-- centro_custo_id: apagar a coluna primeiro perderia o vinculo e nao haveria
-- como saber a que centro cada lancamento pertencia.
--
-- SO DESFAZ O QUE ESTE PACOTE FEZ. Centro de custo criado a mao por voce, com
-- descricao diferente, nao vira categoria — ele fica, e o aviso diz quais.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

do $desfazer$
declare
  v_nutri  uuid;
  v_donos  integer;
  r        record;
  v_cat    uuid;
  v_volta  integer;
  v_total  integer := 0;
  v_ficam  integer := 0;
begin
  select count(distinct nutri_id) into v_donos from public.folhas;

  if auth.uid() is not null then
    v_nutri := auth.uid();
  elsif v_donos = 1 then
    select distinct nutri_id into v_nutri from public.folhas;
  else
    select id into v_nutri from auth.users
     where lower(email) = lower('eduardomedani@natalinossalgados.com.br') limit 1;
  end if;

  if v_nutri is null then
    raise exception 'Nao encontrei o dono dos lancamentos.';
  end if;

  for r in
    select id, nome, ordem, descricao from public.financeiro_centros_custo
     where nutri_id = v_nutri order by ordem, nome
  loop
    if r.descricao is distinct from 'Veio da coluna CENTRO DE CUSTO da planilha de custos.' then
      raise notice 'MANTIDO  "%" — criado a mao, nao pela migracao', r.nome;
      v_ficam := v_ficam + 1;
      continue;
    end if;

    insert into public.financeiro_categorias (nutri_id, nome, tipo, ordem)
    select v_nutri, r.nome, 'despesa', r.ordem
     where not exists (
       select 1 from public.financeiro_categorias c
        where c.nutri_id = v_nutri and c.tipo = 'despesa' and lower(c.nome) = lower(r.nome));

    select id into v_cat from public.financeiro_categorias
     where nutri_id = v_nutri and tipo = 'despesa' and lower(nome) = lower(r.nome);

    update public.financeiro_lancamentos
       set categoria_id = v_cat, centro_custo_id = null, atualizado_em = now()
     where nutri_id = v_nutri and centro_custo_id = r.id;
    get diagnostics v_volta = row_count;
    v_total := v_total + v_volta;

    delete from public.financeiro_centros_custo where id = r.id;
    raise notice 'DEVOLVIDO  "%"  (% lancamento(s))', r.nome, v_volta;
  end loop;

  raise notice '--- % lancamento(s) devolvido(s), % centro(s) mantido(s)', v_total, v_ficam;
end $desfazer$;


-- ===========================================================================
-- A view volta a somar tudo, como era antes da Etapa 1.
-- ===========================================================================
create or replace view public.financeiro_resumo_mensal
with (security_invoker = on) as
select
  l.nutri_id,
  l.competencia,
  l.tipo,
  count(*)                                                     as lancamentos,
  count(*) filter (where l.valor is null)                      as pendentes,
  coalesce(sum(l.valor), 0)                                    as total,
  coalesce(sum(l.valor) filter (where l.pago), 0)              as total_pago,
  coalesce(sum(l.valor) filter (where not l.pago), 0)          as total_aberto
from public.financeiro_lancamentos l
group by l.nutri_id, l.competencia, l.tipo;

drop trigger if exists trg_auditoria_financeiro on public.financeiro_lancamentos;
drop trigger if exists trg_sincronizar_pago_status on public.financeiro_lancamentos;
drop function if exists public.registrar_auditoria_financeiro();
drop function if exists public.sincronizar_pago_status();

alter table public.financeiro_lancamentos drop constraint if exists financeiro_lancamentos_status_check;
alter table public.financeiro_lancamentos drop constraint if exists financeiro_lancamentos_pago_em_check;
alter table public.financeiro_lancamentos drop constraint if exists financeiro_lancamentos_forma_check;

alter table public.financeiro_lancamentos drop column if exists status;
alter table public.financeiro_lancamentos drop column if exists vencimento;
alter table public.financeiro_lancamentos drop column if exists pago_em;
alter table public.financeiro_lancamentos drop column if exists centro_custo_id;
alter table public.financeiro_lancamentos drop column if exists fornecedor;
alter table public.financeiro_lancamentos drop column if exists forma_pagamento;
alter table public.financeiro_lancamentos drop column if exists documento;
alter table public.financeiro_lancamentos drop column if exists metadata;
alter table public.financeiro_lancamentos drop column if exists atualizado_por;
alter table public.financeiro_lancamentos drop column if exists arquivado_em;

-- A trilha de auditoria NAO e apagada por padrao. Desfazer uma migracao nao e
-- motivo para perder o registro de quem mexeu no dinheiro. Para remover mesmo,
-- rode a linha abaixo a mao:
--   drop table if exists public.financeiro_auditoria;
drop table if exists public.financeiro_centros_custo;


-- ===========================================================================
-- Conferencia. Esperado: 0 colunas novas e 0 centros de custo.
-- ===========================================================================
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'financeiro_lancamentos'
      and column_name in ('status', 'vencimento', 'pago_em', 'centro_custo_id')) as colunas_novas,
  (select count(*) from pg_tables
    where schemaname = 'public' and tablename = 'financeiro_centros_custo')      as tabela_centros,
  (select count(*) from public.financeiro_lancamentos where categoria_id is null
     and origem = 'planilha')                                                    as custos_sem_categoria;
