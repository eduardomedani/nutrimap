-- ===========================================================================
-- POR QUE O ESPELHO NAO CEDEU A VEZ PARA A PLANILHA
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- O QUE ACONTECEU. Depois de importar a planilha e rodar
-- db/financeiro_folha_despesa.sql, a conferencia devolveu:
--
--   folhas_fechadas 32 | espelhos 32 | fechadas_sem_espelho 0
--
-- Esperava-se MENOS espelhos que folhas fechadas: onde a planilha ja tem FOPAG,
-- `financeiro_folha_sincronizar` nao deve criar. Como criou para todas, a
-- condicao nao casou, e ela compara duas coisas:
--
--   l.nutri_id    = f.nutri_id     o dono
--   l.competencia = f.competencia  o mes
--
-- Este script responde qual das duas falhou. Sao hipoteses excludentes e cada
-- uma tem conserto proprio, entao vale a pena saber antes de mexer.
--
-- HIPOTESE A — O DONO. O seed escolhe o dono assim: `auth.uid()` se houver
-- sessao; senao, o `nutri_id` das folhas quando ha um so; senao, um usuario por
-- e-mail. Se houver folha fantasma de outro dono (db/folha_apagar_fantasmas.sql
-- e a conferencia 111), a contagem passa de um e o e-mail decide — e pode ter
-- decidido por um uuid diferente do da organizacao. Nesse caso as despesas
-- importadas nem aparecem na tela.
--
-- HIPOTESE B — O MES. A FOPAG entra na competencia do PAGAMENTO: "FOPAG REF:
-- OUTUBRO" paga em 14/11/2023 vira competencia 2023-11-01. Se as folhas do
-- sistema foram gravadas com o mes TRABALHADO, os dois conjuntos ficam
-- deslocados em um mes e nunca se encontram. A conferencia 115 investigou
-- exatamente essa duvida.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) O DONO: quem e o dono de cada coisa
-- ---------------------------------------------------------------------------
-- Esperado: os tres iguais. Qualquer divergencia e a hipotese A.
-- ---------------------------------------------------------------------------
select
  'organizacao do proprietario' as quem,
  (select o.id::text from public.organizacoes o
     join public.admins a on a.user_id = o.proprietario_user_id limit 1) as id,
  null::bigint as linhas
union all
select
  'dono das folhas',
  f.nutri_id::text,
  count(*)
from public.folhas f group by f.nutri_id
union all
select
  'dono das despesas da planilha',
  l.nutri_id::text,
  count(*)
from public.financeiro_lancamentos l
where l.origem = 'planilha' group by l.nutri_id
union all
select
  'dono dos espelhos',
  l.nutri_id::text,
  count(*)
from public.financeiro_lancamentos l
where l.origem = 'folha' group by l.nutri_id;

-- ---------------------------------------------------------------------------
-- 2) O MES: as competencias lado a lado
-- ---------------------------------------------------------------------------
-- `tem_fopag` e `tem_espelho` na mesma linha e o retrato da duplicidade.
-- Se a coluna `tem_fopag` estiver deslocada um mes em relacao as folhas, e a
-- hipotese B.
-- ---------------------------------------------------------------------------
with meses as (
  select competencia from public.folhas where status = 'fechada'
  union
  select competencia from public.financeiro_lancamentos
   where origem = 'planilha' and metadata ->> 'folha' = 'true'
)
select
  m.competencia,
  exists (select 1 from public.folhas f
           where f.competencia = m.competencia and f.status = 'fechada')      as folha_fechada,
  (select count(*) from public.financeiro_lancamentos l
    where l.competencia = m.competencia and l.origem = 'planilha'
      and l.metadata ->> 'folha' = 'true')                                    as fopag_da_planilha,
  (select count(*) from public.financeiro_lancamentos l
    where l.competencia = m.competencia and l.origem = 'folha'
      and l.status <> 'cancelado')                                            as espelhos_ativos,
  (select to_char(coalesce(sum(l.valor), 0), 'FM999G999G990D00')
     from public.financeiro_lancamentos l
    where l.competencia = m.competencia and l.origem = 'planilha'
      and l.metadata ->> 'folha' = 'true')                                    as valor_da_planilha,
  (select to_char(coalesce(sum(l.valor), 0), 'FM999G999G990D00')
     from public.financeiro_lancamentos l
    where l.competencia = m.competencia and l.origem = 'folha'
      and l.status <> 'cancelado')                                            as valor_do_espelho,
  case
    when (select count(*) from public.financeiro_lancamentos l
           where l.competencia = m.competencia and l.origem = 'planilha'
             and l.metadata ->> 'folha' = 'true') > 0
     and (select count(*) from public.financeiro_lancamentos l
           where l.competencia = m.competencia and l.origem = 'folha'
             and l.status <> 'cancelado') > 0
      then 'DUPLICADO'
    else 'ok'
  end                                                                         as resultado
from meses m
order by m.competencia desc;

-- ---------------------------------------------------------------------------
-- 3) A resposta em numeros
-- ---------------------------------------------------------------------------
-- donos_diferentes > 0            -> hipotese A
-- duplicados > 0 e donos iguais   -> hipotese B (ou a marca nao gravou)
-- fopag_sem_marca > 0             -> a marca `metadata.folha` nao entrou
-- ---------------------------------------------------------------------------
select
  (select count(distinct nutri_id) from public.folhas)                        as donos_de_folha,
  (select count(distinct nutri_id) from public.financeiro_lancamentos
    where origem = 'planilha')                                                as donos_de_despesa,
  (select count(*) from public.financeiro_lancamentos l
     join public.folhas f on f.competencia = l.competencia
    where l.origem = 'planilha' and l.metadata ->> 'folha' = 'true'
      and l.nutri_id is distinct from f.nutri_id)                             as fopag_de_outro_dono,
  (select count(*) from public.financeiro_lancamentos
    where origem = 'planilha' and descricao ilike 'FOPAG%'
      and coalesce(metadata ->> 'folha', '') <> 'true')                       as fopag_sem_marca,
  (select count(*) from (
     select l.competencia
       from public.financeiro_lancamentos l
      where l.status <> 'cancelado'
        and (l.origem = 'folha' or l.metadata ->> 'folha' = 'true')
      group by l.competencia
     having count(distinct case when l.origem = 'folha' then 'espelho' else 'planilha' end) > 1
   ) x)                                                                       as competencias_duplicadas;
