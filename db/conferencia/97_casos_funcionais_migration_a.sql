-- ===========================================================================
-- MIGRATION A — OS CASOS FUNCIONAIS A-E, EXECUTADOS
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE. E o unico das conferencias que escreve, e ele limpa
-- tudo o que criou, pelo ID, no fim. Se algo falhar no meio, a secao 90 diz
-- exatamente o que ficou para tras.
--
-- POR QUE ELE EXISTE. A conferencia 93 prova ESTRUTURA — colunas, policies,
-- ACL, o texto das funcoes. Estrutura nao e funcionamento: uma RPC pode ter
-- todas as validacoes no lugar e mesmo assim gravar a coisa errada. Estes sao
-- os cinco casos do briefing, rodados de verdade.
--
-- COMO ELE SIMULA A SESSAO. As RPCs exigem `auth.uid()`, e no SQL Editor ele e
-- nulo. `set_config('request.jwt.claims', ...)` e o jeito padrao de dizer ao
-- Postgres quem esta chamando — e o mesmo mecanismo que o PostgREST usa quando
-- a tela chama. Nao e um atalho: o teto temporario, a organizacao e a permissao
-- sao todos avaliados normalmente, contra esse uuid.
--
-- O QUE ELE NAO TESTA: a TELA. Texto de botao, resumo de-para e a secao
-- "Proxima renovacao" no drawer sao marcacao, e estao presos em
-- test/comercial-formularios.test.mjs e test/comercial-drawer.test.mjs. Este
-- script cobre o que acontece no BANCO.
--
-- ORDEM DOS CASOS: A, B, D, C, E — e nao A, B, C, D, E.
--   So existe UMA renovacao programada por assinatura. Se C rodasse antes de
--   D, a intencao de C sobrescreveria a de B, e D estaria removendo uma
--   cobranca que ja nao e a origem da intencao — testando outra coisa. A
--   secao F cobre justamente esse caso separado.
--
-- Para colar no SQL Editor, use db/conferencia/97_casos_funcionais_migration_a_LIMPO.sql
-- ===========================================================================

drop table if exists conf97;
create temp table conf97 (ordem int, caso text, item text, valor text, resultado text);

do $$
declare
  v_dono    uuid;
  v_ass     public.comercial_assinaturas%rowtype;
  v_plano_b uuid;              -- um plano DIFERENTE do atual, para o caso B
  v_venc    date;
  v_r       jsonb;
  v_cob_a   uuid;
  v_cob_b   uuid;
  v_cob_c   uuid;
  v_criados uuid[] := '{}';    -- tudo o que este script inserir, para limpar
  v_aud0    int;
  v_n       int;
  v_erro    text;
  v_sobrou  int;
  v_t0      timestamptz;
  v_nome    text;
