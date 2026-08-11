-- ===========================================================================
-- BASELINE DE OBJETO JA EXISTENTE NO SUPABASE
-- NAO E MIGRATION. NAO EXECUTE ESTE ARQUIVO CEGAMENTE.
-- ---------------------------------------------------------------------------
-- public.nutricionistas nasceu antes de o schema virar arquivo e so existia no
-- banco. Este arquivo e o RETRATO do que esta la em 11/08/2026, extraido do
-- catalogo por db/conferencia/67_legacy_nutricionistas.sql.
--
-- PARA QUE SERVE: tornar as dependencias visiveis antes da Etapa 2
-- (multiusuario). Nao para recriar o objeto.
--
-- Rodar isto num banco que ja tem a tabela nao "conserta" nada e pode
-- DERRUBAR policy existente (os `drop policy if exists` abaixo). Se algum dia
-- precisar recriar do zero, leia o arquivo inteiro antes.
--
-- ===========================================================================
-- POR QUE ESTA TABELA IMPORTA MAIS QUE AS OUTRAS
-- ---------------------------------------------------------------------------
-- Ela JA E a organizacao, sem ter esse nome:
--
--   nutricionistas.id  ->  auth.users(id)        o id E o auth.uid()
--   pacientes.nutri_id ->  nutricionistas(id)    o dono dos dados
--   avaliacoes.nutri_id -> nutricionistas(id)
--   codigos_uso.nutri_id -> nutricionistas(id)
--
-- As 41 tabelas versionadas em db/*.sql apontam `nutri_id` para auth.users
-- direto; estas quatro apontam para AQUI. Ou seja, a decisao da Etapa 2
-- (organizacao com id = auth.uid() do proprietario) ja esta materializada
-- nesta tabela. Ver o diagnostico da Etapa 1.
-- ===========================================================================

create table if not exists public.nutricionistas (
  id         uuid not null,
  nome       text not null,
  email      text not null,
  telefone   text,
  instagram  text,
  crn        text,
  plano      text default 'free'::text,
  criado_em  timestamp with time zone default now()
);

alter table public.nutricionistas drop constraint if exists nutricionistas_pkey;
alter table public.nutricionistas add  constraint nutricionistas_pkey primary key (id);

alter table public.nutricionistas drop constraint if exists nutricionistas_id_fkey;
alter table public.nutricionistas add  constraint nutricionistas_id_fkey
  foreign key (id) references auth.users(id) on delete cascade;

alter table public.nutricionistas enable row level security;

-- ---------------------------------------------------------------------------
-- POLICIES (fieis ao banco)
-- ---------------------------------------------------------------------------
-- ACHADO DE DIAGNOSTICO - NAO CORRIGIDO NESTA ETAPA:
-- as tres usam `to public`, que inclui o papel `anon`. Nada vaza hoje porque
-- o predicado depende de auth.uid(), que e nulo para anonimo — mas o papel
-- correto seria `authenticated`, como em public.pacientes. Anotado para o
-- hardening, que e outra decisao.

drop policy if exists "Nutri ve proprio perfil" on public.nutricionistas;
create policy "Nutri ve proprio perfil" on public.nutricionistas
  for select to public
  using (auth.uid() = id);

drop policy if exists "Nutri pode criar proprio perfil" on public.nutricionistas;
create policy "Nutri pode criar proprio perfil" on public.nutricionistas
  for insert to public
  with check (auth.uid() = id);

drop policy if exists "Nutri atualiza proprio perfil" on public.nutricionistas;
create policy "Nutri atualiza proprio perfil" on public.nutricionistas
  for update to public
  using (auth.uid() = id);

-- ACHADO DE DIAGNOSTICO - NAO CORRIGIDO NESTA ETAPA:
-- nao existe policy de DELETE. A linha so sai por cascata de auth.users.

-- ---------------------------------------------------------------------------
-- GRANTS (fieis ao banco)
-- ---------------------------------------------------------------------------
-- ACHADO DE DIAGNOSTICO - NAO CORRIGIDO NESTA ETAPA:
-- anon e authenticated recebem DELETE, INSERT, REFERENCES, SELECT, TRIGGER,
-- TRUNCATE e UPDATE. E o `grant all` de configuracao inicial do Supabase, e
-- vale igual nas 8 tabelas legadas. A RLS segura SELECT/INSERT/UPDATE/DELETE.
-- TRUNCATE **nao passa por RLS** — hoje inalcancavel porque o PostgREST nao
-- expoe truncate, mas e um grant que nao deveria existir.
--
-- NAO reproduzo os grants como comando: escrever `grant ... to anon` num
-- arquivo do repositorio faria o baseline PARECER a recomendacao. Ele e o
-- retrato. O hardening de grants de tabela e etapa propria.

-- ---------------------------------------------------------------------------
-- QUEM DEPENDE DESTA TABELA
-- ---------------------------------------------------------------------------
--   pacientes.nutri_id    -> on delete cascade
--   avaliacoes.nutri_id   -> on delete cascade
--   codigos_uso.nutri_id  -> sem acao (restrict implicito)
--
-- No front: js/auth.js:84 obterPerfilNutri(), unico ponto que le a tabela.
-- Chamado por index.html:2546 e js/timeline-ui.js:33. Todo o resto do painel
-- usa auth.uid() direto como nutri_id, sem passar por aqui.
