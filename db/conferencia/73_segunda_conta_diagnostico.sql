-- ===========================================================================
-- DIAGNOSTICO DAS CONTAS DE NUTRICIONISTA FORA DA ORGANIZACAO
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. Um select so, sem tabela temporaria, sem objeto criado.
--
-- POR QUE ESTE SCRIPT EXISTE. O item 7 do script 71 acusou 1 paciente com
-- nutri_id de outra conta. Ao levantar, apareceram QUATRO contas de
-- nutricionista fora de organizacao_usuarios — nao uma.
--
-- ISSO E BLOQUEADOR DA ETAPA 4: no dia em que a policy de pacientes trocar
-- `nutri_id = auth.uid()` por `nutri_id = organizacao_do_auth()`, TODAS elas
-- passam a receber NULL da funcao. Quem tem dado perde o dado; quem nao tem
-- passa a ver um painel vazio sem erro nenhum na tela — que e o modo de falha
-- mais dificil de diagnosticar que este projeto ja teve.
--
-- ESTE SCRIPT NAO DECIDE NADA. Ele levanta.
--
-- ===========================================================================
-- TODA LINHA E CHAVEADA PELO EMAIL DA CONTA, E ISSO IMPORTA
-- ---------------------------------------------------------------------------
-- A primeira versao devolvia os campos em blocos (todos os ids, depois todos
-- os emails, depois todos os logins). Com uma conta so funcionava; com quatro,
-- nao ha garantia nenhuma de que a ordem dentro de cada bloco seja a mesma —
-- o Postgres nao promete isso. Dava para ler o email de uma conta ao lado do
-- ultimo login de outra e nao perceber.
--
-- Agora `conta` e a primeira coluna de TODA linha. A correlacao deixa de
-- depender da ordem das linhas.
--
-- COMO ELE CONTA SEM SABER AS TABELAS. Em vez de listar as 41 tabelas com
-- nutri_id a mao — lista que envelhece —, descobre em information_schema e
-- conta cada uma com query_to_xml. Leitura pura.
--
-- Para colar no SQL Editor, use db/conferencia/73_segunda_conta_diagnostico_LIMPO.sql
-- ===========================================================================

with conta as (
  select n.id, u.email, n.nome, u.created_at, u.last_sign_in_at
    from public.nutricionistas n
    join auth.users u on u.id = n.id
   where not exists (
     select 1 from public.organizacao_usuarios ou where ou.auth_user_id = n.id
   )
),
identidade as (
  select k.email as conta, 1 as secao, 0 as ordem, 'id' as item, k.id::text as valor from conta k
  union all select k.email, 1, 1, 'nome',         coalesce(k.nome, '(sem nome)') from conta k
  union all select k.email, 1, 2, 'criada em',    k.created_at::date::text from conta k
  union all select k.email, 1, 3, 'ultimo login',
         coalesce(k.last_sign_in_at::date::text, 'NUNCA ENTROU')
         || case when k.last_sign_in_at > now() - interval '30 days' then '  [ATIVA]' else '' end
         from conta k
  union all select k.email, 1, 4, 'esta em admins',
         case when exists (select 1 from public.admins a where a.user_id = k.id) then 'SIM' else 'nao' end
         from conta k
),
tabelas as (
  select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public'
     and c.column_name = 'nutri_id'
     and t.table_type = 'BASE TABLE'
),
contagens as (
  select k.email as conta, 2 as secao,
         row_number() over (partition by k.email order by t.table_name) as ordem,
         'dado em ' || t.table_name as item,
         (xpath('/row/c/text()',
                query_to_xml(format('select count(*) as c from public.%I where nutri_id = %L',
                                    t.table_name, k.id),
                             false, true, '')))[1]::text as valor
    from tabelas t cross join conta k
),
pacientes as (
  select k.email as conta, 3 as secao,
         row_number() over (partition by k.email order by p.criado_em) as ordem,
         'paciente: ' || coalesce(nullif(btrim(p.nome), ''), '(sem nome)') as item,
         'codigo ' || p.codigo
           || ' | status ' || coalesce(p.status, '-')
           || ' | criado ' || p.criado_em::date::text
           || ' | login proprio: ' || case when p.auth_user_id is null then 'nao' else 'SIM' end as valor
    from public.pacientes p cross join conta k
   where p.nutri_id = k.id
),
arquivos as (
  select k.email as conta, 4 as secao, 0 as ordem,
         'objetos no Storage' as item,
         (select count(*) from storage.objects so
           where (storage.foldername(so.name))[1] = k.id::text)::text as valor
    from conta k
),
guarda as (
  select '~ RESUMO' as conta, 0 as secao, 0 as ordem,
         'contas de nutricionista fora da organizacao' as item,
         (select count(*)::text from conta) as valor
  union all
  select '~ RESUMO', 0, 1, 'dessas, quantas tem algum dado',
         (select count(distinct k.id)::text
            from conta k
           where exists (select 1 from public.pacientes p where p.nutri_id = k.id))
  union all
  select '~ RESUMO', 0, 2, 'dessas, quantas entraram nos ultimos 30 dias',
         (select count(*)::text from conta k where k.last_sign_in_at > now() - interval '30 days')
)
select conta, item, valor
  from (
    select * from guarda
    union all select * from identidade
    union all select * from contagens
    union all select * from pacientes
    union all select * from arquivos
  ) tudo
 where valor is not null
   and (secao <> 2 or valor <> '0')
 order by conta, secao, ordem;
