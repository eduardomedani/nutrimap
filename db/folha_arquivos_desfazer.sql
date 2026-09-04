-- ===========================================================================
-- DESFAZER · db/folha_arquivos.sql
-- ---------------------------------------------------------------------------
-- TIRE O FRONTEND PRIMEIRO. A tela da Folha de pagamento le esta tabela para
-- montar a secao "Arquivos do mes"; derrubando a tabela antes do deploy, a
-- aba quebra para quem estiver com ela aberta.
--
-- O `drop table` LEVA JUNTO o registro de quais arquivos foram importados —
-- mas nao os arquivos: eles continuam no bucket `colaborador-documentos`, em
-- `{organizacao}/_mes/{AAAA-MM}/`. Apagar o registro sem apagar o objeto e
-- deliberado: o arquivo que gerou um bonus ja pago nao deve sumir porque
-- alguem desfez uma migracao.
--
-- Para limpar o storage tambem, e uma decisao separada e manual.
-- ===========================================================================

drop policy if exists folha_arquivos_select on public.folha_arquivos;
drop policy if exists folha_arquivos_insert on public.folha_arquivos;
drop policy if exists folha_arquivos_update on public.folha_arquivos;

drop index if exists uniq_folha_arquivo_atual;
drop index if exists idx_folha_arquivos_comp;

drop table if exists public.folha_arquivos;

select 'folha_arquivos removida — os arquivos continuam no bucket' as resultado;
