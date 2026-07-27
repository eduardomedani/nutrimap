-- ===========================================================================
-- SEED: cardapios do Ciclo Magro -> modelos de biblioteca do NutriMap
-- ---------------------------------------------------------------------------
-- Gerado a partir do DIETS_DB de ciclomagro-app (18 cardapios, 329 itens,
-- 720 substituicoes). Cria os alimentos proprios que faltavam na TACO e
-- depois 18 planos_alimentares com paciente_id NULL (= modelos reutilizaveis).
--
-- DECISOES QUE VOCE PODE QUERER MUDAR (valores por 100 g, ver bloco PROPRIOS):
--   . Grao-de-bico cozido = 96 kcal (estilo brasileiro, COM CALDO).
--     Se voce prescreve escorrido: 164 / 8.9 / 27.4 / 2.6 / 7.6
--   . Whey = CONCENTRADO (80% prot). Isolado seria 90 / 2 / 1.
--   . Tapioca e Goma de tapioca -> "Goma de tapioca hidratada" (SEM manteiga),
--     e nao a "Tapioca, com manteiga" da TACO. Afeta 44 itens.
--
-- Idempotente: apaga o que este seed criou antes e recria.
-- Rodar no SQL Editor do Supabase, LOGADO como o nutri dono dos modelos.
-- ===========================================================================

-- helper de lookup: prioriza alimento proprio, cai para o global (TACO).
create or replace function pg_temp.cm_food(p_nome text) returns uuid as $fn$
declare v uuid;
begin
  select id into v from public.foods
   where nome = p_nome and (nutri_id is null or nutri_id = auth.uid())
   order by nutri_id nulls last limit 1;
  if v is null then raise exception 'alimento nao encontrado no catalogo: %', p_nome; end if;
  return v;
end $fn$ language plpgsql;

-- ── 1) alimentos proprios (o que a TACO nao cobre) ──────────────────────
delete from public.foods
 where nutri_id = auth.uid() and atributos_extra->>'origem' = 'ciclomagro';

insert into public.foods
  (nutri_id, fonte_dados, nome, subcategoria, calorias, proteina, carboidrato, gordura, fibra, atributos_extra)
values
  (auth.uid(), 'Proprio', 'Macarrão, trigo, cozido', 'Cereais e derivados', 155, 4.2, 32.5, 0.5, 1.2, '{"origem":"ciclomagro"}'::jsonb),
  (auth.uid(), 'Proprio', 'Grão-de-bico, cozido', 'Leguminosas e derivados', 96, 5.7, 15.6, 1.5, 3.4, '{"origem":"ciclomagro"}'::jsonb),
  (auth.uid(), 'Proprio', 'Pasta de amendoim integral', 'Leguminosas e derivados', 544, 27.2, 20.3, 43.9, 8, '{"origem":"ciclomagro"}'::jsonb),
  (auth.uid(), 'Proprio', 'Iogurte natural sem lactose', 'Leite e derivados', 51, 4.1, 1.9, 3, 0, '{"origem":"ciclomagro"}'::jsonb),
  (auth.uid(), 'Proprio', 'Whey protein concentrado', 'Suplementos', 400, 80, 8, 6, 0, '{"origem":"ciclomagro"}'::jsonb),
  (auth.uid(), 'Proprio', 'Queijo cottage', 'Leite e derivados', 98, 12.4, 3.4, 4.3, 0, '{"origem":"ciclomagro"}'::jsonb),
  (auth.uid(), 'Proprio', 'Skyr natural', 'Leite e derivados', 63, 11, 4, 0.2, 0, '{"origem":"ciclomagro"}'::jsonb),
  (auth.uid(), 'Proprio', 'Requeijão light', 'Leite e derivados', 175, 9, 4, 13, 0, '{"origem":"ciclomagro"}'::jsonb),
  (auth.uid(), 'Proprio', 'Creme de ricota light', 'Leite e derivados', 135, 8, 4, 10, 0, '{"origem":"ciclomagro"}'::jsonb),
  (auth.uid(), 'Proprio', 'Óleo de coco', 'Óleos e gorduras', 862, 0, 0, 100, 0, '{"origem":"ciclomagro"}'::jsonb),
  (auth.uid(), 'Proprio', 'Torrada integral', 'Cereais e derivados', 400, 12, 70, 6, 7, '{"origem":"ciclomagro"}'::jsonb),
  (auth.uid(), 'Proprio', 'Chocolate 70% cacau', 'Produtos açucarados', 580, 8, 34, 42, 9, '{"origem":"ciclomagro"}'::jsonb),
  (auth.uid(), 'Proprio', 'Atum em água, drenado', 'Pescados e frutos do mar', 110, 25, 0, 1, 0, '{"origem":"ciclomagro"}'::jsonb),
  (auth.uid(), 'Proprio', 'Goma de tapioca hidratada', 'Cereais e derivados', 240, 0, 60, 0, 0.5, '{"origem":"ciclomagro"}'::jsonb),
  (auth.uid(), 'Proprio', 'Folhas verdes (mix)', 'Verduras e hortaliças', 20, 2, 3, 0.3, 2, '{"origem":"ciclomagro"}'::jsonb),
  (auth.uid(), 'Proprio', 'Vegetais variados (mix cru)', 'Verduras e hortaliças', 35, 2, 7, 0.3, 2.5, '{"origem":"ciclomagro"}'::jsonb),
  (auth.uid(), 'Proprio', 'Vegetais refogados (mix)', 'Verduras e hortaliças', 60, 2, 7, 3, 2.5, '{"origem":"ciclomagro"}'::jsonb);

-- ── 2) modelos de biblioteca ────────────────────────────────────────────
delete from public.planos_alimentares
 where nutri_id = auth.uid() and paciente_id is null and nome like 'Ciclo Magro · %';

do $cm$
declare v_plano uuid; v_ref uuid;
begin
  insert into public.planos_alimentares (nutri_id, paciente_id, nome, objetivo, kcal_meta, ativo, observacoes)
  values (auth.uid(), null, 'Ciclo Magro · 1200 kcal · Folicular/Ovulatória', 'Folicular/Ovulatória', 1200, true, 'Água: 2,0 litros/dia | Para preparar ovos mexidos, voce pode utilizar o oleo da sua preferencia para untar: de soja, canola, girassol, azeite, etc. Desde que utilize um fio de oleo (em zig-zag). | Adocantes para o cafe: Stevia, xilitol, eritritol, sucralose. | Se a fome aumentar, aumente a quantidade de folhas e legumes. | No preparo dos alimentos, utilize temperos naturais como alho, cebola, limao, salsinha, cebolinha, paprica, pimenta do reino, a gosto. Use sal com moderacao (NAO e para zerar). Evite ao maximo temperos prontos. | Voce pode utilizar o oleo da sua preferencia para grelhar. Utilize um fio de oleo em zig-zag. | Ocasionalmente, pode utilizar ketchup zero ou mostarda nas refeicoes.')
  returning id into v_plano;

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Café da manhã', '07:00', 1) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Pão, trigo, forma, integral'), 0.5, '02 fatias', 1, '[{"nome":"Goma de tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Cuscuz de milho","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Banana da terra","quantidade":0.7,"medida":"1/2 unidade media"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Ovo, de galinha, inteiro, cozido/10minutos'), 1, '02 unidades', 2, '[{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Queijo minas","quantidade":0.6,"medida":"02 fatias medias"},{"nome":"Clara de ovo","quantidade":1.5,"medida":"05 unidades"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Mamão, Formosa, cru'), 1.3, '1/2 unidade pequena', 3, '[{"nome":"Morango","quantidade":1.8,"medida":"12 unidades medias"},{"nome":"Melão","quantidade":1.8,"medida":"02 fatias medias"},{"nome":"Kiwi","quantidade":0.8,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.2, '01 scoop pequeno', 4, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Queijo cottage'), 0.8, '03 colheres de sopa', 5, '[{"nome":"Iogurte natural lacfree","quantidade":1.7,"medida":"01 unidade"},{"nome":"Skyr natural","quantidade":1.6,"medida":"01 unidade"},{"nome":"Queijo minas frescal","quantidade":0.6,"medida":"02 fatias medias"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Almoço', '12:00', 2) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Arroz, tipo 1, cozido'), 0.6, '03 colheres de sopa', 1, '[{"nome":"Batata inglesa","quantidade":1.8,"medida":"02 unidades pequenas"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Macarrão cozido","quantidade":0.8,"medida":"01 pegador medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Feijão, carioca, cozido'), 0.86, '04 colheres de sopa', 2, '[{"nome":"Lentilha cozida","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Grão de bico cozido","quantidade":0.6,"medida":"03 colheres de sopa"},{"nome":"Ervilha","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Frango, peito, sem pele, grelhado'), 1.2, '01 file medio', 3, '[{"nome":"Patinho grelhado","quantidade":1,"medida":"01 bife medio"},{"nome":"Peixe grelhado","quantidade":1.4,"medida":"01 file medio"},{"nome":"Lombo suíno","quantidade":1.2,"medida":"01 bife medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais variados (mix cru)'), 2, 'a vontade', 4, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 5, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Azeite, de oliva, extra virgem'), 0.05, '01 colher de cha', 6, '[{"nome":"Manteiga","quantidade":0.1,"medida":"01 colher de cha"},{"nome":"Óleo de coco","quantidade":0.05,"medida":"01 colher de cha"},{"nome":"Castanha do Pará","quantidade":0.15,"medida":"04 unidades"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Lanche', '16:00', 3) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Torrada integral'), 0.3, '03 unidades', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Creme de ricota light'), 0.3, '01 colher de sopa cheia', 2, '[{"nome":"Ovo inteiro","quantidade":0.5,"medida":"01 unidade media"},{"nome":"Requeijão light","quantidade":0.3,"medida":"01 colher de sopa"},{"nome":"Frango desfiado","quantidade":0.5,"medida":"03 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.2, '01 scoop pequeno', 3, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Jantar', '19:30', 4) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Batata, inglesa, cozida'), 1.8, '02 unidades pequenas', 1, '[{"nome":"Arroz branco","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Frango, peito, sem pele, cozido'), 1.2, '06 colheres de sopa', 2, '[{"nome":"Patinho moído","quantidade":1,"medida":"05 colheres de sopa"},{"nome":"Omelete","quantidade":1,"medida":"02 ovos"},{"nome":"Peixe grelhado","quantidade":1.4,"medida":"01 file medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais refogados (mix)'), 2, 'a vontade', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 4, null);
end $cm$;

do $cm$
declare v_plano uuid; v_ref uuid;
begin
  insert into public.planos_alimentares (nutri_id, paciente_id, nome, objetivo, kcal_meta, ativo, observacoes)
  values (auth.uid(), null, 'Ciclo Magro · 1200 kcal · Lútea/Menstrual', 'Lútea/Menstrual', 1200, true, 'Água: 3,0 litros/dia | Para preparar ovos mexidos, voce pode utilizar o oleo da sua preferencia para untar: de soja, canola, girassol, azeite, etc. Desde que utilize um fio de oleo (em zig-zag). | Adocantes para o cafe: Stevia, xilitol, eritritol, sucralose. | Se a fome aumentar, aumente a quantidade de folhas e legumes. | No preparo dos alimentos, utilize temperos naturais como alho, cebola, limao, salsinha, cebolinha, paprica, pimenta do reino, a gosto. Use sal com moderacao (NAO e para zerar). Evite ao maximo temperos prontos. | Voce pode utilizar o oleo da sua preferencia para grelhar. Utilize um fio de oleo em zig-zag. | Ocasionalmente, pode utilizar ketchup zero ou mostarda nas refeicoes.')
  returning id into v_plano;

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Café da manhã', '07:00', 1) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Aveia, flocos, crua'), 0.3, '03 colheres de sopa', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Cuscuz de milho","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Ovo, de galinha, inteiro, cozido/10minutos'), 1, '02 unidades', 2, '[{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Queijo minas","quantidade":0.6,"medida":"02 fatias medias"},{"nome":"Clara de ovo","quantidade":1.5,"medida":"05 unidades"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Banana, prata, crua'), 1, '01 unidade media', 3, '[{"nome":"Mamão formosa","quantidade":1.3,"medida":"1/2 unidade pequena"},{"nome":"Maçã","quantidade":0.9,"medida":"01 unidade pequena"},{"nome":"Pêra","quantidade":1,"medida":"01 unidade media"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.2, '01 scoop pequeno', 4, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Almoço', '12:00', 2) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Arroz, tipo 1, cozido'), 0.6, '03 colheres de sopa', 1, '[{"nome":"Batata inglesa","quantidade":1.8,"medida":"02 unidades pequenas"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Macarrão cozido","quantidade":0.8,"medida":"01 pegador medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Feijão, carioca, cozido'), 0.86, '04 colheres de sopa', 2, '[{"nome":"Lentilha cozida","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Grão de bico cozido","quantidade":0.6,"medida":"03 colheres de sopa"},{"nome":"Ervilha","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Carne, bovina, maminha, grelhada'), 1, '01 bife medio', 3, '[{"nome":"Sardinha ao natural","quantidade":1,"medida":"1/2 lata"},{"nome":"Peito de frango grelhado","quantidade":1.2,"medida":"01 file medio"},{"nome":"Atum em água","quantidade":1,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais variados (mix cru)'), 2, 'a vontade', 4, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 5, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Azeite, de oliva, extra virgem'), 0.05, '01 colher de cha', 6, '[{"nome":"Manteiga","quantidade":0.1,"medida":"01 colher de cha"},{"nome":"Óleo de coco","quantidade":0.05,"medida":"01 colher de cha"},{"nome":"Castanha do Pará","quantidade":0.15,"medida":"04 unidades"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Lanche', '16:00', 3) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Torrada integral'), 0.3, '03 unidades', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Pasta de amendoim integral'), 0.15, '01 colher de sopa', 2, '[{"nome":"Amendoim torrado","quantidade":0.15,"medida":"02 colheres de sopa"},{"nome":"Castanha de caju","quantidade":0.15,"medida":"08 unidades"},{"nome":"Abacate","quantidade":0.5,"medida":"02 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Chocolate 70% cacau'), 0.15, '01 quadradinho', 3, null);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Jantar', '19:30', 4) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Batata, doce, cozida'), 1, '02 pedacos medios', 1, '[{"nome":"Arroz branco","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Inhame cozido","quantidade":0.9,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Sardinha, assada'), 1, '1/2 lata', 2, '[{"nome":"Atum em água","quantidade":1,"medida":"04 colheres de sopa"},{"nome":"Peito de frango desfiado","quantidade":1.2,"medida":"06 colheres de sopa"},{"nome":"Patinho moído","quantidade":1,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais refogados (mix)'), 2, 'a vontade', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 4, null);
end $cm$;

