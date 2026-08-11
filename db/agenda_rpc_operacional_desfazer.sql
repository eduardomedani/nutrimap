-- ===========================================================================
-- Evollo · DESFAZER — a superficie operacional da Agenda
-- ---------------------------------------------------------------------------
-- Desfaz db/agenda_rpc_operacional_proposta.sql.
--
-- E ROLLBACK COMPLETO e sem risco de perda: as quatro funcoes nao guardam
-- estado. Elas leem e escrevem public.consultas, que continua exatamente onde
-- estava — nenhuma consulta e apagada aqui.
--
-- O QUE MUDA AO RODAR ISTO: quem so tinha `agenda.*` perde o acesso a agenda.
-- Nao ha caminho alternativo, e e de proposito — a Recepcao nunca teve policy
-- em public.consultas. O profissional continua enxergando tudo pela policy
-- direta, sob `atendimento.visualizar`.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

drop function if exists public.agenda_listar(date, date, uuid);
drop function if exists public.agenda_agendar(uuid, timestamptz, integer, text, text);
drop function if exists public.agenda_remarcar(uuid, timestamptz, integer, text, text);
drop function if exists public.agenda_cancelar(uuid);


-- ===========================================================================
-- Conferencia. Esperado:
--   funcoes = 0
--   consultas = a MESMA contagem de antes (nenhuma foi tocada)
-- ===========================================================================
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'agenda!_%' escape '!')  as funcoes,
  (select count(*) from public.consultas)                                  as consultas;
