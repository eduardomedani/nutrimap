-- ===========================================================================
-- Evollo · CHECK-INS INTELIGENTES — Etapa 1 (fundacao)
-- ---------------------------------------------------------------------------
-- Modelo -> perguntas -> atribuicao ao paciente -> ocorrencia -> respostas.
--
-- AS TRES DECISOES QUE EXPLICAM O RESTO DO ARQUIVO:
--
-- 1) SNAPSHOT, NAO VERSIONAMENTO. A ocorrencia carrega o questionario que o
--    paciente viu, em JSONB. Versionar exigiria criar uma versao a cada edicao
--    do modelo — e esquecer isso UMA vez reescreve o passado em silencio.
--    Snapshot torna a imutabilidade estrutural: nao ha caminho para uma edicao
--    alcancar uma ocorrencia ja criada.
--
-- 2) O ID DA PERGUNTA E A IDENTIDADE LONGITUDINAL. O snapshot guarda o que a
--    pergunta SIGNIFICAVA; checkin_respostas.pergunta_id guarda QUAL pergunta
--    e, ao longo do tempo. Sao trabalhos diferentes, e e por isso que os dois
--    existem. A FK e RESTRICT: pergunta usada nao some.
--    REGRA CONCEITUAL: pergunta_id representa uma variavel longitudinal.
--    Mudanca que altera o SIGNIFICADO ("sua fome" -> "sua fome a noite") deve
--    gerar pergunta NOVA, nao reaproveitar a identidade. Ajuste de redacao que
--    mede a mesma coisa pode manter o id.
--
-- 3) "ATRASADO" NAO E STATUS. E `status = 'disponivel' and prazo_em < now()`.
--    Gravar atraso exigiria alguem passando para virar o estado, e o dia em
--    que esse alguem falhasse a tela mentiria.
--
-- Requer: pacientes com auth_user_id e public.paciente_do_auth()
--         (db/paciente_login_schema.sql).
-- 100% re-executavel. Rodar no SQL Editor do Supabase.
-- Desfazer: db/checkin_schema_desfazer.sql
-- ===========================================================================


-- ===========================================================================
-- 1) MODELOS
-- ===========================================================================
create table if not exists public.checkin_modelos (
  id        uuid primary key default gen_random_uuid(),
  nutri_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,

  nome      text not null,
  descricao text,

  -- Sugestao para a atribuicao; nao amarra nada. Um modelo semanal pode ser
  -- atribuido como mensal a um paciente especifico.
  frequencia_padrao text not null default 'semanal',
  status            text not null default 'ativo',

  criado_em     timestamptz not null default now(),
  criado_por    uuid default auth.uid(),
  atualizado_em timestamptz not null default now()
);

alter table public.checkin_modelos drop constraint if exists ckm_status_check;
alter table public.checkin_modelos add  constraint ckm_status_check
  check (status in ('ativo', 'arquivado'));

alter table public.checkin_modelos drop constraint if exists ckm_freq_check;
alter table public.checkin_modelos add  constraint ckm_freq_check
  check (frequencia_padrao in ('semanal', 'quinzenal', 'mensal', 'manual'));

create index if not exists idx_ckm_nutri
  on public.checkin_modelos (nutri_id, status, criado_em desc);


