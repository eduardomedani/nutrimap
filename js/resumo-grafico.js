// ═══════════════════════════════════════════════════════════
// RESUMO — gráficos em SVG, sem biblioteca
// ═══════════════════════════════════════════════════════════
// Funções puras: entram dados, sai marcação. Nada de DOM, nada de rede — é o
// que permite conferir a GEOMETRIA no teste, e não só a existência do desenho.
//
// AS DUAS CORES foram escolhidas por validação, não por gosto: verde-700 e
// azul passam nos seis testes de paleta contra a superfície branca, incluindo
// contraste ≥ 3:1. O verde da marca (#18B984) reprovou nesse último com 2,46:1
// — ele é cor de ação em botão, não de área grande sobre branco.
//
// Uma barra empilhada só, em vez de dois gráficos: a soma dos dois segmentos É
// o custo do mês. Separados, os dois desenhos mostrariam o mesmo número duas
// vezes e o olho teria que somá-los de novo.

export const CORES = {
  base:       'var(--color-primary-700)',   // #167C57 — horas trabalhadas
  adicionais: 'var(--chart-carb)',          // #3B82F6 — bônus e descontos
};

export const SERIES = [
  { chave: 'base',       rotulo: 'Horas e valor base',     cor: CORES.base },
  { chave: 'adicionais', rotulo: 'Adicionais e descontos', cor: CORES.adicionais },
];

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
                      'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** '2026-08-01' → 'ago/26'. Rótulo de eixo precisa caber, não ser completo. */
export function rotuloCurto(competencia) {
  const m = /^(\d{4})-(\d{2})/.exec(String(competencia || ''));
  if (!m) return '';
  return `${MESES_CURTOS[Number(m[2]) - 1]}/${m[1].slice(2)}`;
}

/**
 * Escala "bonita" para o eixo: o topo vira um número redondo, e não o valor
 * máximo cru. Eixo terminando em 2.313,67 obriga a ler o número para entender
 * a altura; terminando em 2.500 a altura se lê sozinha.
 */
export function escalaBonita(maximo, divisoes = 4) {
  const m = Number(maximo);
  if (!Number.isFinite(m) || m <= 0) return { topo: 100, passo: 25 };

  const bruto = m / divisoes;
  const magnitude = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = [1, 2, 2.5, 5, 10].map(x => x * magnitude).find(x => x >= bruto) || magnitude * 10;
  return { topo: passo * divisoes, passo };
}

/**
 * Barras empilhadas do custo mensal.
 *
 * @param {Array} meses  [{ competencia, base, adicionais, total }]
 * @param {object} opcoes { largura, altura, destaque }
 * @returns {{svg: string, barras: Array}} a marcação e a geometria de cada
 *          barra — a geometria sai junto para a camada de hover saber onde
 *          cada mês está sem precisar reler o SVG.
 */
