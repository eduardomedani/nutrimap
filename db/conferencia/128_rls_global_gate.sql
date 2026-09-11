-- ===========================================================================
-- 128 · O GATE DE RLS QUE INAUGURA nutri_id IS NULL
-- ---------------------------------------------------------------------------
-- NAO DEIXA NADA NO BANCO. Semeia dado de teste, prova a RLS contra ele, e
-- termina com RAISE EXCEPTION — que aborta a transacao e desfaz TUDO.
--
-- O relatorio vem DENTRO da mensagem de erro. "ERROR" aqui e o resultado
-- esperado, nao uma falha: e o que garante que nenhuma linha de teste
-- sobreviva. Leia o texto da mensagem.
--
-- ===========================================================================
-- POR QUE ESTE ARQUIVO EXISTE
-- ---------------------------------------------------------------------------
-- O SQL Editor do Supabase roda como `service_role`, que IGNORA RLS. Conferir
-- a policy por la aprovaria qualquer coisa: um `select` volta todas as linhas
-- tanto com a policy certa quanto com a policy errada, porque a policy nao e
-- consultada. O teste passaria sem testar.
--
-- Aqui a RLS e exercitada de verdade: `set local role authenticated` mais
-- `request.jwt.claims` com um `sub` escolhido — e assim `auth.uid()` devolve
-- quem eu quiser, e a policy e avaliada como para um usuario comum.
--
-- Nenhuma linha global existe no banco ainda (db/conferencia/127f: 746
-- exercicios, 0 globais). Este e o unico momento em que da para provar o
-- caminho global SEM dado exposto: as linhas de teste nascem e morrem dentro
-- da transacao.
--
-- ===========================================================================
-- O QUE E PROVADO
-- ---------------------------------------------------------------------------
--   1  anon nao acessa midias
--   2  anon nao acessa exercicio_midias
--   3  profissional le a midia global
--   4  profissional le a propria midia privada
--   5  OUTRO profissional NAO le a privada alheia
--   6  OUTRO profissional le a global
--  6b  FORASTEIRO (nem membro nem paciente) NAO le a global
--   7  usuario comum NAO cria global          (insert com nutri_id null falha)
--   8  usuario comum NAO edita a global       (update alcanca 0 linhas)
--   9  usuario comum NAO apaga a global       (delete alcanca 0 linhas)
--  10  paciente le a midia do PROPRIO treino
--  11  paciente NAO lista o catalogo global   (global fora do treino: 0)
--
-- Onde falta fixture no banco (ex.: nenhum paciente com login e treino), o
-- teste sai como NAO TESTAVEL. NAO como aprovado — um teste que nao rodou nao
-- e um teste que passou.
--
-- Pre-requisitos: db/exercicios_delete_global.sql e db/exercicio_midias.sql
-- ja aplicados.
--
-- Rodar no SQL Editor do Supabase, ARQUIVO INTEIRO (e uma instrucao so).
-- Para colar, use db/conferencia/128_rls_global_gate_LIMPO.sql
-- ===========================================================================

do $gate$
declare
  dono_a       uuid;
  outro_b      uuid;
  forasteiro   uuid := '00000000-0000-4000-8000-0000000000b2';
  pac_auth     uuid;
  pac_id       uuid;
  ex_do_dono   uuid;
  ex_do_pac    uuid;
  m_global     uuid;
  m_global_2   uuid;
  m_privada    uuid;
  n            int;
  rel          text := '';
  falhas       int  := 0;
