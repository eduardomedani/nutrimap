-- ===========================================================================
-- Evollo · DE QUAL MODELO DA BASE EVOLLO O TREINO VEIO
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE (uma coluna). Desfazer: db/treino_base_id_desfazer.sql
-- 100% re-executável.
--
-- POR QUE EXISTE
-- O "Criar do zero" parte de um dos 150 modelos da Base de Treinos Evollo
-- (ex.: INT-37). O "Prompt do gerador Evollo" pede, na evolução, "mantenha o
-- mesmo treino base" — e para trocar o ciclo, "outro modelo da mesma
-- combinação". Sem guardar o id do modelo no treino, nenhum dos dois é
-- possível: o INT-37 aparecia na prévia e se perdia ao salvar.
--
-- O QUE MUDA
--   treinos.base_id  text  — id do modelo (INT-37, AVA-12, INI-05…); NULL para
--                            treino montado à mão ou gerado antes da base.
-- Texto, sem FK: a base mora no código (api/_dados/base-evollo.js), não no
-- banco. RLS não muda — a coluna segue as policies da tabela.
--
-- O front funciona ANTES e DEPOIS desta coluna existir: grava base_id só se a
-- coluna existe, e as cópias de treino só levam base_id se a origem tiver.
--
-- Rodar no SQL Editor do Supabase. Para colar, use o _LIMPO.
-- ===========================================================================

alter table public.treinos add column if not exists base_id text;

comment on column public.treinos.base_id is
  'Id do treino-modelo da Base de Treinos Evollo de onde o treino veio (ex.: INT-37). NULL = montado à mão ou anterior à base.';

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA — esperado: uma linha, base_id | text
-- ---------------------------------------------------------------------------
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'treinos' and column_name = 'base_id';
