// ═══════════════════════════════════════════════════════════
// BIBLIOTECA DE EXERCÍCIOS — UI (CRUD da tabela exercicios)
// ═══════════════════════════════════════════════════════════
// Autocontido: monta a tela da biblioteca (lista + form inline).
// Plugado no index.html via initExerciciosUI(nutriId).

import {
  listarExercicios, criarExercicio, atualizarExercicio, excluirExercicio
} from './treinos.js';
import { mostrarToast, mostrarErro, confirmar } from './utils.js';

let _nutriId = null;
let _exercicios = [];      // acumulado na tela (cresce a cada "carregar mais")
let _termo = '';           // termo de busca atual
let _offset = 0;           // próximo registro a pedir ao banco
let _temMais = false;      // se o último lote veio cheio (pode haver mais)
let _carregando = false;   // trava contra requisições concorrentes
let _editandoId = null;    // id do exercício em edição (ou null = novo)

const PAGINA = 40;         // itens por lote

// Debounce simples: só dispara `fn` depois de `ms` sem novas chamadas.
function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Sugestões (datalist) — texto livre continua permitido
const GRUPOS = [
  'Peito', 'Costas', 'Ombros', 'Bíceps', 'Tríceps', 'Antebraço',
  'Quadríceps', 'Posterior de coxa', 'Glúteos', 'Panturrilha',
  'Abdômen', 'Lombar', 'Cardio', 'Corpo inteiro',
];
const EQUIPAMENTOS = [
  'Peso corporal', 'Barra', 'Halter', 'Máquina', 'Polia/Cabo',
  'Smith', 'Elástico', 'Kettlebell', 'Anilha', 'Banco',
];

