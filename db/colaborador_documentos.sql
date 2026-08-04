-- ===========================================================================
-- Evollo · REPOSITORIO DE DOCUMENTOS DO COLABORADOR
-- ---------------------------------------------------------------------------
-- Ate aqui o documento nao era uma entidade: era um par de colunas em
-- folha_itens (ponto_arquivo, contracheque_arquivo). Isso limitava a dois
-- documentos por linha de folha, sem versao, sem status e sem historico — e
-- nao havia onde por ferias, advertencia ou informe de rendimentos.
--
-- Agora cada documento e uma linha propria, ligada ao COLABORADOR e a
-- COMPETENCIA. O tipo e extensivel: acrescentar "recibo_ferias" e editar um
-- CHECK, nao criar tabela nova.
--
-- MIGRACAO: nenhuma. As colunas antigas nunca chegaram a ser preenchidas — a
-- conferencia mostrou 0 arquivos em todas as 31 competencias. Elas ficam onde
-- estao (nada destrutivo) mas param de ser escritas; a fonte da verdade passa
-- a ser esta tabela. `ponto_minutos`, `ponto_inicio` e `ponto_fim` continuam
-- valendo: sao APURACAO, nao ponteiro de arquivo.
--
-- Requer funcionarios_schema.sql, folha_schema.sql e funcionario_login_schema.
-- 100% re-executavel. Rodar no SQL Editor do Supabase.
-- ===========================================================================


-- ===========================================================================
-- 1) A tabela
-- ===========================================================================
create table if not exists public.colaborador_documentos (
  id             uuid primary key default gen_random_uuid(),
  nutri_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  colaborador_id uuid not null references public.funcionarios(id) on delete restrict,

  competencia    date not null,
  tipo_documento text not null,
  titulo         text,
  descricao      text,

  nome_arquivo    text not null,
  caminho_storage text not null,
  mime_type       text not null,
  tamanho_bytes   bigint,
  -- SHA-256 do conteudo. E o que distingue "mandou duas vezes por engano" de
  -- "o valor mudou e o documento foi refeito".
  hash            text,

  origem text not null default 'gerado_sistema',
  status text not null default 'disponivel',

  -- Versao: regerar NAO sobrescreve. A anterior vira atual=false e continua
  -- existindo, porque o colaborador pode ja ter visto e impresso aquela.
  versao                 integer not null default 1,
  atual                  boolean not null default true,
  substitui_documento_id uuid references public.colaborador_documentos(id) on delete set null,

  disponibilizado_em           timestamptz default now(),
  visualizado_pelo_colaborador boolean not null default false,
  visualizado_em               timestamptz,
  arquivado_em                 timestamptz,

  metadata jsonb not null default '{}'::jsonb,

  criado_em     timestamptz not null default now(),
  criado_por    uuid default auth.uid(),
  atualizado_em timestamptz not null default now()
);

alter table public.colaborador_documentos add column if not exists titulo          text;
alter table public.colaborador_documentos add column if not exists descricao       text;
alter table public.colaborador_documentos add column if not exists tamanho_bytes   bigint;
alter table public.colaborador_documentos add column if not exists hash            text;
alter table public.colaborador_documentos add column if not exists versao          integer not null default 1;
alter table public.colaborador_documentos add column if not exists atual           boolean not null default true;
alter table public.colaborador_documentos add column if not exists substitui_documento_id uuid;
alter table public.colaborador_documentos add column if not exists disponibilizado_em timestamptz default now();
alter table public.colaborador_documentos add column if not exists visualizado_pelo_colaborador boolean not null default false;
alter table public.colaborador_documentos add column if not exists visualizado_em  timestamptz;
alter table public.colaborador_documentos add column if not exists arquivado_em    timestamptz;
alter table public.colaborador_documentos add column if not exists metadata        jsonb not null default '{}'::jsonb;
alter table public.colaborador_documentos add column if not exists atualizado_em   timestamptz not null default now();


