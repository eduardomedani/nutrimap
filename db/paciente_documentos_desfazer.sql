-- ===========================================================================
-- Evollo · DESFAZER — documentos do paciente (Etapa 1)
-- ---------------------------------------------------------------------------
-- Desfaz db/paciente_documentos.sql.
--
-- PENSE ANTES DE RODAR ISTO. Este script derruba as policies ANTES de derrubar
-- a tabela, e entre um passo e outro o bucket continua de pe. Se alguem tiver
-- URL assinada valida nesse intervalo, ela continua abrindo — assinatura do
-- Storage nao consulta RLS depois de emitida. Rode de uma vez so.
--
-- O QUE ELE NAO FAZ, DE PROPOSITO:
--
--   . nao apaga os OBJETOS do bucket. Documento clinico apagado nao volta, e
--     um `delete from storage.objects` aqui destruiria exame de paciente por
--     causa de um rollback de schema. Os arquivos ficam; para remove-los, o
--     bloco comentado no fim tem o comando, para ser rodado conscientemente.
--
--   . nao apaga o bucket. Bucket com objeto dentro nao cai, e forcar seria a
--     mesma destruicao por outro caminho.
--
--   . nao apaga public.paciente_documento_auditoria por padrao. Ela e o
--     registro de quem viu o que — sobrevive ao schema que a alimentava. O
--     drop esta no fim, comentado.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) Storage: tira as policies do bucket
-- ---------------------------------------------------------------------------
drop policy if exists pd_storage_nutri    on storage.objects;
drop policy if exists pd_storage_paciente on storage.objects;


-- ---------------------------------------------------------------------------
-- 2) Gatilhos
-- ---------------------------------------------------------------------------
drop trigger if exists trg_auditoria_documento_paciente on public.paciente_documentos;
drop trigger if exists trg_tocar_paciente_documento     on public.paciente_documentos;


-- ---------------------------------------------------------------------------
-- 3) Policies da tabela
-- ---------------------------------------------------------------------------
drop policy if exists pd_nutri_select    on public.paciente_documentos;
drop policy if exists pd_nutri_insert    on public.paciente_documentos;
drop policy if exists pd_nutri_update    on public.paciente_documentos;
drop policy if exists pd_nutri_delete    on public.paciente_documentos;
drop policy if exists pd_paciente_select on public.paciente_documentos;


-- ---------------------------------------------------------------------------
-- 4) Funcoes
-- ---------------------------------------------------------------------------
drop function if exists public.documento_do_paciente_e_meu(text);
drop function if exists public.marcar_documento_paciente_visualizado(uuid);
drop function if exists public.registrar_auditoria_documento_paciente();
drop function if exists public.tocar_paciente_documento();


-- ---------------------------------------------------------------------------
-- 5) A tabela
-- ---------------------------------------------------------------------------
-- Sem `cascade`: se alguma coisa criada depois passou a depender dela, e
-- melhor este script falhar do que levar junto o que nao e dele.
drop table if exists public.paciente_documentos;


-- ===========================================================================
-- Conferencia: tudo em 0.
-- ===========================================================================
select
  (select count(*) from pg_tables
    where schemaname = 'public' and tablename = 'paciente_documentos')      as tabela,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'paciente_documentos')      as policies,
  (select count(*) from pg_policies
    where schemaname = 'storage' and policyname like 'pd\_storage\_%')      as policies_storage,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('documento_do_paciente_e_meu',
                        'marcar_documento_paciente_visualizado',
                        'registrar_auditoria_documento_paciente',
                        'tocar_paciente_documento'))                        as funcoes;


-- ===========================================================================
-- OS DOIS COMANDOS DESTRUTIVOS, SEPARADOS DE PROPOSITO
-- ---------------------------------------------------------------------------
-- Rode so se souber exatamente o que esta apagando. Nao ha volta em nenhum
-- dos dois: o primeiro destroi exames e laudos de pacientes reais; o segundo,
-- o registro de quem os viu e quando.
-- ===========================================================================

-- delete from storage.objects where bucket_id = 'paciente-documentos';
-- delete from storage.buckets where id = 'paciente-documentos';

-- drop table if exists public.paciente_documento_auditoria;
