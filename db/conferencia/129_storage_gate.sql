-- ===========================================================================
-- 129 · O GATE DO BUCKET PRIVADO
-- ---------------------------------------------------------------------------
-- NAO DEIXA NADA NO BANCO. Semeia, prova, e termina com RAISE EXCEPTION — que
-- aborta a transacao e desfaz tudo. O relatorio vem na mensagem de erro.
-- "ERROR" aqui e o resultado esperado.
--
-- ===========================================================================
-- O QUE ELE PROVA, E O QUE ELE NAO PODE PROVAR
-- ---------------------------------------------------------------------------
-- PROVA: quem consegue enxergar a linha de `storage.objects`. E isso que o
-- Supabase consulta quando alguem pede `createSignedUrl` — sem SELECT no
-- objeto, nao sai URL assinada.
--
-- NAO PROVA: que o byte do MP4 chega ou nao chega pela rede. Isso depende do
-- servico de Storage, nao do Postgres, e so se verifica com um pedido HTTP de
-- verdade. Fica para o gate do front, e esta dito aqui para que ninguem leia
-- "12/12" como "o video toca".
--
-- ===========================================================================
-- A ARMADILHA QUE ESTE GATE EVITA
-- ---------------------------------------------------------------------------
-- A policy do bucket delega a `public.midias`. Se alguem subir um arquivo SEM
-- linha de midia correspondente, ele fica invisivel para todo mundo — e o
-- sintoma no app e "video nao carrega", que manda o proximo a investigar o
-- Storage, o CDN e o codec antes de olhar a tabela.
--
-- A prova 5 cobre esse caso de proposito: objeto orfao NAO e legivel, e isso e
-- comportamento correto, nao defeito.
--
-- Pre-requisitos: db/exercicio_midias.sql e db/storage_exercicio_midias.sql
-- ja aplicados.
--
-- Rodar no SQL Editor do Supabase, ARQUIVO INTEIRO (e uma instrucao so).
-- Para colar, use db/conferencia/129_storage_gate_LIMPO.sql
-- ===========================================================================

do $gate$
declare
  dono_a      uuid;
  outro_b     uuid;
  forasteiro  uuid := '00000000-0000-4000-8000-0000000000b2';
  pac_auth    uuid;
  ex_do_dono  uuid;
  ex_do_pac   uuid;
  n           int;
  rel         text := '';
  falhas      int  := 0;
