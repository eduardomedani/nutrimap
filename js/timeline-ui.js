// ═══════════════════════════════════════════════════════════
// TIMELINE — UI (aba completa + lista recente do Painel 360°)
// ═══════════════════════════════════════════════════════════
// Duas entradas, um só renderizador de evento:
//   . initTimeline()          → aba "Timeline": filtros, paginação, registro manual
//   . montarTimelineRecente() → os últimos eventos, embutidos no Painel 360°
//
// Nada aqui tem `if` por tipo de evento: a aparência vem de timeline-config.js.

import {
  listarEventos, entidadesExistentes, criarRegistroManual,
  atualizarRegistroManual, excluirRegistroManual, LIMITE_PAGINA,
} from './timeline.js';
import { configDoTipo, FILTROS, MODULOS, CATEGORIAS_MANUAIS, modulosDoFiltro } from './timeline-config.js';
import { obterPerfilNutri } from './auth.js';
import { mostrarToast, mostrarErro, confirmar } from './utils.js';

// ── Estado da aba Timeline (uma por vez na tela) ───────────
let _paciente = null;
let _irParaAba = null;
let _filtro = 'todos';
let _cursor = null;
let _temMais = false;
let _eventos = [];
let _existentes = new Set();
let _raiz = null;              // container da aba completa

// O nome do profissional aparece em cada evento: buscado uma vez por sessão.
let _autor = 'Profissional';
let _autorPronto = null;
function garantirAutor() {
  if (!_autorPronto) {
    _autorPronto = obterPerfilNutri()
      .then(p => { _autor = (p?.nome || '').trim() || 'Profissional'; })
      .catch(() => { _autor = 'Profissional'; });
  }
  return _autorPronto;
}

// ═══════════════════════════════════════════════════════════
// ABA TIMELINE (completa)
// ═══════════════════════════════════════════════════════════
export async function initTimeline({ cont, paciente, irParaAba }) {
  _paciente = paciente;
  _irParaAba = typeof irParaAba === 'function' ? irParaAba : null;
  _filtro = 'todos'; _cursor = null; _temMais = false; _eventos = []; _existentes = new Set();
  _raiz = cont;

  cont.innerHTML = `
    <section class="pv-bloco">
      <div class="pv-sec-head">
        <h3 class="pv-sec-tit">Histórico do paciente</h3>
        <button class="btn-sm" data-tl-novo><i data-lucide="plus"></i> Adicionar registro</button>
      </div>
      <div class="tl-filtros" role="tablist" aria-label="Filtrar histórico">
        ${FILTROS.map(f => `
          <button class="tl-filtro ${f.id === 'todos' ? 'ativo' : ''}" data-tl-filtro="${f.id}"
                  role="tab" aria-selected="${f.id === 'todos'}">${f.label}</button>`).join('')}
      </div>
      <div class="tl-lista" data-tl-lista>${skeletonEventos()}</div>
    </section>`;

  garantirAutor();
  ligarBarra(cont);
  await carregarPagina(true);
}

function ligarBarra(cont) {
  cont.querySelector('[data-tl-novo]')?.addEventListener('click', () => abrirModalManual());
  cont.querySelectorAll('[data-tl-filtro]').forEach(b =>
    b.addEventListener('click', () => {
      if (_filtro === b.dataset.tlFiltro) return;
      _filtro = b.dataset.tlFiltro;
      cont.querySelectorAll('[data-tl-filtro]').forEach(x => {
        const on = x.dataset.tlFiltro === _filtro;
        x.classList.toggle('ativo', on);
        x.setAttribute('aria-selected', String(on));
      });
      listaEl().innerHTML = skeletonEventos();
      carregarPagina(true).catch(e => console.error('[timeline]', e));
    }));
}

const listaEl = () => (_raiz || document).querySelector('[data-tl-lista]');