-- ---------------------------------------------------------------------------
-- Tipos. A lista ja contempla o que vem depois: acrescentar um tipo e editar
-- este CHECK, nao criar estrutura nova.
-- ---------------------------------------------------------------------------
alter table public.colaborador_documentos drop constraint if exists cd_tipo_check;
alter table public.colaborador_documentos add  constraint cd_tipo_check
  check (tipo_documento in (
    'contracheque',
    'folha_ponto',
    'comprovante_ferias',
    'aviso_ferias',
    'recibo_ferias',
    'comprovante_pagamento',
    'informe_rendimentos',
    'comunicado',
    'advertencia',
    'documento_admissional',
    'personalizado'
  ));

alter table public.colaborador_documentos drop constraint if exists cd_origem_check;
alter table public.colaborador_documentos add  constraint cd_origem_check
  check (origem in ('gerado_sistema', 'importado', 'enviado_manual'));

alter table public.colaborador_documentos drop constraint if exists cd_status_check;
alter table public.colaborador_documentos add  constraint cd_status_check
  check (status in ('rascunho', 'processando', 'disponivel', 'erro', 'arquivado'));

-- Competencia e sempre o primeiro dia do mes. Sem isso, "agosto" viraria 31
-- datas diferentes e nenhum agrupamento fecharia.
alter table public.colaborador_documentos drop constraint if exists cd_competencia_check;
alter table public.colaborador_documentos add  constraint cd_competencia_check
  check (extract(day from competencia) = 1);

alter table public.colaborador_documentos drop constraint if exists cd_versao_check;
alter table public.colaborador_documentos add  constraint cd_versao_check
  check (versao >= 1);


-- ---------------------------------------------------------------------------
-- Indices
-- ---------------------------------------------------------------------------
-- Uma versao atual por colaborador/competencia/tipo. As antigas convivem com
-- atual = false.
create unique index if not exists uniq_cd_atual
  on public.colaborador_documentos (colaborador_id, competencia, tipo_documento)
  where atual;

create index if not exists idx_cd_colaborador
  on public.colaborador_documentos (colaborador_id, competencia desc, tipo_documento);

create index if not exists idx_cd_nutri
  on public.colaborador_documentos (nutri_id, competencia desc);

create index if not exists idx_cd_hash
  on public.colaborador_documentos (colaborador_id, tipo_documento, hash)
  where hash is not null;


-- ===========================================================================
-- 2) O documento e visivel ao colaborador?
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER porque a policy do STORAGE precisa consultar esta tabela, e
-- fazer isso por subconsulta reativaria o RLS dela em cadeia. A funcao so
-- responde sobre o proprio auth.uid(): nao serve de atalho para ver o alheio.
-- ===========================================================================
create or replace function public.documento_e_meu(p_caminho text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.colaborador_documentos d
     where d.caminho_storage = p_caminho
       and d.colaborador_id = public.funcionario_do_auth()
       and d.status = 'disponivel'
       and d.arquivado_em is null
  );
$$;
grant execute on function public.documento_e_meu(text) to authenticated;


-- ===========================================================================
-- 3) Marcar como visualizado
-- ---------------------------------------------------------------------------
-- O colaborador NAO tem update na tabela — se tivesse, teria como mexer em
-- status, versao e caminho. Esta funcao escreve so os tres campos de leitura,
-- e so na linha dele.
-- ===========================================================================
create or replace function public.marcar_documento_visualizado(p_documento uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_eu uuid;
begin
  v_eu := public.funcionario_do_auth();
  if v_eu is null then
    return false;
  end if;

  update public.colaborador_documentos
     set visualizado_pelo_colaborador = true,
         -- Primeira visualizacao nao se sobrescreve: e ela que responde
         -- "quando ele soube".
         visualizado_em = coalesce(visualizado_em, now()),
         metadata = jsonb_set(
           metadata, '{acessos}',
           to_jsonb(coalesce((metadata->>'acessos')::int, 0) + 1), true),
         atualizado_em = now()
   where id = p_documento
     and colaborador_id = v_eu
     and status = 'disponivel'
     and arquivado_em is null;

  return found;
end
$fn$;
grant execute on function public.marcar_documento_visualizado(uuid) to authenticated;


-- ===========================================================================
-- 4) RLS
-- ===========================================================================
alter table public.colaborador_documentos enable row level security;

