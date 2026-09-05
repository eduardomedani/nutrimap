-- ===========================================================================
-- ETAPA 3.5 — PRONTIDAO PARA A MIGRACAO MULTIUSUARIO
-- ---------------------------------------------------------------------------
-- ARQUIVO GERADO. Regenere com:  node test/inventario-repositorio.mjs
-- A fonte e db/*.sql. Editar aqui cria a segunda fonte que o gerador evita.
--
-- NAO ALTERA NADA. So le catalogo.
--
-- Compara o que os SQLs versionados DECLARAM com o que o banco TEM, objeto a
-- objeto, e diz por modulo se da para migrar a policy dele.
--
-- Baseline, desfazer e conferencia ficam de fora do lado "esperado": um e
-- retrato, outro e rollback, o terceiro so le. Conta-los como migration nao
-- aplicada encheria o relatorio de falso alarme.
--
-- COMO LER:
--   AUSENTE NO BANCO        versionado e nunca aplicado
--   AUSENTE NO REPOSITORIO  existe no banco e ninguem versionou
--   <<< O FRONTEND USA      prioridade maxima: a tela chama e o objeto nao existe
--
-- Para colar no SQL Editor, use db/conferencia/79_prontidao_multiusuario_LIMPO.sql
-- ===========================================================================

with esperado(tipo, nome, tabela, modulo, arquivo, front_usa) as (
  values
    ('tabela', 'admins', '', 'CONVITES SaaS', 'admin_convites.sql', false),
    ('funcao', 'admin_is', '', 'CONVITES SaaS', 'admin_convites.sql', false),
    ('funcao', 'admin_gerar_codigo', '', 'CONVITES SaaS', 'admin_convites.sql', true),
    ('funcao', 'admin_listar_codigos', '', 'CONVITES SaaS', 'admin_convites.sql', true),
    ('funcao', 'admin_definir_ativo', '', 'CONVITES SaaS', 'admin_convites.sql', true),
    ('funcao', 'validar_codigo_convite', '', 'LEGADO CENTRAL', 'auth_legacy_rpcs_baseline.sql', true),
    ('funcao', 'registrar_uso_codigo', '', 'LEGADO CENTRAL', 'auth_legacy_rpcs_baseline.sql', true),
    ('funcao', 'rpc_buscar_paciente_por_codigo', '', 'LEGADO CENTRAL', 'auth_legacy_rpcs_baseline.sql', true),
    ('funcao', 'rpc_marcar_completo', '', 'LEGADO CENTRAL', 'auth_legacy_rpcs_baseline.sql', true),
    ('funcao', 'rpc_salvar_respostas', '', 'LEGADO CENTRAL', 'auth_legacy_rpcs_baseline.sql', true),
    ('funcao', 'gerar_codigo_paciente', '', 'LEGADO CENTRAL', 'auth_legacy_rpcs_baseline.sql', true),
    ('funcao', 'handle_new_user', '', 'LEGADO CENTRAL', 'auth_signup_baseline.sql', false),
    ('tabela', 'checkin_modelos', '', 'CHECK-INS', 'checkin_schema.sql', true),
    ('tabela', 'checkin_perguntas', '', 'CHECK-INS', 'checkin_schema.sql', true),
    ('tabela', 'checkin_atribuicoes', '', 'CHECK-INS', 'checkin_schema.sql', true),
    ('tabela', 'checkin_ocorrencias', '', 'CHECK-INS', 'checkin_schema.sql', true),
    ('tabela', 'checkin_respostas', '', 'CHECK-INS', 'checkin_schema.sql', true),
    ('tabela', 'checkin_auditoria', '', 'CHECK-INS', 'checkin_schema.sql', false),
    ('funcao', 'registrar_auditoria_checkin', '', 'CHECK-INS', 'checkin_schema.sql', false),
    ('funcao', 'tocar_checkin', '', 'CHECK-INS', 'checkin_schema.sql', false),
    ('funcao', 'materializar_ocorrencia_checkin', '', 'CHECK-INS', 'checkin_schema.sql', true),
    ('funcao', 'finalizar_checkin', '', 'CHECK-INS', 'checkin_schema.sql', true),
    ('trigger', 'trg_aud_ckm', 'checkin_modelos', 'CHECK-INS', 'checkin_schema.sql', null),
    ('trigger', 'trg_aud_cka', 'checkin_atribuicoes', 'CHECK-INS', 'checkin_schema.sql', null),
    ('trigger', 'trg_aud_cko', 'checkin_ocorrencias', 'CHECK-INS', 'checkin_schema.sql', null),
    ('trigger', 'trg_tocar_ckm', 'checkin_modelos', 'CHECK-INS', 'checkin_schema.sql', null),
    ('trigger', 'trg_tocar_ckp', 'checkin_perguntas', 'CHECK-INS', 'checkin_schema.sql', null),
    ('trigger', 'trg_tocar_cka', 'checkin_atribuicoes', 'CHECK-INS', 'checkin_schema.sql', null),
    ('policy', 'ckm_nutri_all', 'checkin_modelos', 'CHECK-INS', 'checkin_schema.sql', null),
    ('policy', 'ckp_nutri_all', 'checkin_perguntas', 'CHECK-INS', 'checkin_schema.sql', null),
    ('policy', 'cka_nutri_select', 'checkin_atribuicoes', 'CHECK-INS', 'checkin_schema.sql', null),
    ('policy', 'cka_nutri_insert', 'checkin_atribuicoes', 'CHECK-INS', 'checkin_schema.sql', null),
    ('policy', 'cka_nutri_update', 'checkin_atribuicoes', 'CHECK-INS', 'checkin_schema.sql', null),
    ('policy', 'cka_nutri_delete', 'checkin_atribuicoes', 'CHECK-INS', 'checkin_schema.sql', null),
    ('policy', 'cko_nutri_all', 'checkin_ocorrencias', 'CHECK-INS', 'checkin_schema.sql', null),
    ('policy', 'cko_paciente_select', 'checkin_ocorrencias', 'CHECK-INS', 'checkin_schema.sql', null),
    ('policy', 'ckr_nutri_select', 'checkin_respostas', 'CHECK-INS', 'checkin_schema.sql', null),
    ('policy', 'ckr_paciente_select', 'checkin_respostas', 'CHECK-INS', 'checkin_schema.sql', null),
    ('policy', 'ckaud_nutri_select', 'checkin_auditoria', 'CHECK-INS', 'checkin_schema.sql', null),
    ('tabela', 'avaliacoes', '', 'LEGADO CENTRAL', 'clinico_legacy_baseline.sql', true),
    ('tabela', 'respostas', '', 'LEGADO CENTRAL', 'clinico_legacy_baseline.sql', true),
    ('tabela', 'exames', '', 'LEGADO CENTRAL', 'clinico_legacy_baseline.sql', false),
    ('tabela', 'recordatorio_calc', '', 'LEGADO CENTRAL', 'clinico_legacy_baseline.sql', true),
    ('trigger', 'trg_avaliacoes_atualizado', 'avaliacoes', 'LEGADO CENTRAL', 'clinico_legacy_baseline.sql', null),
    ('policy', 'Nutri ve proprias avaliacoes', 'avaliacoes', 'LEGADO CENTRAL', 'clinico_legacy_baseline.sql', null),
    ('policy', 'Nutri ve respostas dos seus pacientes', 'respostas', 'LEGADO CENTRAL', 'clinico_legacy_baseline.sql', null),
    ('policy', 'Nutri ve exames dos seus pacientes', 'exames', 'LEGADO CENTRAL', 'clinico_legacy_baseline.sql', null),
    ('policy', 'Nutri ve cache dos seus pacientes', 'recordatorio_calc', 'LEGADO CENTRAL', 'clinico_legacy_baseline.sql', null),
    ('tabela', 'colaborador_documentos', '', 'DOCUMENTOS DO COLABORADOR', 'colaborador_documentos.sql', true),
    ('funcao', 'documento_e_meu', '', 'DOCUMENTOS DO COLABORADOR', 'colaborador_documentos.sql', false),
    ('funcao', 'marcar_documento_visualizado', '', 'DOCUMENTOS DO COLABORADOR', 'colaborador_documentos.sql', true),
    ('view', 'documentos_por_competencia', '', 'DOCUMENTOS DO COLABORADOR', 'colaborador_documentos.sql', null),
    ('policy', 'cd_nutri_select', 'colaborador_documentos', 'DOCUMENTOS DO COLABORADOR', 'colaborador_documentos.sql', null),
    ('policy', 'cd_nutri_insert', 'colaborador_documentos', 'DOCUMENTOS DO COLABORADOR', 'colaborador_documentos.sql', null),
    ('policy', 'cd_nutri_update', 'colaborador_documentos', 'DOCUMENTOS DO COLABORADOR', 'colaborador_documentos.sql', null),
    ('policy', 'cd_nutri_delete', 'colaborador_documentos', 'DOCUMENTOS DO COLABORADOR', 'colaborador_documentos.sql', null),
    ('policy', 'cd_colaborador_select', 'colaborador_documentos', 'DOCUMENTOS DO COLABORADOR', 'colaborador_documentos.sql', null),
    ('bucket', 'colaborador-documentos', '', 'DOCUMENTOS DO COLABORADOR', 'colaborador_documentos.sql', false),
    ('funcao', 'comercial_alunos_por_turno', '', 'COMERCIAL', 'comercial_alunos_por_turno.sql', true),
    ('funcao', 'fn_lancamento_paciente_do_nutri', '', 'COMERCIAL', 'comercial_etapa1_vinculo.sql', false),
    ('trigger', 'trg_lancamento_paciente_do_nutri', 'financeiro_lancamentos', 'COMERCIAL', 'comercial_etapa1_vinculo.sql', null),
    ('tabela', 'comercial_planos', '', 'COMERCIAL', 'comercial_etapa2_planos.sql', true),
    ('tabela', 'comercial_assinaturas', '', 'COMERCIAL', 'comercial_etapa2_planos.sql', true),
    ('funcao', 'fn_comercial_touch', '', 'COMERCIAL', 'comercial_etapa2_planos.sql', false),
    ('trigger', 'trg_comercial_planos_touch', 'comercial_planos', 'COMERCIAL', 'comercial_etapa2_planos.sql', null),
    ('trigger', 'trg_comercial_assinaturas_touch', 'comercial_assinaturas', 'COMERCIAL', 'comercial_etapa2_planos.sql', null),
    ('policy', 'comercial_planos_select', 'comercial_planos', 'COMERCIAL', 'comercial_etapa2_planos.sql', null),
    ('policy', 'comercial_planos_insert', 'comercial_planos', 'COMERCIAL', 'comercial_etapa2_planos.sql', null),
    ('policy', 'comercial_planos_update', 'comercial_planos', 'COMERCIAL', 'comercial_etapa2_planos.sql', null),
    ('policy', 'comercial_planos_delete', 'comercial_planos', 'COMERCIAL', 'comercial_etapa2_planos.sql', null),
    ('policy', 'comercial_assinaturas_select', 'comercial_assinaturas', 'COMERCIAL', 'comercial_etapa2_planos.sql', null),
    ('policy', 'comercial_assinaturas_insert', 'comercial_assinaturas', 'COMERCIAL', 'comercial_etapa2_planos.sql', null),
    ('policy', 'comercial_assinaturas_update', 'comercial_assinaturas', 'COMERCIAL', 'comercial_etapa2_planos.sql', null),
    ('policy', 'comercial_assinaturas_delete', 'comercial_assinaturas', 'COMERCIAL', 'comercial_etapa2_planos.sql', null),
    ('funcao', 'comercial_registrar_pagamento', '', 'COMERCIAL', 'comercial_pagamento_transacional.sql', true),
    ('tabela', 'comercial_competencia_antes', '', 'COMERCIAL', 'comercial_periodo_da_cobranca.sql', false),
    ('funcao', 'comercial_criar_cobranca_do_periodo', '', 'COMERCIAL', 'comercial_periodo_da_cobranca.sql', true),
    ('tabela', 'comercial_assinatura_auditoria', '', 'COMERCIAL', 'comercial_renovacao_programada.sql', false),
    ('funcao', 'comercial_cancelar_cobranca', '', 'COMERCIAL', 'comercial_renovacao_programada.sql', true),
    ('policy', 'comercial_assinatura_auditoria_select', 'comercial_assinatura_auditoria', 'COMERCIAL', 'comercial_renovacao_programada.sql', null),
    ('tabela', 'consultas', '', 'AGENDA', 'consultas_schema.sql', true),
    ('policy', 'consultas_select', 'consultas', 'AGENDA', 'consultas_schema.sql', null),
    ('policy', 'consultas_insert', 'consultas', 'AGENDA', 'consultas_schema.sql', null),
    ('policy', 'consultas_update', 'consultas', 'AGENDA', 'consultas_schema.sql', null),
    ('policy', 'consultas_delete', 'consultas', 'AGENDA', 'consultas_schema.sql', null),
    ('bucket', 'contracheques', '', 'DOCUMENTOS DO COLABORADOR', 'contracheque_publicado.sql', false),
    ('tabela', 'codigos_convite', '', 'LEGADO CENTRAL', 'convites_legacy_baseline.sql', false),
    ('tabela', 'codigos_uso', '', 'LEGADO CENTRAL', 'convites_legacy_baseline.sql', false),
    ('policy', 'planos_paciente_read', 'planos_alimentares', 'ALIMENTACAO', 'dieta_paciente_leitura.sql', null),
    ('policy', 'refeicoes_paciente_read', 'plano_refeicoes', 'ALIMENTACAO', 'dieta_paciente_leitura.sql', null),
    ('policy', 'ritens_paciente_read', 'refeicao_itens', 'ALIMENTACAO', 'dieta_paciente_leitura.sql', null),
    ('policy', 'alimentos_paciente_read', 'alimentos', 'ALIMENTACAO', 'dieta_paciente_leitura.sql', null),
    ('policy', 'foods_paciente_read', 'foods', 'ALIMENTACAO', 'dieta_paciente_leitura.sql', null),
    ('policy', 'food_measures_paciente_read', 'food_measures', 'ALIMENTACAO', 'dieta_paciente_leitura.sql', null),
    ('tabela', 'alimentos', '', 'ALIMENTACAO', 'dieta_schema.sql', true),
    ('tabela', 'planos_alimentares', '', 'ALIMENTACAO', 'dieta_schema.sql', true),
    ('tabela', 'plano_refeicoes', '', 'ALIMENTACAO', 'dieta_schema.sql', true),
    ('tabela', 'refeicao_itens', '', 'ALIMENTACAO', 'dieta_schema.sql', true),
    ('funcao', 'paciente_do_auth', '', 'ALIMENTACAO', 'dieta_schema.sql', false),
    ('policy', 'alimentos_owner', 'alimentos', 'ALIMENTACAO', 'dieta_schema.sql', null),
    ('policy', 'planos_owner', 'planos_alimentares', 'ALIMENTACAO', 'dieta_schema.sql', null),
    ('policy', 'refeicoes_owner', 'plano_refeicoes', 'ALIMENTACAO', 'dieta_schema.sql', null),
    ('policy', 'ritens_owner', 'refeicao_itens', 'ALIMENTACAO', 'dieta_schema.sql', null),
    ('tabela', 'documentos_pendentes', '', 'DOCUMENTOS DO PACIENTE', 'documentos_etapa2.sql', true),
    ('tabela', 'documento_auditoria', '', 'DOCUMENTOS DO PACIENTE', 'documentos_etapa2.sql', true),
    ('funcao', 'registrar_auditoria_documento', '', 'DOCUMENTOS DO PACIENTE', 'documentos_etapa2.sql', false),
    ('funcao', 'vincular_documento_pendente', '', 'DOCUMENTOS DO PACIENTE', 'documentos_etapa2.sql', true),
    ('trigger', 'trg_auditoria_documento', 'colaborador_documentos', 'DOCUMENTOS DO PACIENTE', 'documentos_etapa2.sql', null),
    ('policy', 'dp_nutri_all', 'documentos_pendentes', 'DOCUMENTOS DO PACIENTE', 'documentos_etapa2.sql', null),
    ('policy', 'da_nutri_select', 'documento_auditoria', 'DOCUMENTOS DO PACIENTE', 'documentos_etapa2.sql', null),
    ('tabela', 'financeiro_centros_custo', '', 'FINANCEIRO', 'financeiro_despesas_etapa1.sql', true),
    ('tabela', 'financeiro_auditoria', '', 'FINANCEIRO', 'financeiro_despesas_etapa1.sql', true),
    ('funcao', 'sincronizar_pago_status', '', 'FINANCEIRO', 'financeiro_despesas_etapa1.sql', false),
    ('funcao', 'registrar_auditoria_financeiro', '', 'FINANCEIRO', 'financeiro_despesas_etapa1.sql', false),
    ('view', 'financeiro_resumo_mensal', '', 'FINANCEIRO', 'financeiro_despesas_etapa1.sql', null),
    ('trigger', 'trg_sincronizar_pago_status', 'financeiro_lancamentos', 'FINANCEIRO', 'financeiro_despesas_etapa1.sql', null),
    ('trigger', 'trg_auditoria_financeiro', 'financeiro_lancamentos', 'FINANCEIRO', 'financeiro_despesas_etapa1.sql', null),
    ('policy', 'financeiro_centros_custo_select', 'financeiro_centros_custo', 'FINANCEIRO', 'financeiro_despesas_etapa1.sql', null),
    ('policy', 'financeiro_centros_custo_insert', 'financeiro_centros_custo', 'FINANCEIRO', 'financeiro_despesas_etapa1.sql', null),
    ('policy', 'financeiro_centros_custo_update', 'financeiro_centros_custo', 'FINANCEIRO', 'financeiro_despesas_etapa1.sql', null),
    ('policy', 'financeiro_centros_custo_delete', 'financeiro_centros_custo', 'FINANCEIRO', 'financeiro_despesas_etapa1.sql', null),
    ('policy', 'financeiro_auditoria_select', 'financeiro_auditoria', 'FINANCEIRO', 'financeiro_despesas_etapa1.sql', null),
    ('policy', 'financeiro_lancamentos_insert', 'financeiro_lancamentos', 'FINANCEIRO', 'financeiro_despesas_etapa1.sql', null),
    ('policy', 'financeiro_lancamentos_update', 'financeiro_lancamentos', 'FINANCEIRO', 'financeiro_despesas_etapa1.sql', null),
    ('funcao', 'financeiro_folha_sincronizar', '', 'FINANCEIRO', 'financeiro_folha_despesa.sql', false),
    ('funcao', 'financeiro_lancar_folha', '', 'FINANCEIRO', 'financeiro_folha_despesa.sql', true),
    ('tabela', 'financeiro_categorias', '', 'FINANCEIRO', 'financeiro_lancamentos.sql', true),
    ('tabela', 'financeiro_lancamentos', '', 'FINANCEIRO', 'financeiro_lancamentos.sql', true),
    ('policy', 'financeiro_categorias_select', 'financeiro_categorias', 'FINANCEIRO', 'financeiro_lancamentos.sql', null),
    ('policy', 'financeiro_categorias_insert', 'financeiro_categorias', 'FINANCEIRO', 'financeiro_lancamentos.sql', null),
    ('policy', 'financeiro_categorias_update', 'financeiro_categorias', 'FINANCEIRO', 'financeiro_lancamentos.sql', null),
    ('policy', 'financeiro_categorias_delete', 'financeiro_categorias', 'FINANCEIRO', 'financeiro_lancamentos.sql', null),
    ('policy', 'financeiro_lancamentos_select', 'financeiro_lancamentos', 'FINANCEIRO', 'financeiro_lancamentos.sql', null),
    ('policy', 'financeiro_lancamentos_delete', 'financeiro_lancamentos', 'FINANCEIRO', 'financeiro_lancamentos.sql', null),
    ('view', 'folha_resumo_mensal', '', 'FINANCEIRO', 'financeiro_resumo.sql', null),
    ('view', 'folha_resumo_colaborador', '', 'FINANCEIRO', 'financeiro_resumo.sql', null),
    ('tabela', 'folha_arquivos', '', 'EQUIPE', 'folha_arquivos.sql', true),
    ('policy', 'folha_arquivos_select', 'folha_arquivos', 'EQUIPE', 'folha_arquivos.sql', null),
    ('policy', 'folha_arquivos_insert', 'folha_arquivos', 'EQUIPE', 'folha_arquivos.sql', null),
    ('policy', 'folha_arquivos_update', 'folha_arquivos', 'EQUIPE', 'folha_arquivos.sql', null),
    ('tabela', 'folhas', '', 'EQUIPE', 'folha_schema.sql', true),
    ('tabela', 'folha_itens', '', 'EQUIPE', 'folha_schema.sql', true),
    ('tabela', 'folha_adicionais', '', 'EQUIPE', 'folha_schema.sql', true),
    ('view', 'folha_itens_totais', '', 'EQUIPE', 'folha_schema.sql', null),
    ('policy', 'folhas_select', 'folhas', 'EQUIPE', 'folha_schema.sql', null),
    ('policy', 'folhas_insert', 'folhas', 'EQUIPE', 'folha_schema.sql', null),
    ('policy', 'folhas_update', 'folhas', 'EQUIPE', 'folha_schema.sql', null),
    ('policy', 'folhas_delete', 'folhas', 'EQUIPE', 'folha_schema.sql', null),
    ('policy', 'folha_itens_select', 'folha_itens', 'EQUIPE', 'folha_schema.sql', null),
    ('policy', 'folha_itens_insert', 'folha_itens', 'EQUIPE', 'folha_schema.sql', null),
    ('policy', 'folha_itens_update', 'folha_itens', 'EQUIPE', 'folha_schema.sql', null),
    ('policy', 'folha_itens_delete', 'folha_itens', 'EQUIPE', 'folha_schema.sql', null),
    ('policy', 'folha_adicionais_select', 'folha_adicionais', 'EQUIPE', 'folha_schema.sql', null),
    ('policy', 'folha_adicionais_insert', 'folha_adicionais', 'EQUIPE', 'folha_schema.sql', null),
    ('policy', 'folha_adicionais_update', 'folha_adicionais', 'EQUIPE', 'folha_schema.sql', null),
    ('policy', 'folha_adicionais_delete', 'folha_adicionais', 'EQUIPE', 'folha_schema.sql', null),
    ('funcao', 'singularizar_palavra', '', 'BANCO DE ALIMENTOS', 'foods_busca_v2.sql', false),
    ('funcao', 'singularizar_texto', '', 'BANCO DE ALIMENTOS', 'foods_busca_v2.sql', false),
    ('funcao', 'texto_busca', '', 'BANCO DE ALIMENTOS', 'foods_busca_v2.sql', false),
    ('funcao', 'palavras_busca', '', 'BANCO DE ALIMENTOS', 'foods_busca_v2.sql', false),
    ('funcao', 'foods_buscar', '', 'BANCO DE ALIMENTOS', 'foods_busca_v2.sql', true),
    ('tabela', 'food_categories', '', 'BANCO DE ALIMENTOS', 'foods_schema.sql', false),
    ('tabela', 'foods', '', 'BANCO DE ALIMENTOS', 'foods_schema.sql', true),
    ('tabela', 'food_measures', '', 'BANCO DE ALIMENTOS', 'foods_schema.sql', true),
    ('tabela', 'food_aliases', '', 'BANCO DE ALIMENTOS', 'foods_schema.sql', false),
    ('tabela', 'food_substitutions', '', 'BANCO DE ALIMENTOS', 'foods_schema.sql', false),
    ('tabela', 'recipes', '', 'BANCO DE ALIMENTOS', 'foods_schema.sql', false),
    ('tabela', 'recipe_items', '', 'BANCO DE ALIMENTOS', 'foods_schema.sql', false),
    ('tabela', 'favorite_foods', '', 'BANCO DE ALIMENTOS', 'foods_schema.sql', true),
    ('tabela', 'recent_foods', '', 'BANCO DE ALIMENTOS', 'foods_schema.sql', true),
    ('funcao', 'f_unaccent', '', 'BANCO DE ALIMENTOS', 'foods_schema.sql', false),
    ('funcao', 'normalizar_texto', '', 'BANCO DE ALIMENTOS', 'foods_schema.sql', false),
    ('funcao', 'set_atualizado_em', '', 'BANCO DE ALIMENTOS', 'foods_schema.sql', false),
    ('view', 'recipe_macros', '', 'BANCO DE ALIMENTOS', 'foods_schema.sql', null),
    ('trigger', 'trg_foods_atualizado', 'foods', 'BANCO DE ALIMENTOS', 'foods_schema.sql', null),
    ('policy', 'food_categories_read', 'food_categories', 'BANCO DE ALIMENTOS', 'foods_schema.sql', null),
    ('policy', 'foods_select', 'foods', 'BANCO DE ALIMENTOS', 'foods_schema.sql', null),
    ('policy', 'foods_modify', 'foods', 'BANCO DE ALIMENTOS', 'foods_schema.sql', null),
    ('policy', 'food_measures_select', 'food_measures', 'BANCO DE ALIMENTOS', 'foods_schema.sql', null),
    ('policy', 'food_measures_modify', 'food_measures', 'BANCO DE ALIMENTOS', 'foods_schema.sql', null),
    ('policy', 'food_aliases_select', 'food_aliases', 'BANCO DE ALIMENTOS', 'foods_schema.sql', null),
    ('policy', 'food_aliases_modify', 'food_aliases', 'BANCO DE ALIMENTOS', 'foods_schema.sql', null),
    ('policy', 'food_subs_select', 'food_substitutions', 'BANCO DE ALIMENTOS', 'foods_schema.sql', null),
    ('policy', 'food_subs_modify', 'food_substitutions', 'BANCO DE ALIMENTOS', 'foods_schema.sql', null),
    ('policy', 'recipes_owner', 'recipes', 'BANCO DE ALIMENTOS', 'foods_schema.sql', null),
    ('policy', 'recipe_items_owner', 'recipe_items', 'BANCO DE ALIMENTOS', 'foods_schema.sql', null),
    ('policy', 'favorite_foods_owner', 'favorite_foods', 'BANCO DE ALIMENTOS', 'foods_schema.sql', null),
    ('policy', 'recent_foods_owner', 'recent_foods', 'BANCO DE ALIMENTOS', 'foods_schema.sql', null),
    ('tabela', 'funcionarios', '', 'EQUIPE', 'funcionarios_schema.sql', true),
    ('policy', 'funcionarios_select', 'funcionarios', 'EQUIPE', 'funcionarios_schema.sql', null),
    ('policy', 'funcionarios_insert', 'funcionarios', 'EQUIPE', 'funcionarios_schema.sql', null),
    ('policy', 'funcionarios_update', 'funcionarios', 'EQUIPE', 'funcionarios_schema.sql', null),
    ('policy', 'funcionarios_delete', 'funcionarios', 'EQUIPE', 'funcionarios_schema.sql', null),
    ('funcao', 'gerar_codigo_funcionario', '', 'EQUIPE', 'funcionario_login_schema.sql', false),
    ('funcao', 'funcionario_do_auth', '', 'EQUIPE', 'funcionario_login_schema.sql', false),
    ('funcao', 'folha_esta_fechada', '', 'EQUIPE', 'funcionario_login_schema.sql', false),
    ('funcao', 'folha_tem_linha_minha', '', 'EQUIPE', 'funcionario_login_schema.sql', false),
    ('funcao', 'item_e_meu', '', 'EQUIPE', 'funcionario_login_schema.sql', false),
    ('funcao', 'vincular_funcionario', '', 'EQUIPE', 'funcionario_login_schema.sql', true),
    ('policy', 'funcionarios_self_read', 'funcionarios', 'EQUIPE', 'funcionario_login_schema.sql', null),
    ('policy', 'folhas_funcionario_read', 'folhas', 'EQUIPE', 'funcionario_login_schema.sql', null),
    ('policy', 'folha_itens_funcionario_read', 'folha_itens', 'EQUIPE', 'funcionario_login_schema.sql', null),
    ('policy', 'folha_adicionais_funcionario_read', 'folha_adicionais', 'EQUIPE', 'funcionario_login_schema.sql', null),
    ('bucket', 'ponto', '', 'EQUIPE', 'funcionario_login_schema.sql', false),
    ('tabela', 'paciente_metas', '', 'TIMELINE E HUB', 'hub_metas_tarefas.sql', true),
    ('tabela', 'paciente_tarefas', '', 'TIMELINE E HUB', 'hub_metas_tarefas.sql', true),
    ('policy', 'paciente_metas_select', 'paciente_metas', 'TIMELINE E HUB', 'hub_metas_tarefas.sql', null),
    ('policy', 'paciente_metas_insert', 'paciente_metas', 'TIMELINE E HUB', 'hub_metas_tarefas.sql', null),
    ('policy', 'paciente_metas_write', 'paciente_metas', 'TIMELINE E HUB', 'hub_metas_tarefas.sql', null),
    ('policy', 'paciente_metas_delete', 'paciente_metas', 'TIMELINE E HUB', 'hub_metas_tarefas.sql', null),
    ('policy', 'paciente_tarefas_select', 'paciente_tarefas', 'TIMELINE E HUB', 'hub_metas_tarefas.sql', null),
    ('policy', 'paciente_tarefas_insert', 'paciente_tarefas', 'TIMELINE E HUB', 'hub_metas_tarefas.sql', null),
    ('policy', 'paciente_tarefas_write', 'paciente_tarefas', 'TIMELINE E HUB', 'hub_metas_tarefas.sql', null),
    ('policy', 'paciente_tarefas_delete', 'paciente_tarefas', 'TIMELINE E HUB', 'hub_metas_tarefas.sql', null),
    ('policy', 'pacientes_select', 'pacientes', 'OUTRO', 'multiusuario_etapa4b_rls.sql', null),
    ('policy', 'pacientes_insert', 'pacientes', 'OUTRO', 'multiusuario_etapa4b_rls.sql', null),
    ('policy', 'pacientes_update', 'pacientes', 'OUTRO', 'multiusuario_etapa4b_rls.sql', null),
    ('policy', 'pacientes_delete', 'pacientes', 'OUTRO', 'multiusuario_etapa4b_rls.sql', null),
    ('tabela', 'nutricionistas', '', 'LEGADO CENTRAL', 'nutricionistas_legacy_baseline.sql', true),
    ('policy', 'Nutri ve proprio perfil', 'nutricionistas', 'LEGADO CENTRAL', 'nutricionistas_legacy_baseline.sql', null),
    ('policy', 'Nutri pode criar proprio perfil', 'nutricionistas', 'LEGADO CENTRAL', 'nutricionistas_legacy_baseline.sql', null),
    ('policy', 'Nutri atualiza proprio perfil', 'nutricionistas', 'LEGADO CENTRAL', 'nutricionistas_legacy_baseline.sql', null),
    ('tabela', 'organizacoes', '', 'MULTIUSUARIO', 'organizacao_schema.sql', false),
    ('tabela', 'perfis', '', 'MULTIUSUARIO', 'organizacao_schema.sql', true),
    ('tabela', 'permissoes', '', 'MULTIUSUARIO', 'organizacao_schema.sql', false),
    ('tabela', 'perfil_permissoes', '', 'MULTIUSUARIO', 'organizacao_schema.sql', false),
    ('tabela', 'organizacao_usuarios', '', 'MULTIUSUARIO', 'organizacao_schema.sql', true),
    ('tabela', 'usuario_permissoes', '', 'MULTIUSUARIO', 'organizacao_schema.sql', false),
    ('funcao', 'organizacao_do_auth', '', 'MULTIUSUARIO', 'organizacao_schema.sql', true),
    ('funcao', 'tem_permissao', '', 'MULTIUSUARIO', 'organizacao_schema.sql', false),
    ('funcao', 'minhas_permissoes', '', 'MULTIUSUARIO', 'organizacao_schema.sql', true),
    ('trigger', 'trg_organizacoes_atualizado', 'organizacoes', 'MULTIUSUARIO', 'organizacao_schema.sql', null),
    ('trigger', 'trg_perfis_atualizado', 'perfis', 'MULTIUSUARIO', 'organizacao_schema.sql', null),
    ('trigger', 'trg_organizacao_usuarios_atualizado', 'organizacao_usuarios', 'MULTIUSUARIO', 'organizacao_schema.sql', null),
    ('policy', 'org_select_propria', 'organizacoes', 'MULTIUSUARIO', 'organizacao_schema.sql', null),
    ('policy', 'org_usuarios_select_propria', 'organizacao_usuarios', 'MULTIUSUARIO', 'organizacao_schema.sql', null),
    ('policy', 'perfis_select_visiveis', 'perfis', 'MULTIUSUARIO', 'organizacao_schema.sql', null),
    ('policy', 'permissoes_select_catalogo', 'permissoes', 'MULTIUSUARIO', 'organizacao_schema.sql', null),
    ('tabela', 'organizacao_convites', '', 'MULTIUSUARIO', 'organizacao_usuarios_admin.sql', false),
    ('tabela', 'organizacao_auditoria', '', 'MULTIUSUARIO', 'organizacao_usuarios_admin.sql', false),
    ('funcao', 'gerar_codigo_organizacao', '', 'MULTIUSUARIO', 'organizacao_usuarios_admin.sql', false),
    ('funcao', 'fn_protege_ultimo_proprietario', '', 'MULTIUSUARIO', 'organizacao_usuarios_admin.sql', false),
    ('funcao', 'exige_permissao', '', 'MULTIUSUARIO', 'organizacao_usuarios_admin.sql', false),
    ('funcao', 'usuario_convidar', '', 'MULTIUSUARIO', 'organizacao_usuarios_admin.sql', false),
    ('funcao', 'usuario_vincular', '', 'MULTIUSUARIO', 'organizacao_usuarios_admin.sql', false),
    ('funcao', 'usuario_definir_perfil', '', 'MULTIUSUARIO', 'organizacao_usuarios_admin.sql', false),
    ('funcao', 'usuario_definir_status', '', 'MULTIUSUARIO', 'organizacao_usuarios_admin.sql', false),
    ('funcao', 'usuario_definir_permissao', '', 'MULTIUSUARIO', 'organizacao_usuarios_admin.sql', false),
    ('funcao', 'usuario_convite_revogar', '', 'MULTIUSUARIO', 'organizacao_usuarios_admin.sql', false),
    ('funcao', 'usuarios_da_organizacao', '', 'MULTIUSUARIO', 'organizacao_usuarios_admin.sql', false),
    ('funcao', 'convites_pendentes', '', 'MULTIUSUARIO', 'organizacao_usuarios_admin.sql', false),
    ('funcao', 'permissoes_do_usuario', '', 'MULTIUSUARIO', 'organizacao_usuarios_admin.sql', false),
    ('funcao', 'registrar_meu_acesso', '', 'MULTIUSUARIO', 'organizacao_usuarios_admin.sql', true),
    ('funcao', 'contas_fora_da_organizacao', '', 'MULTIUSUARIO', 'organizacao_usuarios_admin.sql', false),
    ('funcao', 'conta_externa_detalhe', '', 'MULTIUSUARIO', 'organizacao_usuarios_admin.sql', false),
    ('trigger', 'trg_protege_ultimo_proprietario', 'organizacao_usuarios', 'MULTIUSUARIO', 'organizacao_usuarios_admin.sql', null),
    ('tabela', 'pacientes', '', 'LEGADO CENTRAL', 'pacientes_legacy_baseline.sql', true),
    ('policy', 'Nutri ve proprios pacientes', 'pacientes', 'LEGADO CENTRAL', 'pacientes_legacy_baseline.sql', null),
    ('policy', 'pacientes_self_read', 'pacientes', 'LEGADO CENTRAL', 'pacientes_legacy_baseline.sql', null),
    ('tabela', 'paciente_documentos', '', 'DOCUMENTOS DO PACIENTE', 'paciente_documentos.sql', true),
    ('tabela', 'paciente_documento_auditoria', '', 'DOCUMENTOS DO PACIENTE', 'paciente_documentos.sql', true),
    ('funcao', 'documento_do_paciente_e_meu', '', 'DOCUMENTOS DO PACIENTE', 'paciente_documentos.sql', false),
    ('funcao', 'marcar_documento_paciente_visualizado', '', 'DOCUMENTOS DO PACIENTE', 'paciente_documentos.sql', true),
    ('funcao', 'registrar_auditoria_documento_paciente', '', 'DOCUMENTOS DO PACIENTE', 'paciente_documentos.sql', false),
    ('funcao', 'tocar_paciente_documento', '', 'DOCUMENTOS DO PACIENTE', 'paciente_documentos.sql', false),
    ('trigger', 'trg_auditoria_documento_paciente', 'paciente_documentos', 'DOCUMENTOS DO PACIENTE', 'paciente_documentos.sql', null),
    ('trigger', 'trg_tocar_paciente_documento', 'paciente_documentos', 'DOCUMENTOS DO PACIENTE', 'paciente_documentos.sql', null),
    ('policy', 'pd_nutri_select', 'paciente_documentos', 'DOCUMENTOS DO PACIENTE', 'paciente_documentos.sql', null),
    ('policy', 'pd_nutri_insert', 'paciente_documentos', 'DOCUMENTOS DO PACIENTE', 'paciente_documentos.sql', null),
    ('policy', 'pd_nutri_update', 'paciente_documentos', 'DOCUMENTOS DO PACIENTE', 'paciente_documentos.sql', null),
    ('policy', 'pd_nutri_delete', 'paciente_documentos', 'DOCUMENTOS DO PACIENTE', 'paciente_documentos.sql', null),
    ('policy', 'pd_paciente_select', 'paciente_documentos', 'DOCUMENTOS DO PACIENTE', 'paciente_documentos.sql', null),
    ('policy', 'pda_nutri_select', 'paciente_documento_auditoria', 'DOCUMENTOS DO PACIENTE', 'paciente_documentos.sql', null),
    ('bucket', 'paciente-documentos', '', 'DOCUMENTOS DO PACIENTE', 'paciente_documentos.sql', false),
    ('funcao', 'rpc_paciente_proxima_consulta', '', 'OUTRO', 'paciente_inicio_leitura.sql', true),
    ('funcao', 'rpc_paciente_metas', '', 'OUTRO', 'paciente_inicio_leitura.sql', true),
    ('funcao', 'rpc_vincular_paciente', '', 'PWA DO PACIENTE', 'paciente_login_schema.sql', true),
    ('funcao', 'rpc_paciente_registrar_progressao', '', 'PWA DO PACIENTE', 'paciente_login_schema.sql', true),
    ('funcao', 'rpc_paciente_excluir_progressao', '', 'PWA DO PACIENTE', 'paciente_login_schema.sql', true),
    ('policy', 'treinos_paciente_read', 'treinos', 'PWA DO PACIENTE', 'paciente_login_schema.sql', null),
    ('policy', 'te_paciente_read', 'treino_exercicios', 'PWA DO PACIENTE', 'paciente_login_schema.sql', null),
    ('policy', 'exercicios_paciente_read', 'exercicios', 'PWA DO PACIENTE', 'paciente_login_schema.sql', null),
    ('policy', 'tp_paciente_read', 'treino_progressao', 'PWA DO PACIENTE', 'paciente_login_schema.sql', null),
    ('funcao', 'fn_paciente_nome_do_questionario', '', 'PWA DO PACIENTE', 'paciente_nome_do_questionario.sql', false),
    ('trigger', 'trg_paciente_nome_do_questionario', 'respostas', 'PWA DO PACIENTE', 'paciente_nome_do_questionario.sql', null),
    ('tabela', 'paciente_notificacoes', '', 'PWA DO PACIENTE', 'paciente_notificacoes.sql', false),
    ('funcao', 'marcar_notificacao_lida', '', 'PWA DO PACIENTE', 'paciente_notificacoes.sql', false),
    ('policy', 'pn_nutri_select', 'paciente_notificacoes', 'PWA DO PACIENTE', 'paciente_notificacoes.sql', null),
    ('policy', 'pn_nutri_insert', 'paciente_notificacoes', 'PWA DO PACIENTE', 'paciente_notificacoes.sql', null),
    ('policy', 'pn_paciente_select', 'paciente_notificacoes', 'PWA DO PACIENTE', 'paciente_notificacoes.sql', null),
    ('funcao', 'rpc_paciente_salvar_series', '', 'OUTRO', 'paciente_series_progressao.sql', true),
    ('funcao', 'pedcrm_novo_membro', '', 'OBJETO ESTRANHO', 'pedcrm_objeto_estranho.sql', false),
    ('tabela', 'push_subscriptions', '', 'OUTRO', 'push_subscriptions.sql', false),
    ('tabela', 'treino_notificacoes', '', 'OUTRO', 'push_subscriptions.sql', false),
    ('funcao', 'rpc_paciente_salvar_push', '', 'OUTRO', 'push_subscriptions.sql', true),
    ('funcao', 'rpc_paciente_remover_push', '', 'OUTRO', 'push_subscriptions.sql', true),
    ('tabela', 'paciente_eventos', '', 'TIMELINE E HUB', 'timeline_schema.sql', true),
    ('policy', 'paciente_eventos_select', 'paciente_eventos', 'TIMELINE E HUB', 'timeline_schema.sql', null),
    ('policy', 'paciente_eventos_insert', 'paciente_eventos', 'TIMELINE E HUB', 'timeline_schema.sql', null),
    ('policy', 'paciente_eventos_update', 'paciente_eventos', 'TIMELINE E HUB', 'timeline_schema.sql', null),
    ('policy', 'paciente_eventos_delete', 'paciente_eventos', 'TIMELINE E HUB', 'timeline_schema.sql', null),
    ('funcao', 'bump_treino_atualizado', '', 'TREINOS', 'treino_atualizado.sql', false),
    ('trigger', 'trg_treino_bump', 'treinos', 'TREINOS', 'treino_atualizado.sql', null),
    ('trigger', 'trg_te_bump', 'treino_exercicios', 'TREINOS', 'treino_atualizado.sql', null),
    ('tabela', 'exercicios', '', 'TREINOS', 'treino_schema.sql', true),
    ('tabela', 'treinos', '', 'TREINOS', 'treino_schema.sql', true),
    ('tabela', 'treino_exercicios', '', 'TREINOS', 'treino_schema.sql', true),
    ('tabela', 'treino_progressao', '', 'TREINOS', 'treino_schema.sql', true),
    ('policy', 'exercicios_owner', 'exercicios', 'TREINOS', 'treino_schema.sql', null),
    ('policy', 'treinos_owner', 'treinos', 'TREINOS', 'treino_schema.sql', null),
    ('policy', 'treino_exercicios_owner', 'treino_exercicios', 'TREINOS', 'treino_schema.sql', null),
    ('policy', 'treino_progressao_owner', 'treino_progressao', 'TREINOS', 'treino_schema.sql', null),
    ('funcao', 'vincular_funcionario_por_email', '', 'VINCULOS', 'vinculo_funcionario_trava_dono.sql', true),
    ('funcao', 'desvincular_funcionario', '', 'VINCULOS', 'vinculo_funcionario_trava_dono.sql', false)
),
atual(tipo, nome, tabela) as (
  select 'tabela', c.relname::text, ''
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
  union all
  select 'view', c.relname::text, ''
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v','m')
  union all
  select 'funcao', p.proname::text, ''
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
  union all
  select 'trigger', t.tgname::text, c.relname::text
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal
  union all
  select 'policy', p.policyname::text, p.tablename::text
    from pg_policies p where p.schemaname = 'public'
  union all
  select 'bucket', b.id::text, '' from storage.buckets b
),
comparado as (
  select
    coalesce(e.tipo, a.tipo)     as tipo,
    coalesce(e.nome, a.nome)     as nome,
    coalesce(e.tabela, a.tabela) as tabela,
    coalesce(e.modulo, '(nao versionado)') as modulo,
    e.arquivo, e.front_usa,
    case when a.nome is null then 'AUSENTE NO BANCO'
         when e.nome is null then 'AUSENTE NO REPOSITORIO'
         else 'OK' end as status
  from esperado e
  full outer join atual a
    on a.tipo = e.tipo and a.nome = e.nome and coalesce(a.tabela,'') = coalesce(e.tabela,'')
),
relevante as (
  select * from comparado
   where status <> 'AUSENTE NO REPOSITORIO'
      or (tipo = 'tabela')
      or (tipo = 'funcao' and nome not like 'pg_%' and nome not like 'uuid_%'
          and nome not like 'gtrgm%' and nome not like 'gin_%' and nome not like 'set_limit'
          and nome not like 'show_%' and nome not like 'similarity%' and nome not like 'word_similarity%'
          and nome not like 'strict_word%' and nome not like 'unaccent%' and nome not like 'armor'
          and nome not like 'dearmor' and nome not like 'crypt' and nome not like 'digest'
          and nome not like 'encrypt%' and nome not like 'decrypt%' and nome not like 'hmac'
          and nome not like 'gen_%' and nome not like 'pgp_%')
      or (tipo in ('policy','trigger','bucket'))
),
por_modulo as (
  select modulo,
         count(*) filter (where status = 'OK')               as ok,
         count(*) filter (where status = 'AUSENTE NO BANCO')  as ausente_banco,
         count(*) filter (where status = 'AUSENTE NO REPOSITORIO') as ausente_repo,
         count(*) filter (where status = 'AUSENTE NO BANCO' and front_usa) as front_quebrado
    from relevante group by modulo
)
select
  'A PRONTIDAO 3.5' as secao, p.item, p.valor, p.resultado
from (
  values
    ('CHECK-INS',
     (select count(*)::text from relevante
       where modulo = 'CHECK-INS' and status = 'AUSENTE NO BANCO') || ' objetos faltando no banco',
     case when exists (select 1 from relevante
                        where modulo = 'CHECK-INS' and status = 'AUSENTE NO BANCO')
          then 'BLOQUEADO' else 'PRONTO' end),

    ('HANDLE_NEW_USER',
     coalesce((select status from relevante where tipo = 'funcao' and nome = 'handle_new_user'),
              'nao aparece nem no banco nem no repositorio'),
     case when exists (select 1 from relevante
                        where tipo = 'funcao' and nome = 'handle_new_user' and status = 'OK')
          then 'VERSIONADO' else 'NAO VERSIONADO' end),

    ('PEDCRM_NOVO_MEMBRO',
     coalesce((select modulo from relevante where tipo = 'funcao' and nome = 'pedcrm_novo_membro'),
              '(ausente)'),
     case when exists (select 1 from relevante
                        where tipo = 'funcao' and nome = 'pedcrm_novo_membro'
                          and modulo = 'OBJETO ESTRANHO')
          then 'CLASSIFICADO' else 'NAO CLASSIFICADO' end),

    ('AGENDA',
     (select count(*)::text from public.permissoes where chave like 'agenda.%') || ' chaves no catalogo',
     case when exists (select 1 from public.permissoes where chave like 'agenda.%')
          then 'PERMISSOES DEFINIDAS' else 'PENDENTES' end),

    ('TIMELINE',
     (select count(*)::text from public.permissoes where chave like 'timeline.%') || ' chaves no catalogo',
     case when exists (select 1 from public.permissoes where chave like 'timeline.%')
          then 'PERMISSOES DEFINIDAS' else 'PENDENTES' end),

    ('CONTAS EXTERNAS',
     (select count(*)::text from public.nutricionistas n
       where not exists (select 1 from public.organizacao_usuarios ou where ou.auth_user_id = n.id)
         and not exists (select 1 from public.pacientes    p where p.auth_user_id  = n.id)
         and not exists (select 1 from public.funcionarios f where f.auth_user_id  = n.id))
     || ' contas sem papel definido',
     case when exists (select 1 from public.nutricionistas n
                        where not exists (select 1 from public.organizacao_usuarios ou where ou.auth_user_id = n.id)
                          and not exists (select 1 from public.pacientes    p where p.auth_user_id  = n.id)
                          and not exists (select 1 from public.funcionarios f where f.auth_user_id  = n.id))
          then 'DECISAO PENDENTE' else 'RESOLVIDAS' end)
) as p(item, valor, resultado)
union all
select
  'MODULO' as secao, modulo as item,
  ok || ' ok / ' || ausente_banco || ' faltam no banco / ' || ausente_repo || ' fora do repo' as valor,
  case when front_quebrado > 0 then 'FRONTEND DEPENDE DE OBJETO AUSENTE (' || front_quebrado || ')'
       when ausente_banco > 0  then 'MIGRATION NAO APLICADA'
       when ausente_repo > 0   then 'objeto nao versionado'
       else 'PRONTO' end as resultado
from por_modulo
union all
select 'DIVERGENCIA', tipo || ' ' || nome || case when tabela <> '' then ' (' || tabela || ')' else '' end,
       coalesce(arquivo, '(sem arquivo)') || ' · ' || modulo,
       status || case when front_usa then '  <<< O FRONTEND USA' else '' end
  from relevante where status <> 'OK'
union all
select 'zz TOTAL', 'objetos conferidos',
       (select count(*)::text from relevante),
       case when exists (select 1 from relevante where status = 'AUSENTE NO BANCO' and front_usa)
            then 'NAO PRONTO — frontend depende de objeto ausente'
            when exists (select 1 from relevante where status = 'AUSENTE NO BANCO')
            then 'RESSALVA — ha migration versionada nao aplicada'
            else 'PRONTO PARA A ETAPA 4' end
order by 1, 4, 2;
