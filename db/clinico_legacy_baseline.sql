-- ===========================================================================
-- BASELINE DE OBJETOS JA EXISTENTES NO SUPABASE
-- NAO E MIGRATION. NAO EXECUTE ESTE ARQUIVO CEGAMENTE.
-- ---------------------------------------------------------------------------
-- As quatro tabelas clinicas legadas, retrato de 11/08/2026, extraido por
-- db/conferencia/69_legacy_tabelas.sql:
--
--   avaliacoes         antropometria e composicao corporal
--   respostas          o questionario de anamnese, por modulo
--   exames             anexos de exame
--   recordatorio_calc  cache do calculo do recordatorio
--
-- ESTAO JUNTAS PORQUE COMPARTILHAM O DESENHO DE PROPRIEDADE, e e ele que
-- importa para a Etapa 2:
--
--   avaliacoes         tem nutri_id proprio -> nutricionistas(id)
--   respostas          NAO tem nutri_id: deriva por join em pacientes
--   exames             NAO tem nutri_id: deriva por join em pacientes
--   recordatorio_calc  NAO tem nutri_id: deriva por join em pacientes
--
-- As tres que derivam por join migram DE GRACA quando public.pacientes migrar:
-- basta trocar o predicado dentro do EXISTS, num lugar por tabela. E o achado
-- mais barato do diagnostico da Etapa 1.
-- ===========================================================================


-- ===========================================================================
-- avaliacoes
-- ===========================================================================
create table if not exists public.avaliacoes (
  id                       uuid not null default gen_random_uuid(),
  paciente_id              uuid not null,
  nutri_id                 uuid not null,
  numero                   integer not null,
  data_avaliacao           date not null default CURRENT_DATE,
  sexo                     text,
  idade                    integer,
  peso                     numeric(5,2),
  altura                   numeric(4,2),
  fator_atividade          numeric(4,3) default 1.2,
  pct_gordura_ideal        numeric(4,3) default 0.12,
  protocolo                text,
  dc_peitoral              numeric(4,1),
  dc_axilar_media          numeric(4,1),
  dc_subescapular          numeric(4,1),
  dc_tricipital            numeric(4,1),
  dc_biciptal              numeric(4,1),
  dc_crista_iliaca         numeric(4,1),
  dc_supra_iliaca          numeric(4,1),
  dc_abdominal             numeric(4,1),
  dc_coxa                  numeric(4,1),
  dc_panturrilha           numeric(4,1),
  per_torax                numeric(5,1),
  per_braco_direito        numeric(5,1),
  per_braco_esquerdo       numeric(5,1),
  per_abdomen              numeric(5,1),
  per_cintura              numeric(5,1),
  per_quadril              numeric(5,1),
  per_coxa_direita         numeric(5,1),
  per_coxa_esquerda        numeric(5,1),
  per_panturrilha_direita  numeric(5,1),
  per_panturrilha_esquerda numeric(5,1),
  imc                      numeric(5,2),
  pct_gordura              numeric(4,3),
  peso_gordura             numeric(5,2),
  peso_magro               numeric(5,2),
  peso_ideal               numeric(5,2),
  peso_excesso             numeric(5,2),
  pccq                     numeric(4,3),
  tmb                      numeric(6,1),
  get_kcal                 numeric(6,1),
  observacoes              text,
  criado_em                timestamp with time zone default now(),
  atualizado_em            timestamp with time zone default now()
);

alter table public.avaliacoes drop constraint if exists avaliacoes_pkey;
alter table public.avaliacoes add  constraint avaliacoes_pkey primary key (id);

alter table public.avaliacoes drop constraint if exists avaliacoes_paciente_id_numero_key;
alter table public.avaliacoes add  constraint avaliacoes_paciente_id_numero_key
  unique (paciente_id, numero);

alter table public.avaliacoes drop constraint if exists avaliacoes_paciente_id_fkey;
alter table public.avaliacoes add  constraint avaliacoes_paciente_id_fkey
  foreign key (paciente_id) references public.pacientes(id) on delete cascade;

