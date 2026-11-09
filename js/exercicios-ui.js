// ═══════════════════════════════════════════════════════════
// BIBLIOTECA DE EXERCÍCIOS — UI (CRUD da tabela exercicios)
// ═══════════════════════════════════════════════════════════
// Autocontido: monta a tela da biblioteca (lista + form inline).
// Plugado no index.html via initExerciciosUI(nutriId).

import {
  listarExercicios, criarExercicio, atualizarExercicio, excluirExercicio,
  listarTodosExercicios, obterInventarioAcademia,
} from './treinos.js';
import { mostrarToast, mostrarErro, confirmar } from './utils.js';
import { abrirMinhaAcademia, fecharMinhaAcademia } from './academia-ui.js';
import { recursosDisponiveis, cabeNaAcademia } from './academia-compat.js';

let _nutriId = null;
let _exercicios = [];      // acumulado na tela (cresce a cada "carregar mais")
let _termo = '';           // termo de busca atual
let _offset = 0;           // próximo registro a pedir ao banco
let _temMais = false;      // se o último lote veio cheio (pode haver mais)
let _carregando = false;   // trava contra requisições concorrentes
let _editandoId = null;    // id do exercício em edição (ou null = novo)

const PAGINA = 40;         // itens por lote

// Filtro "Todos" × "Minha academia". "Todos" pagina no banco (como sempre);
// "Minha academia" precisa da biblioteca inteira para decidir o que cabe no
// inventário (academia-compat.js), então carrega tudo uma vez e pagina aqui.
const CHAVE_FILTRO = 'evollo.exercicios.filtro';
let _filtro = 'todos';     // 'todos' | 'academia'
let _cacheTodos = null;    // biblioteca inteira (só no modo academia)
let _disp = null;          // Set de recursos disponíveis (null = sem inventário)
let _mostrar = PAGINA;     // quantos do recorte local estão na tela

