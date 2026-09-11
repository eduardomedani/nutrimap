-- ===========================================================================
-- 128a · O GATE 128 TEM COM O QUE TRABALHAR?
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. UMA consulta so.
--
-- POR QUE ANTES E NAO DEPOIS. Os testes 10 e 11 do gate exigem um paciente com
-- LOGIN (auth_user_id preenchido) que tenha TREINO com exercicio. Sem isso o
-- gate devolve NAO TESTAVEL — e NAO TESTAVEL e parada, por decisao do Eduardo.
--
-- Descobrir isso depois de aplicar a migration significa parar no meio da
-- sequencia. Esta consulta custa um segundo e responde antes.
--
-- ESPERADO para o gate rodar inteiro:
--   pacientes_com_login          >= 1
--   pacientes_com_login_e_treino >= 1
--   exercicios_fora_de_treino    >= 1   (o teste 11 precisa de um exercicio
--                                        que NAO esteja em treino de aluno
--                                        logado, senao ele falha por
--                                        coincidencia de fixture)
-- ===========================================================================
select
  (select count(*) from public.pacientes)                          as pacientes,
  (select count(*) from public.pacientes
    where auth_user_id is not null)                                as pacientes_com_login,
  (select count(distinct p.id)
     from public.pacientes p
     join public.treinos t            on t.paciente_id = p.id
     join public.treino_exercicios te on te.treino_id  = t.id
    where p.auth_user_id is not null)                              as pacientes_com_login_e_treino,
  (select count(*)
     from public.exercicios e
    where e.nutri_id is not null
      and not exists (
            select 1
              from public.treino_exercicios te
              join public.treinos t   on t.id = te.treino_id
              join public.pacientes p on p.id = t.paciente_id
             where te.exercicio_id = e.id
               and p.auth_user_id is not null))                    as exercicios_fora_de_treino;
