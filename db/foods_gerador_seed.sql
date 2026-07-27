-- ===========================================================================
-- SEED: alimentos que o gerador de dieta precisa e a TACO nao cobre
-- ---------------------------------------------------------------------------
-- Sao 17 itens: suplementos, laticinios de mercado, e tres "cozidos" que a
-- TACO so tem na versao crua (macros por 100 g mudam ~3x com a hidratacao,
-- entao usar o cru inflaria o plano em silencio).
--
-- Valores por 100 g. Origem de cada bloco documentada abaixo.
-- Entram como catalogo PROPRIO do nutri (nutri_id preenchido), nao global.
--
-- Idempotente: apaga o que este seed criou antes e reinsere.
-- Rodar no SQL Editor do Supabase: cole o arquivo INTEIRO, sem selecionar nada.
--
-- >>> AJUSTE AQUI (3 lugares, sempre o mesmo e-mail): a conta de nutri dona
--     destes alimentos. Descubra qual e' com:
--       select u.id, u.email,
--              (select count(*) from public.pacientes p where p.nutri_id = u.id)
--         from auth.users u order by 3 desc;
--
-- Nao usamos auth.uid(): no SQL Editor ele e' NULL (fora do modo Role
-- Impersonation), e nutri_id NULL significa catalogo GLOBAL
-- (foods_schema.sql:81) — os 17 itens vazariam para todos os nutris e o
-- delete de idempotencia pararia de casar, duplicando a cada re-run.
--
-- Tudo aqui e' statement avulso de proposito: nada de funcao pg_temp, que
-- vive so' na sessao e some se o editor trocar de conexao entre statements.
-- ===========================================================================

-- ── 0) a conta existe? aborta alto em vez de inserir nutri_id NULL ────────
do $guard$
begin
  if not exists (select 1 from auth.users
                  where lower(email) = lower('eduardomedani@natalinossalgados.com.br')) then
    raise exception 'conta de nutri nao encontrada para esse e-mail';
  end if;
end $guard$;

-- ── 1) limpa o que este seed criou antes ──────────────────────────────────
delete from public.foods
 where nutri_id = (select id from auth.users
                    where lower(email) = lower('eduardomedani@natalinossalgados.com.br'))
   and atributos_extra->>'origem' = 'gerador';

-- ── 2) insere os 17 ───────────────────────────────────────────────────────
insert into public.foods
  (nutri_id, fonte_dados, nome, subcategoria,
   calorias, proteina, carboidrato, gordura, fibra, atributos_extra)
select
  (select id from auth.users
    where lower(email) = lower('eduardomedani@natalinossalgados.com.br')),
  v.*
