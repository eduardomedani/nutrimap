-- ===========================================================================
-- NutriMap - Busca de alimentos v2 + seed de sinonimos
-- ---------------------------------------------------------------------------
-- Resolve tres limitacoes da busca atual:
--
--   1) PONTUACAO. A TACO nomeia com virgula/hifen ("Carne, bovina, patinho",
--      "Grao-de-bico"). Buscar "carne bovina" ou "grao de bico" nao achava nada.
--      Agora a pontuacao vira espaco e a busca casa por PALAVRA, nao por trecho
--      literal: todos os termos digitados precisam aparecer, em qualquer ordem.
--
--   2) PLURAL. "bananas" nao achava "banana". Agora o plural e reduzido dos DOIS
--      lados (no indice e no termo digitado), entao os dois sentidos funcionam.
--      Reducao heuristica PT-BR: nao precisa acertar o singular "de dicionario",
--      precisa ser CONSISTENTE nos dois lados ("frances" -> "france" nos dois).
--
--   3) SINONIMOS. As tabelas existiam vazias. Seed com sinonimos regionais
--      brasileiros (aipim/macaxeira, jerimum, mexerica, jaba, xuxu...).
--
-- Coluna nome_busca (gerada, stored) guarda o texto ja tratado e e indexada com
-- GIN trigram -> continua rapido em 100k+ alimentos.
--
-- ATENCAO: nome_busca e recriada a cada execucao (drop/add). Isso e de proposito:
-- se voce mudar as regras em texto_busca(), rodar este arquivo de novo recalcula
-- tudo. Colunas geradas NAO se recalculam sozinhas quando a funcao muda.
--
-- 100% re-executavel. Rodar no SQL Editor DEPOIS de foods_schema.sql e
-- foods_seed_taco.sql. Aditivo: nao apaga alimentos nem planos.
-- ===========================================================================

-- No Supabase as extensoes vivem em `extensions`. Deixar o search_path resolver
-- gin_trgm_ops/similarity evita erro caso pg_trgm esteja em outro schema.
set search_path = public, extensions;


-- ---------------------------------------------------------------------------
-- 1) Reducao de plural (heuristica PT-BR)
-- ---------------------------------------------------------------------------
-- Aplicada nos dois lados da comparacao, entao o objetivo e CONSISTENCIA e nao
-- correcao gramatical. Palavras <= 3 letras ficam intactas (sal, gas, mes, pes).
create or replace function public.singularizar_palavra(p text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p is null or length(p) <= 3 then p
    when p ~ 'oes$'      then regexp_replace(p, 'oes$', 'ao')   -- feijoes  -> feijao
    when p ~ 'aes$'      then regexp_replace(p, 'aes$', 'ao')   -- paes     -> pao
    when p ~ 'aos$'      then regexp_replace(p, 'aos$', 'ao')   -- graos    -> grao
    when p ~ 'ais$'      then regexp_replace(p, 'ais$', 'al')   -- cereais  -> cereal
    when p ~ 'eis$'      then regexp_replace(p, 'eis$', 'el')   -- pasteis  -> pastel
    when p ~ 'ois$'      then regexp_replace(p, 'ois$', 'ol')   -- lencois  -> lencol
    when p ~ 'uis$'      then regexp_replace(p, 'uis$', 'ul')   -- azuis    -> azul
    when p ~ 'ns$'       then regexp_replace(p, 'ns$', 'm')     -- bombons  -> bombom
    when p ~ '[rzs]es$'  then regexp_replace(p, 'es$', '')      -- nozes    -> noz
    when p ~ 's$'        then regexp_replace(p, 's$', '')       -- peixes   -> peixe
    else p
  end;
$$;

create or replace function public.singularizar_texto(t text)
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(
    (select string_agg(public.singularizar_palavra(w), ' ' order by ord)
       from unnest(string_to_array(coalesce(t, ''), ' ')) with ordinality as u(w, ord)
      where w <> ''),
    '');
$$;


-- ---------------------------------------------------------------------------
-- 2) texto_busca -- o texto canonico da busca
-- ---------------------------------------------------------------------------
-- normalizar_texto (sem acento, minusculo) -> pontuacao vira espaco -> plural
-- reduzido. "Grao-de-bico, cru" e "Carne, bovina, patinho" viram frases de
-- palavras soltas, entao a busca por palavra funciona.
create or replace function public.texto_busca(t text)
returns text
language sql
immutable
parallel safe
as $$
  select public.singularizar_texto(
           trim(regexp_replace(
             regexp_replace(public.normalizar_texto(t), '[^a-z0-9]+', ' ', 'g'),
             '\s+', ' ', 'g'))
         );
$$;

-- Quebra o termo em palavras (usado pela busca e pela ordenacao).
create or replace function public.palavras_busca(t text)
returns text[]
language sql
immutable
parallel safe
as $$
  select coalesce(
    array(select w from unnest(string_to_array(public.texto_busca(t), ' ')) w where w <> ''),
    '{}'::text[]);
$$;


