// SLIDE 3 — Composição corporal
// Antes → agora, em barras pareadas. Sem tabela: o paciente precisa VER que a
// barra de gordura encolheu e a de massa magra ficou onde estava.
//
// As barras dividem a mesma escala (o maior valor da tela vira 100%) — assim
// "massa magra" e "peso de gordura" ficam comparáveis entre si, e não só
// consigo mesmas.

import { esc, fmt } from '../evolucao-core.js';

export default {
  id: 'composicao',
  titulo: 'Composição corporal',

  disponivel(d) { return d.temComparacao && d.composicao.length > 0; },

  html(d) {
    const valores = d.composicao.flatMap(c => [c.antes, c.agora]).filter(v => v != null);
    const teto = Math.max(...valores, 1);
    const larg = v => (v == null ? 0 : Math.max(2, Math.round((v / teto) * 100)));

    const linhas = d.composicao.map(c => {
      const dif = c.dif;
      const delta = dif != null && Math.abs(dif) >= 0.05
        ? `<span class="ap-comp-delta tom-${esc(c.tom)}">${dif > 0 ? '+' : '−'}${fmt(Math.abs(dif))} ${esc(c.unidade)}</span>`
        : '';
      return `
        <article class="ap-comp">
          <header class="ap-comp-head">
            <span class="ap-comp-nome">${esc(c.label)}</span>
            ${delta}
          </header>

          ${c.antes != null ? `
            <div class="ap-comp-linha">
              <span class="ap-comp-lab">Antes</span>
              <div class="ap-comp-trilho">
                <span class="ap-comp-barra ap-comp-antes" data-cresce="${larg(c.antes)}"></span>
              </div>
              <span class="ap-comp-val">${fmt(c.antes)}<small>${esc(c.unidade)}</small></span>
            </div>` : ''}

          <div class="ap-comp-linha">
            <span class="ap-comp-lab">Agora</span>
            <div class="ap-comp-trilho">
              <span class="ap-comp-barra ap-comp-agora tom-${esc(c.tom)}" data-cresce="${larg(c.agora)}"></span>
            </div>
            <span class="ap-comp-val">${fmt(c.agora)}<small>${esc(c.unidade)}</small></span>
          </div>
        </article>`;
    }).join('');

    return `
      <div class="ap-centro">
        <h2 class="ap-secao-tit">Do que o seu peso é feito</h2>
        <div class="ap-comps">${linhas}</div>
      </div>`;
  },

  aoEntrar(el) { crescer(el); },
};

/** Cada barra sai de 0 e cresce; um pequeno atraso em cascata dá o ritmo. */
function crescer(el) {
  const reduzido = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  el.querySelectorAll('[data-cresce]').forEach((b, i) => {
    const pct = Math.max(0, Math.min(100, Number(b.dataset.cresce) || 0));
    if (reduzido) { b.style.width = pct + '%'; return; }
    b.style.width = '0%';
    b.style.transitionDelay = `${Math.min(i * 45, 400)}ms`;
    requestAnimationFrame(() => { b.style.width = pct + '%'; });
  });
}