from (values
  -- ── derivados da propria TACO ───────────────────────────────────────────
  -- Macarrao: "Macarrão, trigo, cru" (371/10/77.9/1.3/2.9) / fator 2.4
  ('Proprio', 'Macarrão, trigo, cozido', 'Cereais e derivados',
   155, 4.2, 32.5, 0.5, 1.2,
   '{"origem":"gerador","base":"TACO Macarrão trigo cru / 2.4"}'::jsonb),

  -- Grao-de-bico: "Grão-de-bico, cru" (355/21.2/57.9/5.4/12.4) / fator 3.7
  -- fator tirado do par Lentilha crua/cozida da TACO = estilo brasileiro, COM CALDO.
  -- Se voce prescreve escorrido, troque por: 164 / 8.9 / 27.4 / 2.6 / 7.6
  ('Proprio', 'Grão-de-bico, cozido', 'Leguminosas e derivados',
   96, 5.7, 15.6, 1.5, 3.4,
   '{"origem":"gerador","base":"TACO Grão-de-bico cru / 3.7 (com caldo)"}'::jsonb),

  -- Pasta 100% amendoim = amendoim moido, herda "Amendoim, grão, cru"
  ('Proprio', 'Pasta de amendoim integral', 'Leguminosas e derivados',
   544, 27.2, 20.3, 43.9, 8.0,
   '{"origem":"gerador","base":"TACO Amendoim grão cru"}'::jsonb),

  -- Sem lactose: a lactase quebra lactose em glicose+galactose, o carboidrato total nao muda
  ('Proprio', 'Iogurte natural sem lactose', 'Leite e derivados',
   51, 4.1, 1.9, 3.0, 0,
   '{"origem":"gerador","base":"TACO Iogurte natural"}'::jsonb),

  -- ── rotulo de mercado (conferir se voce prescreve marca especifica) ─────
  ('Proprio', 'Whey protein concentrado', 'Suplementos',
   400, 80.0, 8.0, 6.0, 0,
   '{"origem":"gerador","nota":"concentrado ~80% prot; isolado seria 90/2/1"}'::jsonb),
  ('Proprio', 'Queijo cottage', 'Leite e derivados',
   98, 12.4, 3.4, 4.3, 0,
   '{"origem":"gerador"}'::jsonb),
  ('Proprio', 'Skyr natural', 'Leite e derivados',
   63, 11.0, 4.0, 0.2, 0,
   '{"origem":"gerador"}'::jsonb),
  ('Proprio', 'Requeijão light', 'Leite e derivados',
   175, 9.0, 4.0, 13.0, 0,
   '{"origem":"gerador","nota":"varia bastante por marca"}'::jsonb),
  ('Proprio', 'Creme de ricota light', 'Leite e derivados',
   135, 8.0, 4.0, 10.0, 0,
   '{"origem":"gerador","nota":"varia bastante por marca"}'::jsonb),
  ('Proprio', 'Óleo de coco', 'Óleos e gorduras',
   862, 0, 0, 100, 0,
   '{"origem":"gerador","nota":"gordura pura"}'::jsonb),
  ('Proprio', 'Torrada integral', 'Cereais e derivados',
   400, 12.0, 70.0, 6.0, 7.0,
   '{"origem":"gerador","nota":"TACO so tem torrada de pão francês"}'::jsonb),
  ('Proprio', 'Chocolate 70% cacau', 'Produtos açucarados',
   580, 8.0, 34.0, 42.0, 9.0,
   '{"origem":"gerador","nota":"TACO meio amargo ~50%, nao serve"}'::jsonb),
  ('Proprio', 'Atum em água, drenado', 'Pescados e frutos do mar',
   110, 25.0, 0, 1.0, 0,
   '{"origem":"gerador","nota":"TACO so tem em óleo"}'::jsonb),
  ('Proprio', 'Goma de tapioca hidratada', 'Cereais e derivados',
   240, 0, 60.0, 0, 0.5,
   '{"origem":"gerador","nota":"sem manteiga, diferente da TACO"}'::jsonb),

  -- ── genericos: entram como vaga fixa de vegetais nos templates ──────────
  ('Proprio', 'Folhas verdes (mix)', 'Verduras e hortaliças',
   20, 2.0, 3.0, 0.3, 2.0,
   '{"origem":"gerador","nota":"média de alface/rúcula/agrião/acelga"}'::jsonb),
  ('Proprio', 'Vegetais variados (mix cru)', 'Verduras e hortaliças',
   35, 2.0, 7.0, 0.3, 2.5,
   '{"origem":"gerador"}'::jsonb),
  ('Proprio', 'Vegetais refogados (mix)', 'Verduras e hortaliças',
   60, 2.0, 7.0, 3.0, 2.5,
   '{"origem":"gerador","nota":"assume ~1 colher de chá de óleo"}'::jsonb)
) as v(fonte_dados, nome, subcategoria,
       calorias, proteina, carboidrato, gordura, fibra, atributos_extra);

-- ── 3) conferencia: os 17 entraram? ───────────────────────────────────────
select count(*) as alimentos_do_gerador
  from public.foods
 where atributos_extra->>'origem' = 'gerador';

-- ===========================================================================
-- FIM
-- ===========================================================================