-- ---------------------------------------------------------------------------
-- 3) Coluna nome_busca em foods e food_aliases (+ indices trigram)
-- ---------------------------------------------------------------------------
-- A funcao antiga depende das colunas; recriada no passo 5.
drop function if exists public.foods_buscar(text, int);

alter table public.foods drop column if exists nome_busca;
alter table public.foods
  add column nome_busca text generated always as (public.texto_busca(nome)) stored;

alter table public.food_aliases drop column if exists nome_busca;
alter table public.food_aliases
  add column nome_busca text generated always as (public.texto_busca(nome)) stored;

create index if not exists idx_foods_nome_busca_trgm
  on public.foods using gin (nome_busca gin_trgm_ops);
create index if not exists idx_foods_marca_busca_trgm
  on public.foods using gin (public.texto_busca(marca) gin_trgm_ops);
create index if not exists idx_food_aliases_busca_trgm
  on public.food_aliases using gin (nome_busca gin_trgm_ops);


-- ---------------------------------------------------------------------------
-- 4) Sinonimos: unicidade (permite reexecutar o seed sem duplicar)
-- ---------------------------------------------------------------------------
create unique index if not exists uq_food_aliases_food_nome
  on public.food_aliases (food_id, nome_normalizado);


-- ---------------------------------------------------------------------------
-- 5) foods_buscar -- nome, sinonimo, marca e codigo de barras
-- ---------------------------------------------------------------------------
-- Estrategia em duas etapas para nao perder o indice:
--   . cand: pega candidatos pela palavra MAIS LONGA do termo (um ilike simples
--     por origem -> o planner usa o GIN trgm de cada uma).
--   . filtro final: exige TODAS as palavras (ilike all). Roda so nos candidatos.
-- security invoker: respeita o RLS (global + proprios do nutri).
create or replace function public.foods_buscar(p_termo text, p_limit int default 20)
returns setof public.foods
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with p as (
    select public.texto_busca(p_termo)                        as t,
           public.palavras_busca(p_termo)                     as ws
  ),
  p2 as (
    select t, ws,
           array(select '%' || w || '%' from unnest(ws) w)    as pats,
           (select w from unnest(ws) w order by length(w) desc limit 1) as maior
    from p
  ),
  cand as (
    select f.id from public.foods f, p2
      where p2.maior is not null and f.nome_busca ilike '%' || p2.maior || '%'
    union
    select a.food_id from public.food_aliases a, p2
      where p2.maior is not null and a.nome_busca ilike '%' || p2.maior || '%'
    union
    select f.id from public.foods f, p2
      where p2.maior is not null
        and public.texto_busca(f.marca) ilike '%' || p2.maior || '%'
    union
    select f.id from public.foods f
      where nullif(trim(coalesce(p_termo, '')), '') is not null
        and f.codigo_barras = trim(p_termo)
  )
  select f.*
  from public.foods f
  join cand c on c.id = f.id
  cross join p2
  where f.codigo_barras = trim(coalesce(p_termo, ''))
     or f.nome_busca ilike all (p2.pats)
     or public.texto_busca(f.marca) ilike all (p2.pats)
     or exists (
          select 1 from public.food_aliases a
           where a.food_id = f.id and a.nome_busca ilike all (p2.pats)
        )
  -- nome exato primeiro, depois prefixo, depois proximidade
  order by
    (f.nome_busca = p2.t) desc,
    (f.nome_busca like p2.t || '%') desc,
    similarity(f.nome_busca, p2.t) desc,
    f.nome asc
  limit greatest(p_limit, 1);
$$;
grant execute on function public.foods_buscar(text, int) to authenticated;


-- ===========================================================================
-- 6) SEED -- sinonimos regionais brasileiros (catalogo global, nutri_id NULL)
-- ---------------------------------------------------------------------------
-- Sao apenas sinonimos DE VERDADE. Variacoes de escrita (virgula, hifen, acento,
-- plural) ja sao resolvidas por texto_busca() e nao precisam virar alias.
--
-- `padrao` casa contra nome_normalizado (que preserva a virgula da TACO), entao
-- 'carne, bovina, seca%' pega so os cortes certos. Idempotente: apaga os
-- sinonimos globais e reinsere.
-- ===========================================================================
delete from public.food_aliases where nutri_id is null;

