-- ===========================================================================
-- Evollo · AMOSTRA DE VIDEO NOS EXERCICIOS — os 25 gratuitos da Your Move
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE. Tem desfazer: db/exercicios_video_amostra_desfazer.sql
-- 100% re-executavel. E TESTE, nao acervo — ver "o que ele nao e".
--
-- POR QUE ELE EXISTE. Antes de licenciar biblioteca nenhuma, a pergunta e se a
-- qualidade se sustenta NO CELULAR DO ALUNO, no meio do treino, com a wifi da
-- academia. Pagina de vendas nao responde isso; o app do aluno responde.
--
-- Os clipes sao os gratuitos que a Your Move publica sem cadastro
-- (https://ymove.app/free-exercise-videos): 720p, MP4, RETRATO, sem marca, uso
-- comercial permitido, cerca de 1 MB cada.
--
-- ===========================================================================
-- O QUE ELE NAO E
-- ---------------------------------------------------------------------------
-- NAO E O ACERVO. As URLs apontam para o servidor deles, e o plano gratuito
-- nao promete que continuem no ar. Se a decisao for licenciar, os arquivos
-- passam a ser servidos por nos; se for gravar, sao substituidos. Enquanto
-- isso, e amostra.
--
-- A MARCA DO DESFAZER E O PROPRIO PREFIXO DA URL. `exercicios` nao tem coluna
-- `metadata` onde carimbar a origem, e criar uma so para marcar um teste seria
-- schema novo para trabalho temporario. Toda URL que comeca com
-- `https://ymove.app/api/free/` veio daqui e de nenhum outro lugar — e um
-- marcador que ja existe no dado, sem coluna nova.
--
-- ===========================================================================
-- POR QUE ELE SO PREENCHE ONDE ESTA VAZIO
-- ---------------------------------------------------------------------------
-- `video_url is null`. Se alguem ja cadastrou um video para o exercicio — o
-- proprio, gravado na casa —, ele vale mais do que amostra de biblioteca, e
-- sobrescrever apagaria trabalho sem avisar.
--
-- ===========================================================================
-- O CASAMENTO E POR NOME, E POR ISSO TEM ENSAIO
-- ---------------------------------------------------------------------------
-- O catalogo esta em portugues e os clipes vem com nome em ingles. Nao ha id em
-- comum, entao o script casa por PADRAO DE NOME (`ilike`), o que e palpite —
-- "supino" pode ser reto, inclinado ou declinado.
--
-- A secao ENSAIO roda ANTES de qualquer escrita e mostra, padrao por padrao,
-- quais exercicios seriam atingidos. Leia a saida: se um padrao pegou um
-- movimento que nao e aquele, tire a linha do VALUES e rode de novo.
--
-- PADRAO QUE CASA COM MAIS DE UM E IGNORADO de proposito. "Casou com tres" nao
-- e permissao para escolher um; e sinal de que o padrao esta largo demais, e
-- adivinhar ali poe video de agachamento livre no hack.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/exercicios_video_amostra_LIMPO.sql
-- ===========================================================================

drop table if exists amostra_video;
create temp table amostra_video (padrao text, url text, rotulo text);

insert into amostra_video (padrao, url, rotulo) values
  ('%agachamento livre%',  'https://ymove.app/api/free/fd0eaa34-d14b-4421-b41c-1669f93253b3', 'Barbell Back Squat'),
  ('%supino reto%',        'https://ymove.app/api/free/dd7e706c-2086-4f4b-867f-d7fece2f720d', 'Barbell Bench Press'),
  ('%levantamento terra%', 'https://ymove.app/api/free/b59952ca-1551-4c07-835d-ab78bfe9953c', 'Barbell Deadlift'),
  ('%lateral%',            'https://ymove.app/api/free/a16f0235-20eb-4306-b9cc-c01ae51b3b9b', 'Dumbbell Lateral Raise'),
  ('%rosca martelo%',      'https://ymove.app/api/free/b11e6c6f-b2e8-44ca-95dc-adf0dcd34426', 'Hammer Curls'),
  ('%remada unilateral%',  'https://ymove.app/api/free/d3fece95-c7e2-4794-ba8f-65a5b3e30a28', 'Single Arm Dumbbell Row'),
  ('%goblet%',             'https://ymove.app/api/free/a2a797d0-f6f6-436e-8616-6c1d93e73d67', 'Dumbbell Goblet Squat'),
  ('%swing%',              'https://ymove.app/api/free/13263f92-5fe2-4d92-bec0-808f8b315620', 'Kettlebell Swing'),
  ('%puxada%',             'https://ymove.app/api/free/9302ad5d-b97a-4b27-afae-611b6ce70a06', 'Lat Pulldown V-Grip'),
  ('%remada baixa%',       'https://ymove.app/api/free/499ccaa4-719d-40bd-b441-511291482471', 'Seated Cable Row'),
  ('%peck deck%',          'https://ymove.app/api/free/4d197e26-766c-4c5c-b937-9918e56c5b9b', 'Pec Deck Fly'),
  ('%supino inclinado%',   'https://ymove.app/api/free/35a53872-f47c-4ec6-9bdd-888eb1705572', 'Incline Machine Press'),
  ('%pulley%',             'https://ymove.app/api/free/9a550e2c-c55e-495d-b59e-b676c3d48a41', 'Cable Tricep Pushdown'),
  ('%corda%',              'https://ymove.app/api/free/c57e3719-a853-453f-b04a-da0c9475d6e7', 'Overhead Rope Extension'),
  ('%extensora%',          'https://ymove.app/api/free/3d0e78d0-1125-4d25-8bd4-9ca7ba3799e8', 'Leg Extension'),
  ('%hack%',               'https://ymove.app/api/free/800cc264-d388-4200-8568-8f1df46e9be9', 'Hack Squat'),
  ('%flexora%',            'https://ymove.app/api/free/34a512bf-baa1-48ac-a5b9-132073166018', 'Lying Leg Curl'),
  ('%crucifixo inverso%',  'https://ymove.app/api/free/31fa8cba-bf48-4c16-9cf9-6a3627ee9bea', 'Machine Reverse Fly'),
  ('%lenhador%',           'https://ymove.app/api/free/e1f80c59-7160-4df2-babb-0aa0eeb54fea', 'Cable Woodchop');

drop table if exists amostra_saida;
create temp table amostra_saida (ordem int, secao text, item text, valor text, resultado text);

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

  -- Se o catalogo vier vazio aqui, o problema e o dono e nao o casamento:
  -- `exercicios.nutri_id` nasceu como `auth.uid()`, e em base migrada ele pode
  -- nao ser o id da organizacao. Sem esta linha, o ENSAIO diria "nenhum
  -- exercicio casou" em tudo e mandaria caçar padrao onde nao esta o erro.
  select count(*) into v_n from public.exercicios where nutri_id = v_org;
  insert into amostra_saida values (0, 'CATALOGO', 'exercicios visiveis', v_n::text,
    case when v_n = 0 then 'ZERO — o dono do catalogo nao e a organizacao; nada vai casar'
         else '' end);

  -- ═══════════ ENSAIO — o que cada padrao pegaria ═══════════
  for r in
    select av.rotulo, av.padrao,
           (select count(*) from public.exercicios e
             where e.nutri_id = v_org and e.nome ilike av.padrao)             as achou,
           (select count(*) from public.exercicios e
             where e.nutri_id = v_org and e.nome ilike av.padrao
               and e.video_url is null)                                      as vazios,
           (select string_agg(e.nome, ' | ' order by e.nome) from public.exercicios e
             where e.nutri_id = v_org and e.nome ilike av.padrao)             as nomes
      from amostra_video av
     order by av.rotulo
  loop
    insert into amostra_saida values (10, 'ENSAIO', r.rotulo,
      coalesce(r.nomes, '(nenhum exercicio casou)'),
      case when r.achou = 0  then 'sem par no catalogo — o clipe fica sem uso'
           when r.achou > 1  then 'PADRAO LARGO: casou com ' || r.achou || ' — IGNORADO, ajuste o padrao'
           when r.vazios = 0 then 'ja tem video — preservado'
           else 'vai ser preenchido' end);
  end loop;

  -- ═══════════ ESCRITA — so o par unico e vazio ═══════════
  with alvo as (
    select av.url,
           (select e.id from public.exercicios e
             where e.nutri_id = v_org and e.nome ilike av.padrao
             limit 1) as exercicio_id
      from amostra_video av
     where (select count(*) from public.exercicios e
             where e.nutri_id = v_org and e.nome ilike av.padrao) = 1
  )
  update public.exercicios e
     set video_url = alvo.url
    from alvo
   where e.id = alvo.exercicio_id
     and e.video_url is null;

  get diagnostics v_n = row_count;
  insert into amostra_saida values (20, 'ESCRITA', 'exercicios que ganharam video', v_n::text,
    case when v_n = 0 then 'nenhum — leia o ENSAIO acima para saber por que'
         else 'abra o app do aluno num treino que use esses exercicios' end);
end $amostra$;

select ordem, secao, item, valor, resultado from amostra_saida order by ordem, item;
