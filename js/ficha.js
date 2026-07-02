// ═══════════════════════════════════════════════════════════
// FICHA DO PACIENTE — navegação centralizada (modelo WebDiet)
// Fase 1: esqueleto (cabeçalho + menu lateral 9 abas).
// "Dados do Paciente" funcional; demais abas: Anamnese e
// Avaliações plugam módulos existentes; resto "em breve".
// ═══════════════════════════════════════════════════════════

import { buscarPacientePorId } from './pacientes.js';
import { dadosBasicosDaAnamnese } from './avaliacoes.js';
import { buscarRespostasModulo } from './respostas.js';
import { gerarRelatorio, ativarConduta } from './relatorio.js';
import { processarRecordatorioIA } from './recordatorio-ia.js';
// Fase 3 ligará as Avaliações dentro da ficha.

let _pacienteAtual = null;
let _nutriId = null;
let _dados = { sexo: null, idade: null };

// Definição das abas (id, ícone, label, estado)
const ABAS = [
  { id: 'dados',        icone: '👤', label: 'Dados do Paciente', pronta: true },
  { id: 'evolucao',     icone: '📈', label: 'Evolução',          pronta: false },
  { id: 'anamnese',     icone: '📋', label: 'Anamnese geral',    pronta: true },
  { id: 'exames',       icone: '🧪', label: 'Exames laboratoriais', pronta: false },
  { id: 'avaliacoes',   icone: '📐', label: 'Avaliações Físicas', pronta: true },
  { id: 'planejamento', icone: '🥗', label: 'Planejamento Alimentar', pronta: false },
  { id: 'metas',        icone: '🎯', label: 'Prescrição de Metas', pronta: false },
  { id: 'manipulados',  icone: '💊', label: 'Prescrição de Manipulados', pronta: false },
  { id: 'orientacoes',  icone: '📝', label: 'Orientações Nutricionais', pronta: false },
];

/**
 * Abre a ficha de um paciente. Chamado ao clicar "Ver" na lista.
 * @param {string} pacienteId
 * @param {string} nutriId
 * @param {function} onVoltar - callback pra voltar à lista
 */
export async function abrirFichaPaciente(pacienteId, nutriId, onVoltar) {
  _nutriId = nutriId;
  const page = document.getElementById('page-ficha');
  if (!page) { console.error('page-ficha não existe'); return; }

  page.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando ficha...</div>`;

  try {
    _pacienteAtual = await buscarPacientePorId(pacienteId);
    _dados = await dadosBasicosDaAnamnese(pacienteId);
  } catch (e) {
    page.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div>Erro ao carregar: ${e.message}</div>`;
    return;
  }

  const p = _pacienteAtual;
  const sexoLabel = _dados.sexo === 'M' ? 'Masculino' : _dados.sexo === 'F' ? 'Feminino' : '—';
  const idadeLabel = _dados.idade != null ? `${_dados.idade} anos` : '—';
  const statusLabel = (p.status || 'aguardando');

  page.innerHTML = `
    <span class="ficha-voltar" id="fichaVoltar">← Voltar para a lista de pacientes</span>

    <div class="ficha-head">
      <div class="ficha-avatar">${iniciais(p.nome)}</div>
      <div>
        <div class="ficha-nome">${esc(p.nome || '(sem nome)')}</div>
        <div class="ficha-meta">${sexoLabel} · ${idadeLabel} · Cadastrado em ${fmtData(p.criado_em)}</div>
      </div>
      <div class="ficha-badges">
        <span class="ficha-badge badge-cod">${p.codigo}</span>
        <span class="ficha-badge badge-${statusLabel === 'completo' ? 'ok' : 'wait'}">${statusLabel}</span>
      </div>
    </div>

    <div class="ficha-body">
      <div class="ficha-menu" id="fichaMenu">
        ${ABAS.map(a => `
          <div class="fm-item ${a.id === 'dados' ? 'active' : ''} ${a.pronta ? '' : 'soon'}" data-aba="${a.id}">
            <span>${a.icone}</span><span>${a.label}</span>
            ${a.pronta ? '' : '<span class="fm-soon">breve</span>'}
          </div>`).join('')}
      </div>
      <div class="ficha-conteudo" id="fichaConteudo"></div>
    </div>
  `;

  // Voltar
  document.getElementById('fichaVoltar').addEventListener('click', () => {
    if (typeof onVoltar === 'function') onVoltar();
  });

  // Navegação entre abas
  document.querySelectorAll('#fichaMenu .fm-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('#fichaMenu .fm-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      renderAba(item.dataset.aba);
    });
  });

  // Abre a primeira aba
  renderAba('dados');
}

