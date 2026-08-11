-- ===========================================================================
-- Evollo · ETAPA 2 — AJUSTE: menor privilegio no perfil Financeiro
-- ---------------------------------------------------------------------------
-- Retira DOIS vinculos do perfil padrao Financeiro:
--
--   comercial.editar
--   equipe.visualizar
--
-- Eles foram semeados a mais na primeira aplicacao de db/organizacao_schema.sql
-- e nao constavam da matriz aprovada. O schema base ja foi corrigido: uma
-- instalacao limpa hoje produz o mesmo estado que este ajuste produz numa base
-- que ja rodou a Fundacao.
--
-- POR QUE SAIR:
--
--   comercial.editar   "registrar pagamento de mensalidade" nao pode custar o
--                      direito de contratar, renovar e cancelar assinatura —
--                      que e o que a chave libera. Se o Financeiro precisar
--                      receber pagamento, o certo e uma chave propria
--                      (comercial.registrar_pagamento). NAO criar agora.
--   equipe.visualizar  concedida por hipotese de que um dia mexeria com folha.
--                      Permissao dada por hipotese e permissao que ninguem
--                      revoga depois.
--
-- NAO TOCA NO CATALOGO. As duas permissoes continuam existindo em
-- public.permissoes e continuam no pacote do Proprietario e do Administrador.
-- O que muda e so quem as recebe.
--
-- IDEMPOTENTE: rodar de novo nao faz nada, porque os vinculos ja terao saido.
--
-- Desfazer: db/organizacao_ajuste_perfil_financeiro_desfazer.sql
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

delete from public.perfil_permissoes pp
 using public.perfis p
 where p.id = pp.perfil_id
   and p.organizacao_id is null
   and p.chave = 'financeiro'
   and pp.permissao_chave in ('comercial.editar', 'equipe.visualizar');

-- Conferencia imediata: o pacote precisa ficar com exatamente as cinco chaves
-- aprovadas. Se sobrar ou faltar, aborta e nada e gravado.
do $$
declare
  v_tem text;
begin
  select string_agg(pp.permissao_chave, ', ' order by pp.permissao_chave)
    into v_tem
    from public.perfil_permissoes pp
    join public.perfis p on p.id = pp.perfil_id
   where p.organizacao_id is null and p.chave = 'financeiro';

  if v_tem is distinct from
     'clientes.visualizar, comercial.visualizar, financeiro.editar, financeiro.lancar, financeiro.visualizar'
  then
    raise exception 'AJUSTE ABORTADO: perfil Financeiro ficou com [%], e nao com as cinco chaves aprovadas.', v_tem;
  end if;

  raise notice 'Perfil Financeiro ajustado: %', v_tem;
end $$;
