-- ===========================================================================
-- Evollo · DOCUMENTOS DO PACIENTE — Etapa 1 (infraestrutura)
-- ---------------------------------------------------------------------------
-- Repositorio de documentos ligados ao PACIENTE: exame, laudo, relatorio,
-- receita, atestado. O profissional guarda; o paciente so ve o que foi
-- explicitamente disponibilizado.
--
-- MOLDE: public.colaborador_documentos (db/colaborador_documentos.sql). Os
-- padroes provados vieram de la — funcao security definer para a policy do
-- Storage, RPC de visualizacao no lugar de UPDATE, policy conferindo a TABELA
-- e nao so a pasta. O que NAO veio, e por que:
--
--   . `atual boolean` — la ele existe para sustentar o indice unico parcial
--     (colaborador, competencia, tipo): um contracheque por mes por pessoa.
--     Aqui nao ha chave natural — um paciente pode ter cinco exames do mesmo
--     tipo no mesmo ano. Sem o indice, `atual` seria um booleano que ninguem
--     tem como garantir. "Foi substituido?" se responde por
--     substitui_documento_id, que e fato, nao flag.
--
--   . `competencia` — documento de paciente nao tem mes de referencia. O que
--     ordena e data_documento (quando o exame foi feito), que pode ser
--     anterior ao upload em meses.
--
--   . `status = 'disponivel'` — la o status carrega disponibilidade. Aqui os
--     tres conceitos sao separados de proposito: status (ativo/arquivado) diz
--     do ciclo de vida do ARQUIVO; visivel_paciente diz da PERMISSAO;
--     visualizado_* diz da LEITURA. Um documento ativo, privado e nao lido e
--     um estado legitimo — juntar os tres esconderia justamente ele.
--
-- Requer: pacientes com auth_user_id e public.paciente_do_auth()
--         (db/paciente_login_schema.sql).
-- 100% re-executavel. Rodar no SQL Editor do Supabase.
-- Desfazer: db/paciente_documentos_desfazer.sql
-- ===========================================================================


-- ===========================================================================
-- 1) A tabela
-- ===========================================================================
create table if not exists public.paciente_documentos (
  id          uuid primary key default gen_random_uuid(),
  nutri_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- restrict, nao cascade: apagar paciente com documento tem que doer. O
  -- arquivo continua no Storage e viraria orfao silencioso.
  paciente_id uuid not null references public.pacientes(id) on delete restrict,

  titulo      text not null,
  descricao   text,
  tipo        text not null default 'outro',

  -- Nome ORIGINAL, como o profissional enviou. O que vai para o Storage e o
  -- nome saneado; este aqui e o que a tela mostra e o download restitui.
  nome_arquivo    text not null,
  caminho_storage text not null,
  mime_type       text not null,
  tamanho_bytes   bigint,
  -- SHA-256 do conteudo: separa "mandou duas vezes por engano" de "o exame foi
  -- refeito". Nao e unico — o mesmo laudo pode valer para dois documentos.
  hash            text,

  -- Quando o documento foi EMITIDO, nao quando subiu. Um exame de marco pode
  -- entrar no sistema em agosto, e a lista precisa ordenar pelo primeiro.
  data_documento date,

  origem text not null default 'upload_profissional',
  status text not null default 'ativo',

  -- ── PERMISSAO ────────────────────────────────────────────────────────────
  -- false por padrao, e isso e regra de negocio, nao preferencia: prontuario
  -- nao publica sozinho. Disponibilizar e ato explicito do profissional.
  visivel_paciente   boolean not null default false,
  disponibilizado_em timestamptz,

  -- ── LEITURA ──────────────────────────────────────────────────────────────
  -- visualizado_em e a PRIMEIRA abertura e nunca se sobrescreve: e ela que
  -- responde "quando o paciente soube". A contagem de aberturas seguintes vive
  -- em metadata->>'acessos', como no modulo do colaborador.
  visualizado_pelo_paciente boolean not null default false,
  visualizado_em            timestamptz,

  -- ── CICLO DE VIDA ────────────────────────────────────────────────────────
  arquivado_em timestamptz,

  -- Substituir arquivo NAO sobrescreve: a linha antiga continua existindo,
  -- porque o paciente pode ja ter aberto e baixado aquela.
  versao                 integer not null default 1,
  substitui_documento_id uuid references public.paciente_documentos(id) on delete set null,

  metadata jsonb not null default '{}'::jsonb,

  criado_em     timestamptz not null default now(),
  criado_por    uuid default auth.uid(),
  atualizado_em timestamptz not null default now()
);

