// ═══════════════════════════════════════════════════════════
// DIETA — UI (construtor de plano alimentar)
// ═══════════════════════════════════════════════════════════
// 3 níveis:
//   1) lista de planos (do paciente, ou modelos da biblioteca)
//   2) criar/editar plano (nome, objetivo, metas, datas)
//   3) refeições + itens (cada item escolhe um alimento da biblioteca)
// Totais de macros e metas ficam para a próxima etapa (um de cada vez).
//
// Plugado na ficha via initDietaUIParaPaciente(nutriId, paciente, mountId)
// e no menu via initBibliotecaDietas(nutriId, mountId).

import {
  listarPlanosDoPaciente, listarModelosDieta, buscarPlano,
  criarPlano, atualizarPlano, excluirPlano,
  listarRefeicoesDoPlano, criarRefeicao, atualizarRefeicao, excluirRefeicao,
  adicionarItem, atualizarItem, excluirItem,
  buscarFoods, buscarFood, listarMedidasDeVarios,
  listarFavoritos, listarRecentes, registrarUso,
  duplicarRefeicao, duplicarItem, reordenarItens, reordenarRefeicoes,
  prescreverModeloParaPaciente, salvarComoModelo,
} from './dieta.js';
import {
  pesoDeItem, quantidadeDePeso, gramasDeMedida, medidaDoItem, MEDIDA_GRAMAS,
  macrosItem, macrosRefeicao, macrosPlano, distribuicaoMacros,
  progresso, alertasPlano, intervaloMedioHoras,
  fmtKcal, fmtG, fmtQtd, num, arredonda,
} from './dieta-calc.js';
import { sb } from './supabase.js';
import { mostrarToast, mostrarToastDesfazer, mostrarErro, confirmar } from './utils.js';

function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Estado do módulo ──
let _modo      = 'paciente';   // 'paciente' | 'modelo'
let _nutriId   = null;
let _paciente  = null;
let _mountEl   = null;
let _plano     = null;         // plano em edição (null enquanto não criado)
let _refeicoes = [];           // refeições (com itens) do plano em edição
let _alimCache = new Map();    // nome(lower) -> alimento, cache do autocomplete
let _sugestoes = null;         // favoritos + recentes (cache; null = ainda não carregado)

// ── Estado da tela de prescrição ──
let _recolhidas = new Set();   // ids de refeições recolhidas
let _drawerRef  = null;        // refeição com o drawer de busca aberto (id) ou null
let _drawerAba  = 'alimentos'; // 'alimentos' | 'favoritos' | 'recentes'
let _medidasDe  = new Map();   // food_id -> medidas caseiras (cache por plano aberto)
let _salvando   = 0;           // requisições de escrita em voo (para o indicador)
let _statusSave = 'ocioso';    // 'ocioso' | 'salvando' | 'salvo' | 'erro'
let _dadosAberto = false;      // accordion dos dados administrativos do plano aberto
let _atalhosLigados = false;   // o listener global de atalhos é ligado uma vez só

/**
 * Busca um elemento DENTRO do mount deste módulo.
 *
 * Não use document.getElementById aqui: esta tela é montada em DOIS lugares —
 * a biblioteca de planos (#page-plano-alimentar) e a ficha do paciente
 * (#dietaFichaMount) — e as duas coexistem no DOM, porque .module-page só é
 * escondida com display:none, nunca destruída. Com um plano aberto nos dois,
 * há dois #plRefeicoes, dois #diAddRef etc., e getElementById devolve sempre o
 * primeiro do documento (a biblioteca, que vem antes no HTML) — mesmo quando
 * quem está na tela é a ficha. O render e os listeners iam para o container
 * errado, escondido.
 */
const qs = (id) => _mountEl?.querySelector('#' + id) || null;

const OBJETIVOS = ['Emagrecimento', 'Manutenção', 'Hipertrofia', 'Recomposição', 'Performance', 'Saúde'];
const REFEICOES_SUGERIDAS = ['Café da manhã', 'Lanche da manhã', 'Almoço', 'Lanche da tarde', 'Jantar', 'Ceia'];

// ───────────────────────────────────────────────────────────
// ENTRADAS
// ───────────────────────────────────────────────────────────
export async function initDietaUIParaPaciente(nutriId, paciente, mountId) {
  _modo = 'paciente';
  _nutriId = nutriId;
  _paciente = paciente;
  _mountEl = document.getElementById(mountId);
  _plano = null;
  _sugestoes = null;   // os favoritos podem ter mudado na aba Alimentos
  if (!_mountEl) return;
  await renderLista();
}

export async function initBibliotecaDietas(nutriId, mountId) {
  _modo = 'modelo';
  _nutriId = nutriId;
  _paciente = null;
  _mountEl = document.getElementById(mountId);
  _plano = null;
  _sugestoes = null;   // idem
  if (!_mountEl) return;
  await renderLista();
}

async function getNutriId() {
  if (_nutriId) return _nutriId;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Usuário não autenticado');
  _nutriId = user.id;
  return _nutriId;
}

// ═══════════════════════════════════════════════════════════
// NÍVEL 1 — Lista de planos
// ═══════════════════════════════════════════════════════════
async function renderLista() {
  const ehModelo = _modo === 'modelo';
  _mountEl.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando planos...</div>`;
  let planos;
  try {
    planos = ehModelo ? await listarModelosDieta() : await listarPlanosDoPaciente(_paciente.id);
  } catch (e) {
    _mountEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>Erro: ${esc(e.message)}</div>`;
    return;
  }

  const linhas = planos.length
    ? planos.map(p => {
        const periodo = p.data_fim
          ? `${fmtData(p.data_inicio)} → ${fmtData(p.data_fim)}`
          : (p.data_inicio ? `início ${fmtData(p.data_inicio)}` : '');
        const meta = ehModelo
          ? `${p.objetivo ? esc(p.objetivo) + ' · ' : ''}<span style="color:var(--ink-mute)">modelo reutilizável</span>`
          : [
              p.objetivo ? esc(p.objetivo) : '',
              p.ativo
                ? '<span style="color:var(--moss)"><i data-lucide="circle-check"></i> Ativo</span>'
                : '<span style="color:var(--ink-mute)"><i data-lucide="circle"></i> Inativo</span>',
              periodo,
            ].filter(Boolean).join(' · ');
        return `
        <div class="patient-row">
          <div class="patient-avatar"><i data-lucide="salad"></i></div>
          <div class="patient-info">
            <div class="patient-name">${esc(p.nome || '(sem nome)')}</div>
            <div class="patient-meta">${meta}</div>
          </div>
          <button class="patient-action primary" data-pl-edit="${p.id}"><i data-lucide="pencil"></i> Abrir</button>
          ${ehModelo ? '' : `<button class="patient-action" data-pl-lib="${p.id}" data-pl-nome="${esc(p.nome || '')}" title="Salvar na biblioteca como modelo"><i data-lucide="copy-plus"></i></button>`}
          <button class="patient-action patient-action-danger" data-pl-del="${p.id}" data-pl-nome="${esc(p.nome || '')}"><i data-lucide="trash-2"></i></button>
        </div>`;
      }).join('')
    : `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="inbox"></i></div>${
        ehModelo ? 'Nenhum modelo ainda. Clique em <strong>Novo modelo</strong>.'
                 : 'Nenhum plano ainda. Clique em <strong>Novo plano</strong>.'}</div>`;

  const header = ehModelo
    ? `<div class="page-header">
         <h1 class="page-title"><i data-lucide="salad"></i> <em>Planejamento Alimentar</em></h1>
         <div class="page-sub">Modelos reutilizáveis — monte uma vez e aplique em vários clientes</div>
       </div>
       <div class="list-header">
         <div class="list-title">Biblioteca de <em>planos</em></div>
         <button class="btn primary" id="plBtnNovo"><i data-lucide="plus"></i> Novo modelo</button>
       </div>`
    : `<div class="list-header">
         <div class="list-title">Planos de <em>${esc(_paciente.nome || _paciente.codigo || 'cliente')}</em></div>
         <div style="display:flex; gap:10px; flex-wrap:wrap;">
           <button class="btn" id="plBtnModelo"><i data-lucide="copy-plus"></i> Usar modelo</button>
           <button class="btn primary" id="plBtnNovo"><i data-lucide="plus"></i> Novo plano</button>
         </div>
       </div>`;

  _mountEl.innerHTML = `${header}<div class="patients-grid">${linhas}</div>`;

  qs('plBtnNovo').addEventListener('click', () => abrirEditor(null));
  const bModelo = qs('plBtnModelo');
  if (bModelo) bModelo.addEventListener('click', () => escolherModelo());
  _mountEl.querySelectorAll('[data-pl-edit]').forEach(b =>
    b.addEventListener('click', () => abrirEditor(planos.find(p => p.id === b.dataset.plEdit))));
  _mountEl.querySelectorAll('[data-pl-del]').forEach(b =>
    b.addEventListener('click', () => removerPlano(b.dataset.plDel, b.dataset.plNome)));
  _mountEl.querySelectorAll('[data-pl-lib]').forEach(b =>
    b.addEventListener('click', () => salvarPlanoNaBiblioteca(b.dataset.plLib, b.dataset.plNome, b)));
}

