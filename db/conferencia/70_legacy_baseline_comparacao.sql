-- ===========================================================================
-- CONFERENCIA DO BASELINE LEGADO — repositorio x banco
-- ---------------------------------------------------------------------------
-- ARQUIVO GERADO. Nao edite a mao: regenere com
--
--     node test/gerar-conferencia-legado.mjs
--
-- A fonte e db/*_legacy_baseline.sql. Editar aqui cria a segunda fonte que o
-- gerador existe para evitar.
--
-- NAO ALTERA NADA. So le catalogo. Pode rodar em producao sem risco.
--
-- COMO LER A SAIDA:
--   linhas com resultado OK    contagem de itens conferidos por objeto
--   linhas com DIFF            baseline e banco divergem — as duas aparecem
--   AUSENTE NO BANCO           o objeto sumiu ou foi renomeado
--   SO NO BANCO                apareceu algo que o baseline nao conhece
--   ultima linha (zz TOTAL)    o veredito
--
-- Qualquer coisa diferente de SEM DIVERGENCIAS **para a Etapa 2**. A migracao
-- multiusuario precisa saber o que mudou antes de comecar.
--
-- Para colar no SQL Editor, use db/conferencia/70_legacy_baseline_comparacao_LIMPO.sql
-- ===========================================================================

with esperado(objeto, item, valor) as (
  values
    ('fn:validar_codigo_convite', 'assinatura', 'p_codigo text'),
    ('fn:validar_codigo_convite', 'linguagem', 'plpgsql'),
    ('fn:validar_codigo_convite', 'security', 'definer'),
    ('fn:validar_codigo_convite', 'search_path', '(sem set)'),
    ('fn:validar_codigo_convite', 'corpo', 'declare cod_record record; resultado json; begin -- busca o código (case insensitive) select * into cod_record from public.codigos_convite where upper(codigo) = upper(p_codigo) and ativo = true limit 1; -- não existe ou inativo if cod_record is null then return json_build_object(''valido'', false, ''erro'', ''código inválido ou desativado''); end if; -- expirado? if cod_record.expira_em is not null and cod_record.expira_em < now() then return json_build_object(''valido'', false, ''erro'', ''código expirado''); end if; -- esgotou usos? if cod_record.usos_atuais >= cod_record.usos_maximo then return json_build_object(''valido'', false, ''erro'', ''este código já atingiu o limite de usos''); end if; -- tudo ok → retorna válido (o consumo acontece depois, ao registrar uso) return json_build_object( ''valido'', true, ''codigo_id'', cod_record.id, ''descricao'', cod_record.descricao ); end;'),
    ('fn:registrar_uso_codigo', 'assinatura', 'p_codigo text, p_nutri_id uuid, p_email text'),
    ('fn:registrar_uso_codigo', 'linguagem', 'plpgsql'),
    ('fn:registrar_uso_codigo', 'security', 'definer'),
    ('fn:registrar_uso_codigo', 'search_path', '(sem set)'),
    ('fn:registrar_uso_codigo', 'corpo', 'declare cod_record record; begin -- re-valida atomicamente select * into cod_record from public.codigos_convite where upper(codigo) = upper(p_codigo) and ativo = true and usos_atuais < usos_maximo and (expira_em is null or expira_em > now()) for update; if cod_record is null then return json_build_object(''ok'', false, ''erro'', ''código não pode ser usado''); end if; -- incrementa update public.codigos_convite set usos_atuais = usos_atuais + 1 where id = cod_record.id; -- registra log insert into public.codigos_uso (codigo_id, nutri_id, email) values (cod_record.id, p_nutri_id, p_email); return json_build_object(''ok'', true); end;'),
    ('fn:rpc_buscar_paciente_por_codigo', 'assinatura', 'p_codigo text'),
    ('fn:rpc_buscar_paciente_por_codigo', 'linguagem', 'sql'),
    ('fn:rpc_buscar_paciente_por_codigo', 'security', 'definer'),
    ('fn:rpc_buscar_paciente_por_codigo', 'search_path', 'public'),
    ('fn:rpc_buscar_paciente_por_codigo', 'corpo', 'select id, nome, status from public.pacientes where codigo = p_codigo limit 1;'),
    ('fn:rpc_marcar_completo', 'assinatura', 'p_codigo text'),
    ('fn:rpc_marcar_completo', 'linguagem', 'plpgsql'),
    ('fn:rpc_marcar_completo', 'security', 'definer'),
    ('fn:rpc_marcar_completo', 'search_path', 'public'),
    ('fn:rpc_marcar_completo', 'corpo', 'begin update public.pacientes set status = ''completo'', completado_em = now() where codigo = p_codigo; end;'),
    ('fn:rpc_salvar_respostas', 'assinatura', 'p_codigo text, p_modulos jsonb'),
    ('fn:rpc_salvar_respostas', 'linguagem', 'plpgsql'),
    ('fn:rpc_salvar_respostas', 'security', 'definer'),
    ('fn:rpc_salvar_respostas', 'search_path', 'public'),
    ('fn:rpc_salvar_respostas', 'corpo', 'declare v_paciente_id uuid; v_modulo text; v_dados jsonb; v_rows int; begin select id into v_paciente_id from public.pacientes where codigo = p_codigo limit 1; if v_paciente_id is null then raise exception ''código de paciente inválido: %'', p_codigo; end if; for v_modulo, v_dados in select * from jsonb_each(p_modulos) loop update public.respostas set dados = v_dados, salvo_em = now() where paciente_id = v_paciente_id and modulo = v_modulo; get diagnostics v_rows = row_count; if v_rows = 0 then insert into public.respostas (paciente_id, modulo, dados, salvo_em) values (v_paciente_id, v_modulo, v_dados, now()); end if; end loop; end;'),
    ('fn:gerar_codigo_paciente', 'assinatura', ''),
    ('fn:gerar_codigo_paciente', 'linguagem', 'plpgsql'),
    ('fn:gerar_codigo_paciente', 'security', 'invoker'),
    ('fn:gerar_codigo_paciente', 'search_path', '(sem set)'),
    ('fn:gerar_codigo_paciente', 'corpo', 'declare alfabeto text := ''abcdefghjkmnpqrstuvwxyz23456789''; novo_codigo text; i int; tentativas int := 0; begin loop novo_codigo := ''''; for i in 1..6 loop novo_codigo := novo_codigo || substr(alfabeto, floor(random() * length(alfabeto) + 1)::int, 1); end loop; -- verifica se já existe (referência explícita à tabela) if not exists (select 1 from public.pacientes p where p.codigo = novo_codigo) then return novo_codigo; end if; tentativas := tentativas + 1; if tentativas > 20 then raise exception ''não foi possível gerar código único''; end if; end loop; end;'),
    ('fn:handle_new_user', 'assinatura', ''),
    ('fn:handle_new_user', 'linguagem', 'plpgsql'),
    ('fn:handle_new_user', 'security', 'definer'),
    ('fn:handle_new_user', 'search_path', '(sem set)'),
    ('fn:handle_new_user', 'corpo', 'begin insert into public.nutricionistas (id, nome, email) values ( new.id, coalesce(new.raw_user_meta_data->>''nome'', new.email), new.email ); return new; end;'),
    ('trg:on_auth_user_created', 'definicao', 'create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user()'),
    ('trg:on_auth_user_created', 'enabled', 'habilitado'),
    ('avaliacoes', 'coluna:01', 'id uuid not null default gen_random_uuid()'),
    ('avaliacoes', 'coluna:02', 'paciente_id uuid not null'),
    ('avaliacoes', 'coluna:03', 'nutri_id uuid not null'),
    ('avaliacoes', 'coluna:04', 'numero integer not null'),
    ('avaliacoes', 'coluna:05', 'data_avaliacao date not null default current_date'),
    ('avaliacoes', 'coluna:06', 'sexo text'),
    ('avaliacoes', 'coluna:07', 'idade integer'),
    ('avaliacoes', 'coluna:08', 'peso numeric(5,2)'),
    ('avaliacoes', 'coluna:09', 'altura numeric(4,2)'),
    ('avaliacoes', 'coluna:10', 'fator_atividade numeric(4,3) default 1.2'),
    ('avaliacoes', 'coluna:11', 'pct_gordura_ideal numeric(4,3) default 0.12'),
    ('avaliacoes', 'coluna:12', 'protocolo text'),
    ('avaliacoes', 'coluna:13', 'dc_peitoral numeric(4,1)'),
    ('avaliacoes', 'coluna:14', 'dc_axilar_media numeric(4,1)'),
    ('avaliacoes', 'coluna:15', 'dc_subescapular numeric(4,1)'),
    ('avaliacoes', 'coluna:16', 'dc_tricipital numeric(4,1)'),
    ('avaliacoes', 'coluna:17', 'dc_biciptal numeric(4,1)'),
    ('avaliacoes', 'coluna:18', 'dc_crista_iliaca numeric(4,1)'),
    ('avaliacoes', 'coluna:19', 'dc_supra_iliaca numeric(4,1)'),
    ('avaliacoes', 'coluna:20', 'dc_abdominal numeric(4,1)'),
    ('avaliacoes', 'coluna:21', 'dc_coxa numeric(4,1)'),
    ('avaliacoes', 'coluna:22', 'dc_panturrilha numeric(4,1)'),
    ('avaliacoes', 'coluna:23', 'per_torax numeric(5,1)'),
    ('avaliacoes', 'coluna:24', 'per_braco_direito numeric(5,1)'),
    ('avaliacoes', 'coluna:25', 'per_braco_esquerdo numeric(5,1)'),
    ('avaliacoes', 'coluna:26', 'per_abdomen numeric(5,1)'),
    ('avaliacoes', 'coluna:27', 'per_cintura numeric(5,1)'),
    ('avaliacoes', 'coluna:28', 'per_quadril numeric(5,1)'),
    ('avaliacoes', 'coluna:29', 'per_coxa_direita numeric(5,1)'),
    ('avaliacoes', 'coluna:30', 'per_coxa_esquerda numeric(5,1)'),
    ('avaliacoes', 'coluna:31', 'per_panturrilha_direita numeric(5,1)'),
    ('avaliacoes', 'coluna:32', 'per_panturrilha_esquerda numeric(5,1)'),
    ('avaliacoes', 'coluna:33', 'imc numeric(5,2)'),
    ('avaliacoes', 'coluna:34', 'pct_gordura numeric(4,3)'),
    ('avaliacoes', 'coluna:35', 'peso_gordura numeric(5,2)'),
    ('avaliacoes', 'coluna:36', 'peso_magro numeric(5,2)'),
    ('avaliacoes', 'coluna:37', 'peso_ideal numeric(5,2)'),
    ('avaliacoes', 'coluna:38', 'peso_excesso numeric(5,2)'),
    ('avaliacoes', 'coluna:39', 'pccq numeric(4,3)'),
    ('avaliacoes', 'coluna:40', 'tmb numeric(6,1)'),
    ('avaliacoes', 'coluna:41', 'get_kcal numeric(6,1)'),
    ('avaliacoes', 'coluna:42', 'observacoes text'),
    ('avaliacoes', 'coluna:43', 'criado_em timestamp with time zone default now()'),
    ('avaliacoes', 'coluna:44', 'atualizado_em timestamp with time zone default now()'),
    ('avaliacoes', 'colunas:total', '44'),
    ('respostas', 'coluna:01', 'id uuid not null default gen_random_uuid()'),
    ('respostas', 'coluna:02', 'paciente_id uuid not null'),
    ('respostas', 'coluna:03', 'modulo text not null'),
    ('respostas', 'coluna:04', 'dados jsonb not null default ''{}''::jsonb'),
    ('respostas', 'coluna:05', 'salvo_em timestamp with time zone default now()'),
    ('respostas', 'colunas:total', '5'),
    ('exames', 'coluna:01', 'id uuid not null default gen_random_uuid()'),
    ('exames', 'coluna:02', 'paciente_id uuid not null'),
    ('exames', 'coluna:03', 'nome_arquivo text not null'),
    ('exames', 'coluna:04', 'url_storage text'),
    ('exames', 'coluna:05', 'tipo text'),
    ('exames', 'coluna:06', 'enviado_em timestamp with time zone default now()'),
    ('exames', 'colunas:total', '6'),
    ('recordatorio_calc', 'coluna:01', 'paciente_id uuid not null'),
    ('recordatorio_calc', 'coluna:02', 'kcal_total numeric(7,1)'),
    ('recordatorio_calc', 'coluna:03', 'prot_g numeric(6,1)'),
    ('recordatorio_calc', 'coluna:04', 'carb_g numeric(6,1)'),
    ('recordatorio_calc', 'coluna:05', 'gord_g numeric(6,1)'),
    ('recordatorio_calc', 'coluna:06', 'detalhe jsonb'),
    ('recordatorio_calc', 'coluna:07', 'hash_origem text'),
    ('recordatorio_calc', 'coluna:08', 'calculado_em timestamp with time zone default now()'),
    ('recordatorio_calc', 'colunas:total', '8'),
    ('avaliacoes', 'constraint:avaliacoes_pkey', 'primary key (id)'),
    ('avaliacoes', 'constraint:avaliacoes_paciente_id_numero_key', 'unique (paciente_id, numero)'),
    ('avaliacoes', 'constraint:avaliacoes_paciente_id_fkey', 'foreign key (paciente_id) references pacientes(id) on delete cascade'),
    ('avaliacoes', 'constraint:avaliacoes_nutri_id_fkey', 'foreign key (nutri_id) references nutricionistas(id) on delete cascade'),
    ('respostas', 'constraint:respostas_pkey', 'primary key (id)'),
    ('respostas', 'constraint:respostas_paciente_id_modulo_key', 'unique (paciente_id, modulo)'),
    ('respostas', 'constraint:respostas_paciente_id_fkey', 'foreign key (paciente_id) references pacientes(id) on delete cascade'),
    ('exames', 'constraint:exames_pkey', 'primary key (id)'),
    ('exames', 'constraint:exames_paciente_id_fkey', 'foreign key (paciente_id) references pacientes(id) on delete cascade'),
    ('recordatorio_calc', 'constraint:recordatorio_calc_pkey', 'primary key (paciente_id)'),
    ('recordatorio_calc', 'constraint:recordatorio_calc_paciente_id_fkey', 'foreign key (paciente_id) references pacientes(id) on delete cascade'),
    ('avaliacoes', 'indice:idx_avaliacoes_nutri', 'create index idx_avaliacoes_nutri on avaliacoes using btree (nutri_id)'),
    ('avaliacoes', 'indice:idx_avaliacoes_paciente', 'create index idx_avaliacoes_paciente on avaliacoes using btree (paciente_id)'),
    ('respostas', 'indice:idx_respostas_paciente', 'create index idx_respostas_paciente on respostas using btree (paciente_id)'),
    ('exames', 'indice:idx_exames_paciente', 'create index idx_exames_paciente on exames using btree (paciente_id)'),
    ('avaliacoes', 'rls', 'enabled'),
    ('respostas', 'rls', 'enabled'),
    ('exames', 'rls', 'enabled'),
    ('recordatorio_calc', 'rls', 'enabled'),
    ('avaliacoes', 'policy:Nutri ve proprias avaliacoes:cmd', 'all'),
    ('avaliacoes', 'policy:Nutri ve proprias avaliacoes:roles', 'public'),
    ('avaliacoes', 'policy:Nutri ve proprias avaliacoes:using', 'auth.uid = nutri_id'),
    ('avaliacoes', 'policy:Nutri ve proprias avaliacoes:check', 'auth.uid = nutri_id'),
    ('respostas', 'policy:Nutri ve respostas dos seus pacientes:cmd', 'all'),
    ('respostas', 'policy:Nutri ve respostas dos seus pacientes:roles', 'authenticated'),
    ('respostas', 'policy:Nutri ve respostas dos seus pacientes:using', 'exists select 1 from pacientes p where p.id = respostas.paciente_id and p.nutri_id = auth.uid'),
    ('respostas', 'policy:Nutri ve respostas dos seus pacientes:check', 'exists select 1 from pacientes p where p.id = respostas.paciente_id and p.nutri_id = auth.uid'),
    ('exames', 'policy:Nutri ve exames dos seus pacientes:cmd', 'select'),
    ('exames', 'policy:Nutri ve exames dos seus pacientes:roles', 'public'),
    ('exames', 'policy:Nutri ve exames dos seus pacientes:using', 'exists select 1 from pacientes where pacientes.id = exames.paciente_id and pacientes.nutri_id = auth.uid'),
    ('exames', 'policy:Nutri ve exames dos seus pacientes:check', '(nenhum)'),
    ('recordatorio_calc', 'policy:Nutri ve cache dos seus pacientes:cmd', 'all'),
    ('recordatorio_calc', 'policy:Nutri ve cache dos seus pacientes:roles', 'authenticated'),
    ('recordatorio_calc', 'policy:Nutri ve cache dos seus pacientes:using', 'exists select 1 from pacientes p where p.id = recordatorio_calc.paciente_id and p.nutri_id = auth.uid'),
    ('recordatorio_calc', 'policy:Nutri ve cache dos seus pacientes:check', 'exists select 1 from pacientes p where p.id = recordatorio_calc.paciente_id and p.nutri_id = auth.uid'),
    ('trg:trg_avaliacoes_atualizado', 'definicao', 'create trigger trg_avaliacoes_atualizado before update on avaliacoes for each row execute function set_atualizado_em()'),
    ('trg:trg_avaliacoes_atualizado', 'enabled', 'habilitado'),
    ('codigos_convite', 'coluna:01', 'id uuid not null default gen_random_uuid()'),
    ('codigos_convite', 'coluna:02', 'codigo text not null'),
    ('codigos_convite', 'coluna:03', 'descricao text'),
    ('codigos_convite', 'coluna:04', 'usos_maximo integer default 1'),
    ('codigos_convite', 'coluna:05', 'usos_atuais integer default 0'),
    ('codigos_convite', 'coluna:06', 'ativo boolean default true'),
    ('codigos_convite', 'coluna:07', 'expira_em timestamp with time zone'),
    ('codigos_convite', 'coluna:08', 'criado_em timestamp with time zone default now()'),
    ('codigos_convite', 'colunas:total', '8'),
    ('codigos_uso', 'coluna:01', 'id uuid not null default gen_random_uuid()'),
    ('codigos_uso', 'coluna:02', 'codigo_id uuid'),
    ('codigos_uso', 'coluna:03', 'nutri_id uuid'),
    ('codigos_uso', 'coluna:04', 'email text'),
    ('codigos_uso', 'coluna:05', 'usado_em timestamp with time zone default now()'),
    ('codigos_uso', 'colunas:total', '5'),
    ('codigos_convite', 'constraint:codigos_convite_pkey', 'primary key (id)'),
    ('codigos_convite', 'constraint:codigos_convite_codigo_key', 'unique (codigo)'),
    ('codigos_uso', 'constraint:codigos_uso_pkey', 'primary key (id)'),
    ('codigos_uso', 'constraint:codigos_uso_codigo_id_fkey', 'foreign key (codigo_id) references codigos_convite(id)'),
    ('codigos_uso', 'constraint:codigos_uso_nutri_id_fkey', 'foreign key (nutri_id) references nutricionistas(id)'),
    ('codigos_convite', 'rls', 'enabled'),
    ('codigos_uso', 'rls', 'enabled'),
    ('nutricionistas', 'coluna:01', 'id uuid not null'),
    ('nutricionistas', 'coluna:02', 'nome text not null'),
    ('nutricionistas', 'coluna:03', 'email text not null'),
    ('nutricionistas', 'coluna:04', 'telefone text'),
    ('nutricionistas', 'coluna:05', 'instagram text'),
    ('nutricionistas', 'coluna:06', 'crn text'),
    ('nutricionistas', 'coluna:07', 'plano text default ''free''::text'),
    ('nutricionistas', 'coluna:08', 'criado_em timestamp with time zone default now()'),
    ('nutricionistas', 'colunas:total', '8'),
    ('nutricionistas', 'constraint:nutricionistas_pkey', 'primary key (id)'),
    ('nutricionistas', 'constraint:nutricionistas_id_fkey', 'foreign key (id) references auth.users(id) on delete cascade'),
    ('nutricionistas', 'rls', 'enabled'),
    ('nutricionistas', 'policy:Nutri ve proprio perfil:cmd', 'select'),
    ('nutricionistas', 'policy:Nutri ve proprio perfil:roles', 'public'),
    ('nutricionistas', 'policy:Nutri ve proprio perfil:using', 'auth.uid = id'),
    ('nutricionistas', 'policy:Nutri ve proprio perfil:check', '(nenhum)'),
    ('nutricionistas', 'policy:Nutri pode criar proprio perfil:cmd', 'insert'),
    ('nutricionistas', 'policy:Nutri pode criar proprio perfil:roles', 'public'),
    ('nutricionistas', 'policy:Nutri pode criar proprio perfil:using', '(nenhum)'),
    ('nutricionistas', 'policy:Nutri pode criar proprio perfil:check', 'auth.uid = id'),
    ('nutricionistas', 'policy:Nutri atualiza proprio perfil:cmd', 'update'),
    ('nutricionistas', 'policy:Nutri atualiza proprio perfil:roles', 'public'),
    ('nutricionistas', 'policy:Nutri atualiza proprio perfil:using', 'auth.uid = id'),
    ('nutricionistas', 'policy:Nutri atualiza proprio perfil:check', '(nenhum)'),
    ('pacientes', 'coluna:01', 'id uuid not null default gen_random_uuid()'),
    ('pacientes', 'coluna:02', 'nutri_id uuid not null'),
    ('pacientes', 'coluna:03', 'codigo text not null'),
    ('pacientes', 'coluna:04', 'nome text'),
    ('pacientes', 'coluna:05', 'email text'),
    ('pacientes', 'coluna:06', 'telefone text'),
    ('pacientes', 'coluna:07', 'status text default ''aguardando''::text'),
    ('pacientes', 'coluna:08', 'criado_em timestamp with time zone default now()'),
    ('pacientes', 'coluna:09', 'completado_em timestamp with time zone'),
    ('pacientes', 'coluna:10', 'pais text default ''brasil''::text'),
    ('pacientes', 'coluna:11', 'cep text'),
    ('pacientes', 'coluna:12', 'endereco text'),
    ('pacientes', 'coluna:13', 'bairro text'),
    ('pacientes', 'coluna:14', 'cidade text'),
    ('pacientes', 'coluna:15', 'uf text'),
    ('pacientes', 'coluna:16', 'instagram text'),
    ('pacientes', 'coluna:17', 'nascimento date'),
    ('pacientes', 'coluna:18', 'sexo text'),
    ('pacientes', 'coluna:19', 'profissao text'),
    ('pacientes', 'coluna:20', 'auth_user_id uuid'),
    ('pacientes', 'colunas:total', '20'),
    ('pacientes', 'constraint:pacientes_pkey', 'primary key (id)'),
    ('pacientes', 'constraint:pacientes_codigo_key', 'unique (codigo)'),
    ('pacientes', 'constraint:pacientes_nutri_id_fkey', 'foreign key (nutri_id) references nutricionistas(id) on delete cascade'),
    ('pacientes', 'constraint:pacientes_auth_user_id_fkey', 'foreign key (auth_user_id) references auth.users(id) on delete set null'),
    ('pacientes', 'indice:idx_pacientes_nutri', 'create index idx_pacientes_nutri on pacientes using btree (nutri_id)'),
    ('pacientes', 'indice:idx_pacientes_codigo', 'create index idx_pacientes_codigo on pacientes using btree (codigo)'),
    ('pacientes', 'indice:idx_pacientes_auth_user', 'create index idx_pacientes_auth_user on pacientes using btree (auth_user_id)'),
    ('pacientes', 'indice:uq_pacientes_auth_user', 'create unique index uq_pacientes_auth_user on pacientes using btree (auth_user_id) where (auth_user_id is not null)'),
    ('pacientes', 'rls', 'enabled'),
    ('pacientes', 'policy:Nutri ve proprios pacientes:cmd', 'all'),
    ('pacientes', 'policy:Nutri ve proprios pacientes:roles', 'authenticated'),
    ('pacientes', 'policy:Nutri ve proprios pacientes:using', 'auth.uid = nutri_id'),
    ('pacientes', 'policy:Nutri ve proprios pacientes:check', 'auth.uid = nutri_id'),
    ('pacientes', 'policy:pacientes_self_read:cmd', 'select'),
    ('pacientes', 'policy:pacientes_self_read:roles', 'authenticated'),
    ('pacientes', 'policy:pacientes_self_read:using', 'auth_user_id = auth.uid'),
    ('pacientes', 'policy:pacientes_self_read:check', '(nenhum)')
),
tabelas(nome) as (values ('avaliacoes'), ('codigos_convite'), ('codigos_uso'), ('exames'), ('nutricionistas'), ('pacientes'), ('recordatorio_calc'), ('respostas')),
funcoes(nome) as (values ('gerar_codigo_paciente'), ('handle_new_user'), ('registrar_uso_codigo'), ('rpc_buscar_paciente_por_codigo'), ('rpc_marcar_completo'), ('rpc_salvar_respostas'), ('validar_codigo_convite')),
gatilhos(nome) as (values ('on_auth_user_created'), ('trg_avaliacoes_atualizado')),

reg as (select t.nome, to_regclass('public.' || t.nome) as rel from tabelas t),

atual_colunas as (
  select r.nome as objeto,
         'coluna:' || lpad((row_number() over (partition by r.nome order by a.attnum))::text, 2, '0') as item,
         lower(regexp_replace(
           a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
           || case when a.attnotnull then ' not null' else '' end
           || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), ''),
           '\s+', ' ', 'g')) as valor
  from reg r
  join pg_attribute a on a.attrelid = r.rel and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where r.rel is not null
),
atual_total as (
  select r.nome, 'colunas:total', count(*)::text
  from reg r join pg_attribute a on a.attrelid = r.rel and a.attnum > 0 and not a.attisdropped
  where r.rel is not null group by r.nome
),
atual_constraints as (
  select r.nome, 'constraint:' || c.conname,
         lower(regexp_replace(replace(pg_get_constraintdef(c.oid), 'public.', ''), '\s+', ' ', 'g'))
  from reg r join pg_constraint c on c.conrelid = r.rel
  where r.rel is not null
),
atual_indices as (
  select r.nome, 'indice:' || i.indexname,
         lower(regexp_replace(replace(i.indexdef, 'public.', ''), '\s+', ' ', 'g'))
  from reg r
  join pg_indexes i on i.schemaname = 'public' and i.tablename = r.nome
  where r.rel is not null
    and not exists (select 1 from pg_constraint c
                     where c.conrelid = r.rel and c.conname = i.indexname)
),
atual_rls as (
  select r.nome, 'rls',
         case when c.relrowsecurity then 'enabled' else 'disabled' end
  from reg r join pg_class c on c.oid = r.rel where r.rel is not null
),
atual_policies as (
  select p.tablename, 'policy:' || p.policyname || ':cmd', lower(p.cmd)
  from pg_policies p where p.schemaname = 'public' and p.tablename in (select nome from tabelas)
  union all
  select p.tablename, 'policy:' || p.policyname || ':roles',
         lower(replace(array_to_string(p.roles, ','), ' ', ''))
  from pg_policies p where p.schemaname = 'public' and p.tablename in (select nome from tabelas)
  union all
  select p.tablename, 'policy:' || p.policyname || ':using',
         case when p.qual is null then '(nenhum)'
              else lower(regexp_replace(translate(replace(p.qual, 'public.', ''), '()', '  '), '\s+', ' ', 'g')) end
  from pg_policies p where p.schemaname = 'public' and p.tablename in (select nome from tabelas)
  union all
  select p.tablename, 'policy:' || p.policyname || ':check',
         case when p.with_check is null then '(nenhum)'
              else lower(regexp_replace(translate(replace(p.with_check, 'public.', ''), '()', '  '), '\s+', ' ', 'g')) end
  from pg_policies p where p.schemaname = 'public' and p.tablename in (select nome from tabelas)
),
atual_funcoes as (
  select 'fn:' || p.proname, 'assinatura',
         lower(regexp_replace(pg_get_function_identity_arguments(p.oid), '\s+', ' ', 'g'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (select nome from funcoes)
  union all
  select 'fn:' || p.proname, 'linguagem', l.lanname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public' and p.proname in (select nome from funcoes)
  union all
  select 'fn:' || p.proname, 'security',
         case when p.prosecdef then 'definer' else 'invoker' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (select nome from funcoes)
  union all
  select 'fn:' || p.proname, 'search_path',
         coalesce((select replace(c, 'search_path=', '')
                     from unnest(p.proconfig) c where c like 'search_path=%'), '(sem set)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (select nome from funcoes)
  union all
  select 'fn:' || p.proname, 'corpo',
         lower(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (select nome from funcoes)
),
atual_triggers as (
  select 'trg:' || t.tgname, 'definicao',
         lower(regexp_replace(replace(pg_get_triggerdef(t.oid), 'public.', ''), '\s+', ' ', 'g'))
  from pg_trigger t
  where not t.tgisinternal and t.tgname in (select nome from gatilhos)
),
atual_enabled as (
  select 'trg:' || t.tgname, 'enabled',
         case t.tgenabled when 'D' then 'DESABILITADO' else 'habilitado' end
  from pg_trigger t
  where not t.tgisinternal and t.tgname in (select nome from gatilhos)
),
atual(objeto, item, valor) as (
  select objeto, item, btrim(valor) from (
    select * from atual_colunas
    union all select * from atual_total
    union all select * from atual_constraints
    union all select * from atual_indices
    union all select * from atual_rls
    union all select * from atual_policies
    union all select * from atual_funcoes
    union all select * from atual_triggers
    union all select * from atual_enabled
  ) t(objeto, item, valor)
),
comparado as (
  select
    coalesce(e.objeto, a.objeto) as objeto,
    coalesce(e.item, a.item)     as item,
    case
      when a.valor is null then 'AUSENTE NO BANCO'
      when e.valor is null then 'SO NO BANCO'
      when e.valor = a.valor then 'OK'
      else 'DIFF'
    end as resultado,
    e.valor as baseline,
    a.valor as banco
  from esperado e
  full outer join atual a on a.objeto = e.objeto and a.item = e.item
),
resumo as (
  select
    'zz TOTAL' as objeto,
    (select count(distinct objeto) from comparado where objeto not like 'fn:%' and objeto not like 'trg:%')::text
      || ' tabelas / '
      || (select count(distinct objeto) from comparado where objeto like 'fn:%')::text
      || ' RPCs / '
      || (select count(distinct objeto) from comparado where objeto like 'trg:%')::text
      || ' triggers' as item,
    case when exists (select 1 from comparado where resultado <> 'OK')
         then (select count(*)::text from comparado where resultado <> 'OK') || ' DIVERGENCIA(S)'
         else 'SEM DIVERGENCIAS' end as resultado,
    null::text as baseline,
    null::text as banco
)
select * from comparado where resultado <> 'OK'
union all
select * from (
  select objeto, 'z ' || count(*)::text || ' itens conferidos' as item,
         'OK' as resultado, null::text, null::text
  from comparado where resultado = 'OK' group by objeto
) ok
union all
select * from resumo
order by objeto, item;
