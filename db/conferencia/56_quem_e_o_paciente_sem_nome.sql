select
  r.modulo,
  r.salvo_em,
  jsonb_pretty(
    case when jsonb_typeof(r.dados) = 'object'
      then (select jsonb_object_agg(k, v)
              from jsonb_each(r.dados) as t(k, v)
             where k ~* 'nome|email|telefone|whats|contato|nasc|cpf|idade')
      else r.dados
    end
  ) as campos_de_identificacao
from public.respostas r
where r.paciente_id = '5ab5cf85-7cca-4f97-81a1-87cbdb3dccb3'::uuid
order by r.salvo_em;
