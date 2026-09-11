-- ===========================================================================
-- 137 · ONDE PARAMOS NA TRILHA DAS MIDIAS
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. UMA consulta so — o painel do SQL Editor mostra
-- apenas o resultado da ultima instrucao, e um arquivo por pergunta e a
-- unica forma de nao confundir qual resposta e de quem.
--
-- POR QUE ELE EXISTE. Os scripts da trilha foram escritos em 08 e 09/09 e o
-- trabalho parou no meio. Nenhum arquivo do repositorio sabe o que foi
-- EXECUTADO — um .sql commitado prova que a intencao existiu, nunca que ela
-- chegou ao banco. Esta consulta pergunta ao proprio banco.
--
-- ELA NAO TOCA EM `public.midias`. De proposito: se o schema nunca rodou, a
-- tabela nao existe, e uma consulta que a referencie falharia com "relation
-- does not exist" — que e informacao, mas chega como erro vermelho e sem as
-- outras cinco respostas junto. `to_regclass` devolve NULL em vez de estourar.
-- `storage.buckets` e `storage.objects` existem sempre num projeto Supabase.
--
-- ---------------------------------------------------------------------------
-- COMO LER O RESULTADO — as tres etapas, na ordem em que foram desenhadas
-- ---------------------------------------------------------------------------
--   tabela_midias = false
--       Nada rodou. Comece por db/exercicio_midias.sql.
--
--   tabelas true, bucket = 0
--       O schema entrou, o Storage nao. Rode db/storage_exercicio_midias.sql.
--
--   bucket = 1, arquivos_no_bucket = 0
--       Banco pronto, acervo vazio. Falta arrastar a pasta de upload.
--       Enquanto isso o app mostra o exercicio e o video nao toca.
--
--   arquivos_no_bucket = 68, mb_no_bucket ~ 69.4
--       Upload feito. Siga para a 137a, que conta o lado do banco.
--
-- `policies_do_bucket` tem que ser 1 em qualquer cenario onde o bucket exista.
-- Bucket privado SEM policy de leitura e um acervo que ninguem enxerga: a URL
-- assinada e emitida com a sessao do aluno e passa pela RLS de
-- `storage.objects` como qualquer outra leitura.
--
-- `bucket_privado` tem que ser true. Se vier false, alguem tornou o bucket
-- publico pelo painel, e ai cada MP4 tem URL eterna e aberta — o contrario de
-- tudo que js/exercicio-midia.js faz.
-- ===========================================================================
select to_regclass('public.midias')           is not null   as tabela_midias,
       to_regclass('public.exercicio_midias') is not null   as tabela_vinculos,
       (select count(*) from storage.buckets b
         where b.id = 'exercicio-midias')                   as bucket,
       (select bool_and(b.public is not true) from storage.buckets b
         where b.id = 'exercicio-midias')                   as bucket_privado,
       (select count(*) from pg_policy p
          join pg_class c     on c.oid = p.polrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'storage' and c.relname = 'objects'
           and p.polname like 'exercicio_midias_%')         as policies_do_bucket,
       (select count(*) from storage.objects o
         where o.bucket_id = 'exercicio-midias')            as arquivos_no_bucket,
       (select round(coalesce(sum((o.metadata->>'size')::bigint), 0) / 1048576.0, 1)
          from storage.objects o
         where o.bucket_id = 'exercicio-midias')            as mb_no_bucket;
