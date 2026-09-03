-- ===========================================================================
-- AS FOLHAS E SUAS COMPETENCIAS — antes de renomear qualquer uma
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- POR QUE ESTE SCRIPT EXISTE. Em 03/09/2026 apareceu a suspeita de que a folha
-- chamada "Agosto" e na verdade o pagamento de JULHO, e a chamada "Setembro" e
-- a de agosto. Mover o rotulo de folha FECHADA e coisa seria, e antes de fazer
-- e preciso responder tres perguntas que so o dado responde.
--
-- ===========================================================================
-- 1. O DESLOCAMENTO E RECENTE OU E A CONVENCAO DE SEMPRE?
-- ---------------------------------------------------------------------------
-- Se TODA folha do historico paga o mes anterior, entao nada esta errado: e o
-- jeito como a casa sempre nomeou, e renomear duas quebraria a serie inteira.
-- Se so as duas ultimas estao deslocadas, e engano recente e tem conserto.
--
-- A coluna `data_pagamento` e a prova mais forte: folha paga em 05/08 quase
-- certamente cobre julho. A secao HISTORICO mostra as duas lado a lado.
--
-- ===========================================================================
-- 2. O QUE MAIS ANDA JUNTO COM A COMPETENCIA
-- ---------------------------------------------------------------------------
-- `folhas.competencia` nao esta sozinha. A mesma data aparece em:
--
--   colaborador_documentos.competencia   contracheque e folha de ponto
--   documentos_pendentes.competencia     arquivo ainda sem dono
--   caminho_storage                      o caminho FISICO do arquivo tem
--                                        {AAAA-MM} dentro dele
--
-- Renomear so a folha deixaria o contracheque de "agosto" arquivado em agosto
-- enquanto a folha vira julho. O colaborador abriria o mes e nao acharia o
-- proprio holerite.
--
-- O Financeiro NAO precisa de conserto: ele LE a folha para compor o custo do
-- mes, nunca copia (js/folha.js, cabecalho). Mover a folha move o custo junto.
--
-- ===========================================================================
-- 3. A COLISAO
-- ---------------------------------------------------------------------------
-- `uniq_folhas_competencia` e `(nutri_id, competencia)`. Se julho ja existe,
-- agosto NAO pode virar julho num `update` direto — ou o julho atual tambem
-- esta deslocado e a correcao e uma CADEIA, ou ha conflito de verdade e duas
-- folhas disputam o mesmo mes.
--
-- Cadeia se resolve renomeando da mais ANTIGA para a mais nova, ou passando por
-- uma competencia temporaria. Conflito de verdade nao se resolve renomeando.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/115_competencia_das_folhas_LIMPO.sql
-- ===========================================================================

