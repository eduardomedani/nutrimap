-- ===========================================================================
-- MEDIDAS CASEIRAS PADRÃO — carga global (nutri_id NULL)
-- ---------------------------------------------------------------------------
-- Para que o app do aluno traduza o plano em gramas ("130 g de arroz") para
-- medida caseira ("≈ 5 colheres de sopa"), o alimento precisa ter medidas.
-- Até aqui só existiam as cadastradas à mão na tela Alimentos.
--
-- GLOBAL: nutri_id NULL é lido por todos (policy food_measures_select) e
-- editado por ninguém pela tela. Medida que a clínica cadastrar continua
-- valendo junto com estas.
--
-- >>> REVISAR ANTES DE APLICAR. Os gramas abaixo são médias de referência de
--     medidas caseiras brasileiras, arredondadas. Cada clínica tem a sua
--     concha. Ajuste os números na lista e rode de novo: é idempotente.
--
-- Idempotente: apaga só as medidas GLOBAIS com a mesma (alimento, descrição)
-- e reinsere. Medidas da clínica (nutri_id preenchido) não são tocadas.
--
-- CUIDADO com os seeds de alimentos: foods_seed_taco.sql e
-- foods_gerador_seed.sql APAGAM e reinserem os alimentos, e o
-- `on delete cascade` leva estas medidas junto. Depois de rodar qualquer um
-- deles, rode este de novo.
--
-- A descrição é a que o app pluraliza (js/pwa-dieta-data.js, PLURAIS):
-- "colher de sopa", "unidade", "fatia", "concha", "escumadeira"... Escrever
-- "unidade média" sairia "2 unidade média" na tela do aluno.
--
-- Desfazer: db/food_measures_padrao_desfazer.sql
-- ===========================================================================

