-- ===========================================================================
-- O QUE, DE FATO, HA NA OBSERVACAO DAS RECEITAS DE 'VENDAS'
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- POR QUE ESTE SCRIPT EXISTE. Em 31/08/2026, 8 receitas tiveram a observacao
-- apagada por um defeito no passo 1 de db/comercial_pagamentos_da_planilha.sql
-- (a causa esta em db/comercial_pagamentos_observacao_corrigir.sql). O
-- diagnostico de la disse que 94% das receitas de 'vendas' tem observacao, e a
-- conclusao foi "as 8 tinham texto, e ele so volta da planilha".
--
-- Essa conclusao pode estar errada, e vale medir antes de mandar alguem
-- garimpar 8 celulas numa planilha de 2.179 linhas. As observacoes que
-- sobreviveram nas linhas vizinhas sao "ASAAS", "NEXTFIT" e "TON" — o ROTULO DA
-- FORMA DE PAGAMENTO, e nao uma nota livre. Se a coluna K da planilha "Vendas"
-- era so isso, entao:
--
--   - ou as 8 (todas pix) tinham "PIX" escrito ali, e restaurar e trivial;
--   - ou pix nao escrevia nada, as 8 ja eram nulas, e nao se perdeu nada.
--
-- Qualquer um dos dois encerra o assunto sem abrir a planilha. O que NAO se
-- pode fazer e decidir isso no chute: se houver nota de verdade no meio
-- ("pagou metade", "transferiu do irmao"), a perda e real e a planilha e o
-- unico lugar de onde ela volta.
--
-- COMO LER:
--
--   FORMATO / distintas
--       quantos textos diferentes existem. Um punhado -> e coluna de rotulo.
--       Centenas -> e nota livre, escrita a mao, e cada uma e unica.
--
--   MAIS COMUNS
--       as 20 mais repetidas, com quantas vezes cada uma aparece. Se as
--       primeiras somarem quase tudo, o campo e rotulo.
--
--   PIX EXISTE COMO OBSERVACAO?
--       a pergunta que decide o caso das 8. Se sim, elas diziam "PIX".
--
--   FORA DO PADRAO
--       as que NAO sao um dos rotulos conhecidos. Sao as notas de verdade. Se
--       aparecer alguma na faixa 2170..2180, as vizinhas das apagadas tinham
--       nota livre, e o argumento acima cai.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/108_o_que_ha_na_observacao_das_vendas_LIMPO.sql
-- ===========================================================================

drop table if exists conf108;
create temp table conf108 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_dono uuid;
  v_n    int;
  v_tot  int;
  r      record;
  -- Os rotulos que a coluna de forma de pagamento da planilha usa. O que nao
  -- estiver aqui e candidato a nota de verdade.
  v_rotulos text[] := array['pix', 'dinheiro', 'asaas', 'ton', 'nextfit',
                            'cartao', 'cartão', 'credito', 'crédito',
                            'debito', 'débito', 'boleto', 'transferencia',
                            'transferência'];