drop table if exists conf115;
create temp table conf115 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_org uuid;
  v_n   int;
  r     record;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  -- ═══════════ HISTORICO ═══════════
  -- Competencia, quando foi paga, e a distancia entre as duas. Uma folha que
  -- cobre o proprio mes e paga logo depois dele; uma que cobre o anterior e
  -- paga com mais de um mes de distancia da competencia.
  for r in
    select f.competencia, f.status, f.data_pagamento, f.criado_em::date as criada,
           (select count(*) from public.folha_itens i where i.folha_id = f.id) as itens,
           (select coalesce(sum(i.valor_base), 0) from public.folha_itens i where i.folha_id = f.id) as base,
           case when f.data_pagamento is null then null
                else (f.data_pagamento - f.competencia) end as dias_ate_pagar
      from public.folhas f
     where f.nutri_id = v_org
     order by f.competencia desc
     limit 18
  loop
    insert into conf115 values (10, 'HISTORICO', to_char(r.competencia, 'YYYY-MM'),
      r.status
      || ' | itens ' || r.itens
      || ' | base R$ ' || to_char(r.base, 'FM999G990D00')
      || ' | pago em ' || coalesce(r.data_pagamento::text, '—')
      || ' | criada ' || r.criada,
      case when r.dias_ate_pagar is null then 'sem data de pagamento'
           when r.dias_ate_pagar between 1 and 40  then 'pagou o PROPRIO mes'
           when r.dias_ate_pagar between 41 and 75 then 'pagou o mes ANTERIOR'
           when r.dias_ate_pagar > 75              then 'mais de dois meses de distancia'
           else 'paga ANTES da competencia' end);
  end loop;

  -- O padrao da casa, em uma linha. Se a maioria diz a mesma coisa, e a
  -- convencao; se as duas ultimas destoam, e engano recente.
  select count(*) into v_n
    from public.folhas f
   where f.nutri_id = v_org and f.data_pagamento is not null
     and (f.data_pagamento - f.competencia) between 41 and 75;
  insert into conf115 values (11, 'PADRAO', 'folhas que pagam o mes ANTERIOR', v_n::text, '');

  select count(*) into v_n
    from public.folhas f
   where f.nutri_id = v_org and f.data_pagamento is not null
     and (f.data_pagamento - f.competencia) between 1 and 40;
  insert into conf115 values (11, 'PADRAO', 'folhas que pagam o PROPRIO mes', v_n::text,
    'se este for a maioria, o deslocamento das duas ultimas e engano');

  -- ═══════════ A COLISAO ═══════════
  for r in
    select unnest(array['2026-07-01','2026-08-01','2026-09-01']::date[]) as comp
  loop
    select count(*) into v_n from public.folhas
     where nutri_id = v_org and competencia = r.comp;
    insert into conf115 values (20, 'COLISAO', to_char(r.comp, 'YYYY-MM'),
      case when v_n > 0 then 'JA EXISTE' else 'livre' end,
      case when v_n > 0 then 'renomear para ca esbarra no indice unico' else '' end);
  end loop;

  -- ═══════════ O QUE ANDA JUNTO ═══════════
  for r in
    select d.competencia,
           count(*) filter (where d.tipo_documento = 'contracheque') as contracheques,
           count(*) filter (where d.tipo_documento = 'folha_ponto')  as pontos,
           count(*) as total
      from public.colaborador_documentos d
     where d.nutri_id = v_org
       and d.competencia >= date '2026-06-01'
     group by d.competencia
     order by d.competencia desc
  loop
    insert into conf115 values (30, 'DOCUMENTOS', to_char(r.competencia, 'YYYY-MM'),
      r.total || ' documento(s) — ' || r.contracheques || ' contracheque(s), ' || r.pontos || ' ponto(s)',
      'seguem a folha se ela for renomeada');
  end loop;

  select count(*) into v_n from public.documentos_pendentes
   where nutri_id = v_org and competencia >= date '2026-06-01';
  insert into conf115 values (31, 'DOCUMENTOS', 'pendentes sem dono', v_n::text, '');

  -- O caminho FISICO do arquivo carrega o mes. Renomear a linha sem mover o
  -- arquivo deixa os dois discordando — e quem busca pelo mes novo nao acha.
  for r in
    select (storage.foldername(o.name))[3] as mes, count(*) as arquivos
      from storage.objects o
     where o.bucket_id = 'colaborador-documentos'
       and (storage.foldername(o.name))[3] >= '2026-06'
     group by 1
     order by 1 desc
  loop
    insert into conf115 values (40, 'ARQUIVOS NO STORAGE', coalesce(r.mes, '(sem mes)'),
      r.arquivos || ' arquivo(s)',
      'o mes esta no CAMINHO — renomear a linha nao move o arquivo');
  end loop;

  -- ═══════════ O QUE O COLABORADOR ENXERGA ═══════════
  -- Contracheque ja disponibilizado e a parte visivel: se ele mudar de mes, a
  -- pessoa que ja abriu vai procurar onde nao esta mais.
  select count(*) into v_n
    from public.colaborador_documentos
   where nutri_id = v_org
     and competencia in (date '2026-08-01', date '2026-09-01')
     and tipo_documento = 'contracheque'
     and status = 'disponivel';
  insert into conf115 values (50, 'JA PUBLICADO', 'contracheques visiveis em ago/set', v_n::text,
    case when v_n = 0 then 'ninguem viu ainda — renomear e barato'
         else 'o colaborador ja pode ter aberto estes' end);

  select count(*) into v_n
    from public.colaborador_documentos
   where nutri_id = v_org
     and competencia in (date '2026-08-01', date '2026-09-01')
     and visualizado_pelo_colaborador;
  insert into conf115 values (51, 'JA PUBLICADO', 'ja abertos pelo colaborador', v_n::text,
    case when v_n = 0 then 'nenhum foi aberto' else 'estes alguem ja leu' end);
end $$;

select ordem, secao, item, valor, resultado from conf115 order by ordem, item desc;
