select
  r.dados ->> 'q1_1' as nome_completo,
  r.dados ->> 'q1_2' as email,
  r.dados ->> 'q1_3' as whatsapp,
  r.dados ->> 'q1_4' as nascimento,
  r.dados ->> 'q1_6' as cidade,
  r.dados ->> 'q1_8' as profissao,
  r.salvo_em
from public.respostas r
where r.paciente_id = '5ab5cf85-7cca-4f97-81a1-87cbdb3dccb3'::uuid
  and r.modulo = 'm1';