do $cm$
declare v_plano uuid; v_ref uuid;
begin
  insert into public.planos_alimentares (nutri_id, paciente_id, nome, objetivo, kcal_meta, ativo, observacoes)
  values (auth.uid(), null, 'Ciclo Magro · 1300 kcal · Folicular/Ovulatória', 'Folicular/Ovulatória', 1300, true, 'Água: 2,0 litros/dia | Para preparar ovos mexidos, voce pode utilizar o oleo da sua preferencia para untar: de soja, canola, girassol, azeite, etc. Desde que utilize um fio de oleo (em zig-zag). | Adocantes para o cafe: Stevia, xilitol, eritritol, sucralose. | Se a fome aumentar, aumente a quantidade de folhas e legumes. | No preparo dos alimentos, utilize temperos naturais como alho, cebola, limao, salsinha, cebolinha, paprica, pimenta do reino, a gosto. Use sal com moderacao (NAO e para zerar). Evite ao maximo temperos prontos. | Voce pode utilizar o oleo da sua preferencia para grelhar. Utilize um fio de oleo em zig-zag. | Ocasionalmente, pode utilizar ketchup zero ou mostarda nas refeicoes.')
  returning id into v_plano;

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Café da manhã', '07:00', 1) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Pão, trigo, forma, integral'), 0.5, '02 fatias', 1, '[{"nome":"Goma de tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Cuscuz de milho","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Banana da terra","quantidade":0.7,"medida":"1/2 unidade media"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Ovo, de galinha, inteiro, cozido/10minutos'), 1, '02 unidades', 2, '[{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Queijo minas","quantidade":0.6,"medida":"02 fatias medias"},{"nome":"Clara de ovo","quantidade":1.5,"medida":"05 unidades"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Mamão, Formosa, cru'), 1.3, '1/2 unidade pequena', 3, '[{"nome":"Morango","quantidade":1.8,"medida":"12 unidades medias"},{"nome":"Melão","quantidade":1.8,"medida":"02 fatias medias"},{"nome":"Kiwi","quantidade":0.8,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.25, '01 scoop medio', 4, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Queijo cottage'), 0.8, '03 colheres de sopa', 5, '[{"nome":"Iogurte natural lacfree","quantidade":1.7,"medida":"01 unidade"},{"nome":"Skyr natural","quantidade":1.6,"medida":"01 unidade"},{"nome":"Queijo minas frescal","quantidade":0.6,"medida":"02 fatias medias"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Almoço', '12:00', 2) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Arroz, tipo 1, cozido'), 0.8, '04 colheres de sopa', 1, '[{"nome":"Batata inglesa","quantidade":1.8,"medida":"02 unidades pequenas"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Macarrão cozido","quantidade":0.8,"medida":"01 pegador medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Feijão, carioca, cozido'), 0.86, '04 colheres de sopa', 2, '[{"nome":"Lentilha cozida","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Grão de bico cozido","quantidade":0.6,"medida":"03 colheres de sopa"},{"nome":"Ervilha","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Frango, peito, sem pele, grelhado'), 1.3, '01 file medio', 3, '[{"nome":"Patinho grelhado","quantidade":1,"medida":"01 bife medio"},{"nome":"Peixe grelhado","quantidade":1.4,"medida":"01 file medio"},{"nome":"Lombo suíno","quantidade":1.2,"medida":"01 bife medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais variados (mix cru)'), 2, 'a vontade', 4, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 5, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Azeite, de oliva, extra virgem'), 0.05, '01 colher de cha', 6, '[{"nome":"Manteiga","quantidade":0.1,"medida":"01 colher de cha"},{"nome":"Óleo de coco","quantidade":0.05,"medida":"01 colher de cha"},{"nome":"Castanha do Pará","quantidade":0.15,"medida":"04 unidades"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Lanche', '16:00', 3) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Torrada integral'), 0.4, '04 unidades', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Creme de ricota light'), 0.3, '01 colher de sopa cheia', 2, '[{"nome":"Ovo inteiro","quantidade":0.5,"medida":"01 unidade media"},{"nome":"Requeijão light","quantidade":0.3,"medida":"01 colher de sopa"},{"nome":"Frango desfiado","quantidade":0.5,"medida":"03 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.2, '01 scoop pequeno', 3, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Jantar', '19:30', 4) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Batata, inglesa, cozida'), 1.8, '02 unidades pequenas', 1, '[{"nome":"Arroz branco","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Frango, peito, sem pele, cozido'), 1.2, '06 colheres de sopa', 2, '[{"nome":"Patinho moído","quantidade":1,"medida":"05 colheres de sopa"},{"nome":"Omelete","quantidade":1,"medida":"02 ovos"},{"nome":"Peixe grelhado","quantidade":1.4,"medida":"01 file medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais refogados (mix)'), 2, 'a vontade', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 4, null);
end $cm$;

do $cm$
declare v_plano uuid; v_ref uuid;
begin
  insert into public.planos_alimentares (nutri_id, paciente_id, nome, objetivo, kcal_meta, ativo, observacoes)
  values (auth.uid(), null, 'Ciclo Magro · 1300 kcal · Lútea/Menstrual', 'Lútea/Menstrual', 1300, true, 'Água: 3,0 litros/dia | Para preparar ovos mexidos, voce pode utilizar o oleo da sua preferencia para untar: de soja, canola, girassol, azeite, etc. Desde que utilize um fio de oleo (em zig-zag). | Adocantes para o cafe: Stevia, xilitol, eritritol, sucralose. | Se a fome aumentar, aumente a quantidade de folhas e legumes. | No preparo dos alimentos, utilize temperos naturais como alho, cebola, limao, salsinha, cebolinha, paprica, pimenta do reino, a gosto. Use sal com moderacao (NAO e para zerar). Evite ao maximo temperos prontos. | Voce pode utilizar o oleo da sua preferencia para grelhar. Utilize um fio de oleo em zig-zag. | Ocasionalmente, pode utilizar ketchup zero ou mostarda nas refeicoes.')
  returning id into v_plano;

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Café da manhã', '07:00', 1) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Aveia, flocos, crua'), 0.4, '04 colheres de sopa', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Cuscuz de milho","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Ovo, de galinha, inteiro, cozido/10minutos'), 1, '02 unidades', 2, '[{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Queijo minas","quantidade":0.6,"medida":"02 fatias medias"},{"nome":"Clara de ovo","quantidade":1.5,"medida":"05 unidades"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Banana, prata, crua'), 1, '01 unidade media', 3, '[{"nome":"Mamão formosa","quantidade":1.3,"medida":"1/2 unidade pequena"},{"nome":"Maçã","quantidade":0.9,"medida":"01 unidade pequena"},{"nome":"Pêra","quantidade":1,"medida":"01 unidade media"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.25, '01 scoop medio', 4, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Almoço', '12:00', 2) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Arroz, tipo 1, cozido'), 0.8, '04 colheres de sopa', 1, '[{"nome":"Batata inglesa","quantidade":1.8,"medida":"02 unidades pequenas"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Macarrão cozido","quantidade":0.8,"medida":"01 pegador medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Feijão, carioca, cozido'), 0.86, '04 colheres de sopa', 2, '[{"nome":"Lentilha cozida","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Grão de bico cozido","quantidade":0.6,"medida":"03 colheres de sopa"},{"nome":"Ervilha","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Carne, bovina, maminha, grelhada'), 1.1, '01 bife medio', 3, '[{"nome":"Sardinha ao natural","quantidade":1,"medida":"1/2 lata"},{"nome":"Peito de frango grelhado","quantidade":1.2,"medida":"01 file medio"},{"nome":"Atum em água","quantidade":1,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais variados (mix cru)'), 2, 'a vontade', 4, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 5, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Azeite, de oliva, extra virgem'), 0.05, '01 colher de cha', 6, '[{"nome":"Manteiga","quantidade":0.1,"medida":"01 colher de cha"},{"nome":"Óleo de coco","quantidade":0.05,"medida":"01 colher de cha"},{"nome":"Castanha do Pará","quantidade":0.15,"medida":"04 unidades"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Lanche', '16:00', 3) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Torrada integral'), 0.4, '04 unidades', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Pasta de amendoim integral'), 0.15, '01 colher de sopa', 2, '[{"nome":"Amendoim torrado","quantidade":0.15,"medida":"02 colheres de sopa"},{"nome":"Castanha de caju","quantidade":0.15,"medida":"08 unidades"},{"nome":"Abacate","quantidade":0.5,"medida":"02 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Chocolate 70% cacau'), 0.15, '01 quadradinho', 3, null);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Jantar', '19:30', 4) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Batata, doce, cozida'), 1.2, '02 pedacos medios', 1, '[{"nome":"Arroz branco","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Inhame cozido","quantidade":0.9,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Sardinha, assada'), 1, '1/2 lata', 2, '[{"nome":"Atum em água","quantidade":1,"medida":"04 colheres de sopa"},{"nome":"Peito de frango desfiado","quantidade":1.2,"medida":"06 colheres de sopa"},{"nome":"Patinho moído","quantidade":1,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais refogados (mix)'), 2, 'a vontade', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 4, null);
end $cm$;

