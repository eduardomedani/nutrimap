// SLIDE 5 — Gráficos
// UM gráfico grande de cada vez. Vários gráficos pequenos na mesma tela viram
// papel de parede: ninguém lê nenhum.
//
// O desenho é o mesmo svgLinha da aba Evolução (evolucao-core.js) — em escala
// maior. Série e período trocam sem sair do slide.

import {
  SERIES, esc, fmt, pontosDaSerie, marcosDePlano, svgLinha,
} from '../evolucao-core.js';

// Períodos da apresentação: os três do briefing, sem os intermediários.
const PERIODOS = [
  { id: 30, label: '30 dias' },
  { id: 90, label: '90 dias' },
  { id: 0,  label: 'Todo o período' },
];

// Ordem de leitura na consulta: o que o paciente pergunta primeiro.
const ORDEM = [
  'peso', 'gordura', 'massa_gorda', 'massa_magra',
  'cintura', 'abdomen', 'quadril', 'braco', 'coxa', 'panturrilha',
  'dobra_abd', 'dobra_supra', 'dobra_tri', 'imc',
];

let _serie = 'peso';
let _periodo = 0;

export default {
  id: 'graficos',
  titulo: 'Gráficos',

  disponivel(d) {
    // Precisa de pelo menos uma série com duas medidas — senão não há linha.
    return ORDEM.some(id => pontosDaSerie(d.avaliacoes, id, 0).length >= 2);
  },

  html(d) {
    const comDado = ORDEM.filter(id => pontosDaSerie(d.avaliacoes, id, 0).length >= 2);
    if (!comDado.includes(_serie)) _serie = comDado[0];

    const abas = comDado.map(id =>
      `<button class="ap-chip ${id === _serie ? 'ativo' : ''}" data-gr-serie="${id}">${esc(SERIES[id].label)}</button>`).join('');

    const periodos = PERIODOS.map(p =>
      `<button class="ap-chip ap-chip-sm ${p.id === _periodo ? 'ativo' : ''}" data-gr-periodo="${p.id}">${esc(p.label)}</button>`).join('');

    return `
      <div class="ap-centro ap-gr">
        <h2 class="ap-secao-tit">Como você chegou até aqui</h2>
        <div class="ap-chips">${abas}</div>
        <div class="ap-gr-caixa" data-gr-caixa></div>
        <div class="ap-gr-rodape">
          <div class="ap-gr-legenda" data-gr-legenda></div>
          <div class="ap-chips ap-chips-fim">${periodos}</div>
        </div>
      </div>`;
  },

  ligar(el, d, api) {
    el.querySelectorAll('[data-gr-serie]').forEach(b =>
      b.addEventListener('click', () => { _serie = b.dataset.grSerie; redesenhar(el, d, true); }));
    el.querySelectorAll('[data-gr-periodo]').forEach(b =>
      b.addEventListener('click', () => { _periodo = Number(b.dataset.grPeriodo); redesenhar(el, d, true); }));
  },

  aoEntrar(el, d) { redesenhar(el, d, false); },
};

function redesenhar(el, d, remarcar) {
  if (remarcar) {
    el.querySelectorAll('[data-gr-serie]').forEach(b =>
      b.classList.toggle('ativo', b.dataset.grSerie === _serie));
    el.querySelectorAll('[data-gr-periodo]').forEach(b =>
      b.classList.toggle('ativo', Number(b.dataset.grPeriodo) === _periodo));
  }

  const caixa = el.querySelector('[data-gr-caixa]');
  const legenda = el.querySelector('[data-gr-legenda]');
  if (!caixa) return;

  const s = SERIES[_serie];
  const pontos = pontosDaSerie(d.avaliacoes, _serie, _periodo);

  if (pontos.length < 2) {
    caixa.innerHTML = `<div class="ap-gr-vazio">${pontos.length === 1
      ? 'Só há uma medida deste indicador no período escolhido.'
      : 'Nenhuma medida deste indicador no período escolhido.'}</div>`;
    if (legenda) legenda.innerHTML = '';
    return;
  }

  // A meta vira uma linha horizontal quando existe para esta série.
  const meta = s.meta
    ? (d.metas || []).find(m => m.tipo === s.meta && m.status !== 'cancelada')
    : null;

  // Largura real do container: com viewBox esticado, o texto dos eixos
  // escalaria junto e sairia da tipografia do sistema.
  const largura = Math.max(360, Math.round(caixa.clientWidth || 900));
  caixa.innerHTML = svgLinha(pontos, {
    unidade: s.unidade,
    meta: meta ? Number(meta.valor_alvo) : null,
    marcos: marcosDePlano(d.resumo?.planos, _periodo),
    largura,
    altura: 340,
    rotulo: s.label,
  });

  if (legenda) {
    const p0 = pontos[0], p1 = pontos[pontos.length - 1];
    const dif = p1.valor - p0.valor;
    legenda.innerHTML = `
      <b>${fmt(p1.valor)}${esc(s.unidade)}</b> agora
      <span class="ap-sep">·</span>
      ${dif > 0 ? '+' : '−'}${fmt(Math.abs(dif))}${esc(s.unidade)} no período
      <span class="ap-sep">·</span>
      ${pontos.length} medidas`;
  }
}

/** Só para os testes: devolve o estado interno do slide. */
export const _estado = () => ({ serie: _serie, periodo: _periodo });