with mapa(padrao, sinonimos) as (values
  -- raizes e tuberculos
  ('mandioca%',                      array['aipim', 'macaxeira', 'castelinha']),
  ('farinha, de mandioca%',          array['farinha de aipim']),
  ('fecula, de mandioca%',           array['goma', 'polvilho']),
  ('polvilho%',                      array['goma']),
  ('tapioca%',                       array['goma', 'beiju']),
  ('batata, doce%',                  array['jetica']),
  ('batata, baroa%',                 array['mandioquinha', 'batata salsa', 'cenoura amarela']),
  ('inhame%',                        array['cara']),
  ('cara,%',                         array['inhame']),

  -- frutas
  ('abacaxi%',                       array['ananas']),
  ('tangerina%',                     array['mexerica', 'bergamota', 'vergamota', 'mimosa']),
  ('mamao%',                         array['papaia', 'papaya']),
  ('pinha%',                         array['fruta do conde', 'ata', 'condessa']),
  ('umbu%',                          array['imbu']),
  ('caja, polpa%',                   array['taperreba', 'tapereba']),
  ('caja-manga%',                    array['cajarana']),

  -- legumes e verduras
  ('abobora%',                       array['jerimum']),
  ('chuchu%',                        array['xuxu']),
  ('quiabo%',                        array['quingombo']),

  -- leguminosas e oleaginosas
  ('feijao, fradinho%',              array['feijao de corda', 'feijao caupi', 'macassar']),
  ('castanha-do-brasil%',            array['castanha do para']),

  -- carnes
  ('carne, bovina%',                 array['carne de vaca', 'boi']),
  ('carne, bovina, seca%',           array['jaba', 'charque', 'carne de sol']),
  ('carne, bovina, charque%',        array['jaba', 'carne seca', 'carne de sol']),
  ('carne, bovina, file mingnon%',   array['file mignon']),
  ('carne, bovina, miolo de alcatra%', array['alcatra']),
  ('carne, bovina, coxao mole%',     array['cha de dentro']),
  ('carne, bovina, coxao duro%',     array['cha de fora']),
  ('carne, bovina, lagarto%',        array['tatu', 'posta branca']),
  ('carne, bovina, bucho%',          array['dobradinha']),
  ('frango%',                        array['galinha']),

  -- paes, massas e prontos
  ('pao, trigo, frances%',           array['pao de sal', 'cacetinho', 'filao', 'pao careca', 'paozinho', 'media']),
  ('macarrao%',                      array['massa', 'espaguete', 'talharim']),
  ('nhoque%',                        array['gnocchi']),
  ('estrogonofe%',                   array['strogonoff', 'stroganoff']),

  -- laticinios e bebidas
  ('queijo, minas%',                 array['queijo branco']),
  ('refrigerante%',                  array['refri'])
)
insert into public.food_aliases (nutri_id, food_id, nome)
select distinct null::uuid, f.id, s
  from mapa m
  join public.foods f
    on f.nutri_id is null
   and f.nome_normalizado like m.padrao
  cross join lateral unnest(m.sinonimos) as s
on conflict (food_id, nome_normalizado) do nothing;

-- Sinonimos por SUBCATEGORIA. A TACO nomeia o alimento, nunca o grupo: nenhum
-- registro contem a palavra "peixe" (sao Pescada, Sardinha, Atum...), entao
-- buscar "peixe" nao achava nada. Estes aliases cobrem o termo generico.
-- `padrao` casa contra normalizar_texto(subcategoria).
with mapa_sub(padrao, sinonimos) as (values
  ('pescados%',    array['peixe', 'pescado', 'frutos do mar']),
  ('nozes%',       array['oleaginosa']),
  ('leite%',       array['laticinio']),
  ('verduras%',    array['verdura', 'hortalica', 'legume']),
  ('gorduras%',    array['gordura', 'oleo']),
  ('bebidas%',     array['bebida']),
  ('leguminosas%', array['leguminosa']),
  ('frutas%',      array['fruta']),
  ('produtos acucarados%', array['doce'])
)
insert into public.food_aliases (nutri_id, food_id, nome)
select distinct null::uuid, f.id, s
  from mapa_sub m
  join public.foods f
    on f.nutri_id is null
   and public.normalizar_texto(f.subcategoria) like m.padrao
  cross join lateral unnest(m.sinonimos) as s
on conflict (food_id, nome_normalizado) do nothing;


-- ===========================================================================
-- 7) CHECAGENS -- o resultado esperado esta ao lado de cada linha
-- ===========================================================================
select count(*) as sinonimos_criados from public.food_aliases where nutri_id is null;

-- Os casos da lista original. Todos devem retornar > 0.
select
  (select count(*) from public.foods_buscar('aipim'))       as aipim,        -- acha Mandioca
  (select count(*) from public.foods_buscar('macaxeira'))   as macaxeira,    -- acha Mandioca
  (select count(*) from public.foods_buscar('mandioca'))    as mandioca,
  (select count(*) from public.foods_buscar('bananas'))     as plural,       -- acha Banana
  (select count(*) from public.foods_buscar('feijoes'))     as plural_oes,   -- acha Feijao
  (select count(*) from public.foods_buscar('carne bovina')) as com_virgula, -- acha "Carne, bovina, ..."
  (select count(*) from public.foods_buscar('grao de bico')) as com_hifen,   -- acha "Grao-de-bico"
  (select count(*) from public.foods_buscar('file mignon')) as mignon,       -- TACO escreve "mingnon"
  (select count(*) from public.foods_buscar('jerimum'))     as jerimum,      -- acha Abobora
  (select count(*) from public.foods_buscar('xuxu'))        as xuxu,         -- acha Chuchu
  (select count(*) from public.foods_buscar('peixe'))       as peixe;        -- via subcategoria

-- ===========================================================================
-- FIM
-- ===========================================================================
