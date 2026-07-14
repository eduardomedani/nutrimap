-- ===========================================================================
-- NutriMap · Login do PACIENTE (v1: ver treino + registrar progressao de carga)
-- ---------------------------------------------------------------------------
-- Modelo: cada paciente vira uma conta real no Supabase Auth (email+senha) e
-- se VINCULA ao registro em public.pacientes pelo CODIGO (mesmo segredo ja
-- usado no questionario). O vinculo fica em pacientes.auth_user_id.
--
-- Seguranca: as politicas do NUTRI continuam intactas (nutri_id = auth.uid()).
-- Aqui adicionamos politicas de LEITURA para o PACIENTE (o Postgres combina
-- politicas permissivas com OR). Escritas de carga vao por RPC SECURITY DEFINER
-- que grava o nutri_id CORRETO (o do nutri dono do treino) — assim o painel do
-- nutri continua enxergando tudo.
--
-- 100% re-executavel. Rodar no SQL Editor do Supabase (projeto jdtplud...).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) Vinculo conta<->paciente
-- ---------------------------------------------------------------------------
alter table public.pacientes
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

-- Uma conta so pode estar ligada a um paciente.
create unique index if not exists uq_pacientes_auth_user
  on public.pacientes (auth_user_id) where auth_user_id is not null;
create index if not exists idx_pacientes_auth_user
  on public.pacientes (auth_user_id);


-- ---------------------------------------------------------------------------
-- 2) Helper: qual paciente e o usuario logado?
-- SECURITY DEFINER de proposito: le pacientes ignorando RLS (sem recursao),
-- mas so devolve a linha do proprio auth.uid() — nao vaza nada de terceiros.
-- ---------------------------------------------------------------------------
create or replace function public.paciente_do_auth()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.pacientes where auth_user_id = auth.uid() limit 1;
$$;
grant execute on function public.paciente_do_auth() to authenticated;


-- ---------------------------------------------------------------------------
-- 3) Politicas de LEITURA do paciente (adicionadas as do nutri, via OR)
-- ---------------------------------------------------------------------------

-- pacientes: le o proprio registro (nome, codigo, status)
drop policy if exists pacientes_self_read on public.pacientes;
create policy pacientes_self_read on public.pacientes
  for select to authenticated
  using (auth_user_id = auth.uid());

-- treinos: le os proprios treinos
drop policy if exists treinos_paciente_read on public.treinos;
create policy treinos_paciente_read on public.treinos
  for select to authenticated
  using (paciente_id = public.paciente_do_auth());

-- treino_exercicios: le os itens dos proprios treinos
drop policy if exists te_paciente_read on public.treino_exercicios;
create policy te_paciente_read on public.treino_exercicios
  for select to authenticated
  using (treino_id in (
    select id from public.treinos where paciente_id = public.paciente_do_auth()
  ));

-- exercicios: le SOMENTE os exercicios que aparecem nos proprios treinos
-- (nao expoe a biblioteca inteira do nutri)
drop policy if exists exercicios_paciente_read on public.exercicios;
create policy exercicios_paciente_read on public.exercicios
  for select to authenticated
  using (id in (
    select te.exercicio_id
      from public.treino_exercicios te
      join public.treinos t on t.id = te.treino_id
     where t.paciente_id = public.paciente_do_auth()
  ));

-- treino_progressao: le a propria progressao
drop policy if exists tp_paciente_read on public.treino_progressao;
create policy tp_paciente_read on public.treino_progressao
  for select to authenticated
  using (treino_exercicio_id in (
    select te.id
      from public.treino_exercicios te
      join public.treinos t on t.id = te.treino_id
     where t.paciente_id = public.paciente_do_auth()
  ));


-- ---------------------------------------------------------------------------
-- 4) RPCs (escritas do paciente) — SECURITY DEFINER, validam a posse
-- ---------------------------------------------------------------------------

-- Vincula a conta logada a um paciente pelo codigo (idempotente).
create or replace function public.rpc_vincular_paciente(p_codigo text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- ja vinculado a esta conta? devolve o mesmo id (idempotente)
  select id into v_id from public.pacientes where auth_user_id = auth.uid() limit 1;
  if v_id is not null then
    return v_id;
  end if;

  -- acha o paciente pelo codigo, ainda sem conta
  select id into v_id
    from public.pacientes
   where upper(codigo) = upper(trim(p_codigo))
     and auth_user_id is null
   limit 1;

  if v_id is null then
    raise exception 'codigo_invalido_ou_ja_vinculado';
  end if;

  update public.pacientes set auth_user_id = auth.uid() where id = v_id;
  return v_id;
end;
$$;
grant execute on function public.rpc_vincular_paciente(text) to authenticated;


-- Paciente registra a carga realizada de um item do PROPRIO treino.
-- Grava o nutri_id CORRETO (o dono do treino), nao o auth.uid() do paciente.
create or replace function public.rpc_paciente_registrar_progressao(
  p_treino_exercicio_id uuid,
  p_data                date,
  p_carga               numeric,
  p_reps                smallint,
  p_obs                 text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pac   uuid;
  v_nutri uuid;
  v_id    uuid;
begin
  v_pac := public.paciente_do_auth();
  if v_pac is null then
    raise exception 'sem_paciente';
  end if;

  -- confirma que o item pertence a um treino do paciente e pega o nutri dono
  select t.nutri_id into v_nutri
    from public.treino_exercicios te
    join public.treinos t on t.id = te.treino_id
   where te.id = p_treino_exercicio_id
     and t.paciente_id = v_pac;

  if v_nutri is null then
    raise exception 'item_nao_pertence_ao_paciente';
  end if;

  insert into public.treino_progressao
    (nutri_id, treino_exercicio_id, data, carga_realizada, reps_realizadas, observacao)
  values
    (v_nutri, p_treino_exercicio_id, coalesce(p_data, current_date),
     p_carga, p_reps, nullif(trim(p_obs), ''))
  returning id into v_id;

  return v_id;
end;
$$;
grant execute on function public.rpc_paciente_registrar_progressao(uuid, date, numeric, smallint, text) to authenticated;


-- Paciente exclui um registro de progressao que ele mesmo lancou.
create or replace function public.rpc_paciente_excluir_progressao(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pac uuid;
  v_ok  int;
begin
  v_pac := public.paciente_do_auth();
  if v_pac is null then
    raise exception 'sem_paciente';
  end if;

  delete from public.treino_progressao tp
   using public.treino_exercicios te, public.treinos t
   where tp.id = p_id
     and te.id = tp.treino_exercicio_id
     and t.id  = te.treino_id
     and t.paciente_id = v_pac;

  get diagnostics v_ok = row_count;
  return v_ok > 0;
end;
$$;
grant execute on function public.rpc_paciente_excluir_progressao(uuid) to authenticated;

-- ===========================================================================
-- FIM
-- ===========================================================================
