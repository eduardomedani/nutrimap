-- ===========================================================================
-- Evollo · AGENDA DE TREINO — horários, vagas, horário fixo e troca pelo app
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE: 4 tabelas novas, policies, 1 gatilho e funções.
-- NÃO ALTERA nenhuma tabela existente (comercial, financeiro, pacientes,
-- treinos). Só LÊ comercial_assinaturas / comercial_planos / pacientes.
-- Desfazer: db/agenda_treino_desfazer.sql. 100% re-executável.
--
-- ===========================================================================
-- O QUE A GOUP FAZ HOJE (Next Fit, varredura de 10/11/2026) E VIRA AQUI
-- ---------------------------------------------------------------------------
--   · grade de horários de 1h com vagas por horário          -> agenda_grade
--   · regras da agenda (reserva abre 2 dias antes; cancelar
--     até 1h antes; agenda só para quem tem plano ativo)     -> agenda_config
--   · "Matrícula": o aluno fixo no horário, preso ao contrato,
--     cai sozinho quando o contrato acaba                     -> agenda_fixos
--   · o aluno desmarca e reserva outro dia pelo app; o total
--     da semana NUNCA passa da frequência do plano             -> agenda_movimentos
--
-- Decisões do Eduardo (10/11/2026): grade de segunda a domingo escolhível;
-- 9 pessoas por hora; o total semanal nunca passa da frequência do plano
-- (plano de 5 dias = 5 treinos na semana); 1 mês em paralelo com a Next Fit
-- (por isso `agenda_config.ativo`: o aluno só vê a agenda quando ligar).
--
-- ===========================================================================
-- COMO A OCUPAÇÃO É CALCULADA (sem gerar uma linha por aula)
-- ---------------------------------------------------------------------------
-- ocupação(horário, data) = fixos daquele dia da semana com assinatura
--                           vigente na data
--                         − os fixos que desmarcaram AQUELA data
--                         + as reservas avulsas daquela data
-- Mudou o plano, venceu, renovou: a agenda acompanha sozinha, sem rotina que
-- gere ou apague milhares de linhas.
--
-- Uso da semana do aluno (seg–dom) = fixos que caem na semana − desmarcados +
-- reservas. Reservar só é aceito com uso < frequência do plano. Desmarcar o
-- fixo devolve 1 ao saldo — é o "crédito de reposição na mesma semana" da
-- Next Fit, sem tabela de crédito: o saldo é a própria conta.
--
-- VIGÊNCIA da assinatura numa data: status 'ativa' e
--   inicio_periodo <= data <= fim_periodo + tolerancia_dias do plano.
--
-- ===========================================================================
-- ISOLAMENTO E QUEM VÊ
-- ---------------------------------------------------------------------------
--   · dono/recepção: nutri_id = organizacao_do_auth() + tem_permissao
--     ('agenda.visualizar' para ler, 'agenda.editar' para mudar) — as mesmas
--     permissões que a recepção já tem; o horário fixo também aceita
--     'comercial.editar', porque é escolhido ao lançar o plano;
--   · ALUNO: não lê tabela nenhuma direto. Tudo por funções SECURITY DEFINER
--     que conferem paciente_do_auth(), plano, prazos e vaga NO SERVIDOR;
--   · anon: nada.
--
-- Rodar no SQL Editor do Supabase de PRODUÇÃO (jdtpludqkpvhnzkekrgm).
-- Para colar, use o _LIMPO. Conferência no fim.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) REGRAS DA AGENDA — uma linha por organização
-- ---------------------------------------------------------------------------
create table if not exists public.agenda_config (
  nutri_id            uuid primary key default public.organizacao_do_auth()
                        references auth.users(id) on delete cascade,
  ativo               boolean not null default false,   -- aluno só vê/agenda com true (mês em paralelo)
  abre_dias_antes     smallint not null default 2  check (abre_dias_antes between 0 and 30),
  cancela_horas_antes numeric(5,2) not null default 1 check (cancela_horas_antes between 0 and 72),
  atualizado_em       timestamptz not null default now()
);
alter table public.agenda_config enable row level security;

