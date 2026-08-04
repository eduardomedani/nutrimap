-- ===========================================================================
-- Evollo · App do colaborador — VINCULO AUTOMATICO POR E-MAIL
-- ---------------------------------------------------------------------------
-- A pessoa cria a conta com o mesmo e-mail que esta na ficha dela e ja entra,
-- sem digitar codigo. O codigo continua existindo para quem nao tem e-mail no
-- cadastro ou preferiu usar outro.
--
-- POR QUE ISTO PRECISA DE E-MAIL CONFIRMADO:
-- sem confirmacao, qualquer um que saiba o e-mail da Aline cria uma conta com
-- ele e recebe o holerite dela. A prova de que a pessoa e dona daquele e-mail e
-- ter aberto a caixa de entrada — e e so isso que separa "conveniencia" de
-- "porta aberta".
--
-- COMO A CONFIRMACAO E VERIFICADA, E POR QUE DOIS CAMPOS:
--   . email_confirmed_at  — quando o e-mail foi dado como confirmado;
--   . confirmation_sent_at — quando o e-mail de confirmacao foi ENVIADO.
--
-- Se o projeto estiver com "Confirm email" DESLIGADO, o Supabase preenche
-- email_confirmed_at sozinho no cadastro e nenhuma mensagem e enviada. Checar
-- so o primeiro campo passaria em todo mundo e a trava nao existiria. Exigir os
-- dois significa "houve um e-mail de verdade, e ele foi respondido".
--
-- CONSEQUENCIA PRATICA: com a confirmacao desligada no projeto, este vinculo
-- NUNCA acontece e todo mundo cai no codigo. E de proposito — falhar para o
-- caminho seguro, nao para o cômodo.
-- Conferir em: Authentication > Sign In / Providers > Email > Confirm email.
--
-- Requer funcionario_login_schema.sql. 100% re-executavel.
-- ===========================================================================

create or replace function public.vincular_funcionario_por_email()
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_email     text;
  v_confirmado boolean;
  v_enviado    boolean;
  v_id        uuid;
  v_quantos   int;
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

grant execute on function public.vincular_funcionario_por_email() to authenticated;


-- ===========================================================================
-- Conferencia. `confirmacao_ligada` diz se o vinculo por e-mail vai funcionar:
-- 0 significa que nenhuma conta passou por confirmacao de verdade — ligue
-- "Confirm email" em Authentication > Sign In / Providers > Email.
-- `com_email` e quantos funcionarios tem e-mail na ficha (os candidatos).
-- ===========================================================================
select
  (select count(*) from auth.users where confirmation_sent_at is not null) as confirmacao_ligada,
  (select count(*) from public.funcionarios where email is not null and ativo) as com_email;
