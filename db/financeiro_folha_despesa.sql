-- ===========================================================================
-- Evollo · Financeiro — A FOLHA FECHADA VIRA DESPESA
-- ---------------------------------------------------------------------------
-- Fechar a folha de uma competencia passa a criar, no caixa da empresa, uma
-- despesa chamada "Folha de Pagamento - <Mes> de <Ano>". Reabrir a folha
-- CANCELA essa despesa; fechar de novo a recria com o valor novo.
--
-- ===========================================================================
-- ISTO CONTRARIA UMA DECISAO ANTERIOR — E ESTA E A PARTE QUE IMPORTA
-- ---------------------------------------------------------------------------
-- db/financeiro_lancamentos.sql diz, no cabecalho: "NAO e a folha de pagamento
-- (...) o Financeiro LE aquele numero em vez de guardar uma segunda copia
-- dele". A razao era boa: 88 linhas de FOPAG vieram da planilha de custos e,
-- importadas, o custo de equipe existiria em dois lugares — que divergem no
-- primeiro mes em que alguem corrige um lado so.
--
-- O QUE MUDA E DE ONDE VEM A COPIA. Aquelas 88 linhas eram digitadas a mao,
-- numa planilha, sem nenhum vinculo com a apuracao. A linha que este arquivo
-- cria e GERADA a partir da folha, tem `folha_id` apontando para ela, e o valor
-- e recalculado toda vez que a folha fecha. Nao ha um segundo numero para
-- corrigir: ha um espelho, e o espelho se refaz.
--
-- O QUE IMPEDE A DUPLA CONTAGEM. Sao duas travas, uma no banco e uma na tela:
--
--   . no banco, `uniq_financeiro_lancamentos_folha` garante UM lancamento por
--     folha. Fechar duas vezes atualiza; nunca cria a segunda linha.
--   . na tela, js/financeiro.js le a folha de cada mes por
--     `folhaDoPeriodo()`: onde HA lancamento, ele manda e a view
--     `folha_resumo_mensal` e ignorada; onde NAO ha (folha em rascunho, ou
--     fechada antes desta migration), vale a apuracao. As duas nunca somam
--     juntas o mesmo mes.
--
-- A folha continua sendo apurada em folhas/folha_itens. Este lancamento nao e
-- fonte de nada: e o registro, no caixa, de um dinheiro que a folha ja sabia.
--
-- E HA UMA TERCEIRA FONTE, mais velha que as duas: as FOPAG da planilha de
-- despesas (out/2023 a mai/2026), importadas com `metadata.folha` por
-- db/gerador_custos.mjs. Onde ela existe, ela manda — a funcao abaixo nao cria
-- espelho, e o front trata a linha importada como folha, nao como despesa de
-- operacao. A ordem de precedencia e uma so, em todo lugar: planilha, depois
-- lancamento, depois apuracao.
--
-- ===========================================================================
-- POR QUE UMA RPC, E NAO UM INSERT DA TELA
-- ---------------------------------------------------------------------------
-- Quem fecha a folha tem `equipe.folha`. Nao necessariamente tem
-- `financeiro.lancar` — e nao deveria precisar: a gerente que fecha o mes nao
-- ganha, por causa disso, o direito de cadastrar despesa no caixa.
--
-- Com um insert direto da tela, a policy
-- `financeiro_lancamentos_insert` recusaria, e a folha fecharia sem aparecer no
-- Financeiro — em silencio, que e o pior dos resultados.
--
-- A funcao resolve isso do jeito estreito: exige `equipe.folha`, escreve UMA
-- linha cujos campos sao todos ditados pela folha (descricao, valor,
-- competencia, data), e nao aceita nenhum valor de quem chama alem do id da
-- folha. Nao e "permissao de lancar despesa"; e "permissao de espelhar a folha
-- que voce ja podia fechar".
--
-- Requer: db/financeiro_despesas_etapa1.sql (status, pago_em, vencimento),
--         db/folha_schema.sql, db/organizacao_schema.sql (tem_permissao).
-- 100% re-executavel. Desfazer: db/financeiro_folha_despesa_desfazer.sql
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================


-- ===========================================================================
-- 1) A coluna que liga o lancamento a folha
-- ---------------------------------------------------------------------------
-- `on delete set null` e nao `cascade`: apagar a competencia nao pode apagar,
-- por tabela, uma despesa que ja esta no caixa e talvez ja tenha sido
-- conciliada com o extrato. A linha perde o vinculo, guarda `origem = 'folha'`
-- e continua contando pela competencia que ja tem gravada.
-- ===========================================================================
alter table public.financeiro_lancamentos
  add column if not exists folha_id uuid references public.folhas(id) on delete set null;