async function removerPlano(id, nome) {
  const termo = _modo === 'modelo' ? 'modelo' : 'plano';
  if (!(await confirmar({
    titulo: `Excluir ${termo}`,
    mensagem: `Excluir o ${termo} "${nome || 'sem nome'}"?\nAs refeições e itens também serão removidos.`,
    textoOk: 'Excluir', perigo: true,
  }))) return;
  try {
    await excluirPlano(id);
    mostrarToast(_modo === 'modelo' ? '✓ Modelo excluído' : '✓ Plano excluído');
    await renderLista();
  } catch (e) { mostrarErro('Erro: ' + e.message); }
}

async function salvarPlanoNaBiblioteca(id, nome, btn) {
  if (!(await confirmar({
    titulo: 'Salvar como modelo',
    mensagem: `Salvar "${nome || 'este plano'}" na biblioteca como modelo reutilizável?\nRefeições e itens são copiados.`,
    textoOk: 'Salvar',
  }))) return;
  if (btn) btn.disabled = true;
  try {
    await salvarComoModelo(id);
    mostrarToast('✓ Plano salvo na biblioteca');
  } catch (e) {
    mostrarErro('Erro: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Aplicar um MODELO da biblioteca como plano do paciente ──
async function escolherModelo() {
  _mountEl.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando modelos...</div>`;
  let modelos;
  try {
    modelos = await listarModelosDieta();
  } catch (e) {
    _mountEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>Erro: ${esc(e.message)}</div>`;
    return;
  }

  const linhas = modelos.length
    ? modelos.map(m => `
        <div class="patient-row">
          <div class="patient-avatar"><i data-lucide="salad"></i></div>
          <div class="patient-info">
            <div class="patient-name">${esc(m.nome || '(sem nome)')}</div>
            <div class="patient-meta">${m.objetivo ? esc(m.objetivo) : 'modelo'}</div>
          </div>
          <button class="btn primary" data-mod-apply="${m.id}"><i data-lucide="copy-plus"></i> Usar</button>
        </div>`).join('')
    : `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="inbox"></i></div>Nenhum modelo na biblioteca ainda.</div>`;

  _mountEl.innerHTML = `
    <span class="ficha-voltar" id="plVoltarLista"><i data-lucide="arrow-left"></i> Voltar</span>
    <div class="list-header"><div class="list-title">Escolha um <em>modelo</em></div></div>
    <div class="patients-grid">${linhas}</div>`;

  qs('plVoltarLista').addEventListener('click', () => renderLista());
  _mountEl.querySelectorAll('[data-mod-apply]').forEach(b =>
    b.addEventListener('click', () => aplicarModelo(b.dataset.modApply, b)));
}

async function aplicarModelo(modeloId, btn) {
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Aplicando...';
  try {
    const novo = await prescreverModeloParaPaciente(modeloId, _paciente.id, {});
    mostrarToast('✓ Plano criado a partir do modelo');
    await abrirEditor(novo);
  } catch (e) {
    mostrarErro('Erro: ' + e.message);
    btn.disabled = false; btn.innerHTML = orig;
  }
}

// ═══════════════════════════════════════════════════════════
// NÍVEL 2 — Editor do plano
// ═══════════════════════════════════════════════════════════
async function abrirEditor(plano) {
  _plano = plano || null;
  _drawerRef = null;
  _recolhidas.clear();
  _medidasDe.clear();
  _statusSave = 'ocioso';
  // Plano novo → dados abertos (é preciso preencher). Plano existente → recolhido,
  // para o nutri "cair" direto no ambiente de prescrição. (Também recolhe após salvar.)
  _dadosAberto = !_plano;

  if (_plano) {
    try {
      _refeicoes = await listarRefeicoesDoPlano(_plano.id);
      // Medidas de todos os itens numa query só — a tabela precisa delas para
      // converter peso <-> medida em cada linha.
      await carregarMedidasDe(_refeicoes.flatMap(r => (r.itens || []).map(i => i.food_id)));
    } catch (e) {
      _refeicoes = [];
      mostrarErro('Não foi possível carregar as refeições: ' + e.message);
    }
  } else {
    _refeicoes = [];
  }
  renderEditor();
  ligarAtalhos();
}

function renderEditor() {
  const t = _plano;
  const termo = _modo === 'modelo' ? 'modelo' : 'plano';

  _mountEl.innerHTML = `
    <span class="ficha-voltar" id="plVoltar"><i data-lucide="arrow-left"></i> Voltar para os planos</span>

    <div id="plDadosMount"></div>

    ${t ? `<div id="plRefeicoes"></div>` : `
      <div class="form-warn" style="margin-top:16px;"><i data-lucide="lightbulb"></i> Preencha os dados e clique em <strong>Criar ${termo}</strong> para liberar as refeições.</div>
    `}

    <datalist id="dlObjetivos">${OBJETIVOS.map(o => `<option value="${esc(o)}">`).join('')}</datalist>
    <datalist id="dlRefeicoes">${REFEICOES_SUGERIDAS.map(r => `<option value="${esc(r)}">`).join('')}</datalist>
  `;

  qs('plVoltar').addEventListener('click', () => renderLista());
  montarDadosCard();
  if (t) renderRefeicoes();
}

// ── Card de dados administrativos (accordion) ─────────────────────────────
// Fechado: resumo compacto (nome · objetivo · status · período) + "Editar".
// Aberto: o formulário completo. O foco da tela é a prescrição, não isto.
function montarDadosCard() {
  const mount = qs('plDadosMount');
  if (!mount) return;
  if (!_plano) _dadosAberto = true;   // criar exige o formulário aberto
  mount.innerHTML = _dadosAberto ? dadosCardAbertoHtml() : dadosCardFechadoHtml();
  if (_dadosAberto) ligarDadosAberto(mount);
  else ligarDadosFechado(mount);
}

function fmtPeriodo(t) {
  if (!t) return '';
  if (t.data_inicio && t.data_fim) return `${fmtData(t.data_inicio)} – ${fmtData(t.data_fim)}`;
  if (t.data_inicio) return `desde ${fmtData(t.data_inicio)}`;
  return '';
}

function dadosCardFechadoHtml() {
  const t = _plano || {};
  const periodo = fmtPeriodo(t);
  return `
    <div class="pl-dados-min">
      <div class="pl-dados-min-info">
        <div class="pl-dados-eyebrow">Dados do plano</div>
        <div class="pl-dados-min-nome">${esc(t.nome || 'Plano sem nome')} ${estadoChipHtml()}</div>
        <div class="pl-dados-min-tags">
          ${t.objetivo ? `<span class="pl-tag"><i data-lucide="target"></i> ${esc(t.objetivo)}</span>` : ''}
          ${periodo ? `<span class="pl-tag"><i data-lucide="calendar"></i> ${periodo}</span>` : ''}
        </div>
      </div>
      <button class="btn" id="plDadosEditar"><i data-lucide="pencil"></i> Editar</button>
    </div>`;
}

function dadosCardAbertoHtml() {
  const t = _plano;
  const termo = _modo === 'modelo' ? 'modelo' : 'plano';
  return `
    <div class="av-form-card pl-dados-form">
      <div class="pl-dados-head">
        <div class="av-form-title">${t ? `Editar: <em>${esc(t.nome || '')}</em>` : `Novo ${termo}`}</div>
        ${t ? `<button class="btn di-mini-btn" id="plDadosRecolher" title="Recolher os dados"><i data-lucide="chevrons-down-up"></i> Recolher</button>` : ''}
      </div>
      <div class="av-grid">
        <div class="av-field" style="grid-column: 1 / -1;">
          <label>Nome do ${termo} *</label>
          <input type="text" id="plNome" value="${esc(t?.nome || '')}" class="np-input" placeholder="Ex.: Emagrecimento — Fase 1">
        </div>
        <div class="av-field" style="grid-column: span 2;">
          <label>Objetivo</label>
          <input type="text" id="plObjetivo" value="${esc(t?.objetivo || '')}" class="np-input" list="dlObjetivos" placeholder="Ex.: Emagrecimento">
        </div>
        ${_modo === 'paciente' ? `
        <div class="av-field">
          <label>Data de início</label>
          <input type="date" id="plData" value="${t?.data_inicio || ''}" class="np-input">
        </div>
        <div class="av-field">
          <label>Dias</label>
          <input type="number" min="1" step="1" id="plDias" value="${(t?.data_inicio && t?.data_fim) ? diffDias(t.data_inicio, t.data_fim) + 1 : ''}" class="np-input" placeholder="Ex.: 30">
        </div>
        <div class="av-field">
          <label>Data de término</label>
          <input type="date" id="plDataFim" value="${t?.data_fim || ''}" class="np-input">
        </div>
        <div class="av-field">
          <label>Status</label>
          <select id="plAtivo" class="np-input ${(!t || t.ativo) ? 'pl-status-ativo' : 'pl-status-inativo'}">
            <option value="1" ${!t || t.ativo ? 'selected' : ''}>Ativo</option>
            <option value="0" ${t && !t.ativo ? 'selected' : ''}>Inativo</option>
          </select>
        </div>` : ''}
      </div>

      <div class="di-metas-ro">
        <div class="di-metas-ro-head">
          <span class="di-metas-ro-tit"><i data-lucide="flame"></i> Metas nutricionais</span>
          <span class="di-metas-ro-hint">definidas na aba <strong>Cálculo de Calorias</strong></span>
        </div>
        <div class="di-metas-ro-grid">
          <div><span>Calorias</span><b>${t?.kcal_meta != null ? Math.round(t.kcal_meta) + ' kcal' : '—'}</b></div>
          <div><span>Proteína</span><b>${t?.prot_meta != null ? Math.round(t.prot_meta) + ' g' : '—'}</b></div>
          <div><span>Carboidrato</span><b>${t?.carb_meta != null ? Math.round(t.carb_meta) + ' g' : '—'}</b></div>
          <div><span>Gordura</span><b>${t?.gord_meta != null ? Math.round(t.gord_meta) + ' g' : '—'}</b></div>
        </div>
      </div>

      <div class="av-field" style="margin-top:12px;">
        <label>Observações <span class="ex-opt">opcional</span></label>
        <textarea id="plObs" class="np-input" rows="2" style="resize:vertical" placeholder="Orientações gerais do plano...">${esc(t?.observacoes || '')}</textarea>
      </div>

      <div class="av-actions">
        <button class="btn primary" id="plSalvarDados">${t ? '<i data-lucide="save"></i> Salvar dados' : `<i data-lucide="plus"></i> Criar ${termo}`}</button>
      </div>
    </div>`;
}

function ligarDadosFechado(mount) {
  mount.querySelector('#plDadosEditar')?.addEventListener('click', () => {
    _dadosAberto = true;
    montarDadosCard();
  });
}

function ligarDadosAberto(mount) {
  mount.querySelector('#plSalvarDados')?.addEventListener('click', () => salvarDados());
  mount.querySelector('#plDadosRecolher')?.addEventListener('click', () => {
    _dadosAberto = false;
    montarDadosCard();
  });

  // Vínculo Data de início ↔ Dias ↔ Data de término (só no modo paciente).
  const elIni = mount.querySelector('#plData');
  const elDias = mount.querySelector('#plDias');
  const elFim = mount.querySelector('#plDataFim');
  if (elIni && elDias && elFim) {
    const fimPorDias = () => {
      const n = Number(elDias.value);
      if (elIni.value && n >= 1) elFim.value = addDias(elIni.value, n - 1);
    };
    const diasPorFim = () => {
      if (elIni.value && elFim.value) {
        const d = diffDias(elIni.value, elFim.value) + 1;
        elDias.value = d >= 1 ? d : '';
      }
    };
    elDias.addEventListener('input', fimPorDias);
    elFim.addEventListener('change', diasPorFim);
    elIni.addEventListener('change', () => { if (elDias.value) fimPorDias(); else diasPorFim(); });
  }

  // Cor do Status: Ativo = verde, Inativo = vermelho.
  const elStatus = mount.querySelector('#plAtivo');
  if (elStatus) {
    const corStatus = () => {
      const ativo = elStatus.value === '1';
      elStatus.classList.toggle('pl-status-ativo', ativo);
      elStatus.classList.toggle('pl-status-inativo', !ativo);
    };
    elStatus.addEventListener('change', corStatus);
    corStatus();
  }
}

// Lê o formulário administrativo. Quando o card está RECOLHIDO os inputs não
// existem: cada campo então cai no valor atual do _plano (nada mudou lá).
function lerDados() {
  const g = id => (qs(id)?.value || '').trim();
  const t = _plano || {};
  const dataEl = qs('plData');
  const dataFimEl = qs('plDataFim');
  const ativoEl = qs('plAtivo');
  const dataInicio = dataEl ? (dataEl.value || null) : (t.data_inicio ?? null);
  const dataFim = dataFimEl ? (dataFimEl.value || null) : (t.data_fim ?? null);
  // Metas (kcal/macros) NÃO entram aqui de propósito: vêm do Cálculo de Calorias.
  return {
    nome:        qs('plNome') ? g('plNome') : (t.nome || ''),
    objetivo:    qs('plObjetivo') ? (g('plObjetivo') || null) : (t.objetivo ?? null),
    data_inicio: dataInicio,
    data_fim:    dataFim,
    ativo:       ativoEl ? (ativoEl.value === '1') : (t.ativo ?? true),
    observacoes: qs('plObs') ? (g('plObs') || null) : (t.observacoes ?? null),
    _dataInicio: dataInicio, _dataFim: dataFim,
  };
}

async function salvarDados(override = {}) {
  const dados = { ...lerDados(), ...override };
  if (!dados.nome) { mostrarToast('Informe o nome do plano'); return; }
  if (dados._dataInicio && dados._dataFim && dados._dataFim < dados._dataInicio) {
    mostrarToast('A data de término não pode ser antes do início'); return;
  }
  delete dados._dataInicio; delete dados._dataFim;

  // O botão pode estar no card de dados (aberto) OU ausente (salvo pela barra
  // com o card recolhido) — por isso o indicador de autosave também é atualizado.
  const btn = qs('plSalvarDados');
  const orig = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
  marcarSave('salvando');
  try {
    if (_plano) {
      const atualizado = await atualizarPlano(_plano.id, dados);
      _plano = { ..._plano, ...atualizado };
      mostrarToast('✓ Plano atualizado');
      await abrirEditor(_plano);   // recolhe o card de dados e volta à prescrição
    } else {
      const nutriId = await getNutriId();
      const extra = _modo === 'modelo' ? {} : { paciente_id: _paciente.id };
      const criado = await criarPlano(nutriId, { ...dados, ...extra });
      mostrarToast(_modo === 'modelo' ? '✓ Modelo criado' : '✓ Plano criado');
      await abrirEditor(criado);
    }
    marcarSave('salvo');
  } catch (e) {
    mostrarErro('Erro ao salvar: ' + e.message);
    marcarSave('erro');
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
  }
}

// ═══════════════════════════════════════════════════════════
// NÍVEL 3 — Prescrição (refeições, itens, resumo)
// ═══════════════════════════════════════════════════════════
// Layout: coluna principal (cards de refeição) + resumo sticky à direita.
// No mobile o resumo vira uma barra fixa embaixo, expansível.
//
// Toda a matemática mora em dieta-calc.js. Aqui é só render + eventos.
// Lembrete do contrato: item.quantidade é MÚLTIPLO DE 100 g, não gramas.

function renderRefeicoes() {
  const cont = qs('plRefeicoes');
  if (!cont) return;

  cont.innerHTML = `
    <div class="di-rx">
      <div class="di-rx-main">
        ${resumoBarHtml()}
        ${secaoPrescricaoHtml()}
        <div class="di-refeicoes">${refeicoesHtml()}</div>
        ${novaRefeicaoHtml()}
      </div>
    </div>
    ${_drawerRef ? drawerHtml() : ''}
  `;

  ligarBarra(cont);
  ligarRefeicoes(cont);
  ligarNovaRefeicao(cont);
  if (_drawerRef) ligarDrawer(cont);
}

// ───────────────────────────────────────────────────────────
// BARRA DE RESUMO NUTRICIONAL (sticky) — macros sempre à vista + ações
// ───────────────────────────────────────────────────────────
function resumoBarHtml() {
  const p = _plano || {};
  const tot = macrosPlano(_refeicoes);
  const pk = progresso(tot.kcal, p.kcal_meta);
  const n = _refeicoes.length;

  const metric = (lbl, val, sub) => `
    <div class="di-rb-metric">
      <span class="di-rb-lbl">${lbl}</span>
      <span class="di-rb-val">${val}</span>
      ${sub ? `<span class="di-rb-sub">${sub}</span>` : ''}
    </div>`;

  const macro = (lbl, atual, meta) => {
    const pr = progresso(atual, meta);
    const sub = pr.temMeta
      ? `<span class="di-txt-${pr.status}">${pr.pctReal}%</span> · meta ${fmtG(meta)} g`
      : 'sem meta';
    return metric(lbl, `${fmtG(atual)} <em>g</em>`, sub);
  };

  return `
    <div class="di-resumo-bar" id="diResumoBar" role="region" aria-label="Resumo nutricional do plano">
      <div class="di-rb-metrics">
        <div class="di-rb-metric di-rb-kcal">
          <span class="di-rb-lbl">Calorias</span>
          <span class="di-rb-val">${fmtKcal(tot.kcal)}${pk.temMeta ? ` <em>/ ${fmtKcal(p.kcal_meta)}</em>` : ' <em>kcal</em>'}</span>
          ${pk.temMeta
            ? `<div class="di-bar di-bar-${pk.status}" role="progressbar" aria-valuenow="${pk.pctReal}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pk.pct}%"></span></div>`
            : '<span class="di-rb-sub">defina no cálculo</span>'}
        </div>
        ${macro('Proteína', tot.prot, p.prot_meta)}
        ${macro('Carboidrato', tot.carb, p.carb_meta)}
        ${macro('Gordura', tot.gord, p.gord_meta)}
        ${metric('Refeições', n, tot.fibra > 0 ? `${fmtG(tot.fibra)} g de fibra` : '')}
        ${metric('Meta atingida',
            pk.temMeta ? `<span class="di-txt-${pk.status}">${pk.pctReal}%</span>` : '—',
            pk.temMeta
              ? (pk.resta > 0 ? `faltam ${fmtKcal(pk.resta)} kcal` : pk.excedeu > 0 ? `${fmtKcal(pk.excedeu)} kcal acima` : 'na meta')
              : 'sem meta definida')}
      </div>
      <div class="di-rb-acts">
        <span class="di-save" id="diSave" role="status" aria-live="polite">${saveStatusHtml()}</span>
        ${_modo === 'paciente'
          ? `<button class="btn di-rb-calc" id="diEditarCalc" title="Editar metas na aba Cálculo de Calorias"><i data-lucide="calculator"></i> Editar cálculo</button>`
          : ''}
        <button class="btn" id="diSalvarRasc" title="Salvar mantendo como rascunho (Ctrl+S)">Salvar rascunho</button>
        ${_modo === 'paciente'
          ? `<button class="btn primary" id="diPublicar" title="Salvar e marcar o plano como ativo">Salvar e publicar</button>`
          : ''}
        <div class="di-menu-wrap">
          <button class="btn di-menu-btn" id="diMaisBtn" aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações">
            <i data-lucide="ellipsis"></i>
          </button>
          <div class="di-menu" id="diMais" role="menu" hidden>
            <button role="menuitem" data-mais="duplicar"><i data-lucide="copy-plus"></i> Duplicar plano na biblioteca</button>
            <button role="menuitem" data-mais="imprimir"><i data-lucide="printer"></i> Gerar PDF (imprimir)</button>
            <button role="menuitem" data-mais="recolher"><i data-lucide="chevrons-down-up"></i> Recolher todas</button>
            <button role="menuitem" data-mais="expandir"><i data-lucide="chevrons-up-down"></i> Expandir todas</button>
            <button role="menuitem" data-mais="atalhos"><i data-lucide="keyboard"></i> Atalhos do teclado</button>
          </div>
        </div>
      </div>
    </div>`;
}

function secaoPrescricaoHtml() {
  return `
    <div class="di-secao">
      <h3 class="di-secao-tit"><i data-lucide="utensils"></i> Prescrição alimentar</h3>
      ${estadoChipHtml()}
    </div>`;
}

// O banco só tem `ativo` (boolean). "Rascunho/arquivado" não existe: não invento
// estado que não dá para persistir.
function estadoChipHtml() {
  if (_modo === 'modelo') return `<span class="di-chip">modelo</span>`;
  return _plano?.ativo
    ? `<span class="di-chip di-chip-on">ativo</span>`
    : `<span class="di-chip">inativo</span>`;
}

function saveStatusHtml() {
  const M = {
    salvando: '<i data-lucide="loader"></i> Salvando...',
    salvo: '<i data-lucide="check"></i> Alterações salvas',
    erro: '<i data-lucide="triangle-alert"></i> Erro ao salvar',
    ocioso: '',
  };
  return M[_statusSave] || '';
}

function marcarSave(estado) {
  _statusSave = estado;
  const el = qs('diSave');
  if (el) { el.className = `di-save di-save-${estado}`; el.innerHTML = saveStatusHtml(); }
  if (estado === 'salvo') {
    setTimeout(() => { if (_statusSave === 'salvo') marcarSave('ocioso'); }, 2500);
  }
}

/** Envolve uma escrita para alimentar o indicador do cabeçalho. */
async function comSave(fn) {
  _salvando++;
  marcarSave('salvando');
  try {
    const r = await fn();
    if (--_salvando === 0) marcarSave('salvo');
    return r;
  } catch (e) {
    _salvando--;
    marcarSave('erro');
    throw e;
  }
}

// ───────────────────────────────────────────────────────────
// CARDS DE REFEIÇÃO
// ───────────────────────────────────────────────────────────
function refeicoesHtml() {
  if (!_refeicoes.length) {
    return `
      <div class="di-vazio">
        <div class="empty-state-icon"><i data-lucide="utensils"></i></div>
        <div class="di-vazio-tit">Seu plano alimentar ainda está vazio</div>
        <div class="di-vazio-sub">Comece adicionando a primeira refeição do dia.</div>
        <div class="di-vazio-acts">
          <button class="btn primary" id="diVazioNova"><i data-lucide="plus"></i> Adicionar primeira refeição</button>
          ${_modo === 'paciente' ? `<button class="btn" id="diVazioModelo"><i data-lucide="copy-plus"></i> Usar modelo</button>` : ''}
        </div>
      </div>`;
  }
  return _refeicoes.map((r, i) => refeicaoCardHtml(r, i, _refeicoes.length)).join('');
}

function refeicaoCardHtml(r, idx, total) {
  const itens = r.itens || [];
  const m = macrosRefeicao(r);
  const recolhida = _recolhidas.has(r.id);
  const painelId = `di-painel-${r.id}`;

  return `
    <section class="di-card ${recolhida ? 'recolhida' : ''}" data-ref-card="${r.id}">
      <div class="di-card-hd">
        <button class="di-toggle" data-ref-toggle="${r.id}"
                aria-expanded="${!recolhida}" aria-controls="${painelId}"
                aria-label="${recolhida ? 'Expandir' : 'Recolher'} ${esc(r.nome || 'refeição')}">
          <i data-lucide="chevron-${recolhida ? 'right' : 'down'}"></i>
        </button>

        <div class="di-card-id">
          <input type="time" class="di-hora" value="${esc(hhmm(r.horario))}"
                 data-ref-campo="horario" data-ref-id="${r.id}"
                 aria-label="Horário de ${esc(r.nome || 'refeição')}">
          <input type="text" class="di-nome" value="${esc(r.nome || '')}"
                 data-ref-campo="nome" data-ref-id="${r.id}" list="dlRefeicoes"
                 placeholder="Nome da refeição" aria-label="Nome da refeição">
        </div>

        <div class="di-card-stats">
          <span class="di-kcal">${fmtKcal(m.kcal)} kcal</span>
          <span class="di-macros">P ${fmtG(m.prot)} · C ${fmtG(m.carb)} · G ${fmtG(m.gord)}</span>
          <span class="di-conta">${itens.length} ${itens.length === 1 ? 'alimento' : 'alimentos'}</span>
        </div>

        <div class="di-card-acts">
          <button class="di-iact" data-ref-add="${r.id}" title="Adicionar alimento" aria-label="Adicionar alimento em ${esc(r.nome || 'refeição')}">
            <i data-lucide="plus"></i>
          </button>
          <button class="di-iact" data-ref-up="${r.id}" ${idx === 0 ? 'disabled' : ''} title="Mover para cima" aria-label="Mover ${esc(r.nome || 'refeição')} para cima">
            <i data-lucide="chevron-up"></i>
          </button>
          <button class="di-iact" data-ref-down="${r.id}" ${idx === total - 1 ? 'disabled' : ''} title="Mover para baixo" aria-label="Mover ${esc(r.nome || 'refeição')} para baixo">
            <i data-lucide="chevron-down"></i>
          </button>
          <div class="di-menu-wrap">
            <button class="di-iact" data-ref-menu="${r.id}" aria-haspopup="menu" aria-expanded="false" title="Mais ações" aria-label="Mais ações de ${esc(r.nome || 'refeição')}">
              <i data-lucide="ellipsis-vertical"></i>
            </button>
            <div class="di-menu" data-ref-menu-pop="${r.id}" role="menu" hidden>
              <button role="menuitem" data-ref-dup="${r.id}"><i data-lucide="copy-plus"></i> Duplicar refeição</button>
              <button role="menuitem" data-ref-del="${r.id}" class="perigo"><i data-lucide="trash-2"></i> Excluir refeição</button>
            </div>
          </div>
        </div>
      </div>

      <div class="di-card-body" id="${painelId}" ${recolhida ? 'hidden' : ''}>
        ${itens.length ? itensHtml(itens) : `
          <div class="di-sem-itens">
            <span>Nenhum alimento adicionado.</span>
            <button class="btn" data-ref-add="${r.id}"><i data-lucide="plus"></i> Adicionar alimento</button>
          </div>`}
        ${itens.length ? `
          <div class="di-card-ft">
            <button class="di-add-link" data-ref-add="${r.id}"><i data-lucide="plus"></i> Adicionar alimento</button>
          </div>` : ''}
      </div>
    </section>`;
}

// ───────────────────────────────────────────────────────────
// ITENS — tabela editável no desktop, cards no mobile (mesmo HTML, CSS decide)
// ───────────────────────────────────────────────────────────
function itensHtml(itens) {
  return `
    <div class="di-tab" role="table" aria-label="Alimentos da refeição">
      <div class="di-tr di-th" role="row">
        <span role="columnheader" class="c-num">#</span>
        <span role="columnheader" class="c-nome">Alimento</span>
        <span role="columnheader" class="c-qtd">Qtd</span>
        <span role="columnheader" class="c-med">Medida</span>
        <span role="columnheader" class="c-peso">Peso</span>
        <span role="columnheader" class="c-mac">P</span>
        <span role="columnheader" class="c-mac">C</span>
        <span role="columnheader" class="c-mac">G</span>
        <span role="columnheader" class="c-kcal">kcal</span>
        <span role="columnheader" class="c-acts"><span class="sr">Ações</span></span>
      </div>
      ${itens.map((it, i) => itemRowHtml(it, i, itens.length)).join('')}
    </div>`;
}

function itemRowHtml(it, i, total) {
  const f = it.food || {};
  const mm = macrosItem(it);
  const medidas = _medidasDe.get(it.food_id) || [];
  const sel = medidaDoItem(medidas, it);
  const fonte = f.marca || (f.fonte_dados && f.fonte_dados !== 'Proprio' ? f.fonte_dados : '');

  const opcoes = [
    `<option value="${MEDIDA_GRAMAS}" ${sel.medida === MEDIDA_GRAMAS ? 'selected' : ''}>gramas</option>`,
    ...medidas.map(m =>
      `<option value="${esc(m.descricao)}" ${sel.medida === m.descricao ? 'selected' : ''}>${esc(m.descricao)} (${fmtG(m.gramas)} g)</option>`),
  ].join('');

  return `
    <div class="di-tr di-item" role="row" data-item-row="${it.id}">
      <span class="c-num" role="cell">${i + 1}</span>

      <div class="c-nome" role="cell">
        <div class="di-it-nome">${esc(f.nome || '(alimento removido)')}</div>
        <div class="di-it-sub">
          ${fonte ? `<span class="di-it-fonte">${esc(fonte)}</span>` : ''}
          <input type="text" class="di-obs" value="${esc(it.observacao ?? '')}" placeholder="+ observação"
                 data-item-campo="observacao" data-item-id="${it.id}"
                 aria-label="Observação sobre ${esc(f.nome || 'alimento')}">
        </div>
      </div>

      <div class="c-qtd" role="cell">
        <input type="number" step="0.25" min="0" inputmode="decimal" class="di-inp di-inp-qtd"
               value="${fmtQtdInput(sel.n)}" data-item-qtd="${it.id}"
               aria-label="Quantidade de ${esc(f.nome || 'alimento')}">
      </div>

      <div class="c-med" role="cell">
        <select class="di-inp di-inp-med" data-item-med="${it.id}"
                aria-label="Medida de ${esc(f.nome || 'alimento')}"
                ${medidas.length ? '' : 'title="Este alimento ainda não tem medidas caseiras. Cadastre em Alimentos."'}>
          ${opcoes}
        </select>
      </div>

      <span class="c-peso" role="cell"><b>${fmtG(sel.gramas)}</b> g</span>

      <span class="c-mac" role="cell" title="Proteína">${fmtG(mm.prot)}</span>
      <span class="c-mac" role="cell" title="Carboidrato">${fmtG(mm.carb)}</span>
      <span class="c-mac" role="cell" title="Gordura">${fmtG(mm.gord)}</span>
      <span class="c-kcal" role="cell"><b>${fmtKcal(mm.kcal)}</b></span>

      <div class="c-acts" role="cell">
        <button class="di-iact" data-item-up="${it.id}" ${i === 0 ? 'disabled' : ''} title="Subir" aria-label="Subir ${esc(f.nome || 'alimento')}">
          <i data-lucide="chevron-up"></i>
        </button>
        <button class="di-iact" data-item-down="${it.id}" ${i === total - 1 ? 'disabled' : ''} title="Descer" aria-label="Descer ${esc(f.nome || 'alimento')}">
          <i data-lucide="chevron-down"></i>
        </button>
        <button class="di-iact" data-item-dup="${it.id}" title="Duplicar" aria-label="Duplicar ${esc(f.nome || 'alimento')}">
          <i data-lucide="copy"></i>
        </button>
        <button class="di-iact di-iact-del" data-item-del="${it.id}" title="Remover" aria-label="Remover ${esc(f.nome || 'alimento')}">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// NOVA REFEIÇÃO — form compacto, escondido até pedir
// ───────────────────────────────────────────────────────────
function novaRefeicaoHtml() {
  return `
    <div class="di-nova">
      <button class="di-nova-btn" id="diNovaAbrir"><i data-lucide="plus"></i> Adicionar refeição</button>
      <div class="di-nova-form" id="diNovaForm" hidden>
        <div class="di-nova-grid">
          <div class="av-field">
            <label for="diNovaRefNome">Nome</label>
            <input type="text" id="diNovaRefNome" class="np-input" list="dlRefeicoes" placeholder="Ex.: Café da manhã">
          </div>
          <div class="av-field">
            <label for="diNovaRefHora">Horário</label>
            <input type="time" id="diNovaRefHora" class="np-input">
          </div>
          <div class="av-field">
            <label for="diNovaRefCopia">Começar de</label>
            <select id="diNovaRefCopia" class="np-input">
              <option value="">Refeição vazia</option>
              ${_refeicoes.map(r => `<option value="${r.id}">Copiar "${esc(r.nome)}"</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="di-nova-acts">
          <button class="btn" id="diNovaCancelar">Cancelar</button>
          <button class="btn primary" id="diAddRef"><i data-lucide="plus"></i> Adicionar refeição</button>
        </div>
      </div>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// DRAWER DE BUSCA — some da rota, não da tela: a refeição segue visível
// ───────────────────────────────────────────────────────────
function drawerHtml() {
  const r = _refeicoes.find(x => x.id === _drawerRef);
  const ABAS = [
    ['alimentos', 'Alimentos'],
    ['favoritos', 'Favoritos'],
    ['recentes', 'Recentes'],
  ];
  return `
    <div class="di-drawer-fundo" id="diDrawerFundo"></div>
    <aside class="di-drawer" id="diDrawer" role="dialog" aria-modal="true" aria-label="Adicionar alimento">
      <div class="di-dw-hd">
        <div>
          <div class="di-dw-eyebrow">Adicionar em</div>
          <div class="di-dw-tit">${esc(r?.nome || 'refeição')}</div>
        </div>
        <button class="di-iact" id="diDwFechar" title="Fechar (Esc)" aria-label="Fechar"><i data-lucide="x"></i></button>
      </div>

      <div class="di-dw-abas" role="tablist">
        ${ABAS.map(([k, txt]) => `
          <button role="tab" class="di-dw-aba ${_drawerAba === k ? 'ativa' : ''}"
                  data-dw-aba="${k}" aria-selected="${_drawerAba === k}">${txt}</button>`).join('')}
      </div>

      <div class="di-dw-busca">
        <i data-lucide="search"></i>
        <input type="text" id="diDwInput" autocomplete="off"
               placeholder="Busque por alimento, marca ou código de barras"
               aria-label="Buscar alimento">
      </div>

      <div class="di-dw-lista" id="diDwLista" role="listbox" aria-label="Resultados"></div>

      <div class="di-dw-ft">
        <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
        <span><kbd>Enter</kbd> adicionar</span>
        <span><kbd>Esc</kbd> fechar</span>
      </div>
    </aside>`;
}

function resultadoHtml(a, i, ativo) {
  const fonte = a.marca || (a.fonte_dados && a.fonte_dados !== 'Proprio' ? a.fonte_dados : '');
  const med = (_medidasDe.get(a.id) || [])[0];
  const porcao = med ? `${esc(med.descricao)} · ${fmtG(med.gramas)} g` : 'Porção padrão: 100 g';
  return `
    <div class="di-res ${ativo ? 'ativo' : ''}" role="option" aria-selected="${ativo}" data-res="${i}">
      <div class="di-res-txt">
        <div class="di-res-nome">${a._tag === 'favorito' ? '<i data-lucide="star" class="di-fav"></i> ' : ''}${esc(a.nome)}</div>
        <div class="di-res-sub">${fonte ? `<span class="di-it-fonte">${esc(fonte)}</span> · ` : ''}${porcao}</div>
      </div>
      <div class="di-res-mac">
        <div class="di-res-kcal">${fmtKcal(a.calorias)} kcal</div>
        <div class="di-res-pcg">P ${fmtG(a.proteina)} · C ${fmtG(a.carboidrato)} · G ${fmtG(a.gordura)}</div>
      </div>
      <button class="btn di-res-add" data-res-add="${i}" aria-label="Adicionar ${esc(a.nome)}">Adicionar</button>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// EVENTOS
// ───────────────────────────────────────────────────────────
function abrirMenu(btn, pop) {
  const jaAberto = !pop.hidden;
  // Um menu por vez.
  _mountEl.querySelectorAll('.di-menu').forEach(m => { m.hidden = true; });
  _mountEl.querySelectorAll('[aria-haspopup="menu"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  if (jaAberto) return;
  pop.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  const fora = (e) => {
    if (pop.contains(e.target) || btn.contains(e.target)) return;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', fora);
  };
  document.addEventListener('mousedown', fora);
}

function ligarBarra(cont) {
  cont.querySelector('#diSalvarRasc')?.addEventListener('click', () => salvarDados());
  cont.querySelector('#diPublicar')?.addEventListener('click', () => publicarPlano());
  cont.querySelector('#diEditarCalc')?.addEventListener('click', irParaCalculo);

  const btn = cont.querySelector('#diMaisBtn');
  const pop = cont.querySelector('#diMais');
  btn?.addEventListener('click', () => abrirMenu(btn, pop));

  pop?.querySelectorAll('[data-mais]').forEach(b => b.addEventListener('click', () => {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    const a = b.dataset.mais;
    if (a === 'duplicar') salvarPlanoNaBiblioteca(_plano.id, _plano.nome, null);
    else if (a === 'imprimir') window.print();
    else if (a === 'recolher') { _refeicoes.forEach(r => _recolhidas.add(r.id)); renderRefeicoes(); }
    else if (a === 'expandir') { _recolhidas.clear(); renderRefeicoes(); }
    else if (a === 'atalhos') mostrarAtalhos();
  }));
}

// "Editar cálculo" → salta para a aba Cálculo de Calorias (onde as metas moram).
// Só existe na ficha do paciente; a navegação é o próprio menu lateral da ficha.
function irParaCalculo() {
  const item = document.querySelector('#fichaMenu .fm-item[data-aba="calorias"]');
  if (item) { item.click(); return; }
  mostrarToast('Abra a aba "Cálculo de Calorias" para editar as metas.');
}

function ligarNovaRefeicao(cont) {
  const abrir = cont.querySelector('#diNovaAbrir');
  const form = cont.querySelector('#diNovaForm');
  const mostrar = () => {
    form.hidden = false;
    abrir.hidden = true;
    cont.querySelector('#diNovaRefNome')?.focus();
  };
  abrir?.addEventListener('click', mostrar);
  cont.querySelector('#diVazioNova')?.addEventListener('click', mostrar);
  cont.querySelector('#diVazioModelo')?.addEventListener('click', () => escolherModelo());
  cont.querySelector('#diNovaCancelar')?.addEventListener('click', () => {
    form.hidden = true; abrir.hidden = false;
  });
  cont.querySelector('#diAddRef')?.addEventListener('click', adicionarRefeicao);
  cont.querySelector('#diNovaRefNome')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); adicionarRefeicao(); }
  });
}

function ligarRefeicoes(cont) {
  cont.querySelectorAll('[data-ref-campo]').forEach(el =>
    el.addEventListener('change', () => salvarCampoRefeicao(el)));

  cont.querySelectorAll('[data-ref-toggle]').forEach(b =>
    b.addEventListener('click', () => alternarRecolhida(b.dataset.refToggle)));

  cont.querySelectorAll('[data-ref-add]').forEach(b =>
    b.addEventListener('click', () => abrirDrawer(b.dataset.refAdd)));

  cont.querySelectorAll('[data-ref-up]').forEach(b =>
    b.addEventListener('click', () => moverRefeicao(b.dataset.refUp, -1)));
  cont.querySelectorAll('[data-ref-down]').forEach(b =>
    b.addEventListener('click', () => moverRefeicao(b.dataset.refDown, +1)));

  cont.querySelectorAll('[data-ref-menu]').forEach(b => {
    const pop = cont.querySelector(`[data-ref-menu-pop="${b.dataset.refMenu}"]`);
    if (pop) b.addEventListener('click', () => abrirMenu(b, pop));
  });
  cont.querySelectorAll('[data-ref-dup]').forEach(b =>
    b.addEventListener('click', () => duplicarRefeicaoUI(b.dataset.refDup)));
  cont.querySelectorAll('[data-ref-del]').forEach(b =>
    b.addEventListener('click', () => removerRefeicao(b.dataset.refDel)));

  // Itens
  cont.querySelectorAll('[data-item-campo]').forEach(el =>
    el.addEventListener('change', () => salvarCampoItem(el)));
  cont.querySelectorAll('[data-item-qtd]').forEach(el =>
    el.addEventListener('change', () => salvarQuantidade(el.dataset.itemQtd)));
  cont.querySelectorAll('[data-item-med]').forEach(el =>
    el.addEventListener('change', () => trocarMedida(el.dataset.itemMed)));
  cont.querySelectorAll('[data-item-up]').forEach(b =>
    b.addEventListener('click', () => moverItem(b.dataset.itemUp, -1)));
  cont.querySelectorAll('[data-item-down]').forEach(b =>
    b.addEventListener('click', () => moverItem(b.dataset.itemDown, +1)));
  cont.querySelectorAll('[data-item-dup]').forEach(b =>
    b.addEventListener('click', () => duplicarItemUI(b.dataset.itemDup)));
  cont.querySelectorAll('[data-item-del]').forEach(b =>
    b.addEventListener('click', () => removerItem(b.dataset.itemDel)));
}

function alternarRecolhida(id) {
  if (_recolhidas.has(id)) _recolhidas.delete(id); else _recolhidas.add(id);
  renderRefeicoes();
}

// ───────────────────────────────────────────────────────────
// DRAWER
// ───────────────────────────────────────────────────────────
let _dwResultados = [], _dwAtivo = -1, _dwBuscando = false;

async function abrirDrawer(refId) {
  _drawerRef = refId;
  _drawerAba = 'alimentos';
  _dwResultados = []; _dwAtivo = -1;
  _recolhidas.delete(refId);          // não faz sentido adicionar numa refeição recolhida
  renderRefeicoes();
  qs('diDwInput')?.focus();
  await carregarAba();
}

function fecharDrawer() {
  _drawerRef = null;
  _dwResultados = []; _dwAtivo = -1;
  renderRefeicoes();
}

function ligarDrawer(cont) {
  cont.querySelector('#diDwFechar')?.addEventListener('click', fecharDrawer);
  cont.querySelector('#diDrawerFundo')?.addEventListener('click', fecharDrawer);

  cont.querySelectorAll('[data-dw-aba]').forEach(b =>
    b.addEventListener('click', async () => {
      _drawerAba = b.dataset.dwAba;
      _dwAtivo = -1;
      renderRefeicoes();
      qs('diDwInput')?.focus();
      await carregarAba();
    }));

  const inp = cont.querySelector('#diDwInput');
  if (!inp) return;
  inp.addEventListener('input', dwBuscar);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); fecharDrawer(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); _dwAtivo = Math.min(_dwAtivo + 1, _dwResultados.length - 1); pintarResultados(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _dwAtivo = Math.max(_dwAtivo - 1, 0); pintarResultados(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const i = _dwAtivo >= 0 ? _dwAtivo : 0;
      if (_dwResultados[i]) adicionarDoDrawer(i);
    }
  });
  inp.focus();
}

