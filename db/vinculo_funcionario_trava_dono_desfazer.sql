-- ===========================================================================
-- Evollo · DESFAZER — a trava do dono no vinculo de colaborador
-- ---------------------------------------------------------------------------
-- Devolve as duas funcoes de vinculo ao corpo original (sem a checagem de
-- dono) e remove a funcao de desvincular.
--
-- PENSE ANTES DE RODAR. Sem a trava, o dono volta a poder consumir o codigo do
-- proprio colaborador — e, como `desvincular_funcionario` sai junto, o engano
-- deixa de novo de ter conserto pelo sistema.
--
-- Se o que quebrou foi um caso legitimo (alguem que e dono E colaborador de
-- verdade, o que existe em estudio pequeno onde o socio tambem da aula), o
-- conserto certo NAO e remover a trava: e criar um segundo cadastro de
-- funcionario com e-mail proprio, ou soltar o vinculo pela
-- desvincular_funcionario e ligar pela conta certa.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

create or replace function public.vincular_funcionario(p_codigo text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'precisa_estar_logado';
  end if;

  if exists (select 1 from public.funcionarios where auth_user_id = auth.uid()) then
    raise exception 'conta_ja_vinculada';
  end if;

  if exists (
    select 1 from public.funcionarios
     where upper(codigo_acesso) = upper(btrim(p_codigo)) and acesso_bloqueado
  ) then
    raise exception 'acesso_bloqueado';
  end if;

  select id into v_id
    from public.funcionarios
   where upper(codigo_acesso) = upper(btrim(p_codigo))
     and ativo
     and not acesso_bloqueado
     and auth_user_id is null
   limit 1;

  if v_id is null then
    raise exception 'codigo_invalido';
  end if;

  update public.funcionarios
     set auth_user_id = auth.uid(), atualizado_em = now()
   where id = v_id and auth_user_id is null;

  if not found then
    raise exception 'codigo_invalido';
  end if;

  return v_id;
end
$fn$;
grant execute on function public.vincular_funcionario(text) to authenticated;


create or replace function public.vincular_funcionario_por_email()
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_email      text;
  v_confirmado boolean;
  v_enviado    boolean;
  v_id         uuid;
  v_quantos    int;
begin
  if auth.uid() is null then
    raise exception 'precisa_estar_logado';
  end if;

  if exists (select 1 from public.funcionarios where auth_user_id = auth.uid()) then
    raise exception 'conta_ja_vinculada';
  end if;

  select lower(u.email),
         u.email_confirmed_at is not null,
         u.confirmation_sent_at is not null
    into v_email, v_confirmado, v_enviado
    from auth.users u
   where u.id = auth.uid();

  if v_email is null then
    return null;
  end if;

  if not (v_confirmado and v_enviado) then
    return null;
  end if;

  select count(*) into v_quantos
    from public.funcionarios
   where lower(email) = v_email
     and ativo
     and not acesso_bloqueado
     and auth_user_id is null;

  if v_quantos <> 1 then
    return null;
  end if;

  select id into v_id
    from public.funcionarios
   where lower(email) = v_email
     and ativo
     and not acesso_bloqueado
     and auth_user_id is null
   limit 1;

  update public.funcionarios
     set auth_user_id = auth.uid(), atualizado_em = now()
   where id = v_id and auth_user_id is null;

  if not found then
    return null;
  end if;

  return v_id;
end
$fn$;
grant execute on function public.vincular_funcionario_por_email() to authenticated;


drop function if exists public.desvincular_funcionario(uuid);


-- Conferencia: devolve 2 (a de desvincular saiu).
select count(*) as funcoes
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('vincular_funcionario', 'vincular_funcionario_por_email',
                    'desvincular_funcionario');
