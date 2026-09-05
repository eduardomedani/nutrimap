// ═══════════════════════════════════════════════════════════
// GERADOR — planilha de despesas  ->  db/financeiro_lancamentos_seed.sql
// ═══════════════════════════════════════════════════════════
// Uso:  node db/gerador_custos.mjs [caminho/da/planilha.xlsx|.csv]
//
// A planilha é a fonte; o .sql é derivado. Corrigiu a planilha? Roda de novo e
// aplica — em vez de editar o SQL à mão, que faria os dois divergirem em
// silêncio na primeira correção.
//
// ═══════════════════════════════════════════════════════════
// A FOLHA AGORA ENTRA — E ISSO INVERTEU UMA DECISÃO
// ───────────────────────────────────────────────────────────
// A primeira versão deste gerador DESCARTAVA as linhas de folha (FOPAG e
// pagamento nominal), e por um bom motivo: o custo de equipe já era apurado
// pelo módulo Equipe a partir do ponto, e importar as duas coisas faria o mesmo
// dinheiro existir em dois lugares.
//
// O que mudou não foi o risco — foi haver uma REGRA DE PRECEDÊNCIA. Desde
// db/financeiro_folha_despesa.sql, quem responde pelo custo de equipe de um mês
// é sempre UMA fonte só, e `folhaDoPeriodo()` (js/financeiro.js) escolhe qual:
// onde há lançamento de folha, a apuração não soma junto. As FOPAG desta
// planilha entram como esse lançamento, marcadas em `metadata.folha`.
//
// POR QUE `metadata` E NÃO `origem = 'folha'`: este seed apaga e recria
// filtrando por `origem = 'planilha'`, e é isso que o torna re-executável.
// Trocar a marca de origem deixaria as FOPAG órfãs na próxima reimportação.
//
// A CLASSIFICAÇÃO É PELA DESCRIÇÃO, NÃO PELA COLUNA. Na planilha há FOPAG em
// ADMINISTRATIVO e FOPAG sem centro nenhum, e há linha em COLABORADORES que não
// é folha (Uniformes, MEI). Confiar na coluna erraria dos dois lados.
//
// ═══════════════════════════════════════════════════════════
// CENTRO DE CUSTO É CENTRO DE CUSTO, NÃO CATEGORIA
// ───────────────────────────────────────────────────────────
// A importação de 2026 gravou a coluna "CENTRO DE CUSTO" como CATEGORIA, e
// db/financeiro_centros_custo_migrar.sql precisou desfazer isso depois:
// ADMINISTRATIVO e OBRAS E EXPANSAO dizem ONDE o dinheiro foi alocado, não QUAL
// é a natureza do gasto. Aqui a coluna já entra em `centro_custo_id`.
//
// A categoria fica NULA de propósito. Ela responde a outra pergunta (Energia,
// Contabilidade, Aluguel) e ninguém a respondeu ainda — a tela mostra isso como
// pendência, que é honesto. Preencher com o centro seria escrever no balanço
// uma resposta que a planilha não deu.
//
// Nada é adivinhado: centro em branco entra sem centro, valor em branco entra
// sem valor, e as duas coisas aparecem como pendência para quem sabe resolver.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
// O leitor de .xlsx mora no gerador de vendas e é reaproveitado inteiro. Copiar
// as quatro funções para cá criaria duas implementações do mesmo formato, que
// divergem no primeiro arquivo que uma das duas não souber abrir.
import { abrirZip, lerSharedStrings, lerEstilosDeData, lerLinhas, serialParaISO }
  from './gerador_vendas.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DESTINO = resolve(AQUI, 'financeiro_lancamentos_seed.sql');
const PADRAO = 'C:/Users/Eduardo/Desktop/Despesas.xlsx';