-- ===========================================================================
-- 2) PERGUNTAS
-- ---------------------------------------------------------------------------
-- `ativo` e SOFT DELETE, e nao conveniencia: a resposta aponta para a pergunta
-- por FK RESTRICT, entao apagar fisicamente uma pergunta ja usada e impossivel
-- — e desejavel que seja. Desativar tira de novos snapshots sem quebrar o
-- historico nem a comparacao longitudinal.
-- ===========================================================================
create table if not exists public.checkin_perguntas (
  id        uuid primary key default gen_random_uuid(),
  modelo_id uuid not null references public.checkin_modelos(id) on delete cascade,
  nutri_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,

  texto       text not null,
  tipo        text not null,
  obrigatoria boolean not null default false,
  ordem       integer not null default 0,
  unidade     text,

  -- O que muda por tipo mora aqui, e nao em coluna propria: `escala` precisa
  -- de min/max/labels, `multipla_escolha` de opcoes, `texto` de nada. Colunas
  -- para cada um deixariam a tabela com metade das celulas nulas.
  -- E e aqui que limite_atencao/direcao/ocorrencias_consecutivas entram
  -- depois, sem migration.
  configuracao jsonb not null default '{}'::jsonb,

  ativo boolean not null default true,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.checkin_perguntas add column if not exists unidade text;
alter table public.checkin_perguntas add column if not exists ativo boolean not null default true;

alter table public.checkin_perguntas drop constraint if exists ckp_tipo_check;
alter table public.checkin_perguntas add  constraint ckp_tipo_check
  check (tipo in ('escala', 'multipla_escolha', 'sim_nao', 'numero',
                  'texto_curto', 'texto_longo'));

-- CHECK minimo de propositio: a coerencia de `configuracao` por tipo (min<max,
-- opcoes nao vazio) e validada no servico e na RPC. Um CHECK que tentasse
-- cobrir todo o JSONB viraria expressao ilegivel que ninguem mais mexe.
alter table public.checkin_perguntas drop constraint if exists ckp_config_check;
alter table public.checkin_perguntas add  constraint ckp_config_check
  check (jsonb_typeof(configuracao) = 'object');

-- Sem unique em (modelo_id, ordem): reordenar exigiria mexer em todas as
-- linhas numa ordem especifica so para nao colidir no meio do caminho.
create index if not exists idx_ckp_modelo
  on public.checkin_perguntas (modelo_id, ordem, criado_em);


-- ===========================================================================
-- 3) ATRIBUICOES — o modelo aplicado a um paciente
-- ===========================================================================
create table if not exists public.checkin_atribuicoes (
  id          uuid primary key default gen_random_uuid(),
  nutri_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  paciente_id uuid not null references public.pacientes(id) on delete restrict,
  modelo_id   uuid not null references public.checkin_modelos(id) on delete restrict,

  frequencia  text not null default 'semanal',
  data_inicio date not null default current_date,
  dia_semana  smallint,   -- 0 = domingo … 6 = sabado
  dia_mes     smallint,

  ativo boolean not null default true,

  -- Informacao de AGENDAMENTO, nao automacao: nesta etapa nada le este campo
  -- sozinho. Quem calcula e js/checkin.js; quem vai chamar e a Etapa 2.
  proxima_ocorrencia_em date,

  criado_em     timestamptz not null default now(),
  criado_por    uuid default auth.uid(),
  atualizado_em timestamptz not null default now()
);

alter table public.checkin_atribuicoes drop constraint if exists cka_freq_check;
alter table public.checkin_atribuicoes add  constraint cka_freq_check
  check (frequencia in ('semanal', 'quinzenal', 'mensal', 'manual'));

alter table public.checkin_atribuicoes drop constraint if exists cka_dia_semana_check;
alter table public.checkin_atribuicoes add  constraint cka_dia_semana_check
  check (dia_semana is null or dia_semana between 0 and 6);

alter table public.checkin_atribuicoes drop constraint if exists cka_dia_mes_check;
alter table public.checkin_atribuicoes add  constraint cka_dia_mes_check
  check (dia_mes is null or dia_mes between 1 and 31);

-- Coerencia por frequencia. Combinacao invalida nao passa em silencio: uma
-- atribuicao semanal sem dia_semana nunca produziria ocorrencia, e o problema
-- so apareceria semanas depois, como "o check-in nao chegou".
alter table public.checkin_atribuicoes drop constraint if exists cka_coerencia_check;
alter table public.checkin_atribuicoes add  constraint cka_coerencia_check
  check (
    (frequencia in ('semanal', 'quinzenal') and dia_semana is not null and dia_mes is null)
    or (frequencia = 'mensal' and dia_mes is not null and dia_semana is null)
    or (frequencia = 'manual'  and dia_semana is null and dia_mes is null)
  );