-- ---------------------------------------------------------------------------
-- 2) GRADE — os horários recorrentes, com vagas
-- ---------------------------------------------------------------------------
-- dia_semana segue extract(dow): 0 = domingo … 6 = sábado.
create table if not exists public.agenda_grade (
  id           uuid primary key default gen_random_uuid(),
  nutri_id     uuid not null default public.organizacao_do_auth()
                 references auth.users(id) on delete cascade,
  dia_semana   smallint not null check (dia_semana between 0 and 6),
  hora_inicio  time not null,
  duracao_min  smallint not null default 60 check (duracao_min between 10 and 240),
  capacidade   smallint not null default 9  check (capacidade between 1 and 200),
  modalidade   text not null default 'Musculação',
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now(),
  unique (nutri_id, dia_semana, hora_inicio, modalidade)
);
create index if not exists idx_agenda_grade_org on public.agenda_grade (nutri_id, dia_semana);
alter table public.agenda_grade enable row level security;

-- ---------------------------------------------------------------------------
-- 3) HORÁRIO FIXO — o "Matrícula" da Next Fit, preso à assinatura
-- ---------------------------------------------------------------------------
-- Vale enquanto a assinatura estiver vigente; vencida, o fixo para de ocupar
-- vaga sem ninguém apagar nada. Apagar a assinatura apaga o fixo.
create table if not exists public.agenda_fixos (
  id             uuid primary key default gen_random_uuid(),
  nutri_id       uuid not null default public.organizacao_do_auth()
                   references auth.users(id) on delete cascade,
  paciente_id    uuid not null references public.pacientes(id) on delete cascade,
  assinatura_id  uuid not null references public.comercial_assinaturas(id) on delete cascade,
  grade_id       uuid not null references public.agenda_grade(id) on delete cascade,
  criado_em      timestamptz not null default now(),
  unique (assinatura_id, grade_id)
);
create index if not exists idx_agenda_fixos_grade on public.agenda_fixos (grade_id);
create index if not exists idx_agenda_fixos_paciente on public.agenda_fixos (paciente_id);
alter table public.agenda_fixos enable row level security;

-- ---------------------------------------------------------------------------
-- 4) MOVIMENTOS — só as exceções do dia
-- ---------------------------------------------------------------------------
--   tipo 'desmarcado' : o aluno fixo não vai NAQUELA data (libera a vaga)
--   tipo 'reserva'    : o aluno reservou um horário que não é o fixo dele
--   status 'cancelado': desfeito (reserva desmarcada / fixo remarcado de volta)
create table if not exists public.agenda_movimentos (
  id            uuid primary key default gen_random_uuid(),
  nutri_id      uuid not null references auth.users(id) on delete cascade,
  paciente_id   uuid not null references public.pacientes(id) on delete cascade,
  grade_id      uuid not null references public.agenda_grade(id) on delete cascade,
  data          date not null,
  tipo          text not null check (tipo in ('desmarcado', 'reserva')),
  origem        text not null check (origem in ('app', 'recepcao')),
  status        text not null default 'ativo' check (status in ('ativo', 'cancelado')),
  criado_em     timestamptz not null default now(),
  criado_por    uuid default auth.uid(),
  cancelado_em  timestamptz
);
-- Um movimento ATIVO por aluno, horário e data (não dá para reservar 2x).
create unique index if not exists uq_agenda_mov_ativo
  on public.agenda_movimentos (paciente_id, grade_id, data) where status = 'ativo';
create index if not exists idx_agenda_mov_dia on public.agenda_movimentos (grade_id, data) where status = 'ativo';
create index if not exists idx_agenda_mov_paciente on public.agenda_movimentos (paciente_id, data) where status = 'ativo';
alter table public.agenda_movimentos enable row level security;


-- ---------------------------------------------------------------------------
-- 5) POLICIES — dono/recepção por permissão; aluno NÃO lê tabela direto
-- ---------------------------------------------------------------------------
drop policy if exists agenda_config_select on public.agenda_config;
create policy agenda_config_select on public.agenda_config for select to authenticated
  using (nutri_id = public.organizacao_do_auth() and public.tem_permissao('agenda.visualizar'));
drop policy if exists agenda_config_insert on public.agenda_config;
create policy agenda_config_insert on public.agenda_config for insert to authenticated
  with check (nutri_id = public.organizacao_do_auth() and public.tem_permissao('agenda.editar'));