with padrao (nome, descricao, gramas, ordem) as (values
  -- Cereais, tubérculos e pães
  ('Arroz, tipo 1, cozido',                        'colher de sopa',  25, 0),
  ('Arroz, tipo 1, cozido',                        'escumadeira',     90, 1),
  ('Arroz, integral, cozido',                      'colher de sopa',  20, 0),
  ('Arroz, integral, cozido',                      'escumadeira',     80, 1),
  ('Macarrão, trigo, cozido',                      'colher de sopa',  25, 0),
  ('Macarrão, trigo, cozido',                      'pegador',        110, 1),
  ('Cuscuz, de milho, cozido com sal',             'colher de sopa',  30, 0),
  ('Cuscuz, de milho, cozido com sal',             'fatia',          100, 1),
  ('Batata, doce, cozida',                         'colher de sopa',  40, 0),
  ('Batata, doce, cozida',                         'unidade',        150, 1),
  ('Batata, inglesa, cozida',                      'colher de sopa',  30, 0),
  ('Batata, inglesa, cozida',                      'unidade',        140, 1),
  ('Mandioca, cozida',                             'colher de sopa',  30, 0),
  ('Mandioca, cozida',                             'pedaço',         100, 1),
  ('Cará, cozido',                                 'colher de sopa',  30, 0),
  ('Aveia, flocos, crua',                          'colher de sopa',  15, 0),
  ('Pão, trigo, forma, integral',                  'fatia',           25, 0),
  ('Pão, trigo, francês',                          'unidade',         50, 0),
  ('Goma de tapioca hidratada',                    'colher de sopa',  20, 0),
  ('Torrada integral',                             'unidade',          8, 0),

  -- Leguminosas
  ('Feijão, carioca, cozido',                      'concha',          90, 0),
  ('Feijão, carioca, cozido',                      'colher de sopa',  18, 1),
  ('Feijão, preto, cozido',                        'concha',          90, 0),
  ('Feijão, preto, cozido',                        'colher de sopa',  18, 1),
  ('Lentilha, cozida',                             'concha',          90, 0),
  ('Lentilha, cozida',                             'colher de sopa',  18, 1),
  ('Grão-de-bico, cozido',                         'colher de sopa',  22, 0),
  ('Ervilha, em vagem',                            'colher de sopa',  20, 0),

  -- Carnes, peixes e ovos
  ('Frango, peito, sem pele, grelhado',            'filé',           100, 0),
  ('Frango, peito, sem pele, cozido',              'colher de sopa',  25, 0),
  ('Frango, peito, sem pele, cozido',              'filé',           100, 1),
  ('Carne, bovina, patinho, sem gordura, grelhado','bife',           100, 0),
  ('Carne, bovina, maminha, grelhada',             'fatia',           80, 0),
  ('Carne, bovina, acém, moído, cozido',           'colher de sopa',  25, 0),
  ('Porco, lombo, assado',                         'fatia',           60, 0),
  ('Merluza, filé, assado',                        'filé',           100, 0),
  ('Sardinha, assada',                             'unidade',         35, 0),
  ('Atum em água, drenado',                        'colher de sopa',  20, 0),
  ('Atum em água, drenado',                        'lata',           120, 1),
  ('Ovo, de galinha, inteiro, cozido/10minutos',   'unidade',         50, 0),
  ('Ovo, de galinha, clara, cozida/10minutos',     'unidade',         30, 0),

  -- Laticínios
  ('Queijo, minas, frescal',                       'fatia',           30, 0),
  ('Queijo, mozarela',                             'fatia',           15, 0),
  ('Queijo, ricota',                               'colher de sopa',  25, 0),
  ('Queijo cottage',                               'colher de sopa',  30, 0),
  ('Requeijão light',                              'colher de sopa',  30, 0),
  ('Creme de ricota light',                        'colher de sopa',  30, 0),
  ('Iogurte, natural',                             'pote',           170, 0),
  ('Iogurte, natural, desnatado',                  'pote',           170, 0),
  ('Iogurte natural sem lactose',                  'pote',           170, 0),
  ('Skyr natural',                                 'pote',           160, 0),
  ('Leite, de vaca, integral',                     'copo',           200, 0),
  ('Leite, de vaca, desnatado, UHT',               'copo',           200, 0),

  -- Frutas
  ('Banana, prata, crua',                          'unidade',         65, 0),
  ('Banana, nanica, crua',                         'unidade',         90, 0),
  ('Banana, da terra, crua',                       'unidade',        120, 0),
  ('Maçã, Fuji, com casca, crua',                  'unidade',        130, 0),
  ('Pêra, Williams, crua',                         'unidade',        130, 0),
  ('Mamão, Formosa, cru',                          'fatia',          170, 0),
  ('Mamão, Papaia, cru',                           'unidade',        270, 0),
  ('Melão, cru',                                   'fatia',           90, 0),
  ('Melancia, crua',                               'fatia',          200, 0),
  ('Abacaxi, cru',                                 'fatia',           75, 0),
  ('Morango, cru',                                 'unidade',         12, 0),
  ('Kiwi, cru',                                    'unidade',         75, 0),
  ('Laranja, pêra, crua',                          'unidade',        140, 0),
  ('Uva, Itália, crua',                            'unidade',          8, 0),
  ('Abacate, cru',                                 'colher de sopa',  30, 0),

  -- Gorduras, oleaginosas e outros
  ('Azeite, de oliva, extra virgem',               'colher de sopa',  13, 0),
  ('Azeite, de oliva, extra virgem',               'colher de chá',    4, 1),
  ('Óleo de coco',                                 'colher de sopa',  13, 0),
  ('Manteiga, sem sal',                            'colher de chá',    5, 0),
  ('Pasta de amendoim integral',                   'colher de sopa',  15, 0),
  ('Castanha-do-Brasil, crua',                     'unidade',          4, 0),
  ('Castanha-de-caju, torrada, salgada',           'unidade',        2.5, 0),
  ('Chocolate 70% cacau',                          'quadrado',         5, 0),
  ('Mel, de abelha',                               'colher de sopa',  20, 0),
  ('Whey protein concentrado',                     'scoop',           30, 0),

  -- Hortaliças
  ('Vegetais refogados (mix)',                     'colher de sopa',  20, 0),
  ('Cenoura, cozida',                              'colher de sopa',  25, 0),
  ('Brócolis, cozido',                             'colher de sopa',  20, 0),
  ('Beterraba, cozida',                            'colher de sopa',  25, 0),
  ('Abobrinha, italiana, refogada',                'colher de sopa',  25, 0),
  ('Chuchu, cozido',                               'colher de sopa',  25, 0),
  ('Tomate, com semente, cru',                     'fatia',           15, 0)
),
alvo as (
  select f.id as food_id, p.descricao, p.gramas, p.ordem
    from padrao p
    join public.foods f on f.nome = p.nome
),
limpa as (
  delete from public.food_measures m
   using alvo a
   where m.nutri_id is null
     and m.food_id = a.food_id
     and m.descricao = a.descricao
  returning m.id
),
ins as (
  insert into public.food_measures (nutri_id, food_id, descricao, gramas, ordem)
  select null, a.food_id, a.descricao, a.gramas, a.ordem from alvo a
  returning id
)
-- O delete e o insert rodam mesmo sem a consulta abaixo lê-los (o Postgres
-- executa todo WITH que modifica dados) e enxergam o mesmo retrato do banco:
-- o delete tira as globais que já existiam, o insert põe as novas.
--
-- Conferência, no MESMO comando para usar a mesma lista: os alimentos que NÃO
-- existem neste banco (nome diferente ou seed não aplicado). Vazio é o
-- esperado. Os itens do gerador (Skyr, Whey, Torrada integral...) só existem
-- se db/foods_gerador_seed.sql foi rodado.
select distinct p.nome as alimento_nao_encontrado
  from padrao p
 where not exists (select 1 from public.foods f where f.nome = p.nome);

-- Quantas medidas globais existem agora.
select count(*) as medidas_globais from public.food_measures where nutri_id is null;
