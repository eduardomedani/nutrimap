-- ===========================================================================
-- 127c · A POLITICA QUE GOVERNA exercicios
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- `exercicios` tem `nutri_id`: o catalogo e por organizacao. A tabela de midia
-- precisa da MESMA politica — senao ela vira a porta pela qual o dado de um
-- cliente aparece no outro.
--
-- Eu nao invento politica: copio esta. Por isso preciso ve-la literal.
-- ===========================================================================
select p.polname                               as politica,
       p.polcmd                                as comando,
       pg_get_expr(p.polqual, p.polrelid)      as usando,
       pg_get_expr(p.polwithcheck, p.polrelid) as com_check
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'exercicios'
order by p.polcmd, p.polname;
