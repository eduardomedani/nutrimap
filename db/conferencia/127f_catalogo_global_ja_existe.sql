-- ===========================================================================
-- 127f · O CATALOGO GLOBAL JA E USADO?
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. UMA consulta so.
--
-- A policy de `exercicios` preve `nutri_id IS NULL` como catalogo global. A
-- pergunta e se alguem ja esta nele, ou se a midia global inaugura o padrao.
--
-- A resposta nao muda o DESENHO — a decisao ja foi tomada. Muda o RISCO da
-- migracao: inaugurar um padrao e diferente de entrar num que ja tem dado e
-- comportamento estabelecidos.
-- ===========================================================================
select count(*)                                       as exercicios,
       count(*) filter (where nutri_id is null)       as globais,
       count(*) filter (where nutri_id is not null)   as com_dono,
       count(distinct nutri_id)                       as donos_distintos
from public.exercicios;