drop policy if exists agenda_config_update on public.agenda_config;
create policy agenda_config_update on public.agenda_config for update to authenticated
  using (nutri_id = public.organizacao_do_auth() and public.tem_permissao('agenda.editar'))
  with check (nutri_id = public.organizacao_do_auth() and public.tem_permissao('agenda.editar'));

drop policy if exists agenda_grade_select on public.agenda_grade;
create policy agenda_grade_select on public.agenda_grade for select to authenticated
  using (nutri_id = public.organizacao_do_auth()
         and (public.tem_permissao('agenda.visualizar') or public.tem_permissao('comercial.visualizar')));
drop policy if exists agenda_grade_insert on public.agenda_grade;
create policy agenda_grade_insert on public.agenda_grade for insert to authenticated
  with check (nutri_id = public.organizacao_do_auth() and public.tem_permissao('agenda.editar'));
drop policy if exists agenda_grade_update on public.agenda_grade;
create policy agenda_grade_update on public.agenda_grade for update to authenticated
  using (nutri_id = public.organizacao_do_auth() and public.tem_permissao('agenda.editar'))
  with check (nutri_id = public.organizacao_do_auth() and public.tem_permissao('agenda.editar'));
drop policy if exists agenda_grade_delete on public.agenda_grade;
create policy agenda_grade_delete on public.agenda_grade for delete to authenticated
  using (nutri_id = public.organizacao_do_auth() and public.tem_permissao('agenda.editar'));

drop policy if exists agenda_fixos_select on public.agenda_fixos;
create policy agenda_fixos_select on public.agenda_fixos for select to authenticated
  using (nutri_id = public.organizacao_do_auth()
         and (public.tem_permissao('agenda.visualizar') or public.tem_permissao('comercial.visualizar')));
drop policy if exists agenda_fixos_insert on public.agenda_fixos;
create policy agenda_fixos_insert on public.agenda_fixos for insert to authenticated
  with check (nutri_id = public.organizacao_do_auth()
              and (public.tem_permissao('agenda.editar') or public.tem_permissao('comercial.editar')));
drop policy if exists agenda_fixos_delete on public.agenda_fixos;
create policy agenda_fixos_delete on public.agenda_fixos for delete to authenticated
  using (nutri_id = public.organizacao_do_auth()
         and (public.tem_permissao('agenda.editar') or public.tem_permissao('comercial.editar')));

-- Movimentos: leitura por permissão; ESCRITA só pelas funções (sem policy de
-- insert/update/delete — nem dono escreve direto, para a regra não ter atalho).
drop policy if exists agenda_mov_select on public.agenda_movimentos;
create policy agenda_mov_select on public.agenda_movimentos for select to authenticated
  using (nutri_id = public.organizacao_do_auth() and public.tem_permissao('agenda.visualizar'));


-- ---------------------------------------------------------------------------
-- 6) FUNÇÕES INTERNAS (sem execute para ninguém além do dono do schema)
-- ---------------------------------------------------------------------------
-- Agora no horário de Brasília (as datas/horas da grade são locais).
create or replace function public.agenda__agora()
returns timestamp language sql stable set search_path = public
as $fn$ select (now() at time zone 'America/Sao_Paulo') $fn$;

-- A assinatura está vigente nesta data? (status + período + tolerância)
create or replace function public.agenda__vigente(p_assinatura uuid, p_data date)
returns boolean language sql stable security definer set search_path = public
as $fn$
  select exists (
    select 1 from public.comercial_assinaturas a
      left join public.comercial_planos p on p.id = a.plano_id
     where a.id = p_assinatura and a.status = 'ativa'
       and p_data >= a.inicio_periodo
       and p_data <= a.fim_periodo + coalesce(p.tolerancia_dias, 0));
$fn$;

-- Frequência semanal que o aluno pode usar NESTA data (0 = sem plano com agenda).
create or replace function public.agenda__limite(p_paciente uuid, p_data date)
returns int language sql stable security definer set search_path = public
as $fn$
  select coalesce(max(p.frequencia_semanal), 0)::int
    from public.comercial_assinaturas a
    join public.comercial_planos p on p.id = a.plano_id
   where a.paciente_id = p_paciente and a.status = 'ativa'
     and p.frequencia_semanal is not null
     and p_data >= a.inicio_periodo
     and p_data <= a.fim_periodo + coalesce(p.tolerancia_dias, 0);
