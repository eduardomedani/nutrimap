// SLIDE 6 — Corpo humano
// O mapa onde a evolução vira geografia: o paciente vê ONDE mudou, não só
// quanto. Frente e costas, cada região pintada pela sua variação; tocar numa
// região abre o antes → agora daquela medida.

import { esc, fmt, num, tomDaVariacao } from '../evolucao-core.js';
import { svgCorpo, estadosDasRegioes } from '../apresentacao-mapa.js';

let _vista = 'frente';

export default {
  id: 'corpo',
  titulo: 'Mapa corporal',

  // Só faz sentido com pelo menos uma região medida nas duas avaliações.
  disponivel(d) {
    if (!d.temComparacao) return false;
    return ['frente', 'costas'].some(v =>
      estados(v, d).some(e => e.dif != null));
  },

  html(d) {
    const temCostas = estados('costas', d).some(e => e.temDado);
    if (!temCostas) _vista = 'frente';
    const es = estados(_vista, d);

    const abas = temCostas ? `
      <div class="ap-chips ap-corpo-vistas">
        <button class="ap-chip ap-chip-sm ${_vista === 'frente' ? 'ativo' : ''}" data-vista="frente">Frente</button>
        <button class="ap-chip ap-chip-sm ${_vista === 'costas' ? 'ativo' : ''}" data-vista="costas">Costas</button>
      </div>` : '';

    // Pré-seleciona a região que mais mudou — é sobre ela que a conversa começa.
    const destaque = [...es].filter(e => e.dif != null)
      .sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif))[0] || null;

    return `
      <div class="ap-corpo-wrap">
        <div class="ap-corpo-col">
          <h2 class="ap-secao-tit ap-corpo-tit">Onde o seu corpo mudou</h2>
          ${abas}
          <div class="ap-corpo-svg" data-corpo>${svgCorpo(_vista, es)}</div>
          <div class="ap-corpo-legenda">
            <span><i class="ap-bolinha tom-bom"></i> Reduziu</span>
            <span><i class="ap-bolinha tom-subiu"></i> Aumentou</span>
            <span><i class="ap-bolinha tom-atencao"></i> Atenção</span>
          </div>
        </div>

        <aside class="ap-corpo-lado">
          <div data-corpo-painel>${destaque ? detalhe(destaque, d) : vazio()}</div>
          <!-- Mesma seleção da silhueta, por nome. No tablet o corpo fica alto e
               estreito e a dobra vira um alvo de ~15 px; aqui o alvo é a
               palavra. Fica nesta coluna porque a esquerda já está cheia — e a
               direita, sobrando. Também é por onde teclado e leitor de tela
               navegam entre as regiões. -->
          <div class="ap-corpo-atalhos" data-corpo-atalhos>${atalhos(es)}</div>
        </aside>
      </div>`;
  },

  ligar(el, d, api) {
    const painel = el.querySelector('[data-corpo-painel]');

    const abrir = (id) => {
      const e = estados(_vista, d).find(x => x.id === id);
      if (!e || !e.temDado || !painel) return;
      painel.innerHTML = detalhe(e, d);
      el.querySelectorAll('[data-regiao]').forEach(p =>
        p.classList.toggle('ativa', p.dataset.regiao === id));
      el.querySelectorAll('[data-regiao-nome]').forEach(p =>
        p.classList.toggle('ativo', p.dataset.regiaoNome === id));
    };

    const ligarRegioes = () => {
      el.querySelectorAll('[data-regiao]').forEach(p => {
        if (p.getAttribute('tabindex') === '-1') return;   // sem medida: inerte
        p.addEventListener('click', () => abrir(p.dataset.regiao));
        p.addEventListener('keydown', ev => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(p.dataset.regiao); }
        });
      });
      el.querySelectorAll('[data-regiao-nome]').forEach(b =>
        b.addEventListener('click', () => abrir(b.dataset.regiaoNome)));
    };
    ligarRegioes();

    el.querySelectorAll('[data-vista]').forEach(b =>
      b.addEventListener('click', () => {
        _vista = b.dataset.vista;
        el.querySelectorAll('[data-vista]').forEach(x => x.classList.toggle('ativo', x === b));
        const caixa = el.querySelector('[data-corpo]');
        const es = estados(_vista, d);
        if (caixa) caixa.innerHTML = svgCorpo(_vista, es);
        const lista = el.querySelector('[data-corpo-atalhos]');
        if (lista) lista.innerHTML = atalhos(es);
        ligarRegioes();
        const primeiro = es.filter(e => e.dif != null)
          .sort((a, b2) => Math.abs(b2.dif) - Math.abs(a.dif))[0];
        if (painel) painel.innerHTML = primeiro ? detalhe(primeiro, d) : vazio();
      }));
  },
};