export function graficoMensal(meses, opcoes = {}) {
  const {
    largura = 720,
    altura = 240,
    margemEsq = 56,
    margemBaixo = 26,
    margemTopo = 12,
  } = opcoes;

  if (!meses?.length) return { svg: '', barras: [] };

  const areaL = largura - margemEsq - 8;
  const areaA = altura - margemBaixo - margemTopo;
  const { topo, passo } = escalaBonita(Math.max(...meses.map(m => Number(m.total) || 0)));

  // 2px de respiro entre barras vizinhas: sem o vão, dois meses parecidos
  // viram um bloco só.
  const passoX = areaL / meses.length;
  const larguraBarra = Math.max(3, Math.min(28, passoX - 4));
  const y = (v) => margemTopo + areaA - (v / topo) * areaA;

  const grade = [];
  for (let v = 0; v <= topo + 0.001; v += passo) {
    grade.push(`
      <line class="rg-grade" x1="${margemEsq}" x2="${largura - 8}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
      <text class="rg-eixo-y" x="${margemEsq - 8}" y="${(y(v) + 4).toFixed(1)}">${curto(v)}</text>`);
  }

  const barras = [];
  const marcas = meses.map((m, i) => {
    const x = margemEsq + i * passoX + (passoX - larguraBarra) / 2;
    const base = Math.max(0, Number(m.base) || 0);
    const add = Math.max(0, Number(m.adicionais) || 0);
    const total = base + add;

    const hBase = (base / topo) * areaA;
    const hAdd = (add / topo) * areaA;
    // 2px de superfície entre os segmentos empilhados, como entre as barras.
    const vao = hAdd > 3 && hBase > 3 ? 2 : 0;

    const yAdd = y(total);
    const yBase = y(base);

    barras.push({ ...m, x, largura: larguraBarra, y: yAdd, altura: y(0) - yAdd, indice: i });

    return `
      <g class="rg-barra" data-rg-mes="${i}">
        ${hBase > 0 ? `<rect class="rg-seg rg-base" x="${x.toFixed(1)}" y="${yBase.toFixed(1)}"
          width="${larguraBarra.toFixed(1)}" height="${Math.max(1, y(0) - yBase).toFixed(1)}" rx="0"/>` : ''}
        ${hAdd > 0 ? `<rect class="rg-seg rg-add" x="${x.toFixed(1)}" y="${yAdd.toFixed(1)}"
          width="${larguraBarra.toFixed(1)}" height="${Math.max(1, hAdd - vao).toFixed(1)}" rx="4"/>` : ''}
        <rect class="rg-alvo" x="${(margemEsq + i * passoX).toFixed(1)}" y="${margemTopo}"
          width="${passoX.toFixed(1)}" height="${areaA.toFixed(1)}"/>
      </g>`;
  });

  // Rótulo de eixo só de tempos em tempos: 24 rótulos colidem, 6 se leem.
  const cada = Math.max(1, Math.ceil(meses.length / 8));
  const rotulos = meses.map((m, i) => (i % cada === 0 || i === meses.length - 1)
    ? `<text class="rg-eixo-x" x="${(margemEsq + i * passoX + passoX / 2).toFixed(1)}"
         y="${altura - 8}">${rotuloCurto(m.competencia)}</text>`
    : '').join('');

  return {
    svg: `<svg class="rg-svg" viewBox="0 0 ${largura} ${altura}" role="img"
            aria-label="Custo mensal da equipe, dividido entre horas e adicionais">
            ${grade.join('')}
            ${marcas.join('')}
            ${rotulos}
          </svg>`,
    barras,
  };
}

/**
 * Barras horizontais do custo por colaborador. Uma série só, uma cor só —
 * pintar cada pessoa de uma cor faria a cor significar identidade num gráfico
 * em que ela não significa nada.
 */
export function graficoPorPessoa(pessoas, opcoes = {}) {
  const { limite = 12 } = opcoes;
  const lista = [...(pessoas || [])]
    .sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0))
    .slice(0, limite);
  if (!lista.length) return '';

  const maior = Math.max(...lista.map(p => Number(p.total) || 0), 1);

  return `<div class="rg-pessoas">${lista.map(p => {
    const pct = Math.max(1, ((Number(p.total) || 0) / maior) * 100);
    return `
      <div class="rg-pessoa">
        <div class="rg-pessoa-nome" title="${esc(p.nome)}">${esc(p.nome)}</div>
        <div class="rg-pessoa-barra"><span style="width:${pct.toFixed(1)}%"></span></div>
        <div class="rg-pessoa-valor">${esc(brl(p.total))}</div>
      </div>`;
  }).join('')}</div>`;
}

// ───────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────

/** 12500 → "12,5 mil". Eixo com "R$ 12.500,00" rouba metade da largura. */
export function curto(valor) {
  const n = Number(valor) || 0;
  if (n === 0) return '0';
  if (Math.abs(n) >= 1000) {
    const mil = n / 1000;
    return `${mil % 1 === 0 ? mil : mil.toFixed(1).replace('.', ',')} mil`;
  }
  return String(Math.round(n));
}

const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export { brl };