-- Re-execucao em banco que ja tenha a tabela de uma versao anterior.
alter table public.paciente_documentos add column if not exists descricao        text;
alter table public.paciente_documentos add column if not exists tamanho_bytes    bigint;
alter table public.paciente_documentos add column if not exists hash             text;
alter table public.paciente_documentos add column if not exists data_documento   date;
alter table public.paciente_documentos add column if not exists visivel_paciente boolean not null default false;
alter table public.paciente_documentos add column if not exists disponibilizado_em timestamptz;
alter table public.paciente_documentos add column if not exists visualizado_pelo_paciente boolean not null default false;
alter table public.paciente_documentos add column if not exists visualizado_em   timestamptz;
alter table public.paciente_documentos add column if not exists arquivado_em     timestamptz;
alter table public.paciente_documentos add column if not exists versao           integer not null default 1;
alter table public.paciente_documentos add column if not exists substitui_documento_id uuid;
alter table public.paciente_documentos add column if not exists metadata         jsonb not null default '{}'::jsonb;
alter table public.paciente_documentos add column if not exists atualizado_em    timestamptz not null default now();


-- ---------------------------------------------------------------------------
-- Tipos. Extensivel por CHECK: acrescentar "plano_complementar" e editar esta
-- lista, nao criar tabela de tipos.
-- ---------------------------------------------------------------------------
alter table public.paciente_documentos drop constraint if exists pd_tipo_check;
alter table public.paciente_documentos add  constraint pd_tipo_check
  check (tipo in (
    'exame',
    'laudo',
    'relatorio',
    'orientacao',
    'prescricao',
    'receita',
    'avaliacao',
    'termo',
    'declaracao',
    'atestado',
    'outro'
  ));

-- gerado_sistema ja entra aqui, mas nada o produz nesta etapa. Deixar o CHECK
-- pronto evita migration so para acrescentar um valor quando o relatorio de
-- evolucao comecar a virar documento.
alter table public.paciente_documentos drop constraint if exists pd_origem_check;
alter table public.paciente_documentos add  constraint pd_origem_check
  check (origem in ('upload_profissional', 'gerado_sistema'));

-- Ciclo de vida do ARQUIVO. Disponibilidade nao entra aqui — e visivel_paciente.
alter table public.paciente_documentos drop constraint if exists pd_status_check;
alter table public.paciente_documentos add  constraint pd_status_check
  check (status in ('ativo', 'arquivado'));

alter table public.paciente_documentos drop constraint if exists pd_versao_check;
alter table public.paciente_documentos add  constraint pd_versao_check
  check (versao >= 1);

-- Coerencia entre a permissao e o carimbo: disponibilizado_em existe se, e so
-- se, o documento esta (ou ja esteve) visivel. Sem isto, "remover do app"
-- poderia apagar a data e perder quando o paciente teve acesso.
alter table public.paciente_documentos drop constraint if exists pd_disponibilizado_check;
alter table public.paciente_documentos add  constraint pd_disponibilizado_check
  check (not visivel_paciente or disponibilizado_em is not null);

-- Arquivado e visivel ao mesmo tempo seria contradicao: arquivar TIRA do app.
alter table public.paciente_documentos drop constraint if exists pd_arquivado_check;
alter table public.paciente_documentos add  constraint pd_arquivado_check
  check (arquivado_em is null or not visivel_paciente);

-- Um caminho no Storage pertence a um documento so. Sem isto, duas linhas
-- apontando para o mesmo objeto fariam a exclusao de uma deixar a outra
-- pendurada num arquivo que nao existe mais.
create unique index if not exists uniq_pd_caminho
  on public.paciente_documentos (caminho_storage);


-- ---------------------------------------------------------------------------
-- Indices
-- ---------------------------------------------------------------------------
create index if not exists idx_pd_paciente
  on public.paciente_documentos (paciente_id, data_documento desc nulls last, criado_em desc);

create index if not exists idx_pd_nutri
  on public.paciente_documentos (nutri_id, criado_em desc);

-- A consulta do PWA: so o que esta disponivel e nao arquivado.
create index if not exists idx_pd_visiveis
  on public.paciente_documentos (paciente_id, disponibilizado_em desc)
  where visivel_paciente and arquivado_em is null;

