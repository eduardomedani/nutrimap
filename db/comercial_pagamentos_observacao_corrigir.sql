-- ===========================================================================
-- Evollo · CONSERTO DA OBSERVACAO EM db/comercial_pagamentos_da_planilha.sql
-- ---------------------------------------------------------------------------
-- POR QUE ESTE ARQUIVO EXISTE. A primeira versao do passo 1 daquele script
-- tinha dois defeitos na coluna `observacoes`. O gerador ja foi corrigido
-- (db/gerador_pagamentos_da_planilha.mjs); isto conserta o que ele gravou
-- antes da correcao, em 31/08/2026.
--
--   1. ROTULO EM DOBRO, em 7 linhas de gateway. A importacao de 05/08/2026 ja
--      guardava "ASAAS", "TON" e "NEXTFIT" crus na observacao. O passo 1
--      anexou "forma: <rotulo>" sem olhar se ele ja estava la, e o resultado
--      ficou "ASAAS · forma: ASAAS".
--
--   2. OBSERVACAO APAGADA, em 8 linhas de pix. O VALUES levava NULL onde o
--      SQL esperava string vazia:
--
--        case when r.obs = '' then observacoes
--             else trim(both ' · ' from coalesce(observacoes,'') || ' · ' || r.obs) end
--
--      Com r.obs NULL, `r.obs = ''` nao da falso — da NULL. O CASE cai no
--      else, a concatenacao com NULL devolve NULL, e a observacao que estivesse
--      la foi substituida por nulo.
--
-- O PASSO 1 DESTE ARQUIVO CONSERTA. O PASSO 2 SO DIAGNOSTICA: o conteudo
-- apagado nao esta em lugar nenhum do repositorio — a observacao das receitas
-- de 'vendas' vem da coluna K da planilha "Vendas" (db/gerador_vendas.mjs), e a
-- planilha "Pagamentos" nao tem essa coluna. Se as 8 tinham texto, ele so volta
-- da planilha "Vendas" ou de um backup do Supabase.
--
-- NAO ALTERA VALOR, DATA, STATUS NEM PERIODO. So a coluna observacoes.
--
-- Cada update leva o estado esperado no WHERE: se voce ja editou a observacao
-- pela tela, a linha nao casa e este script deixa ela em paz.
--
-- Para colar no SQL Editor, use db/comercial_pagamentos_observacao_corrigir_LIMPO.sql
-- ===========================================================================

do $conserta$
declare
  v_dono uuid;
  v_n    int;
  v_dedup int := 0;
  r      record;
begin
  select o.proprietario_user_id into v_dono
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  if v_dono is null then
    raise exception 'Nao encontrei a organizacao principal.';
  end if;

  -- ═══════════════════════════════════════════════════════════
  -- 1) O ROTULO EM DOBRO
  -- -----------------------------------------------------------
  -- Volta para o rotulo cru, que e como as outras 2.200 receitas da mesma
  -- importacao escrevem. A forma_pagamento continua 'outro' — essa parte
  -- estava certa e e o que a coluna sabe dizer.
  -- ═══════════════════════════════════════════════════════════
  for r in
    select * from (values
    (1964, 'ASAAS'),
    (1986, 'ASAAS'),
    (2007, 'ASAAS'),
    (2079, 'NEXTFIT'),
    (2080, 'NEXTFIT'),
    (2119, 'TON'),
    (2127, 'TON')
    ) as t(origem_linha, rotulo)
  loop
    update public.financeiro_lancamentos
       set observacoes = r.rotulo
     where nutri_id = v_dono
       and origem = 'vendas'
       and origem_linha = r.origem_linha
       and observacoes = r.rotulo || ' · forma: ' || r.rotulo;
    get diagnostics v_n = row_count;
    v_dedup := v_dedup + v_n;
  end loop;

  raise notice 'observacoes desduplicadas: % (esperado 7)', v_dedup;
end $conserta$;


-- ===========================================================================
-- 2) DIAGNOSTICO DAS 8 QUE FICARAM NULAS
-- ---------------------------------------------------------------------------
-- Nao ha o que consertar sem a fonte. O que este SELECT responde e QUANTO se
-- perdeu, comparando as 8 com as vizinhas da mesma importacao: se quase nenhuma
-- receita de 'vendas' tem observacao, as 8 provavelmente ja eram nulas e nada
-- se perdeu. Se a maioria tem, vale buscar a coluna K da planilha "Vendas".
-- ===========================================================================
select
  (select count(*) from public.financeiro_lancamentos
    where origem = 'vendas')                                      as receitas_vendas,
  (select count(*) from public.financeiro_lancamentos
    where origem = 'vendas' and observacoes is not null)          as com_observacao,
  (select count(*) from public.financeiro_lancamentos
    where origem = 'vendas' and observacoes is not null
      and origem_linha between 2100 and 2210)                     as com_observacao_perto,
  (select count(*) from public.financeiro_lancamentos
    where origem = 'vendas' and observacoes is null
      and origem_linha in (1634, 2173, 2174, 2175, 2176, 2177, 2178, 2179))
                                                                  as das_oito_ainda_nulas;
