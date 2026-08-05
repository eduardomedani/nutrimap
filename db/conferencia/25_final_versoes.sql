select competencia, tipo_documento, colaborador_id, count(*) as versoes,
       max(versao) as versao_atual
  from public.colaborador_documentos
 group by competencia, tipo_documento, colaborador_id
having count(*) > 1
 order by competencia desc;
