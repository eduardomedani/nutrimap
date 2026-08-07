-- ===========================================================================
-- Evollo · SEGURANCA — o dono nao pode se vincular como proprio colaborador
-- ---------------------------------------------------------------------------
-- Os dois caminhos de vinculo (por codigo e por e-mail) validam quatro coisas:
-- se ha sessao, se a conta ja esta vinculada, se o acesso esta bloqueado e se
-- o codigo/e-mail casa com alguem. Nenhum deles pergunta a quinta:
--
--   quem esta chamando e o DONO desse funcionario?
--
-- O DANO NAO E SO DE PERMISSAO. Ao vincular, `auth_user_id` deixa de ser nulo
-- e o codigo e CONSUMIDO — as duas funcoes exigem `auth_user_id is null` para
-- ligar. Um nutri que digite por engano o codigo do proprio colaborador tranca
-- essa pessoa para fora, e nao existe funcao de desvincular no sistema. O
-- conserto seria um UPDATE manual no banco.
--
-- Efeito colateral do vinculo indevido: as policies passam a valer pelos dois
-- lados (`nutri_id = auth.uid()` E `auth_user_id = auth.uid()`), e o app do
-- colaborador abre para o dono mostrando a propria folha como se ele fosse
-- funcionario. Foi isso que fez um teste anterior "passar" sem provar nada.
--
-- ESTADO EM 07/08/2026: o buraco esta aberto e NAO foi usado. As duas contas
-- de profissional do projeto tem zero vinculo como colaborador (conferido em
-- db/conferencia/49_isolamento_entre_contas.sql).
--
-- O que muda: uma checagem a mais em cada funcao, com erro proprio
-- (`codigo_do_proprio_dono` / retorno nulo no caminho por e-mail). Todo o resto
-- do corpo e identico ao que ja estava em db/funcionario_login_schema.sql e
-- db/vinculo_por_email.sql.
--
-- Desfazer: db/vinculo_funcionario_trava_dono_desfazer.sql
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================


-- ===========================================================================
-- 1) Vinculo por CODIGO
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

  -- A TRAVA NOVA. Antes de qualquer outra coisa sobre o codigo: se ele pertence
  -- a um funcionario DESTE nutri, quem chama e o dono, e dono nao e colaborador
  -- de si mesmo. Recusar aqui evita consumir o codigo e trancar a pessoa certa
  -- para fora — o que nao teria desfazer pelo sistema.
  if exists (
    select 1 from public.funcionarios
     where upper(codigo_acesso) = upper(btrim(p_codigo))
       and nutri_id = auth.uid()
  ) then
    raise exception 'codigo_do_proprio_dono';
  end if;

  -- Bloqueado nao liga conta nova: senao bastaria pedir outro codigo para
  -- contornar o bloqueio.
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

  -- O `auth_user_id is null` se repete AQUI de proposito. Entre o select acima
  -- e este update cabe outra chamada com o mesmo codigo: sem esta condicao, a
  -- segunda sobrescreveria o vinculo da primeira, e a pessoa que ligou a conta
  -- antes seria desligada em silencio.
  update public.funcionarios
     set auth_user_id = auth.uid(), atualizado_em = now()
   where id = v_id and auth_user_id is null;

  if not found then
    raise exception 'codigo_invalido';
  end if;

  return v_id;
end
$fn$;

revoke all on function public.vincular_funcionario(text) from public;
grant execute on function public.vincular_funcionario(text) to authenticated;


-- ===========================================================================
-- 2) Vinculo por E-MAIL
-- ---------------------------------------------------------------------------
-- Aqui a recusa e `return null`, nao excecao, para seguir a convencao que a
-- funcao ja usa: o app cai na tela do codigo, que e caminho legitimo. Erro
-- viraria beco sem saida para quem so tem o e-mail coincidente.
-- ===========================================================================
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

  -- Sem confirmacao real, devolve NULL em vez de erro: o app segue para a tela
  -- do codigo, que e um caminho legitimo. Erro aqui viraria beco sem saida.
  if not (v_confirmado and v_enviado) then
    return null;
  end if;

  -- A TRAVA NOVA. Se o e-mail da conta bate com o de um funcionario DESTE
  -- nutri, quem chama e o dono. Devolve nulo em vez de vincular.
  if exists (
    select 1 from public.funcionarios
     where lower(email) = v_email
       and nutri_id = auth.uid()
  ) then
    return null;
  end if;

  select count(*) into v_quantos
    from public.funcionarios
   where lower(email) = v_email
     and ativo
     and not acesso_bloqueado
     and auth_user_id is null;

  -- Dois cadastros com o mesmo e-mail: nao ha como saber qual e a pessoa.
  -- Adivinhar aqui entregaria o holerite errado.
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

  -- A condicao se repete no UPDATE: entre a contagem e a escrita cabe outra
  -- chamada, e sem isso a segunda sobrescreveria o vinculo da primeira.
  update public.funcionarios
     set auth_user_id = auth.uid(), atualizado_em = now()
   where id = v_id and auth_user_id is null;

  if not found then
    return null;
  end if;

  return v_id;
end
$fn$;

revoke all on function public.vincular_funcionario_por_email() from public;
grant execute on function public.vincular_funcionario_por_email() to authenticated;


-- ===========================================================================
-- 3) DESVINCULAR — o que faltava para o engano ter conserto
-- ---------------------------------------------------------------------------
-- Sem isto, um vinculo errado so se desfaz com UPDATE manual no banco. So o
-- DONO do funcionario pode desvincular, e a funcao devolve o e-mail da conta
-- que foi solta, para quem operou saber o que aconteceu.
-- ===========================================================================
create or replace function public.desvincular_funcionario(p_funcionario_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_conta uuid;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'precisa_estar_logado';
  end if;

  select auth_user_id into v_conta
    from public.funcionarios
   where id = p_funcionario_id
     and nutri_id = auth.uid();

  if not found then
    raise exception 'funcionario_de_outro_profissional';
  end if;

  if v_conta is null then
    raise exception 'funcionario_sem_vinculo';
  end if;

  select lower(email) into v_email from auth.users where id = v_conta;

  update public.funcionarios
     set auth_user_id = null, atualizado_em = now()
   where id = p_funcionario_id and nutri_id = auth.uid();

  return coalesce(v_email, v_conta::text);
end
$fn$;

revoke all on function public.desvincular_funcionario(uuid) from public;
grant execute on function public.desvincular_funcionario(uuid) to authenticated;


-- ===========================================================================
-- Conferencia. Esperado: 3 funcoes, e nenhum vinculo indevido no banco.
-- ===========================================================================
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('vincular_funcionario', 'vincular_funcionario_por_email',
                        'desvincular_funcionario'))                       as funcoes,
  (select count(*) from public.funcionarios f
    where f.auth_user_id is not null and f.auth_user_id = f.nutri_id)     as donos_vinculados_como_colaborador;
