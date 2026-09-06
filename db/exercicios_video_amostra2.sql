-- ===========================================================================
-- Evollo · AMOSTRA DE VIDEO — segunda passada, com os nomes reais
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE. Desfazer: db/exercicios_video_amostra_desfazer.sql
-- (o mesmo da primeira passada — a marca e o prefixo da URL, nao o script).
--
-- 100% re-executavel.
--
-- POR QUE HOUVE UMA SEGUNDA. A primeira passada casava por PALAVRA e o ensaio
-- barrou 13 de 19 padroes por serem largos demais. Estava certo: o catalogo tem
-- 746 exercicios com granularidade fina — quinze variacoes de levantamento
-- terra, setenta e seis nomes contendo "lateral". Adivinhar ali poria video de
-- terra convencional no terra sumo.
--
-- O ensaio devolveu os NOMES EXATOS. Esta passada usa eles, sem curinga: cada
-- padrao aponta para um exercicio e so um.
--
-- ===========================================================================
-- ESTA PASSADA SOBRESCREVE AMOSTRA, MAS NUNCA VIDEO SEU
-- ---------------------------------------------------------------------------
-- A primeira passada preencheu quatro exercicios, e um deles pode estar errado:
-- "Kettlebell swing" caiu em "Swing unilateral com kettlebell" porque era o
-- unico com "swing" no nome — mas o clipe e provavelmente bilateral.
--
-- Para poder corrigir isso, o `where` aceita a linha quando `video_url` esta
-- nulo OU quando ja e uma amostra nossa (prefixo `ymove.app/api/free/`). Video
-- que voce cadastrou — proprio, YouTube, o que for — nao tem esse prefixo e
-- continua intocado. Assim a amostra converge a cada passada sem nunca comer
-- trabalho de gente.
--
-- ===========================================================================
-- OS DOIS QUE FICARAM SEM PAR
-- ---------------------------------------------------------------------------
-- "Pec Deck Fly" e "Machine Reverse Fly" nao acharam nada: o catalogo chama
-- essas maquinas de outra coisa. A secao CANDIDATOS no fim lista os nomes que
-- provavelmente sao eles, para a proxima passada mirar certo — nao adianta eu
-- chutar "voador" ou "peck deck" de novo sem olhar o que existe.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/exercicios_video_amostra2_LIMPO.sql
-- ===========================================================================

drop table if exists amostra2;
create temp table amostra2 (nome_exato text, url text, rotulo text);

insert into amostra2 (nome_exato, url, rotulo) values
  ('Supino reto com barra',                                'https://ymove.app/api/free/dd7e706c-2086-4f4b-867f-d7fece2f720d', 'Barbell Bench Press'),
  ('Levantamento terra com barra',                         'https://ymove.app/api/free/b59952ca-1551-4c07-835d-ab78bfe9953c', 'Barbell Deadlift'),
  ('Elevação lateral',                                     'https://ymove.app/api/free/a16f0235-20eb-4306-b9cc-c01ae51b3b9b', 'Dumbbell Lateral Raise'),
  ('Rosca martelo',                                        'https://ymove.app/api/free/b11e6c6f-b2e8-44ca-95dc-adf0dcd34426', 'Hammer Curls'),
  ('Remada unilateral com halter (serrote)',               'https://ymove.app/api/free/d3fece95-c7e2-4794-ba8f-65a5b3e30a28', 'Single Arm Dumbbell Row'),
  ('Puxada com barra V',                                   'https://ymove.app/api/free/9302ad5d-b97a-4b27-afae-611b6ce70a06', 'Lat Pulldown V-Grip'),
  ('Remada baixa pegada neutra fechada',                   'https://ymove.app/api/free/499ccaa4-719d-40bd-b441-511291482471', 'Seated Cable Row Neutral Grip'),
  ('Supino inclinado na máquina articulada',               'https://ymove.app/api/free/35a53872-f47c-4ec6-9bdd-888eb1705572', 'Incline Machine Press'),
  ('Tríceps pulley (polia)',                               'https://ymove.app/api/free/9a550e2c-c55e-495d-b59e-b676c3d48a41', 'Cable Tricep Pushdown'),
  ('Extensão de tríceps acima da cabeça na polia com corda','https://ymove.app/api/free/c57e3719-a853-453f-b04a-da0c9475d6e7', 'Overhead Rope Extension'),
  ('Cadeira extensora',                                    'https://ymove.app/api/free/3d0e78d0-1125-4d25-8bd4-9ca7ba3799e8', 'Leg Extension'),
  ('Agachamento hack na máquina',                          'https://ymove.app/api/free/800cc264-d388-4200-8568-8f1df46e9be9', 'Hack Squat'),
  ('Mesa flexora',                                         'https://ymove.app/api/free/34a512bf-baa1-48ac-a5b9-132073166018', 'Lying Leg Curl');

drop table if exists amostra2_saida;
create temp table amostra2_saida (ordem int, secao text, item text, valor text, resultado text);

do $amostra$
declare
  v_org uuid;
  v_n   int;
  r     record;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  if v_org is null then
    raise exception 'organizacao nao encontrada — nada foi tocado';
  end if;

  -- ═══════════ ENSAIO ═══════════
  -- Nome exato deveria dar exatamente um. Se der zero, o nome mudou ou tem
  -- acento diferente; se der mais de um, ha duplicata no catalogo — e as duas
  -- coisas sao noticia, nao detalhe.
  for r in
    select a.rotulo, a.nome_exato,
           (select count(*) from public.exercicios e
             where e.nutri_id = v_org and e.nome = a.nome_exato) as achou
      from amostra2 a
     order by a.rotulo
  loop
    insert into amostra2_saida values (10, 'ENSAIO', r.rotulo, r.nome_exato,
      case when r.achou = 1 then 'ok'
           when r.achou = 0 then 'NAO EXISTE com este nome — confira acento e grafia'
           else 'DUPLICADO no catalogo: ' || r.achou || ' exercicios com o mesmo nome' end);
  end loop;

  -- ═══════════ ESCRITA ═══════════
  update public.exercicios e
     set video_url = a.url
    from amostra2 a
   where e.nutri_id = v_org
     and e.nome = a.nome_exato
     and (e.video_url is null or e.video_url like 'https://ymove.app/api/free/%');

  get diagnostics v_n = row_count;
  insert into amostra2_saida values (20, 'ESCRITA', 'exercicios com video de amostra', v_n::text, '');

  select count(*) into v_n from public.exercicios
   where nutri_id = v_org and video_url like 'https://ymove.app/api/free/%';
  insert into amostra2_saida values (21, 'ESCRITA', 'total de amostras no catalogo', v_n::text,
    'somando as duas passadas');

  -- ═══════════ CANDIDATOS ═══════════
  -- Para a proxima passada mirar os dois clipes que ficaram sem par, em vez de
  -- eu chutar outro nome de maquina.
  for r in
    select e.nome
      from public.exercicios e
     where e.nutri_id = v_org
       and (e.nome ilike '%crucifixo%' or e.nome ilike '%voador%'
            or e.nome ilike '%peitoral na m%' or e.nome ilike '%deltoide posterior%'
            or e.nome ilike '%fly%')
     order by e.nome
  loop
    insert into amostra2_saida values (30, 'CANDIDATOS', r.nome, '',
      'para Pec Deck Fly / Machine Reverse Fly');
  end loop;
end $amostra$;

select ordem, secao, item, valor, resultado from amostra2_saida order by ordem, item;
