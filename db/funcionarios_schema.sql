-- ===========================================================================
-- Evollo · Financeiro (Fase 1) — Tabela: funcionarios
-- ---------------------------------------------------------------------------
-- Cadastro da equipe. E a primeira peca do modulo financeiro: folha, custos e
-- comissoes vao todos apontar para uma linha daqui, entao o cadastro nasce
-- antes de qualquer valor em dinheiro.
--
-- ESTA VERSAO E SO CADASTRAL. Nenhuma coluna de remuneracao (salario, comissao,
-- chave Pix, vinculo CLT/PJ) mora aqui — isso entra numa tabela propria depois,
-- referenciando funcionarios(id). Manter os dois separados evita que um reajuste
-- de salario reescreva a linha que guarda o CPF da pessoa.
--
-- Espelha o que o sistema antigo (Go Up) mostrava na tela "Editar usuario":
-- dados principais, unidade + perfil de acesso, endereco.
--
-- Padrao do projeto: PK uuid, nutri_id default auth.uid(), criado_em em PT-BR,
-- RLS por nutri_id, `ativo` como desligamento suave.
--
-- So estrutura, sem INSERT (os 6 da equipe vem em funcionarios_seed.sql).
-- 100% re-executavel. Rodar no SQL Editor do Supabase.
-- ===========================================================================

create table if not exists public.funcionarios (
  id                uuid primary key default gen_random_uuid(),
  nutri_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,

  nome              text not null,
  -- cpf e telefone entram so com digitos; a mascara e assunto de tela.
  -- documento = RG ou matricula, como vinha do sistema antigo.
  cpf               text,
  documento         text,
  data_nascimento   date,
  sexo              text,

  email             text,
  telefone          text,

  -- conselho de classe: CREF, CRN, CRM...
  conselho_tipo     text,
  conselho_numero   text,

  -- unidade = academia/filial; cargo = o "perfil de acesso" do sistema antigo.
  unidade           text,
  cargo             text,

  cep               text,
  logradouro        text,
  numero            text,
  complemento       text,
  bairro            text,
  cidade            text,
  uf                text,

  -- acesso_bloqueado = o toggle "bloquear acesso no sistema" da ficha antiga.
  -- ativo = false e desligamento suave: some da lista, o historico fica.
  acesso_bloqueado  boolean not null default false,
  ativo             boolean not null default true,
  observacoes       text,

  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  criado_por        uuid default auth.uid()
);

alter table public.funcionarios add column if not exists nutri_id          uuid;
alter table public.funcionarios add column if not exists nome              text;
alter table public.funcionarios add column if not exists cpf               text;
alter table public.funcionarios add column if not exists documento         text;
alter table public.funcionarios add column if not exists data_nascimento   date;
alter table public.funcionarios add column if not exists sexo              text;
alter table public.funcionarios add column if not exists email             text;
alter table public.funcionarios add column if not exists telefone          text;
alter table public.funcionarios add column if not exists conselho_tipo     text;
alter table public.funcionarios add column if not exists conselho_numero   text;
alter table public.funcionarios add column if not exists unidade           text;
alter table public.funcionarios add column if not exists cargo             text;
alter table public.funcionarios add column if not exists cep               text;
alter table public.funcionarios add column if not exists logradouro        text;
alter table public.funcionarios add column if not exists numero            text;
alter table public.funcionarios add column if not exists complemento       text;
alter table public.funcionarios add column if not exists bairro            text;
alter table public.funcionarios add column if not exists cidade            text;
alter table public.funcionarios add column if not exists uf                text;
alter table public.funcionarios add column if not exists acesso_bloqueado  boolean not null default false;
alter table public.funcionarios add column if not exists ativo             boolean not null default true;
alter table public.funcionarios add column if not exists observacoes       text;
alter table public.funcionarios add column if not exists criado_em         timestamptz not null default now();
alter table public.funcionarios add column if not exists atualizado_em     timestamptz not null default now();
alter table public.funcionarios add column if not exists criado_por        uuid default auth.uid();

-- CPF guardado sem pontuacao: e assim que ele serve de chave. A tela formata
-- na exibicao; o banco recusa qualquer coisa que nao sejam 11 digitos.
alter table public.funcionarios drop constraint if exists funcionarios_cpf_check;
alter table public.funcionarios add  constraint funcionarios_cpf_check
  check (cpf is null or cpf ~ '^[0-9]{11}$');

alter table public.funcionarios drop constraint if exists funcionarios_sexo_check;
alter table public.funcionarios add  constraint funcionarios_sexo_check
  check (sexo is null or sexo in ('feminino', 'masculino', 'outro'));

alter table public.funcionarios drop constraint if exists funcionarios_nome_check;
alter table public.funcionarios add  constraint funcionarios_nome_check
  check (length(btrim(nome)) > 0);

-- Duas linhas com o mesmo CPF sao a mesma pessoa cadastrada duas vezes — e o
-- estrago aparece depois, na folha, em dobro. O indice e parcial porque CPF
-- em branco e permitido (e varios em branco nao se conflitam entre si).
create unique index if not exists uniq_funcionarios_cpf
  on public.funcionarios (nutri_id, cpf) where cpf is not null;

create index if not exists idx_funcionarios_nutri
  on public.funcionarios (nutri_id, ativo, nome);


-- ===========================================================================
-- RLS — cada profissional so enxerga a propria equipe.
-- ===========================================================================
alter table public.funcionarios enable row level security;

drop policy if exists funcionarios_select on public.funcionarios;
drop policy if exists funcionarios_insert on public.funcionarios;
drop policy if exists funcionarios_update on public.funcionarios;
drop policy if exists funcionarios_delete on public.funcionarios;

create policy funcionarios_select on public.funcionarios
  for select to authenticated
  using (nutri_id = auth.uid());

create policy funcionarios_insert on public.funcionarios
  for insert to authenticated
  with check (nutri_id = auth.uid());

create policy funcionarios_update on public.funcionarios
  for update to authenticated
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

create policy funcionarios_delete on public.funcionarios
  for delete to authenticated
  using (nutri_id = auth.uid());


-- ===========================================================================
-- Conferencia: deve voltar 0 (a tabela nasce vazia).
-- ===========================================================================
select count(*) as funcionarios from public.funcionarios;
