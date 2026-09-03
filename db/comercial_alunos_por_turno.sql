-- ===========================================================================
-- Evollo · ALUNOS ATIVOS POR TURNO, NA DATA DO FECHAMENTO
-- ---------------------------------------------------------------------------
-- 100% re-executavel. Desfazer: db/comercial_alunos_por_turno_desfazer.sql
--
-- Uma funcao. Ela responde "quantos alunos ativos cada turno tinha no dia X",
-- e e desse numero que sai o bonus por aluno no contracheque.
--
-- PODE RODAR ANTES DO FRONTEND. Funcao nova nao muda comportamento nenhum:
-- quem nao a chama nao percebe que ela existe. E a ordem inversa da 4B e da
-- 4C, e aqui ela e a certa — o frontend e que vai depender dela.
--
-- ===========================================================================
-- POR QUE ISTO NAO E UM `SELECT` NA TELA
-- ---------------------------------------------------------------------------
-- A conta parece simples e nao e. Ela precisa saber como cada assinatura estava
-- NUMA DATA PASSADA, e o banco so guarda o estado de HOJE:
-- `comercial_assinaturas.fim_periodo` e o periodo VIGENTE, e ele anda a cada
-- pagamento.
--
-- Perguntar hoje "quem estava vencido em 31/08" usando o `fim_periodo` de hoje
-- da a resposta errada para quem renovou depois: a pessoa aparece em dia. Em
-- 03/09/2026 isso valia para 10 das 94 assinaturas — mais de 10% da base, num
-- numero que vira dinheiro.
--
-- Entao a funcao REBOBINA. Para cada assinatura ela procura a renovacao mais
-- ANTIGA registrada DEPOIS da data de referencia e usa o `antes` dela:
--
--   comercial_assinatura_auditoria.antes = { plano_id, valor_contratado,
--                                            inicio_periodo, fim_periodo }
--
-- Sem renovacao posterior, o estado de hoje ja era o daquele dia. E o mesmo
-- mecanismo que a Migration C usou para achar o periodo historico das
-- cobrancas.
--
-- ===========================================================================
-- O QUE A REBOBINAGEM NAO ALCANCA
-- ---------------------------------------------------------------------------
--   A AUDITORIA COMECOU EM 13/08/2026 (Migration A). Para data anterior a essa
--   nao ha o que rebobinar, e a funcao devolve a foto de hoje. Fechar julho de
--   2026 com ela da um numero aproximado — e a aproximacao nao aparece
--   sozinha, entao quem for fazer isso precisa saber.
--
--   CANCELAMENTO NAO E AUDITADO. `acao` so registra renovacao. Assinatura
--   cancelada em setembro conta como cancelada em agosto tambem. O erro e
--   pequeno na pratica: quem cancela costuma vir de um vencimento, e vencido
--   ja nao contava.
--
-- Nenhuma das duas se conserta aqui. Consertar exigiria auditar tudo o que
-- muda numa assinatura, o que e outra etapa — e inventar o dado que falta seria
-- pior que dizer que ele falta.
--
-- ===========================================================================
-- AS REGRAS DE QUEM CONTA
-- ---------------------------------------------------------------------------
--   . assinatura ATIVA e com turno preenchido;
--   . o cliente ja existia na data (`data_inicio_original <= a data`);
--   . o periodo NAO estava vencido na data;
--   . o desconto sobre o preco do plano nao passa do teto (20% por padrao).
--
-- O TETO E PARAMETRO, e nao numero escrito no meio da consulta: mudar a regra
-- comercial nao pode exigir migracao. O padrao vem do combinado de 03/09/2026.
--
-- DESCONTO NEGATIVO CONTA. Quem paga ACIMA da tabela — acontece quando o preco
-- do plano baixa depois do contrato — nao e bolsista. Um `abs()` aqui excluiria
-- justamente quem paga mais.
--
-- ===========================================================================
-- POR QUE SECURITY DEFINER, E O QUE ISSO CONCEDE
-- ---------------------------------------------------------------------------
-- A funcao exige `equipe.folha` e NAO exige `comercial.visualizar`.
--
-- Ela devolve DOIS INTEIROS por turno. Nao devolve nome, valor, plano nem
-- vencimento de ninguem — nada que identifique cliente. Quem fecha a folha
-- precisa do NUMERO para calcular o bonus, e nao da lista de clientes.
--
-- Exigir `comercial.visualizar` daria a quem fecha a folha o acesso a carteira
-- inteira so para somar duas contagens. Menos permissao pelo mesmo resultado.
-- ===========================================================================

create or replace function public.comercial_alunos_por_turno(
  p_ref              date    default current_date,
  p_desconto_maximo  numeric default 0.20
)
returns table (turno text, alunos integer)
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

  if not public.tem_permissao('equipe.folha') then
    raise exception 'sem permissao equipe.folha' using errcode = '42501';
  end if;

  return query
  with rebobinada as (
    select
      a.id,
      trim(a.horario) as turno,
      -- `distinct on` pega a renovacao mais ANTIGA depois da data: e o `antes`
      -- dela que descreve como a assinatura estava naquele dia.
      coalesce((h.antes ->> 'fim_periodo')::date,      a.fim_periodo)      as fim_periodo,
      coalesce((h.antes ->> 'valor_contratado')::numeric, a.valor_contratado) as valor_contratado,
      coalesce((h.antes ->> 'plano_id')::uuid,         a.plano_id)         as plano_id
    from public.comercial_assinaturas a
    left join lateral (
      select ad.antes
        from public.comercial_assinatura_auditoria ad
       where ad.assinatura_id = a.id
         and ad.acao = 'renovada'
         and ad.criado_em::date > p_ref
       order by ad.criado_em
       limit 1
    ) h on true
    where a.nutri_id = v_org
      and a.status = 'ativa'
      and coalesce(trim(a.horario), '') <> ''
      -- Cliente que comecou depois da data nao existia nela.
      and (a.data_inicio_original is null or a.data_inicio_original <= p_ref)
  )
  select r.turno, count(*)::integer
    from rebobinada r
    join public.comercial_planos p on p.id = r.plano_id
   where r.fim_periodo >= p_ref
     and p.preco_padrao > 0
     -- Sem valor contratado, vale o preco do plano: desconto zero.
     and (1 - coalesce(r.valor_contratado, p.preco_padrao) / p.preco_padrao) <= p_desconto_maximo
   group by r.turno
   order by r.turno;
end;
$fn$;

-- A anon-key nao tem nada que fazer aqui: a funcao le carteira de cliente para
-- somar, mesmo devolvendo so o total.
revoke all on function public.comercial_alunos_por_turno(date, numeric) from public, anon;
grant execute on function public.comercial_alunos_por_turno(date, numeric) to authenticated;


-- ===========================================================================
-- Conferencia. Esperado:
--   definer = true · stable = true · search_path fixo
--   e a contagem de 31/08/2026 batendo com db/conferencia/113 — com a
--   diferenca da rebobinagem, que o 113 nao faz.
-- ===========================================================================
select
  p.prosecdef                                                   as definer,
  p.provolatile = 's'                                           as estavel,
  array_to_string(p.proconfig, ', ')                            as config,
  pg_get_function_identity_arguments(p.oid)                     as argumentos
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'comercial_alunos_por_turno';
