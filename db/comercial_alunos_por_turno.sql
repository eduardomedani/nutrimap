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
-- 03/09/2026 isso valia para 11 das 95 assinaturas — mais de 10% da base, num
-- numero que vira dinheiro.
--
-- ===========================================================================
-- A PERGUNTA CERTA NAO E "ESTAVA EM DIA", E "O DIA ESTAVA PAGO"
-- ---------------------------------------------------------------------------
-- Ate 04/09/2026 esta funcao rebobinava: procurava a renovacao mais ANTIGA
-- depois da data e usava o `antes` dela para reconstruir como a assinatura
-- estava NAQUELE dia. O numero saia certo para a pergunta "quem estava com a
-- mensalidade em dia em 31/08" — e essa era a pergunta errada.
--
-- A conferencia 113 mostrou por que. Dos que a rebobinagem tirava, dez tinham
-- renovado poucos dias depois com o periodo novo COMECANDO onde o antigo
-- terminou: Charlene vencia 26/08 e passou a ter 26/08 a 25/09. O dia 31/08
-- esta dentro de um periodo pago. Ela pagou atrasado, nao deixou de ser aluna
-- — e o bonus conta ALUNOS, nao pontualidade deles.
--
-- Entao a regra virou COBERTURA: a assinatura conta se a data de referencia cai
-- dentro de algum periodo que ela ja teve. E os periodos que ela ja teve estao
-- todos ali, porque toda `renovada` grava o intervalo dos dois lados:
--
--   comercial_assinatura_auditoria.antes = { plano_id, valor_contratado,
--                                            inicio_periodo, fim_periodo }
--
-- A uniao dos `antes` com o periodo de hoje e a vida inteira da assinatura. A
-- consulta procura nela o periodo que contem a data e usa o plano e o valor
-- DAQUELE periodo para medir o desconto — nao os de hoje.
--
-- ISSO SUBSTITUI TRES REGRAS POR UMA. Nao ha mais "rebobinar", nem
-- "`fim_periodo` >= a data", nem "`data_inicio_original` <= a data": quem nao
-- existia na data nao tem periodo que a contenha, e quem estava vencido
-- tambem nao. Uma condicao no lugar de tres, e as tres eram a mesma pergunta
-- feita torto.
--
-- QUEM TEM BURACO CONTINUA FORA, e e o teste de que a regra discrimina: em
-- 31/08/2026, Flavio renovou com periodo comecando em 02/09 e nao conta. Nao e
-- "todo mundo que pagou algum dia" — e "o dia estava coberto".
--
-- ===========================================================================
-- O QUE A REBOBINAGEM NAO ALCANCA
-- ---------------------------------------------------------------------------
--   A AUDITORIA COMECOU EM 13/08/2026 (Migration A). Antes disso nao ha
--   periodo historico guardado, e so o periodo de hoje sobra para consultar.
--   Fechar julho de 2026 com ela da um numero aproximado — e a aproximacao nao
--   aparece sozinha, entao quem for fazer isso precisa saber.
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
--   . a data cai dentro de algum periodo da assinatura — o de hoje ou um que a
--     auditoria guardou (isto ja diz que o cliente existia e que o dia estava
--     pago, ainda que o pagamento tenha entrado depois);
--   . o desconto do periodo QUE COBRE A DATA nao passa do teto (10% por padrao).
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
  p_desconto_maximo  numeric default 0.10
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
  -- Todo periodo que cada assinatura ativa ja teve: o de hoje, mais os que a
  -- auditoria guardou. `union all` e nao `union` de proposito — periodo
  -- repetido nao muda o resultado, e o `distinct on` abaixo escolhe um so.
  with periodos as (
    select a.id, trim(a.horario) as turno,
           a.inicio_periodo, a.fim_periodo, a.valor_contratado, a.plano_id
      from public.comercial_assinaturas a
     where a.nutri_id = v_org
       and a.status = 'ativa'
       and coalesce(trim(a.horario), '') <> ''
    union all
    select a.id, trim(a.horario) as turno,
           (ad.antes ->> 'inicio_periodo')::date,
           (ad.antes ->> 'fim_periodo')::date,
           (ad.antes ->> 'valor_contratado')::numeric,
           (ad.antes ->> 'plano_id')::uuid
      from public.comercial_assinaturas a
      join public.comercial_assinatura_auditoria ad
        on ad.assinatura_id = a.id
       and ad.acao = 'renovada'
       -- Auditoria antiga pode nao ter o intervalo. Sem ele nao da para dizer
       -- se cobre a data, e chutar seria pior que faltar.
       and ad.antes ->> 'inicio_periodo' is not null
       and ad.antes ->> 'fim_periodo'    is not null
     where a.nutri_id = v_org
       and a.status = 'ativa'
       and coalesce(trim(a.horario), '') <> ''
  ),
  -- Um periodo por assinatura: o que contem a data. Se mais de um contiver —
  -- correcao manual que gerou sobreposicao — vale o que termina depois, que e
  -- o mais recente e reflete a ultima decisao tomada sobre aquele cliente.
  cobrindo as (
    select distinct on (pe.id) pe.*
      from periodos pe
     where pe.inicio_periodo <= p_ref
       and pe.fim_periodo    >= p_ref
     order by pe.id, pe.fim_periodo desc
  )
  select c.turno, count(*)::integer
    from cobrindo c
    join public.comercial_planos p on p.id = c.plano_id
   where p.preco_padrao > 0
     -- Sem valor contratado, vale o preco do plano: desconto zero.
     and (1 - coalesce(c.valor_contratado, p.preco_padrao) / p.preco_padrao) <= p_desconto_maximo
   group by c.turno
   order by c.turno;
end;
$fn$;

-- A anon-key nao tem nada que fazer aqui: a funcao le carteira de cliente para
-- somar, mesmo devolvendo so o total.
revoke all on function public.comercial_alunos_por_turno(date, numeric) from public, anon;
grant execute on function public.comercial_alunos_por_turno(date, numeric) to authenticated;


-- ===========================================================================
-- Conferencia. Esperado:
--   definer = true · stable = true · search_path fixo
--   e a contagem de 31/08/2026 dando Diurno 28 e Noturno 25 — os mesmos
--   numeros da secao COBERTURA de db/conferencia/113. Se discordarem, um dos
--   dois esta lendo o dia errado.
-- ===========================================================================
select
  p.prosecdef                                                   as definer,
  p.provolatile = 's'                                           as estavel,
  array_to_string(p.proconfig, ', ')                            as config,
  pg_get_function_identity_arguments(p.oid)                     as argumentos
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'comercial_alunos_por_turno';