const dwBuscar = debounce(async () => {
  const inp = qs('diDwInput');
  if (!inp) return;
  const termo = inp.value.trim();
  if (!termo) { await carregarAba(); return; }
  _dwBuscando = true; pintarResultados();
  try {
    _dwResultados = await buscarFoods(termo, 25);
  } catch (e) {
    _dwBuscando = false;
    _dwResultados = [];
    pintarResultados(`Erro na busca: ${e.message}`);
    return;
  }
  _dwBuscando = false;
  for (const a of _dwResultados) _alimCache.set(String(a.nome).toLowerCase(), a);
  await carregarMedidasDe(_dwResultados.map(a => a.id));
  _dwAtivo = _dwResultados.length ? 0 : -1;
  pintarResultados();
}, 180);

// Aba sem termo digitado: favoritos/recentes/sugestões.
async function carregarAba() {
  _dwBuscando = true; pintarResultados();
  try {
    if (_drawerAba === 'favoritos') _dwResultados = await listarFavoritos(50);
    else if (_drawerAba === 'recentes') _dwResultados = await listarRecentes(25);
    else _dwResultados = await carregarSugestoes();
  } catch (e) {
    _dwBuscando = false;
    _dwResultados = [];
    pintarResultados(`Não foi possível carregar: ${e.message}`);
    return;
  }
  _dwBuscando = false;
  await carregarMedidasDe(_dwResultados.map(a => a.id));
  _dwAtivo = _dwResultados.length ? 0 : -1;
  pintarResultados();
}

