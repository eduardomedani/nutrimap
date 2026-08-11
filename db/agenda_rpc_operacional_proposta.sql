-- ===========================================================================
-- Evollo · AGENDA — a superficie operacional segura
-- ---------------------------------------------------------------------------
-- PROPOSTA. NAO APLICADO. Ver "por que nao rodar isto agora" no fim do
-- cabecalho.
--
-- Quatro RPCs que deixam a Recepcao operar a agenda inteira sem receber uma
-- unica linha de public.consultas.
--
-- 100% re-executavel. Desfazer: db/agenda_rpc_operacional_desfazer.sql
--
-- ===========================================================================
-- O PROBLEMA QUE ESTAS FUNCOES RESOLVEM
-- ---------------------------------------------------------------------------
-- public.consultas nao e uma tabela de agenda. A MESMA LINHA guarda o horario
-- e o registro clinico do atendimento:
--
--   agendamento : data_hora, duracao_min, status, tipo, modalidade
--   prontuario  : motivo, relato, conduta, orientacoes, resumo, observacoes
--
-- RLS protege LINHA, nao COLUNA. Uma policy de SELECT que deixe a Recepcao ver
-- a agenda entrega, no mesmo `select`, a conduta clinica de todo atendimento
-- ja realizado. Nao ha predicado que separe as duas coisas, porque nao ha duas
-- coisas para o Postgres — ha uma linha.
--
-- ---------------------------------------------------------------------------
-- POR QUE NAO UMA VIEW
-- ---------------------------------------------------------------------------
-- Uma view com as colunas certas parece a resposta obvia, e nao e. O projeto
-- exige `security_invoker` em toda view — ha guarda em test/views.test.mjs — e
-- view `security_invoker` respeita o RLS da tabela de baixo. Para ler a view,
-- a Recepcao precisaria de uma policy de SELECT em consultas. E com essa
-- policy ela consultaria `/rest/v1/consultas` direto pelo PostgREST e veria
-- todas as colunas.
--
-- A view protegeria a tela, nao o dado. E o que importa proteger e o dado.
--
-- SECURITY DEFINER inverte isso: a funcao le a tabela com o privilegio DELA,
-- devolve so o que projeta, e a Recepcao nao precisa — nem recebe — policy
-- nenhuma em consultas.
--
-- ---------------------------------------------------------------------------
-- A ESCRITA TAMBEM PRECISA PASSAR POR AQUI, E PELO MESMO MOTIVO
-- ---------------------------------------------------------------------------
-- Policy de INSERT tambem nao restringe coluna. `agenda.criar` como policy
-- direta deixaria a Recepcao gravar em `relato` e `conduta` — nao ler, mas
-- escrever, o que e pior. Por isso agendar, remarcar e cancelar sao RPCs que
-- tocam so as colunas operacionais.
--
-- ---------------------------------------------------------------------------
-- CANCELAR NAO E APAGAR
-- ---------------------------------------------------------------------------
-- `agenda_cancelar` muda `status` para 'cancelada' e a linha continua
-- existindo. E por isso que nao existe `agenda.excluir` no catalogo: o DELETE
-- de verdade e do profissional, sob `atendimento.registrar`, para corrigir um
-- registro criado por engano.
--
-- ---------------------------------------------------------------------------
-- POR QUE NAO RODAR ISTO AGORA
-- ---------------------------------------------------------------------------
-- Estas funcoes JA FUNCIONARIAM hoje: sao DEFINER, entao ignoram RLS, e
-- `organizacao_do_auth()` ja devolve o uuid certo desde a Etapa 2. E
-- exatamente por isso que nao devem ser aplicadas ainda — aplica-las daria a
-- Recepcao acesso operacional a agenda ANTES da Etapa 4, que e uma mudanca de
-- comportamento do produto, e nao parte do diagnostico.
--
-- Elas entram na subetapa da Agenda, junto com a troca do predicado das quatro
-- policies de consultas.
-- ===========================================================================


