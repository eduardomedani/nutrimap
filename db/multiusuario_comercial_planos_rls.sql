-- ===========================================================================
-- Evollo · ETAPA 4A — RLS multiusuario em public.comercial_planos
-- ---------------------------------------------------------------------------
-- O PILOTO. Uma tabela, quatro policies, um default. Mais nada.
--
-- 100% re-executavel. Desfazer: db/multiusuario_comercial_planos_rls_desfazer.sql
--
-- ===========================================================================
-- ANTES DE RODAR: O FRONTEND PRECISA ESTAR NO AR
-- ---------------------------------------------------------------------------
-- js/organizacao.js e as tres funcoes de plano em js/comercial-data.js vem
-- PRIMEIRO, e a ordem nao e preferencia.
--
-- Com a policy migrada e o frontend antigo, a Recepcao pediria
-- `.eq('nutri_id', <uuid dela>)` contra uma policy que exige a organizacao: a
-- consulta nao casaria com nada e a tela abriria VAZIA, sem erro. E o
-- proprietario nao perceberia, porque para ele os dois valores sao iguais.
--
-- Na ordem certa nao ha janela de quebra: o frontend novo pede a organizacao,
-- que para o proprietario e o mesmo uuid de sempre, e a policy antiga aceita.
--
-- ===========================================================================
-- POR QUE SO comercial_planos, E NAO O MODULO COMERCIAL INTEIRO
-- ---------------------------------------------------------------------------
-- `comercial_assinaturas` NAO e independente, e o preflight do frontend
-- mostrou por que:
--
--   . o front a le com `embed` de `pacientes` — e embed do PostgREST carrega a
--     RLS da tabela embutida. Com pacientes ainda em auth.uid(), a Recepcao
--     veria a lista com `paciente: null` em toda linha, sem erro;
--   . a policy de INSERT dela tem `exists (select 1 from pacientes ...)`, e a
--     RLS de pacientes tambem vale DENTRO da subconsulta da policy — a
--     Recepcao nao conseguiria contratar para ninguem;
--   . criar cobranca ESCREVE em financeiro_lancamentos, que e outro modulo.
--
-- Contornar isso exigiria uma funcao SECURITY DEFINER em volta de pacientes,
-- semanas antes de migrar pacientes. Seria divida nascida no piloto.
--
-- `comercial_planos` e catalogo puro: sem paciente, sem exists, sem embed, sem
-- financeiro. E a unica fatia do modulo que se sustenta sozinha.
--
-- ===========================================================================
-- O PADRAO QUE ESTE ARQUIVO ESTABELECE
-- ---------------------------------------------------------------------------
-- Toda policy da Etapa 4 passa a ter DUAS condicoes, e nao uma:
--
--   nutri_id = public.organizacao_do_auth()    DE QUEM E o dado
--   and public.tem_permissao('<chave>')        O QUE a pessoa pode fazer
--
-- Trocar so a primeira faria qualquer membro ativo enxergar tudo o que a
-- organizacao tem. A troca de tenancy sem permissao nao e um avanco: e uma
-- regressao de privacidade com cara de progresso.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) O DEFAULT DA COLUNA
-- ---------------------------------------------------------------------------
-- O front deixou de mandar `nutri_id` no insert: quem determina o tenant e o
-- banco. Sem esta linha, um insert da Recepcao gravaria o uuid DELA — e o
-- `with check` recusaria, com um erro que nao explica nada.
--
-- Para o proprietario nada muda: organizacao_do_auth() devolve o mesmo uuid
-- que auth.uid() devolvia.
--
-- `criado_por` NAO e tocado. Ele continua `default auth.uid()`, e e essa
-- diferenca que separa DONO de AUTOR: um plano criado pela Recepcao nasce com
-- nutri_id da organizacao e criado_por dela.
-- ---------------------------------------------------------------------------
alter table public.comercial_planos
  alter column nutri_id set default public.organizacao_do_auth();


-- ---------------------------------------------------------------------------
-- 2) AS QUATRO POLICIES
-- ---------------------------------------------------------------------------
drop policy if exists comercial_planos_select on public.comercial_planos;
drop policy if exists comercial_planos_insert on public.comercial_planos;
drop policy if exists comercial_planos_update on public.comercial_planos;
drop policy if exists comercial_planos_delete on public.comercial_planos;

create policy comercial_planos_select on public.comercial_planos
  for select to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('comercial.visualizar')
  );

-- O `with check` e a unica defesa contra tenant forjado. O default resolve o
-- caso honesto; isto resolve o request adulterado no DevTools que mande
-- `nutri_id` de outra organizacao.
create policy comercial_planos_insert on public.comercial_planos
  for insert to authenticated
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('comercial.editar')
  );

-- USING e WITH CHECK exigem a MESMA chave, e as duas sao `editar`.
--
-- No UPDATE o `using` decide QUAIS LINHAS podem ser alvo e o `with check`
-- decide COMO ELAS PODEM FICAR. Pedir `visualizar` no `using` deixaria quem so
-- le selecionar a linha e receber a recusa la na frente: mesmo resultado, com
-- um erro que aponta para o lugar errado.
--
-- E como o `with check` tambem exige `nutri_id = organizacao_do_auth()`, nao ha
-- update capaz de MOVER um plano para outra organizacao — a linha resultante
-- teria de continuar sendo desta.
create policy comercial_planos_update on public.comercial_planos
  for update to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('comercial.editar')
  )
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('comercial.editar')
  );

-- DELETE sob `comercial.editar`, e nao sob uma chave nova.
--
-- Nao existe um unico `.delete()` em nenhum arquivo do modulo Comercial —
-- planos sao DESATIVADOS pelo campo `ativo`. A policy existe e continua
-- protegida, mas nao ha acao nova na interface. Criar `comercial.excluir`
-- seria chave nascida do piloto, e nao da operacao.
create policy comercial_planos_delete on public.comercial_planos
  for delete to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('comercial.editar')
  );


-- ===========================================================================
-- Conferencia. Esperado:
--   policies = 4 · com_organizacao = 4 · com_permissao = 4
--   default_nutri_id  = organizacao_do_auth()
--   default_criado_por = auth.uid()   (INTOCADO)
--   linhas e donos = os mesmos de antes
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
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'comercial_planos'
      and column_name = 'criado_por')                                          as default_criado_por,
  (select count(*) from public.comercial_planos)                               as linhas,
  (select count(distinct nutri_id) from public.comercial_planos)               as donos;
