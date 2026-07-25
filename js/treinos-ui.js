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
  listarModelos, prescreverModeloParaPaciente, salvarComoModelo,
} from './treinos.js';
import { sb } from './supabase.js';
import { mostrarToast, mostrarErro, confirmar } from './utils.js';

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

// ── Gerador de treino por IA ──
const GRUPOS_MUSC = ['Peitoral', 'Costas', 'Quadríceps', 'Posterior', 'Ombros', 'Bíceps', 'Tríceps', 'Glúteos', 'Panturrilhas', 'Abdômen'];
const OBJETIVOS = ['Hipertrofia', 'Força', 'Emagrecimento', 'Resistência'];
const NIVEIS = ['Iniciante', 'Intermediário', 'Avançado'];
const PRIO = { '': { label: '', cls: '' }, alta: { label: 'Alta', cls: 'prio-alta' }, media: { label: 'Média', cls: 'prio-media' }, baixa: { label: 'Baixa', cls: 'prio-baixa' } };
const PRIO_NEXT = { '': 'alta', alta: 'media', media: 'baixa', baixa: '' };

// Em quais séries o drop set se aplica (só quando metodo = 'Drop-set').
// Guardamos "quantas das ÚLTIMAS" — 0 = todas as séries.
const DROP_OPCOES = [
  { v: '0', label: 'Todas as séries' },
  { v: '1', label: 'Somente a última' },
  { v: '2', label: 'Duas últimas' },
  { v: '3', label: 'Três últimas' },
];
const ehDropSet = (metodo) => String(metodo || '').trim().toLowerCase() === 'drop-set';
const ehBiset   = (metodo) => String(metodo || '').trim().toLowerCase() === 'bi-set';

// Cards de Bi-set recolhidos (guarda o id do exercício âncora A).
const _bisetRecolhidos = new Set();

// Acha o exercício B (parceiro) de um âncora, ou null.
function membroB(ancora) {
  return _itens.find(x => x.grupo_id === ancora.id && x.grupo_pos === 'B') || null;
}

// Unidades do dia atual (single | grupo), na ordem de exibição.
// O exercício B nunca vira um card próprio — é renderizado dentro do card do A.
function unidadesDoDia() {
  return _itens
    .filter(it => it.dia === _diaSel && it.grupo_pos !== 'B')
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
    .map(a => ehBiset(a.metodo)
      ? { tipo: 'grupo', a, b: membroB(a) }
      : { tipo: 'single', a, b: null });
}

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
        const periodo = t.data_fim
          ? `${fmtData(t.data_inicio)} → ${fmtData(t.data_fim)}`
          : `início ${fmtData(t.data_inicio)}`;
        const meta = ehModelo
          ? `${esc(divisaoLabel(t.divisao))} · <span style="color:var(--ink-mute)">modelo reutilizável</span>`
          : `${esc(divisaoLabel(t.divisao))} ·
              ${t.ativo
                ? '<span style="color:var(--moss)"><i data-lucide="circle-check"></i> Ativo</span>'
                : '<span style="color:var(--ink-mute)"><i data-lucide="circle"></i> Inativo</span>'} ·
              ${periodo}`;
        return `
        <div class="patient-row">
          <div class="patient-avatar"><i data-lucide="dumbbell"></i></div>
          <div class="patient-info">
            <div class="patient-name">${esc(t.nome || '(sem nome)')}</div>
            <div class="patient-meta">${meta}</div>
          </div>
          <button class="patient-action primary" data-tr-edit="${t.id}"><i data-lucide="pencil"></i> Abrir</button>
          ${ehModelo ? '' : `<button class="patient-action" data-tr-lib="${t.id}" data-tr-nome="${esc(t.nome || '')}" title="Salvar na biblioteca como modelo"><i data-lucide="copy-plus"></i></button>`}
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
           <button class="btn btn-ia" id="trBtnIA"><i data-lucide="sparkles"></i> Gerar com IA</button>
           <button class="btn" id="trBtnModelo"><i data-lucide="copy-plus"></i> Usar modelo</button>
           <button class="btn primary" id="trBtnNovo"><i data-lucide="plus"></i> Novo treino</button>
         </div>
       </div>`;

  _mountEl.innerHTML = `${header}<div class="patients-grid">${linhas}</div>`;

  document.getElementById('trBtnNovo').addEventListener('click', () => abrirEditor(null));
  const bModelo = document.getElementById('trBtnModelo');
  if (bModelo) bModelo.addEventListener('click', () => escolherModelo());
  document.getElementById('trBtnIA')?.addEventListener('click', () => renderGeradorIA());
  _mountEl.querySelectorAll('[data-tr-edit]').forEach(b =>
    b.addEventListener('click', () => abrirEditor(treinos.find(t => t.id === b.dataset.trEdit))));
  _mountEl.querySelectorAll('[data-tr-del]').forEach(b =>
    b.addEventListener('click', () => removerTreino(b.dataset.trDel, b.dataset.trNome)));
  _mountEl.querySelectorAll('[data-tr-lib]').forEach(b =>
    b.addEventListener('click', () => salvarTreinoNaBiblioteca(b.dataset.trLib, b.dataset.trNome, b)));
}