-- ===========================================================================
-- 1) LER — a agenda sem o prontuario
-- ---------------------------------------------------------------------------
-- As doze colunas aprovadas, e nenhuma a mais. `paciente_nome` nao existe em
-- consultas: vem do join, porque uma agenda sem nome nao serve para nada e a
-- Recepcao ja pode ver o cadastro (clientes.visualizar).
--
-- `retorno_sugerido` ENTRA, e foi reconferido: e coluna `date`, estruturalmente
-- incapaz de guardar narrativa. E o dado que a Recepcao usa para marcar o
-- proximo atendimento — tira-lo obrigaria a perguntar ao profissional a cada
-- marcacao. A inferencia que ele permite (voltar em 7 ou em 90 dias) ja esta
-- disponivel para quem ve o calendario.
-- ===========================================================================
create or replace function public.agenda_listar(
  p_de       date,
  p_ate      date,
  p_paciente uuid default null
)
returns table (
  id               uuid,
  paciente_id      uuid,
  paciente_nome    text,
  data_hora        timestamptz,
  duracao_min      integer,
  status           text,
  tipo             text,
  modalidade       text,
  retorno_sugerido date,
  iniciada_em      timestamptz,
  finalizada_em    timestamptz,
  criado_por       uuid
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
begin
  -- exige_permissao faz os tres de uma vez e levanta excecao em qualquer um:
  -- sessao (auth.uid() nao nulo), organizacao (nao bloqueado, org ativa) e
  -- permissao. Nao ha caminho que chegue no `return query` sem passar por ela.
  v_org := public.exige_permissao('agenda.visualizar');

  if p_ate < p_de then
    raise exception 'agenda_periodo_invertido';
  end if;

  return query
    select c.id, c.paciente_id, p.nome,
           c.data_hora, c.duracao_min, c.status, c.tipo, c.modalidade,
           c.retorno_sugerido, c.iniciada_em, c.finalizada_em, c.criado_por
      from public.consultas c
      join public.pacientes p on p.id = c.paciente_id
     where c.nutri_id = v_org
       and (p_paciente is null or c.paciente_id = p_paciente)
       -- `< p_ate + 1` e nao `<= p_ate`: data_hora e timestamptz, e `<= data`
       -- perderia tudo o que acontece depois da meia-noite do ultimo dia.
       and c.data_hora >= p_de::timestamptz
       and c.data_hora <  (p_ate + 1)::timestamptz
     order by c.data_hora;
end $fn$;


-- ===========================================================================
-- 2) AGENDAR
-- ---------------------------------------------------------------------------
-- `nutri_id` e gravado EXPLICITAMENTE com a organizacao. A coluna tem
-- `default auth.uid()`, e confiar no default aqui gravaria o uuid da
-- recepcionista — que nao e dono de nada. A consulta nasceria orfa, invisivel
-- para todo mundo, inclusive para quem a marcou.
--
-- `criado_por` continua vindo de auth.uid(), e ai esta certo: dono e a
-- organizacao, autor e a pessoa.
-- ===========================================================================
create or replace function public.agenda_agendar(
  p_paciente    uuid,
  p_data_hora   timestamptz,
  p_duracao_min integer default null,
  p_tipo        text    default 'retorno',
  p_modalidade  text    default 'presencial'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_id  uuid;
begin
  v_org := public.exige_permissao('agenda.criar');

  -- O paciente precisa ser DA ORGANIZACAO. Sem esta guarda bastaria mandar o
  -- uuid de um paciente de outra clinica para criar consulta no calendario
  -- alheio — a funcao e definer, entao nenhuma policy a impediria.
  if not exists (select 1 from public.pacientes p
                  where p.id = p_paciente and p.nutri_id = v_org) then
    raise exception 'agenda_paciente_de_outra_organizacao';
  end if;

  if p_data_hora is null then
    raise exception 'agenda_sem_data';
  end if;

  insert into public.consultas
    (nutri_id, paciente_id, data_hora, duracao_min, tipo, modalidade, status, criado_por)
  values
    (v_org, p_paciente, p_data_hora, p_duracao_min,
     coalesce(p_tipo, 'retorno'), coalesce(p_modalidade, 'presencial'),
     'agendada', auth.uid())
  returning id into v_id;

  return v_id;
end $fn$;


-- ===========================================================================
-- 3) REMARCAR
-- ---------------------------------------------------------------------------
-- So as colunas de agendamento. `coalesce(p_x, c.x)` deixa remarcar so a hora
-- sem ter de reenviar duracao e modalidade — parametro nulo significa "nao
-- mexe", e nao "apaga".
--
-- Consulta FINALIZADA nao entra: e registro de atendimento, historico clinico.
-- E a mesma regra que a policy consultas_update ja aplica hoje.
-- ===========================================================================
create or replace function public.agenda_remarcar(
  p_id          uuid,
  p_data_hora   timestamptz default null,
  p_duracao_min integer     default null,
  p_modalidade  text        default null,
  p_tipo        text        default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_org    uuid;
  v_status text;
begin
  v_org := public.exige_permissao('agenda.editar');

  select c.status into v_status
    from public.consultas c where c.id = p_id and c.nutri_id = v_org;

  if v_status is null then
    raise exception 'agenda_consulta_nao_encontrada';
  end if;
  if v_status = 'finalizada' then
    raise exception 'agenda_consulta_finalizada';
  end if;

  update public.consultas c
     set data_hora     = coalesce(p_data_hora,   c.data_hora),
         duracao_min   = coalesce(p_duracao_min, c.duracao_min),
         modalidade    = coalesce(p_modalidade,  c.modalidade),
         tipo          = coalesce(p_tipo,        c.tipo),
         atualizado_em = now()
   where c.id = p_id and c.nutri_id = v_org;
end $fn$;


-- ===========================================================================
-- 4) CANCELAR
-- ---------------------------------------------------------------------------
-- Muda o status. A linha fica — quem marcou, para quem e quando continua
-- registrado, e e isso que faz o cancelamento ser auditavel.
-- ===========================================================================
create or replace function public.agenda_cancelar(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_org    uuid;
  v_status text;
begin
  v_org := public.exige_permissao('agenda.editar');

  select c.status into v_status
    from public.consultas c where c.id = p_id and c.nutri_id = v_org;

  if v_status is null then
    raise exception 'agenda_consulta_nao_encontrada';
  end if;
  if v_status = 'finalizada' then
    raise exception 'agenda_consulta_finalizada';
  end if;
  if v_status = 'cancelada' then
    return;   -- idempotente: cancelar duas vezes nao e erro
  end if;

  update public.consultas c
     set status = 'cancelada', atualizado_em = now()
   where c.id = p_id and c.nutri_id = v_org;
end $fn$;


-- ===========================================================================
-- 5) ACL
-- ---------------------------------------------------------------------------
-- `anon` nao executa nada: sem sessao, exige_permissao ja levantaria excecao,
-- mas o grant e a primeira porta e ela nao deve nem existir.
-- ===========================================================================
revoke all on function public.agenda_listar(date, date, uuid)                         from public, anon;
revoke all on function public.agenda_agendar(uuid, timestamptz, integer, text, text)  from public, anon;
revoke all on function public.agenda_remarcar(uuid, timestamptz, integer, text, text) from public, anon;
revoke all on function public.agenda_cancelar(uuid)                                   from public, anon;

grant execute on function public.agenda_listar(date, date, uuid)                         to authenticated;
grant execute on function public.agenda_agendar(uuid, timestamptz, integer, text, text)  to authenticated;
grant execute on function public.agenda_remarcar(uuid, timestamptz, integer, text, text) to authenticated;
grant execute on function public.agenda_cancelar(uuid)                                   to authenticated;


-- ===========================================================================
-- Conferencia: as quatro existem, definer, com search_path, e sem anon.
-- ===========================================================================
select
  p.proname,
  p.prosecdef                                                  as definer,
  coalesce(array_to_string(p.proconfig, ','), 'SEM search_path') as configuracao,
  has_function_privilege('authenticated', p.oid, 'execute')     as authenticated,
  has_function_privilege('anon',          p.oid, 'execute')     as anon
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'agenda!_%' escape '!'
order by p.proname;
