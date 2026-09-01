-- ===========================================================================
-- DESFAZER db/multiusuario_etapa4b_rls.sql
-- ---------------------------------------------------------------------------
-- Devolve as cinco tabelas para `nutri_id = auth.uid()` — o estado anterior a
-- Etapa 4B. 100% re-executavel.
--
-- QUANDO USAR. Se a Recepcao passar a ver o que nao devia, ou se o
-- proprietario perder acesso a alguma coisa, este arquivo volta tudo em uma
-- transacao mental so: nenhuma linha de DADO e tocada, so policy e default.
--
-- ORDEM DO ROLLBACK: rode db/multiusuario_etapa4b_rpc_desfazer.sql ANTES deste.
-- As RPCs sem teto contam com a RLS nova para nao conceder demais; devolver a
-- RLS primeiro deixaria, por um instante, funcoes SECURITY DEFINER mais
-- permissivas que as policies em volta.
--
-- O QUE ELE NAO DESFAZ, de proposito:
--
--   os defaults de `comercial_assinaturas`, `financeiro_lancamentos`,
--   `financeiro_categorias` e `financeiro_centros_custo` VOLTAM para
--   `auth.uid()`, que e de onde vieram. Mas `pacientes.nutri_id` volta a NAO
--   TER DEFAULT — porque nunca teve. Repor `auth.uid()` ali seria "consertar"
--   para um estado que nunca existiu, e mascararia a razao pela qual a Fase 1
--   ainda manda o campo a mao.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) OS DEFAULTS VOLTAM
-- ---------------------------------------------------------------------------
alter table public.pacientes
  alter column nutri_id drop default;
alter table public.comercial_assinaturas
  alter column nutri_id set default auth.uid();
alter table public.financeiro_lancamentos
  alter column nutri_id set default auth.uid();
alter table public.financeiro_categorias
  alter column nutri_id set default auth.uid();
alter table public.financeiro_centros_custo
  alter column nutri_id set default auth.uid();


-- ---------------------------------------------------------------------------
-- 2) pacientes — as quatro viram uma de novo
-- ---------------------------------------------------------------------------
-- `pacientes_self_read` nao aparece aqui porque a migracao nao a tocou.
drop policy if exists pacientes_select on public.pacientes;
drop policy if exists pacientes_insert on public.pacientes;
drop policy if exists pacientes_update on public.pacientes;
drop policy if exists pacientes_delete on public.pacientes;

drop policy if exists "Nutri ve proprios pacientes" on public.pacientes;
create policy "Nutri ve proprios pacientes" on public.pacientes
  for all to authenticated
  using (auth.uid() = nutri_id)
  with check (auth.uid() = nutri_id);


-- ---------------------------------------------------------------------------
-- 3) comercial_assinaturas
-- ---------------------------------------------------------------------------
drop policy if exists comercial_assinaturas_select on public.comercial_assinaturas;
drop policy if exists comercial_assinaturas_insert on public.comercial_assinaturas;
drop policy if exists comercial_assinaturas_update on public.comercial_assinaturas;
drop policy if exists comercial_assinaturas_delete on public.comercial_assinaturas;

create policy comercial_assinaturas_select on public.comercial_assinaturas
  for select to authenticated using (nutri_id = auth.uid());
create policy comercial_assinaturas_insert on public.comercial_assinaturas
  for insert to authenticated
  with check (
    nutri_id = auth.uid()
    and exists (select 1 from public.pacientes p
                 where p.id = paciente_id and p.nutri_id = auth.uid())
  );
create policy comercial_assinaturas_update on public.comercial_assinaturas
  for update to authenticated
  using (nutri_id = auth.uid())
  with check (
    nutri_id = auth.uid()
    and exists (select 1 from public.pacientes p
                 where p.id = paciente_id and p.nutri_id = auth.uid())
  );
create policy comercial_assinaturas_delete on public.comercial_assinaturas
  for delete to authenticated using (nutri_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 4) financeiro_lancamentos
-- ---------------------------------------------------------------------------
-- Volta com a checagem de centro de custo, que e a versao de
-- db/financeiro_despesas_etapa1.sql — a mais recente antes da 4B.
drop policy if exists financeiro_lancamentos_select on public.financeiro_lancamentos;
drop policy if exists financeiro_lancamentos_insert on public.financeiro_lancamentos;
drop policy if exists financeiro_lancamentos_update on public.financeiro_lancamentos;
drop policy if exists financeiro_lancamentos_delete on public.financeiro_lancamentos;