function estados(vista, d) {
  return estadosDasRegioes(vista, d.primeira, d.atual, d.objetivo, { num, tomDaVariacao });
}

/** Chips das regiões medidas — a mesma seleção da silhueta, por nome. */
function atalhos(es) {
  const medidas = es.filter(e => e.temDado);
  if (!medidas.length) return '';
  // "Dobra da coxa" vira "Coxa (dobra)": o nome cabe no chip e continua dizendo
  // que é dobra, e não perimetria — as duas existem para a mesma região.
  const curto = (e) => e.dobra
    ? e.rotulo.replace(/^Dobra (da |do )?/, '').replace(/^./, c => c.toUpperCase()) + ' (dobra)'
    : e.rotulo;
  return medidas.map(e => `
    <button class="ap-atalho tom-${esc(e.tom)}" data-regiao-nome="${esc(e.id)}">
      ${esc(curto(e))}
      ${e.dif != null && Math.abs(e.dif) >= 0.05
        ? `<b>${e.dif > 0 ? '+' : '−'}${fmt(Math.abs(e.dif))}</b>` : ''}
    </button>`).join('');
}

/** Painel lateral: anterior → atual, diferença e a leitura. */
function detalhe(e, d) {
  const un = e.unidade;
  const dif = e.dif;
  const temDif = dif != null && Math.abs(dif) >= 0.05;

  return `
    <div class="ap-det tom-${esc(e.tom)}">
      <span class="ap-det-lab">${esc(e.rotulo)}</span>

      <div class="ap-det-valores">
        ${e.de != null ? `
          <div class="ap-det-ponta">
            <span class="ap-det-quando">Avaliação ${d.primeira?.numero ?? 1}</span>
            <span class="ap-det-num">${fmt(e.de)}<small>${esc(un)}</small></span>
          </div>
          <div class="ap-det-seta" aria-hidden="true"><i data-lucide="arrow-down"></i></div>` : ''}
        <div class="ap-det-ponta ap-det-agora">
          <span class="ap-det-quando">Avaliação ${d.atual?.numero ?? ''}</span>
          <span class="ap-det-num">${e.para != null ? fmt(e.para) : '—'}<small>${esc(un)}</small></span>
        </div>
      </div>

      ${temDif ? `
        <div class="ap-det-dif">${dif > 0 ? '+' : '−'}${fmt(Math.abs(dif))} ${esc(un)}</div>
        <p class="ap-det-leitura">${esc(leitura(e, d))}</p>` : `
        <p class="ap-det-leitura">${e.de == null ? 'Primeira medida desta região.' : 'Sem mudança relevante.'}</p>`}
    </div>`;
}

/**
 * Frase de leitura — por regra, nunca gerada. Sem objetivo declarado no plano,
 * descreve a direção em vez de julgá-la.
 */
function leitura(e, d) {
  const desceu = e.dif < 0;
  const oQue = e.dobra ? 'A dobra' : 'A medida';
  if (!d.objetivo) return `${oQue} ${desceu ? 'diminuiu' : 'aumentou'} desde a primeira avaliação.`;
  if (e.tom === 'bom')     return `Excelente evolução — ${oQue.toLowerCase()} caminhou na direção do seu objetivo.`;
  if (e.tom === 'atencao') return `Ponto de atenção: ${oQue.toLowerCase()} foi na direção oposta ao objetivo.`;
  return `${oQue} ${desceu ? 'diminuiu' : 'aumentou'} desde a primeira avaliação.`;
}

function vazio() {
  return `<div class="ap-det ap-det-vazio"><p class="ap-det-leitura">Toque em uma região do corpo para ver a evolução dela.</p></div>`;
}
