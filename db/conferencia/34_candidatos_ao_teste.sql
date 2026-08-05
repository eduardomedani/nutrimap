select f.id,
       f.nome,
       f.email,
       f.auth_user_id,
       f.nutri_id,
       f.ativo,
       f.acesso_bloqueado,
       f.codigo_acesso is not null as tem_codigo,
       (select count(*) from public.funcionarios g
         where f.email is not null and lower(g.email) = lower(f.email)) as cadastros_com_este_email,
       (select count(*) from public.folha_itens i
          join public.folhas fo on fo.id = i.folha_id
         where i.funcionario_id = f.id and fo.status = 'rascunho') as linhas_em_folha_aberta,
       (select max(fo.competencia) from public.folha_itens i
          join public.folhas fo on fo.id = i.folha_id
         where i.funcionario_id = f.id and fo.status = 'rascunho') as competencia_aberta
  from public.funcionarios f
 where f.auth_user_id is not null
   and f.ativo
   and not f.acesso_bloqueado
 order by f.nome;
