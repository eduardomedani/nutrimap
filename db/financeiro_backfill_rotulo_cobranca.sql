-- ===========================================================================
-- Evollo · O QUE JA ESTA GRAVADO GANHA O ROTULO NOVO
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE. Tem desfazer:
-- db/financeiro_backfill_rotulo_cobranca_desfazer.sql
--
-- Requer db/comercial_rotulo_da_cobranca.sql (e dele que vem o resolvedor de
-- categoria). 100% re-executavel.
--
-- A migration anterior mudou como a cobranca NASCE. Este cuida das que ja
-- existem: tira o "<plano> — " da frente da descricao e poe o plano na
-- categoria, quando ela estiver vazia.
--
-- Sem isto a lista do Financeiro fica com dois formatos convivendo — as
-- antigas com o plano no nome, as novas sem —, que e pior do que qualquer um
-- dos dois sozinho.
--
-- ===========================================================================
-- SIM, ELE MEXE EM LANCAMENTO PAGO
-- ---------------------------------------------------------------------------
-- E deliberado, e o limite esta em ONDE ele mexe: `descricao` e `categoria_id`
-- sao ROTULO. Valor, data, competencia, vencimento, pago_em e status — tudo o
-- que e dinheiro ou prazo — nao sao tocados por este script. Renomear uma
-- receita paga nao muda um centavo de nenhum relatorio; muda como ela aparece
-- na lista e em que grupo ela soma.
--
-- A DESCRICAO VELHA E GUARDADA em `metadata.descricao_anterior` antes da
-- troca. E o que permite o desfazer devolver o texto exato, em vez de tentar
-- remontar "<plano> — <nome>" e errar em quem tinha descricao escrita a mao.
--
-- ===========================================================================
-- SO O QUE TEM O PREFIXO DO PROPRIO PLANO
-- ---------------------------------------------------------------------------
-- O `where` nao corta qualquer coisa antes de um travessao: exige que o
-- comeco da descricao seja exatamente o nome do plano DAQUELA assinatura,
-- seguido de " — ". Assim uma descricao escrita a mao ("Mensalidade + avaliacao
-- — Fulano") nao e mutilada, e quem ja esta no formato novo nao e tocado.
--
-- A categoria so e preenchida onde esta VAZIA. Se alguem classificou a receita
-- na mao, essa escolha vale mais do que o plano do contrato.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/financeiro_backfill_rotulo_cobranca_LIMPO.sql
-- ===========================================================================

do $backfill$
declare
  v_org uuid;
  v_n   int;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  if v_org is null then
    raise exception 'organizacao nao encontrada — nada foi tocado';
  end if;

  -- ── 0) a dependencia ───────────────────────────────────────
  -- O passo 2 chama `comercial_categoria_do_plano`, que nasce no script
  -- anterior. Sem esta trava, o Postgres so reclama la embaixo, com
  -- "function does not exist" e um CONTEXT de numero de linha — e quem le nao
  -- descobre por essa mensagem que faltou rodar OUTRO arquivo.
  --
  -- A ordem importa e o bloco e transacional: rodar este primeiro nao suja
  -- nada (o passo 1 volta atras junto com o erro), mas custa uma ida ao banco
  -- para descobrir o obvio.
  if to_regprocedure('public.comercial_categoria_do_plano(uuid,uuid)') is null then
    raise exception 'rode db/comercial_rotulo_da_cobranca.sql ANTES deste — e ele que cria comercial_categoria_do_plano(). Nada foi tocado.';
  end if;

  -- ── 1) a descricao ─────────────────────────────────────────
  with alvo as (
    select l.id,
           l.descricao                          as antiga,
           btrim(substr(l.descricao, length(pl.nome) + 4)) as nova
      from public.financeiro_lancamentos l
      join public.comercial_assinaturas a  on a.id = l.assinatura_id
      join public.comercial_planos      pl on pl.id = a.plano_id
     where l.nutri_id = v_org
       and l.tipo = 'receita'
       and l.descricao like pl.nome || ' — %'
  )
  update public.financeiro_lancamentos l
     set descricao     = alvo.nova,
         atualizado_em = now(),
         metadata      = coalesce(l.metadata, '{}'::jsonb)
                         || jsonb_build_object('descricao_anterior', alvo.antiga)
    from alvo
   where l.id = alvo.id
     and nullif(btrim(alvo.nova), '') is not null;

  get diagnostics v_n = row_count;
  raise notice 'descricoes trocadas: %', v_n;

  -- ── 2) a categoria, so onde falta ──────────────────────────
  update public.financeiro_lancamentos l
     set categoria_id  = public.comercial_categoria_do_plano(l.nutri_id, a.plano_id),
         atualizado_em = now()
    from public.comercial_assinaturas a
   where a.id = l.assinatura_id
     and l.nutri_id = v_org
     and l.tipo = 'receita'
     and l.categoria_id is null
     and a.plano_id is not null;

  get diagnostics v_n = row_count;
  raise notice 'categorias preenchidas: %', v_n;
end $backfill$;


-- ===========================================================================
-- CONFERENCIA. Esperado: com_prefixo = 0 · sem_categoria = 0
-- ---------------------------------------------------------------------------
-- `sem_categoria` conta so as cobrancas de assinatura COM plano — as sem plano
-- continuam sem categoria de proposito.
-- ===========================================================================
select
  (select count(*) from public.financeiro_lancamentos l
     join public.comercial_assinaturas a  on a.id = l.assinatura_id
     join public.comercial_planos      pl on pl.id = a.plano_id
    where l.tipo = 'receita' and l.descricao like pl.nome || ' — %')  as com_prefixo,
  (select count(*) from public.financeiro_lancamentos l
     join public.comercial_assinaturas a on a.id = l.assinatura_id
    where l.tipo = 'receita' and l.categoria_id is null
      and a.plano_id is not null)                                     as sem_categoria;
