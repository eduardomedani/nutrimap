-- ===========================================================================
-- 130b · TODA MIDIA TEM ARQUIVO? TODO ARQUIVO TEM MIDIA?
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. UMA consulta so — o painel do SQL Editor mostra
-- apenas o resultado da ultima instrucao, e um arquivo por pergunta e a
-- unica forma de nao confundir qual resposta e de quem.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 2) TODA MIDIA TEM ARQUIVO? TODO ARQUIVO TEM MIDIA?
-- ---------------------------------------------------------------------------
-- As duas metades da mesma pergunta, e as duas doem de jeitos diferentes:
--
--   midia sem arquivo  -> o app mostra o exercicio e o video nao toca;
--   arquivo sem midia  -> ninguem consegue ver (a policy do bucket delega a
--                         `midias`), e o arquivo ocupa espaco sem servir.
--
-- ESPERADO: NENHUMA LINHA. Antes do upload, o lado "sem arquivo" vai listar as
-- 68 — o que e correto, e some quando os MP4 subirem.
--
-- O lado "arquivo sem midia" tem que dar ZERO SEMPRE, inclusive depois do
-- upload: ha 8 MP4 em disco FORA do seed, e nenhum deles pode subir.
-- ---------------------------------------------------------------------------
select 'midia sem arquivo' as problema, m.chave as ref, m.caminho
  from public.midias m
 where m.bucket = 'exercicio-midias'
   and not exists (select 1 from storage.objects o
                    where o.bucket_id = m.bucket and o.name = m.caminho)
union all
select 'arquivo sem midia', o.name, o.name
  from storage.objects o
 where o.bucket_id = 'exercicio-midias'
   and not exists (select 1 from public.midias m
                    where m.bucket = o.bucket_id and m.caminho = o.name)
order by 1, 2;
