// ═══════════════════════════════════════════════════════════
// FINANCEIRO — gráfico de Receita × Despesa, em SVG, sem biblioteca
// ═══════════════════════════════════════════════════════════
// Função pura: entram os doze meses, sai marcação. Nada de DOM, nada de rede —
// é o que permite conferir a GEOMETRIA no teste, e não só a existência do
// desenho. Mesmo contrato de js/resumo-grafico.js, de onde vêm a escala e os
// rótulos: são helpers genéricos e já testados, e duplicá-los criaria dois
// eixos que divergem no dia em que um for ajustado.
//
// DUAS BARRAS POR MÊS, NÃO UMA LÍQUIDA. Uma barra só com o resultado esconde a
// escala do negócio: R$ 10 mil de lucro sobre R$ 100 mil e sobre R$ 12 mil
// desenham a mesma altura, e são situações opostas. Lado a lado, a diferença
// entre as duas alturas É o resultado, e o tamanho de cada uma continua à vista.
//
// A DESPESA É EMPILHADA em dois segmentos — lançamentos e folha — porque são
// apurados por módulos diferentes. Uma barra só de "despesa" apagaria de onde
// cada pedaço veio, e é justamente essa separação que o módulo inteiro defende.
//
// AS TRÊS CORES passam em contraste ≥ 3:1 sobre a superfície branca, que é o
// critério já adotado em resumo-grafico.js. O verde da marca (#18B984) reprova
// nesse teste com 2,46:1 — ele é cor de ação em botão, não de área grande.

import { escalaBonita, curto, rotuloCurto, brl } from './resumo-grafico.js';

export const CORES = {
  receita: 'var(--color-primary-700)',   // #167C57 — 4,7:1
  despesa: 'var(--chart-kcal)',          // #7C5CFF — 4,2:1
  folha:   'var(--chart-carb)',          // #3B82F6 — 3,7:1
};

export const SERIES = [
  { chave: 'receita', rotulo: 'Receita',            cor: CORES.receita },
  { chave: 'despesa', rotulo: 'Despesas lançadas',  cor: CORES.despesa },
  { chave: 'folha',   rotulo: 'Folha da equipe',    cor: CORES.folha },
];

export { escalaBonita, curto, rotuloCurto, brl };

/**
 * Receita × Despesa dos doze meses de um ano.
 *
 * @param {Array}  meses   [{ competencia, receita, despesa, folha, custo }]
 * @param {object} opcoes  { largura, altura }
 * @returns {{svg: string, barras: Array, topo: number}} a marcação e a
 *          geometria de cada mês — a geometria sai junto para a camada de hover
 *          saber onde cada mês está sem precisar reler o SVG.
 */
