select colaborador_id, competencia, tipo_documento, count(*) as atuais
  from public.colaborador_documentos
 where atual
 group by colaborador_id, competencia, tipo_documento
having count(*) > 1;
