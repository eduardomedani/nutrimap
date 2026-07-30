// ═══════════════════════════════════════════════════════════
// EVOLUÇÃO — gráficos, comparação de avaliações e metas
// ═══════════════════════════════════════════════════════════
// Tudo desenhado com o que as avaliações já registram.
//
// O catálogo de séries, o desenho do gráfico e a regra de "melhorou/piorou"
// moram em evolucao-core.js — compartilhados com o Modo Apresentação, para que
// as duas telas não discordem sobre o que é uma boa notícia.

import { carregarResumo, invalidarResumo } from './paciente-resumo.js';
import { listarMetas, criarMeta, atualizarMeta, excluirMeta, situacaoDaMeta, estimativa, TIPOS_META, STATUS_META } from './paciente-metas.js';
import { mostrarToast, mostrarErro, confirmar } from './utils.js';
import {
  SERIES, SERIES_ABA, PERIODOS, COMPARAR,
  pontosDaSerie, marcosDePlano, svgLinha, interpretar, objetivoDirigido,
  esc, num, fmt, fmtData,
} from './evolucao-core.js';

let _cont = null;
let _paciente = null;
let _resumo = null;
let _metas = [];
let _serie = 'peso';
let _periodo = 180;      // dias; 0 = todo o período
let _cmpDe = null;
let _cmpPara = null;

export async function initEvolucao({ cont, paciente, irParaAba }) {
  _cont = cont; _paciente = paciente; _metas = [];
  cont.innerHTML = `<div class="ev-sk"><div class="sk sk-bloco"></div><div class="sk sk-bloco"></div></div>`;

  try {
    _resumo = await carregarResumo(paciente);
    _metas = await listarMetas(paciente.id).catch(() => []);
  } catch (e) {
    console.error('[evolucao]', e);
    cont.innerHTML = `<div class="tl-estado">
        <div class="tl-estado-t">Não foi possível carregar a evolução.</div>
        <button class="btn-sm" data-ev-retry>Tentar novamente</button></div>`;
    cont.querySelector('[data-ev-retry]')?.addEventListener('click', () => initEvolucao({ cont, paciente, irParaAba }));
    return;
  }

  if (!_resumo.avaliacoes.length) {
    cont.innerHTML = `
      <div class="tl-estado">
        <div class="tl-estado-ic"><i data-lucide="trending-up"></i></div>
        <div class="tl-estado-t">Este paciente ainda não possui avaliações.</div>
        <div class="tl-estado-s">Registre a primeira avaliação para acompanhar a evolução.</div>
        <button class="btn primary" data-ev-nova><i data-lucide="plus"></i> Nova avaliação</button>
      </div>`;
    cont.querySelector('[data-ev-nova]')?.addEventListener('click', () => irParaAba?.('avaliacoes'));
    return;
  }

  // Padrão da comparação: primeira contra a última.
  const avs = _resumo.avaliacoes;
  _cmpDe = _cmpDe && avs.some(a => a.id === _cmpDe) ? _cmpDe : avs[0].id;
  _cmpPara = _cmpPara && avs.some(a => a.id === _cmpPara) ? _cmpPara : avs[avs.length - 1].id;

  render();
}

function render() {
  _cont.innerHTML = `
    ${graficoSecaoHtml()}
    ${comparacaoSecaoHtml()}
    ${metasSecaoHtml()}`;
  ligar();
  desenharGrafico();
  ligarResize();
}

