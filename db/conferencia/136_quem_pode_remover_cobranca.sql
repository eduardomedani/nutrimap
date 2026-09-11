-- ===========================================================================
-- COMERCIAL — QUEM PODE REMOVER (CANCELAR) COBRANCA, HOJE E COM A REGRA NOVA
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- `comercial_cancelar_cobranca` ainda tem o TETO TEMPORARIO (conferencia da
-- db/comercial_rotulo_sem_teto.sql, 11/09/2026). O teto compara a
-- ORGANIZACAO da assinatura com o ID DE QUEM CLICOU: so passa o login cujo id
-- e o id da organizacao. Todo o resto recebe "Nao foi possivel concluir".
--
-- Antes do teto a funcao ja exige: sessao, organizacao da assinatura e
-- `comercial.editar` — a mesma regra de criar cobranca e registrar pagamento
-- depois da correcao de hoje.
--
-- Uma linha por perfil (os padrao e os da organizacao):
--
--   comercial_editar            tem a chave que a funcao exige
--   financeiro_editar           a RLS deixa esse perfil mudar o status direto,
--                               pelo Financeiro — sem a limpeza da renovacao
--                               programada que a RPC faz
--   usuarios_ativos / quem      quem tem esse perfil hoje
--   remove_hoje                 quem desse perfil passa pelo teto HOJE
--   removeria_sem_teto          se o teto sair e ficar `comercial.editar`
--   rpc_tem_teto / rpc_exige... o estado da funcao em producao
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

with org as (
  select o.id
    from public.organizacoes o
    join public.admins ad on ad.user_id = o.proprietario_user_id
),
fn as (
  select p.prosrc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'comercial_cancelar_cobranca'
   limit 1
)
select case when pf.organizacao_id is null then 'padrao' else 'da organizacao' end    as escopo,
       pf.chave,
       pf.nome,
       coalesce(bool_or(pp.permissao_chave = 'comercial.editar'), false)              as comercial_editar,
       coalesce(bool_or(pp.permissao_chave = 'financeiro.editar'), false)             as financeiro_editar,
       (select count(*) from public.organizacao_usuarios u, org
         where u.perfil_id = pf.id and u.organizacao_id = org.id and u.status = 'ativo') as usuarios_ativos,
       (select string_agg(u.nome, ', ' order by u.nome) from public.organizacao_usuarios u, org
         where u.perfil_id = pf.id and u.organizacao_id = org.id and u.status = 'ativo') as quem,
       coalesce((select string_agg(u.nome, ', ') from public.organizacao_usuarios u, org
         where u.perfil_id = pf.id and u.organizacao_id = org.id and u.status = 'ativo'
           and u.auth_user_id = org.id), '—')                                         as remove_hoje,
       case when coalesce(bool_or(pp.permissao_chave = 'comercial.editar'), false)
            then 'SIM' else 'nao' end                                                 as removeria_sem_teto,
       (select case when prosrc like '%TETO TEMPORARIO%' then 'SIM' else 'nao' end from fn) as rpc_tem_teto,
       (select case when prosrc like '%comercial.editar%' then 'SIM' else 'nao' end from fn) as rpc_exige_comercial_editar
  from public.perfis pf
  left join public.perfil_permissoes pp on pp.perfil_id = pf.id
 where pf.organizacao_id is null
    or pf.organizacao_id = (select id from org)
 group by pf.id, pf.organizacao_id, pf.chave, pf.nome
 order by pf.organizacao_id nulls first, pf.chave;
