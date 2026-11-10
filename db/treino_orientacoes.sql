-- ===========================================================================
-- Evollo · ORIENTAÇÕES DO TREINO PARA O ALUNO
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE (uma coluna). Desfazer: db/treino_orientacoes_desfazer.sql
-- 100% re-executável.
--
-- POR QUE EXISTE
-- O treino gerado pela Base de Treinos Evollo traz a agenda sugerida
-- ("Seg: A · Ter: B · Qui: C · Sex: D"), as orientações da seção 5 do prompt
-- do gerador (aquecimento, progressão, repetições na reserva, deload, troca do
-- treino) e o aviso médico. Até aqui isso aparecia SÓ na prévia do
-- profissional e se perdia ao salvar — o aluno nunca via.
--
-- O QUE MUDA
--   treinos.orientacoes  text — texto livre, editável no editor do treino e
--                               mostrado ao aluno no app ("Como fazer este
--                               treino"). NULL = sem orientações.
-- RLS não muda: o aluno já lê a linha do próprio treino (select *).
--
-- O front funciona ANTES e DEPOIS desta coluna existir: grava orientações só
-- se a coluna existe, e o campo no editor só aparece quando ela existe.
--
-- Rodar no SQL Editor do Supabase. Para colar, use o _LIMPO.
-- ===========================================================================

alter table public.treinos add column if not exists orientacoes text;

comment on column public.treinos.orientacoes is
  'Orientações do treino para o aluno (agenda sugerida, aquecimento, progressão, aviso). Mostradas no app do aluno.';

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA — esperado: uma linha, orientacoes | text
-- ---------------------------------------------------------------------------
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'treinos' and column_name = 'orientacoes';
