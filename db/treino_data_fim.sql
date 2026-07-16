-- ===========================================================================
-- MIGRAÇÃO: adiciona data_fim aos treinos (período do treino: início → fim).
-- Seguro re-rodar (ADD COLUMN IF NOT EXISTS). Não afeta dados existentes.
-- Rodar no SQL Editor do Supabase (projeto jdtpludqkpvhnzkekrgm).
-- ===========================================================================
alter table public.treinos add column if not exists data_fim date;
