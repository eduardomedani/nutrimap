-- ===========================================================================
-- 140 · CONTAS PRESAS NO MEIO DO CADASTRO PROFISSIONAL
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. UMA consulta so — o painel do SQL Editor mostra
-- apenas o resultado da ultima instrucao.
--
-- POR QUE ELE EXISTE. O cadastro por convite do SaaS cria a conta de login e,
-- pelo gatilho `handle_new_user`, a linha em `nutricionistas`. Nada cria a
-- organizacao nem o vinculo: `registrar_uso_codigo` so conta o uso do convite.
-- Desde o portao do painel (a68c25e), essas contas recebem o aviso "sem acesso"
-- em vez de um painel vazio. Esta consulta diz QUANTAS sao e QUEM sao, para a
-- correcao saber se precisa de uma recuperacao para quem ja caiu nesse buraco.
--
-- ---------------------------------------------------------------------------
-- QUEM APARECE — toda conta de login que NAO e nenhuma destas:
--   · membro ATIVO de organizacao ATIVA (o profissional que funciona);
--   · aluno (`pacientes.auth_user_id`);
--   · colaborador da equipe (`funcionarios.auth_user_id`);
--   · dono da plataforma (`admins`).
--
-- O que sobra e, por construcao, alguem que tem conta e nao tem para onde ir.
--
-- ---------------------------------------------------------------------------
-- COMO LER AS COLUNAS
--   usou_convite_saas   ha linha em `codigos_uso` com o id desta conta. E o
--                       sinal mais forte de "profissional que tentou o SaaS".
--                       Lembre: `registrar_uso_codigo` e best-effort no
--                       cadastro, entao FALSE nao prova que nao usou.
--   tem_organizacao     e dona de alguma organizacao (ativa ou nao)
--   vinculo             o status do vinculo, se houver algum (ex.: bloqueado)
--   org_ativa           a organizacao do vinculo esta ativa?
--
-- LEITURA ESPERADA HOJE
--   usou_convite_saas = true e tem_organizacao = false  -> o defeito em si
--   vinculo = 'bloqueado' ou org_ativa = false          -> NAO e defeito: e
--                                                          acesso retirado de
--                                                          proposito, e fica
--   o resto                                              -> contas de teste ou
--                                                          cadastros abandonados;
--                                                          olhar uma a uma
--
-- Zero linhas: ninguem esta preso, e a correcao nao precisa de recuperacao.
-- ===========================================================================
select u.email,
       u.created_at::date                                               as criada_em,
       u.last_sign_in_at::date                                          as ultimo_login,
       exists (select 1 from public.codigos_uso cu
                where cu.nutri_id = u.id)                               as usou_convite_saas,
       exists (select 1 from public.organizacoes o
                where o.proprietario_user_id = u.id)                    as tem_organizacao,
       ou.status                                                        as vinculo,
       o.ativo                                                          as org_ativa,
       exists (select 1 from public.nutricionistas n where n.id = u.id) as linha_nutricionistas
  from auth.users u
  left join public.organizacao_usuarios ou on ou.auth_user_id = u.id
  left join public.organizacoes o          on o.id = ou.organizacao_id
 where not exists (select 1 from public.organizacao_usuarios x
                     join public.organizacoes y on y.id = x.organizacao_id
                    where x.auth_user_id = u.id and x.status = 'ativo' and y.ativo)
   and not exists (select 1 from public.pacientes p    where p.auth_user_id = u.id)
   and not exists (select 1 from public.funcionarios f where f.auth_user_id = u.id)
   and not exists (select 1 from public.admins a       where a.user_id = u.id)
 order by u.created_at desc;