do $cm$
declare v_plano uuid; v_ref uuid;
begin
  insert into public.planos_alimentares (nutri_id, paciente_id, nome, objetivo, kcal_meta, ativo, observacoes)
  values (auth.uid(), null, 'Ciclo Magro · 1400 kcal · Folicular/Ovulatória', 'Folicular/Ovulatória', 1400, true, 'Água: 2,0 litros/dia | Para preparar ovos mexidos, voce pode utilizar o oleo da sua preferencia para untar: de soja, canola, girassol, azeite, etc. Desde que utilize um fio de oleo (em zig-zag). | Adocantes para o cafe: Stevia, xilitol, eritritol, sucralose. | Se a fome aumentar, aumente a quantidade de folhas e legumes. | No preparo dos alimentos, utilize temperos naturais como alho, cebola, limao, salsinha, cebolinha, paprica, pimenta do reino, a gosto. Use sal com moderacao (NAO e para zerar). Evite ao maximo temperos prontos. | Voce pode utilizar o oleo da sua preferencia para grelhar. Utilize um fio de oleo em zig-zag. | Ocasionalmente, pode utilizar ketchup zero ou mostarda nas refeicoes.')
  returning id into v_plano;

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Café da manhã', '07:00', 1) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Pão, trigo, forma, integral'), 0.5, '02 fatias', 1, '[{"nome":"Goma de tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Cuscuz de milho","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Banana da terra","quantidade":0.7,"medida":"1/2 unidade media"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Ovo, de galinha, inteiro, cozido/10minutos'), 1, '02 unidades', 2, '[{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Queijo minas","quantidade":0.6,"medida":"02 fatias medias"},{"nome":"Clara de ovo","quantidade":1.5,"medida":"05 unidades"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Mamão, Formosa, cru'), 1.3, '1/2 unidade pequena', 3, '[{"nome":"Morango","quantidade":1.8,"medida":"12 unidades medias"},{"nome":"Melão","quantidade":1.8,"medida":"02 fatias medias"},{"nome":"Kiwi","quantidade":0.8,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.25, '01 scoop medio', 4, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Queijo cottage'), 1, '04 colheres de sopa', 5, '[{"nome":"Iogurte natural lacfree","quantidade":1.7,"medida":"01 unidade"},{"nome":"Skyr natural","quantidade":1.6,"medida":"01 unidade"},{"nome":"Queijo minas frescal","quantidade":0.6,"medida":"02 fatias medias"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Almoço', '12:00', 2) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Arroz, tipo 1, cozido'), 0.8, '04 colheres de sopa', 1, '[{"nome":"Batata inglesa","quantidade":1.8,"medida":"02 unidades pequenas"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Macarrão cozido","quantidade":0.8,"medida":"01 pegador medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Feijão, carioca, cozido'), 0.86, '04 colheres de sopa', 2, '[{"nome":"Lentilha cozida","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Grão de bico cozido","quantidade":0.6,"medida":"03 colheres de sopa"},{"nome":"Ervilha","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Frango, peito, sem pele, grelhado'), 1.4, '01 file grande', 3, '[{"nome":"Patinho grelhado","quantidade":1,"medida":"01 bife medio"},{"nome":"Peixe grelhado","quantidade":1.4,"medida":"01 file medio"},{"nome":"Lombo suíno","quantidade":1.2,"medida":"01 bife medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais variados (mix cru)'), 2, 'a vontade', 4, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 5, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Azeite, de oliva, extra virgem'), 0.05, '01 colher de cha', 6, '[{"nome":"Manteiga","quantidade":0.1,"medida":"01 colher de cha"},{"nome":"Óleo de coco","quantidade":0.05,"medida":"01 colher de cha"},{"nome":"Castanha do Pará","quantidade":0.15,"medida":"04 unidades"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Lanche', '16:00', 3) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Torrada integral'), 0.4, '04 unidades', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Creme de ricota light'), 0.3, '01 colher de sopa cheia', 2, '[{"nome":"Ovo inteiro","quantidade":0.5,"medida":"01 unidade media"},{"nome":"Requeijão light","quantidade":0.3,"medida":"01 colher de sopa"},{"nome":"Frango desfiado","quantidade":0.5,"medida":"03 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.25, '01 scoop medio', 3, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Banana, prata, crua'), 0.8, '01 unidade pequena', 4, '[{"nome":"Mamão formosa","quantidade":1.3,"medida":"1/2 unidade pequena"},{"nome":"Maçã","quantidade":0.9,"medida":"01 unidade pequena"},{"nome":"Pêra","quantidade":1,"medida":"01 unidade media"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Jantar', '19:30', 4) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Batata, inglesa, cozida'), 1.8, '02 unidades pequenas', 1, '[{"nome":"Arroz branco","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Frango, peito, sem pele, cozido'), 1.3, '07 colheres de sopa', 2, '[{"nome":"Patinho moído","quantidade":1,"medida":"05 colheres de sopa"},{"nome":"Omelete","quantidade":1,"medida":"02 ovos"},{"nome":"Peixe grelhado","quantidade":1.4,"medida":"01 file medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais refogados (mix)'), 2, 'a vontade', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 4, null);
end $cm$;

do $cm$
declare v_plano uuid; v_ref uuid;
begin
  insert into public.planos_alimentares (nutri_id, paciente_id, nome, objetivo, kcal_meta, ativo, observacoes)
  values (auth.uid(), null, 'Ciclo Magro · 1400 kcal · Lútea/Menstrual', 'Lútea/Menstrual', 1400, true, 'Água: 3,0 litros/dia | Para preparar ovos mexidos, voce pode utilizar o oleo da sua preferencia para untar: de soja, canola, girassol, azeite, etc. Desde que utilize um fio de oleo (em zig-zag). | Adocantes para o cafe: Stevia, xilitol, eritritol, sucralose. | Se a fome aumentar, aumente a quantidade de folhas e legumes. | No preparo dos alimentos, utilize temperos naturais como alho, cebola, limao, salsinha, cebolinha, paprica, pimenta do reino, a gosto. Use sal com moderacao (NAO e para zerar). Evite ao maximo temperos prontos. | Voce pode utilizar o oleo da sua preferencia para grelhar. Utilize um fio de oleo em zig-zag. | Ocasionalmente, pode utilizar ketchup zero ou mostarda nas refeicoes.')
  returning id into v_plano;

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Café da manhã', '07:00', 1) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Aveia, flocos, crua'), 0.4, '04 colheres de sopa', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Cuscuz de milho","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Ovo, de galinha, inteiro, cozido/10minutos'), 1, '02 unidades', 2, '[{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Queijo minas","quantidade":0.6,"medida":"02 fatias medias"},{"nome":"Clara de ovo","quantidade":1.5,"medida":"05 unidades"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Banana, prata, crua'), 1.2, '01 unidade grande', 3, '[{"nome":"Mamão formosa","quantidade":1.3,"medida":"1/2 unidade pequena"},{"nome":"Maçã","quantidade":0.9,"medida":"01 unidade pequena"},{"nome":"Pêra","quantidade":1,"medida":"01 unidade media"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.25, '01 scoop medio', 4, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Almoço', '12:00', 2) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Arroz, tipo 1, cozido'), 0.8, '04 colheres de sopa', 1, '[{"nome":"Batata inglesa","quantidade":1.8,"medida":"02 unidades pequenas"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Macarrão cozido","quantidade":0.8,"medida":"01 pegador medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Feijão, carioca, cozido'), 0.86, '04 colheres de sopa', 2, '[{"nome":"Lentilha cozida","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Grão de bico cozido","quantidade":0.6,"medida":"03 colheres de sopa"},{"nome":"Ervilha","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Carne, bovina, maminha, grelhada'), 1.2, '01 bife medio', 3, '[{"nome":"Sardinha ao natural","quantidade":1,"medida":"1/2 lata"},{"nome":"Peito de frango grelhado","quantidade":1.2,"medida":"01 file medio"},{"nome":"Atum em água","quantidade":1,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais variados (mix cru)'), 2, 'a vontade', 4, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 5, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Azeite, de oliva, extra virgem'), 0.05, '01 colher de cha', 6, '[{"nome":"Manteiga","quantidade":0.1,"medida":"01 colher de cha"},{"nome":"Óleo de coco","quantidade":0.05,"medida":"01 colher de cha"},{"nome":"Castanha do Pará","quantidade":0.15,"medida":"04 unidades"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Lanche', '16:00', 3) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Torrada integral'), 0.4, '04 unidades', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Pasta de amendoim integral'), 0.2, '01 colher de sopa cheia', 2, '[{"nome":"Amendoim torrado","quantidade":0.15,"medida":"02 colheres de sopa"},{"nome":"Castanha de caju","quantidade":0.15,"medida":"08 unidades"},{"nome":"Abacate","quantidade":0.5,"medida":"02 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Chocolate 70% cacau'), 0.15, '01 quadradinho', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Mamão, Formosa, cru'), 0.9, '01 fatia pequena', 4, '[{"nome":"Morango","quantidade":1.8,"medida":"12 unidades medias"},{"nome":"Melão","quantidade":1.8,"medida":"02 fatias medias"},{"nome":"Kiwi","quantidade":0.8,"medida":"01 unidade"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Jantar', '19:30', 4) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Batata, doce, cozida'), 1.4, '02 pedacos medios', 1, '[{"nome":"Arroz branco","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Inhame cozido","quantidade":0.9,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Sardinha, assada'), 1, '1/2 lata', 2, '[{"nome":"Atum em água","quantidade":1,"medida":"04 colheres de sopa"},{"nome":"Peito de frango desfiado","quantidade":1.2,"medida":"06 colheres de sopa"},{"nome":"Patinho moído","quantidade":1,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais refogados (mix)'), 2, 'a vontade', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 4, null);
end $cm$;