function pintarResultados(erro) {
  const lista = qs('diDwLista');
  if (!lista) return;

  if (_dwBuscando) {
    lista.innerHTML = `<div class="di-dw-vazio"><div class="spinner"></div>Buscando...</div>`;
    return;
  }
  if (erro) {
    lista.innerHTML = `<div class="di-dw-vazio"><i data-lucide="triangle-alert"></i>${esc(erro)}</div>`;
    return;
  }
  if (!_dwResultados.length) {
    const termo = (qs('diDwInput')?.value || '').trim();
    const msg = termo
      ? `Nenhum alimento encontrado para "${esc(termo)}".`
      : _drawerAba === 'favoritos'
        ? 'Você ainda não tem favoritos. Marque a estrela na aba Alimentos.'
        : _drawerAba === 'recentes'
          ? 'Nada por aqui ainda — os alimentos que você usar aparecem nesta aba.'
          : 'Digite para buscar no catálogo.';
    lista.innerHTML = `<div class="di-dw-vazio"><i data-lucide="search-x"></i>${msg}</div>`;
    return;
  }

  lista.innerHTML = _dwResultados.map((a, i) => resultadoHtml(a, i, i === _dwAtivo)).join('');
  lista.querySelectorAll('[data-res-add]').forEach(b =>
    b.addEventListener('click', () => adicionarDoDrawer(Number(b.dataset.resAdd))));
  lista.querySelectorAll('[data-res]').forEach(el =>
    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('[data-res-add]')) return;
      e.preventDefault();
      adicionarDoDrawer(Number(el.dataset.res));
    }));
  lista.querySelector('.di-res.ativo')?.scrollIntoView({ block: 'nearest' });
}

