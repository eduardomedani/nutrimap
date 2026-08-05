select current_user as rodando_como,
       (select relforcerowsecurity from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'funcionarios') as rls_forcada,
       (select count(*) from public.funcionarios) as funcionarios_total,
       (select count(*) from public.funcionarios where ativo) as ativos,
       (select count(*) from public.funcionarios where not acesso_bloqueado) as nao_bloqueados,
       (select count(*) from public.funcionarios where auth_user_id is not null) as com_conta_vinculada,
       (select count(*) from public.funcionarios where codigo_acesso is not null) as com_codigo,
       (select count(*) from public.funcionarios where email is not null) as com_email,
       (select count(*) from public.folhas) as folhas,
       (select count(*) from public.folhas where status = 'rascunho') as folhas_em_rascunho,
       (select count(*) from public.folha_itens) as linhas_de_folha;