do $cm$
declare v_plano uuid; v_ref uuid;
begin
  insert into public.planos_alimentares (nutri_id, paciente_id, nome, objetivo, kcal_meta, ativo, observacoes)
  values (auth.uid(), null, 'Ciclo Magro · 1500 kcal · Folicular/Ovulatória', 'Folicular/Ovulatória', 1500, true, 'Água: 2,0 litros/dia | Para preparar ovos mexidos, voce pode utilizar o oleo da sua preferencia para untar: de soja, canola, girassol, azeite, etc. Desde que utilize um fio de oleo (em zig-zag). | Adocantes para o cafe: Stevia, xilitol, eritritol, sucralose. | Se a fome aumentar, aumente a quantidade de folhas e legumes. | No preparo dos alimentos, utilize temperos naturais como alho, cebola, limao, salsinha, cebolinha, paprica, pimenta do reino, a gosto. Use sal com moderacao (NAO e para zerar). Evite ao maximo temperos prontos. | Voce pode utilizar o oleo da sua preferencia para grelhar. Utilize um fio de oleo em zig-zag. | Ocasionalmente, pode utilizar ketchup zero ou mostarda nas refeicoes.')
  returning id into v_plano;

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Café da manhã', '07:00', 1) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Pão, trigo, forma, integral'), 0.75, '03 fatias', 1, '[{"nome":"Goma de tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Cuscuz de milho","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Banana da terra","quantidade":0.7,"medida":"1/2 unidade media"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Ovo, de galinha, inteiro, cozido/10minutos'), 1, '02 unidades', 2, '[{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Queijo minas","quantidade":0.6,"medida":"02 fatias medias"},{"nome":"Clara de ovo","quantidade":1.5,"medida":"05 unidades"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Mamão, Formosa, cru'), 1.3, '1/2 unidade pequena', 3, '[{"nome":"Morango","quantidade":1.8,"medida":"12 unidades medias"},{"nome":"Melão","quantidade":1.8,"medida":"02 fatias medias"},{"nome":"Kiwi","quantidade":0.8,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.25, '01 scoop medio', 4, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Queijo cottage'), 1, '04 colheres de sopa', 5, '[{"nome":"Iogurte natural lacfree","quantidade":1.7,"medida":"01 unidade"},{"nome":"Skyr natural","quantidade":1.6,"medida":"01 unidade"},{"nome":"Queijo minas frescal","quantidade":0.6,"medida":"02 fatias medias"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Almoço', '12:00', 2) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Arroz, tipo 1, cozido'), 1, '05 colheres de sopa', 1, '[{"nome":"Batata inglesa","quantidade":1.8,"medida":"02 unidades pequenas"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Macarrão cozido","quantidade":0.8,"medida":"01 pegador medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Feijão, carioca, cozido'), 0.86, '04 colheres de sopa', 2, '[{"nome":"Lentilha cozida","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Grão de bico cozido","quantidade":0.6,"medida":"03 colheres de sopa"},{"nome":"Ervilha","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Frango, peito, sem pele, grelhado'), 1.4, '01 file grande', 3, '[{"nome":"Patinho grelhado","quantidade":1,"medida":"01 bife medio"},{"nome":"Peixe grelhado","quantidade":1.4,"medida":"01 file medio"},{"nome":"Lombo suíno","quantidade":1.2,"medida":"01 bife medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais variados (mix cru)'), 2, 'a vontade', 4, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 5, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Azeite, de oliva, extra virgem'), 0.05, '01 colher de cha', 6, '[{"nome":"Manteiga","quantidade":0.1,"medida":"01 colher de cha"},{"nome":"Óleo de coco","quantidade":0.05,"medida":"01 colher de cha"},{"nome":"Castanha do Pará","quantidade":0.15,"medida":"04 unidades"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Lanche', '16:00', 3) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Torrada integral'), 0.4, '04 unidades', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Creme de ricota light'), 0.3, '01 colher de sopa cheia', 2, '[{"nome":"Ovo inteiro","quantidade":0.5,"medida":"01 unidade media"},{"nome":"Requeijão light","quantidade":0.3,"medida":"01 colher de sopa"},{"nome":"Frango desfiado","quantidade":0.5,"medida":"03 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.25, '01 scoop medio', 3, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Mamão, Formosa, cru'), 0.9, '01 fatia pequena', 4, '[{"nome":"Morango","quantidade":1.8,"medida":"12 unidades medias"},{"nome":"Melão","quantidade":1.8,"medida":"02 fatias medias"},{"nome":"Kiwi","quantidade":0.8,"medida":"01 unidade"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Jantar', '19:30', 4) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Batata, inglesa, cozida'), 2, '02 unidades medias', 1, '[{"nome":"Arroz branco","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Frango, peito, sem pele, cozido'), 1.3, '07 colheres de sopa', 2, '[{"nome":"Patinho moído","quantidade":1,"medida":"05 colheres de sopa"},{"nome":"Omelete","quantidade":1,"medida":"02 ovos"},{"nome":"Peixe grelhado","quantidade":1.4,"medida":"01 file medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais refogados (mix)'), 2, 'a vontade', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 4, null);
end $cm$;

do $cm$
declare v_plano uuid; v_ref uuid;
begin
  insert into public.planos_alimentares (nutri_id, paciente_id, nome, objetivo, kcal_meta, ativo, observacoes)
  values (auth.uid(), null, 'Ciclo Magro · 1500 kcal · Lútea/Menstrual', 'Lútea/Menstrual', 1500, true, 'Água: 3,0 litros/dia | Para preparar ovos mexidos, voce pode utilizar o oleo da sua preferencia para untar: de soja, canola, girassol, azeite, etc. Desde que utilize um fio de oleo (em zig-zag). | Adocantes para o cafe: Stevia, xilitol, eritritol, sucralose. | Se a fome aumentar, aumente a quantidade de folhas e legumes. | No preparo dos alimentos, utilize temperos naturais como alho, cebola, limao, salsinha, cebolinha, paprica, pimenta do reino, a gosto. Use sal com moderacao (NAO e para zerar). Evite ao maximo temperos prontos. | Voce pode utilizar o oleo da sua preferencia para grelhar. Utilize um fio de oleo em zig-zag. | Ocasionalmente, pode utilizar ketchup zero ou mostarda nas refeicoes.')
  returning id into v_plano;

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Café da manhã', '07:00', 1) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Aveia, flocos, crua'), 0.5, '05 colheres de sopa', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Cuscuz de milho","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Ovo, de galinha, inteiro, cozido/10minutos'), 1, '02 unidades', 2, '[{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Queijo minas","quantidade":0.6,"medida":"02 fatias medias"},{"nome":"Clara de ovo","quantidade":1.5,"medida":"05 unidades"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Banana, prata, crua'), 1.2, '01 unidade grande', 3, '[{"nome":"Mamão formosa","quantidade":1.3,"medida":"1/2 unidade pequena"},{"nome":"Maçã","quantidade":0.9,"medida":"01 unidade pequena"},{"nome":"Pêra","quantidade":1,"medida":"01 unidade media"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.25, '01 scoop medio', 4, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Almoço', '12:00', 2) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Arroz, tipo 1, cozido'), 1, '05 colheres de sopa', 1, '[{"nome":"Batata inglesa","quantidade":1.8,"medida":"02 unidades pequenas"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Macarrão cozido","quantidade":0.8,"medida":"01 pegador medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Feijão, carioca, cozido'), 0.86, '04 colheres de sopa', 2, '[{"nome":"Lentilha cozida","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Grão de bico cozido","quantidade":0.6,"medida":"03 colheres de sopa"},{"nome":"Ervilha","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Carne, bovina, maminha, grelhada'), 1.2, '01 bife medio', 3, '[{"nome":"Sardinha ao natural","quantidade":1,"medida":"1/2 lata"},{"nome":"Peito de frango grelhado","quantidade":1.2,"medida":"01 file medio"},{"nome":"Atum em água","quantidade":1,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais variados (mix cru)'), 2, 'a vontade', 4, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 5, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Azeite, de oliva, extra virgem'), 0.05, '01 colher de cha', 6, '[{"nome":"Manteiga","quantidade":0.1,"medida":"01 colher de cha"},{"nome":"Óleo de coco","quantidade":0.05,"medida":"01 colher de cha"},{"nome":"Castanha do Pará","quantidade":0.15,"medida":"04 unidades"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Lanche', '16:00', 3) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Torrada integral'), 0.4, '04 unidades', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Pasta de amendoim integral'), 0.2, '01 colher de sopa cheia', 2, '[{"nome":"Amendoim torrado","quantidade":0.15,"medida":"02 colheres de sopa"},{"nome":"Castanha de caju","quantidade":0.15,"medida":"08 unidades"},{"nome":"Abacate","quantidade":0.5,"medida":"02 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Chocolate 70% cacau'), 0.15, '01 quadradinho', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Banana, prata, crua'), 0.8, '01 unidade pequena', 4, '[{"nome":"Mamão formosa","quantidade":1.3,"medida":"1/2 unidade pequena"},{"nome":"Maçã","quantidade":0.9,"medida":"01 unidade pequena"},{"nome":"Pêra","quantidade":1,"medida":"01 unidade media"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Jantar', '19:30', 4) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Batata, doce, cozida'), 1.5, '02 pedacos grandes', 1, '[{"nome":"Arroz branco","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Inhame cozido","quantidade":0.9,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Sardinha, assada'), 1.2, '1/2 lata', 2, '[{"nome":"Atum em água","quantidade":1,"medida":"04 colheres de sopa"},{"nome":"Peito de frango desfiado","quantidade":1.2,"medida":"06 colheres de sopa"},{"nome":"Patinho moído","quantidade":1,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais refogados (mix)'), 2, 'a vontade', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 4, null);
end $cm$;

