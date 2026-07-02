// ═══════════════════════════════════════════════════════════
// FICHA DO PACIENTE — navegação centralizada (modelo WebDiet)
// Fase 1: esqueleto (cabeçalho + menu lateral 9 abas).
// "Dados do Paciente" funcional; demais abas: Anamnese e
// Avaliações plugam módulos existentes; resto "em breve".
// ═══════════════════════════════════════════════════════════

import { buscarPacientePorId, atualizarPaciente } from './pacientes.js';
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
    let m1 = {};
    try {
      const resp = await buscarRespostasModulo(p.id, 'm1');
      m1 = resp || {};
    } catch (e) { /* segue */ }
    renderDadosView(cont, p, m1);
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

// ─── Aba Dados: visualização (balões) ───
function renderDadosView(cont, p, m1) {
  // Prioriza dado editado (tabela pacientes) sobre o da anamnese (m1)
  const nome = p.nome || m1.q1_1 || '(sem nome)';
  const email = p.email || m1.q1_2 || '';
  const nascimento = p.nascimento || m1.q1_4 || '';
  const sexoRaw = p.sexo || m1.q1_5 || '';
  const sexoLabel = (sexoRaw === 'M' || sexoRaw === 'Masculino') ? 'Masculino'
    : (sexoRaw === 'F' || sexoRaw === 'Feminino') ? 'Feminino' : '';
  const idade = calcularIdade(nascimento);
  const cidade = p.cidade || m1.q1_6 || '';
  const profissao = p.profissao || m1.q1_8 || '';

  cont.innerHTML = `
    <div class="dados-head">
      <div class="ficha-sec-titulo" style="border:none; margin:0; padding:0;">Dados pessoais</div>
      <button class="btn-editar-dados" id="btnEditarDados">✏️ Editar</button>
    </div>
    <div class="dados-balao-grid">
      ${balao('Nome', nome)}
      ${balao('E-mail', email)}
      ${balao('Telefone', p.telefone || m1.q1_3 || '')}
      ${balao('Instagram', p.instagram || '')}
      ${balao('Nascimento', nascimento ? fmtData(nascimento) : '')}
      ${balao('Idade', idade != null ? idade + ' anos' : '')}
      ${balao('Sexo', sexoLabel)}
      ${balao('Profissão', profissao)}
    </div>

    <div class="ficha-sec-titulo" style="margin-top:24px;">Endereço</div>
    <div class="dados-balao-grid">
      ${balao('País', p.pais || 'Brasil')}
      ${balao('CEP', p.cep || '')}
      ${balao('Endereço', p.endereco || '')}
      ${balao('Bairro', p.bairro || '')}
      ${balao('Cidade', cidade)}
      ${balao('UF', p.uf || '')}
    </div>

    <div class="ficha-sec-titulo" style="margin-top:24px;">Cadastro</div>
    <div class="dados-balao-grid">
      ${balao('Código', p.codigo)}
      ${balao('Status', p.status || 'aguardando')}
      ${balao('Cadastrado em', fmtData(p.criado_em))}
    </div>`;

  document.getElementById('btnEditarDados').addEventListener('click', () => {
    renderDadosEdit(cont, p, m1);
  });
}

// ─── Aba Dados: edição (formulário) ───
function renderDadosEdit(cont, p, m1) {
  const val = (campoP, campoM1) => p[campoP] || (campoM1 ? m1[campoM1] : '') || '';
  const sexoAtual = p.sexo || m1.q1_5 || '';
  const sexoV = (sexoAtual === 'M' || sexoAtual === 'Masculino') ? 'M'
    : (sexoAtual === 'F' || sexoAtual === 'Feminino') ? 'F' : '';

  cont.innerHTML = `
    <div class="dados-head">
      <div class="ficha-sec-titulo" style="border:none; margin:0; padding:0;">Editar dados</div>
    </div>
    <div class="dados-form-grid">
      ${inputD('nome', 'Nome', val('nome','q1_1'))}
      ${inputD('email', 'E-mail', val('email','q1_2'), 'email')}
      ${inputD('telefone', 'Telefone', val('telefone','q1_3'))}
      ${inputD('instagram', 'Instagram', p.instagram || '')}
      ${inputD('nascimento', 'Nascimento', (p.nascimento || m1.q1_4 || '').slice(0,10), 'date')}
      <div class="dados-field"><label>Sexo</label>
        <select id="d_sexo" class="np-input">
          <option value="" ${!sexoV?'selected':''}>—</option>
          <option value="M" ${sexoV==='M'?'selected':''}>Masculino</option>
          <option value="F" ${sexoV==='F'?'selected':''}>Feminino</option>
        </select></div>
      ${inputD('profissao', 'Profissão', val('profissao','q1_8'))}
    </div>

    <div class="ficha-sec-titulo" style="margin-top:20px;">Endereço</div>
    <div class="dados-form-grid">
      ${inputD('pais', 'País', p.pais || 'Brasil')}
      ${inputD('cep', 'CEP', p.cep || '')}
      ${inputD('endereco', 'Endereço', p.endereco || '')}
      ${inputD('bairro', 'Bairro', p.bairro || '')}
      ${inputD('cidade', 'Cidade', val('cidade','q1_6'))}
      ${inputD('uf', 'UF', p.uf || '')}
    </div>

    <div class="dados-form-acoes">
      <button class="btn-editar-dados" id="btnCancelarDados" style="background:var(--bg); color:var(--ink-soft);">Cancelar</button>
      <button class="btn-editar-dados" id="btnSalvarDados">💾 Salvar</button>
    </div>`;

  document.getElementById('btnCancelarDados').addEventListener('click', () => {
    renderDadosView(cont, p, m1);
  });

  document.getElementById('btnSalvarDados').addEventListener('click', async () => {
    const g = id => (document.getElementById(id)?.value || '').trim();
    const dados = {
      nome: g('d_nome') || null,
      email: g('d_email') || null,
      telefone: g('d_telefone') || null,
      instagram: g('d_instagram') || null,
      nascimento: g('d_nascimento') || null,
      sexo: document.getElementById('d_sexo')?.value || null,
      profissao: g('d_profissao') || null,
      pais: g('d_pais') || null,
      cep: g('d_cep') || null,
      endereco: g('d_endereco') || null,
      bairro: g('d_bairro') || null,
      cidade: g('d_cidade') || null,
      uf: g('d_uf') || null,
    };
    const btn = document.getElementById('btnSalvarDados');
    btn.disabled = true; btn.textContent = 'Salvando...';
    try {
      const atualizado = await atualizarPaciente(p.id, dados);
      _pacienteAtual = { ...p, ...atualizado };
      renderDadosView(cont, _pacienteAtual, m1);
    } catch (e) {
      btn.disabled = false; btn.textContent = '💾 Salvar';
      alert('Erro ao salvar: ' + e.message);
    }
  });
}

function balao(label, valor) {
  const v = (valor === null || valor === undefined || valor === '') ? '—' : valor;
  return `<div class="dado-balao"><div class="dado-balao-label">${label}</div><div class="dado-balao-valor">${esc(v)}</div></div>`;
}
function inputD(id, label, valor, tipo) {
  return `<div class="dados-field"><label>${label}</label><input type="${tipo||'text'}" id="d_${id}" value="${esc(valor)}" class="np-input"></div>`;
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
