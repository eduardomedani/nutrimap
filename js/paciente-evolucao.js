// ═══════════════════════════════════════════════════════════
// EVOLUÇÃO — gráficos, comparação de avaliações e metas
// ═══════════════════════════════════════════════════════════
// Tudo desenhado com o que as avaliações já registram. Sem biblioteca de
// gráficos: SVG inline, uma série por vez (misturar kg e % no mesmo eixo
// mente sobre a escala).
//
// A leitura de "melhorou/piorou" respeita o OBJETIVO do plano ativo: perder
// massa magra não é vitória em emagrecimento, e perder peso não é vitória em
// hipertrofia. Sem objetivo declarado, mostra a direção sem julgar.

import { carregarResumo, invalidarResumo } from './paciente-resumo.js';
import { listarMetas, criarMeta, atualizarMeta, excluirMeta, situacaoDaMeta, estimativa, TIPOS_META, STATUS_META } from './paciente-metas.js';
import { mostrarToast, mostrarErro, confirmar } from './utils.js';

let _cont = null;
let _paciente = null;
let _resumo = null;
let _metas = [];
let _serie = 'peso';
let _periodo = 180;      // dias; 0 = todo o período
let _cmpDe = null;
let _cmpPara = null;

// Séries do gráfico: campo na avaliação, escala e unidade.
const SERIES = {
  peso:        { label: 'Peso',          campo: 'peso',        unidade: 'kg', escala: 1,   meta: 'peso' },
  gordura:     { label: '% de gordura',  campo: 'pct_gordura', unidade: '%',  escala: 100, meta: 'gordura' },
  massa_magra: { label: 'Massa magra',   campo: 'peso_magro',  unidade: 'kg', escala: 1,   meta: 'massa_magra' },
  cintura:     { label: 'Cintura',       campo: 'per_cintura', unidade: 'cm', escala: 1,   meta: 'cintura' },
  imc:         { label: 'IMC',           campo: 'imc',         unidade: '',   escala: 1,   meta: null },
};

const PERIODOS = [
  { id: 30,  label: '30 dias' },
  { id: 90,  label: '90 dias' },
  { id: 180, label: '6 meses' },
  { id: 365, label: '1 ano' },
  { id: 0,   label: 'Tudo' },
];

