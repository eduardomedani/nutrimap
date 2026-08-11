-- ===========================================================================
-- BASELINE DE OBJETO JA EXISTENTE NO SUPABASE
-- NAO E MIGRATION. NAO EXECUTE ESTE ARQUIVO CEGAMENTE.
-- ---------------------------------------------------------------------------
-- public.pacientes nasceu antes de o schema virar arquivo e so existia no
-- banco. Retrato de 11/08/2026, extraido por
-- db/conferencia/66_legacy_pacientes.sql.
--
-- E a tabela mais referenciada do sistema: 15 tabelas apontam para ela, e a
-- lista esta no fim do arquivo. Qualquer mudanca de tenancy passa por aqui.
-- ===========================================================================

create table if not exists public.pacientes (
  id            uuid not null default gen_random_uuid(),
  nutri_id      uuid not null,
  codigo        text not null,
  nome          text,
  email         text,
  telefone      text,
  status        text default 'aguardando'::text,
  criado_em     timestamp with time zone default now(),
  completado_em timestamp with time zone,
  pais          text default 'Brasil'::text,
  cep           text,
  endereco      text,
  bairro        text,
  cidade        text,
  uf            text,
  instagram     text,
  nascimento    date,
  sexo          text,
  profissao     text,
  auth_user_id  uuid
);

alter table public.pacientes drop constraint if exists pacientes_pkey;
alter table public.pacientes add  constraint pacientes_pkey primary key (id);

alter table public.pacientes drop constraint if exists pacientes_codigo_key;
alter table public.pacientes add  constraint pacientes_codigo_key unique (codigo);

alter table public.pacientes drop constraint if exists pacientes_nutri_id_fkey;
alter table public.pacientes add  constraint pacientes_nutri_id_fkey
  foreign key (nutri_id) references public.nutricionistas(id) on delete cascade;

alter table public.pacientes drop constraint if exists pacientes_auth_user_id_fkey;
alter table public.pacientes add  constraint pacientes_auth_user_id_fkey
  foreign key (auth_user_id) references auth.users(id) on delete set null;

create index if not exists idx_pacientes_nutri     on public.pacientes using btree (nutri_id);
create index if not exists idx_pacientes_codigo    on public.pacientes using btree (codigo);
create index if not exists idx_pacientes_auth_user on public.pacientes using btree (auth_user_id);

create unique index if not exists uq_pacientes_auth_user
  on public.pacientes using btree (auth_user_id)
  where (auth_user_id is not null);

alter table public.pacientes enable row level security;

drop policy if exists "Nutri ve proprios pacientes" on public.pacientes;
create policy "Nutri ve proprios pacientes" on public.pacientes
  for all to authenticated
  using (auth.uid() = nutri_id)
  with check (auth.uid() = nutri_id);

drop policy if exists pacientes_self_read on public.pacientes;
create policy pacientes_self_read on public.pacientes
  for select to authenticated
  using (auth_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- ACHADOS DE DIAGNOSTICO - NAO CORRIGIDOS NESTA ETAPA
-- ---------------------------------------------------------------------------
-- 1) `nutri_id` NAO tem `default auth.uid()`, ao contrario das 41 tabelas
--    versionadas. Quem insere precisa preencher (js/pacientes.js:59 faz isso
--    com getUser()). Nao e defeito — mas e diferenca que surpreende.
--
-- 2) A FK de `nutri_id` aponta para public.nutricionistas, e NAO para
--    auth.users. E o que faz `nutricionistas` ser a organizacao de fato.
--
-- 3) `status` nao tem CHECK: aceita qualquer texto. As tabelas versionadas
--    todas restringem status por constraint. Valores em uso conhecidos:
--    'aguardando' (default) e 'completo' (posto por rpc_marcar_completo).
--
-- 4) `codigo` e UNIQUE GLOBAL, nao por nutricionista. Ver o achado sobre
--    gerar_codigo_paciente() em db/auth_legacy_rpcs_baseline.sql: a funcao e
--    SECURITY INVOKER e so enxerga os proprios pacientes ao testar unicidade,
--    entao com mais de uma organizacao ela vai gerar codigo ja existente.
--
-- 5) Nao ha trigger nenhum nesta tabela, e nao ha coluna `atualizado_em`.
--    O nome do paciente e preenchido de fora, por
--    trg_paciente_nome_do_questionario sobre public.respostas
--    (ver db/paciente_nome_do_questionario.sql, esse SIM versionado).
--
-- 6) GRANTS: anon e authenticated com DELETE, INSERT, REFERENCES, SELECT,
--    TRIGGER, TRUNCATE, UPDATE — o `grant all` inicial do Supabase. A RLS
--    segura o DML; TRUNCATE nao passa por RLS. Nao reproduzido como comando
--    de proposito: baseline e retrato, nao recomendacao.

-- ---------------------------------------------------------------------------
-- QUEM DEPENDE DESTA TABELA (15 FKs)
-- ---------------------------------------------------------------------------
-- Versionadas em db/*.sql:
--   comercial_assinaturas  cascade      planos_alimentares   cascade
--   consultas              cascade      push_subscriptions   cascade
--   financeiro_lancamentos set null     treinos              cascade
--   paciente_documentos    restrict     paciente_eventos     cascade
--   paciente_metas         cascade      paciente_notificacoes cascade
--   paciente_tarefas       cascade
--
-- Legadas (baseline em db/clinico_legacy_baseline.sql):
--   avaliacoes             cascade      exames               cascade
--   recordatorio_calc      cascade      respostas            cascade
