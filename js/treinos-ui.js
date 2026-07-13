// ═══════════════════════════════════════════════════════════
// TREINOS — UI (montagem de treino dentro da ficha do paciente)
// ═══════════════════════════════════════════════════════════
// 3 níveis:
//   1) lista de treinos do paciente
//   2) criar/editar treino (nome, data início, nº de divisões => abas dos dias)
//   3) exercícios de cada dia (dropdown da biblioteca + campos por exercício)
// Progressão (histórico de cargas) fica para a próxima etapa.
//
// Plugado na ficha via initTreinosUIParaPaciente(nutriId, paciente, mountId).

import {
  listarTreinosDoPaciente, criarTreino, atualizarTreino, excluirTreino,
  listarItensDoTreino, adicionarExercicioAoTreino, atualizarItem, excluirItem,
  listarExercicios,
  listarProgressao, registrarProgressao, excluirProgressao,
} from './treinos.js';
import { sb } from './supabase.js';
import { mostrarToast } from './utils.js';

// ── Estado do módulo ──
let _nutriId    = null;
let _paciente   = null;
let _mountEl    = null;
let _biblioteca = null;    // cache dos exercícios da biblioteca
let _treino     = null;    // treino em edição (null enquanto não criado)
let _itens      = [];       // itens (treino_exercicios) do treino em edição
let _dias       = [];       // letras dos dias, ex.: ['A','B','C']
let _diaSel     = 'A';      // dia selecionado
let _progAbertas = new Set(); // ids de treino_exercicio com o painel de progressão aberto

const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];      // até 7 dias
const MIN_DIAS = 2, MAX_DIAS = 7;

const METODOS = [
  'Normal', 'Bi-set', 'Tri-set', 'Drop-set', 'Super-set',
  'Rest-pause', 'Piramidal', 'Isometria', 'FST-7', 'Cluster',
];

// Descrição curta de como executar cada método (mostrada na linha do exercício).
// "Normal" fica de fora de propósito (não precisa de explicação).
const MET_DESC = {
  'Bi-set':     'Dois exercícios em sequência, sem descanso entre eles.',
  'Tri-set':    'Três exercícios em sequência, sem descanso entre eles.',
  'Drop-set':   'Ao falhar, reduza a carga (~20%) e continue sem descanso — repita a queda 2–3x.',
  'Super-set':  'Dois exercícios de músculos antagonistas alternados, sem descanso.',
  'Rest-pause': 'Chegue à falha, descanse 10–15s e faça mais algumas repetições; repita.',
  'Piramidal':  'A cada série, aumente a carga e reduza as reps (crescente) — ou o inverso (decrescente).',
  'Isometria':  'Sustente a contração parado, sem movimento, pelo tempo determinado.',
  'FST-7':      '7 séries do mesmo exercício com ~30–45s de descanso, buscando congestão máxima.',
  'Cluster':    'Fracione a série em mini-blocos de poucas reps com pausas curtas dentro da própria série.',
};

// Retorna { nome, desc } do método reconhecido (case-insensitive) ou null.
function metodoInfo(metodo) {
  const key = String(metodo || '').trim().toLowerCase();
  if (!key) return null;
  const nome = Object.keys(MET_DESC).find(k => k.toLowerCase() === key);
  return nome ? { nome, desc: MET_DESC[nome] } : null;
}

// Campos editáveis de cada exercício (além de Observação, que é textarea)
const CAMPOS_ITEM = [
  { k: 'series',     label: 'Séries',      type: 'number', ph: '3' },
  { k: 'repeticoes', label: 'Repetições',  type: 'text',   ph: '8-12' },
  { k: 'carga',      label: 'Carga',       type: 'text',   ph: '20kg' },
  { k: 'cadencia',   label: 'Cadência',    type: 'text',   ph: '2-0-2' },
  { k: 'descanso',   label: 'Descanso',    type: 'text',   ph: '60s' },
  { k: 'rir',        label: 'RIR',         type: 'text',   ph: '1-2' },
  { k: 'metodo',     label: 'Método',      select: true,   options: METODOS },
];

