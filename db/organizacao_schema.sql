-- ===========================================================================
-- Evollo · ETAPA 2 — FUNDACAO MULTIUSUARIO
-- ---------------------------------------------------------------------------
-- Cria a fundacao e NADA ALEM DELA. Ao terminar este script o sistema
-- funciona exatamente como antes: as 136 policies antigas continuam com
-- `nutri_id = auth.uid()`, nenhum modulo usa organizacao_do_auth() ainda,
-- nenhum arquivo de Storage se move, nenhum nutri_id muda de valor.
--
-- A troca de predicado, modulo a modulo, e a Etapa 4.
--
-- ===========================================================================
-- A ESTRATEGIA, EM UMA FRASE
-- ---------------------------------------------------------------------------
-- A organizacao inicial nasce com `id` igual ao auth.uid() do proprietario
-- atual. Como todo `nutri_id` ja gravado vale esse mesmo uuid, e como o
-- primeiro segmento do caminho de todo arquivo no Storage tambem e ele, a
-- fundacao entra sem UPDATE em 41 tabelas e sem mover um arquivo.
--
-- ISSO E ESTRATEGIA DE MIGRACAO, NAO REGRA DE NEGOCIO. Nao existe constraint
-- exigindo `id = proprietario_user_id`, e nao deve existir: organizacao nova
-- criada daqui para a frente usa gen_random_uuid() normalmente.
--
-- Desfazer: db/organizacao_schema_desfazer.sql
-- Conferir: db/conferencia/71_organizacao_fundacao.sql
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================


-- ===========================================================================
-- 1) TABELAS
-- ===========================================================================

create table if not exists public.organizacoes (
  id                   uuid primary key default gen_random_uuid(),
  nome                 text not null,
  ativo                boolean not null default true,
  proprietario_user_id uuid not null references auth.users(id) on delete restrict,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now()
);

-- `on delete restrict` no proprietario, e nao cascade: apagar a conta nao pode
-- levar a organizacao junto. Tem um efeito colateral desejado — como
-- nutricionistas.id tem `on delete cascade` de auth.users, e pacientes cascateia
-- de nutricionistas, o restrict daqui passa a BLOQUEAR a exclusao da conta
-- enquanto a organizacao existir. Hoje essa exclusao levaria os pacientes.


