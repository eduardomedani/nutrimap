-- ===========================================================================
-- Evollo · AMOSTRA DE VIDEO — terceira passada: os dois que faltavam, e o swing
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE. Desfazer: db/exercicios_video_amostra_desfazer.sql
-- (o mesmo das outras — a marca e o prefixo da URL, nao o script).
--
-- 100% re-executavel. Fecha a amostra dos 25 clipes gratuitos.
--
-- ===========================================================================
-- 1) OS DOIS QUE FICARAM SEM PAR
-- ---------------------------------------------------------------------------
-- A secao CANDIDATOS da passada anterior deu os nomes, e sem ambiguidade:
--
--   Pec Deck Fly        -> "Crucifixo na máquina (voador)"
--   Machine Reverse Fly -> "Crucifixo invertido na máquina"
--
-- Eu tinha chutado "%peck deck%" e "%crucifixo inverso%" na primeira passada.
-- Os dois erraram por grafia: a casa escreve "voador" e "invertido", nao "peck
-- deck" nem "inverso". Perguntar ao dado custou uma consulta; continuar
-- chutando custaria video errado em maquina errada.
--
-- ===========================================================================
-- 2) O SWING SAI, E ISSO E O CONSERTO
-- ---------------------------------------------------------------------------
-- A primeira passada pos o clipe "Kettlebell swing" em "Swing unilateral com
-- kettlebell" — o unico exercicio do catalogo com "swing" no nome. Mas o clipe
-- e o swing CLASSICO, com as duas maos, e unilateral e outro movimento: outra
-- pegada, outra compensacao de tronco, outro risco de ombro.
--
-- VIDEO ERRADO E PIOR QUE VIDEO NENHUM. Sem video o aluno pergunta ao
-- professor; com o video errado ele treina errado achando que esta certo. Por
-- isso aqui a amostra e REMOVIDA em vez de mantida ate achar coisa melhor.
--
-- A secao CANDIDATOS lista o que ha de kettlebell no catalogo, para decidir se
-- existe um swing bilateral onde o clipe caberia.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/exercicios_video_amostra3_LIMPO.sql
-- ===========================================================================

drop table if exists amostra3;
create temp table amostra3 (nome_exato text, url text, rotulo text);

insert into amostra3 (nome_exato, url, rotulo) values
  ('Crucifixo na máquina (voador)',  'https://ymove.app/api/free/4d197e26-766c-4c5c-b937-9918e56c5b9b', 'Pec Deck Fly'),
  ('Crucifixo invertido na máquina', 'https://ymove.app/api/free/31fa8cba-bf48-4c16-9cf9-6a3627ee9bea', 'Machine Reverse Fly');

drop table if exists amostra3_saida;
create temp table amostra3_saida (ordem int, secao text, item text, valor text, resultado text);

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
  for r in
    select a.rotulo, a.nome_exato,
           (select count(*) from public.exercicios e
             where e.nutri_id = v_org and e.nome = a.nome_exato) as achou
      from amostra3 a
     order by a.rotulo
  loop
    insert into amostra3_saida values (10, 'ENSAIO', r.rotulo, r.nome_exato,
      case when r.achou = 1 then 'ok'
           when r.achou = 0 then 'NAO EXISTE com este nome — confira acento e grafia'
           else 'DUPLICADO: ' || r.achou || ' exercicios com o mesmo nome' end);
  end loop;

  -- ═══════════ ESCRITA ═══════════
  update public.exercicios e
     set video_url = a.url
    from amostra3 a
   where e.nutri_id = v_org
     and e.nome = a.nome_exato
     and (e.video_url is null or e.video_url like 'https://ymove.app/api/free/%');

  get diagnostics v_n = row_count;
  insert into amostra3_saida values (20, 'ESCRITA', 'crucifixos que ganharam video', v_n::text, '');

  -- ═══════════ O SWING SAI ═══════════
  -- So a amostra do swing, e so onde ela esta: `video_url` igual aquela URL.
  -- Filtrar pelo nome do exercicio seria pior — se alguem ja tiver movido o
  -- clipe para outro lugar, e la que ele precisa sair.
  update public.exercicios e
     set video_url = null
   where e.nutri_id = v_org
     and e.video_url = 'https://ymove.app/api/free/13263f92-5fe2-4d92-bec0-808f8b315620';

  get diagnostics v_n = row_count;
  insert into amostra3_saida values (25, 'CORRECAO', 'swing bilateral removido do unilateral', v_n::text,
    case when v_n = 0 then 'ja nao estava la' else 'video errado e pior que video nenhum' end);

  select count(*) into v_n from public.exercicios
   where nutri_id = v_org and video_url like 'https://ymove.app/api/free/%';
  insert into amostra3_saida values (26, 'TOTAL', 'exercicios com amostra', v_n::text,
    'de 25 clipes disponiveis');

  -- ═══════════ CANDIDATOS AO SWING ═══════════
  for r in
    select e.nome, e.video_url is not null as tem_video
      from public.exercicios e
     where e.nutri_id = v_org
       and (e.nome ilike '%swing%' or e.nome ilike '%kettlebell%balanc%'
            or e.nome ilike '%pendul%')
     order by e.nome
  loop
    insert into amostra3_saida values (30, 'CANDIDATOS AO SWING', r.nome, '',
      case when r.tem_video then 'ja tem video' else 'livre' end);
  end loop;
end $amostra$;

select ordem, secao, item, valor, resultado from amostra3_saida order by ordem, item;
