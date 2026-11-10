-- ===========================================================================
-- Evollo · DESFAZ db/agenda_treino.sql
-- ---------------------------------------------------------------------------
-- Remove as 4 tabelas da agenda de treino, o gatilho e as funções.
-- APAGA a grade, os horários fixos e as reservas/desmarques gravados.
-- NÃO toca no comercial, no financeiro, nos pacientes nem nos treinos.
-- As permissões agenda.* do proprietário ficam (já existiam para a agenda de
-- atendimentos).
-- ===========================================================================

drop trigger if exists trg_agenda_fixo_confere on public.agenda_fixos;

drop function if exists public.agenda_aluno_semana(date);
drop function if exists public.agenda_aluno_reservar(uuid, date);
drop function if exists public.agenda_aluno_desmarcar(uuid, date);
drop function if exists public.agenda_painel_semana(date);
drop function if exists public.agenda_recepcao_reservar(uuid, uuid, date);
drop function if exists public.agenda_recepcao_desmarcar(uuid, uuid, date);
drop function if exists public.agenda__fixo_confere();
drop function if exists public.agenda__semana(uuid, date, uuid);
drop function if exists public.agenda__reservar(uuid, uuid, date, text, boolean);
drop function if exists public.agenda__desmarcar(uuid, uuid, date, text, boolean);
drop function if exists public.agenda__uso_semana(uuid, date);
drop function if exists public.agenda__situacao(uuid, uuid, date);
drop function if exists public.agenda__ocupacao(uuid, date);
drop function if exists public.agenda__limite(uuid, date);
drop function if exists public.agenda__vigente(uuid, date);
drop function if exists public.agenda__agora();

drop table if exists public.agenda_movimentos;
drop table if exists public.agenda_fixos;
drop table if exists public.agenda_grade;
drop table if exists public.agenda_config;

-- Esperado: 0 | 0
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename like 'agenda\_%' escape '\'
     and tablename in ('agenda_config','agenda_grade','agenda_fixos','agenda_movimentos')) as tabelas,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('agenda_aluno_semana','agenda_aluno_reservar','agenda_aluno_desmarcar','agenda_painel_semana',
                     'agenda_recepcao_reservar','agenda_recepcao_desmarcar'))                as funcoes;