create table if not exists public.perfis (
  id            uuid primary key default gen_random_uuid(),
  -- NULL = perfil padrao do sistema, vale para todas as organizacoes.
  -- Preenchido = perfil personalizado daquela organizacao (Etapa 3+).
  organizacao_id uuid references public.organizacoes(id) on delete cascade,
  chave         text not null,
  nome          text not null,
  descricao     text,
  protegido     boolean not null default false,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Unique sobre EXPRESSAO, e nao `unique (organizacao_id, chave)`: em unique
-- comum, NULL nunca colide com NULL, entao daria para criar dois perfis padrao
-- com a mesma chave e a fundacao ficaria com dois "proprietario".
create unique index if not exists uq_perfis_org_chave
  on public.perfis (coalesce(organizacao_id, '00000000-0000-0000-0000-000000000000'::uuid), chave);


create table if not exists public.permissoes (
  chave     text primary key,
  modulo    text not null,
  acao      text not null,
  descricao text not null,
  -- METADADO para a UI destacar o que é clinico ou financeiro. NAO substitui
  -- permissao: quem decide acesso e a chave, nunca este booleano.
  sensivel  boolean not null default false,
  ordem     integer not null default 0
);


create table if not exists public.perfil_permissoes (
  perfil_id       uuid not null references public.perfis(id) on delete cascade,
  permissao_chave text not null references public.permissoes(chave) on delete cascade,
  primary key (perfil_id, permissao_chave)
);


create table if not exists public.organizacao_usuarios (
  id               uuid primary key default gen_random_uuid(),
  organizacao_id   uuid not null references public.organizacoes(id) on delete cascade,
  auth_user_id     uuid not null references auth.users(id) on delete cascade,
  nome             text not null,
  perfil_id        uuid not null references public.perfis(id) on delete restrict,
  status           text not null default 'ativo',
  -- Usuario NAO precisa ser funcionario, e funcionario NAO precisa ter login.
  funcionario_id   uuid references public.funcionarios(id) on delete set null,
  ultimo_acesso_em timestamptz,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

alter table public.organizacao_usuarios drop constraint if exists organizacao_usuarios_status_check;
alter table public.organizacao_usuarios add  constraint organizacao_usuarios_status_check
  check (status in ('ativo', 'bloqueado'));

-- Estrutural: a mesma pessoa nao entra duas vezes na mesma organizacao.
create unique index if not exists uq_org_usuario_por_org
  on public.organizacao_usuarios (organizacao_id, auth_user_id);

-- POLITICA ATUAL, nao verdade estrutural: um usuario pertence a uma unica
-- organizacao. E o que permite organizacao_do_auth() devolver um uuid sem
-- contexto de sessao.
-- Remover esta constraint futuramente caso seja introduzido contexto de
-- organizacao ativa.
create unique index if not exists uq_org_usuario_unico
  on public.organizacao_usuarios (auth_user_id);


create table if not exists public.usuario_permissoes (
  usuario_id      uuid not null references public.organizacao_usuarios(id) on delete cascade,
  permissao_chave text not null references public.permissoes(chave) on delete cascade,
  -- true = concede alem do perfil. false = revoga o que o perfil dava.
  concede         boolean not null,
  primary key (usuario_id, permissao_chave)
);


-- atualizado_em: reaproveita public.set_atualizado_em(), ja versionada em
-- db/foods_schema.sql. Nao e recriada aqui — duas definicoes para a mesma
-- funcao significam que a ultima a rodar vence, em silencio.
drop trigger if exists trg_organizacoes_atualizado on public.organizacoes;
create trigger trg_organizacoes_atualizado
  before update on public.organizacoes
  for each row execute function public.set_atualizado_em();

drop trigger if exists trg_perfis_atualizado on public.perfis;
create trigger trg_perfis_atualizado
  before update on public.perfis
  for each row execute function public.set_atualizado_em();

drop trigger if exists trg_organizacao_usuarios_atualizado on public.organizacao_usuarios;
create trigger trg_organizacao_usuarios_atualizado
  before update on public.organizacao_usuarios
  for each row execute function public.set_atualizado_em();


-- ===========================================================================
-- 2) CATALOGO DE PERMISSOES
-- ---------------------------------------------------------------------------
-- Derivado dos modulos REAIS do painel. Os quatro itens `disabled` da barra
-- lateral (agendamentos, evolucao, ia, materiais) ficam de fora: permissao
-- para modulo que nao existe e catalogo inflado sem nada para autorizar.
--
-- Duas separacoes carregam decisao de produto:
--   cadastro do cliente  x  dado clinico   (recepcao ve nome e telefone,
--                                           nao ve anamnese)
--   comercial/cobranca   x  financeiro     (recepcao registra mensalidade,
--                                           nao ve fluxo de caixa)
-- ===========================================================================

insert into public.permissoes (chave, modulo, acao, descricao, sensivel, ordem) values
  ('clientes.visualizar',   'clientes',    'visualizar', 'Ver a lista e a ficha cadastral dos clientes',        false, 10),
  ('clientes.criar',        'clientes',    'criar',      'Cadastrar cliente novo',                              false, 11),
  ('clientes.editar',       'clientes',    'editar',     'Editar dados cadastrais e de contato',                false, 12),
  ('anamnese.visualizar',   'clinico',     'visualizar', 'Ver as respostas do questionario de anamnese',        true,  20),
  ('avaliacoes.visualizar', 'clinico',     'visualizar', 'Ver avaliacoes fisicas e composicao corporal',        true,  21),
  ('avaliacoes.editar',     'clinico',     'editar',     'Lancar e corrigir avaliacoes',                        true,  22),
  ('alimentacao.visualizar','alimentacao', 'visualizar', 'Ver o plano alimentar do cliente',                    true,  30),
  ('alimentacao.editar',    'alimentacao', 'editar',     'Montar e alterar o plano alimentar',                  true,  31),
  ('alimentos.visualizar',  'alimentos',   'visualizar', 'Consultar o banco de alimentos',                      false, 40),
  ('alimentos.editar',      'alimentos',   'editar',     'Manter o catalogo proprio de alimentos e receitas',   false, 41),
  ('treinos.visualizar',    'treinos',     'visualizar', 'Ver os treinos do cliente',                           false, 50),
  ('treinos.editar',        'treinos',     'editar',     'Montar treino e gerenciar a rotina do cliente',       false, 51),
  ('exercicios.visualizar', 'exercicios',  'visualizar', 'Consultar a biblioteca de exercicios',                false, 60),
  ('exercicios.editar',     'exercicios',  'editar',     'Manter a biblioteca de exercicios',                   false, 61),
  ('checkins.visualizar',   'checkins',    'visualizar', 'Ver respostas de check-in dos clientes',              true,  70),
  ('checkins.gerenciar',    'checkins',    'gerenciar',  'Criar modelos, atribuir e encerrar check-ins',        true,  71),
  ('documentos.visualizar', 'documentos',  'visualizar', 'Ver documentos do prontuario do cliente',             true,  80),
  ('documentos.enviar',     'documentos',  'enviar',     'Enviar documento e disponibilizar para o cliente',    true,  81),
  ('comercial.visualizar',  'comercial',   'visualizar', 'Ver assinaturas, planos e cobrancas dos clientes',    false, 90),
  ('comercial.editar',      'comercial',   'editar',     'Contratar, renovar e registrar pagamento de cliente', false, 91),
  ('financeiro.visualizar', 'financeiro',  'visualizar', 'Ver receitas, despesas e fluxo de caixa da empresa',  true, 100),
  ('financeiro.lancar',     'financeiro',  'lancar',     'Lancar receita e despesa da empresa',                 true, 101),
  ('financeiro.editar',     'financeiro',  'editar',     'Corrigir e excluir lancamento ja registrado',         true, 102),
  ('equipe.visualizar',     'equipe',      'visualizar', 'Ver o cadastro de colaboradores',                     false, 110),
  ('equipe.folha',          'equipe',      'folha',      'Ver e fechar folha de pagamento e contracheques',     true, 111),
  ('usuarios.visualizar',   'usuarios',    'visualizar', 'Ver quem tem acesso ao painel',                       false, 120),
  ('usuarios.gerenciar',    'usuarios',    'gerenciar',  'Criar acesso, trocar perfil, bloquear e reativar',    true, 121),
  -- AGENDA e ATENDIMENTO vivem na MESMA tabela, public.consultas: a linha tem o
  -- horario e, nas mesmas colunas, o relato, a conduta e as orientacoes. RLS
  -- protege LINHA, nao COLUNA — um `select` autorizado entrega as duas coisas.
  -- Por isso sao duas chaves: `agenda.*` governa a superficie operacional (as
  -- RPCs definer, que devolvem so as colunas de agendamento) e `atendimento.*`
  -- governa o acesso direto a linha inteira. Sem essa separacao, deixar a
  -- Recepcao marcar consulta custaria o prontuario junto.
  --
  -- Nao existe `agenda.excluir` de proposito: a Recepcao CANCELA — a RPC muda
  -- `status` para 'cancelada' e a linha continua existindo. O DELETE real e do
  -- profissional, sob `atendimento.registrar`.
  ('atendimento.visualizar','clinico',     'visualizar', 'Ver o registro clinico da consulta: relato, conduta e orientacoes', true, 23),
  ('atendimento.registrar', 'clinico',     'registrar',  'Escrever o atendimento e finalizar a consulta',       true,  24),
  ('agenda.visualizar',     'agenda',      'visualizar', 'Ver a agenda de atendimentos, sem o conteudo clinico', false, 130),
  ('agenda.criar',          'agenda',      'criar',      'Marcar atendimento',                                 false, 131),
  ('agenda.editar',         'agenda',      'editar',     'Remarcar e cancelar atendimento',                    false, 132),
  -- TIMELINE e sensivel porque AGREGA os outros modulos: ler a linha do tempo e
  -- ler resumo de avaliacao, de plano alimentar e de documento. E uma janela
  -- para o prontuario, nao um mural.
  ('timeline.visualizar',   'timeline',    'visualizar', 'Ver a linha do tempo, as metas e as tarefas do cliente', true, 140),
  ('timeline.gerenciar',    'timeline',    'gerenciar',  'Criar e editar anotacao, meta e tarefa do cliente',   true,  141)
on conflict (chave) do nothing;


-- ===========================================================================
-- 3) PERFIS PADRAO
-- ---------------------------------------------------------------------------
-- organizacao_id NULL = valem para todas as organizacoes.
-- protegido = true    = a UI nao deixa apagar (Etapa 3).
--
-- O perfil e um PACOTE. A autorizacao real nunca le o nome dele: tem_permissao()
-- nao conhece as palavras "proprietario" ou "recepcao", so calcula.
-- ===========================================================================

