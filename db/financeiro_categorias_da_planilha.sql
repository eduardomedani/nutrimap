-- ===========================================================================
-- Evollo · Financeiro — A NATUREZA DE CADA DESPESA IMPORTADA
-- ---------------------------------------------------------------------------
-- A planilha traz CENTRO DE CUSTO (ADMINISTRATIVO, LIMPEZA, INVESTIMENTO), que
-- diz ONDE o dinheiro foi alocado, e ja entra em `centro_custo_id`. Ela nao traz
-- CATEGORIA — a natureza do gasto (Energia, Equipamentos, Manutencao) —, e por
-- isso as 360 linhas entraram sem categoria: adivinhar seria escrever no balanco
-- uma opiniao do programa.
--
-- Este arquivo e onde a resposta e DADA, uma regra por linha.
--
-- O mapa abaixo classifica as 323 despesas de operacao, sem sobra. As seis
-- ultimas foram decididas uma a uma em 05/09/2026, olhando a lista do que tinha
-- ficado sem regra — que e para isso que a Conferencia 2, no fim deste arquivo,
-- existe.
--
-- ===========================================================================
-- COMO ELE FUNCIONA
-- ---------------------------------------------------------------------------
-- O mapa e uma lista de (ORDEM, PADRAO, CATEGORIA). O padrao casa com a
-- DESCRICAO por `ilike`: `%` vale por qualquer coisa e maiuscula nao importa.
-- ACENTO IMPORTA — "manutencao" nao casa com "Manutenção".
--
-- A MENOR ORDEM QUE CASA E A QUE VALE. Nao e detalhe: "Limpeza Ar Condicionado"
-- casa com Manutencao (22) e com Limpeza (71), e as duas respostas sao
-- defensaveis. A ordem decide, e decide sempre igual — sem ela, o resultado
-- dependeria de qual update rodou por ultimo.
--
-- E UMA CONSULTA SO, com `distinct on`, e nao um update por regra. Assim a
-- ordem e obedecida de verdade: com updates em sequencia, a ultima regra a
-- rodar sobrescreveria a primeira que casou.
--
-- ===========================================================================
-- O QUE ELE NAO FAZ, E POR QUE
-- ---------------------------------------------------------------------------
-- 1. NAO TOCA EM LANCAMENTO MANUAL. So mexe em `origem = 'planilha'`. O que foi
--    digitado na tela ja foi classificado por quem digitou.
--
-- 2. NAO LIMPA A CATEGORIA DE QUEM NAO CASA. Linha sem regra fica como esta —
--    inclusive se alguem a classificou na tela.
--
-- 3. NAO APAGA CATEGORIA VAZIA. As que vieram da importacao de 2026 com nome de
--    centro de custo (ADMINISTRATIVO, LIMPEZA) podem ter despesa manual
--    classificada nelas; quem decide fundir ou apagar e a tela.
--
-- RODE-O DEPOIS DE CADA REIMPORTACAO. O seed apaga e recria as linhas de origem
-- 'planilha', e leva junto a categoria delas. Este arquivo e re-executavel e
-- reconstroi a classificacao inteira — e por isso que a regra mora aqui,
-- versionada, e nao em cliques que ninguem consegue repetir.
--
-- Requer db/financeiro_lancamentos.sql. Rodar no SQL Editor do Supabase.
-- ===========================================================================

