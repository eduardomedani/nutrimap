-- ===========================================================================
-- QUEM E QUEM — as contas, a organizacao e o dono
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- POR QUE ESTE SCRIPT EXISTE. A sessao do painel devolveu:
--
--     auth.uid() = dd412ed1...   email = eduardomedani@gmail.com
--     organizacao = 71935ff7...  (proprietario_user_id = 71935ff7...)
--
-- Ou seja: a conta com que se entra no painel NAO e a conta registrada como
-- proprietaria da organizacao. Antes de criar mais qualquer coisa, e preciso
-- saber se sao duas contas de verdade, com que e-mails, e qual delas os dados
-- seguem — porque as policies atuais ainda leem `nutri_id = auth.uid()`.
--
-- Para colar no SQL Editor, use db/conferencia/76_quem_e_quem_LIMPO.sql
-- ===========================================================================

with org as (
  select o.id, o.nome, o.proprietario_user_id, o.criado_em
    -- A organizacao da INSTALACAO, e nao "a primeira que aparecer". Desde que a
    -- conta do Caio ganhou organizacao propria, ha DUAS linhas em organizacoes, e
    -- `order by criado_em limit 1` deixou de dizer qual delas e — passou a depender
    -- de quem nasceu antes. O vinculo com public.admins e o mesmo sinal que a Etapa
    -- 2 usou para descobrir o proprietario da instalacao, e entrar em admins e um
    -- ato explicito. O Caio nao esta la.
    from public.organizacoes o join public.admins a on a.user_id = o.proprietario_user_id
),
membros as (
  select ou.id, ou.nome, u.email, p.chave as perfil, ou.status,
         ou.auth_user_id, ou.organizacao_id, ou.criado_em,
         (select count(*) from public.perfil_permissoes pp where pp.perfil_id = ou.perfil_id) as permissoes
    from public.organizacao_usuarios ou
    join public.perfis p    on p.id = ou.perfil_id
    join auth.users u       on u.id = ou.auth_user_id
),
tudo(secao, ordem, item, valor) as (

  select 'ORGANIZACAO', 1, 'id',                  o.id::text                  from org o
  union all
  select 'ORGANIZACAO', 2, 'nome',                o.nome                      from org o
  union all
  select 'ORGANIZACAO', 3, 'proprietario_user_id', o.proprietario_user_id::text from org o
  union all
  select 'ORGANIZACAO', 4, 'e-mail do proprietario',
         coalesce((select u.email from auth.users u where u.id = o.proprietario_user_id),
                  'SEM CONTA EM auth.users')
    from org o

  union all
  select 'MEMBROS', 10 + row_number() over (order by m.criado_em),
         m.email,
         m.perfil || ' / ' || m.status || ' / ' || m.permissoes || ' permissoes'
           || ' / uid ' || left(m.auth_user_id::text, 8)
           || ' / entrou ' || m.criado_em::timestamp(0)::text
    from membros m

  union all
  -- As contas com o e-mail em questao. Se aparecer mais de uma linha aqui, ha
  -- duas contas Auth distintas, e o e-mail nao serve para distingui-las.
  select 'CONTAS COM ESSE E-MAIL', 30 + row_number() over (order by u.created_at),
         u.email,
         'uid ' || u.id::text
           || ' / criada ' || u.created_at::date::text
           || ' / ultimo login ' || coalesce(u.last_sign_in_at::date::text, 'nunca')
    from auth.users u
   where lower(u.email) like 'eduardomedani%'

  union all
  -- De quem sao os dados, de fato. E o que decide se a conta do painel enxerga
  -- alguma coisa hoje, porque as policies ainda comparam com auth.uid().
  select 'DE QUEM SAO OS DADOS', 50, 'pacientes por nutri_id',
         coalesce((select string_agg(x.linha, ' | ')
                     from (select coalesce(u.email, 'sem conta: ' || left(p.nutri_id::text, 8))
                                  || ' = ' || count(*)::text as linha
                             from public.pacientes p
                             left join auth.users u on u.id = p.nutri_id
                            group by u.email, p.nutri_id) x), '(nenhum paciente)')

  union all
  select 'DE QUEM SAO OS DADOS', 51, 'a conta do painel tem pacientes?',
         (select count(*)::text from public.pacientes p
           where p.nutri_id = (select u.id from auth.users u
                                where lower(u.email) = 'eduardomedani@gmail.com'
                                order by u.created_at limit 1))

  union all
  select 'DE QUEM SAO OS DADOS', 52, 'objetos no Storage por pasta',
         coalesce((select string_agg(x.linha, ' | ')
                     from (select coalesce(u.email, 'pasta ' || (storage.foldername(so.name))[1])
                                  || ' = ' || count(*)::text as linha
                             from storage.objects so
                             left join auth.users u
                               on u.id::text = (storage.foldername(so.name))[1]
                            where (storage.foldername(so.name))[1] is not null
                            group by u.email, (storage.foldername(so.name))[1]) x), '(nenhum objeto)')

  union all
  -- admins foi o sinal que a Etapa 2 usou para escolher o proprietario. Se ele
  -- apontar para uma conta e o painel entrar com outra, e aqui que se ve.
  select 'ADMINS DO SaaS', 60 + row_number() over (order by u.email),
         coalesce(u.email, 'uid sem conta'),
         'uid ' || a.user_id::text
           || case when a.user_id = (select proprietario_user_id from org) then '  [E O PROPRIETARIO]' else '' end
    from public.admins a
    left join auth.users u on u.id = a.user_id

  union all
  select 'CONVITES', 70 + row_number() over (order by c.criado_em),
         c.email,
         c.codigo || ' / ' || (select p.chave from public.perfis p where p.id = c.perfil_id)
           || ' / ' || case when c.usado_em is not null then 'usado'
                            when c.revogado_em is not null then 'revogado'
                            when c.expira_em < now() then 'expirado'
                            else 'aberto' end
           || ' / criado ' || c.criado_em::timestamp(0)::text
    from public.organizacao_convites c
)
select secao, item, valor from tudo order by ordem;