alter table public.avaliacoes drop constraint if exists avaliacoes_nutri_id_fkey;
alter table public.avaliacoes add  constraint avaliacoes_nutri_id_fkey
  foreign key (nutri_id) references public.nutricionistas(id) on delete cascade;

create index if not exists idx_avaliacoes_nutri    on public.avaliacoes using btree (nutri_id);
create index if not exists idx_avaliacoes_paciente on public.avaliacoes using btree (paciente_id);

alter table public.avaliacoes enable row level security;

-- ACHADO DE DIAGNOSTICO - NAO CORRIGIDO NESTA ETAPA: `to public` inclui anon.
drop policy if exists "Nutri ve proprias avaliacoes" on public.avaliacoes;
create policy "Nutri ve proprias avaliacoes" on public.avaliacoes
  for all to public
  using (auth.uid() = nutri_id)
  with check (auth.uid() = nutri_id);

-- ---------------------------------------------------------------------------
-- TRIGGER LEGADO, versionado aqui pela primeira vez.
-- ---------------------------------------------------------------------------
-- A FUNCAO set_atualizado_em() NAO e criada neste arquivo: ela ja existe
-- versionada em db/foods_schema.sql. Duplica-la criaria duas fontes para a
-- mesma definicao, e a segunda venceria em silencio.
--
-- O que este bloco torna visivel e a DEPENDENCIA: um gatilho de tabela legada
-- que chama uma funcao versionada noutro arquivo. Ate agora isso nao existia
-- em lugar nenhum do repositorio.
drop trigger if exists trg_avaliacoes_atualizado on public.avaliacoes;
create trigger trg_avaliacoes_atualizado
  before update on public.avaliacoes
  for each row execute function public.set_atualizado_em();


-- ===========================================================================
-- respostas
-- ===========================================================================
create table if not exists public.respostas (
  id          uuid not null default gen_random_uuid(),
  paciente_id uuid not null,
  modulo      text not null,
  dados       jsonb not null default '{}'::jsonb,
  salvo_em    timestamp with time zone default now()
);

alter table public.respostas drop constraint if exists respostas_pkey;
alter table public.respostas add  constraint respostas_pkey primary key (id);

alter table public.respostas drop constraint if exists respostas_paciente_id_modulo_key;
alter table public.respostas add  constraint respostas_paciente_id_modulo_key
  unique (paciente_id, modulo);

alter table public.respostas drop constraint if exists respostas_paciente_id_fkey;
alter table public.respostas add  constraint respostas_paciente_id_fkey
  foreign key (paciente_id) references public.pacientes(id) on delete cascade;

create index if not exists idx_respostas_paciente on public.respostas using btree (paciente_id);

alter table public.respostas enable row level security;

drop policy if exists "Nutri ve respostas dos seus pacientes" on public.respostas;
create policy "Nutri ve respostas dos seus pacientes" on public.respostas
  for all to authenticated
  using (exists (select 1 from public.pacientes p
                  where p.id = respostas.paciente_id and p.nutri_id = auth.uid()))
  with check (exists (select 1 from public.pacientes p
                       where p.id = respostas.paciente_id and p.nutri_id = auth.uid()));

-- O gatilho trg_paciente_nome_do_questionario JA e versionado, em
-- db/paciente_nome_do_questionario.sql. Nao e recriado aqui — este comentario
-- existe so para que quem ler o baseline saiba que ele existe e onde mora.
--
-- ACHADO DE DIAGNOSTICO - NAO CORRIGIDO NESTA ETAPA:
-- quem ESCREVE em respostas no fluxo real nao passa por esta policy. E a RPC
-- rpc_salvar_respostas, SECURITY DEFINER e aberta para `anon`, que identifica
-- o paciente pelo `codigo`. Ver db/auth_legacy_rpcs_baseline.sql.


-- ===========================================================================
-- exames
-- ===========================================================================
create table if not exists public.exames (
  id           uuid not null default gen_random_uuid(),
  paciente_id  uuid not null,
  nome_arquivo text not null,
  url_storage  text,
  tipo         text,
  enviado_em   timestamp with time zone default now()
);

