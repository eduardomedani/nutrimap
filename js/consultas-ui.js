// ═══════════════════════════════════════════════════════════
// CONSULTAS — aba do Hub do paciente
// ═══════════════════════════════════════════════════════════
// Dois níveis: lista dos atendimentos e o registro de um deles.
// O Modo Consulta (Fase 2B) vai reaproveitar exatamente este registro — por
// isso o formulário já salva sozinho e sabe se a consulta está fechada.
//
// Consulta finalizada aparece em modo leitura, sem campos editáveis: o que o
// banco proíbe, a tela não oferece.

import {
  listarConsultas, buscarConsulta, criarConsulta, atualizarConsulta,
  iniciarConsulta, finalizarConsulta, cancelarConsulta, excluirConsulta,
  estaFechada, traduzirErroConsulta, TIPOS_CONSULTA, STATUS_CONSULTA,
} from './consultas.js';
import { invalidarResumo } from './paciente-resumo.js';
import { mostrarToast, mostrarErro, confirmar } from './utils.js';

let _cont = null;
let _paciente = null;
let _consultas = [];
let _abertaId = null;      // consulta em edição
let _salvando = null;      // debounce do autosave

export async function initConsultas({ cont, paciente, irParaAba, consultaId = null }) {
  _cont = cont; _paciente = paciente; _abertaId = consultaId;
  cont.innerHTML = `<div class="ev-sk"><div class="sk sk-bloco"></div></div>`;
  try {
    _consultas = await listarConsultas(paciente.id);
  } catch (e) {
    cont.innerHTML = `<div class="tl-estado">
        <div class="tl-estado-t">Não foi possível carregar as consultas.</div>
        <button class="btn-sm" data-cs-retry>Tentar novamente</button></div>`;
    cont.querySelector('[data-cs-retry]')?.addEventListener('click', () => initConsultas({ cont, paciente, irParaAba }));
    return;
  }
  render();
}

function render() {
  if (_abertaId) renderRegistro();
  else renderLista();
}

// ───────────────────────────────────────────────────────────
// LISTA
// ───────────────────────────────────────────────────────────
function renderLista() {
  const abertas = _consultas.filter(c => c.status === 'agendada' || c.status === 'em_andamento');
  const fechadas = _consultas.filter(c => c.status === 'finalizada' || c.status === 'cancelada');

  _cont.innerHTML = `
    <section class="pv-bloco">
      <div class="pv-sec-head">
        <h3 class="pv-sec-tit">Consultas</h3>
        <button class="btn-sm" data-cs-nova><i data-lucide="plus"></i> Nova consulta</button>
      </div>
      ${!_consultas.length ? `
        <div class="tl-estado">
          <div class="tl-estado-ic"><i data-lucide="stethoscope"></i></div>
          <div class="tl-estado-t">Nenhuma consulta registrada.</div>
          <div class="tl-estado-s">Registre o atendimento para guardar relato, conduta e orientações no histórico.</div>
          <button class="btn primary" data-cs-nova><i data-lucide="plus"></i> Registrar consulta</button>
        </div>` : `
        ${abertas.length ? `<div class="cs-grupo-tit">Em aberto</div>
          <div class="cs-lista">${abertas.map(itemHtml).join('')}</div>` : ''}
        ${fechadas.length ? `<div class="cs-grupo-tit">Histórico</div>
          <div class="cs-lista">${fechadas.map(itemHtml).join('')}</div>` : ''}
      `}
    </section>`;

  _cont.querySelectorAll('[data-cs-nova]').forEach(b => b.addEventListener('click', novaConsulta));
  _cont.querySelectorAll('[data-cs-abrir]').forEach(b =>
    b.addEventListener('click', () => { _abertaId = b.dataset.csAbrir; render(); }));
}

function itemHtml(c) {
  const fechada = estaFechada(c);
  return `
    <button class="cs-item ${c.status}" data-cs-abrir="${c.id}">
      <span class="cs-item-data">
        <b>${fmtDia(c.data_hora)}</b>
        <span>${fmtHora(c.data_hora)}</span>
      </span>
      <span class="cs-item-txt">
        <span class="cs-item-tit">${esc(TIPOS_CONSULTA[c.tipo] || 'Consulta')}
          ${c.modalidade === 'online' ? '<span class="cs-mini">online</span>' : ''}
        </span>
        <span class="cs-item-sub">${esc(resumoLinha(c))}</span>
      </span>
      <span class="cs-status st-${c.status}">${esc(STATUS_CONSULTA[c.status] || c.status)}</span>
      ${fechada ? '<span class="cs-cadeado" title="Registro fechado"><i data-lucide="lock"></i></span>' : ''}
    </button>`;
}

