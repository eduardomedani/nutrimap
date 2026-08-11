-- ===========================================================================
-- Evollo · CATALOGO DE PERMISSOES — Agenda, Atendimento e Timeline
-- ---------------------------------------------------------------------------
-- MIGRATION CORRETIVA. A Fundacao (db/organizacao_schema.sql) ja esta aplicada
-- em producao com 27 chaves; este arquivo acrescenta 7 e nao toca em nenhuma
-- das 27. 27 -> 34.
--
-- 100% re-executavel. Desfazer:
-- db/organizacao_permissoes_agenda_atendimento_timeline_desfazer.sql
--
-- db/organizacao_schema.sql foi atualizado com as mesmas 7 chaves e os mesmos
-- vinculos, para que uma instalacao limpa chegue ao mesmo estado final. Os
-- dois arquivos precisam continuar dizendo a mesma coisa — ha guarda em
-- test/organizacao-fundacao.test.mjs conferindo isso.
--
-- ===========================================================================
-- POR QUE SAO TRES MODULOS, E NAO UM
-- ---------------------------------------------------------------------------
-- AGENDA e ATENDIMENTO vivem na MESMA TABELA, public.consultas: a linha guarda
-- o horario e, nas mesmas colunas, o relato, a conduta, as orientacoes e o
-- resumo do que foi feito. RLS protege LINHA, nao COLUNA — entao um unico
-- `select` autorizado entrega as duas coisas de uma vez.
--
-- A consequencia pratica e direta: dar a Recepcao o direito de ver a agenda,
-- pela via de uma policy de SELECT, seria dar a ela o prontuario junto. Isso e
-- o oposto do que o catalogo inteiro existe para fazer — `clientes.visualizar`
-- deliberadamente nao arrasta anamnese, e a agenda nao pode ser a porta dos
-- fundos.
--
-- Por isso:
--
--   agenda.*        governa a SUPERFICIE OPERACIONAL — as RPCs definer, que
--                   devolvem so as colunas de agendamento. A Recepcao nao
--                   recebe policy nenhuma em public.consultas.
--
--   atendimento.*   governa o ACESSO DIRETO a linha, com tudo o que ela tem.
--                   E a chave clinica, e e ela que a policy de SELECT vai
--                   exigir na Etapa 4.
--
-- TIMELINE e separada por outro motivo: ela AGREGA eventos dos outros modulos.
-- Ler a timeline e ler resumo de avaliacao, de plano alimentar e de documento.
-- E uma janela para o prontuario, nao um mural — por isso `sensivel`.
--
-- ---------------------------------------------------------------------------
-- POR QUE NAO EXISTE agenda.excluir
-- ---------------------------------------------------------------------------
-- Porque nao ha decisao de negocio propria nela. A Recepcao CANCELA — a RPC
-- muda `status` para 'cancelada' e a linha continua existindo, que e o que o
-- historico exige. O DELETE de verdade continua sendo policy direta, sob
-- `atendimento.registrar`, para o profissional corrigir um registro criado por
-- engano. Chave para operacao que ninguem faz e catalogo inflado.
--
-- ===========================================================================
-- ONDE CADA CHAVE ENTRA NA ORDEM
-- ---------------------------------------------------------------------------
-- `ordem` e o que agrupa o catalogo na tela. atendimento.* entra em 23 e 24,
-- no meio do bloco clinico (anamnese 20, avaliacoes 21-22, alimentacao 30):
-- e clinico, e precisa aparecer junto do resto do clinico. agenda.* e
-- timeline.* entram no fim, depois de usuarios (120-121).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) AS SETE CHAVES
-- ---------------------------------------------------------------------------
insert into public.permissoes (chave, modulo, acao, descricao, sensivel, ordem) values
  ('atendimento.visualizar', 'clinico',     'visualizar', 'Ver o registro clinico da consulta: relato, conduta e orientacoes', true,  23),
  ('atendimento.registrar',  'clinico',     'registrar',  'Escrever o atendimento e finalizar a consulta',                      true,  24),
  ('agenda.visualizar',      'agenda',      'visualizar', 'Ver a agenda de atendimentos, sem o conteudo clinico',              false, 130),
  ('agenda.criar',           'agenda',      'criar',      'Marcar atendimento',                                                false, 131),
  ('agenda.editar',          'agenda',      'editar',     'Remarcar e cancelar atendimento',                                   false, 132),
  ('timeline.visualizar',    'timeline',    'visualizar', 'Ver a linha do tempo, as metas e as tarefas do cliente',            true,  140),
  ('timeline.gerenciar',     'timeline',    'gerenciar',  'Criar e editar anotacao, meta e tarefa do cliente',                 true,  141)
on conflict (chave) do nothing;