// ───────────────────────────────────────────────────────────
// ENTRADA (chamada pela ficha.js)
// ───────────────────────────────────────────────────────────
export async function initTreinosUIParaPaciente(nutriId, paciente, mountId) {
  _nutriId = nutriId;
  _paciente = paciente;
  _mountEl = document.getElementById(mountId);
  _biblioteca = null;
  _treino = null;
  if (!_mountEl) return;
  await renderLista();
}

// Pega o nutri logado (padrão do pacientes.js). Usa o param se já veio da ficha.
async function getNutriId() {
  if (_nutriId) return _nutriId;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Usuário não autenticado');
  _nutriId = user.id;
  return _nutriId;
}

// ═══════════════════════════════════════════════════════════
// NÍVEL 1 — Lista de treinos do paciente
// ═══════════════════════════════════════════════════════════
async function renderLista() {
  _mountEl.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando treinos...</div>`;
  let treinos;
  try {
    treinos = await listarTreinosDoPaciente(_paciente.id);
  } catch (e) {
    _mountEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>Erro: ${esc(e.message)}</div>`;
    return;
  }

  const linhas = treinos.length
    ? treinos.map(t => `
        <div class="patient-row">
          <div class="patient-avatar"><i data-lucide="dumbbell"></i></div>
          <div class="patient-info">
            <div class="patient-name">${esc(t.nome || '(sem nome)')}</div>
            <div class="patient-meta">${esc(divisaoLabel(t.divisao))} ·
              ${t.ativo
                ? '<span style="color:var(--moss)"><i data-lucide="circle-check"></i> Ativo</span>'
                : '<span style="color:var(--ink-mute)"><i data-lucide="circle"></i> Inativo</span>'} ·
              início ${fmtData(t.data_inicio)}</div>
          </div>
          <button class="patient-action primary" data-tr-edit="${t.id}"><i data-lucide="pencil"></i> Abrir</button>
          <button class="patient-action patient-action-danger" data-tr-del="${t.id}" data-tr-nome="${esc(t.nome || '')}"><i data-lucide="trash-2"></i></button>
        </div>`).join('')
    : `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="inbox"></i></div>Nenhum treino ainda. Clique em <strong>Novo treino</strong>.</div>`;

  _mountEl.innerHTML = `
    <div class="list-header">
      <div class="list-title">Treinos de <em>${esc(_paciente.nome || _paciente.codigo)}</em></div>
      <button class="btn primary" id="trBtnNovo"><i data-lucide="plus"></i> Novo treino</button>
    </div>
    <div class="patients-grid">${linhas}</div>
  `;

  document.getElementById('trBtnNovo').addEventListener('click', () => abrirEditor(null));
  _mountEl.querySelectorAll('[data-tr-edit]').forEach(b =>
    b.addEventListener('click', () => abrirEditor(treinos.find(t => t.id === b.dataset.trEdit))));
  _mountEl.querySelectorAll('[data-tr-del]').forEach(b =>
    b.addEventListener('click', () => removerTreino(b.dataset.trDel, b.dataset.trNome)));
}

async function removerTreino(id, nome) {
  if (!confirm(`Excluir o treino "${nome || 'sem nome'}"?\nOs exercícios do treino também serão removidos.`)) return;
  try {
    await excluirTreino(id);
    mostrarToast('✓ Treino excluído');
    await renderLista();
  } catch (e) { alert('Erro: ' + e.message); }
}

// ═══════════════════════════════════════════════════════════
// NÍVEL 2 — Criar / editar treino (+ seletor de divisões)
// ═══════════════════════════════════════════════════════════
async function abrirEditor(treino) {
  _treino = treino || null;
  _mountEl.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando...</div>`;

  try {
    if (_biblioteca == null) _biblioteca = await listarExercicios();
    _itens = _treino ? await listarItensDoTreino(_treino.id) : [];
  } catch (e) {
    _mountEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>Erro: ${esc(e.message)}</div>`;
    return;
  }

  _dias = _treino ? diasDoTreino(_treino, _itens) : [];
  _diaSel = _dias[0] || 'A';
  renderEditor();
}

