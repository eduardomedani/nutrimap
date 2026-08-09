-- ===========================================================================
-- Evollo · VALIDACAO DA ETAPA 4 em ambiente real
-- ---------------------------------------------------------------------------
-- Roteiro de conferencia para rodar no SQL Editor do Supabase, na ordem, com
-- um PACIENTE DE TESTE. Cada bloco traz o esperado ao lado — o que precisa ser
-- olhado, e nao so executado.
--
-- Substitua os dois marcadores antes de comecar:
--   :PACIENTE  -> uuid do paciente de teste
--   :DOCUMENTO -> uuid do documento criado no passo 4.1
--
-- NAO rode db/paciente_notificacoes_desfazer.sql durante a validacao.
-- ===========================================================================


-- ===========================================================================
-- 1) DEPOIS DE APLICAR db/paciente_notificacoes.sql
-- ===========================================================================

-- 1.1 Tabela, RLS e policies.
-- Esperado: tabela=1, rls_ativa=true, policies=3, escrita_direta=0
select
  (select count(*) from pg_tables
    where schemaname='public' and tablename='paciente_notificacoes')            as tabela,
  (select relrowsecurity from pg_class
    where oid='public.paciente_notificacoes'::regclass)                         as rls_ativa,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='paciente_notificacoes')            as policies,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='paciente_notificacoes'
      and cmd in ('UPDATE','DELETE'))                                           as escrita_direta;

-- 1.2 As policies, uma a uma. A do paciente TEM que filtrar por
--     paciente_do_auth(); a de insert do nutri TEM que trazer o exists().
select policyname, cmd, qual as usando, with_check as checando
  from pg_policies
 where schemaname='public' and tablename='paciente_notificacoes'
 order by policyname;

-- 1.3 ACL das funcoes. Esperado: publico_executa=false nas DUAS.
select p.proname as funcao, p.prosecdef as definer, p.proconfig as search_path,
       coalesce(has_function_privilege('public', p.oid, 'EXECUTE'), false)        as publico_executa,
       coalesce(has_function_privilege('anon', p.oid, 'EXECUTE'), false)          as anon_executa,
       coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as autenticado_executa
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'
   and p.proname in ('marcar_notificacao_lida','marcar_documento_paciente_visualizado')
 order by p.proname;

-- 1.4 A funcao de visualizacao foi MESMO substituida (a nova fecha o aviso).
--     Esperado: fecha_aviso = true
select position('paciente_notificacoes' in pg_get_functiondef(p.oid)) > 0 as fecha_aviso
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='marcar_documento_paciente_visualizado';

-- 1.5 NADA MAIS FOI TOCADO. Rode ANTES e DEPOIS da migration e compare:
--     os tres numeros tem que ser identicos nas duas execucoes.
select
  (select count(*) from public.paciente_documentos)                             as documentos,
  (select count(*) from storage.objects
    where bucket_id='paciente-documentos')                                      as arquivos,
  (select count(*) from pg_policies where schemaname in ('public','storage')
     and tablename <> 'paciente_notificacoes')                                  as policies_dos_outros;


-- ===========================================================================
-- 4) TESTE REAL — o estado antes e depois de cada acao
-- ===========================================================================

-- 4.A Depois de CRIAR o documento privado (passos 4.1 a 4.4).
--     Esperado: visivel=false, disponibilizado_em=null, avisos=0, eventos=0
select
  (select visivel_paciente from public.paciente_documentos where id=':DOCUMENTO')    as visivel,
  (select disponibilizado_em from public.paciente_documentos where id=':DOCUMENTO')  as disponibilizado_em,
  (select count(*) from public.paciente_notificacoes
    where referencia_id=':DOCUMENTO')                                                as avisos,
  (select count(*) from public.paciente_eventos
    where entidade_id=':DOCUMENTO' and tipo='DOCUMENT_SHARED')                       as eventos;

