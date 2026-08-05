// ═══════════════════════════════════════════════════════════
// GERADOR — planilha de custos  ->  db/financeiro_lancamentos_seed.sql
// ═══════════════════════════════════════════════════════════
// Uso:  node db/gerador_custos.mjs [caminho/do/custos.csv]
//
// A planilha é a fonte; o .sql é derivado. Corrigiu a planilha? Roda de novo e
// aplica — em vez de editar o SQL à mão, que faria os dois divergirem em
// silêncio na primeira correção.
//
// O QUE FICA DE FORA, E POR QUÊ: as linhas de folha (FOPAG e "Pagamento
// Professor/Estagiário"). Esse custo é apurado pelo módulo Equipe a partir do
// ponto — 31 competências já no banco. Importar as duas coisas faria o mesmo
// dinheiro existir em dois lugares.
//
// A CLASSIFICAÇÃO É PELA DESCRIÇÃO, NÃO PELA COLUNA. Na planilha, 11 linhas de
// FOPAG estão fora de COLABORADORES (5 em ADMINISTRATIVO, 6 em branco,
// R$ 53.859,25) e 2 linhas em COLABORADORES não são folha (Uniformes e MEI).
// Confiar na coluna duplicaria as primeiras e perderia as segundas.
//
// Nada é adivinhado: centro de custo em branco entra como lançamento SEM
// categoria, para ser resolvido na tela por quem sabe o que a linha foi.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DESTINO = resolve(AQUI, 'financeiro_lancamentos_seed.sql');
const PADRAO = 'C:/Users/eduar/Desktop/custos.csv';