// ───────────────────────────────────────────────────────────
// 1 · GRÁFICO
// ───────────────────────────────────────────────────────────
function graficoSecaoHtml() {
  const s = SERIES[_serie];
  const pontos = pontosDaSerie(_resumo.avaliacoes, _serie, _periodo);
  const metaSerie = s.meta ? _metas.find(m => m.tipo === s.meta && m.status !== 'cancelada') : null;

  return `
    <section class="pv-bloco">
      <div class="pv-sec-head">
        <h3 class="pv-sec-tit">Evolução</h3>
        <div class="ev-periodos">
          ${PERIODOS.map(p => `
            <button class="ev-periodo ${p.id === _periodo ? 'ativo' : ''}" data-ev-periodo="${p.id}">${p.label}</button>`).join('')}
        </div>
      </div>
      <div class="ev-series">
        ${SERIES_ABA.map(id => {
          const temDado = pontosDaSerie(_resumo.avaliacoes, id, 0).length > 0;
          if (!temDado) return '';   // série sem nenhuma medida não vira botão morto
          return `<button class="ev-serie ${id === _serie ? 'ativa' : ''}" data-ev-serie="${id}">${SERIES[id].label}</button>`;
        }).join('')}
      </div>
      ${pontos.length >= 2
        ? `<div class="ev-grafico" data-ev-canvas></div>${legendaHtml(pontos, s, metaSerie)}`
        : `<div class="ev-vazio">${pontos.length === 1
            ? 'Só há uma medida deste indicador — o gráfico aparece a partir da segunda avaliação.'
            : 'Nenhuma medida deste indicador no período escolhido.'}</div>`}
    </section>`;
}

/**
 * Desenha o SVG na largura REAL do container. Com viewBox esticado, o texto
 * dos eixos escalaria junto e ficaria fora da tipografia do sistema.
 */
function desenharGrafico() {
  const box = _cont?.querySelector('[data-ev-canvas]');
  if (!box) return;
  const s = SERIES[_serie];
  const pontos = pontosDaSerie(_resumo.avaliacoes, _serie, _periodo);
  if (pontos.length < 2) return;
  const metaSerie = s.meta ? _metas.find(m => m.tipo === s.meta && m.status !== 'cancelada') : null;
  const largura = Math.max(320, Math.round(box.clientWidth || 640));
  box.innerHTML = svgLinha(pontos, {
    unidade: s.unidade,
    meta: metaSerie ? Number(metaSerie.valor_alvo) : null,
    marcos: marcosDePlano(_resumo.planos, _periodo),
    largura,
    rotulo: s.label,
  });
}

// Redesenha ao redimensionar; para sozinho quando a aba sai do DOM.
let _resizeLigado = false;
function ligarResize() {
  if (_resizeLigado) return;
  _resizeLigado = true;
  let t = null;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!_cont || !document.body.contains(_cont)) return;
      desenharGrafico();
    }, 160);
  });
}

function legendaHtml(pontos, s, meta) {
  const p0 = pontos[0], p1 = pontos[pontos.length - 1];
  const dif = p1.valor - p0.valor;
  const pct = p0.valor ? (dif / p0.valor) * 100 : null;
  return `
    <div class="ev-legenda">
      <span><b>${fmt(p1.valor)}${s.unidade}</b> agora</span>
      <span class="tl-sep">·</span>
      <span>${dif > 0 ? '+' : ''}${fmt(dif)}${s.unidade}${pct != null ? ` (${dif > 0 ? '+' : ''}${fmt(pct)}%)` : ''} no período</span>
      <span class="tl-sep">·</span>
      <span>${pontos.length} medidas</span>
      ${meta ? `<span class="tl-sep">·</span><span>meta: ${fmt(Number(meta.valor_alvo))}${s.unidade}</span>` : ''}
    </div>`;
}

