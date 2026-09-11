-- ===========================================================================
-- 127a · AS TABELAS DO MODELO JA EXISTEM?
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- Uma consulta so, de proposito: no SQL Editor, rodar varias de uma vez mostra
-- apenas o resultado da ULTIMA, e as outras somem sem aviso. Um arquivo por
-- pergunta e mais chato de organizar e impossivel de ler errado.
--
-- VAZIO E RESPOSTA: significa terreno limpo, nenhuma tabela de midia
-- preexistente para acomodar. Se vier linha, o desenho novo tem que conviver
-- com o que ja esta la — criar por cima destruiria dado alheio.
-- ===========================================================================
select c.relname                              as tabela,
       c.relrowsecurity                       as rls_ligada,
       (select count(*) from pg_attribute a
         where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)
                                              as colunas
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('midias', 'exercicio_midias', 'exercicio_midia', 'exercicios_midias')
order by c.relname;