insert into public.perfis (organizacao_id, chave, nome, descricao, protegido) values
  (null, 'proprietario',  'Proprietário',  'Acesso total, incluindo usuarios e folha',        true),
  (null, 'administrador', 'Administrador', 'Acesso operacional amplo, sem usuarios nem folha', true),
  (null, 'nutricionista', 'Nutricionista', 'Atendimento clinico e nutricional',                true),
  (null, 'treinador',     'Treinador',     'Treinos e acompanhamento de execucao',             true),
  (null, 'recepcao',      'Recepção',      'Cadastro, contato e cobranca, sem dado clinico',   true),
  (null, 'financeiro',    'Financeiro',    'Financeiro da empresa e cobranca de clientes',     true)
on conflict do nothing;


-- ===========================================================================
-- 4) PACOTES: perfil -> permissoes
-- ---------------------------------------------------------------------------
-- Os vinculos vivem em DADOS, nao em if/else de funcao. Trocar o que a
-- Recepcao pode fazer e um insert/delete aqui, sem tocar em codigo.
-- ===========================================================================

-- PROPRIETARIO: todas as permissoes existentes. Sem atalho na funcao — o motor
-- e o mesmo para todo mundo, e por isso nao ha caminho privilegiado para
-- alguem entrar sem passar pelo calculo.
insert into public.perfil_permissoes (perfil_id, permissao_chave)
select p.id, pm.chave
  from public.perfis p cross join public.permissoes pm
 where p.organizacao_id is null and p.chave = 'proprietario'