-- 4.B Depois de DISPONIBILIZAR (passos 4.5 a 4.8).
--     Esperado: visivel=true, disponibilizado_em preenchido, avisos=1, eventos=1
--     e push_enviado=1 (ou push_falhou=1 se o paciente nao tiver inscricao).
select
  (select visivel_paciente from public.paciente_documentos where id=':DOCUMENTO')    as visivel,
  (select count(*) from public.paciente_notificacoes where referencia_id=':DOCUMENTO') as avisos,
  (select count(*) from public.paciente_eventos
    where entidade_id=':DOCUMENTO' and tipo='DOCUMENT_SHARED')                       as eventos,
  (select count(*) from public.paciente_documento_auditoria
    where documento_id=':DOCUMENTO' and acao='push_enviado')                         as push_enviado,
  (select count(*) from public.paciente_documento_auditoria
    where documento_id=':DOCUMENTO' and acao='push_falhou')                          as push_falhou;

-- 4.C Depois de o paciente ABRIR o documento no PWA (passos 4.11 a 4.13).
--     Esperado: visualizado_em preenchido E lida_em preenchido, com poucos
--     segundos de diferenca — as duas se movem na MESMA acao.
select d.visualizado_em, n.lida_em,
       n.lida_em is not null and d.visualizado_em is not null as as_duas_fecharam
  from public.paciente_documentos d
  left join public.paciente_notificacoes n
         on n.referencia_id = d.id and n.tipo='documento'
 where d.id=':DOCUMENTO';


-- ===========================================================================
-- 5) IDEMPOTENCIA — depois de clicar "Disponibilizar" varias vezes
-- ===========================================================================
-- Esperado: avisos=1, eventos=1, push_enviado=1, disponibilizacoes=1.
-- Qualquer numero acima de 1 aqui e duplicidade — e a causa esta na clausula
-- `eq('visivel_paciente', false)` de js/paciente-documentos.js ter sido
-- afrouxada, ou no webhook estar disparando sem conferir a transicao.
select
  (select count(*) from public.paciente_notificacoes where referencia_id=':DOCUMENTO')  as avisos,
  (select count(*) from public.paciente_eventos
    where entidade_id=':DOCUMENTO' and tipo='DOCUMENT_SHARED')                          as eventos,
  (select count(*) from public.paciente_documento_auditoria
    where documento_id=':DOCUMENTO' and acao='push_enviado')                            as push_enviado,
  (select count(*) from public.paciente_documento_auditoria
    where documento_id=':DOCUMENTO' and acao='documento_disponibilizado')               as disponibilizacoes;

-- 5.B As chaves de deduplicacao. Esperado: uma linha por disponibilizacao REAL.
select chave_dedup, criado_em, lida_em
  from public.paciente_notificacoes
 where referencia_id=':DOCUMENTO'
 order by criado_em;


-- ===========================================================================
-- 6) EDICAO — depois de alterar titulo, descricao e tipo
-- ===========================================================================
-- Esperado: os quatro numeros IGUAIS aos do bloco 5, e visivel continua true.
-- `informacoes_editadas` pode subir: e o gatilho de auditoria fazendo o que
-- deve. O que nao pode subir e aviso, evento ou push.
select
  (select visivel_paciente from public.paciente_documentos where id=':DOCUMENTO')      as visivel,
  (select count(*) from public.paciente_notificacoes where referencia_id=':DOCUMENTO') as avisos,
  (select count(*) from public.paciente_eventos
    where entidade_id=':DOCUMENTO' and tipo='DOCUMENT_SHARED')                         as eventos,
  (select count(*) from public.paciente_documento_auditoria
    where documento_id=':DOCUMENTO' and acao='push_enviado')                           as push_enviado,
  (select count(*) from public.paciente_documento_auditoria
    where documento_id=':DOCUMENTO' and acao='informacoes_editadas')                   as edicoes;


-- ===========================================================================
-- 7) REMOCAO — depois de "Remover do aplicativo"
-- ===========================================================================
-- Esperado: visivel=false, MAS disponibilizado_em preservado, eventos=1
-- (historico intacto) e avisos=1 (o aviso historico nao se apaga).
select
  (select visivel_paciente from public.paciente_documentos where id=':DOCUMENTO')      as visivel,
  (select disponibilizado_em from public.paciente_documentos where id=':DOCUMENTO')    as disponibilizado_em,
  (select count(*) from public.paciente_eventos
    where entidade_id=':DOCUMENTO' and tipo='DOCUMENT_SHARED')                         as eventos,
  (select count(*) from public.paciente_notificacoes where referencia_id=':DOCUMENTO') as avisos,
  (select count(*) from public.paciente_documento_auditoria
    where documento_id=':DOCUMENTO' and acao='push_enviado')                           as push_enviado;


