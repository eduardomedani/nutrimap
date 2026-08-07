with usuarios as (
  select u.id, u.email
  from auth.users u
),
papeis as (
  select
    u.id,
    u.email,
    (select count(*) from public.pacientes    p where p.nutri_id = u.id) as pacientes_como_nutri,
    (select count(*) from public.treinos      t where t.nutri_id = u.id) as treinos_como_nutri,
    (select count(*) from public.funcionarios f where f.nutri_id = u.id) as funcionarios_como_nutri,
    (select count(*) from public.financeiro_lancamentos l where l.nutri_id = u.id) as lancamentos_como_nutri,
    (select count(*) from public.comercial_assinaturas a where a.nutri_id = u.id) as assinaturas_como_nutri,
    (select count(*) from public.pacientes    p where p.auth_user_id = u.id) as vinculado_como_paciente,
    (select count(*) from public.funcionarios f where f.auth_user_id = u.id) as vinculado_como_colaborador
  from usuarios u
)
select
  email,
  pacientes_como_nutri      as pac_nutri,
  treinos_como_nutri        as trein_nutri,
  funcionarios_como_nutri   as func_nutri,
  lancamentos_como_nutri    as lanc_nutri,
  assinaturas_como_nutri    as assin_nutri,
  vinculado_como_paciente   as e_paciente,
  vinculado_como_colaborador as e_colaborador,
  case
    when vinculado_como_paciente > 0 and pacientes_como_nutri > 0
      then 'NUTRI E PACIENTE — policies OR-ed valem para os dois lados'
    when vinculado_como_colaborador > 0 and funcionarios_como_nutri > 0
      then 'NUTRI E COLABORADOR — mesma sobreposicao'
    when pacientes_como_nutri > 0 then 'so nutri'
    when vinculado_como_paciente > 0 then 'so paciente'
    when vinculado_como_colaborador > 0 then 'so colaborador'
    else 'sem dado'
  end as papel
from papeis
order by pacientes_como_nutri desc, email;
