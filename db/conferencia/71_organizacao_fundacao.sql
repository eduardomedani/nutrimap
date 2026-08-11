-- ===========================================================================
-- CONFERENCIA DA ETAPA 2 — Fundacao Multiusuario
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le catalogo e as tabelas da fundacao.
--
-- Roda DEPOIS de db/organizacao_schema.sql. Devolve um resultado so, com uma
-- linha por invariante e o veredito no fim.
--
-- O invariante que sustenta a estrategia inteira e o de numero 6:
--
--     organizacoes.id  =  proprietario  =  nutri_id gravado
--                      =  primeiro segmento dos caminhos no Storage
--
-- Se ele nao valer, a Etapa 4 nao pode trocar predicado de policy nenhuma.
--
-- Para colar no SQL Editor, use db/conferencia/71_organizacao_fundacao_LIMPO.sql
-- ===========================================================================

with dono as (
  select o.id, o.proprietario_user_id, o.nome, o.ativo
-- A organizacao da INSTALACAO, e nao "a primeira que aparecer". Desde que a
-- conta do Caio ganhou organizacao propria, ha DUAS linhas em organizacoes, e
-- `order by criado_em limit 1` deixou de dizer qual delas e — passou a depender
-- de quem nasceu antes. O vinculo com public.admins e o mesmo sinal que a Etapa
-- 2 usou para descobrir o proprietario da instalacao, e entrar em admins e um
-- ato explicito. O Caio nao esta la.
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id
),
checagens(ordem, item, resultado, detalhe) as (

  select 1, 'as seis tabelas da fundacao existem',
    case when count(*) = 6 then 'OK' else 'FALHOU' end,
    count(*)::text || ' de 6'
  from information_schema.tables
  where table_schema = 'public'
    and table_name in ('organizacoes','organizacao_usuarios','perfis',
                       'permissoes','perfil_permissoes','usuario_permissoes')

  union all
  select 2, 'existe exatamente uma organizacao',
    case when count(*) = 1 then 'OK' else 'FALHOU' end,
    count(*)::text || ' organizacao(oes)'
  from public.organizacoes

  union all
  select 3, 'organizacao.id = proprietario_user_id (estrategia de migracao)',
    case when exists (select 1 from dono where id = proprietario_user_id) then 'OK' else 'FALHOU' end,
    (select id::text from dono)

  union all
  select 4, 'o proprietario esta em organizacao_usuarios, ativo e com perfil Proprietario',
    case when exists (
      select 1 from public.organizacao_usuarios ou
        join dono d on d.id = ou.organizacao_id and d.proprietario_user_id = ou.auth_user_id
        join public.perfis p on p.id = ou.perfil_id
       where ou.status = 'ativo' and p.chave = 'proprietario'
    ) then 'OK' else 'FALHOU' end,
    (select ou.status || ' / ' || p.chave
       from public.organizacao_usuarios ou
       join public.perfis p on p.id = ou.perfil_id
       join dono d on d.proprietario_user_id = ou.auth_user_id)

  union all
  select 5, 'o proprietario tem TODAS as permissoes do catalogo',
    case when (select count(*) from public.permissoes) =
              (select count(*) from public.perfil_permissoes pp
                 join public.perfis p on p.id = pp.perfil_id
                where p.organizacao_id is null and p.chave = 'proprietario')
         then 'OK' else 'FALHOU' end,
    (select count(*)::text from public.perfil_permissoes pp
       join public.perfis p on p.id = pp.perfil_id
      where p.organizacao_id is null and p.chave = 'proprietario')
    || ' de ' || (select count(*)::text from public.permissoes)

  union all
  select 6, 'INVARIANTE: id da organizacao = nutri_id gravado = pasta do Storage',
    case
      when not exists (select 1 from dono) then 'FALHOU'
      when exists (
        select 1 from storage.objects so
         where (storage.foldername(so.name))[1] is not null
           and (storage.foldername(so.name))[1] <> (select id::text from dono)
      ) then 'ATENCAO'
      else 'OK'
    end,
    coalesce((
      select 'arquivos fora da pasta do proprietario: ' ||
             string_agg(distinct (storage.foldername(so.name))[1], ', ')
        from storage.objects so
       where (storage.foldername(so.name))[1] is not null
         and (storage.foldername(so.name))[1] <> (select id::text from dono)
    ), 'todos os ' || (select count(*)::text from storage.objects) || ' objetos na pasta do proprietario')

  union all
  select 7, 'os nutri_id gravados apontam para a organizacao',
    case when not exists (
      select 1 from public.pacientes where nutri_id <> (select id from dono)
    ) then 'OK' else 'ATENCAO' end,
    (select count(*)::text from public.pacientes where nutri_id <> (select id from dono))
      || ' paciente(s) com nutri_id de outra conta'

  union all
  select 8, 'as tres funcoes existem, definer e com search_path fixo',
    case when count(*) = 3 then 'OK' else 'FALHOU' end,
    string_agg(p.proname || case when p.prosecdef then ' definer' else ' INVOKER' end
               || case when exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
                       then '' else ' SEM-SEARCH-PATH' end, ', ' order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('organizacao_do_auth','tem_permissao','minhas_permissoes')

  union all
  select 9, 'ACL: anon e PUBLIC nao executam as funcoes da fundacao',
    case when bool_and(
      not has_function_privilege('anon', p.oid, 'EXECUTE')
    ) then 'OK' else 'FALHOU' end,
    string_agg(p.proname || ': ' ||
      case when has_function_privilege('anon', p.oid, 'EXECUTE') then 'ANON EXECUTA' else 'anon bloqueado' end
      || ' / ' ||
      case when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'authenticated ok' else 'AUTHENTICATED SEM EXECUTE' end,
      ' | ' order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('organizacao_do_auth','tem_permissao','minhas_permissoes')

  union all
  select 10, 'RLS ativa nas seis tabelas da fundacao',
    case when count(*) filter (where c.relrowsecurity) = 6 then 'OK' else 'FALHOU' end,
    count(*) filter (where c.relrowsecurity)::text || ' de 6 com RLS'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('organizacoes','organizacao_usuarios','perfis',
                      'permissoes','perfil_permissoes','usuario_permissoes')

  union all
  select 11, 'NENHUMA tabela da fundacao usa FORCE RLS (senao a funcao cai na propria policy)',
    case when count(*) filter (where c.relforcerowsecurity) = 0 then 'OK' else 'FALHOU' end,
    count(*) filter (where c.relforcerowsecurity)::text || ' com force'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('organizacoes','organizacao_usuarios','perfis',
                      'permissoes','perfil_permissoes','usuario_permissoes')

  union all
  select 12, 'perfil_permissoes e usuario_permissoes sem policy (so DEFINER entra)',
    case when count(*) = 0 then 'OK' else 'FALHOU' end,
    count(*)::text || ' policy(s)'
  from pg_policies
  where schemaname = 'public'
    and tablename in ('perfil_permissoes','usuario_permissoes')

  union all
  select 13, 'nenhuma policy de ESCRITA nas tabelas da fundacao',
    case when count(*) = 0 then 'OK' else 'FALHOU' end,
    coalesce(string_agg(tablename || '.' || policyname || ' (' || cmd || ')', ', '), 'nenhuma')
  from pg_policies
  where schemaname = 'public'
    and tablename in ('organizacoes','organizacao_usuarios','perfis',
                      'permissoes','perfil_permissoes','usuario_permissoes')
    and cmd <> 'SELECT'

  union all
  select 14, 'os seis perfis padrao existem e estao protegidos',
    case when count(*) = 6 then 'OK' else 'FALHOU' end,
    string_agg(chave, ', ' order by chave)
  from public.perfis
  where organizacao_id is null and protegido

  union all
  select 15, 'o legado nao foi tocado: nutricionistas continua com as 8 colunas',
    case when count(*) = 8 then 'OK' else 'ATENCAO' end,
    count(*)::text || ' colunas'
  from information_schema.columns
  where table_schema = 'public' and table_name = 'nutricionistas'
),
resumo as (
  select 99 as ordem,
    'VEREDITO' as item,
    case when exists (select 1 from checagens where resultado = 'FALHOU') then
      (select count(*)::text from checagens where resultado = 'FALHOU') || ' FALHA(S)'
    when exists (select 1 from checagens where resultado = 'ATENCAO') then
      (select count(*)::text from checagens where resultado = 'ATENCAO') || ' ATENCAO'
    else 'FUNDACAO OK' end as resultado,
    'a prova de organizacao_do_auth() = auth.uid() exige sessao logada — ver o script 72' as detalhe
)
select ordem, item, resultado, detalhe from checagens
union all
select ordem, item, resultado, detalhe from resumo
order by ordem;
