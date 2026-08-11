-- ===========================================================================
-- AS SEIS CONTAS DO PROJETO — o que cada uma E de verdade
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. Um select so.
--
-- POR QUE ESTE SCRIPT EXISTE, E POR QUE ELE MUDA O DIAGNOSTICO ANTERIOR.
--
-- O script 81 provou que `handle_new_user` roda em TODA insercao de
-- auth.users e cria uma linha em public.nutricionistas para qualquer conta —
-- 0 de 6 contas ficaram sem linha. Ou seja: "estar em nutricionistas" nao
-- significa nada sobre o papel da pessoa. E carimbo automatico.
--
-- E o repositorio mostra por que TRES das quatro contas externas tem
-- `nome` igual ao e-mail. Existem tres chamadas de signUp no projeto:
--
--   js/auth.js         criarConta({nome, email, senha})  -> manda { nome }
--   js/paciente-data.js cadastrar(email, senha)          -> NAO manda nome
--   js/equipe-data.js   cadastrar(email, senha)          -> NAO manda nome
--
-- Como o gatilho faz `coalesce(raw_user_meta_data->>'nome', email)`, uma
-- conta com nome = e-mail NAO nasceu no cadastro do painel. Nasceu no PWA do
-- paciente ou no app do colaborador.
--
-- Entao a pergunta certa deixou de ser "por que ha nutricionistas soltos" e
-- passou a ser: ESSAS CONTAS SAO PACIENTE OU COLABORADOR? E isso o 73 nao
-- respondia, porque ele so olhava para `nutri_id`.
--
-- ISSO DECIDE A ETAPA 4. Uma conta que e paciente vinculado continua
-- funcionando depois da migracao, porque `paciente_do_auth()` nao muda. Uma
-- conta que nao e nada continua vendo painel vazio. Sao destinos opostos.
--
-- Para colar no SQL Editor, use db/conferencia/82_quem_sao_as_seis_contas_LIMPO.sql
-- ===========================================================================

select
  u.email,
  u.created_at::date                                        as criada,
  coalesce(u.last_sign_in_at::date::text, 'NUNCA')          as ultimo_login,

  case when n.nome = u.email then '(= email)' else n.nome end as nome_em_nutricionistas,

  -- O PAPEL REAL, na ordem em que importa. Uma conta pode acumular papeis;
  -- por isso concatena em vez de escolher um.
  coalesce(nullif(btrim(
       case when exists (select 1 from public.organizacao_usuarios ou
                          where ou.auth_user_id = u.id)
            then 'MEMBRO DA ORGANIZACAO ' else '' end
    || case when exists (select 1 from public.pacientes p where p.auth_user_id = u.id)
            then 'PACIENTE ' else '' end
    || case when exists (select 1 from public.funcionarios f where f.auth_user_id = u.id)
            then 'COLABORADOR ' else '' end
    || case when exists (select 1 from public.admins a where a.user_id = u.id)
            then 'ADMIN ' else '' end
    || case when (select count(*) from public.pacientes p where p.nutri_id = u.id) > 0
            then 'DONO DE PACIENTES ' else '' end
  ), ''), 'NADA — so a linha automatica de nutricionistas')  as papel_real,

  -- Se e paciente, de quem. Se e colaborador, de quem. E o dado que decide
  -- se a conta pertence a esta organizacao ou a nenhuma.
  coalesce(
    (select 'paciente "' || p.nome || '" de ' || left(p.nutri_id::text, 8)
       from public.pacientes p where p.auth_user_id = u.id limit 1),
    (select 'colaborador "' || f.nome || '" de ' || left(f.nutri_id::text, 8)
       from public.funcionarios f where f.auth_user_id = u.id limit 1),
    '-')                                                    as vinculo,

  (select count(*) from public.codigos_uso cu where cu.nutri_id = u.id)   as codigo_saas,
  (select count(*) from public.pacientes p  where p.nutri_id  = u.id)     as pacientes_proprios,

  -- Rastro de uso do PWA: quem instalou o app e aceitou notificacao deixou
  -- assinatura de push amarrada ao paciente, nao a conta. Serve de indicio.
  (select count(*) from public.push_subscriptions ps
     join public.pacientes p on p.id = ps.paciente_id
    where p.auth_user_id = u.id)                            as push_do_pwa,

  left(u.id::text, 8)                                       as uid

from auth.users u
left join public.nutricionistas n on n.id = u.id
order by u.created_at;
