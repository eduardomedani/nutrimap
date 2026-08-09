-- ===========================================================================
-- Evollo · NOTIFICACOES INTERNAS DO PACIENTE — Etapa 4
-- ---------------------------------------------------------------------------
-- Caixa de avisos dentro do app autenticado. Nasce com uma origem so
-- (documento disponibilizado) e ja generica: `tipo` + `referencia_id` servem
-- para check-in, consulta remarcada e biblioteca sem migration nova.
--
-- O RISCO DESTA TABELA, e como ele foi fechado.
--
-- Aviso e um SEGUNDO estado de "novidade" — o primeiro ja existe e e melhor:
-- paciente_documentos.visualizado_pelo_paciente. Duas fontes para a mesma
-- pergunta divergem na primeira semana: o paciente dispensa o aviso sem abrir
-- o arquivo, o sino zera, o documento continua sem ler, e o profissional ve
-- "2 pendentes" enquanto o paciente ve zero.
--
-- A trava e nao deixar as duas se moverem sozinhas: quem marca o documento
-- como visto (marcar_documento_paciente_visualizado) marca TAMBEM o aviso
-- daquele documento como lido, na mesma transacao. Nao existe caminho para
-- dispensar o aviso sem abrir o documento — a tela do PWA nao oferece "marcar
-- como lida", e a RPC de leitura de aviso so aceita aviso SEM referencia a
-- documento. Documento continua sendo a fonte da verdade; o aviso e um
-- espelho que nao tem como andar sozinho.
--
-- IDEMPOTENCIA: chave_dedup UNIQUE + "on conflict do nothing", mesmo padrao de
-- public.paciente_eventos. Dois cliques em "Disponibilizar" nao viram dois
-- avisos porque a chave carrega o instante da transicao, e a transicao so
-- acontece uma vez (ver a clausula `and not visivel_paciente` no UPDATE que a
-- provoca, em js/paciente-documentos.js).
--
-- Requer: paciente_login_schema.sql (paciente_do_auth) e paciente_documentos.sql
-- 100% re-executavel. Rodar no SQL Editor do Supabase.
-- Desfazer: db/paciente_notificacoes_desfazer.sql
-- ===========================================================================


-- ===========================================================================
-- 1) A tabela
-- ===========================================================================
create table if not exists public.paciente_notificacoes (
  id          uuid primary key default gen_random_uuid(),
  nutri_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  paciente_id uuid not null references public.pacientes(id) on delete cascade,

  tipo          text not null,
  -- O id da coisa referida. NAO e chave estrangeira de proposito: o aviso
  -- sobrevive ao documento excluido — "voce foi avisado em 08/08" continua
  -- verdade depois de o arquivo sumir. Quem confere existencia e a tela.
  referencia_id uuid,

  titulo text not null,
  corpo  text not null,
  -- Para onde o toque leva. Nome de ROTA, nunca URL: URL assinada aqui viraria
  -- link permanente para documento privado dentro de uma linha de banco.
  acao   text,

  lida_em   timestamptz,
  criado_em timestamptz not null default now(),

  -- Idempotencia, igual a paciente_eventos.chave_dedup.
  chave_dedup text
);

alter table public.paciente_notificacoes add column if not exists acao        text;
alter table public.paciente_notificacoes add column if not exists lida_em     timestamptz;
alter table public.paciente_notificacoes add column if not exists chave_dedup text;

alter table public.paciente_notificacoes drop constraint if exists pn_tipo_check;
alter table public.paciente_notificacoes add  constraint pn_tipo_check
  check (tipo in ('documento', 'checkin', 'consulta', 'plano', 'treino', 'geral'));

-- Nada de URL dentro do aviso. O CHECK e barato e fecha a porta para sempre:
-- assinatura guardada em banco continua abrindo documento ja removido do app
-- pelo tempo que faltar para expirar.
alter table public.paciente_notificacoes drop constraint if exists pn_sem_url_check;
alter table public.paciente_notificacoes add  constraint pn_sem_url_check
  check (acao is null or acao !~* '^https?://');

create unique index if not exists uniq_pn_dedup
  on public.paciente_notificacoes (chave_dedup)
  where chave_dedup is not null;

create index if not exists idx_pn_paciente
  on public.paciente_notificacoes (paciente_id, criado_em desc);

-- A consulta do sino: so as nao lidas.
create index if not exists idx_pn_nao_lidas
  on public.paciente_notificacoes (paciente_id, criado_em desc)
  where lida_em is null;


