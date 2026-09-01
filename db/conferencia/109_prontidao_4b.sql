-- ===========================================================================
-- ETAPA 4B — PRONTIDAO, ANTES E DEPOIS
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. Rode DUAS vezes: antes de migrar e depois.
--
-- POR QUE ESTE SCRIPT EXISTE. A 4B troca a RLS de cinco tabelas de uma vez,
-- inclusive `pacientes` — a mais referenciada do sistema. Errar aqui tem duas
-- formas, e as duas sao silenciosas:
--
--   . abrir DEMAIS: a Recepcao passa a ver prontuario ou fluxo de caixa, e
--     ninguem reclama, porque ninguem reclama de ver mais;
--   . abrir DE MENOS: o proprietario perde acesso ao proprio dado, e a tela
--     abre vazia sem erro.
--
-- COMO LER. Cada secao diz o valor ESPERADO na coluna `resultado`. A leitura
-- muda conforme o momento:
--
--   ANTES da migracao  -> FASE 1 tem que estar OK e FASE 2 tem que estar
--                         "ainda nao"
--   DEPOIS da migracao -> tudo OK
--
-- A secao FASE 1 e a que decide se voce PODE rodar a migracao. Ela nao consegue
-- ver o frontend em producao — nenhum SQL consegue — entao o que ela mede e o
-- efeito: se ainda existir lancamento nascendo com o uuid da pessoa em vez do
-- da organizacao, o frontend antigo ainda esta no ar em algum lugar.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/109_prontidao_4b_LIMPO.sql
-- ===========================================================================

drop table if exists conf109;
create temp table conf109 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_dono   uuid;
  v_org    uuid;
  v_n      int;
  v_txt    text;
  r        record;
  ALVOS    text[] := array['pacientes','comercial_assinaturas','financeiro_lancamentos',
                           'financeiro_categorias','financeiro_centros_custo'];
  CLINICAS text[] := array['respostas','avaliacoes','recordatorio_calc','consultas',
                           'paciente_documentos','checkin_respostas'];
