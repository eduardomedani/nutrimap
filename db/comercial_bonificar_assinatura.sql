-- ===========================================================================
-- Evollo · TORNAR UMA ASSINATURA BONIFICACAO (cliente que nao paga)
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE. Tem desfazer:
-- db/comercial_bonificar_assinatura_desfazer.sql
--
-- 100% re-executavel. Para bonificar outra pessoa, troque `v_nome` no topo.
--
-- ===========================================================================
-- O PROBLEMA QUE ELE RESOLVE
-- ---------------------------------------------------------------------------
-- Um cliente de cortesia nao tem pagamento — e no Evollo e o PAGAMENTO que faz
-- o periodo andar (`comercial_registrar_pagamento` e a porta unica, de
-- proposito). Sem pagamento o `fim_periodo` congela no passado, e como
-- `situacaoDoCliente` deriva a situacao dessa data (js/comercial.js:157), o
-- bonificado vira "Vencido" para sempre.
--
-- Pior: `pesoDaUrgencia` poe vencido em primeiro lugar e, entre vencidos, o
-- mais antigo na frente. O cliente que nunca vai pagar sobe ao TOPO da lista
-- de quem precisa de atencao, e empurra para baixo quem realmente deve.
--
-- ===========================================================================
-- A SOLUCAO: UM PLANO DE VERDADE, COM PRECO ZERO E PERIODO LONGO
-- ---------------------------------------------------------------------------
-- Nada de flag nova nem coluna nova. Bonificacao E um plano comercial: tem
-- nome, tem duracao, tem preco — que por acaso e zero. Modelar assim faz o
-- resto do sistema acertar sozinho:
--
--   MRR NAO SE MEXE. `indicadores()` soma so quando `valor > 0`
--   (js/comercial.js:323). Bonificado nao infla nem esvazia a receita
--   recorrente — ele simplesmente nao entra nela.
--
--   ELE CONTA COMO ATIVO, que e a verdade: usa a academia, ocupa horario,
--   aparece na frequencia. Some-lo dos ativos mentiria sobre a ocupacao.
--
--   A CATEGORIA SAI CERTA. Se um dia nascer cobranca para ele, ela vai para a
--   categoria "Bonificacao" (db/comercial_rotulo_da_cobranca.sql), e nao
--   misturada no "Mensal - 5x" de quem paga.
--
--   O PERIODO LONGO E O TRUQUE. Doze meses por padrao: o bonificado fica
--   "Ativo" o ano inteiro e some da fila de urgencia. Quando o periodo
--   terminar, ele reaparece — que e o comportamento desejado, porque
--   cortesia deveria mesmo ser revista de tempos em tempos, e nao virar
--   permanente por esquecimento.
--
-- ===========================================================================
-- O QUE ELE NAO FAZ
-- ---------------------------------------------------------------------------
--   NAO CRIA COBRANCA. `renovacao_automatica` fica desligada e nenhuma linha
--   entra no Financeiro. Cobranca de R$ 0,00 e ruido: ocupa a lista, pede
--   baixa e nao move dinheiro.
--
--   NAO APAGA HISTORICO. Os pagamentos que a pessoa fez enquanto pagava
--   continuam onde estao. A assinatura e a MESMA linha — muda o plano, o
--   valor e o periodo, e `data_inicio_original` fica intacta, entao "cliente
--   desde" nao mente.
--
--   NAO MEXE EM MAIS NINGUEM. So na assinatura viva da pessoa nomeada.
--
-- UMA CONSEQUENCIA PARA VOCE SABER: aluno bonificado continua gerando bonus
-- de presenca para o estagiario (js/bonus-presenca.js paga por presenca de
-- ALUNO, sem olhar se aquele aluno pagou). Esta certo — o estagiario atendeu
-- a pessoa —, mas e custo real em cima de receita zero.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/comercial_bonificar_assinatura_LIMPO.sql
-- ===========================================================================

-- ===========================================================================
-- 0) A auditoria aprende a acao nova
-- ---------------------------------------------------------------------------
-- O CHECK de `acao` lista so as tres da renovacao programada, e o proprio
-- arquivo que o criou diz que quem precisar de outra amplia aqui
-- (db/comercial_renovacao_programada.sql:144). Sem isto o insert da trilha
-- estoura e derruba a bonificacao junto.
-- ===========================================================================
alter table public.comercial_assinatura_auditoria drop constraint if exists comercial_assinatura_auditoria_acao_check;
alter table public.comercial_assinatura_auditoria add  constraint comercial_assinatura_auditoria_acao_check
  check (acao in ('renovacao_programada', 'renovacao_cancelada', 'renovada',
                  'bonificada', 'bonificacao_desfeita'));


