-- ===========================================================================
-- Evollo · ARQUIVOS DA COMPETENCIA — presencas e espelho de ponto
-- ---------------------------------------------------------------------------
-- 100% re-executavel. Desfazer: db/folha_arquivos_desfazer.sql
--
-- POR QUE UMA TABELA NOVA, E NAO `colaborador_documentos`.
-- Aquela exige `colaborador_id not null`: todo documento la tem dono, e o
-- colaborador o ve no proprio app. Estes dois arquivos nao tem dono — o
-- relatorio de presencas fala dos ALUNOS, e o espelho de ponto fala da equipe
-- INTEIRA numa aba por pessoa. Enfia-los la exigiria escolher um colaborador
-- arbitrario, que veria no proprio app um arquivo com o ponto dos colegas.
--
-- `documentos_pendentes` tambem nao serve: ela e a fila de PDFs de ponto
-- esperando dono, e o que esta ali e sempre de alguem — so nao se sabe de quem
-- ainda. Estes nunca serao de ninguem.
--
-- ===========================================================================
-- O STORAGE NAO PRECISA DE NADA NOVO
-- ---------------------------------------------------------------------------
-- A policy `cd_storage_nutri` do bucket `colaborador-documentos` ja exige o
-- que importa:
--
--   (storage.foldername(name))[1] = organizacao_do_auth()::text
--   tem_permissao('equipe.folha')
--
-- O caminho destes arquivos e `{organizacao}/_mes/{AAAA-MM}/{tipo}-{hora}.xlsx`.
-- O `_mes` no segundo nivel nao colide com nada: o padrao dos documentos de
-- colaborador poe o uuid dele ali, e uuid nao comeca com underline.
--
-- ===========================================================================
-- REIMPORTAR NAO SOBRESCREVE
-- ---------------------------------------------------------------------------
-- Quem reimporta costuma estar corrigindo — exportou o mes errado, ou o
-- arquivo veio truncado. Mas as vezes esta so conferindo, e apagar o anterior
-- nesse caso perderia o arquivo que gerou o bonus JA PAGO.
--
-- Entao a versao antiga vira `atual = false` e fica. O indice unico e PARCIAL
-- (`where atual`), o que garante um arquivo corrente por tipo e por mes sem
-- impedir o historico.
-- ===========================================================================

create table if not exists public.folha_arquivos (
  id        uuid primary key default gen_random_uuid(),
  nutri_id  uuid not null default public.organizacao_do_auth(),

  -- O MES, e nao a folha. O arquivo existe antes de a folha ser aberta — quem
  -- importa em 01/09 para conferir ainda nao criou a folha de setembro — e
  -- continua existindo se a folha for apagada e refeita.
  competencia date not null,

  tipo text not null check (tipo in ('presencas', 'ponto')),

  nome_arquivo    text not null,
  caminho_storage text not null,
  mime_type       text not null default
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  tamanho_bytes   bigint,
  -- SHA-256 do conteudo. E o que distingue "mandou duas vezes por engano" de
  -- "exportou de novo porque o dado mudou".
  hash text,

  -- O QUE O ARQUIVO PRODUZIU, guardado junto. Sem isto, mostrar "1.063
  -- presencas, 84 alunos" na tela exigiria baixar e reprocessar o xlsx a cada
  -- abertura da folha — e o resumo e justamente o que se olha para saber se o
  -- arquivo certo foi importado.
  resumo jsonb not null default '{}'::jsonb,

  atual boolean not null default true,

  criado_em  timestamptz not null default now(),
  -- AUTOR, nao dono: `auth.uid()` e a pessoa; `nutri_id` e a organizacao.
  criado_por uuid default auth.uid()
);

alter table public.folha_arquivos add column if not exists resumo jsonb not null default '{}'::jsonb;
alter table public.folha_arquivos add column if not exists atual boolean not null default true;

-- Um corrente por tipo e por mes. Parcial, para o historico caber ao lado.
drop index if exists uniq_folha_arquivo_atual;
create unique index uniq_folha_arquivo_atual
  on public.folha_arquivos (nutri_id, competencia, tipo)
  where atual;

create index if not exists idx_folha_arquivos_comp
  on public.folha_arquivos (nutri_id, competencia, tipo);


-- ---------------------------------------------------------------------------
-- RLS — a mesma chave da folha
-- ---------------------------------------------------------------------------
-- `equipe.folha` e nao `equipe.visualizar`: quem ve estes arquivos ve o ponto
-- da equipe inteira e a carteira de alunos por tabela. E a mesma exigencia de
-- `comercial_alunos_por_turno`, pelo mesmo motivo.
--
-- SEM POLICY DE DELETE. Apagar o arquivo que gerou um bonus ja pago e o tipo
-- de coisa que ninguem faz de proposito — reimportar ja resolve o caso real,
-- deixando o anterior como historico. Se um dia for preciso, a policy entra
-- aqui e nao numa gambiarra de tela.
alter table public.folha_arquivos enable row level security;

drop policy if exists folha_arquivos_select on public.folha_arquivos;
drop policy if exists folha_arquivos_insert on public.folha_arquivos;
drop policy if exists folha_arquivos_update on public.folha_arquivos;

create policy folha_arquivos_select on public.folha_arquivos
  for select to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  );

create policy folha_arquivos_insert on public.folha_arquivos
  for insert to authenticated
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  );

-- O update existe para marcar `atual = false` na versao anterior. Nada mais
-- muda aqui: arquivo importado e fato consumado.
create policy folha_arquivos_update on public.folha_arquivos
  for update to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  )
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  );


-- ===========================================================================
-- Conferencia. Esperado:
--   rls = true · policies = 3 (select, insert, update) · delete = 0
--   indice unico parcial presente
-- ===========================================================================
select
  (select relrowsecurity from pg_class where oid = 'public.folha_arquivos'::regclass) as rls,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'folha_arquivos')                     as policies,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'folha_arquivos' and cmd = 'DELETE')  as policies_delete,
  (select count(*) from pg_indexes
    where schemaname = 'public' and indexname = 'uniq_folha_arquivo_atual')           as indice_parcial;