export function graficoReceitaDespesa(meses, opcoes = {}) {
  const {
    largura = 720,
    altura = 260,
    margemEsq = 56,
    margemBaixo = 26,
    margemTopo = 12,
  } = opcoes;

  if (!meses?.length) return { svg: '', barras: [], topo: 0 };

  const areaL = largura - margemEsq - 8;
  const areaA = altura - margemBaixo - margemTopo;

  // O topo do eixo é o maior entre receita e custo, não o maior de cada um: com
  // duas escalas, barras de alturas iguais significariam valores diferentes.
  const maximo = Math.max(...meses.map(m => Math.max(Number(m.receita) || 0,
                                                     Number(m.custo) || 0)), 0);
  const { topo, passo } = escalaBonita(maximo);

  const passoX = areaL / meses.length;
  // Duas barras no mesmo mês, com 2px entre elas e respiro para o mês vizinho.
  const larguraBarra = Math.max(3, Math.min(18, (passoX - 8) / 2));
  const y = v => margemTopo + areaA - (v / topo) * areaA;
  const base = y(0);

  const grade = [];
  for (let v = 0; v <= topo + 0.001; v += passo) {
    const yv = y(v).toFixed(1);
    grade.push(`
      <line class="rg-grade" x1="${margemEsq}" x2="${largura - 8}" y1="${yv}" y2="${yv}"/>
      <text class="rg-eixo-y" x="${margemEsq - 8}" y="${(y(v) + 4).toFixed(1)}">${curto(v)}</text>`);
  }

  const barras = [];
  const marcas = meses.map((m, i) => {
    const receita = Math.max(0, Number(m.receita) || 0);
    const despesa = Math.max(0, Number(m.despesa) || 0);
    const folha   = Math.max(0, Number(m.folha) || 0);
    const custo   = despesa + folha;

    const centro = margemEsq + i * passoX + passoX / 2;
    const xR = centro - larguraBarra - 1;
    const xD = centro + 1;

    const yR = y(receita);
    const yFolha = y(custo);            // folha empilhada por cima
    const yDesp = y(despesa);
    const alturaFolha = yDesp - yFolha;
    // 2px de superfície entre os segmentos empilhados, como entre as barras.
    const vao = alturaFolha > 3 && (base - yDesp) > 3 ? 2 : 0;

    barras.push({
      ...m, indice: i, centro,
      receita: { x: xR, y: yR, altura: base - yR },
      custo:   { x: xD, y: yFolha, altura: base - yFolha },
      largura: larguraBarra,
    });

    return `
      <g class="fg-mes" data-fg-mes="${i}">
        ${receita > 0 ? `<rect class="fg-seg fg-receita" x="${xR.toFixed(1)}" y="${yR.toFixed(1)}"
          width="${larguraBarra.toFixed(1)}" height="${Math.max(1, base - yR).toFixed(1)}" rx="3"/>` : ''}
        ${despesa > 0 ? `<rect class="fg-seg fg-despesa" x="${xD.toFixed(1)}" y="${yDesp.toFixed(1)}"
          width="${larguraBarra.toFixed(1)}" height="${Math.max(1, base - yDesp).toFixed(1)}" rx="0"/>` : ''}
        ${folha > 0 ? `<rect class="fg-seg fg-folha" x="${xD.toFixed(1)}" y="${yFolha.toFixed(1)}"
          width="${larguraBarra.toFixed(1)}" height="${Math.max(1, alturaFolha - vao).toFixed(1)}" rx="3"/>` : ''}
        <rect class="rg-alvo" x="${(margemEsq + i * passoX).toFixed(1)}" y="${margemTopo}"
          width="${passoX.toFixed(1)}" height="${areaA.toFixed(1)}"/>
      </g>`;
  });

  const rotulos = meses.map((m, i) =>
    `<text class="rg-eixo-x" x="${(margemEsq + i * passoX + passoX / 2).toFixed(1)}"
       y="${altura - 8}">${rotuloCurto(m.competencia).split('/')[0]}</text>`).join('');

  return {
    svg: `<svg class="rg-svg" viewBox="0 0 ${largura} ${altura}" role="img"
            aria-label="Receita e despesa mês a mês. A despesa é dividida entre lançamentos e folha da equipe.">
            ${grade.join('')}
            ${marcas.join('')}
            ${rotulos}
          </svg>`,
    barras,
    topo,
  };
}

/**
 * FLUXO DE CAIXA — entradas acima do zero, saídas abaixo, saldo acumulado em
 * linha.
 *
 * O EIXO ZERO NO MEIO, e não uma barra líquida: um mês que movimentou R$ 60 mil
 * para dentro e R$ 58 mil para fora tem o mesmo saldo de um que movimentou
 * R$ 3 mil e R$ 1 mil, e são operações completamente diferentes. Com os dois
 * lados desenhados, o tamanho da operação aparece junto com o resultado.
 *
 * A LINHA DO ACUMULADO é o que responde "o caixa aguenta?". O saldo do mês
 * sozinho não responde: três meses negativos seguidos podem ser irrelevantes
 * sobre uma reserva alta, e fatais sem ela.
 *
 * @param {Array} meses [{ competencia, entrou, saiu, saldo, acumulado }]
 */
