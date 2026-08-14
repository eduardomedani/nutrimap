-- ===========================================================================
-- E2E — A CONFERENCIA DEPOIS DO PAGAMENTO
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- Rodar DEPOIS de registrar o pagamento pela tela.
--
-- ELE NAO PRECISA DE PARAMETRO. Encontra sozinho as renovacoes recentes pela
-- auditoria `renovada`, e confere cada uma. Se voce pagou os dois cenarios,
-- aparecem os dois.
--
-- O QUE ELE FAZ DE DIFERENTE DAS OUTRAS CONFERENCIAS. Ele nao pergunta "os
-- campos mudaram?" — ele REFAZ A CONTA por fora e compara:
--
--   inicio esperado = atraso <= tolerancia ? fim_anterior : pago_em
--   fim esperado    = inicio + duracao
--
-- com `atraso`, `tolerancia` e `duracao` tirados do PLANO QUE ENTROU e do
-- `antes` que a propria auditoria guardou. Se a RPC tivesse usado a tolerancia
-- do plano velho, ou somado a duracao errada, a conta daqui divergiria.
--
-- A EVIDENCIA DE "UM PAGAMENTO = UMA RENOVACAO" e a secao 60: numero de linhas
-- `renovada` por lancamento pago. Tem que ser 1, sempre.
--
-- Para colar no SQL Editor, use db/conferencia/100_e2e_depois_LIMPO.sql
-- ===========================================================================

drop table if exists conf100;
create temp table conf100 (ordem int, alvo text, item text, valor text, resultado text);

do $$
declare
  v_dono   uuid;
  r        record;
  v_ass    public.comercial_assinaturas%rowtype;
  v_lanc   public.financeiro_lancamentos%rowtype;
  v_pl     public.comercial_planos%rowtype;
  v_pl_antigo public.comercial_planos%rowtype;
  v_prox   public.financeiro_lancamentos%rowtype;
  v_nome   text;

  v_de_plano  uuid;  v_para_plano uuid;
  v_de_valor  numeric; v_para_valor numeric;
  v_de_ini    date;  v_de_fim  date;
  v_para_ini  date;  v_para_fim date;
  v_consumiu  boolean;

  v_atraso  int;
  v_esp_ini date;
  v_esp_fim date;
  v_n       int;
