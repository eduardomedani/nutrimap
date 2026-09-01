-- ===========================================================================
-- Evollo · ETAPA 4B — RLS multiusuario no Comercial, no Financeiro e em pacientes
-- ---------------------------------------------------------------------------
-- 100% re-executavel. Desfazer: db/multiusuario_etapa4b_rls_desfazer.sql
--
-- Cinco tabelas, vinte policies, cinco defaults. Depois deste arquivo, o
-- modulo Comercial deixa de ser do PROPRIETARIO e passa a ser da ORGANIZACAO.
--
-- ===========================================================================
-- NAO RODE ISTO ANTES DA FASE 1 ESTAR NO AR
-- ---------------------------------------------------------------------------
-- A Fase 1 (frontend) vem PRIMEIRO, e a ordem nao e preferencia. Ela ja esta
-- escrita e testada, mas so vale depois de commit + push + deploy.
--
-- Com a policy migrada e o frontend antigo em producao:
--
--   . as LEITURAS do Comercial pediriam `nutri_id = <uuid da pessoa>` contra
--     uma policy que exige a organizacao. Para o proprietario daria no mesmo, e
--     ele nao perceberia nada — para a Recepcao a tela continuaria vazia, que e
--     exatamente o sintoma que esta etapa existe para curar;
--   . os INSERTS do Financeiro ainda mandariam `nutri_id` explicito, vindo do
--     encanamento de `initFinanceiroUI`. Para o proprietario passa; para
--     qualquer outro o `with check` recusaria, com um erro que nao explica
--     nada.
--
-- Confira antes: db/conferencia/109_prontidao_4b.sql, secao FASE 1.
--
-- ===========================================================================
-- AS TRES DECISOES QUE ESTE ARQUIVO GRAVA
-- ---------------------------------------------------------------------------
-- 1. COBRANCA DE CLIENTE ABRE PARA O COMERCIAL; O RESTO DO CAIXA, NAO.
--
--    `financeiro_lancamentos` guarda duas coisas na mesma tabela — "a cobranca
--    E o lancamento". Mas o catalogo de permissoes separa as duas de proposito
--    (db/organizacao_schema.sql, o comentario "comercial/cobranca x
--    financeiro"), e a Recepcao tem `comercial.*` sem ter `financeiro.*`.
--
--    Exigir `financeiro.visualizar` deixaria a Recepcao sem ver as cobrancas —
--    nao resolveria nada. Exigir `comercial.visualizar` entregaria o fluxo de
--    caixa inteiro da empresa. Entao a policy olha A FORMA DA LINHA:
--
--      assinatura_id is not null  -> cobranca de cliente -> comercial.*
--      qualquer outra linha       -> caixa da empresa    -> financeiro.*
--
--    Isso casa com o que a tela ja faz: `receitasDeClientes()` em
--    js/comercial-data.js filtra `assinatura_id not null`. As receitas avulsas
--    da planilha de vendas ficam do lado do Financeiro, que e onde elas estao.
--
-- 2. APAGAR PACIENTE CONTINUA SO DO PROPRIETARIO.
--
--    `clientes.editar` deixa a Recepcao corrigir telefone, nao apagar gente.
--    Apagar paciente cascateia respostas, exames, avaliacoes e documentos. A
--    policy de DELETE exige `auth.uid() = organizacao_do_auth()`, que so e
--    verdade para o dono da organizacao.
--
-- 3. `clientes.visualizar` NAO ARRASTA O PRONTUARIO.
--
--    E o §25 da Etapa 1, e ele se sustenta sozinho: toda policy de anamnese,
--    avaliacao, check-in, consulta e documento compara `p.nutri_id = auth.uid()`
--    DENTRO do proprio `exists`, alem da RLS de pacientes. Migrar pacientes faz
--    a RLS passar para a Recepcao, mas a comparacao explicita continua falhando.
--    Este arquivo NAO toca em nenhuma tabela clinica, e a conferencia 109 prova
--    que elas continuam fechadas.
--
-- ===========================================================================
-- O PADRAO, HERDADO DA ETAPA 4A
-- ---------------------------------------------------------------------------
-- Toda policy tem DUAS condicoes, e nao uma:
--
--   nutri_id = public.organizacao_do_auth()    DE QUEM E o dado
--   and public.tem_permissao('<chave>')        O QUE a pessoa pode fazer
--
-- Trocar so a primeira faria qualquer membro ativo enxergar tudo o que a
-- organizacao tem. Tenancy sem permissao nao e avanco: e regressao de
-- privacidade com cara de progresso.
--
-- RLS VALE DENTRO DA SUBCONSULTA DA POLICY. Os `exists` daqui (paciente da
-- assinatura, categoria do lancamento) carregam a RLS da tabela consultada.
-- E por isso que `financeiro_categorias` abre no SELECT para os dois modulos:
-- sem isso, a Recepcao criaria cobranca e o `exists` da categoria falharia.
--
-- `organizacao_do_auth()` DEVOLVE O UUID DO PROPRIETARIO. `organizacoes.id` e
-- gravado como o `auth.uid()` do dono (db/organizacao_schema.sql: "id =
-- auth.uid() do proprietario: e a estrategia inteira"), entao todas as FKs de
-- `nutri_id` continuam validas sem tocar em uma linha de dado.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) OS DEFAULTS
-- ---------------------------------------------------------------------------
-- Quem determina o tenant passa a ser o banco. `criado_por` e `criado_em` NAO
-- sao tocados: e essa diferenca que separa DONO de AUTOR — uma cobranca criada
-- pela Recepcao nasce com nutri_id da organizacao e criado_por dela.
--
-- `pacientes.nutri_id` era `not null` SEM DEFAULT, e e por isso que a Fase 1
-- ainda manda o campo em `criarPaciente`. Depois desta linha ele pode sair do
-- frontend — mas so depois.
alter table public.pacientes
  alter column nutri_id set default public.organizacao_do_auth();
alter table public.comercial_assinaturas
  alter column nutri_id set default public.organizacao_do_auth();
alter table public.financeiro_lancamentos
  alter column nutri_id set default public.organizacao_do_auth();
alter table public.financeiro_categorias
  alter column nutri_id set default public.organizacao_do_auth();
alter table public.financeiro_centros_custo
  alter column nutri_id set default public.organizacao_do_auth();


-- ---------------------------------------------------------------------------
-- 2) pacientes
-- ---------------------------------------------------------------------------
-- A policy antiga era UMA so, `for all`, chamada "Nutri ve proprios pacientes".
-- Vira quatro, porque as quatro acoes tem chaves diferentes — e porque DELETE
-- precisa de uma condicao que as outras nao tem.
--
-- `pacientes_self_read` NAO E TOCADA. E o acesso do proprio cliente a sua
-- linha pelo PWA (`auth_user_id = auth.uid()`), e policies sao OR'd: derruba-la
-- tiraria o aluno do ar.
drop policy if exists "Nutri ve proprios pacientes" on public.pacientes;
drop policy if exists pacientes_select on public.pacientes;
drop policy if exists pacientes_insert on public.pacientes;
drop policy if exists pacientes_update on public.pacientes;
drop policy if exists pacientes_delete on public.pacientes;

