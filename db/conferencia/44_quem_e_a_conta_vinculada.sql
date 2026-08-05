select f.id,
       f.nome,
       f.email as email_no_cadastro,
       u.email as email_da_conta_vinculada,
       u.email_confirmed_at,
       f.auth_user_id,
       f.nutri_id,
       f.auth_user_id = f.nutri_id as conta_e_do_proprio_nutricionista
  from public.funcionarios f
  left join auth.users u on u.id = f.auth_user_id
 where f.auth_user_id is not null
 order by f.nome;
