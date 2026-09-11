-- ===========================================================================
-- Evollo · COMERCIAL — A COMPETENCIA DAS 23 PAGAS CORRIGIDAS VOLTA UM MES
-- ---------------------------------------------------------------------------
-- Autorizado em 11/09/2026, sobre a previa db/conferencia/135_competencia_das_29.sql.
--
-- O QUE E. db/comercial_periodo_das_pagas_de_inicio.sql moveu 29 pagas para o
-- periodo que elas ENCERRARAM e manteve a competencia. A regra da Migration C e
-- "competencia = mes do INICIO do periodo" — mantida, cada cliente ficaria com
-- duas receitas no mes do periodo atual e nenhuma no anterior (a Nilca ja
-- esta assim). Aqui a competencia dessas pagas passa ao mes do inicio do
-- periodo que elas cobrem.
--
-- EXATAMENTE 23 LINHAS, listadas por id abaixo, com o valor e as duas
-- competencias que a previa 135 mostrou:
--   20  agosto -> julho   R$ 5.917,00
--    3  julho  -> junho   R$ 1.005,00
--   total                 R$ 6.922,00
--
-- FICAM DE FORA, por decisao:
--   Phablo Correa Cabral  — setembro -> junho seriam tres meses; nao alterar
--   os 5 de periodo de um dia (Barbara, Hiago, Josemar, Kariny, Margareti) —
--     nao ha mes anterior no contrato
--
-- O QUE MUDA: `competencia`, `metadata` e `atualizado_em`. NADA MAIS. O script
-- fotografa pago_em, valor_pago, status, periodo_inicio, periodo_fim,
-- vencimento e valor antes, e compara depois — se qualquer um mudar, tudo volta.
--
-- ROLLBACK LINHA A LINHA. Cada linha guarda no `metadata`:
--   competencia_antes          a competencia de antes (date)
--   competencia_corrigida_por  'comercial_competencia_das_23'
--   competencia_corrigida_em   now()
-- E o gatilho `registrar_auditoria_financeiro` grava, sozinho, uma linha
-- 'editado' em financeiro_auditoria com a competencia antes e depois — um
-- segundo registro, independente do primeiro.
--
-- AS GUARDAS, tudo numa transacao — se uma parar, nada muda:
--   ANTES   a lista tem 23 ids e soma R$ 6.922,00; no banco, as 23 estao
--           exatamente como na previa (id, valor, competencia atual, mes do
--           inicio do periodo, pago, marcadas pela correcao do periodo, ainda
--           sem competencia_antes); 20 / R$ 5.917,00 de agosto e
--           3 / R$ 1.005,00 de julho
--   UPDATE  tocou exatamente 23
--   DEPOIS  as 23 com a competencia nova e a antiga guardada; nenhuma coluna
--           da fotografia mudou
--
-- O RESULTADO no fim: cada cliente (antes, agora, confere) e o total mensal
-- de receitas de junho, julho e agosto (antes, agora, diferenca).
--
-- Desfazer: db/comercial_competencia_das_23_desfazer.sql
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/comercial_competencia_das_23_LIMPO.sql
-- ===========================================================================

drop table if exists comp_alvo;
drop table if exists comp_foto;
create temp table comp_alvo (id uuid primary key, cliente text, valor numeric(12,2), de date, para date);
create temp table comp_foto (id uuid primary key, pago_em date, valor_pago numeric(12,2), status text,
                             periodo_inicio date, periodo_fim date, vencimento date, valor numeric(12,2));

