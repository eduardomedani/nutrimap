-- ===========================================================================
-- NutriMap · "Treino atualizado" — carimbo de data + triggers
-- ---------------------------------------------------------------------------
-- treinos.atualizado_em reflete QUALQUER alteração feita pelo nutri:
--   . no próprio treino (nome, datas, divisão, ativo...)      -> BEFORE UPDATE
--   . nos exercícios do treino (add/editar/excluir, bi-set)   -> AFTER I/U/D
-- Criar um treino novo já nasce com atualizado_em = now() (default).
-- O app do aluno usa isso para avisar "Seu treino foi atualizado".
--
-- Rodar no SQL Editor do Supabase. Re-executável.
-- ===========================================================================

alter table public.treinos
  add column if not exists atualizado_em timestamptz not null default now();

create or replace function public.bump_treino_atualizado()
returns trigger
language plpgsql
as $$
begin
  if TG_TABLE_NAME = 'treinos' then
    -- alteração no próprio treino
    new.atualizado_em := now();
    return new;
  end if;
  -- alteração num exercício: carimba o treino dono
  update public.treinos
     set atualizado_em = now()
   where id = coalesce(new.treino_id, old.treino_id);
  return coalesce(new, old);
end;
$$;

-- No próprio treino (não dispara em INSERT: o default já cobre a criação)
drop trigger if exists trg_treino_bump on public.treinos;
create trigger trg_treino_bump
  before update on public.treinos
  for each row execute function public.bump_treino_atualizado();

-- Nos exercícios do treino
drop trigger if exists trg_te_bump on public.treino_exercicios;
create trigger trg_te_bump
  after insert or update or delete on public.treino_exercicios
  for each row execute function public.bump_treino_atualizado();

-- ===========================================================================
-- FIM
-- ===========================================================================
