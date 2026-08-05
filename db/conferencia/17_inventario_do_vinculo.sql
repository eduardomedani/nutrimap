select f.id,
       f.nome,
       f.ativo,
       f.acesso_bloqueado,
       f.auth_user_id,
       f.auth_user_id is not null as conta_vinculada,
       f.codigo_acesso is not null as tem_codigo,
       (select count(*) from public.colaborador_documentos d
         where d.colaborador_id = f.id and d.atual and d.status = 'disponivel'
           and d.arquivado_em is null) as documentos_visiveis
  from public.funcionarios f
 order by f.nome;