insert into comp_alvo (id, cliente, valor, de, para) values
  ('8853a31b-9ca0-46cc-b8f3-0373fcd859e3', 'Ana Paula Biss Nunes',          330.00, '2026-08-01', '2026-07-01'),
  ('6cc3be92-303f-4d9b-8e0f-98655afdaf6d', 'Ana Paula Cipriano',            362.00, '2026-08-01', '2026-07-01'),
  ('e8b6ff88-a06d-4b9a-9074-7274ba3d70ad', 'Angela Coelho Silva',           190.00, '2026-08-01', '2026-07-01'),
  ('16ca8a6c-a41b-4906-a84f-c105a5de6519', 'Angela Luiza Demuner',          311.00, '2026-08-01', '2026-07-01'),
  ('193ceda2-eb5e-4be5-b84a-fd4c312a383b', 'Bruna Pimentel Bastos',         362.00, '2026-08-01', '2026-07-01'),
  ('3cc809df-6036-4836-ade0-0624778137f8', 'Cibely Vitorio de Armita',      220.00, '2026-08-01', '2026-07-01'),
  ('d056270d-3460-477e-a996-10fe925b4299', 'Diego Siqueira Ferreira',       362.00, '2026-08-01', '2026-07-01'),
  ('4e4d5af1-c3d7-4695-8f41-c3148d276bfe', 'Eliezer Carretta Bastos',       311.00, '2026-08-01', '2026-07-01'),
  ('9b757fe2-2f3b-4b73-89a1-a194a042e4b9', 'Fernanda Lannes Segatto',       385.00, '2026-08-01', '2026-07-01'),
  ('db5f5427-2f90-4beb-bde5-2d18cf57caa3', 'Gessica da Silva Loureiro',     220.00, '2026-08-01', '2026-07-01'),
  ('d52dd46f-6f7e-4ff1-ab1c-8bd0fb282c77', 'Gleidson Demuner Patuzzo',      362.00, '2026-08-01', '2026-07-01'),
  ('c098d486-80b7-411c-80f8-5f0e03541e6b', 'Jose Delesposte Grazioti',      310.00, '2026-08-01', '2026-07-01'),
  ('08638bdc-9633-4881-9892-553e6fb3bd0d', 'Juliana Resende Chagas',        220.00, '2026-08-01', '2026-07-01'),
  ('6957a342-e90c-40ae-9d69-c06d4073bd33', 'Maria da Penha Vicente',        190.00, '2026-08-01', '2026-07-01'),
  ('5780f7f8-0fec-4d80-990f-743c978a0cf8', 'Maria Jessica Gomes Freire',    362.00, '2026-08-01', '2026-07-01'),
  ('4e6010df-c41a-4522-8016-45f06054eb0c', 'Natalino Benedito Aliprandi',   385.00, '2026-08-01', '2026-07-01'),
  ('80920838-9a3d-4ea6-846c-a214971045dd', 'Nilca Rosa da Silva',           150.00, '2026-08-01', '2026-07-01'),
  ('985af9ea-10c0-4041-b69f-913d3e148877', 'Sandra Ferreira Auer',          190.00, '2026-08-01', '2026-07-01'),
  ('2909bff8-1130-4af9-bd35-eff76ac92228', 'Sara Gustavo Wagmaker Correa',  385.00, '2026-08-01', '2026-07-01'),
  ('825aa61f-d830-4a62-8039-278c9af41c81', 'Vera Lucia Guarise de Oliveira',310.00, '2026-08-01', '2026-07-01'),
  ('610f05de-3f04-41f6-8368-1e87bcf412ea', 'Amanda Borges Scaquetti',       385.00, '2026-07-01', '2026-06-01'),
  ('6c692f28-3016-4378-85a6-328e71d5572a', 'Fellipe Caldeira Ramos',        310.00, '2026-07-01', '2026-06-01'),
  ('5d71ccd1-24d1-4ad5-8f4d-1fba21c3fc30', 'Samira Murelli de Souza',       310.00, '2026-07-01', '2026-06-01');

do $comp$
declare
  v_n     int;
  v_soma  numeric;
  v_n_ago int;
  v_s_ago numeric;
  v_n_jul int;
  v_s_jul numeric;
  v_upd   int;
  v_mudou int;