do $cm$
declare v_plano uuid; v_ref uuid;
begin
  insert into public.planos_alimentares (nutri_id, paciente_id, nome, objetivo, kcal_meta, ativo, observacoes)
  values (auth.uid(), null, 'Ciclo Magro · 1600 kcal · Folicular/Ovulatória', 'Folicular/Ovulatória', 1600, true, 'Água: 2,0 litros/dia | Para preparar ovos mexidos, voce pode utilizar o oleo da sua preferencia para untar: de soja, canola, girassol, azeite, etc. Desde que utilize um fio de oleo (em zig-zag). | Adocantes para o cafe: Stevia, xilitol, eritritol, sucralose. | Se a fome aumentar, aumente a quantidade de folhas e legumes. | No preparo dos alimentos, utilize temperos naturais como alho, cebola, limao, salsinha, cebolinha, paprica, pimenta do reino, a gosto. Use sal com moderacao (NAO e para zerar). Evite ao maximo temperos prontos. | Voce pode utilizar o oleo da sua preferencia para grelhar. Utilize um fio de oleo em zig-zag. | Ocasionalmente, pode utilizar ketchup zero ou mostarda nas refeicoes.')
  returning id into v_plano;

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Café da manhã', '07:00', 1) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Pão, trigo, forma, integral'), 0.75, '03 fatias', 1, '[{"nome":"Goma de tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Cuscuz de milho","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Banana da terra","quantidade":0.7,"medida":"1/2 unidade media"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Ovo, de galinha, inteiro, cozido/10minutos'), 1, '02 unidades', 2, '[{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Queijo minas","quantidade":0.6,"medida":"02 fatias medias"},{"nome":"Clara de ovo","quantidade":1.5,"medida":"05 unidades"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Mamão, Formosa, cru'), 1.3, '1/2 unidade pequena', 3, '[{"nome":"Morango","quantidade":1.8,"medida":"12 unidades medias"},{"nome":"Melão","quantidade":1.8,"medida":"02 fatias medias"},{"nome":"Kiwi","quantidade":0.8,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.3, '01 scoop grande', 4, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Queijo cottage'), 1, '04 colheres de sopa', 5, '[{"nome":"Iogurte natural lacfree","quantidade":1.7,"medida":"01 unidade"},{"nome":"Skyr natural","quantidade":1.6,"medida":"01 unidade"},{"nome":"Queijo minas frescal","quantidade":0.6,"medida":"02 fatias medias"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Almoço', '12:00', 2) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Arroz, tipo 1, cozido'), 1, '05 colheres de sopa', 1, '[{"nome":"Batata inglesa","quantidade":1.8,"medida":"02 unidades pequenas"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Macarrão cozido","quantidade":0.8,"medida":"01 pegador medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Feijão, carioca, cozido'), 0.86, '04 colheres de sopa', 2, '[{"nome":"Lentilha cozida","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Grão de bico cozido","quantidade":0.6,"medida":"03 colheres de sopa"},{"nome":"Ervilha","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Frango, peito, sem pele, grelhado'), 1.5, '01 file grande', 3, '[{"nome":"Patinho grelhado","quantidade":1,"medida":"01 bife medio"},{"nome":"Peixe grelhado","quantidade":1.4,"medida":"01 file medio"},{"nome":"Lombo suíno","quantidade":1.2,"medida":"01 bife medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais variados (mix cru)'), 2, 'a vontade', 4, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 5, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Azeite, de oliva, extra virgem'), 0.05, '01 colher de cha', 6, '[{"nome":"Manteiga","quantidade":0.1,"medida":"01 colher de cha"},{"nome":"Óleo de coco","quantidade":0.05,"medida":"01 colher de cha"},{"nome":"Castanha do Pará","quantidade":0.15,"medida":"04 unidades"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Lanche', '16:00', 3) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Torrada integral'), 0.4, '04 unidades', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Creme de ricota light'), 0.3, '01 colher de sopa cheia', 2, '[{"nome":"Ovo inteiro","quantidade":0.5,"medida":"01 unidade media"},{"nome":"Requeijão light","quantidade":0.3,"medida":"01 colher de sopa"},{"nome":"Frango desfiado","quantidade":0.5,"medida":"03 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.25, '01 scoop medio', 3, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Banana, prata, crua'), 1, '01 unidade media', 4, '[{"nome":"Mamão formosa","quantidade":1.3,"medida":"1/2 unidade pequena"},{"nome":"Maçã","quantidade":0.9,"medida":"01 unidade pequena"},{"nome":"Pêra","quantidade":1,"medida":"01 unidade media"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Jantar', '19:30', 4) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Batata, inglesa, cozida'), 2, '02 unidades medias', 1, '[{"nome":"Arroz branco","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Frango, peito, sem pele, cozido'), 1.4, '07 colheres de sopa', 2, '[{"nome":"Patinho moído","quantidade":1,"medida":"05 colheres de sopa"},{"nome":"Omelete","quantidade":1,"medida":"02 ovos"},{"nome":"Peixe grelhado","quantidade":1.4,"medida":"01 file medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais refogados (mix)'), 2, 'a vontade', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 4, null);
end $cm$;

do $cm$
declare v_plano uuid; v_ref uuid;
begin
  insert into public.planos_alimentares (nutri_id, paciente_id, nome, objetivo, kcal_meta, ativo, observacoes)
  values (auth.uid(), null, 'Ciclo Magro · 1600 kcal · Lútea/Menstrual', 'Lútea/Menstrual', 1600, true, 'Água: 3,0 litros/dia | Para preparar ovos mexidos, voce pode utilizar o oleo da sua preferencia para untar: de soja, canola, girassol, azeite, etc. Desde que utilize um fio de oleo (em zig-zag). | Adocantes para o cafe: Stevia, xilitol, eritritol, sucralose. | Se a fome aumentar, aumente a quantidade de folhas e legumes. | No preparo dos alimentos, utilize temperos naturais como alho, cebola, limao, salsinha, cebolinha, paprica, pimenta do reino, a gosto. Use sal com moderacao (NAO e para zerar). Evite ao maximo temperos prontos. | Voce pode utilizar o oleo da sua preferencia para grelhar. Utilize um fio de oleo em zig-zag. | Ocasionalmente, pode utilizar ketchup zero ou mostarda nas refeicoes.')
  returning id into v_plano;

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Café da manhã', '07:00', 1) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Aveia, flocos, crua'), 0.5, '05 colheres de sopa', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Cuscuz de milho","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Ovo, de galinha, inteiro, cozido/10minutos'), 1.5, '03 unidades', 2, '[{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Queijo minas","quantidade":0.6,"medida":"02 fatias medias"},{"nome":"Clara de ovo","quantidade":1.5,"medida":"05 unidades"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Banana, prata, crua'), 1.2, '01 unidade grande', 3, '[{"nome":"Mamão formosa","quantidade":1.3,"medida":"1/2 unidade pequena"},{"nome":"Maçã","quantidade":0.9,"medida":"01 unidade pequena"},{"nome":"Pêra","quantidade":1,"medida":"01 unidade media"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.25, '01 scoop medio', 4, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Almoço', '12:00', 2) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Arroz, tipo 1, cozido'), 1, '05 colheres de sopa', 1, '[{"nome":"Batata inglesa","quantidade":1.8,"medida":"02 unidades pequenas"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Macarrão cozido","quantidade":0.8,"medida":"01 pegador medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Feijão, carioca, cozido'), 0.86, '04 colheres de sopa', 2, '[{"nome":"Lentilha cozida","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Grão de bico cozido","quantidade":0.6,"medida":"03 colheres de sopa"},{"nome":"Ervilha","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Carne, bovina, maminha, grelhada'), 1.3, '01 bife grande', 3, '[{"nome":"Sardinha ao natural","quantidade":1,"medida":"1/2 lata"},{"nome":"Peito de frango grelhado","quantidade":1.2,"medida":"01 file medio"},{"nome":"Atum em água","quantidade":1,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais variados (mix cru)'), 2, 'a vontade', 4, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 5, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Azeite, de oliva, extra virgem'), 0.05, '01 colher de cha', 6, '[{"nome":"Manteiga","quantidade":0.1,"medida":"01 colher de cha"},{"nome":"Óleo de coco","quantidade":0.05,"medida":"01 colher de cha"},{"nome":"Castanha do Pará","quantidade":0.15,"medida":"04 unidades"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Lanche', '16:00', 3) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Torrada integral'), 0.4, '04 unidades', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Pasta de amendoim integral'), 0.2, '01 colher de sopa cheia', 2, '[{"nome":"Amendoim torrado","quantidade":0.15,"medida":"02 colheres de sopa"},{"nome":"Castanha de caju","quantidade":0.15,"medida":"08 unidades"},{"nome":"Abacate","quantidade":0.5,"medida":"02 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Chocolate 70% cacau'), 0.15, '01 quadradinho', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Banana, prata, crua'), 0.8, '01 unidade pequena', 4, '[{"nome":"Mamão formosa","quantidade":1.3,"medida":"1/2 unidade pequena"},{"nome":"Maçã","quantidade":0.9,"medida":"01 unidade pequena"},{"nome":"Pêra","quantidade":1,"medida":"01 unidade media"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Jantar', '19:30', 4) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Batata, doce, cozida'), 1.5, '02 pedacos grandes', 1, '[{"nome":"Arroz branco","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Inhame cozido","quantidade":0.9,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Sardinha, assada'), 1.2, '1/2 lata', 2, '[{"nome":"Atum em água","quantidade":1,"medida":"04 colheres de sopa"},{"nome":"Peito de frango desfiado","quantidade":1.2,"medida":"06 colheres de sopa"},{"nome":"Patinho moído","quantidade":1,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais refogados (mix)'), 2, 'a vontade', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 4, null);
end $cm$;

do $cm$
declare v_plano uuid; v_ref uuid;
begin
  insert into public.planos_alimentares (nutri_id, paciente_id, nome, objetivo, kcal_meta, ativo, observacoes)
  values (auth.uid(), null, 'Ciclo Magro · 1700 kcal · Folicular/Ovulatória', 'Folicular/Ovulatória', 1700, true, 'Água: 2,0 litros/dia | Para preparar ovos mexidos, voce pode utilizar o oleo da sua preferencia para untar: de soja, canola, girassol, azeite, etc. Desde que utilize um fio de oleo (em zig-zag). | Adocantes para o cafe: Stevia, xilitol, eritritol, sucralose. | Se a fome aumentar, aumente a quantidade de folhas e legumes. | No preparo dos alimentos, utilize temperos naturais como alho, cebola, limao, salsinha, cebolinha, paprica, pimenta do reino, a gosto. Use sal com moderacao (NAO e para zerar). Evite ao maximo temperos prontos. | Voce pode utilizar o oleo da sua preferencia para grelhar. Utilize um fio de oleo em zig-zag. | Ocasionalmente, pode utilizar ketchup zero ou mostarda nas refeicoes.')
  returning id into v_plano;

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Café da manhã', '07:00', 1) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Pão, trigo, forma, integral'), 1, '04 fatias', 1, '[{"nome":"Goma de tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Cuscuz de milho","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Banana da terra","quantidade":0.7,"medida":"1/2 unidade media"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Ovo, de galinha, inteiro, cozido/10minutos'), 1.5, '03 unidades', 2, '[{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Queijo minas","quantidade":0.6,"medida":"02 fatias medias"},{"nome":"Clara de ovo","quantidade":1.5,"medida":"05 unidades"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Mamão, Formosa, cru'), 1.3, '1/2 unidade pequena', 3, '[{"nome":"Morango","quantidade":1.8,"medida":"12 unidades medias"},{"nome":"Melão","quantidade":1.8,"medida":"02 fatias medias"},{"nome":"Kiwi","quantidade":0.8,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.3, '01 scoop grande', 4, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Queijo cottage'), 1, '04 colheres de sopa', 5, '[{"nome":"Iogurte natural lacfree","quantidade":1.7,"medida":"01 unidade"},{"nome":"Skyr natural","quantidade":1.6,"medida":"01 unidade"},{"nome":"Queijo minas frescal","quantidade":0.6,"medida":"02 fatias medias"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Almoço', '12:00', 2) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Arroz, tipo 1, cozido'), 1.2, '06 colheres de sopa', 1, '[{"nome":"Batata inglesa","quantidade":1.8,"medida":"02 unidades pequenas"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Macarrão cozido","quantidade":0.8,"medida":"01 pegador medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Feijão, carioca, cozido'), 0.86, '04 colheres de sopa', 2, '[{"nome":"Lentilha cozida","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Grão de bico cozido","quantidade":0.6,"medida":"03 colheres de sopa"},{"nome":"Ervilha","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Frango, peito, sem pele, grelhado'), 1.5, '01 file grande', 3, '[{"nome":"Patinho grelhado","quantidade":1,"medida":"01 bife medio"},{"nome":"Peixe grelhado","quantidade":1.4,"medida":"01 file medio"},{"nome":"Lombo suíno","quantidade":1.2,"medida":"01 bife medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais variados (mix cru)'), 2, 'a vontade', 4, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 5, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Azeite, de oliva, extra virgem'), 0.05, '01 colher de cha', 6, '[{"nome":"Manteiga","quantidade":0.1,"medida":"01 colher de cha"},{"nome":"Óleo de coco","quantidade":0.05,"medida":"01 colher de cha"},{"nome":"Castanha do Pará","quantidade":0.15,"medida":"04 unidades"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Lanche', '16:00', 3) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Torrada integral'), 0.4, '04 unidades', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Creme de ricota light'), 0.3, '01 colher de sopa cheia', 2, '[{"nome":"Ovo inteiro","quantidade":0.5,"medida":"01 unidade media"},{"nome":"Requeijão light","quantidade":0.3,"medida":"01 colher de sopa"},{"nome":"Frango desfiado","quantidade":0.5,"medida":"03 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.25, '01 scoop medio', 3, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Castanha-do-Brasil, crua'), 0.15, '04 unidades', 4, null);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Jantar', '19:30', 4) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Batata, inglesa, cozida'), 2.2, '02 unidades medias', 1, '[{"nome":"Arroz branco","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Frango, peito, sem pele, cozido'), 1.5, '08 colheres de sopa', 2, '[{"nome":"Patinho moído","quantidade":1,"medida":"05 colheres de sopa"},{"nome":"Omelete","quantidade":1,"medida":"02 ovos"},{"nome":"Peixe grelhado","quantidade":1.4,"medida":"01 file medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais refogados (mix)'), 2, 'a vontade', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 4, null);
end $cm$;

