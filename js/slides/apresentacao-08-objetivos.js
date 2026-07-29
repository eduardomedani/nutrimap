// SLIDE 8 — Próximos objetivos
// Fecha o ciclo: onde o paciente quer chegar, quanto falta e o que ele leva
// para casa. As "próximas ações" são digitadas pelo profissional na hora —
// não há sugestão automática, porque conduta é decisão clínica.

import { esc, fmt, fmtData } from '../evolucao-core.js';

export default {
  id: 'objetivos',
  titulo: 'Próximos objetivos',

  // Sem meta cadastrada, o slide ainda vale: é onde as ações são escritas.
  disponivel(d) { return !!d.atual; },

  html(d) {
    const metas = d.metasVivas.map(({ meta, cfg, situacao, previsao }) => {
      const un = situacao.unidade || cfg.unidade || '';
      const pct = situacao.progresso;
      const alvo = situacao.alvo != null ? `${fmt(situacao.alvo, cfg.casas ?? 1)}${un}` : '—';
      const atual = situacao.atual != null ? `${fmt(situacao.atual, cfg.casas ?? 1)}${un}` : null;

      return `
        <article class="ap-meta">
          <header class="ap-meta-topo">
            <span class="ap-meta-nome">${esc(meta.titulo || cfg.label || 'Meta')}</span>
            <span class="ap-meta-status tom-${esc(situacao.tom)}">${esc(situacao.statusLabel)}</span>
          </header>

          <div class="ap-meta-alvo">
            ${atual ? `<span class="ap-meta-atual">${esc(atual)}</span>
                       <span class="ap-meta-seta" aria-hidden="true">→</span>` : ''}
            <span class="ap-meta-valor">${esc(alvo)}</span>
          </div>

          ${pct != null ? `
            <div class="ap-barra" role="progressbar" aria-valuemin="0" aria-valuemax="100"
                 aria-valuenow="${pct}" aria-label="Progresso de ${esc(meta.titulo || cfg.label || 'meta')}">
              <span class="ap-barra-fill" data-cresce="${pct}"></span>
            </div>
            <div class="ap-meta-pct"><b>${pct}%</b> do caminho</div>` : ''}

          ${previsao ? `<div class="ap-meta-prev"><i data-lucide="calendar-clock"></i> Previsão: ${esc(fmtData(previsao.data))} (${previsao.dias} dias no ritmo atual)</div>` : ''}
          ${meta.prazo && !previsao ? `<div class="ap-meta-prev"><i data-lucide="calendar"></i> Prazo: ${esc(fmtData(meta.prazo))}</div>` : ''}
        </article>`;
    }).join('');

    return `
      <div class="ap-centro">
        <h2 class="ap-secao-tit">Para onde vamos agora</h2>

        ${metas ? `<div class="ap-metas">${metas}</div>` : ''}

        <div class="ap-acoes-bloco">
          <label class="ap-acoes-lab" for="apAcoes">Próximas ações</label>
          <textarea id="apAcoes" class="ap-acoes" rows="4" spellcheck="true"
            placeholder="Ex.: continuar musculação 4x/semana · aumentar ingestão proteica · reduzir refeições livres"></textarea>
          <p class="ap-acoes-dica">O que for escrito aqui entra no resumo da consulta.</p>
        </div>
      </div>`;
  },

  ligar(el, d, api) {
    const campo = el.querySelector('#apAcoes');
    if (!campo) return;
    campo.value = api.sessao.acoes || '';
    campo.addEventListener('input', () => { api.sessao.acoes = campo.value; });
  },

  aoEntrar(el) { crescerBarras(el); },
};

/** Barras saem de 0 e crescem até o valor — 260 ms, sem exagero. */
export function crescerBarras(el) {
  const reduzido = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  el.querySelectorAll('[data-cresce]').forEach(b => {
    const pct = Math.max(0, Math.min(100, Number(b.dataset.cresce) || 0));
    if (reduzido) { b.style.width = pct + '%'; return; }
    b.style.width = '0%';
    requestAnimationFrame(() => { b.style.width = pct + '%'; });
  });
}
