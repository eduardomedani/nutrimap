// ═══════════════════════════════════════════════════════════
// ESPELHO DE PONTO — a planilha, uma aba por colaborador
// ═══════════════════════════════════════════════════════════
// O PDF do espelho já é importado (js/ponto-arquivo.js) e dá o TOTAL DE HORAS.
// Esta planilha dá outra coisa: as MARCAÇÕES, com hora de entrada e de saída.
//
// É a diferença entre saber que alguém fez 56 horas no mês e saber que estava
// na sala às 16h de uma terça — e só a segunda permite dizer de quem é a
// presença do aluno que entrou naquele minuto. Os dois convivem: o PDF continua
// alimentando as horas da folha, a planilha alimenta o bônus por presença.
//
// O FORMATO, conferido no arquivo de agosto/2026:
//
//   uma aba por colaborador, com o nome da pessoa no nome da aba
//   linhas de cabeçalho em duas colunas:  "Colaborador:" | "Aline Vitório"
//                                         "CPF:"         | "13740672706"
//                                         "Função:"      | "Estagiária"
//   depois a tabela:  Data | Dia | Marcações | Previstas | Trabalhadas | ...
//   e as marcações vêm como "08:03 | 09:31", às vezes com "*" de ajuste manual.
//
// O FORMATO MUDOU EM SETEMBRO/2026, e o arquivo novo não trazia nenhum turno:
//
//   Data | Dia | Ent.1 | Saí.1 | Ent.2 | Saí.2 | Previstas | ...
//   46266 | "Ter" | 0.3229 | 0.3958 | ...
//
// A data virou número de série do Excel e cada batida ganhou coluna própria,
// em fração do dia. Os dois formatos são aceitos: a coluna é achada pelo nome
// no cabeçalho, e o valor é lido seja texto, seja número.

import { abrirZip, lerSharedStrings, lerLinhas, serialParaISO } from './planilha.js';

/** "08:03", "08:03*" e 0.3354 (fração do dia, como o Excel guarda) → 483 minutos. */
export function minutoDe(hhmm) {
  if (typeof hhmm === 'number') {
    return hhmm >= 0 && hhmm < 1 ? Math.round(hhmm * 1440) : null;
  }
  const m = String(hhmm ?? '').replace(/\*/g, '').trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 483 → "08:03". */
export function textoDoMinuto(min) {
  const p = x => String(x).padStart(2, '0');
  return `${p(Math.floor(min / 60))}:${p(min % 60)}`;
}

/**
 * As batidas de um dia viram TURNOS, aos pares.
 *
 * BATIDA ÍMPAR NÃO VIRA TURNO ABERTO. Entrada sem saída acontece — alguém
 * esquece de bater ao sair — e tratar isso como "ficou até o fim do dia" daria
 * ao colaborador todas as presenças da tarde inteira. O turno incompleto é
 * devolvido à parte, para a tela mostrar e alguém corrigir.
 */
export function turnosDoDia(marcacoes, dia) {
  // Texto "08:03 | 09:31" no formato antigo; lista de células no novo.
  const brutas = Array.isArray(marcacoes)
    ? marcacoes
    : String(marcacoes || '').split('|').map(s => s.trim()).filter(Boolean);
  const batidas = brutas
    .map(minutoDe).filter(m => m !== null)
    .sort((a, b) => a - b);

  const turnos = [];
  for (let i = 0; i + 1 < batidas.length; i += 2) {
    turnos.push({ dia, de: batidas[i], ate: batidas[i + 1] });
  }
  const impar = batidas.length % 2 === 1
    ? { dia, de: batidas[batidas.length - 1] }
    : null;
  return { turnos, impar };
}

/**
 * '01/08/2026' e 46266 (série do Excel) → data ISO. Devolve null para o que não
 * é data. A série só vale numa faixa plausível (2000 a 2100): a linha de totais
 * também traz números, e eles não podem virar dia.
 */
function diaIso(valor) {
  if (typeof valor === 'number') {
    return Number.isInteger(valor) && valor > 36526 && valor < 73051 ? serialParaISO(valor) : null;
  }
  const m = String(valor || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Uma aba: quem é a pessoa e os turnos que ela bateu. */
export function lerAba(linhas = []) {
  const campo = rotulo => {
    const l = linhas.find(x => String(x.celulas?.[0] || '').trim() === rotulo);
    return l ? String(l.celulas[1] ?? '').trim() : '';
  };
  const cabecalho = linhas.findIndex(x => String(x.celulas?.[0] || '').trim() === 'Data');
  if (cabecalho < 0) return null;

  // Uma coluna "Marcações" (formato antigo) ou várias "Ent.N"/"Saí.N" (novo).
  const nomes = (linhas[cabecalho].celulas || []).map(c => String(c ?? '').trim());
  const iMarcacoes = nomes.indexOf('Marcações');
  const iBatidas = nomes.flatMap((n, i) => (/^(Ent|Sa[ií])\.\s*\d+$/i.test(n) ? [i] : []));
  const marcacoesDa = l => (iBatidas.length
    ? iBatidas.map(i => l.celulas?.[i]).filter(v => v !== null && v !== undefined && v !== '')
    : l.celulas?.[iMarcacoes >= 0 ? iMarcacoes : 2]);

  const turnos = [];
  const impares = [];
  for (const l of linhas.slice(cabecalho + 1)) {
    const dia = diaIso(l.celulas?.[0]);
    if (!dia) continue;
    const r = turnosDoDia(marcacoesDa(l), dia);
    turnos.push(...r.turnos);
    if (r.impar) impares.push(r.impar);
  }

  return {
    nome: campo('Colaborador:'),
    // Só dígitos: é assim que o resto do sistema guarda CPF, e é por ele que a
    // folha casa a pessoa — nome bate errado, CPF não.
    cpf: campo('CPF:').replace(/\D/g, ''),
    funcao: campo('Função:'),
    departamento: campo('Departamento:'),
    periodo: campo('Período:'),
    turnos,
    impares,
  };
}

/**
 * O arquivo inteiro: uma entrada por colaborador.
 *
 * Este leitor NÃO usa `lerPrimeiraAba`: aqui todas as abas importam, e é
 * justamente uma por pessoa. O prefixo `x:` das tags aparece neste gerador e
 * não no de presenças — normalizar aqui é uma linha.
 */
export async function lerEspelhoDePonto(file) {
  const zip = await abrirZip(new Uint8Array(await file.arrayBuffer()));
  const sem = s => (s || '').replace(/<x:/g, '<').replace(/<\/x:/g, '</');
  const shared = lerSharedStrings(sem(zip['xl/sharedStrings.xml']));

  const abas = [...sem(zip['xl/workbook.xml']).matchAll(/<sheet[^>]*sheetId="(\d+)"/g)]
    .map(m => Number(m[1]));

  const pessoas = [];
  for (const id of abas) {
    const xml = zip[`xl/worksheets/sheet${id}.xml`];
    if (!xml) continue;
    const pessoa = lerAba(lerLinhas(sem(xml), shared, []));
    if (pessoa?.nome) pessoas.push(pessoa);
  }
  if (!pessoas.length) throw new Error('espelho_sem_colaborador');
  // Achar as pessoas e nenhuma batida é sinal de formato que este leitor não
  // conhece — foi assim que o arquivo de setembro/2026 zerou o bônus de todo
  // mundo sem erro nenhum na tela. Recusar é melhor que calcular zero.
  if (!pessoas.some(p => p.turnos.length || p.impares.length)) {
    throw new Error('espelho_sem_marcacoes');
  }
  return pessoas;
}
