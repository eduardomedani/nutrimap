-- ===========================================================================
-- Evollo · INICIO do PWA — proxima consulta e metas do paciente
-- ---------------------------------------------------------------------------
-- Hoje `consultas_select` e `paciente_metas_select` sao `nutri_id = auth.uid()`:
-- pelo app do paciente as duas voltam vazias, e a tela de Inicio nao tem como
-- mostrar nem a proxima consulta nem as metas.
--
-- POR QUE NAO E UMA POLICY DE SELECT. RLS filtra LINHA, nao COLUNA. Uma policy
-- `paciente_id = paciente_do_auth()` em `consultas` liberaria a linha inteira
-- pela API — e a linha inteira inclui o que o profissional escreveu SOBRE o
-- paciente e nao PARA ele:
--
--   consultas.observacoes  "notas do profissional durante o atendimento"
--   consultas.relato       "o que o paciente contou (na voz dele)"
--   consultas.conduta      "o que foi decidido"
--   consultas.resumo       fechamento escrito na finalizacao
--   paciente_metas.observacoes
--
-- A tela mostraria so a data, mas qualquer um com a anon-key e o token do
-- paciente leria o resto num GET. E o mesmo cuidado que db/pwa da dieta ja
-- tomou com `planos_alimentares.observacoes`, que e nota interna e nao vai
-- para o paciente.
--
-- Por isso: duas funcoes SECURITY DEFINER que devolvem APENAS as colunas
-- seguras, no padrao que o app do aluno ja usa (rpc_paciente_*). Nenhuma
-- policy nova, nenhuma tabela exposta.
--
-- ADITIVO: nada do lado do nutri muda. 100% re-executavel.
-- Desfazer: db/paciente_inicio_leitura_desfazer.sql
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================


-- ===========================================================================
-- 1) Proxima consulta
-- ---------------------------------------------------------------------------
-- So a que ainda vai acontecer e ainda esta de pe: `agendada` e no futuro.
-- Cancelada nao e proxima consulta, e finalizada e passado.
--
-- `motivo` fica de fora junto com o resto: quem escreve o motivo e o
-- profissional, e ele nem sempre escreve pensando em ser lido pelo paciente.
-- ===========================================================================
create or replace function public.rpc_paciente_proxima_consulta()
returns table (
  data_hora   timestamptz,
  tipo        text,
  modalidade  text,
  duracao_min integer
)
language sql
stable
security definer
set search_path = public
as $$
  select c.data_hora, c.tipo, c.modalidade, c.duracao_min
    from public.consultas c
   where c.paciente_id = public.paciente_do_auth()
     and c.status = 'agendada'
     and c.data_hora >= now()
   order by c.data_hora
   limit 1;
$$;

revoke all on function public.rpc_paciente_proxima_consulta() from public;
grant execute on function public.rpc_paciente_proxima_consulta() to authenticated;


-- ===========================================================================
-- 2) Metas do paciente
-- ---------------------------------------------------------------------------
-- So as que estao valendo. `atingida`, `pausada` e `cancelada` ficam de fora:
-- o Inicio mostra o que esta em jogo agora, nao o historico.
--
-- `observacoes` NAO entra — e o campo onde o profissional anota o contexto da
-- meta, que e conversa dele com ele mesmo.
-- ===========================================================================
create or replace function public.rpc_paciente_metas()
returns table (
  id            uuid,
  tipo          text,
  titulo        text,
  valor_inicial numeric,
  valor_alvo    numeric,
  unidade       text,
  prazo         date,
  status        text
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.tipo, m.titulo, m.valor_inicial, m.valor_alvo,
         m.unidade, m.prazo, m.status
    from public.paciente_metas m
   where m.paciente_id = public.paciente_do_auth()
     and m.status in ('em_andamento', 'nao_iniciada')
   order by m.prazo nulls last, m.criado_em;
$$;

revoke all on function public.rpc_paciente_metas() from public;
grant execute on function public.rpc_paciente_metas() to authenticated;


-- ===========================================================================
-- Conferencia. Devolve 2 se as duas funcoes existem, e 0 em `vazando` se
-- nenhuma das duas devolve coluna de nota interna.
--
-- Rodando como NUTRI no SQL Editor, paciente_do_auth() e nulo e as funcoes
-- devolvem vazio — isso e o esperado, e prova que o filtro esta de pe.
-- ===========================================================================
select
  count(*) filter (
    where p.proname in ('rpc_paciente_proxima_consulta', 'rpc_paciente_metas')
  ) as funcoes,
  count(*) filter (
    where pg_get_function_result(p.oid) ~ '(observacoes|relato|conduta|resumo|motivo)'
  ) as vazando,
  count(*) filter (
    where has_function_privilege('anon', p.oid, 'execute')
  ) as anon_pode_executar
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('rpc_paciente_proxima_consulta', 'rpc_paciente_metas');
