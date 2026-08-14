-- ===========================================================================
-- DE ONDE VIERAM AS 31 COBRANCAS E AS 2 CANCELADAS
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. Nenhum update, nenhum delete, nenhuma funcao.
--
-- O RETRATO ANTERIOR, para comparar:
--   13/08/2026, depois da atualizacao de pagamentos -> 29 cobrancas, 0 canceladas
--   13/08/2026, conferencia 93 (Migration A)        -> 31 cobrancas, 2 canceladas
--
-- Duas cobrancas a mais e duas canceladas. A Migration A nao pode te-las
-- criado — ela nao escreve em `financeiro_lancamentos`, e as conferencias 93
-- mostraram 0 renovacoes programadas e auditoria vazia, ou seja, a RPC nova
-- nunca rodou. Entao a origem esta fora dela.
--
-- ONDE ESTA A RESPOSTA. `financeiro_auditoria` existe desde
-- db/financeiro_despesas_etapa1.sql e tem gatilho em `financeiro_lancamentos`:
-- ela grava `criado`, `excluido` e cada campo alterado, com `usuario_id`. E a
-- unica fonte que diz QUEM e QUANDO — `financeiro_lancamentos.criado_por`
-- responde so o quem, e so na criacao.
--
-- COMO LER, na ordem das secoes:
--   10 TOTAIS         -> confirma o 31/2 e separa por origem
--   20 AS 2 CANCELADAS-> as duas, com a trilha inteira de cada uma
--   30 AS MAIS NOVAS  -> tudo que nasceu depois da atualizacao de 13/08
--   40 A TRILHA       -> eventos de auditoria do dia, em ordem
--   50 SEM TRILHA     -> cobranca cuja auditoria nao existe (import antigo)
--
-- Para colar no SQL Editor, use db/conferencia/94_origem_das_cobrancas_LIMPO.sql
-- ===========================================================================

drop table if exists conf94;
create temp table conf94 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_dono uuid;
  v_n    int;
  r      record;
  -- Segundo cursor para o laco aninhado da secao 20. Reusar `r` faria o laco
  -- de dentro sobrescrever o registro do de fora — funciona por acidente e
  -- quebra na primeira edicao.
  r2     record;
