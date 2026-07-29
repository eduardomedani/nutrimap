// SLIDE 4 — Linha do tempo
// Todas as avaliações numa trilha só. Clicar num ponto muda qual avaliação é a
// "atual" — e isso reverbera nos slides de composição, gráficos, mapa corporal
// e conquistas. É o mecanismo de "comparar entre avaliações" do briefing.

import { esc, fmt, fmtData, num } from '../evolucao-core.js';

export default {
  id: 'linha-do-tempo',
  titulo: 'Linha do tempo',

  disponivel(d) { return (d.avaliacoes || []).length >= 2; },

  html(d) {
    const avs = d.avaliacoes;
    const sel = d.avaliacoes.find(a => a.id === d.idAtual) || avs[avs.length - 1];

    const pontos = avs.map(a => {
      const ativo = a.id === sel.id;
      const peso = num(a.peso);
      const pg = num(a.pct_gordura);
      return `
        <li class="ap-tl-item ${ativo ? 'ativo' : ''}">
          <button class="ap-tl-ponto" data-tl-av="${esc(a.id)}"
                  aria-pressed="${ativo}"
                  aria-label="Avaliação ${a.numero} de ${esc(fmtData(a.data_avaliacao))}">
            <span class="ap-tl-bolha"></span>
            <span class="ap-tl-av">AV ${a.numero}</span>
            <span class="ap-tl-data">${esc(fmtData(a.data_avaliacao).slice(0, 5))}</span>
            <span class="ap-tl-vals">
              ${peso != null ? `<b>${fmt(peso)} kg</b>` : ''}
              ${pg != null ? `<span>${fmt(pg * 100)}%</span>` : ''}
            </span>
          </button>
        </li>`;
    }).join('');

    return `
      <div class="ap-centro">
        <h2 class="ap-secao-tit">Sua linha do tempo</h2>
        <ol class="ap-tl">${pontos}</ol>
        <div class="ap-tl-detalhe" data-tl-detalhe>${detalheHtml(sel, d)}</div>
        <p class="ap-tl-dica">Toque em uma avaliação para comparar a partir dela.</p>
      </div>`;
  },

  ligar(el, d, api) {
    el.querySelectorAll('[data-tl-av]').forEach(b =>
      b.addEventListener('click', () => api.trocarAvaliacao(b.dataset.tlAv)));
  },
};

/** Resumo da avaliação escolhida, comparado com a primeira. */
function detalheHtml(av, d) {
  const CAMPOS = [
    { campo: 'peso',         label: 'Peso',          unidade: 'kg', escala: 1 },
    { campo: 'pct_gordura',  label: '% de gordura',  unidade: '%',  escala: 100 },
    { campo: 'peso_magro',   label: 'Massa magra',   unidade: 'kg', escala: 1 },
    { campo: 'per_cintura',  label: 'Cintura',       unidade: 'cm', escala: 1 },
  ];
  const base = d.primeira;
  const itens = CAMPOS.map(c => {
    const v = num(av[c.campo]);
    if (v == null) return '';
    const val = v * c.escala;
    const b = base && base.id !== av.id ? num(base[c.campo]) : null;
    const dif = b != null ? val - b * c.escala : null;
    return `
      <div class="ap-tl-cel">
        <span class="ap-tl-cel-lab">${esc(c.label)}</span>
        <span class="ap-tl-cel-val">${fmt(val)}<small>${esc(c.unidade)}</small></span>
        ${dif != null && Math.abs(dif) >= 0.05
          ? `<span class="ap-tl-cel-dif">${dif > 0 ? '+' : '−'}${fmt(Math.abs(dif))} desde a AV ${base.numero}</span>` : ''}
      </div>`;
  }).join('');

  return `
    <div class="ap-tl-cab">Avaliação ${av.numero} · ${esc(fmtData(av.data_avaliacao))}</div>
    <div class="ap-tl-cels">${itens}</div>`;
}
