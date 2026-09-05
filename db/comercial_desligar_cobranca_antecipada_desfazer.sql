-- ===========================================================================
-- DESFAZER db/comercial_desligar_cobranca_antecipada.sql — SO O PASSO 2
-- ---------------------------------------------------------------------------
-- Religa `renovacao_automatica` nas assinaturas vivas: a partir da proxima
-- baixa, a cobranca do periodo seguinte volta a nascer sozinha.
--
-- AS COBRANCAS APAGADAS NAO VOLTAM. `delete` nao tem desfazer, e reconstruir a
-- partir do log seria adivinhar id, competencia e categoria. Se voce precisa
-- delas de volta, o caminho e a tela: em Comercial > cliente, "Criar cobranca
-- do periodo" recria a do periodo vigente com os dados da assinatura, que e a
-- mesma fonte que o script original usava.
--
-- ELE RELIGA TODAS, e nao so as que o script desligou. Nao ha marca gravada
-- para distinguir — quem ja estava desligado antes (o script so mexeu em quem
-- estava ligado) volta ligado por aqui. Se havia cliente com renovacao
-- desligada de proposito, desligue de novo na ficha depois de rodar.
--
-- Tambem e preciso desmarcar a mudanca na TELA, se ela nao for mais desejada:
-- js/comercial-formularios.js, `assinaturaVazia()`, `renovacao_automatica`.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/comercial_desligar_cobranca_antecipada_desfazer_LIMPO.sql
-- ===========================================================================

do $desfaz$
declare
  v_org uuid;
  v_n   int;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  if v_org is null then
    raise exception 'organizacao nao encontrada — nada foi tocado';
  end if;

  update public.comercial_assinaturas a
     set renovacao_automatica = true,
         atualizado_em        = now()
   where a.nutri_id = v_org
     and a.status in ('ativa', 'pausada', 'aguardando_inicio')
     and not a.renovacao_automatica;

  get diagnostics v_n = row_count;
  raise notice 'religadas: % assinatura(s)', v_n;
end $desfaz$;


-- ===========================================================================
-- CONFERENCIA. Esperado: desligadas = 0
-- ===========================================================================
select
  (select count(*) from public.comercial_assinaturas
    where status in ('ativa', 'pausada', 'aguardando_inicio')
      and not renovacao_automatica) as desligadas;
