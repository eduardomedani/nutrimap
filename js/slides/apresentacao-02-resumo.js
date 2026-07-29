// SLIDE 2 — Resumo da evolução
// Os números grandes. É o slide que o paciente lembra depois da consulta, e
// por isso ele mostra POUCA coisa: quatro variações e o progresso das metas.
//
// Cada número conta do zero até o valor real ao entrar no slide — a contagem é
// o que faz "−8,2 kg" virar uma conquista em vez de um dado.

import { esc, fmt } from '../evolucao-core.js';

const ICONE_TOM = { bom: 'trending-down', subiu: 'trending-up', atencao: 'triangle-alert', igual: 'minus' };

export default {
  id: 'resumo',
  titulo: 'Resumo da evolução',

  // Sem duas avaliações não existe "evolução" — só uma foto.
  disponivel(d) { return d.temComparacao && d.destaques.length > 0; },

  html(d) {
    const cartoes = d.destaques.map(v => {
      // A seta segue a direção do número; a cor, a leitura clínica.
      const seta = v.dif > 0 ? 'arrow-up' : 'arrow-down';
      const sinal = v.dif > 0 ? '+' : '−';
      const casas = v.unidade === '%' ? 1 : 1;
      return `
        <div class="ap-num tom-${v.tom}">
          <span class="ap-num-lab">${esc(v.label)}</span>
          <span class="ap-num-val">
            <i data-lucide="${seta}" aria-hidden="true"></i>
            <span class="ap-num-sinal">${sinal}</span><b data-conta="${Math.abs(v.dif).toFixed(2)}" data-casas="${casas}">0</b><span class="ap-num-un">${esc(v.unidade)}</span>
          </span>
          <span class="ap-num-de-para">${fmt(v.de)} → ${fmt(v.para)} ${esc(v.unidade)}</span>
        </div>`;
    }).join('');

    const meta = d.metaMedia != null ? `
      <div class="ap-num ap-num-meta tom-bom">
        <span class="ap-num-lab">Meta alcançada</span>
        <span class="ap-num-val"><b data-conta="${d.metaMedia}" data-casas="0">0</b><span class="ap-num-un">%</span></span>
        <span class="ap-num-de-para">${d.metasVivas.length} ${d.metasVivas.length === 1 ? 'meta acompanhada' : 'metas acompanhadas'}</span>
      </div>` : '';

    return `
      <div class="ap-centro">
        <h2 class="ap-secao-tit">Sua evolução até aqui</h2>
        <div class="ap-nums">${cartoes}${meta}</div>
      </div>`;
  },

  aoEntrar(el) { animarNumeros(el); },
};

/**
 * Contagem de 0 até o alvo em ~700 ms. Respeita "reduzir movimento": nesse
 * caso o valor final aparece direto, sem animação.
 */
export function animarNumeros(el, duracao = 700) {
  const reduzido = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  el.querySelectorAll('[data-conta]').forEach(node => {
    const alvo = Number(node.dataset.conta);
    const casas = Number(node.dataset.casas || 0);
    if (!Number.isFinite(alvo)) return;
    const escrever = v => { node.textContent = fmt(v, casas); };
    if (reduzido || duracao <= 0) { escrever(alvo); return; }

    const t0 = performance.now();
    const passo = (agora) => {
      const p = Math.min(1, (agora - t0) / duracao);
      // easing de saída: rápido no começo, assenta no fim
      escrever(alvo * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  });
}
