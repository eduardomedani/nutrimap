-- ═══════════════════════════════════════════════════════════════════════════
-- SERVIÇOS CONTRATADOS POR CLIENTE — Alimentação, Treino, Academia
-- ═══════════════════════════════════════════════════════════════════════════
-- Pedido do Eduardo (10/11/2026): o app atende três tipos de contrato —
-- aluno da academia (treino + academia), cliente de nutricionista
-- (alimentação) e combinações. Cada cliente diz o que contratou, e o app do
-- aluno mostra só isso (o resto vira oferta discreta ou some).
--
-- Decisões:
--   * Marcação SÓ MANUAL, na ficha do cliente (Visão geral). Nada é marcado
--     sozinho por assinatura, dieta ou treino publicados.
--   * NULL = "ainda não definido": o app continua mostrando tudo, como hoje.
--     Assim nenhum aluno atual perde tela no dia em que isto entra.
--   * Quem altera: a política `pacientes_update` que JÁ existe (mesma
--     organização + `clientes.editar`). O aluno só lê a própria linha
--     (`pacientes_self_read`) e não tem política de escrita — não consegue se
--     dar um serviço.
--
-- O que muda: uma coluna nova, que aceita nulo, sem valor padrão — o
-- Postgres só registra a coluna, não reescreve a tabela — e uma regra que
-- só aceita os três nomes. Nenhum dado existente é alterado.
-- Reverter: db/paciente_servicos_desfazer.sql
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.pacientes add column if not exists servicos text[];

alter table public.pacientes drop constraint if exists pacientes_servicos_validos;
alter table public.pacientes add constraint pacientes_servicos_validos
  check (servicos is null or servicos <@ array['alimentacao', 'treino', 'academia']::text[]);

comment on column public.pacientes.servicos is
  'Serviços contratados (alimentacao, treino, academia). NULL = não definido: o app mostra tudo. Marcado à mão na ficha.';

-- Conferência (uma linha) — esperado: true | true | <total de clientes> | 0
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'pacientes' and column_name = 'servicos')   as coluna_criada,
  exists (select 1 from pg_constraint where conname = 'pacientes_servicos_validos')                   as regra_criada,
  (select count(*) from public.pacientes where servicos is null)                                      as clientes_sem_definir,
  (select count(*) from public.pacientes where servicos is not null)                                  as clientes_definidos;