create policy pacientes_select on public.pacientes
  for select to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('clientes.visualizar')
  );

create policy pacientes_insert on public.pacientes
  for insert to authenticated
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('clientes.criar')
  );

create policy pacientes_update on public.pacientes
  for update to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('clientes.editar')
  )
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('clientes.editar')
  );

-- DELETE SO DO PROPRIETARIO — decisao 2 do cabecalho.
--
-- `auth.uid() = organizacao_do_auth()` so e verdade para o dono: para todo
-- outro membro, o uuid da pessoa e diferente do uuid da organizacao. Nao ha
-- chave de permissao para isto de proposito — criar `clientes.excluir` faria a
-- exclusao virar algo que se DELEGA, e a decisao foi a oposta.
create policy pacientes_delete on public.pacientes
  for delete to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and auth.uid() = public.organizacao_do_auth()
  );


-- ---------------------------------------------------------------------------
-- 3) comercial_assinaturas
-- ---------------------------------------------------------------------------
-- O `exists` sobre pacientes continua, e continua sendo necessario: sem ele um
-- insert com o paciente_id de outra organizacao passaria, porque a policy so
-- olha o nutri_id da propria linha. O que muda e o lado direito da comparacao.
--
-- Como a RLS de pacientes vale dentro deste `exists`, quem tiver
-- `comercial.editar` sem ter `clientes.visualizar` nao consegue contratar. E o
-- comportamento certo: nao se fecha contrato para alguem que nao se pode ver.
drop policy if exists comercial_assinaturas_select on public.comercial_assinaturas;
drop policy if exists comercial_assinaturas_insert on public.comercial_assinaturas;
drop policy if exists comercial_assinaturas_update on public.comercial_assinaturas;
drop policy if exists comercial_assinaturas_delete on public.comercial_assinaturas;

create policy comercial_assinaturas_select on public.comercial_assinaturas
  for select to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('comercial.visualizar')
  );

create policy comercial_assinaturas_insert on public.comercial_assinaturas
  for insert to authenticated
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('comercial.editar')
    and exists (select 1 from public.pacientes p
                 where p.id = paciente_id
                   and p.nutri_id = public.organizacao_do_auth())
  );