function renderEditor() {
  const t = _treino;
  const nDefault = t ? _dias.length : 3;

  // Opções do seletor de divisões (2..7)
  const opcoesDiv = [];
  for (let n = MIN_DIAS; n <= MAX_DIAS; n++) {
    const label = `${n} dias (${LETRAS.slice(0, n).join(', ')})`;
    opcoesDiv.push(`<option value="${n}" ${n === nDefault ? 'selected' : ''}>${label}</option>`);
  }

  _mountEl.innerHTML = `
    <span class="ficha-voltar" id="trVoltar"><i data-lucide="arrow-left"></i> Voltar para os treinos</span>

    <div class="av-form-card">
      <div class="av-form-title">${t ? 'Editar' : 'Novo'} treino${t ? ` — <em>${esc(t.nome || '')}</em>` : ''}</div>
      <div class="av-grid">
        <div class="av-field" style="grid-column: 1 / -1;">
          <label>Nome do treino *</label>
          <input type="text" id="trNome" value="${esc(t?.nome || '')}" class="np-input" placeholder="Ex.: Hipertrofia — Fase 1">
        </div>
        <div class="av-field">
          <label>Data de início</label>
          <input type="date" id="trData" value="${t?.data_inicio || ''}" class="np-input">
        </div>
        <div class="av-field">
          <label>Divisão (nº de dias)</label>
          <select id="trDivisao" class="np-input">${opcoesDiv.join('')}</select>
        </div>
        <div class="av-field">
          <label>Status</label>
          <select id="trAtivo" class="np-input">
            <option value="1" ${!t || t.ativo ? 'selected' : ''}>Ativo</option>
            <option value="0" ${t && !t.ativo ? 'selected' : ''}>Inativo</option>
          </select>
        </div>
      </div>
      <div class="av-actions">
        <button class="btn primary" id="trSalvarDados">${t ? '<i data-lucide="save"></i> Salvar dados' : '<i data-lucide="plus"></i> Criar treino'}</button>
      </div>
    </div>

    ${t ? `
      <div class="tr-dias-tabs" id="trDiasTabs">
        ${_dias.map(d => `<button class="btn ${d === _diaSel ? 'primary' : ''}" data-dia="${d}">Dia ${d}</button>`).join('')}
      </div>
      <div id="trDiaConteudo"></div>
    ` : `
      <div class="form-warn" style="margin-top:16px;"><i data-lucide="lightbulb"></i> Preencha os dados e clique em <strong>Criar treino</strong> para liberar as abas dos dias e adicionar exercícios.</div>
    `}

    <datalist id="dlMetodos">${METODOS.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
  `;

  document.getElementById('trVoltar').addEventListener('click', () => renderLista());
  document.getElementById('trSalvarDados').addEventListener('click', salvarDados);

  if (t) {
    _mountEl.querySelectorAll('#trDiasTabs [data-dia]').forEach(b =>
      b.addEventListener('click', () => { _diaSel = b.dataset.dia; renderEditor(); }));
    renderDia();
  }
}

async function salvarDados() {
  const nome = (document.getElementById('trNome').value || '').trim();
  if (!nome) { mostrarToast('Informe o nome do treino'); return; }
  const n = Number(document.getElementById('trDivisao').value);
  const dados = {
    nome,
    data_inicio: document.getElementById('trData').value || null,
    divisao: LETRAS.slice(0, n).join(''),      // ex.: "ABC"
    ativo: document.getElementById('trAtivo').value === '1',
  };

  const btn = document.getElementById('trSalvarDados');
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    if (_treino) {
      // Aviso se reduziu dias e há exercícios em dias que somem
      const diasNovos = LETRAS.slice(0, n);
      const orfaos = _itens.filter(it => !diasNovos.includes(it.dia));
      if (orfaos.length && !confirm(
        `Reduzir para ${n} dias deixará ${orfaos.length} exercício(s) em dia(s) removido(s) — eles ficarão ocultos, mas não serão apagados. Continuar?`)) {
        btn.disabled = false; btn.innerHTML = orig; return;
      }
      const atualizado = await atualizarTreino(_treino.id, dados);
      _treino = { ..._treino, ...atualizado };
      mostrarToast('✓ Treino atualizado');
      await abrirEditor(_treino);
    } else {
      const nutriId = await getNutriId();
      const criado = await criarTreino(nutriId, { ...dados, paciente_id: _paciente.id });
      mostrarToast('✓ Treino criado');
      await abrirEditor(criado);
    }
  } catch (e) {
    alert('Erro ao salvar: ' + e.message);
    btn.disabled = false; btn.innerHTML = orig;
  }
}

