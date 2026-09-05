-- ===========================================================================
-- Evollo · QUEM GERA BONUS — a mesma regua para os dois bonus
-- ---------------------------------------------------------------------------
-- Requer db/comercial_alunos_por_turno.sql. 100% re-executavel.
--
-- ===========================================================================
-- O QUE ELE ADICIONA
-- ---------------------------------------------------------------------------
-- `comercial_alunos_do_bonus`, que devolve o NOME de quem passa no teto de
-- desconto — para o bonus POR PRESENCA usar a mesma regua do bonus POR ALUNO.
--
-- O TETO NAO MUDA: segue em 10% (DESCONTO_MAXIMO, js/folha.js). O que muda e
-- QUEM o respeita.
--
-- POR QUE ELA PRECISOU EXISTIR. O bonus por presenca e calculado a partir de
-- DUAS PLANILHAS (presencas dos alunos + espelho de ponto) e nao enxerga o
-- banco: em js/folha-ui.js ele nunca soube quem tem assinatura, quanto paga ou
-- se e cortesia. Resultado: pagava por qualquer aluno que entrasse na sala,
-- inclusive quem tem 40% de abatimento ou nao paga nada. Eram duas reguas para
-- a mesma pergunta — "este aluno da lucro suficiente para gerar bonus?" — e so
-- o bonus por aluno respondia.
--
-- ===========================================================================
-- O NOME COMO CHAVE, E POR QUE NAO HA OUTRA
-- ---------------------------------------------------------------------------
-- A planilha de presencas traz Cliente, Modalidade, Contrato, Tipo e Data — e
-- nada que ligue ao cadastro alem do nome. Entao a funcao devolve nome, e quem
-- chama compara sem acento e sem caixa (a planilha e o cadastro discordam no
-- acento de varios nomes; comparar cru criaria "nao elegivel" para gente que e).
--
-- O NOME SAI JA NORMALIZADO daqui, e nao normalizado no JS depois: assim as
-- duas pontas usam a MESMA regra de comparacao, em vez de duas que precisam
-- ser mantidas iguais.
--
-- ===========================================================================
-- O CRITERIO, IGUALZINHO AO DO BONUS POR ALUNO
-- ---------------------------------------------------------------------------
--   preco_padrao > 0                          plano sem preco nao tem desconto
--                                             que se calcule — e e por aqui que
--                                             a BONIFICACAO cai fora, ja que o
--                                             plano dela vale zero
--
--   1 - valor_contratado / preco_padrao       o desconto efetivo
--       <= p_desconto_maximo
--
-- Sem `valor_contratado`, vale o preco do plano: desconto zero.
--
-- A DIFERENCA PARA `comercial_alunos_por_turno` e uma so: aqui NAO se exige
-- `horario`. Turno importa para contar aluno por turno; para presenca, quem
-- entrou na sala entrou, com ou sem turno cadastrado.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/comercial_alunos_do_bonus_LIMPO.sql
-- ===========================================================================


-- ===========================================================================
-- Os nomes de quem gera bonus
-- ===========================================================================
create or replace function public.comercial_alunos_do_bonus(
  p_ref              date    default current_date,
  p_desconto_maximo  numeric default 0.10
)
returns table (nome text, nome_busca text)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'sem sessao' using errcode = '42501';
  end if;

  v_org := public.organizacao_do_auth();
  if v_org is null then
    raise exception 'sem organizacao' using errcode = '42501';
  end if;

  -- Mesma permissao do outro: quem nao fecha folha nao precisa da carteira de
  -- clientes com o desconto de cada um.
  if not public.tem_permissao('equipe.folha') then
    raise exception 'sem permissao equipe.folha' using errcode = '42501';
  end if;

  return query
  with periodos as (
    select a.id, a.paciente_id,
           a.inicio_periodo, a.fim_periodo, a.valor_contratado, a.plano_id
      from public.comercial_assinaturas a
     where a.nutri_id = v_org
       and a.status = 'ativa'
    union all
    select a.id, a.paciente_id,
           (ad.antes ->> 'inicio_periodo')::date,
           (ad.antes ->> 'fim_periodo')::date,
           (ad.antes ->> 'valor_contratado')::numeric,
           (ad.antes ->> 'plano_id')::uuid
      from public.comercial_assinaturas a
      join public.comercial_assinatura_auditoria ad
        on ad.assinatura_id = a.id
       and ad.acao = 'renovada'
       and ad.antes ->> 'inicio_periodo' is not null
       and ad.antes ->> 'fim_periodo'    is not null
     where a.nutri_id = v_org
       and a.status = 'ativa'
  ),
  cobrindo as (
    select distinct on (pe.id) pe.*
      from periodos pe
     where pe.inicio_periodo <= p_ref
       and pe.fim_periodo    >= p_ref
     order by pe.id, pe.fim_periodo desc
  )
  select distinct
         pa.nome,
         lower(translate(btrim(pa.nome),
                 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
    from cobrindo c
    join public.comercial_planos p  on p.id = c.plano_id
    join public.pacientes        pa on pa.id = c.paciente_id
   where p.preco_padrao > 0
     and (1 - coalesce(c.valor_contratado, p.preco_padrao) / p.preco_padrao) <= p_desconto_maximo
     and coalesce(btrim(pa.nome), '') <> '';
end;
$fn$;

revoke all on function public.comercial_alunos_do_bonus(date, numeric) from public, anon;
grant execute on function public.comercial_alunos_do_bonus(date, numeric) to authenticated;


-- ===========================================================================
-- CONFERENCIA. Esperado:
--   teto_por_turno = 0.10 · teto_do_bonus = 0.10 · definer = true (as duas)
-- ---------------------------------------------------------------------------
-- Rode tambem, para ver o efeito do teto novo antes de fechar a folha:
--
--   select count(*) from public.comercial_alunos_do_bonus(date '2026-08-31');
--
-- E quantas presencas isso barra no bonus por presenca, que ate agora pagava
-- por todo mundo.
-- ===========================================================================
select
  (select pg_get_function_arg_default(p.oid, 2) from pg_proc p
    where p.proname = 'comercial_alunos_por_turno')  as teto_por_turno,
  (select pg_get_function_arg_default(p.oid, 2) from pg_proc p
    where p.proname = 'comercial_alunos_do_bonus')   as teto_do_bonus,
  (select bool_and(p.prosecdef) from pg_proc p
    where p.proname in ('comercial_alunos_por_turno', 'comercial_alunos_do_bonus')) as definer;