do $cm$
declare v_plano uuid; v_ref uuid;
begin
  insert into public.planos_alimentares (nutri_id, paciente_id, nome, objetivo, kcal_meta, ativo, observacoes)
  values (auth.uid(), null, 'Ciclo Magro · 1700 kcal · Lútea/Menstrual', 'Lútea/Menstrual', 1700, true, 'Água: 3,0 litros/dia | Para preparar ovos mexidos, voce pode utilizar o oleo da sua preferencia para untar: de soja, canola, girassol, azeite, etc. Desde que utilize um fio de oleo (em zig-zag). | Adocantes para o cafe: Stevia, xilitol, eritritol, sucralose. | Se a fome aumentar, aumente a quantidade de folhas e legumes. | No preparo dos alimentos, utilize temperos naturais como alho, cebola, limao, salsinha, cebolinha, paprica, pimenta do reino, a gosto. Use sal com moderacao (NAO e para zerar). Evite ao maximo temperos prontos. | Voce pode utilizar o oleo da sua preferencia para grelhar. Utilize um fio de oleo em zig-zag. | Ocasionalmente, pode utilizar ketchup zero ou mostarda nas refeicoes.')
  returning id into v_plano;

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Café da manhã', '07:00', 1) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Aveia, flocos, crua'), 0.6, '06 colheres de sopa', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Cuscuz de milho","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Ovo, de galinha, inteiro, cozido/10minutos'), 1.5, '03 unidades', 2, '[{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Queijo minas","quantidade":0.6,"medida":"02 fatias medias"},{"nome":"Clara de ovo","quantidade":1.5,"medida":"05 unidades"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Banana, prata, crua'), 1.5, '01 unidade grande', 3, '[{"nome":"Mamão formosa","quantidade":1.3,"medida":"1/2 unidade pequena"},{"nome":"Maçã","quantidade":0.9,"medida":"01 unidade pequena"},{"nome":"Pêra","quantidade":1,"medida":"01 unidade media"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.3, '01 scoop grande', 4, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Almoço', '12:00', 2) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Arroz, tipo 1, cozido'), 1.2, '06 colheres de sopa', 1, '[{"nome":"Batata inglesa","quantidade":1.8,"medida":"02 unidades pequenas"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Macarrão cozido","quantidade":0.8,"medida":"01 pegador medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Feijão, carioca, cozido'), 0.86, '04 colheres de sopa', 2, '[{"nome":"Lentilha cozida","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Grão de bico cozido","quantidade":0.6,"medida":"03 colheres de sopa"},{"nome":"Ervilha","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Carne, bovina, maminha, grelhada'), 1.4, '01 bife grande', 3, '[{"nome":"Sardinha ao natural","quantidade":1,"medida":"1/2 lata"},{"nome":"Peito de frango grelhado","quantidade":1.2,"medida":"01 file medio"},{"nome":"Atum em água","quantidade":1,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais variados (mix cru)'), 2, 'a vontade', 4, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 5, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Azeite, de oliva, extra virgem'), 0.05, '01 colher de cha', 6, '[{"nome":"Manteiga","quantidade":0.1,"medida":"01 colher de cha"},{"nome":"Óleo de coco","quantidade":0.05,"medida":"01 colher de cha"},{"nome":"Castanha do Pará","quantidade":0.15,"medida":"04 unidades"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Lanche', '16:00', 3) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Torrada integral'), 0.4, '04 unidades', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Pasta de amendoim integral'), 0.25, '01 colher de sopa cheia', 2, '[{"nome":"Amendoim torrado","quantidade":0.15,"medida":"02 colheres de sopa"},{"nome":"Castanha de caju","quantidade":0.15,"medida":"08 unidades"},{"nome":"Abacate","quantidade":0.5,"medida":"02 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Chocolate 70% cacau'), 0.15, '01 quadradinho', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Castanha-do-Brasil, crua'), 0.15, '04 unidades', 4, null);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Jantar', '19:30', 4) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Batata, doce, cozida'), 1.6, '03 pedacos medios', 1, '[{"nome":"Arroz branco","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Inhame cozido","quantidade":0.9,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Sardinha, assada'), 1.4, '01 lata pequena', 2, '[{"nome":"Atum em água","quantidade":1,"medida":"04 colheres de sopa"},{"nome":"Peito de frango desfiado","quantidade":1.2,"medida":"06 colheres de sopa"},{"nome":"Patinho moído","quantidade":1,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais refogados (mix)'), 2, 'a vontade', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 4, null);
end $cm$;

do $cm$
declare v_plano uuid; v_ref uuid;
begin
  insert into public.planos_alimentares (nutri_id, paciente_id, nome, objetivo, kcal_meta, ativo, observacoes)
  values (auth.uid(), null, 'Ciclo Magro · 1800 kcal · Folicular/Ovulatória', 'Folicular/Ovulatória', 1800, true, 'Água: 2,0 litros/dia | Para preparar ovos mexidos, voce pode utilizar o oleo da sua preferencia para untar: de soja, canola, girassol, azeite, etc. Desde que utilize um fio de oleo (em zig-zag). | Adocantes para o cafe: Stevia, xilitol, eritritol, sucralose. | Se a fome aumentar, aumente a quantidade de folhas e legumes. | No preparo dos alimentos, utilize temperos naturais como alho, cebola, limao, salsinha, cebolinha, paprica, pimenta do reino, a gosto. Use sal com moderacao (NAO e para zerar). Evite ao maximo temperos prontos. | Voce pode utilizar o oleo da sua preferencia para grelhar. Utilize um fio de oleo em zig-zag. | Ocasionalmente, pode utilizar ketchup zero ou mostarda nas refeicoes.')
  returning id into v_plano;

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Café da manhã', '07:00', 1) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Pão, trigo, forma, integral'), 1, '04 fatias', 1, '[{"nome":"Goma de tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Cuscuz de milho","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Banana da terra","quantidade":0.7,"medida":"1/2 unidade media"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Ovo, de galinha, inteiro, cozido/10minutos'), 1.5, '03 unidades', 2, '[{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Queijo minas","quantidade":0.6,"medida":"02 fatias medias"},{"nome":"Clara de ovo","quantidade":1.5,"medida":"05 unidades"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Mamão, Formosa, cru'), 2, '01 unidade pequena', 3, '[{"nome":"Morango","quantidade":1.8,"medida":"12 unidades medias"},{"nome":"Melão","quantidade":1.8,"medida":"02 fatias medias"},{"nome":"Kiwi","quantidade":0.8,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.3, '01 scoop grande', 4, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Queijo cottage'), 1.2, '05 colheres de sopa', 5, '[{"nome":"Iogurte natural lacfree","quantidade":1.7,"medida":"01 unidade"},{"nome":"Skyr natural","quantidade":1.6,"medida":"01 unidade"},{"nome":"Queijo minas frescal","quantidade":0.6,"medida":"02 fatias medias"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Almoço', '12:00', 2) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Arroz, tipo 1, cozido'), 1.2, '06 colheres de sopa', 1, '[{"nome":"Batata inglesa","quantidade":1.8,"medida":"02 unidades pequenas"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Macarrão cozido","quantidade":0.8,"medida":"01 pegador medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Feijão, carioca, cozido'), 1.3, '06 colheres de sopa', 2, '[{"nome":"Lentilha cozida","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Grão de bico cozido","quantidade":0.6,"medida":"03 colheres de sopa"},{"nome":"Ervilha","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Frango, peito, sem pele, grelhado'), 1.6, '01 file grande', 3, '[{"nome":"Patinho grelhado","quantidade":1,"medida":"01 bife medio"},{"nome":"Peixe grelhado","quantidade":1.4,"medida":"01 file medio"},{"nome":"Lombo suíno","quantidade":1.2,"medida":"01 bife medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais variados (mix cru)'), 2, 'a vontade', 4, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 5, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Azeite, de oliva, extra virgem'), 0.05, '01 colher de cha', 6, '[{"nome":"Manteiga","quantidade":0.1,"medida":"01 colher de cha"},{"nome":"Óleo de coco","quantidade":0.05,"medida":"01 colher de cha"},{"nome":"Castanha do Pará","quantidade":0.15,"medida":"04 unidades"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Lanche', '16:00', 3) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Torrada integral'), 0.4, '04 unidades', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Creme de ricota light'), 0.4, '01 colher de sopa cheia', 2, '[{"nome":"Ovo inteiro","quantidade":0.5,"medida":"01 unidade media"},{"nome":"Requeijão light","quantidade":0.3,"medida":"01 colher de sopa"},{"nome":"Frango desfiado","quantidade":0.5,"medida":"03 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.3, '01 scoop grande', 3, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Abacate, cru'), 0.5, '02 colheres de sopa', 4, null);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Jantar', '19:30', 4) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Batata, inglesa, cozida'), 2.4, '03 unidades pequenas', 1, '[{"nome":"Arroz branco","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Frango, peito, sem pele, cozido'), 1.5, '08 colheres de sopa', 2, '[{"nome":"Patinho moído","quantidade":1,"medida":"05 colheres de sopa"},{"nome":"Omelete","quantidade":1,"medida":"02 ovos"},{"nome":"Peixe grelhado","quantidade":1.4,"medida":"01 file medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais refogados (mix)'), 2, 'a vontade', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 4, null);
end $cm$;