begin
  select o.proprietario_user_id, o.id into v_dono, v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  -- ═══════════ A PREMISSA ═══════════
  -- Tudo na 4B depende disto: `organizacoes.id` E o auth.uid() do dono. Se um
  -- dia deixar de ser, `nutri_id = organizacao_do_auth()` compara uuid de
  -- tabelas diferentes e NADA casa — o sistema inteiro abre vazio.
  insert into conf109 values (0, 'PREMISSA', 'organizacoes.id = proprietario_user_id',
    coalesce(v_org::text, 'sem organizacao'),
    case when v_org is null then 'FALTA a organizacao — rode a Etapa 2'
         when v_org = v_dono then 'OK'
         else 'QUEBRADO — a 4B nao pode rodar' end);

  -- ═══════════ FASE 1 — o frontend ja esta no ar? ═══════════
  -- Lancamento criado nos ultimos 7 dias com nutri_id != organizacao denuncia
  -- frontend antigo escrevendo. Zero e o esperado (hoje so o proprietario
  -- escreve, e para ele os dois uuid coincidem) — mas a consulta passa a valer
  -- de verdade quando a Recepcao comecar a operar.
  select count(*) into v_n
    from public.financeiro_lancamentos
   where criado_em > now() - interval '7 days'
     and nutri_id <> v_org;
  insert into conf109 values (10, 'FASE 1', 'lancamentos recentes fora da organizacao', v_n::text,
    case when v_n = 0 then 'OK' else 'frontend antigo ainda escrevendo — NAO migre' end);

  select count(*) into v_n
    from public.pacientes
   where criado_em > now() - interval '7 days'
     and nutri_id <> v_org;
  insert into conf109 values (11, 'FASE 1', 'pacientes recentes fora da organizacao', v_n::text,
    case when v_n = 0 then 'OK' else 'criarPaciente ainda manda o uuid da pessoa' end);

  -- Dado orfao de qualquer epoca: linha cujo dono nao e a organizacao. Depois
  -- da migracao ela fica INVISIVEL para todo mundo, inclusive o proprietario.
  foreach v_txt in array ALVOS loop
    execute format('select count(*) from public.%I where nutri_id <> $1', v_txt)
      into v_n using v_org;
    insert into conf109 values (12, 'FASE 1', 'linhas orfas em ' || v_txt, v_n::text,
      case when v_n = 0 then 'OK'
           else 'estas somem da tela apos migrar — resolva ANTES' end);
  end loop;

  -- ═══════════ FASE 2 — as policies ═══════════
  foreach v_txt in array ALVOS loop
    select count(*) into v_n from pg_policies
     where schemaname = 'public' and tablename = v_txt
       and coalesce(qual,'') || coalesce(with_check,'') like '%organizacao_do_auth%';
    insert into conf109 values (20, 'FASE 2', 'policies migradas em ' || v_txt, v_n::text,
      case when v_n >= 4 then 'OK' else 'ainda nao' end);
  end loop;

  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and column_name = 'nutri_id'
     and table_name = any (ALVOS)
     and column_default like '%organizacao_do_auth%';
  insert into conf109 values (21, 'FASE 2', 'defaults migrados', v_n || ' de 5',
    case when v_n = 5 then 'OK' else 'ainda nao' end);

  -- Toda policy migrada tem que exigir permissao TAMBEM. Tenancy sozinha faria
  -- qualquer membro ativo enxergar tudo o que a organizacao tem.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = any (ALVOS)
     and coalesce(qual,'') || coalesce(with_check,'') like '%organizacao_do_auth%'
     and coalesce(qual,'') || coalesce(with_check,'') not like '%tem_permissao%'
     and policyname <> 'pacientes_delete';
  insert into conf109 values (22, 'FASE 2', 'policies com tenancy e SEM permissao', v_n::text,
    case when v_n = 0 then 'OK'
         else 'REGRESSAO DE PRIVACIDADE — membro ve tudo da organizacao' end);

  -- ═══════════ A REGRA DAS DUAS DONAS ═══════════
  -- `financeiro_lancamentos` so esta certa se a policy mencionar assinatura_id
  -- E as duas familias de permissao. Sem assinatura_id, ou ela fechou a
  -- cobranca para o Comercial, ou abriu o caixa inteiro.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'financeiro_lancamentos'
     and cmd = 'SELECT'
     and qual like '%assinatura_id%'
     and qual like '%comercial.visualizar%'
     and qual like '%financeiro.visualizar%';
  insert into conf109 values (30, 'DUAS DONAS', 'select separa cobranca de caixa', v_n::text,
    case when v_n = 1 then 'OK' else 'ainda nao' end);

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'financeiro_lancamentos'
     and cmd = 'DELETE' and coalesce(qual,'') like '%comercial.%';
  insert into conf109 values (31, 'DUAS DONAS', 'delete NAO abre para o Comercial', v_n::text,
    case when v_n = 0 then 'OK' else 'cobranca podeira ser APAGADA, nao cancelada' end);

  -- ═══════════ EXCLUSAO DE PACIENTE ═══════════
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'pacientes' and cmd = 'DELETE'
     and qual like '%auth.uid()%' and qual like '%organizacao_do_auth%';
  insert into conf109 values (40, 'EXCLUSAO', 'delete de paciente exige ser o dono', v_n::text,
    case when v_n = 1 then 'OK' else 'ainda nao' end);

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'pacientes' and cmd = 'DELETE'
     and qual like '%tem_permissao%';
  insert into conf109 values (41, 'EXCLUSAO', 'delete NAO se delega por permissao', v_n::text,
    case when v_n = 0 then 'OK' else 'apagar cliente virou algo delegavel' end);

  -- ═══════════ O CLINICO CONTINUA FECHADO ═══════════
  -- A 4B nao toca nestas tabelas. Se alguma aparecer com organizacao_do_auth,
  -- `clientes.visualizar` passou a arrastar o prontuario — o §25 caiu.
  foreach v_txt in array CLINICAS loop
    select count(*) into v_n from pg_policies
     where schemaname = 'public' and tablename = v_txt
       and coalesce(qual,'') || coalesce(with_check,'') like '%organizacao_do_auth%';
    if v_n > 0 then
      insert into conf109 values (50, 'CLINICO', v_txt, v_n::text,
        'ABRIU — o prontuario saiu junto com o cadastro');
    end if;
  end loop;
  if not exists (select 1 from conf109 where secao = 'CLINICO') then
    insert into conf109 values (50, 'CLINICO', 'nenhuma tabela clinica migrada', '0', 'OK');
  end if;

  -- E a segunda tranca: as policies clinicas comparam p.nutri_id = auth.uid()
  -- DENTRO do exists. E ela que mantem a Recepcao fora mesmo com pacientes
  -- migrada. Some-la sem querer seria a regressao mais cara desta etapa.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = any (CLINICAS)
     and coalesce(qual,'') || coalesce(with_check,'') like '%auth.uid()%';
  insert into conf109 values (51, 'CLINICO', 'policies clinicas ainda comparam auth.uid()', v_n::text,
    case when v_n > 0 then 'OK' else 'PERIGO — a segunda tranca sumiu' end);

  -- ═══════════ AS RPCs ═══════════
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('comercial_criar_cobranca_do_periodo','comercial_registrar_pagamento')
     and p.prosrc like '%TETO%';
  insert into conf109 values (60, 'RPCs', 'funcoes ainda com o teto temporario', v_n::text,
    case when v_n = 0 then 'OK — a Recepcao consegue operar'
         when v_n = 2 then 'ainda nao (rode db/multiusuario_etapa4b_rpc.sql)'
         else 'PELA METADE — uma migrou e a outra nao' end);

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('comercial_criar_cobranca_do_periodo','comercial_registrar_pagamento')
     and p.prosrc like '%fora da organizacao%';
  insert into conf109 values (61, 'RPCs', 'funcoes que checam a organizacao', v_n::text,
    case when v_n = 2 then 'OK' else 'a checagem certa saiu junto com o teto' end);

  -- ═══════════ O PROPRIETARIO CONTINUA DONO ═══════════
  -- O teste que so o dono pode fazer: ele tem todas as permissoes?
  for r in
    select pm.chave, public.tem_permissao(pm.chave) as tem
      from public.permissoes pm
     where pm.chave in ('clientes.visualizar','clientes.criar','clientes.editar',
                        'comercial.visualizar','comercial.editar',
                        'financeiro.visualizar','financeiro.lancar','financeiro.editar')
     order by pm.chave
  loop
    insert into conf109 values (70, 'QUEM ESTA RODANDO', r.chave,
      case when r.tem then 'sim' else 'NAO' end, '');
  end loop;

  insert into conf109 values (71, 'QUEM ESTA RODANDO', 'auth.uid()',
    coalesce(auth.uid()::text, '(nulo — SQL Editor sem sessao)'),
    case when auth.uid() is null
         then 'normal no SQL Editor: as secoes 70 e 71 so valem no app'
         when auth.uid() = v_org then 'e o proprietario'
         else 'NAO e o proprietario' end);
end $$;

select ordem, secao, item, valor, resultado from conf109 order by ordem, item;