-- Um modelo ATIVO por paciente. Mesmo padrao de uq_comercial_assinatura_ativa:
-- o parcial deixa reatribuir depois de desativar.
create unique index if not exists uniq_cka_ativa
  on public.checkin_atribuicoes (paciente_id, modelo_id)
  where ativo;

create index if not exists idx_cka_paciente
  on public.checkin_atribuicoes (paciente_id, ativo);

create index if not exists idx_cka_proxima
  on public.checkin_atribuicoes (proxima_ocorrencia_em)
  where ativo and proxima_ocorrencia_em is not null;


-- ===========================================================================
-- 4) OCORRENCIAS — o check-in concreto
-- ===========================================================================
create table if not exists public.checkin_ocorrencias (
  id            uuid primary key default gen_random_uuid(),
  nutri_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  paciente_id   uuid not null references public.pacientes(id) on delete restrict,
  atribuicao_id uuid not null references public.checkin_atribuicoes(id) on delete restrict,
  modelo_id     uuid not null references public.checkin_modelos(id) on delete restrict,

  -- O periodo de referencia. E a chave natural do "ja materializei este?".
  periodo date not null,

  -- O questionario congelado. Ver o cabecalho: e o que torna a imutabilidade
  -- estrutural em vez de disciplinar.
  snapshot jsonb not null,

  -- disponivel_em = quando o paciente PODE responder.
  -- prazo_em      = ate quando esta DENTRO DO PRAZO.
  -- Depois do prazo o status continua 'disponivel'; "atrasado" e derivado.
  disponivel_em timestamptz not null default now(),
  prazo_em      timestamptz,
  respondido_em timestamptz,

  status text not null default 'agendado',

  criado_em timestamptz not null default now()
);

alter table public.checkin_ocorrencias drop constraint if exists cko_status_check;
alter table public.checkin_ocorrencias add  constraint cko_status_check
  check (status in ('agendado', 'disponivel', 'respondido', 'cancelado'));

alter table public.checkin_ocorrencias drop constraint if exists cko_respondido_check;
alter table public.checkin_ocorrencias add  constraint cko_respondido_check
  check ((status = 'respondido') = (respondido_em is not null));

alter table public.checkin_ocorrencias drop constraint if exists cko_snapshot_check;
alter table public.checkin_ocorrencias add  constraint cko_snapshot_check
  check (jsonb_typeof(snapshot -> 'perguntas') = 'array');

-- IDEMPOTENCIA DA MATERIALIZACAO. Cancelada fica de fora pelo mesmo motivo do
-- uq_comercial_cobranca_periodo: um check-in cancelado e justamente o que se
-- refaz naquele periodo.
create unique index if not exists uniq_cko_periodo
  on public.checkin_ocorrencias (atribuicao_id, periodo)
  where status <> 'cancelado';

create index if not exists idx_cko_paciente_status
  on public.checkin_ocorrencias (paciente_id, status);

create index if not exists idx_cko_paciente_data
  on public.checkin_ocorrencias (paciente_id, disponivel_em desc);

create index if not exists idx_cko_nutri
  on public.checkin_ocorrencias (nutri_id, disponivel_em desc);

-- Atrasados: disponivel e fora do prazo. Parcial porque e o unico recorte que
-- a operacao diaria consulta com frequencia.
create index if not exists idx_cko_atrasadas
  on public.checkin_ocorrencias (nutri_id, prazo_em)
  where status = 'disponivel' and prazo_em is not null;


-- ===========================================================================
-- 5) RESPOSTAS
-- ---------------------------------------------------------------------------
-- Normalizada, e nao um JSONB unico na ocorrencia: e o que permite comparar a
-- mesma pergunta ao longo do tempo, montar grafico e, depois, alertar.
--
-- `valor` e JSONB unico de proposito. Colunas separadas por tipo (valor_texto,
-- valor_numero, valor_bool) deixariam quatro colunas com tres nulas em toda
-- linha, e a RPC ja valida o tipo contra o snapshot.
-- ===========================================================================
create table if not exists public.checkin_respostas (
  id            uuid primary key default gen_random_uuid(),
  ocorrencia_id uuid not null references public.checkin_ocorrencias(id) on delete cascade,

  -- RESTRICT: pergunta usada em resposta nao pode ser apagada. Desativar sim,
  -- apagar nao — a identidade longitudinal depende dela continuar existindo.
  pergunta_id uuid not null references public.checkin_perguntas(id) on delete restrict,

  -- O tipo NO MOMENTO DA RESPOSTA, lido do snapshot. Se a pergunta virar outro
  -- tipo depois, a resposta antiga continua sabendo como se ler.
  tipo  text not null,
  valor jsonb not null,

  criado_em timestamptz not null default now()
);

