-- ═══════════════════════════════════════════════════════════════════════════
-- DESFAZ db/agenda_uma_aula_por_dia.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Volta agenda__reservar e agenda__fixo_confere às versões de
-- db/agenda_treino.sql (copiadas daqui por script, sem edição à mão) e remove
-- as três funções novas. Não toca em dado nenhum.

drop function if exists public.agenda_aluno_resumo();
drop function if exists public.agenda__aulas_feitas(uuid, uuid, date, timestamp);

create or replace function public.agenda__reservar(
  p_paciente uuid, p_grade uuid, p_data date, p_origem text, p_checar_prazos boolean)
returns jsonb language plpgsql security definer set search_path = public
as $fn$
declare
  v_org uuid; g public.agenda_grade; c public.agenda_config;
  v_inicio timestamp; v_agora timestamp := public.agenda__agora();
  v_limite int; v_uso int; v_sit text;
begin
  select nutri_id into v_org from public.pacientes where id = p_paciente;
  select * into g from public.agenda_grade where id = p_grade and nutri_id = v_org and ativo;
  if not found then raise exception 'Horário não encontrado.' using errcode = 'P0001'; end if;
  if extract(dow from p_data)::int <> g.dia_semana then
    raise exception 'Esse horário não acontece nesse dia.' using errcode = 'P0001';
  end if;
  select * into c from public.agenda_config where nutri_id = v_org;
  v_inicio := p_data + g.hora_inicio;
  if v_inicio <= v_agora then raise exception 'Esse horário já passou.' using errcode = 'P0001'; end if;
  if p_checar_prazos and p_data > v_agora::date + coalesce(c.abre_dias_antes, 2) then
    raise exception 'A reserva abre % dia(s) antes do treino.', coalesce(c.abre_dias_antes, 2) using errcode = 'P0001';
  end if;

  -- Trava: duas pessoas não levam a última vaga; o mesmo aluno não fura o limite em dois toques.
  perform pg_advisory_xact_lock(hashtextextended('agenda:' || p_grade::text || ':' || p_data::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('agenda-aluno:' || p_paciente::text || ':' || date_trunc('week', p_data)::date::text, 0));

  v_limite := public.agenda__limite(p_paciente, p_data);
  if v_limite = 0 then raise exception 'Sem plano ativo com agenda nessa data.' using errcode = 'P0001'; end if;

  v_sit := public.agenda__situacao(p_paciente, p_grade, p_data);
  if v_sit in ('fixo', 'reserva') then raise exception 'Você já está nesse horário.' using errcode = 'P0001'; end if;

  v_uso := public.agenda__uso_semana(p_paciente, p_data);
  if v_uso >= v_limite then
    raise exception 'Você já tem os % treino(s) da semana do seu plano. Desmarque um para trocar.', v_limite using errcode = 'P0001';
  end if;
  if public.agenda__ocupacao(p_grade, p_data) >= g.capacidade then
    raise exception 'Horário lotado.' using errcode = 'P0001';
  end if;

  if v_sit = 'desmarcado' then
    -- Era o fixo dele e tinha desmarcado: volta a valer (desfaz o desmarque).
    update public.agenda_movimentos set status = 'cancelado', cancelado_em = now()
     where paciente_id = p_paciente and grade_id = p_grade and data = p_data
       and tipo = 'desmarcado' and status = 'ativo';
  else
    insert into public.agenda_movimentos (nutri_id, paciente_id, grade_id, data, tipo, origem)
    values (v_org, p_paciente, p_grade, p_data, 'reserva', p_origem);
  end if;
  return jsonb_build_object('ok', true, 'situacao', case when v_sit = 'desmarcado' then 'fixo' else 'reserva' end);
end;
$fn$;
revoke all on function public.agenda__reservar(uuid, uuid, date, text, boolean) from public, anon, authenticated;

create or replace function public.agenda__fixo_confere()
returns trigger language plpgsql security definer set search_path = public
as $fn$
declare a public.comercial_assinaturas; v_freq int; v_cap int; v_hoje date := public.agenda__agora()::date;
begin
  select * into a from public.comercial_assinaturas where id = new.assinatura_id;
  if not found or a.paciente_id <> new.paciente_id then
    raise exception 'A assinatura não é desse aluno.' using errcode = 'P0001';
  end if;
  new.nutri_id := a.nutri_id;
  if not exists (select 1 from public.agenda_grade where id = new.grade_id and nutri_id = a.nutri_id) then
    raise exception 'Horário de outra academia.' using errcode = 'P0001';
  end if;
  select p.frequencia_semanal into v_freq from public.comercial_planos p where p.id = a.plano_id;
  if v_freq is null then
    raise exception 'O plano não tem frequência semanal: defina no Comercial antes de escolher horário fixo.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.agenda_fixos where assinatura_id = new.assinatura_id) >= v_freq then
    raise exception 'O plano permite % horário(s) fixo(s) por semana.', v_freq using errcode = 'P0001';
  end if;
  select capacidade into v_cap from public.agenda_grade where id = new.grade_id;
  if (select count(*) from public.agenda_fixos f
       where f.grade_id = new.grade_id
         and public.agenda__vigente(f.assinatura_id, greatest(v_hoje, a.inicio_periodo))) >= v_cap then
    raise exception 'Esse horário já tem % aluno(s) fixo(s) — lotado.', v_cap using errcode = 'P0001';
  end if;
  return new;
end;
$fn$;
revoke all on function public.agenda__fixo_confere() from public, anon, authenticated;

-- Por último: a versão antiga de agenda__reservar não usa mais esta.
drop function if exists public.agenda__aulas_no_dia(uuid, date);

-- Conferência: esperado 16 | false
select
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'agenda\_%' escape '\') as funcoes,  -- 16
  position('aulas_no_dia' in pg_get_functiondef('public.agenda__reservar(uuid, uuid, date, text, boolean)'::regprocedure)) > 0 as reservar_1_por_dia; -- false
