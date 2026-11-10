-- ═══════════════════════════════════════════════════════════════════════════
-- DESFAZ db/paciente_servicos.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ATENÇÃO: apaga as marcações de serviço já feitas nas fichas (a coluna sai).
-- O app volta a mostrar tudo para todos, como antes.

alter table public.pacientes drop constraint if exists pacientes_servicos_validos;
alter table public.pacientes drop column if exists servicos;

-- Conferência: esperado false
select exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'pacientes' and column_name = 'servicos') as coluna_existe;