// ═══════════════════════════════════════════════════════════
// NÍVEL 3 — Exercícios do dia selecionado
// ═══════════════════════════════════════════════════════════
function renderDia() {
  const cont = document.getElementById('trDiaConteudo');
  if (!cont) return;

  const doDia = _itens
    .filter(it => it.dia === _diaSel)
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));

  // Dropdown de adicionar exercício
  let addBox;
  if (!_biblioteca.length) {
    addBox = `<div class="form-warn">Sua biblioteca está vazia. Cadastre exercícios em
      <strong>Exercícios</strong> (menu lateral) antes de montar o treino.</div>`;
  } else {
    const ops = _biblioteca.map(ex =>
      `<option value="${esc(ex.nome)}">${ex.grupo_muscular ? esc(ex.grupo_muscular) : ''}</option>`).join('');
    addBox = `
      <div class="tr-add-row">
        <input id="trAddInput" class="np-input" list="dlBiblioteca" autocomplete="off"
          placeholder="Escolha na lista ou digite o nome do exercício...">
        <datalist id="dlBiblioteca">${ops}</datalist>
        <button class="btn primary" id="trAddBtn"><i data-lucide="plus"></i> Adicionar</button>
      </div>`;
  }

  const linhas = doDia.length
    ? doDia.map((it, i) => itemHtml(it, i, doDia.length)).join('')
    : `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="inbox"></i></div>Nenhum exercício no Dia ${_diaSel} ainda.</div>`;

  cont.innerHTML = `
    <div class="tr-dia-head">Dia <em>${_diaSel}</em> — ${doDia.length} exercício(s)</div>
    ${addBox}
    <div class="tr-ex-list">${linhas}</div>
  `;

  const addBtn = document.getElementById('trAddBtn');
  if (addBtn) addBtn.addEventListener('click', adicionarExercicio);

  // Listeners das linhas
  cont.querySelectorAll('[data-item-campo]').forEach(el =>
    el.addEventListener('change', () => salvarCampoItem(el)));
  // Atualiza a descrição do método ao vivo (input), antes mesmo de salvar
  cont.querySelectorAll('[data-item-campo="metodo"]').forEach(el =>
    el.addEventListener('input', () => atualizarDescMetodo(el)));
  cont.querySelectorAll('[data-item-del]').forEach(b =>
    b.addEventListener('click', () => removerItem(b.dataset.itemDel)));
  cont.querySelectorAll('[data-item-up]').forEach(b =>
    b.addEventListener('click', () => moverItem(b.dataset.itemUp, -1)));
  cont.querySelectorAll('[data-item-down]').forEach(b =>
    b.addEventListener('click', () => moverItem(b.dataset.itemDown, +1)));
  cont.querySelectorAll('[data-item-prog]').forEach(b =>
    b.addEventListener('click', () => toggleProg(b.dataset.itemProg)));

  // Reabre os painéis de progressão que estavam abertos antes do re-render
  _progAbertas.forEach(id => {
    const box = cont.querySelector(`[data-prog-box="${id}"]`);
    if (box) { box.hidden = false; carregarProg(id); }
    else _progAbertas.delete(id);
  });
}