-- Uma resposta por pergunta por ocorrencia. E a segunda rede contra dupla
-- finalizacao: mesmo que duas transacoes passassem pelo lock, a segunda
-- colidiria aqui.
create unique index if not exists uniq_ckr_pergunta
  on public.checkin_respostas (ocorrencia_id, pergunta_id);

create index if not exists idx_ckr_ocorrencia
  on public.checkin_respostas (ocorrencia_id);

-- Serie temporal de uma pergunta: e esta que sustenta grafico e comparacao.
create index if not exists idx_ckr_longitudinal
  on public.checkin_respostas (pergunta_id, criado_em desc);


-- ===========================================================================
-- 6) AUDITORIA
-- ---------------------------------------------------------------------------
-- Minima e propria do modulo. Nao ha auditoria generica no projeto — existem
-- tres tabelas por modulo (financeiro_auditoria, documento_auditoria,
-- paciente_documento_auditoria), cada uma com colunas do seu dominio. Uma
-- quarta no mesmo formato e o caminho consistente; unificar as quatro e
-- trabalho de outra etapa.
--
-- So os eventos essenciais do briefing: modelo, atribuicao, ocorrencia,
-- finalizacao. Escrita por GATILHO — insert espalhado pela tela e esquecido no
-- primeiro caminho novo.
-- ===========================================================================
create table if not exists public.checkin_auditoria (
  id            uuid primary key default gen_random_uuid(),
  nutri_id      uuid not null,
  acao          text not null,
  modelo_id     uuid,
  atribuicao_id uuid,
  ocorrencia_id uuid,
  paciente_id   uuid,
  usuario_id    uuid,
  metadata      jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now()
);

create index if not exists idx_ckaud_nutri
  on public.checkin_auditoria (nutri_id, criado_em desc);
create index if not exists idx_ckaud_ocorrencia
  on public.checkin_auditoria (ocorrencia_id, criado_em desc);


create or replace function public.registrar_auditoria_checkin()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_acao text;
begin
  if tg_table_name = 'checkin_modelos' then
    if tg_op = 'INSERT' then v_acao := 'modelo_criado';
    elsif old.status is distinct from new.status then
      v_acao := case when new.status = 'arquivado' then 'modelo_arquivado' else 'modelo_reativado' end;
    elsif (old.nome, old.descricao) is distinct from (new.nome, new.descricao) then
      v_acao := 'modelo_editado';
    else return new;
    end if;
    insert into public.checkin_auditoria (nutri_id, acao, modelo_id, usuario_id, metadata)
    values (new.nutri_id, v_acao, new.id, auth.uid(), jsonb_build_object('nome', new.nome));
    return new;
  end if;

  if tg_table_name = 'checkin_atribuicoes' then
    if tg_op = 'INSERT' then v_acao := 'atribuicao_criada';
    elsif old.ativo is distinct from new.ativo then
      v_acao := case when new.ativo then 'atribuicao_reativada' else 'atribuicao_desativada' end;
    else return new;
    end if;
    insert into public.checkin_auditoria
      (nutri_id, acao, modelo_id, atribuicao_id, paciente_id, usuario_id, metadata)
    values (new.nutri_id, v_acao, new.modelo_id, new.id, new.paciente_id, auth.uid(),
            jsonb_build_object('frequencia', new.frequencia));
    return new;
  end if;

  -- checkin_ocorrencias
  if tg_op = 'INSERT' then v_acao := 'ocorrencia_materializada';
  elsif old.status is distinct from new.status and new.status = 'respondido' then
    v_acao := 'checkin_finalizado';
  elsif old.status is distinct from new.status and new.status = 'cancelado' then
    v_acao := 'ocorrencia_cancelada';
  else return new;
  end if;
  insert into public.checkin_auditoria
    (nutri_id, acao, modelo_id, atribuicao_id, ocorrencia_id, paciente_id, usuario_id, metadata)
  values (new.nutri_id, v_acao, new.modelo_id, new.atribuicao_id, new.id, new.paciente_id, auth.uid(),
          jsonb_build_object('periodo', new.periodo));
  return new;
