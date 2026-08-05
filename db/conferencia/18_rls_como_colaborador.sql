begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"COLE_O_AUTH_USER_ID_DO_COLABORADOR","role":"authenticated"}';

select auth.uid() as minha_conta,
       public.funcionario_do_auth() as meu_funcionario_id,
       (select count(*) from public.colaborador_documentos) as documentos_que_eu_vejo,
       (select count(*) from public.documentos_pendentes) as pendentes_que_eu_vejo,
       (select count(*) from public.documento_auditoria) as auditoria_que_eu_vejo;

rollback;
