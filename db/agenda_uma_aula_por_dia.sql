-- ═══════════════════════════════════════════════════════════════════════════
-- AGENDA DE TREINO — 1 aula por dia + resumo do plano no Início do app
-- ═══════════════════════════════════════════════════════════════════════════
-- Pedido do Eduardo (10/11/2026), depois de conseguir marcar 2 treinos no
-- mesmo dia pelo app:
--   * Todo plano: no máximo UMA aula por dia. Quem tem plano de 3 dias usa as
--     3 em quaisquer dias da semana, mas uma por dia; o de 5 dias, uma por dia.
--     Para trocar o horário do dia, desmarca a aula e marca outra.
--   * O Início do aluno mostra a vigência do plano, as aulas feitas e as
--     disponíveis. Aula marcada e NÃO desmarcada conta como feita.
--
-- O que muda:
--   1) agenda__aulas_no_dia (interna, nova): quantas aulas o aluno tem na data.
--   2) agenda__reservar (substituída): recusa se já houver aula no dia. Vale
--      para o app e para a recepção. Nada mais muda nela.
--   3) agenda__fixo_confere (substituída): recusa 2 fixos no mesmo dia da
--      semana para a mesma assinatura. Nada mais muda nele.
--   4) agenda__aulas_feitas (interna, nova) e agenda_aluno_resumo (nova, do
--      aluno): vigência, feitas e disponíveis.
--
-- Não altera tabela, não apaga nem move dado. Aulas duplicadas que já existam
-- no mesmo dia continuam lá (a consulta da seção 6 lista); a regra vale para
-- as reservas daqui em diante.
-- Reverter: db/agenda_uma_aula_por_dia_desfazer.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- 1) Quantas aulas o aluno tem nessa data (fixo vigente não desmarcado + reservas)
-- ---------------------------------------------------------------------------
create or replace function public.agenda__aulas_no_dia(p_paciente uuid, p_data date)
returns int language sql stable security definer set search_path = public
as $fn$
  select (
    (select count(*) from public.agenda_fixos f
       join public.agenda_grade g on g.id = f.grade_id and g.ativo
      where f.paciente_id = p_paciente
        and g.dia_semana = extract(dow from p_data)::int
        and public.agenda__vigente(f.assinatura_id, p_data)
        and not exists (select 1 from public.agenda_movimentos m
                         where m.paciente_id = f.paciente_id and m.grade_id = f.grade_id and m.data = p_data
                           and m.tipo = 'desmarcado' and m.status = 'ativo'))
    + (select count(*) from public.agenda_movimentos m
        where m.paciente_id = p_paciente and m.data = p_data and m.tipo = 'reserva' and m.status = 'ativo')
  )::int;
$fn$;
revoke all on function public.agenda__aulas_no_dia(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) RESERVAR — igual à versão de db/agenda_treino.sql + a trava de 1 por dia
-- ---------------------------------------------------------------------------
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

  -- 1 aula por dia (10/11/2026). A trava semanal acima já serializa o aluno
  -- nesta semana, então dois toques rápidos não passam juntos.
  if public.agenda__aulas_no_dia(p_paciente, p_data) >= 1 then
    raise exception 'Você já tem uma aula neste dia. É uma aula por dia: desmarque a aula do dia para escolher outro horário.' using errcode = 'P0001';
  end if;

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

-- ---------------------------------------------------------------------------
-- 3) GATILHO DO FIXO — igual + não deixa 2 fixos no mesmo dia da semana
-- ---------------------------------------------------------------------------
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
  -- 1 aula por dia (10/11/2026): um fixo por dia da semana.
  if exists (select 1 from public.agenda_fixos f
               join public.agenda_grade gf on gf.id = f.grade_id
               join public.agenda_grade gn on gn.id = new.grade_id
              where f.assinatura_id = new.assinatura_id and gf.dia_semana = gn.dia_semana) then
    raise exception 'O aluno já tem horário fixo nesse dia da semana — é uma aula por dia.' using errcode = 'P0001';
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

-- ---------------------------------------------------------------------------
-- 4) AULAS FEITAS — marcadas e não desmarcadas, com início até `p_agora`
-- ---------------------------------------------------------------------------
-- Conta de `p_de` até o fim da assinatura (e nunca depois de agora). O fixo só
-- conta a partir do dia em que foi escolhido: escolher o horário hoje não
-- inventa aulas feitas no começo do mês.
create or replace function public.agenda__aulas_feitas(p_paciente uuid, p_assinatura uuid, p_de date, p_agora timestamp)
returns int language sql stable security definer set search_path = public
as $fn$
  with a as (select * from public.comercial_assinaturas where id = p_assinatura),
  dias as (
    select d::date as data
      from a, generate_series(greatest(p_de, a.inicio_periodo), least(p_agora::date, a.fim_periodo), interval '1 day') d
  ),
  fixos as (
    select 1 from dias
      join public.agenda_fixos f on f.assinatura_id = p_assinatura and f.criado_em::date <= dias.data
      join public.agenda_grade g on g.id = f.grade_id and g.dia_semana = extract(dow from dias.data)::int
     where dias.data + g.hora_inicio <= p_agora
       and not exists (select 1 from public.agenda_movimentos m
                        where m.paciente_id = p_paciente and m.grade_id = g.id and m.data = dias.data
                          and m.tipo = 'desmarcado' and m.status = 'ativo')
  ),
  reservas as (
    select 1 from a
      join public.agenda_movimentos m on m.paciente_id = p_paciente and m.tipo = 'reserva' and m.status = 'ativo'
       and m.data between greatest(p_de, a.inicio_periodo) and a.fim_periodo
      join public.agenda_grade g on g.id = m.grade_id
     where m.data + g.hora_inicio <= p_agora
  )
  select ((select count(*) from fixos) + (select count(*) from reservas))::int;
