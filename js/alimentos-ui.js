// ═══════════════════════════════════════════════════════════
// BIBLIOTECA DE ALIMENTOS — UI (CRUD da tabela alimentos)
// ═══════════════════════════════════════════════════════════
// Autocontido: monta a tela da biblioteca (lista + form inline).
// Plugado no index.html via initAlimentosUI(nutriId).
// Gerencia os alimentos PRÓPRIOS do nutri em `foods` (valores por 100 g).

import {
  listarFoodsProprios, listarFoodsCatalogo, buscarFoods,
  criarFood, atualizarFood, excluirFood,
  listarMedidas, criarMedida, atualizarMedida, excluirMedida,
  listarFavoritos, listarIdsFavoritos, favoritar, desfavoritar,
} from './dieta.js';
import { mostrarToast, mostrarErro, confirmar } from './utils.js';

let _nutriId = null;
let _alimentos = [];       // acumulado na tela (cresce a cada "carregar mais")
let _termo = '';           // termo de busca atual
let _offset = 0;           // próximo registro a pedir ao banco
let _temMais = false;      // se o último lote veio cheio (pode haver mais)
let _carregando = false;   // trava contra requisições concorrentes
let _editandoId = null;    // id do alimento em edição (ou null = novo)
let _escopo = 'meus';      // 'meus' = próprios | 'favoritos' | 'catalogo' = tudo (inclui TACO)
let _medidasFoodId = null; // alimento com o painel de medidas aberto (ou null)
let _medidas = [];         // medidas do alimento aberto
let _favIds = new Set();   // ids favoritados, para desenhar a estrela

const PAGINA = 40;
// Busca no catálogo usa a RPC foods_buscar, que tem limite fixo e ordena por
// relevância — paginar por relevância não faz sentido, então mostramos o topo.
const LIMITE_BUSCA_CATALOGO = 50;

function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Sugestões (datalist) — texto livre continua permitido
const GRUPOS = [
  'Proteínas', 'Carboidratos', 'Gorduras', 'Frutas', 'Legumes e verduras',
  'Laticínios', 'Leguminosas', 'Oleaginosas', 'Bebidas', 'Suplementos', 'Outros',
];
const MEDIDAS = [
  '100 g', '1 unidade', '1 fatia', '1 colher de sopa', '1 colher de chá',
  '1 xícara', '1 concha', '1 filé', '1 scoop', '1 copo (200 ml)',
];