create policy financeiro_lancamentos_select on public.financeiro_lancamentos
  for select to authenticated using (nutri_id = auth.uid());
create policy financeiro_lancamentos_insert on public.financeiro_lancamentos
  for insert to authenticated
  with check (
    nutri_id = auth.uid()
    and (categoria_id is null or exists (
      select 1 from public.financeiro_categorias c
       where c.id = categoria_id and c.nutri_id = auth.uid()))
    and (centro_custo_id is null or exists (
      select 1 from public.financeiro_centros_custo cc
       where cc.id = centro_custo_id and cc.nutri_id = auth.uid()))
  );
create policy financeiro_lancamentos_update on public.financeiro_lancamentos
  for update to authenticated
  using (nutri_id = auth.uid())
  with check (
    nutri_id = auth.uid()
    and (categoria_id is null or exists (
      select 1 from public.financeiro_categorias c
       where c.id = categoria_id and c.nutri_id = auth.uid()))
    and (centro_custo_id is null or exists (
      select 1 from public.financeiro_centros_custo cc
       where cc.id = centro_custo_id and cc.nutri_id = auth.uid()))
  );
create policy financeiro_lancamentos_delete on public.financeiro_lancamentos
  for delete to authenticated using (nutri_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 5) financeiro_categorias
-- ---------------------------------------------------------------------------
drop policy if exists financeiro_categorias_select on public.financeiro_categorias;
drop policy if exists financeiro_categorias_insert on public.financeiro_categorias;
drop policy if exists financeiro_categorias_update on public.financeiro_categorias;
drop policy if exists financeiro_categorias_delete on public.financeiro_categorias;

create policy financeiro_categorias_select on public.financeiro_categorias
  for select to authenticated using (nutri_id = auth.uid());
create policy financeiro_categorias_insert on public.financeiro_categorias
  for insert to authenticated with check (nutri_id = auth.uid());
create policy financeiro_categorias_update on public.financeiro_categorias
  for update to authenticated using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());
create policy financeiro_categorias_delete on public.financeiro_categorias
  for delete to authenticated using (nutri_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 6) financeiro_centros_custo
-- ---------------------------------------------------------------------------
drop policy if exists financeiro_centros_custo_select on public.financeiro_centros_custo;
drop policy if exists financeiro_centros_custo_insert on public.financeiro_centros_custo;
drop policy if exists financeiro_centros_custo_update on public.financeiro_centros_custo;
drop policy if exists financeiro_centros_custo_delete on public.financeiro_centros_custo;

create policy financeiro_centros_custo_select on public.financeiro_centros_custo
  for select to authenticated using (nutri_id = auth.uid());
create policy financeiro_centros_custo_insert on public.financeiro_centros_custo
  for insert to authenticated with check (nutri_id = auth.uid());
create policy financeiro_centros_custo_update on public.financeiro_centros_custo
  for update to authenticated using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());
create policy financeiro_centros_custo_delete on public.financeiro_centros_custo
  for delete to authenticated using (nutri_id = auth.uid());


-- ===========================================================================
-- Conferencia. Esperado depois do rollback:
--   com_organizacao = 0 · policies de pacientes = 2 ("Nutri ve..." + self_read)
--   defaults_migrados = 0 · default de pacientes.nutri_id = null (nunca teve)
-- ===========================================================================
with alvo as (
  select unnest(array['pacientes','comercial_assinaturas','financeiro_lancamentos',
                      'financeiro_categorias','financeiro_centros_custo']) as t
)
select
  (select count(*) from pg_policies p join alvo on alvo.t = p.tablename
    where p.schemaname = 'public'
      and coalesce(p.qual,'') || coalesce(p.with_check,'') like '%organizacao_do_auth%')
                                                                          as com_organizacao,
  (select count(*) from pg_policies where schemaname='public' and tablename='pacientes')
                                                                          as policies_pacientes,
  (select count(*) from information_schema.columns c join alvo on alvo.t = c.table_name
    where c.table_schema='public' and c.column_name='nutri_id'
      and c.column_default like '%organizacao_do_auth%')                  as defaults_migrados,
  (select column_default from information_schema.columns
    where table_schema='public' and table_name='pacientes' and column_name='nutri_id')
                                                                          as default_pacientes;
