-- ===========================================================================
-- NutriMap · Admin de convites (SaaS — o dono controla os cadastros)
-- ---------------------------------------------------------------------------
-- Cria uma tabela public.admins (quem pode gerar códigos) e RPCs SECURITY
-- DEFINER protegidas por admin_is(): só quem está em admins consegue gerar,
-- listar ou (des)ativar códigos de convite. Nenhum nutri comum consegue.
--
-- Reaproveita as tabelas/funções que já existem: codigos_convite, codigos_uso,
-- validar_codigo_convite, registrar_uso_codigo. Nada disso é alterado.
--
-- Re-executável. Rodar no SQL Editor do Supabase.
-- ===========================================================================

-- 1) Quem é admin (dono da plataforma)
create table if not exists public.admins (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);
alter table public.admins enable row level security;
-- (sem policy p/ authenticated => ninguém lê direto; só as funções DEFINER acessam)

-- BOOTSTRAP: marca o dono como admin (precisa já ter conta criada).
insert into public.admins (user_id)
select id from auth.users where lower(email) = lower('eduardomedani@gmail.com')
on conflict (user_id) do nothing;

-- 2) Helper: o usuário logado é admin?
create or replace function public.admin_is()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.admin_is() to authenticated;

-- 3) Gerar um código de convite (só admin). Código em branco => gera aleatório.
create or replace function public.admin_gerar_codigo(
  p_codigo      text,
  p_descricao   text,
  p_usos_maximo int,
  p_expira_em   timestamptz
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_cod text;
begin
  if not public.admin_is() then raise exception 'nao_autorizado'; end if;

  v_cod := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  if v_cod is null then
    v_cod := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  end if;

  insert into public.codigos_convite (codigo, descricao, ativo, usos_atuais, usos_maximo, expira_em)
  values (v_cod, nullif(trim(p_descricao), ''), true, 0, coalesce(p_usos_maximo, 1), p_expira_em);

  return v_cod;
end;
$$;
grant execute on function public.admin_gerar_codigo(text, text, int, timestamptz) to authenticated;

-- 4) Listar todos os códigos (só admin). Retorna cada linha como JSON
-- (assim não dependemos de saber todas as colunas da tabela).
create or replace function public.admin_listar_codigos()
returns setof jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_is() then raise exception 'nao_autorizado'; end if;
  return query select to_jsonb(c) from public.codigos_convite c;
end;
$$;
grant execute on function public.admin_listar_codigos() to authenticated;

-- 5) Ativar/desativar um código (só admin)
create or replace function public.admin_definir_ativo(p_id uuid, p_ativo boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_is() then raise exception 'nao_autorizado'; end if;
  update public.codigos_convite set ativo = coalesce(p_ativo, false) where id = p_id;
  return found;
end;
$$;
grant execute on function public.admin_definir_ativo(uuid, boolean) to authenticated;

-- ===========================================================================
-- FIM
-- ===========================================================================