-- UMA folha, UM lancamento. E esta a trava que torna "fechar de novo" seguro:
-- a funcao abaixo procura por `folha_id` e atualiza o que achar.
create unique index if not exists uniq_financeiro_lancamentos_folha
  on public.financeiro_lancamentos (folha_id)
  where folha_id is not null;

-- A marca de origem ganha o quarto valor. Sem isto o insert da funcao esbarra
-- no CHECK. O mesmo valor foi acrescentado em db/financeiro_lancamentos.sql,
-- que e a fonte canonica da constraint: reexecutar aquele arquivo depois deste
-- nao pode derrubar a marca nova.
alter table public.financeiro_lancamentos drop constraint if exists financeiro_lancamentos_origem_check;
alter table public.financeiro_lancamentos add  constraint financeiro_lancamentos_origem_check
  check (origem in ('manual', 'planilha', 'vendas', 'folha'));


-- ===========================================================================
-- 2) financeiro_folha_sincronizar — a regra, sem checagem de quem chama
-- ---------------------------------------------------------------------------
-- INTERNA. Nao e para ser chamada pelo app: o EXECUTE e revogado logo abaixo, e
-- quem entra pela porta da frente e `financeiro_lancar_folha`, que valida a
-- sessao antes. Ela existe separada por um motivo pratico: o backfill da secao
-- 4 roda no SQL Editor, onde `auth.uid()` e nulo e toda validacao de sessao
-- falharia — e duplicar a regra de montagem em dois lugares seria criar as duas
-- versoes que um dia discordam.
--
-- O ESTADO DA FOLHA DECIDE TUDO. Fechada, o lancamento existe e vale;
-- rascunho, ele e cancelado. Nao ha um terceiro caminho, e por isso reabrir e
-- fechar quantas vezes for preciso sempre converge para o mesmo lugar.
--
-- CANCELAR EM VEZ DE APAGAR ao reabrir: cancelado sai dos totais (a view e
-- `contaNoTotal()` o excluem) e continua na lista com o rotulo. Apagar levaria
-- junto a informacao de que aquele mes chegou a ser fechado.
-- ===========================================================================
create or replace function public.financeiro_folha_sincronizar(p_folha_id uuid)
returns table (lancamento_id uuid, acao text, descricao text, valor numeric, status text)
language plpgsql
security definer
set search_path = public
as $fn$
-- AS COLUNAS DE RETORNO SAO VARIAVEIS AQUI DENTRO. `returns table (... descricao,
-- valor, status)` declara tres nomes que TAMBEM sao colunas de
-- financeiro_lancamentos, e o plpgsql, por padrao, aborta com "column reference
-- is ambiguous" na primeira referencia nao qualificada. Toda referencia abaixo e
-- qualificada por alias; esta diretiva e o cinto: onde um nome puder ser os
-- dois, vale a COLUNA, que e o que se quer em todos os casos.
#variable_conflict use_column
declare
  -- Os nomes dos meses moram aqui porque `to_char(..., 'TMMonth')` depende do
  -- lc_time do servidor: no Supabase ele e ingles, e a despesa nasceria
  -- "Folha de Pagamento - September de 2026". O mesmo array esta em
  -- js/folha.js (MESES), e test/folha-despesa.test.mjs compara os dois.
  v_meses text[] := array['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                          'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  f          public.folhas%rowtype;
  v_total    numeric(12,2);
  v_desc     text;
  v_cat      uuid;
  v_id       uuid;
  v_status   text;
  v_data     date;
begin
  select * into f from public.folhas where id = p_folha_id;
  if not found then
    raise exception 'folha nao encontrada' using errcode = 'P0002';
  end if;

  select id into v_id from public.financeiro_lancamentos where folha_id = f.id;

  -- ── Folha em rascunho: o espelho, se existir, e cancelado ──────────────
  if f.status <> 'fechada' then
    -- Nenhuma linha de volta quando nao ha espelho: rascunho que nunca fechou
    -- nao tem nada a cancelar, e devolver uma linha de nulos obrigaria quem
    -- chama a distinguir "nada a fazer" de "cancelei" pelo conteudo.
    if v_id is null then return; end if;
    update public.financeiro_lancamentos as l
       set status = 'cancelado', atualizado_em = now()
     where l.id = v_id and l.status <> 'cancelado';
    return query
      select l.id, 'cancelado'::text, l.descricao, l.valor, l.status
        from public.financeiro_lancamentos l where l.id = v_id;
    return;
  end if;

  -- ── A PLANILHA MANDA NO PASSADO ────────────────────────────────────────
  -- As FOPAG de out/2023 a mai/2026 vieram da planilha de despesas
  -- (db/gerador_custos.mjs), marcadas em `metadata.folha`. Onde ela ja
  -- respondeu pela competencia, o espelho NAO entra: dois lancamentos de folha
  -- no mesmo mes contariam o mesmo pagamento duas vezes, e a planilha e a fonte
  -- que o dono confere.
  --
  -- Um espelho que porventura ja exista naquela competencia e cancelado, nao
  -- apagado — pode ter nascido de um backfill rodado antes da importacao.
  if exists (
    select 1 from public.financeiro_lancamentos l
     where l.nutri_id    = f.nutri_id
       and l.tipo        = 'despesa'
       and l.competencia = f.competencia
       and l.origem      = 'planilha'
       and l.metadata ->> 'folha' = 'true'
       and l.status <> 'cancelado')
  then
    if v_id is not null then
      update public.financeiro_lancamentos as l
         set status = 'cancelado', atualizado_em = now()
       where l.id = v_id and l.status <> 'cancelado';
    end if;
    return query select v_id, 'planilha'::text, null::text, null::numeric, null::text;
    return;
  end if;

  -- ── Folha fechada: o espelho nasce ou se atualiza ──────────────────────
  -- base + adicionais de cada linha, que e a mesma soma de folha_resumo_mensal
  -- e de totalFolha() no navegador. Adicional NEGATIVO (desconto de ferias, no
  -- historico) reduz o total, como reduz o Pix.
  select coalesce(sum(
           i.valor_base + coalesce((select sum(a.valor)
                                      from public.folha_adicionais a
                                     where a.item_id = i.id), 0)), 0)
    into v_total
    from public.folha_itens i
   where i.folha_id = f.id;

  v_desc := 'Folha de Pagamento - '
         || v_meses[extract(month from f.competencia)::int]
         || ' de ' || extract(year from f.competencia)::int;

  -- A categoria nasce sozinha na primeira vez. Deixar a despesa sem categoria
  -- a jogaria na pendencia "sem categoria" da Visao geral todo mes — um alerta
  -- que ninguem pode resolver, porque a linha e gerada.
  select c.id into v_cat
    from public.financeiro_categorias c
   where c.nutri_id = f.nutri_id and c.tipo = 'despesa'
     and lower(c.nome) = 'folha de pagamento';
  if v_cat is null then
    insert into public.financeiro_categorias (nutri_id, nome, tipo)
    values (f.nutri_id, 'Folha de Pagamento', 'despesa')
    on conflict do nothing;
    select c.id into v_cat
      from public.financeiro_categorias c
     where c.nutri_id = f.nutri_id and c.tipo = 'despesa'
       and lower(c.nome) = 'folha de pagamento';
  end if;

  -- SEM DATA DE PAGAMENTO A DESPESA NASCE PENDENTE, e sem vencimento. Fechar a
  -- folha sem informar o dia e possivel (o campo aceita vazio), e carimbar
  -- `pago_em = hoje` poria no fluxo de caixa uma data que ninguem informou.
  -- Pendente sem vencimento e exatamente o que a linha e, e a tela ja sabe
  -- contar isso como pendencia em vez de esconde-la.
  v_status := case when f.data_pagamento is null then 'pendente' else 'pago' end;
  v_data   := coalesce(f.data_pagamento, f.competencia);

  if v_id is null then
    insert into public.financeiro_lancamentos
      (nutri_id, tipo, data, competencia, descricao, valor, categoria_id,
       status, pago_em, origem, folha_id)
    values
      (f.nutri_id, 'despesa', v_data, f.competencia, v_desc, v_total, v_cat,
       v_status, f.data_pagamento, 'folha', f.id)
    returning id into v_id;

    return query
      select l.id, 'criado'::text, l.descricao, l.valor, l.status
        from public.financeiro_lancamentos l where l.id = v_id;
    return;
  end if;

  -- ATUALIZA SO O QUE A FOLHA DITA. `observacoes`, `centro_custo_id`,
  -- `forma_pagamento` e `documento` ficam de fora de proposito: sao campos que
  -- alguem pode ter preenchido no Financeiro, e refazer o espelho nao pode
  -- apagar o trabalho de quem classificou a linha.
  update public.financeiro_lancamentos as l
     set descricao     = v_desc,
         valor         = v_total,
         competencia   = f.competencia,
         data          = v_data,
         status        = v_status,
         pago_em       = f.data_pagamento,
         categoria_id  = coalesce(l.categoria_id, v_cat),
         atualizado_em = now()
   where l.id = v_id;

  return query
    select l.id, 'atualizado'::text, l.descricao, l.valor, l.status
      from public.financeiro_lancamentos l where l.id = v_id;
end;
$fn$;

revoke all on function public.financeiro_folha_sincronizar(uuid) from public;
revoke all on function public.financeiro_folha_sincronizar(uuid) from anon, authenticated;


-- ===========================================================================
-- 3) financeiro_lancar_folha — a porta da frente
-- ---------------------------------------------------------------------------
-- O que ela concede, dito por inteiro: quem tem `equipe.folha` passa a poder
-- criar e cancelar UMA despesa por folha da propria organizacao, sem escolher
-- nenhum campo dela. Nao ganha leitura do caixa (isso e
-- `financeiro.visualizar`), nao ganha edicao de outras despesas, e nao alcanca
-- folha de outra organizacao — a checagem de `nutri_id` esta abaixo, e vale
-- mesmo com a RLS desligada por causa do security definer.
-- ===========================================================================
create or replace function public.financeiro_lancar_folha(p_folha_id uuid)
returns table (lancamento_id uuid, acao text, descricao text, valor numeric, status text)
language plpgsql
security definer
set search_path = public
as $fn$
-- AS COLUNAS DE RETORNO SAO VARIAVEIS AQUI DENTRO. `returns table (... descricao,
-- valor, status)` declara tres nomes que TAMBEM sao colunas de
-- financeiro_lancamentos, e o plpgsql, por padrao, aborta com "column reference
-- is ambiguous" na primeira referencia nao qualificada. Toda referencia abaixo e
-- qualificada por alias; esta diretiva e o cinto: onde um nome puder ser os
-- dois, vale a COLUNA, que e o que se quer em todos os casos.
#variable_conflict use_column
declare
  v_org  uuid;
  v_dono uuid;
