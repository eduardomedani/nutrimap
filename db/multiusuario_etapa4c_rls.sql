-- ===========================================================================
-- Evollo · ETAPA 4C — RLS multiusuario no modulo Equipe
-- ---------------------------------------------------------------------------
-- 100% re-executavel. Desfazer: db/multiusuario_etapa4c_rls_desfazer.sql
--
-- Seis tabelas, um bucket, vinte e uma policies, seis defaults. Depois deste
-- arquivo, a Folha de pagamento deixa de ser do PROPRIETARIO e passa a ser da
-- ORGANIZACAO — quem tem `equipe.folha` opera.
--
-- ===========================================================================
-- A FASE 1 JA ESTA NO AR (commit 69b3da6, 02/09/2026)
-- ---------------------------------------------------------------------------
-- A ordem foi respeitada: o frontend parou de mandar `nutri_id` e de montar o
-- caminho do Storage com o uuid da pessoa ANTES desta migracao. Confira em
-- db/conferencia/112_prontidao_4c.sql, secao FASE 1.
--
-- ===========================================================================
-- O INCIDENTE QUE ORIGINOU A ETAPA
-- ---------------------------------------------------------------------------
-- Em 02/09/2026 uma conta de RH com `equipe.folha` concedido abriu a Folha, nao
-- viu a folha do mes e o sistema criou uma SEGUNDA, vazia, no nome dela. A
-- Fase 1 tratou a metade que era codigo (`abrirFolha` deixou de ler "zero
-- linhas" como "nao existe"). Esta e a outra metade: enquanto a RLS for
-- `nutri_id = auth.uid()`, ela ve a tela e nao ve o dado.
--
-- ===========================================================================
-- A DECISAO: TUDO SOB `equipe.folha`, E NAO SOB `equipe.visualizar`
-- ---------------------------------------------------------------------------
-- O catalogo tem duas chaves: `equipe.visualizar` ("ver o cadastro de
-- colaboradores") e `equipe.folha` ("ver e fechar folha e contracheques",
-- SENSIVEL). A tentacao e dar a tabela `funcionarios` para a primeira.
--
-- Nao da. `funcionarios` guarda SALARIO, CPF e CHAVE PIX nas proprias colunas,
-- e RLS protege LINHA, nao COLUNA — o mesmo problema que a Agenda ja enfrentou
-- (db/organizacao_schema.sql: "um `select` autorizado entrega as duas coisas").
-- Liberar a linha por `equipe.visualizar` entregaria o salario junto.
--
-- Entao as seis tabelas ficam sob `equipe.folha`, que e a chave sensivel, e
-- `equipe.visualizar` continua governando o menu.
--
-- E POR QUE NAO SEPARAR AS COLUNAS AGORA. Daria: uma RPC SECURITY DEFINER
-- devolvendo so nome, cargo e contato, com a tabela fechada — exatamente a
-- receita que a Agenda usa para nao entregar o prontuario. Mas hoje NINGUEM na
-- operacao tem `equipe.visualizar` sem `equipe.folha`: a conta de RH tem as
-- duas, e o unico perfil sem elas nao tem nenhuma. Construir a separacao seria
-- complexidade nascida de hipotese, e o projeto ja recusou isso antes ("chave
-- nascida do piloto, e nao da operacao"). Quando aparecer alguem que precise
-- ver o cadastro sem os valores, a receita esta escrita aqui.
--
-- ===========================================================================
-- O QUE ESTE ARQUIVO NAO TOCA, E POR QUE
-- ---------------------------------------------------------------------------
-- As policies do COLABORADOR ficam como estao, e sao SEIS — cinco em `public`
-- mais uma no Storage:
--
--   funcionarios_self_read             auth_user_id = auth.uid()
--   folhas_funcionario_read            folha_tem_linha_minha(id)
--   folha_itens_funcionario_read       funcionario_do_auth()
--   folha_adicionais_funcionario_read  item_e_meu(item_id)
--   cd_colaborador_select              funcionario_do_auth()
--   cd_storage_colaborador             funcionario_do_auth() + documento_e_meu()
--
-- Repare que sao TRES mecanismos, nao um. Nenhum deles fala de tenancy: todos
-- resolvem o vinculo da pessoa com o proprio dado. Migra-las nao faria sentido
-- — o colaborador nao pertence a organizacao no sentido de dono, ele e o
-- assunto do dado. Policies sao OR'd, entao as duas familias convivem.
--
-- A conferencia 112 verifica as cinco de `public` PELO NOME. A primeira versao
-- dela procurava `funcionario_do_auth` e acusou "ALGUMA SUMIU" porque so duas
-- usam essa funcao — alarme falso, corrigido antes de migrar.
--
-- A TRAVA DA FOLHA FECHADA tambem fica. `folha_itens` e `folha_adicionais`
-- recusam insert, update e delete quando `folhas.status = 'fechada'`, e isso
-- vale no banco, nao so na tela. A 4C troca o lado esquerdo da comparacao de
-- tenancy e nao encosta nessa regra.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) OS DEFAULTS
-- ---------------------------------------------------------------------------
-- Quem determina o tenant passa a ser o banco. `criado_por` NAO e tocado: e
-- essa diferenca que separa DONO de AUTOR — uma folha aberta pelo RH nasce com
-- nutri_id da organizacao e criado_por dela.
alter table public.folhas
  alter column nutri_id set default public.organizacao_do_auth();
alter table public.folha_itens
  alter column nutri_id set default public.organizacao_do_auth();
alter table public.folha_adicionais
  alter column nutri_id set default public.organizacao_do_auth();
alter table public.funcionarios
  alter column nutri_id set default public.organizacao_do_auth();
alter table public.colaborador_documentos
  alter column nutri_id set default public.organizacao_do_auth();
alter table public.documentos_pendentes
  alter column nutri_id set default public.organizacao_do_auth();


-- ---------------------------------------------------------------------------
-- 2) funcionarios
-- ---------------------------------------------------------------------------
-- `funcionarios_self_read` NAO aparece nos drops: e o acesso do colaborador ao
-- proprio cadastro, e ela resolve por `auth_user_id = auth.uid()` — a coluna
-- que liga o funcionario a conta dele. Derruba-la tiraria o contracheque do ar.
drop policy if exists funcionarios_select on public.funcionarios;
drop policy if exists funcionarios_insert on public.funcionarios;
drop policy if exists funcionarios_update on public.funcionarios;
drop policy if exists funcionarios_delete on public.funcionarios;

