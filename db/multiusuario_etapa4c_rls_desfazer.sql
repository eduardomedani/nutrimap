-- ===========================================================================
-- DESFAZER db/multiusuario_etapa4c_rls.sql
-- ---------------------------------------------------------------------------
-- Devolve as seis tabelas e o bucket para `nutri_id = auth.uid()` — o estado
-- anterior a Etapa 4C. 100% re-executavel.
--
-- Cada policy volta com o TEXTO EXATO que tinha, incluindo as travas de folha
-- fechada e os `exists` de folha/funcionario. Nenhuma linha de DADO e tocada.
--
-- ===========================================================================
-- OS DEFAULTS VOLTAM PARA auth.uid(), E ISSO E DELIBERADO
-- ---------------------------------------------------------------------------
-- Antes da 4C as seis colunas ja tinham `default auth.uid()`, entao aqui a
-- restauracao e fiel — diferente da 4B, onde `pacientes.nutri_id` nunca tivera
-- default e repor o estado pristino teria quebrado o cadastro.
--
-- Mas o motivo pratico e o mesmo: a Fase 1 da 4C (commit 69b3da6, ja em
-- producao) parou de mandar `nutri_id` nos inserts. Sem default, o rollback
-- derrubaria a abertura de folha na hora seguinte, com violacao de not-null.
--
-- ===========================================================================
-- O QUE ELE NAO DESFAZ
-- ---------------------------------------------------------------------------
-- A Fase 1 continua no ar depois deste rollback, e continua CORRETA: para o
-- proprietario, `organizacaoAtual()` devolve o mesmo uuid que `auth.uid()`
-- devolvia. O que volta a nao funcionar e o acesso de quem nao e o
-- proprietario — que e exatamente o estado de antes da etapa.
--
-- `abrirFolha` tambem continua exigindo `criar: true` para criar. Isso NAO se
-- desfaz, e nao deve: era um defeito de leitura, nao de tenancy. Sem ele, um
-- rollback traria de volta a folha fantasma.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) OS DEFAULTS
-- ---------------------------------------------------------------------------
alter table public.folhas
  alter column nutri_id set default auth.uid();
alter table public.folha_itens
  alter column nutri_id set default auth.uid();
alter table public.folha_adicionais
  alter column nutri_id set default auth.uid();
alter table public.funcionarios
  alter column nutri_id set default auth.uid();
alter table public.colaborador_documentos
  alter column nutri_id set default auth.uid();
alter table public.documentos_pendentes
  alter column nutri_id set default auth.uid();


-- ---------------------------------------------------------------------------
-- 2) funcionarios
-- ---------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------
-- 3) folhas
-- ---------------------------------------------------------------------------
drop policy if exists folhas_select on public.folhas;
drop policy if exists folhas_insert on public.folhas;
drop policy if exists folhas_update on public.folhas;
drop policy if exists folhas_delete on public.folhas;

create policy folhas_select on public.folhas
  for select to authenticated using (nutri_id = auth.uid());
create policy folhas_insert on public.folhas
  for insert to authenticated with check (nutri_id = auth.uid());
create policy folhas_update on public.folhas
  for update to authenticated using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());
create policy folhas_delete on public.folhas
  for delete to authenticated using (nutri_id = auth.uid() and status <> 'fechada');


-- ---------------------------------------------------------------------------
-- 4) folha_itens
-- ---------------------------------------------------------------------------
drop policy if exists folha_itens_select on public.folha_itens;
drop policy if exists folha_itens_insert on public.folha_itens;
drop policy if exists folha_itens_update on public.folha_itens;
drop policy if exists folha_itens_delete on public.folha_itens;

create policy folha_itens_select on public.folha_itens
  for select to authenticated using (nutri_id = auth.uid());
create policy folha_itens_insert on public.folha_itens
  for insert to authenticated
  with check (
    nutri_id = auth.uid()
    and exists (select 1 from public.folhas f
                 where f.id = folha_id and f.nutri_id = auth.uid() and f.status <> 'fechada')
    and exists (select 1 from public.funcionarios u where u.id = funcionario_id and u.nutri_id = auth.uid())
  );