begin
  if auth.uid() is null then
    raise exception 'sem sessao' using errcode = '42501';
  end if;

  v_org := public.organizacao_do_auth();
  if v_org is null then
    raise exception 'sem organizacao' using errcode = '42501';
  end if;

  if not public.tem_permissao('equipe.folha') then
    raise exception 'sem permissao equipe.folha' using errcode = '42501';
  end if;

  select f.nutri_id into v_dono from public.folhas f where f.id = p_folha_id;
  if v_dono is null then
    raise exception 'folha nao encontrada' using errcode = 'P0002';
  end if;
  if v_dono <> v_org then
    raise exception 'folha de outra organizacao' using errcode = '42501';
  end if;

  return query select * from public.financeiro_folha_sincronizar(p_folha_id);
end;
$fn$;

grant execute on function public.financeiro_lancar_folha(uuid) to authenticated;


-- ===========================================================================
-- 4) O que ja estava fechado antes desta migration
-- ---------------------------------------------------------------------------
-- Roda uma vez por folha FECHADA que ainda nao tem espelho. Idempotente: a
-- funcao procura por `folha_id` e, achando, atualiza em vez de duplicar —
-- reexecutar este arquivo inteiro nao cria uma segunda linha de mes nenhum.
--
-- NAO DUPLICA COM O QUE JA SE VIA NA TELA: onde ha lancamento, a apuracao para
-- de ser somada (`folhaDoPeriodo()` em js/financeiro.js). O total do mes
-- continua o mesmo depois deste bloco; o que muda e de onde ele vem.
--
-- Folha em rascunho NAO entra: ela ainda nao e despesa, e continua aparecendo
-- pela apuracao, como sempre apareceu.
-- ===========================================================================
do $$
declare
  r record;