end
$fn$;

drop trigger if exists trg_aud_ckm on public.checkin_modelos;
create trigger trg_aud_ckm after insert or update on public.checkin_modelos
  for each row execute function public.registrar_auditoria_checkin();

drop trigger if exists trg_aud_cka on public.checkin_atribuicoes;
create trigger trg_aud_cka after insert or update on public.checkin_atribuicoes
  for each row execute function public.registrar_auditoria_checkin();

drop trigger if exists trg_aud_cko on public.checkin_ocorrencias;
create trigger trg_aud_cko after insert or update on public.checkin_ocorrencias
  for each row execute function public.registrar_auditoria_checkin();


-- ── atualizado_em ──────────────────────────────────────────────────────────
create or replace function public.tocar_checkin()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.atualizado_em := now();
  return new;
end
$fn$;

drop trigger if exists trg_tocar_ckm on public.checkin_modelos;
create trigger trg_tocar_ckm before update on public.checkin_modelos
  for each row execute function public.tocar_checkin();
drop trigger if exists trg_tocar_ckp on public.checkin_perguntas;
create trigger trg_tocar_ckp before update on public.checkin_perguntas
  for each row execute function public.tocar_checkin();
drop trigger if exists trg_tocar_cka on public.checkin_atribuicoes;
create trigger trg_tocar_cka before update on public.checkin_atribuicoes
  for each row execute function public.tocar_checkin();


-- ===========================================================================
-- 7) MATERIALIZAR — atribuicao + periodo => ocorrencia
-- ---------------------------------------------------------------------------
-- Uma ocorrencia por chamada. Nada de gerar o ano inteiro adiantado: mudar o
-- modelo em marco reescreveria o significado de dezembro.
--
-- IDEMPOTENTE POR CONTRATO: chamar duas vezes para o mesmo (atribuicao,
-- periodo) devolve a MESMA ocorrencia, sem erro. O unique parcial e a garantia
-- no banco; o `on conflict do nothing` + re-select e o que impede o erro cru
-- de unique chegar na aplicacao.
--
-- Nao e chamada por ninguem nesta etapa. Existe para que a Etapa 2 possa
-- escolher entre cron, Edge Function ou sob demanda sem mudar o modelo.
-- ===========================================================================
create or replace function public.materializar_ocorrencia_checkin(
  p_atribuicao   uuid,
  p_periodo      date,
  p_disponivel_em timestamptz default null,
  p_prazo_em      timestamptz default null
)
returns public.checkin_ocorrencias
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_at  public.checkin_atribuicoes;
  v_mod public.checkin_modelos;
  v_snapshot jsonb;
  v_oc  public.checkin_ocorrencias;