async function carregarPagina(primeira = false) {
  const lista = listaEl();
  if (!lista) return;
  if (primeira) { _cursor = null; _eventos = []; }

  try {
    const r = await listarEventos(_paciente.id, {
      modulos: modulosDoFiltro(_filtro), cursor: _cursor, limite: LIMITE_PAGINA,
    });
    _cursor = r.proximoCursor;
    _temMais = r.temMais;
    _eventos = primeira ? r.eventos : _eventos.concat(r.eventos);

    (await entidadesExistentes(r.eventos)).forEach(k => _existentes.add(k));
    await garantirAutor();
    renderLista();
  } catch (e) {
    console.error('[timeline]', e);
    lista.innerHTML = `
      <div class="tl-estado">
        <div class="tl-estado-t">Não foi possível carregar o histórico.</div>
        <button class="btn-sm" data-tl-retry>Tentar novamente</button>
      </div>`;
    lista.querySelector('[data-tl-retry]')?.addEventListener('click', () => {
      lista.innerHTML = skeletonEventos();
      carregarPagina(true).catch(err => console.error('[timeline]', err));
    });
  }
}

function renderLista() {
  const lista = listaEl();
  if (!lista) return;

  if (!_eventos.length) {
    lista.innerHTML = _filtro === 'todos' ? vazioHtml() : vazioFiltroHtml();
    lista.querySelector('[data-tl-primeiro]')?.addEventListener('click', () => abrirModalManual());
    lista.querySelector('[data-tl-limpar]')?.addEventListener('click', () =>
      (_raiz || document).querySelector('[data-tl-filtro="todos"]')?.click());
    return;
  }

  lista.innerHTML = gruposHtml(_eventos)
    + (_temMais ? `<button class="tl-mais" data-tl-mais>Carregar eventos anteriores</button>` : '');

  lista.querySelector('[data-tl-mais]')?.addEventListener('click', (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Carregando...';
    carregarPagina(false).catch(err => console.error('[timeline]', err));
  });
  ligarEventos(lista);
}

/** Liga as ações de uma lista de eventos (serve para a aba e para a recente). */
function ligarEventos(lista) {
  lista.querySelectorAll('[data-ev-abrir]').forEach(b =>
    b.addEventListener('click', () => _irParaAba?.(b.dataset.evAbrir)));
  lista.querySelectorAll('[data-ev-editar]').forEach(b =>
    b.addEventListener('click', () => {
      const ev = _eventos.find(x => x.id === b.dataset.evEditar);
      if (ev) abrirModalManual(ev);
    }));
  lista.querySelectorAll('[data-ev-excluir]').forEach(b =>
    b.addEventListener('click', () => removerManual(b.dataset.evExcluir)));
}

// ═══════════════════════════════════════════════════════════
// TIMELINE RECENTE (dentro do Painel 360°)
// ═══════════════════════════════════════════════════════════
/**
 * Monta os últimos eventos em modo leitura. Sem filtros nem paginação —
 * a visão completa mora na aba Timeline.
 */
export async function montarTimelineRecente({ cont, paciente, limite = 5, irParaAba }) {
  if (!cont) return;
  _paciente = paciente;
  if (typeof irParaAba === 'function') _irParaAba = irParaAba;
  cont.innerHTML = skeletonEventos(2);
  try {
    const r = await listarEventos(paciente.id, { limite });
    (await entidadesExistentes(r.eventos)).forEach(k => _existentes.add(k));
    await garantirAutor();
    if (!r.eventos.length) {
      cont.innerHTML = `<div class="tl-estado tl-estado-mini">
          <div class="tl-estado-t">Nenhum evento registrado ainda.</div>
        </div>`;
      return;
    }
    cont.innerHTML = `<div class="tl-lista">${gruposHtml(r.eventos)}</div>`;
    ligarEventos(cont);
  } catch (e) {
    console.error('[timeline recente]', e);
    cont.innerHTML = `<div class="tl-estado tl-estado-mini">
        <div class="tl-estado-t">Não foi possível carregar o histórico.</div>
      </div>`;
  }
}

