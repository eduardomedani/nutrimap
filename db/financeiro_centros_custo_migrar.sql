-- ===========================================================================
-- Evollo · Financeiro — MOVE os centros de custo para a entidade certa
-- ---------------------------------------------------------------------------
-- ISTO MEXE EM DADO JA IMPORTADO. Esta separado do schema de proposito, para
-- ser rodado e conferido sozinho.
--
-- O QUE ACONTECEU: a importacao de custos.csv leu a coluna "CENTRO DE CUSTO" e
-- gravou aqueles nomes como CATEGORIA. ADMINISTRATIVO, INVESTIMENTO, OBRAS E
-- EXPANSAO e LIMPEZA dizem ONDE o dinheiro foi alocado — nao QUAL e a natureza
-- do gasto. Sao dimensoes diferentes, e ficar so com uma obriga a escolher qual
-- das duas perguntas nunca sera respondida.
--
-- O QUE ESTE ARQUIVO FAZ:
--   1. cria um centro de custo para cada categoria de DESPESA que veio da
--      planilha, com o mesmo nome e a mesma ordem;
--   2. religa cada lancamento ao centro de custo correspondente;
--   3. LIMPA a categoria desses lancamentos — eles passam a ficar "sem
--      categoria" e aparecem no alerta da Visao geral, para voce classificar a
--      NATUREZA (Energia, Contabilidade, Aluguel) na tela;
--   4. apaga as categorias que ficaram vazias.
--
-- POR QUE LIMPAR A CATEGORIA: deixar "ADMINISTRATIVO" nos dois campos criaria
-- duas copias do mesmo dado, que divergem na primeira correcao de um lado so —
-- e o relatorio por categoria continuaria respondendo a pergunta errada, agora
-- com a aparencia de estar certo.
--
-- NENHUM VALOR, DATA OU DESCRICAO E TOCADO. Nenhum lancamento e apagado.
--
-- Requer db/financeiro_despesas_etapa1.sql. Re-executavel.
-- Desfazer: db/financeiro_despesas_etapa1_desfazer.sql
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

do $migrar$
declare
  v_nutri   uuid;
  v_donos   integer;
  r         record;
  v_cc      uuid;
  v_movidos integer;
  v_total   integer := 0;
  v_criados integer := 0;
begin
  select count(distinct nutri_id) into v_donos from public.folhas;

  if auth.uid() is not null then
    v_nutri := auth.uid();
  elsif v_donos = 1 then
    select distinct nutri_id into v_nutri from public.folhas;
  else
    select id into v_nutri from auth.users
     where lower(email) = lower('eduardomedani@natalinossalgados.com.br') limit 1;
  end if;

  if v_nutri is null then
    raise exception 'Nao encontrei o dono dos lancamentos.';
  end if;

  -- So as categorias de DESPESA que a importacao da planilha criou. As de
  -- receita sao pacotes vendidos (Mensal - 5x, Suplemento) — essas sao
  -- natureza de verdade e ficam onde estao.
  for r in
    select c.id, c.nome, c.ordem
      from public.financeiro_categorias c
     where c.nutri_id = v_nutri
       and c.tipo = 'despesa'
       and exists (
         select 1 from public.financeiro_lancamentos l
          where l.categoria_id = c.id and l.origem = 'planilha')
     order by c.ordem, c.nome
  loop
    insert into public.financeiro_centros_custo (nutri_id, nome, ordem, descricao)
    select v_nutri, r.nome, r.ordem,
           'Veio da coluna CENTRO DE CUSTO da planilha de custos.'
     where not exists (
       select 1 from public.financeiro_centros_custo cc
        where cc.nutri_id = v_nutri and lower(cc.nome) = lower(r.nome));

    select id into v_cc from public.financeiro_centros_custo
     where nutri_id = v_nutri and lower(nome) = lower(r.nome);

    if v_cc is null then
      raise notice 'PULADO  "%" — nao consegui criar o centro de custo', r.nome;
      continue;
    end if;
    v_criados := v_criados + 1;

    update public.financeiro_lancamentos
       set centro_custo_id = v_cc,
           categoria_id    = null,
           atualizado_em   = now()
     where nutri_id = v_nutri and categoria_id = r.id;
    get diagnostics v_movidos = row_count;
    v_total := v_total + v_movidos;

    raise notice 'CENTRO DE CUSTO  "%"  (% lancamento(s))', r.nome, v_movidos;
  end loop;

  -- As categorias que ficaram sem nenhum lancamento. So estas: uma categoria
  -- que voce ja tenha usado a mao continua de pe.
  delete from public.financeiro_categorias c
   where c.nutri_id = v_nutri
     and c.tipo = 'despesa'
     and not exists (
       select 1 from public.financeiro_lancamentos l where l.categoria_id = c.id);

  raise notice '---';
  raise notice '% centro(s) de custo, % lancamento(s) religado(s)', v_criados, v_total;
  raise notice 'Os lancamentos ficaram SEM CATEGORIA de proposito — classifique a natureza na tela.';
end $migrar$;


-- ===========================================================================
-- Conferencia. Esperado: 12 centros de custo somando R$ 313.999,78, e as
-- categorias de despesa da planilha nao devem mais aparecer.
-- ===========================================================================
select
  cc.nome                     as centro_de_custo,
  count(l.id)                 as lancamentos,
  coalesce(sum(l.valor), 0)   as total
from public.financeiro_centros_custo cc
left join public.financeiro_lancamentos l on l.centro_custo_id = cc.id
group by cc.nome
order by coalesce(sum(l.valor), 0) desc;