do $categorias$
declare
  v_nutri uuid;
  v_donos integer;
  v_n     integer;
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
    raise exception 'Nao encontrei o dono das linhas. Rode logado.';
  end if;

  -- =====================================================================
  -- O MAPA. Acrescentar categoria e acrescentar linha.
  -- =====================================================================
  create temp table if not exists mapa_categorias (
    ordem integer, padrao text, categoria text
  ) on commit drop;
  delete from mapa_categorias;

  insert into mapa_categorias (ordem, padrao, categoria) values
    -- ENERGIA — as quatro grafias da mesma conta: 40 linhas, R$ 41.668,06.
    -- "Recuperacao Invest Energia" e restituicao de investimento na rede e
    -- entra junto: continua sendo dinheiro de energia.
    (10, '%energia%', 'Energia'),

    -- MANUTENCAO vem ANTES de Equipamentos e de Limpeza. "Limpeza Ar
    -- Condicionado" e conserto, nao faxina; "Pecas do Ar condicionado" e
    -- reposicao, nao compra de aparelho.
    (20, '%manuten%',               'Manutenção'),
    (21, 'Peças do Ar%',            'Manutenção'),
    (22, '%limpeza ar condicio%',   'Manutenção'),
    (23, 'Instalação Ar Condicio%', 'Manutenção'),
    (24, 'Concerto%',               'Manutenção'),
    (25, 'Placa %',                 'Manutenção'),
    (26, 'Lona Esteira%',           'Manutenção'),
    (27, 'Manípulos%',              'Manutenção'),
    (28, 'Pegador para%',           'Manutenção'),
    (29, 'ESTOFADOS NOVOS%',        'Manutenção'),
    (30, 'Lâmpadas',                'Manutenção'),
    (31, 'Tomadas pretas',          'Manutenção'),
    (32, 'PlugLead',                'Manutenção'),
    (33, '%chaveiro%',              'Manutenção'),

    (40, '%obra expans%',        'Obras e reforma'),
    (41, 'REFORMA INTERNA%',     'Obras e reforma'),
    (42, 'Retirada das Janelas', 'Obras e reforma'),
    (43, 'Corrimão%',            'Obras e reforma'),
    (44, 'Projeto da academia',  'Obras e reforma'),
    (45, 'Elétrica',             'Obras e reforma'),

    -- EQUIPAMENTOS inclui o parcelado (Simulador de Escada 1/10, KIKOS 1/12).
    -- Uma categoria propria para parcela separaria o mesmo aparelho da propria
    -- entrada, e o relatorio deixaria de responder quanto custou o equipamento.
    (50, 'Conexão Fitness%',    'Equipamentos'),
    (51, 'Frete %',             'Equipamentos'),
    (52, 'Mundial Fitness%',    'Equipamentos'),
    (53, 'Simulador de Escada%','Equipamentos'),
    (54, 'KIKOS%',              'Equipamentos'),
    (55, 'Esteira%',            'Equipamentos'),
    (56, 'Entrada na Esteira',  'Equipamentos'),
    (57, 'ENTRADA NA REMADA%',  'Equipamentos'),
    (58, 'REMADA CAVALINHA%',   'Equipamentos'),
    (59, 'Spinning%',           'Equipamentos'),
    (60, 'Polia Uni%',          'Equipamentos'),
    (61, 'Map Fit%',            'Equipamentos'),
    (62, 'Elevação Pélvica%',   'Equipamentos'),
    (63, 'Suporte de%',         'Equipamentos'),
    (64, 'Tablet',              'Equipamentos'),
    (65, 'Bebedouro%',          'Equipamentos'),
    (66, 'Equipamentos (%',     'Equipamentos'),
    (67, 'Ar Condicionado',     'Equipamentos'),

    (70, 'Faxina',              'Limpeza'),
    (71, 'Limpeza',             'Limpeza'),
    (72, 'Material de limpeza', 'Limpeza'),
    (73, 'Alcool',              'Limpeza'),

    (80, 'Sistema%',  'Sistemas'),
    (85, 'Internet',  'Telefonia e internet'),
    (86, 'Telefone%', 'Telefonia e internet'),

    (90, 'SIMPLES',          'Impostos e encargos'),
    (91, 'INSS',             'Impostos e encargos'),
    (92, 'MEI',              'Impostos e encargos'),
    (93, 'Encargos Sociais', 'Impostos e encargos'),
    (94, '%CREF%',           'Impostos e encargos'),
    (95, 'Tarifas Conta',    'Tarifas bancárias'),
    (96, 'Taxa ASAAS',       'Tarifas bancárias'),

    -- `%supl%` e nao `%suplement%`: a planilha tem "Suplmento (Jamal)", sem o
    -- "e". Um padrao mais estrito perderia justamente a linha digitada errado.
    (100, '%supl%', 'Suplementos'),

    (110, '%evento %', 'Eventos'),
    (112, 'Palestrante', 'Eventos'),
    (113, 'Fotógrafo',   'Eventos'),
    (114, 'Faixas',      'Eventos'),

    (120, 'Uniformes%',         'Uniformes'),
    (121, 'Camisas dos Alunos', 'Uniformes'),

    -- As ultimas seis linhas da planilha, decididas em 05/09/2026. Alvara e
    -- extintor sao obrigacao de FUNCIONAR, e nao imposto sobre faturamento:
    -- as duas coisas se planejam em epocas diferentes do ano.
    (125, 'Alvará%',   'Licenças e segurança'),
    (126, 'Extintor',  'Licenças e segurança'),
    -- "Materiais" e "Lan house e material de construcao" nao dizem para que
    -- foram. Vao com o conserto do dia a dia, onde ja estao lampadas e tomadas.
    (127, 'Materiais',  'Manutenção'),
    (128, 'Lan house%', 'Manutenção'),
    -- A logo e comunicacao visual. A categoria nasce com uma linha e existe
    -- para receber fachada, panfleto e anuncio quando vierem.
    (129, '%Instalação da Logo%', 'Marketing'),

    (130, 'Contabilidade', 'Contabilidade'),
    (140, 'Aluguel%',      'Aluguel'),
    (150, 'Café',           'Copa e alimentação'),
    (151, 'Almoço',         'Copa e alimentação'),
    (152, 'Pote Hermético', 'Copa e alimentação');

  -- ---------------------------------------------------------------------
  -- 1) As categorias que o mapa nomeia, criadas se ainda nao existirem
  -- ---------------------------------------------------------------------
  insert into public.financeiro_categorias (nutri_id, nome, tipo)
  select distinct v_nutri, m.categoria, 'despesa'
    from mapa_categorias m
   where not exists (
     select 1 from public.financeiro_categorias c
      where c.nutri_id = v_nutri and c.tipo = 'despesa'
        and lower(c.nome) = lower(m.categoria));

  -- ---------------------------------------------------------------------
  -- 2) A classificacao, em uma consulta so
  -- ---------------------------------------------------------------------
  -- `distinct on (l.id) ... order by l.id, m.ordem` e o que faz a MENOR ordem
  -- vencer quando a mesma descricao casa com mais de um padrao.
  --
  -- `is distinct from` evita reescrever quem ja esta certo: sem isso, cada
  -- reexecucao carimbaria `atualizado_em` em 317 linhas e encheria a auditoria
  -- de mudanca que nao mudou nada.
  -- ---------------------------------------------------------------------
  with alvo as (
    select distinct on (l.id) l.id, m.categoria
      from public.financeiro_lancamentos l
      join mapa_categorias m on l.descricao ilike m.padrao
     where l.nutri_id = v_nutri
       and l.origem = 'planilha'
       and coalesce(l.metadata ->> 'folha', '') <> 'true'
     order by l.id, m.ordem
  )
  update public.financeiro_lancamentos l
     set categoria_id = c.id, atualizado_em = now()
    from alvo a
    join public.financeiro_categorias c
      on c.nutri_id = v_nutri and c.tipo = 'despesa'
     and lower(c.nome) = lower(a.categoria)
   where l.id = a.id
     and l.categoria_id is distinct from c.id;

  get diagnostics v_n = row_count;
  raise notice 'Classificadas % linhas nesta execucao.', v_n;