function itemHtml(it, i, total) {
  const nome = it.exercicio?.nome || '(exercício)';
  const grupo = it.exercicio?.grupo_muscular ? ` · ${esc(it.exercicio.grupo_muscular)}` : '';
  const mi = metodoInfo(it.metodo);
  const campos = CAMPOS_ITEM.map(c => {
    if (c.select) {
      const cur = String(it[c.k] || '');
      const opts = c.options.slice();
      if (cur && !opts.includes(cur)) opts.unshift(cur);   // preserva método custom antigo
      const ops = ['<option value="">—</option>']
        .concat(opts.map(o => `<option value="${esc(o)}" ${cur === o ? 'selected' : ''}>${esc(o)}</option>`))
        .join('');
      return `<div class="av-field"><label>${c.label}</label>
        <select data-item-campo="${c.k}" data-item-id="${it.id}" class="np-input">${ops}</select></div>`;
    }
    return `<div class="av-field"><label>${c.label}</label>
      <input type="${c.type}" placeholder="${c.ph}" value="${esc(it[c.k] ?? '')}"
        data-item-campo="${c.k}" data-item-id="${it.id}" class="np-input"></div>`;
  }).join('');

  return `
    <div class="av-form-card tr-ex-card">
      <div class="tr-ex-head">
        <div class="tr-ex-nome"><span class="tr-ex-num">${i + 1}</span> ${esc(nome)}<span class="tr-ex-grupo">${grupo}</span></div>
        <div class="tr-ex-btns">
          <button class="patient-action" data-item-prog="${it.id}" title="Progressão de carga"><i data-lucide="chart-line"></i></button>
          <button class="patient-action" data-item-up="${it.id}" ${i === 0 ? 'disabled' : ''} title="Subir"><i data-lucide="chevron-up"></i></button>
          <button class="patient-action" data-item-down="${it.id}" ${i === total - 1 ? 'disabled' : ''} title="Descer"><i data-lucide="chevron-down"></i></button>
          <button class="patient-action patient-action-danger" data-item-del="${it.id}" title="Remover"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
      <div class="av-grid tr-ex-grid">${campos}</div>
      <div class="tr-metodo-desc" data-metodo-desc="${it.id}"${mi ? '' : ' style="display:none"'}>${mi ? `<i data-lucide="lightbulb"></i> <strong>${esc(mi.nome)}</strong> — ${esc(mi.desc)}` : ''}</div>
      <div class="av-field" style="margin-top:10px;">
        <label>Observação</label>
        <input type="text" placeholder="Ex.: unilateral, drop na última série..."
          value="${esc(it.observacao ?? '')}" data-item-campo="observacao" data-item-id="${it.id}" class="np-input">
      </div>
      <div class="tr-prog" data-prog-box="${it.id}" hidden></div>
    </div>`;
}

async function adicionarExercicio() {
  const input = document.getElementById('trAddInput');
  const val = (input.value || '').trim();
  if (!val) { mostrarToast('Escolha ou digite um exercício'); return; }

  // Resolve o texto (da lista ou digitado) para um exercício da biblioteca
  const alvo = val.toLowerCase();
  const ex = _biblioteca.find(e => (e.nome || '').trim().toLowerCase() === alvo);
  if (!ex) { mostrarToast('Exercício não encontrado na biblioteca'); return; }

  const ordem = _itens.filter(it => it.dia === _diaSel).length;   // vai pro fim da lista
  try {
    const nutriId = await getNutriId();
    await adicionarExercicioAoTreino(nutriId, {
      treino_id: _treino.id,
      exercicio_id: ex.id,
      dia: _diaSel,
      ordem,
    });
    _itens = await listarItensDoTreino(_treino.id);
    renderDia();
  } catch (e) { alert('Erro ao adicionar: ' + e.message); }
}

async function salvarCampoItem(el) {
  const id = el.dataset.itemId;
  const campo = el.dataset.itemCampo;
  let valor = (el.value || '').trim();
  let payload;
  if (campo === 'series') {
    payload = { series: valor === '' ? null : parseInt(valor, 10) };
  } else {
    payload = { [campo]: valor === '' ? null : valor };
  }
  try {
    await atualizarItem(id, payload);
    // atualiza o cache local sem re-render (não perde o foco do próximo campo)
    const it = _itens.find(x => x.id === id);
    if (it) Object.assign(it, payload);
    if (campo === 'metodo') atualizarDescMetodo(el);
    mostrarToast('✓ Salvo');
  } catch (e) { alert('Erro ao salvar: ' + e.message); }
}

