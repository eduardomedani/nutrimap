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
  listarExercicios, buscarExercicioPorNome,
  listarProgressao, registrarProgressao, excluirProgressao,
  listarModelos, prescreverModeloParaPaciente,
} from './treinos.js';
import { sb } from './supabase.js';
import { mostrarToast } from './utils.js';

// Debounce simples: só dispara `fn` depois de `ms` sem novas chamadas.
function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ── Estado do módulo ──
let _modo         = 'paciente';   // 'paciente' (prescrição) | 'modelo' (biblioteca)
let _nutriId      = null;
let _paciente     = null;
let _mountEl      = null;
let _bibVazia     = true;    // biblioteca sem nenhum exercício?
let _bibResultados = [];     // último lote da busca (cache p/ resolver o nome escolhido)
let _exSelecionado = null;   // exercício escolhido no autocomplete (resolve o "Adicionar" na hora)
let _treino       = null;    // treino em edição (null enquanto não criado)
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
  { k: 'metodo',     label: 'Método',      select: true,   options: METODOS },
];

// ───────────────────────────────────────────────────────────
// ENTRADA (chamada pela ficha.js)
// ───────────────────────────────────────────────────────────
export async function initTreinosUIParaPaciente(nutriId, paciente, mountId) {
  _modo = 'paciente';
  _nutriId = nutriId;
  _paciente = paciente;
  _mountEl = document.getElementById(mountId);
  _bibResultados = [];
  _treino = null;
  if (!_mountEl) return;
  await renderLista();
}

// Entrada da BIBLIOTECA de treinos (modelos reutilizáveis, sem paciente).
export async function initBibliotecaTreinos(nutriId, mountId) {
  _modo = 'modelo';
  _nutriId = nutriId;
  _paciente = null;
  _mountEl = document.getElementById(mountId);
  _bibResultados = [];
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
  const ehModelo = _modo === 'modelo';
  _mountEl.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando treinos...</div>`;
  let treinos;
  try {
    treinos = ehModelo ? await listarModelos() : await listarTreinosDoPaciente(_paciente.id);
  } catch (e) {
    _mountEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>Erro: ${esc(e.message)}</div>`;
    return;
  }

  const linhas = treinos.length
    ? treinos.map(t => {
        const meta = ehModelo
          ? `${esc(divisaoLabel(t.divisao))} · <span style="color:var(--ink-mute)">modelo reutilizável</span>`
          : `${esc(divisaoLabel(t.divisao))} ·
              ${t.ativo
                ? '<span style="color:var(--moss)"><i data-lucide="circle-check"></i> Ativo</span>'
                : '<span style="color:var(--ink-mute)"><i data-lucide="circle"></i> Inativo</span>'} ·
              início ${fmtData(t.data_inicio)}`;
        return `
        <div class="patient-row">
          <div class="patient-avatar"><i data-lucide="dumbbell"></i></div>
          <div class="patient-info">
            <div class="patient-name">${esc(t.nome || '(sem nome)')}</div>
            <div class="patient-meta">${meta}</div>
          </div>
          <button class="patient-action primary" data-tr-edit="${t.id}"><i data-lucide="pencil"></i> Abrir</button>
          <button class="patient-action patient-action-danger" data-tr-del="${t.id}" data-tr-nome="${esc(t.nome || '')}"><i data-lucide="trash-2"></i></button>
        </div>`;
      }).join('')
    : `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="inbox"></i></div>${
        ehModelo ? 'Nenhum modelo ainda. Clique em <strong>Novo modelo</strong>.'
                 : 'Nenhum treino ainda. Clique em <strong>Novo treino</strong>.'}</div>`;

  const header = ehModelo
    ? `<div class="page-header">
         <h1 class="page-title"><i data-lucide="list-checks"></i> <em>Treinos</em></h1>
         <div class="page-sub">Modelos reutilizáveis — monte uma vez e aplique em vários clientes</div>
       </div>
       <div class="list-header">
         <div class="list-title">Biblioteca de <em>treinos</em></div>
         <button class="btn primary" id="trBtnNovo"><i data-lucide="plus"></i> Novo modelo</button>
       </div>`
    : `<div class="list-header">
         <div class="list-title">Treinos de <em>${esc(_paciente.nome || _paciente.codigo)}</em></div>
         <div style="display:flex; gap:10px; flex-wrap:wrap;">
           <button class="btn" id="trBtnModelo"><i data-lucide="copy-plus"></i> Usar modelo</button>
           <button class="btn primary" id="trBtnNovo"><i data-lucide="plus"></i> Novo treino</button>
         </div>
       </div>`;

  _mountEl.innerHTML = `${header}<div class="patients-grid">${linhas}</div>`;

  document.getElementById('trBtnNovo').addEventListener('click', () => abrirEditor(null));
  const bModelo = document.getElementById('trBtnModelo');
  if (bModelo) bModelo.addEventListener('click', () => escolherModelo());
  _mountEl.querySelectorAll('[data-tr-edit]').forEach(b =>
    b.addEventListener('click', () => abrirEditor(treinos.find(t => t.id === b.dataset.trEdit))));
  _mountEl.querySelectorAll('[data-tr-del]').forEach(b =>
    b.addEventListener('click', () => removerTreino(b.dataset.trDel, b.dataset.trNome)));
}

