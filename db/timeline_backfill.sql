-- ===========================================================================
-- NutriMap · Timeline do Paciente — CARGA INICIAL (backfill)
-- ---------------------------------------------------------------------------
-- Rodar DEPOIS de db/timeline_schema.sql, em uma execucao separada: no SQL
-- Editor do Supabase um INSERT na tabela criada no MESMO lote falha com
-- "relation does not exist".
--
-- Nao reconstroi alteracoes que nunca foram registradas. Cria so os marcos que
-- ja existem no banco com data confiavel:
--   . paciente cadastrado
--   . plano alimentar ATIVO
--   . treino ATIVO
--   . avaliacoes fisicas (cada uma ja e um evento datado, nao uma "alteracao")
--
-- Todos ficam com {"importado": true} no metadata e protegidos por chave_dedup:
-- rodar de novo NAO duplica. Cada bloco so roda se a tabela de origem existir.
-- ===========================================================================

-- Guarda: sem a estrutura, avisa em vez de estourar no meio.
do $$
begin
  if to_regclass('public.paciente_eventos') is null then
    raise exception 'Rode db/timeline_schema.sql antes deste arquivo.';
  end if;
end $$;


-- 1) Paciente cadastrado
do $$
begin
  insert into public.paciente_eventos
    (nutri_id, paciente_id, tipo, modulo, titulo, descricao, data_evento,
     criado_por, entidade_tipo, entidade_id, metadata, importancia, chave_dedup)
  select
    p.nutri_id, p.id, 'PATIENT_CREATED', 'paciente',
    'Paciente cadastrado',
    'Cadastro criado no NutriMap.',
    p.criado_em, p.nutri_id, 'paciente', p.id,
    jsonb_build_object('importado', true, 'codigo', p.codigo),
    'normal', 'PATIENT_CREATED:' || p.id
  from public.pacientes p
  where p.nutri_id is not null
  on conflict (chave_dedup) do nothing;
end $$;


-- 2) Plano alimentar ativo (o que esta valendo hoje)
do $$
begin
  if to_regclass('public.planos_alimentares') is not null then
    insert into public.paciente_eventos
      (nutri_id, paciente_id, tipo, modulo, titulo, descricao, data_evento,
       criado_por, entidade_tipo, entidade_id, metadata, importancia, chave_dedup)
    select
      pl.nutri_id, pl.paciente_id, 'MEAL_PLAN_PUBLISHED', 'alimentacao',
      'Plano alimentar publicado',
      coalesce(pl.nome, 'Plano alimentar') ||
        case when pl.kcal_meta is not null
             then ' · meta de ' || round(pl.kcal_meta)::text || ' kcal' else '' end,
      coalesce(pl.data_inicio::timestamptz, pl.criado_em),
      pl.nutri_id, 'plano', pl.id,
      jsonb_strip_nulls(jsonb_build_object(
        'importado', true,
        'plan_name', pl.nome,
        'target_calories', pl.kcal_meta,
        'objetivo', pl.objetivo
      )),
      'alta', 'MEAL_PLAN_PUBLISHED:' || pl.id
    from public.planos_alimentares pl
    where pl.paciente_id is not null and pl.ativo is true and pl.nutri_id is not null
    on conflict (chave_dedup) do nothing;
  end if;
end $$;


-- 3) Treino ativo
do $$
begin
  if to_regclass('public.treinos') is not null then
    insert into public.paciente_eventos
      (nutri_id, paciente_id, tipo, modulo, titulo, descricao, data_evento,
       criado_por, entidade_tipo, entidade_id, metadata, importancia, chave_dedup)
    select
      t.nutri_id, t.paciente_id, 'WORKOUT_PUBLISHED', 'treinos',
      'Treino publicado',
      coalesce(t.nome, 'Treino') ||
        case when t.divisao is not null then ' · ' || t.divisao else '' end,
      coalesce(t.data_inicio::timestamptz, t.criado_em),
      t.nutri_id, 'treino', t.id,
      jsonb_strip_nulls(jsonb_build_object(
        'importado', true,
        'workout_name', t.nome,
        'divisao', t.divisao
      )),
      'alta', 'WORKOUT_PUBLISHED:' || t.id
    from public.treinos t
    where t.paciente_id is not null and t.ativo is true and t.nutri_id is not null
    on conflict (chave_dedup) do nothing;
  end if;
end $$;


-- 4) Avaliacoes fisicas
do $$
begin
  if to_regclass('public.avaliacoes') is not null then
    insert into public.paciente_eventos
      (nutri_id, paciente_id, tipo, modulo, titulo, descricao, data_evento,
       criado_por, entidade_tipo, entidade_id, metadata, importancia, chave_dedup)
    select
      a.nutri_id, a.paciente_id, 'PHYSICAL_ASSESSMENT_CREATED', 'avaliacoes',
      'Avaliação física realizada',
      -- pct_gordura = 0 significa "sem protocolo de dobras", nao "0% de gordura":
      -- gravar zero aqui seria inventar um dado que ninguem mediu.
      concat_ws(' · ',
        case when a.peso is not null then 'Peso: ' || a.peso::text || ' kg' end,
        case when coalesce(a.pct_gordura, 0) > 0
             then 'Gordura: ' || round((a.pct_gordura * 100)::numeric, 1)::text || '%' end),
      a.data_avaliacao::timestamptz,
      a.nutri_id, 'avaliacao', a.id,
      jsonb_strip_nulls(jsonb_build_object(
        'importado', true,
        'numero', a.numero,
        'weight', a.peso,
        'body_fat_percentage', case when coalesce(a.pct_gordura, 0) > 0
                                    then round((a.pct_gordura * 100)::numeric, 1) end
      )),
      'alta', 'PHYSICAL_ASSESSMENT_CREATED:' || a.id
    from public.avaliacoes a
    where a.paciente_id is not null and a.nutri_id is not null and a.data_avaliacao is not null
    on conflict (chave_dedup) do nothing;
  end if;
end $$;


-- Conferencia
select tipo, count(*) as eventos
from public.paciente_eventos
group by tipo
order by eventos desc;