begin
  select * into v_at from public.checkin_atribuicoes where id = p_atribuicao;
  if v_at.id is null then raise exception 'checkin_atribuicao_inexistente'; end if;
  if v_at.nutri_id <> auth.uid() then raise exception 'checkin_atribuicao_de_outro'; end if;
  if not v_at.ativo then raise exception 'checkin_atribuicao_inativa'; end if;

  select * into v_mod from public.checkin_modelos where id = v_at.modelo_id;
  if v_mod.status <> 'ativo' then raise exception 'checkin_modelo_arquivado'; end if;

  -- SO PERGUNTAS ATIVAS entram no snapshot. Desativar uma pergunta tira ela
  -- dos check-ins novos sem tocar nos antigos, que carregam o proprio.
  select jsonb_build_object(
           'modelo', jsonb_build_object('id', v_mod.id, 'nome', v_mod.nome,
                                        'descricao', v_mod.descricao),
           'perguntas', coalesce(jsonb_agg(p order by p.ordem, p.criado_em), '[]'::jsonb))
    into v_snapshot
    from (
      select id, texto, tipo, obrigatoria, ordem, unidade, configuracao, criado_em
        from public.checkin_perguntas
       where modelo_id = v_mod.id and ativo
    ) p;

  if jsonb_array_length(v_snapshot -> 'perguntas') = 0 then
    raise exception 'checkin_modelo_sem_perguntas';
  end if;

  insert into public.checkin_ocorrencias
    (nutri_id, paciente_id, atribuicao_id, modelo_id, periodo, snapshot,
     disponivel_em, prazo_em, status)
  values
    (v_at.nutri_id, v_at.paciente_id, v_at.id, v_mod.id, p_periodo, v_snapshot,
     coalesce(p_disponivel_em, now()), p_prazo_em,
     case when coalesce(p_disponivel_em, now()) <= now() then 'disponivel' else 'agendado' end)
  on conflict do nothing
  returning * into v_oc;

  -- Ja existia: devolve a que esta la. Chamar de novo nao e erro — e o que um
  -- cron reexecutado ou um duplo clique produzem.
  if v_oc.id is null then
    select * into v_oc
      from public.checkin_ocorrencias
     where atribuicao_id = p_atribuicao and periodo = p_periodo and status <> 'cancelado';
  end if;

  return v_oc;
end
$fn$;

revoke all on function public.materializar_ocorrencia_checkin(uuid, date, timestamptz, timestamptz) from public;
revoke all on function public.materializar_ocorrencia_checkin(uuid, date, timestamptz, timestamptz) from anon;
grant execute on function public.materializar_ocorrencia_checkin(uuid, date, timestamptz, timestamptz) to authenticated;