begin
  v_t0 := clock_timestamp();

  -- ══════════════════════════════════════════════════════════
  -- PREPARO
  -- ══════════════════════════════════════════════════════════
  select o.proprietario_user_id into v_dono
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  if v_dono is null then
    insert into conf97 values (0, 'PREPARO', 'dono', '(nao encontrado)', 'PAROU');
    return;
  end if;

  -- A sessao simulada. `false` = vale para a sessao, nao so para a transacao,
  -- porque cada `select` do SQL Editor pode vir numa transacao propria.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_dono, 'role', 'authenticated')::text,
                     false);

  insert into conf97 values (1, 'PREPARO', 'auth.uid() simulado', coalesce(auth.uid()::text, '(nulo)'),
    case when auth.uid() = v_dono then 'OK' else 'PAROU (a sessao nao pegou)' end);

  insert into conf97 values (2, 'PREPARO', 'organizacao_do_auth()', coalesce(public.organizacao_do_auth()::text, '(nulo)'),
    case when public.organizacao_do_auth() = v_dono then 'OK' else 'PAROU' end);

  insert into conf97 values (3, 'PREPARO', 'tem_permissao(comercial.editar)', public.tem_permissao('comercial.editar')::text,
    case when public.tem_permissao('comercial.editar') then 'OK' else 'PAROU (sem a permissao, nada roda)' end);

  if auth.uid() is distinct from v_dono
     or public.organizacao_do_auth() is distinct from v_dono
     or not public.tem_permissao('comercial.editar') then
    insert into conf97 values (4, 'PREPARO', 'veredito', 'preparo falhou', 'PAROU antes dos casos');
    perform set_config('request.jwt.claims', '', false);
    return;
  end if;

  -- A cobaia: uma assinatura SEM cobranca em aberto e SEM renovacao
  -- programada — o mesmo estado em que a tela mostra "Criar cobranca do
  -- periodo". Escolhe a mais antiga, que e a que menos atrapalha se algo ficar.
  select * into v_ass
    from public.comercial_assinaturas a
   where a.nutri_id = v_dono
     and a.status = 'ativa'
     and a.plano_id is not null
     and a.proximo_plano_id is null
     and not exists (select 1 from public.financeiro_lancamentos l
                      where l.assinatura_id = a.id and l.status = 'pendente')
   order by a.fim_periodo
   limit 1;

  if v_ass.id is null then
    insert into conf97 values (5, 'PREPARO', 'cobaia', '(nenhuma)', 'PAROU (sem assinatura livre)');
    perform set_config('request.jwt.claims', '', false);
    return;
  end if;

  select p.nome into v_nome from public.pacientes p where p.id = v_ass.paciente_id;
  insert into conf97 values (5, 'PREPARO', 'cobaia', v_nome || ' | periodo ' || v_ass.inicio_periodo || ' -> ' || v_ass.fim_periodo, 'OK');

  -- Um plano diferente do atual, para o caso B.
  select id into v_plano_b from public.comercial_planos
   where nutri_id = v_dono and ativo and id <> v_ass.plano_id
   order by ordem, nome limit 1;

  if v_plano_b is null then
    insert into conf97 values (6, 'PREPARO', 'plano alternativo', '(nenhum)', 'PAROU (so ha um plano ativo)');
    perform set_config('request.jwt.claims', '', false);
    return;
  end if;

  -- SNAPSHOT DE IDS, nao de tempo. `criado_em` usa o default `now()`, que e
  -- transaction_timestamp() — o instante em que a TRANSACAO comecou, sempre
  -- anterior a um clock_timestamp() capturado dentro do bloco. Uma limpeza
  -- por janela de tempo nunca casa, e foi assim que a primeira execucao
  -- deixou tres linhas para tras dizendo que removeu zero.
  drop table if exists _aud_antes;
  create temp table _aud_antes as select id from public.comercial_assinatura_auditoria;

  select count(*) into v_aud0 from public.comercial_assinatura_auditoria;
  insert into conf97 values (7, 'PREPARO', 'auditoria antes', v_aud0::text, 'baseline');

  v_venc := v_ass.fim_periodo;

  -- ══════════════════════════════════════════════════════════
  -- CASO A — mesmo plano, mesmo valor: NAO programa
  -- ══════════════════════════════════════════════════════════
  v_r := public.comercial_criar_cobranca_do_periodo(
           v_ass.id, v_venc, coalesce(v_ass.valor_contratado, 100),
           null, null, v_ass.plano_id, v_ass.valor_contratado);
  v_cob_a := (v_r -> 'cobranca' ->> 'id')::uuid;
  v_criados := v_criados || v_cob_a;

  insert into conf97 values (10, 'A', 'cobranca criada', coalesce(v_cob_a::text, '(nenhuma)'),
    case when v_cob_a is not null then 'OK' else 'FALHOU' end);
  insert into conf97 values (11, 'A', 'programou renovacao?', (v_r ->> 'programou'),
    case when (v_r ->> 'programou') = 'false' then 'OK (plano e valor iguais nao programam)' else 'FALHOU' end);

  select count(*) into v_n from public.comercial_assinaturas
   where id = v_ass.id and proximo_plano_id is null;
  insert into conf97 values (12, 'A', 'as cinco colunas seguem NULL', v_n::text,
    case when v_n = 1 then 'OK' else 'FALHOU' end);

  select count(*) into v_n from public.comercial_assinatura_auditoria;
  insert into conf97 values (13, 'A', 'auditoria nao ganhou linha', (v_n - v_aud0)::text,
    case when v_n = v_aud0 then 'OK (nada mudou, nada a registrar)' else 'FALHOU' end);

  -- ══════════════════════════════════════════════════════════
  -- CASO B — plano diferente: programa
  -- ══════════════════════════════════════════════════════════
  v_r := public.comercial_criar_cobranca_do_periodo(
           v_ass.id, v_venc + 1, coalesce(v_ass.valor_contratado, 100),
           null, null, v_plano_b, null);
  v_cob_b := (v_r -> 'cobranca' ->> 'id')::uuid;
  v_criados := v_criados || v_cob_b;

  insert into conf97 values (20, 'B', 'programou renovacao?', (v_r ->> 'programou'),
    case when (v_r ->> 'programou') = 'true' then 'OK' else 'FALHOU' end);

  select count(*) into v_n from public.comercial_assinaturas
   where id = v_ass.id and proximo_plano_id = v_plano_b
     and renovacao_origem_id = v_cob_b
     and renovacao_definida_por = v_dono
     and renovacao_definida_em is not null;
  insert into conf97 values (21, 'B', 'intencao gravada, ligada a cobranca, com autor', v_n::text,
    case when v_n = 1 then 'OK (autor = auth.uid(), origem = a cobranca)' else 'FALHOU' end);

  -- E o contrato VIGENTE nao pode ter sido tocado. E a regra central da D.
  select count(*) into v_n from public.comercial_assinaturas
   where id = v_ass.id
     and plano_id = v_ass.plano_id
     and valor_contratado is not distinct from v_ass.valor_contratado
     and inicio_periodo = v_ass.inicio_periodo
     and fim_periodo = v_ass.fim_periodo;
  insert into conf97 values (22, 'B', 'contrato vigente INTACTO', v_n::text,
    case when v_n = 1 then 'OK (plano, valor e periodo nao mudaram)' else 'FALHOU — a intencao vazou para o vigente' end);

  select count(*) into v_n from public.comercial_assinatura_auditoria
   where assinatura_id = v_ass.id and acao = 'renovacao_programada' and usuario_id = v_dono;
  insert into conf97 values (23, 'B', 'auditoria renovacao_programada', v_n::text,
    case when v_n = 1 then 'OK' else 'FALHOU' end);

  -- ══════════════════════════════════════════════════════════
  -- CASO D — remover a cobranca do B leva a intencao junto
  -- (roda antes do C: so ha uma intencao por assinatura)
  -- ══════════════════════════════════════════════════════════
  v_r := public.comercial_cancelar_cobranca(v_cob_b);

  insert into conf97 values (30, 'D', 'cancelou', (v_r ->> 'cancelou'),
    case when (v_r ->> 'cancelou') = 'true' then 'OK' else 'FALHOU' end);
  insert into conf97 values (31, 'D', 'limpou a renovacao', (v_r ->> 'limpou_renovacao'),
    case when (v_r ->> 'limpou_renovacao') = 'true' then 'OK' else 'FALHOU' end);

  select count(*) into v_n from public.comercial_assinaturas
   where id = v_ass.id
     and proximo_plano_id is null and proximo_valor_contratado is null
     and renovacao_definida_em is null and renovacao_definida_por is null
     and renovacao_origem_id is null;
  insert into conf97 values (32, 'D', 'as cinco colunas voltaram a NULL', v_n::text,
    case when v_n = 1 then 'OK' else 'FALHOU' end);

  select count(*) into v_n from public.comercial_assinatura_auditoria
   where assinatura_id = v_ass.id and acao = 'renovacao_cancelada';
  insert into conf97 values (33, 'D', 'auditoria renovacao_cancelada', v_n::text,
    case when v_n = 1 then 'OK' else 'FALHOU' end);

  select count(*) into v_n from public.financeiro_lancamentos
   where id = v_cob_b and status = 'cancelado';
  insert into conf97 values (34, 'D', 'cobranca cancelada, nao apagada', v_n::text,
    case when v_n = 1 then 'OK' else 'FALHOU' end);

  -- ══════════════════════════════════════════════════════════
  -- CASO C — mesmo plano, valor diferente: programa
  -- ══════════════════════════════════════════════════════════
  v_r := public.comercial_criar_cobranca_do_periodo(
           v_ass.id, v_venc + 2, coalesce(v_ass.valor_contratado, 100),
           null, null, v_ass.plano_id, coalesce(v_ass.valor_contratado, 100) + 50);
  v_cob_c := (v_r -> 'cobranca' ->> 'id')::uuid;
  v_criados := v_criados || v_cob_c;

  insert into conf97 values (40, 'C', 'programou renovacao?', (v_r ->> 'programou'),
    case when (v_r ->> 'programou') = 'true' then 'OK (so o valor mudou, e basta)' else 'FALHOU' end);

  select count(*) into v_n from public.comercial_assinaturas
   where id = v_ass.id
     and proximo_plano_id = v_ass.plano_id
     and proximo_valor_contratado = coalesce(v_ass.valor_contratado, 100) + 50;
  insert into conf97 values (41, 'C', 'plano futuro = o atual, valor futuro maior', v_n::text,
    case when v_n = 1 then 'OK' else 'FALHOU' end);

  -- ══════════════════════════════════════════════════════════
  -- CASO E — mesmo vencimento ativo: erro, e NADA parcial
  -- ══════════════════════════════════════════════════════════
  select count(*) into v_n from public.financeiro_lancamentos where assinatura_id = v_ass.id;
  begin
    v_r := public.comercial_criar_cobranca_do_periodo(
             v_ass.id, v_venc, coalesce(v_ass.valor_contratado, 100),
             null, null, v_plano_b, null);
    insert into conf97 values (50, 'E', 'duplicidade recusada', 'NAO recusou', 'FALHOU');
  exception when others then
    v_erro := sqlerrm;
    insert into conf97 values (50, 'E', 'duplicidade recusada', left(v_erro, 80),
      case when sqlstate = '23505' then 'OK (indice unico)' else 'recusou por outro motivo' end);
  end;

  select count(*) into v_sobrou from public.financeiro_lancamentos where assinatura_id = v_ass.id;
  insert into conf97 values (51, 'E', 'nenhuma cobranca parcial', (v_sobrou - v_n)::text,
    case when v_sobrou = v_n then 'OK (nada foi inserido)' else 'FALHOU' end);

  -- A intencao tem que ser a do C, intocada — a tentativa do E propunha o
  -- plano B, e se ela tivesse vazado a intencao seria outra.
  select count(*) into v_n from public.comercial_assinaturas
   where id = v_ass.id and proximo_plano_id = v_ass.plano_id
     and renovacao_origem_id = v_cob_c;
  insert into conf97 values (52, 'E', 'nenhuma renovacao parcial', v_n::text,
    case when v_n = 1 then 'OK (a intencao do C seguiu intacta)' else 'FALHOU' end);

  select count(*) into v_n from public.comercial_assinatura_auditoria
   where assinatura_id = v_ass.id;
  insert into conf97 values (53, 'E', 'auditoria total do teste', v_n::text,
    case when v_n = 3 then 'OK (B programada + D cancelada + C programada)'
         else 'FALHOU (esperado 3)' end);

  -- ══════════════════════════════════════════════════════════
  -- CASO F — cancelar uma cobranca que NAO programou a intencao
  -- ══════════════════════════════════════════════════════════
  -- O outro lado da regra do §10. A intencao viva agora e a do C. Cancelar a
  -- cobranca do A — que esta pendente e nao programou nada — nao pode
  -- encostar nela. Se encostasse, remover qualquer cobranca antiga apagaria em
  -- silencio uma troca de plano combinada com o cliente.
  v_r := public.comercial_cancelar_cobranca(v_cob_a);

  insert into conf97 values (60, 'F', 'cancelou a cobranca do A', (v_r ->> 'cancelou'),
    case when (v_r ->> 'cancelou') = 'true' then 'OK' else 'FALHOU' end);
  insert into conf97 values (61, 'F', 'NAO limpou a renovacao', (v_r ->> 'limpou_renovacao'),
    case when (v_r ->> 'limpou_renovacao') = 'false' then 'OK (so a cobranca de origem limpa)' else 'FALHOU' end);

  select count(*) into v_n from public.comercial_assinaturas
   where id = v_ass.id and renovacao_origem_id = v_cob_c;
  insert into conf97 values (62, 'F', 'a intencao do C segue viva', v_n::text,
    case when v_n = 1 then 'OK' else 'FALHOU' end);

  -- ══════════════════════════════════════════════════════════
  -- LIMPEZA — pelo ID, so o que este script criou
  -- ══════════════════════════════════════════════════════════
  -- Nada de delete generico. Cada linha removida aqui nasceu nesta execucao, e
  -- os ids estao em v_criados. O `delete` na auditoria e restrito a esta
  -- assinatura E ao intervalo desta execucao.
  delete from public.comercial_assinatura_auditoria
   where assinatura_id = v_ass.id
     and id not in (select id from _aud_antes);
  get diagnostics v_n = row_count;
  insert into conf97 values (90, 'LIMPEZA', 'linhas de auditoria removidas', v_n::text, case when v_n = 3 then 'OK (as 3 do teste)' else 'CONFERIR — esperado 3' end);

  update public.comercial_assinaturas
     set proximo_plano_id = null, proximo_valor_contratado = null,
         renovacao_definida_em = null, renovacao_definida_por = null,
         renovacao_origem_id = null
   where id = v_ass.id;
  insert into conf97 values (91, 'LIMPEZA', 'renovacao programada da cobaia', 'zerada', 'OK');

  delete from public.financeiro_lancamentos where id = any(v_criados);
  get diagnostics v_n = row_count;
  insert into conf97 values (92, 'LIMPEZA', 'cobrancas de teste removidas', v_n::text,
    case when v_n = array_length(v_criados, 1) then 'OK' else 'CONFERIR — sobrou fixture' end);

  -- E o contrato da cobaia tem que estar exatamente como estava.
  select count(*) into v_n from public.comercial_assinaturas
   where id = v_ass.id
     and plano_id = v_ass.plano_id
     and valor_contratado is not distinct from v_ass.valor_contratado
     and inicio_periodo = v_ass.inicio_periodo
     and fim_periodo = v_ass.fim_periodo
     and proximo_plano_id is null;
  insert into conf97 values (93, 'LIMPEZA', 'cobaia de volta ao estado original', v_n::text,
    case when v_n = 1 then 'OK' else 'FALHOU — conferir a assinatura a mao' end);

  perform set_config('request.jwt.claims', '', false);
end $$;

insert into conf97
select 999, 'VEREDITO',
  case when exists (select 1 from conf97 where resultado like 'FALHOU%' or resultado like 'PAROU%')
       then 'HA FALHAS — nao liberar a Migration B'
       when exists (select 1 from conf97 where resultado like 'CONFERIR%')
       then 'CASOS A-E PASSARAM — conferir os pontos marcados'
       else 'CASOS A-E PASSARAM — Migration A encerrada' end,
  coalesce((select string_agg(distinct caso || '/' || item, ', ') from conf97
             where resultado like 'FALHOU%' or resultado like 'PAROU%'
                or resultado like 'CONFERIR%'), 'nada a apontar'),
  '';

select ordem, caso, item, valor, resultado from conf97 order by ordem, item;