// ───────────────────────────────────────────────────────────
// 2 · COMPARAÇÃO ENTRE AVALIAÇÕES
// ───────────────────────────────────────────────────────────
function comparacaoSecaoHtml() {
  const avs = _resumo.avaliacoes;
  if (avs.length < 2) {
    return `
      <section class="pv-bloco">
        <div class="pv-sec-head"><h3 class="pv-sec-tit">Comparação entre avaliações</h3></div>
        <div class="ev-vazio">A comparação aparece a partir da segunda avaliação.</div>
      </section>`;
  }
  const de = avs.find(a => a.id === _cmpDe) || avs[0];
  const para = avs.find(a => a.id === _cmpPara) || avs[avs.length - 1];
  const objetivo = _resumo.metricas.objetivo;

  const opt = (a, sel) => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>AV ${a.numero} · ${fmtData(a.data_avaliacao)}</option>`;

  const linhas = COMPARAR.map(c => {
    const v1 = num(de[c.campo]), v2 = num(para[c.campo]);
    if (v1 == null && v2 == null) return '';        // indicador nunca medido: fora
    const a = v1 != null ? v1 * c.escala : null;
    const b = v2 != null ? v2 * c.escala : null;
    const dif = (a != null && b != null) ? b - a : null;
    const pct = (dif != null && a) ? (dif / a) * 100 : null;
    const leitura = interpretar(c.campo, dif, objetivo);
    const seta = dif == null || Math.abs(dif) < 0.05 ? '→' : (dif > 0 ? '↑' : '↓');
    return `
      <tr class="${leitura.tom ? 'tom-' + leitura.tom : ''}">
        <th scope="row">${esc(c.label)}</th>
        <td>${a != null ? fmt(a) + c.unidade : '—'}</td>
        <td>${b != null ? fmt(b) + c.unidade : '—'}</td>
        <td class="ev-dif">${dif != null ? `${seta} ${dif > 0 ? '+' : ''}${fmt(dif)}${c.unidade}` : '—'}</td>
        <td class="ev-pct">${pct != null ? `${pct > 0 ? '+' : ''}${fmt(pct)}%` : '—'}</td>
      </tr>`;
  }).join('');

  return `
    <section class="pv-bloco">
      <div class="pv-sec-head">
        <h3 class="pv-sec-tit">Comparação entre avaliações</h3>
        <div class="ev-cmp-sel">
          <label class="sr-only" for="evCmpDe">Avaliação inicial</label>
          <select id="evCmpDe" class="np-input">${avs.map(a => opt(a, de.id)).join('')}</select>
          <span aria-hidden="true">→</span>
          <label class="sr-only" for="evCmpPara">Avaliação atual</label>
          <select id="evCmpPara" class="np-input">${avs.map(a => opt(a, para.id)).join('')}</select>
        </div>
      </div>
      <div class="ev-tabela-wrap">
        <table class="ev-tabela">
          <thead><tr><th scope="col">Indicador</th><th scope="col">AV ${de.numero}</th><th scope="col">AV ${para.numero}</th><th scope="col">Diferença</th><th scope="col">%</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
      <p class="ev-nota">${objetivoDirigido(objetivo)
        ? `Leitura orientada pelo objetivo do plano ativo (${esc(objetivo)}). Não é diagnóstico.`
        : objetivo
          ? `O objetivo do plano ativo (${esc(objetivo)}) não aponta uma direção para os indicadores: as mudanças aparecem sem julgamento de valor.`
          : 'Sem objetivo definido no plano ativo: as mudanças aparecem sem julgamento de valor.'}</p>
    </section>`;
}

// ───────────────────────────────────────────────────────────
// 3 · METAS
// ───────────────────────────────────────────────────────────
function metasSecaoHtml() {
  const ativas = _metas.filter(m => m.status !== 'cancelada');
  return `
    <section class="pv-bloco">
      <div class="pv-sec-head">
        <h3 class="pv-sec-tit">Metas</h3>
        <button class="btn-sm" data-meta-nova><i data-lucide="plus"></i> Nova meta</button>
      </div>
      ${ativas.length ? `<div class="ev-metas">${ativas.map(metaHtml).join('')}</div>` : `
        <div class="ev-vazio">
          Nenhuma meta definida. Registre uma meta para acompanhar o progresso do paciente.
        </div>`}
    </section>`;
}

function metaHtml(m) {
  const s = situacaoDaMeta(m, _resumo.metricas);
  const cfg = TIPOS_META[m.tipo] || {};
  const est = s.status === 'em_andamento' ? estimativa(m, _resumo.avaliacoes, _resumo.metricas) : null;

  return `
    <div class="ev-meta tom-${s.tom}">
      <div class="ev-meta-topo">
        <span class="ev-meta-tit">${esc(m.titulo || cfg.label || m.tipo)}</span>
        <span class="ev-meta-status tom-${s.tom}">${esc(s.statusLabel)}</span>
        <div class="ev-meta-acoes">
          <button class="tl-link" data-meta-editar="${m.id}">Editar</button>
          <button class="tl-link tl-link-perigo" data-meta-excluir="${m.id}">Excluir</button>
        </div>
      </div>
      <div class="ev-meta-nums">
        <span>Inicial <b>${s.inicial != null ? fmt(s.inicial) + s.unidade : '—'}</b></span>
        <span>Atual <b>${s.atual != null ? fmt(s.atual) + s.unidade : (s.medida ? 'Não registrado' : 'Acompanhada manualmente')}</b></span>
        <span>Meta <b>${s.alvo != null ? fmt(s.alvo) + s.unidade : '—'}</b></span>
        ${m.prazo ? `<span>Prazo <b>${fmtData(m.prazo)}</b></span>` : ''}
      </div>
      ${s.progresso != null ? `
        <div class="ev-meta-bar"><span style="width:${Math.min(100, s.progresso)}%"></span></div>
        <div class="ev-meta-pe">
          <span>${s.progresso}% do caminho${s.restante != null && s.status !== 'atingida' ? ` · faltam ${fmt(Math.abs(s.restante))}${s.unidade}` : ''}</span>
          ${est ? `<span class="ev-meta-est" title="Projeção simples, não é promessa de resultado">${esc(est.texto)}</span>` : ''}
        </div>` : `
        <div class="ev-meta-pe"><span>${s.medida ? 'Sem medida atual para calcular o progresso.' : 'Progresso registrado manualmente.'}</span></div>`}
      ${m.observacoes ? `<p class="ev-meta-obs">${esc(m.observacoes)}</p>` : ''}
    </div>`;
}

// ───────────────────────────────────────────────────────────
function ligar() {
  _cont.querySelectorAll('[data-ev-periodo]').forEach(b =>
    b.addEventListener('click', () => { _periodo = Number(b.dataset.evPeriodo); render(); }));
  _cont.querySelectorAll('[data-ev-serie]').forEach(b =>
    b.addEventListener('click', () => { _serie = b.dataset.evSerie; render(); }));

  const de = _cont.querySelector('#evCmpDe'), para = _cont.querySelector('#evCmpPara');
  de?.addEventListener('change', () => { _cmpDe = de.value; render(); });
  para?.addEventListener('change', () => { _cmpPara = para.value; render(); });

  _cont.querySelector('[data-meta-nova]')?.addEventListener('click', () => abrirModalMeta());
  _cont.querySelectorAll('[data-meta-editar]').forEach(b =>
    b.addEventListener('click', () => abrirModalMeta(_metas.find(m => m.id === b.dataset.metaEditar))));
  _cont.querySelectorAll('[data-meta-excluir]').forEach(b =>
    b.addEventListener('click', () => removerMeta(b.dataset.metaExcluir)));
}

async function recarregarMetas() {
  _metas = await listarMetas(_paciente.id).catch(() => _metas);
  render();
}

async function removerMeta(id) {
  if (!(await confirmar({ titulo: 'Excluir meta', mensagem: 'Excluir esta meta do paciente?', textoOk: 'Excluir', perigo: true }))) return;
  try { await excluirMeta(id); mostrarToast('Meta excluída'); await recarregarMetas(); }
  catch (e) { mostrarErro('Não foi possível excluir: ' + (e.message || e)); }
}

// ── Modal de meta ──────────────────────────────────────────
function abrirModalMeta(meta = null) {
  const editando = !!meta;
  const m = _resumo.metricas;
  const fundo = document.createElement('div');
  fundo.className = 'tl-modal-fundo';
  fundo.innerHTML = `
    <div class="tl-modal" role="dialog" aria-modal="true" aria-labelledby="evMetaTit">
      <div class="tl-modal-head">
        <h3 id="evMetaTit">${editando ? 'Editar meta' : 'Nova meta'}</h3>
        <button class="tl-modal-x" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
      </div>
      <div class="tl-modal-body">
        <div class="tl-campo-linha">
          <label class="tl-campo"><span>Tipo</span>
            <select id="mtTipo" class="np-input" ${editando ? 'disabled' : ''}>
              ${Object.entries(TIPOS_META).map(([id, c]) =>
                `<option value="${id}" ${meta?.tipo === id ? 'selected' : ''}>${c.label}</option>`).join('')}
            </select></label>
          <label class="tl-campo"><span>Status</span>
            <select id="mtStatus" class="np-input">
              ${Object.entries(STATUS_META).map(([id, l]) =>
                `<option value="${id}" ${(meta?.status || 'em_andamento') === id ? 'selected' : ''}>${l}</option>`).join('')}
            </select></label>
        </div>
        <label class="tl-campo" id="mtTituloWrap" ${meta?.tipo === 'habito' ? '' : 'hidden'}>
          <span>Título do hábito</span>
          <input type="text" id="mtTitulo" class="np-input" maxlength="80" value="${esc(meta?.titulo || '')}"
                 placeholder="Ex.: 2 porções de vegetais no almoço"></label>
        <div class="tl-campo-linha">
          <label class="tl-campo"><span>Valor inicial</span>
            <input type="number" step="0.1" id="mtIni" class="np-input" value="${meta?.valor_inicial ?? ''}"></label>
          <label class="tl-campo"><span>Meta</span>
            <input type="number" step="0.1" id="mtAlvo" class="np-input" value="${meta?.valor_alvo ?? ''}"></label>
          <label class="tl-campo"><span>Prazo</span>
            <input type="date" id="mtPrazo" class="np-input" value="${meta?.prazo || ''}"></label>
        </div>
        <label class="tl-campo"><span>Observações</span>
          <textarea id="mtObs" class="np-input" rows="2">${esc(meta?.observacoes || '')}</textarea></label>
        <p class="ev-nota" id="mtDica"></p>
        <div class="tl-modal-erro" data-erro role="alert"></div>
      </div>
      <div class="tl-modal-foot">
        <button class="btn" data-fechar>Cancelar</button>
        <button class="btn primary" data-salvar>${editando ? 'Salvar alterações' : 'Criar meta'}</button>
      </div>
    </div>`;
  document.body.appendChild(fundo);

  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', onEsc); };
  const onEsc = (e) => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', onEsc);
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  fundo.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', fechar));

  const tipoEl = fundo.querySelector('#mtTipo');
  const dica = fundo.querySelector('#mtDica');
  const sincronizar = () => {
    const t = tipoEl.value;
    fundo.querySelector('#mtTituloWrap').hidden = (t !== 'habito');
    const cfg = TIPOS_META[t];
    const atual = cfg.campo ? m[cfg.campo] : null;
    dica.textContent = cfg.campo
      ? (atual != null
          ? `Valor atual medido: ${fmt(atual)} ${cfg.unidade}. O progresso é calculado com as avaliações.`
          : 'Sem medida atual nas avaliações — o progresso aparece depois da próxima avaliação.')
      : 'Este tipo é acompanhado manualmente por enquanto (vira automático com os check-ins).';
    // Sugere o valor inicial a partir da medida atual, sem sobrescrever o que já existe.
    const ini = fundo.querySelector('#mtIni');
    if (!editando && !ini.value && atual != null) ini.value = atual;
  };
  tipoEl.addEventListener('change', sincronizar);
  sincronizar();

  fundo.querySelector('[data-salvar]').addEventListener('click', async () => {
    const erro = fundo.querySelector('[data-erro]');
    const tipo = tipoEl.value;
    const alvo = fundo.querySelector('#mtAlvo').value;
    const titulo = fundo.querySelector('#mtTitulo').value.trim();
    if (tipo === 'habito' && !titulo) { erro.textContent = 'Descreva o hábito.'; return; }
    if (tipo !== 'habito' && alvo === '') { erro.textContent = 'Informe o valor da meta.'; return; }
    erro.textContent = '';

    const dados = {
      tipo,
      titulo: tipo === 'habito' ? titulo : (titulo || null),
      valor_inicial: fundo.querySelector('#mtIni').value || null,
      valor_alvo: alvo || null,
      unidade: TIPOS_META[tipo]?.unidade || null,
      prazo: fundo.querySelector('#mtPrazo').value || null,
      status: fundo.querySelector('#mtStatus').value,
      observacoes: fundo.querySelector('#mtObs').value.trim() || null,
    };

    const btn = fundo.querySelector('[data-salvar]');
    btn.disabled = true; btn.textContent = 'Salvando...';
    try {
      if (editando) await atualizarMeta(meta.id, dados);
      else await criarMeta(_paciente.id, dados);
      fechar();
      mostrarToast(editando ? '✓ Meta atualizada' : '✓ Meta criada');
      invalidarResumo(_paciente.id);
      await recarregarMetas();
    } catch (e) {
      btn.disabled = false; btn.textContent = editando ? 'Salvar alterações' : 'Criar meta';
      erro.textContent = 'Não foi possível salvar: ' + (e.message || e);
    }
  });
}