on conflict do nothing;

insert into public.perfil_permissoes (perfil_id, permissao_chave)
select p.id, pm.chave
  from public.perfis p cross join public.permissoes pm
 where p.organizacao_id is null and p.chave = 'administrador'
   and pm.chave not in ('usuarios.gerenciar', 'equipe.folha')
on conflict do nothing;

insert into public.perfil_permissoes (perfil_id, permissao_chave)
select p.id, pm.chave
  from public.perfis p cross join public.permissoes pm
 where p.organizacao_id is null and p.chave = 'nutricionista'
   and pm.chave in ('clientes.visualizar','clientes.criar','clientes.editar',
                    'anamnese.visualizar','avaliacoes.visualizar','avaliacoes.editar',
                    'alimentacao.visualizar','alimentacao.editar',
                    'alimentos.visualizar','alimentos.editar',
                    'treinos.visualizar',
                    'checkins.visualizar','checkins.gerenciar',
                    'documentos.visualizar','documentos.enviar',
                    -- Agenda e atendimento inteiros: ele marca, atende, escreve
                    -- a conduta e finaliza. `timeline.gerenciar` entra porque as
                    -- operacoes que ela governa SAO atuacao clinica — criar meta,
                    -- abrir tarefa de acompanhamento, anotar na linha do tempo —
                    -- e nao trabalho administrativo.
                    'agenda.visualizar','agenda.criar','agenda.editar',
                    'atendimento.visualizar','atendimento.registrar',
                    'timeline.visualizar','timeline.gerenciar')
