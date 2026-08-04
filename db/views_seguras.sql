-- ===========================================================================
-- Evollo · CORRECAO DE SEGURANCA — views sem security_invoker
-- ---------------------------------------------------------------------------
-- URGENTE. Rodar antes de qualquer pessoa nova entrar no app.
--
-- O PROBLEMA
-- No Postgres, uma view roda com os privilegios de QUEM A CRIOU, nao de quem a
-- consulta. Criada pelo `postgres` (o papel do SQL Editor), ela ignora o RLS
-- das tabelas de baixo. Somando a isso, o Supabase concede SELECT em objetos
-- novos do schema public para `anon` e `authenticated`, e o PostgREST publica
-- tudo que esta la.
--
-- Resultado: qualquer usuario LOGADO — um paciente de qualquer nutricionista,
-- ou um dos colaboradores assim que criasse a conta do app — conseguiria ler
--
--     select * from folha_itens_totais
--
-- e receber a folha de pagamento INTEIRA de TODOS os profissionais do projeto.
-- O RLS das tabelas continuava correto; a view passava por cima dele.
--
-- Duas views foram criadas assim:
--   . public.folha_itens_totais        (db/folha_schema.sql)
--   . public.documentos_por_competencia (db/colaborador_documentos.sql)
--
-- A CORRECAO
-- `security_invoker = on` faz a view rodar com os privilegios de quem consulta,
-- e o RLS das tabelas volta a valer. A convencao ja existia no projeto —
-- `recipe_macros`, em foods_schema.sql, sempre fez assim. Os arquivos de
-- origem foram corrigidos tambem, para quem rodar do zero nao repetir o erro.
--
-- Nao ha perda de dado: as views sao recriadas com a mesma consulta.
-- 100% re-executavel.
-- ===========================================================================

create or replace view public.folha_itens_totais
with (security_invoker = on) as
select
  i.id,
  i.nutri_id,
  i.folha_id,
  i.funcionario_id,
  i.modo,
  i.minutos,
  i.valor_hora,
  i.valor_base,
  coalesce((select sum(a.valor) from public.folha_adicionais a where a.item_id = i.id), 0) as adicionais,
  i.valor_base + coalesce((select sum(a.valor) from public.folha_adicionais a where a.item_id = i.id), 0) as total
from public.folha_itens i;


create or replace view public.documentos_por_competencia
with (security_invoker = on) as
select
  d.nutri_id,
  d.competencia,
  d.tipo_documento,
  count(*) filter (where d.atual and d.status = 'disponivel')      as disponiveis,
  count(*) filter (where d.visualizado_pelo_colaborador)           as visualizados,
  count(*) filter (where d.status = 'erro')                        as com_erro,
  count(*) filter (where d.arquivado_em is not null)               as arquivados
from public.colaborador_documentos d
group by d.nutri_id, d.competencia, d.tipo_documento;


-- ===========================================================================
-- Conferencia: as duas tem que aparecer com security_invoker = on.
-- Se `invoker` vier false em alguma linha, a view ainda esta vazando.
-- ===========================================================================
select
  c.relname as view,
  coalesce(
    (select option_value from pg_options_to_table(c.reloptions)
      where option_name = 'security_invoker'), 'off') as invoker
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v'
  and c.relname in ('folha_itens_totais', 'documentos_por_competencia', 'recipe_macros')
order by c.relname;