// ───────────────────────────────────────────────────────────
// ENTRADA: chamado pelo index.html ao abrir a aba
// ───────────────────────────────────────────────────────────
export async function initExerciciosUI(nutriId) {
  _nutriId = nutriId;
  _termo = '';
  _offset = 0;
  _exercicios = [];
  _temMais = false;
  _editandoId = null;
  const page = document.getElementById('page-exercicios');
  if (!page) return;

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title"><i data-lucide="dumbbell"></i> <em>Exercícios</em></h1>
      <div class="page-sub">Sua biblioteca de exercícios — a base para montar os treinos</div>
    </div>

    <div class="list-header">
      <div class="list-title">Biblioteca de <em>exercícios</em></div>
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <div class="search-box"><i data-lucide="search"></i> <input type="text" id="exSearch" placeholder="Buscar por nome ou grupo..." /></div>
        <button class="btn primary" id="exBtnNovo"><i data-lucide="plus"></i> Novo exercício</button>
      </div>
    </div>

    <div id="exFormWrap"></div>
    <div id="exContainer"><div class="loading"><div class="spinner"></div>Carregando exercícios...</div></div>

    <datalist id="dlGrupos">${GRUPOS.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
    <datalist id="dlEquip">${EQUIPAMENTOS.map(e => `<option value="${esc(e)}">`).join('')}</datalist>
  `;

  document.getElementById('exBtnNovo').addEventListener('click', () => abrirForm(null));

  // Debounce: espera ~300ms sem digitar antes de consultar o banco.
  const buscar = debounce(() => {
    _termo = document.getElementById('exSearch').value.trim();
    recarregar();
  }, 300);
  document.getElementById('exSearch').addEventListener('input', buscar);

  await recarregar();
}

// Zera a paginação e carrega o primeiro lote (usado no init, na busca e após CRUD).
async function recarregar() {
  _offset = 0;
  _exercicios = [];
  _temMais = false;
  await carregarPagina(true);
}

// Busca um lote no banco e acrescenta ao acumulado. `primeira` = mostra spinner e substitui.
async function carregarPagina(primeira = false) {
  if (_carregando) return;
  _carregando = true;
  const cont = document.getElementById('exContainer');
  if (primeira && cont) {
    cont.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando exercícios...</div>`;
  }
  try {
    const lote = await listarExercicios({ termo: _termo, limite: PAGINA, offset: _offset });
    _exercicios = primeira ? lote : _exercicios.concat(lote);
    _offset += lote.length;
    _temMais = lote.length === PAGINA;   // lote cheio => provavelmente há mais
    renderLista();
  } catch (e) {
    if (cont) cont.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>Erro ao carregar: ${esc(e.message)}</div>`;
  } finally {
    _carregando = false;
  }
}

// ───────────────────────────────────────────────────────────
// LISTA
// ───────────────────────────────────────────────────────────
function renderLista() {
  const cont = document.getElementById('exContainer');
  if (!cont) return;

  // _exercicios já vem filtrado pelo banco — nada de filtrar no navegador aqui.
  if (!_exercicios.length) {
    cont.innerHTML = _termo
      ? `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="search-x"></i></div>
          Nenhum exercício encontrado para "<strong>${esc(_termo)}</strong>".</div>`
      : `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="inbox"></i></div>
          Nenhum exercício cadastrado ainda. Clique em <strong>Novo exercício</strong> para começar.</div>`;
    return;
  }

  const maisBtn = _temMais
    ? `<div style="text-align:center; margin-top:16px;">
         <button class="btn" id="exCarregarMais"><i data-lucide="chevron-down"></i> Carregar mais</button>
       </div>`
    : '';

  cont.innerHTML = `<div class="patients-grid">${_exercicios.map(rowHtml).join('')}</div>${maisBtn}`;

  const maisEl = document.getElementById('exCarregarMais');
  if (maisEl) maisEl.addEventListener('click', async () => {
    maisEl.disabled = true;
    maisEl.innerHTML = 'Carregando...';
    await carregarPagina(false);
  });

  cont.querySelectorAll('[data-ex-edit]').forEach(b =>
    b.addEventListener('click', () => abrirForm(_exercicios.find(x => x.id === b.dataset.exEdit))));
  cont.querySelectorAll('[data-ex-del]').forEach(b =>
    b.addEventListener('click', () => remover(b.dataset.exDel, b.dataset.exNome)));
}

function rowHtml(ex) {
  const meta = [ex.grupo_muscular, ex.equipamento].filter(Boolean).join(' · ') || '—';
  const video = ex.video_url
    ? `<a class="patient-action" href="${esc(ex.video_url)}" target="_blank" rel="noopener" title="Ver vídeo"><i data-lucide="play"></i></a>`
    : '';
  return `
    <div class="patient-row">
      <div class="patient-avatar"><i data-lucide="dumbbell"></i></div>
      <div class="patient-info">
        <div class="patient-name">${esc(ex.nome || '(sem nome)')}</div>
        <div class="patient-meta">${esc(meta)}</div>
      </div>
      ${video}
      <button class="patient-action primary" data-ex-edit="${ex.id}"><i data-lucide="pencil"></i> Editar</button>
      <button class="patient-action patient-action-danger" data-ex-del="${ex.id}" data-ex-nome="${esc(ex.nome || '')}"><i data-lucide="trash-2"></i></button>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// FORMULÁRIO (novo / editar) — inline
// ───────────────────────────────────────────────────────────
function abrirForm(ex) {
  _editandoId = ex ? ex.id : null;
  const wrap = document.getElementById('exFormWrap');

  wrap.innerHTML = `
    <div class="av-form-card" style="margin-bottom:18px;">
      <div class="av-form-title">${ex ? 'Editar' : 'Novo'} exercício</div>

      <div class="av-grid">
        <div class="av-field" style="grid-column: 1 / -1;">
          <label>Nome *</label>
          <input type="text" id="exNome" value="${esc(ex?.nome || '')}" class="np-input" placeholder="Ex.: Supino reto com barra">
        </div>
        <div class="av-field">
          <label>Grupo muscular</label>
          <input type="text" id="exGrupo" value="${esc(ex?.grupo_muscular || '')}" class="np-input" list="dlGrupos" placeholder="Ex.: Peito">
        </div>
        <div class="av-field">
          <label>Equipamento</label>
          <input type="text" id="exEquip" value="${esc(ex?.equipamento || '')}" class="np-input" list="dlEquip" placeholder="Ex.: Barra">
        </div>
        <div class="av-field" style="grid-column: 1 / -1;">
          <label>Vídeo demonstrativo <span class="ex-opt">opcional</span></label>
          <input type="url" id="exVideo" value="${esc(ex?.video_url || '')}" class="np-input" placeholder="Cole o link (YouTube, Instagram, Drive...)">
          <div class="ex-hint">Aparece como ▶ na lista e ficará embutido no treino do aluno.</div>
        </div>
      </div>

      <div class="av-field" style="margin-top:16px;">
        <label>Observações <span class="ex-opt">opcional</span></label>
        <textarea id="exObs" class="np-input" rows="4" style="resize:vertical"
          placeholder="Execução, amplitude, cadência, cuidados, contraindicações...">${esc(ex?.observacoes || '')}</textarea>
        <div class="ex-hint">Anote dicas técnicas — o aluno vê junto do exercício na prescrição.</div>
      </div>

      <div class="av-actions">
        <button class="btn" id="exCancelar">Cancelar</button>
        <button class="btn primary" id="exSalvar"><i data-lucide="save"></i> ${ex ? 'Atualizar' : 'Salvar exercício'}</button>
      </div>
    </div>
  `;

  document.getElementById('exCancelar').addEventListener('click', () => { wrap.innerHTML = ''; });
  document.getElementById('exSalvar').addEventListener('click', salvar);
  document.getElementById('exNome').focus();
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function lerForm() {
  const g = id => (document.getElementById(id)?.value || '').trim();
  return {
    nome:           g('exNome'),
    grupo_muscular: g('exGrupo') || null,
    equipamento:    g('exEquip') || null,
    video_url:      g('exVideo') || null,
    observacoes:    g('exObs') || null,
  };
}

async function salvar() {
  const dados = lerForm();
  if (!dados.nome) { mostrarToast('Informe o nome do exercício'); return; }

  const btn = document.getElementById('exSalvar');
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    if (_editandoId) await atualizarExercicio(_editandoId, dados);
    else await criarExercicio(_nutriId, dados);
    mostrarToast('✓ Exercício salvo');
    document.getElementById('exFormWrap').innerHTML = '';
    await recarregar();
  } catch (e) {
    mostrarErro('Erro ao salvar: ' + e.message);
    btn.disabled = false; btn.innerHTML = orig;
  }
}

async function remover(id, nome) {
  if (!(await confirmar({
    titulo: 'Excluir exercício',
    mensagem: `Excluir o exercício "${nome || 'sem nome'}"?`,
    textoOk: 'Excluir', perigo: true,
  }))) return;
  try {
    await excluirExercicio(id);
    mostrarToast('✓ Exercício excluído');
    await recarregar();
  } catch (e) {
    // FK restrict: exercício em uso por algum treino
    const emUso = /foreign key|violates|restrict/i.test(e.message || '');
    mostrarErro(emUso
      ? 'Não dá para excluir: este exercício está sendo usado em um ou mais treinos.'
      : 'Erro: ' + e.message);
  }
}

// ───────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
