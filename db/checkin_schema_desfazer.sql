-- ===========================================================================
-- Evollo · DESFAZER — check-ins (Etapa 1)
-- ---------------------------------------------------------------------------
-- Desfaz db/checkin_schema.sql.
--
-- PENSE ANTES DE RODAR. O `drop table ... cascade` aqui apaga RESPOSTA DE
-- PACIENTE — o que ele escreveu sobre fome, sono e dor, que nao existe em
-- nenhum outro lugar. Nao ha backup implicito.
--
-- Por isso o drop das tabelas fica COMENTADO no fim. O que este script faz por
-- padrao e desligar o modulo: policies, gatilhos e funcoes saem, e as tabelas
-- ficam. Um schema desligado nao atrapalha; uma resposta apagada nao volta.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) Gatilhos
-- ---------------------------------------------------------------------------
drop trigger if exists trg_aud_ckm   on public.checkin_modelos;
drop trigger if exists trg_aud_cka   on public.checkin_atribuicoes;
drop trigger if exists trg_aud_cko   on public.checkin_ocorrencias;
drop trigger if exists trg_tocar_ckm on public.checkin_modelos;
drop trigger if exists trg_tocar_ckp on public.checkin_perguntas;
drop trigger if exists trg_tocar_cka on public.checkin_atribuicoes;


-- ---------------------------------------------------------------------------
-- 2) Policies
-- ---------------------------------------------------------------------------
drop policy if exists ckm_nutri_all       on public.checkin_modelos;
drop policy if exists ckp_nutri_all       on public.checkin_perguntas;
drop policy if exists cka_nutri_select    on public.checkin_atribuicoes;
drop policy if exists cka_nutri_insert    on public.checkin_atribuicoes;
drop policy if exists cka_nutri_update    on public.checkin_atribuicoes;
drop policy if exists cka_nutri_delete    on public.checkin_atribuicoes;
drop policy if exists cko_nutri_all       on public.checkin_ocorrencias;
drop policy if exists cko_paciente_select on public.checkin_ocorrencias;
drop policy if exists ckr_nutri_select    on public.checkin_respostas;
drop policy if exists ckr_paciente_select on public.checkin_respostas;
drop policy if exists ckaud_nutri_select  on public.checkin_auditoria;

-- RLS continua LIGADA nas tabelas. Sem policy e com RLS ligada, ninguem le
-- nada pela API — que e o estado seguro para um modulo desligado. Desligar o
-- RLS aqui deixaria as tabelas abertas a quem tivesse o grant de tabela.


-- ---------------------------------------------------------------------------
-- 3) Funcoes
-- ---------------------------------------------------------------------------
drop function if exists public.finalizar_checkin(uuid, jsonb);
drop function if exists public.materializar_ocorrencia_checkin(uuid, date, timestamptz, timestamptz);
drop function if exists public.registrar_auditoria_checkin();
drop function if exists public.tocar_checkin();


-- ===========================================================================
-- Conferencia: funcoes e policies em 0, tabelas de pe e ainda com RLS.
-- ===========================================================================
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('finalizar_checkin', 'materializar_ocorrencia_checkin',
                        'registrar_auditoria_checkin', 'tocar_checkin'))          as funcoes,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename like 'checkin\_%')                  as policies,
  (select count(*) from pg_tables
    where schemaname = 'public' and tablename like 'checkin\_%')                  as tabelas,
  (select count(*) from public.checkin_respostas)                                 as respostas_preservadas;


-- ===========================================================================
-- O COMANDO DESTRUTIVO, SEPARADO DE PROPOSITO
-- ---------------------------------------------------------------------------
-- Apaga o que os pacientes responderam. Nao ha volta.
-- A ordem respeita as FKs RESTRICT; `cascade` no fim resolve o resto.
-- ===========================================================================

-- drop table if exists public.checkin_respostas   cascade;
-- drop table if exists public.checkin_ocorrencias cascade;
-- drop table if exists public.checkin_atribuicoes cascade;
-- drop table if exists public.checkin_perguntas   cascade;
-- drop table if exists public.checkin_modelos     cascade;
-- drop table if exists public.checkin_auditoria   cascade;
