-- ===========================================================================
-- Evollo · ETAPA 3 — DESFAZER a administracao de usuarios
-- ---------------------------------------------------------------------------
-- Remove SOMENTE o que db/organizacao_usuarios_admin.sql criou.
--
-- NAO TOCA na Fundacao da Etapa 2 (organizacoes, organizacao_usuarios,
-- perfis, permissoes, perfil_permissoes, usuario_permissoes), nem em nada
-- legado, nem em Storage, nem nas 136 policies antigas.
--
-- ATENCAO AO QUE SOBREVIVE: usuarios ja vinculados CONTINUAM em
-- organizacao_usuarios, com perfil e permissoes. O rollback tira a
-- administracao, nao o acesso de quem ja entrou. Para remover uma pessoa,
-- use a tela — ou, sem ela, um delete manual que a trava do ultimo
-- proprietario ainda vai proteger... exceto que a trava tambem sai aqui.
-- Por isso: se houver mais de um usuario na organizacao, pense duas vezes.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

drop trigger if exists trg_protege_ultimo_proprietario on public.organizacao_usuarios;

drop function if exists public.conta_externa_detalhe(uuid);
drop function if exists public.contas_fora_da_organizacao();
drop function if exists public.registrar_meu_acesso();
drop function if exists public.permissoes_do_usuario(uuid);
drop function if exists public.convites_pendentes();
drop function if exists public.usuarios_da_organizacao();
drop function if exists public.usuario_convite_revogar(uuid);
drop function if exists public.usuario_definir_permissao(uuid, text, text);
drop function if exists public.usuario_definir_status(uuid, text);
drop function if exists public.usuario_definir_perfil(uuid, uuid);
drop function if exists public.usuario_vincular(text);
drop function if exists public.usuario_convidar(text, text, text, uuid);
drop function if exists public.exige_permissao(text);
drop function if exists public.fn_protege_ultimo_proprietario();
drop function if exists public.gerar_codigo_organizacao();

drop table if exists public.organizacao_auditoria;
drop table if exists public.organizacao_convites;