-- ---------------------------------------------------------------------------
-- 2) PROPRIETARIO E ADMINISTRADOR — o mesmo bloco da Fundacao, reexecutado
-- ---------------------------------------------------------------------------
-- Os dois pacotes sao `cross join public.permissoes`, entao reexecuta-los ja
-- concede o que for novo. E de proposito que sejam os MESMOS comandos da
-- Fundacao, e nao uma lista das 7: se um dia outra chave nascer e alguem
-- esquecer de vir aqui, este bloco continua correto sozinho.
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


-- ---------------------------------------------------------------------------
-- 3) NUTRICIONISTA — atende, registra e acompanha
-- ---------------------------------------------------------------------------
-- Recebe timeline.gerenciar porque as operacoes que ela governa SAO atuacao
-- clinica, e nao trabalho administrativo: criar meta, abrir tarefa de
-- acompanhamento e anotar na linha do tempo. Foi conferido no frontend — as
-- nove escritas existem e sao chamadas por js/timeline.js, js/paciente-metas.js
-- e js/paciente-tarefas.js, todas telas do profissional.
insert into public.perfil_permissoes (perfil_id, permissao_chave)
select p.id, pm.chave
  from public.perfis p cross join public.permissoes pm
 where p.organizacao_id is null and p.chave = 'nutricionista'
   and pm.chave in ('agenda.visualizar','agenda.criar','agenda.editar',
                    'atendimento.visualizar','atendimento.registrar',
                    'timeline.visualizar','timeline.gerenciar')
on conflict do nothing;


-- ---------------------------------------------------------------------------
-- 4) RECEPCAO — a agenda inteira, e nada do prontuario
-- ---------------------------------------------------------------------------
-- As tres de agenda, e SO as tres. Sem atendimento.*, sem timeline.*. E o
-- recorte que a superficie operacional torna possivel: antes dela, "deixar a
-- Recepcao marcar consulta" custava o prontuario.
insert into public.perfil_permissoes (perfil_id, permissao_chave)
select p.id, pm.chave
  from public.perfis p cross join public.permissoes pm
 where p.organizacao_id is null and p.chave = 'recepcao'
   and pm.chave in ('agenda.visualizar','agenda.criar','agenda.editar')
on conflict do nothing;


-- ---------------------------------------------------------------------------
-- 5) TREINADOR E FINANCEIRO — nenhuma das sete
-- ---------------------------------------------------------------------------
-- Nao ha insert aqui, e a ausencia e a decisao.
--
-- TREINADOR: a consulta e nutricional e a linha carrega conduta clinica; a
-- timeline agrega anamnese, avaliacao e dieta. Ele ja tem clientes.visualizar,
-- treinos.*, exercicios.* e checkins.visualizar — o que precisa para trabalhar.
-- No dia em que a agenda marcar sessao de treino, a decisao muda com um motivo
-- concreto; hoje seria acesso concedido por conveniencia.
--
-- FINANCEIRO: cuida do dinheiro da empresa. Nada na agenda nem na timeline lhe
-- diz respeito.


-- ===========================================================================
-- Conferencia. Esperado:
--   permissoes = 34 · novas = 7
--   proprietario = 34 · administrador = 32
--   nutricionista = 22 · recepcao = 8 · treinador = 6 · financeiro = 5
--   recepcao_com_clinico = 0
-- ===========================================================================
select
  (select count(*) from public.permissoes)                                       as permissoes,
  (select count(*) from public.permissoes
    where modulo in ('agenda','timeline') or chave like 'atendimento.%')          as novas,
  (select count(*) from public.perfil_permissoes pp join public.perfis p on p.id = pp.perfil_id
    where p.organizacao_id is null and p.chave = 'proprietario')                  as proprietario,
  (select count(*) from public.perfil_permissoes pp join public.perfis p on p.id = pp.perfil_id
    where p.organizacao_id is null and p.chave = 'administrador')                 as administrador,
  (select count(*) from public.perfil_permissoes pp join public.perfis p on p.id = pp.perfil_id
    where p.organizacao_id is null and p.chave = 'nutricionista')                 as nutricionista,
  (select count(*) from public.perfil_permissoes pp join public.perfis p on p.id = pp.perfil_id
    where p.organizacao_id is null and p.chave = 'recepcao')                      as recepcao,
  (select count(*) from public.perfil_permissoes pp join public.perfis p on p.id = pp.perfil_id
    where p.organizacao_id is null and p.chave = 'treinador')                     as treinador,
  (select count(*) from public.perfil_permissoes pp join public.perfis p on p.id = pp.perfil_id
    where p.organizacao_id is null and p.chave = 'financeiro')                    as financeiro,
  (select count(*) from public.perfil_permissoes pp join public.perfis p on p.id = pp.perfil_id
    where p.organizacao_id is null and p.chave = 'recepcao'
      and (pp.permissao_chave like 'atendimento.%' or pp.permissao_chave like 'timeline.%'))
                                                                                 as recepcao_com_clinico;
