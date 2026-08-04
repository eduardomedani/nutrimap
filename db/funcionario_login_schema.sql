-- ===========================================================================
-- Evollo · Financeiro — TERRENO do app do funcionario
-- ---------------------------------------------------------------------------
-- Ainda NAO e o aplicativo. E o que ele vai precisar encontrar pronto no banco:
-- o vinculo conta<->funcionario, as politicas de leitura da propria folha e o
-- lugar onde os PDFs do ponto ficam guardados.
--
-- Mesmo desenho do app do aluno (paciente_login_schema.sql): cada funcionario
-- vira uma conta real no Supabase Auth e se liga ao cadastro por um CODIGO.
-- As politicas do nutri seguem intactas; as do funcionario sao ADICIONADAS, e
-- o Postgres combina politicas permissivas com OR.
--
-- TRES REGRAS QUE O APP TEM QUE HERDAR DAQUI:
--
--   1. O funcionario so enxerga folha FECHADA. Rascunho e numero mudando
--      enquanto o valor ainda esta sendo digitado — ele cobraria explicacao
--      por um valor que ainda nao existe.
--
--   2. Nada de recursao entre politicas. "Ver a folha se ela tem uma linha
--      minha" + "ver a linha se a folha esta fechada" se chamariam em circulo
--      e o Postgres aborta. Por isso as consultas cruzadas passam por funcoes
--      SECURITY DEFINER, que leem sem reativar RLS.
--
--   3. POLITICAS SE SOMAM. Se a mesma pessoa for nutri E funcionario, as duas
--      politicas valem ao mesmo tempo e a consulta devolve tudo o que QUALQUER
--      uma permite. O app do funcionario tem que filtrar por funcionario_id
--      explicitamente na consulta — a policy sozinha nao segura esse caso.
--
-- Requer funcionarios_schema.sql e folha_schema.sql. 100% re-executavel.
-- ===========================================================================


-- ===========================================================================
-- 1) Vinculo conta <-> funcionario
-- ===========================================================================
alter table public.funcionarios
  add column if not exists auth_user_id  uuid references auth.users(id) on delete set null;
alter table public.funcionarios
  add column if not exists codigo_acesso text;

-- Uma conta pertence a um funcionario so.
create unique index if not exists uq_funcionarios_auth_user
  on public.funcionarios (auth_user_id) where auth_user_id is not null;
create index if not exists idx_funcionarios_auth_user
  on public.funcionarios (auth_user_id);

-- O codigo e o segredo do convite: unico no sistema inteiro, nao so por nutri.
create unique index if not exists uq_funcionarios_codigo
  on public.funcionarios (upper(codigo_acesso)) where codigo_acesso is not null;


-- ===========================================================================
-- 2) Gerador de codigo de acesso
-- ---------------------------------------------------------------------------
-- Alfabeto sem 0/O e sem 1/I/L: o codigo vai ser ditado por telefone e escrito
-- a mao, e um zero lido como letra vira suporte.
-- ===========================================================================
create or replace function public.gerar_codigo_funcionario()
returns text
language plpgsql
volatile
as $fn$
declare
  v_alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_codigo text;
  v_tentativa int := 0;
begin
  loop
    v_codigo := '';
    for i in 1..6 loop
      v_codigo := v_codigo || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.funcionarios where upper(codigo_acesso) = v_codigo
    );
    v_tentativa := v_tentativa + 1;
    if v_tentativa > 50 then
      raise exception 'nao consegui gerar codigo unico';
    end if;
  end loop;
  return v_codigo;
end
$fn$;

-- O CODIGO NASCE COM A LINHA. Sem este default, so quem ja estava cadastrado
-- quando o script rodou teria codigo: todo funcionario contratado a partir de
-- hoje ficaria sem convite possivel, e o defeito so apareceria na primeira
-- contratacao — meses depois, com a causa ja esquecida.
alter table public.funcionarios
  alter column codigo_acesso set default public.gerar_codigo_funcionario();

-- E quem ja esta cadastrado ganha o dele agora.
update public.funcionarios
   set codigo_acesso = public.gerar_codigo_funcionario()
 where codigo_acesso is null;


-- ===========================================================================
-- 3) Helpers SECURITY DEFINER
-- ---------------------------------------------------------------------------
-- Leem ignorando RLS — e por isso que nao ha recursao. Cada um devolve so o
-- que diz respeito ao proprio auth.uid(); nenhum aceita id de terceiro como
-- atalho para ver o que nao e seu.
-- ===========================================================================
-- O "bloquear acesso no sistema" do cadastro MORA AQUI. Como toda politica de
-- leitura do colaborador passa por esta funcao — folha, adicionais e os dois
-- buckets do Storage —, devolver NULL para quem esta bloqueado corta o acesso
-- inteiro num lugar so. Espalhar a condicao por sete politicas seria seis
-- chances de esquecer uma.
--
-- Sem isso o interruptor so pintava um selo na tela: o gestor marcava
-- "bloquear", via a confirmacao, e a pessoa continuava entrando no app.
create or replace function public.funcionario_do_auth()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.funcionarios
   where auth_user_id = auth.uid()
     and not acesso_bloqueado
   limit 1;
