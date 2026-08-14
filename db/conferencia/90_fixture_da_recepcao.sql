-- ===========================================================================
-- ETAPA 4A — a prova central: DONO e AUTOR na mesma linha
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. Um select so.
--
-- RODE DEPOIS de a Recepcao criar a fixture pela interface.
--
-- O QUE ESTA LINHA PROVA. Ela nasceu de um insert que NAO mandou `nutri_id`:
-- o frontend mandou dado de negocio e mais nada. Entao quem preencheu o dono
-- foi o `default organizacao_do_auth()` da coluna, e quem preencheu o autor
-- foi o `default auth.uid()`, que continua intocado.
--
-- Dois defaults, na mesma linha, resolvendo perguntas diferentes:
--
--   nutri_id    = 71935ff7...   DE QUEM E o registro
--   criado_por  = dd412ed1...   QUEM o criou
--
-- Se os dois viessem iguais, ou o default nao migrou, ou o frontend voltou a
-- escolher o dono. Se `nutri_id` viesse com o uuid da pessoa, seria o modo de
-- falha que a Etapa 4A existe para eliminar — e ele estaria gravado no banco,
-- nao so na tela.
--
-- Os uuids esperados sao DESCOBERTOS, nao escritos a mao: a organizacao vem do
-- vinculo com admins e a Recepcao vem do perfil. Um uuid colado a mao em
-- script de conferencia envelhece calado.
--
-- Para colar no SQL Editor, use db/conferencia/90_fixture_da_recepcao_LIMPO.sql
-- ===========================================================================

with esperado as (
  select o.proprietario_user_id as organizacao,
         (select ou.auth_user_id
            from public.organizacao_usuarios ou
            join public.perfis pf on pf.id = ou.perfil_id
           where ou.organizacao_id = o.id and pf.chave = 'recepcao') as recepcao
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id
)
select
  p.nome,
  left(p.id::text, 8)                     as id,
  p.nutri_id                              as dono,
  p.criado_por                            as autor,
  p.criado_em::timestamp(0)               as criado_em,
  case when p.nutri_id = e.organizacao
       then 'OK — dono e a ORGANIZACAO'
       when p.nutri_id = e.recepcao
       then 'FALHOU — dono e a PESSOA, o default nao migrou'
       else 'FALHOU — dono e um terceiro uuid' end   as prova_dono,
  case when p.criado_por = e.recepcao
       then 'OK — autor e a RECEPCAO'
       when p.criado_por is null
       then 'FALHOU — sem autor'
       else 'FALHOU — autor inesperado' end          as prova_autor,
  case when p.nutri_id = e.organizacao and p.criado_por = e.recepcao
       then 'DONO <> AUTOR, COMO PROJETADO'
       else 'PARE' end                               as veredito
from public.comercial_planos p
cross join esperado e
where p.nome like '[FIXTURE 4A]%'
order by p.criado_em;
