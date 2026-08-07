select
  tablename,
  policyname,
  cmd,
  case
    when qual is null then '(sem USING)'
    when qual ilike '%nutri_id%' then 'filtra por nutri'
    when qual ilike '%paciente_do_auth%' then 'filtra por paciente da sessao'
    when qual ilike '%auth_user_id%'     then 'filtra pela conta'
    when qual ilike '%auth.uid%'         then 'usa auth.uid de outro jeito'
    else 'SEM FILTRO DE DONO'
  end as filtro,
  qual as condicao
from pg_policies
where schemaname = 'public'
order by
  case
    when qual is null then 0
    when qual ilike '%nutri_id%' or qual ilike '%paciente_do_auth%'
      or qual ilike '%auth_user_id%' or qual ilike '%auth.uid%' then 2
    else 1
  end,
  tablename, policyname;