-- ===========================================================================
-- 8) FINALIZAR — a unica escrita do paciente
-- ---------------------------------------------------------------------------
-- Ordem, e o porque de cada passo:
--   1. `select ... for update` TRAVA a ocorrencia antes de qualquer validacao.
--      A segunda chamada espera aqui; quando entra, ve status 'respondido' e
--      sai por excecao. Sem o lock, as duas validariam, as duas inseririam, e
--      a segunda so descobriria o problema no unique — com metade do trabalho
--      feito e um erro cru para tratar.
--   2. valida TUDO contra o snapshot antes de gravar qualquer coisa;
--   3. insere as respostas;
--   4. muda o status por ultimo.
-- A funcao inteira e uma transacao: excecao em qualquer ponto desfaz tudo, e
-- nao existe estado parcial.
--
-- p_respostas: { "<pergunta_id>": <valor>, ... }
-- ===========================================================================
create or replace function public.finalizar_checkin(p_ocorrencia uuid, p_respostas jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_eu   uuid;
  v_oc   public.checkin_ocorrencias;
  v_p    jsonb;
  v_id   text;
  v_tipo text;
  v_val  jsonb;
  v_cfg  jsonb;
  v_num  numeric;
  v_n    integer := 0;
begin
  v_eu := public.paciente_do_auth();
  if v_eu is null then raise exception 'checkin_sem_paciente'; end if;
  if jsonb_typeof(p_respostas) <> 'object' then raise exception 'checkin_payload_invalido'; end if;

  -- 1) trava
  select * into v_oc
    from public.checkin_ocorrencias
   where id = p_ocorrencia and paciente_id = v_eu
   for update;

  if v_oc.id is null then raise exception 'checkin_nao_encontrado'; end if;
  if v_oc.status = 'respondido' then raise exception 'checkin_ja_finalizado'; end if;
  if v_oc.status <> 'disponivel' then raise exception 'checkin_indisponivel'; end if;

  -- 2) valida contra o SNAPSHOT — nunca contra a pergunta atual, que pode ter
  --    mudado depois de a ocorrencia nascer.
  for v_p in select * from jsonb_array_elements(v_oc.snapshot -> 'perguntas')
  loop
    v_id   := v_p ->> 'id';
    v_tipo := v_p ->> 'tipo';
    v_cfg  := coalesce(v_p -> 'configuracao', '{}'::jsonb);
    v_val  := p_respostas -> v_id;

    if v_val is null or jsonb_typeof(v_val) = 'null' then
      if coalesce((v_p ->> 'obrigatoria')::boolean, false) then
        raise exception 'checkin_obrigatoria_faltando:%', v_id;
      end if;
      continue;
    end if;

    if v_tipo = 'sim_nao' then
      if jsonb_typeof(v_val) <> 'boolean' then raise exception 'checkin_tipo_invalido:%', v_id; end if;

    elsif v_tipo in ('escala', 'numero') then
      if jsonb_typeof(v_val) <> 'number' then raise exception 'checkin_tipo_invalido:%', v_id; end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_cfg ? 'min' and v_num < (v_cfg ->> 'min')::numeric then
        raise exception 'checkin_fora_do_intervalo:%', v_id;
      end if;
      if v_cfg ? 'max' and v_num > (v_cfg ->> 'max')::numeric then
        raise exception 'checkin_fora_do_intervalo:%', v_id;
      end if;

    elsif v_tipo = 'multipla_escolha' then
      if jsonb_typeof(v_val) <> 'string' then raise exception 'checkin_tipo_invalido:%', v_id; end if;
      if not (v_cfg -> 'opcoes' @> jsonb_build_array(v_val #>> '{}')) then
        raise exception 'checkin_opcao_invalida:%', v_id;
      end if;

    elsif v_tipo in ('texto_curto', 'texto_longo') then
      if jsonb_typeof(v_val) <> 'string' then raise exception 'checkin_tipo_invalido:%', v_id; end if;

    else
      raise exception 'checkin_tipo_desconhecido:%', v_tipo;
    end if;

    -- 3) grava
    insert into public.checkin_respostas (ocorrencia_id, pergunta_id, tipo, valor)
    values (v_oc.id, v_id::uuid, v_tipo, v_val);
    v_n := v_n + 1;
  end loop;

  -- 4) so agora o status muda
  update public.checkin_ocorrencias
     set status = 'respondido', respondido_em = now()
   where id = v_oc.id and status = 'disponivel';

  if not found then raise exception 'checkin_ja_finalizado'; end if;

  return jsonb_build_object(
    'ocorrencia_id', v_oc.id,
    'respostas', v_n,
    'respondido_em', now());
end
$fn$;

revoke all on function public.finalizar_checkin(uuid, jsonb) from public;
revoke all on function public.finalizar_checkin(uuid, jsonb) from anon;
grant execute on function public.finalizar_checkin(uuid, jsonb) to authenticated;

-- Gatilhos: ninguem os chama direto, entao nao recebem EXECUTE de ninguem.
revoke all on function public.registrar_auditoria_checkin() from public;
revoke all on function public.registrar_auditoria_checkin() from anon;
revoke all on function public.registrar_auditoria_checkin() from authenticated;
revoke all on function public.tocar_checkin() from public;
revoke all on function public.tocar_checkin() from anon;
revoke all on function public.tocar_checkin() from authenticated;


-- ===========================================================================
-- 9) RLS
-- ---------------------------------------------------------------------------
-- O paciente NAO le modelo, pergunta nem atribuicao: o snapshot da ocorrencia
-- ja traz tudo que ele precisa ver, e sem os campos administrativos.
-- ===========================================================================
alter table public.checkin_modelos      enable row level security;
alter table public.checkin_perguntas    enable row level security;
alter table public.checkin_atribuicoes  enable row level security;
alter table public.checkin_ocorrencias  enable row level security;
alter table public.checkin_respostas    enable row level security;
alter table public.checkin_auditoria    enable row level security;

-- ── Modelos ──
drop policy if exists ckm_nutri_all on public.checkin_modelos;
create policy ckm_nutri_all on public.checkin_modelos
  for all to authenticated
  using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