// Atualiza (sem re-render) a caixinha de descrição do método da linha.
function atualizarDescMetodo(el) {
  const box = document.querySelector(`[data-metodo-desc="${el.dataset.itemId}"]`);
  if (!box) return;
  const mi = metodoInfo(el.value);
  if (mi) {
    box.style.display = '';
    box.innerHTML = `<i data-lucide="lightbulb"></i> <strong>${esc(mi.nome)}</strong> — ${esc(mi.desc)}`;
  } else {
    box.style.display = 'none';
    box.innerHTML = '';
  }
}

async function removerItem(id) {
  if (!confirm('Remover este exercício do treino?')) return;
  try {
    await excluirItem(id);
    _itens = await listarItensDoTreino(_treino.id);
    renderDia();
  } catch (e) { alert('Erro: ' + e.message); }
}

// Move um item para cima/baixo dentro do dia, trocando o campo `ordem` com o vizinho.
async function moverItem(id, dir) {
  const doDia = _itens.filter(it => it.dia === _diaSel).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  const i = doDia.findIndex(it => it.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= doDia.length) return;
  const a = doDia[i], b = doDia[j];
  try {
    // troca as ordens (usa o índice como ordem canônica para evitar empates)
    await Promise.all([atualizarItem(a.id, { ordem: j }), atualizarItem(b.id, { ordem: i })]);
    _itens = await listarItensDoTreino(_treino.id);
    renderDia();
  } catch (e) { alert('Erro ao reordenar: ' + e.message); }
}

// ───────────────────────────────────────────────────────────
// PROGRESSÃO DE CARGA (treino_progressao) — painel por exercício
// ───────────────────────────────────────────────────────────
function toggleProg(id) {
  const box = document.querySelector(`[data-prog-box="${id}"]`);
  if (!box) return;
  if (box.hidden) {
    box.hidden = false;
    _progAbertas.add(id);
    carregarProg(id);
  } else {
    box.hidden = true;
    box.innerHTML = '';
    _progAbertas.delete(id);
  }
}

async function carregarProg(id) {
  const box = document.querySelector(`[data-prog-box="${id}"]`);
  if (!box) return;
  box.innerHTML = '<div class="loading"><div class="spinner"></div>Carregando...</div>';
  try {
    const regs = await listarProgressao(id);   // já vem data desc
    renderProg(box, id, regs);
  } catch (e) {
    box.innerHTML = `<div class="form-warn"><i data-lucide="triangle-alert"></i> Erro: ${esc(e.message)}</div>`;
  }
}

function renderProg(box, id, regs) {
  const linhas = regs.length
    ? regs.map(r => `
        <div class="tr-prog-row">
          <span class="tr-prog-data">${fmtData(r.data)}</span>
          <span class="tr-prog-carga">${r.carga_realizada != null ? r.carga_realizada + ' kg' : '—'}</span>
          <span class="tr-prog-reps">${r.reps_realizadas != null ? r.reps_realizadas + ' reps' : '—'}</span>
          <span class="tr-prog-obs">${esc(r.observacao || '')}</span>
          <button class="patient-action patient-action-danger" data-p-del="${r.id}" title="Excluir"><i data-lucide="trash-2"></i></button>
        </div>`).join('')
    : '<div class="tr-prog-vazio">Nenhum registro ainda. Anote a carga de cada treino para acompanhar a evolução.</div>';

  box.innerHTML = `
    <div class="tr-prog-head"><i data-lucide="chart-line"></i> Progressão de carga</div>
    ${sparkline(regs)}
    <div class="tr-prog-add">
      <input type="date"   data-p="data"  value="${hoje()}" class="np-input" title="Data">
      <input type="number" data-p="carga" step="0.5" placeholder="Carga (kg)" class="np-input">
      <input type="number" data-p="reps"  placeholder="Reps" class="np-input">
      <input type="text"   data-p="obs"   placeholder="Obs (opcional)" class="np-input">
      <button class="btn primary" data-p-add><i data-lucide="plus"></i> Registrar</button>
    </div>
    <div class="tr-prog-list">${linhas}</div>
  `;

  box.querySelector('[data-p-add]').addEventListener('click', () => adicionarProg(id));
  box.querySelectorAll('[data-p-del]').forEach(b =>
    b.addEventListener('click', () => removerProg(b.dataset.pDel, id)));
}

