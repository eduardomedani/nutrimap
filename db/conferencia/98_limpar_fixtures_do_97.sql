-- ===========================================================================
-- LIMPEZA DAS 3 LINHAS DE AUDITORIA QUE A 97 DEIXOU PARA TRAS
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE, e escreve pouco: remove exatamente as linhas de
-- `comercial_assinatura_auditoria` criadas pela bateria de testes 97.
--
-- POR QUE ELAS FICARAM. A limpeza da 97 comparava `criado_em >= clock_timestamp()`
-- capturado dentro do bloco. Mas `criado_em` usa o default `now()`, que no
-- Postgres e `transaction_timestamp()` — o instante em que a TRANSACAO comecou,
-- sempre anterior. O predicado nunca foi verdadeiro, e a 97 relatou "0
-- removidas" enquanto 3 linhas continuavam la. A 97 ja foi corrigida para
-- comparar IDS contra um snapshot, que nao depende de relogio.
--
-- POR QUE ESTAS 3 SAO INEQUIVOCAMENTE FIXTURE, e nao dado legitimo:
--
--   1. a 93 mediu a tabela VAZIA depois de aplicar a Migration A;
--   2. a 97 registrou baseline 0 no proprio preparo (item 7);
--   3. as 3 sao da assinatura cobaia, e as acoes batem com os casos
--      B (renovacao_programada), D (renovacao_cancelada) e C (renovacao_programada);
--   4. as cobrancas que as originaram JA NAO EXISTEM — a 97 as removeu (item 92).
--
-- A SECAO 1 LISTA antes de qualquer delete. Rode ela, confira, e so entao o
-- resto. Se aparecer qualquer linha que voce nao reconheca como teste, PARE:
-- o predicado da secao 2 e restrito, mas quem decide o que e fixture e voce.
--
-- NAO EXISTE `delete` SEM PREDICADO neste arquivo. O da secao 2 exige as tres
-- coisas ao mesmo tempo: a assinatura cobaia, uma das duas acoes de renovacao,
-- e uma origem que aponta para lancamento que nao existe mais.
--
-- Para colar no SQL Editor, use db/conferencia/98_limpar_fixtures_do_97_LIMPO.sql
-- ===========================================================================


-- ===========================================================================
-- 1) O QUE EXISTE HOJE — leia antes de rodar a secao 2
-- ===========================================================================
select
  ca.id,
  p.nome                                            as cliente,
  ca.acao,
  to_char(ca.criado_em, 'DD/MM/YYYY HH24:MI:SS')    as quando,
  case when ca.usuario_id is null then '(sem autor)'
       else left(ca.usuario_id::text, 8) end        as autor,
  ca.antes,
  ca.depois,
  -- A marca de fixture: a cobranca que originou a intencao ja nao existe.
  coalesce(ca.depois ->> 'renovacao_origem_id', ca.antes ->> 'renovacao_origem_id') as origem_id,
  case
    when coalesce(ca.depois ->> 'renovacao_origem_id', ca.antes ->> 'renovacao_origem_id') is null
      then 'sem origem (a renovacao_cancelada nao guarda)'
    when exists (select 1 from public.financeiro_lancamentos l
                  where l.id = coalesce(ca.depois ->> 'renovacao_origem_id',
                                        ca.antes  ->> 'renovacao_origem_id')::uuid)
      then 'A COBRANCA AINDA EXISTE — nao e fixture, NAO APAGUE'
    else 'cobranca de origem removida — fixture da 97'
  end                                               as veredito
from public.comercial_assinatura_auditoria ca
join public.comercial_assinaturas a on a.id = ca.assinatura_id
join public.pacientes p             on p.id = a.paciente_id
order by ca.criado_em;


-- ===========================================================================
-- 2) A REMOCAO
-- ---------------------------------------------------------------------------
-- Tres condicoes simultaneas. A ultima e a que importa: uma linha cuja
-- cobranca de origem AINDA EXISTE nao e fixture, e nao e tocada aqui — nem que
-- ela esteja na mesma assinatura e com a mesma acao.
--
-- A `renovacao_cancelada` nao guarda origem no `depois` (ela zera tudo), entao
-- ela e alcancada pelo `antes`, que guarda de onde veio.
-- ===========================================================================
delete from public.comercial_assinatura_auditoria ca
 where ca.acao in ('renovacao_programada', 'renovacao_cancelada')
   and coalesce(ca.depois ->> 'renovacao_origem_id', ca.antes ->> 'renovacao_origem_id') is not null
   and not exists (
         select 1 from public.financeiro_lancamentos l
          where l.id = coalesce(ca.depois ->> 'renovacao_origem_id',
                                ca.antes  ->> 'renovacao_origem_id')::uuid);


-- ===========================================================================
-- 3) O QUE SOBROU
-- ---------------------------------------------------------------------------
-- Esperado: 0. Se sobrar alguma, a secao 1 diz qual e por que — e ela nao e
-- fixture.
-- ===========================================================================
select
  (select count(*) from public.comercial_assinatura_auditoria)                     as auditoria_agora,
  (select count(*) from public.comercial_assinaturas where proximo_plano_id is not null) as renovacoes_programadas,
  (select count(*) from public.comercial_assinaturas)                              as assinaturas,
  (select count(*) from public.financeiro_lancamentos where assinatura_id is not null) as cobrancas;