$fn$;

-- Quantas pessoas no horário nesta data.
create or replace function public.agenda__ocupacao(p_grade uuid, p_data date)
returns int language sql stable security definer set search_path = public
as $fn$
  select (
    (select count(*) from public.agenda_fixos f
      where f.grade_id = p_grade and public.agenda__vigente(f.assinatura_id, p_data)
        and not exists (select 1 from public.agenda_movimentos m
                         where m.paciente_id = f.paciente_id and m.grade_id = p_grade and m.data = p_data
                           and m.tipo = 'desmarcado' and m.status = 'ativo'))
    + (select count(*) from public.agenda_movimentos m
        where m.grade_id = p_grade and m.data = p_data and m.tipo = 'reserva' and m.status = 'ativo')
  )::int;
$fn$;

-- O aluno está nesse horário nessa data? 'fixo' | 'reserva' | 'desmarcado' | null
create or replace function public.agenda__situacao(p_paciente uuid, p_grade uuid, p_data date)
returns text language sql stable security definer set search_path = public
as $fn$
  select coalesce(
    (select 'reserva' from public.agenda_movimentos m
      where m.paciente_id = p_paciente and m.grade_id = p_grade and m.data = p_data
        and m.tipo = 'reserva' and m.status = 'ativo'),
    (select case when exists (select 1 from public.agenda_movimentos m
                               where m.paciente_id = p_paciente and m.grade_id = p_grade and m.data = p_data
                                 and m.tipo = 'desmarcado' and m.status = 'ativo')
                 then 'desmarcado' else 'fixo' end
       from public.agenda_fixos f
      where f.paciente_id = p_paciente and f.grade_id = p_grade
        and public.agenda__vigente(f.assinatura_id, p_data)
      limit 1));
$fn$;

-- Treinos do aluno na semana (seg–dom) que contém a data.
create or replace function public.agenda__uso_semana(p_paciente uuid, p_data date)
returns int language sql stable security definer set search_path = public
as $fn$
  with sem as (select date_trunc('week', p_data)::date as ini),
  fixos as (
    select count(*) as n
      from public.agenda_fixos f
      join public.agenda_grade g on g.id = f.grade_id and g.ativo
      cross join sem
     where f.paciente_id = p_paciente
       -- a data do fixo nesta semana: seg = +0 … dom = +6
       and public.agenda__vigente(f.assinatura_id, sem.ini + ((g.dia_semana + 6) % 7))
  ),
  mov as (
    select count(*) filter (where m.tipo = 'reserva') as reservas,
           count(*) filter (where m.tipo = 'desmarcado') as desmarcados
      from public.agenda_movimentos m cross join sem
     where m.paciente_id = p_paciente and m.status = 'ativo'
       and m.data between sem.ini and sem.ini + 6
  )
  select (fixos.n - mov.desmarcados + mov.reservas)::int from fixos, mov;
$fn$;

-- O núcleo de RESERVAR (aluno e recepção). Confere tudo e grava.
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

-- O núcleo de DESMARCAR.
create or replace function public.agenda__desmarcar(
  p_paciente uuid, p_grade uuid, p_data date, p_origem text, p_checar_prazos boolean)
returns jsonb language plpgsql security definer set search_path = public
as $fn$
declare
  v_org uuid; g public.agenda_grade; c public.agenda_config;
  v_sit text; v_agora timestamp := public.agenda__agora();
