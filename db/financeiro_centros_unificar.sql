-- ===========================================================================
-- Evollo · Financeiro — UNIFICA os centros de custo escritos de varios jeitos
-- ---------------------------------------------------------------------------
-- A planilha escreve o mesmo centro de tres formas:
--
--   MANUTENÇÃO CORRETIVA               ->  MANUTENÇÃO
--   Manutenção e Reforma Estofados     ->  MANUTENÇÃO
--
-- Enquanto separados, o relatorio racha o total entre tres linhas e nenhuma
-- delas mostra quanto a manutencao realmente custou. Decidido em 05/09/2026.
--
-- ISTO SOZINHO NAO BASTA, e por isso db/gerador_custos.mjs tambem foi
-- corrigido: o gerador le a planilha crua, entao arrumar so o banco traria
-- "MANUTENÇÃO CORRETIVA" de volta na proxima importacao — e ninguem
-- desconfiaria, porque o centro certo continuaria existindo, so que com parte
-- das despesas.
--
-- OS LANCAMENTOS NAO SAO APAGADOS: mudam de centro. So o centro de origem, ja
-- vazio, e removido — e so se estiver mesmo vazio.
--
-- O MAPA E DE NOMES, e o destino nao precisa existir antes: se so as grafias
-- erradas estiverem no banco, a primeira delas e RENOMEADA para o nome certo em
-- vez de criar uma quarta linha.
--
-- Requer db/financeiro_despesas_etapa1.sql. 100% re-executavel: rodar de novo
-- nao faz nada, porque as origens ja nao existem.
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

do $unificar$
declare
  v_nutri  uuid;
  v_donos  integer;
  r        record;
  v_destino uuid;
  v_origem  uuid;
  v_n       integer;
  v_total   integer := 0;
begin
  select count(distinct nutri_id) into v_donos from public.folhas;

  if auth.uid() is not null then
    v_nutri := auth.uid();
  elsif v_donos = 1 then
    select distinct nutri_id into v_nutri from public.folhas;
  else
    select id into v_nutri from auth.users
     where lower(email) = lower('eduardomedani@natalinossalgados.com.br') limit 1;
  end if;

  if v_nutri is null then
    raise exception 'Nao encontrei o dono das linhas. Rode logado.';
  end if;

  for r in
    select * from (values
      ('MANUTENÇÃO CORRETIVA',           'MANUTENÇÃO'),
      ('Manutenção e Reforma Estofados',  'MANUTENÇÃO')
    ) as m(de, para)
  loop
    select id into v_origem from public.financeiro_centros_custo
     where nutri_id = v_nutri and lower(nome) = lower(r.de);
    continue when v_origem is null;

    select id into v_destino from public.financeiro_centros_custo
     where nutri_id = v_nutri and lower(nome) = lower(r.para);

    -- Sem destino, o conserto e RENOMEAR: criar o certo e mover para ele
    -- deixaria duas linhas onde a intencao era ter uma.
    if v_destino is null then
      update public.financeiro_centros_custo
         set nome = r.para, atualizado_em = now()
       where id = v_origem;
      raise notice '% renomeado para %', r.de, r.para;
      continue;
    end if;

    update public.financeiro_lancamentos
       set centro_custo_id = v_destino, atualizado_em = now()
     where nutri_id = v_nutri and centro_custo_id = v_origem;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;

    -- So apaga o que ficou mesmo vazio. Se alguma linha resistiu — outro dono,
    -- RLS, o que for —, o centro fica e aparece na conferencia.
    delete from public.financeiro_centros_custo
     where id = v_origem
       and not exists (select 1 from public.financeiro_lancamentos l
                        where l.centro_custo_id = v_origem);

    raise notice '% -> % (% lancamentos)', r.de, r.para, v_n;
  end loop;

  raise notice 'Movidos % lancamentos.', v_total;
end $unificar$;


-- ===========================================================================
-- Conferencia. Esperado: uma linha "MANUTENÇÃO", e nenhuma das duas grafias
-- antigas.
-- ===========================================================================
select
  cc.nome                                                  as centro_de_custo,
  count(l.id)                                              as lancamentos,
  to_char(coalesce(sum(l.valor), 0), 'FM999G999G990D00')   as total
from public.financeiro_centros_custo cc
left join public.financeiro_lancamentos l
       on l.centro_custo_id = cc.id and l.status <> 'cancelado'
group by cc.nome
order by count(l.id) desc;