begin
  -- ── ANTES 1: a lista e a combinada ─────────────────────────
  select count(*), coalesce(sum(valor), 0) into v_n, v_soma from comp_alvo;
  if v_n <> 23 or v_soma <> 6922.00 then
    raise exception 'A lista do script nao e a combinada: % linhas, R$ %. Esperado 23, R$ 6922.00. Nada foi alterado.', v_n, v_soma;
  end if;

  -- ── ANTES 2: o banco esta exatamente como na previa 135 ────
  select count(*), coalesce(sum(f.valor), 0),
         count(*) filter (where a.de = '2026-08-01'), coalesce(sum(f.valor) filter (where a.de = '2026-08-01'), 0),
         count(*) filter (where a.de = '2026-07-01'), coalesce(sum(f.valor) filter (where a.de = '2026-07-01'), 0)
    into v_n, v_soma, v_n_ago, v_s_ago, v_n_jul, v_s_jul
    from comp_alvo a
    join public.financeiro_lancamentos f on f.id = a.id
   where f.valor = a.valor
     and f.competencia = a.de
     and date_trunc('month', f.periodo_inicio)::date = a.para
     and f.status = 'pago'
     and f.metadata ->> 'periodo_corrigido_por' = 'comercial_periodo_das_pagas_de_inicio'
     and not (coalesce(f.metadata, '{}'::jsonb) ? 'competencia_antes');

  if v_n <> 23 or v_soma <> 6922.00
     or v_n_ago <> 20 or v_s_ago <> 5917.00
     or v_n_jul <> 3  or v_s_jul <> 1005.00 then
    raise exception 'O banco nao esta como na previa 135: % linhas / R$ % (agosto % / R$ %, julho % / R$ %). Esperado 23 / R$ 6922.00 (20 / R$ 5917.00, 3 / R$ 1005.00). Nada foi alterado.',
      v_n, v_soma, v_n_ago, v_s_ago, v_n_jul, v_s_jul;
  end if;

  -- ── A FOTOGRAFIA do que NAO pode mudar ─────────────────────
  insert into comp_foto
  select f.id, f.pago_em, f.valor_pago, f.status, f.periodo_inicio, f.periodo_fim, f.vencimento, f.valor
    from public.financeiro_lancamentos f
    join comp_alvo a on a.id = f.id;

  -- ── O UPDATE: competencia, metadata, atualizado_em ─────────
  update public.financeiro_lancamentos f
     set competencia   = a.para,
         metadata      = coalesce(f.metadata, '{}'::jsonb) || jsonb_build_object(
                           'competencia_antes', a.de,
                           'competencia_corrigida_por', 'comercial_competencia_das_23',
                           'competencia_corrigida_em', now()),
         atualizado_em = now()
    from comp_alvo a
   where f.id = a.id
     and f.competencia = a.de
     and f.valor = a.valor
     and f.status = 'pago'
     and not (coalesce(f.metadata, '{}'::jsonb) ? 'competencia_antes');
  get diagnostics v_upd = row_count;
  if v_upd <> 23 then
    raise exception 'O update tocaria % de 23 linhas. Nada foi alterado.', v_upd;
  end if;

  -- ── DEPOIS 1: linha a linha ────────────────────────────────
  select count(*) into v_n
    from comp_alvo a
    join public.financeiro_lancamentos f on f.id = a.id
   where f.competencia = a.para
     and (f.metadata ->> 'competencia_antes')::date = a.de
     and f.metadata ->> 'competencia_corrigida_por' = 'comercial_competencia_das_23';
  if v_n <> 23 then
    raise exception 'Conferencia depois do update: % de 23 com a competencia nova e a antiga guardada. Tudo volta atras.', v_n;
  end if;

  -- ── DEPOIS 2: nada da fotografia mudou ─────────────────────
  select count(*) into v_mudou
    from comp_foto p
    join public.financeiro_lancamentos f on f.id = p.id
   where f.pago_em        is distinct from p.pago_em
      or f.valor_pago     is distinct from p.valor_pago
      or f.status         is distinct from p.status
      or f.periodo_inicio is distinct from p.periodo_inicio
      or f.periodo_fim    is distinct from p.periodo_fim
      or f.vencimento     is distinct from p.vencimento
      or f.valor          is distinct from p.valor;
  if v_mudou <> 0 then
    raise exception '% linha(s) tiveram pagamento, status, periodo, vencimento ou valor alterado. Tudo volta atras.', v_mudou;
  end if;

  raise notice 'competencias corrigidas: 23 (R$ 6922.00)';
end $comp$;


-- ===========================================================================
-- RESULTADO. CLIENTE: 23 linhas, todas `ok`. TOTAL MENSAL: junho +1005,00 ·
-- julho +4912,00 (entram 5917,00, saem 1005,00) · agosto -5917,00.
-- O "antes" do total e reconstruido: agora - o que entrou + o que saiu.
-- Receitas = tipo receita, nao cancelada, nao arquivada, qualquer origem.
-- ===========================================================================
select ordem, secao, item, valor, antes, agora, confere
  from (
    select 1 as ordem, 'CLIENTE' as secao, a.cliente as item,
           to_char(f.valor, 'FM999G990D00') as valor,
           to_char((f.metadata ->> 'competencia_antes')::date, 'YYYY-MM') as antes,
           to_char(f.competencia, 'YYYY-MM') as agora,
           case when f.competencia = a.para
                 and (f.metadata ->> 'competencia_antes')::date = a.de
                 and f.valor = a.valor
                then 'ok' else 'DIVERGE' end as confere
      from comp_alvo a
      join public.financeiro_lancamentos f on f.id = a.id
    union all
    select 2, 'TOTAL MENSAL', to_char(m.mes, 'YYYY-MM'), '',
           to_char(m.agora - m.entrou + m.saiu, 'FM999G990D00'),
           to_char(m.agora, 'FM999G990D00'),
           'diferenca ' || to_char(m.entrou - m.saiu, 'FM999G990D00')
      from (
        select mes.mes,
               coalesce((select sum(l.valor) from public.financeiro_lancamentos l
                          where l.tipo = 'receita' and l.status <> 'cancelado'
                            and l.arquivado_em is null and l.competencia = mes.mes), 0) as agora,
               coalesce((select sum(a.valor) from comp_alvo a where a.para = mes.mes), 0) as entrou,
               coalesce((select sum(a.valor) from comp_alvo a where a.de   = mes.mes), 0) as saiu
          from (values (date '2026-06-01'), (date '2026-07-01'), (date '2026-08-01')) as mes(mes)
      ) m
    union all
    select 3, 'MOVIDAS', 'total', to_char(sum(a.valor), 'FM999G990D00'), '', count(*)::text || ' linhas', ''
      from comp_alvo a
  ) r
 order by ordem, item;
