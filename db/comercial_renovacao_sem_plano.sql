-- ===========================================================================
-- COMERCIAL — MIGRATION D (PROPOSTA, NAO APLICADA): renovar sem plano E ERRO
-- ---------------------------------------------------------------------------
-- ESCRITA EM 14/08/2026 E NAO APLICADA. Aplicar so quando voce mandar.
--
-- Ela nao altera a Migration C: e um `create or replace` posterior, e o corpo
-- da funcao e o mesmo, com UM bloco trocado. Aplicar esta depois daquela.
--
-- O QUE ELA CONSERTA
--
-- A regra de renovacao esta correta e nao muda aqui. O que muda e o que
-- acontece quando o plano NAO PODE SER RESOLVIDO. Hoje:
--
--   if v_plano_id is not null then
--     select * into v_plano from public.comercial_planos where id = v_plano_id;
--     if found then
--       v_duracao    := coalesce(v_plano.duracao_valor, 30);
--       ...
--   -- Sem plano nenhum, vale o PLANO_PADRAO: 30 dias, dia, 5.
--
-- Ou seja: assinatura sem `plano_id`, ou apontando para um plano que sumiu, e
-- renovada com TRINTA DIAS inventados e tolerancia 5 inventada, em silencio. O
-- cliente recebe um periodo que ninguem contratou, e nada no banco registra
-- que foi um chute.
--
-- Isso e pior do que recusar. A duracao e o preco do servico: erra-la para
-- mais e entregar de graca, para menos e cobrar por algo nao entregue. E o
-- caso NAO e hipotetico — `comercial_assinaturas.plano_id` e anulavel, e um
-- `on delete set null` num plano removido chega exatamente aqui.
--
-- Os `coalesce` internos sao codigo morto e saem junto: `duracao_valor`,
-- `duracao_unidade` e `tolerancia_dias` sao todas `not null` no schema, entao
-- nenhuma delas pode ser nula quando a linha existe. Manter o coalesce sugere
-- uma incerteza que nao existe e esconde a unica que existe de verdade, que e
-- o plano nao ser encontrado.
--
-- O LADO JS JA FOI FEITO, e sem migration: `previaDaRenovacao()` passou a
-- devolver `semPlano: true` e `incompleta: true` em vez de prever 30 dias. A
-- tela ja sabia avisar "nao foi possivel confirmar" — e o mesmo caminho.
--
-- O QUE ELA NAO FAZ
--
--   - nao muda a regra de tolerancia nem a aritmetica do periodo
--   - nao muda o vencimento de nada
--   - nao muda a competencia
--   - nao mexe em plano INATIVO: inativo quer dizer "nao oferecer mais", e nao
--     "desfazer o combinado". Assinatura em plano inativo continua renovando
--
-- Desfazer: reaplicar db/comercial_periodo_da_cobranca.sql, que traz a versao
-- anterior desta funcao na integra.
-- ===========================================================================

-- Conferencia PRIMEIRO: existe alguma assinatura que cairia na excecao? Se
-- vier alguma linha, ela precisa de plano ANTES de a migration entrar, senao o
-- proximo pagamento dela passa a falhar.
select a.id, p.nome as cliente, a.status, a.plano_id, a.proximo_plano_id,
       a.inicio_periodo, a.fim_periodo, a.valor_contratado,
       case when a.plano_id is null and a.proximo_plano_id is null then 'SEM PLANO NENHUM'
            else 'plano aponta para linha inexistente' end as motivo
  from public.comercial_assinaturas a
  join public.pacientes p on p.id = a.paciente_id
 where a.status in ('ativa', 'aguardando_inicio')
   and not exists (
     select 1 from public.comercial_planos pl
      where pl.id = coalesce(a.proximo_plano_id, a.plano_id))
 order by p.nome;


-- ===========================================================================
-- O BLOCO 6, sem invencao
-- ---------------------------------------------------------------------------
-- Cole o corpo inteiro da funcao de db/comercial_periodo_da_cobranca.sql e
-- troque APENAS o trecho abaixo. Ele esta isolado aqui para a revisao ser
-- sobre a mudanca, e nao sobre 258 linhas identicas.
--
-- ANTES:
--
--   if v_plano_id is not null then
--     select * into v_plano from public.comercial_planos where id = v_plano_id;
--     if found then
--       v_duracao    := coalesce(v_plano.duracao_valor, 30);
--       v_unidade    := coalesce(v_plano.duracao_unidade, 'dia');
--       v_tolerancia := coalesce(v_plano.tolerancia_dias, 5);
--     end if;
--   end if;
--
-- DEPOIS:
--
--   if v_plano_id is null then
--     raise exception 'assinatura % nao tem plano: a duracao do periodo novo nao pode ser inventada'
--       , v_ass.id using errcode = '23514';
--   end if;
--
--   select * into v_plano from public.comercial_planos where id = v_plano_id;
--   if not found then
--     raise exception 'plano % nao encontrado para a assinatura %: a duracao do periodo novo nao pode ser inventada'
--       , v_plano_id, v_ass.id using errcode = 'P0002';
--   end if;
--   if v_plano.nutri_id is distinct from v_org then
--     raise exception 'plano fora da organizacao' using errcode = '42501';
--   end if;
--
--   v_duracao    := v_plano.duracao_valor;
--   v_unidade    := v_plano.duracao_unidade;
--   v_tolerancia := v_plano.tolerancia_dias;
--
-- E na declaracao, os defaults saem com eles:
--
--   v_duracao    integer;
--   v_unidade    text;
--   v_tolerancia integer;
--
-- A checagem de organizacao entra de brinde e nao e escopo novo: o plano que
-- ENTRA vinha sendo lido sem ela, enquanto a RPC da cobranca manual ja
-- validava o plano futuro do mesmo jeito. Era assimetria, nao decisao.
-- ===========================================================================