// Mini-gráfico de evolução da carga (SVG inline). Só desenha com >= 2 pontos.
function sparkline(regs) {
  const pts = [...regs]
    .filter(r => r.carga_realizada != null)
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  if (pts.length < 2) return '';
  const w = 280, h = 56, pad = 8;
  const vals = pts.map(r => Number(r.carga_realizada));
  const min = Math.min(...vals), max = Math.max(...vals);
  const x = i => pad + i * (w - 2 * pad) / (pts.length - 1);
  const y = v => (max === min) ? h / 2 : (h - pad) - (v - min) / (max - min) * (h - 2 * pad);
  const poly = pts.map((_, i) => `${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`).join(' ');
  const dots = pts.map((_, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(vals[i]).toFixed(1)}" r="2.6"/>`).join('');
  const delta = vals[vals.length - 1] - vals[0];
  const sinal = delta > 0 ? `+${delta}` : `${delta}`;
  return `
    <div class="tr-prog-chart">
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="tr-spark">
        <polyline points="${poly}" />${dots}
      </svg>
      <div class="tr-prog-trend">${min} → ${max} kg · Δ ${sinal} kg em ${pts.length} registros</div>
    </div>`;
}

async function adicionarProg(id) {
  const box = document.querySelector(`[data-prog-box="${id}"]`);
  const val = k => (box.querySelector(`[data-p="${k}"]`)?.value || '').trim();
  const carga = val('carga'), reps = val('reps');
  if (carga === '' && reps === '') { mostrarToast('Informe ao menos a carga realizada'); return; }
  try {
    const nutriId = await getNutriId();
    await registrarProgressao(nutriId, {
      treino_exercicio_id: id,
      data: val('data') || hoje(),
      carga_realizada: carga === '' ? null : Number(carga),
      reps_realizadas: reps === '' ? null : parseInt(reps, 10),
      observacao: val('obs') || null,
    });
    mostrarToast('✓ Registro salvo');
    await carregarProg(id);
  } catch (e) { alert('Erro ao salvar: ' + e.message); }
}

async function removerProg(regId, itemId) {
  if (!confirm('Excluir este registro de carga?')) return;
  try {
    await excluirProgressao(regId);
    await carregarProg(itemId);
  } catch (e) { alert('Erro: ' + e.message); }
}

// ───────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────
// Deriva as letras dos dias a partir do treino + itens existentes.
function diasDoTreino(treino, itens) {
  const letras = String(treino.divisao || '').toUpperCase().replace(/[^A-G]/g, '');
  let n = 0;
  if (letras.startsWith('A')) n = new Set(letras.split('')).size;      // divisao "ABC" => 3
  // garante que cobre qualquer dia que já tenha exercício
  const maxItem = itens.reduce((m, it) => Math.max(m, LETRAS.indexOf(it.dia) + 1), 0);
  n = Math.max(n, maxItem, MIN_DIAS);
  n = Math.min(n, MAX_DIAS);
  return LETRAS.slice(0, n);
}

function divisaoLabel(divisao) {
  const letras = String(divisao || '').toUpperCase().replace(/[^A-G]/g, '');
  if (letras.startsWith('A')) {
    const n = new Set(letras.split('')).size;
    return `${n} dias`;
  }
  return divisao ? esc(divisao) : 'Sem divisão';
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtData = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
const hoje = () => new Date().toISOString().slice(0, 10);
