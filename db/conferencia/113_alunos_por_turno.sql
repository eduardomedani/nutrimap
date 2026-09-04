-- ===========================================================================
-- ALUNOS ATIVOS POR TURNO — a conta do bonus da folha
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- POR QUE ESTE SCRIPT EXISTE. O fechamento da folha vai passar a mostrar
-- quantos alunos ativos cada turno tem, e a virar bonus de R$ 10 por aluno no
-- contracheque. Antes de escrever tela nenhuma, este script CALCULA o numero
-- com as regras pedidas e MOSTRA QUEM FICOU DE FORA E POR QUE — porque um
-- numero que vira dinheiro tem que ser conferivel contra a realidade.
--
-- AS REGRAS, como foram entendidas:
--
--   . conta aluno com assinatura ATIVA na data de referencia;
--   . NAO conta quem tem mais de 10% de desconto sobre o preco do plano;
--   . NAO conta quem estava com a mensalidade VENCIDA na data de referencia.
--
-- ===========================================================================
-- TRES COISAS QUE ESTE SCRIPT PRECISA RESPONDER ANTES DE VIRAR CODIGO
-- ---------------------------------------------------------------------------
-- 1. O QUE ESTA ESCRITO NO CAMPO `horario`. Ele e TEXTO LIVRE — o formulario
--    sugere "Diurno" e "Noturno" num datalist, mas aceita qualquer coisa. O
--    pedido fala em "manha" e "matutinos". Se o banco disser "Diurno", e
--    preciso decidir se Diurno = manha ou se Diurno inclui a tarde. A secao
--    TURNOS mostra o que existe de verdade, com quantos em cada.
--
-- 2. SE O DESCONTO E CALCULAVEL. Ele nao e uma coluna: sai da diferenca entre
--    `assinatura.valor_contratado` e `plano.preco_padrao`. Assinatura sem
--    valor contratado usa o preco do plano (desconto zero); plano sem preco
--    padrao nao permite calcular desconto NENHUM, e essas linhas aparecem na
--    secao SEM BASE DE CALCULO.
--
-- 3. QUANTO O RETROATIVO CUSTA. `fim_periodo` e o periodo VIGENTE, e ele anda
--    a cada renovacao. Perguntar hoje "quem estava vencido em 31/08" usando o
--    `fim_periodo` de hoje da a resposta errada para quem renovou depois: a
--    pessoa aparece em dia. A secao RETROATIVO mede quantas assinaturas
--    andaram desde a data de referencia — se for zero, a conta de hoje vale
--    para a data pedida.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/113_alunos_por_turno_LIMPO.sql
-- ===========================================================================

