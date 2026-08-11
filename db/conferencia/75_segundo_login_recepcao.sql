-- ===========================================================================
-- CONFERENCIA DA ETAPA 3 — o segundo login real
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le, e nao usa subtransacao: aqui nao ha nada para
-- reverter, porque o estado que se confere foi criado pela INTERFACE, e e para
-- ficar.
--
-- Rode DEPOIS de a Recepcao criar a conta e consumir o codigo EVL-.
--
-- Confere o que a prova do console nao alcanca: o que ficou GRAVADO. O console
-- prova identidade e permissao efetiva; este script prova vinculo, convite
-- consumido e trilha de auditoria.
--
-- O e-mail da conta de teste esta em UM lugar so, na primeira CTE. Trocando
-- ali, o script serve para qualquer usuario.
--
-- Para colar no SQL Editor, use db/conferencia/75_segundo_login_recepcao_LIMPO.sql
-- ===========================================================================

with alvo as (
  select 'eduardomedani+recepcao3@gmail.com'::text as email
),
conta as (
  select u.id as uid, u.email, u.created_at, u.last_sign_in_at
    from auth.users u, alvo a
   where lower(u.email) = lower(a.email)
),
membro as (
  select ou.*, p.chave as perfil_chave, p.nome as perfil_nome
    from public.organizacao_usuarios ou
    join public.perfis p on p.id = ou.perfil_id
    join conta c on c.uid = ou.auth_user_id
),
org as (
  -- A organizacao da INSTALACAO, e nao "a primeira que aparecer". Desde que a
  -- conta do Caio ganhou organizacao propria, ha DUAS linhas em organizacoes, e
  -- `order by criado_em limit 1` deixou de dizer qual delas e — passou a depender
  -- de quem nasceu antes. O vinculo com public.admins e o mesmo sinal que a Etapa
  -- 2 usou para descobrir o proprietario da instalacao, e entrar em admins e um
  -- ato explicito. O Caio nao esta la.
  select o.id, o.nome from public.organizacoes o join public.admins a on a.user_id = o.proprietario_user_id
),
convite as (
  select c.* from public.organizacao_convites c, alvo a
   where lower(c.email) = lower(a.email)
   order by c.criado_em desc
   limit 1
),
linhas(secao, ordem, item, valor, resultado) as (

  -- ═══════════════ GUARDA — SEMPRE EMITE ═══════════════
  -- Sem estas tres linhas, uma conta que ainda nao existe fazia as secoes
  -- PROVA, VINCULO, CONVITE e AUDITORIA simplesmente NAO APARECEREM. Sobrava
  -- so ISOLAMENTO, e o resultado se lia como "passou" quando era "nao achei".
  -- Ausencia de linha nao pode ser a forma de dizer que nao encontrou.
  select 'GUARDA', 0, 'conta no auth.users',
         coalesce((select uid::text from conta), 'NAO ENCONTRADA — a conta ainda nao foi criada'),
         case when exists (select 1 from conta) then 'ok' else 'PENDENTE' end
  union all
  select 'GUARDA', 0, 'vinculo em organizacao_usuarios',
         coalesce((select id::text from membro), 'NAO ENCONTRADO — o codigo ainda nao foi consumido'),
         case when exists (select 1 from membro) then 'ok' else 'PENDENTE' end
  union all
  select 'GUARDA', 0, 'convite para este e-mail',
         coalesce((select codigo from convite), 'NENHUM — o convite ainda nao foi criado no painel'),
         case when exists (select 1 from convite) then 'ok' else 'PENDENTE' end
  union all
  select 'GUARDA', 0, 'e-mail conferido', (select email from alvo), 'ok'

  -- ═══════════════ A PROVA CENTRAL ═══════════════
  union all
  select 'PROVA', 1, 'auth.uid da Recepcao', c.uid::text,
         case when c.uid is null then 'FALHOU' else 'ok' end
    from conta c
  union all
  select 'PROVA', 2, 'organizacao_id gravado', m.organizacao_id::text,
         case when m.organizacao_id = (select id from org) then 'OK' else 'FALHOU' end
    from membro m
  union all
  select 'PROVA', 3, 'os dois sao iguais?',
         case when m.auth_user_id = m.organizacao_id then 'SIM' else 'NAO' end,
         case when m.auth_user_id = m.organizacao_id then 'FALHOU' else 'OK' end
    from membro m
  union all
  -- Ate hoje auth.uid() e a organizacao sempre coincidiram, e nenhum teste
  -- conseguia distinguir IDENTIDADE de PROPRIEDADE. Esta linha e a diferenca.
  select 'PROVA', 4, 'identidade separada de propriedade',
         'uid ' || left(m.auth_user_id::text, 8) || '... pertence a org '
                || left(m.organizacao_id::text, 8) || '...',
         case when m.auth_user_id <> m.organizacao_id
               and m.organizacao_id = (select id from org) then 'OK' else 'FALHOU' end
    from membro m

  -- ═══════════════ O VINCULO GRAVADO (§14) ═══════════════
  union all
  select 'VINCULO', 10, 'nome', m.nome,
         case when m.nome is not null then 'ok' else 'FALHOU' end from membro m
  union all
  select 'VINCULO', 11, 'perfil', m.perfil_chave,
         case when m.perfil_chave = 'recepcao' then 'OK' else 'FALHOU' end from membro m
  union all
  select 'VINCULO', 12, 'status', m.status,
         case when m.status = 'ativo' then 'OK' else 'FALHOU' end from membro m
  union all
  select 'VINCULO', 13, 'colaborador vinculado',
         coalesce(m.funcionario_id::text, '(nenhum, como pedido)'), 'ok' from membro m
  union all
  select 'VINCULO', 14, 'ultimo acesso',
         coalesce(m.ultimo_acesso_em::text, '(ainda nao registrado)'), 'ok' from membro m
  union all
  select 'VINCULO', 15, 'excecoes individuais',
         (select count(*)::text from public.usuario_permissoes up where up.usuario_id = m.id),
         case when (select count(*) from public.usuario_permissoes up where up.usuario_id = m.id) = 0
              then 'OK' else 'ATENCAO' end
    from membro m

  -- ═══════════════ O CONVITE (§15) ═══════════════
  union all
  select 'CONVITE', 20, 'codigo', v.codigo, 'ok' from convite v
  union all
  select 'CONVITE', 21, 'usado_em', coalesce(v.usado_em::text, '(NAO CONSUMIDO)'),
         case when v.usado_em is not null then 'OK' else 'FALHOU' end from convite v
  union all
  select 'CONVITE', 22, 'usado_por bate com a conta',
         case when v.usado_por = (select uid from conta) then 'sim' else 'NAO BATE' end,
         case when v.usado_por = (select uid from conta) then 'OK' else 'FALHOU' end from convite v
  union all
  select 'CONVITE', 23, 'revogado', coalesce(v.revogado_em::text, 'nao'), 'ok' from convite v
  union all
  -- Consumido deixa de contar no indice parcial de "um aberto por e-mail", o
  -- que e o certo: reconvidar a mesma pessoa depois tem que funcionar.
  select 'CONVITE', 24, 'reutilizavel?',
         case when v.usado_em is null and v.revogado_em is null and v.expira_em > now()
              then 'SIM — AINDA ABERTO' else 'nao' end,
         case when v.usado_em is not null then 'OK' else 'FALHOU' end
    from convite v

  -- ═══════════════ AUDITORIA (§16 e §22) ═══════════════
  -- So os eventos que o CHECK da tabela realmente aceita. "usuario_criado" nao
  -- existe neste schema: quem cria o acesso e o convite, e o evento dele e
  -- `codigo_gerado`.
  union all
  select 'AUDITORIA', 30 + row_number() over (order by a.criado_em),
         a.acao,
         'alvo=' || coalesce(left(a.usuario_alvo::text, 8), '-')
           || ' / autor=' || case when a.usuario_autor = (select proprietario_user_id from public.organizacoes o2 where o2.id = a.organizacao_id)
                                  then 'proprietario'
                                  when a.usuario_autor = (select uid from conta) then 'a propria Recepcao'
                                  else left(a.usuario_autor::text, 8) end
           || ' / ' || a.criado_em::timestamp(0)::text,
         case when a.organizacao_id = (select id from org) then 'OK' else 'FALHOU' end
    from public.organizacao_auditoria a
   where a.organizacao_id = (select id from org)
     and (a.usuario_alvo in (select id from membro)
          or a.usuario_alvo in (select id from convite))

  -- ═══════════════ O QUE NAO PODE TER ACONTECIDO ═══════════════
  union all
  select 'ISOLAMENTO', 90, 'a Recepcao NAO virou proprietaria',
         (select count(*)::text from public.organizacao_usuarios ou
            join public.perfis p on p.id = ou.perfil_id
           where p.chave = 'proprietario' and ou.status = 'ativo'),
         case when (select count(*) from public.organizacao_usuarios ou
                      join public.perfis p on p.id = ou.perfil_id
                     where p.chave = 'proprietario' and ou.status = 'ativo') = 1
              then 'OK' else 'FALHOU' end
  union all
  select 'ISOLAMENTO', 91, 'contas fora da organizacao intocadas',
         (select count(*)::text from public.nutricionistas n
           where not exists (select 1 from public.organizacao_usuarios ou where ou.auth_user_id = n.id)),
         'ok'
  union all
  -- A Recepcao NAO pode ver paciente ainda: as policies continuam em
  -- nutri_id = auth.uid(). Isto e o esperado da Etapa 3, e a Etapa 4 e que
  -- muda. Aqui so se registra o fato.
  select 'ISOLAMENTO', 92, 'pacientes com nutri_id da Recepcao',
         (select count(*)::text from public.pacientes p, conta c where p.nutri_id = c.uid),
         'ok'
),
veredito as (
  select 'VEREDITO' as secao, 999 as ordem,
    case when not exists (select 1 from conta)   then 'conta ainda nao criada'
         when not exists (select 1 from membro)  then 'conta criada, mas o codigo nao foi consumido'
         when exists (select 1 from linhas where resultado = 'FALHOU') then 'ha falhas'
         else 'segundo login provado' end as item,
    case when not exists (select 1 from conta) or not exists (select 1 from membro)
         then 'complete o fluxo na interface e rode de novo'
         else (select count(*)::text from linhas where resultado = 'OK') || ' verificacoes OK' end as valor,
    case when not exists (select 1 from conta) or not exists (select 1 from membro) then 'PENDENTE'
         when exists (select 1 from linhas where resultado = 'FALHOU') then 'FALHOU'
         else 'APROVADO' end as resultado
)
select secao, ordem, item, valor, resultado from linhas
union all
select secao, ordem, item, valor, resultado from veredito
 order by ordem, secao;
