-- ===========================================================================
-- 128b · O DONO DOS EXERCICIOS TAMBEM E PACIENTE?
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. UMA consulta so.
--
-- POR QUE. No gate 128 a prova 3 falhou e a 6 passou — mesma linha global,
-- mesma policy, leitores diferentes. A unica clausula sensivel a quem le e:
--
--     (nutri_id is null and paciente_do_auth() is null)
--
-- Para um uuid inventado ela da NULL e o acesso passa. Para o dono, nao deu.
-- A hipotese e que o auth user do profissional TAMBEM tenha linha em
-- `pacientes` — e a policy assumiu que as duas coisas se excluem.
--
-- Se for isso, o teste "nao e paciente" e o errado. O certo e "E profissional",
-- e `organizacao_do_auth()` responde essa — mas so se o dono estiver em
-- `organizacao_usuarios`. As duas metades precisam ser confirmadas juntas,
-- porque trocar uma clausula por outra sem checar a segunda so troca de bug.
-- ===========================================================================
with dono as (
  select e.nutri_id as uid
    from public.exercicios e
   where e.nutri_id is not null
   order by e.criado_em
   limit 1
)
select
  d.uid                                                        as dono_dos_exercicios,
  (select count(*) from public.pacientes p
    where p.auth_user_id = d.uid)                              as tem_cadastro_de_paciente,
  (select public.paciente_do_auth() is null)                   as paciente_do_auth_nulo_agora,
  (select count(*) from public.organizacao_usuarios ou
    where ou.auth_user_id = d.uid)                             as esta_em_organizacao_usuarios,
  (select count(*) from public.organizacao_usuarios ou
    join public.pacientes p on p.auth_user_id = ou.auth_user_id) as usuarios_que_sao_os_dois,
  (select count(*) from public.pacientes
    where auth_user_id is not null)                            as pacientes_com_login,
  (select count(*) from public.organizacao_usuarios)           as total_usuarios_da_organizacao
from dono d;