begin
  -- =========================================================================
  -- FIXTURES — quem sao os personagens
  -- =========================================================================
  -- O exercicio do dono precisa estar FORA de qualquer treino de paciente com
  -- login. Se estivesse dentro, o teste 11 falharia por coincidencia de
  -- fixture — o aluno leria a midia pela via legitima do proprio treino — e eu
  -- leria isso como catalogo exposto.
  select e.nutri_id, e.id into dono_a, ex_do_dono
    from public.exercicios e
   where e.nutri_id is not null
     and not exists (
           select 1
             from public.treino_exercicios te
             join public.treinos t   on t.id = te.treino_id
             join public.pacientes p on p.id = t.paciente_id
            where te.exercicio_id = e.id
              and p.auth_user_id is not null)
   order by e.criado_em
   limit 1;

  -- Um paciente que tenha login E treino com exercicio. Sem isso os testes
  -- 10 e 11 nao tem como rodar.
  select p.auth_user_id, p.id, te.exercicio_id
    into pac_auth, pac_id, ex_do_pac
    from public.pacientes p
    join public.treinos t            on t.paciente_id = p.id
    join public.treino_exercicios te on te.treino_id = t.id
   where p.auth_user_id is not null
   limit 1;

  -- OUTRO profissional: precisa ser MEMBRO ATIVO de verdade, nao um uuid
  -- inventado. A policy agora libera a global por `organizacao_do_auth()`, e
  -- um uuid solto nao esta em `organizacao_usuarios` — a prova 6 mediria a
  -- ausencia da fixture, nao a policy.
  select ou.auth_user_id into outro_b
    from public.organizacao_usuarios ou
   where ou.auth_user_id is distinct from dono_a
     and ou.status = 'ativo'
   limit 1;

  rel := rel || E'\n=== FIXTURES ===\n';
  rel := rel || '  dono A ............ ' || coalesce(dono_a::text, 'NENHUM') || E'\n';
  rel := rel || '  outro membro ...... ' || coalesce(outro_b::text, 'NENHUM — provas 5 e 6 nao rodam') || E'\n';
  rel := rel || '  exercicio do dono . ' || coalesce(ex_do_dono::text, 'NENHUM') || E'\n';
  rel := rel || '  paciente (auth) ... ' || coalesce(pac_auth::text, 'NENHUM — testes 10 e 11 nao rodam') || E'\n';
  rel := rel || '  exercicio do treino ' || coalesce(ex_do_pac::text, 'NENHUM') || E'\n';

  if dono_a is null then
    raise exception 'GATE 128 ABORTADO: nenhum exercicio com dono. Sem fixture nao ha teste.';
  end if;

  -- =========================================================================
  -- SEMENTES — criadas como service_role, que ignora RLS de proposito:
  -- semear e trabalho de administrador; o que se testa e a LEITURA depois.
  -- =========================================================================
  insert into public.midias (nutri_id, chave, tipo, bucket, caminho, genero)
    values (null, 'gate_global_1', 'animacao', 'gate', 'g1.mp4', 'masculino')
    returning id into m_global;

  insert into public.midias (nutri_id, chave, tipo, bucket, caminho, genero)
    values (null, 'gate_global_2', 'animacao', 'gate', 'g2.mp4', 'feminino')
    returning id into m_global_2;

  insert into public.midias (nutri_id, chave, tipo, bucket, caminho, genero)
    values (dono_a, 'gate_privada_a', 'animacao', 'gate', 'pa.mp4', 'masculino')
    returning id into m_privada;

  -- vinculo global do exercicio do dono
  insert into public.exercicio_midias (nutri_id, exercicio_id, midia_id, papel)
    values (null, ex_do_dono, m_global, 'principal');

  -- vinculo global do exercicio que esta no treino do paciente
  if ex_do_pac is not null then
    insert into public.exercicio_midias (nutri_id, exercicio_id, midia_id, papel)
      values (null, ex_do_pac, m_global_2, 'principal')
      on conflict do nothing;
  end if;

  rel := rel || E'\n=== RESULTADOS ===\n';

  -- =========================================================================
  -- 1 e 2 — anon
  -- =========================================================================
  begin
    set local role anon;
    select count(*) into n from public.midias;
    reset role;
    rel := rel || '  1  anon le midias .................. ' ||
           case when n = 0 then 'OK (0 linhas)' else 'FALHOU (' || n || ' linhas)' end || E'\n';
    if n <> 0 then falhas := falhas + 1; end if;
  exception when insufficient_privilege then
    reset role;
    rel := rel || E'  1  anon le midias .................. OK (permissao negada)\n';
  when others then
    reset role;
    rel := rel || '  1  anon le midias .................. OK (' || sqlerrm || ')' || E'\n';
  end;

  begin
    set local role anon;
    select count(*) into n from public.exercicio_midias;
    reset role;
    rel := rel || '  2  anon le exercicio_midias ........ ' ||
           case when n = 0 then 'OK (0 linhas)' else 'FALHOU (' || n || ' linhas)' end || E'\n';
    if n <> 0 then falhas := falhas + 1; end if;
  exception when others then
    reset role;
    rel := rel || E'  2  anon le exercicio_midias ........ OK (permissao negada)\n';
  end;

  -- =========================================================================
  -- 3 a 6 — leitura por profissional
  -- =========================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', dono_a, 'role', 'authenticated')::text, true);

  select count(*) into n from public.midias where id = m_global;
  rel := rel || '  3  dono le a global ................ ' ||
         case when n = 1 then 'OK' else 'FALHOU (' || n || ')' end || E'\n';
  if n <> 1 then falhas := falhas + 1; end if;

  select count(*) into n from public.midias where id = m_privada;
  rel := rel || '  4  dono le a propria privada ....... ' ||
         case when n = 1 then 'OK' else 'FALHOU (' || n || ')' end || E'\n';
  if n <> 1 then falhas := falhas + 1; end if;

  if outro_b is null then
    rel := rel || E'  5  OUTRO nao le a privada alheia ... NAO TESTAVEL (sem fixture)\n';
    rel := rel || E'  6  OUTRO le a global ............... NAO TESTAVEL (sem fixture)\n';
    falhas := falhas + 1;
  else
    perform set_config('request.jwt.claims',
                       json_build_object('sub', outro_b, 'role', 'authenticated')::text, true);

    select count(*) into n from public.midias where id = m_privada;
    rel := rel || '  5  OUTRO nao le a privada alheia ... ' ||
           case when n = 0 then 'OK' else 'FALHOU (' || n || ' — VAZAMENTO)' end || E'\n';
    if n <> 0 then falhas := falhas + 1; end if;

    select count(*) into n from public.midias where id = m_global;
    rel := rel || '  6  OUTRO le a global ............... ' ||
           case when n = 1 then 'OK' else 'FALHOU (' || n || ')' end || E'\n';
    if n <> 1 then falhas := falhas + 1; end if;
  end if;

  -- 6b — quem nao e da organizacao NEM paciente nao ve nada. E o contraponto
  -- da 6: sem ele, "membro le a global" nao prova que NAO-membro nao le.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', forasteiro, 'role', 'authenticated')::text, true);

  select count(*) into n from public.midias where id = m_global;
  rel := rel || '  6b FORASTEIRO nao le a global ..... ' ||
         case when n = 0 then 'OK' else 'FALHOU (' || n || ' — CATALOGO ABERTO)' end || E'\n';
  if n <> 0 then falhas := falhas + 1; end if;

  -- =========================================================================
  -- 7 a 9 — escrita no acervo global por usuario comum
  -- =========================================================================
  perform set_config('request.jwt.claims',
                     json_build_object('sub', dono_a, 'role', 'authenticated')::text, true);

  begin
    insert into public.midias (nutri_id, chave, tipo, bucket, caminho)
      values (null, 'gate_intruso', 'animacao', 'gate', 'x.mp4');
    rel := rel || E'  7  usuario cria global ............. FALHOU (INSERT PASSOU)\n';
    falhas := falhas + 1;
  exception when others then
    rel := rel || E'  7  usuario cria global ............. OK (recusado)\n';
  end;

  update public.midias set genero = 'neutro' where id = m_global;
  get diagnostics n = row_count;
  rel := rel || '  8  usuario edita a global .......... ' ||
         case when n = 0 then 'OK (0 linhas)' else 'FALHOU (' || n || ' editadas)' end || E'\n';
  if n <> 0 then falhas := falhas + 1; end if;

  delete from public.midias where id = m_global;
  get diagnostics n = row_count;
  rel := rel || '  9  usuario apaga a global .......... ' ||
         case when n = 0 then 'OK (0 linhas)' else 'FALHOU (' || n || ' apagadas)' end || E'\n';
  if n <> 0 then falhas := falhas + 1; end if;

  -- =========================================================================
  -- 10 e 11 — o paciente
  -- =========================================================================
  if pac_auth is null then
    rel := rel || E'  10 paciente le a do treino ......... NAO TESTAVEL (sem fixture)\n';
    rel := rel || E'  11 paciente nao lista o catalogo ... NAO TESTAVEL (sem fixture)\n';
    falhas := falhas + 1;
  else
    perform set_config('request.jwt.claims',
                       json_build_object('sub', pac_auth, 'role', 'authenticated')::text, true);

    select count(*) into n from public.midias where id = m_global_2;
    rel := rel || '  10 paciente le a do treino ......... ' ||
           case when n = 1 then 'OK' else 'FALHOU (' || n || ' — aluno sem demonstracao)' end || E'\n';
    if n <> 1 then falhas := falhas + 1; end if;

    select count(*) into n from public.midias where id = m_global;
    rel := rel || '  11 paciente nao lista o catalogo ... ' ||
           case when n = 0 then 'OK' else 'FALHOU (' || n || ' — catalogo exposto)' end || E'\n';
    if n <> 0 then falhas := falhas + 1; end if;
  end if;

  reset role;

  rel := rel || E'\n=== VEREDITO ===\n';
  if falhas = 0 then
    rel := rel || E'  TODAS AS 12 PROVAS PASSARAM.\n' ||
                  E'  A transacao foi desfeita: nenhuma linha de teste ficou no banco.\n';
  else
    rel := rel || '  ' || falhas || E' PROVA(S) FALHARAM — NAO APLICAR, NAO SUBIR ARQUIVO.\n';
  end if;

  -- O relatorio sai pela mensagem de erro, e o erro e o que desfaz tudo.
  raise exception E'\n%', rel;
end;
$gate$;