/**
 * Renderiza o conteúdo de uma aba.
 */
async function renderAba(abaId) {
  const cont = document.getElementById('fichaConteudo');
  const p = _pacienteAtual;

  // Abas prontas
  if (abaId === 'dados') {
    cont.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando dados...</div>`;
    // Busca o M1 (dados pessoais) da anamnese
    let m1 = {};
    try {
      const resp = await buscarRespostasModulo(p.id, 'm1');
      m1 = resp || {};
    } catch (e) { /* segue com o que tiver */ }

    const sexoRaw = m1.q1_5 || _dados.sexo;
    const sexoLabel = (sexoRaw === 'M' || sexoRaw === 'Masculino') ? 'Masculino'
      : (sexoRaw === 'F' || sexoRaw === 'Feminino') ? 'Feminino' : '—';
    const nascimento = m1.q1_4 || null;
    const idadeLabel = calcularIdade(nascimento) ?? (_dados.idade != null ? _dados.idade : null);

    cont.innerHTML = `
      <div class="ficha-sec-titulo">Dados pessoais</div>
      <div class="ficha-campos">
        ${campo('Nome', m1.q1_1 || p.nome || '(sem nome)')}
        ${campo('E-mail', m1.q1_2 || p.email || '—')}
        ${campo('Telefone', m1.q1_3 || p.telefone || '—')}
        ${campo('Nascimento', nascimento ? fmtData(nascimento) : '—')}
        ${campo('Idade', idadeLabel != null ? idadeLabel + ' anos' : '—')}
        ${campo('Sexo', sexoLabel)}
        ${campo('Cidade', m1.q1_6 || '—')}
        ${campo('Profissão', m1.q1_8 || '—')}
      </div>
      <div class="ficha-sec-titulo" style="margin-top:22px;">Cadastro</div>
      <div class="ficha-campos">
        ${campo('Código', p.codigo)}
        ${campo('Status', p.status || 'aguardando')}
        ${campo('Cadastrado em', fmtData(p.criado_em))}
      </div>`;
    return;
  }

  if (abaId === 'anamnese') {
    cont.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando relatório...</div>`;
    try {
      const html = await gerarRelatorio(p.id);
      cont.innerHTML = html;
      // Dispara o cálculo do recordatório por IA (com cache)
      processarRecordatorioIA(p.id).catch(e => console.warn('recordatorio ia:', e));
      // Liga os cards clicáveis de PSQI e Cronotipo
      ativarConduta(cont);
      // Remove o botão "voltar" interno do relatório (a ficha já tem o seu)
      cont.querySelectorAll('[data-relatorio-action="voltar"]').forEach(b => b.remove());
    } catch (e) {
      cont.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div>Erro no relatório: ${e.message}</div>`;
    }
    return;
  }

  if (abaId === 'avaliacoes') {
    cont.innerHTML = `<div id="avaliacoesFichaMount"><div class="loading"><div class="spinner"></div>Carregando avaliações...</div></div>`;
    try {
      const { initAvaliacoesUIParaPaciente } = await import('./avaliacoes-ui.js');
      await initAvaliacoesUIParaPaciente(_nutriId, p, 'avaliacoesFichaMount');
    } catch (e) {
      cont.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div>Erro nas avaliações: ${e.message}</div>`;
    }
    return;
  }

  // Abas futuras
  const aba = ABAS.find(a => a.id === abaId);
  cont.innerHTML = `
    <div class="ficha-em-breve">
      <div class="feb-ico">${aba.icone}</div>
      <div class="feb-t">${aba.label}</div>
      <div class="feb-s">Esta funcionalidade ainda está em desenvolvimento.</div>
    </div>`;
}

// ─── Helpers ───
function campo(label, valor) {
  return `<div class="ficha-campo"><div class="fc-l">${label}</div><div class="fc-v">${esc(valor)}</div></div>`;
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const iniciais = nome => {
  if (!nome) return '?';
  const parts = nome.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
};
const fmtData = d => {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return '—'; }
};
function calcularIdade(nascimento) {
  if (!nascimento) return null;
  const nasc = new Date(nascimento);
  if (isNaN(nasc.getTime())) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const m = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
  return (idade >= 0 && idade < 130) ? idade : null;
}