create policy comercial_assinaturas_update on public.comercial_assinaturas
  for update to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('comercial.editar')
  )
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('comercial.editar')
    and exists (select 1 from public.pacientes p
                 where p.id = paciente_id
                   and p.nutri_id = public.organizacao_do_auth())
  );

-- DELETE sob `comercial.editar`. Nao ha `.delete()` de assinatura em nenhum
-- arquivo do modulo — contrato se CANCELA pelo campo `status`. A policy existe
-- e continua protegida, mas nao ha acao nova na interface.
create policy comercial_assinaturas_delete on public.comercial_assinaturas
  for delete to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('comercial.editar')
  );


-- ---------------------------------------------------------------------------
-- 4) financeiro_lancamentos — A TABELA DE DOIS DONOS
-- ---------------------------------------------------------------------------
-- Decisao 1 do cabecalho, escrita como policy. A linha com `assinatura_id`
-- preenchido e a cobranca de um cliente e pertence ao Comercial; toda outra e
-- caixa da empresa e pertence ao Financeiro.
--
-- Quem tem as duas permissoes ve tudo — o `or` resolve. Quem so tem Comercial
-- ve exatamente as cobrancas, e nem uma despesa.
drop policy if exists financeiro_lancamentos_select on public.financeiro_lancamentos;
drop policy if exists financeiro_lancamentos_insert on public.financeiro_lancamentos;
drop policy if exists financeiro_lancamentos_update on public.financeiro_lancamentos;
drop policy if exists financeiro_lancamentos_delete on public.financeiro_lancamentos;

create policy financeiro_lancamentos_select on public.financeiro_lancamentos
  for select to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and (
      (assinatura_id is not null and public.tem_permissao('comercial.visualizar'))
      or public.tem_permissao('financeiro.visualizar')
    )
  );

-- As checagens de categoria e centro de custo continuam: sem elas um id de
-- outra organizacao entraria pela API e o relatorio dela somaria uma linha
-- alheia. A RLS das duas tabelas vale dentro destes `exists` — ver o SELECT de
-- financeiro_categorias mais abaixo, que abre para os dois modulos por isso.
create policy financeiro_lancamentos_insert on public.financeiro_lancamentos
  for insert to authenticated
  with check (
    nutri_id = public.organizacao_do_auth()
    and (
      (assinatura_id is not null and public.tem_permissao('comercial.editar'))
      or public.tem_permissao('financeiro.lancar')
    )
    and (categoria_id is null or exists (
      select 1 from public.financeiro_categorias c
       where c.id = categoria_id and c.nutri_id = public.organizacao_do_auth()))
    and (centro_custo_id is null or exists (
      select 1 from public.financeiro_centros_custo cc
       where cc.id = centro_custo_id and cc.nutri_id = public.organizacao_do_auth()))
  );

create policy financeiro_lancamentos_update on public.financeiro_lancamentos
  for update to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and (
      (assinatura_id is not null and public.tem_permissao('comercial.editar'))
      or public.tem_permissao('financeiro.editar')
    )
  )
  with check (
    nutri_id = public.organizacao_do_auth()
    and (
      (assinatura_id is not null and public.tem_permissao('comercial.editar'))
      or public.tem_permissao('financeiro.editar')
    )
    and (categoria_id is null or exists (
      select 1 from public.financeiro_categorias c
       where c.id = categoria_id and c.nutri_id = public.organizacao_do_auth()))
    and (centro_custo_id is null or exists (
      select 1 from public.financeiro_centros_custo cc
       where cc.id = centro_custo_id and cc.nutri_id = public.organizacao_do_auth()))
  );

-- DELETE SO PELO FINANCEIRO, sem o ramo do Comercial.
--
-- Cobranca nao se apaga: `comercial_cancelar_cobranca` muda o status e a linha
-- continua existindo, porque ela E a receita. Dar DELETE a `comercial.editar`
-- abriria um caminho para sumir com dinheiro ja registrado, sem trilha.
create policy financeiro_lancamentos_delete on public.financeiro_lancamentos
  for delete to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('financeiro.editar')
  );


-- ---------------------------------------------------------------------------
-- 5) financeiro_categorias
-- ---------------------------------------------------------------------------
-- O SELECT ABRE PARA OS DOIS MODULOS, e nao e generosidade: a Recepcao precisa
-- ler a categoria de receita para criar a cobranca, e o `exists` do
-- `financeiro_lancamentos_insert` carrega a RLS desta tabela. Sem isto, criar
-- cobranca falharia com um erro que aponta para o lugar errado.
--
-- Categoria e CATALOGO — nome de pacote, sem valor. Ler nao entrega caixa.
-- Escrever, sim: mexer no catalogo muda como todo o balanco e agrupado, e isso
-- fica com o Financeiro.
drop policy if exists financeiro_categorias_select on public.financeiro_categorias;
drop policy if exists financeiro_categorias_insert on public.financeiro_categorias;
drop policy if exists financeiro_categorias_update on public.financeiro_categorias;
drop policy if exists financeiro_categorias_delete on public.financeiro_categorias;

