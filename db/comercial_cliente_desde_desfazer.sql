-- ===========================================================================
-- Evollo · DESFAZER — "CLIENTE DESDE" VOLTA A NAO TER ACAO PROPRIA
-- ---------------------------------------------------------------------------
-- Desfaz db/comercial_cliente_desde.sql: tira o gatilho, a funcao do gatilho
-- e a RPC.
--
-- O CHECK DA TRILHA: volta as cinco acoes de antes SO se nenhuma linha
-- `inicio_contrato_alterado` tiver sido gravada. Se houver, o CHECK fica com a
-- acao — apagar a trilha para caber no CHECK antigo seria sumir com o registro
-- de quem alterou. O resultado diz qual dos dois aconteceu.
--
-- AS DATAS JA ALTERADAS FICAM COMO ESTAO. Sao cadastro, corrigido por alguem
-- com o nome na trilha. Para voltar uma delas, o `antes` de cada linha da
-- trilha tem a data original.
--
-- ATENCAO: depois disto, o frontend publicado continua chamando a RPC, que
-- deixa de existir. Desfaca junto o deploy, ou a acao "Alterar" da ficha falha.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/comercial_cliente_desde_desfazer_LIMPO.sql
-- ===========================================================================

drop trigger if exists trg_comercial_cliente_desde_so_pela_rpc on public.comercial_assinaturas;
drop function if exists public.fn_comercial_cliente_desde_so_pela_rpc();
drop function if exists public.comercial_alterar_cliente_desde(uuid, date);

do $desf$
begin
  if exists (select 1 from public.comercial_assinatura_auditoria
              where acao = 'inicio_contrato_alterado') then
    raise notice 'Ha alteracoes de cliente desde na trilha: o CHECK continua com a acao, para nao perder o registro.';
  else
    alter table public.comercial_assinatura_auditoria drop constraint if exists comercial_assinatura_auditoria_acao_check;
    alter table public.comercial_assinatura_auditoria add  constraint comercial_assinatura_auditoria_acao_check
      check (acao in ('renovacao_programada', 'renovacao_cancelada', 'renovada',
                      'bonificada', 'bonificacao_desfeita'));
  end if;
end $desf$;


-- ===========================================================================
-- CONFERENCIA. Esperado: funcao 0 · gatilho 0. `alteracoes_na_trilha` diz
-- quantas correcoes ficaram registradas, e `check_com_acao` se o CHECK as manteve.
-- ===========================================================================
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'comercial_alterar_cliente_desde')   as funcao,
  (select count(*) from pg_trigger
    where tgrelid = 'public.comercial_assinaturas'::regclass
      and tgname  = 'trg_comercial_cliente_desde_so_pela_rpc')                     as gatilho,
  (select count(*) from public.comercial_assinatura_auditoria
    where acao = 'inicio_contrato_alterado')                                        as alteracoes_na_trilha,
  (select pg_get_constraintdef(c.oid) like '%inicio_contrato_alterado%'
     from pg_constraint c
    where c.conrelid = 'public.comercial_assinatura_auditoria'::regclass
      and c.conname  = 'comercial_assinatura_auditoria_acao_check')                as check_com_acao;