-- ===========================================================================
-- 2) RLS
-- ---------------------------------------------------------------------------
-- O paciente LE as proprias. Nao escreve: nem para marcar lida — isso passa
-- pela RPC, que so aceita aviso sem documento por tras (ver secao 4).
-- ===========================================================================
alter table public.paciente_notificacoes enable row level security;

drop policy if exists pn_nutri_select    on public.paciente_notificacoes;
drop policy if exists pn_nutri_insert    on public.paciente_notificacoes;
drop policy if exists pn_paciente_select on public.paciente_notificacoes;

create policy pn_nutri_select on public.paciente_notificacoes
  for select to authenticated
  using (nutri_id = auth.uid());

create policy pn_nutri_insert on public.paciente_notificacoes
  for insert to authenticated
  with check (
    nutri_id = auth.uid()
    and exists (
      select 1 from public.pacientes p
       where p.id = paciente_id and p.nutri_id = auth.uid())
  );

create policy pn_paciente_select on public.paciente_notificacoes
  for select to authenticated
  using (paciente_id = public.paciente_do_auth());

-- Sem UPDATE e sem DELETE para ninguem pela API: aviso nao se edita nem se
-- apaga. O que muda e `lida_em`, e so pelas funcoes abaixo.


-- ===========================================================================
-- 3) Marcar lido junto com o documento
-- ---------------------------------------------------------------------------
-- Esta e a trava do desenho. A funcao de visualizacao da Etapa 1 passa a
-- fechar tambem o aviso: uma acao, os dois estados. Sem isto, "documento nao
-- lido" e "aviso nao lido" viram dois numeros que discordam.
--
-- Substitui a versao de db/paciente_documentos.sql. O resto do corpo e
-- identico — as tres condicoes de propriedade continuam sendo as mesmas.
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
         -- A PRIMEIRA visualizacao nao se sobrescreve: e ela que responde
         -- "quando o paciente soube".
         visualizado_em = coalesce(visualizado_em, now()),
         metadata = jsonb_set(
           metadata, '{acessos}',
           to_jsonb(coalesce((metadata->>'acessos')::int, 0) + 1), true),
         atualizado_em = now()
   where id = p_documento
     and paciente_id = v_eu
     and visivel_paciente
     and status = 'ativo'
     and arquivado_em is null;

  if not found then
    return false;
  end if;

  -- O aviso daquele documento se fecha junto. `lida_em is null` evita
  -- reescrever a data na segunda abertura.
  update public.paciente_notificacoes
     set lida_em = now()
   where paciente_id = v_eu
     and tipo = 'documento'
     and referencia_id = p_documento
     and lida_em is null;

  return true;
end
$fn$;

-- ACL explicita: nao depende dos default privileges do schema public, que no
-- Supabase concedem EXECUTE a anon em toda funcao nova. Vale tambem para
-- CREATE OR REPLACE, que refaz o grant padrao.
revoke all on function public.marcar_documento_paciente_visualizado(uuid) from public;
revoke all on function public.marcar_documento_paciente_visualizado(uuid) from anon;
grant execute on function public.marcar_documento_paciente_visualizado(uuid) to authenticated;


-- ===========================================================================
-- 4) Marcar lido um aviso QUE NAO E DE DOCUMENTO
-- ---------------------------------------------------------------------------
-- Existe para os tipos futuros (checkin, consulta), que nao tem um "abrir" que
-- sirva de leitura. Recusa aviso de documento de proposito: se aceitasse, o
-- paciente teria como zerar o sino sem abrir o exame, e as duas contas
-- voltariam a divergir. Nao ha tela que chame isto hoje.
-- ===========================================================================
create or replace function public.marcar_notificacao_lida(p_notificacao uuid)
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

  update public.paciente_notificacoes
     set lida_em = now()
   where id = p_notificacao
     and paciente_id = v_eu
     and lida_em is null
     -- Documento se le abrindo o documento, nao dispensando o aviso.
     and tipo <> 'documento';

  return found;
end
$fn$;

revoke all on function public.marcar_notificacao_lida(uuid) from public;
revoke all on function public.marcar_notificacao_lida(uuid) from anon;
grant execute on function public.marcar_notificacao_lida(uuid) to authenticated;


-- ===========================================================================
-- Conferencia
-- ===========================================================================
select
  (select count(*) from public.paciente_notificacoes)                          as avisos,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'paciente_notificacoes')       as policies,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'paciente_notificacoes'
      and cmd in ('UPDATE', 'DELETE'))                                         as escrita_direta,
  (select coalesce(has_function_privilege('public',
     'public.marcar_notificacao_lida(uuid)', 'EXECUTE'), false))               as publico_executa;
