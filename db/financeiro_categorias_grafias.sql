-- ===========================================================================
-- Evollo · Financeiro — UNIFICA as grafias duplicadas de pacote
-- ---------------------------------------------------------------------------
-- A planilha de vendas escreve o mesmo plano de dois jeitos:
--
--   "Trimestral - 5x"  ->  "Trimestral 5x"    (19 vendas juntam-se a 37)
--   "Trimestral - 3x"  ->  "Trimestral 3x"    (13 vendas juntam-se a 12)
--
-- A forma sem hifen e a correta (definida em 05/08/2026). Enquanto separadas, o
-- relatorio racha o total do plano entre duas linhas e nenhuma delas mostra
-- quanto o Trimestral realmente vendeu.
--
-- ISTO SOZINHO NAO BASTA, e por isso db/gerador_vendas.mjs tambem foi
-- corrigido: o gerador le a planilha crua, entao arrumar so o banco traria
-- "Trimestral - 5x" de volta na proxima importacao — e ninguem desconfiaria,
-- porque a categoria certa continuaria existindo, so que com metade das vendas.
--
-- Os lancamentos NAO sao apagados: mudam de categoria. So a categoria de origem,
-- ja vazia, e removida.
--
-- Requer db/financeiro_lancamentos.sql. 100% re-executavel: rodar de novo nao
-- faz nada, porque a origem ja nao existe.
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

do $grafias$
declare
  v_nutri   uuid;
  v_donos   integer;
  v_origem  uuid;
  v_destino uuid;
  r         record;
  v_movidos integer;
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
    raise exception 'Nao encontrei o dono das categorias.';
  end if;

  for r in
    select * from (values
      ('Trimestral - 5x', 'Trimestral 5x'),
      ('Trimestral - 3x', 'Trimestral 3x')
    ) as t(errada, certa)
  loop
    select id into v_origem from public.financeiro_categorias
     where nutri_id = v_nutri and tipo = 'receita' and lower(nome) = lower(r.errada);

    if v_origem is null then
      raise notice 'NADA A FAZER  "%" nao existe', r.errada;
      continue;
    end if;

    select id into v_destino from public.financeiro_categorias
     where nutri_id = v_nutri and tipo = 'receita' and lower(nome) = lower(r.certa);

    -- Se a forma correta ainda nao existe, RENOMEIA em vez de mover: criar uma
    -- categoria nova e apagar a antiga trocaria o id, e qualquer lancamento que
    -- alguem tivesse acabado de classificar ficaria orfao.
    if v_destino is null then
      update public.financeiro_categorias set nome = r.certa, atualizado_em = now()
       where id = v_origem;
      raise notice 'RENOMEADA     "%" -> "%"', r.errada, r.certa;
      continue;
    end if;

    update public.financeiro_lancamentos
       set categoria_id = v_destino, atualizado_em = now()
     where nutri_id = v_nutri and categoria_id = v_origem;
    get diagnostics v_movidos = row_count;

    delete from public.financeiro_categorias where id = v_origem;

    raise notice 'UNIFICADA     "%" -> "%"  (% lancamento(s) movido(s))',
                 r.errada, r.certa, v_movidos;
  end loop;
end $grafias$;


-- ===========================================================================
-- Conferencia. Esperado: 2 linhas — Trimestral 3x com 25 e Trimestral 5x com 56.
-- As grafias com hifen nao devem aparecer.
-- ===========================================================================
select
  c.nome,
  count(l.id)                as lancamentos,
  coalesce(sum(l.valor), 0)  as total
from public.financeiro_categorias c
left join public.financeiro_lancamentos l on l.categoria_id = c.id
where c.tipo = 'receita' and c.nome ilike 'trimestral%'
group by c.nome
order by c.nome;