create policy funcionarios_select on public.funcionarios
  for select to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  );

create policy funcionarios_insert on public.funcionarios
  for insert to authenticated
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  );

create policy funcionarios_update on public.funcionarios
  for update to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  )
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  );

create policy funcionarios_delete on public.funcionarios
  for delete to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  );


-- ---------------------------------------------------------------------------
-- 3) folhas
-- ---------------------------------------------------------------------------
-- O DELETE mantem `status <> 'fechada'`: folha fechada nao se apaga, e isso e
-- anterior a qualquer discussao de tenancy.
drop policy if exists folhas_select on public.folhas;
drop policy if exists folhas_insert on public.folhas;
drop policy if exists folhas_update on public.folhas;
drop policy if exists folhas_delete on public.folhas;

create policy folhas_select on public.folhas
  for select to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  );

create policy folhas_insert on public.folhas
  for insert to authenticated
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  );

create policy folhas_update on public.folhas
  for update to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  )
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  );

create policy folhas_delete on public.folhas
  for delete to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
    and status <> 'fechada'
  );


-- ---------------------------------------------------------------------------
-- 4) folha_itens
-- ---------------------------------------------------------------------------
-- Os `exists` continuam, e continuam necessarios: sem eles uma linha entraria
-- apontando para folha ou funcionario de outra organizacao. O que muda e o lado
-- direito da comparacao.
--
-- A RLS das tabelas consultadas vale DENTRO destes `exists`. Como `folhas` e
-- `funcionarios` acabaram de exigir `equipe.folha`, quem nao tem a chave nao
-- passa nem aqui — o que e coerente: nao se lanca linha numa folha que nao se
-- pode ver.
drop policy if exists folha_itens_select on public.folha_itens;
drop policy if exists folha_itens_insert on public.folha_itens;
drop policy if exists folha_itens_update on public.folha_itens;
drop policy if exists folha_itens_delete on public.folha_itens;

