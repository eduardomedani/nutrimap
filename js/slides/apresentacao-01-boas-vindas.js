// SLIDE 1 — Boas-vindas
// Abre a conversa: o nome do paciente, o intervalo do acompanhamento e há
// quanto tempo estão nisso juntos. Nenhum número de avaliação ainda — este
// slide é o "olá".

import { esc, fmtData } from '../evolucao-core.js';
import { iniciaisDoNome } from '../utils.js';

export default {
  id: 'boas-vindas',
  titulo: 'Bem-vindo',

  // Basta existir uma avaliação: sem nenhuma, não há o que apresentar.
  disponivel(d) { return !!d.atual; },

  html(d) {
    const nome = String(d.paciente?.nome || '').trim();
    const primeiro = nome.split(/\s+/)[0] || 'você';

    const de = d.primeira?.data_avaliacao;
    const ate = d.atual?.data_avaliacao;
    const mostraIntervalo = d.temComparacao && de && ate;

    // "126 dias juntos" só aparece quando há intervalo real para contar.
    const tempo = (d.dias && d.dias > 0)
      ? `<p class="ap-tempo"><b>${d.dias}</b> ${d.dias === 1 ? 'dia' : 'dias'} juntos.</p>`
      : '';

    return `
      <div class="ap-centro ap-boas">
        <div class="ap-avatar" aria-hidden="true">${esc(iniciaisDoNome(nome))}</div>
        <h1 class="ap-titulo">Olá, ${esc(primeiro)}.</h1>
        <p class="ap-subtitulo">Hoje vamos acompanhar sua evolução.</p>

        ${mostraIntervalo ? `
          <div class="ap-intervalo">
            <div class="ap-intervalo-ponta">
              <span class="ap-intervalo-lab">Primeira avaliação</span>
              <span class="ap-intervalo-val">${esc(fmtData(de))}</span>
            </div>
            <div class="ap-intervalo-seta" aria-hidden="true"><i data-lucide="arrow-down"></i></div>
            <div class="ap-intervalo-ponta">
              <span class="ap-intervalo-lab">Hoje</span>
              <span class="ap-intervalo-val">${esc(fmtData(ate))}</span>
            </div>
          </div>` : ''}

        ${tempo}
      </div>`;
  },
};
