-- ===========================================================================
-- Evollo · DESFAZER — proxima consulta e metas no Inicio do PWA
-- ---------------------------------------------------------------------------
-- Desfaz db/paciente_inicio_leitura.sql.
--
-- Nenhuma policy foi criada la, e nenhuma tabela foi tocada: derrubar as duas
-- funcoes devolve o banco exatamente ao estado anterior. O paciente volta a
-- nao ver consulta nem metas, e o app trata isso como "nao ha" — as duas
-- secoes somem da tela do Inicio sozinhas.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

drop function if exists public.rpc_paciente_proxima_consulta();
drop function if exists public.rpc_paciente_metas();


-- Conferencia: devolve 0.
select count(*) as funcoes_restantes
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('rpc_paciente_proxima_consulta', 'rpc_paciente_metas');
