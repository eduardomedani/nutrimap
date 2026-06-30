// ═══════════════════════════════════════════════════════════
// AVALIAÇÕES — UI (tela de cadastro + preview em tempo real)
// ═══════════════════════════════════════════════════════════
// Autocontido: monta lista de pacientes, formulário e preview.
// Plugado no index.html via initAvaliacoesUI().

import {
  listarPacientes
} from './pacientes.js';
import {
  listarAvaliacoes, criarAvaliacao, atualizarAvaliacao, excluirAvaliacao,
  proximoNumero, dadosBasicosDaAnamnese, gerarOpcoesProtocolo,
  calcularResultados, extrairDobras
} from './avaliacoes.js';
import { mostrarToast } from './utils.js';

let _nutriId = null;
let _pacientes = [];
let _pacienteSel = null;          // paciente escolhido
let _dadosBasicos = { sexo: null, idade: null };
let _editandoId = null;           // id da avaliação em edição (ou null = nova)

const DOBRAS = [
  ['dc_peitoral', 'Peitoral'], ['dc_axilar_media', 'Axilar média'],
  ['dc_subescapular', 'Subescapular'], ['dc_tricipital', 'Tricipital'],
  ['dc_biciptal', 'Bicipital'], ['dc_crista_iliaca', 'Crista ilíaca'],
  ['dc_supra_iliaca', 'Supra-ilíaca'], ['dc_abdominal', 'Abdominal'],
  ['dc_coxa', 'Coxa'], ['dc_panturrilha', 'Panturrilha'],
];
const PERIMETRIAS = [
  ['per_torax', 'Tórax'], ['per_braco_direito', 'Braço D'],
  ['per_braco_esquerdo', 'Braço E'], ['per_abdomen', 'Abdômen'],
  ['per_cintura', 'Cintura'], ['per_quadril', 'Quadril'],
  ['per_coxa_direita', 'Coxa D'], ['per_coxa_esquerda', 'Coxa E'],
  ['per_panturrilha_direita', 'Pantur. D'], ['per_panturrilha_esquerda', 'Pantur. E'],
];
const FATORES = [
  [1.2, 'Sedentário'], [1.375, 'Levemente ativo'], [1.55, 'Moderadamente ativo'],
  [1.725, 'Muito ativo'], [1.9, 'Extremamente ativo'],
];

// ───────────────────────────────────────────────────────────
// ENTRADA: chamado pelo index.html quando entra na aba
// ───────────────────────────────────────────────────────────
export async function initAvaliacoesUI(nutriId) {
  _nutriId = nutriId;
  const page = document.getElementById('page-avaliacoes');
  if (!page) return;
  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">📐 <em>Avaliações</em></h1>
      <div class="page-sub">Antropometria, dobras cutâneas e composição corporal</div>
    </div>
    <div id="avMain"><div class="loading"><div class="spinner"></div>Carregando pacientes...</div></div>
  `;
  try {
    _pacientes = await listarPacientes();
    renderSelecaoPaciente();
  } catch (e) {
    document.getElementById('avMain').innerHTML =
      `<div class="empty-state"><div class="empty-state-icon">⚠️</div>Erro: ${e.message}</div>`;
  }
}

// ───────────────────────────────────────────────────────────
// PASSO 1 — escolher paciente
// ───────────────────────────────────────────────────────────
function renderSelecaoPaciente() {
  const main = document.getElementById('avMain');
  if (!_pacientes.length) {
    main.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div>
      Cadastre um paciente na aba Início antes de criar avaliações.</div>`;
    return;
  }
  const opcoes = _pacientes.map(p =>
    `<option value="${p.id}">${esc(p.nome || '(sem nome)')} — ${p.codigo}</option>`
  ).join('');
  main.innerHTML = `
    <div class="novo-paciente-card">
      <div class="novo-paciente-header">
        <div class="novo-paciente-icon">🧍</div>
        <div>
          <div class="novo-paciente-title">Selecione o <em>paciente</em></div>
          <div class="novo-paciente-sub">A avaliação será vinculada a este paciente</div>
        </div>
      </div>
      <div class="novo-paciente-form">
        <select id="avPacienteSelect" class="np-input">
          <option value="">— escolha —</option>${opcoes}
        </select>
        <button class="btn primary" id="avBtnAbrir">Abrir avaliações →</button>
      </div>
    </div>
    <div id="avPainel"></div>
  `;
  document.getElementById('avBtnAbrir').addEventListener('click', async () => {
    const id = document.getElementById('avPacienteSelect').value;
    if (!id) { mostrarToast('Selecione um paciente'); return; }
    _pacienteSel = _pacientes.find(p => p.id === id);
    await abrirPainelPaciente();
  });
}