function lerFiltro() {
  try { return localStorage.getItem(CHAVE_FILTRO) === 'academia' ? 'academia' : 'todos'; } catch { return 'todos'; }
}
function gravarFiltro(f) {
  try { localStorage.setItem(CHAVE_FILTRO, f); } catch {}
}

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
  _filtro = lerFiltro();
  _cacheTodos = null;
  _disp = null;
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
        <div class="ex-filtro" role="group" aria-label="Filtrar biblioteca">
          <button type="button" class="ex-filtro-btn" data-ex-filtro="todos"><i data-lucide="list"></i> Todos</button>
          <button type="button" class="ex-filtro-btn" data-ex-filtro="academia"><i data-lucide="warehouse"></i> Minha academia</button>
        </div>
        <button class="btn" id="exBtnInventario" title="Aparelhos e puxadores da sua academia"><i data-lucide="settings-2"></i> Inventário</button>
        <button class="btn primary" id="exBtnNovo"><i data-lucide="plus"></i> Novo exercício</button>
      </div>
    </div>
    <div class="ex-busca">
      <div class="search-box search-box-inteira"><i data-lucide="search"></i> <input type="text" id="exSearch" placeholder="Buscar por nome ou grupo..." /></div>
    </div>
    <div id="exResumo"></div>

    <div id="exFormWrap"></div>
    <div id="exContainer"><div class="loading"><div class="spinner"></div>Carregando exercícios...</div></div>

    <datalist id="dlGrupos">${GRUPOS.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
    <datalist id="dlEquip">${EQUIPAMENTOS.map(e => `<option value="${esc(e)}">`).join('')}</datalist>
  `;

  document.getElementById('exBtnNovo').addEventListener('click', async () => {
    if (await fecharMinhaAcademia()) abrirForm(null);
  });
  // Salvar o inventário muda o que cabe: no modo academia, refiltra na hora.
  // Já aberto, o botão só leva até ele — reabrir descartaria o que está editado.
  document.getElementById('exBtnInventario').addEventListener('click', () => {
    const wrap = document.getElementById('exFormWrap');
    if (wrap.querySelector('.acad')) { wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    abrirMinhaAcademia(wrap, _nutriId, {
      aoSalvar: () => { _disp = null; if (_filtro === 'academia') recarregar(); },
    });
  });
  // Cada botão tem a sua função: os filtros mostram a LISTA, então fecham o
  // inventário (que mora no mesmo #exFormWrap). Clicar no filtro já ativo
  // também fecha — é o jeito de "voltar para a lista".
  page.querySelectorAll('[data-ex-filtro]').forEach(b => b.addEventListener('click', async () => {
    if (!(await fecharMinhaAcademia())) return;   // editando e preferiu ficar
    if (_filtro === b.dataset.exFiltro) return;
    _filtro = b.dataset.exFiltro;
    gravarFiltro(_filtro);
    marcarFiltro();
    recarregar();
  }));
  marcarFiltro();

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
  _mostrar = PAGINA;
  if (_filtro === 'academia') await carregarAcademia();
  else { renderResumo(''); await carregarPagina(true); }
}

function marcarFiltro() {
  document.querySelectorAll('[data-ex-filtro]').forEach(b =>
    b.classList.toggle('active', b.dataset.exFiltro === _filtro));
}

function renderResumo(html) {
  const el = document.getElementById('exResumo');
  if (el) el.innerHTML = html;
}

// Modo "Minha academia": biblioteca inteira (cacheada) × inventário, filtrada
// e paginada aqui. `_disp` só é reaproveitado quando já é um Set.
async function carregarAcademia() {
  const cont = document.getElementById('exContainer');
  // Spinner só quando há o que buscar no banco: busca e "carregar mais" são
  // locais e não podem piscar a lista (a rolagem pularia para o topo).
  if (cont && (!_cacheTodos || !(_disp instanceof Set))) {
    cont.innerHTML = `<div class="loading"><div class="spinner"></div>Conferindo o que cabe na sua academia...</div>`;
  }
  try {
    if (!_cacheTodos) _cacheTodos = await listarTodosExercicios();
    if (!(_disp instanceof Set)) _disp = recursosDisponiveis(await obterInventarioAcademia());
  } catch (e) {
    if (cont) cont.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>Erro ao carregar: ${esc(e.message)}</div>`;
    return;
  }
  if (!_disp) {
    renderResumo('');
    if (cont) cont.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="warehouse"></i></div>
      Sem inventário da academia (ou nada marcado como disponível).<br>
      <button class="btn primary" id="exAbrirInv" style="margin-top:12px"><i data-lucide="settings-2"></i> Cadastrar inventário</button></div>`;
    document.getElementById('exAbrirInv')?.addEventListener('click', () => document.getElementById('exBtnInventario').click());
    return;
  }
  const cabem = _cacheTodos.filter(e => cabeNaAcademia(e, _disp));
  const t = norm(_termo);
  const recorte = t ? cabem.filter(e => norm(e.nome).includes(t) || norm(e.grupo_muscular).includes(t)) : cabem;
  _exercicios = recorte.slice(0, _mostrar);
  _temMais = recorte.length > _mostrar;
  renderResumo(`<div class="ex-resumo"><i data-lucide="warehouse"></i>
    <span><b>${cabem.length}</b> de ${_cacheTodos.length} exercícios cabem na sua academia${t ? ` · ${recorte.length} com "${esc(_termo)}"` : ''}.
    Exercício que pede algo "A confirmar" (ex.: banco móvel) aparece quando você marcar como disponível.</span></div>`);
  renderLista();
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

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
    if (_filtro === 'academia') { _mostrar += PAGINA; await carregarAcademia(); }
    else await carregarPagina(false);
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
    _cacheTodos = null;   // nome/equipamento mudou: o filtro da academia relê
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
    _cacheTodos = null;
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
