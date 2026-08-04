-- ===========================================================================
-- Evollo · DOCUMENTOS — etapa 2
-- ---------------------------------------------------------------------------
-- Duas peças que a etapa 1 deixou de fora:
--
--   1. PENDENTES DE VINCULO — o PDF importado que nao casou com ninguem.
--      Ate aqui ele era so reportado na tela e descartado: o arquivo se perdia
--      e a pessoa tinha que reimportar depois de corrigir o cadastro.
--
--   2. AUDITORIA — quem fez o que com cada documento. Holerite tem valor
--      probatorio; "esse contracheque mudou" sem dizer quando e por quem e uma
--      discussao sem arbitro.
--
-- POR QUE PENDENTE NAO E UM DOCUMENTO COM colaborador_id NULO:
-- a regra de ouro do repositorio e que todo documento pertence a alguem. Abrir
-- excecao para o caso pendente enfraqueceria essa garantia em TODA consulta —
-- cada uma passaria a precisar de "and colaborador_id is not null". O pendente
-- fica numa sala de espera propria e so vira documento quando tem dono.
--
-- Requer colaborador_documentos.sql. 100% re-executavel.
-- ===========================================================================


-- ===========================================================================
-- 1) Sala de espera dos arquivos sem dono
-- ===========================================================================
create table if not exists public.documentos_pendentes (
  id         uuid primary key default gen_random_uuid(),
  nutri_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,

  competencia    date not null,
  tipo_documento text not null default 'folha_ponto',

  nome_arquivo    text not null,
  caminho_storage text not null,
  mime_type       text not null default 'application/pdf',
  tamanho_bytes   bigint,
  hash            text,

  -- O que o arquivo dizia sobre quem ele e. E com isto que a tela sugere o
  -- colaborador e explica por que nao achou sozinha.
  cpf_lido    text,
  nome_lido   text,
  motivo      text,
  sugestao_id uuid references public.funcionarios(id) on delete set null,

  status text not null default 'aguardando_vinculo',

  criado_em     timestamptz not null default now(),
  criado_por    uuid default auth.uid(),
  resolvido_em  timestamptz,
  documento_id  uuid references public.colaborador_documentos(id) on delete set null,

  metadata jsonb not null default '{}'::jsonb
);

alter table public.documentos_pendentes add column if not exists cpf_lido     text;
alter table public.documentos_pendentes add column if not exists nome_lido    text;
alter table public.documentos_pendentes add column if not exists motivo       text;
alter table public.documentos_pendentes add column if not exists sugestao_id  uuid;
alter table public.documentos_pendentes add column if not exists resolvido_em timestamptz;
alter table public.documentos_pendentes add column if not exists documento_id uuid;
alter table public.documentos_pendentes add column if not exists metadata     jsonb not null default '{}'::jsonb;

alter table public.documentos_pendentes drop constraint if exists dp_status_check;
alter table public.documentos_pendentes add  constraint dp_status_check
  check (status in ('aguardando_vinculo', 'vinculado', 'ignorado'));

alter table public.documentos_pendentes drop constraint if exists dp_competencia_check;
alter table public.documentos_pendentes add  constraint dp_competencia_check
  check (extract(day from competencia) = 1);

create index if not exists idx_dp_nutri
  on public.documentos_pendentes (nutri_id, status, competencia desc);

-- O mesmo arquivo, na mesma competencia, nao entra duas vezes na fila.
create unique index if not exists uniq_dp_hash
  on public.documentos_pendentes (nutri_id, competencia, hash)
  where hash is not null and status = 'aguardando_vinculo';


-- ===========================================================================
-- 2) Auditoria
-- ---------------------------------------------------------------------------
-- Escrita por GATILHO, nao pelo codigo da tela. Um insert espalhado por cada
-- ponto de acao seria esquecido no primeiro caminho novo — e o registro que
-- falta e sempre o do dia em que alguem precisou dele.
-- ===========================================================================
create table if not exists public.documento_auditoria (
  id             uuid primary key default gen_random_uuid(),
  nutri_id       uuid not null,
  documento_id   uuid,
  colaborador_id uuid,
  acao           text not null,
  usuario_id     uuid,
  criado_em      timestamptz not null default now(),
  metadata       jsonb not null default '{}'::jsonb
);

create index if not exists idx_da_documento
  on public.documento_auditoria (documento_id, criado_em desc);
create index if not exists idx_da_nutri
  on public.documento_auditoria (nutri_id, criado_em desc);


create or replace function public.registrar_auditoria_documento()
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
    v_acao := case new.origem
                when 'importado' then 'documento_importado'
                else 'documento_gerado' end;
    if new.versao > 1 then
      v_acao := 'nova_versao_gerada';
      v_meta := jsonb_build_object('versao', new.versao, 'substitui', new.substitui_documento_id);
    end if;

  elsif tg_op = 'UPDATE' then
    -- Uma acao por mudanca relevante. Ordem importa: arquivar e o evento mais
    -- forte, e visualizar e o mais frequente.
    if new.arquivado_em is not null and old.arquivado_em is null then
      v_acao := 'documento_arquivado';
    elsif new.arquivado_em is null and old.arquivado_em is not null then
      v_acao := 'documento_reativado';
    elsif new.visualizado_pelo_colaborador and not old.visualizado_pelo_colaborador then
      v_acao := 'documento_visualizado';
    elsif new.atual = false and old.atual = true then
      v_acao := 'versao_substituida';
      v_meta := jsonb_build_object('versao', old.versao);
    elsif new.status is distinct from old.status then
      v_acao := 'status_alterado';
      v_meta := jsonb_build_object('de', old.status, 'para', new.status);
    else
      -- Nada que valha registro. Salvar a linha sem mudar nada relevante
      -- encheria o log de ruido e esconderia os eventos que importam.
      return new;
    end if;

  elsif tg_op = 'DELETE' then
    insert into public.documento_auditoria
      (nutri_id, documento_id, colaborador_id, acao, usuario_id, metadata)
    values (old.nutri_id, old.id, old.colaborador_id, 'documento_excluido', auth.uid(),
            jsonb_build_object('competencia', old.competencia, 'tipo', old.tipo_documento,
                               'caminho', old.caminho_storage));
    return old;
  end if;

  insert into public.documento_auditoria
    (nutri_id, documento_id, colaborador_id, acao, usuario_id, metadata)
  values (new.nutri_id, new.id, new.colaborador_id, v_acao, auth.uid(),
          v_meta || jsonb_build_object('competencia', new.competencia, 'tipo', new.tipo_documento));

  return new;