-- "Nao visualizados" e um dos filtros do painel.
create index if not exists idx_pd_nao_lidos
  on public.paciente_documentos (nutri_id, paciente_id)
  where visivel_paciente and not visualizado_pelo_paciente and arquivado_em is null;

create index if not exists idx_pd_substitui
  on public.paciente_documentos (substitui_documento_id)
  where substitui_documento_id is not null;


-- ===========================================================================
-- 2) O arquivo e deste paciente, e ele pode ve-lo?
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER porque a policy do STORAGE precisa consultar esta tabela, e
-- fazer isso por subconsulta reativaria o RLS dela em cadeia.
--
-- Confere o CAMINHO EXATO, nao o prefixo nem a pasta. A pasta 2 do caminho ja
-- e conferida pela policy, mas sozinha ela so prova "esta na arvore do
-- paciente X" — nao prova que aquele objeto tem registro ativo, disponivel e
-- nao arquivado. Um arquivo que sobrou de um upload interrompido mora na
-- arvore certa e nao deve abrir.
--
-- A funcao so responde sobre o proprio auth.uid(): passar o caminho de outro
-- paciente devolve false, porque paciente_do_auth() e de quem chama.
-- ===========================================================================
create or replace function public.documento_do_paciente_e_meu(p_caminho text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.paciente_documentos d
     where d.caminho_storage = p_caminho
       and d.paciente_id = public.paciente_do_auth()
       and d.visivel_paciente
       and d.status = 'ativo'
       and d.arquivado_em is null
  );
$$;

-- ACL explicita: esta migration NAO depende dos default privileges do schema
-- public, que no Supabase concedem EXECUTE a anon em toda funcao nova.
revoke all on function public.documento_do_paciente_e_meu(text) from public;
revoke all on function public.documento_do_paciente_e_meu(text) from anon;
grant execute on function public.documento_do_paciente_e_meu(text) to authenticated;


-- ===========================================================================
-- 3) Marcar como visualizado
-- ---------------------------------------------------------------------------
-- O paciente NAO tem update na tabela. Se tivesse, teria como mexer em
-- visivel_paciente, caminho_storage e status — ou seja, se autopublicar um
-- documento privado. Esta funcao escreve tres campos, e so na linha dele.
--
-- Devolve boolean: `found` e false quando o documento nao e dele, esta privado
-- ou foi arquivado. A tela nao precisa saber qual dos tres — para ela, o
-- documento simplesmente nao existe.
-- ===========================================================================
create or replace function public.marcar_documento_paciente_visualizado(p_documento uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_eu uuid;
begin
  v_eu := public.paciente_do_auth();
  if v_eu is null then
    return false;
  end if;

  update public.paciente_documentos
     set visualizado_pelo_paciente = true,
         -- coalesce: a PRIMEIRA visualizacao nao se sobrescreve. E ela que
         -- responde "quando o paciente soube", e o que mede o tempo ate a
         -- primeira abertura.
         visualizado_em = coalesce(visualizado_em, now()),
         -- As aberturas seguintes viram contador, como no modulo do
         -- colaborador. Sem coluna nova para um numero que ninguem consulta
         -- linha a linha.
         metadata = jsonb_set(
           metadata, '{acessos}',
           to_jsonb(coalesce((metadata->>'acessos')::int, 0) + 1), true),
         atualizado_em = now()
   where id = p_documento
     and paciente_id = v_eu
     and visivel_paciente
     and status = 'ativo'
     and arquivado_em is null;

  return found;
end
$fn$;

revoke all on function public.marcar_documento_paciente_visualizado(uuid) from public;
revoke all on function public.marcar_documento_paciente_visualizado(uuid) from anon;
grant execute on function public.marcar_documento_paciente_visualizado(uuid) to authenticated;


-- ===========================================================================
-- 4) RLS
-- ===========================================================================
alter table public.paciente_documentos enable row level security;

drop policy if exists pd_nutri_select    on public.paciente_documentos;
drop policy if exists pd_nutri_insert    on public.paciente_documentos;
drop policy if exists pd_nutri_update    on public.paciente_documentos;
drop policy if exists pd_nutri_delete    on public.paciente_documentos;
drop policy if exists pd_paciente_select on public.paciente_documentos;

create policy pd_nutri_select on public.paciente_documentos
  for select to authenticated
  using (nutri_id = auth.uid());