$fn$;
revoke all on function public.agenda__aulas_feitas(uuid, uuid, date, timestamp) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) RESUMO DO PLANO para o Início do app (só o próprio aluno)
-- ---------------------------------------------------------------------------
-- disponiveis = aulas que ainda cabem daqui até o fim do plano: em cada semana
-- (seg–dom), o menor entre (frequência − feitas na semana) e os dias que ainda
-- têm horário na grade — um por dia, sem contar o dia em que ele já treinou.
create or replace function public.agenda_aluno_resumo()
returns jsonb language plpgsql stable security definer set search_path = public
as $fn$
declare
  v_pac uuid := public.paciente_do_auth(); v_org uuid; c public.agenda_config;
  a public.comercial_assinaturas; p public.comercial_planos;
  v_agora timestamp := public.agenda__agora(); v_hoje date := public.agenda__agora()::date;
  v_sem date; v_fim date; v_dias int; v_feitas_sem int; v_disp int := 0;
begin
  if v_pac is null then raise exception 'Faça login no app.' using errcode = 'P0001'; end if;
  select nutri_id into v_org from public.pacientes where id = v_pac;
  select * into c from public.agenda_config where nutri_id = v_org;
  if not found or not c.ativo then return jsonb_build_object('ativo', false); end if;

  select s.* into a from public.comercial_assinaturas s
    join public.comercial_planos pl on pl.id = s.plano_id
   where s.paciente_id = v_pac and s.status = 'ativa' and pl.frequencia_semanal is not null
     and v_hoje between s.inicio_periodo and s.fim_periodo + coalesce(pl.tolerancia_dias, 0)
   order by s.fim_periodo desc limit 1;
  if not found then return jsonb_build_object('ativo', true, 'plano', null); end if;
  select * into p from public.comercial_planos where id = a.plano_id;

  v_fim := a.fim_periodo + coalesce(p.tolerancia_dias, 0);
  v_sem := date_trunc('week', v_hoje)::date;
  while v_sem <= v_fim loop
    -- dias desta semana, de hoje em diante e dentro do plano, com algum
    -- horário ainda por começar e sem aula já feita naquele dia
    select count(*) into v_dias
      from generate_series(greatest(v_sem, v_hoje), least(v_sem + 6, v_fim), interval '1 day') d
     where exists (select 1 from public.agenda_grade g
                    where g.nutri_id = v_org and g.ativo and g.dia_semana = extract(dow from d)::int
                      and d::date + g.hora_inicio > v_agora)
       and public.agenda__aulas_feitas(v_pac, a.id, d::date, v_agora) = 0;
    v_feitas_sem := case when v_sem <= v_hoje then public.agenda__aulas_feitas(v_pac, a.id, v_sem, v_agora) else 0 end;
    v_disp := v_disp + greatest(0, least(p.frequencia_semanal - v_feitas_sem, v_dias));
    v_sem := v_sem + 7;
  end loop;

  return jsonb_build_object(
    'ativo', true,
    'plano', p.nome,
    'frequencia', p.frequencia_semanal,
    'inicio', a.inicio_periodo,
    'fim', a.fim_periodo,
    'feitas', public.agenda__aulas_feitas(v_pac, a.id, a.inicio_periodo, v_agora),
    'disponiveis', v_disp);
end;
$fn$;
revoke all on function public.agenda_aluno_resumo() from public, anon;
grant execute on function public.agenda_aluno_resumo() to authenticated;

-- ---------------------------------------------------------------------------
-- 6) CONFERÊNCIA (uma linha) — esperado: 19 | 0 | 0 | true | true | true | 0+
-- ---------------------------------------------------------------------------
-- dias_com_2_aulas: alunos/datas futuras que JÁ têm 2+ aulas no mesmo dia
-- (de antes desta regra). Não é erro da migração: é para a recepção desmarcar.
select
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'agenda\_%' escape '\')            as funcoes,           -- 19
  (select count(*) from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name like 'agenda\_\_%' escape '\' and grantee in ('anon','authenticated'))  as internas_expostas, -- 0
  (select count(*) from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name like 'agenda%' and grantee = 'anon')                                     as anon_executa,      -- 0
  exists (select 1 from information_schema.routine_privileges
           where routine_schema = 'public' and routine_name = 'agenda_aluno_resumo' and grantee = 'authenticated')           as resumo_liberado,   -- true
  position('aulas_no_dia' in pg_get_functiondef('public.agenda__reservar(uuid, uuid, date, text, boolean)'::regprocedure)) > 0 as reservar_1_por_dia, -- true
  exists (select 1 from pg_trigger where tgname = 'trg_agenda_fixo_confere')                                                    as gatilho_fixo,      -- true
  (select count(*) from (
     select m.paciente_id, m.data from public.agenda_movimentos m
      where m.tipo = 'reserva' and m.status = 'ativo' and m.data >= public.agenda__agora()::date
      group by 1, 2
     having public.agenda__aulas_no_dia(m.paciente_id, m.data) > 1) x)                                                         as dias_com_2_aulas;