end
$fn$;

drop trigger if exists trg_auditoria_documento on public.colaborador_documentos;
create trigger trg_auditoria_documento
  after insert or update or delete on public.colaborador_documentos
  for each row execute function public.registrar_auditoria_documento();


-- ===========================================================================
-- 3) Vincular um pendente a um colaborador
-- ---------------------------------------------------------------------------
-- Move o arquivo para a pasta certa e cria o documento. E RPC porque as duas
-- coisas precisam acontecer juntas: metade feita deixaria arquivo na pasta do
-- colaborador sem registro, ou registro apontando para a pasta errada.
--
-- O arquivo em si e movido pela TELA (a API de Storage nao e alcancavel de
-- dentro do Postgres); esta funcao recebe o caminho novo ja gravado e cuida do
-- que e transacional: criar o documento e fechar a pendencia.
-- ===========================================================================
create or replace function public.vincular_documento_pendente(
  p_pendente       uuid,
  p_colaborador    uuid,
  p_caminho_novo   text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  p       public.documentos_pendentes%rowtype;
  v_doc   uuid;
  v_atual public.colaborador_documentos%rowtype;
  v_versao int := 1;
begin
  select * into p from public.documentos_pendentes
   where id = p_pendente and nutri_id = auth.uid() and status = 'aguardando_vinculo';
  if not found then
    raise exception 'pendencia_nao_encontrada';
  end if;

  if not exists (select 1 from public.funcionarios
                  where id = p_colaborador and nutri_id = auth.uid()) then
    raise exception 'colaborador_invalido';
  end if;

  select * into v_atual from public.colaborador_documentos
   where colaborador_id = p_colaborador
     and competencia = p.competencia
     and tipo_documento = p.tipo_documento
     and atual;
  if found then
    v_versao := v_atual.versao + 1;
  end if;

  insert into public.colaborador_documentos
    (nutri_id, colaborador_id, competencia, tipo_documento, titulo,
     nome_arquivo, caminho_storage, mime_type, tamanho_bytes, hash,
     origem, status, versao, atual, substitui_documento_id, disponibilizado_em, metadata)
  values
    (auth.uid(), p_colaborador, p.competencia, p.tipo_documento, 'Folha de ponto',
     p.nome_arquivo, p_caminho_novo, p.mime_type, p.tamanho_bytes, p.hash,
     'importado', 'disponivel', v_versao, true,
     case when v_atual.id is not null then v_atual.id else null end,
     now(),
     p.metadata || jsonb_build_object('vinculado_manualmente', true, 'pendencia_id', p.id))
  returning id into v_doc;

  if v_atual.id is not null then
    update public.colaborador_documentos
       set atual = false, atualizado_em = now()
     where id = v_atual.id;
  end if;

  update public.documentos_pendentes
     set status = 'vinculado', resolvido_em = now(), documento_id = v_doc
   where id = p_pendente;

  return v_doc;
end
$fn$;
grant execute on function public.vincular_documento_pendente(uuid, uuid, text) to authenticated;


-- ===========================================================================
-- 4) RLS
-- ---------------------------------------------------------------------------
-- Pendencia e auditoria sao do PAINEL. O colaborador nao tem nada aqui: um
-- arquivo sem dono definido pode ser de outra pessoa, e o log de acoes revela
-- o movimento da equipe inteira.
-- ===========================================================================
alter table public.documentos_pendentes enable row level security;
alter table public.documento_auditoria  enable row level security;

drop policy if exists dp_nutri_all on public.documentos_pendentes;
create policy dp_nutri_all on public.documentos_pendentes
  for all to authenticated
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

drop policy if exists da_nutri_select on public.documento_auditoria;
create policy da_nutri_select on public.documento_auditoria
  for select to authenticated
  using (nutri_id = auth.uid());

-- Sem policy de insert/update/delete: quem escreve e o GATILHO, que roda como
-- definer. Ninguem edita o proprio log.


-- ===========================================================================
-- 5) Storage — a sala de espera fica numa pasta separada
-- ---------------------------------------------------------------------------
-- Caminho: {nutri_id}/_pendentes/{competencia}/{arquivo}
-- A pasta 2 nao e um colaborador, entao a policy de leitura do colaborador
-- (que compara a pasta 2 com o proprio id) nunca casa aqui. E o que garante
-- que um arquivo ainda sem dono nao apareca para ninguem.
-- ===========================================================================
-- (a policy cd_storage_nutri de colaborador_documentos.sql ja cobre a escrita:
--  ela vale para todo o bucket, conferindo so a pasta 1 = auth.uid())


-- ===========================================================================
-- Conferencia: as duas tabelas nascem vazias.
-- ===========================================================================
select
  (select count(*) from public.documentos_pendentes)  as pendentes,
  (select count(*) from public.documento_auditoria)   as auditoria;
