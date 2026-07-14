-- ===========================================================================
-- NutriMap · Progressão POR SÉRIE (peso + reps de cada série)
-- ---------------------------------------------------------------------------
-- Antes: 1 carga + 1 reps por registro. Agora: guardamos as séries num JSON
--   series_realizadas = [ {"peso": 20, "reps": 8}, {"peso": 22, "reps": 7}, ... ]
-- Um registro por (exercício, dia). Salvar de novo no mesmo dia ATUALIZA.
-- carga_realizada / reps_realizadas continuam preenchidos (maior peso do dia)
-- para o mini-gráfico de evolução seguir funcionando.
--
-- Rodar no SQL Editor do Supabase. Re-executável.
-- ===========================================================================

alter table public.treino_progressao
  add column if not exists series_realizadas jsonb;

-- Salva/atualiza as séries de um item do treino do próprio paciente.
create or replace function public.rpc_paciente_salvar_series(
  p_treino_exercicio_id uuid,
  p_data                date,
  p_series              jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pac      uuid;
  v_nutri    uuid;
  v_id       uuid;
  v_data     date;
  v_top      numeric;
  v_top_reps smallint;
begin
  v_pac := public.paciente_do_auth();
  if v_pac is null then
    raise exception 'sem_paciente';
  end if;

  -- confirma posse do item e pega o nutri dono
  select t.nutri_id into v_nutri
    from public.treino_exercicios te
    join public.treinos t on t.id = te.treino_id
   where te.id = p_treino_exercicio_id
     and t.paciente_id = v_pac;
  if v_nutri is null then
    raise exception 'item_nao_pertence_ao_paciente';
  end if;

  v_data := coalesce(p_data, current_date);

  -- representativo p/ o gráfico: maior peso do dia + reps daquela série
  select (elem->>'peso')::numeric, (elem->>'reps')::smallint
    into v_top, v_top_reps
    from jsonb_array_elements(coalesce(p_series, '[]'::jsonb)) elem
   where (elem->>'peso') ~ '^[0-9]+(\.[0-9]+)?$'
   order by (elem->>'peso')::numeric desc
   limit 1;

  -- upsert manual por (item, data) — sem exigir constraint única
  select id into v_id from public.treino_progressao
   where treino_exercicio_id = p_treino_exercicio_id and data = v_data
   limit 1;

  if v_id is null then
    insert into public.treino_progressao
      (nutri_id, treino_exercicio_id, data, carga_realizada, reps_realizadas, series_realizadas)
    values
      (v_nutri, p_treino_exercicio_id, v_data, v_top, v_top_reps, p_series)
    returning id into v_id;
  else
    update public.treino_progressao
       set carga_realizada   = v_top,
           reps_realizadas   = v_top_reps,
           series_realizadas = p_series
     where id = v_id;
  end if;

  return v_id;
end;
$$;
grant execute on function public.rpc_paciente_salvar_series(uuid, date, jsonb) to authenticated;

-- ===========================================================================
-- FIM
-- ===========================================================================