create policy folha_itens_select on public.folha_itens
  for select to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  );

create policy folha_itens_insert on public.folha_itens
  for insert to authenticated
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
    and exists (select 1 from public.folhas f
                 where f.id = folha_id
                   and f.nutri_id = public.organizacao_do_auth()
                   and f.status <> 'fechada')
    and exists (select 1 from public.funcionarios u
                 where u.id = funcionario_id
                   and u.nutri_id = public.organizacao_do_auth())
  );

-- Folha FECHADA nao aceita mais mexer nas linhas — e isso vale no BANCO, nao
-- so na tela. Reabrir continua possivel: quem muda de status e a tabela
-- `folhas`, que nao tem essa trava. Corrigir pagamento e legitimo; corrigir
-- sem deixar rastro de que a folha foi reaberta, nao.
create policy folha_itens_update on public.folha_itens
  for update to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
    and exists (select 1 from public.folhas f where f.id = folha_id and f.status <> 'fechada')
  )
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  );

create policy folha_itens_delete on public.folha_itens
  for delete to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
    and exists (select 1 from public.folhas f where f.id = folha_id and f.status <> 'fechada')
  );


-- ---------------------------------------------------------------------------
-- 5) folha_adicionais
-- ---------------------------------------------------------------------------
-- Mesma regra dos itens: adicional de folha fechada nao entra, nao muda e nao
-- sai. A trava mora no estado da folha, uma consulta acima.
drop policy if exists folha_adicionais_select on public.folha_adicionais;
drop policy if exists folha_adicionais_insert on public.folha_adicionais;
drop policy if exists folha_adicionais_update on public.folha_adicionais;
drop policy if exists folha_adicionais_delete on public.folha_adicionais;

create policy folha_adicionais_select on public.folha_adicionais
  for select to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  );

create policy folha_adicionais_insert on public.folha_adicionais
  for insert to authenticated
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
    and exists (
      select 1 from public.folha_itens i join public.folhas f on f.id = i.folha_id
       where i.id = item_id
         and i.nutri_id = public.organizacao_do_auth()
         and f.status <> 'fechada')
  );

create policy folha_adicionais_update on public.folha_adicionais
  for update to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
    and exists (
      select 1 from public.folha_itens i join public.folhas f on f.id = i.folha_id
       where i.id = item_id and f.status <> 'fechada')
  )
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  );

create policy folha_adicionais_delete on public.folha_adicionais
  for delete to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
    and exists (
      select 1 from public.folha_itens i join public.folhas f on f.id = i.folha_id
       where i.id = item_id and f.status <> 'fechada')
  );


-- ---------------------------------------------------------------------------
-- 6) colaborador_documentos e documentos_pendentes
-- ---------------------------------------------------------------------------
-- E aqui que mora a folha de ponto: ela nao e tabela, e PDF anexado ao
-- colaborador. `cd_colaborador_select` nao aparece nos drops — e o acesso do
-- colaborador ao proprio contracheque.
drop policy if exists cd_nutri_select on public.colaborador_documentos;
drop policy if exists cd_nutri_insert on public.colaborador_documentos;
drop policy if exists cd_nutri_update on public.colaborador_documentos;
drop policy if exists cd_nutri_delete on public.colaborador_documentos;

create policy cd_nutri_select on public.colaborador_documentos
  for select to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  );

create policy cd_nutri_insert on public.colaborador_documentos
  for insert to authenticated
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
    and exists (
      select 1 from public.funcionarios u
       where u.id = colaborador_id
         and u.nutri_id = public.organizacao_do_auth())
  );

create policy cd_nutri_update on public.colaborador_documentos
  for update to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  )
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  );

create policy cd_nutri_delete on public.colaborador_documentos
  for delete to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  );