// Indicadores da comparação, na ordem clínica de leitura.
const COMPARAR = [
  { campo: 'peso',                     label: 'Peso',            unidade: 'kg', escala: 1 },
  { campo: 'imc',                      label: 'IMC',             unidade: '',   escala: 1 },
  { campo: 'pct_gordura',              label: '% de gordura',    unidade: '%',  escala: 100 },
  { campo: 'peso_gordura',             label: 'Massa gorda',     unidade: 'kg', escala: 1 },
  { campo: 'peso_magro',               label: 'Massa magra',     unidade: 'kg', escala: 1 },
  { campo: 'per_cintura',              label: 'Cintura',         unidade: 'cm', escala: 1 },
  { campo: 'per_abdomen',              label: 'Abdômen',         unidade: 'cm', escala: 1 },
  { campo: 'per_quadril',              label: 'Quadril',         unidade: 'cm', escala: 1 },
  { campo: 'per_braco_direito',        label: 'Braço D',         unidade: 'cm', escala: 1 },
  { campo: 'per_coxa_direita',         label: 'Coxa D',          unidade: 'cm', escala: 1 },
  { campo: 'per_panturrilha_direita',  label: 'Panturrilha D',   unidade: 'cm', escala: 1 },
];

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
  const pontos = pontosDaSerie(_serie, _periodo);
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
        ${Object.entries(SERIES).map(([id, cfg]) => {
          const temDado = pontosDaSerie(id, 0).length > 0;
          if (!temDado) return '';   // série sem nenhuma medida não vira botão morto
          return `<button class="ev-serie ${id === _serie ? 'ativa' : ''}" data-ev-serie="${id}">${cfg.label}</button>`;
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
  const pontos = pontosDaSerie(_serie, _periodo);
  if (pontos.length < 2) return;
  const metaSerie = s.meta ? _metas.find(m => m.tipo === s.meta && m.status !== 'cancelada') : null;
  const largura = Math.max(320, Math.round(box.clientWidth || 640));
  box.innerHTML = svgLinha(pontos, {
    unidade: s.unidade,
    meta: metaSerie ? Number(metaSerie.valor_alvo) : null,
    marcos: marcosDePlano(_periodo),
    largura,
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

function pontosDaSerie(serieId, periodoDias) {
  const cfg = SERIES[serieId];
  const limite = periodoDias ? Date.now() - periodoDias * 86400000 : null;
  return _resumo.avaliacoes
    .filter(a => a.data_avaliacao && num(a[cfg.campo]) != null)
    .map(a => ({ data: new Date(`${a.data_avaliacao}T12:00:00`), valor: num(a[cfg.campo]) * cfg.escala, av: a }))
    .filter(p => !limite || p.data.getTime() >= limite)
    .sort((a, b) => a.data - b.data);
}

/** Início dos planos alimentares no período — marca no gráfico. */
function marcosDePlano(periodoDias) {
  const limite = periodoDias ? Date.now() - periodoDias * 86400000 : null;
  return (_resumo.planos || [])
    .map(p => ({ data: new Date(p.data_inicio ? `${p.data_inicio}T12:00:00` : p.criado_em), nome: p.nome }))
    .filter(m => !isNaN(m.data.getTime()) && (!limite || m.data.getTime() >= limite));
}

/** Gráfico de linha em SVG. Sem dependência, sem enfeite. */
function svgLinha(pontos, { unidade, meta, marcos = [], largura = 640 }) {
  const W = largura, H = 210, ml = 46, mr = 16, mt = 16, mb = 28;
  const vals = pontos.map(p => p.valor);
  if (meta != null) vals.push(meta);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const folga = (max - min) * 0.12;
  min -= folga; max += folga;

  // O eixo vai até HOJE, não até a última medida: assim o intervalo sem
  // avaliação fica visível (a linha simplesmente para no meio) e as mudanças
  // de plano recentes cabem no gráfico.
  const t0 = pontos[0].data.getTime();
  const t1 = Math.max(pontos[pontos.length - 1].data.getTime(), Date.now());
  const x = (d) => ml + (t1 === t0 ? 0.5 : (Math.min(Math.max(d.getTime(), t0), t1) - t0) / (t1 - t0)) * (W - ml - mr);
  const y = (v) => mt + (1 - (v - min) / (max - min)) * (H - mt - mb);

  const linha = pontos.map((p, i) => `${i ? 'L' : 'M'}${x(p.data).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' ');
  const area = `${linha} L${x(pontos[pontos.length - 1].data).toFixed(1)},${H - mb} L${x(pontos[0].data).toFixed(1)},${H - mb} Z`;

  const marcasY = [max - folga, (min + max) / 2, min + folga].map(v => `
    <line x1="${ml}" y1="${y(v).toFixed(1)}" x2="${W - mr}" y2="${y(v).toFixed(1)}" class="ev-grade"/>
    <text x="${ml - 7}" y="${(y(v) + 3.5).toFixed(1)}" class="ev-eixo" text-anchor="end">${fmt(v)}</text>`).join('');

  const linhaMeta = meta != null ? `
    <line x1="${ml}" y1="${y(meta).toFixed(1)}" x2="${W - mr}" y2="${y(meta).toFixed(1)}" class="ev-meta-linha"/>
    <text x="${W - mr}" y="${(y(meta) - 6).toFixed(1)}" class="ev-meta-txt" text-anchor="end">meta ${fmt(meta)}${unidade}</text>` : '';

  const linhasMarco = marcos.map(m => {
    const px = x(m.data);
    if (px < ml || px > W - mr) return '';
    return `<line x1="${px.toFixed(1)}" y1="${mt}" x2="${px.toFixed(1)}" y2="${H - mb}" class="ev-marco">
              <title>Plano: ${esc(m.nome || 'sem nome')} · ${m.data.toLocaleDateString('pt-BR')}</title></line>`;
  }).join('');

  const bolinhas = pontos.map(p => `
    <circle cx="${x(p.data).toFixed(1)}" cy="${y(p.valor).toFixed(1)}" r="3.5" class="ev-ponto">
      <title>${p.data.toLocaleDateString('pt-BR')} · ${fmt(p.valor)}${unidade}${p.av?.numero ? ` (AV ${p.av.numero})` : ''}</title>
    </circle>`).join('');

  const datas = `
    <text x="${ml}" y="${H - 8}" class="ev-eixo">${pontos[0].data.toLocaleDateString('pt-BR')}</text>
    <text x="${W - mr}" y="${H - 8}" class="ev-eixo" text-anchor="end">${new Date(t1).toLocaleDateString('pt-BR')}</text>`;

  return `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="ev-svg" role="img"
         aria-label="Evolução de ${esc(SERIES[_serie].label)} em ${pontos.length} medidas">
      ${marcasY}${linhasMarco}
      <path d="${area}" class="ev-area"/>
      <path d="${linha}" class="ev-linha"/>
      ${linhaMeta}${bolinhas}${datas}
    </svg>`;
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
      <p class="ev-nota">${objetivo
        ? `Leitura orientada pelo objetivo do plano ativo (${esc(objetivo)}). Não é diagnóstico.`
        : 'Sem objetivo definido no plano ativo: as mudanças aparecem sem julgamento de valor.'}</p>
    </section>`;
}

/**
 * Uma queda não é boa por si só: depende do objetivo.
 * Sem objetivo declarado, devolve tom neutro.
 */
function interpretar(campo, dif, objetivo) {
  if (dif == null || Math.abs(dif) < 0.05 || !objetivo) return { tom: '' };
  const o = objetivo.toLowerCase();
  const emagrecer = /emagre|perda|redu|gordura|definic/.test(o);
  const ganhar = /hipertrof|ganho|massa|volume/.test(o);
  if (!emagrecer && !ganhar) return { tom: '' };

  const desce = dif < 0;
  if (campo === 'peso_magro') return { tom: desce ? 'atencao' : 'bom' };
  if (campo === 'pct_gordura' || campo === 'peso_gordura') return { tom: desce ? 'bom' : 'atencao' };
  if (campo.startsWith('per_')) {
    if (emagrecer) return { tom: desce ? 'bom' : 'atencao' };
    return { tom: '' };            // em hipertrofia, medida maior pode ser músculo
  }
  if (campo === 'peso' || campo === 'imc') {
    if (emagrecer) return { tom: desce ? 'bom' : 'atencao' };
    return { tom: desce ? 'atencao' : 'bom' };
  }
  return { tom: '' };
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

// ── Helpers ────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function fmt(v, casas = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
}
function fmtData(d) {
  if (!d) return '—';
  const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T12:00:00` : d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('pt-BR');
}
