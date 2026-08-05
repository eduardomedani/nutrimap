select u.id,
       u.email,
       u.email_confirmed_at is not null as email_confirmado,
       u.created_at,
       u.last_sign_in_at
  from auth.users u
 order by u.created_at desc;
