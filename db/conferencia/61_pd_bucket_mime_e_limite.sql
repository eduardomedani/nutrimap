-- Documentos do paciente · o bucket e privado, com teto e MIME declarados.
--
-- Esperado:
--   public             = false      <- se vier true, PARE: documento clinico aberto
--   file_size_limit    = 15728640   (15 MB)
--   allowed_mime_types = application/pdf, image/jpeg, image/png
--
-- O limite e o MIME no BUCKET nao sao redundancia da validacao do JavaScript:
-- sao a parte que continua valendo quando alguem chama a API direto.
select id, name, public, file_size_limit,
       array_to_string(allowed_mime_types, ', ') as mimes
  from storage.buckets
 where id = 'paciente-documentos';

-- As duas policies do bucket. A do paciente TEM que ser somente SELECT e TEM
-- que chamar documento_do_paciente_e_meu — conferir so a pasta deixaria abrir
-- arquivo de upload interrompido, que mora na arvore certa sem registro valido.
select policyname, cmd, qual as usando, with_check as checando
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname like 'pd\_storage\_%'
 order by policyname;

-- Objetos no bucket x registros na tabela. Os dois numeros tem que bater;
-- diferenca e arquivo orfao ou registro apontando para o vazio.
select
  (select count(*) from storage.objects
    where bucket_id = 'paciente-documentos')          as arquivos_no_bucket,
  (select count(*) from public.paciente_documentos)   as registros_na_tabela;
