-- ===========================================================================
-- Evollo · DESFAZER o bucket das animacoes
-- ---------------------------------------------------------------------------
-- ATENCAO — LEIA ANTES DE RODAR.
--
-- Este script NAO apaga arquivo. Ele remove a policy de leitura e o REGISTRO
-- do bucket — e o `delete from storage.buckets` FALHA se ainda houver objeto
-- dentro, o que e proposital: o banco recusa esquecer arquivos em vez de
-- deixa-los orfaos.
--
-- Para esvaziar de verdade, apague os objetos pelo painel Storage ou pela API
-- ANTES. Nao ponho o `delete from storage.objects` aqui: apagar 70 arquivos
-- por engano num script de rollback e o tipo de coisa que so se descobre
-- depois.
--
-- As linhas de `public.midias` NAO sao tocadas — elas apontariam para um
-- bucket inexistente, e a conferencia 130 acusa isso.
--
-- 100% re-executavel.
-- Para colar, use db/storage_exercicio_midias_desfazer_LIMPO.sql
-- ===========================================================================

drop policy if exists exercicio_midias_objeto_read on storage.objects;

-- Falha de proposito se houver arquivo dentro.
delete from storage.buckets where id = 'exercicio-midias';

-- Esperado: nenhuma linha.
select id, public from storage.buckets where id = 'exercicio-midias';