do $cm$
declare v_plano uuid; v_ref uuid;
begin
  insert into public.planos_alimentares (nutri_id, paciente_id, nome, objetivo, kcal_meta, ativo, observacoes)
  values (auth.uid(), null, 'Ciclo Magro · 1800 kcal · Lútea/Menstrual', 'Lútea/Menstrual', 1800, true, 'Água: 3,0 litros/dia | Para preparar ovos mexidos, voce pode utilizar o oleo da sua preferencia para untar: de soja, canola, girassol, azeite, etc. Desde que utilize um fio de oleo (em zig-zag). | Adocantes para o cafe: Stevia, xilitol, eritritol, sucralose. | Se a fome aumentar, aumente a quantidade de folhas e legumes. | No preparo dos alimentos, utilize temperos naturais como alho, cebola, limao, salsinha, cebolinha, paprica, pimenta do reino, a gosto. Use sal com moderacao (NAO e para zerar). Evite ao maximo temperos prontos. | Voce pode utilizar o oleo da sua preferencia para grelhar. Utilize um fio de oleo em zig-zag. | Ocasionalmente, pode utilizar ketchup zero ou mostarda nas refeicoes.')
  returning id into v_plano;

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Café da manhã', '07:00', 1) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Aveia, flocos, crua'), 0.6, '06 colheres de sopa', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Cuscuz de milho","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Ovo, de galinha, inteiro, cozido/10minutos'), 1.5, '03 unidades', 2, '[{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Queijo minas","quantidade":0.6,"medida":"02 fatias medias"},{"nome":"Clara de ovo","quantidade":1.5,"medida":"05 unidades"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Banana, prata, crua'), 1.5, '01 unidade grande', 3, '[{"nome":"Mamão formosa","quantidade":1.3,"medida":"1/2 unidade pequena"},{"nome":"Maçã","quantidade":0.9,"medida":"01 unidade pequena"},{"nome":"Pêra","quantidade":1,"medida":"01 unidade media"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.3, '01 scoop grande', 4, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Almoço', '12:00', 2) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Arroz, tipo 1, cozido'), 1.2, '06 colheres de sopa', 1, '[{"nome":"Batata inglesa","quantidade":1.8,"medida":"02 unidades pequenas"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Macarrão cozido","quantidade":0.8,"medida":"01 pegador medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Feijão, carioca, cozido'), 1.3, '06 colheres de sopa', 2, '[{"nome":"Lentilha cozida","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Grão de bico cozido","quantidade":0.6,"medida":"03 colheres de sopa"},{"nome":"Ervilha","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Carne, bovina, maminha, grelhada'), 1.5, '01 bife grande', 3, '[{"nome":"Sardinha ao natural","quantidade":1,"medida":"1/2 lata"},{"nome":"Peito de frango grelhado","quantidade":1.2,"medida":"01 file medio"},{"nome":"Atum em água","quantidade":1,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais variados (mix cru)'), 2, 'a vontade', 4, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 5, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Azeite, de oliva, extra virgem'), 0.05, '01 colher de cha', 6, '[{"nome":"Manteiga","quantidade":0.1,"medida":"01 colher de cha"},{"nome":"Óleo de coco","quantidade":0.05,"medida":"01 colher de cha"},{"nome":"Castanha do Pará","quantidade":0.15,"medida":"04 unidades"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Lanche', '16:00', 3) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Torrada integral'), 0.5, '05 unidades', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Pasta de amendoim integral'), 0.25, '01 colher de sopa cheia', 2, '[{"nome":"Amendoim torrado","quantidade":0.15,"medida":"02 colheres de sopa"},{"nome":"Castanha de caju","quantidade":0.15,"medida":"08 unidades"},{"nome":"Abacate","quantidade":0.5,"medida":"02 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Chocolate 70% cacau'), 0.15, '01 quadradinho', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Abacate, cru'), 0.5, '02 colheres de sopa', 4, null);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Jantar', '19:30', 4) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Batata, doce, cozida'), 1.8, '03 pedacos medios', 1, '[{"nome":"Arroz branco","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Inhame cozido","quantidade":0.9,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Sardinha, assada'), 1.4, '01 lata pequena', 2, '[{"nome":"Atum em água","quantidade":1,"medida":"04 colheres de sopa"},{"nome":"Peito de frango desfiado","quantidade":1.2,"medida":"06 colheres de sopa"},{"nome":"Patinho moído","quantidade":1,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais refogados (mix)'), 2, 'a vontade', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 4, null);
end $cm$;

do $cm$
declare v_plano uuid; v_ref uuid;
begin
  insert into public.planos_alimentares (nutri_id, paciente_id, nome, objetivo, kcal_meta, ativo, observacoes)
  values (auth.uid(), null, 'Ciclo Magro · 1900 kcal · Folicular/Ovulatória', 'Folicular/Ovulatória', 1900, true, 'Água: 2,0 litros/dia | Para preparar ovos mexidos, voce pode utilizar o oleo da sua preferencia para untar: de soja, canola, girassol, azeite, etc. Desde que utilize um fio de oleo (em zig-zag). | Adocantes para o cafe: Stevia, xilitol, eritritol, sucralose. | Se a fome aumentar, aumente a quantidade de folhas e legumes. | No preparo dos alimentos, utilize temperos naturais como alho, cebola, limao, salsinha, cebolinha, paprica, pimenta do reino, a gosto. Use sal com moderacao (NAO e para zerar). Evite ao maximo temperos prontos. | Voce pode utilizar o oleo da sua preferencia para grelhar. Utilize um fio de oleo em zig-zag. | Ocasionalmente, pode utilizar ketchup zero ou mostarda nas refeicoes.')
  returning id into v_plano;

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Café da manhã', '07:00', 1) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Pão, trigo, forma, integral'), 1, '04 fatias', 1, '[{"nome":"Goma de tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Cuscuz de milho","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Banana da terra","quantidade":0.7,"medida":"1/2 unidade media"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Ovo, de galinha, inteiro, cozido/10minutos'), 1.5, '03 unidades', 2, '[{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Queijo minas","quantidade":0.6,"medida":"02 fatias medias"},{"nome":"Clara de ovo","quantidade":1.5,"medida":"05 unidades"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Mamão, Formosa, cru'), 2, '01 unidade pequena', 3, '[{"nome":"Morango","quantidade":1.8,"medida":"12 unidades medias"},{"nome":"Melão","quantidade":1.8,"medida":"02 fatias medias"},{"nome":"Kiwi","quantidade":0.8,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.3, '01 scoop grande', 4, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Queijo cottage'), 1.2, '05 colheres de sopa', 5, '[{"nome":"Iogurte natural lacfree","quantidade":1.7,"medida":"01 unidade"},{"nome":"Skyr natural","quantidade":1.6,"medida":"01 unidade"},{"nome":"Queijo minas frescal","quantidade":0.6,"medida":"02 fatias medias"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Almoço', '12:00', 2) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Arroz, tipo 1, cozido'), 1.4, '07 colheres de sopa', 1, '[{"nome":"Batata inglesa","quantidade":1.8,"medida":"02 unidades pequenas"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Macarrão cozido","quantidade":0.8,"medida":"01 pegador medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Feijão, carioca, cozido'), 1.3, '06 colheres de sopa', 2, '[{"nome":"Lentilha cozida","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Grão de bico cozido","quantidade":0.6,"medida":"03 colheres de sopa"},{"nome":"Ervilha","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Frango, peito, sem pele, grelhado'), 1.7, '01 file extra grande', 3, '[{"nome":"Patinho grelhado","quantidade":1,"medida":"01 bife medio"},{"nome":"Peixe grelhado","quantidade":1.4,"medida":"01 file medio"},{"nome":"Lombo suíno","quantidade":1.2,"medida":"01 bife medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais variados (mix cru)'), 2, 'a vontade', 4, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 5, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Azeite, de oliva, extra virgem'), 0.05, '01 colher de cha', 6, '[{"nome":"Manteiga","quantidade":0.1,"medida":"01 colher de cha"},{"nome":"Óleo de coco","quantidade":0.05,"medida":"01 colher de cha"},{"nome":"Castanha do Pará","quantidade":0.15,"medida":"04 unidades"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Lanche', '16:00', 3) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Torrada integral'), 0.5, '05 unidades', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Creme de ricota light'), 0.4, '01 colher de sopa cheia', 2, '[{"nome":"Ovo inteiro","quantidade":0.5,"medida":"01 unidade media"},{"nome":"Requeijão light","quantidade":0.3,"medida":"01 colher de sopa"},{"nome":"Frango desfiado","quantidade":0.5,"medida":"03 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.3, '01 scoop grande', 3, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Castanha-de-caju, torrada, salgada'), 0.15, '08 unidades', 4, null);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Jantar', '19:30', 4) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Batata, inglesa, cozida'), 2.4, '03 unidades pequenas', 1, '[{"nome":"Arroz branco","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Frango, peito, sem pele, cozido'), 1.6, '08 colheres de sopa', 2, '[{"nome":"Patinho moído","quantidade":1,"medida":"05 colheres de sopa"},{"nome":"Omelete","quantidade":1,"medida":"02 ovos"},{"nome":"Peixe grelhado","quantidade":1.4,"medida":"01 file medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais refogados (mix)'), 2, 'a vontade', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 4, null);
end $cm$;