// Sobe um treino do aluno para a biblioteca como modelo reutilizável.
async function salvarTreinoNaBiblioteca(id, nome, btn) {
  if (!(await confirmar({
    titulo: 'Salvar como modelo',
    mensagem: `Salvar "${nome || 'este treino'}" na biblioteca como modelo reutilizável?\nOs exercícios são copiados; a progressão do aluno não.`,
    textoOk: 'Salvar',
  }))) return;
  if (btn) btn.disabled = true;
  try {
    await salvarComoModelo(id);
    mostrarToast('✓ Treino salvo na biblioteca');
  } catch (e) {
    mostrarErro('Erro: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function removerTreino(id, nome) {
  const termo = _modo === 'modelo' ? 'modelo' : 'treino';
  if (!(await confirmar({
    titulo: `Excluir ${termo}`,
    mensagem: `Excluir o ${termo} "${nome || 'sem nome'}"?\nOs exercícios ${_modo === 'modelo' ? 'do modelo' : 'do treino'} também serão removidos.`,
    textoOk: 'Excluir', perigo: true,
  }))) return;
  try {
    await excluirTreino(id);
    mostrarToast(_modo === 'modelo' ? '✓ Modelo excluído' : '✓ Treino excluído');
    await renderLista();
  } catch (e) { mostrarErro('Erro: ' + e.message); }
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
    mostrarErro('Erro ao aplicar modelo: ' + e.message);
    btn.disabled = false; btn.innerHTML = orig;
  }
}

// ═══════════════════════════════════════════════════════════
// NÍVEL 2 — Criar / editar treino (+ seletor de divisões)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// GERADOR DE TREINO POR IA (músculos-alvo + frequência semanal)
// ═══════════════════════════════════════════════════════════
async function renderGeradorIA() {
  let treinos = [];
  try { treinos = await listarTreinosDoPaciente(_paciente.id); } catch {}
  const base = treinos.filter(t => t.paciente_id);   // treinos prescritos ao aluno
  const temBase = base.length > 0;

  const chips = GRUPOS_MUSC.map(g => `
    <button type="button" class="ia-musc" data-musc="${esc(g)}" data-prio="">
      <span class="ia-musc-nome">${esc(g)}</span><span class="ia-musc-prio"></span>
    </button>`).join('');
  const optBase = base.map(t => `<option value="${t.id}">${esc(t.nome || 'Treino')}</option>`).join('');

  _mountEl.innerHTML = `
    <span class="ficha-voltar" id="iaVoltar"><i data-lucide="arrow-left"></i> Voltar para os treinos</span>
    <div class="av-form-card">
      <div class="av-form-title"><i data-lucide="sparkles"></i> Gerar treino com <em>IA</em></div>

      <div class="ia-modos">
        <button type="button" class="ia-modo active" data-ia-modo="criar"><i data-lucide="plus"></i> Criar do zero</button>
        <button type="button" class="ia-modo" data-ia-modo="evoluir" ${temBase ? '' : 'disabled'}><i data-lucide="trending-up"></i> Evoluir treino atual</button>
        <button type="button" class="ia-modo" data-ia-modo="ajustar" ${temBase ? '' : 'disabled'}><i data-lucide="wrench"></i> Ajustar treino atual</button>
      </div>

      <div data-ia-bloco="criar">
        <p class="ia-hint">Escolha os <b>músculos prioritários</b> (clique para alternar Alta → Média → Baixa) e os dias por semana. A IA monta a divisão, o volume e escolhe os exercícios da sua biblioteca.</p>
        <label class="ia-label">Músculos-alvo e prioridade</label>
        <div class="ia-muscs">${chips}</div>
      </div>

      <div data-ia-bloco="base" hidden>
        <div class="av-field"><label>Treino a usar como base</label>
          <select id="iaTreinoBase" class="np-input">${optBase}</select></div>
      </div>

      <div data-ia-bloco="evoluir" hidden>
        <p class="ia-hint">A IA aplica <b>progressão</b> sobre o treino atual usando as cargas que o aluno registrou — aumenta onde ele avançou, varia exercícios e periodiza. Um treino novo é gerado (o atual não é apagado).</p>
      </div>

      <div data-ia-bloco="ajustar" hidden>
        <div class="av-field"><label>O que ajustar</label>
          <input type="text" id="iaInstrucao" class="np-input" placeholder="Ex.: trocar leg press por agachamento; aluno com dor no ombro; reduzir volume de ombro">
          <span class="ia-hint" style="margin:6px 0 0;">Descreva o ajuste. A IA mexe o mínimo e mantém o resto do treino.</span></div>
      </div>

      <div class="tr-form-linha" data-ia-bloco="params" style="margin-top:16px;">
        <div class="av-field" data-ia-so="criar"><label>Dias por semana</label><select id="iaDias" class="np-input">${[2, 3, 4, 5, 6, 7].map(n => `<option value="${n}" ${n === 4 ? 'selected' : ''}>${n} dias</option>`).join('')}</select></div>
        <div class="av-field"><label>Objetivo</label><select id="iaObj" class="np-input">${OBJETIVOS.map(o => `<option>${o}</option>`).join('')}</select></div>
        <div class="av-field"><label>Nível</label><select id="iaNivel" class="np-input">${NIVEIS.map((o, i) => `<option ${i === 1 ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
        <div class="av-field"><label>Tempo/sessão (min)</label><input type="number" id="iaTempo" class="np-input" placeholder="ex.: 60"></div>
      </div>

      <div class="av-field" style="margin-top:12px;">
        <label>Observações (equipamentos, lesões, preferências)</label>
        <input type="text" id="iaObs" class="np-input" placeholder="Ex.: sem barra livre; dor no ombro direito; foco em glúteo">
      </div>
      <div class="av-actions">
        <button class="btn primary btn-ia" id="iaGerar"><i data-lucide="sparkles"></i> Gerar treino</button>
      </div>
      <div id="iaResultado"></div>
    </div>`;

  document.getElementById('iaVoltar').addEventListener('click', () => renderLista());
  document.getElementById('iaGerar').addEventListener('click', gerarTreinoIA);
  _mountEl.querySelectorAll('.ia-musc').forEach(b => b.addEventListener('click', () => {
    const next = PRIO_NEXT[b.dataset.prio || ''];
    b.dataset.prio = next;
    b.className = 'ia-musc' + (next ? ' ' + PRIO[next].cls : '');
    b.querySelector('.ia-musc-prio').textContent = next ? PRIO[next].label : '';
  }));
  _mountEl.querySelectorAll('.ia-modo').forEach(b =>
    b.addEventListener('click', () => { if (!b.disabled) aplicarModoIA(b.dataset.iaModo); }));
  aplicarModoIA('criar');
}

// Mostra/esconde os blocos do formulário conforme o modo escolhido.
function aplicarModoIA(modo) {
  _mountEl.querySelectorAll('.ia-modo').forEach(b => b.classList.toggle('active', b.dataset.iaModo === modo));
  const vis = {
    criar:   { criar: 1, base: 0, evoluir: 0, ajustar: 0, params: 1 },
    evoluir: { criar: 0, base: 1, evoluir: 1, ajustar: 0, params: 1 },
    ajustar: { criar: 0, base: 1, evoluir: 0, ajustar: 1, params: 0 },
  }[modo] || {};
  _mountEl.querySelectorAll('[data-ia-bloco]').forEach(el => { el.hidden = !vis[el.dataset.iaBloco]; });
  _mountEl.querySelectorAll('[data-ia-so]').forEach(el => { el.style.display = el.dataset.iaSo === modo ? '' : 'none'; });
  _mountEl.dataset.iaModo = modo;
}

// Reduz a biblioteca enviada à IA: cobre todos os grupos com um teto,
// dando mais espaço aos grupos-alvo. Corta bastante o custo da entrada.
function bibliotecaCompacta(todos, gruposAlvo) {
  const alvo = new Set((gruposAlvo || []).map(g => String(g).toLowerCase()));
  const porGrupo = {};
  todos.forEach(e => { (porGrupo[e.grupo_muscular || 'outros'] ||= []).push(e); });
  const out = [];
  for (const [g, exs] of Object.entries(porGrupo)) {
    const teto = alvo.has(g.toLowerCase()) ? 25 : 10;
    exs.slice(0, teto).forEach(e => out.push({ id: e.id, nome: e.nome, grupo: e.grupo_muscular || '' }));
  }
  return out.slice(0, 180);
}

// Texto compacto do treino atual (por dia) para a IA evoluir/ajustar.
function montarTextoTreino(itens) {
  const porDia = {};
  itens.filter(it => it.grupo_pos !== 'B')
    .sort((a, b) => String(a.dia).localeCompare(String(b.dia)) || (a.ordem ?? 0) - (b.ordem ?? 0))
    .forEach(it => { (porDia[it.dia] ||= []).push(it); });
  return Object.keys(porDia).sort().map(dia => {
    const linhas = porDia[dia].map(it => {
      const nome = it.exercicio?.nome || '(exercício)';
      const spec = [it.series ? `${it.series}x` : '', it.repeticoes || '', it.carga || '', it.metodo && it.metodo !== 'Normal' ? it.metodo : '']
        .filter(Boolean).join(' ');
      return `  - ${nome}${spec ? ` (${spec})` : ''}`;
    }).join('\n');
    return `Dia ${dia}:\n${linhas}`;
  }).join('\n');
}

// Resumo das últimas cargas registradas pelo aluno, por exercício.
async function montarTextoProgressao(itens) {
  const principais = itens.filter(it => it.grupo_pos !== 'B');
  const regs = await Promise.all(principais.map(it => listarProgressao(it.id).catch(() => [])));
  const linhas = [];
  principais.forEach((it, i) => {
    const ult = (regs[i] || [])[0];
    if (!ult) return;
    const arr = ult.series_realizadas || [];
    let txt;
    if (arr.length) txt = arr.map(s => `${s.peso ?? '–'}x${s.reps ?? '–'}`).join(', ');
    else if (ult.carga_realizada != null) txt = `${ult.carga_realizada}kg x ${ult.reps_realizadas ?? '–'}`;
    else return;
    linhas.push(`  - ${it.exercicio?.nome || '(exercício)'}: última sessão ${txt} (${(regs[i] || []).length} registros)`);
  });
  return linhas.length ? linhas.join('\n') : 'O aluno ainda não registrou cargas.';
}

async function gerarTreinoIA() {
  const modo = _mountEl.dataset.iaModo || 'criar';
  const res = document.getElementById('iaResultado');
  const btn = document.getElementById('iaGerar');

  const criterios = {
    objetivo: document.getElementById('iaObj')?.value,
    nivel: document.getElementById('iaNivel')?.value,
    tempoMin: Number(document.getElementById('iaTempo')?.value) || null,
    obs: (document.getElementById('iaObs')?.value || '').trim(),
  };
  const payload = { modo, criterios };
  let gruposAlvo = [];

  try {
    if (modo === 'criar') {
      const musculos = [...document.querySelectorAll('.ia-musc')]
        .filter(b => b.dataset.prio).map(b => ({ grupo: b.dataset.musc, prioridade: b.dataset.prio }));
      if (!musculos.length) { mostrarToast('Escolha ao menos um músculo prioritário.'); return; }
      criterios.musculos = musculos;
      criterios.dias = Number(document.getElementById('iaDias').value);
      gruposAlvo = musculos.map(m => m.grupo);
    } else {
      const treinoId = document.getElementById('iaTreinoBase')?.value;
      if (!treinoId) { mostrarToast('Selecione o treino base.'); return; }
      if (modo === 'ajustar') {
        const instr = (document.getElementById('iaInstrucao')?.value || '').trim();
        if (!instr) { mostrarToast('Descreva o ajuste desejado.'); return; }
        payload.instrucao = instr;
      }
      const itens = await listarItensDoTreino(treinoId);
      if (!itens.length) { mostrarToast('O treino base está sem exercícios.'); return; }
      gruposAlvo = [...new Set(itens.map(it => it.exercicio?.grupo_muscular).filter(Boolean))];
      payload.treinoAtualTexto = montarTextoTreino(itens);
      if (modo === 'evoluir') payload.progressaoTexto = await montarTextoProgressao(itens);
    }
  } catch (e) { mostrarToast('Erro ao preparar: ' + e.message); return; }

  btn.disabled = true;
  res.innerHTML = `<div class="loading" style="padding:24px;"><div class="spinner"></div>A IA está montando o treino... (pode levar alguns segundos)</div>`;
  try {
    const todos = await listarExercicios({ termo: '', limite: 500 });
    if (!todos.length) {
      res.innerHTML = `<div class="ia-erro"><i data-lucide="triangle-alert"></i> Sua biblioteca de exercícios está vazia. Cadastre exercícios em <b>Exercícios</b> antes de gerar.</div>`;
      return;
    }
    const bib = bibliotecaCompacta(todos, gruposAlvo);
    payload.exercicios = bib;
    const resp = await fetch('/api/gerar-treino', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error('O gerador por IA não está disponível neste endereço. Abra o painel pela URL da Vercel (o mesmo lugar onde o recordatório por IA funciona) — ele não funciona no GitHub Pages nem no localhost.');
    }
    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || ('Falha: ' + resp.status));
    renderPreviewIA(data, bib);
  } catch (e) {
    res.innerHTML = `<div class="ia-erro"><i data-lucide="triangle-alert"></i> ${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

function renderPreviewIA(plano, bib) {
  const nomeDe = id => (bib.find(e => e.id === id)?.nome) || '(exercício)';
  const dias = (plano.dias || []).map(d => `
    <div class="ia-dia">
      <div class="ia-dia-head"><span class="ia-dia-letra">${esc(d.dia || '')}</span> ${esc(d.foco || '')}</div>
      <div class="ia-dia-exs">
        ${(d.exercicios || []).map(ex => `
          <div class="ia-ex">
            <span class="ia-ex-nome">${esc(nomeDe(ex.exercicio_id))}</span>
            <span class="ia-ex-spec">${esc(String(ex.series ?? ''))}×${esc(ex.repeticoes || '')}${ex.descanso ? ` · ${esc(ex.descanso)}` : ''}${ex.metodo && ex.metodo !== 'Normal' ? ` · <b>${esc(ex.metodo)}</b>` : ''}</span>
          </div>`).join('')}
      </div>
    </div>`).join('');

  const r = plano.relatorio || {};
  const rel = (t, txt) => txt ? `<div class="ia-rel-item"><b>${t}</b><span>${esc(txt)}</span></div>` : '';

  const res = document.getElementById('iaResultado');
  res.innerHTML = `
    <div class="ia-preview">
      <div class="ia-preview-head">
        <div>
          <div class="ia-preview-nome">${esc(plano.nome || 'Treino gerado')}</div>
          <div class="ia-preview-sub">${(plano.dias || []).length} dias · gerado por IA — revise antes de criar</div>
        </div>
        <button class="btn primary" id="iaCriar"><i data-lucide="check"></i> Criar treino</button>
      </div>
      <div class="ia-dias">${dias}</div>
      <div class="ia-relatorio">
        ${rel('Estrutura', r.estrutura)}
        ${rel('Volume semanal', r.volume)}
        ${rel('Justificativa', r.justificativa)}
        ${rel('Tempo estimado', r.tempo_estimado)}
      </div>
      <div class="av-actions">
        <button class="btn" id="iaRefazer"><i data-lucide="rotate-ccw"></i> Ajustar critérios</button>
        <button class="btn primary" id="iaCriar2"><i data-lucide="check"></i> Criar treino</button>
      </div>
    </div>`;

  const criar = () => criarTreinoDaIA(plano);
  document.getElementById('iaCriar').addEventListener('click', criar);
  document.getElementById('iaCriar2').addEventListener('click', criar);
  document.getElementById('iaRefazer').addEventListener('click', () => { res.innerHTML = ''; });
  res.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function criarTreinoDaIA(plano) {
  const btns = [..._mountEl.querySelectorAll('#iaCriar, #iaCriar2')];
  btns.forEach(b => { b.disabled = true; });
  try {
    const nutriId = await getNutriId();
    const treino = await criarTreino(nutriId, {
      nome: plano.nome || 'Treino gerado por IA',
      paciente_id: _paciente.id,
      divisao: LETRAS.slice(0, plano.dias.length).join(''),
      ativo: true,
    });
    for (let di = 0; di < plano.dias.length; di++) {
      const letra = LETRAS[di];
      const exs = plano.dias[di].exercicios || [];
      for (let oi = 0; oi < exs.length; oi++) {
        const ex = exs[oi];
        await adicionarExercicioAoTreino(nutriId, {
          treino_id: treino.id,
          exercicio_id: ex.exercicio_id,
          dia: letra,
          ordem: oi,
          series: ex.series != null && ex.series !== '' ? parseInt(ex.series, 10) : null,
          repeticoes: ex.repeticoes || null,
          cadencia: ex.cadencia || null,
          descanso: ex.descanso || null,
          rir: ex.rir || null,
          metodo: ex.metodo || null,
          observacao: ex.observacao || null,
        });
      }
    }
    mostrarToast('✓ Treino criado! Revise e ajuste abaixo.');
    await abrirEditor(treino);
  } catch (e) {
    mostrarErro('Erro ao criar o treino: ' + e.message);
    btns.forEach(b => { b.disabled = false; });
  }
}

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
      <div class="av-field" style="margin-bottom: 14px;">
        <label>Nome do ${termo} *</label>
        <input type="text" id="trNome" value="${esc(t?.nome || '')}" class="np-input" placeholder="Ex.: Hipertrofia — Fase 1">
      </div>
      <div class="tr-form-linha">
        ${_modo === 'paciente' ? `
        <div class="av-field">
          <label>Data de início</label>
          <input type="date" id="trData" value="${t?.data_inicio || ''}" class="np-input">
        </div>
        <div class="av-field">
          <label>Data de término</label>
          <input type="date" id="trDataFim" value="${t?.data_fim || ''}" class="np-input">
        </div>
        <div class="av-field tr-field-num">
          <label>Nº de treinos</label>
          <input type="number" min="1" id="trNumTreinos" class="np-input" placeholder="ex.: 36">
        </div>` : ''}
        <div class="av-field tr-field-div">
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
        <button class="btn primary tr-salvar-linha" id="trSalvarDados">${t ? '<i data-lucide="save"></i> Salvar dados' : `<i data-lucide="plus"></i> Criar ${termo}`}</button>
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
  ligarAutocalculoDatas(t);

  if (t) {
    _mountEl.querySelectorAll('#trDiasTabs [data-dia]').forEach(b =>
      b.addEventListener('click', () => { _diaSel = b.dataset.dia; renderEditor(); }));
    renderDia();
  }
}

// Autocálculo entre "Nº de treinos" e "Data de término" (só no modo paciente).
// dias/semana = a divisão escolhida (ex.: ABC = 3 treinos por semana).
function ligarAutocalculoDatas(t) {
  const num = document.getElementById('trNumTreinos');
  if (!num) return;   // modo modelo: sem datas
  const ini = document.getElementById('trData');
  const fim = document.getElementById('trDataFim');
  const div = document.getElementById('trDivisao');

  const diasSemana = () => Math.max(1, Number(div?.value) || 1);
  const addDias = (dataStr, dias) => {
    const d = new Date(dataStr + 'T00:00:00');
    d.setDate(d.getDate() + dias);
    return d.toISOString().slice(0, 10);
  };
  const calcFim = () => {   // nº de treinos → data de término
    const n = Number(num.value);
    if (!ini?.value || !n || n < 1) return;
    const semanas = Math.ceil(n / diasSemana());
    fim.value = addDias(ini.value, semanas * 7);
  };
  const calcNum = () => {   // data de término → nº de treinos
    if (!ini?.value || !fim?.value) return;
    const dias = Math.round((new Date(fim.value + 'T00:00:00') - new Date(ini.value + 'T00:00:00')) / 86400000);
    if (dias < 0) return;
    num.value = Math.max(1, Math.round(dias / 7)) * diasSemana();
  };

  num.addEventListener('input', calcFim);
  fim?.addEventListener('change', calcNum);
  // Ao mudar início ou divisão, recalcula o lado que já tem valor.
  ini?.addEventListener('change', () => { if (num.value) calcFim(); else calcNum(); });
  div?.addEventListener('change', () => { if (num.value) calcFim(); else calcNum(); });

  // Editando um treino que já tem as duas datas: mostra o nº de treinos.
  if (t && ini?.value && fim?.value) calcNum();
}

async function salvarDados() {
  const nome = (document.getElementById('trNome').value || '').trim();
  if (!nome) { mostrarToast('Informe o nome do treino'); return; }
  const n = Number(document.getElementById('trDivisao').value);
  const dataEl = document.getElementById('trData');       // ausente no modo modelo
  const dataFimEl = document.getElementById('trDataFim'); // ausente no modo modelo
  const ativoEl = document.getElementById('trAtivo');     // ausente no modo modelo
  const dataInicio = dataEl ? (dataEl.value || null) : null;
  const dataFim = dataFimEl ? (dataFimEl.value || null) : null;
  if (dataInicio && dataFim && dataFim < dataInicio) {
    mostrarToast('A data de término não pode ser antes do início');
    return;
  }
  const dados = {
    nome,
    data_inicio: dataInicio,
    data_fim: dataFim,
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
      if (orfaos.length && !(await confirmar({
        titulo: 'Reduzir dias do treino',
        mensagem: `Reduzir para ${n} dias deixará ${orfaos.length} exercício(s) em dia(s) removido(s) — eles ficarão ocultos, mas não serão apagados. Continuar?`,
        textoOk: 'Continuar',
      }))) {
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
    mostrarErro('Erro ao salvar: ' + e.message);
    btn.disabled = false; btn.innerHTML = orig;
  }
}

// ═══════════════════════════════════════════════════════════
// NÍVEL 3 — Exercícios do dia selecionado
// ═══════════════════════════════════════════════════════════
function renderDia() {
  const cont = document.getElementById('trDiaConteudo');
  if (!cont) return;

  const unidades = unidadesDoDia();
  const nEx = _itens.filter(it => it.dia === _diaSel).length;

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

  const linhas = unidades.length
    ? unidades.map((u, i) => u.tipo === 'grupo'
        ? grupoCardHtml(u, i, unidades.length)
        : itemHtml(u.a, i, unidades.length)).join('')
    : `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="inbox"></i></div>Nenhum exercício no Dia ${_diaSel} ainda.</div>`;

  cont.innerHTML = `
    <div class="tr-dia-head">Dia <em>${_diaSel}</em> — ${nEx} exercício(s)</div>
    ${addBox}
    <div class="tr-ex-list">${linhas}</div>
  `;

  const addBtn = document.getElementById('trAddBtn');
  if (addBtn) addBtn.addEventListener('click', adicionarExercicio);

  montarAutocomplete();

  // Listeners das linhas — método tem tratamento próprio (pode remover o B do Bi-set)
  cont.querySelectorAll('[data-item-campo]:not([data-item-campo="metodo"])').forEach(el =>
    el.addEventListener('change', () => salvarCampoItem(el)));
  cont.querySelectorAll('[data-item-campo="metodo"]').forEach(el => {
    el.addEventListener('input', () => { atualizarDescMetodo(el); atualizarCampoDrop(el); });
    el.addEventListener('change', () => mudarMetodo(el));
  });
  cont.querySelectorAll('[data-item-del]').forEach(b =>
    b.addEventListener('click', () => removerItem(b.dataset.itemDel)));
  cont.querySelectorAll('[data-item-up]').forEach(b =>
    b.addEventListener('click', () => moverItem(b.dataset.itemUp, -1)));
  cont.querySelectorAll('[data-item-down]').forEach(b =>
    b.addEventListener('click', () => moverItem(b.dataset.itemDown, +1)));
  cont.querySelectorAll('[data-item-prog]').forEach(b =>
    b.addEventListener('click', () => toggleProg(b.dataset.itemProg)));

  // ── Bi-set ──
  cont.querySelectorAll('[data-biset-del]').forEach(b =>
    b.addEventListener('click', () => excluirBiset(b.dataset.bisetDel)));
  cont.querySelectorAll('[data-biset-remb]').forEach(b =>
    b.addEventListener('click', () => removerBDoBiset(b.dataset.bisetRemb)));
  cont.querySelectorAll('[data-biset-toggle]').forEach(b =>
    b.addEventListener('click', () => toggleRecolherBiset(b.dataset.bisetToggle)));
  cont.querySelectorAll('[data-biset-trocar]').forEach(b =>
    b.addEventListener('click', () => {
      const inp = cont.querySelector(`[data-biset-b-input="${b.dataset.bisetTrocar}"]`);
      const bloco = cont.querySelector(`[data-biset-bsel="${b.dataset.bisetTrocar}"]`);
      if (bloco) bloco.hidden = false;
      if (inp) inp.focus();
    }));
  // Autocomplete inline para escolher/trocar o Exercício B (reaproveita o do topo)
  cont.querySelectorAll('[data-biset-b-input]').forEach(inp => {
    const anchorId = inp.dataset.bisetBInput;
    const lista = cont.querySelector(`[data-biset-b-list="${anchorId}"]`);
    if (lista) montarAutocompleteEl(inp, lista, (ex) => escolherB(anchorId, ex));
  });

  // Reabre os painéis de progressão que estavam abertos antes do re-render
  _progAbertas.forEach(id => {
    const box = cont.querySelector(`[data-prog-box="${id}"]`);
    if (box) { box.hidden = false; carregarProg(id); }
    else _progAbertas.delete(id);
  });
}

// Gera um campo (.av-field) para a chave `k` de CAMPOS_ITEM, do item `it`.
// `labelOverride` troca o rótulo (ex.: "Descanso após o Bi-set").
function campoHtml(k, it, labelOverride) {
  const c = CAMPOS_ITEM.find(x => x.k === k);
  if (!c) return '';
  const label = esc(labelOverride || c.label);
  if (c.select) {
    const cur = String(it[c.k] || '');
    const opts = c.options.slice();
    if (cur && !opts.includes(cur)) opts.unshift(cur);   // preserva método custom antigo
    const ops = ['<option value="">—</option>']
      .concat(opts.map(o => `<option value="${esc(o)}" ${cur === o ? 'selected' : ''}>${esc(o)}</option>`))
      .join('');
    return `<div class="av-field"><label>${label}</label>
      <select data-item-campo="${c.k}" data-item-id="${it.id}" class="np-input">${ops}</select></div>`;
  }
  return `<div class="av-field"><label>${label}</label>
    <input type="${c.type}" placeholder="${c.ph}" value="${esc(it[c.k] ?? '')}"
      data-item-campo="${c.k}" data-item-id="${it.id}" class="np-input"></div>`;
}
// Vários campos de uma vez (lista de chaves de CAMPOS_ITEM).
function camposHtml(it, chaves) {
  return chaves.map(k => campoHtml(k, it)).join('');
}

function itemHtml(it, i, total) {
  const nome = it.exercicio?.nome || '(exercício)';
  const grupo = it.exercicio?.grupo_muscular ? ` · ${esc(it.exercicio.grupo_muscular)}` : '';
  const mi = metodoInfo(it.metodo);
  const campos = camposHtml(it, ['series', 'repeticoes', 'carga', 'cadencia', 'descanso', 'metodo']);

  // Campo "Drop set em" — só visível quando o método é Drop-set.
  const dropCur = String(it.drop_ultimas ?? '0');
  const dropOps = DROP_OPCOES
    .map(o => `<option value="${o.v}" ${dropCur === o.v ? 'selected' : ''}>${esc(o.label)}</option>`)
    .join('');
  const dropCampo = `<div class="av-field tr-drop-field" data-drop-field="${it.id}"${ehDropSet(it.metodo) ? '' : ' style="display:none"'}>
      <label>Drop set em</label>
      <select data-item-campo="drop_ultimas" data-item-id="${it.id}" class="np-input">${dropOps}</select></div>`;

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
      <div class="av-grid tr-ex-grid">${campos}${dropCampo}</div>
      <div class="tr-metodo-desc" data-metodo-desc="${it.id}"${mi ? '' : ' style="display:none"'}>${mi ? `<i data-lucide="lightbulb"></i> <strong>${esc(mi.nome)}</strong> — ${esc(mi.desc)}` : ''}</div>
      <div class="av-field" style="margin-top:10px;">
        <label>Observação</label>
        <input type="text" placeholder="Ex.: unilateral, drop na última série..."
          value="${esc(it.observacao ?? '')}" data-item-campo="observacao" data-item-id="${it.id}" class="np-input">
      </div>
      ${_modo === 'paciente' ? `<div class="tr-prog" data-prog-box="${it.id}" hidden></div>` : ''}
    </div>`;
}

// ── Autocomplete customizado (reutilizável) ──
// Dropdown estilizado (no lugar do <datalist> nativo), com busca debounced no
// banco, navegação por teclado (↑ ↓ Enter Esc) e realce do trecho buscado.
// `onEscolher(ex)` recebe o exercício selecionado. Estado local por instância
// (permite vários autocompletes na tela — o do topo e o Exercício B de cada Bi-set).
function montarAutocompleteEl(input, lista, onEscolher) {
  if (!input || !lista || input.dataset.acPronto) return;
  input.dataset.acPronto = '1';

  let ativo = -1;         // índice do item destacado (-1 = nenhum)
  let resultados = [];    // último lote da busca (isolado desta instância)

  const fechar = () => {
    lista.hidden = true; lista.innerHTML = ''; ativo = -1;
    input.setAttribute('aria-expanded', 'false');
  };
  const escolher = (ex) => { if (!ex) return; fechar(); onEscolher(ex); };
  const pintar = () => {
    lista.querySelectorAll('.tr-ac-item').forEach((el, i) => {
      const on = i === ativo;
      el.classList.toggle('active', on);
      if (on) el.scrollIntoView({ block: 'nearest' });
    });
  };
  const desenhar = (termo) => {
    if (!resultados.length) {
      lista.innerHTML = `<div class="tr-ac-empty">Nenhum exercício encontrado${termo ? ` para “${esc(termo)}”` : ''}.</div>`;
    } else {
      lista.innerHTML = resultados.map((ex, i) => `
        <div class="tr-ac-item" data-i="${i}">
          <span class="tr-ac-nome">${realce(ex.nome || '(sem nome)', termo)}</span>
          ${ex.grupo_muscular ? `<span class="tr-ac-grupo">${esc(ex.grupo_muscular)}</span>` : ''}
        </div>`).join('');
      lista.querySelectorAll('.tr-ac-item').forEach(el => {
        const idx = +el.dataset.i;
        // mousedown (não click): dispara antes do blur do input, senão a lista fecharia antes de selecionar
        el.addEventListener('mousedown', (e) => { e.preventDefault(); escolher(resultados[idx]); });
        el.addEventListener('mouseenter', () => { ativo = idx; pintar(); });
      });
    }
    ativo = -1; lista.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  const buscar = debounce(async (termo) => {
    try { resultados = await listarExercicios({ termo, limite: 40 }); }
    catch { resultados = []; }
    desenhar(termo);
  }, 300);

  input.addEventListener('input', () => buscar(input.value.trim()));
  input.addEventListener('keydown', (e) => {
    if (lista.hidden) return;
    const n = lista.querySelectorAll('.tr-ac-item').length;
    if (e.key === 'ArrowDown')      { e.preventDefault(); if (n) { ativo = (ativo + 1) % n; pintar(); } }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); if (n) { ativo = (ativo - 1 + n) % n; pintar(); } }
    else if (e.key === 'Enter')     { if (ativo >= 0 && resultados[ativo]) { e.preventDefault(); escolher(resultados[ativo]); } }
    else if (e.key === 'Escape')    { fechar(); }
  });
  input.addEventListener('focus', () => {
    const t = input.value.trim();
    if (t && resultados.length) desenhar(t);
  });
  input.addEventListener('blur', () => { setTimeout(fechar, 120); });
}

// Autocomplete do campo "adicionar exercício" (topo). Guarda o escolhido em
// _exSelecionado, que adicionarExercicio() consome.
function montarAutocomplete() {
  const input = document.getElementById('trAddInput');
  const lista = document.getElementById('trAcList');
  if (!input || !lista) return;
  input.addEventListener('input', () => { _exSelecionado = null; });
  montarAutocompleteEl(input, lista, (ex) => {
    _exSelecionado = ex;
    input.value = ex.nome || '';
    input.focus();
  });
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
  } catch (e) { mostrarErro('Erro ao adicionar: ' + e.message); }
}

async function salvarCampoItem(el) {
  const id = el.dataset.itemId;
  const campo = el.dataset.itemCampo;
  let valor = (el.value || '').trim();
  let payload;
  if (campo === 'series') {
    payload = { series: valor === '' ? null : parseInt(valor, 10) };
  } else if (campo === 'drop_ultimas') {
    payload = { drop_ultimas: parseInt(valor, 10) || 0 };
  } else {
    payload = { [campo]: valor === '' ? null : valor };
  }
  try {
    await atualizarItem(id, payload);
    // atualiza o cache local sem re-render (não perde o foco do próximo campo)
    const it = _itens.find(x => x.id === id);
    if (it) {
      Object.assign(it, payload);
      // se o campo pertence a um Bi-set, recalcula os avisos daquele bloco
      const anchorId = it.grupo_pos === 'B' ? it.grupo_id : (ehBiset(it.metodo) ? it.id : null);
      if (anchorId) atualizarAvisosBiset(anchorId);
    }
    if (campo === 'metodo') atualizarDescMetodo(el);
    mostrarToast('✓ Salvo');
  } catch (e) { mostrarErro('Erro ao salvar: ' + e.message); }
}

// Mostra/esconde o campo "Drop set em" conforme o método selecionado.
function atualizarCampoDrop(el) {
  const box = document.querySelector(`[data-drop-field="${el.dataset.itemId}"]`);
  if (box) box.style.display = ehDropSet(el.value) ? '' : 'none';
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
  if (!(await confirmar({
    titulo: 'Remover exercício',
    mensagem: 'Remover este exercício do treino?',
    textoOk: 'Remover', perigo: true,
  }))) return;
  try {
    await excluirItem(id);
    _itens = await listarItensDoTreino(_treino.id);
    renderDia();
  } catch (e) { mostrarErro('Erro: ' + e.message); }
}

// Move um BLOCO (exercício single ou Bi-set inteiro) para cima/baixo no dia,
// trocando a `ordem` do âncora com a do vizinho. O Exercício B acompanha o A
// pelo grupo_id (não tem ordem própria relevante), então nunca fica separado.
async function moverItem(anchorId, dir) {
  const unidades = unidadesDoDia();
  const i = unidades.findIndex(u => u.a.id === anchorId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= unidades.length) return;
  const a = unidades[i].a, b = unidades[j].a;
  try {
    // troca as ordens (usa o índice como ordem canônica para evitar empates)
    await Promise.all([atualizarItem(a.id, { ordem: j }), atualizarItem(b.id, { ordem: i })]);
    _itens = await listarItensDoTreino(_treino.id);
    renderDia();
  } catch (e) { mostrarErro('Erro ao reordenar: ' + e.message); }
}

// ═══════════════════════════════════════════════════════════
// BI-SET — grupo de 2 exercícios (A + B)
// ═══════════════════════════════════════════════════════════

// Trata a troca do campo Método. Sair de "Bi-set" com um B já escolhido
// remove o B (com confirmação). Entrar em "Bi-set" abre a área do Exercício B.
async function mudarMetodo(el) {
  const id = el.dataset.itemId;
  const it = _itens.find(x => x.id === id);
  if (!it) return;
  const novo = el.value;
  if (novo === (it.metodo || '')) return;
  const b = ehBiset(it.metodo) ? membroB(it) : null;

  if (b && !ehBiset(novo)) {
    const ok = await confirmar({
      titulo: 'Alterar método',
      mensagem: 'Alterar o método removerá o segundo exercício deste Bi-set.',
      textoOk: 'Alterar método', perigo: true,
    });
    if (!ok) { el.value = it.metodo || ''; atualizarDescMetodo(el); atualizarCampoDrop(el); return; }
    try {
      await excluirItem(b.id);
      await atualizarItem(id, { metodo: novo || null, grupo_id: null, grupo_pos: null, grupo_obs: null });
    } catch (e) { return mostrarErro('Erro ao alterar método: ' + e.message); }
  } else {
    try { await atualizarItem(id, { metodo: novo || null }); }
    catch (e) { return mostrarErro('Erro ao salvar: ' + e.message); }
  }
  _itens = await listarItensDoTreino(_treino.id);
  renderDia();
}

// Seleciona (ou troca) o Exercício B de um Bi-set.
async function escolherB(anchorId, ex) {
  const a = _itens.find(x => x.id === anchorId);
  if (!a || !ex) return;
  if (ex.id === a.exercicio_id) {
    mostrarErroBiset(anchorId, 'Escolha um exercício diferente do Exercício A.');
    return;
  }
  const b = membroB(a);
  try {
    if (b) {
      await atualizarItem(b.id, { exercicio_id: ex.id });   // troca preservando os campos do B
    } else {
      await atualizarItem(a.id, { grupo_id: a.id, grupo_pos: 'A' });   // A vira âncora
      const nutriId = await getNutriId();
      await adicionarExercicioAoTreino(nutriId, {
        treino_id: a.treino_id, dia: a.dia, exercicio_id: ex.id,
        grupo_id: a.id, grupo_pos: 'B', ordem: a.ordem ?? 0,
        series: a.series ?? null,     // herda a quantidade de séries do A
      });
    }
    _itens = await listarItensDoTreino(_treino.id);
    renderDia();
  } catch (e) { mostrarErro('Erro ao definir o Exercício B: ' + e.message); }
}

function mostrarErroBiset(anchorId, msg) {
  const el = document.querySelector(`[data-biset-err="${anchorId}"]`);
  if (el) el.textContent = msg || '';
}

// Exclui o Bi-set inteiro (A + B).
async function excluirBiset(anchorId) {
  const a = _itens.find(x => x.id === anchorId);
  if (!a) return;
  if (!(await confirmar({
    titulo: 'Excluir este Bi-set?',
    mensagem: 'O Exercício A e o Exercício B serão removidos do treino.',
    textoOk: 'Excluir Bi-set', perigo: true,
  }))) return;
  const b = membroB(a);
  try {
    if (b) await excluirItem(b.id);
    await excluirItem(a.id);
    _bisetRecolhidos.delete(a.id);
    _itens = await listarItensDoTreino(_treino.id);
    renderDia();
  } catch (e) { mostrarErro('Erro ao excluir: ' + e.message); }
}

// Remove só o Exercício B; o A volta a ser exercício normal (dados preservados).
async function removerBDoBiset(anchorId) {
  const a = _itens.find(x => x.id === anchorId);
  if (!a) return;
  const b = membroB(a);
  try {
    if (b) await excluirItem(b.id);
    await atualizarItem(a.id, { metodo: 'Normal', grupo_id: null, grupo_pos: null, grupo_obs: null });
    _itens = await listarItensDoTreino(_treino.id);
    renderDia();
  } catch (e) { mostrarErro('Erro: ' + e.message); }
}

function toggleRecolherBiset(anchorId) {
  if (_bisetRecolhidos.has(anchorId)) _bisetRecolhidos.delete(anchorId);
  else _bisetRecolhidos.add(anchorId);
  renderDia();
}

// Avisos (não bloqueiam o salvamento — os campos salvam incrementalmente).
// Retorna só os itens; o container fica sempre no card (atualizável sem re-render).
function avisosBisetItems(u) {
  const { a, b } = u;
  const av = [];
  if (!b) av.push('Selecione o segundo exercício do Bi-set.');
  if (a.series == null || a.series === '') av.push('Informe a quantidade de séries.');
  if (!a.repeticoes) av.push('Informe as repetições do Exercício A.');
  if (b) {
    if (b.series == null || b.series === '') av.push('Informe as séries do Exercício B.');
    if (!b.repeticoes) av.push('Informe as repetições do Exercício B.');
    if (a.series != null && b.series != null && Number(a.series) !== Number(b.series))
      av.push('As quantidades de séries são diferentes. Isso pode deixar o Bi-set incompleto.');
  }
  if (!a.descanso) av.push('Informe o descanso após o Bi-set.');
  return av.map(m =>
    `<div class="tr-aviso"><i data-lucide="alert-triangle"></i> ${esc(m)}</div>`).join('');
}

// Recalcula os avisos de um Bi-set sem re-renderizar o card (não perde o foco).
function atualizarAvisosBiset(anchorId) {
  const box = document.querySelector(`[data-biset-avisos="${anchorId}"]`);
  if (!box) return;
  const a = _itens.find(x => x.id === anchorId);
  if (a) box.innerHTML = avisosBisetItems({ a, b: membroB(a) });
}

// Resumo compacto (card recolhido).
function grupoResumoHtml(u) {
  const { a, b } = u;
  const nomeA = a.exercicio?.nome || '(A)';
  const nomeB = b ? (b.exercicio?.nome || '(B)') : '— selecionar Exercício B —';
  const series = a.series ?? '—';
  const repsA = a.repeticoes || '—';
  const repsB = b ? (b.repeticoes || '—') : '—';
  const desc = a.descanso ? `descanso ${esc(a.descanso)}` : 'sem descanso definido';
  return `
    <div class="tr-biset-resumo" data-biset-toggle="${a.id}">
      <div class="tr-biset-resumo-exs">
        <span class="tr-biset-resumo-ex"><span class="tr-biset-mark sm">A</span> ${esc(nomeA)}</span>
        <i data-lucide="arrow-down" class="tr-biset-resumo-seta"></i>
        <span class="tr-biset-resumo-ex"><span class="tr-biset-mark sm">B</span> ${esc(nomeB)}</span>
      </div>
      <div class="tr-biset-resumo-meta">${esc(String(series))} séries · ${esc(repsA)} / ${esc(repsB)} reps · ${desc}</div>
    </div>`;
}

// Card completo do Bi-set (A + conector + B + descanso do conjunto).
function grupoCardHtml(u, i, total) {
  const { a, b } = u;
  const recolhido = _bisetRecolhidos.has(a.id);

  const header = `
    <div class="tr-ex-head tr-biset-head">
      <div class="tr-biset-title">
        <button class="tr-biset-toggle" data-biset-toggle="${a.id}" title="${recolhido ? 'Expandir' : 'Recolher'}"
          aria-expanded="${recolhido ? 'false' : 'true'}"><i data-lucide="${recolhido ? 'chevron-right' : 'chevron-down'}"></i></button>
        <span class="tr-biset-selo"><i data-lucide="repeat-2"></i> Bi-set</span>
        <span class="tr-ex-num">${i + 1}</span>
      </div>
      <div class="tr-ex-btns">
        <button class="patient-action" data-item-up="${a.id}" ${i === 0 ? 'disabled' : ''} title="Subir"><i data-lucide="chevron-up"></i></button>
        <button class="patient-action" data-item-down="${a.id}" ${i === total - 1 ? 'disabled' : ''} title="Descer"><i data-lucide="chevron-down"></i></button>
        <button class="patient-action patient-action-danger" data-biset-del="${a.id}" title="Excluir Bi-set"><i data-lucide="trash-2"></i></button>
      </div>
    </div>`;

  if (recolhido) {
    return `<div class="av-form-card tr-ex-card tr-biset-card recolhido">${header}${grupoResumoHtml(u)}</div>`;
  }

  const nomeA = a.exercicio?.nome || '(exercício A)';
  const grupoA = a.exercicio?.grupo_muscular ? `<span class="tr-ex-grupo"> · ${esc(a.exercicio.grupo_muscular)}</span>` : '';
  const blocoA = `
    <div class="tr-biset-ex">
      <div class="tr-biset-ex-head"><span class="tr-biset-mark">A</span> <span class="tr-biset-ex-nome">${esc(nomeA)}${grupoA}</span></div>
      <div class="av-grid tr-ex-grid">${camposHtml(a, ['series', 'repeticoes', 'carga', 'cadencia'])}${campoHtml('metodo', a)}</div>
      <div class="av-field" style="margin-top:10px;"><label>Observação do Exercício A</label>
        <input type="text" placeholder="Ex.: extensão completa sem tirar o quadril do banco."
          value="${esc(a.observacao ?? '')}" data-item-campo="observacao" data-item-id="${a.id}" class="np-input"></div>
    </div>`;

  const conector = `<div class="tr-biset-conector"><span class="tr-biset-line"></span>
    <span class="tr-biset-nodesc"><i data-lucide="arrow-down"></i> Sem descanso entre A e B</span>
    <span class="tr-biset-line"></span></div>`;

  let blocoB;
  if (b) {
    const nomeB = b.exercicio?.nome || '(exercício B)';
    const grupoB = b.exercicio?.grupo_muscular ? `<span class="tr-ex-grupo"> · ${esc(b.exercicio.grupo_muscular)}</span>` : '';
    blocoB = `
      <div class="tr-biset-ex">
        <div class="tr-biset-ex-head">
          <span class="tr-biset-mark">B</span> <span class="tr-biset-ex-nome">${esc(nomeB)}${grupoB}</span>
          <div class="tr-biset-ex-acoes">
            <button class="tr-biset-link" data-biset-trocar="${a.id}" type="button"><i data-lucide="repeat"></i> Trocar</button>
            <button class="tr-biset-link danger" data-biset-remb="${a.id}" type="button"><i data-lucide="x"></i> Remover do Bi-set</button>
          </div>
        </div>
        <div class="av-grid tr-ex-grid">${camposHtml(b, ['series', 'repeticoes', 'carga', 'cadencia'])}</div>
        <div class="av-field" style="margin-top:10px;"><label>Observação do Exercício B</label>
          <input type="text" placeholder="Ex.: manter o joelho alinhado."
            value="${esc(b.observacao ?? '')}" data-item-campo="observacao" data-item-id="${b.id}" class="np-input"></div>
        <div class="tr-biset-bsel" data-biset-bsel="${a.id}" hidden>
          <label>Trocar Exercício B</label>
          <div class="tr-ac"><input class="np-input" data-biset-b-input="${a.id}" autocomplete="off"
            role="combobox" aria-autocomplete="list" aria-expanded="false" placeholder="Buscar outro exercício...">
            <div class="tr-ac-list" data-biset-b-list="${a.id}" hidden></div></div>
          <div class="tr-field-err" data-biset-err="${a.id}" role="alert"></div>
        </div>
      </div>`;
  } else {
    blocoB = `
      <div class="tr-biset-ex tr-biset-b-vazio">
        <div class="tr-biset-ex-head"><span class="tr-biset-mark vazio">B</span>
          <span class="tr-biset-ex-nome muted">Selecionar segundo exercício</span></div>
        <div class="tr-biset-bsel" data-biset-bsel="${a.id}">
          <div class="tr-ac"><input class="np-input" data-biset-b-input="${a.id}" autocomplete="off"
            role="combobox" aria-autocomplete="list" aria-expanded="false" placeholder="Buscar o Exercício B...">
            <div class="tr-ac-list" data-biset-b-list="${a.id}" hidden></div></div>
          <div class="tr-field-err" data-biset-err="${a.id}" role="alert"></div>
        </div>
      </div>`;
  }

  const descanso = `
    <div class="tr-biset-descanso">
      ${campoHtml('descanso', a, 'Descanso após o Bi-set')}
      <div class="tr-biset-aux">Aplicado após concluir os exercícios A e B.</div>
    </div>`;

  const obsGeral = `
    <div class="av-field" style="margin-top:12px;"><label>Observação geral do conjunto</label>
      <input type="text" placeholder="Ex.: realizar os dois exercícios sem pausa e controlar a execução."
        value="${esc(a.grupo_obs ?? '')}" data-item-campo="grupo_obs" data-item-id="${a.id}" class="np-input"></div>`;

  return `
    <div class="av-form-card tr-ex-card tr-biset-card">
      ${header}
      <div class="tr-biset-desc">Dois exercícios em sequência, sem descanso entre eles.</div>
      <div class="tr-biset-avisos" data-biset-avisos="${a.id}">${avisosBisetItems(u)}</div>
      ${blocoA}
      ${conector}
      ${blocoB}
      ${descanso}
      ${obsGeral}
    </div>`;
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
  } catch (e) { mostrarErro('Erro ao salvar: ' + e.message); }
}

async function removerProg(regId, itemId) {
  if (!(await confirmar({
    titulo: 'Excluir carga',
    mensagem: 'Excluir este registro de carga?',
    textoOk: 'Excluir', perigo: true,
  }))) return;
  try {
    await excluirProgressao(regId);
    await carregarProg(itemId);
  } catch (e) { mostrarErro('Erro: ' + e.message); }
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
