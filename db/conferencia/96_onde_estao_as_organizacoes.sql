-- ===========================================================================
-- A TABELA organizacoes EXISTE? E organizacao_do_auth() RODA?
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- POR QUE ESTE SCRIPT EXISTE. Em 13/08/2026 a conferencia 94 falhou com
-- "relation public.organizacoes does not exist" — no MESMO `select` que a
-- conferencia 93 tinha acabado de rodar com sucesso. Uma das duas coisas e
-- verdade, e elas levam a lugares muito diferentes:
--
--   a) a tabela existe e algo no ambiente da execucao mudou (conexao, banco,
--      role) -> problema de sessao, o SQL esta certo
--
--   b) a tabela nao existe -> as RPCs da Migration A estao QUEBRADAS em
--      execucao, porque as duas chamam organizacao_do_auth(), que le
--      organizacoes e organizacao_usuarios. A 93 nunca provou isso: ela leu o
--      TEXTO das policies, nunca executou a funcao.
--
-- A LICAO, se for (b): conferir estrutura nao e conferir funcionamento. Uma
-- policy pode citar uma funcao que aponta para uma tabela ausente, e todo
-- teste de texto passa.
--
-- Para colar no SQL Editor, use db/conferencia/96_onde_estao_as_organizacoes_LIMPO.sql
-- ===========================================================================

select
  current_database()                                        as banco,
  current_user                                              as usuario,
  current_schema()                                          as schema_atual,
  current_setting('search_path')                            as search_path,
  to_regclass('public.organizacoes')::text                  as organizacoes,
  to_regclass('public.organizacao_usuarios')::text          as organizacao_usuarios,
  to_regclass('public.admins')::text                        as admins,
  to_regclass('public.comercial_assinaturas')::text         as comercial_assinaturas,
  to_regproc('public.organizacao_do_auth')::text            as fn_organizacao_do_auth,
  to_regproc('public.tem_permissao')::text                  as fn_tem_permissao;


-- Onde quer que ela esteja, esta consulta acha — inclusive noutro schema.
select n.nspname as schema, c.relname as tabela, c.relkind as tipo
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relname in ('organizacoes', 'organizacao_usuarios', 'perfis',
                     'perfil_permissoes', 'usuario_permissoes', 'admins')
 order by 1, 2;


-- E as funcoes: existem, e de que schema elas leem?
select n.nspname as schema, p.proname as funcao,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where p.proname in ('organizacao_do_auth', 'tem_permissao',
                     'comercial_criar_cobranca_do_periodo', 'comercial_cancelar_cobranca')
 order by 1, 2;


-- O TESTE QUE FALTAVA: executar de verdade, em vez de ler o texto.
-- Rodando no SQL Editor sem sessao de usuario, auth.uid() e nulo e as duas
-- devolvem nulo/false SEM ERRO. O que importa aqui e justamente isso: se elas
-- ESTOURAM, as RPCs da Migration A estouram junto.
select
  (select public.organizacao_do_auth())                     as organizacao_do_auth_roda,
  (select public.tem_permissao('comercial.editar'))         as tem_permissao_roda;
