-- ===========================================================================
-- Evollo · DESLIGAR A COBRANCA QUE NASCE NA BAIXA
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT APAGA. O passo 1 nao tem desfazer; o passo 2 tem.
--
-- Sao DUAS coisas, e uma sem a outra nao resolve:
--
--   PASSO 1  apaga as cobrancas pendentes que ainda NAO venceram
--   PASSO 2  desliga `renovacao_automatica` nas assinaturas vivas
--
-- Sem o passo 2, a proxima baixa recria tudo o que o passo 1 apagou. Sem o
-- passo 1, as que ja existem continuam la. Por isso vao no mesmo script.
--
-- O padrao da TELA mudou junto (js/comercial-formularios.js, assinaturaVazia):
-- assinatura nova ja nasce com a caixa desmarcada. Este script cuida das que
-- ja existiam.
--
-- ===========================================================================
-- O QUE VOCE GANHA E O QUE VOCE PERDE
-- ---------------------------------------------------------------------------
-- GANHA: o "a receber" do Financeiro passa a mostrar so o que esta vencido de
-- verdade. Hoje ele mistura vinte e duas cobrancas que ninguem deve ainda com
-- a unica que esta atrasada, e a tela nao distingue as duas (ela desenha
-- "Em aberto" para as duas — js/financeiro-ui.js:854).
--
-- PERDE: a visibilidade do faturamento previsto. Essas cobrancas NAO sao
-- adiantamento — elas cobrem o mes que o cliente esta treinando AGORA e vencem
-- no fim dele. Apagar nao cancela a divida: o cliente continua devendo o mes,
-- so que o sistema deixa de saber disso ate alguem criar a cobranca.
--
-- E MUDA O FLUXO DE QUEM RECEBE. Com a cobranca em aberto, dar baixa e um
-- clique no botao "Registrar pagamento". Sem ela, a ficha mostra "Nenhuma
-- cobranca em aberto" e e preciso clicar antes em "Criar cobranca do periodo"
-- (js/comercial-drawer.js:193). Passam a ser dois passos por pagamento.
--
-- Se o incomodo for so visual, a alternativa mais barata e um selo "Vencida" na
-- lista de receitas — resolve sem apagar nada. Este script e para quem decidiu
-- que a cobranca so deve existir quando o dinheiro chega.
--
-- ===========================================================================
-- O QUE ELE NAO TOCA, DE PROPOSITO
-- ---------------------------------------------------------------------------
--   COBRANCA JA VENCIDA. `vencimento < hoje` fica. Uma dessas e divida real de
--   cliente ativo, e apagar sumiria com dinheiro que alguem deve. Se voce
--   quiser tirar essa tambem, e decisao separada e consciente.
--
--   COBRANCA SEM VENCIMENTO. Nao da para dizer se venceu. Fica.
--
--   COBRANCA SEM ASSINATURA. As linhas antigas da planilha nao pertencem a
--   ciclo nenhum — outro assunto, outra decisao.
--
--   PAGAMENTO. Nada com `status = 'pago'` e tocado em nenhum dos dois passos.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/comercial_desligar_cobranca_antecipada_LIMPO.sql
-- ===========================================================================

do $desliga$
declare
  v_org uuid;
  v_n   int;
  v_v   numeric;
  r     record;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  if v_org is null then
    raise exception 'organizacao nao encontrada — nada foi tocado';
  end if;

  -- ═══════════ PASSO 1 — apagar as que ainda nao venceram ═══════════
  create temp table if not exists apaga_futuras (id uuid primary key) on commit drop;
  delete from apaga_futuras;

  insert into apaga_futuras (id)
  select l.id
    from public.financeiro_lancamentos l
   where l.nutri_id = v_org
     and l.tipo = 'receita'
     and l.status = 'pendente'
     and l.arquivado_em is null
     and l.assinatura_id is not null
     and l.vencimento is not null
     and l.vencimento >= current_date;

  select count(*) into v_n from apaga_futuras;
  select coalesce(sum(l.valor), 0) into v_v
    from public.financeiro_lancamentos l join apaga_futuras f on f.id = l.id;

  raise notice 'PASSO 1 — a vencer: % cobranca(s), R$ %', v_n, to_char(v_v, 'FM999G990D00');

  -- O backup possivel: a linha inteira no log, ja que `delete` nao volta.
  for r in
    select to_jsonb(l) as linha
      from public.financeiro_lancamentos l join apaga_futuras f on f.id = l.id
     order by l.vencimento
  loop
    raise notice 'APAGANDO %', r.linha::text;
  end loop;

  delete from public.financeiro_lancamentos l using apaga_futuras f where l.id = f.id;
  get diagnostics v_n = row_count;
  raise notice 'PASSO 1 — apagadas: %', v_n;

  -- ═══════════ PASSO 2 — a torneira ═══════════
  -- Sem isto o passo 1 e enxugar gelo: a proxima baixa recria a cobranca.
  -- `renovacao_definida_em` marca quando e por quem, para a ficha do cliente
  -- nao mentir que sempre foi assim.
  update public.comercial_assinaturas a
     set renovacao_automatica = false,
         atualizado_em        = now()
   where a.nutri_id = v_org
     and a.status in ('ativa', 'pausada', 'aguardando_inicio')
     and a.renovacao_automatica;

  get diagnostics v_n = row_count;
  raise notice 'PASSO 2 — assinaturas com renovacao desligada: %', v_n;
end $desliga$;


-- ===========================================================================
-- CONFERENCIA. Esperado depois de rodar:
--   a_vencer = 0 · ainda_ligadas = 0
--   vencidas = as que sobraram de proposito (divida real)
-- ===========================================================================
select
  (select count(*) from public.financeiro_lancamentos
    where tipo = 'receita' and status = 'pendente' and arquivado_em is null
      and assinatura_id is not null and vencimento >= current_date)  as a_vencer,
  (select count(*) from public.comercial_assinaturas
    where status in ('ativa', 'pausada', 'aguardando_inicio')
      and renovacao_automatica)                                      as ainda_ligadas,
  (select count(*) from public.financeiro_lancamentos
    where tipo = 'receita' and status = 'pendente' and arquivado_em is null
      and assinatura_id is not null and vencimento < current_date)   as vencidas;