/** Abre o modal de registro manual de fora (ação rápida do Hub). */
export function abrirRegistroManual(paciente, aoSalvar) {
  _paciente = paciente;
  garantirAutor();
  abrirModalManual(null, aoSalvar);
}

// ═══════════════════════════════════════════════════════════
// RENDER DOS EVENTOS
// ═══════════════════════════════════════════════════════════
function gruposHtml(eventos) {
  const grupos = [];
  for (const ev of eventos) {
    const g = chaveGrupo(ev.data_evento);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.chave === g.chave) ultimo.itens.push(ev);
    else grupos.push({ chave: g.chave, label: g.label, itens: [ev] });
  }
  return grupos.map(g => `
    <div class="tl-grupo">
      <div class="tl-dia">${esc(g.label)}</div>
      <ul class="tl-itens">${g.itens.map(eventoHtml).join('')}</ul>
    </div>`).join('');
}

function eventoHtml(ev) {
  const cfg = configDoTipo(ev.tipo);
  const manual = ev.gerado_pelo_sistema === false;
  const cat = ev.metadata?.categoria;

  const temEntidade = ev.entidade_tipo && ev.entidade_id;
  const viva = !temEntidade || _existentes.has(`${ev.entidade_tipo}:${ev.entidade_id}`);
  const mostrarAcao = cfg.acao && viva;
  const dados = linhasDeMetadata(ev);

  return `
    <li class="tl-ev tom-${cfg.tom}${ev.importancia === 'alta' ? ' destaque' : ''}${manual ? ' manual' : ''}">
      <span class="tl-marco" aria-hidden="true"><i data-lucide="${cfg.icone}"></i></span>
      <div class="tl-corpo">
        <div class="tl-topo">
          <span class="tl-titulo">${esc(ev.titulo || cfg.label)}</span>
          ${manual ? `<span class="tl-tag">Registro manual</span>` : ''}
          ${cat ? `<span class="tl-tag tl-tag-cat">${esc(cat)}</span>` : ''}
          ${ev.metadata?.importado ? `<span class="tl-tag tl-tag-hist">Histórico inicial</span>` : ''}
        </div>
        ${ev.descricao ? `<p class="tl-desc">${esc(ev.descricao)}</p>` : ''}
        ${dados.length ? `<ul class="tl-dados">${dados.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
        <div class="tl-meta">
          <span>${esc(quandoLongo(ev.data_evento))}</span>
          <span class="tl-sep">·</span><span>${esc(_autor)}</span>
          <span class="tl-sep">·</span><span>${esc(MODULOS[ev.modulo] || ev.modulo)}</span>
          ${ev.editado_em ? `<span class="tl-sep">·</span><span class="tl-editado">editado em ${esc(quandoLongo(ev.editado_em))}</span>` : ''}
        </div>
        ${(mostrarAcao || manual) ? `
          <div class="tl-acoes">
            ${mostrarAcao ? `<button class="btn-sm btn-sm-secondary" data-ev-abrir="${esc(cfg.acao.aba)}">${esc(cfg.acao.label)}</button>` : ''}
            ${manual ? `<button class="tl-link" data-ev-editar="${ev.id}">Editar</button>
                        <button class="tl-link tl-link-perigo" data-ev-excluir="${ev.id}">Excluir</button>` : ''}
          </div>` : ''}
      </div>
    </li>`;
}

// Rótulos dos campos conhecidos de metadata. Chave desconhecida é ignorada.
const CAMPOS_META = {
  plan_name:             v => `Plano: ${v}`,
  calories:              v => `${fmtNum(v, 0)} kcal prescritas`,
  target_calories:       v => `meta de ${fmtNum(v, 0)} kcal`,
  meals:                 v => `${v} ${v === 1 ? 'refeição' : 'refeições'}`,
  protein:               v => `P ${fmtNum(v)} g`,
  carbohydrate:          v => `C ${fmtNum(v)} g`,
  fat:                   v => `G ${fmtNum(v)} g`,
  weight:                v => `Peso: ${fmtNum(v)} kg`,
  previous_weight:       v => `anterior: ${fmtNum(v)} kg`,
  weight_difference:     v => `variação: ${v > 0 ? '+' : ''}${fmtNum(v)} kg`,
  body_fat_percentage:   v => `gordura: ${fmtNum(v)}%`,
  imc:                   v => `IMC ${fmtNum(v)}`,
  workout_name:          v => `Treino: ${v}`,
  previous_workout_name: v => `anterior: ${v}`,
  weekly_sessions:       v => `${v} ${v === 1 ? 'dia' : 'dias'} por semana`,
  divisao:               v => `divisão ${v}`,
  objetivo:              v => `objetivo: ${v}`,
  campos:                v => `campos: ${Array.isArray(v) ? v.join(', ') : v}`,
};
const MAX_DADOS = 4;

function linhasDeMetadata(ev) {
  const m = ev.metadata || {};
  const out = [];
  for (const [k, fn] of Object.entries(CAMPOS_META)) {
    if (m[k] === undefined || m[k] === null || m[k] === '') continue;
    if ((k === 'plan_name' || k === 'workout_name') && (ev.descricao || '').includes(String(m[k]))) continue;
    out.push(fn(m[k]));
    if (out.length >= MAX_DADOS) break;
  }
  return out;
}

function skeletonEventos(n = 3) {
  const item = `
    <li class="tl-ev tl-sk"><span class="tl-marco"></span>
      <div class="tl-corpo"><div class="sk sk-tit"></div><div class="sk sk-txt"></div><div class="sk sk-meta"></div></div>
    </li>`;
  return `<div class="tl-grupo"><div class="sk sk-dia"></div><ul class="tl-itens">${item.repeat(n)}</ul></div>`;
}

function vazioHtml() {
  return `
    <div class="tl-estado">
      <div class="tl-estado-ic"><i data-lucide="history"></i></div>
      <div class="tl-estado-t">Este paciente ainda não possui histórico.</div>
      <div class="tl-estado-s">As principais movimentações do acompanhamento aparecerão aqui.</div>
      <button class="btn primary" data-tl-primeiro><i data-lucide="plus"></i> Adicionar primeiro registro</button>
    </div>`;
}
function vazioFiltroHtml() {
  return `
    <div class="tl-estado">
      <div class="tl-estado-t">Nenhum evento neste filtro.</div>
      <button class="btn-sm btn-sm-secondary" data-tl-limpar>Ver todos os eventos</button>
    </div>`;
}

// ═══════════════════════════════════════════════════════════
// MODAL — registro manual
// ═══════════════════════════════════════════════════════════
function abrirModalManual(evento = null, aoSalvar = null) {
  const editando = !!evento;
  const d = evento ? new Date(evento.data_evento) : new Date();
  const dataLocal = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  const fundo = document.createElement('div');
  fundo.className = 'tl-modal-fundo';
  fundo.innerHTML = `
    <div class="tl-modal" role="dialog" aria-modal="true" aria-labelledby="tlModalTit">
      <div class="tl-modal-head">
        <h3 id="tlModalTit">${editando ? 'Editar registro' : 'Adicionar registro'}</h3>
        <button class="tl-modal-x" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
      </div>
      <div class="tl-modal-body">
        <label class="tl-campo"><span>Título</span>
          <input type="text" id="tlmTitulo" class="np-input" maxlength="120"
                 placeholder="Ex.: Contato por WhatsApp" value="${esc(evento?.titulo || '')}"></label>
        <label class="tl-campo"><span>Descrição</span>
          <textarea id="tlmDesc" class="np-input" rows="3" placeholder="O que aconteceu">${esc(evento?.descricao || '')}</textarea></label>
        <div class="tl-campo-linha">
          <label class="tl-campo"><span>Data e hora</span>
            <input type="datetime-local" id="tlmData" class="np-input" value="${dataLocal}"></label>
          <label class="tl-campo"><span>Categoria</span>
            <select id="tlmCat" class="np-input">
              ${CATEGORIAS_MANUAIS.map(c => `<option ${evento?.metadata?.categoria === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
            </select></label>
          <label class="tl-campo"><span>Importância</span>
            <select id="tlmImp" class="np-input">
              <option value="normal" ${(evento?.importancia || 'normal') === 'normal' ? 'selected' : ''}>Normal</option>
              <option value="alta"   ${evento?.importancia === 'alta' ? 'selected' : ''}>Relevante</option>
              <option value="baixa"  ${evento?.importancia === 'baixa' ? 'selected' : ''}>Baixa</option>
            </select></label>
        </div>
        <div class="tl-modal-erro" data-erro role="alert"></div>
      </div>
      <div class="tl-modal-foot">
        <button class="btn" data-fechar>Cancelar</button>
        <button class="btn primary" data-salvar>${editando ? 'Salvar alterações' : 'Adicionar registro'}</button>
      </div>
    </div>`;
  document.body.appendChild(fundo);

  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', onEsc); };
  const onEsc = (e) => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', onEsc);
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  fundo.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', fechar));
  setTimeout(() => fundo.querySelector('#tlmTitulo')?.focus(), 30);

  fundo.querySelector('[data-salvar]').addEventListener('click', async () => {
    const titulo = fundo.querySelector('#tlmTitulo').value.trim();
    const erro = fundo.querySelector('[data-erro]');
    if (!titulo) { erro.textContent = 'Informe um título para o registro.'; return; }
    erro.textContent = '';

    const dados = {
      titulo,
      descricao: fundo.querySelector('#tlmDesc').value.trim(),
      dataEvento: fundo.querySelector('#tlmData').value || new Date().toISOString(),
      categoria: fundo.querySelector('#tlmCat').value,
      importancia: fundo.querySelector('#tlmImp').value,
    };
    const btn = fundo.querySelector('[data-salvar]');
    btn.disabled = true; btn.textContent = 'Salvando...';
    try {
      if (editando) await atualizarRegistroManual(evento.id, dados);
      else await criarRegistroManual({ pacienteId: _paciente.id, ...dados });
      fechar();
      mostrarToast(editando ? '✓ Registro atualizado' : '✓ Registro adicionado');
      if (listaEl()) { listaEl().innerHTML = skeletonEventos(); await carregarPagina(true); }
      aoSalvar?.();
    } catch (e) {
      btn.disabled = false; btn.textContent = editando ? 'Salvar alterações' : 'Adicionar registro';
      erro.textContent = 'Não foi possível salvar: ' + (e.message || e);
    }
  });
}

async function removerManual(id) {
  if (!(await confirmar({
    titulo: 'Excluir registro',
    mensagem: 'Excluir este registro manual da timeline?',
    textoOk: 'Excluir', perigo: true,
  }))) return;
  try {
    await excluirRegistroManual(id);
    mostrarToast('Registro excluído');
    await carregarPagina(true);
  } catch (e) {
    mostrarErro('Não foi possível excluir: ' + (e.message || e));
  }
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmtNum(v, casas = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
               'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIA_MS = 86400000;

/** Recente agrupa por dia; acima de 180 dias agrupa por mês. */
function chaveGrupo(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { chave: 'sem-data', label: 'Sem data' };
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dia = new Date(d); dia.setHours(0, 0, 0, 0);
  const dif = Math.round((hoje - dia) / DIA_MS);

  if (dif === 0) return { chave: 'hoje', label: 'Hoje' };
  if (dif === 1) return { chave: 'ontem', label: 'Ontem' };
  if (dif <= 180) {
    const label = d.getFullYear() === hoje.getFullYear()
      ? `${d.getDate()} de ${MESES[d.getMonth()]}`
      : `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
    return { chave: `d-${dia.toISOString().slice(0, 10)}`, label };
  }
  const mes = MESES[d.getMonth()];
  return { chave: `m-${d.getFullYear()}-${d.getMonth()}`, label: `${mes[0].toUpperCase()}${mes.slice(1)} de ${d.getFullYear()}` };
}

function quandoLongo(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${chaveGrupo(iso).label}, ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}