create policy folha_itens_update on public.folha_itens
  for update to authenticated
  using (
    nutri_id = auth.uid()
    and exists (select 1 from public.folhas f where f.id = folha_id and f.status <> 'fechada')
  )
  with check (nutri_id = auth.uid());
create policy folha_itens_delete on public.folha_itens
  for delete to authenticated
  using (
    nutri_id = auth.uid()
    and exists (select 1 from public.folhas f where f.id = folha_id and f.status <> 'fechada')
  );


-- ---------------------------------------------------------------------------
-- 5) folha_adicionais
-- ---------------------------------------------------------------------------
drop policy if exists folha_adicionais_select on public.folha_adicionais;
drop policy if exists folha_adicionais_insert on public.folha_adicionais;
drop policy if exists folha_adicionais_update on public.folha_adicionais;
drop policy if exists folha_adicionais_delete on public.folha_adicionais;

create policy folha_adicionais_select on public.folha_adicionais
  for select to authenticated using (nutri_id = auth.uid());
create policy folha_adicionais_insert on public.folha_adicionais
  for insert to authenticated
  with check (
    nutri_id = auth.uid()
    and exists (
      select 1 from public.folha_itens i join public.folhas f on f.id = i.folha_id
       where i.id = item_id and i.nutri_id = auth.uid() and f.status <> 'fechada')
  );
create policy folha_adicionais_update on public.folha_adicionais
  for update to authenticated
  using (
    nutri_id = auth.uid()
    and exists (
      select 1 from public.folha_itens i join public.folhas f on f.id = i.folha_id
       where i.id = item_id and f.status <> 'fechada')
  )
  with check (nutri_id = auth.uid());
create policy folha_adicionais_delete on public.folha_adicionais
  for delete to authenticated
  using (
    nutri_id = auth.uid()
    and exists (
      select 1 from public.folha_itens i join public.folhas f on f.id = i.folha_id
       where i.id = item_id and f.status <> 'fechada')
  );


-- ---------------------------------------------------------------------------
-- 6) colaborador_documentos e documentos_pendentes
-- ---------------------------------------------------------------------------
drop policy if exists cd_nutri_select on public.colaborador_documentos;
drop policy if exists cd_nutri_insert on public.colaborador_documentos;
drop policy if exists cd_nutri_update on public.colaborador_documentos;
drop policy if exists cd_nutri_delete on public.colaborador_documentos;

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

drop policy if exists dp_nutri_all on public.documentos_pendentes;
create policy dp_nutri_all on public.documentos_pendentes
  for all to authenticated
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 7) O BUCKET
-- ---------------------------------------------------------------------------
drop policy if exists cd_storage_nutri on storage.objects;

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


-- ===========================================================================
-- Conferencia. Esperado depois do rollback:
--   com_organizacao = 0 · storage_migrada = 0 · defaults_migrados = 0
--   colaborador_intactas = 2 (so as de funcionario_do_auth) · linhas iguais
-- ===========================================================================
with alvo as (
  select unnest(array['folhas','folha_itens','folha_adicionais','funcionarios',
                      'colaborador_documentos','documentos_pendentes']) as t
)
select
  (select count(*) from pg_policies p join alvo on alvo.t = p.tablename
    where p.schemaname = 'public'
      and coalesce(p.qual,'') || coalesce(p.with_check,'') like '%organizacao_do_auth%')
                                                                    as com_organizacao,
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'cd_storage_nutri'
      and coalesce(qual,'') like '%organizacao_do_auth%')           as storage_migrada,
  (select count(*) from information_schema.columns c join alvo on alvo.t = c.table_name
    where c.table_schema = 'public' and c.column_name = 'nutri_id'
      and c.column_default like '%organizacao_do_auth%')            as defaults_migrados,
  (select count(*) from pg_policies p join alvo on alvo.t = p.tablename
    where p.schemaname = 'public'
      and coalesce(p.qual,'') like '%funcionario_do_auth%')         as colaborador_intactas,
  (select count(*) from public.folhas)                              as folhas,
  (select count(*) from public.folha_itens)                         as itens,
  (select count(*) from public.funcionarios)                        as funcionarios;