do $cm$
declare v_plano uuid; v_ref uuid;
begin
  insert into public.planos_alimentares (nutri_id, paciente_id, nome, objetivo, kcal_meta, ativo, observacoes)
  values (auth.uid(), null, 'Ciclo Magro · 1900 kcal · Lútea/Menstrual', 'Lútea/Menstrual', 1900, true, 'Água: 3,0 litros/dia | Para preparar ovos mexidos, voce pode utilizar o oleo da sua preferencia para untar: de soja, canola, girassol, azeite, etc. Desde que utilize um fio de oleo (em zig-zag). | Adocantes para o cafe: Stevia, xilitol, eritritol, sucralose. | Se a fome aumentar, aumente a quantidade de folhas e legumes. | No preparo dos alimentos, utilize temperos naturais como alho, cebola, limao, salsinha, cebolinha, paprica, pimenta do reino, a gosto. Use sal com moderacao (NAO e para zerar). Evite ao maximo temperos prontos. | Voce pode utilizar o oleo da sua preferencia para grelhar. Utilize um fio de oleo em zig-zag. | Ocasionalmente, pode utilizar ketchup zero ou mostarda nas refeicoes.')
  returning id into v_plano;

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Café da manhã', '07:00', 1) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Aveia, flocos, crua'), 0.7, '07 colheres de sopa', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Cuscuz de milho","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Ovo, de galinha, inteiro, cozido/10minutos'), 1.5, '03 unidades', 2, '[{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Queijo minas","quantidade":0.6,"medida":"02 fatias medias"},{"nome":"Clara de ovo","quantidade":1.5,"medida":"05 unidades"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Banana, prata, crua'), 1.5, '01 unidade grande', 3, '[{"nome":"Mamão formosa","quantidade":1.3,"medida":"1/2 unidade pequena"},{"nome":"Maçã","quantidade":0.9,"medida":"01 unidade pequena"},{"nome":"Pêra","quantidade":1,"medida":"01 unidade media"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.3, '01 scoop grande', 4, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Almoço', '12:00', 2) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Arroz, tipo 1, cozido'), 1.4, '07 colheres de sopa', 1, '[{"nome":"Batata inglesa","quantidade":1.8,"medida":"02 unidades pequenas"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Macarrão cozido","quantidade":0.8,"medida":"01 pegador medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Feijão, carioca, cozido'), 1.3, '06 colheres de sopa', 2, '[{"nome":"Lentilha cozida","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Grão de bico cozido","quantidade":0.6,"medida":"03 colheres de sopa"},{"nome":"Ervilha","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Carne, bovina, maminha, grelhada'), 1.6, '01 bife extra grande', 3, '[{"nome":"Sardinha ao natural","quantidade":1,"medida":"1/2 lata"},{"nome":"Peito de frango grelhado","quantidade":1.2,"medida":"01 file medio"},{"nome":"Atum em água","quantidade":1,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais variados (mix cru)'), 2, 'a vontade', 4, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 5, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Azeite, de oliva, extra virgem'), 0.05, '01 colher de cha', 6, '[{"nome":"Manteiga","quantidade":0.1,"medida":"01 colher de cha"},{"nome":"Óleo de coco","quantidade":0.05,"medida":"01 colher de cha"},{"nome":"Castanha do Pará","quantidade":0.15,"medida":"04 unidades"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Lanche', '16:00', 3) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Torrada integral'), 0.5, '05 unidades', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Pasta de amendoim integral'), 0.3, '02 colheres de sopa', 2, '[{"nome":"Amendoim torrado","quantidade":0.15,"medida":"02 colheres de sopa"},{"nome":"Castanha de caju","quantidade":0.15,"medida":"08 unidades"},{"nome":"Abacate","quantidade":0.5,"medida":"02 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Chocolate 70% cacau'), 0.15, '01 quadradinho', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Castanha-de-caju, torrada, salgada'), 0.15, '08 unidades', 4, null);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Jantar', '19:30', 4) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Batata, doce, cozida'), 2, '03 pedacos medios', 1, '[{"nome":"Arroz branco","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Inhame cozido","quantidade":0.9,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Sardinha, assada'), 1.4, '01 lata pequena', 2, '[{"nome":"Atum em água","quantidade":1,"medida":"04 colheres de sopa"},{"nome":"Peito de frango desfiado","quantidade":1.2,"medida":"06 colheres de sopa"},{"nome":"Patinho moído","quantidade":1,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais refogados (mix)'), 2, 'a vontade', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 4, null);
end $cm$;

do $cm$
declare v_plano uuid; v_ref uuid;
begin
  insert into public.planos_alimentares (nutri_id, paciente_id, nome, objetivo, kcal_meta, ativo, observacoes)
  values (auth.uid(), null, 'Ciclo Magro · 2000 kcal · Folicular/Ovulatória', 'Folicular/Ovulatória', 2000, true, 'Água: 2,0 litros/dia | Para preparar ovos mexidos, voce pode utilizar o oleo da sua preferencia para untar: de soja, canola, girassol, azeite, etc. Desde que utilize um fio de oleo (em zig-zag). | Adocantes para o cafe: Stevia, xilitol, eritritol, sucralose. | Se a fome aumentar, aumente a quantidade de folhas e legumes. | No preparo dos alimentos, utilize temperos naturais como alho, cebola, limao, salsinha, cebolinha, paprica, pimenta do reino, a gosto. Use sal com moderacao (NAO e para zerar). Evite ao maximo temperos prontos. | Voce pode utilizar o oleo da sua preferencia para grelhar. Utilize um fio de oleo em zig-zag. | Ocasionalmente, pode utilizar ketchup zero ou mostarda nas refeicoes.')
  returning id into v_plano;

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Café da manhã', '07:00', 1) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Pão, trigo, forma, integral'), 1, '04 fatias', 1, '[{"nome":"Goma de tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Cuscuz de milho","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Banana da terra","quantidade":0.7,"medida":"1/2 unidade media"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Ovo, de galinha, inteiro, cozido/10minutos'), 1.5, '03 unidades', 2, '[{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Queijo minas","quantidade":0.6,"medida":"02 fatias medias"},{"nome":"Clara de ovo","quantidade":1.5,"medida":"05 unidades"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Mamão, Formosa, cru'), 2, '01 unidade pequena', 3, '[{"nome":"Morango","quantidade":1.8,"medida":"12 unidades medias"},{"nome":"Melão","quantidade":1.8,"medida":"02 fatias medias"},{"nome":"Kiwi","quantidade":0.8,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.3, '01 scoop grande', 4, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Queijo cottage'), 1.5, '06 colheres de sopa', 5, '[{"nome":"Iogurte natural lacfree","quantidade":1.7,"medida":"01 unidade"},{"nome":"Skyr natural","quantidade":1.6,"medida":"01 unidade"},{"nome":"Queijo minas frescal","quantidade":0.6,"medida":"02 fatias medias"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Almoço', '12:00', 2) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Arroz, tipo 1, cozido'), 1.4, '07 colheres de sopa', 1, '[{"nome":"Batata inglesa","quantidade":1.8,"medida":"02 unidades pequenas"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Macarrão cozido","quantidade":0.8,"medida":"01 pegador medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Feijão, carioca, cozido'), 1.3, '06 colheres de sopa', 2, '[{"nome":"Lentilha cozida","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Grão de bico cozido","quantidade":0.6,"medida":"03 colheres de sopa"},{"nome":"Ervilha","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Frango, peito, sem pele, grelhado'), 1.8, '01 file extra grande', 3, '[{"nome":"Patinho grelhado","quantidade":1,"medida":"01 bife medio"},{"nome":"Peixe grelhado","quantidade":1.4,"medida":"01 file medio"},{"nome":"Lombo suíno","quantidade":1.2,"medida":"01 bife medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais variados (mix cru)'), 2, 'a vontade', 4, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 5, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Azeite, de oliva, extra virgem'), 0.05, '01 colher de cha', 6, '[{"nome":"Manteiga","quantidade":0.1,"medida":"01 colher de cha"},{"nome":"Óleo de coco","quantidade":0.05,"medida":"01 colher de cha"},{"nome":"Castanha do Pará","quantidade":0.15,"medida":"04 unidades"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Lanche', '16:00', 3) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Torrada integral'), 0.5, '05 unidades', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Creme de ricota light'), 0.4, '01 colher de sopa cheia', 2, '[{"nome":"Ovo inteiro","quantidade":0.5,"medida":"01 unidade media"},{"nome":"Requeijão light","quantidade":0.3,"medida":"01 colher de sopa"},{"nome":"Frango desfiado","quantidade":0.5,"medida":"03 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.3, '01 scoop grande', 3, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Abacate, cru'), 0.8, '03 colheres de sopa', 4, null);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Jantar', '19:30', 4) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Batata, doce, cozida'), 2, '03 pedacos medios', 1, '[{"nome":"Arroz branco","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Inhame cozido","quantidade":0.9,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Frango, peito, sem pele, cozido'), 1.7, '09 colheres de sopa', 2, '[{"nome":"Patinho moído","quantidade":1,"medida":"05 colheres de sopa"},{"nome":"Omelete","quantidade":1,"medida":"02 ovos"},{"nome":"Peixe grelhado","quantidade":1.4,"medida":"01 file medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais refogados (mix)'), 2, 'a vontade', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 4, null);
end $cm$;

do $cm$
declare v_plano uuid; v_ref uuid;
begin
  insert into public.planos_alimentares (nutri_id, paciente_id, nome, objetivo, kcal_meta, ativo, observacoes)
  values (auth.uid(), null, 'Ciclo Magro · 2000 kcal · Lútea/Menstrual', 'Lútea/Menstrual', 2000, true, 'Água: 3,0 litros/dia | Para preparar ovos mexidos, voce pode utilizar o oleo da sua preferencia para untar: de soja, canola, girassol, azeite, etc. Desde que utilize um fio de oleo (em zig-zag). | Adocantes para o cafe: Stevia, xilitol, eritritol, sucralose. | Se a fome aumentar, aumente a quantidade de folhas e legumes. | No preparo dos alimentos, utilize temperos naturais como alho, cebola, limao, salsinha, cebolinha, paprica, pimenta do reino, a gosto. Use sal com moderacao (NAO e para zerar). Evite ao maximo temperos prontos. | Voce pode utilizar o oleo da sua preferencia para grelhar. Utilize um fio de oleo em zig-zag. | Ocasionalmente, pode utilizar ketchup zero ou mostarda nas refeicoes.')
  returning id into v_plano;

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Café da manhã', '07:00', 1) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Aveia, flocos, crua'), 0.7, '07 colheres de sopa', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Cuscuz de milho","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Ovo, de galinha, inteiro, cozido/10minutos'), 1.5, '03 unidades', 2, '[{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Queijo minas","quantidade":0.6,"medida":"02 fatias medias"},{"nome":"Clara de ovo","quantidade":1.5,"medida":"05 unidades"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Banana, prata, crua'), 1.5, '01 unidade grande', 3, '[{"nome":"Mamão formosa","quantidade":1.3,"medida":"1/2 unidade pequena"},{"nome":"Maçã","quantidade":0.9,"medida":"01 unidade pequena"},{"nome":"Pêra","quantidade":1,"medida":"01 unidade media"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Whey protein concentrado'), 0.3, '01 scoop grande', 4, '[{"nome":"Clara de ovo cozida","quantidade":1.5,"medida":"05 unidades"},{"nome":"Frango desfiado","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Iogurte natural","quantidade":1.7,"medida":"01 unidade"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Almoço', '12:00', 2) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Arroz, tipo 1, cozido'), 1.4, '07 colheres de sopa', 1, '[{"nome":"Batata inglesa","quantidade":1.8,"medida":"02 unidades pequenas"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Macarrão cozido","quantidade":0.8,"medida":"01 pegador medio"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Feijão, carioca, cozido'), 1.3, '06 colheres de sopa', 2, '[{"nome":"Lentilha cozida","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Grão de bico cozido","quantidade":0.6,"medida":"03 colheres de sopa"},{"nome":"Ervilha","quantidade":0.8,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Carne, bovina, maminha, grelhada'), 1.7, '01 bife extra grande', 3, '[{"nome":"Sardinha ao natural","quantidade":1,"medida":"1/2 lata"},{"nome":"Peito de frango grelhado","quantidade":1.2,"medida":"01 file medio"},{"nome":"Atum em água","quantidade":1,"medida":"04 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais variados (mix cru)'), 2, 'a vontade', 4, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 5, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Azeite, de oliva, extra virgem'), 0.05, '01 colher de cha', 6, '[{"nome":"Manteiga","quantidade":0.1,"medida":"01 colher de cha"},{"nome":"Óleo de coco","quantidade":0.05,"medida":"01 colher de cha"},{"nome":"Castanha do Pará","quantidade":0.15,"medida":"04 unidades"}]'::jsonb);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Lanche', '16:00', 3) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Torrada integral'), 0.5, '05 unidades', 1, '[{"nome":"Pão integral","quantidade":0.5,"medida":"02 fatias"},{"nome":"Tapioca","quantidade":0.4,"medida":"02 colheres de sopa"},{"nome":"Batata doce","quantidade":1,"medida":"02 pedacos medios"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Pasta de amendoim integral'), 0.3, '02 colheres de sopa', 2, '[{"nome":"Amendoim torrado","quantidade":0.15,"medida":"02 colheres de sopa"},{"nome":"Castanha de caju","quantidade":0.15,"medida":"08 unidades"},{"nome":"Abacate","quantidade":0.5,"medida":"02 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Chocolate 70% cacau'), 0.15, '01 quadradinho', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Abacate, cru'), 0.8, '03 colheres de sopa', 4, null);

  insert into public.plano_refeicoes (nutri_id, plano_id, nome, horario, ordem)
  values (auth.uid(), v_plano, 'Jantar', '19:30', 4) returning id into v_ref;
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Batata, doce, cozida'), 2.2, '03 pedacos grandes', 1, '[{"nome":"Arroz branco","quantidade":0.8,"medida":"04 colheres de sopa"},{"nome":"Mandioca cozida","quantidade":0.9,"medida":"03 pedacos pequenos"},{"nome":"Inhame cozido","quantidade":0.9,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Sardinha, assada'), 1.6, '01 lata', 2, '[{"nome":"Atum em água","quantidade":1,"medida":"04 colheres de sopa"},{"nome":"Peito de frango desfiado","quantidade":1.2,"medida":"06 colheres de sopa"},{"nome":"Patinho moído","quantidade":1,"medida":"05 colheres de sopa"}]'::jsonb);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Vegetais refogados (mix)'), 2, 'a vontade', 3, null);
  insert into public.refeicao_itens (nutri_id, refeicao_id, food_id, quantidade, medida, ordem, substituicoes)
  values (auth.uid(), v_ref, pg_temp.cm_food('Folhas verdes (mix)'), 1, 'a vontade', 4, null);
end $cm$;

-- ── conferencia ─────────────────────────────────────────────────────────
select
  (select count(*) from public.planos_alimentares
    where nutri_id = auth.uid() and paciente_id is null and nome like 'Ciclo Magro · %') as modelos,
  (select count(*) from public.refeicao_itens ri
     join public.plano_refeicoes pr on pr.id = ri.refeicao_id
     join public.planos_alimentares pa on pa.id = pr.plano_id
    where pa.nome like 'Ciclo Magro · %' and pa.nutri_id = auth.uid()) as itens;

-- ===========================================================================
-- FIM
-- ===========================================================================