alter table public.exames drop constraint if exists exames_pkey;
alter table public.exames add  constraint exames_pkey primary key (id);

alter table public.exames drop constraint if exists exames_paciente_id_fkey;
alter table public.exames add  constraint exames_paciente_id_fkey
  foreign key (paciente_id) references public.pacientes(id) on delete cascade;

create index if not exists idx_exames_paciente on public.exames using btree (paciente_id);

alter table public.exames enable row level security;

-- ACHADO DE DIAGNOSTICO - NAO CORRIGIDO NESTA ETAPA: `to public` inclui anon.
drop policy if exists "Nutri ve exames dos seus pacientes" on public.exames;
create policy "Nutri ve exames dos seus pacientes" on public.exames
  for select to public
  using (exists (select 1 from public.pacientes
                  where pacientes.id = exames.paciente_id
                    and pacientes.nutri_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- SOBRE A AUSENCIA DE POLICY DE INSERT — E DELIBERADA, NAO E ACHADO.
-- ---------------------------------------------------------------------------
-- public.exames tem RLS ativa e SOMENTE policy de SELECT. Nada grava nesta
-- tabela pela API, nem paciente nem profissional.
--
-- Isso NAO e descuido: e o resultado de db/exames_fechar_insercao_publica.sql,
-- aplicado em 07/08/2026. A policy anterior ("Publico insere exames") permitia
-- INSERT sem amarrar a linha a ninguem — com a anon-key no JavaScript do site,
-- qualquer um gravava exame no prontuario de qualquer paciente.
--
-- O upload de exames em anamnese.html chama simulateUpload(): os arquivos
-- nunca saem do navegador. Fechar a insercao nao quebrou nada porque nada
-- escrevia de verdade.
--
-- QUANDO O MODULO DE EXAMES FOR CONSTRUIDO, a policy de insercao volta — mas
-- escopada por nutri_id, como a de leitura. Nao reabra a antiga.


-- ===========================================================================
-- recordatorio_calc
-- ===========================================================================
-- Cache do calculo. A PK e o proprio paciente_id: um recordatorio por
-- paciente, sobrescrito a cada calculo.
create table if not exists public.recordatorio_calc (
  paciente_id  uuid not null,
  kcal_total   numeric(7,1),
  prot_g       numeric(6,1),
  carb_g       numeric(6,1),
  gord_g       numeric(6,1),
  detalhe      jsonb,
  hash_origem  text,
  calculado_em timestamp with time zone default now()
);

alter table public.recordatorio_calc drop constraint if exists recordatorio_calc_pkey;
alter table public.recordatorio_calc add  constraint recordatorio_calc_pkey
  primary key (paciente_id);

alter table public.recordatorio_calc drop constraint if exists recordatorio_calc_paciente_id_fkey;
alter table public.recordatorio_calc add  constraint recordatorio_calc_paciente_id_fkey
  foreign key (paciente_id) references public.pacientes(id) on delete cascade;

alter table public.recordatorio_calc enable row level security;

drop policy if exists "Nutri ve cache dos seus pacientes" on public.recordatorio_calc;
create policy "Nutri ve cache dos seus pacientes" on public.recordatorio_calc
  for all to authenticated
  using (exists (select 1 from public.pacientes p
                  where p.id = recordatorio_calc.paciente_id and p.nutri_id = auth.uid()))
  with check (exists (select 1 from public.pacientes p
                       where p.id = recordatorio_calc.paciente_id and p.nutri_id = auth.uid()));


-- ===========================================================================
-- GRANTS DAS QUATRO
-- ---------------------------------------------------------------------------
-- ACHADO DE DIAGNOSTICO - NAO CORRIGIDO NESTA ETAPA:
-- as quatro dao DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE e
-- UPDATE para anon e authenticated — o `grant all` inicial do Supabase, igual
-- nas 8 tabelas legadas. Nao reproduzidos como comando: baseline e retrato,
-- nao recomendacao.
-- ===========================================================================
