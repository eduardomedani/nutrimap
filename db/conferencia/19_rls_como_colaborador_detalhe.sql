begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"COLE_O_AUTH_USER_ID_DO_COLABORADOR","role":"authenticated"}';

select id, colaborador_id, competencia, tipo_documento, versao, atual, status,
       visualizado_pelo_colaborador
  from public.colaborador_documentos
 order by competencia desc;

rollback;