/** "R$ 1.728,08" -> 1728.08 ; vazio -> null (a linha entra sem valor). */
export function lerValor(bruto) {
  if (bruto === 0) return 0;
  if (!bruto) return null;
  if (typeof bruto === 'number') return Number.isFinite(bruto) ? bruto : null;
  if (!String(bruto).trim()) return null;
  const n = Number(String(bruto).replace(/R\$/g, '').replace(/\./g, '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * "04/11/2023" -> "2023-11-04". Devolve null se não for uma data completa.
 *
 * Aceita também o que o .xlsx entrega: a data já em ISO (quando a célula tem
 * estilo de data) ou o serial do Excel cru (quando não tem).
 */
export function lerData(bruto) {
  if (bruto === null || bruto === undefined || bruto === '') return null;
  if (typeof bruto === 'number') return serialParaISO(bruto);
  const t = String(bruto).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Pagamento de gente. NÃO fica mais de fora: fica MARCADO — ver o cabeçalho. */
export function ehFolha(descricao) {
  return /^(fopag|pagamento (professor|estagi))/i.test((descricao || '').trim());
}

const aspas = s => `'${String(s).replace(/'/g, "''")}'`;

/** Uma linha da planilha, já traduzida. `folha` decide a marca, não a exclusão. */
function registro(linha, colunas) {
  const [data, , , descricao, , valor, pago, centro, observacoes] = colunas;
  const r = {
    linha,
    data: lerData(data),
    descricao: String(descricao ?? '').trim(),
    valor: lerValor(valor),
    pago: !/^n/i.test(String(pago ?? '').trim()),
    centro: String(centro ?? '').trim(),
    observacoes: String(observacoes ?? '').trim(),
  };
  r.folha = ehFolha(r.descricao);
  return r;
}

/** A planilha em CSV — o formato da exportação antiga. */
export function lerCsv(conteudo) {
  const linhas = String(conteudo).split(/\r?\n/);
  const fora = [];
  for (let i = 1; i < linhas.length; i++) {
    if (!linhas[i].trim() || /^;+$/.test(linhas[i])) continue;   // o rodapé são centenas de linhas vazias
    const r = registro(i + 1, linhas[i].split(';'));
    if (!r.data || !r.descricao) continue;
    fora.push(r);
  }
  return fora;
}

/** A planilha em .xlsx — o formato de hoje. Mesma saída de `lerCsv`. */
export function lerXlsx(bytes) {
  const zip = abrirZip(bytes);
  const shared = lerSharedStrings(zip['xl/sharedStrings.xml']?.toString('utf8') || '');
  const ehData = lerEstilosDeData(zip['xl/styles.xml']?.toString('utf8') || '');
  const linhas = lerLinhas(zip['xl/worksheets/sheet1.xml'].toString('utf8'), shared, ehData);

  const fora = [];
  for (const l of linhas.slice(1)) {                             // a primeira é o cabeçalho
    const r = registro(l.num, l.celulas || []);
    if (!r.data || !r.descricao) continue;
    fora.push(r);
  }
  return fora;
}

/** Lê pelo que o arquivo É, não pelo que quem chama acha que ele é. */
export function lerArquivo(caminho) {
  if (extname(caminho).toLowerCase() === '.xlsx') return lerXlsx(readFileSync(caminho));
  // A exportação em CSV sai do Excel em pt-BR: windows-1252, `;` como separador,
  // vírgula decimal. Ler como UTF-8 transforma "Manutenção" em "Manuten<?>o".
  return lerCsv(new TextDecoder('windows-1252').decode(readFileSync(caminho)));
}

/** Soma em centavos inteiros: `0.1 + 0.2` não é `0.3` em ponto flutuante, e o
 *  erro acumula. O total que este arquivo declara como esperado tem que bater
 *  com o `sum(valor)` do Postgres, que soma `numeric` exato — senão a
 *  conferência erra por um centavo e ensina a ignorar divergência. */
export const soma = a => a.reduce((s, r) => s + Math.round((r.valor || 0) * 100), 0) / 100;
const brl = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** O arquivo .sql inteiro, como texto. Puro: recebe os registros lidos. */
export function montarSql(registros) {
  const linhas = registros || [];
  const folha = linhas.filter(r => r.folha);
  const operacao = linhas.filter(r => !r.folha);
  const centros = [...new Set(linhas.map(r => r.centro).filter(Boolean))].sort();
  const semValor = linhas.filter(r => r.valor === null);
  const semCentro = linhas.filter(r => !r.centro);
  const datas = linhas.map(r => r.data).sort();

  return `-- ===========================================================================
-- Evollo · Financeiro da empresa — DESPESAS IMPORTADAS DA PLANILHA
-- ---------------------------------------------------------------------------
-- GERADO AUTOMATICAMENTE por db/gerador_custos.mjs. NAO EDITE A MAO: ajuste a
-- planilha e rode o gerador de novo.
--
-- ${linhas.length} despesas, de ${datas[0]} a ${datas[datas.length - 1]}. Total: R$ ${brl(soma(linhas))}.
--   ${operacao.length} de operacao   R$ ${brl(soma(operacao))}
--   ${folha.length} de folha       R$ ${brl(soma(folha))}   (FOPAG e pagamento nominal)
--
-- A FOLHA ENTRA MARCADA, em \`metadata.folha\`. Isso nao e etiqueta: e o que faz
-- o Financeiro contar o custo de equipe UMA vez. \`folhaDoPeriodo()\`
-- (js/financeiro.js) da a palavra sobre cada competencia a uma fonte so — onde
-- ha lancamento de folha, a apuracao de folhas/folha_itens nao soma junto, e
-- vice-versa. Sem a marca, out/2023 a mai/2026 contariam a folha duas vezes.
--
-- A classificacao e pela DESCRICAO, nao pela coluna CENTRO DE CUSTO: ha FOPAG
-- marcada como ADMINISTRATIVO e FOPAG sem centro nenhum.
--
-- O CENTRO DE CUSTO vai para \`centro_custo_id\` — ONDE o dinheiro foi alocado.
-- A CATEGORIA (a natureza do gasto) fica nula e aparece como pendencia na tela:
-- preenche-la com o centro seria responder a pergunta errada com ar de certeza.
--
-- ${semCentro.length} linha(s) sem centro e ${semValor.length} sem valor entram assim mesmo. Nada foi
-- adivinhado.
--
-- Requer db/financeiro_lancamentos.sql e db/financeiro_despesas_etapa1.sql.
-- 100% re-executavel: apaga e recria APENAS os lancamentos de origem
-- 'planilha'. O que foi lancado a mao na tela (origem 'manual') nao e tocado.
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
  -- 1) Os centros de custo da planilha, como estao escritos nela.
  --    "MANUTENCAO" e "MANUTENCAO CORRETIVA" chegam separadas porque foi
  --    assim que foram escritas — juntar as duas e decisao de quem le o
  --    balanco, e a tela tem a fusao para isso.
  -- ---------------------------------------------------------------------
  insert into public.financeiro_centros_custo (nutri_id, nome, ordem)
  select v_nutri, x.nome, x.ordem
    from (values
${centros.map((nome, i) => `      (${aspas(nome)}, ${i + 1})`).join(',\n')}
         ) as x(nome, ordem)
   where not exists (
     select 1 from public.financeiro_centros_custo cc
      where cc.nutri_id = v_nutri and lower(cc.nome) = lower(x.nome)
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
     centro_custo_id, observacoes, origem, origem_linha, metadata)
  select
    v_nutri, 'despesa', v.data, date_trunc('month', v.data)::date, v.descricao,
    v.valor, v.pago,
    case when v.pago then 'pago' else 'pendente' end,
    case when v.pago then v.data else null end,
    cc.id, nullif(v.observacoes, ''), 'planilha', v.linha,
    case when v.folha then '{"folha": true}'::jsonb else '{}'::jsonb end
  from (values
${linhas.map(r => `    (${r.linha}, date '${r.data}', ${aspas(r.descricao)}, ` +
      `${r.valor === null ? 'null::numeric' : r.valor.toFixed(2)}, ${r.pago}, ` +
      `${aspas(r.centro)}, ${aspas(r.observacoes)}, ${r.folha})`).join(',\n')}
       ) as v(linha, data, descricao, valor, pago, centro, observacoes, folha)
  left join public.financeiro_centros_custo cc
    on cc.nutri_id = v_nutri
   and v.centro <> '' and lower(cc.nome) = lower(v.centro);

  select count(*), coalesce(sum(valor), 0) into v_linhas, v_total
    from public.financeiro_lancamentos
   where nutri_id = v_nutri and origem = 'planilha';

  raise notice 'Importadas % despesas, total R$ %', v_linhas, v_total;
end $custos$;


-- ===========================================================================
-- Conferencia. Esperado: ${linhas.length} lancamentos, ${brl(soma(linhas))}, dos quais ${folha.length} de folha
-- (${brl(soma(folha))}); ${semCentro.length} sem centro de custo e ${semValor.length} sem valor.
-- ===========================================================================
select
  count(*)                                            as lancamentos,
  sum(valor)                                          as total,
  count(*) filter (where metadata ->> 'folha' = 'true') as linhas_de_folha,
  sum(valor) filter (where metadata ->> 'folha' = 'true') as total_de_folha,
  count(*) filter (where centro_custo_id is null)     as sem_centro,
  count(*) filter (where valor is null)               as sem_valor,
  min(competencia)                                    as primeiro_mes,
  max(competencia)                                    as ultimo_mes
from public.financeiro_lancamentos
where origem = 'planilha';
`;
}

// Só escreve quando chamado como script. Importar o módulo (nos testes) não
// pode ler o Desktop nem sobrescrever o .sql.
const comoScript = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (comoScript) {
  const caminho = process.argv[2] || PADRAO;
  const registros = lerArquivo(caminho);
  const folha = registros.filter(r => r.folha);

  writeFileSync(DESTINO, montarSql(registros), 'utf8');

  console.log(`  ok — ${DESTINO}`);
  console.log(`  ${registros.length} despesas, R$ ${brl(soma(registros))}`);
  console.log(`  dentre elas ${folha.length} de folha, R$ ${brl(soma(folha))}`);
  console.log(`  ${registros.filter(r => !r.centro).length} sem centro de custo, ` +
              `${registros.filter(r => r.valor === null).length} sem valor`);
}
