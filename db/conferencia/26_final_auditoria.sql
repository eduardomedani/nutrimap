select acao, count(*) as eventos, max(criado_em) as ultimo
  from public.documento_auditoria
 group by acao
 order by eventos desc;