-- O exists() amarra o documento a um paciente DA PROPRIA carteira. Sem ele,
-- `nutri_id = auth.uid()` sozinho deixaria gravar documento no prontuario de
-- paciente de outro profissional, bastando mandar o paciente_id dele.
create policy pd_nutri_insert on public.paciente_documentos
  for insert to authenticated
  with check (
    nutri_id = auth.uid()
    and exists (
      select 1 from public.pacientes p
       where p.id = paciente_id and p.nutri_id = auth.uid())
  );

create policy pd_nutri_update on public.paciente_documentos
  for update to authenticated
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

create policy pd_nutri_delete on public.paciente_documentos
  for delete to authenticated
  using (nutri_id = auth.uid());

-- O paciente LE, e so o que foi disponibilizado a ele. Nenhuma politica de
-- escrita: a unica alteracao que ele provoca passa pela RPC de visualizacao.
create policy pd_paciente_select on public.paciente_documentos
  for select to authenticated
  using (
    paciente_id = public.paciente_do_auth()
    and visivel_paciente
    and status = 'ativo'
    and arquivado_em is null
  );


-- ===========================================================================
-- 5) Storage
-- ---------------------------------------------------------------------------
-- Caminho: {nutri_id}/{paciente_id}/{AAAA}/{documento_id}/{arquivo}
-- A pasta 1 diz de quem e a conta; a pasta 2, de qual paciente; a pasta 4
-- isola cada documento, para substituir arquivo nunca sobrescrever a versao
-- anterior no mesmo lugar.
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'paciente-documentos',
  'paciente-documentos',
  false,                                    -- NUNCA true: documento clinico
  15728640,                                 -- 15 MB, o mesmo teto do projeto
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists pd_storage_nutri    on storage.objects;
drop policy if exists pd_storage_paciente on storage.objects;

create policy pd_storage_nutri on storage.objects
  for all to authenticated
  using (
    bucket_id = 'paciente-documentos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'paciente-documentos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- SELECT e so. Sem insert, update ou delete para o paciente: no bucket ele le,
-- e nada mais. E a leitura passa pela TABELA, nao so pela pasta — documento
-- privado, arquivado ou removido do app deixa de abrir mesmo que ele tenha
-- guardado o caminho de uma URL assinada antiga.
create policy pd_storage_paciente on storage.objects
  for select to authenticated
  using (
    bucket_id = 'paciente-documentos'
    and (storage.foldername(name))[2] = public.paciente_do_auth()::text
    and public.documento_do_paciente_e_meu(name)
  );


-- ===========================================================================
-- 6) Auditoria
-- ---------------------------------------------------------------------------
-- Escrita por GATILHO, nao pelo codigo da tela. Um insert espalhado por cada
-- ponto de acao seria esquecido no primeiro caminho novo — e o registro que
-- falta e sempre o do dia em que alguem precisou dele.
--
-- Tabela propria, e nao a public.documento_auditoria do modulo do colaborador:
-- aquela tem colaborador_id como coluna real, com indices e RLS montados para
-- ela. Juntar as duas seria alterar um modulo que nao esta em obra. Se um dia
-- valer a pena unificar, e acrescentar paciente_id la e migrar estas linhas.
-- ===========================================================================
create table if not exists public.paciente_documento_auditoria (
  id           uuid primary key default gen_random_uuid(),
  nutri_id     uuid not null,
  documento_id uuid,
  paciente_id  uuid,
  acao         text not null,
  usuario_id   uuid,
  criado_em    timestamptz not null default now(),
  metadata     jsonb not null default '{}'::jsonb
);

create index if not exists idx_pda_documento
  on public.paciente_documento_auditoria (documento_id, criado_em desc);
create index if not exists idx_pda_nutri
  on public.paciente_documento_auditoria (nutri_id, criado_em desc);
create index if not exists idx_pda_paciente
  on public.paciente_documento_auditoria (paciente_id, criado_em desc);


