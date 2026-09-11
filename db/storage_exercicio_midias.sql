-- ===========================================================================
-- Evollo · O BUCKET PRIVADO DAS ANIMACOES
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE (bucket + policies de storage.objects). NAO sobe
-- arquivo nenhum.
--
-- Desfazer: db/storage_exercicio_midias_desfazer.sql
-- Gate: db/conferencia/129_storage_gate.sql
--
-- 100% re-executavel.
--
-- ===========================================================================
-- PRIVADO, POR DECISAO
-- ---------------------------------------------------------------------------
-- Decisao do Eduardo: sem URL publica permanente. A reproducao passa por
-- signed URL temporaria, emitida so depois de autorizacao.
--
-- Isso e viavel porque NAO existe fluxo anonimo no app: o aluno entra por
-- `signInWithPassword` (js/paciente-data.js:13) e a leitura passa por
-- `paciente_do_auth()`. Nao ha visualizacao publica nem link compartilhavel de
-- treino. Verificado no codigo, nao suposto.
--
-- ===========================================================================
-- A POLICY NAO REPETE A REGRA — ELA PERGUNTA A TABELA
-- ---------------------------------------------------------------------------
-- A tentacao aqui e escrever de novo, em `storage.objects`, a mesma logica de
-- quem pode ver o que. Seriam DUAS copias da mesma regra, e o dia em que
-- divergissem seria o dia em que um aluno veria um arquivo que a tabela dizia
-- que ele nao podia ver.
--
-- Em vez disso a policy pergunta a `public.midias`:
--
--     existe uma linha de midia com este bucket e este caminho?
--
-- A subconsulta roda sob a RLS de quem chamou. Entao o objeto e visivel
-- EXATAMENTE quando a linha de midia e visivel — nao "de forma equivalente",
-- e sim pela mesma avaliacao, uma vez so. As 12 provas do gate 128 passam a
-- valer tambem para o Storage.
--
-- ===========================================================================
-- NENHUMA POLICY DE ESCRITA, E ISSO E DE PROPOSITO
-- ---------------------------------------------------------------------------
-- O acervo global sobe por `service_role`, que ignora RLS. Sem policy de
-- INSERT/UPDATE/DELETE, nenhum usuario do app escreve neste bucket — nem
-- sobrescreve uma animacao por outra.
--
-- Quando existir "video proprio do profissional" (midias.nutri_id preenchido),
-- ai sim entra uma policy de INSERT com dono. E outro trabalho, com outro
-- gate. Deixar a porta fechada agora custa nada; deixa-la aberta custaria
-- descobrir depois quem escreveu o que.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/storage_exercicio_midias_LIMPO.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) O BUCKET
-- ---------------------------------------------------------------------------
-- `public = false`. O limite de 10 MB e folgado: o maior MP4 da primeira leva
-- tem 1,9 MB e os 70 somam 71,5 MB. `allowed_mime_types` restringe a video/mp4
-- — se um dia alguem tentar guardar um PDF aqui, falha na hora em vez de
-- virar um arquivo que ninguem consegue tocar.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercicio-midias', 'exercicio-midias', false, 10485760, array['video/mp4'])
on conflict (id) do update set
  public             = false,
  file_size_limit    = 10485760,
  allowed_mime_types = array['video/mp4'];


-- ---------------------------------------------------------------------------
-- 2) LEITURA — espelha a RLS de public.midias, sem reescreve-la
-- ---------------------------------------------------------------------------
-- `createSignedUrl` do Supabase exige SELECT no objeto. E esta a policy que
-- decide quem consegue pedir uma URL assinada.
-- ---------------------------------------------------------------------------
drop policy if exists exercicio_midias_objeto_read on storage.objects;
create policy exercicio_midias_objeto_read on storage.objects
  for select
  using (
    bucket_id = 'exercicio-midias'
    and exists (
          select 1
            from public.midias m
           where m.bucket  = 'exercicio-midias'
             and m.caminho = storage.objects.name)
  );


-- ---------------------------------------------------------------------------
-- 3) CONFERENCIA
-- ---------------------------------------------------------------------------
-- Esperado: uma linha, `public = false`, limite 10485760, mime ['video/mp4'],
-- e exatamente UMA policy no bucket — a de leitura. Zero policies de escrita.
-- ---------------------------------------------------------------------------
select b.id, b.public, b.file_size_limit, b.allowed_mime_types,
       (select count(*) from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'storage' and c.relname = 'objects'
          and p.polname like 'exercicio_midias_%')     as policies_do_bucket,
       (select count(*) from storage.objects o
         where o.bucket_id = 'exercicio-midias')       as arquivos_no_bucket
from storage.buckets b
where b.id = 'exercicio-midias';