// ───────────────────────────────────────────────────────────
// PASSO 2 — painel do paciente (lista + botão nova)
// ───────────────────────────────────────────────────────────
async function abrirPainelPaciente() {
  const painel = document.getElementById('avPainel');
  painel.innerHTML = '<div class="loading"><div class="spinner"></div>Carregando...</div>';
  _dadosBasicos = await dadosBasicosDaAnamnese(_pacienteSel.id);
  const avals = await listarAvaliacoes(_pacienteSel.id);
  const semDados = !_dadosBasicos.sexo || !_dadosBasicos.idade;

  const aviso = semDados
    ? `<div class="form-warn">⚠️ Sexo/idade não encontrados na anamnese deste paciente.
        Preencha manualmente no formulário (campos editáveis).</div>`
    : `<div class="form-ok">✓ Anamnese: ${_dadosBasicos.sexo === 'M' ? 'Masculino' : 'Feminino'},
        ${_dadosBasicos.idade} anos</div>`;

  const linhas = avals.length
    ? avals.map(a => `
        <div class="patient-row">
          <div class="patient-avatar">AV${a.numero}</div>
          <div class="patient-info">
            <div class="patient-name">Avaliação ${a.numero}</div>
            <div class="patient-meta">${fmtData(a.data_avaliacao)} ·
              ${a.pct_gordura != null ? (a.pct_gordura*100).toFixed(1)+'% G' : '—'} ·
              IMC ${a.imc ?? '—'}</div>
          </div>
          <button class="patient-action primary" data-av-edit="${a.id}">✏️ Editar</button>
          <button class="patient-action patient-action-danger" data-av-del="${a.id}" data-av-num="${a.numero}">🗑</button>
        </div>`).join('')
    : `<div class="empty-state"><div class="empty-state-icon">📭</div>Nenhuma avaliação ainda.</div>`;

  painel.innerHTML = `
    <div class="list-header">
      <div class="list-title">Avaliações de <em>${esc(_pacienteSel.nome || _pacienteSel.codigo)}</em></div>
      <button class="btn primary" id="avBtnNova">➕ Nova avaliação</button>
    </div>
    ${aviso}
    <div class="patients-grid">${linhas}</div>
    <div id="avFormWrap"></div>
  `;
  document.getElementById('avBtnNova').addEventListener('click', () => abrirFormulario(null));
  painel.querySelectorAll('[data-av-edit]').forEach(b =>
    b.addEventListener('click', () => abrirFormulario(avals.find(a => a.id === b.dataset.avEdit))));
  painel.querySelectorAll('[data-av-del]').forEach(b =>
    b.addEventListener('click', () => removerAval(b.dataset.avDel, b.dataset.avNum)));
}

async function removerAval(id, numero) {
  if (!confirm(`Excluir a Avaliação ${numero}?`)) return;
  try {
    await excluirAvaliacao(id);
    mostrarToast('✓ Avaliação excluída');
    await abrirPainelPaciente();
  } catch (e) { alert('Erro: ' + e.message); }
}

// ───────────────────────────────────────────────────────────
// PASSO 3 — formulário com preview em tempo real
// ───────────────────────────────────────────────────────────
async function abrirFormulario(aval) {
  _editandoId = aval ? aval.id : null;
  const numero = aval ? aval.numero : await proximoNumero(_pacienteSel.id);
  const sexo = aval?.sexo || _dadosBasicos.sexo || 'M';
  const idade = aval?.idade ?? _dadosBasicos.idade ?? '';

  const campoNum = (id, label, val = '', step = '0.1') =>
    `<div class="av-field"><label>${label}</label>
      <input type="number" step="${step}" id="${id}" value="${val ?? ''}" class="np-input av-in"></div>`;

  const wrap = document.getElementById('avFormWrap');
  wrap.innerHTML = `
    <div class="av-form-card">
      <div class="av-form-title">${aval ? 'Editar' : 'Nova'} avaliação — <em>AV ${numero}</em></div>

      <div class="av-section">Dados básicos</div>
      <div class="av-grid">
        <div class="av-field"><label>Data</label>
          <input type="date" id="data_avaliacao" value="${aval?.data_avaliacao || hoje()}" class="np-input av-in"></div>
        <div class="av-field"><label>Sexo</label>
          <select id="sexo" class="np-input av-in">
            <option value="M" ${sexo==='M'?'selected':''}>Masculino</option>
            <option value="F" ${sexo==='F'?'selected':''}>Feminino</option>
          </select></div>
        ${campoNum('idade', 'Idade (anos)', idade, '1')}
        ${campoNum('peso', 'Peso (kg)', aval?.peso, '0.1')}
        ${campoNum('altura', 'Altura (m)', aval?.altura, '0.01')}
        <div class="av-field"><label>Atividade</label>
          <select id="fator_atividade" class="np-input av-in">
            ${FATORES.map(([v,n]) => `<option value="${v}" ${(aval?.fator_atividade==v)||(!aval&&v==1.2)?'selected':''}>${n}</option>`).join('')}
          </select></div>
        ${campoNum('pct_gordura_ideal', '%G ideal (frac.)', aval?.pct_gordura_ideal ?? 0.12, '0.01')}
        <div class="av-field"><label>Protocolo %G</label>
          <select id="protocolo" class="np-input av-in"></select></div>
      </div>

      <div class="av-section">Dobras cutâneas (mm)</div>
      <div class="av-grid">${DOBRAS.map(([id,l]) => campoNum(id, l, aval?.[id])).join('')}</div>

      <div class="av-section">Perimetrias (cm)</div>
      <div class="av-grid">${PERIMETRIAS.map(([id,l]) => campoNum(id, l, aval?.[id])).join('')}</div>

      <div class="av-section">Observações</div>
      <textarea id="observacoes" class="np-input" rows="2" style="resize:vertical">${esc(aval?.observacoes || '')}</textarea>

      <div class="av-section">Resultados</div>
      <div id="avPreview" class="av-preview"></div>

      <div class="av-actions">
        <button class="btn" id="avCancelar">Cancelar</button>
        <button class="btn primary" id="avSalvar">${aval ? '💾 Atualizar' : '💾 Salvar avaliação'}</button>
      </div>
    </div>
  `;
  atualizarProtocolos();
  if (aval?.protocolo) document.getElementById('protocolo').value = aval.protocolo;

  // Listeners de recálculo em tempo real
  wrap.querySelectorAll('.av-in').forEach(el => {
    el.addEventListener('input', recalcPreview);
    el.addEventListener('change', recalcPreview);
  });
  document.getElementById('sexo').addEventListener('change', atualizarProtocolos);
  document.getElementById('avCancelar').addEventListener('click', () => { wrap.innerHTML=''; });
  document.getElementById('avSalvar').addEventListener('click', salvar);
  recalcPreview();
  wrap.scrollIntoView({ behavior:'smooth', block:'start' });
}

