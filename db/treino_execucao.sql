-- ===========================================================================
-- Evollo · EXECUÇÃO GUIADA DO TREINO (app do aluno)
-- ---------------------------------------------------------------------------
-- O app passa a CONDUZIR a sessão: ao concluir a série, ela é salva e o
-- cronômetro de descanso começa sozinho. Para isso o profissional precisa
-- prescrever três coisas que ainda não existiam no banco:
--
--   treinos.descanso_padrao            descanso do treino (fallback do item)
--   treino_exercicios.descanso_final   descanso após a ÚLTIMA série
--   treino_exercicios.rir_modo         'rir' | 'escala' | null (não perguntar)
--
-- O descanso ENTRE séries continua em treino_exercicios.descanso (já existia)
-- e a cadência continua em treino_exercicios.cadencia — cadência preenchida
-- é o próprio "ligado"; vazia, o aluno não vê nada sobre cadência.
--
-- Nada aqui altera o que já estava gravado: são 3 colunas novas, nullable,
-- sem default destrutivo. Os dados de execução (horário de cada série, RIR,
-- descanso gasto) vão dentro do jsonb treino_progressao.series_realizadas,
-- que a RPC rpc_paciente_salvar_series já grava verbatim — sem migração.
--
-- Formato de cada série no jsonb (chaves novas são opcionais):
--   { "peso": 60, "reps": 8,
--     "t": "2026-07-29T13:02:11.000Z",   -- horário da conclusão
--     "descanso": 90,                     -- segundos descansados após a série
--     "rir": 2,                           -- só na última série, se solicitado
--     "drop": { "peso": 48, "reps": 6 } } -- inalterado
--
-- 100% re-executável. Rodar no SQL Editor do Supabase.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) Descanso padrão do treino — usado quando o exercício não define o seu.
-- ---------------------------------------------------------------------------
alter table public.treinos
  add column if not exists descanso_padrao text;

comment on column public.treinos.descanso_padrao is
  'Descanso padrão entre séries (ex.: "60s", "90s"). Vale para os exercícios sem descanso próprio.';


-- ---------------------------------------------------------------------------
-- 2) Descanso após a última série + modo do RIR, por exercício.
-- ---------------------------------------------------------------------------
alter table public.treino_exercicios
  add column if not exists descanso_final text;

alter table public.treino_exercicios
  add column if not exists rir_modo text;

comment on column public.treino_exercicios.descanso_final is
  'Descanso após a ÚLTIMA série (ex.: "180s"). Vazio = usa o mesmo descanso das demais séries.';
comment on column public.treino_exercicios.rir_modo is
  'Como perguntar o esforço ao fim do exercício: "rir" (0..4 reps na reserva), "escala" (muito leve..falha) ou vazio (não perguntar).';

-- Só os três valores previstos (vazio = não perguntar).
alter table public.treino_exercicios drop constraint if exists treino_exercicios_rir_modo_check;
alter table public.treino_exercicios add constraint treino_exercicios_rir_modo_check
  check (rir_modo is null or rir_modo in ('rir', 'escala'));


-- ---------------------------------------------------------------------------
-- 3) Nada de novo em RLS: as colunas herdam as policies das tabelas donas
--    (treinos_owner / treino_exercicios_owner) e as de leitura do paciente.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- FIM
-- ===========================================================================
