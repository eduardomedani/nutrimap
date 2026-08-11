-- ===========================================================================
-- Evollo · DESFAZER — RLS multiusuario em public.comercial_planos
-- ---------------------------------------------------------------------------
-- Desfaz db/multiusuario_comercial_planos_rls.sql.
--
-- ===========================================================================
-- ISTO E METADE DO ROLLBACK. A OUTRA METADE E JAVASCRIPT.
-- ---------------------------------------------------------------------------
-- Nenhum arquivo SQL desfaz um deploy. O rollback funcional tem duas partes, e
-- elas rodam em ORDEM INVERSA A DA APLICACAO:
--
--   ROLLBACK FUNCIONAL
--     1. FRONTEND  — reverter js/organizacao.js e as tres funcoes de plano em
--                    js/comercial-data.js, e publicar. Enquanto isso o banco
--                    ainda esta migrado, e nada quebra: o front antigo pede
--                    `auth.uid()`, que para o proprietario e a organizacao.
--     2. BANCO     — rodar ESTE arquivo.
--
-- Na ordem trocada, o banco volta a exigir `auth.uid()` enquanto o front ainda
-- pede a organizacao. O proprietario continua funcionando — os dois valores
-- coincidem para ele — e so a Recepcao quebra, em silencio. E o mesmo modo de
-- falha que a migracao existe para eliminar, reaparecendo no rollback.
--
-- ---------------------------------------------------------------------------
-- A FONTE DAS POLICIES RESTAURADAS
-- ---------------------------------------------------------------------------
-- db/comercial_etapa2_planos.sql, linhas 199 a 206. Copia literal, nao
-- reconstrucao de memoria — foi o que a conferencia da Etapa 3.5 registrou
-- como o estado real do banco.
--
-- NENHUM DADO E APAGADO AQUI. As linhas de comercial_planos continuam onde
-- estao, com o mesmo nutri_id e o mesmo criado_por: a migration nao moveu
-- nada, e o rollback tambem nao.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) O DEFAULT ANTERIOR
-- ---------------------------------------------------------------------------
-- Volta a auth.uid(). Depois disto, o frontend PRECISA voltar a mandar
-- `nutri_id` no insert — ou, mais exatamente, precisa ja ter voltado: com o
-- front novo (que nao manda) e este default (que grava a pessoa), um plano
-- criado pela Recepcao nasceria com o dono errado e a policy antiga o
-- aceitaria. E a unica combinacao das quatro que grava dado torto em vez de
-- so recusar. Por isso o frontend vem primeiro.
-- ---------------------------------------------------------------------------
alter table public.comercial_planos
  alter column nutri_id set default auth.uid();


-- ---------------------------------------------------------------------------
-- 2) AS QUATRO POLICIES ANTERIORES
-- ---------------------------------------------------------------------------
drop policy if exists comercial_planos_select on public.comercial_planos;
drop policy if exists comercial_planos_insert on public.comercial_planos;
drop policy if exists comercial_planos_update on public.comercial_planos;
drop policy if exists comercial_planos_delete on public.comercial_planos;

create policy comercial_planos_select on public.comercial_planos
  for select to authenticated using (nutri_id = auth.uid());
create policy comercial_planos_insert on public.comercial_planos
  for insert to authenticated with check (nutri_id = auth.uid());
create policy comercial_planos_update on public.comercial_planos
  for update to authenticated using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());
create policy comercial_planos_delete on public.comercial_planos
  for delete to authenticated using (nutri_id = auth.uid());


-- ===========================================================================
-- Conferencia. Esperado:
--   policies = 4 · com_organizacao = 0 · com_permissao = 0
--   default_nutri_id = auth.uid()
--   linhas e donos = os mesmos de antes da migration
-- ===========================================================================
select
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'comercial_planos')            as policies,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'comercial_planos'
      and coalesce(qual, '') || coalesce(with_check, '') like '%organizacao_do_auth%') as com_organizacao,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'comercial_planos'
      and coalesce(qual, '') || coalesce(with_check, '') like '%tem_permissao%')       as com_permissao,
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'comercial_planos'
      and column_name = 'nutri_id')                                            as default_nutri_id,
  (select count(*) from public.comercial_planos)                               as linhas,
  (select count(distinct nutri_id) from public.comercial_planos)               as donos;