async function removerTreino(id, nome) {
  const termo = _modo === 'modelo' ? 'modelo' : 'treino';
  if (!confirm(`Excluir o ${termo} "${nome || 'sem nome'}"?\nOs exercícios ${_modo === 'modelo' ? 'do modelo' : 'do treino'} também serão removidos.`)) return;
  try {
    await excluirTreino(id);
    mostrarToast(_modo === 'modelo' ? '✓ Modelo excluído' : '✓ Treino excluído');
    await renderLista();
  } catch (e) { alert('Erro: ' + e.message); }
}

// ── Aplicar um MODELO da biblioteca como treino do paciente ──
async function escolherModelo() {
  _mountEl.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando modelos...</div>`;
  let modelos;
  try {
    modelos = await listarModelos();
  } catch (e) {
    _mountEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>Erro: ${esc(e.message)}</div>`;
    return;
  }

  if (!modelos.length) {
    _mountEl.innerHTML = `
      <span class="ficha-voltar" id="mVoltar"><i data-lucide="arrow-left"></i> Voltar</span>
      <div class="empty-state"><div class="empty-state-icon"><i data-lucide="inbox"></i></div>
        Nenhum modelo na biblioteca ainda. Crie modelos em <strong>Treinos</strong> (menu lateral).</div>`;
    document.getElementById('mVoltar').addEventListener('click', () => renderLista());
    return;
  }

  _mountEl.innerHTML = `
    <span class="ficha-voltar" id="mVoltar"><i data-lucide="arrow-left"></i> Voltar</span>
    <div class="av-form-card">
      <div class="av-form-title">Usar modelo da biblioteca</div>
      <div class="av-field">
        <label>Escolha o modelo</label>
        <select id="mSel" class="np-input">
          ${modelos.map(m => `<option value="${m.id}">${esc(m.nome || '(sem nome)')} — ${esc(divisaoLabel(m.divisao))}</option>`).join('')}
        </select>
      </div>
      <div class="ex-hint" style="margin-top:8px;">Uma cópia do modelo será criada como treino deste cliente; editar aqui não altera o modelo.</div>
      <div class="av-actions">
        <button class="btn primary" id="mAplicar"><i data-lucide="copy-plus"></i> Criar treino a partir do modelo</button>
      </div>
    </div>`;

  document.getElementById('mVoltar').addEventListener('click', () => renderLista());
  document.getElementById('mAplicar').addEventListener('click', () => aplicarModelo(document.getElementById('mSel').value));
}

async function aplicarModelo(modeloId) {
  if (!modeloId) return;
  const btn = document.getElementById('mAplicar');
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Criando...';
  try {
    const novo = await prescreverModeloParaPaciente(modeloId, _paciente.id, {});
    mostrarToast('✓ Treino criado a partir do modelo');
    await abrirEditor(novo);
  } catch (e) {
    alert('Erro ao aplicar modelo: ' + e.message);
    btn.disabled = false; btn.innerHTML = orig;
  }
}