function atualizarProtocolos() {
  const sexo = document.getElementById('sexo').value;
  const sel = document.getElementById('protocolo');
  const atual = sel.value;
  const ops = gerarOpcoesProtocolo(sexo);
  sel.innerHTML = ops.map(o => `<option value="${o.id}">${o.nome}</option>`).join('');
  if (ops.some(o => o.id === atual)) sel.value = atual;
  recalcPreview();
}

function lerForm() {
  const v = id => {
    const el = document.getElementById(id);
    if (!el) return null;
    return el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
  };
  const reg = {
    data_avaliacao: v('data_avaliacao'),
    sexo: v('sexo'), idade: v('idade'),
    peso: v('peso'), altura: v('altura'),
    fator_atividade: v('fator_atividade'),
    pct_gordura_ideal: v('pct_gordura_ideal'),
    protocolo: v('protocolo'),
    observacoes: v('observacoes'),
  };
  DOBRAS.forEach(([id]) => reg[id] = v(id));
  PERIMETRIAS.forEach(([id]) => reg[id] = v(id));
  return reg;
}

function recalcPreview() {
  const reg = lerForm();
  const box = document.getElementById('avPreview');
  if (!box) return;
  try {
    const r = calcularResultados({ ...reg, dobras: extrairDobras(reg) });
    const item = (lbl, val, suf='') =>
      `<div class="av-res"><div class="av-res-lbl">${lbl}</div><div class="av-res-val">${val}${suf}</div></div>`;
    box.innerHTML =
      item('IMC', r.imc) +
      item('% Gordura', (r.pct_gordura*100).toFixed(1), '%') +
      item('Massa gorda', r.peso_gordura, ' kg') +
      item('Massa magra', r.peso_magro, ' kg') +
      item('Peso ideal', r.peso_ideal, ' kg') +
      item('Excesso', r.peso_excesso, ' kg') +
      item('RCQ', r.pccq) +
      item('TMB', r.tmb, ' kcal') +
      item('GET', r.get_kcal, ' kcal');
  } catch (e) {
    box.innerHTML = `<div class="form-warn">${e.message}</div>`;
  }
}

async function salvar() {
  const reg = lerForm();
  if (!reg.peso || !reg.altura) { mostrarToast('Preencha peso e altura'); return; }
  const btn = document.getElementById('avSalvar');
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    if (_editandoId) await atualizarAvaliacao(_editandoId, reg);
    else await criarAvaliacao(_nutriId, _pacienteSel.id, reg);
    mostrarToast('✓ Avaliação salva');
    document.getElementById('avFormWrap').innerHTML = '';
    await abrirPainelPaciente();
  } catch (e) {
    alert('Erro ao salvar: ' + e.message);
    btn.disabled = false; btn.textContent = '💾 Salvar avaliação';
  }
}

// ───────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hoje = () => new Date().toISOString().slice(0,10);
const fmtData = d => d ? new Date(d+'T00:00:00').toLocaleDateString('pt-BR') : '—';