on conflict do nothing;

insert into public.perfil_permissoes (perfil_id, permissao_chave)
select p.id, pm.chave
  from public.perfis p cross join public.permissoes pm
 where p.organizacao_id is null and p.chave = 'treinador'
   and pm.chave in ('clientes.visualizar',
                    'treinos.visualizar','treinos.editar',
                    'exercicios.visualizar','exercicios.editar',
                    'checkins.visualizar')
on conflict do nothing;

-- RECEPCAO: cadastro, contato, agenda comercial e cobranca. NENHUM dado
-- clinico — nem anamnese, nem avaliacao, nem plano alimentar, nem documento.
-- E o §25 da Etapa 1: `clientes.visualizar` nao arrasta o prontuario.
insert into public.perfil_permissoes (perfil_id, permissao_chave)
select p.id, pm.chave
  from public.perfis p cross join public.permissoes pm
 where p.organizacao_id is null and p.chave = 'recepcao'
   and pm.chave in ('clientes.visualizar','clientes.criar','clientes.editar',
                    'comercial.visualizar','comercial.editar',
                    -- As tres de agenda, e SO as tres. Sem atendimento.*, sem
                    -- timeline.*. E o recorte que a superficie operacional torna
                    -- possivel: antes dela, deixar a Recepcao marcar consulta
                    -- custava o prontuario, porque a policy de SELECT em
                    -- public.consultas entrega a linha inteira.
                    'agenda.visualizar','agenda.criar','agenda.editar')
on conflict do nothing;

-- FINANCEIRO: dinheiro da empresa, e LEITURA do comercial. Ve o cliente porque
-- precisa saber de quem e a cobranca; nao ve o prontuario dele.
--
-- MENOR PRIVILEGIO, e a ausencia de duas chaves aqui e deliberada:
--
--   comercial.editar   nao entra. "Registrar pagamento de mensalidade" nao
--                      pode custar o direito de contratar, renovar e cancelar
--                      assinatura — que e o que essa chave libera hoje. Se o
--                      Financeiro precisar receber pagamento, o certo e uma
--                      chave propria (comercial.registrar_pagamento), nao
--                      alargar esta.
--   equipe.visualizar  nao entra por "pode ser que um dia mexa com folha".
--                      Permissao concedida por hipotese e permissao que
--                      ninguem revoga depois.
insert into public.perfil_permissoes (perfil_id, permissao_chave)
select p.id, pm.chave
  from public.perfis p cross join public.permissoes pm
 where p.organizacao_id is null and p.chave = 'financeiro'
   and pm.chave in ('clientes.visualizar',
                    'comercial.visualizar',
                    'financeiro.visualizar','financeiro.lancar','financeiro.editar')
on conflict do nothing;


-- ===========================================================================
-- 5) FUNCOES
-- ===========================================================================

-- Resolve auth.uid() -> organizacao. Devolve NULL para usuario bloqueado ou
-- organizacao inativa: quem chama trata NULL como "sem acesso".
--
-- SECURITY DEFINER e o que impede a recursao: a policy de leitura de
-- organizacao_usuarios chama esta funcao, e esta funcao le
-- organizacao_usuarios. Rodando como dona da tabela, ela nao passa pela RLS.
-- E POR ISSO QUE ESTAS TABELAS NAO PODEM RECEBER `force row level security` —
-- com force, ate a dona cai na policy e o par vira laco infinito.
create or replace function public.organizacao_do_auth()
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select ou.organizacao_id
    from public.organizacao_usuarios ou
    join public.organizacoes o on o.id = ou.organizacao_id
   where ou.auth_user_id = auth.uid()
     and ou.status = 'ativo'
     and o.ativo
   limit 1;