begin
  select nutri_id into v_org from public.pacientes where id = p_paciente;
  select * into g from public.agenda_grade where id = p_grade and nutri_id = v_org;
  if not found then raise exception 'Horário não encontrado.' using errcode = 'P0001'; end if;
  select * into c from public.agenda_config where nutri_id = v_org;
  if p_checar_prazos and v_agora > (p_data + g.hora_inicio) - make_interval(secs => (coalesce(c.cancela_horas_antes, 1) * 3600)::double precision) then
    raise exception 'Só dá para desmarcar até % hora(s) antes do treino.', coalesce(c.cancela_horas_antes, 1)::float8 using errcode = 'P0001';
  end if;
  v_sit := public.agenda__situacao(p_paciente, p_grade, p_data);
  if v_sit = 'reserva' then
    update public.agenda_movimentos set status = 'cancelado', cancelado_em = now()
     where paciente_id = p_paciente and grade_id = p_grade and data = p_data and tipo = 'reserva' and status = 'ativo';
  elsif v_sit = 'fixo' then
    insert into public.agenda_movimentos (nutri_id, paciente_id, grade_id, data, tipo, origem)
    values (v_org, p_paciente, p_grade, p_data, 'desmarcado', p_origem);
  else
    raise exception 'Você não está nesse horário.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('ok', true);
end;
$fn$;

-- A semana (seg–dom) de horários, com ocupação e a situação de UM aluno (ou nenhum).
create or replace function public.agenda__semana(p_org uuid, p_inicio date, p_paciente uuid)
returns jsonb language sql stable security definer set search_path = public
as $fn$
  with sem as (select date_trunc('week', p_inicio)::date as ini),
  dias as (select (sem.ini + i)::date as data from sem, generate_series(0, 6) i),
  slots as (
    select g.id as grade_id, d.data, g.hora_inicio, g.duracao_min, g.capacidade, g.modalidade,
           public.agenda__ocupacao(g.id, d.data) as ocupados,
           case when p_paciente is null then null else public.agenda__situacao(p_paciente, g.id, d.data) end as meu
      from dias d
      join public.agenda_grade g on g.nutri_id = p_org and g.ativo and g.dia_semana = extract(dow from d.data)::int
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'grade_id', grade_id, 'data', data, 'hora', to_char(hora_inicio, 'HH24:MI'),
           'duracao_min', duracao_min, 'capacidade', capacidade, 'modalidade', modalidade,
           'ocupados', ocupados, 'meu', meu)
         order by data, hora_inicio), '[]'::jsonb)
    from slots;
$fn$;