begin
  select o.proprietario_user_id into v_dono
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  select count(*) into v_tot
    from public.financeiro_lancamentos
   where nutri_id = v_dono and origem = 'vendas' and observacoes is not null;

  -- ═══════════ FORMATO ═══════════
  insert into conf108 values (10, 'FORMATO', 'com observacao', v_tot::text, '');

  select count(distinct lower(trim(observacoes))) into v_n
    from public.financeiro_lancamentos
   where nutri_id = v_dono and origem = 'vendas' and observacoes is not null;
  -- O veredito sai da RAZAO distintos/total, e nao de um numero fixo de textos
  -- distintos. Um limiar fixo errou aqui: 64 distintos parecem muitos, mas em
  -- 2.113 linhas sao 3% — cada texto se repete 33 vezes, que e cara de rotulo,
  -- nao de nota escrita a mao.
  insert into conf108 values (11, 'FORMATO', 'textos distintos', v_n::text,
    case when v_tot = 0 then ''
         when v_n * 10 <= v_tot then 'e coluna de ROTULO — cada texto se repete '
                                     || round(v_tot::numeric / v_n) || ' vezes'
         else 'e NOTA LIVRE — quase cada linha tem a sua' end);

  select round(avg(length(observacoes))) into v_n
    from public.financeiro_lancamentos
   where nutri_id = v_dono and origem = 'vendas' and observacoes is not null;
  insert into conf108 values (12, 'FORMATO', 'tamanho medio do texto', v_n::text,
    case when v_n <= 12 then 'curto, cara de rotulo' else 'longo, cara de frase' end);

  -- ═══════════ MAIS COMUNS ═══════════
  for r in
    select lower(trim(observacoes)) as texto, count(*) as q
      from public.financeiro_lancamentos
     where nutri_id = v_dono and origem = 'vendas' and observacoes is not null
     group by 1
     order by 2 desc, 1
     limit 20
  loop
    insert into conf108 values (20, 'MAIS COMUNS', r.texto, r.q::text,
      round(100.0 * r.q / nullif(v_tot, 0), 1) || '% das que tem observacao');
  end loop;

  -- ═══════════ PIX EXISTE COMO OBSERVACAO? ═══════════
  select count(*) into v_n
    from public.financeiro_lancamentos
   where nutri_id = v_dono and origem = 'vendas'
     and lower(trim(observacoes)) = 'pix';
  insert into conf108 values (30, 'PIX', 'receitas com observacao = pix', v_n::text,
    case when v_n > 0 then 'AS 8 APAGADAS DIZIAM "PIX" — restaurar e trivial'
         else 'pix nao escrevia observacao; as 8 podem ja ser nulas' end);

  -- Quantas receitas de vendas NAO tem observacao? Se forem muitas, o campo
  -- vazio e comum e as 8 nao eram excecao.
  select count(*) into v_n
    from public.financeiro_lancamentos
   where nutri_id = v_dono and origem = 'vendas' and observacoes is null;
  insert into conf108 values (31, 'PIX', 'receitas de vendas SEM observacao', v_n::text,
    'inclui as 8 apagadas');

  -- ═══════════ FORA DO PADRAO — as notas de verdade ═══════════
  select count(*) into v_n
    from public.financeiro_lancamentos
   where nutri_id = v_dono and origem = 'vendas'
     and observacoes is not null
     and lower(trim(observacoes)) <> all (v_rotulos);
  insert into conf108 values (40, 'FORA DO PADRAO', 'observacoes que nao sao rotulo', v_n::text,
    case when v_n = 0 then 'a coluna e SO rotulo — nada de nota livre se perdeu'
         else 'ha nota de verdade no meio; ver a amostra abaixo' end);

  for r in
    select origem_linha, data, descricao, observacoes
      from public.financeiro_lancamentos
     where nutri_id = v_dono and origem = 'vendas'
       and observacoes is not null
       and lower(trim(observacoes)) <> all (v_rotulos)
     order by origem_linha desc
     limit 15
  loop
    insert into conf108 values (41, 'FORA DO PADRAO', 'linha ' || r.origem_linha,
      r.data || ' | ' || left(r.observacoes, 80), '');
  end loop;

  -- ═══════════ AS VIZINHAS DAS APAGADAS ═══════════
  -- As 8 sao 1634 e 2173..2179. Se as vizinhas imediatas so tem rotulo, o mais
  -- provavel e que elas tambem tivessem.
  for r in
    select origem_linha, data, descricao, coalesce(observacoes, '(nulo)') as obs
      from public.financeiro_lancamentos
     where nutri_id = v_dono and origem = 'vendas'
       and (origem_linha between 2168 and 2185 or origem_linha between 1630 and 1638)
     order by origem_linha
  loop
    insert into conf108 values (50, 'VIZINHAS DAS APAGADAS', 'linha ' || r.origem_linha,
      r.data || ' | ' || r.obs,
      case when r.origem_linha in (1634, 2173, 2174, 2175, 2176, 2177, 2178, 2179)
           then 'APAGADA POR MIM' else '' end);
  end loop;
end $$;

select ordem, secao, item, valor, resultado from conf108 order by ordem, valor desc, item;