$fn$;


-- Permissao efetiva. A ordem e a regra, e ela e DENY BY DEFAULT:
--   1. excecao individual do usuario, se existir  -> vale o `concede`
--   2. senao, o pacote do perfil                  -> concedido se houver linha
--   3. senao                                       -> false
--
-- Nao ha ramo por nome de perfil. O Proprietario passa aqui como todo mundo,
-- e so e onipotente porque tem todas as linhas em perfil_permissoes.
create or replace function public.tem_permissao(p_chave text)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  with eu as (
    select ou.id, ou.perfil_id
      from public.organizacao_usuarios ou
      join public.organizacoes o on o.id = ou.organizacao_id
     where ou.auth_user_id = auth.uid()
       and ou.status = 'ativo'
       and o.ativo
     limit 1
  )
  select coalesce(
    (select up.concede
       from public.usuario_permissoes up join eu on up.usuario_id = eu.id
      where up.permissao_chave = p_chave),
    (select true
       from public.perfil_permissoes pp join eu on pp.perfil_id = eu.perfil_id
      where pp.permissao_chave = p_chave),
    false
  );
$fn$;


-- O conjunto efetivo, para o frontend pedir UMA vez por sessao e montar menu e
-- rotas (Etapa 3). Devolve so o que esta CONCEDIDO: permissao revogada por
-- excecao simplesmente nao aparece.
create or replace function public.minhas_permissoes()
returns setof text
language sql
stable
security definer
set search_path = public
as $fn$
  with eu as (
    select ou.id, ou.perfil_id
      from public.organizacao_usuarios ou
      join public.organizacoes o on o.id = ou.organizacao_id
     where ou.auth_user_id = auth.uid()
       and ou.status = 'ativo'
       and o.ativo
     limit 1
  ),
  do_perfil as (
    select pp.permissao_chave as chave
      from public.perfil_permissoes pp join eu on pp.perfil_id = eu.perfil_id
  ),
  excecoes as (
    select up.permissao_chave as chave, up.concede
      from public.usuario_permissoes up join eu on up.usuario_id = eu.id
  )
  select chave from (
    select chave from do_perfil where chave not in (select chave from excecoes)
    union
    select chave from excecoes where concede
  ) efetivas
  order by chave;
$fn$;


-- ===========================================================================
-- 6) ACL — explicita, sem depender de default privileges
-- ---------------------------------------------------------------------------
-- Mesmo padrao do hardening de Documentos e Check-ins.
-- ===========================================================================

revoke all on function public.organizacao_do_auth()   from public, anon;
revoke all on function public.tem_permissao(text)     from public, anon;
revoke all on function public.minhas_permissoes()     from public, anon;

grant execute on function public.organizacao_do_auth() to authenticated;
grant execute on function public.tem_permissao(text)   to authenticated;
grant execute on function public.minhas_permissoes()   to authenticated;


-- ===========================================================================
-- 7) RLS DAS TABELAS NOVAS
-- ---------------------------------------------------------------------------
-- Leitura escopada pela organizacao. NENHUMA policy de escrita: criar usuario,
-- trocar perfil e conceder permissao sao operacoes sensiveis e vao passar por
-- RPC controlada na Etapa 3. Sem policy de escrita, o frontend nao consegue
-- INSERT/UPDATE/DELETE nestas tabelas nem tentando.
--
-- NAO usar `force row level security` aqui — ver a nota em organizacao_do_auth().
-- ===========================================================================

alter table public.organizacoes         enable row level security;
alter table public.perfis               enable row level security;
alter table public.permissoes           enable row level security;
alter table public.perfil_permissoes    enable row level security;
alter table public.organizacao_usuarios enable row level security;
alter table public.usuario_permissoes   enable row level security;

drop policy if exists org_select_propria on public.organizacoes;
create policy org_select_propria on public.organizacoes
  for select to authenticated
  using (id = public.organizacao_do_auth());

