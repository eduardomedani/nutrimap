// SLIDE 7 — O que melhorou
// A leitura em palavras do que os números disseram. Gerada por REGRA
// (evolucao-core.interpretar + frases fixas por campo), nunca por IA: numa
// consulta, uma frase inventada sobre a saúde de alguém é inaceitável.
//
// Quando o plano ativo não declara objetivo, a lista deixa de julgar e passa a
// descrever — "reduziu" no lugar de "melhorou".

import { esc, fmt } from '../evolucao-core.js';

export default {
  id: 'conquistas',
  titulo: 'O que melhorou',

  disponivel(d) {
    const c = d.conquistas;
    return !!c && (c.boas.length + c.atencao.length + c.neutras.length) > 0;
  },

  html(d) {
    const c = d.conquistas;

    const item = (x, icone) => `
      <li class="ap-cq tom-${esc(x.tom)}">
        <span class="ap-cq-ic" aria-hidden="true"><i data-lucide="${icone}"></i></span>
        <span class="ap-cq-txt">${esc(x.texto)}</span>
        <span class="ap-cq-dif">${x.dif > 0 ? '+' : '−'}${fmt(Math.abs(x.dif))} ${esc(x.unidade || '')}</span>
      </li>`;

    // Teto de 6 por bloco: a lista é falada em voz alta na consulta, e a
    // décima linha ninguém ouve. As menores viram uma linha de rodapé — some
    // do palco, mas não some do relato.
    const TETO = 6;
    const bloco = (titulo, itens, icone, cls) => {
      if (!itens.length) return '';
      const visiveis = itens.slice(0, TETO);
      const resto = itens.length - visiveis.length;
      return `
      <section class="ap-cq-bloco ${cls}">
        <h3 class="ap-cq-tit">${esc(titulo)}</h3>
        <ul class="ap-cq-lista">${visiveis.map(x => item(x, icone)).join('')}</ul>
        ${resto > 0 ? `<p class="ap-cq-resto">e mais ${resto} ${resto === 1 ? 'medida' : 'medidas'}: ${
          esc(itens.slice(TETO).map(x => x.texto.replace(/ (reduziu|aumentou|diminuiu).*$/i, '')).join(', '))}</p>` : ''}
      </section>`;
    };

    // Sem objetivo que aponte direção não existe "melhorou": existe "mudou".
    const semObjetivo = !c.objetivoDirige;
    const principais = semObjetivo ? [...c.boas, ...c.neutras, ...c.atencao] : c.boas;

    return `
      <div class="ap-centro">
        <h2 class="ap-secao-tit">${semObjetivo ? 'O que mudou' : 'O que melhorou'}</h2>

        <div class="ap-cq-grid">
          ${bloco(semObjetivo ? 'Mudanças' : 'Conquistas', principais, semObjetivo ? 'arrow-right' : 'check', 'ap-cq-boas')}
          ${semObjetivo ? '' : bloco('Pontos de atenção', c.atencao, 'triangle-alert', 'ap-cq-atencao')}
          ${semObjetivo ? '' : bloco('Também mudaram', c.neutras, 'arrow-right', 'ap-cq-neutras')}
        </div>

        <p class="ap-cq-nota">${semObjetivo
          ? (d.objetivo
              ? `O objetivo do plano ativo (${esc(d.objetivo)}) não aponta uma direção para os indicadores, então as mudanças aparecem sem julgamento de valor.`
              : 'O plano ativo não declara objetivo, então as mudanças aparecem sem julgamento de valor.')
          : `Leitura orientada pelo objetivo do plano ativo (${esc(d.objetivo)}). Não é diagnóstico.`}</p>
      </div>`;
  },
};