create policy financeiro_categorias_select on public.financeiro_categorias
  for select to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and (public.tem_permissao('financeiro.visualizar')
         or public.tem_permissao('comercial.visualizar'))
  );

create policy financeiro_categorias_insert on public.financeiro_categorias
  for insert to authenticated
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('financeiro.lancar')
  );

create policy financeiro_categorias_update on public.financeiro_categorias
  for update to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('financeiro.editar')
  )
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('financeiro.editar')
  );

create policy financeiro_categorias_delete on public.financeiro_categorias
  for delete to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('financeiro.editar')
  );


-- ---------------------------------------------------------------------------
-- 6) financeiro_centros_custo
-- ---------------------------------------------------------------------------
-- Centro de custo so existe em despesa. Nao ha ramo do Comercial aqui, nem no
-- SELECT: a Recepcao nao lanca despesa, entao nao precisa do catalogo delas.
drop policy if exists financeiro_centros_custo_select on public.financeiro_centros_custo;
drop policy if exists financeiro_centros_custo_insert on public.financeiro_centros_custo;
drop policy if exists financeiro_centros_custo_update on public.financeiro_centros_custo;
drop policy if exists financeiro_centros_custo_delete on public.financeiro_centros_custo;

create policy financeiro_centros_custo_select on public.financeiro_centros_custo
  for select to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('financeiro.visualizar')
  );

create policy financeiro_centros_custo_insert on public.financeiro_centros_custo
  for insert to authenticated
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('financeiro.lancar')
  );

create policy financeiro_centros_custo_update on public.financeiro_centros_custo
  for update to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('financeiro.editar')
  )
  with check (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('financeiro.editar')
  );

create policy financeiro_centros_custo_delete on public.financeiro_centros_custo
  for delete to authenticated
  using (
    nutri_id = public.organizacao_do_auth()
    and public.tem_permissao('financeiro.editar')
  );


-- ===========================================================================
-- O QUE ESTE ARQUIVO NAO FAZ, e onde isso mora
-- ---------------------------------------------------------------------------
--   o TETO TEMPORARIO das RPCs -> db/multiusuario_etapa4b_rpc.sql, que roda
--      DEPOIS deste. Enquanto ele nao rodar, a Recepcao ve o Comercial e nao
--      consegue registrar pagamento — meia etapa, e visivel.
--
--   `fn_lancamento_paciente_do_nutri` -> NAO precisa mudar. Ela ja compara
--      `p.nutri_id = new.nutri_id`, tenant contra tenant, e e SECURITY DEFINER
--      (a RLS nao vale dentro dela). Continua correta como esta.
--
--   as tabelas clinicas -> continuam em `auth.uid()`, de proposito. Ver a
--      decisao 3 do cabecalho.
-- ===========================================================================


-- ===========================================================================
-- Conferencia. Esperado:
--   policies = 21 (20 novas + pacientes_self_read, intocada)
--   sem_organizacao = 1 (so pacientes_self_read, que e do proprio cliente)
--   sem_permissao   = 2 (pacientes_self_read e pacientes_delete, que usa
--                        auth.uid() = organizacao_do_auth() em vez de chave)
--   defaults = 5 x organizacao_do_auth()
--   linhas e donos = os mesmos de antes
-- ===========================================================================
with alvo as (
  select unnest(array['pacientes','comercial_assinaturas','financeiro_lancamentos',
                      'financeiro_categorias','financeiro_centros_custo']) as t
)
select
  (select count(*) from pg_policies p join alvo on alvo.t = p.tablename
    where p.schemaname = 'public')                                          as policies,
  (select count(*) from pg_policies p join alvo on alvo.t = p.tablename
    where p.schemaname = 'public'
      and coalesce(p.qual,'') || coalesce(p.with_check,'') not like '%organizacao_do_auth%')
                                                                            as sem_organizacao,
  (select count(*) from pg_policies p join alvo on alvo.t = p.tablename
    where p.schemaname = 'public'
      and coalesce(p.qual,'') || coalesce(p.with_check,'') not like '%tem_permissao%')
                                                                            as sem_permissao,
  (select count(*) from information_schema.columns c join alvo on alvo.t = c.table_name
    where c.table_schema = 'public' and c.column_name = 'nutri_id'
      and c.column_default like '%organizacao_do_auth%')                    as defaults_migrados,
  (select count(*) from public.pacientes)                                   as pacientes,
  (select count(*) from public.comercial_assinaturas)                       as assinaturas,
  (select count(*) from public.financeiro_lancamentos)                      as lancamentos,
  (select count(distinct nutri_id) from public.pacientes)                   as donos_de_paciente;