begin
  -- =========================================================================
  -- FIXTURES
  -- =========================================================================
  select e.nutri_id, e.id into dono_a, ex_do_dono
    from public.exercicios e
   where e.nutri_id is not null
     and not exists (
           select 1 from public.treino_exercicios te
             join public.treinos t   on t.id = te.treino_id
             join public.pacientes p on p.id = t.paciente_id
            where te.exercicio_id = e.id and p.auth_user_id is not null)
   order by e.criado_em limit 1;

  select ou.auth_user_id into outro_b
    from public.organizacao_usuarios ou
   where ou.auth_user_id is distinct from dono_a and ou.status = 'ativo'
   limit 1;

  select p.auth_user_id, te.exercicio_id into pac_auth, ex_do_pac
    from public.pacientes p
    join public.treinos t            on t.paciente_id = p.id
    join public.treino_exercicios te on te.treino_id = t.id
   where p.auth_user_id is not null
   limit 1;

  if dono_a is null then
    raise exception 'GATE 129 ABORTADO: sem exercicio com dono.';
  end if;

  if not exists (select 1 from storage.buckets where id = 'exercicio-midias') then
    raise exception 'GATE 129 ABORTADO: o bucket exercicio-midias nao existe. Rode db/storage_exercicio_midias.sql antes.';
  end if;

  rel := rel || E'\n=== FIXTURES ===\n';
  rel := rel || '  dono A ............ ' || dono_a || E'\n';
  rel := rel || '  outro membro ...... ' || coalesce(outro_b::text, 'NENHUM — prova 3 nao roda') || E'\n';
  rel := rel || '  paciente (auth) ... ' || coalesce(pac_auth::text, 'NENHUM — provas 6 e 7 nao rodam') || E'\n';

  -- =========================================================================
  -- SEMENTES — tres objetos e as midias de dois deles
  -- =========================================================================
  insert into public.midias (nutri_id, chave, tipo, bucket, caminho, genero)
    values (null, 'gate129_global', 'animacao', 'exercicio-midias', 'gate129-global.mp4', 'masculino');
  insert into public.midias (nutri_id, chave, tipo, bucket, caminho, genero)
    values (null, 'gate129_do_treino', 'animacao', 'exercicio-midias', 'gate129-treino.mp4', 'feminino');

  insert into public.exercicio_midias (nutri_id, exercicio_id, midia_id, papel)
    select null, ex_do_dono, m.id, 'principal' from public.midias m where m.chave = 'gate129_global';

  if ex_do_pac is not null then
    insert into public.exercicio_midias (nutri_id, exercicio_id, midia_id, papel)
      select null, ex_do_pac, m.id, 'principal' from public.midias m where m.chave = 'gate129_do_treino'
      on conflict do nothing;
  end if;

  -- Os objetos. O terceiro e ORFAO de proposito: sem linha de midia.
  insert into storage.objects (bucket_id, name, owner, metadata)
    values ('exercicio-midias', 'gate129-global.mp4', null, '{}'::jsonb),
           ('exercicio-midias', 'gate129-treino.mp4', null, '{}'::jsonb),
           ('exercicio-midias', 'gate129-orfao.mp4',  null, '{}'::jsonb);

  rel := rel || E'\n=== RESULTADOS ===\n';

  -- =========================================================================
  -- 1 — anon
  -- =========================================================================
  begin
    set local role anon;
    select count(*) into n from storage.objects where bucket_id = 'exercicio-midias';
    reset role;
    rel := rel || '  1  anon ve objetos ................. ' ||
           case when n = 0 then 'OK (0)' else 'FALHOU (' || n || ')' end || E'\n';
    if n <> 0 then falhas := falhas + 1; end if;
  exception when others then
    reset role;
    rel := rel || E'  1  anon ve objetos ................. OK (permissao negada)\n';
  end;

  -- =========================================================================
  -- 2 a 5 — profissionais
  -- =========================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', dono_a, 'role', 'authenticated')::text, true);

  select count(*) into n from storage.objects
   where bucket_id = 'exercicio-midias' and name = 'gate129-global.mp4';
  rel := rel || '  2  membro ve o objeto do acervo .... ' ||
         case when n = 1 then 'OK' else 'FALHOU (' || n || ' — nao sai signed URL)' end || E'\n';
  if n <> 1 then falhas := falhas + 1; end if;

  if outro_b is null then
    rel := rel || E'  3  outro membro ve o objeto ........ NAO TESTAVEL (sem fixture)\n';
    falhas := falhas + 1;
  else
    perform set_config('request.jwt.claims',
                       json_build_object('sub', outro_b, 'role', 'authenticated')::text, true);
    select count(*) into n from storage.objects
     where bucket_id = 'exercicio-midias' and name = 'gate129-global.mp4';
    rel := rel || '  3  outro membro ve o objeto ........ ' ||
           case when n = 1 then 'OK' else 'FALHOU (' || n || ')' end || E'\n';
    if n <> 1 then falhas := falhas + 1; end if;
  end if;

  perform set_config('request.jwt.claims',
                     json_build_object('sub', forasteiro, 'role', 'authenticated')::text, true);
  select count(*) into n from storage.objects
   where bucket_id = 'exercicio-midias' and name = 'gate129-global.mp4';
  rel := rel || '  4  FORASTEIRO nao ve o objeto ...... ' ||
         case when n = 0 then 'OK' else 'FALHOU (' || n || ' — ACERVO ABERTO)' end || E'\n';
  if n <> 0 then falhas := falhas + 1; end if;

  perform set_config('request.jwt.claims',
                     json_build_object('sub', dono_a, 'role', 'authenticated')::text, true);
  select count(*) into n from storage.objects
   where bucket_id = 'exercicio-midias' and name = 'gate129-orfao.mp4';
  rel := rel || '  5  objeto ORFAO fica invisivel ..... ' ||
         case when n = 0 then 'OK (sem linha de midia, sem acesso)'
              else 'FALHOU (' || n || ')' end || E'\n';
  if n <> 0 then falhas := falhas + 1; end if;

  -- =========================================================================
  -- 6 e 7 — o paciente
  -- =========================================================================
  if pac_auth is null then
    rel := rel || E'  6  paciente ve o objeto do treino .. NAO TESTAVEL (sem fixture)\n';
    rel := rel || E'  7  paciente nao ve o resto ......... NAO TESTAVEL (sem fixture)\n';
    falhas := falhas + 1;
  else
    perform set_config('request.jwt.claims',
                       json_build_object('sub', pac_auth, 'role', 'authenticated')::text, true);

    select count(*) into n from storage.objects
     where bucket_id = 'exercicio-midias' and name = 'gate129-treino.mp4';
    rel := rel || '  6  paciente ve o objeto do treino .. ' ||
           case when n = 1 then 'OK' else 'FALHOU (' || n || ' — aluno sem video)' end || E'\n';
    if n <> 1 then falhas := falhas + 1; end if;

    select count(*) into n from storage.objects
     where bucket_id = 'exercicio-midias' and name = 'gate129-global.mp4';
    rel := rel || '  7  paciente nao ve o resto ......... ' ||
           case when n = 0 then 'OK' else 'FALHOU (' || n || ' — ACERVO EXPOSTO)' end || E'\n';
    if n <> 0 then falhas := falhas + 1; end if;
  end if;

  -- =========================================================================
  -- 8 — escrita
  -- =========================================================================
  perform set_config('request.jwt.claims',
                     json_build_object('sub', dono_a, 'role', 'authenticated')::text, true);
  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
      values ('exercicio-midias', 'gate129-intruso.mp4', null, '{}'::jsonb);
    rel := rel || E'  8  usuario grava no bucket ......... FALHOU (INSERT PASSOU)\n';
    falhas := falhas + 1;
  exception when others then
    rel := rel || E'  8  usuario grava no bucket ......... OK (recusado)\n';
  end;

  reset role;

  rel := rel || E'\n=== VEREDITO ===\n';
  if falhas = 0 then
    rel := rel || E'  TODAS AS 8 PROVAS PASSARAM.\n' ||
                  E'  A transacao foi desfeita: nenhum objeto nem midia de teste ficou.\n' ||
                  E'  Isto prova o ACESSO A LINHA do objeto, nao a entrega do byte pela\n' ||
                  E'  rede — essa so se verifica com um pedido HTTP real.\n';
  else
    rel := rel || '  ' || falhas || E' PROVA(S) FALHARAM — NAO APLICAR, NAO SUBIR ARQUIVO.\n';
  end if;

  raise exception E'\n%', rel;
end;
$gate$;
