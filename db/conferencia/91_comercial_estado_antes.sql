-- ===========================================================================
-- COMERCIAL — RETRATO DE HOJE, ANTES DE ATUALIZAR OS PAGAMENTOS
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- POR QUE ESTE SCRIPT EXISTE. O levantamento dos pagamentos que faltam foi
-- feito comparando a planilha "Vendas" de hoje com os DOIS seeds do
-- repositorio (db/financeiro_vendas_seed.sql e db/comercial_clientes_seed.sql).
-- Arquivo nao e banco: se alguem usou a tela desde a importacao, o banco andou
-- e o arquivo nao. Este retrato diz se os dois ainda contam a mesma historia.
--
-- COMO LER. Tres numeros decidem se o script de atualizacao pode rodar:
--
--   IMPORTACAO / ultima linha da planilha importada
--       esperado 2179. Se for maior, alguem ja lancou vendas mais novas e o
--       levantamento das 40 esta desatualizado.
--
--   ASSINATURAS / total
--       esperado 89. Diferente disso, o cadastro mudou desde o seed.
--
--   COBRANCAS / de assinatura
--       esperado 0. O seed do Comercial nao criou nenhuma cobranca de
--       proposito. Se houver alguma, o modulo ja esta em uso e a atualizacao
--       tem que respeitar o que ja existe.
--
-- A secao POR CLIENTE e a que se compara linha a linha com o levantamento: e
-- dela que sai "o app diz que o periodo termina em X".
--
-- Para colar no SQL Editor, use db/conferencia/91_comercial_estado_antes_LIMPO.sql
-- ===========================================================================

drop table if exists conf91;
create temp table conf91 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_dono uuid;
  v_n    int;
  v_txt  text;
  r      record;
begin
  select o.proprietario_user_id into v_dono
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  insert into conf91 values (1, 'IDENTIDADE', 'organizacao principal', v_dono::text, '');

  -- ═══════════ A IMPORTACAO DE VENDAS ═══════════
  select count(*) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and origem = 'vendas';
  insert into conf91 values (10, 'IMPORTACAO', 'receitas de origem vendas', v_n::text,
    case when v_n = 2177 then 'OK (igual ao seed)' else 'DIFERENTE do seed (2177)' end);

  select max(origem_linha) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and origem = 'vendas';
  insert into conf91 values (11, 'IMPORTACAO', 'ultima linha da planilha importada', v_n::text,
    case when v_n = 2179 then 'OK — a planilha de hoje vai ate 2211'
         when v_n > 2179 then 'JA ANDOU — refazer o levantamento'
         else 'ATRAS do esperado' end);

  select count(*) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and origem = 'vendas' and status = 'pendente';
  insert into conf91 values (12, 'IMPORTACAO', 'vendas ainda pendentes', v_n::text,
    case when v_n = 15 then 'OK (as 15 da conciliacao de 07/08/2026)'
         else 'diferente de 15 — ver db/vendas_sem_credito_no_extrato.sql' end);

  select to_char(coalesce(sum(valor), 0), 'FM999G999G990D00') into v_txt
    from public.financeiro_lancamentos
   where nutri_id = v_dono and origem = 'vendas' and status = 'pago';
  insert into conf91 values (13, 'IMPORTACAO', 'total ja lancado como recebido', 'R$ ' || v_txt, '');

  -- ═══════════ ASSINATURAS ═══════════
  select count(*) into v_n from public.comercial_assinaturas where nutri_id = v_dono;
  insert into conf91 values (20, 'ASSINATURAS', 'total', v_n::text,
    case when v_n = 89 then 'OK (igual ao seed)' else 'DIFERENTE do seed (89)' end);

  select count(*) into v_n from public.comercial_assinaturas
   where nutri_id = v_dono and status = 'ativa';
  insert into conf91 values (21, 'ASSINATURAS', 'ativas', v_n::text, '');

  select count(*) into v_n from public.comercial_assinaturas
   where nutri_id = v_dono and status = 'ativa' and fim_periodo < current_date;
  insert into conf91 values (22, 'ASSINATURAS', 'ativas e VENCIDAS hoje', v_n::text,
    'o levantamento esperava 39 antes da atualizacao');

  select count(*) into v_n from public.comercial_assinaturas
   where nutri_id = v_dono and atualizado_em > criado_em + interval '1 minute';
  insert into conf91 values (23, 'ASSINATURAS', 'ja editadas depois de criadas', v_n::text,
    case when v_n = 0 then 'OK (ninguem mexeu pela tela)'
         else 'ALGUEM JA USOU A TELA — conferir antes de atualizar' end);

  -- ═══════════ COBRANCAS ═══════════
  select count(*) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and assinatura_id is not null;
  insert into conf91 values (30, 'COBRANCAS', 'de assinatura', v_n::text,
    case when v_n = 0 then 'OK (o seed nao criou nenhuma)'
         else 'JA EXISTEM — a atualizacao tem que respeitar' end);

  select count(*) into v_n from public.financeiro_lancamentos
   where nutri_id = v_dono and assinatura_id is not null and status = 'pendente';
  insert into conf91 values (31, 'COBRANCAS', 'em aberto', v_n::text, '');

  -- ═══════════ POR CLIENTE ═══════════
  -- Uma linha por assinatura viva. E esta secao que se compara, nome a nome,
  -- com a tabela do levantamento.
  for r in
    select p.nome,
           coalesce(pl.nome, '(sem plano)') as plano,
           a.valor_contratado,
           a.inicio_periodo,
           a.fim_periodo,
           a.status,
           (a.fim_periodo - current_date) as dias,
           (select count(*) from public.financeiro_lancamentos l
             where l.assinatura_id = a.id)                        as cobrancas
      from public.comercial_assinaturas a
      join public.pacientes p            on p.id  = a.paciente_id
      left join public.comercial_planos pl on pl.id = a.plano_id
     where a.nutri_id = v_dono
       and a.status in ('ativa', 'pausada', 'aguardando_inicio')
     order by a.fim_periodo, p.nome
  loop
    insert into conf91 values (40, 'POR CLIENTE', r.nome,
      r.plano
      || ' | R$ ' || to_char(coalesce(r.valor_contratado, 0), 'FM999G990D00')
      || ' | ' || r.inicio_periodo || ' -> ' || r.fim_periodo
      || ' | ' || r.status
      || ' | cobrancas: ' || r.cobrancas,
      case when r.dias < 0 then 'VENCIDO ha ' || (-r.dias) || 'd'
           when r.dias = 0 then 'vence hoje'
           else 'vence em ' || r.dias || 'd' end);
  end loop;
end $$;

insert into conf91
select 999, 'VEREDITO',
  case when exists (select 1 from conf91
                     where resultado like 'DIFERENTE%'
                        or resultado like 'JA %'
                        or resultado like 'ATRAS%')
       then 'O BANCO ANDOU — refazer o levantamento antes de atualizar'
       else 'BANCO IGUAL AOS SEEDS — pode atualizar' end,
  coalesce((select string_agg(distinct item, ', ') from conf91
             where resultado like 'DIFERENTE%'
                or resultado like 'JA %'
                or resultado like 'ATRAS%'), 'nada a apontar'),
  '';

select ordem, secao, item, valor, resultado from conf91 order by ordem, item;
