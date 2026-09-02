-- ===========================================================================
-- EQUIPE/FOLHA — O QUE UM ACESSO NAO MIGRADO JA CRIOU
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- POR QUE ESTE SCRIPT EXISTE. Em 02/09/2026 uma conta com acesso a Equipe
-- abriu a Folha de pagamento e nao viu a folha que o proprietario tinha aberto.
-- A causa e a mesma que a Etapa 4B curou no Comercial, e o modulo Equipe ainda
-- nao foi migrado:
--
--   . `js/folha.js` recebe o dono como PARAMETRO, vindo de
--     `initEquipeUI(sessao.user.id)` em index.html — ou seja, o uuid da PESSOA;
--   . a RLS de `folhas` e `nutri_id = auth.uid()`.
--
-- MAS AQUI TEM UM AGRAVANTE QUE O COMERCIAL NAO TINHA. No Comercial a tela
-- abria vazia e parava por ai. Na Folha ela ESCREVE:
--
--   1. `buscarFolhaPorCompetencia` nao filtra nada — confia na RLS. Para quem
--      nao e o dono, devolve zero linhas.
--   2. `abrirFolha` le esse zero como "a folha do mes ainda nao existe" e chama
--      `criarFolha(nutriId, competencia)` com o uuid da pessoa.
--   3. A policy de insert e `with check (nutri_id = auth.uid())`. Passa.
--   4. `uniq_folhas_competencia` e `(nutri_id, competencia)`, e nao
--      `(competencia)`. Nao colide com a folha do proprietario.
--
-- Resultado: uma SEGUNDA folha do mesmo mes, vazia, no nome de quem abriu a
-- tela. Invisivel para o proprietario e invisivel para ela na visita seguinte,
-- porque o ciclo se repete.
--
-- COMO LER:
--
--   FOLHAS FORA DA ORGANIZACAO
--       o estrago. Zero = ninguem abriu a tela ainda. Qualquer numero > 0 sao
--       folhas fantasma para apagar ANTES de migrar o modulo — depois da
--       migracao elas ficam invisiveis para todos, como o paciente orfao do
--       109.
--
--   A CONTA
--       quais permissoes ela realmente tem. `equipe.folha` e SENSIVEL e nao
--       vem no pacote basico: pode ser que falte tambem, e ai sao dois
--       problemas, nao um.
--
--   OUTRAS TABELAS DO MODULO
--       folha_itens, folha_adicionais, funcionarios, ponto. O mesmo caminho
--       existe em cada uma.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/111_folha_fora_da_organizacao_LIMPO.sql
-- ===========================================================================