export function graficoFluxo(meses, opcoes = {}) {
  const {
    largura = 720,
    altura = 280,
    margemEsq = 60,
    margemBaixo = 26,
    margemTopo = 14,
  } = opcoes;

  if (!meses?.length) return { svg: '', barras: [], topo: 0 };

  const areaL = largura - margemEsq - 8;
  const areaA = altura - margemBaixo - margemTopo;

  // UMA escala para os dois lados: entrada e saída de mesmo valor têm que
  // desenhar a mesma altura, senão o gráfico mente sobre qual é maior.
  const maior = Math.max(...meses.map(m => Math.max(Number(m.entrou) || 0, Number(m.saiu) || 0)), 0);
  const { topo, passo } = escalaBonita(maior, 3);

  // O acumulado tem escala PRÓPRIA e é declarado como tal na legenda: ele é uma
  // ordem de grandeza acima do movimento mensal, e forçá-lo na mesma régua
  // achataria as barras até virarem um traço.
  const accs = meses.map(m => Number(m.acumulado) || 0);
  const accMax = Math.max(...accs, 0);
  const accMin = Math.min(...accs, 0);
  const accVao = (accMax - accMin) || 1;

  const passoX = areaL / meses.length;
  const larguraBarra = Math.max(3, Math.min(22, passoX - 10));
  const meio = margemTopo + areaA / 2;
  const metade = areaA / 2;
  const y = v => meio - (v / topo) * metade;
  const yAcc = v => margemTopo + areaA - ((v - accMin) / accVao) * areaA;

  const grade = [];
  for (let v = -topo; v <= topo + 0.001; v += passo) {
    if (Math.abs(v) < 0.001) continue;
    const yv = y(v).toFixed(1);
    grade.push(`
      <line class="rg-grade" x1="${margemEsq}" x2="${largura - 8}" y1="${yv}" y2="${yv}"/>
      <text class="rg-eixo-y" x="${margemEsq - 8}" y="${(y(v) + 4).toFixed(1)}">${curto(Math.abs(v))}</text>`);
  }

  const barras = [];
  const marcas = meses.map((m, i) => {
    const entrou = Math.max(0, Number(m.entrou) || 0);
    const saiu = Math.max(0, Number(m.saiu) || 0);
    const x = margemEsq + i * passoX + (passoX - larguraBarra) / 2;

    const hE = (entrou / topo) * metade;
    const hS = (saiu / topo) * metade;

    barras.push({ ...m, indice: i, x, largura: larguraBarra, entradaAltura: hE, saidaAltura: hS });

    return `
      <g class="fg-mes" data-fg-mes="${i}">
        ${entrou > 0 ? `<rect class="fg-seg fg-entrada" x="${x.toFixed(1)}" y="${(meio - hE).toFixed(1)}"
          width="${larguraBarra.toFixed(1)}" height="${Math.max(1, hE).toFixed(1)}" rx="3"/>` : ''}
        ${saiu > 0 ? `<rect class="fg-seg fg-saida" x="${x.toFixed(1)}" y="${meio.toFixed(1)}"
          width="${larguraBarra.toFixed(1)}" height="${Math.max(1, hS).toFixed(1)}" rx="3"/>` : ''}
        <rect class="rg-alvo" x="${(margemEsq + i * passoX).toFixed(1)}" y="${margemTopo}"
          width="${passoX.toFixed(1)}" height="${areaA.toFixed(1)}"/>
      </g>`;
  });

  const pontos = meses.map((m, i) =>
    `${(margemEsq + i * passoX + passoX / 2).toFixed(1)},${yAcc(Number(m.acumulado) || 0).toFixed(1)}`).join(' ');

  const rotulos = meses.map((m, i) =>
    `<text class="rg-eixo-x" x="${(margemEsq + i * passoX + passoX / 2).toFixed(1)}"
       y="${altura - 8}">${rotuloCurto(m.competencia).split('/')[0]}</text>`).join('');

  return {
    svg: `<svg class="rg-svg" viewBox="0 0 ${largura} ${altura}" role="img"
            aria-label="Fluxo de caixa: entradas acima do eixo, saídas abaixo, e o saldo acumulado em linha.">
            ${grade.join('')}
            <line class="fg-zero" x1="${margemEsq}" x2="${largura - 8}" y1="${meio}" y2="${meio}"/>
            ${marcas.join('')}
            <polyline class="fg-acumulado" points="${pontos}"/>
            ${rotulos}
          </svg>`,
    barras,
    topo,
  };
}

export const SERIES_FLUXO = [
  { chave: 'entrada',   rotulo: 'Entradas',        cor: CORES.receita },
  { chave: 'saida',     rotulo: 'Saídas',          cor: CORES.despesa },
  { chave: 'acumulado', rotulo: 'Saldo acumulado', cor: CORES.folha },
];

export function legendaFluxoHtml() {
  return `<div class="rs-legenda">
    ${SERIES_FLUXO.map(s => `<span class="rs-leg"><i class="fg-ponto fg-ponto-${
      s.chave === 'entrada' ? 'receita' : s.chave === 'saida' ? 'despesa' : 'folha'
    }"></i>${s.rotulo}</span>`).join('')}
    <span class="rs-leg fg-leg-nota">o acumulado tem escala própria</span>
  </div>`;
}

/** A legenda. Sai daqui, e não da tela, para série e cor nunca se separarem:
 *  legenda escrita à mão continua verde depois que o gráfico virou azul. */
export function legendaHtml() {
  return `<div class="rs-legenda">
    ${SERIES.map(s => `<span class="rs-leg"><i class="fg-ponto fg-ponto-${s.chave}"></i>${s.rotulo}</span>`).join('')}
  </div>`;
}
