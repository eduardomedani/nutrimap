select f.id,
       f.nome,
       f.email,
       f.ativo,
       f.acesso_bloqueado,
       f.auth_user_id is not null as conta_vinculada,
       f.codigo_acesso,
       (select max(fo.competencia) from public.folha_itens i
          join public.folhas fo on fo.id = i.folha_id
         where i.funcionario_id = f.id) as ultima_competencia
  from public.funcionarios f
 order by f.ativo desc, f.nome;