revoke all on function public.agenda__agora() from public, anon, authenticated;
revoke all on function public.agenda__vigente(uuid, date) from public, anon, authenticated;
revoke all on function public.agenda__limite(uuid, date) from public, anon, authenticated;
revoke all on function public.agenda__ocupacao(uuid, date) from public, anon, authenticated;
revoke all on function public.agenda__situacao(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.agenda__uso_semana(uuid, date) from public, anon, authenticated;
revoke all on function public.agenda__reservar(uuid, uuid, date, text, boolean) from public, anon, authenticated;
revoke all on function public.agenda__desmarcar(uuid, uuid, date, text, boolean) from public, anon, authenticated;
revoke all on function public.agenda__semana(uuid, date, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 7) FUNÇÕES DO ALUNO (app) — paciente_do_auth(), regras e prazos no servidor
-- ---------------------------------------------------------------------------
create or replace function public.agenda_aluno_semana(p_inicio date)
returns jsonb language plpgsql stable security definer set search_path = public
as $fn$
declare v_pac uuid := public.paciente_do_auth(); v_org uuid; c public.agenda_config; v_ini date;
begin
  if v_pac is null then raise exception 'Faça login no app.' using errcode = 'P0001'; end if;
  select nutri_id into v_org from public.pacientes where id = v_pac;
  select * into c from public.agenda_config where nutri_id = v_org;
  if not found or not c.ativo then return jsonb_build_object('ativo', false); end if;
  v_ini := date_trunc('week', coalesce(p_inicio, public.agenda__agora()::date))::date;
  return jsonb_build_object(
    'ativo', true,
    'semana', v_ini,
    'agora', public.agenda__agora(),
    'abre_dias_antes', c.abre_dias_antes,
    'cancela_horas_antes', c.cancela_horas_antes,
    -- limite pelo plano vigente no meio da semana (quinta), uso pela semana
    'limite', public.agenda__limite(v_pac, greatest(v_ini + 3, public.agenda__agora()::date)),
    'usados', public.agenda__uso_semana(v_pac, v_ini),
    'horarios', public.agenda__semana(v_org, v_ini, v_pac));
end;
$fn$;

create or replace function public.agenda_aluno_reservar(p_grade uuid, p_data date)
returns jsonb language plpgsql security definer set search_path = public
as $fn$
declare v_pac uuid := public.paciente_do_auth(); v_ativo boolean;
begin
  if v_pac is null then raise exception 'Faça login no app.' using errcode = 'P0001'; end if;
  select c.ativo into v_ativo from public.agenda_config c join public.pacientes p on p.nutri_id = c.nutri_id where p.id = v_pac;
  if not coalesce(v_ativo, false) then raise exception 'A agenda ainda não está aberta.' using errcode = 'P0001'; end if;
  return public.agenda__reservar(v_pac, p_grade, p_data, 'app', true);
end;
$fn$;

create or replace function public.agenda_aluno_desmarcar(p_grade uuid, p_data date)
returns jsonb language plpgsql security definer set search_path = public
as $fn$
declare v_pac uuid := public.paciente_do_auth(); v_ativo boolean;
begin
  if v_pac is null then raise exception 'Faça login no app.' using errcode = 'P0001'; end if;
  select c.ativo into v_ativo from public.agenda_config c join public.pacientes p on p.nutri_id = c.nutri_id where p.id = v_pac;
  if not coalesce(v_ativo, false) then raise exception 'A agenda ainda não está aberta.' using errcode = 'P0001'; end if;
  return public.agenda__desmarcar(v_pac, p_grade, p_data, 'app', true);
end;
$fn$;

revoke all on function public.agenda_aluno_semana(date) from public, anon;
revoke all on function public.agenda_aluno_reservar(uuid, date) from public, anon;
revoke all on function public.agenda_aluno_desmarcar(uuid, date) from public, anon;
grant execute on function public.agenda_aluno_semana(date) to authenticated;
grant execute on function public.agenda_aluno_reservar(uuid, date) to authenticated;
grant execute on function public.agenda_aluno_desmarcar(uuid, date) to authenticated;


-- ---------------------------------------------------------------------------
-- 8) FUNÇÕES DO PAINEL (dono/recepção) — por permissão
-- ---------------------------------------------------------------------------
-- A semana com a lista de quem está em cada horário (para a tela Agendamentos).
create or replace function public.agenda_painel_semana(p_inicio date)
returns jsonb language plpgsql stable security definer set search_path = public
as $fn$
declare v_org uuid := public.organizacao_do_auth(); v_ini date;
begin
  if v_org is null or not public.tem_permissao('agenda.visualizar') then
    raise exception 'Sem permissão para ver a agenda.' using errcode = '42501';
  end if;
  v_ini := date_trunc('week', coalesce(p_inicio, public.agenda__agora()::date))::date;
  return jsonb_build_object(
    'semana', v_ini,
    'horarios', (
      select coalesce(jsonb_agg(s || jsonb_build_object('alunos', (
        select coalesce(jsonb_agg(jsonb_build_object('paciente_id', x.paciente_id, 'nome', x.nome, 'origem', x.origem)
                                  order by x.nome), '[]'::jsonb)
          from (
            select f.paciente_id, p.nome, 'fixo' as origem
              from public.agenda_fixos f join public.pacientes p on p.id = f.paciente_id
             where f.grade_id = (s->>'grade_id')::uuid
               and public.agenda__vigente(f.assinatura_id, (s->>'data')::date)
               and not exists (select 1 from public.agenda_movimentos m
                                where m.paciente_id = f.paciente_id and m.grade_id = f.grade_id
                                  and m.data = (s->>'data')::date and m.tipo = 'desmarcado' and m.status = 'ativo')
            union all
            select m.paciente_id, p.nome, m.origem
              from public.agenda_movimentos m join public.pacientes p on p.id = m.paciente_id
             where m.grade_id = (s->>'grade_id')::uuid and m.data = (s->>'data')::date
               and m.tipo = 'reserva' and m.status = 'ativo'
          ) x),
        'desmarcados', (
          select coalesce(jsonb_agg(jsonb_build_object('paciente_id', m.paciente_id, 'nome', p.nome, 'origem', m.origem) order by p.nome), '[]'::jsonb)
            from public.agenda_movimentos m join public.pacientes p on p.id = m.paciente_id
           where m.grade_id = (s->>'grade_id')::uuid and m.data = (s->>'data')::date
             and m.tipo = 'desmarcado' and m.status = 'ativo')
      ) order by (s->>'data'), (s->>'hora')), '[]'::jsonb)
        from jsonb_array_elements(public.agenda__semana(v_org, v_ini, null)) s));