// ───────────────────────────────────────────────────────────
// ENTRADA: chamado pelo index.html ao abrir a aba
// ───────────────────────────────────────────────────────────
export async function initAlimentosUI(nutriId) {
  _nutriId = nutriId;
  _termo = '';
  _offset = 0;
  _alimentos = [];
  _temMais = false;
  _editandoId = null;
  _escopo = 'meus';
  _medidasFoodId = null;
  const page = document.getElementById('page-alimentos');
  if (!page) return;

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title"><i data-lucide="apple"></i> <em>Alimentos</em></h1>
      <div class="page-sub">Valores por 100 g. Você pode cadastrar <strong>medidas caseiras</strong> em qualquer alimento — inclusive nos da TACO.</div>
    </div>

    <div class="list-header">
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <button class="btn primary" id="alEscopoMeus" data-escopo="meus">Meus alimentos</button>
        <button class="btn" id="alEscopoFavoritos" data-escopo="favoritos"><i data-lucide="star"></i> Favoritos</button>
        <button class="btn" id="alEscopoCatalogo" data-escopo="catalogo">Catálogo completo</button>
      </div>
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <div class="search-box"><i data-lucide="search"></i> <input type="text" id="alSearch" placeholder="Buscar pelos meus alimentos..." /></div>
        <button class="btn primary" id="alBtnNovo"><i data-lucide="plus"></i> Novo alimento</button>
      </div>
    </div>

    <div id="alFormWrap"></div>
    <div id="alContainer"><div class="loading"><div class="spinner"></div>Carregando alimentos...</div></div>

    <datalist id="dlGruposAlim">${GRUPOS.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
    <datalist id="dlMedidas">${MEDIDAS.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
  `;

  document.getElementById('alBtnNovo').addEventListener('click', () => abrirForm(null));

  page.querySelectorAll('[data-escopo]').forEach(b =>
    b.addEventListener('click', () => trocarEscopo(b.dataset.escopo)));

  const buscar = debounce(() => {
    _termo = document.getElementById('alSearch').value.trim();
    recarregar();
  }, 300);
  document.getElementById('alSearch').addEventListener('input', buscar);

  await recarregar();
}

// Alterna entre "meus alimentos", favoritos e o catálogo inteiro (inclui TACO).
async function trocarEscopo(escopo) {
  if (escopo === _escopo) return;
  _escopo = escopo;
  _medidasFoodId = null;
  document.getElementById('alFormWrap').innerHTML = '';

  const PLACEHOLDER = {
    meus: 'Buscar pelos meus alimentos...',
    favoritos: 'Buscar nos favoritos...',
    catalogo: 'Buscar no catálogo (aipim, carne bovina, peixe...)',
  };
  const BOTOES = { meus: 'alEscopoMeus', favoritos: 'alEscopoFavoritos', catalogo: 'alEscopoCatalogo' };
  for (const [nome, id] of Object.entries(BOTOES)) {
    document.getElementById(id).className = (nome === _escopo) ? 'btn primary' : 'btn';
  }
  document.getElementById('alBtnNovo').style.display = _escopo === 'meus' ? '' : 'none';
  document.getElementById('alSearch').placeholder = PLACEHOLDER[_escopo];

  await recarregar();
}

async function recarregar() {
  _offset = 0;
  _alimentos = [];
  _temMais = false;
  // A lista muda: o painel aberto pode nem estar mais nela.
  _medidasFoodId = null;
  _medidas = [];
  await carregarPagina(true);
}

// Busca no catálogo passa pela RPC (sinônimos, plural, pontuação); o resto é
// listagem alfabética paginada direto na tabela. Favoritos são poucos por
// natureza: vêm de uma vez e o filtro roda no cliente.
async function buscarLote() {
  if (_escopo === 'meus') {
    return listarFoodsProprios({ termo: _termo, limite: PAGINA, offset: _offset });
  }
  if (_escopo === 'favoritos') {
    if (_offset > 0) return [];
    const favs = await listarFavoritos(200);
    if (!_termo) return favs;
    const t = _termo.toLowerCase();
    return favs.filter(f => String(f.nome || '').toLowerCase().includes(t));
  }
  if (_termo) return buscarFoods(_termo, LIMITE_BUSCA_CATALOGO);
  return listarFoodsCatalogo({ limite: PAGINA, offset: _offset });
}

// Sem paginação quando o resultado já vem completo ou truncado por relevância.
function podeCarregarMais(lote) {
  if (_escopo === 'favoritos') return false;
  if (_escopo === 'catalogo' && _termo) return false;
  return lote.length === PAGINA;
}

async function carregarPagina(primeira = false) {
  if (_carregando) return;
  _carregando = true;
  const cont = document.getElementById('alContainer');
  if (primeira && cont) {
    cont.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando alimentos...</div>`;
  }
  try {
    // Estrela: precisa dos ids favoritados junto com a lista.
    const [lote] = await Promise.all([
      buscarLote(),
      primeira ? carregarFavIds() : Promise.resolve(),
    ]);
    _alimentos = primeira ? lote : _alimentos.concat(lote);
    _offset += lote.length;
    _temMais = podeCarregarMais(lote);
    renderLista();
  } catch (e) {
    if (cont) cont.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>Erro ao carregar: ${esc(e.message)}</div>`;
  } finally {
    _carregando = false;
  }
}

// Best-effort: sem os ids a estrela só fica apagada, não vale quebrar a tela.
async function carregarFavIds() {
  try { _favIds = await listarIdsFavoritos(); } catch (e) { _favIds = new Set(); }
}

// ───────────────────────────────────────────────────────────
// LISTA
// ───────────────────────────────────────────────────────────
function renderLista() {
  const cont = document.getElementById('alContainer');
  if (!cont) return;

  if (!_alimentos.length) {
    cont.innerHTML = _termo
      ? `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="search-x"></i></div>
          Nenhum alimento encontrado para "<strong>${esc(_termo)}</strong>".</div>`
      : _escopo === 'catalogo'
        ? `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="inbox"></i></div>
            O catálogo está vazio. Rode <strong>db/foods_seed_taco.sql</strong> no Supabase para importar a TACO.</div>`
        : _escopo === 'favoritos'
          ? `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="star"></i></div>
              Nenhum favorito ainda. Marque a <strong>estrela</strong> nos alimentos que você mais usa —
              eles aparecem primeiro ao montar um plano.</div>`
          : `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="inbox"></i></div>
              Nenhum alimento cadastrado ainda. Clique em <strong>Novo alimento</strong> para começar.</div>`;
    return;
  }

  const maisBtn = _temMais
    ? `<div style="text-align:center; margin-top:16px;">
         <button class="btn" id="alCarregarMais"><i data-lucide="chevron-down"></i> Carregar mais</button>
       </div>`
    : '';

  // Busca no catálogo mostra só o topo por relevância — avisar em vez de deixar
  // o nutri achar que o resultado é a lista completa.
  const truncado = (_escopo === 'catalogo' && _termo && _alimentos.length === LIMITE_BUSCA_CATALOGO)
    ? `<div class="ex-hint" style="text-align:center; margin-top:12px;">
         Mostrando os ${LIMITE_BUSCA_CATALOGO} mais relevantes. Refine a busca para ver outros.</div>`
    : '';

  const corpo = _alimentos
    .map(al => rowHtml(al) + (al.id === _medidasFoodId ? medidasHtml(al) : ''))
    .join('');
  cont.innerHTML = `<div class="patients-grid">${corpo}</div>${maisBtn}${truncado}`;

  const maisEl = document.getElementById('alCarregarMais');
  if (maisEl) maisEl.addEventListener('click', async () => {
    maisEl.disabled = true;
    maisEl.innerHTML = 'Carregando...';
    await carregarPagina(false);
  });

  cont.querySelectorAll('[data-al-edit]').forEach(b =>
    b.addEventListener('click', () => abrirForm(_alimentos.find(x => x.id === b.dataset.alEdit))));
  cont.querySelectorAll('[data-al-del]').forEach(b =>
    b.addEventListener('click', () => remover(b.dataset.alDel, b.dataset.alNome)));
  cont.querySelectorAll('[data-al-med]').forEach(b =>
    b.addEventListener('click', () => alternarMedidas(b.dataset.alMed)));
  cont.querySelectorAll('[data-al-fav]').forEach(b =>
    b.addEventListener('click', () => alternarFavorito(b.dataset.alFav)));
  ligarPainelMedidas(cont);
}

// Favoritar/desfavoritar. Na aba Favoritos, desfavoritar tira o item da lista.
async function alternarFavorito(foodId) {
  const era = _favIds.has(foodId);
  try {
    if (era) {
      await desfavoritar(_nutriId, foodId);
      _favIds.delete(foodId);
    } else {
      await favoritar(_nutriId, foodId);
      _favIds.add(foodId);
    }
  } catch (e) {
    mostrarErro('Erro ao salvar o favorito: ' + e.message);
    return;
  }
  mostrarToast(era ? 'Removido dos favoritos' : '★ Adicionado aos favoritos');
  if (_escopo === 'favoritos' && era) {
    _alimentos = _alimentos.filter(a => a.id !== foodId);
    if (_medidasFoodId === foodId) { _medidasFoodId = null; _medidas = []; }
  }
  renderLista();
}

// Linha "Proteínas · por 100 g · 120 kcal · P 20 C 5 G 3"
function macroLinha(al) {
  const partes = [];
  if (al.subcategoria) partes.push(esc(al.subcategoria));
  partes.push('por 100 g');
  const macros = [];
  if (al.calorias != null) macros.push(`${fmtNum(al.calorias)} kcal`);
  const pcg = [
    al.proteina != null ? `P ${fmtNum(al.proteina)}` : '',
    al.carboidrato != null ? `C ${fmtNum(al.carboidrato)}` : '',
    al.gordura != null ? `G ${fmtNum(al.gordura)}` : '',
  ].filter(Boolean).join(' · ');
  if (pcg) macros.push(pcg);
  const linha = [partes.join(' · '), macros.join(' · ')].filter(Boolean).join(' — ');
  return linha || '—';
}

function rowHtml(al) {
  const proprio = !!al.nutri_id;   // alimento do catálogo global não é editável
  const aberto = al.id === _medidasFoodId;
  const fonte = (!proprio && al.fonte_dados && al.fonte_dados !== 'Proprio')
    ? ` <span class="ex-opt">${esc(al.fonte_dados)}</span>` : '';
  return `
    <div class="patient-row">
      <div class="patient-avatar"><i data-lucide="apple"></i></div>
      <div class="patient-info">
        <div class="patient-name">${esc(al.nome || '(sem nome)')}${fonte}</div>
        <div class="patient-meta">${macroLinha(al)}</div>
      </div>
      <button class="patient-action" data-al-fav="${al.id}"
              title="${_favIds.has(al.id) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}"
              style="${_favIds.has(al.id) ? 'color:var(--moss);' : ''}">
        <i data-lucide="star"></i>
      </button>
      <button class="patient-action" data-al-med="${al.id}">
        <i data-lucide="${aberto ? 'chevron-up' : 'ruler'}"></i> Medidas
      </button>
      ${proprio ? `
      <button class="patient-action primary" data-al-edit="${al.id}"><i data-lucide="pencil"></i> Editar</button>
      <button class="patient-action patient-action-danger" data-al-del="${al.id}" data-al-nome="${esc(al.nome || '')}"><i data-lucide="trash-2"></i></button>
      ` : ''}
    </div>`;
}

// ───────────────────────────────────────────────────────────
// MEDIDAS CASEIRAS — painel inline, abre sob a linha do alimento
// ───────────────────────────────────────────────────────────
// Funciona também nos alimentos da TACO: a medida é do nutri (nutri_id), o
// alimento continua global. Medidas com nutri_id nulo (vindas de seed) ficam
// em modo leitura, porque não pertencem a este nutri.
const GRID_MED = 'grid-template-columns: minmax(0,2fr) minmax(0,1fr) auto; align-items:end; gap:10px;';

function medidaRowHtml(m) {
  const editavel = !!m.nutri_id;
  return `
    <div class="av-grid" style="${GRID_MED} margin-bottom:8px;" data-med-row="${m.id}">
      <div class="av-field">
        <input type="text" class="np-input" data-med-desc value="${esc(m.descricao || '')}"
               list="dlMedidas" ${editavel ? '' : 'disabled'}>
      </div>
      <div class="av-field">
        <input type="number" step="0.1" inputmode="decimal" class="np-input" data-med-g
               value="${valNum(m.gramas)}" ${editavel ? '' : 'disabled'}>
      </div>
      <div style="display:flex; gap:6px; align-items:center;">
        ${editavel ? `
        <button class="btn" data-med-save="${m.id}" title="Salvar"><i data-lucide="save"></i></button>
        <button class="btn" data-med-del="${m.id}" title="Excluir"><i data-lucide="trash-2"></i></button>
        ` : `<span class="ex-opt">padrão</span>`}
      </div>
    </div>`;
}

function medidasHtml(al) {
  const lista = _medidas.length
    ? `<div class="av-grid" style="${GRID_MED} margin-bottom:4px;">
         <label style="font-size:11.5px; font-weight:600; color:var(--ink-soft);">Descrição</label>
         <label style="font-size:11.5px; font-weight:600; color:var(--ink-soft);">Gramas</label>
         <span></span>
       </div>
       ${_medidas.map(medidaRowHtml).join('')}`
    : `<div class="ex-hint">Nenhuma medida cadastrada para este alimento ainda.</div>`;

  return `
    <div class="av-form-card" style="margin-top:0;">
      <div class="av-form-title"><i data-lucide="ruler"></i> Medidas caseiras — ${esc(al.nome || '')}</div>
      <div class="ex-hint" style="margin-bottom:14px;">
        Quanto pesa cada porção, em gramas. Ex.: <strong>1 colher de sopa</strong> = 25 g.
      </div>

      ${lista}

      <div class="av-section" style="margin-top:18px;">Nova medida</div>
      <div class="av-grid" style="${GRID_MED}">
        <div class="av-field">
          <label>Descrição</label>
          <input type="text" id="medNovaDesc" class="np-input" list="dlMedidas" placeholder="1 colher de sopa">
        </div>
        <div class="av-field">
          <label>Gramas</label>
          <input type="number" step="0.1" inputmode="decimal" id="medNovaG" class="np-input" placeholder="25">
        </div>
        <button class="btn primary" id="medAdd"><i data-lucide="plus"></i> Adicionar</button>
      </div>

      <div class="av-actions" style="margin-top:16px;">
        <button class="btn" id="medFechar">Fechar</button>
      </div>
    </div>`;
}

async function alternarMedidas(foodId) {
  if (_medidasFoodId === foodId) { fecharMedidas(); return; }
  try {
    _medidas = await listarMedidas(foodId);
    _medidasFoodId = foodId;
    renderLista();
  } catch (e) {
    mostrarErro('Erro ao carregar as medidas: ' + e.message);
  }
}

function fecharMedidas() {
  _medidasFoodId = null;
  _medidas = [];
  renderLista();
}

function ligarPainelMedidas(cont) {
  const fechar = cont.querySelector('#medFechar');
  if (!fechar) return;   // painel não está aberto
  fechar.addEventListener('click', fecharMedidas);
  cont.querySelector('#medAdd').addEventListener('click', adicionarMedida);
  cont.querySelectorAll('[data-med-save]').forEach(b =>
    b.addEventListener('click', () => salvarMedida(b.dataset.medSave)));
  cont.querySelectorAll('[data-med-del]').forEach(b =>
    b.addEventListener('click', () => removerMedida(b.dataset.medDel)));
}

// Valida descrição + gramas. Devolve null (e avisa) se estiver inválido.
function lerMedida(desc, gramas) {
  const d = String(desc || '').trim();
  const g = num(gramas);
  if (!d) { mostrarToast('Informe a descrição da medida'); return null; }
  if (g == null || g <= 0) { mostrarToast('Informe quantos gramas essa medida tem'); return null; }
  return { descricao: d, gramas: g };
}

async function adicionarMedida() {
  const dados = lerMedida(
    document.getElementById('medNovaDesc').value,
    document.getElementById('medNovaG').value,
  );
  if (!dados) return;

  const btn = document.getElementById('medAdd');
  btn.disabled = true;
  try {
    const ordem = _medidas.length ? Math.max(..._medidas.map(m => m.ordem ?? 0)) + 1 : 0;
    await criarMedida(_nutriId, _medidasFoodId, { ...dados, ordem });
    _medidas = await listarMedidas(_medidasFoodId);
    mostrarToast('✓ Medida adicionada');
    renderLista();
  } catch (e) {
    mostrarErro('Erro ao adicionar a medida: ' + e.message);
    btn.disabled = false;
  }
}

async function salvarMedida(id) {
  const row = document.querySelector(`[data-med-row="${id}"]`);
  if (!row) return;
  const dados = lerMedida(
    row.querySelector('[data-med-desc]').value,
    row.querySelector('[data-med-g]').value,
  );
  if (!dados) return;

  try {
    await atualizarMedida(id, dados);
    _medidas = await listarMedidas(_medidasFoodId);
    mostrarToast('✓ Medida atualizada');
    renderLista();
  } catch (e) {
    mostrarErro('Erro ao salvar a medida: ' + e.message);
  }
}

async function removerMedida(id) {
  const m = _medidas.find(x => x.id === id);
  if (!(await confirmar({
    titulo: 'Excluir medida',
    mensagem: `Excluir a medida "${m?.descricao || ''}"?`,
    textoOk: 'Excluir', perigo: true,
  }))) return;
  try {
    await excluirMedida(id);
    _medidas = await listarMedidas(_medidasFoodId);
    mostrarToast('✓ Medida excluída');
    renderLista();
  } catch (e) {
    mostrarErro('Erro ao excluir a medida: ' + e.message);
  }
}

// ───────────────────────────────────────────────────────────
// FORMULÁRIO (novo / editar) — inline
// ───────────────────────────────────────────────────────────
function abrirForm(al) {
  _editandoId = al ? al.id : null;
  const wrap = document.getElementById('alFormWrap');

  wrap.innerHTML = `
    <div class="av-form-card" style="margin-bottom:18px;">
      <div class="av-form-title">${al ? 'Editar' : 'Novo'} alimento</div>

      <div class="av-grid">
        <div class="av-field" style="grid-column: 1 / -1;">
          <label>Nome *</label>
          <input type="text" id="alNome" value="${esc(al?.nome || '')}" class="np-input" placeholder="Ex.: Peito de frango grelhado">
        </div>
        <div class="av-field">
          <label>Grupo</label>
          <input type="text" id="alGrupo" value="${esc(al?.subcategoria || '')}" class="np-input" list="dlGruposAlim" placeholder="Ex.: Proteínas">
        </div>
      </div>

      <div class="av-section" style="margin-top:14px;">
        <div class="ex-hint" style="margin-bottom:8px;">Valores por <strong>100 g</strong> — usados para somar as calorias e macros do plano.</div>
        <div class="av-grid">
          <div class="av-field">
            <label>Calorias (kcal)</label>
            <input type="number" step="1" inputmode="decimal" id="alKcal" value="${valNum(al?.calorias)}" class="np-input" placeholder="Ex.: 165">
          </div>
          <div class="av-field">
            <label>Proteína (g)</label>
            <input type="number" step="0.1" inputmode="decimal" id="alProt" value="${valNum(al?.proteina)}" class="np-input" placeholder="Ex.: 31">
          </div>
          <div class="av-field">
            <label>Carboidrato (g)</label>
            <input type="number" step="0.1" inputmode="decimal" id="alCarb" value="${valNum(al?.carboidrato)}" class="np-input" placeholder="Ex.: 0">
          </div>
          <div class="av-field">
            <label>Gordura (g)</label>
            <input type="number" step="0.1" inputmode="decimal" id="alGord" value="${valNum(al?.gordura)}" class="np-input" placeholder="Ex.: 3.6">
          </div>
        </div>
      </div>

      <div class="av-field" style="margin-top:14px;">
        <label>Observações <span class="ex-opt">opcional</span></label>
        <textarea id="alObs" class="np-input" rows="3" style="resize:vertical"
          placeholder="Marca, preparo, dicas de substituição...">${esc(al?.descricao || '')}</textarea>
      </div>

      <div class="av-actions">
        <button class="btn" id="alCancelar">Cancelar</button>
        <button class="btn primary" id="alSalvar"><i data-lucide="save"></i> ${al ? 'Atualizar' : 'Salvar alimento'}</button>
      </div>
    </div>
  `;

  document.getElementById('alCancelar').addEventListener('click', () => { wrap.innerHTML = ''; });
  document.getElementById('alSalvar').addEventListener('click', salvar);
  document.getElementById('alNome').focus();
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function lerForm() {
  const g = id => (document.getElementById(id)?.value || '').trim();
  return {
    nome:         g('alNome'),
    subcategoria: g('alGrupo') || null,
    calorias:     num(g('alKcal')),
    proteina:     num(g('alProt')),
    carboidrato:  num(g('alCarb')),
    gordura:      num(g('alGord')),
    descricao:    g('alObs') || null,
  };
}

async function salvar() {
  const dados = lerForm();
  if (!dados.nome) { mostrarToast('Informe o nome do alimento'); return; }

  const btn = document.getElementById('alSalvar');
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    if (_editandoId) await atualizarFood(_editandoId, dados);
    else await criarFood(_nutriId, dados);
    mostrarToast('✓ Alimento salvo');
    document.getElementById('alFormWrap').innerHTML = '';
    await recarregar();
  } catch (e) {
    mostrarErro('Erro ao salvar: ' + e.message);
    btn.disabled = false; btn.innerHTML = orig;
  }
}

async function remover(id, nome) {
  if (!(await confirmar({
    titulo: 'Excluir alimento',
    mensagem: `Excluir o alimento "${nome || 'sem nome'}"?`,
    textoOk: 'Excluir', perigo: true,
  }))) return;
  try {
    await excluirFood(id);
    mostrarToast('✓ Alimento excluído');
    await recarregar();
  } catch (e) {
    const emUso = /foreign key|violates|restrict/i.test(e.message || '');
    mostrarErro(emUso
      ? 'Não dá para excluir: este alimento está sendo usado em um ou mais planos.'
      : 'Erro: ' + e.message);
  }
}

// ───────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Parse numérico tolerante (aceita vírgula). Vazio/ inválido => null.
function num(v) {
  const s = String(v ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
// Valor para o input (evita "null"/"undefined" no campo).
const valNum = v => (v == null ? '' : v);
// Exibe número enxuto (sem casas desnecessárias).
const fmtNum = v => (v == null ? '' : String(Math.round(Number(v) * 10) / 10));
