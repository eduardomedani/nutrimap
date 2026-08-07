-- ===========================================================================
-- Evollo · SEGURANCA — fechar a insercao publica na tabela exames
-- ---------------------------------------------------------------------------
-- A policy "Publico insere exames" em public.exames permite INSERT sem
-- amarrar a linha a ninguem. Como a anon-key vive no JavaScript do site,
-- qualquer um consegue gravar exame no prontuario de qualquer paciente.
--
-- POR QUE DA PARA REMOVER SEM QUEBRAR NADA. Nada no projeto escreve nessa
-- tabela — conferido em js/, *.html e api/:
--
--   js/paciente-modulos.js:32   exames: false — o modulo nao foi construido
--   anamnese.html:2597          o upload de exames chama simulateUpload():
--                               os arquivos NUNCA saem do navegador
--   js/respostas.js             o questionario grava em `respostas`
--
-- A policy de leitura ("Nutri ve exames dos seus pacientes") NAO e tocada: ela
-- ja e corretamente escopada por nutri_id e continua valendo para quando o
-- modulo existir.
--
-- QUANDO O MODULO DE EXAMES FOR CONSTRUIDO, a policy de insercao volta — mas
-- escopada, como a de leitura. Nao reabra esta.
--
-- Desfazer: db/exames_fechar_insercao_publica_desfazer.sql
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

select
  policyname,
  cmd,
  roles::text as papeis,
  qual        as using_condicao,
  with_check  as check_condicao,
  (select count(*) from public.exames) as linhas_na_tabela
from pg_policies
where schemaname = 'public' and tablename = 'exames'
order by cmd, policyname;

drop policy if exists "Publico insere exames" on public.exames;


-- ===========================================================================
-- Conferencia. Esperado: insercao_publica 0, leitura_do_nutri 1, rls true.
-- ===========================================================================
select
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'exames' and cmd = 'INSERT')   as insercao_publica,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'exames' and cmd = 'SELECT')   as leitura_do_nutri,
  (select c.relrowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'exames')                       as rls_ligado;