-- ===========================================================================
-- 8) REDISPONIBILIZACAO — depois de disponibilizar de novo
-- ===========================================================================
-- Esperado: avisos=2, eventos=2, push_enviado=2, e um disponibilizado_em NOVO.
-- As duas chaves_dedup tem que ser DIFERENTES (carregam o instante).
select
  (select disponibilizado_em from public.paciente_documentos where id=':DOCUMENTO')    as disponibilizado_em,
  (select count(*) from public.paciente_notificacoes where referencia_id=':DOCUMENTO') as avisos,
  (select count(distinct chave_dedup) from public.paciente_notificacoes
    where referencia_id=':DOCUMENTO')                                                  as chaves_distintas,
  (select count(*) from public.paciente_eventos
    where entidade_id=':DOCUMENTO' and tipo='DOCUMENT_SHARED')                         as eventos,
  (select count(*) from public.paciente_documento_auditoria
    where documento_id=':DOCUMENTO' and acao='push_enviado')                           as push_enviado;


-- ===========================================================================
-- 9) PACIENTE SEM PUSH
-- ===========================================================================
-- Antes: confirme que o paciente de teste nao tem inscricao.
select count(*) as inscricoes from public.push_subscriptions where paciente_id=':PACIENTE';

-- Depois de disponibilizar um documento para ele.
-- Esperado: push_falhou com motivo 'sem_inscricao', e o aviso/evento criados
-- do mesmo jeito — push e reforco, nao o canal.
select acao, metadata, criado_em
  from public.paciente_documento_auditoria
 where paciente_id=':PACIENTE' and acao in ('push_falhou','push_enviado','notificacao_criada')
 order by criado_em desc limit 10;


-- ===========================================================================
-- 12) SAUDE 360° — os numeros que o card mostra
-- ===========================================================================
-- Compare com o que aparece na aba Visao geral do paciente.
-- Privado NAO entra em pendentes; arquivado nao entra em nada.
select
  count(*) filter (where arquivado_em is null)                                    as total,
  count(*) filter (where arquivado_em is null and visivel_paciente)               as compartilhados,
  count(*) filter (where arquivado_em is null and not visivel_paciente)           as privados,
  count(*) filter (where arquivado_em is null and visivel_paciente
                     and not visualizado_pelo_paciente)                           as pendentes,
  (select titulo from public.paciente_documentos
    where paciente_id=':PACIENTE' and visivel_paciente and arquivado_em is null
    order by disponibilizado_em desc limit 1)                                     as ultimo
  from public.paciente_documentos
 where paciente_id=':PACIENTE';


-- ===========================================================================
-- 13) TIMELINE — um card por compartilhamento, e nenhum DOCUMENT_VIEWED
-- ===========================================================================
-- Esperado: so linhas DOCUMENT_SHARED. Se aparecer DOCUMENT_VIEWED, alguem
-- criou o tipo que o desenho evita de proposito.
select tipo, count(*) as quantos
  from public.paciente_eventos
 where paciente_id=':PACIENTE' and modulo='documentos'
 group by tipo order by tipo;


-- ===========================================================================
-- 10/15) PRIVACIDADE — o que ficou gravado
-- ===========================================================================
-- A auditoria de push NAO pode conter titulo, descricao nem endpoint.
-- Esperado: 0 linhas.
select id, acao, metadata
  from public.paciente_documento_auditoria
 where acao in ('push_enviado','push_falhou')
   and (metadata::text ilike '%titulo%'
     or metadata::text ilike '%descricao%'
     or metadata::text ilike '%endpoint%'
     or metadata::text ilike '%http%');

-- O aviso interno PODE ter o titulo (o paciente ja esta autenticado), mas
-- NUNCA uma URL no campo de acao. Esperado: 0 linhas.
select id, acao from public.paciente_notificacoes where acao ~* '^https?://';
