select tipo_documento, status, count(*) as documentos,
       count(*) filter (where visualizado_pelo_colaborador) as visualizados,
       count(*) filter (where arquivado_em is not null) as arquivados,
       count(*) filter (where not atual) as versoes_antigas
  from public.colaborador_documentos
 group by tipo_documento, status
 order by tipo_documento, status;
