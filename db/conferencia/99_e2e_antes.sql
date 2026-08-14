-- ===========================================================================
-- E2E — O RETRATO DE ANTES DO PAGAMENTO
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- Rodar ANTES de registrar o pagamento pela tela. O companheiro dele e
-- db/conferencia/100_e2e_depois.sql, que roda DEPOIS e confere.
--
-- ESCOLHA DO CLIENTE. Deixe `v_alvo` vazio e o script escolhe sozinho um
-- candidato para cada cenario; ou escreva o nome do cliente entre as aspas
-- para forcar. O nome escolhido aparece na secao ALVO — e ele que voce vai
-- abrir na tela.
--
--   CENARIO 1 -> assinatura com cobranca PENDENTE e SEM renovacao programada
--   CENARIO 2 -> assinatura com cobranca PENDENTE e COM renovacao programada
--                (voce cria essa programacao pela tela antes, no formulario
--                 "Criar cobranca do periodo", trocando o plano)
--
-- POR QUE GUARDAR TANTO CAMPO. O "depois" nao vai comparar com a sua memoria:
-- ele recalcula o periodo esperado a partir da auditoria e confere contra o
-- que ficou gravado. Este retrato existe para VOCE conferir a olho e para o
-- caso de a auditoria nao ter sido escrita — que ja seria a falha.
--
-- Para colar no SQL Editor, use db/conferencia/99_e2e_antes_LIMPO.sql
-- ===========================================================================

drop table if exists conf99;
create temp table conf99 (ordem int, cenario text, item text, valor text, resultado text);

do $$
declare
  v_alvo text := '';
  v_dono uuid;
  v_ass  public.comercial_assinaturas%rowtype;
  v_cob  public.financeiro_lancamentos%rowtype;
  v_pl   public.comercial_planos%rowtype;
  v_pn   public.comercial_planos%rowtype;
  v_nome text;
  v_n    int;
  v_cen  text;
  r      record;