// Adiciona e MANTÉM o drawer aberto — a ideia é enfileirar vários alimentos.
async function adicionarDoDrawer(i) {
  const al = _dwResultados[i];
  if (!al || !_drawerRef) return;
  await adicionarAlimento(_drawerRef, al);
  mostrarToast(`✓ ${al.nome}`);
  const inp = qs('diDwInput');
  if (inp) { inp.value = ''; inp.focus(); }
  _sugestoes = null;
  await carregarAba();
}

function mostrarAtalhos() {
  confirmar({
    titulo: 'Atalhos do teclado',
    mensagem: [
      'Ctrl/Cmd + K   abrir a busca de alimentos',
      'Ctrl/Cmd + S   salvar o plano',
      '↑ ↓            navegar nos resultados',
      'Enter          adicionar o alimento selecionado',
      'Esc            fechar a busca',
    ].join('\n'),
    textoOk: 'Entendi',
    textoCancelar: 'Fechar',
  });
}

// ───────────────────────────────────────────────────────────
// MEDIDAS (cache por food_id)
// ───────────────────────────────────────────────────────────
async function carregarMedidasDe(foodIds) {
  const faltando = [...new Set((foodIds || []).filter(id => id && !_medidasDe.has(id)))];
  if (!faltando.length) return;
  try {
    const mapa = await listarMedidasDeVarios(faltando);
    for (const id of faltando) _medidasDe.set(id, mapa[id] || []);
  } catch (e) {
    // Sem medidas a tela ainda funciona em gramas — não vale derrubar o editor.
    for (const id of faltando) _medidasDe.set(id, []);
  }
}