drop policy if exists dp_nutri_all on public.documentos_pendentes;
create policy dp_nutri_all on public.documentos_pendentes
  for all to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  )
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('equipe.folha')
  );


-- ---------------------------------------------------------------------------
-- 7) O BUCKET — a peca que a 4B nao tinha
-- ---------------------------------------------------------------------------
-- O caminho e {nutri_id}/{colaborador_id}/{AAAA-MM}/{tipo}/{arquivo}, e a
-- policy confere o PRIMEIRO pedaco contra o dono.
--
-- NENHUM ARQUIVO PRECISA SER MOVIDO. `organizacoes.id` E o auth.uid() do
-- proprietario (db/organizacao_schema.sql: "id = auth.uid() do proprietario: e
-- a estrategia inteira"), entao os arquivos que ja existem estao exatamente na
-- pasta que a policy nova vai exigir. O que muda e quem mais alcanca aquela
-- pasta: quem tem `equipe.folha` na mesma organizacao.
--
-- `cd_storage_colaborador` NAO e tocada: ela confere a pasta 2 contra
-- `funcionario_do_auth()` e ainda passa por `documento_e_meu(name)`, que le a
-- TABELA — documento arquivado ou em rascunho deixa de abrir mesmo que o
-- colaborador guarde o link.
drop policy if exists cd_storage_nutri on storage.objects;

create policy cd_storage_nutri on storage.objects
  for all to authenticated
  using (
    bucket_id = 'colaborador-documentos'
    and (storage.foldername(name))[1] = public.organizacao_do_auth()::text
    and public.tem_permissao('equipe.folha')
  )
  with check (
    bucket_id = 'colaborador-documentos'
    and (storage.foldername(name))[1] = public.organizacao_do_auth()::text
    and public.tem_permissao('equipe.folha')
  );


-- ===========================================================================
-- Conferencia. Esperado:
--   policies_migradas = 21   (4 funcionarios + 4 folhas + 4 itens + 4 adicionais
--                             + 4 colaborador_documentos + 1 documentos_pendentes)
--   sem_permissao     = 0    nenhuma migrada sem `tem_permissao`
--   defaults          = 6
--   storage_migrada   = 1
--   colaborador_intactas = 2  SO as que usam funcionario_do_auth(); as outras
--                             tres do colaborador usam outros mecanismos e a
--                             conferencia 112 as verifica pelo nome
--   linhas = as mesmas de antes (nenhum dado e escrito por este arquivo)
-- ===========================================================================
with alvo as (
  select unnest(array['folhas','folha_itens','folha_adicionais','funcionarios',
                      'colaborador_documentos','documentos_pendentes']) as t
)
select
  (select count(*) from pg_policies p join alvo on alvo.t = p.tablename
    where p.schemaname = 'public'
      and coalesce(p.qual,'') || coalesce(p.with_check,'') like '%organizacao_do_auth%')
                                                                    as policies_migradas,
  (select count(*) from pg_policies p join alvo on alvo.t = p.tablename
    where p.schemaname = 'public'
      and coalesce(p.qual,'') || coalesce(p.with_check,'') like '%organizacao_do_auth%'
      and coalesce(p.qual,'') || coalesce(p.with_check,'') not like '%tem_permissao%')
                                                                    as sem_permissao,
  (select count(*) from information_schema.columns c join alvo on alvo.t = c.table_name
    where c.table_schema = 'public' and c.column_name = 'nutri_id'
      and c.column_default like '%organizacao_do_auth%')            as defaults,
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'cd_storage_nutri'
      and coalesce(qual,'') like '%organizacao_do_auth%')           as storage_migrada,
  (select count(*) from pg_policies p join alvo on alvo.t = p.tablename
    where p.schemaname = 'public'
      and coalesce(p.qual,'') like '%funcionario_do_auth%')         as colaborador_intactas,
  (select count(*) from public.folhas)                              as folhas,
  (select count(*) from public.folha_itens)                         as itens,
  (select count(*) from public.funcionarios)                        as funcionarios;