begin
  select o.proprietario_user_id into v_dono
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  for r in
    select ca.*
      from public.comercial_assinatura_auditoria ca
     where ca.acao = 'renovada'
     order by ca.criado_em desc
     limit 4
  loop
    v_de_plano   := nullif(r.antes  ->> 'plano_id', '')::uuid;
    v_para_plano := nullif(r.depois ->> 'plano_id', '')::uuid;
    v_de_valor   := nullif(r.antes  ->> 'valor_contratado', '')::numeric;
    v_para_valor := nullif(r.depois ->> 'valor_contratado', '')::numeric;
    v_de_ini     := nullif(r.antes  ->> 'inicio_periodo', '')::date;
    v_de_fim     := nullif(r.antes  ->> 'fim_periodo', '')::date;
    v_para_ini   := nullif(r.depois ->> 'inicio_periodo', '')::date;
    v_para_fim   := nullif(r.depois ->> 'fim_periodo', '')::date;
    v_consumiu   := (r.depois ->> 'renovacao_consumida')::boolean;

    select * into v_ass  from public.comercial_assinaturas where id = r.assinatura_id;
    select * into v_lanc from public.financeiro_lancamentos where id = (r.depois ->> 'lancamento_id')::uuid;
    select * into v_pl   from public.comercial_planos where id = v_para_plano;
    select p.nome into v_nome from public.pacientes p where p.id = v_ass.paciente_id;

    v_nome := coalesce(v_nome, '(sem nome)') ||
              case when v_consumiu then ' [cenario 2]' else ' [cenario 1]' end;

    -- ═══════════ O PAGAMENTO ═══════════
    insert into conf100 values (10, v_nome, 'lancamento — status', coalesce(v_lanc.status, '(sumiu)'),
      case when v_lanc.status = 'pago' then 'OK (pendente -> pago)' else 'FALHOU' end);
    insert into conf100 values (11, v_nome, 'lancamento — pago_em', coalesce(v_lanc.pago_em::text, '(nulo)'),
      case when v_lanc.pago_em is not null then 'OK' else 'FALHOU (pago sem data)' end);
    insert into conf100 values (12, v_nome, 'lancamento — forma_pagamento', coalesce(v_lanc.forma_pagamento, '(nulo)'), '');
    insert into conf100 values (13, v_nome, 'lancamento — valor_pago', coalesce(v_lanc.valor_pago::text, '(nulo)'),
      case when v_lanc.valor_pago is null then 'CONFERIR (quitacao sem valor recebido)'
           when v_lanc.valor is not null and v_lanc.valor_pago < v_lanc.valor then 'FALHOU (parcial nao deveria passar)'
           else 'OK' end);

    -- ═══════════ O PLANO E O VALOR ═══════════
    insert into conf100 values (20, v_nome, 'plano',
      coalesce(v_de_plano::text, '(nulo)') || ' -> ' || coalesce(v_para_plano::text, '(nulo)'),
      case when v_consumiu and v_de_plano is distinct from v_para_plano then 'OK (trocou, como programado)'
           when not v_consumiu and v_de_plano is not distinct from v_para_plano then 'OK (nao trocou)'
           when v_consumiu then 'CONFERIR (consumiu intencao mas o plano nao mudou — pode ser troca so de valor)'
           else 'FALHOU (mudou de plano sem renovacao programada)' end);

    insert into conf100 values (21, v_nome, 'valor_contratado',
      coalesce(v_de_valor::text, '(nulo)') || ' -> ' || coalesce(v_para_valor::text, '(nulo)'),
      case when not v_consumiu and v_de_valor is not distinct from v_para_valor then 'OK (manteve)'
           when v_consumiu then 'OK (veio da programacao)'
           else 'FALHOU (valor mudou sem programacao)' end);

    insert into conf100 values (22, v_nome, 'a assinatura HOJE bate com o `depois` da auditoria',
      v_ass.plano_id::text || ' | ' || coalesce(v_ass.valor_contratado::text, '(nulo)')
      || ' | ' || v_ass.inicio_periodo || ' -> ' || v_ass.fim_periodo,
      case when v_ass.plano_id is not distinct from v_para_plano
            and v_ass.valor_contratado is not distinct from v_para_valor
            and v_ass.inicio_periodo = v_para_ini
            and v_ass.fim_periodo = v_para_fim
           then 'OK' else 'FALHOU (a linha divergiu da trilha)' end);

    -- ═══════════ A CONTA DO PERIODO, REFEITA POR FORA ═══════════
    -- Nao confere se "mudou": refaz a conta com a tolerancia e a duracao do
    -- plano que ENTROU e compara. Tolerancia do plano velho daria outro inicio.
    v_atraso := v_lanc.pago_em - v_de_fim;
    if v_atraso <= coalesce(v_pl.tolerancia_dias, 5) then
      v_esp_ini := v_de_fim;
    else
      v_esp_ini := v_lanc.pago_em;
    end if;
    if coalesce(v_pl.duracao_unidade, 'dia') = 'mes' then
      v_esp_fim := (v_esp_ini + (coalesce(v_pl.duracao_valor, 30) || ' months')::interval)::date;
    else
      v_esp_fim := v_esp_ini + coalesce(v_pl.duracao_valor, 30);
    end if;

    insert into conf100 values (30, v_nome, 'atraso do pagamento',
      v_atraso || ' dia(s) | tolerancia do plano que entrou: ' || coalesce(v_pl.tolerancia_dias::text, '5'),
      case when v_atraso <= coalesce(v_pl.tolerancia_dias, 5)
           then 'dentro da tolerancia' else 'fora da tolerancia' end);

    -- A TOLERANCIA FOI MESMO EXERCITADA? So da para afirmar que a regra "vale
    -- a do plano que ENTRA" foi provada E2E se os dois planos tiverem
    -- tolerancias DIFERENTES. Iguais, o teste passaria com qualquer uma das
    -- duas, e dizer que provou seria inventar prova.
    select * into v_pl_antigo from public.comercial_planos where id = v_de_plano;
    insert into conf100 values (34, v_nome, 'tolerancia — saiu x entrou',
      coalesce(v_pl_antigo.tolerancia_dias::text, '(sem plano)') || ' -> ' ||
      coalesce(v_pl.tolerancia_dias::text, '(sem plano)'),
      case when v_de_plano is not distinct from v_para_plano
             then 'NAO EXERCITADA (nao houve troca de plano)'
           when v_pl_antigo.tolerancia_dias is distinct from v_pl.tolerancia_dias
             then 'EXERCITADA (as duas diferem, e valeu a do que entrou)'
           else 'NAO EXERCITADA (os dois planos tem a mesma tolerancia)' end);

    -- E a duracao: mesma pergunta.
    insert into conf100 values (35, v_nome, 'duracao — saiu x entrou',
      coalesce(v_pl_antigo.duracao_valor::text, '?') || ' ' || coalesce(v_pl_antigo.duracao_unidade, '?') ||
      ' -> ' || coalesce(v_pl.duracao_valor::text, '?') || ' ' || coalesce(v_pl.duracao_unidade, '?'),
      case when v_de_plano is not distinct from v_para_plano
             then 'NAO EXERCITADA (nao houve troca de plano)'
           when v_pl_antigo.duracao_valor is distinct from v_pl.duracao_valor
             then 'EXERCITADA (duracoes diferentes, e valeu a do que entrou)'
           else 'NAO EXERCITADA (os dois planos tem a mesma duracao)' end);

    insert into conf100 values (31, v_nome, 'inicio_periodo — esperado x gravado',
      v_esp_ini::text || ' x ' || v_para_ini::text,
      case when v_esp_ini = v_para_ini then 'OK' else 'FALHOU (tolerancia do plano errado?)' end);

    insert into conf100 values (32, v_nome, 'fim_periodo — esperado x gravado',
      v_esp_fim::text || ' x ' || v_para_fim::text,
      case when v_esp_fim = v_para_fim then 'OK (duracao do plano que entrou)' else 'FALHOU' end);

    -- Avancou UMA vez: o periodo novo comeca onde o velho terminava, ou na
    -- data do pagamento. Nunca dois periodos de distancia.
    insert into conf100 values (33, v_nome, 'avancou exatamente um periodo',
      v_de_ini::text || ' -> ' || v_de_fim::text || '  vira  ' || v_para_ini::text || ' -> ' || v_para_fim::text,
      case when v_para_ini in (v_de_fim, v_lanc.pago_em) then 'OK'
           else 'FALHOU (o inicio novo nao e o fim velho nem a data do pagamento)' end);

    -- A PROVA DE QUE NAO FORAM DOIS PERIODOS. O periodo novo tem exatamente a
    -- duracao do plano que entrou — nem o dobro, nem uma soma acumulada. Dizer
    -- "mudou" nao basta; isto mostra o tamanho.
    insert into conf100 values (36, v_nome, 'tamanho do periodo novo, em dias',
      (v_para_fim - v_para_ini)::text || ' | duracao do plano: ' ||
      coalesce(v_pl.duracao_valor::text, '30') || ' ' || coalesce(v_pl.duracao_unidade, 'dia'),
      case when coalesce(v_pl.duracao_unidade, 'dia') = 'dia'
            and (v_para_fim - v_para_ini) = coalesce(v_pl.duracao_valor, 30)
             then 'OK (um periodo, nao dois)'
           when coalesce(v_pl.duracao_unidade, 'dia') = 'mes'
             then 'conferir a olho: plano em meses calendario'
           else 'FALHOU (o periodo nao tem a duracao do plano)' end);

    -- ═══════════ A INTENCAO FOI CONSUMIDA ═══════════
    insert into conf100 values (40, v_nome, 'as cinco colunas depois do pagamento',
      coalesce(v_ass.proximo_plano_id::text, 'null') || ' | ' ||
      coalesce(v_ass.proximo_valor_contratado::text, 'null') || ' | ' ||
      coalesce(v_ass.renovacao_definida_em::text, 'null') || ' | ' ||
      coalesce(v_ass.renovacao_definida_por::text, 'null') || ' | ' ||
      coalesce(v_ass.renovacao_origem_id::text, 'null'),
      case when v_ass.proximo_plano_id is null and v_ass.proximo_valor_contratado is null
            and v_ass.renovacao_definida_em is null and v_ass.renovacao_definida_por is null
            and v_ass.renovacao_origem_id is null
           then 'OK (nenhuma intencao sobreviveu)' else 'FALHOU' end);

    insert into conf100 values (41, v_nome, 'renovacao_consumida', v_consumiu::text, '');

    -- ═══════════ A AUDITORIA: AUTOR E DONO ═══════════
    -- §13: o autor tem que ser a PESSOA que registrou o pagamento, e o dono a
    -- organizacao. Se os dois viessem iguais por acidente de codigo, a trilha
    -- deixaria de responder "quem fez".
    insert into conf100 values (44, v_nome, 'auditoria — acao', r.acao,
      case when r.acao = 'renovada' then 'OK' else 'FALHOU' end);
    insert into conf100 values (45, v_nome, 'auditoria — autor (usuario_id)',
      coalesce(r.usuario_id::text, '(nulo)'),
      case when r.usuario_id is null then 'FALHOU (pagamento sem autor)'
           when r.usuario_id = v_dono then 'OK (o proprietario registrou)'
           else 'OK (outra conta: ' || left(r.usuario_id::text, 8) || ')' end);
    insert into conf100 values (46, v_nome, 'auditoria — dono (nutri_id)',
      coalesce(r.nutri_id::text, '(nulo)'),
      case when r.nutri_id = v_ass.nutri_id then 'OK (a organizacao da assinatura)' else 'FALHOU' end);
    insert into conf100 values (47, v_nome, 'auditoria — antes',  r.antes::text,  '');
    insert into conf100 values (48, v_nome, 'auditoria — depois', r.depois::text, '');

    -- ═══════════ A PROXIMA COBRANCA ═══════════
    select * into v_prox from public.financeiro_lancamentos
     where assinatura_id = v_ass.id and vencimento = v_para_fim and status <> 'cancelado'
     limit 1;

    insert into conf100 values (50, v_nome, 'proxima cobranca',
      coalesce(v_prox.id::text, '(nenhuma)'),
      case when v_ass.renovacao_automatica and v_prox.id is not null then 'OK (nasceu, como manda renovacao_automatica)'
           when v_ass.renovacao_automatica and v_prox.id is null then 'FALHOU (deveria ter nascido)'
           when not v_ass.renovacao_automatica and v_prox.id is null then 'OK (renovacao_automatica desligada)'
           else 'FALHOU (nasceu com renovacao_automatica desligada)' end);

    if v_prox.id is not null then
      insert into conf100 values (51, v_nome, 'proxima — vencimento, valor, status',
        v_prox.vencimento::text || ' | ' || coalesce(v_prox.valor::text, '(nulo)') || ' | ' || v_prox.status,
        case when v_prox.vencimento = v_para_fim
              and v_prox.valor is not distinct from v_para_valor
              and v_prox.status = 'pendente'
             then 'OK (periodo NOVO, valor NOVO, pendente)' else 'FALHOU' end);
      -- §12 pede a competencia explicitamente: e o mes do periodo, dia 1o.
      insert into conf100 values (53, v_nome, 'proxima — competencia',
        coalesce(v_prox.competencia::text, '(nula)'),
        case when v_prox.competencia = date_trunc('month', v_prox.vencimento)::date
             then 'OK (dia 1o do mes do vencimento)' else 'FALHOU' end);
      insert into conf100 values (54, v_nome, 'proxima — id e criada em',
        left(v_prox.id::text, 8) || ' | ' || to_char(v_prox.criado_em, 'DD/MM HH24:MI:SS'), '');
    end if;

    -- §12: quantas cobrancas a assinatura tem AGORA. Compare com o item 40 da
    -- conferencia 99 — a diferenca tem que ser exatamente 1 (a proxima), ou 0
    -- se `renovacao_automatica` estiver desligada.
    select count(*) into v_n from public.financeiro_lancamentos where assinatura_id = v_ass.id;
    insert into conf100 values (55, v_nome, 'cobrancas da assinatura AGORA', v_n::text,
      case when v_ass.renovacao_automatica then 'esperado: o numero da 99 + 1'
           else 'esperado: o mesmo numero da 99' end);

    select count(*) into v_n from public.financeiro_lancamentos
     where assinatura_id = v_ass.id and vencimento = v_para_fim and status <> 'cancelado';
    insert into conf100 values (52, v_nome, 'proxima cobranca duplicada?', v_n::text,
      case when v_n <= 1 then 'OK' else 'FALHOU (duas cobrancas vivas no mesmo vencimento)' end);
  end loop;

  -- ═══════════ UM PAGAMENTO = UMA RENOVACAO ═══════════
  -- A evidencia central. Uma linha `renovada` por lancamento pago; duas
  -- significariam que o periodo andou duas vezes com um pagamento so.
  for r in
    select depois ->> 'lancamento_id' as lanc, count(*) as n
      from public.comercial_assinatura_auditoria
     where acao = 'renovada' and depois ? 'lancamento_id'
     group by 1
     order by 2 desc, 1
  loop
    insert into conf100 values (60, 'TODOS', 'renovacoes por lancamento ' || left(r.lanc, 8), r.n::text,
      case when r.n = 1 then 'OK' else 'FALHOU — DUPLA RENOVACAO' end);
  end loop;

  select count(*) into v_n from (
    select depois ->> 'lancamento_id'
      from public.comercial_assinatura_auditoria
     where acao = 'renovada' and depois ? 'lancamento_id'
     group by 1 having count(*) > 1) x;
  insert into conf100 values (61, 'TODOS', '~ lancamentos renovados mais de uma vez', v_n::text,
    case when v_n = 0 then 'OK (um pagamento = uma renovacao)' else 'FALHOU' end);

  select count(*) into v_n from public.comercial_assinaturas a
   where a.proximo_plano_id is not null
     and exists (select 1 from public.financeiro_lancamentos l
                  where l.id = a.renovacao_origem_id and l.status = 'pago');
  insert into conf100 values (62, 'TODOS', 'intencao viva com a cobranca de origem paga', v_n::text,
    case when v_n = 0 then 'OK' else 'FALHOU (intencao sobreviveu ao pagamento)' end);

  select count(*) into v_n from public.comercial_assinatura_auditoria where acao = 'renovada';
  insert into conf100 values (63, 'TODOS', 'eventos `renovada` no total', v_n::text,
    case when v_n = 0 then 'PARE: nenhum pagamento foi registrado ainda' else '' end);
end $$;

insert into conf100
select 999, 'VEREDITO',
  case when exists (select 1 from conf100 where resultado like 'FALHOU%' or resultado like 'PARE%')
       then 'HA FALHAS — nao declarar validado'
       when exists (select 1 from conf100 where resultado like 'CONFERIR%')
       then 'PASSOU — conferir os pontos marcados'
       else 'E2E PASSOU — um pagamento, uma renovacao' end,
  coalesce((select string_agg(distinct item, ', ') from conf100
             where resultado like 'FALHOU%' or resultado like 'PARE%'
                or resultado like 'CONFERIR%'), 'nada a apontar'),
  '';

select ordem, alvo, item, valor, resultado from conf100 order by alvo, ordem, item;
