// ═══════════════════════════════════════════════════════════
// GERADOR — as vendas que a importação assumiu como recebidas
// ═══════════════════════════════════════════════════════════
// Uso:  node db/gerador_vendas_duvidosas.mjs "caminho/2026. Studio (GOUP) 1.0.xlsx"
//
// A importação de 05/08/2026 leu "coluna Pago em branco" como "recebido", em
// 1.663 das 2.178 linhas da aba Vendas. A coluna original não foi importada —
// só a interpretação dela —, e por isso a premissa ficou registrada como
// dívida: não dava para conferir olhando o banco.
//
// Dá para conferir olhando a PLANILHA, e o resultado em 07/08/2026 foi:
//
//   1.587 das 1.663 linhas em branco TÊM forma de pagamento preenchida.
//
// Forma de pagamento é sinal independente: ninguém anota "Pix" para dinheiro
// que não entrou. Essas 1.587 (R$ 444.996,60) estão corroboradas.
//
// SOBRAM 76 LINHAS — R$ 14.303,24, ou 2,41% do total — em que a planilha não
// diz nada: nem "Sim", nem "Não", nem forma de pagamento. É só sobre elas que
// a premissa realmente se apoia, e é o que este script lista para conferência
// contra o extrato bancário.
//
// A saída NÃO é versionada: traz nome de cliente e valor. Ver .gitignore.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirZip, lerSharedStrings, lerEstilosDeData, lerLinhas } from './gerador_vendas.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));

/** "R$ 1.234,56" e 1234.56 -> 1234.56. Zero quando não dá para ler. */
export function valor(bruto) {
  const t = String(bruto ?? '').replace(/R\$|\s| /g, '');
  if (!t) return 0;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : 0;
}

/**
 * As linhas em que a planilha não afirma nada sobre o recebimento.
 *
 * `origem_linha` é o número da linha NA PLANILHA, e é por ele que o lançamento
 * correspondente se acha no banco — nunca por campo derivado. Em 05/08/2026
 * um predicado escrito sobre `observacoes` marcou 82 receitas erradas.
 */
export function duvidosas(linhas) {
  const cab = (linhas[0]?.celulas || []).map(c => String(c || '').trim());
  const i = n => cab.indexOf(n);
  if (i('Pago') < 0 || i('Forma de Pagamento') < 0) {
    throw new Error('A aba não tem as colunas Pago e Forma de Pagamento — não é a aba Vendas.');
  }

  const saida = [];
  for (const l of linhas.slice(1)) {
    const r = l.celulas;
    if (!r || !r.some(c => String(c ?? '').trim())) continue;
    const pago = String(r[i('Pago')] ?? '').trim();
    const forma = String(r[i('Forma de Pagamento')] ?? '').trim();
    if (pago || forma) continue;

    // Linha sem nome não é venda: é sobra de formatação no fim da aba. Sem
    // isto, 1.786 linhas vazias entravam na lista — e como todas valem zero, a
    // SOMA continuava certa e o erro não aparecia no total.
    if (!String(r[i('Nome')] ?? '').trim()) continue;

    saida.push({
      linha: l.num,
      data: r[i('Data')] ?? null,
      nome: String(r[i('Nome')] ?? '').trim() || '(sem nome)',
      pacote: String(r[i('Pacote')] ?? '').trim() || null,
      valor: valor(r[i('Valor')]),
    });
  }
  return saida;
}

if (process.argv[1] && process.argv[1].endsWith('gerador_vendas_duvidosas.mjs')) {
  const entrada = process.argv[2];
  if (!entrada) {
    console.error('Uso: node db/gerador_vendas_duvidosas.mjs "caminho/planilha.xlsx"');
    process.exit(1);
  }

  const zip = abrirZip(readFileSync(resolve(entrada)));
  const shared = lerSharedStrings(zip['xl/sharedStrings.xml']?.toString('utf8') || '');
  const ehData = lerEstilosDeData(zip['xl/styles.xml']?.toString('utf8') || '');

  // Acha a aba Vendas pelo cabeçalho COMPLETO, e entre as candidatas fica com
  // a maior. A planilha tem três abas com "Pago" e "Nome" (Vendas, Vendas_tab,
  // Venda_S): parar na primeira que casasse pegava a errada — e como as outras
  // são pequenas e vazias, o erro passava despercebido, porque a SOMA batia.
  const ESPERADO = ['Data', 'Nome', 'Pacote', 'Valor', 'Pago', 'Forma de Pagamento'];
  let linhas = null;
  let melhor = -1;
  for (const chave of Object.keys(zip).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()) {
    const l = lerLinhas(zip[chave].toString('utf8'), shared, ehData);
    const cab = (l[0]?.celulas || []).map(c => String(c || '').trim());
    if (!ESPERADO.every(c => cab.includes(c))) continue;
    if (l.length > melhor) { melhor = l.length; linhas = l; }
  }
  if (!linhas) { console.error('Não achei a aba Vendas nessa planilha.'); process.exit(1); }

  const lista = duvidosas(linhas);
  const total = Math.round(lista.reduce((s, r) => s + r.valor * 100, 0)) / 100;
  const brl = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Só o resumo na tela: nome de cliente não é saída de terminal.
  console.log(lista.length + ' linhas sem "Pago" e sem forma de pagamento');
  console.log('somam R$ ' + brl(total));

  const csv = ['linha_da_planilha,data,nome,pacote,valor,conferido_no_extrato']
    .concat(lista.map(r => [
      r.linha,
      r.data ?? '',
      '"' + r.nome.split('"').join('""') + '"',
      r.pacote ?? '',
      r.valor.toFixed(2).replace('.', ','),
      '',
    ].join(',')))
    .join('\n') + '\n';

  writeFileSync(resolve(AQUI, 'vendas_duvidosas.csv'), csv, 'utf8');
  console.log('\nLista em db/vendas_duvidosas.csv (fora do git).');
  console.log('A última coluna está vazia de propósito: marque nela o que achar no extrato.');
}
