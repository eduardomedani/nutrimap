-- ===========================================================================
-- NutriMap · Notificações push (Web Push / VAPID)
-- ---------------------------------------------------------------------------
-- push_subscriptions : inscrições dos aparelhos de cada paciente.
-- treino_notificacoes: último envio por treino (cooldown anti-spam).
-- Acesso do aluno é só via RPC SECURITY DEFINER (grava o paciente do auth).
-- A Edge Function usa a service_role (bypassa RLS) para ler/enviar.
--
-- Rodar no SQL Editor do Supabase. Re-executável.
-- ===========================================================================

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  criado_em   timestamptz not null default now()
);
create index if not exists idx_push_paciente on public.push_subscriptions (paciente_id);
alter table public.push_subscriptions enable row level security;
-- Sem policy para 'authenticated': acesso apenas via RPC (definer) e service_role.

create table if not exists public.treino_notificacoes (
  treino_id     uuid primary key references public.treinos(id) on delete cascade,
  notificado_em timestamptz
);
alter table public.treino_notificacoes enable row level security;

-- Salva/atualiza a inscrição do aparelho do paciente logado.
create or replace function public.rpc_paciente_salvar_push(
  p_endpoint text, p_p256dh text, p_auth text
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_pac uuid;
begin
  v_pac := public.paciente_do_auth();
  if v_pac is null then raise exception 'sem_paciente'; end if;
  insert into public.push_subscriptions (paciente_id, endpoint, p256dh, auth)
  values (v_pac, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
     set paciente_id = excluded.paciente_id,
         p256dh      = excluded.p256dh,
         auth        = excluded.auth;
end; $$;
grant execute on function public.rpc_paciente_salvar_push(text, text, text) to authenticated;

-- Remove a inscrição de um aparelho.
create or replace function public.rpc_paciente_remover_push(p_endpoint text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint;
end; $$;
grant execute on function public.rpc_paciente_remover_push(text) to authenticated;

-- ===========================================================================
-- FIM
-- ===========================================================================
