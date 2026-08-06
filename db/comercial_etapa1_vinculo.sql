-- ===========================================================================
-- Evollo · COMERCIAL — Etapa 1: o vinculo entre dinheiro e cliente
-- ---------------------------------------------------------------------------
-- Hoje o cliente que pagou existe so como TEXTO na descricao do lancamento
-- (db/gerador_vendas.mjs grava o Nome da planilha ali). Isso permite ler o
-- extrato, mas nao permite responder "quanto o Eduardo ja pagou", nem ligar um
-- pagamento a um contrato.
--
-- Esta etapa faz uma coisa so: liga o lancamento ao paciente.
--
-- POR QUE NAO EXISTE TABELA DE COBRANCA. Uma cobranca e um valor, com um
-- vencimento, que pode estar pendente ou paga. `financeiro_lancamentos` ja tem
-- exatamente isso: `tipo`, `valor`, `vencimento`, `status`, `pago_em`,
-- `forma_pagamento`. Criar uma tabela `cobrancas` ao lado significaria manter
-- dois numeros que precisam concordar para sempre — e no dia em que
-- discordarem, nao ha como saber qual esta certo. A cobranca E o lancamento.
--
-- Consequencia direta: e impossivel registrar o mesmo pagamento duas vezes,
-- porque nao ha dois lugares onde registrar.
--
-- ADITIVO: nenhuma coluna muda de tipo, nenhuma linha e alterada, nada do
-- financeiro atual deixa de funcionar. 100% re-executavel.
-- Desfazer: db/comercial_etapa1_vinculo_desfazer.sql
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================


-- ===========================================================================
-- 1) A coluna
-- ---------------------------------------------------------------------------
-- `on delete set null` e nao `cascade`: apagar um cliente NAO pode apagar o
-- dinheiro que ele pagou. O lancamento continua no caixa, so perde o dono.
-- ===========================================================================
alter table public.financeiro_lancamentos
  add column if not exists paciente_id uuid references public.pacientes(id) on delete set null;


-- ===========================================================================
-- 2) Indices
-- ---------------------------------------------------------------------------
-- O primeiro serve a pergunta "o historico deste cliente"; o segundo, "o que
-- vence e ainda nao foi pago", que e a lista que o painel comercial abre.
-- ===========================================================================
create index if not exists idx_financeiro_lancamentos_paciente
  on public.financeiro_lancamentos (nutri_id, paciente_id, vencimento desc)
  where paciente_id is not null;

create index if not exists idx_financeiro_lancamentos_a_receber
  on public.financeiro_lancamentos (nutri_id, vencimento)
  where tipo = 'receita' and status = 'pendente';


-- ===========================================================================
-- 3) O paciente tem que ser do MESMO nutri
-- ---------------------------------------------------------------------------
-- A RLS de `financeiro_lancamentos` garante que o lancamento e meu, mas nao
-- diz nada sobre o paciente apontado. Sem esta trava, um insert com o
-- paciente_id de outro profissional seria aceito pelo banco.
--
-- E gatilho, e nao CHECK, porque CHECK nao pode consultar outra tabela.
-- ===========================================================================
create or replace function public.fn_lancamento_paciente_do_nutri()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.paciente_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.pacientes p
     where p.id = new.paciente_id
       and p.nutri_id = new.nutri_id
  ) then
    raise exception 'paciente_de_outro_profissional';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lancamento_paciente_do_nutri on public.financeiro_lancamentos;
create trigger trg_lancamento_paciente_do_nutri
  before insert or update of paciente_id, nutri_id on public.financeiro_lancamentos
  for each row execute function public.fn_lancamento_paciente_do_nutri();


-- ===========================================================================
-- Conferencia. Devolve a coluna, os dois indices e o gatilho.
-- ===========================================================================
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'financeiro_lancamentos'
      and column_name = 'paciente_id')                                as coluna,
  (select count(*) from pg_indexes
    where schemaname = 'public'
      and indexname in ('idx_financeiro_lancamentos_paciente',
                        'idx_financeiro_lancamentos_a_receber'))      as indices,
  (select count(*) from pg_trigger
    where tgname = 'trg_lancamento_paciente_do_nutri')                as gatilho;