drop policy if exists cd_nutri_select on public.colaborador_documentos;
drop policy if exists cd_nutri_insert on public.colaborador_documentos;
drop policy if exists cd_nutri_update on public.colaborador_documentos;
drop policy if exists cd_nutri_delete on public.colaborador_documentos;
drop policy if exists cd_colaborador_select on public.colaborador_documentos;

create policy cd_nutri_select on public.colaborador_documentos
  for select to authenticated
  using (nutri_id = auth.uid());

create policy cd_nutri_insert on public.colaborador_documentos
  for insert to authenticated
  with check (
    nutri_id = auth.uid()
    and exists (
      select 1 from public.funcionarios u
       where u.id = colaborador_id and u.nutri_id = auth.uid())
  );

create policy cd_nutri_update on public.colaborador_documentos
  for update to authenticated
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

create policy cd_nutri_delete on public.colaborador_documentos
  for delete to authenticated
  using (nutri_id = auth.uid());

-- O colaborador LE, e so o que esta disponivel e nao arquivado. Nenhuma
-- politica de escrita: a unica alteracao que ele provoca passa pela funcao
-- marcar_documento_visualizado().
create policy cd_colaborador_select on public.colaborador_documentos
  for select to authenticated
  using (
    colaborador_id = public.funcionario_do_auth()
    and status = 'disponivel'
    and arquivado_em is null
  );


-- ===========================================================================
-- 5) Storage
-- ---------------------------------------------------------------------------
-- Caminho: {nutri_id}/{colaborador_id}/{AAAA-MM}/{tipo_documento}/{arquivo}
-- A pasta 1 diz de quem e a conta; a pasta 2, de qual colaborador.
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('colaborador-documentos', 'colaborador-documentos', false)
on conflict (id) do nothing;

drop policy if exists cd_storage_nutri on storage.objects;
drop policy if exists cd_storage_colaborador on storage.objects;

create policy cd_storage_nutri on storage.objects
  for all to authenticated
  using (
    bucket_id = 'colaborador-documentos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'colaborador-documentos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- A leitura do colaborador passa pela TABELA, nao so pela pasta: documento
-- arquivado ou ainda em rascunho deixa de abrir mesmo que ele guarde o link.
create policy cd_storage_colaborador on storage.objects
  for select to authenticated
  using (
    bucket_id = 'colaborador-documentos'
    and (storage.foldername(name))[2] = public.funcionario_do_auth()::text
    and public.documento_e_meu(name)
  );


-- ===========================================================================
-- 6) Visao de conferencia por competencia
-- ===========================================================================
-- security_invoker: sem isto a view rodaria com os privilegios de quem a criou
-- e ignoraria o RLS de colaborador_documentos.
create or replace view public.documentos_por_competencia
with (security_invoker = on) as
select
  d.nutri_id,
  d.competencia,
  d.tipo_documento,
  count(*) filter (where d.atual and d.status = 'disponivel')      as disponiveis,
  count(*) filter (where d.visualizado_pelo_colaborador)           as visualizados,
  count(*) filter (where d.status = 'erro')                        as com_erro,
  count(*) filter (where d.arquivado_em is not null)               as arquivados
from public.colaborador_documentos d
group by d.nutri_id, d.competencia, d.tipo_documento;


-- ===========================================================================
-- Conferencia: a tabela nasce vazia e o bucket existe.
-- ===========================================================================
select
  (select count(*) from public.colaborador_documentos)                        as documentos,
  (select count(*) from storage.buckets where id = 'colaborador-documentos')  as bucket;
