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
  listarMedidasDeVarios,
  listarFavoritos, listarRecentes, registrarUso,
  duplicarRefeicao, duplicarItem, reordenarItens, reordenarRefeicoes,
  prescreverModeloParaPaciente, salvarComoModelo,
} from './dieta.js';
import {
  quantidadeDePeso, gramasDeMedida, medidaDoItem, MEDIDA_GRAMAS,
  macrosRefeicao, macrosPlano, progresso,
  fmtKcal, fmtG, fmtQtd, num, arredonda,
} from './dieta-calc.js';
import { substituicoesDoItem, itemParaResumo } from './dieta-linha.js';
import { abrirSubstituicoes } from './dieta-substituicoes.js';
import {
  abrirRefeicao, fecharRefeicao, refeicaoAberta, drawerRefeicaoHtml, ligarRefeicaoDrawer,
  editarItem, fecharEdicaoItem,
} from './dieta-refeicao.js';
import {
  abrirBusca, fecharBusca, ligarBusca, drawerHtml, buscaAberta, estadoBusca,
} from './dieta-busca.js';
import { sb } from './supabase.js';
import { registrarEvento } from './timeline.js';
import { mostrarToast, mostrarToastDesfazer, mostrarErro, confirmar } from './utils.js';

// ── Estado do módulo ──
let _modo      = 'paciente';   // 'paciente' | 'modelo'
let _nutriId   = null;
let _paciente  = null;
let _mountEl   = null;
let _plano     = null;         // plano em edição (null enquanto não criado)
let _refeicoes = [];           // refeições (com itens) do plano em edição
let _sugestoes = null;         // favoritos + recentes (cache; null = ainda não carregado)

// ── Estado da tela de prescrição ──
let _medidasDe  = new Map();   // food_id -> medidas caseiras (cache por plano aberto)
let _resumos    = new Set();   // refeições com o resumo inline aberto (Nível 1)
let _focoDepois = null;        // seletor a refocar após o próximo render (Enter encadeado)
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
    if (novo.ativo) await eventoPlanoPublicado();   // prescrever um modelo = publicar
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
  _medidasDe.clear();
  _resumos.clear();
  _focoDepois = null;
  fecharBusca();     // trocar de plano com a busca aberta deixaria o drawer apontando para a refeição do plano anterior
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

  // Fechado, o card não existe mais: nome, status, objetivo e período estão na
  // barra de ferramentas, e o lápis de lá reabre este formulário. Era o bloco
  // que mais custava altura sem entregar nada que a barra não entregue.
  if (!_dadosAberto) { mount.innerHTML = ''; return; }

  mount.innerHTML = dadosCardAbertoHtml();
  ligarDadosAberto(mount);
}