// Favoritos + últimos utilizados, sem repetir. É o que o campo mostra ANTES de
// digitar: na prática o nutri reusa os mesmos alimentos o tempo todo.
async function carregarSugestoes() {
  if (_sugestoes) return _sugestoes;
  let favs = [], recs = [];
  try {
    [favs, recs] = await Promise.all([listarFavoritos(10), listarRecentes(10)]);
  } catch (e) { /* sugestão é conveniência: sem ela o campo só busca normalmente */ }

  const vistos = new Set();
  const out = [];
  for (const f of favs) {
    if (f && !vistos.has(f.id)) { vistos.add(f.id); out.push({ ...f, _tag: 'favorito' }); }
  }
  for (const r of recs) {
    if (r && !vistos.has(r.id)) { vistos.add(r.id); out.push({ ...r, _tag: 'recente' }); }
  }
  _sugestoes = out;
  return out;
}

// ── Refeições ──
async function adicionarRefeicao() {
  const nome = (qs('diNovaRefNome').value || '').trim();
  const hora = (qs('diNovaRefHora').value || '').trim();
  if (!nome) { mostrarToast('Informe o nome da refeição'); return; }
  const copiarDe = qs('diNovaRefCopia')?.value || '';
  try {
    const nutriId = await getNutriId();
    let nova;
    if (copiarDe) {
      const base = _refeicoes.find(r => r.id === copiarDe);
      nova = await comSave(() => duplicarRefeicao(nutriId, base, {
        nome, horario: hora || null, ordem: _refeicoes.length,
      }));
    } else {
      nova = await comSave(() => criarRefeicao(nutriId, {
        plano_id: _plano.id, nome, horario: hora || null, ordem: _refeicoes.length,
      }));
    }
    await recarregarRefeicoes();
    mostrarToast('✓ Refeição adicionada');
    // Recém-criada e vazia: já abre a busca, que é o próximo passo óbvio.
    if (!copiarDe) abrirDrawer(nova.id); else renderRefeicoes();
  } catch (e) { mostrarErro('Erro ao adicionar a refeição: ' + e.message); }
}