begin
  for r in select id from public.folhas where status = 'fechada' order by competencia
  loop
    perform public.financeiro_folha_sincronizar(r.id);
  end loop;
end;
$$;


-- ===========================================================================
-- Conferencia. Esperado: uma linha por folha fechada, nenhuma folha fechada
-- sem espelho, nenhuma competencia com dois espelhos, e a soma dos espelhos
-- igual a soma apurada das mesmas competencias (a diferenca tem que ser 0,00).
-- ===========================================================================
select
  (select count(*) from public.folhas where status = 'fechada')                  as folhas_fechadas,
  (select count(*) from public.financeiro_lancamentos where origem = 'folha')    as espelhos,
  (select count(*) from public.folhas f
    where f.status = 'fechada'
      and not exists (select 1 from public.financeiro_lancamentos l
                       where l.folha_id = f.id))                                 as fechadas_sem_espelho,
  (select count(*) from (
     select folha_id from public.financeiro_lancamentos
      where folha_id is not null group by folha_id having count(*) > 1) x)       as folhas_com_dois,
  (select to_char(coalesce(sum(l.valor), 0) - coalesce((
     select sum(m.total) from public.folha_resumo_mensal m
      join public.folhas f2 on f2.competencia = m.competencia and f2.nutri_id = m.nutri_id
     where f2.status = 'fechada'), 0), 'FM999G999G990D00')
     from public.financeiro_lancamentos l where l.origem = 'folha')              as diferenca;