end;
$fn$;

-- Recepção marca/desmarca por um aluno. Vaga e limite semanal valem igual;
-- os prazos do app (abrir 2 dias antes, cancelar até 1h) não travam a recepção.
create or replace function public.agenda_recepcao_reservar(p_paciente uuid, p_grade uuid, p_data date)
returns jsonb language plpgsql security definer set search_path = public
as $fn$
begin
  if not public.tem_permissao('agenda.editar')
     or not exists (select 1 from public.pacientes where id = p_paciente and nutri_id = public.organizacao_do_auth()) then
    raise exception 'Sem permissão para marcar na agenda.' using errcode = '42501';
  end if;
  return public.agenda__reservar(p_paciente, p_grade, p_data, 'recepcao', false);
end;
$fn$;

create or replace function public.agenda_recepcao_desmarcar(p_paciente uuid, p_grade uuid, p_data date)
returns jsonb language plpgsql security definer set search_path = public
as $fn$
begin
  if not public.tem_permissao('agenda.editar')
     or not exists (select 1 from public.pacientes where id = p_paciente and nutri_id = public.organizacao_do_auth()) then
    raise exception 'Sem permissão para desmarcar na agenda.' using errcode = '42501';
  end if;
  return public.agenda__desmarcar(p_paciente, p_grade, p_data, 'recepcao', false);
end;
$fn$;

revoke all on function public.agenda_painel_semana(date) from public, anon;
revoke all on function public.agenda_recepcao_reservar(uuid, uuid, date) from public, anon;
revoke all on function public.agenda_recepcao_desmarcar(uuid, uuid, date) from public, anon;
grant execute on function public.agenda_painel_semana(date) to authenticated;
grant execute on function public.agenda_recepcao_reservar(uuid, uuid, date) to authenticated;
grant execute on function public.agenda_recepcao_desmarcar(uuid, uuid, date) to authenticated;


-- ---------------------------------------------------------------------------
-- 9) GATILHO DO HORÁRIO FIXO — frequência do plano e vaga
-- ---------------------------------------------------------------------------
-- Escolher o fixo no Comercial passa por aqui: a assinatura e o horário têm de
-- ser da mesma organização e do mesmo aluno; o número de fixos não passa da
-- frequência do plano; e o horário não passa da capacidade (contando os
-- fixos com assinatura vigente hoje).
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

drop trigger if exists trg_agenda_fixo_confere on public.agenda_fixos;
create trigger trg_agenda_fixo_confere before insert on public.agenda_fixos
  for each row execute function public.agenda__fixo_confere();


-- ---------------------------------------------------------------------------
-- 10) O PROPRIETÁRIO VÊ E EDITA A AGENDA (idempotente; normalmente já tem)
-- ---------------------------------------------------------------------------
insert into public.perfil_permissoes (perfil_id, permissao_chave)
select p.id, pm.chave
  from public.perfis p cross join public.permissoes pm
 where p.organizacao_id is null and p.chave = 'proprietario'
   and pm.chave in ('agenda.visualizar', 'agenda.editar')
on conflict do nothing;


-- ---------------------------------------------------------------------------
-- 11) CONFERÊNCIA — esperado: 4 tabelas com RLS, 9 policies... (uma linha)
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_tables where schemaname = 'public'
     and tablename in ('agenda_config','agenda_grade','agenda_fixos','agenda_movimentos') and rowsecurity) as tabelas_com_rls,  -- 4
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename in ('agenda_config','agenda_grade','agenda_fixos','agenda_movimentos'))                                   as policies,        -- 11
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'agenda\_%' escape '\')            as funcoes,         -- 16
  (select count(*) from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name like 'agenda\_\_%' escape '\' and grantee in ('anon','authenticated'))  as internas_expostas, -- 0
  (select count(*) from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name like 'agenda%' and grantee = 'anon')                                     as anon_executa,    -- 0
  exists (select 1 from pg_trigger where tgname = 'trg_agenda_fixo_confere')                                                    as gatilho_fixo;    -- true
