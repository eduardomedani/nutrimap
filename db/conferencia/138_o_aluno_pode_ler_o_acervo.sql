-- ===========================================================================
-- 138 · O ALUNO PODE LER O ACERVO?
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. UMA consulta so.
--
-- ---------------------------------------------------------------------------
-- POR QUE ESTE ARQUIVO EXISTE
-- ---------------------------------------------------------------------------
-- A 137a provou que as 68 midias estao no banco e a 130b que os 68 arquivos
-- estao no bucket. Nenhuma das duas prova que o ALUNO consegue ler as linhas.
--
-- Sao duas camadas diferentes, e elas falham em ordens diferentes:
--
--   GRANT  -> permissao de tabela. Sem ele a RLS nem chega a ser avaliada;
--             o acesso morre antes, com "permission denied for table".
--   RLS    -> quais LINHAS daquela tabela o usuario ve.
--
-- Medido hoje, com a chave anonima, contra o PostgREST de producao:
--
--   GET /rest/v1/treino_exercicios?select=...exercicio_midias...
--   -> 401  "permission denied for table exercicio_midias"  (code 42501)
--
-- Isso e o COMPORTAMENTO DESENHADO, nao um defeito: db/exercicio_midias.sql
-- revoga `anon` de proposito. Mas prova, pela negativa, que o GRANT e o portao
-- que decide — e que ninguem ate agora verificou o lado `authenticated`, que e
-- o role com que o app do aluno fala.
--
-- Se `authenticated` nao tiver select nas duas tabelas, o embed aninhado de
-- `itensDoTreino` falha inteiro — e o que quebra nao e o video: e A TELA DE
-- TREINO, porque o PostgREST recusa a consulta toda, nao a parte dela.
--
-- ---------------------------------------------------------------------------
-- ESPERADO
-- ---------------------------------------------------------------------------
--   auth_le_midias        true    auth_le_vinculos        true
--   anon_le_midias        false   anon_le_vinculos        false
--   rls_midias            true    rls_vinculos            true
--   policies_select_midias  >= 1  policies_select_vinculos  >= 1
--
-- `anon` false nas duas e tao importante quanto `authenticated` true: o acervo
-- nao e publico, e a chave anonima esta no codigo-fonte de um site estatico.
--
-- RLS ligada com GRANT dado e a combinacao certa. GRANT sem RLS seria o aluno
-- lendo o acervo inteiro de todo mundo; RLS sem GRANT e a tela que nao abre.
-- ===========================================================================
select has_table_privilege('authenticated', 'public.midias',           'select') as auth_le_midias,
       has_table_privilege('authenticated', 'public.exercicio_midias', 'select') as auth_le_vinculos,
       has_table_privilege('anon',          'public.midias',           'select') as anon_le_midias,
       has_table_privilege('anon',          'public.exercicio_midias', 'select') as anon_le_vinculos,
       (select c.relrowsecurity from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'midias')            as rls_midias,
       (select c.relrowsecurity from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'exercicio_midias')  as rls_vinculos,
       (select count(*) from pg_policy p
          join pg_class c     on c.oid = p.polrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'midias'
           and p.polcmd in ('r', '*'))                                   as policies_select_midias,
       (select count(*) from pg_policy p
          join pg_class c     on c.oid = p.polrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'exercicio_midias'
           and p.polcmd in ('r', '*'))                                   as policies_select_vinculos;
