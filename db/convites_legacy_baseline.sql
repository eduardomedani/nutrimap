-- ===========================================================================
-- BASELINE DE OBJETOS JA EXISTENTES NO SUPABASE
-- NAO E MIGRATION. NAO EXECUTE ESTE ARQUIVO CEGAMENTE.
-- ---------------------------------------------------------------------------
-- public.codigos_convite e public.codigos_uso, retrato de 11/08/2026,
-- extraido por db/conferencia/69_legacy_tabelas.sql.
--
-- SAO DO NIVEL SaaS, NAO DA CLINICA. O codigo de convite e o que permite uma
-- pessoa criar conta de PROFISSIONAL no Evollo. Nao tem relacao com o codigo
-- de acesso do paciente (public.pacientes.codigo) nem com o vinculo de
-- funcionario — tres coisas diferentes com o mesmo apelido.
--
-- Nao confundir com o convite de USUARIO da organizacao, que a Etapa 3 vai
-- construir. Este aqui cadastra uma organizacao nova; aquele adiciona uma
-- pessoa a uma organizacao existente.
-- ===========================================================================

create table if not exists public.codigos_convite (
  id          uuid not null default gen_random_uuid(),
  codigo      text not null,
  descricao   text,
  usos_maximo integer default 1,
  usos_atuais integer default 0,
  ativo       boolean default true,
  expira_em   timestamp with time zone,
  criado_em   timestamp with time zone default now()
);

alter table public.codigos_convite drop constraint if exists codigos_convite_pkey;
alter table public.codigos_convite add  constraint codigos_convite_pkey primary key (id);

alter table public.codigos_convite drop constraint if exists codigos_convite_codigo_key;
alter table public.codigos_convite add  constraint codigos_convite_codigo_key unique (codigo);

alter table public.codigos_convite enable row level security;


create table if not exists public.codigos_uso (
  id        uuid not null default gen_random_uuid(),
  codigo_id uuid,
  nutri_id  uuid,
  email     text,
  usado_em  timestamp with time zone default now()
);

alter table public.codigos_uso drop constraint if exists codigos_uso_pkey;
alter table public.codigos_uso add  constraint codigos_uso_pkey primary key (id);

alter table public.codigos_uso drop constraint if exists codigos_uso_codigo_id_fkey;
alter table public.codigos_uso add  constraint codigos_uso_codigo_id_fkey
  foreign key (codigo_id) references public.codigos_convite(id);

alter table public.codigos_uso drop constraint if exists codigos_uso_nutri_id_fkey;
alter table public.codigos_uso add  constraint codigos_uso_nutri_id_fkey
  foreign key (nutri_id) references public.nutricionistas(id);

alter table public.codigos_uso enable row level security;


-- ===========================================================================
-- RLS ATIVA E ZERO POLICIES — E DE PROPOSITO, NAO E ACHADO.
-- ---------------------------------------------------------------------------
-- Nenhuma das duas tem policy nenhuma. Com RLS ligada, isso significa que
-- NENHUM papel alcanca as tabelas pela API: nem anon, nem authenticated. Os
-- grants amplos ficam inertes, porque a RLS nao deixa passar linha alguma.
--
-- Quem chega nelas sao as funcoes SECURITY DEFINER, que passam por cima da
-- RLS depois de conferir o que precisam conferir:
--
--   validar_codigo_convite()   le codigos_convite            (aberta p/ anon)
--   registrar_uso_codigo()     le e escreve nas duas         (aberta p/ anon)
--   admin_listar_codigos()     le codigos_convite            (db/admin_convites.sql)
--   admin_gerar_codigo()       escreve em codigos_convite    (db/admin_convites.sql)
--   admin_definir_ativo()      atualiza codigos_convite      (db/admin_convites.sql)
--
-- O estado de zero policies veio de db/convites_fechar_leitura_publica.sql,
-- aplicado em 07/08/2026. Antes existia a policy "Publico le codigos" com
-- condicao `true`: qualquer um com a anon-key recebia TODOS os codigos ativos,
-- e conhecer um codigo era a unica coisa entre um estranho e virar
-- profissional no sistema.
--
-- NAO ADICIONE POLICY AQUI. O acesso por funcao DEFINER e o desenho, e e o
-- padrao que o resto do sistema deveria seguir.
-- ===========================================================================


-- ===========================================================================
-- ACHADO DE DIAGNOSTICO - NAO CORRIGIDO NESTA ETAPA
-- ---------------------------------------------------------------------------
-- registrar_uso_codigo(p_codigo, p_nutri_id, p_email) recebe o dono como
-- PARAMETRO em vez de derivar de auth.uid(), e esta aberta para `anon`. Com a
-- chave anonima da para chamar em laco e queimar `usos_atuais` de qualquer
-- codigo valido — e validar_codigo_convite(), tambem anonima, informa de
-- antemao quais codigos valem.
--
-- A tabela nao sofre: a RLS nao deixa ler nem escrever direto. O que se gasta
-- e o saldo de usos do codigo. Corrigir isso significa derivar o nutri_id de
-- auth.uid() dentro da funcao, o que muda comportamento — fora do escopo
-- desta etapa. Ver db/auth_legacy_rpcs_baseline.sql.
--
-- GRANTS: as duas dao DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE e
-- UPDATE para anon e authenticated. Inertes enquanto nao houver policy, mas
-- presentes. Nao reproduzidos como comando.
-- ===========================================================================