$$;
grant execute on function public.funcionario_do_auth() to authenticated;

create or replace function public.folha_esta_fechada(p_folha uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.folhas f where f.id = p_folha and f.status = 'fechada');
$$;
grant execute on function public.folha_esta_fechada(uuid) to authenticated;

create or replace function public.folha_tem_linha_minha(p_folha uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.folha_itens i
     where i.folha_id = p_folha
       and i.funcionario_id = public.funcionario_do_auth()
  );
$$;
grant execute on function public.folha_tem_linha_minha(uuid) to authenticated;

create or replace function public.item_e_meu(p_item uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.folha_itens i
      join public.folhas f on f.id = i.folha_id
     where i.id = p_item
       and i.funcionario_id = public.funcionario_do_auth()
       and f.status = 'fechada'
  );
$$;
grant execute on function public.item_e_meu(uuid) to authenticated;


-- ===========================================================================
-- 4) Vinculo por codigo (o "entrar com o codigo que o chefe passou")
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER porque o funcionario ainda NAO tem permissao de ler a
-- tabela: e este RPC que cria o vinculo. Ele so aceita codigo de funcionario
-- ativo e ainda sem conta, e recusa quem ja esta ligado a outro cadastro.
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
grant execute on function public.vincular_funcionario(text) to authenticated;


-- ===========================================================================
-- 5) Politicas de LEITURA do funcionario
-- ---------------------------------------------------------------------------
-- Somadas as do nutri. Nenhuma politica de escrita: no app o funcionario le,
-- nao lanca.
-- ===========================================================================

-- O proprio cadastro.
drop policy if exists funcionarios_self_read on public.funcionarios;
create policy funcionarios_self_read on public.funcionarios
  for select to authenticated
  using (auth_user_id = auth.uid());

-- As folhas FECHADAS em que ele aparece. O status e lido na propria linha
-- (sem subconsulta); quem faz a ponte para folha_itens e a funcao definer.
drop policy if exists folhas_funcionario_read on public.folhas;
create policy folhas_funcionario_read on public.folhas
  for select to authenticated
  using (status = 'fechada' and public.folha_tem_linha_minha(id));

-- A propria linha, so depois da folha fechada.
drop policy if exists folha_itens_funcionario_read on public.folha_itens;
create policy folha_itens_funcionario_read on public.folha_itens
  for select to authenticated
  using (
    funcionario_id = public.funcionario_do_auth()
    and public.folha_esta_fechada(folha_id)
  );

-- Os adicionais da propria linha — com a descricao, que e o que explica o valor.
drop policy if exists folha_adicionais_funcionario_read on public.folha_adicionais;
create policy folha_adicionais_funcionario_read on public.folha_adicionais
  for select to authenticated
  using (public.item_e_meu(item_id));


-- ===========================================================================
-- 6) O PDF do ponto guardado
-- ---------------------------------------------------------------------------
-- Hoje o sistema le o total do PDF e descarta o arquivo. Para o funcionario
-- conferir o proprio ponto, o arquivo precisa sobreviver.
--
-- Alem do caminho, ficam gravados os numeros COMO O PDF DIZIA. `minutos` e o
-- que foi pago e pode ser corrigido a mao; `ponto_minutos` e o que estava no
-- documento. Guardar os dois e o que permite responder "por que pagou
-- diferente do ponto?" um ano depois.
-- ===========================================================================
alter table public.folha_itens add column if not exists ponto_arquivo  text;
alter table public.folha_itens add column if not exists ponto_minutos  integer;
alter table public.folha_itens add column if not exists ponto_noturnas integer;
alter table public.folha_itens add column if not exists ponto_inicio   date;
alter table public.folha_itens add column if not exists ponto_fim      date;

insert into storage.buckets (id, name, public)
values ('ponto', 'ponto', false)
on conflict (id) do nothing;

-- Caminho: <nutri_id>/<funcionario_id>/<arquivo>.pdf
-- A pasta 1 diz de quem e a conta; a pasta 2, de qual funcionario.
drop policy if exists ponto_nutri_all    on storage.objects;
drop policy if exists ponto_func_read    on storage.objects;

create policy ponto_nutri_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'ponto'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'ponto'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy ponto_func_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ponto'
    and (storage.foldername(name))[2] = public.funcionario_do_auth()::text
  );


-- ===========================================================================
-- Conferencia: os 6 com codigo, nenhum vinculado ainda, bucket criado.
-- ===========================================================================
select
  (select count(*) from public.funcionarios where codigo_acesso is not null) as com_codigo,
  (select count(*) from public.funcionarios where auth_user_id is not null)  as ja_vinculados,
  (select count(*) from storage.buckets where id = 'ponto')                  as bucket_ponto;
