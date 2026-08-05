begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';

select public.funcionario_do_auth() as deve_ser_nulo,
       (select count(*) from public.colaborador_documentos) as deve_ser_zero;

rollback;
