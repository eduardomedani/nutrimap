-- ===========================================================================
-- 138a · AS CHAVES QUE O EMBED DO APP ATRAVESSA
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. UMA consulta so.
--
-- ---------------------------------------------------------------------------
-- A CONSULTA QUE ESTA EM PRODUCAO NO APP DO ALUNO
-- ---------------------------------------------------------------------------
-- js/paciente-data.js, `itensDoTreino`:
--
--   treino_exercicios
--     -> exercicio:exercicios(...)
--          -> midias:exercicio_midias(papel, ordem)
--               -> midia:midias(id, bucket, caminho, genero)
--
-- O PostgREST nao segue nome de coluna: ele segue CHAVE ESTRANGEIRA. Para
-- resolver cada degrau, precisa achar UMA — e exatamente uma. Duas FKs entre o
-- mesmo par de tabelas deixam o embed ambiguo, e a resposta vira erro PGRST201
-- pedindo que se desfaca a ambiguidade pelo nome da constraint.
--
-- E o erro derruba A CONSULTA INTEIRA, nao o degrau: o aluno nao perde a
-- animacao, perde a tela de treino. Por isso isto se confere no banco, e nao
-- descobrindo pelo celular de alguem.
--
-- ---------------------------------------------------------------------------
-- ESPERADO — exatamente estas duas linhas, uma vez cada
-- ---------------------------------------------------------------------------
--   exercicio_midias -> exercicios   exercicio_id   quantas_assim = 1
--   exercicio_midias -> midias       midia_id       quantas_assim = 1
--
-- `quantas_assim` = 2 em qualquer linha e o defeito que este arquivo procura.
--
-- As FKs para `auth.users` (nutri_id, nas duas tabelas) ficam de fora de
-- proposito: `auth` nao e schema exposto pelo PostgREST, entao elas nao
-- disputam nenhum degrau do embed.
-- ===========================================================================
select src.relname                         as origem,
       tgt.relname                         as destino,
       (select string_agg(a.attname, ', ' order by k.ord)
          from unnest(c.conkey) with ordinality k(attnum, ord)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
                                           as coluna,
       c.conname                           as constraint_name,
       count(*) over (partition by c.conrelid, c.confrelid) as quantas_assim
from pg_constraint c
join pg_class src     on src.oid = c.conrelid
join pg_class tgt     on tgt.oid = c.confrelid
join pg_namespace nsrc on nsrc.oid = src.relnamespace
join pg_namespace ntgt on ntgt.oid = tgt.relnamespace
where c.contype = 'f'
  and nsrc.nspname = 'public'
  and ntgt.nspname = 'public'
  and src.relname = 'exercicio_midias'
order by tgt.relname;