function fmtPeriodo(t) {
  if (!t) return '';
  if (t.data_inicio && t.data_fim) return `${fmtData(t.data_inicio)} – ${fmtData(t.data_fim)}`;
  if (t.data_inicio) return `desde ${fmtData(t.data_inicio)}`;
  return '';
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
          <input type="text" id="plObjetivo" value="${esc(t?.objetivo || '')}" class="np-input" list="dlObjetivos" placeholder="Ex.: Emagrecimento" autocomplete="off">
          <div class="pl-obj-chips">
            ${OBJETIVOS.map(o => `<button type="button" class="pl-chip" data-obj="${esc(o)}">${esc(o)}</button>`).join('')}
          </div>
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


function ligarDadosAberto(mount) {
  mount.querySelector('#plSalvarDados')?.addEventListener('click', () => salvarDados());
  mount.querySelector('#plDadosRecolher')?.addEventListener('click', () => {
    _dadosAberto = false;
    montarDadosCard();
  });

  // Objetivo: chips sempre visíveis (o datalist nativo esconde as opções quando o
  // campo já tem texto). Clicar num chip preenche; digitar destaca o correspondente.
  const inpObj = mount.querySelector('#plObjetivo');
  const chips = mount.querySelectorAll('.pl-chip');
  const syncChips = () => {
    const v = (inpObj?.value || '').trim().toLowerCase();
    chips.forEach(c => c.classList.toggle('on', c.dataset.obj.toLowerCase() === v));
  };
  chips.forEach(c => c.addEventListener('click', () => {
    if (inpObj) { inpObj.value = c.dataset.obj; syncChips(); }
  }));
  inpObj?.addEventListener('input', syncChips);
  syncChips();

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
      // Publicação registra o próprio evento; aqui é só edição do plano.
      // Um evento por dia agrupa vários salvamentos seguidos em uma linha só.
      if (_modo === 'paciente' && override.ativo !== true) await eventoPlanoAtualizado();
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

// Qual refeição estava com o drawer aberto no render anterior. Serve para
// distinguir "abriu agora" de "só re-renderizou" — sem isso o <aside> nasce de
// novo a cada clique e a animação de entrada toca outra vez, dando a impressão
// de que o painel reabre sozinho.
let _drawerRenderizado = null;
let _buscaRenderizada = null;

function renderRefeicoes() {
  const cont = qs('plRefeicoes');
  if (!cont) return;

  // Estado que o innerHTML destrói e o usuário espera encontrar no lugar:
  // a rolagem do painel, a da lista de busca e o que estava sendo digitado.
  const posicoes = {
    corpo:  cont.querySelector('.rf-body')?.scrollTop ?? null,
    lista:  cont.querySelector('.di-dw-lista')?.scrollTop ?? null,
    termo:  cont.querySelector('#diDwInput')?.value ?? null,
    focoId: document.activeElement?.id || null,
  };
  const abriuAgora = refeicaoAberta() && _drawerRenderizado !== refeicaoAberta();
  _drawerRenderizado = refeicaoAberta();
  const buscaAbriuAgora = buscaAberta() && _buscaRenderizada !== estadoBusca().refId;
  _buscaRenderizada = buscaAberta() ? estadoBusca().refId : null;

  cont.innerHTML = `
    <div class="di-rx">
      <div class="di-rx-main">
        ${toolbarHtml()}
        <div class="di-refeicoes">${refeicoesHtml()}</div>
        ${novaRefeicaoHtml()}
        ${somasHtml()}
      </div>
    </div>
    ${refeicaoAberta() ? drawerRefeicaoHtml(acharRefeicao(refeicaoAberta()), {
        medidasDe: _medidasDe,
        sugestoesNome: REFEICOES_SUGERIDAS,
        // A busca desta refeição é renderizada DENTRO do drawer, não como um
        // segundo painel por cima do primeiro.
        buscaHtml: buscaAberta() && estadoBusca().refId === refeicaoAberta()
          ? drawerHtml(refeicaoDaBusca()?.nome, { inline: true })
          : '',
      }) : ''}
    ${buscaAberta() && estadoBusca().refId !== refeicaoAberta() ? drawerHtml(refeicaoDaBusca()?.nome) : ''}
  `;

  // A animação de entrada é só para a abertura de verdade. Re-render não é
  // abertura, e repetir o slide a cada clique fazia o painel piscar.
  if (!abriuAgora) cont.querySelector('.rf-drawer')?.classList.add('rf-sem-anim');
  if (!buscaAbriuAgora) {
    cont.querySelector('.di-drawer')?.classList.add('rf-sem-anim');
    cont.querySelector('.di-drawer-fundo')?.classList.add('rf-sem-anim');
  }

  ligarBarra(cont);
  ligarRefeicoes(cont);
  ligarNovaRefeicao(cont);
  if (refeicaoAberta()) ligarRefeicaoDrawer(cont);
  if (buscaAberta()) ligarBusca(cont);

  // Devolve rolagem, texto e foco ao lugar em que estavam antes do render.
  const corpo = cont.querySelector('.rf-body');
  if (corpo && posicoes.corpo != null && !abriuAgora) corpo.scrollTop = posicoes.corpo;
  const lista = cont.querySelector('.di-dw-lista');
  if (lista && posicoes.lista != null) lista.scrollTop = posicoes.lista;
  const busca = cont.querySelector('#diDwInput');
  if (busca && posicoes.termo && !busca.value) busca.value = posicoes.termo;
  if (posicoes.focoId && posicoes.focoId !== 'diDwInput') {
    cont.querySelector('#' + CSS.escape(posicoes.focoId))?.focus?.();
  }

  // Enter encadeado: o render recria os inputs, então o foco é reposto aqui —
  // é o único ponto em que o nó novo já existe.
  if (_focoDepois) {
    const alvo = cont.querySelector(_focoDepois);
    _focoDepois = null;
    if (alvo) { alvo.focus(); alvo.select?.(); }
  }
}

const refeicaoDaBusca = () => _refeicoes.find(r => r.id === estadoBusca().refId) || null;
const acharRefeicao = (id) => _refeicoes.find(r => r.id === id) || null;

/**
 * As refeições que compõem o DIA. Alternativas ficam de fora de propósito.
 *
 * O paciente come o café da manhã OU a vitamina proteica, nunca os dois — somar
 * as duas inflaria o total do plano e a comparação com a meta viraria ficção.
 * A regra vale para as calorias, os macros e a contagem de refeições.
 *
 * A filtragem é aqui, no consumo: dieta-calc.js continua somando o que recebe,
 * sem saber que alternativa existe.
 */
const principais = () => _refeicoes.filter(r => !r.substitui_refeicao_id);

/** As alternativas de uma refeição, na ordem em que foram criadas. */
const alternativasDe = (id) => _refeicoes.filter(r => r.substitui_refeicao_id === id);

/**
 * O contrato do Nível 2. O drawer não conhece banco nem estado: recebe daqui
 * como ler a refeição e o que fazer quando o nutri age.
 */
function apiRefeicao() {
  return {
    refeicao: acharRefeicao,
    medidasDe: _medidasDe,
    rerender: renderRefeicoes,
    onCampo: salvarCampoRefeicao,
    abrirMenu,
    // A faixa "+ Alimento" some enquanto a busca está aberta (o fechar mora no
    // cabeçalho dela), mas Ctrl+K continua alternando por este caminho.
    onAdicionar: (id) => (buscaAberta() ? fecharBusca() : abrirDrawer(id)),
    // Chamado quando o painel da refeição fecha ou troca de refeição: leva
    // junto a busca que estava embutida nele. Devolve true se já redesenhou,
    // para quem chamou não renderizar de novo.
    aoFechar: () => {
      if (!buscaAberta()) return false;
      fecharBusca();      // já dispara o render
      return true;
    },
    onDuplicar: (id) => duplicarRefeicaoUI(id),
    onExcluir: (id) => removerRefeicao(id),
    acoesItem: {
      salvarCampo:      salvarCampoItem,
      salvarQuantidade: salvarQuantidade,
      trocarMedida:     trocarMedida,
      mover:            moverItem,
      duplicar:         duplicarItemUI,
      remover:          removerItem,
      pedirObservacao:  pedirObservacao,
      verSubstituicoes: verSubstituicoes,
      abrirMenu:        abrirMenu,
      editar:           editarItem,
      fecharEdicao:     fecharEdicaoItem,
    },
  };
}

// ───────────────────────────────────────────────────────────
// BARRA DE FERRAMENTAS (topo, sticky) — tudo à mão, nada escondido
// ───────────────────────────────────────────────────────────
// Duas faixas finas no lugar dos dois blocos altos que existiam antes (o card
// de dados + a barra de métricas). A identidade do plano mora aqui; o card de
// dados só aparece quando o nutri clica em editar. As métricas desceram para a
// barra de somas, no rodapé, onde acompanham a rolagem.
//
// Nenhuma ação do dia a dia fica atrás de "...": clicar duas vezes para
// recolher todas as refeições, numa tela usada por horas, é imposto puro.
function toolbarHtml() {
  const p = _plano || {};
  const periodo = fmtPeriodo(p);
  const btn = (id, icone, texto, dica) =>
    `<button class="di-tb-btn" id="${id}" title="${esc(dica || texto)}"><i data-lucide="${icone}"></i><span>${esc(texto)}</span></button>`;

  return `
    <header class="di-tb" id="diToolbar">
      <div class="di-tb-l1">
        <div class="di-tb-ident">
          <h2 class="di-tb-nome" title="${esc(p.nome || '')}">${esc(p.nome || 'Plano sem nome')}</h2>
          ${estadoChipHtml()}
          ${p.objetivo ? `<span class="di-tb-tag"><i data-lucide="target"></i>${esc(p.objetivo)}</span>` : ''}
          ${periodo ? `<span class="di-tb-tag"><i data-lucide="calendar"></i>${periodo}</span>` : ''}
          <button class="di-tb-edit" id="plDadosEditar" title="Editar dados do plano" aria-label="Editar dados do plano">
            <i data-lucide="pencil"></i>
          </button>
        </div>
        <div class="di-tb-salvar">
          <span class="di-save" id="diSave" role="status" aria-live="polite">${saveStatusHtml()}</span>
          <button class="btn" id="diSalvarRasc" title="Salvar mantendo como rascunho (Ctrl+S)">Salvar rascunho</button>
          ${_modo === 'paciente'
            ? `<button class="btn primary" id="diPublicar" title="Salvar e marcar o plano como ativo">Salvar e publicar</button>`
            : ''}
        </div>
      </div>

      <div class="di-tb-l2" role="toolbar" aria-label="Ações da prescrição">
        <button class="di-tb-btn di-tb-add" id="diAddRefeicao" title="Adicionar refeição">
          <i data-lucide="plus"></i><span>Adicionar refeição</span>
        </button>
        <span class="di-tb-sep" aria-hidden="true"></span>
        ${_modo === 'paciente' ? btn('diEditarCalc', 'calculator', 'Editar cálculo', 'Editar as metas na aba Cálculo de Calorias') : ''}
        ${btn('diDuplicar', 'copy-plus', 'Duplicar', 'Duplicar este plano na biblioteca de modelos')}
        ${btn('diPdf', 'printer', 'PDF', 'Gerar PDF (imprimir)')}
        <span class="di-tb-sep" aria-hidden="true"></span>
        ${btn('diAtalhos', 'keyboard', 'Atalhos', 'Ver todos os atalhos do teclado')}

        <div class="di-tb-dicas">
          <span><kbd>Ctrl</kbd><kbd>K</kbd> buscar</span>
          <span><kbd>Ctrl</kbd><kbd>↵</kbd> alimento</span>
          <span><kbd>Ctrl</kbd><kbd>S</kbd> salvar</span>
        </div>
      </div>
    </header>`;
}

// ───────────────────────────────────────────────────────────
// BARRA DE SOMAS (rodapé, sticky) — acompanha a rolagem
// ───────────────────────────────────────────────────────────
// `position: sticky; bottom: 0` em vez de `fixed`: a barra respeita a largura
// do container sozinha, sem precisar saber quanto mede a sidebar — e não cobre
// o fim da lista quando a página termina.
//
// Os números saem todos de dieta-calc.js (macrosPlano + progresso). Nenhuma
// conta nova mora aqui.
function somasHtml() {
  const p = _plano || {};
  const t = macrosPlano(principais());
  const pk = progresso(t.kcal, p.kcal_meta);

  const macro = (lbl, atual, meta, tom) => {
    const pr = progresso(atual, meta);
    return `
      <div class="di-so-item">
        <span class="di-so-lbl"><i class="di-so-dot di-so-dot-${tom}" aria-hidden="true"></i>${lbl}</span>
        <span class="di-so-val">${fmtG(atual)}<em>g</em></span>
        ${pr.temMeta ? `<span class="di-so-sub di-txt-${pr.status}">${pr.pctReal}% de ${fmtG(meta)}</span>` : ''}
      </div>`;
  };

  const n = principais().length;
  const itens = _refeicoes.reduce((s, r) => s + (r.itens?.length || 0), 0);

  return `
    <footer class="di-somas" id="diSomas" role="region" aria-label="Totais do plano">
      <div class="di-so-item di-so-kcal">
        <span class="di-so-lbl">Calorias</span>
        <span class="di-so-val">${fmtKcal(t.kcal)}${pk.temMeta ? `<em>/ ${fmtKcal(p.kcal_meta)}</em>` : '<em>kcal</em>'}</span>
        ${pk.temMeta
          ? `<div class="di-bar di-bar-${pk.status}" role="progressbar" aria-valuenow="${pk.pctReal}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pk.pct}%"></span></div>`
          : `<span class="di-so-sub">defina no cálculo</span>`}
      </div>

      ${macro('Proteína', t.prot, p.prot_meta, 'prot')}
      ${macro('Carboidrato', t.carb, p.carb_meta, 'carb')}
      ${macro('Gordura', t.gord, p.gord_meta, 'gord')}

      ${t.fibra > 0 ? `
        <div class="di-so-item">
          <span class="di-so-lbl">Fibra</span>
          <span class="di-so-val">${fmtG(t.fibra)}<em>g</em></span>
        </div>` : ''}

      <div class="di-so-item di-so-conta">
        <span class="di-so-lbl">Prescrição</span>
        <span class="di-so-val">${n}<em>${n === 1 ? 'refeição' : 'refeições'}</em></span>
        <span class="di-so-sub">${itens} ${itens === 1 ? 'alimento' : 'alimentos'}</span>
      </div>

      <div class="di-so-item di-so-meta">
        <span class="di-so-lbl">Meta</span>
        <span class="di-so-val">${pk.temMeta ? `<span class="di-txt-${pk.status}">${pk.pctReal}<em>%</em></span>` : '—'}</span>
        <span class="di-so-sub">${pk.temMeta
          ? (pk.resta > 0 ? `faltam ${fmtKcal(pk.resta)} kcal` : pk.excedeu > 0 ? `${fmtKcal(pk.excedeu)} kcal acima` : 'na meta')
          : 'sem meta definida'}</span>
      </div>
    </footer>`;
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
  // As alternativas aparecem sob a principal que substituem, nunca soltas na
  // rotina: fora do contexto, "Vitamina proteica" às 07:00 pareceria uma
  // segunda refeição do dia.
  const lista = principais();
  return lista.map((r, i) => {
    const alts = alternativasDe(r.id);
    return refeicaoCardHtml(r, i, lista.length)
      + (alts.length ? `<div class="rt-alts">${
          alts.map(a => refeicaoCardHtml(a, 0, 1, { alternativa: true })).join('')
        }</div>` : '');
  }).join('');
}

// Ícone por refeição, deduzido do nome. É decoração: se o nome não bater com
// nada conhecido, cai no talher genérico. Nada aqui vira dado nem é salvo.
const ICONES = [
  [/café|cafe|desjejum|manh/i, 'sunrise'],
  [/almo[çc]o/i, 'sun'],
  [/jantar|noite/i, 'moon'],
  [/ceia/i, 'moon-star'],
  [/pr[ée].?treino/i, 'zap'],
  [/p[óo]s.?treino/i, 'dumbbell'],
  [/lanche|colaç|merenda/i, 'cookie'],
  [/vitamina|shake|suco/i, 'cup-soda'],
];
const iconeDaRefeicao = (nome) =>
  (ICONES.find(([re]) => re.test(String(nome || '')))?.[1]) || 'utensils';

/**
 * Macro na coluna: SEMPRE uma casa decimal.
 *
 * `fmtG` omite o ",0" (30 vira "30", 30,6 vira "30,6"), o que é bom em texto
 * corrido e péssimo em coluna: "49" e "41,7" desalinham a vírgula e o olho
 * perde a referência entre as linhas. Isto é formatação de exibição — a conta
 * continua vindo inteira de dieta-calc.js.
 */
const fmtMacro = (v) => (Number(v) || 0)
  .toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Indicador do cabeçalho: valor forte em cima, legenda discreta embaixo.
 *
 * A legenda saiu da faixa de cabeçalho e passou a viver DENTRO de cada célula.
 * Com o rótulo colado no número, some a viagem de ida e volta do olho até o
 * topo da lista para lembrar qual coluna era qual — e a faixa extra de chrome
 * deixa de existir.
 */
const indicador = (valor, unidade, legenda, tom) => `
  <span class="rt-val ${tom ? `rt-val-${tom}` : ''}">
    <span class="rt-val-num">${valor}<em>${unidade}</em></span>
    <span class="rt-val-lbl">${tom ? `<i class="di-so-dot di-so-dot-${tom}" aria-hidden="true"></i>` : ''}${legenda}</span>
  </span>`;

/**
 * NÍVEL 1 — linha da refeição.
 *
 * A linha inteira é UM botão em grade: identidade + quatro colunas numéricas de
 * largura fixa, para kcal ficar embaixo de kcal em todas as refeições. As ações
 * ficam fora do botão (irmãs, posicionadas na última coluna), então clicar numa
 * delas não pode abrir a refeição por acidente — não há aninhamento.
 */
function refeicaoCardHtml(r, idx, total, opts = {}) {
  const itens = r.itens || [];
  const m = macrosRefeicao(r);
  const subs = itens.reduce((s, it) => s + substituicoesDoItem(it).length, 0);
  const obs = String(r.observacao ?? '').trim();
  const aberta = _resumos.has(r.id);
  const editando = refeicaoAberta() === r.id;
  const painelId = `rt-resumo-${r.id}`;
  const ehAlt = !!opts.alternativa;
  const alts = ehAlt ? [] : alternativasDe(r.id);
  const instrucao = String(r.instrucao ?? '').trim();

  const conta = (n, um, muitos) =>
    n ? `<span class="rt-conta">${n} ${n === 1 ? um : muitos}</span>` : '';

  const acao = (nome, icone, rotulo, extra = '') => `
    <button class="rt-btn" data-acao="${nome}" data-ref="${r.id}" ${extra}
            title="${esc(rotulo)}" aria-label="${esc(rotulo)} — ${esc(r.nome || 'refeição')}">
      <i data-lucide="${icone}"></i>
    </button>`;

  return `
    <article class="rt-card ${aberta ? 'aberta' : ''} ${editando ? 'editando' : ''} ${ehAlt ? 'alternativa' : ''}" data-ref-card="${r.id}">
      <!-- Linha e ações lado a lado num flex: as ações ocupam espaço de verdade
           e ficam centradas pelo align-items. Antes eram posicionadas de forma
           absoluta, com deslocamento fixo do topo, e a linha reservava o lugar
           delas em padding — bastava a linha mudar de altura para os botões
           saírem do eixo. -->
      <div class="rt-topo">
      <button class="rt-linha" data-ref-toggle="${r.id}"
              aria-expanded="${aberta}" aria-controls="${painelId}">
        <span class="rt-ident">
          <span class="rt-seta" aria-hidden="true"><i data-lucide="chevron-right"></i></span>
          <span class="rt-hora">${ehAlt ? '<span class="rt-ou">ou</span>' : (esc(hhmm(r.horario)) || '--:--')}</span>
          <span class="rt-icone" aria-hidden="true"><i data-lucide="${iconeDaRefeicao(r.nome)}"></i></span>
          <span class="rt-id">
            <span class="rt-nome">${esc(r.nome || 'Refeição sem nome')}</span>
            <span class="rt-contagens">
              ${conta(itens.length, 'alimento', 'alimentos')}
              ${conta(subs, 'substituição', 'substituições')}
              ${conta(alts.length, 'alternativa', 'alternativas')}
              ${obs ? `<span class="rt-conta rt-conta-obs"><i data-lucide="message-square-text" aria-hidden="true"></i>observação</span>` : ''}
              ${instrucao ? `<span class="rt-conta rt-conta-obs" title="${esc(instrucao)}"><i data-lucide="info" aria-hidden="true"></i>${esc(instrucao)}</span>` : ''}
            </span>
          </span>
        </span>

        ${indicador(fmtKcal(m.kcal), 'kcal', 'Calorias', 'kcal')}
        ${indicador(fmtMacro(m.prot), 'g', 'Proteína', 'prot')}
        ${indicador(fmtMacro(m.carb), 'g', 'Carboidrato', 'carb')}
        ${indicador(fmtMacro(m.gord), 'g', 'Gordura', 'gord')}
      </button>

      <div class="rt-acts">
        ${acao('editar', 'pencil', 'Editar refeição')}
        ${acao('subir', 'chevron-up', 'Mover para cima', idx === 0 ? 'disabled' : '')}
        ${acao('descer', 'chevron-down', 'Mover para baixo', idx === total - 1 ? 'disabled' : '')}
        <div class="di-menu-wrap">
          ${acao('menu', 'ellipsis-vertical', 'Mais ações', 'aria-haspopup="menu" aria-expanded="false"')}
          <div class="di-menu" data-ref-menu-pop="${r.id}" role="menu" hidden>
            <button role="menuitem" data-acao="add" data-ref="${r.id}"><i data-lucide="plus"></i> Adicionar alimento</button>
            <button role="menuitem" data-acao="duplicar" data-ref="${r.id}"><i data-lucide="copy-plus"></i> Duplicar refeição</button>
            <button role="menuitem" data-acao="excluir" data-ref="${r.id}" class="perigo"><i data-lucide="trash-2"></i> Excluir refeição</button>
          </div>
        </div>
      </div>
      </div>

      <div class="rt-resumo" id="${painelId}" ${aberta ? '' : 'hidden'}>
        ${aberta ? resumoRefeicaoHtml(r) : ''}
      </div>
    </article>`;
}

/**
 * Resumo inline — SOMENTE LEITURA. Serve para conferir o que foi prescrito sem
 * entrar no editor; por isso não há um único campo editável aqui. Macros não
 * se repetem: já estão no cabeçalho da linha.
 */
function resumoRefeicaoHtml(r) {
  const itens = r.itens || [];
  const obs = String(r.observacao ?? '').trim();

  if (!itens.length) {
    return `
      <div class="rt-vazio">
        <div class="rt-vazio-txt">
          <strong>Esta refeição ainda não possui alimentos.</strong>
          <span>Adicione o primeiro para ela entrar nos totais do plano.</span>
        </div>
        <button class="btn primary" data-acao="add" data-ref="${r.id}">
          <i data-lucide="plus"></i> Adicionar primeiro alimento
        </button>
      </div>`;
  }

  // Ações rápidas do alimento: aparecem no hover/foco da própria linha. Não é
  // edição em linha — cada uma abre ou executa uma operação que já existia.
  const rapida = (acao, icone, rotulo, it) => `
    <button class="rt-al-btn" data-acao="${acao}" data-ref="${r.id}" data-item="${it.id}"
            title="${esc(rotulo)}" aria-label="${esc(rotulo)} — ${esc(it.food?.nome || 'alimento')}">
      <i data-lucide="${icone}"></i>
    </button>`;

  const linhas = itens.map(it => {
    const f = it.food || {};
    // Um adaptador só: quantidade, medida e peso saem daqui já prontos para a
    // tela. Nada é derivado de novo dentro do template.
    const v = itemParaResumo(it, _medidasDe.get(it.food_id) || []);

    // "3 opções" em vez de "3 substituições": é o que o paciente ganha, dito
    // do jeito que o nutri fala na consulta.
    const chip = v.substituicoes
      ? `<button class="rt-al-chip" data-acao="subs" data-ref="${r.id}" data-item="${it.id}"
                 title="Ver as ${v.substituicoes} opções de substituição">${v.substituicoes} ${v.substituicoes === 1 ? 'opção' : 'opções'}</button>`
      : '<span class="rt-al-nulo">—</span>';

    return `
      <li class="rt-al">
        <span class="rt-al-nome" title="${esc(f.nome || '')}">${esc(f.nome || '(alimento removido)')}</span>
        <span class="rt-al-qtd">${v.quantidade ?? '<span class="rt-al-nulo" title="A medida salva neste item não existe mais no cadastro do alimento">—</span>'}</span>
        <span class="rt-al-med ${v.medidaConhecida ? '' : 'rt-al-med-orfa'}"
              ${v.medidaConhecida ? '' : 'title="Medida salva no item, mas ausente no cadastro do alimento"'}>${esc(v.medida)}</span>
        <span class="rt-al-peso">${v.pesoTexto}</span>
        <span class="rt-al-subs">${chip}</span>
        <span class="rt-al-acts">
          ${rapida('editar', 'pencil', 'Editar', it)}
          ${rapida('subs', 'repeat-2', 'Substituições', it)}
          ${rapida('dup-item', 'copy', 'Duplicar', it)}
          ${rapida('del-item', 'trash-2', 'Excluir', it)}
        </span>
      </li>`;
  }).join('');

  return `
    <div class="rt-resumo-in">
      <ul class="rt-al-lista" role="list">
        <li class="rt-al rt-al-th" aria-hidden="true">
          <span>Alimento</span><span>Qtd</span><span>Medida</span><span>Peso</span><span>Substituições</span><span></span>
        </li>
        ${linhas}
      </ul>

      ${obs ? `<p class="rt-resumo-obs"><i data-lucide="message-square-text" aria-hidden="true"></i>${esc(obs)}</p>` : ''}

      ${actionBarHtml(r)}
    </div>`;
}

/**
 * Action Bar da refeição — três níveis de hierarquia, não três botões iguais.
 *   principal  Editar refeição   sólido, é para onde o trabalho vai
 *   secundária Adicionar alimento outline verde
 *   terciária  Duplicar           outline cinza
 */
function actionBarHtml(r) {
  return `
    <div class="rt-bar">
      <button class="rt-acao rt-acao-1" data-acao="editar" data-ref="${r.id}">
        <i data-lucide="pencil"></i> Editar refeição
      </button>
      <button class="rt-acao rt-acao-2" data-acao="add" data-ref="${r.id}">
        <i data-lucide="plus"></i> Adicionar alimento
      </button>
      <button class="rt-acao rt-acao-3" data-acao="duplicar" data-ref="${r.id}">
        <i data-lucide="copy-plus"></i> Duplicar
      </button>
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

        <!-- Alternativa: substitui uma refeição INTEIRA, não um alimento. Só
             refeições principais podem ser substituídas — alternativa de
             alternativa não tem significado para o paciente. -->
        <div class="di-alt-bloco">
          <label class="di-switch">
            <input type="checkbox" id="diNovaRefAlt">
            <span class="di-switch-ui" aria-hidden="true"></span>
            <span class="di-switch-txt">
              <b>Esta é uma refeição alternativa</b>
              <em>O paciente escolhe entre ela e a refeição que ela substitui.</em>
            </span>
          </label>

          <div class="di-alt-campos" id="diNovaRefAltCampos" hidden>
            <div class="av-field">
              <label for="diNovaRefSubstitui">Substitui qual refeição?</label>
              <select id="diNovaRefSubstitui" class="np-input">
                ${principais().map(r => `
                  <option value="${r.id}">${esc(r.nome || 'Refeição')}${r.horario ? ` · ${esc(hhmm(r.horario))}` : ''}</option>`).join('')}
              </select>
            </div>
            <div class="av-field">
              <label for="diNovaRefInstrucao">Orientação ao paciente <span class="di-opcional">opcional</span></label>
              <input type="text" id="diNovaRefInstrucao" class="np-input"
                     placeholder="Ex.: use esta opção quando estiver fora de casa">
            </div>
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

// Cada ação tem seu botão. Não sobrou nada para um menu "..." nesta tela:
// arquivar, excluir e histórico do plano não existem no produto (excluir mora
// na lista de planos), e menu vazio é pior que menu nenhum.
function ligarBarra(cont) {
  const ao = (id, fn) => cont.querySelector('#' + id)?.addEventListener('click', fn);

  ao('diSalvarRasc', () => salvarDados());
  ao('diPublicar', () => publicarPlano());
  ao('diEditarCalc', irParaCalculo);
  ao('plDadosEditar', () => { _dadosAberto = true; montarDadosCard(); });

  ao('diAddRefeicao', () => abrirNovaRefeicao());
  ao('diDuplicar', () => salvarPlanoNaBiblioteca(_plano.id, _plano.nome, null));
  ao('diPdf', () => window.print());
  ao('diAtalhos', mostrarAtalhos);
}

// "Editar cálculo" → salta para a aba Cálculo de Calorias (onde as metas moram).
// A navegação é a do Hub do paciente; fora dele, apenas orienta.
function irParaCalculo() {
  const aba = document.querySelector('.hub-tab[data-aba="calorias"]');
  if (aba) { aba.click(); return; }
  mostrarToast('Abra a aba "Calorias" para editar as metas.');
}

function ligarNovaRefeicao(cont) {
  const abrir = cont.querySelector('#diNovaAbrir');
  const form = cont.querySelector('#diNovaForm');
  const mostrar = () => {
    form.hidden = false;
    abrir.hidden = true;
    cont.querySelector('#diNovaRefNome')?.focus();
  };
  _abrirNovaRefeicao = mostrar;      // o botão da barra de ferramentas usa o mesmo caminho
  abrir?.addEventListener('click', mostrar);
  cont.querySelector('#diVazioNova')?.addEventListener('click', mostrar);
  cont.querySelector('#diVazioModelo')?.addEventListener('click', () => escolherModelo());
  cont.querySelector('#diNovaCancelar')?.addEventListener('click', () => {
    form.hidden = true; abrir.hidden = false;
  });
  // O switch de alternativa revela os campos que só fazem sentido com ele
  // ligado — e some quando não há principal para substituir.
  const alt = cont.querySelector('#diNovaRefAlt');
  const altCampos = cont.querySelector('#diNovaRefAltCampos');
  if (alt && altCampos) {
    if (!principais().length) alt.closest('.di-alt-bloco')?.setAttribute('hidden', '');
    alt.addEventListener('change', () => {
      altCampos.hidden = !alt.checked;
      if (alt.checked) cont.querySelector('#diNovaRefSubstitui')?.focus();
    });
  }

  cont.querySelector('#diAddRef')?.addEventListener('click', adicionarRefeicao);
  cont.querySelector('#diNovaRefNome')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); adicionarRefeicao(); }
  });
}

// Mostrar o formulário de nova refeição é responsabilidade de ligarNovaRefeicao;
// a barra de ferramentas só precisa de um gatilho, e ele é registrado no render.
let _abrirNovaRefeicao = null;
function abrirNovaRefeicao() {
  if (_abrirNovaRefeicao) _abrirNovaRefeicao();
  qs('diNovaRefNome')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function ligarRefeicoes(cont) {
  // O drawer também renderiza [data-ref-campo]; ele liga os seus em
  // ligarRefeicaoDrawer. Aqui só os do Nível 1 — que hoje não tem nenhum, mas
  // a consulta continua barata e o dia em que voltar a ter, funciona.
  cont.querySelectorAll('.di-refeicoes [data-ref-campo]').forEach(el =>
    el.addEventListener('change', () => salvarCampoRefeicao(el)));

  // DELEGAÇÃO. Um listener no container, não um por botão: a lista é recriada
  // a cada render (mover, salvar, abrir resumo), e ligar botão a botão fazia o
  // número de listeners crescer junto com o número de renders.
  //
  // `_delegado` garante que o listener é registrado UMA vez por container;
  // renders seguintes reaproveitam o mesmo, porque o alvo é resolvido no clique
  // e não no momento da ligação.
  if (cont.dataset.delegado !== '1') {
    cont.dataset.delegado = '1';
    cont.addEventListener('click', aoClicarNaRotina);
  }

  // Os alimentos não existem mais neste nível: quem os liga é o drawer da
  // refeição, com o mesmo contrato (apiRefeicao().acoesItem).
}

/**
 * Resolve o clique na rotina: primeiro uma AÇÃO, depois a linha.
 *
 * A ordem importa. Os botões de ação são irmãos do botão da linha (não estão
 * dentro dele), então nem haveria aninhamento — mas o `closest` de ação vem
 * antes e com stopPropagation para que nenhum controle novo, colocado dentro da
 * linha um dia, abra o resumo por acidente.
 */
function aoClicarNaRotina(e) {
  const btnAcao = e.target.closest('[data-acao]');
  if (btnAcao && !btnAcao.disabled) {
    e.stopPropagation();
    e.preventDefault();
    executarAcaoDaRefeicao(btnAcao.dataset.acao, btnAcao.dataset.ref, btnAcao, btnAcao.dataset.item);
    return;
  }

  const linha = e.target.closest('[data-ref-toggle]');
  if (linha) alternarResumo(linha.dataset.refToggle);
}

function executarAcaoDaRefeicao(acao, id, btn, itemId) {
  switch (acao) {
    case 'editar':   abrirRefeicao(id, apiRefeicao()); break;
    case 'subir':    moverRefeicao(id, -1); break;
    case 'descer':   moverRefeicao(id, +1); break;
    case 'add':      fecharMenus(); abrirDrawer(id); break;
    case 'duplicar': fecharMenus(); duplicarRefeicaoUI(id); break;
    case 'excluir':  fecharMenus(); removerRefeicao(id); break;

    // Ações rápidas do alimento, do resumo. Reaproveitam os mesmos handlers do
    // editor — o resumo continua sem campo editável, só dispara operações.
    case 'subs':     verSubstituicoes(itemId); break;
    case 'dup-item': duplicarItemUI(itemId); break;
    case 'del-item': removerItem(itemId); break;
    case 'menu': {
      const pop = _mountEl?.querySelector(`[data-ref-menu-pop="${id}"]`);
      if (pop) abrirMenu(btn, pop);
      break;
    }
  }
}

function fecharMenus() {
  _mountEl?.querySelectorAll('.di-menu').forEach(m => { m.hidden = true; });
  _mountEl?.querySelectorAll('[aria-haspopup="menu"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

/** Abre/fecha o resumo inline. Várias refeições podem ficar abertas ao mesmo tempo. */
function alternarResumo(id) {
  if (_resumos.has(id)) _resumos.delete(id); else _resumos.add(id);
  renderRefeicoes();
}

function verSubstituicoes(id) {
  const { item } = acharItem(id);
  if (item) abrirSubstituicoes(item, { medidasDe: _medidasDe });
}

/**
 * A observação só existe na linha quando tem conteúdo (o campo vazio em toda
 * linha era ruído). Pelo botão, ela nasce: cria o campo, foca e some sozinha se
 * o nutri sair sem escrever nada.
 */
function pedirObservacao(id) {
  const { item } = acharItem(id);
  if (!item) return;
  const linha = _mountEl?.querySelector(`[data-item-row="${id}"] .c-nome`);
  if (!linha) return;

  let campo = linha.querySelector('[data-item-campo="observacao"]');
  if (!campo) {
    const cx = document.createElement('div');
    cx.className = 'di-it-obs';
    cx.innerHTML = `<i data-lucide="message-square-text" aria-hidden="true"></i>
      <input type="text" class="di-obs" value="" data-item-campo="observacao" data-item-id="${id}"
             placeholder="Observação para o paciente" aria-label="Observação">`;
    linha.appendChild(cx);
    campo = cx.querySelector('input');
    campo.addEventListener('change', () => salvarCampoItem(campo));
    // Sem texto, o campo não vira registro nem linha permanente.
    campo.addEventListener('blur', () => {
      if (!campo.value.trim() && !item.observacao) cx.remove();
    });
    window.renderIcons?.();
  }
  campo.focus();
}

// ───────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────
// BUSCA DE ALIMENTOS — o drawer mora em dieta-busca.js
// ───────────────────────────────────────────────────────────
// Aqui fica só a ponte: o módulo de busca não conhece o plano, e esta tela não
// conhece paginação, filtro nem favorito. O contrato é esta `api`.
function apiBusca() {
  return {
    qs,
    rerender: renderRefeicoes,
    medidasDe: _medidasDe,
    carregarMedidas: carregarMedidasDe,
    adicionar: adicionarAlimento,
    nutriId: getNutriId,
    sugestoes: carregarSugestoes,
    invalidarSugestoes: () => { _sugestoes = null; },
  };
}

async function abrirDrawer(refId) {
  await abrirBusca(refId, apiBusca());
}

function mostrarAtalhos() {
  confirmar({
    titulo: 'Atalhos do teclado',
    mensagem: [
      'NA BUSCA DE ALIMENTOS',
      'Ctrl/Cmd + K       abrir a busca',
      'Ctrl/Cmd + Enter   adicionar alimento na refeição do cursor',
      '↑ ↓            navegar nos resultados',
      'Enter          adicionar o alimento selecionado',
      'Esc            fechar a busca',
      '',
      'NA PRESCRIÇÃO',
      'Ctrl/Cmd + S   salvar o plano',
      'Enter          confirmar a quantidade e descer para o próximo alimento',
      'Shift + Enter  confirmar e subir para o alimento anterior',
      'Tab            andar entre quantidade, medida e ações da linha',
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

  // Alternativa: substitui uma refeição inteira. Sem principal selecionada não
  // há o que substituir, então o switch é ignorado em vez de gravar um vínculo
  // solto.
  const ehAlt = !!qs('diNovaRefAlt')?.checked;
  const substitui = ehAlt ? (qs('diNovaRefSubstitui')?.value || null) : null;
  const instrucao = ehAlt ? ((qs('diNovaRefInstrucao')?.value || '').trim() || null) : null;
  if (ehAlt && !substitui) { mostrarToast('Escolha qual refeição esta alternativa substitui'); return; }

  const extras = { substitui_refeicao_id: substitui, instrucao };

  try {
    const nutriId = await getNutriId();
    let nova;
    if (copiarDe) {
      const base = _refeicoes.find(r => r.id === copiarDe);
      nova = await comSave(() => duplicarRefeicao(nutriId, base, {
        nome, horario: hora || null, ordem: _refeicoes.length, ...extras,
      }));
    } else {
      nova = await comSave(() => criarRefeicao(nutriId, {
        plano_id: _plano.id, nome, horario: hora || null, ordem: _refeicoes.length, ...extras,
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
  if (_modo === 'paciente' && _plano?.ativo) await eventoPlanoPublicado();
}

// ── Timeline do plano ──────────────────────────────────────
// O que vale para o acompanhamento é a publicação (o plano que passou a valer)
// e a revisão do plano — nunca cada alimento ou cada gram a mais.

/** Números reais da prescrição, para o metadata do evento. */
function resumoDoPlano() {
  // Plano ainda vazio soma zero — e zero aqui seria um dado falso, não um dado.
  const m = macrosPlano(principais()) || {};
  return {
    plan_name: _plano?.nome,
    calories: m.kcal ? arredonda(m.kcal, 0) : null,
    target_calories: _plano?.kcal_meta ? arredonda(Number(_plano.kcal_meta), 0) : null,
    meals: principais().length || null,
    protein: m.prot ? arredonda(m.prot, 1) : null,
    carbohydrate: m.carb ? arredonda(m.carb, 1) : null,
    fat: m.gord ? arredonda(m.gord, 1) : null,
    objetivo: _plano?.objetivo,
  };
}

async function eventoPlanoPublicado() {
  const r = resumoDoPlano();
  const partes = [];
  if (r.meals) partes.push(`${r.meals} ${r.meals === 1 ? 'refeição' : 'refeições'}`);
  if (r.calories) partes.push(`${fmtKcal(r.calories)} kcal prescritas`);
  await registrarEvento({
    pacienteId: _paciente.id,
    tipo: 'MEAL_PLAN_PUBLISHED',
    descricao: `Plano "${_plano?.nome || 'sem nome'}" publicado${partes.length ? ' · ' + partes.join(' · ') : ''}.`,
    entidadeTipo: 'plano',
    entidadeId: _plano.id,
    metadata: r,
    dedupPorDia: true,
  });
}

async function eventoPlanoAtualizado() {
  await registrarEvento({
    pacienteId: _paciente.id,
    tipo: 'MEAL_PLAN_UPDATED',
    descricao: 'Calorias, metas de macronutrientes e composição das refeições foram ajustadas.',
    entidadeTipo: 'plano',
    entidadeId: _plano.id,
    metadata: resumoDoPlano(),
    dedupPorDia: true,
  });
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
 * Os itens na ordem em que aparecem na tela. Só a refeição aberta no drawer
 * tem alimentos visíveis — o Enter não pode mandar o foco para um campo que
 * não está na tela.
 */
function itensVisiveis() {
  const r = acharRefeicao(refeicaoAberta());
  return (r?.itens || []).map(it => it.id);
}

/** Marca quem recebe o foco depois do próximo render. `dir` +1 desce, -1 sobe. */
function agendarFocoVizinho(id, dir) {
  const ids = itensVisiveis();
  const i = ids.indexOf(id);
  const alvo = i < 0 ? null : ids[i + dir];
  // Sem vizinho (última linha), o foco fica onde está — melhor que pular para
  // o começo da lista, que faria o nutri perder o lugar sem perceber.
  _focoDepois = `[data-item-qtd="${alvo || id}"]`;
}

/**
 * Grava a quantidade digitada.
 *
 * O campo mostra a quantidade NA MEDIDA escolhida (2 colheres), mas o banco
 * guarda múltiplo de 100 g. A conversão passa por gramas:
 *   2 colheres x 25 g = 50 g -> quantidade = 0,5
 */
async function salvarQuantidade(id, { seguir = 0 } = {}) {
  const { item } = acharItem(id);
  const el = _mountEl?.querySelector(`[data-item-qtd="${id}"]`);
  if (!item || !el) return;

  if (seguir) agendarFocoVizinho(id, seguir);

  const n = num(el.value);
  if (n == null || n < 0) { renderRefeicoes(); return; }   // valor inválido: volta ao que era

  const medidas = _medidasDe.get(item.food_id) || [];
  const gramas = gramasDeMedida(medidas, item.medida, n);
  const quantidade = quantidadeDePeso(gramas);
  if (quantidade === Number(item.quantidade)) {
    // Nada mudou, mas o Enter ainda tem que andar: sem render, o foco é aqui.
    if (seguir) { const alvo = _mountEl?.querySelector(_focoDepois); _focoDepois = null; alvo?.focus(); alvo?.select?.(); }
    return;
  }

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

    // Ctrl+Enter adiciona alimento NA REFEIÇÃO EM QUE O CURSOR ESTÁ — com oito
    // refeições na tela, abrir sempre na primeira faria o nutri corrigir o
    // destino toda vez.
    if (e.key === 'Enter') {
      e.preventDefault();
      const alvo = acharRefeicao(refeicaoAberta()) || refeicaoDoFoco() || _refeicoes[0];
      if (alvo) abrirDrawer(alvo.id);
      else mostrarToast('Adicione uma refeição primeiro');
      return;
    }

    const k = e.key.toLowerCase();
    if (k === 'k') {
      e.preventDefault();
      if (buscaAberta()) { qs('diDwInput')?.focus(); return; }
      const alvo = acharRefeicao(refeicaoAberta()) || refeicaoDoFoco() || _refeicoes[0];
      if (alvo) abrirDrawer(alvo.id);
      else mostrarToast('Adicione uma refeição primeiro');
    } else if (k === 's') {
      e.preventDefault();
      salvarDados();
    }
  });
}

/** A refeição que contém o elemento focado, se houver. */
function refeicaoDoFoco() {
  const card = document.activeElement?.closest?.('[data-ref-card]');
  const id = card?.dataset?.refCard;
  return id ? _refeicoes.find(r => r.id === id) || null : null;
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