-- ── Perguntas ──
drop policy if exists ckp_nutri_all on public.checkin_perguntas;
create policy ckp_nutri_all on public.checkin_perguntas
  for all to authenticated
  using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

-- ── Atribuicoes ──
drop policy if exists cka_nutri_select on public.checkin_atribuicoes;
drop policy if exists cka_nutri_insert on public.checkin_atribuicoes;
drop policy if exists cka_nutri_update on public.checkin_atribuicoes;
drop policy if exists cka_nutri_delete on public.checkin_atribuicoes;

create policy cka_nutri_select on public.checkin_atribuicoes
  for select to authenticated using (nutri_id = auth.uid());

-- O exists() amarra a atribuicao a um paciente DA PROPRIA carteira. Sem ele,
-- bastaria mandar o paciente_id de outro profissional.
create policy cka_nutri_insert on public.checkin_atribuicoes
  for insert to authenticated
  with check (
    nutri_id = auth.uid()
    and exists (select 1 from public.pacientes p
                 where p.id = paciente_id and p.nutri_id = auth.uid())
    and exists (select 1 from public.checkin_modelos m
                 where m.id = modelo_id and m.nutri_id = auth.uid())
  );

create policy cka_nutri_update on public.checkin_atribuicoes
  for update to authenticated
  using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

create policy cka_nutri_delete on public.checkin_atribuicoes
  for delete to authenticated using (nutri_id = auth.uid());

-- ── Ocorrencias ──
drop policy if exists cko_nutri_all       on public.checkin_ocorrencias;
drop policy if exists cko_paciente_select on public.checkin_ocorrencias;

create policy cko_nutri_all on public.checkin_ocorrencias
  for all to authenticated
  using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

-- O paciente LE as proprias, e so o que ja esta em jogo. 'agendado' fica de
-- fora: check-in que ainda nao abriu nao e assunto dele.
create policy cko_paciente_select on public.checkin_ocorrencias
  for select to authenticated
  using (
    paciente_id = public.paciente_do_auth()
    and status in ('disponivel', 'respondido')
  );

-- ── Respostas ──
drop policy if exists ckr_nutri_select    on public.checkin_respostas;
drop policy if exists ckr_paciente_select on public.checkin_respostas;

create policy ckr_nutri_select on public.checkin_respostas
  for select to authenticated
  using (exists (select 1 from public.checkin_ocorrencias o
                  where o.id = ocorrencia_id and o.nutri_id = auth.uid()));

create policy ckr_paciente_select on public.checkin_respostas
  for select to authenticated
  using (exists (select 1 from public.checkin_ocorrencias o
                  where o.id = ocorrencia_id and o.paciente_id = public.paciente_do_auth()));

-- NENHUMA policy de escrita em respostas, para ninguem. Quem grava e a RPC de
-- finalizacao, que roda como definer. Nem o profissional insere resposta —
-- reabertura, se um dia existir, sera fluxo proprio.

-- ── Auditoria ──
drop policy if exists ckaud_nutri_select on public.checkin_auditoria;
create policy ckaud_nutri_select on public.checkin_auditoria
  for select to authenticated using (nutri_id = auth.uid());
-- Sem policy de insert: quem escreve e o gatilho. Ninguem edita o proprio log.


-- ===========================================================================
-- Conferencia: as seis tabelas nascem vazias e com RLS.
-- ===========================================================================
select
  (select count(*) from public.checkin_modelos)      as modelos,
  (select count(*) from public.checkin_perguntas)    as perguntas,
  (select count(*) from public.checkin_atribuicoes)  as atribuicoes,
  (select count(*) from public.checkin_ocorrencias)  as ocorrencias,
  (select count(*) from public.checkin_respostas)    as respostas,
  (select count(*) from pg_class
    where oid in ('public.checkin_modelos'::regclass, 'public.checkin_perguntas'::regclass,
                  'public.checkin_atribuicoes'::regclass, 'public.checkin_ocorrencias'::regclass,
                  'public.checkin_respostas'::regclass, 'public.checkin_auditoria'::regclass)
      and relrowsecurity)                            as com_rls;
