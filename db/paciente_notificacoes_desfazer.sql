-- ===========================================================================
-- Evollo · DESFAZER — notificacoes internas do paciente (Etapa 4)
-- ---------------------------------------------------------------------------
-- Desfaz db/paciente_notificacoes.sql.
--
-- ATENCAO A ORDEM. Este script devolve marcar_documento_paciente_visualizado()
-- a versao da Etapa 1 ANTES de derrubar a tabela. Fazer o contrario deixaria a
-- funcao apontando para uma tabela que nao existe mais, e a visualizacao de
-- documento — que nao tem nada a ver com aviso — pararia de funcionar no PWA.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) A funcao de visualizacao volta a versao da Etapa 1
-- ---------------------------------------------------------------------------
-- Identica a de db/paciente_documentos.sql, secao 3: so os campos de leitura
-- do documento, sem a parte de avisos.
create or replace function public.marcar_documento_paciente_visualizado(p_documento uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_eu uuid;
begin
  v_eu := public.paciente_do_auth();
  if v_eu is null then
    return false;
  end if;

  update public.paciente_documentos
     set visualizado_pelo_paciente = true,
         visualizado_em = coalesce(visualizado_em, now()),
         metadata = jsonb_set(
           metadata, '{acessos}',
           to_jsonb(coalesce((metadata->>'acessos')::int, 0) + 1), true),
         atualizado_em = now()
   where id = p_documento
     and paciente_id = v_eu
     and visivel_paciente
     and status = 'ativo'
     and arquivado_em is null;

  return found;
end
$fn$;

-- O rollback recria a funcao, e CREATE OR REPLACE refaz o grant padrao do
-- schema. Sem estas duas linhas, desfazer reabriria o EXECUTE para anon —
-- voltar atras nao pode significar voltar ao inseguro.
revoke all on function public.marcar_documento_paciente_visualizado(uuid) from public;
revoke all on function public.marcar_documento_paciente_visualizado(uuid) from anon;
grant execute on function public.marcar_documento_paciente_visualizado(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 2) A funcao que so existia para os avisos
-- ---------------------------------------------------------------------------
drop function if exists public.marcar_notificacao_lida(uuid);


-- ---------------------------------------------------------------------------
-- 3) Policies e tabela
-- ---------------------------------------------------------------------------
drop policy if exists pn_nutri_select    on public.paciente_notificacoes;
drop policy if exists pn_nutri_insert    on public.paciente_notificacoes;
drop policy if exists pn_paciente_select on public.paciente_notificacoes;

-- Os avisos SAO descartaveis, ao contrario dos documentos: o que eles dizem
-- ("foi compartilhado tal coisa") continua inteiro em paciente_eventos e em
-- paciente_documento_auditoria. Por isso este drop nao fica comentado.
drop table if exists public.paciente_notificacoes;


-- ===========================================================================
-- Conferencia: tudo em 0, e a funcao de visualizacao de pe.
-- ===========================================================================
select
  (select count(*) from pg_tables
    where schemaname = 'public' and tablename = 'paciente_notificacoes')   as tabela,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'marcar_notificacao_lida')  as funcao_aviso,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'marcar_documento_paciente_visualizado')             as funcao_visualizacao;