function resumoLinha(c) {
  const p = [];
  if (c.duracao_min) p.push(`${c.duracao_min} min`);
  if (c.motivo) p.push(c.motivo.length > 60 ? c.motivo.slice(0, 60) + '…' : c.motivo);
  else if (c.conduta) p.push('conduta registrada');
  if (c.retorno_sugerido) p.push(`retorno ${fmtDia(c.retorno_sugerido)}`);
  return p.join(' · ') || 'Sem anotações ainda';
}

async function novaConsulta() {
  try {
    const nova = await criarConsulta(_paciente.id, { tipo: _consultas.length ? 'retorno' : 'primeira' });
    _consultas = [nova, ..._consultas];
    _abertaId = nova.id;
    invalidarResumo(_paciente.id);
    render();
  } catch (e) {
    mostrarErro('Não foi possível criar a consulta: ' + traduzirErroConsulta(e.message));
  }
}

// ───────────────────────────────────────────────────────────
// REGISTRO DE UMA CONSULTA
// ───────────────────────────────────────────────────────────
function renderRegistro() {
  const c = _consultas.find(x => x.id === _abertaId);
  if (!c) { _abertaId = null; render(); return; }
  const fechada = estaFechada(c);
  const cancelada = c.status === 'cancelada';
  const somenteLeitura = fechada || cancelada;

  const campo = (id, label, valor, dica = '') => somenteLeitura
    ? `<div class="cs-campo-ro">
         <span class="cs-campo-l">${esc(label)}</span>
         <div class="cs-campo-v">${valor ? esc(valor).replace(/\n/g, '<br>') : '<i>Não registrado</i>'}</div>
       </div>`
    : `<label class="cs-campo">
         <span class="cs-campo-l">${esc(label)}</span>
         <textarea class="np-input" rows="3" data-cs-campo="${id}" placeholder="${esc(dica)}">${esc(valor || '')}</textarea>
       </label>`;

  _cont.innerHTML = `
    <button class="hub-voltar" data-cs-voltar><i data-lucide="arrow-left"></i> Consultas</button>

    <section class="pv-card cs-cabecalho">
      <div class="cs-cab-top">
        <div>
          <div class="cs-cab-tit">${esc(TIPOS_CONSULTA[c.tipo] || 'Consulta')}</div>
          <div class="cs-cab-sub">${fmtDia(c.data_hora)} às ${fmtHora(c.data_hora)}${c.duracao_min ? ` · ${c.duracao_min} min` : ''}</div>
        </div>
        <span class="cs-status st-${c.status}">${esc(STATUS_CONSULTA[c.status] || c.status)}</span>
      </div>

      ${somenteLeitura ? `
        <div class="cs-aviso">
          <i data-lucide="lock"></i>
          ${fechada ? 'Consulta finalizada — o registro do atendimento não pode mais ser alterado.'
                    : 'Consulta cancelada.'}
        </div>` : `
        <div class="cs-form-linha">
          <label class="tl-campo"><span>Data e hora</span>
            <input type="datetime-local" class="np-input" data-cs-campo="data_hora" value="${paraLocal(c.data_hora)}"></label>
          <label class="tl-campo"><span>Tipo</span>
            <select class="np-input" data-cs-campo="tipo">
              ${Object.entries(TIPOS_CONSULTA).map(([k, v]) =>
                `<option value="${k}" ${c.tipo === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
            </select></label>
          <label class="tl-campo"><span>Modalidade</span>
            <select class="np-input" data-cs-campo="modalidade">
              <option value="presencial" ${c.modalidade === 'presencial' ? 'selected' : ''}>Presencial</option>
              <option value="online" ${c.modalidade === 'online' ? 'selected' : ''}>Online</option>
            </select></label>
        </div>`}
    </section>

    <section class="pv-card cs-registro">
      <div class="pv-card-head">
        <h3><i data-lucide="notebook-pen"></i> Registro do atendimento</h3>
        ${somenteLeitura ? '' : `<span class="cs-save" data-cs-save role="status" aria-live="polite"></span>`}
      </div>
      ${campo('motivo', 'Motivo da consulta', c.motivo, 'Por que o paciente veio hoje')}
      ${campo('relato', 'Relato do paciente', c.relato, 'O que ele contou, na fala dele')}
      ${campo('observacoes', 'Observações', c.observacoes, 'O que você observou')}
      ${campo('conduta', 'Conduta', c.conduta, 'O que foi decidido')}
      ${campo('orientacoes', 'Orientações', c.orientacoes, 'O que o paciente leva de orientação')}
      ${somenteLeitura
        ? (c.retorno_sugerido ? `<div class="cs-campo-ro"><span class="cs-campo-l">Retorno sugerido</span>
             <div class="cs-campo-v">${fmtDia(c.retorno_sugerido)}</div></div>` : '')
        : `<div class="cs-form-linha">
             <label class="tl-campo"><span>Retorno sugerido</span>
               <input type="date" class="np-input" data-cs-campo="retorno_sugerido" value="${c.retorno_sugerido || ''}"></label>
             <label class="tl-campo"><span>Duração (min)</span>
               <input type="number" min="1" class="np-input" data-cs-campo="duracao_min" value="${c.duracao_min ?? ''}"
                      placeholder="calculada ao finalizar"></label>
           </div>`}
      ${fechada && c.resumo ? `<div class="cs-campo-ro"><span class="cs-campo-l">Resumo da consulta</span>
          <div class="cs-campo-v">${esc(c.resumo).replace(/\n/g, '<br>')}</div></div>` : ''}
    </section>

    ${somenteLeitura ? '' : `
      <div class="cs-acoes">
        ${c.status === 'agendada' ? `<button class="btn" data-cs-iniciar><i data-lucide="play"></i> Iniciar atendimento</button>` : ''}
        <button class="btn primary" data-cs-finalizar><i data-lucide="check"></i> Finalizar consulta</button>
        <button class="tl-link" data-cs-cancelar>Cancelar consulta</button>
        <button class="tl-link tl-link-perigo" data-cs-excluir>Excluir</button>
      </div>`}`;

  ligarRegistro(c);
}

function ligarRegistro(c) {
  _cont.querySelector('[data-cs-voltar]')?.addEventListener('click', () => { _abertaId = null; render(); });

  // Autosave: some com "salvar" da tela sem esconder o que está acontecendo.
  _cont.querySelectorAll('[data-cs-campo]').forEach(el => {
    const evento = el.tagName === 'SELECT' || el.type === 'date' || el.type === 'datetime-local' ? 'change' : 'input';
    el.addEventListener(evento, () => agendarSalvar(c.id));
    if (evento === 'input') el.addEventListener('blur', () => salvarAgora(c.id));
  });

  _cont.querySelector('[data-cs-iniciar]')?.addEventListener('click', async () => {
    try {
      const at = await iniciarConsulta(c.id);
      trocar(at); mostrarToast('Atendimento iniciado'); render();
    } catch (e) { mostrarErro(traduzirErroConsulta(e.message)); }
  });

  _cont.querySelector('[data-cs-finalizar]')?.addEventListener('click', () => finalizar(c.id));

  _cont.querySelector('[data-cs-cancelar]')?.addEventListener('click', async () => {
    if (!(await confirmar({
      titulo: 'Cancelar consulta',
      mensagem: 'Marcar esta consulta como cancelada? O registro fica no histórico.',
      textoOk: 'Cancelar consulta',
    }))) return;
    try {
      const at = await cancelarConsulta(c.id);
      trocar(at); invalidarResumo(_paciente.id); mostrarToast('Consulta cancelada'); render();
    } catch (e) { mostrarErro(traduzirErroConsulta(e.message)); }
  });

  _cont.querySelector('[data-cs-excluir]')?.addEventListener('click', async () => {
    if (!(await confirmar({
      titulo: 'Excluir consulta',
      mensagem: 'Excluir este registro? Só é possível porque a consulta ainda não foi finalizada.',
      textoOk: 'Excluir', perigo: true,
    }))) return;
    try {
      await excluirConsulta(c.id);
      _consultas = _consultas.filter(x => x.id !== c.id);
      _abertaId = null; invalidarResumo(_paciente.id);
      mostrarToast('Consulta excluída'); render();
    } catch (e) { mostrarErro(traduzirErroConsulta(e.message)); }
  });
}

function trocar(atualizada) {
  _consultas = _consultas.map(x => (x.id === atualizada.id ? atualizada : x));
}

// ── Autosave ───────────────────────────────────────────────
function lerFormulario() {
  const out = {};
  _cont.querySelectorAll('[data-cs-campo]').forEach(el => {
    const k = el.dataset.csCampo;
    let v = el.value;
    if (k === 'data_hora' && v) v = new Date(v).toISOString();
    if (k === 'duracao_min') v = v === '' ? null : Number(v);
    out[k] = v === '' ? null : v;
  });
  return out;
}

function agendarSalvar(id) {
  marcarSave('salvando');
  clearTimeout(_salvando);
  _salvando = setTimeout(() => salvarAgora(id), 900);
}

async function salvarAgora(id) {
  clearTimeout(_salvando);
  try {
    const at = await atualizarConsulta(id, lerFormulario());
    trocar(at);
    invalidarResumo(_paciente.id);
    marcarSave('salvo');
  } catch (e) {
    marcarSave('erro');
    console.error('[consultas] autosave', e);
  }
}

function marcarSave(estado) {
  const el = _cont?.querySelector('[data-cs-save]');
  if (!el) return;
  const M = {
    salvando: '<i data-lucide="loader"></i> Salvando...',
    salvo: '<i data-lucide="check"></i> Alterações salvas',
    erro: '<i data-lucide="triangle-alert"></i> Erro ao salvar',
  };
  el.className = `cs-save cs-save-${estado}`;
  el.innerHTML = M[estado] || '';
  if (estado === 'salvo') setTimeout(() => { if (el.classList.contains('cs-save-salvo')) el.innerHTML = ''; }, 2500);
}

// ── Finalização ────────────────────────────────────────────
async function finalizar(id) {
  await salvarAgora(id);
  const c = _consultas.find(x => x.id === id);

  const faltando = [];
  if (!c.conduta) faltando.push('conduta');
  if (!c.orientacoes) faltando.push('orientações');
  if (!c.retorno_sugerido) faltando.push('retorno sugerido');

  const fundo = document.createElement('div');
  fundo.className = 'tl-modal-fundo';
  fundo.innerHTML = `
    <div class="tl-modal" role="dialog" aria-modal="true" aria-labelledby="csFimTit">
      <div class="tl-modal-head">
        <h3 id="csFimTit">Finalizar consulta</h3>
        <button class="tl-modal-x" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
      </div>
      <div class="tl-modal-body">
        <p class="cs-fim-aviso"><i data-lucide="lock"></i>
          Depois de finalizar, o registro desta consulta não poderá mais ser alterado.</p>
        ${faltando.length ? `<div class="cs-fim-falta">
            <b>Ainda sem preencher:</b> ${esc(faltando.join(', '))}. Dá para finalizar assim mesmo.</div>` : ''}
        <label class="tl-campo"><span>Resumo da consulta (opcional)</span>
          <textarea id="csResumo" class="np-input" rows="3"
            placeholder="Fechamento do atendimento, em poucas linhas">${esc(c.resumo || '')}</textarea></label>
        <label class="tl-campo"><span>Retorno sugerido</span>
          <input type="date" id="csRetorno" class="np-input" value="${c.retorno_sugerido || ''}"></label>
        <div class="tl-modal-erro" data-erro role="alert"></div>
      </div>
      <div class="tl-modal-foot">
        <button class="btn" data-fechar>Voltar</button>
        <button class="btn primary" data-confirmar><i data-lucide="check"></i> Finalizar consulta</button>
      </div>
    </div>`;
  document.body.appendChild(fundo);

  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', onEsc); };
  const onEsc = (e) => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', onEsc);
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  fundo.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', fechar));

  fundo.querySelector('[data-confirmar]').addEventListener('click', async () => {
    const btn = fundo.querySelector('[data-confirmar]');
    btn.disabled = true; btn.textContent = 'Finalizando...';
    try {
      const at = await finalizarConsulta(id, {
        resumo: fundo.querySelector('#csResumo').value.trim() || null,
        retorno_sugerido: fundo.querySelector('#csRetorno').value || null,
      });
      trocar(at);
      invalidarResumo(_paciente.id);
      fechar();
      mostrarToast('✓ Consulta finalizada');
      render();
    } catch (e) {
      btn.disabled = false; btn.innerHTML = '<i data-lucide="check"></i> Finalizar consulta';
      fundo.querySelector('[data-erro]').textContent = traduzirErroConsulta(e.message);
    }
  });
}

// ── Helpers ────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmtDia(d) {
  if (!d) return '—';
  const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T12:00:00` : d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('pt-BR');
}
function fmtHora(d) {
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '' : dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function paraLocal(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
