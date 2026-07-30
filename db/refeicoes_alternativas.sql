-- ===========================================================================
-- Evollo · REFEIÇÕES ALTERNATIVAS
-- ---------------------------------------------------------------------------
-- Uma refeição pode ter outras que a SUBSTITUEM por inteiro:
--
--   Café da manhã          substitui_refeicao_id = null   (principal)
--     Vitamina proteica    substitui_refeicao_id = <café> (alternativa)
--     Panqueca de aveia    substitui_refeicao_id = <café> (alternativa)
--
-- A alternativa continua sendo uma refeição normal: tem os próprios alimentos,
-- as próprias substituições por item e a própria observação. É só isso que a
-- coluna acrescenta — nenhuma tabela nova, nenhuma regra de cálculo mudou.
--
-- `instrucao` é o texto que o paciente lê ao escolher:
--   "Use esta opção quando estiver fora de casa."
--
-- on delete cascade: apagar a principal apaga as alternativas dela. Uma
-- alternativa órfã não significa nada — ela existe em função de outra refeição.
--
-- ADITIVO. Não altera nenhuma linha existente: toda refeição já gravada fica
-- com substitui_refeicao_id nulo, ou seja, principal — que é o que ela é.
--
-- RLS: nada a fazer. As policies de plano_refeicoes são por nutri_id e por
-- paciente (refeicoes_paciente_read), e valem para as colunas novas.
--
-- 100% re-executável. Rodar no SQL Editor do Supabase.
-- ===========================================================================

alter table public.plano_refeicoes
  add column if not exists substitui_refeicao_id uuid
    references public.plano_refeicoes(id) on delete cascade;

alter table public.plano_refeicoes
  add column if not exists instrucao text;

comment on column public.plano_refeicoes.substitui_refeicao_id is
  'Nula = refeição principal. Preenchida = esta refeição substitui aquela por inteiro.';
comment on column public.plano_refeicoes.instrucao is
  'Orientação ao paciente sobre quando usar esta alternativa.';

create index if not exists idx_refeicoes_substitui
  on public.plano_refeicoes (substitui_refeicao_id);

-- ===========================================================================
-- Conferência: as duas colunas existem e nenhuma refeição virou alternativa
-- por acidente (alternativas devem ser 0 até alguém criar a primeira).
-- ===========================================================================
select
  count(*)                                         as refeicoes_total,
  count(*) filter (where substitui_refeicao_id is null)     as principais,
  count(*) filter (where substitui_refeicao_id is not null) as alternativas
from public.plano_refeicoes;

-- ===========================================================================
-- FIM
-- ===========================================================================
