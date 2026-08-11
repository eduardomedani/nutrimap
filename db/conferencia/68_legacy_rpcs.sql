-- ===========================================================================
-- ETAPA 1B - EXTRACAO: as seis RPCs que o front chama e o repositorio nao tem
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le catalogo. Pode rodar em producao sem risco.
--
--   validar_codigo_convite        chamada por js/auth.js       (painel + admin)
--   registrar_uso_codigo          chamada por js/auth.js       (painel + admin)
--   rpc_salvar_respostas          chamada por js/respostas.js  (anamnese.html)
--   rpc_marcar_completo           chamada por js/pacientes.js  (anamnese + painel)
--   rpc_buscar_paciente_por_codigo chamada por js/pacientes.js (anamnese + painel)
--   gerar_codigo_paciente         chamada por js/pacientes.js  (anamnese + painel)
--
-- Devolve DEFINICAO COMPLETA + ACL de cada uma. pg_get_functiondef ja traz
-- linguagem, volatilidade, security definer/invoker, search_path e corpo -
-- e traz o texto REAL, nao uma reconstrucao.
--
-- A busca e por nome sem esquema fixo porque nem toda funcao do projeto vive
-- em public: se alguma estiver noutro esquema, ela aparece aqui em vez de
-- sumir do resultado e ser dada como inexistente.
--
-- Para colar no SQL Editor, use a versao sem comentarios:
--   db/conferencia/68_legacy_rpcs_LIMPO.sql
-- ===========================================================================

with alvo as (
  select unnest(array[
    'validar_codigo_convite',
    'registrar_uso_codigo',
    'rpc_salvar_respostas',
    'rpc_marcar_completo',
    'rpc_buscar_paciente_por_codigo',
    'gerar_codigo_paciente'
  ]) as nome
),
achadas as (
  select
    a.nome,
    p.oid,
    n.nspname as esquema,
    pg_get_function_identity_arguments(p.oid) as argumentos,
    pg_get_function_result(p.oid) as retorno,
    l.lanname as linguagem,
    case p.provolatile::text when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end as volatilidade,
    case when p.prosecdef then 'security definer' else 'security invoker' end as seguranca,
    coalesce(array_to_string(p.proconfig, ' | '), '(sem set - search_path NAO fixado)') as configuracao,
    coalesce(array_to_string(p.proacl::text[], ' | '), '(acl nula - herda o default do esquema)') as acl,
    pg_get_functiondef(p.oid) as definicao
  from alvo a
  left join pg_proc p on p.proname = a.nome
  left join pg_namespace n on n.oid = p.pronamespace
  left join pg_language l on l.oid = p.prolang
),
linhas as (
  select nome, 1 as ordem, 'ESQUEMA        : ' || coalesce(esquema, '*** NAO ENCONTRADA NO BANCO ***') as linha from achadas
  union all select nome, 2, 'ASSINATURA     : ' || coalesce(nome || '(' || argumentos || ')', '-') from achadas
  union all select nome, 3, 'RETORNO        : ' || coalesce(retorno, '-') from achadas
  union all select nome, 4, 'LINGUAGEM      : ' || coalesce(linguagem, '-') from achadas
  union all select nome, 5, 'VOLATILIDADE   : ' || coalesce(volatilidade, '-') from achadas
  union all select nome, 6, 'SEGURANCA      : ' || coalesce(seguranca, '-') from achadas
  union all select nome, 7, 'SET/SEARCHPATH : ' || coalesce(configuracao, '-') from achadas
  union all select nome, 8, 'ACL            : ' || coalesce(acl, '-') from achadas
  union all select nome, 9, 'DEFINICAO      : ' || coalesce(definicao, '-') from achadas
)
select
  nome,
  ordem,
  linha
from linhas
order by nome, ordem;
