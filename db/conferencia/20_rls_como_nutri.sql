begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"COLE_O_AUTH_UID_DO_NUTRI","role":"authenticated"}';

select auth.uid() as minha_conta,
       (select count(*) from public.colaborador_documentos) as meus_documentos,
       (select count(*) from public.documentos_pendentes) as minhas_pendencias,
       (select count(*) from public.documento_auditoria) as minha_auditoria;

rollback;