drop table if exists conf111;
create temp table conf111 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_org  uuid;
  v_n    int;
  r      record;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  insert into conf111 values (0, 'ORGANIZACAO', 'id', v_org::text, '');

  -- ═══════════ QUEM TEM ACESSO, E COM QUE CHAVES ═══════════
  -- Sem e-mail no arquivo: o script lista TODOS os membros. O repositorio e
  -- publico, e a pergunta ("quem pode abrir a folha?") nao depende de saber o
  -- nome de ninguem de antemao — pelo contrario, ver a lista inteira e melhor
  -- que conferir uma conta por vez.
  --
  -- `tem_permissao()` depende de auth.uid(), que no SQL Editor e nulo. Entao a
  -- consulta refaz a regra na mao: excecao individual vence o pacote do perfil,
  -- e a ausencia dos dois e negacao.
  -- Uma linha por membro, com as chaves de Equipe resumidas. Evita laco
  -- aninhado e sai legivel depois do ORDER BY final.
  for r in
    select coalesce((select u.email from auth.users u where u.id = ou.auth_user_id),
                    ou.auth_user_id::text)                                  as quem,
           p.nome                                                           as perfil,
           ou.status,
           ou.organizacao_id,
           ou.auth_user_id,
           (select string_agg(
                     pm.chave || '=' ||
                     case when coalesce(
                            (select up.concede from public.usuario_permissoes up
                              where up.usuario_id = ou.id and up.permissao_chave = pm.chave),
                            (select true from public.perfil_permissoes pp
                              where pp.perfil_id = ou.perfil_id and pp.permissao_chave = pm.chave),
                            false)
                          then 'sim' else 'NAO' end, ', ' order by pm.chave)
              from public.permissoes pm
             where pm.chave like 'equipe.%')                                as chaves
      from public.organizacao_usuarios ou
      join public.perfis p on p.id = ou.perfil_id
     order by p.nome
  loop
    insert into conf111 values (10, 'QUEM TEM ACESSO', r.quem,
      'perfil ' || r.perfil || ' | status ' || r.status || ' | ' || coalesce(r.chaves, '(sem chaves)'),
      case when r.organizacao_id <> v_org then 'DE OUTRA ORGANIZACAO'
           when r.auth_user_id = v_org then 'proprietario'
           when r.chaves like '%equipe.folha=NAO%' then 'falta equipe.folha — a tela nao abre nem depois de migrar'
           else '' end);
  end loop;

  -- ═══════════ O ESTRAGO ═══════════
  select count(*) into v_n from public.folhas where nutri_id <> v_org;
  insert into conf111 values (20, 'FOLHAS FORA DA ORGANIZACAO', 'total', v_n::text,
    case when v_n = 0 then 'OK — ninguem chegou a criar folha fantasma'
         else 'FOLHAS FANTASMA — apagar antes de migrar o modulo' end);

  for r in
    select f.id, f.competencia, f.status, f.nutri_id, f.criado_em::date as criada,
           (select count(*) from public.folha_itens i where i.folha_id = f.id) as itens,
           (select u.email from auth.users u where u.id = f.nutri_id)          as dono
      from public.folhas f
     where f.nutri_id <> v_org
     order by f.competencia desc
  loop
    insert into conf111 values (21, 'FOLHAS FORA DA ORGANIZACAO',
      'competencia ' || r.competencia,
      'dono ' || coalesce(r.dono, r.nutri_id::text)
      || ' | status ' || r.status
      || ' | itens ' || r.itens
      || ' | criada ' || r.criada,
      case when r.itens = 0 then 'VAZIA — foi a tela que criou sozinha'
           else 'TEM LANCAMENTO — conferir antes de apagar' end);
    insert into conf111 values (22, 'FOLHAS FORA DA ORGANIZACAO', 'id da folha', r.id::text, '');
  end loop;

  -- A folha do proprietario para o mesmo mes existe? Se sim, a fantasma e
  -- duplicata pura e apagar nao perde nada.
  for r in
    select f.competencia,
           (select count(*) from public.folhas o
             where o.nutri_id = v_org and o.competencia = f.competencia) as tem_a_certa
      from public.folhas f
     where f.nutri_id <> v_org
  loop
    insert into conf111 values (23, 'FOLHAS FORA DA ORGANIZACAO',
      'a folha CERTA de ' || r.competencia || ' existe?',
      case when r.tem_a_certa > 0 then 'sim' else 'NAO' end,
      case when r.tem_a_certa > 0 then 'a fantasma e duplicata — apagar e seguro'
           else 'NAO ha folha da organizacao neste mes — leia a fantasma antes' end);
  end loop;

  -- ═══════════ O MESMO CAMINHO NAS OUTRAS TABELAS ═══════════
  for r in
    select unnest(array['folha_itens','folha_adicionais','funcionarios',
                        'colaborador_documentos']) as t
  loop
    begin
      execute format('select count(*) from public.%I where nutri_id <> $1', r.t)
        into v_n using v_org;
      insert into conf111 values (30, 'OUTRAS TABELAS DO MODULO', r.t, v_n::text,
        case when v_n = 0 then 'OK' else 'linhas de outro dono' end);
    exception when undefined_table or undefined_column then
      insert into conf111 values (30, 'OUTRAS TABELAS DO MODULO', r.t, '-', 'tabela nao existe com este nome');
    end;
  end loop;

  -- ═══════════ A FOLHA QUE VOCE ABRIU ═══════════
  for r in
    select f.competencia, f.status,
           (select count(*) from public.folha_itens i where i.folha_id = f.id) as itens
      from public.folhas f
     where f.nutri_id = v_org
     order by f.competencia desc
     limit 3
  loop
    insert into conf111 values (40, 'AS SUAS FOLHAS', 'competencia ' || r.competencia,
      'status ' || r.status || ' | itens ' || r.itens, '');
  end loop;
end $$;

select ordem, secao, item, valor, resultado from conf111 order by ordem, item;