begin
  -- O DONO SEM DEPENDER DE `organizacoes`.
  --
  -- A primeira versao resolvia o dono pela tabela de organizacoes, como as
  -- conferencias 91 e 93. Em 13/08/2026 isso estourou aqui com "relation
  -- public.organizacoes does not exist" — no mesmo select que a 93 tinha
  -- acabado de rodar. Ver db/conferencia/96_onde_estao_as_organizacoes.sql.
  --
  -- Investigar de onde vieram cobrancas nao pode depender da tabela de
  -- organizacoes: o dono destas linhas ja esta em `comercial_assinaturas`, e
  -- e o mesmo uuid. Entao tenta pelo caminho de sempre e, se ele falhar por
  -- qualquer motivo, cai para a propria tabela que se quer investigar.
  begin
    select o.proprietario_user_id into v_dono
      from public.organizacoes o
      join public.admins a on a.user_id = o.proprietario_user_id;
  exception when others then
    v_dono := null;
  end;

  if v_dono is null then
    select a.nutri_id into v_dono
      from public.comercial_assinaturas a
     group by a.nutri_id
     order by count(*) desc
     limit 1;
  end if;

  insert into conf94 values (1, 'IDENTIDADE', 'dono das cobrancas', coalesce(v_dono::text, '(nao resolvido)'),
    'se `organizacoes` falhou, este veio de comercial_assinaturas');

  -- ═══════════ 10) TOTAIS ═══════════
  select count(*) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and assinatura_id is not null;
  insert into conf94 values (10, 'TOTAIS', 'cobrancas de assinatura', v_n::text,
    case when v_n = 31 then 'confere com a 93' else 'mudou desde a 93' end);

  for r in
    select coalesce(origem, '(nulo)') as origem, status, count(*) as n,
           replace(replace(replace(to_char(sum(valor), 'FM999G999G990D00'), ',', 'X'), '.', ','), 'X', '.') as total
      from public.financeiro_lancamentos
     where nutri_id = v_dono and assinatura_id is not null
     group by 1, 2
     order by 1, 2
  loop
    insert into conf94 values (11, 'TOTAIS', r.origem || ' / ' || r.status,
      r.n || ' cobranca(s) | R$ ' || r.total, '');
  end loop;

  -- ═══════════ 20) AS 2 CANCELADAS, uma a uma ═══════════
  -- Estas sao as que mais importam: cancelar tira dinheiro do "a receber".
  for r in
    select l.id, p.nome, l.valor, l.vencimento, l.competencia,
           l.origem, l.origem_linha, l.criado_em, l.atualizado_em, l.criado_por,
           l.observacoes
      from public.financeiro_lancamentos l
      join public.comercial_assinaturas a on a.id = l.assinatura_id
      join public.pacientes p             on p.id = a.paciente_id
     where l.nutri_id = v_dono and l.assinatura_id is not null
       and l.status = 'cancelado'
     order by l.atualizado_em
  loop
    insert into conf94 values (20, 'CANCELADA', r.nome,
      'R$ ' || replace(replace(replace(to_char(coalesce(r.valor, 0), 'FM999G990D00'), ',', 'X'), '.', ','), 'X', '.')
      || ' | vence ' || r.vencimento
      || ' | origem ' || coalesce(r.origem, '(nulo)')
      || coalesce(' linha ' || r.origem_linha, '')
      || ' | criada ' || to_char(r.criado_em, 'DD/MM HH24:MI')
      || ' | cancelada ' || to_char(r.atualizado_em, 'DD/MM HH24:MI'),
      case when r.criado_por = v_dono then 'criada pelo proprietario'
           when r.criado_por is null  then 'sem autor (import ou trigger)'
           else 'criada por OUTRA conta: ' || left(r.criado_por::text, 8) end);

    -- E a trilha completa dela.
    for r2 in
      select fa.acao, fa.usuario_id, fa.antes, fa.depois, fa.criado_em
        from public.financeiro_auditoria fa
       where fa.lancamento_id = r.id
       order by fa.criado_em
    loop
      insert into conf94 values (21, '  trilha de ' || r.nome, r2.acao,
        to_char(r2.criado_em, 'DD/MM HH24:MI:SS')
        || ' | de ' || coalesce(r2.antes::text, '{}')
        || ' | para ' || coalesce(r2.depois::text, '{}'),
        case when r2.usuario_id = v_dono then 'proprietario'
             when r2.usuario_id is null  then 'sem sessao (SQL Editor?)'
             else 'outra conta: ' || left(r2.usuario_id::text, 8) end);
    end loop;
  end loop;

  -- ═══════════ 30) O QUE NASCEU DEPOIS DA ATUALIZACAO DE 13/08 ═══════════
  -- A atualizacao de pagamentos rodou em 13/08/2026 e deixou 29. Tudo com
  -- `criado_em` posterior ao ultimo lancamento dela e novidade a explicar.
  for r in
    select l.id, p.nome, l.valor, l.vencimento, l.status, l.origem,
           l.criado_em, l.criado_por
      from public.financeiro_lancamentos l
      join public.comercial_assinaturas a on a.id = l.assinatura_id
      join public.pacientes p             on p.id = a.paciente_id
     where l.nutri_id = v_dono and l.assinatura_id is not null
       and l.criado_em > timestamptz '2026-08-13 14:00-03'
     order by l.criado_em
  loop
    insert into conf94 values (30, 'NOVA DESDE 13/08', r.nome,
      'R$ ' || replace(replace(replace(to_char(coalesce(r.valor, 0), 'FM999G990D00'), ',', 'X'), '.', ','), 'X', '.')
      || ' | vence ' || r.vencimento
      || ' | ' || r.status
      || ' | origem ' || coalesce(r.origem, '(nulo)')
      || ' | ' || to_char(r.criado_em, 'DD/MM HH24:MI'),
      case when r.criado_por = v_dono then 'proprietario'
           when r.criado_por is null  then 'sem autor'
           else 'OUTRA conta: ' || left(r.criado_por::text, 8) end);
  end loop;

  select count(*) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and assinatura_id is not null and criado_em > timestamptz '2026-08-13 14:00-03';
  insert into conf94 values (31, 'NOVA DESDE 13/08', '~ total', v_n::text,
    case when v_n = 2 then 'as duas que explicam 29 -> 31'
         else 'diferente de 2 — reler a secao 10' end);

  -- ═══════════ 40) A TRILHA DO DIA ═══════════
  -- Todo evento de auditoria em cobranca de assinatura desde 13/08, em ordem.
  -- E aqui que aparece um cancelamento feito pela tela ou pelo SQL Editor.
  for r in
    select fa.acao, fa.criado_em, fa.usuario_id, p.nome,
           fa.antes, fa.depois
      from public.financeiro_auditoria fa
      join public.financeiro_lancamentos l on l.id = fa.lancamento_id
      join public.comercial_assinaturas a  on a.id = l.assinatura_id
      join public.pacientes p              on p.id = a.paciente_id
     where fa.nutri_id = v_dono
       and l.assinatura_id is not null
       and fa.criado_em > timestamptz '2026-08-13 14:00-03'
     order by fa.criado_em
  loop
    insert into conf94 values (40, 'TRILHA DESDE 13/08',
      to_char(r.criado_em, 'DD/MM HH24:MI:SS') || ' ' || r.nome,
      r.acao || ' | de ' || coalesce(r.antes::text, '{}') || ' | para ' || coalesce(r.depois::text, '{}'),
      case when r.usuario_id = v_dono then 'proprietario'
           when r.usuario_id is null  then 'sem sessao (SQL Editor?)'
           else 'outra conta: ' || left(r.usuario_id::text, 8) end);
  end loop;

  -- ═══════════ 50) COBRANCA SEM TRILHA ═══════════
  -- A auditoria so existe desde db/financeiro_despesas_etapa1.sql. Cobranca
  -- anterior a ela nao tem evento — nao e suspeita, e idade.
  select count(*) into v_n
    from public.financeiro_lancamentos l
   where l.nutri_id = v_dono and l.assinatura_id is not null
     and not exists (select 1 from public.financeiro_auditoria fa where fa.lancamento_id = l.id);
  insert into conf94 values (50, 'SEM TRILHA', 'cobrancas sem evento de auditoria', v_n::text,
    'esperado: as que a atualizacao de 13/08 LIGOU a uma assinatura, sem criar');

  -- ═══════════ 60) A AUDITORIA DA ASSINATURA ═══════════
  -- Antes de qualquer limpeza de fixture: o que existe aqui hoje.
  select count(*) into v_n from public.comercial_assinatura_auditoria;
  insert into conf94 values (60, 'AUDITORIA DA ASSINATURA', 'linhas', v_n::text,
    case when v_n = 0 then 'vazia — nada a limpar' else 'HA LINHAS: listadas abaixo, conferir antes de apagar' end);

  for r in
    select ca.acao, ca.criado_em, ca.usuario_id, p.nome, ca.antes, ca.depois
      from public.comercial_assinatura_auditoria ca
      join public.comercial_assinaturas a on a.id = ca.assinatura_id
      join public.pacientes p             on p.id = a.paciente_id
     order by ca.criado_em
  loop
    insert into conf94 values (61, '  evento', to_char(r.criado_em, 'DD/MM HH24:MI') || ' ' || r.nome,
      r.acao || ' | de ' || r.antes::text || ' | para ' || r.depois::text,
      case when r.usuario_id = v_dono then 'proprietario' else coalesce(left(r.usuario_id::text, 8), 'sem autor') end);
  end loop;
end $$;

select ordem, secao, item, valor, resultado from conf94 order by ordem, item, valor;
