select 'tabela colaborador_documentos' as item, 'sim' as esperado, (select to_regclass('public.colaborador_documentos') is not null)::text as encontrado
union all
select 'tabela documentos_pendentes' as item, 'sim' as esperado, (select to_regclass('public.documentos_pendentes') is not null)::text as encontrado
union all
select 'tabela documento_auditoria' as item, 'sim' as esperado, (select to_regclass('public.documento_auditoria') is not null)::text as encontrado
union all
select 'view documentos_por_competencia' as item, 'sim' as esperado, (select to_regclass('public.documentos_por_competencia') is not null)::text as encontrado
union all
select 'view com security_invoker' as item, 'sim' as esperado, (select coalesce(array_to_string(c.reloptions, ',') like '%security_invoker=on%', false)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'documentos_por_competencia')::text as encontrado
union all
select 'funcoes esperadas' as item, '7' as esperado, (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in
      ('funcionario_do_auth','documento_e_meu','marcar_documento_visualizado',
       'vincular_documento_pendente','vincular_funcionario',
       'vincular_funcionario_por_email','registrar_auditoria_documento'))::text as encontrado
union all
select 'funcoes security definer' as item, '7' as esperado, (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proname in
      ('funcionario_do_auth','documento_e_meu','marcar_documento_visualizado',
       'vincular_documento_pendente','vincular_funcionario',
       'vincular_funcionario_por_email','registrar_auditoria_documento'))::text as encontrado
union all
select 'execute para authenticated' as item, '6' as esperado, (select count(distinct routine_name) from information_schema.role_routine_grants
     where specific_schema = 'public' and grantee = 'authenticated'
       and routine_name in ('funcionario_do_auth','documento_e_meu','marcar_documento_visualizado',
                            'vincular_documento_pendente','vincular_funcionario',
                            'vincular_funcionario_por_email'))::text as encontrado
union all
select 'execute para anon' as item, '0' as esperado, (select count(*) from information_schema.role_routine_grants
     where specific_schema = 'public' and grantee = 'anon'
       and routine_name in ('funcionario_do_auth','documento_e_meu','marcar_documento_visualizado',
                            'vincular_documento_pendente','vincular_documento_pendente'))::text as encontrado
union all
select 'rls colaborador_documentos' as item, 'true' as esperado, (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'colaborador_documentos')::text as encontrado
union all
select 'rls documentos_pendentes' as item, 'true' as esperado, (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'documentos_pendentes')::text as encontrado
union all
select 'rls documento_auditoria' as item, 'true' as esperado, (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'documento_auditoria')::text as encontrado
union all
select 'rls funcionarios' as item, 'true' as esperado, (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'funcionarios')::text as encontrado
union all
select 'policies colaborador_documentos' as item, '5' as esperado, (select count(*) from pg_policies where schemaname = 'public'
      and tablename = 'colaborador_documentos')::text as encontrado
union all
select 'policies documentos_pendentes' as item, '1' as esperado, (select count(*) from pg_policies where schemaname = 'public'
      and tablename = 'documentos_pendentes')::text as encontrado
union all
select 'policies documento_auditoria' as item, '1' as esperado, (select count(*) from pg_policies where schemaname = 'public'
      and tablename = 'documento_auditoria')::text as encontrado
union all
select 'auditoria so leitura' as item, 'true' as esperado, (select coalesce(bool_and(cmd = 'SELECT'), false) from pg_policies
     where schemaname = 'public' and tablename = 'documento_auditoria')::text as encontrado
union all
select 'colaborador le so disponivel' as item, 'true' as esperado, (select coalesce(bool_or(qual like '%disponivel%' and qual like '%arquivado_em%'
                            and qual like '%funcionario_do_auth%'), false)
      from pg_policies where schemaname = 'public'
       and tablename = 'colaborador_documentos' and policyname = 'cd_colaborador_select')::text as encontrado
union all
select 'policies do storage' as item, '2' as esperado, (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('cd_storage_nutri','cd_storage_colaborador'))::text as encontrado
union all
select 'storage do colaborador confere a tabela' as item, 'true' as esperado, (select coalesce(bool_or(qual like '%documento_e_meu%'), false) from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'cd_storage_colaborador')::text as encontrado
union all
select 'bucket existe' as item, '1' as esperado, (select count(*) from storage.buckets where id = 'colaborador-documentos')::text as encontrado
union all
select 'bucket privado' as item, 'true' as esperado, (select not coalesce(bool_or(public), true) from storage.buckets
     where id = 'colaborador-documentos')::text as encontrado
union all
select 'bucket com limite de tamanho' as item, 'ver nota' as esperado, (select coalesce(max(file_size_limit)::text, 'nulo') from storage.buckets
     where id = 'colaborador-documentos')::text as encontrado
union all
select 'trigger de auditoria ativo' as item, 'true' as esperado, (select coalesce(bool_or(t.tgenabled = 'O'), false)
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'colaborador_documentos'
       and t.tgname = 'trg_auditoria_documento' and not t.tgisinternal)::text as encontrado
union all
select 'indices nomeados' as item, '8' as esperado, (select count(*) from pg_indexes where schemaname = 'public' and indexname in
      ('uniq_cd_atual','idx_cd_colaborador','idx_cd_nutri','idx_cd_hash',
       'idx_dp_nutri','uniq_dp_hash','idx_da_documento','idx_da_nutri'))::text as encontrado
union all
select 'uniq_cd_atual so na versao atual' as item, 'true' as esperado, (select coalesce(bool_or(indexdef like '%WHERE atual%' or indexdef like '%where atual%'), false)
      from pg_indexes where schemaname = 'public' and indexname = 'uniq_cd_atual')::text as encontrado
union all
select 'colunas de colaborador_documentos' as item, '25' as esperado, (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'colaborador_documentos')::text as encontrado
union all
select 'coluna atual' as item, 'sim' as esperado, (select count(*) > 0 from information_schema.columns where table_schema = 'public'
      and table_name = 'colaborador_documentos' and column_name = 'atual')::text as encontrado
union all
select 'coluna substitui_documento_id' as item, 'sim' as esperado, (select count(*) > 0 from information_schema.columns where table_schema = 'public'
      and table_name = 'colaborador_documentos' and column_name = 'substitui_documento_id')::text as encontrado
union all
select 'check de tipo com 11 tipos' as item, 'true' as esperado, (select coalesce(bool_or(
             (length(pg_get_constraintdef(con.oid)) - length(replace(pg_get_constraintdef(con.oid), ',', ''))) = 10
           ), false)
      from pg_constraint con join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'colaborador_documentos'
       and con.conname = 'cd_tipo_check')::text as encontrado
union all
select 'checks de colaborador_documentos' as item, '5' as esperado, (select count(*) from pg_constraint con join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'colaborador_documentos' and con.contype = 'c')::text as encontrado
union all
select 'arquivos no bucket' as item, 'informativo' as esperado, (select count(*) from storage.objects where bucket_id = 'colaborador-documentos')::text as encontrado;