end $categorias$;


-- ===========================================================================
-- Conferencia 1 — o que cada categoria ficou tendo.
-- Esperado (despesas de operacao da planilha):
--   Equipamentos 85 · Limpeza 49 · Sistemas 55 · Energia 40 · Manutencao 29
--   Obras e reforma 15 · Impostos e encargos 12 · Eventos 10 · Tarifas 6
--   Suplementos 5 · Contabilidade 4 · Copa 4 · Uniformes 3 · Telefonia 2
--   Licencas e seguranca 2 · Aluguel 1 · Marketing 1 · SEM CATEGORIA 0
-- ===========================================================================
select
  coalesce(c.nome, '— SEM CATEGORIA —')                    as categoria,
  count(*)                                                 as linhas,
  to_char(coalesce(sum(l.valor), 0), 'FM999G999G990D00')   as total
from public.financeiro_lancamentos l
left join public.financeiro_categorias c on c.id = l.categoria_id
where l.origem = 'planilha' and l.status <> 'cancelado'
  and coalesce(l.metadata ->> 'folha', '') <> 'true'
group by c.nome
order by count(*) desc;

-- ===========================================================================
-- Conferencia 2 — o que ainda espera regra, do maior para o menor.
-- E daqui que saem as proximas linhas do mapa.
-- ===========================================================================
select
  l.descricao,
  count(*)                                   as linhas,
  to_char(sum(l.valor), 'FM999G999G990D00')  as total
from public.financeiro_lancamentos l
where l.origem = 'planilha' and l.categoria_id is null
  and l.status <> 'cancelado'
  and coalesce(l.metadata ->> 'folha', '') <> 'true'
group by l.descricao
order by sum(l.valor) desc nulls last
limit 60;