/** "R$ 1.728,08" -> 1728.08 ; vazio -> null (a linha entra sem valor). */
export function lerValor(bruto) {
  if (!bruto || !bruto.trim()) return null;
  const n = Number(bruto.replace(/R\$/g, '').replace(/\./g, '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
}

/** "04/11/2023" -> "2023-11-04". Devolve null se não for uma data completa. */
export function lerData(bruto) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((bruto || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Pagamento de gente: é o que o módulo Equipe apura, e não entra aqui. */
export function ehFolha(descricao) {
  return /^(fopag|pagamento (professor|estagi))/i.test((descricao || '').trim());
}

const aspas = s => `'${String(s).replace(/'/g, "''")}'`;

export function lerPlanilha(conteudo) {
  const linhas = conteudo.split(/\r?\n/);
  const fora = [];
  const dentro = [];

  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.trim() || /^;+$/.test(linha)) continue;   // o rodapé é ~570 linhas vazias

    const c = linha.split(';');
    const registro = {
      linha: i + 1,
      data: lerData(c[0]),
      descricao: (c[3] || '').trim(),
      valor: lerValor(c[5]),
      pago: !/^n/i.test((c[6] || '').trim()),
      centro: (c[7] || '').trim(),
      observacoes: (c[8] || '').trim(),
    };
    if (!registro.data || !registro.descricao) continue;

    (ehFolha(registro.descricao) ? fora : dentro).push(registro);
  }
  return { dentro, fora };
}

/** Soma em centavos inteiros: `0.1 + 0.2` não é `0.3` em ponto flutuante, e o
 *  erro acumula. O total que este arquivo declara como esperado tem que bater
 *  com o `sum(valor)` do Postgres, que soma `numeric` exato — senão a
 *  conferência erra por um centavo e ensina a ignorar divergência. */
export const soma = a => a.reduce((s, r) => s + Math.round((r.valor || 0) * 100), 0) / 100;
const brl = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** O arquivo .sql inteiro, como texto. Puro: recebe o CSV, devolve o SQL. */
export function montarSql(conteudo) {
  const { dentro, fora } = lerPlanilha(conteudo);
  const categorias = [...new Set(dentro.map(r => r.centro).filter(Boolean))].sort();
  const semValor = dentro.filter(r => r.valor === null);
  const semCategoria = dentro.filter(r => !r.centro);

  return `-- ===========================================================================
-- Evollo · Financeiro da empresa — CUSTOS IMPORTADOS DA PLANILHA
-- ---------------------------------------------------------------------------
-- GERADO AUTOMATICAMENTE por db/gerador_custos.mjs a partir de "custos.csv".
-- NAO EDITE A MAO: ajuste a planilha e rode o gerador de novo.
--
-- ${dentro.length} despesas, de ${dentro.map(r => r.data).sort()[0]} a ${dentro.map(r => r.data).sort().slice(-1)[0]}.
-- Total: R$ ${brl(soma(dentro))}.
--
-- FICARAM DE FORA ${fora.length} linhas de folha (R$ ${brl(soma(fora))}): FOPAG e pagamento
-- nominal a colaborador. Esse custo e apurado pelo modulo Equipe a partir do
-- ponto, e importar as duas coisas faria o mesmo dinheiro existir em dois
-- lugares. A classificacao foi pela DESCRICAO, nao pela coluna CENTRO DE CUSTO:
-- na planilha ha folha marcada como ADMINISTRATIVO e folha sem centro nenhum.
--
-- ${semCategoria.length} linhas entram SEM CATEGORIA (a planilha nao trouxe centro de custo) e
-- ${semValor.length} linha entra SEM VALOR. Nada foi adivinhado: as duas coisas aparecem como
-- pendencia na tela, para quem sabe o que cada linha foi resolver.
--
-- Requer db/financeiro_lancamentos.sql. 100% re-executavel: apaga e recria
-- APENAS os lancamentos de origem 'planilha'. O que for lancado a mao na tela
-- (origem 'manual') nao e tocado.
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

do $custos$
declare
  v_nutri  uuid;
  v_donos  integer;
  v_linhas integer;
  v_total  numeric;
begin
  -- Quem e o dono destas despesas. No SQL Editor auth.uid() e nulo, entao a
  -- referencia passa a ser quem ja tem folha no banco: as despesas tem que
  -- cair na MESMA conta que responde pela folha, ou o financeiro nasce partido
  -- entre dois usuarios.
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
    raise exception 'Nao encontrei o dono das linhas. Rode logado, ou ajuste o e-mail no gerador.';
  end if;

  -- ---------------------------------------------------------------------
  -- 1) Os centros de custo da planilha viram categorias de despesa.
  --    Como estao na planilha, sem unificar: "MANUTENCAO" e "MANUTENCAO
  --    CORRETIVA" chegam separadas porque foi assim que foram escritas, e
  --    juntar as duas e uma decisao de quem le o balanco, na tela.
  -- ---------------------------------------------------------------------
  insert into public.financeiro_categorias (nutri_id, nome, tipo, ordem)
  select v_nutri, x.nome, 'despesa', x.ordem
    from (values
${categorias.map((nome, i) => `      (${aspas(nome)}, ${i + 1})`).join(',\n')}
         ) as x(nome, ordem)
   where not exists (
     select 1 from public.financeiro_categorias c
      where c.nutri_id = v_nutri and c.tipo = 'despesa' and lower(c.nome) = lower(x.nome)
   );

  -- ---------------------------------------------------------------------
  -- 2) As despesas. Apaga so o que veio da planilha antes de recriar.
  -- ---------------------------------------------------------------------
  delete from public.financeiro_lancamentos
   where nutri_id = v_nutri and origem = 'planilha';

  -- STATUS VAI EXPLICITO. A coluna tem default 'pendente' e um trigger que
  -- sincroniza pago <-> status: omiti-la aqui faria o default vencer, o trigger
  -- concluir pago = false e as despesas todas virarem pendentes na
  -- reimportacao, sem erro nenhum na tela.
  insert into public.financeiro_lancamentos
    (nutri_id, tipo, data, competencia, descricao, valor, pago, status, pago_em,
     categoria_id, observacoes, origem, origem_linha)
  select
    v_nutri, 'despesa', v.data, date_trunc('month', v.data)::date, v.descricao,
    v.valor, v.pago,
    case when v.pago then 'pago' else 'pendente' end,
    case when v.pago then v.data else null end,
    c.id, nullif(v.observacoes, ''), 'planilha', v.linha
  from (values
${dentro.map(r => `    (${r.linha}, date '${r.data}', ${aspas(r.descricao)}, ` +
      `${r.valor === null ? 'null::numeric' : r.valor.toFixed(2)}, ${r.pago}, ` +
      `${aspas(r.centro)}, ${aspas(r.observacoes)})`).join(',\n')}
       ) as v(linha, data, descricao, valor, pago, centro, observacoes)
  left join public.financeiro_categorias c
    on c.nutri_id = v_nutri and c.tipo = 'despesa'
   and v.centro <> '' and lower(c.nome) = lower(v.centro);

  select count(*), coalesce(sum(valor), 0) into v_linhas, v_total
    from public.financeiro_lancamentos
   where nutri_id = v_nutri and origem = 'planilha';

  raise notice 'Importadas % despesas, total R$ %', v_linhas, v_total;
end $custos$;


-- ===========================================================================
-- Conferencia. Esperado: ${dentro.length} lancamentos, ${brl(soma(dentro))}, ${semCategoria.length} sem categoria, ${semValor.length} sem valor.
-- ===========================================================================
select
  count(*)                                  as lancamentos,
  sum(valor)                                as total,
  count(*) filter (where categoria_id is null) as sem_categoria,
  count(*) filter (where valor is null)        as sem_valor,
  min(competencia)                          as primeiro_mes,
  max(competencia)                          as ultimo_mes
from public.financeiro_lancamentos
where origem = 'planilha';
`;
}

// Só escreve quando chamado como script. Importar o módulo (nos testes) não
// pode ler o Desktop nem sobrescrever o .sql.
const comoScript = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (comoScript) {
  // A planilha sai do Excel em pt-BR: windows-1252, `;` como separador, vírgula
  // decimal. Ler como UTF-8 transforma "Manutenção" em "Manuten�o".
  const conteudo = new TextDecoder('windows-1252').decode(readFileSync(process.argv[2] || PADRAO));
  const { dentro, fora } = lerPlanilha(conteudo);

  writeFileSync(DESTINO, montarSql(conteudo), 'utf8');

  console.log(`  ok — ${DESTINO}`);
  console.log(`  ${dentro.length} despesas, R$ ${brl(soma(dentro))}`);
  console.log(`  fora: ${fora.length} linhas de folha, R$ ${brl(soma(fora))}`);
  console.log(`  ${dentro.filter(r => !r.centro).length} sem categoria, ` +
              `${dentro.filter(r => r.valor === null).length} sem valor`);
}