begin
  select o.proprietario_user_id into v_dono
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  for v_cen in select unnest(array['1', '2']) loop
    v_ass := null; v_cob := null;

    select a.* into v_ass
      from public.comercial_assinaturas a
      join public.pacientes p on p.id = a.paciente_id
     where a.nutri_id = v_dono
       and a.status = 'ativa'
       and a.plano_id is not null
       and (v_alvo = '' or lower(p.nome) = lower(v_alvo))
       and (case when v_cen = '1' then a.proximo_plano_id is null
                                  else a.proximo_plano_id is not null end)
       and exists (select 1 from public.financeiro_lancamentos l
                    where l.assinatura_id = a.id and l.status = 'pendente')
     order by a.fim_periodo
     limit 1;

    if v_ass.id is null then
      insert into conf99 values (10, v_cen, 'ALVO', '(nenhum candidato)',
        case when v_cen = '1'
             then 'crie uma cobranca pela tela, SEM trocar o plano'
             else 'crie uma cobranca pela tela TROCANDO o plano' end);

      -- SUGESTAO DE COBAIA. Sem cobranca pendente no sistema, o E2E comeca um
      -- passo antes: criar a cobranca pela tela. Estas sao assinaturas prontas
      -- para receber uma — vencidas primeiro, que sao as que a tela ja mostra
      -- com o botao "Criar cobranca do periodo" em destaque.
      --
      -- Use CLIENTES DIFERENTES nos dois cenarios: so existe uma renovacao
      -- programada por assinatura, e a do cenario 2 sobrescreveria a do 1.
      for r in
        select p.nome, pl.nome as plano, a.valor_contratado,
               a.inicio_periodo, a.fim_periodo,
               (current_date - a.fim_periodo) as vencido_ha
          from public.comercial_assinaturas a
          join public.pacientes p             on p.id  = a.paciente_id
          left join public.comercial_planos pl on pl.id = a.plano_id
         where a.nutri_id = v_dono
           and a.status = 'ativa'
           and a.plano_id is not null
           and a.proximo_plano_id is null
           and not exists (select 1 from public.financeiro_lancamentos l
                            where l.assinatura_id = a.id and l.status = 'pendente')
         order by a.fim_periodo
         limit 5
      loop
        insert into conf99 values (12, v_cen, 'sugestao de cobaia', r.nome,
          coalesce(r.plano, '?') || ' | R$ ' || coalesce(r.valor_contratado::text, '?')
          || ' | periodo ' || r.inicio_periodo || ' -> ' || r.fim_periodo
          || case when r.vencido_ha > 0 then ' | vencido ha ' || r.vencido_ha || 'd' else '' end);
      end loop;
      continue;
    end if;

    select p.nome into v_nome from public.pacientes p where p.id = v_ass.paciente_id;
    select * into v_pl from public.comercial_planos where id = v_ass.plano_id;
    if v_ass.proximo_plano_id is not null then
      select * into v_pn from public.comercial_planos where id = v_ass.proximo_plano_id;
    else
      v_pn := null;
    end if;

    select * into v_cob
      from public.financeiro_lancamentos
     where assinatura_id = v_ass.id and status = 'pendente'
     order by vencimento limit 1;

    insert into conf99 values (10, v_cen, 'ALVO — abra este cliente na tela', v_nome, 'anote');
    insert into conf99 values (11, v_cen, 'assinatura_id', v_ass.id::text, '');
    insert into conf99 values (12, v_cen, 'plano_id', coalesce(v_ass.plano_id::text, '(nulo)'),
      coalesce(v_pl.nome, '') || ' | ' || coalesce(v_pl.duracao_valor::text, '?') || ' ' ||
      coalesce(v_pl.duracao_unidade, '?') || ' | tolerancia ' || coalesce(v_pl.tolerancia_dias::text, '?'));
    insert into conf99 values (13, v_cen, 'valor_contratado', coalesce(v_ass.valor_contratado::text, '(nulo)'), '');
    insert into conf99 values (14, v_cen, 'inicio_periodo', v_ass.inicio_periodo::text, '');
    insert into conf99 values (15, v_cen, 'fim_periodo', v_ass.fim_periodo::text, '');
    insert into conf99 values (16, v_cen, 'renovacao_automatica', v_ass.renovacao_automatica::text,
      case when v_ass.renovacao_automatica then 'a proxima cobranca DEVE nascer'
           else 'a proxima cobranca NAO deve nascer' end);

    insert into conf99 values (20, v_cen, 'cobranca pendente — id', coalesce(v_cob.id::text, '(nenhuma)'),
      case when v_cob.id is null then 'PARE: sem cobranca para pagar' else '' end);
    insert into conf99 values (21, v_cen, 'cobranca — vencimento', coalesce(v_cob.vencimento::text, '—'), '');
    insert into conf99 values (22, v_cen, 'cobranca — valor', coalesce(v_cob.valor::text, '—'), '');

    insert into conf99 values (30, v_cen, 'proximo_plano_id', coalesce(v_ass.proximo_plano_id::text, '(nulo)'),
      coalesce(v_pn.nome, '') ||
      case when v_pn.id is not null
           then ' | ' || v_pn.duracao_valor || ' ' || v_pn.duracao_unidade ||
                ' | tolerancia ' || v_pn.tolerancia_dias
           else '' end);
    insert into conf99 values (31, v_cen, 'proximo_valor_contratado', coalesce(v_ass.proximo_valor_contratado::text, '(nulo)'), '');
    insert into conf99 values (32, v_cen, 'renovacao_definida_em', coalesce(v_ass.renovacao_definida_em::text, '(nulo)'), '');
    insert into conf99 values (33, v_cen, 'renovacao_origem_id', coalesce(v_ass.renovacao_origem_id::text, '(nulo)'),
      case when v_ass.renovacao_origem_id is null then ''
           when v_ass.renovacao_origem_id = v_cob.id then 'OK — aponta para a cobranca que voce vai pagar'
           else 'ATENCAO: aponta para OUTRA cobranca' end);

    -- O que o cenario exige ANTES do pagamento.
    if v_cen = '1' then
      insert into conf99 values (35, v_cen, 'exigencia do cenario', 'renovacao programada = nenhuma',
        case when v_ass.proximo_plano_id is null then 'OK' else 'FALHOU' end);
    else
      insert into conf99 values (35, v_cen, 'exigencia do cenario', 'assinatura AINDA no plano atual',
        case when v_ass.proximo_plano_id is not null
              and v_ass.proximo_plano_id <> v_ass.plano_id
             then 'OK (o vigente nao mudou; a troca e so intencao)'
             else 'FALHOU' end);
    end if;

    select count(*) into v_n from public.financeiro_lancamentos where assinatura_id = v_ass.id;
    insert into conf99 values (40, v_cen, 'cobrancas da assinatura', v_n::text, 'o depois compara com este numero');

    select count(*) into v_n from public.comercial_assinatura_auditoria where assinatura_id = v_ass.id;
    insert into conf99 values (41, v_cen, 'linhas de auditoria da assinatura', v_n::text, 'o depois espera +1 (renovada)');

    -- A CONTA ESPERADA, feita aqui a mao, para voce conferir a olho. O script
    -- do depois refaz a mesma conta sozinho a partir da auditoria.
    insert into conf99 values (50, v_cen, 'plano que vai ENTRAR',
      coalesce(v_pn.nome, v_pl.nome),
      'duracao ' || coalesce(v_pn.duracao_valor, v_pl.duracao_valor) || ' ' ||
      coalesce(v_pn.duracao_unidade, v_pl.duracao_unidade) ||
      ' | tolerancia ' || coalesce(v_pn.tolerancia_dias, v_pl.tolerancia_dias));

    insert into conf99 values (51, v_cen, 'se pagar HOJE, periodo esperado',
      case when (current_date - v_ass.fim_periodo) <= coalesce(v_pn.tolerancia_dias, v_pl.tolerancia_dias)
           then v_ass.fim_periodo::text else current_date::text end
      || ' -> ' ||
      (case when (current_date - v_ass.fim_periodo) <= coalesce(v_pn.tolerancia_dias, v_pl.tolerancia_dias)
            then v_ass.fim_periodo else current_date end
       + coalesce(v_pn.duracao_valor, v_pl.duracao_valor))::text,
      case when (current_date - v_ass.fim_periodo) <= coalesce(v_pn.tolerancia_dias, v_pl.tolerancia_dias)
           then 'dentro da tolerancia: continua do termino anterior'
           else 'fora da tolerancia: conta da data do pagamento' end);
  end loop;
end $$;

select ordem, cenario, item, valor, resultado from conf99 order by cenario, ordem, item;