do $bonifica$
declare
  v_nome  text := 'NOME COMPLETO DO CLIENTE';   -- <<< troque aqui
  v_meses int  := 12;                  -- <<< e aqui, se a cortesia for mais curta
  v_org   uuid;
  v_pac   uuid;
  v_plano uuid;
  v_ass   uuid;
  v_antes jsonb;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  if v_org is null then
    raise exception 'organizacao nao encontrada — nada foi tocado';
  end if;

  -- Sem acento dos dois lados: a planilha e o cadastro discordam em varios
  -- nomes, e comparar cru nao acha a pessoa.
  select p.id into v_pac
    from public.pacientes p
   where p.nutri_id = v_org
     and lower(translate(trim(p.nome),
                 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
       = lower(translate(trim(v_nome),
                 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
   limit 1;

  if v_pac is null then
    raise exception 'cliente "%" nao encontrado — confira a grafia. Nada foi tocado.', v_nome;
  end if;

  -- ── 1) o plano Bonificacao — encontra ou cria ──────────────
  -- Encontra antes de criar: rodar duas vezes, ou bonificar um segundo
  -- cliente, tem de reusar o mesmo plano. Dois planos "Bonificacao" rachariam
  -- a contagem de cortesias em duas sem ninguem perceber.
  select pl.id into v_plano
    from public.comercial_planos pl
   where pl.nutri_id = v_org and lower(pl.nome) = 'bonificacao'
   limit 1;

  if v_plano is null then
    insert into public.comercial_planos
      (nutri_id, nome, descricao, duracao_valor, duracao_unidade,
       preco_padrao, tolerancia_dias, ativo, ordem)
    values
      (v_org, 'Bonificacao', 'Cortesia — o cliente usa a academia e nao paga.',
       v_meses, 'mes', 0, 0, true, 99)
    returning id into v_plano;
    raise notice 'plano Bonificacao criado';
  else
    raise notice 'plano Bonificacao ja existia — reaproveitado';
  end if;

  -- ── 2) a assinatura ────────────────────────────────────────
  select a.id into v_ass
    from public.comercial_assinaturas a
   where a.paciente_id = v_pac
     and a.status in ('ativa', 'pausada', 'aguardando_inicio')
   order by a.criado_em desc
   limit 1;

  if v_ass is null then
    raise exception 'nenhuma assinatura viva para "%". Nada foi tocado.', v_nome;
  end if;

  -- O ESTADO ANTERIOR VAI ESTRUTURADO, e nao como frase. Guardado em texto
  -- ("plano Mensal - 5x | R$ 385,00 | ...") ele serve para um humano ler e para
  -- nada mais — o desfazer teria de reinterpretar a frase para devolver os
  -- campos, e erraria no primeiro plano cujo nome tivesse uma barra.
  select jsonb_build_object(
           'plano_id',             a.plano_id,
           'plano_nome',           pl.nome,
           'valor_contratado',     a.valor_contratado,
           'inicio_periodo',       a.inicio_periodo,
           'fim_periodo',          a.fim_periodo,
           'status',               a.status,
           'renovacao_automatica', a.renovacao_automatica)
    into v_antes
    from public.comercial_assinaturas a
    left join public.comercial_planos pl on pl.id = a.plano_id
   where a.id = v_ass;
  raise notice 'antes: %', v_antes::text;

  -- O periodo recomeca HOJE. Continuar do termino anterior deixaria a cortesia
  -- ja parcialmente gasta por um atraso que nao foi de ninguem.
  --
  -- `data_inicio_original` NAO entra no update: e desde quando a pessoa e
  -- cliente, e virar cortesia nao a faz cliente nova.
  update public.comercial_assinaturas a
     set plano_id             = v_plano,
         valor_contratado     = 0,
         inicio_periodo       = current_date,
         fim_periodo          = (current_date + (v_meses || ' months')::interval)::date,
         status               = 'ativa',
         renovacao_automatica = false,
         atualizado_em        = now()
   where a.id = v_ass;

  -- ── 3) a trilha ────────────────────────────────────────────
  -- A ficha precisa dizer QUANDO virou cortesia e o que havia antes. Sem isto,
  -- daqui a um ano ninguem sabe se o R$ 0,00 foi decisao ou defeito.
  insert into public.comercial_assinatura_auditoria
    (nutri_id, assinatura_id, acao, usuario_id, antes, depois)
  select a.nutri_id, a.id, 'bonificada', auth.uid(),
         v_antes,
         jsonb_build_object('plano', 'Bonificacao', 'valor_contratado', 0,
                            'inicio_periodo', a.inicio_periodo,
                            'fim_periodo', a.fim_periodo,
                            'meses', v_meses)
    from public.comercial_assinaturas a
   where a.id = v_ass;

  raise notice 'depois: Bonificacao | R$ 0,00 | periodo % a %',
    current_date, (current_date + (v_meses || ' months')::interval)::date;
end $bonifica$;


-- ===========================================================================
-- CONFERENCIA. Esperado: bonificados >= 1 · com_cobranca_aberta = 0
-- ---------------------------------------------------------------------------
-- `com_cobranca_aberta` e a linha que importa: cortesia com cobranca em aberto
-- e contradicao — alguem vai cobrar quem foi dispensado de pagar.
-- ===========================================================================
select
  (select count(*) from public.comercial_assinaturas a
     join public.comercial_planos pl on pl.id = a.plano_id
    where lower(pl.nome) = 'bonificacao' and a.status = 'ativa')  as bonificados,
  (select count(*) from public.financeiro_lancamentos l
     join public.comercial_assinaturas a  on a.id = l.assinatura_id
     join public.comercial_planos      pl on pl.id = a.plano_id
    where lower(pl.nome) = 'bonificacao'
      and l.status = 'pendente' and l.arquivado_em is null)       as com_cobranca_aberta;
