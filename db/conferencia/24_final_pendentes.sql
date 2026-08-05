select status, count(*) as arquivos, max(criado_em) as ultimo
  from public.documentos_pendentes
 group by status
 order by status;
