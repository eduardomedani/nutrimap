-- ===========================================================================
-- Evollo · ETAPA 2 — DESFAZER o ajuste do perfil Financeiro
-- ---------------------------------------------------------------------------
-- Restaura EXATAMENTE os dois vinculos retirados por
-- db/organizacao_ajuste_perfil_financeiro.sql:
--
--   comercial.editar
--   equipe.visualizar
--
-- Nada alem disso. Nao toca no catalogo de permissoes, nos outros perfis, nas
-- tabelas da Fundacao nem em qualquer objeto legado.
--
-- ATENCAO: rodar isto devolve ao perfil Financeiro o direito de contratar,
-- renovar e cancelar assinatura, e de ver o cadastro de colaboradores. Foi
-- justamente por isso que os dois sairam. So desfaca se a decisao de menor
-- privilegio tiver sido revista.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

insert into public.perfil_permissoes (perfil_id, permissao_chave)
select p.id, pm.chave
  from public.perfis p
 cross join public.permissoes pm
 where p.organizacao_id is null
   and p.chave = 'financeiro'
   and pm.chave in ('comercial.editar', 'equipe.visualizar')
on conflict do nothing;
