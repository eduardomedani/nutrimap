-- ===========================================================================
-- Evollo · ETAPA 2 — DESFAZER a Fundacao Multiusuario
-- ---------------------------------------------------------------------------
-- Remove SOMENTE o que db/organizacao_schema.sql criou.
--
-- NAO TOCA em nada legado, e nao precisa tocar: a Etapa 2 nao alterou uma
-- policy antiga, nao mudou um nutri_id, nao moveu um arquivo de Storage e nao
-- escreveu em nenhuma tabela que ja existia. E por isso que este rollback e
-- barato — ele desfaz adicao, nunca alteracao.
--
-- Continuam intactos: nutricionistas, pacientes, avaliacoes, respostas,
-- exames, recordatorio_calc, codigos_convite, codigos_uso, funcionarios,
-- auth.users, as 136 policies antigas, os 4 buckets e as 4 auditorias.
--
-- A ordem e a das dependencias: primeiro o que aponta, depois o apontado.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

drop function if exists public.minhas_permissoes();
drop function if exists public.tem_permissao(text);
drop function if exists public.organizacao_do_auth();

-- Os gatilhos caem junto com as tabelas; ficam aqui explicitos para quem ler o
-- arquivo saber que existiram. public.set_atualizado_em() NAO e removida: ela
-- e de db/foods_schema.sql e continua servindo alimentos e avaliacoes.
drop trigger if exists trg_organizacao_usuarios_atualizado on public.organizacao_usuarios;
drop trigger if exists trg_perfis_atualizado               on public.perfis;
drop trigger if exists trg_organizacoes_atualizado         on public.organizacoes;

drop table if exists public.usuario_permissoes;
drop table if exists public.perfil_permissoes;
drop table if exists public.organizacao_usuarios;
drop table if exists public.permissoes;
drop table if exists public.perfis;
drop table if exists public.organizacoes;

-- Os indices unicos e as policies caem com as tabelas. Nada a revogar: os
-- grants desta etapa existiam so nas funcoes, que ja sairam.