/** Relê as refeições do banco e recarrega as medidas dos alimentos novos. */
async function recarregarRefeicoes() {
  _refeicoes = await listarRefeicoesDoPlano(_plano.id);
  await carregarMedidasDe(_refeicoes.flatMap(r => (r.itens || []).map(i => i.food_id)));
}

async function duplicarRefeicaoUI(id) {
  const r = _refeicoes.find(x => x.id === id);
  if (!r) return;
  try {
    const nutriId = await getNutriId();
    await comSave(() => duplicarRefeicao(nutriId, r));
    await recarregarRefeicoes();
    renderRefeicoes();
    mostrarToast('✓ Refeição duplicada');
  } catch (e) { mostrarErro('Erro ao duplicar: ' + e.message); }
}

/** Move a refeição trocando `ordem` com a vizinha. */
async function moverRefeicao(id, dir) {
  const idx = _refeicoes.findIndex(r => r.id === id);
  const alvo = idx + dir;
  if (idx === -1 || alvo < 0 || alvo >= _refeicoes.length) return;
  const a = _refeicoes[idx], b = _refeicoes[alvo];
  try {
    await comSave(() => reordenarRefeicoes([{ id: a.id, ordem: alvo }, { id: b.id, ordem: idx }]));
    await recarregarRefeicoes();
    renderRefeicoes();
  } catch (e) { mostrarErro('Erro ao reordenar: ' + e.message); }
}

/**
 * "Salvar e publicar" = salvar os dados + marcar ativo.
 * O banco só tem o boolean `ativo` — não existe rascunho/arquivado. Publicar
 * aqui significa exatamente "ficar ativo", nada além disso.
 */
async function publicarPlano() {
  const sel = qs('plAtivo');
  if (sel) sel.value = '1';
  await salvarDados({ ativo: true });   // força ativo mesmo com o card de dados recolhido
}

async function salvarCampoRefeicao(el) {
  const id = el.dataset.refId;
  const campo = el.dataset.refCampo;
  let valor = el.value.trim();
  if (campo === 'horario') valor = valor || null;
  if (campo === 'nome' && !valor) { mostrarToast('A refeição precisa de um nome'); return; }
  try {
    await atualizarRefeicao(id, { [campo]: valor });
    const r = _refeicoes.find(x => x.id === id);
    if (r) r[campo] = valor;
  } catch (e) { mostrarToast('Erro ao salvar: ' + e.message); }
}

async function removerRefeicao(id) {
  const r = _refeicoes.find(x => x.id === id);
  if (!(await confirmar({
    titulo: 'Excluir refeição',
    mensagem: `Excluir a refeição "${r?.nome || 'sem nome'}" e seus itens?`,
    textoOk: 'Excluir', perigo: true,
  }))) return;
  try {
    await excluirRefeicao(id);
    _refeicoes = await listarRefeicoesDoPlano(_plano.id);
    renderRefeicoes();
  } catch (e) { mostrarErro('Erro: ' + e.message); }
}