// ═══════════════════════════════════════════════════════════
// NÍVEL 2 — Criar / editar treino (+ seletor de divisões)
// ═══════════════════════════════════════════════════════════
async function abrirEditor(treino) {
  _treino = treino || null;
  _mountEl.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando...</div>`;

  try {
    // Só checa se a biblioteca tem algo (1 registro basta) — não carrega os 740.
    const amostra = await listarExercicios({ limite: 1 });
    _bibVazia = amostra.length === 0;
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
  const termo = _modo === 'modelo' ? 'modelo' : 'treino';
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
      <div class="av-form-title">${t ? 'Editar' : 'Novo'} ${termo}${t ? ` — <em>${esc(t.nome || '')}</em>` : ''}</div>
      <div class="av-grid">
        <div class="av-field" style="grid-column: 1 / -1;">
          <label>Nome do ${termo} *</label>
          <input type="text" id="trNome" value="${esc(t?.nome || '')}" class="np-input" placeholder="Ex.: Hipertrofia — Fase 1">
        </div>
        ${_modo === 'paciente' ? `
        <div class="av-field">
          <label>Data de início</label>
          <input type="date" id="trData" value="${t?.data_inicio || ''}" class="np-input">
        </div>` : ''}
        <div class="av-field">
          <label>Divisão (nº de dias)</label>
          <select id="trDivisao" class="np-input">${opcoesDiv.join('')}</select>
        </div>
        ${_modo === 'paciente' ? `
        <div class="av-field">
          <label>Status</label>
          <select id="trAtivo" class="np-input">
            <option value="1" ${!t || t.ativo ? 'selected' : ''}>Ativo</option>
            <option value="0" ${t && !t.ativo ? 'selected' : ''}>Inativo</option>
          </select>
        </div>` : ''}
      </div>
      <div class="av-actions">
        <button class="btn primary" id="trSalvarDados">${t ? '<i data-lucide="save"></i> Salvar dados' : `<i data-lucide="plus"></i> Criar ${termo}`}</button>
      </div>
    </div>

    ${t ? `
      <div class="tr-dias-tabs" id="trDiasTabs">
        ${_dias.map(d => `<button class="btn ${d === _diaSel ? 'primary' : ''}" data-dia="${d}">Dia ${d}</button>`).join('')}
      </div>
      <div id="trDiaConteudo"></div>
    ` : `
      <div class="form-warn" style="margin-top:16px;"><i data-lucide="lightbulb"></i> Preencha os dados e clique em <strong>Criar ${termo}</strong> para liberar as abas dos dias e adicionar exercícios.</div>
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
  const dataEl = document.getElementById('trData');    // ausente no modo modelo
  const ativoEl = document.getElementById('trAtivo');  // ausente no modo modelo
  const dados = {
    nome,
    data_inicio: dataEl ? (dataEl.value || null) : null,
    divisao: LETRAS.slice(0, n).join(''),      // ex.: "ABC"
    ativo: ativoEl ? (ativoEl.value === '1') : true,
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
      const extra = _modo === 'modelo' ? {} : { paciente_id: _paciente.id };
      const criado = await criarTreino(nutriId, { ...dados, ...extra });
      mostrarToast(_modo === 'modelo' ? '✓ Modelo criado' : '✓ Treino criado');
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

  // Dropdown de adicionar exercício — busca no banco conforme digita (não pré-carrega a biblioteca).
  let addBox;
  if (_bibVazia) {
    addBox = `<div class="form-warn">Sua biblioteca está vazia. Cadastre exercícios em
      <strong>Exercícios</strong> (menu lateral) antes de montar o treino.</div>`;
  } else {
    addBox = `
      <div class="tr-add-row">
        <div class="tr-ac" id="trAc">
          <input id="trAddInput" class="np-input" autocomplete="off" role="combobox"
            aria-autocomplete="list" aria-expanded="false"
            placeholder="Digite para buscar o exercício...">
          <div class="tr-ac-list" id="trAcList" hidden></div>
        </div>
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

  montarAutocomplete();

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
          ${_modo === 'paciente' ? `<button class="patient-action" data-item-prog="${it.id}" title="Progressão de carga"><i data-lucide="chart-line"></i></button>` : ''}
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
      ${_modo === 'paciente' ? `<div class="tr-prog" data-prog-box="${it.id}" hidden></div>` : ''}
    </div>`;
}

// ── Autocomplete customizado do campo "adicionar exercício" ──
// Dropdown estilizado (no lugar do <datalist> nativo), com busca debounced no
// banco, navegação por teclado (↑ ↓ Enter Esc) e realce do trecho buscado.
function montarAutocomplete() {
  const input = document.getElementById('trAddInput');
  const lista = document.getElementById('trAcList');
  if (!input || !lista) return;

  let ativo = -1;   // índice do item destacado (-1 = nenhum)

  const fechar = () => {
    lista.hidden = true;
    lista.innerHTML = '';
    ativo = -1;
    input.setAttribute('aria-expanded', 'false');
  };

  const escolher = (ex) => {
    if (!ex) return;
    _exSelecionado = ex;
    input.value = ex.nome || '';
    fechar();
    input.focus();
  };

  const pintar = () => {
    lista.querySelectorAll('.tr-ac-item').forEach((el, i) => {
      const on = i === ativo;
      el.classList.toggle('active', on);
      if (on) el.scrollIntoView({ block: 'nearest' });
    });
  };

  const desenhar = (termo) => {
    if (!_bibResultados.length) {
      lista.innerHTML = `<div class="tr-ac-empty">Nenhum exercício encontrado${termo ? ` para “${esc(termo)}”` : ''}.</div>`;
    } else {
      lista.innerHTML = _bibResultados.map((ex, i) => `
        <div class="tr-ac-item" data-i="${i}">
          <span class="tr-ac-nome">${realce(ex.nome || '(sem nome)', termo)}</span>
          ${ex.grupo_muscular ? `<span class="tr-ac-grupo">${esc(ex.grupo_muscular)}</span>` : ''}
        </div>`).join('');
      lista.querySelectorAll('.tr-ac-item').forEach(el => {
        const idx = +el.dataset.i;
        // mousedown (não click): dispara antes do blur do input, senão a lista fecharia antes de selecionar
        el.addEventListener('mousedown', (e) => { e.preventDefault(); escolher(_bibResultados[idx]); });
        el.addEventListener('mouseenter', () => { ativo = idx; pintar(); });
      });
    }
    ativo = -1;
    lista.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  const buscar = debounce(async (termo) => {
    try { _bibResultados = await listarExercicios({ termo, limite: 40 }); }
    catch { _bibResultados = []; }
    desenhar(termo);
  }, 300);

  input.addEventListener('input', () => {
    _exSelecionado = null;
    buscar(input.value.trim());
  });

  input.addEventListener('keydown', (e) => {
    if (lista.hidden) return;
    const n = lista.querySelectorAll('.tr-ac-item').length;
    if (e.key === 'ArrowDown')      { e.preventDefault(); if (n) { ativo = (ativo + 1) % n; pintar(); } }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); if (n) { ativo = (ativo - 1 + n) % n; pintar(); } }
    else if (e.key === 'Enter')     { if (ativo >= 0 && _bibResultados[ativo]) { e.preventDefault(); escolher(_bibResultados[ativo]); } }
    else if (e.key === 'Escape')    { fechar(); }
  });

  input.addEventListener('focus', () => {
    const t = input.value.trim();
    if (t && _bibResultados.length) desenhar(t);
  });
  input.addEventListener('blur', () => { setTimeout(fechar, 120); });
}

async function adicionarExercicio() {
  const input = document.getElementById('trAddInput');
  const val = (input.value || '').trim();
  if (!val) { mostrarToast('Escolha ou digite um exercício'); return; }

  // Resolve o texto para um exercício da biblioteca: 1) o escolhido no dropdown,
  // 2) o cache da última busca, 3) consulta ao banco pelo nome exato.
  const alvo = val.toLowerCase();
  let ex = (_exSelecionado && (_exSelecionado.nome || '').trim().toLowerCase() === alvo)
    ? _exSelecionado : null;
  if (!ex) ex = _bibResultados.find(e => (e.nome || '').trim().toLowerCase() === alvo);
  if (!ex) {
    try { ex = await buscarExercicioPorNome(val); } catch { ex = null; }
  }
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

// Escapa o texto e envolve o trecho buscado em <mark> (para realçar no dropdown).
function realce(texto, termo) {
  const t = esc(texto);
  const q = String(termo || '').trim();
  if (!q) return t;
  const qEsc = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');   // escapa metacaracteres de regex
  try {
    return t.replace(new RegExp(`(${qEsc})`, 'ig'), '<mark>$1</mark>');
  } catch {
    return t;
  }
}
const fmtData = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
const hoje = () => new Date().toISOString().slice(0, 10);
