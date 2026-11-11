-- ===========================================================================
-- Evollo · DESFAZER o canal comercial (db/canal_comercial.sql)
-- ---------------------------------------------------------------------------
-- Remove a RPC e a coluna. O app volta a mostrar a orientação no lugar do
-- botão do WhatsApp, sem erro. Re-executável.
-- ===========================================================================

drop function if exists public.rpc_paciente_canal_comercial();
alter table public.organizacoes drop constraint if exists organizacoes_whatsapp_comercial_valido;
alter table public.organizacoes drop column if exists whatsapp_comercial;