drop table if exists conf113;
drop table if exists reb113;
create temp table conf113 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_org  uuid;
  v_n    int;
  r      record;
  -- A data em que a pergunta e feita: o ultimo dia da competencia.
  v_ref  constant date := date '2026-08-31';
  -- Acima disto o aluno nao entra na contagem.
  v_teto constant numeric := 0.10;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  -- ═══════ 0) A FOTO DE v_ref, RECONSTRUIDA ═══════
  -- Ate 03/09/2026 este script lia o estado de HOJE e o chamava de foto do dia
  -- 31/08. Nao e a mesma coisa: quem renovou em setembro tem fim_periodo novo e
  -- passa no filtro ">= 31/08" mesmo se naquele dia estivesse vencido. A secao
  -- RETROATIVO ja avisava disso — mas avisar nao e conferir, e o script
  -- terminava discordando da tela que ele deveria estar conferindo.
  --
  -- Agora reb113 rebobina, do mesmo jeito que comercial_alunos_por_turno: a
  -- renovacao mais ANTIGA registrada depois de v_ref guarda no seu "antes" como
  -- a assinatura estava naquele dia. Com ela os numeros daqui batem com o
  -- painel — e a secao REBOBINAGEM mostra o tamanho da diferenca em vez de
  -- deixa-la escondida.
  create temp table reb113 as
  select
    a.id                                      as assinatura_id,
    pa.nome                                   as aluno,
    coalesce(trim(a.horario), '')             as turno,
    coalesce((h.antes ->> 'fim_periodo')::date, a.fim_periodo)              as fim_periodo,
    a.fim_periodo                                                          as fim_hoje,
    a.inicio_periodo                                                       as inicio_hoje,
    coalesce((h.antes ->> 'valor_contratado')::numeric, a.valor_contratado) as valor_contratado,
    pl.nome                                   as plano,
    pl.preco_padrao,
    case when pl.preco_padrao > 0
         then 1 - coalesce(
                    coalesce((h.antes ->> 'valor_contratado')::numeric, a.valor_contratado),
                    pl.preco_padrao) / pl.preco_padrao
    end                                       as desconto,
    (h.antes is not null)                     as rebobinada,
    (a.data_inicio_original is not null and a.data_inicio_original > v_ref) as comecou_depois
  from public.comercial_assinaturas a
  join public.pacientes pa on pa.id = a.paciente_id
  left join lateral (
    select ad.antes
      from public.comercial_assinatura_auditoria ad
     where ad.assinatura_id = a.id
       and ad.acao = 'renovada'
       and ad.criado_em::date > v_ref
     order by ad.criado_em
     limit 1
  ) h on true
  left join public.comercial_planos pl
         on pl.id = coalesce((h.antes ->> 'plano_id')::uuid, a.plano_id)
  where a.nutri_id = v_org
    and a.status = 'ativa';

  insert into conf113 values (0, 'PARAMETROS', 'data de referencia', v_ref::text, '');
  insert into conf113 values (0, 'PARAMETROS', 'desconto maximo aceito',
    (v_teto * 100) || '%', 'acima disto nao conta');

  -- ═══════════ 1) O QUE HA NO CAMPO horario ═══════════
  for r in
    select coalesce(nullif(trim(a.horario), ''), '(em branco)') as turno,
           count(*) as quantos
      from public.comercial_assinaturas a
     where a.nutri_id = v_org
       and a.status = 'ativa'
     group by 1
     order by count(*) desc
  loop
    insert into conf113 values (10, 'TURNOS', r.turno, r.quantos || ' assinatura(s) ativa(s)',
      case when r.turno = '(em branco)' then 'sem turno — nao entra em nenhuma contagem'
           else '' end);
  end loop;

  -- Grafias que so diferem por caixa ou acento viram turnos diferentes na
  -- contagem. Se aparecer aqui, o campo precisa ser normalizado antes.
  select count(*) into v_n
    from (select lower(trim(a.horario)) as t
            from public.comercial_assinaturas a
           where a.nutri_id = v_org and a.status = 'ativa'
             and coalesce(trim(a.horario), '') <> ''
           group by 1) x;
  insert into conf113 values (11, 'TURNOS', 'grafias distintas (minusculas)', v_n::text,
    case when v_n <= 2 then 'OK — da para contar sem normalizar'
         else 'ATENCAO — mais de dois turnos escritos' end);

  -- ═══════════ 2) A BASE DO DESCONTO ═══════════
  for r in
    select p.nome, p.preco_padrao,
           (select count(*) from public.comercial_assinaturas a
             where a.plano_id = p.id and a.status = 'ativa') as ativas
      from public.comercial_planos p
     where p.nutri_id = v_org and p.ativo
     order by p.nome
  loop
    insert into conf113 values (20, 'PLANOS', r.nome,
      'preco padrao ' || coalesce(r.preco_padrao::text, 'NULO') || ' | ' || r.ativas || ' ativa(s)',
      case when r.preco_padrao is null or r.preco_padrao = 0
           then 'SEM BASE — nao da para calcular desconto' else 'OK' end);
  end loop;

  select count(*) into v_n
    from public.comercial_assinaturas a
    left join public.comercial_planos p on p.id = a.plano_id
   where a.nutri_id = v_org and a.status = 'ativa'
     and (p.preco_padrao is null or p.preco_padrao = 0);
  insert into conf113 values (21, 'SEM BASE DE CALCULO', 'assinaturas ativas sem preco de plano', v_n::text,
    case when v_n = 0 then 'OK' else 'estas nao podem ser avaliadas por desconto' end);

  -- ═══════════ 3) O CUSTO DO RETROATIVO ═══════════
  -- Assinatura cujo periodo COMECOU depois da data de referencia ja renovou
  -- desde entao: o `fim_periodo` de hoje nao diz como ela estava naquele dia.
  select count(*) into v_n
    from public.comercial_assinaturas a
   where a.nutri_id = v_org and a.status = 'ativa'
     and a.inicio_periodo > v_ref;
  insert into conf113 values (30, 'RETROATIVO', 'assinaturas que renovaram apos ' || v_ref, v_n::text,
    case when v_n = 0 then 'OK — a foto de hoje vale para a data pedida'
         else 'a contagem de hoje difere da que valia naquele dia' end);

  select count(*) into v_n from public.comercial_assinatura_auditoria
   where criado_em::date > v_ref;
  insert into conf113 values (31, 'RETROATIVO', 'renovacoes registradas apos ' || v_ref, v_n::text,
    'a auditoria guarda o periodo anterior — da para reconstruir se precisar');

  -- ═══════════ 4) A CONTAGEM ═══════════
  for r in
    select b.turno, count(*) as contam
      from reb113 b
     where b.turno <> ''
       and not b.comecou_depois
       and b.fim_periodo >= v_ref
       and b.preco_padrao > 0
       and b.desconto <= v_teto
     group by 1
     order by 1
  loop
    insert into conf113 values (40, 'CONTAGEM', r.turno, r.contam::text,
      'x R$ 10 = R$ ' || (r.contam * 10));
  end loop;

  -- ═══════ 4a) O QUE A REBOBINAGEM MUDOU ═══════
  -- A conta ingenua — a foto de hoje — ao lado da reconstruida. Se as duas
  -- baterem, a rebobinagem nao custou nada nesta data e tanto faz. Se
  -- diferirem, vale a reconstruida: e ela que o painel mostra.
  for r in
    select b.turno,
           count(*) filter (
             where b.fim_hoje >= v_ref and b.preco_padrao > 0 and b.desconto <= v_teto
           ) as ingenua,
           count(*) filter (
             where b.fim_periodo >= v_ref and not b.comecou_depois
               and b.preco_padrao > 0 and b.desconto <= v_teto
           ) as reconstruida
      from reb113 b
     where b.turno <> ''
     group by 1
     order by 1
  loop
    insert into conf113 values (41, 'REBOBINAGEM', r.turno,
      'foto de hoje ' || r.ingenua || ' | reconstruida ' || r.reconstruida,
      case when r.ingenua = r.reconstruida then 'iguais — a data nao pesou aqui'
           else 'diferenca de ' || abs(r.ingenua - r.reconstruida)
                || ' — vale a RECONSTRUIDA, que e a do painel' end);
  end loop;

  select count(*) into v_n from reb113 where rebobinada;
  insert into conf113 values (41, 'REBOBINAGEM', 'assinaturas reconstruidas pela auditoria', v_n::text,
    case when v_n = 0 then 'nenhuma renovou depois da data'
         else 'estas voltaram ao estado de ' || v_ref end);

  -- ═══════ 4b) O ALUNO QUE PAGOU DEPOIS — MAS PAGOU AQUELE DIA ═══════
  -- Aqui mora a pergunta que decide o bonus, e ela nao e tecnica.
  --
  -- A rebobinagem tira da contagem quem estava com a mensalidade vencida em
  -- v_ref. Muitos desses pagaram poucos dias depois. A questao e o que a
  -- renovacao COBRIU: se o periodo novo comeca onde o antigo terminou, o dia
  -- 31/08 ficou pago — com atraso, mas pago, e a pessoa nunca deixou de ser
  -- aluna. Se o periodo novo comeca na data do pagamento, houve um buraco de
  -- verdade e o dia 31/08 nao estava coberto por ninguem.
  --
  -- As duas leituras sao defensaveis. O que nao da e escolher sem olhar: sao
  -- R$ 10 por aluno, e a diferenca entre elas aparece na secao REBOBINAGEM.
  -- Tres desfechos, nao dois. A primeira versao desta secao so tinha "cobre" e
  -- "buraco", e por isso imprimiu "buraco de -30 dia(s)" em vinte e uma linhas:
  -- quem NUNCA renovou nao foi rebobinado, entao o periodo de hoje e o mesmo de
  -- v_ref e a subtracao da negativa. Numero negativo num campo chamado "buraco"
  -- e o script confessando que a pergunta nao cabia naquela linha. Essas pessoas
  -- nao pagaram atrasado — nao pagaram, e e outra conversa.
  for r in
    select b.aluno, b.turno, b.fim_periodo as fim_em_ref, b.inicio_hoje, b.fim_hoje,
           b.rebobinada,
           (b.rebobinada and b.inicio_hoje <= v_ref and b.fim_hoje >= v_ref) as cobre_a_data
      from reb113 b
     where b.turno <> ''
       and not b.comecou_depois
       and b.preco_padrao > 0
       and b.desconto <= v_teto
       and b.fim_periodo < v_ref
     order by 7 desc, 6 desc, b.aluno
  loop
    insert into conf113 values (42, 'VENCIDOS EM ' || v_ref, r.aluno,
      r.turno || ' | vencia ' || r.fim_em_ref
      || ' | periodo de hoje ' || r.inicio_hoje || ' a ' || r.fim_hoje,
      case when r.cobre_a_data
             then 'PAGOU ATRASADO — o periodo novo cobre ' || v_ref
           when not r.rebobinada
             then 'nao renovou ate hoje — saiu mesmo'
           else 'renovou, mas o periodo novo comeca em ' || r.inicio_hoje
                || ' — ' || v_ref || ' ficou descoberto' end);
  end loop;

  select count(*) into v_n
    from reb113 b
   where b.turno <> '' and not b.comecou_depois and b.preco_padrao > 0
     and b.desconto <= v_teto and b.fim_periodo < v_ref
     and b.rebobinada and b.inicio_hoje <= v_ref and b.fim_hoje >= v_ref;
  insert into conf113 values (43, 'VENCIDOS EM ' || v_ref, 'pagaram atrasado, e o periodo novo cobre ' || v_ref, v_n::text,
    case when v_n = 0 then 'nenhum — quem estava vencido ficou mesmo descoberto'
         else 'somando estes aos ' || (select coalesce(sum(valor::int), 0) from conf113 where secao = 'CONTAGEM')
              || ' da contagem, seriam ' || (v_n + (select coalesce(sum(valor::int), 0) from conf113 where secao = 'CONTAGEM'))
              || ' alunos — decisao sua, nao do script' end);

  -- ═══════════ 4b) ONDE O TETO CORTA ═══════════
  -- O teto passou de 20% para 10% em 03/09/2026. A pergunta que decide se a
  -- mudanca mexeu em alguem e simples: ha aluno na faixa ENTRE os dois?
  --
  -- A distribuicao inteira aparece para o teto ser escolhido olhando o dado, e
  -- nao no chute. Se houver um vale claro entre o desconto comum e a bolsa, o
  -- teto certo mora dentro dele — e qualquer valor ali dentro da o mesmo
  -- resultado, o que torna a regra estavel.
  for r in
    select case
             when d <= 0        then 'sem desconto'
             when d <= 0.05     then 'ate 5%'
             when d <= 0.10     then '5% a 10%'
             when d <= 0.20     then '10% a 20%   <- a faixa que mudou'
             when d <= 0.50     then '20% a 50%'
             else 'mais de 50%'
           end as faixa,
           count(*) as quantos,
           min(round(d * 100)) as menor,
           max(round(d * 100)) as maior
      from (
        select b.desconto as d
          from reb113 b
         where b.turno <> ''
           and not b.comecou_depois
           and b.preco_padrao > 0
           and b.fim_periodo >= v_ref
      ) x
     group by 1
     order by min(d)
  loop
    insert into conf113 values (35, 'FAIXAS DE DESCONTO', r.faixa,
      r.quantos || ' aluno(s) | de ' || r.menor || '% a ' || r.maior || '%',
      case when r.faixa like '10%%' then 'sairam quando o teto virou 10%'
           when r.menor > 10 then 'ja estavam fora com 20%'
           else 'contam' end);
  end loop;

  -- O numero que responde a pergunta sozinho.
  select count(*) into v_n
    from reb113 b
   where b.turno <> ''
     and not b.comecou_depois
     and b.preco_padrao > 0
     and b.fim_periodo >= v_ref
     and b.desconto > 0.10
     and b.desconto <= 0.20;
  insert into conf113 values (36, 'FAIXAS DE DESCONTO', 'afetados pela mudanca de 20% para 10%', v_n::text,
    case when v_n = 0 then 'NINGUEM — a regra ficou mais estrita e o numero nao mudou'
         else 'estes contavam com 20% e deixam de contar com 10%' end);

  -- ═══════════ 5) QUEM FICOU DE FORA, E POR QUE ═══════════
  -- E a secao que permite conferir contra a realidade. Sem ela o numero e um
  -- palpite com cara de verdade.
  for r in
    select b.aluno,
           coalesce(nullif(b.turno, ''), '(em branco)') as turno,
           b.fim_periodo,
           b.valor_contratado,
           b.preco_padrao,
           case
             when b.turno = ''                           then 'sem turno'
             when b.comecou_depois                       then 'comecou depois de ' || v_ref
             when b.preco_padrao is null or b.preco_padrao = 0 then 'plano sem preco padrao'
             when b.fim_periodo < v_ref                  then 'vencida em ' || v_ref
             when b.desconto > v_teto
                  then 'desconto de ' || round(b.desconto * 100) || '%'
             else null
           end as motivo
      from reb113 b
     order by 6, b.aluno
  loop
    if r.motivo is not null then
      insert into conf113 values (50, 'FORA DA CONTAGEM', r.aluno,
        r.turno || ' | vence ' || coalesce(r.fim_periodo::text, '-')
        || ' | contratado ' || coalesce(r.valor_contratado::text, '(preco do plano)')
        || ' de ' || coalesce(r.preco_padrao::text, '-'),
        r.motivo);
    end if;
  end loop;

  -- ═══════════ 6) OS TOTAIS, PARA FECHAR A CONTA ═══════════
  select count(*) into v_n from public.comercial_assinaturas
   where nutri_id = v_org and status = 'ativa';
  insert into conf113 values (60, 'TOTAIS', 'assinaturas ativas', v_n::text, '');

  select count(*) into v_n from conf113 where secao = 'FORA DA CONTAGEM';
  insert into conf113 values (60, 'TOTAIS', 'fora da contagem', v_n::text, '');

  select coalesce(sum(valor::int), 0) into v_n from conf113 where secao = 'CONTAGEM';
  insert into conf113 values (60, 'TOTAIS', 'entram na contagem', v_n::text,
    'bonus total se todos os turnos forem pagos: R$ ' || (v_n * 10));
end $$;

select ordem, secao, item, valor, resultado from conf113 order by ordem, resultado, item;