create or replace function public.registrar_auditoria_documento_paciente()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_acao text;
  v_meta jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    v_acao := case when new.visivel_paciente
                   then 'documento_criado_e_disponibilizado'
                   else 'documento_criado' end;

  elsif tg_op = 'DELETE' then
    -- Antes da linha sumir: e o unico momento em que ainda se sabe qual
    -- arquivo ela apontava.
    insert into public.paciente_documento_auditoria
      (nutri_id, documento_id, paciente_id, acao, usuario_id, metadata)
    values (old.nutri_id, old.id, old.paciente_id, 'documento_excluido', auth.uid(),
            jsonb_build_object('tipo', old.tipo, 'titulo', old.titulo,
                               'caminho', old.caminho_storage));
    return old;

  else
    -- UPDATE. So o que muda de verdade vira registro: um update que nao mexeu
    -- em nada relevante nao polui o historico.
    if old.visivel_paciente is distinct from new.visivel_paciente then
      v_acao := case when new.visivel_paciente
                     then 'documento_disponibilizado'
                     else 'documento_removido_do_app' end;

    elsif old.visualizado_pelo_paciente is distinct from new.visualizado_pelo_paciente
          and new.visualizado_pelo_paciente then
      v_acao := 'documento_visualizado_pelo_paciente';

    elsif old.arquivado_em is distinct from new.arquivado_em then
      v_acao := case when new.arquivado_em is null
                     then 'documento_reativado'
                     else 'documento_arquivado' end;

    elsif old.caminho_storage is distinct from new.caminho_storage then
      v_acao := 'arquivo_substituido';
      v_meta := jsonb_build_object('caminho_anterior', old.caminho_storage,
                                   'versao', new.versao);

    elsif (old.titulo, old.descricao, old.tipo, old.data_documento)
          is distinct from (new.titulo, new.descricao, new.tipo, new.data_documento) then
      v_acao := 'informacoes_editadas';

    else
      -- Contador de acessos e atualizado_em nao sao evento.
      return new;
    end if;
  end if;

  insert into public.paciente_documento_auditoria
    (nutri_id, documento_id, paciente_id, acao, usuario_id, metadata)
  values (new.nutri_id, new.id, new.paciente_id, v_acao, auth.uid(),
          v_meta || jsonb_build_object('tipo', new.tipo, 'titulo', new.titulo));

  return new;
end
$fn$;

-- Funcao de GATILHO: ninguem a chama direto, entao nao recebe grant nenhum.
-- O Postgres so exige EXECUTE em CREATE TRIGGER, que roda como dono.
revoke all on function public.registrar_auditoria_documento_paciente() from public;
revoke all on function public.registrar_auditoria_documento_paciente() from anon;
revoke all on function public.registrar_auditoria_documento_paciente() from authenticated;

drop trigger if exists trg_auditoria_documento_paciente on public.paciente_documentos;
create trigger trg_auditoria_documento_paciente
  after insert or update or delete on public.paciente_documentos
  for each row execute function public.registrar_auditoria_documento_paciente();


-- O log e do profissional. O paciente nao le auditoria — nem a propria: ela
-- carrega titulo e tipo de documento que podem ter sido arquivados justamente
-- para sairem da vista dele.
alter table public.paciente_documento_auditoria enable row level security;

drop policy if exists pda_nutri_select on public.paciente_documento_auditoria;
create policy pda_nutri_select on public.paciente_documento_auditoria
  for select to authenticated
  using (nutri_id = auth.uid());

-- Nenhuma policy de INSERT: quem escreve e o gatilho, que roda como definer.
-- Ninguem edita o proprio log.


-- ===========================================================================
-- 7) atualizado_em
-- ===========================================================================
create or replace function public.tocar_paciente_documento()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.atualizado_em := now();
  return new;
end
$fn$;

-- Gatilho, como a de auditoria: sem grant para ninguem.
revoke all on function public.tocar_paciente_documento() from public;
revoke all on function public.tocar_paciente_documento() from anon;
revoke all on function public.tocar_paciente_documento() from authenticated;

drop trigger if exists trg_tocar_paciente_documento on public.paciente_documentos;
create trigger trg_tocar_paciente_documento
  before update on public.paciente_documentos
  for each row execute function public.tocar_paciente_documento();


-- ===========================================================================
-- Conferencia: a tabela nasce vazia, o bucket existe e e privado.
-- ===========================================================================
select
  (select count(*) from public.paciente_documentos)                     as documentos,
  (select count(*) from public.paciente_documento_auditoria)            as auditoria,
  (select count(*) from storage.buckets
    where id = 'paciente-documentos')                                   as bucket,
  (select public from storage.buckets
    where id = 'paciente-documentos')                                   as bucket_publico,
  (select file_size_limit from storage.buckets
    where id = 'paciente-documentos')                                   as limite_bytes,
  (select array_to_string(allowed_mime_types, ', ') from storage.buckets
    where id = 'paciente-documentos')                                   as mimes;
