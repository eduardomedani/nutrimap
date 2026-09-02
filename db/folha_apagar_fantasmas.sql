-- ===========================================================================
-- Evollo · APAGAR AS FOLHAS FANTASMA
-- ---------------------------------------------------------------------------
-- 100% re-executavel. Rodar de novo depois de limpo nao apaga mais nada.
--
-- O QUE E UMA FOLHA FANTASMA. O modulo Equipe ainda esta em
-- `nutri_id = auth.uid()` (a Etapa 4B migrou Comercial, Financeiro e pacientes;
-- Equipe ficou para a 4C). Quando um membro que nao e o proprietario abre a
-- tela de Folha:
--
--   1. `buscarFolhaPorCompetencia` (js/folha.js) nao filtra nada — confia na
--      RLS. Para quem nao e o dono, devolve zero linhas.
--   2. `abrirFolha` le esse zero como "a folha do mes ainda nao existe" e chama
--      `criarFolha(nutriId, competencia)` com o uuid da PESSOA, que veio de
--      `initEquipeUI(sessao.user.id)` em index.html.
--   3. A policy de insert e `with check (nutri_id = auth.uid())`. Passa.
--   4. `uniq_folhas_competencia` e `(nutri_id, competencia)`, e nao
--      `(competencia)`. Nao colide com a folha do proprietario.
--
-- Nasce uma segunda folha do mesmo mes, vazia, no nome de quem abriu a tela.
-- Invisivel para o proprietario e invisivel para ela na visita seguinte,
-- porque o ciclo se repete.
--
-- POR QUE APAGAR ANTES DA 4C. Depois que o modulo migrar para
-- `organizacao_do_auth()`, essas linhas nao vao pertencer a organizacao
-- nenhuma: somem da tela para todos e continuam no banco, sem aparecer em lugar
-- algum. E o mesmo caso do paciente orfao que barrou a 4B
-- (db/conferencia/109 e 110).
--
-- ===========================================================================
-- AS QUATRO TRAVAS DO DELETE
-- ---------------------------------------------------------------------------
-- Apagar folha de pagamento e coisa seria. Este script so remove a linha que
-- satisfaz TODAS as condicoes abaixo — nao ha uuid escrito a mao, e e por isso
-- que ele serve tambem para qualquer fantasma nova que aparecer ate a 4C:
--
--   1. `nutri_id` NAO e a organizacao          -> nao e uma folha nossa
--   2. `status = 'rascunho'`                   -> folha fechada nunca e tocada
--   3. ZERO itens                              -> ninguem lancou nada nela
--   4. a folha da ORGANIZACAO para a MESMA competencia EXISTE
--                                              -> a de verdade esta a salvo
--
-- A quarta e a que importa mais. Sem ela, um mes em que so exista a fantasma
-- seria apagado — e com ele o unico registro de que alguem tentou abrir aquele
-- mes. Se algum dia isso acontecer, o script deixa a linha viva e ela aparece
-- em db/conferencia/111 para decisao humana.
--
-- NAO HA DESFAZER, e nao faz falta: o que se apaga aqui e um rascunho vazio
-- criado por engano. Recria-lo seria recriar o proprio defeito.
-- ===========================================================================

do $fantasmas$
declare
  v_org uuid;
  v_n   int;
  r     record;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  if v_org is null then
    raise exception 'Nao encontrei a organizacao principal.';
  end if;

  -- Diz o que vai sair ANTES de sair. Se o SQL Editor nao mostrar NOTICE, a
  -- conferencia no fim do arquivo mostra o resultado.
  for r in
    select f.id, f.competencia,
           (select u.email from auth.users u where u.id = f.nutri_id) as dono
      from public.folhas f
     where f.nutri_id <> v_org
       and f.status = 'rascunho'
       and not exists (select 1 from public.folha_itens i where i.folha_id = f.id)
       and exists (select 1 from public.folhas o
                    where o.nutri_id = v_org and o.competencia = f.competencia)
  loop
    raise notice 'apagando fantasma: % de % (dono %)', r.id, r.competencia, r.dono;
  end loop;

  delete from public.folhas f
   where f.nutri_id <> v_org
     and f.status = 'rascunho'
     and not exists (select 1 from public.folha_itens i where i.folha_id = f.id)
     and exists (select 1 from public.folhas o
                  where o.nutri_id = v_org and o.competencia = f.competencia);
  get diagnostics v_n = row_count;

  raise notice 'folhas fantasma apagadas: %', v_n;

  -- O que sobrou fora da organizacao e o que NAO satisfez as travas. Se houver,
  -- e decisao humana — nao invente regra nova aqui.
  select count(*) into v_n from public.folhas where nutri_id <> v_org;
  if v_n > 0 then
    raise notice 'ATENCAO: % folha(s) fora da organizacao NAO foram apagadas. Rode db/conferencia/111 e decida uma a uma.', v_n;
  end if;
end $fantasmas$;


-- ===========================================================================
-- Conferencia. Esperado:
--   fantasmas_restantes = 0
--   folhas_da_organizacao = as suas, intocadas (3 hoje: 07, 08 e 09/2026)
--   itens_da_organizacao  = intocados
-- ===========================================================================
select
  (select count(*) from public.folhas f
    where f.nutri_id <> (select o.id from public.organizacoes o
                          join public.admins a on a.user_id = o.proprietario_user_id))
                                                                    as fantasmas_restantes,
  (select count(*) from public.folhas f
    where f.nutri_id = (select o.id from public.organizacoes o
                         join public.admins a on a.user_id = o.proprietario_user_id))
                                                                    as folhas_da_organizacao,
  (select count(*) from public.folha_itens)                         as itens_da_organizacao,
  (select count(*) from public.folhas where status = 'fechada')     as folhas_fechadas;
