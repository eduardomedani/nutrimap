select
  p.id,
  coalesce(p.nome, '(SEM NOME)')                    as nome,
  p.codigo,
  p.status,
  p.criado_em,
  u.email                                           as dono,
  case when p.auth_user_id is null then 'sem conta' else 'tem conta' end as vinculo,
  (select count(*) from public.respostas          r where r.paciente_id = p.id) as respostas,
  (select count(*) from public.treinos            t where t.paciente_id = p.id) as treinos,
  (select count(*) from public.planos_alimentares a where a.paciente_id = p.id) as planos,
  (select count(*) from public.avaliacoes         v where v.paciente_id = p.id) as avaliacoes,
  (select count(*) from public.consultas          c where c.paciente_id = p.id) as consultas,
  (select count(*) from public.paciente_eventos   e where e.paciente_id = p.id) as eventos,
  (select count(*) from public.paciente_metas     m where m.paciente_id = p.id) as metas,
  (select count(*) from public.paciente_tarefas   t where t.paciente_id = p.id) as tarefas,
  (select count(*) from public.exames             x where x.paciente_id = p.id) as exames,
  (select count(*) from public.comercial_assinaturas s where s.paciente_id = p.id) as assinaturas,
  (select count(*) from public.financeiro_lancamentos l where l.paciente_id = p.id) as lancamentos
from public.pacientes p
left join auth.users u on u.id = p.nutri_id
where p.nome is null
   or btrim(p.nome) = ''
   or p.nutri_id <> '71935ff7-19a0-453a-9ae4-fa1d73c13a58'::uuid
order by p.criado_em;