// ── Itens ──
// Resolve o texto digitado para um alimento (cache do autocomplete ou match exato).
async function adicionarItemNaRefeicao(refId, inp) {
  const nome = (inp?.value || '').trim();
  if (!nome) { mostrarToast('Digite o nome do alimento'); return; }
  let al = _alimCache.get(nome.toLowerCase());
  if (!al) { try { al = (await buscarFoods(nome, 1))[0]; } catch (e) {} }
  if (!al) { mostrarToast('Alimento não encontrado. Escolha um da lista.'); return; }
  await adicionarAlimento(refId, al);
}

/**
 * Insere um alimento na refeição.
 * Entra com a primeira medida caseira do alimento, se houver; senão, 100 g —
 * que é a base dos valores da tabela e o palpite mais honesto.
 */
async function adicionarAlimento(refId, al) {
  try {
    const nutriId = await getNutriId();
    const r = _refeicoes.find(x => x.id === refId);
    await carregarMedidasDe([al.id]);
    const med = (_medidasDe.get(al.id) || [])[0];

    await comSave(() => adicionarItem(nutriId, {
      refeicao_id: refId,
      food_id: al.id,
      quantidade: quantidadeDePeso(med ? Number(med.gramas) : 100),
      medida: med ? med.descricao : null,
      ordem: (r?.itens?.length || 0),
    }));

    // "Últimos utilizados" alimenta as sugestões. Best-effort: falhar aqui não
    // pode impedir o alimento de entrar no plano.
    try {
      await registrarUso(nutriId, al.id);
      _sugestoes = null;
    } catch (e) { /* silencioso de propósito */ }

    await recarregarRefeicoes();
    renderRefeicoes();
  } catch (e) { mostrarErro('Erro ao adicionar o alimento: ' + e.message); }
}

function acharItem(id) {
  for (const r of _refeicoes) {
    const it = (r.itens || []).find(x => x.id === id);
    if (it) return { ref: r, item: it };
  }
  return { ref: null, item: null };
}

/**
 * Grava a quantidade digitada.
 *
 * O campo mostra a quantidade NA MEDIDA escolhida (2 colheres), mas o banco
 * guarda múltiplo de 100 g. A conversão passa por gramas:
 *   2 colheres x 25 g = 50 g -> quantidade = 0,5
 */
async function salvarQuantidade(id) {
  const { item } = acharItem(id);
  const el = _mountEl?.querySelector(`[data-item-qtd="${id}"]`);
  if (!item || !el) return;

  const n = num(el.value);
  if (n == null || n < 0) { renderRefeicoes(); return; }   // valor inválido: volta ao que era

  const medidas = _medidasDe.get(item.food_id) || [];
  const gramas = gramasDeMedida(medidas, item.medida, n);
  const quantidade = quantidadeDePeso(gramas);
  if (quantidade === Number(item.quantidade)) return;

  item.quantidade = quantidade;   // otimista: o número já está na tela
  renderRefeicoes();
  try {
    await comSave(() => atualizarItem(id, { quantidade }));
  } catch (e) {
    mostrarErro('Erro ao salvar a quantidade: ' + e.message);
    await recarregarRefeicoes();
    renderRefeicoes();
  }
}

/**
 * Troca a medida caseira MANTENDO O PESO — e portanto os macros.
 *
 * Trocar a unidade de exibição não pode mudar o que o paciente come: 100 g de
 * arroz viram "4 colheres de sopa", não "1 colher" (que seriam 25 g). Quem muda
 * a quantidade prescrita é o campo Qtd, nunca o seletor de medida.
 */
async function trocarMedida(id) {
  const { item } = acharItem(id);
  const el = _mountEl?.querySelector(`[data-item-med="${id}"]`);
  if (!item || !el) return;

  const nova = el.value === MEDIDA_GRAMAS ? null : el.value;
  if ((item.medida || null) === nova) return;

  item.medida = nova;   // o peso (quantidade) não muda de propósito
  renderRefeicoes();
  try {
    await comSave(() => atualizarItem(id, { medida: nova }));
  } catch (e) {
    mostrarErro('Erro ao trocar a medida: ' + e.message);
    await recarregarRefeicoes();
    renderRefeicoes();
  }
}

async function salvarCampoItem(el) {
  const id = el.dataset.itemId;
  const campo = el.dataset.itemCampo;
  const valor = String(el.value).trim() || null;
  const { item } = acharItem(id);
  if (item && item[campo] === valor) return;
  try {
    await comSave(() => atualizarItem(id, { [campo]: valor }));
    if (item) item[campo] = valor;
  } catch (e) { mostrarErro('Erro ao salvar: ' + e.message); }
}

async function duplicarItemUI(id) {
  const { item } = acharItem(id);
  if (!item) return;
  try {
    const nutriId = await getNutriId();
    await comSave(() => duplicarItem(nutriId, item));
    await recarregarRefeicoes();
    renderRefeicoes();
    mostrarToast('✓ Alimento duplicado');
  } catch (e) { mostrarErro('Erro ao duplicar: ' + e.message); }
}

/**
 * Remove o alimento com opção de desfazer.
 * Sem confirmação: a perda é pequena e reversível por alguns segundos — bem
 * menos atrito que um modal a cada remoção.
 */
async function removerItem(id) {
  const { item } = acharItem(id);
  if (!item) return;
  const nome = item.food?.nome || 'Alimento';
  const backup = { ...item };
  try {
    await comSave(() => excluirItem(id));
    await recarregarRefeicoes();
    renderRefeicoes();
    mostrarToastDesfazer(`${nome} removido`, () => restaurarItem(backup));
  } catch (e) { mostrarErro('Erro ao remover: ' + e.message); }
}

async function restaurarItem(backup) {
  try {
    const nutriId = await getNutriId();
    await comSave(() => adicionarItem(nutriId, {
      refeicao_id: backup.refeicao_id,
      food_id: backup.food_id,
      alimento_id: backup.alimento_id ?? null,
      quantidade: backup.quantidade,
      medida: backup.medida,
      observacao: backup.observacao,
      substituicoes: backup.substituicoes,
      ordem: backup.ordem,
    }));
    await recarregarRefeicoes();
    renderRefeicoes();
    mostrarToast('✓ Alimento restaurado');
  } catch (e) { mostrarErro('Não foi possível restaurar: ' + e.message); }
}

// Move um item para cima/baixo dentro da própria refeição (troca ordem).
async function moverItem(id, dir) {
  let ref = null, itens = null, idx = -1;
  for (const r of _refeicoes) {
    const arr = (r.itens || []);
    const i = arr.findIndex(x => x.id === id);
    if (i !== -1) { ref = r; itens = arr; idx = i; break; }
  }
  if (!ref) return;
  const alvo = idx + dir;
  if (alvo < 0 || alvo >= itens.length) return;
  const a = itens[idx], b = itens[alvo];
  try {
    await comSave(() => reordenarItens([{ id: a.id, ordem: alvo }, { id: b.id, ordem: idx }]));
    await recarregarRefeicoes();
    renderRefeicoes();
  } catch (e) { mostrarErro('Erro ao reordenar: ' + e.message); }
}

// ───────────────────────────────────────────────────────────
// ATALHOS DE TECLADO
// ───────────────────────────────────────────────────────────
// Ctrl/Cmd+K abre a busca e Ctrl/Cmd+S salva. Ctrl+D ficou de fora de propósito:
// conflita com "adicionar favorito" no browser e não dá para interceptar de
// forma confiável em todos eles.
function ligarAtalhos() {
  if (_atalhosLigados) return;
  _atalhosLigados = true;
  document.addEventListener('keydown', (e) => {
    // Só quando o editor de plano está montado e visível.
    if (!_plano || !_mountEl?.isConnected || !_mountEl.querySelector('.di-rx')) return;
    const cmd = e.ctrlKey || e.metaKey;
    if (!cmd) return;

    const k = e.key.toLowerCase();
    if (k === 'k') {
      e.preventDefault();
      if (_drawerRef) { qs('diDwInput')?.focus(); return; }
      const alvo = _refeicoes.find(r => !_recolhidas.has(r.id)) || _refeicoes[0];
      if (alvo) abrirDrawer(alvo.id);
      else mostrarToast('Adicione uma refeição primeiro');
    } else if (k === 's') {
      e.preventDefault();
      salvarDados();
    }
  });
}

// ───────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtData = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
// Datas: início + n dias e diferença em dias (contagem inclusiva no editor).
function addDias(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;   // componentes locais (sem deslocar por fuso)
}
function diffDias(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}
const valNum = v => (v == null ? '' : v);

// "08:00:00" ou "08:00" -> "08:00"; nulo -> "". O input[type=time] exige HH:MM.
const hhmm = h => (h ? String(h).slice(0, 5) : '');

// timestamptz -> "16/07/2026" (só a data; a hora não ajuda no cabeçalho).
function fmtDataHora(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
}

// Valor para input[type=number]: ponto decimal (o HTML não aceita vírgula) e
// sem casas à toa. fmtQtd() é para EXIBIR (vírgula); esta é para o campo.
const fmtQtdInput = v => String(arredonda(v, 2));