drop policy if exists org_usuarios_select_propria on public.organizacao_usuarios;
create policy org_usuarios_select_propria on public.organizacao_usuarios
  for select to authenticated
  using (organizacao_id = public.organizacao_do_auth());

-- Perfis padrao (organizacao_id null) sao visiveis para todos: sao catalogo.
drop policy if exists perfis_select_visiveis on public.perfis;
create policy perfis_select_visiveis on public.perfis
  for select to authenticated
  using (organizacao_id is null or organizacao_id = public.organizacao_do_auth());

-- Catalogo de permissoes: texto de interface, igual para todo mundo. Nao ha o
-- que isolar aqui, e esconder o catalogo nao esconde nada de util.
drop policy if exists permissoes_select_catalogo on public.permissoes;
create policy permissoes_select_catalogo on public.permissoes
  for select to authenticated
  using (true);

-- perfil_permissoes e usuario_permissoes ficam com RLS ativa e ZERO policies,
-- como codigos_convite: nenhum papel alcanca pela API, so as funcoes DEFINER.


-- ===========================================================================
-- 8) BOOTSTRAP DO PROPRIETARIO
-- ---------------------------------------------------------------------------
-- Descobre o proprietario a partir do ESTADO, sem uuid escrito aqui:
--
--     nutricionistas  JOIN  admins  JOIN  auth.users
--
-- e exige que de EXATAMENTE UM. Zero ou mais de um aborta com a lista dos
-- candidatos. Escolher sozinho seria criar a organizacao errada — e uma
-- organizacao errada so aparece depois que 41 tabelas ja dependem dela.
--
-- Idempotente: reaplicar nao cria segunda organizacao nem segundo vinculo.
-- ===========================================================================

do $$
declare
  v_qtd       integer;
  v_owner     uuid;
  v_nome      text;
  v_email     text;
  v_lista     text;
  v_perfil    uuid;
begin
  select count(*) into v_qtd
    from public.nutricionistas n
    join public.admins a on a.user_id = n.id
    join auth.users u    on u.id = n.id;

  if v_qtd = 0 then
    raise exception
      'ETAPA 2 ABORTADA: nenhum nutricionista consta em public.admins. Sem sinal para identificar o proprietario, e este script nao escolhe sozinho.';
  end if;

  if v_qtd > 1 then
    select string_agg(u.email || ' (' || n.id::text || ')', ' | ' order by u.email)
      into v_lista
      from public.nutricionistas n
      join public.admins a on a.user_id = n.id
      join auth.users u    on u.id = n.id;
    raise exception
      'ETAPA 2 ABORTADA: % candidatos a proprietario em admins: %. Decida qual e o dono antes de rodar.', v_qtd, v_lista;
  end if;

  select n.id, nullif(btrim(n.nome), ''), u.email
    into v_owner, v_nome, v_email
    from public.nutricionistas n
    join public.admins a on a.user_id = n.id
    join auth.users u    on u.id = n.id;

  -- Nome derivado do estado, nunca inventado: o nome do profissional; na falta
  -- dele, o email da conta. Os dois sao deterministicos.
  v_nome := coalesce(v_nome, v_email);

  -- id = auth.uid() do proprietario: e a estrategia inteira. Ver o cabecalho.
  insert into public.organizacoes (id, nome, proprietario_user_id)
  values (v_owner, v_nome, v_owner)
  on conflict (id) do nothing;

  select id into v_perfil
    from public.perfis
   where organizacao_id is null and chave = 'proprietario';

  if v_perfil is null then
    raise exception 'ETAPA 2 ABORTADA: perfil padrao "proprietario" nao foi semeado.';
  end if;

  insert into public.organizacao_usuarios (organizacao_id, auth_user_id, nome, perfil_id, status)
  values (v_owner, v_owner, v_nome, v_perfil, 'ativo')
  on conflict (auth_user_id) do nothing;

  raise notice 'Fundacao pronta. Organizacao % (%) com o proprietario %.', v_nome, v_owner, v_email;
end $$;
