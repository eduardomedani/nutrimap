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
import { QUESTIONARIO_URL } from './supabase.js';
import { copiarParaClipboard, gerarLinkWhatsapp, montarMensagemQuestionario, mostrarErro } from './utils.js';
// Fase 3 ligará as Avaliações dentro da ficha.

let _pacienteAtual = null;
let _nutriId = null;
let _dados = { sexo: null, idade: null };

// Definição das abas (id, ícone, label, estado)
const ABAS = [
  { id: 'dados',        icone: '<i data-lucide="user"></i>',          label: 'Dados do Cliente', pronta: true },
  { id: 'evolucao',     icone: '<i data-lucide="trending-up"></i>',   label: 'Evolução',          pronta: false },
  { id: 'anamnese',     icone: '<i data-lucide="clipboard-list"></i>', label: 'Anamnese geral',    pronta: true },
  { id: 'exames',       icone: '<i data-lucide="flask-conical"></i>', label: 'Exames laboratoriais', pronta: false },
  { id: 'avaliacoes',   icone: '<i data-lucide="ruler"></i>',         label: 'Avaliações Físicas', pronta: true },
  { id: 'treinos',      icone: '<i data-lucide="dumbbell"></i>',      label: 'Treinos',            pronta: true },
  { id: 'calorias',     icone: '<i data-lucide="flame"></i>',         label: 'Cálculo de Calorias', pronta: true },
  { id: 'planejamento', icone: '<i data-lucide="salad"></i>',         label: 'Planejamento Alimentar', pronta: true },
  { id: 'manipulados',  icone: '<i data-lucide="pill"></i>',          label: 'Prescrição de Manipulados', pronta: false },
  { id: 'orientacoes',  icone: '<i data-lucide="file-pen"></i>',      label: 'Orientações Nutricionais', pronta: false },
];

/**
 * Abre a ficha de um paciente. Chamado ao clicar "Ver" na lista.
 * @param {string} pacienteId
 * @param {string} nutriId
 * @param {function} onVoltar - callback pra voltar à lista
 */
export async function abrirFichaPaciente(pacienteId, nutriId, onVoltar, abaInicial = 'dados') {
  _nutriId = nutriId;
  const page = document.getElementById('page-ficha');
  if (!page) { console.error('page-ficha não existe'); return; }

  // Aba inicial válida (existe e está pronta), senão cai em "dados".
  const abaOk = ABAS.find(a => a.id === abaInicial && a.pronta) ? abaInicial : 'dados';

  page.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando ficha...</div>`;

  try {
    _pacienteAtual = await buscarPacientePorId(pacienteId);
    _dados = await dadosBasicosDaAnamnese(pacienteId);
  } catch (e) {
    page.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>Erro ao carregar: ${e.message}</div>`;
    return;
  }

  const p = _pacienteAtual;
  const sexoLabel = _dados.sexo === 'M' ? 'Masculino' : _dados.sexo === 'F' ? 'Feminino' : '—';
  const idadeLabel = _dados.idade != null ? `${_dados.idade} anos` : '—';
  const statusLabel = (p.status || 'aguardando');

  page.innerHTML = `
    <span class="ficha-voltar" id="fichaVoltar"><i data-lucide="arrow-left"></i> Voltar para a lista de clientes</span>

    <div class="ficha-head">
      <div class="ficha-avatar">${iniciais(p.nome)}</div>
      <div>
        <div class="ficha-nome">${esc(p.nome || '(sem nome)')}</div>
        <div class="ficha-meta">${sexoLabel} · ${idadeLabel} · Cadastrado em ${fmtData(p.criado_em)}</div>
      </div>
      <div class="ficha-head-right">
        ${botaoLinks(p)}
        <div class="ficha-badges">
          <span class="ficha-badge badge-cod">${p.codigo}</span>
          <span class="ficha-badge badge-${statusLabel === 'completo' ? 'ok' : 'wait'}">${statusLabel}</span>
        </div>
      </div>
    </div>

    <div class="ficha-body">
      <div class="ficha-menu" id="fichaMenu">
        ${ABAS.map(a => `
          <div class="fm-item ${a.id === abaOk ? 'active' : ''} ${a.pronta ? '' : 'soon'}" data-aba="${a.id}">
            <span>${a.icone}</span><span>${a.label}</span>
          </div>`).join('')}
      </div>
      <div class="ficha-conteudo" id="fichaConteudo"></div>
    </div>
  `;

  // Voltar
  document.getElementById('fichaVoltar').addEventListener('click', () => {
    if (typeof onVoltar === 'function') onVoltar();
  });

  // Links de acesso (copiar / WhatsApp)
  ligarLinksAcesso(page, p);

  // Navegação entre abas
  document.querySelectorAll('#fichaMenu .fm-item').forEach(item => {
    item.addEventListener('click', () => {
      if (item.classList.contains('soon')) return;   // abas não prontas: sem funcionalidade
      document.querySelectorAll('#fichaMenu .fm-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      renderAba(item.dataset.aba);
    });
  });

  // Abre a aba inicial (restaurada da URL ou "dados")
  renderAba(abaOk);
}

/**
 * Renderiza o conteúdo de uma aba.
 */
async function renderAba(abaId) {
  const cont = document.getElementById('fichaConteudo');
  const p = _pacienteAtual;

  // Grava a rota na URL (sem poluir o histórico) p/ o F5 manter cliente + aba.
  if (p?.id) { try { history.replaceState(null, '', '#ficha/' + p.id + '/' + abaId); } catch (e) {} }

  // Abas prontas
  if (abaId === 'dados') {
    cont.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando dados...</div>`;
    let m1 = {};
    try {
      const resp = await buscarRespostasModulo(p.id, 'm1');
      m1 = resp || {};
    } catch (e) { /* segue */ }
    renderDadosView(cont, p, m1, false);
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
      cont.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>Erro no relatório: ${e.message}</div>`;
    }
    return;
  }

  if (abaId === 'avaliacoes') {
    cont.innerHTML = `<div id="avaliacoesFichaMount"><div class="loading"><div class="spinner"></div>Carregando avaliações...</div></div>`;
    try {
      const { initAvaliacoesUIParaPaciente } = await import('./avaliacoes-ui.js');
      await initAvaliacoesUIParaPaciente(_nutriId, p, 'avaliacoesFichaMount');
    } catch (e) {
      cont.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>Erro nas avaliações: ${e.message}</div>`;
    }
    return;
  }

  if (abaId === 'treinos') {
    cont.innerHTML = `<div id="treinosFichaMount"><div class="loading"><div class="spinner"></div>Carregando treinos...</div></div>`;
    try {
      const { initTreinosUIParaPaciente } = await import('./treinos-ui.js');
      await initTreinosUIParaPaciente(_nutriId, p, 'treinosFichaMount');
    } catch (e) {
      cont.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>Erro nos treinos: ${e.message}</div>`;
    }
    return;
  }

  if (abaId === 'calorias') {
    cont.innerHTML = `<div id="caloriasFichaMount"><div class="loading"><div class="spinner"></div>Carregando...</div></div>`;
    try {
      const { initCaloriasUIParaPaciente } = await import('./calorias-ui.js');
      await initCaloriasUIParaPaciente(_nutriId, p, 'caloriasFichaMount');
    } catch (e) {
      cont.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>Erro no cálculo de calorias: ${e.message}</div>`;
    }
    return;
  }

  if (abaId === 'planejamento') {
    cont.innerHTML = `<div id="dietaFichaMount"><div class="loading"><div class="spinner"></div>Carregando planos...</div></div>`;
    try {
      const { initDietaUIParaPaciente } = await import('./dieta-ui.js');
      await initDietaUIParaPaciente(_nutriId, p, 'dietaFichaMount');
    } catch (e) {
      cont.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>Erro no planejamento: ${e.message}</div>`;
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

// ─── Aba Dados: um só layout; editar muda os balões in-place ───
function renderDadosView(cont, p, m1, editando) {
  const nome = p.nome || m1.q1_1 || '';
  const email = p.email || m1.q1_2 || '';
  const telefone = p.telefone || m1.q1_3 || '';
  const nascimento = (p.nascimento || m1.q1_4 || '').slice(0,10);
  const sexoRaw = p.sexo || m1.q1_5 || '';
  const sexoV = (sexoRaw === 'M' || sexoRaw === 'Masculino') ? 'M'
    : (sexoRaw === 'F' || sexoRaw === 'Feminino') ? 'F' : '';
  const sexoLabel = sexoV === 'M' ? 'Masculino' : sexoV === 'F' ? 'Feminino' : '';
  const idade = calcularIdade(nascimento);
  const cidade = p.cidade || m1.q1_6 || '';
  const profissao = p.profissao || m1.q1_8 || '';

  // cada balão: modo view mostra valor; modo edit mostra input com mesmo layout
  const b = (id, label, valor, tipo, editavel = true, largo = false) => {
    const clsLargo = largo ? ' dado-balao-largo' : '';
    if (editando && editavel) {
      if (id === 'sexo') {
        return `<div class="dado-balao editando${clsLargo}"><div class="dado-balao-label">${label}</div>
          <select id="d_sexo" class="dado-balao-input">
            <option value="" ${!sexoV?'selected':''}>—</option>
            <option value="M" ${sexoV==='M'?'selected':''}>Masculino</option>
            <option value="F" ${sexoV==='F'?'selected':''}>Feminino</option>
          </select></div>`;
      }
      return `<div class="dado-balao editando${clsLargo}"><div class="dado-balao-label">${label}</div>
        <input type="${tipo||'text'}" id="d_${id}" value="${esc(valor)}" class="dado-balao-input"></div>`;
    }
    // modo view (ou campo não-editável como Idade)
    const vShow = (valor === null || valor === undefined || valor === '') ? '—' : valor;
    return `<div class="dado-balao${clsLargo}"><div class="dado-balao-label">${label}</div><div class="dado-balao-valor">${esc(vShow)}</div></div>`;
  };

  const botao = editando
    ? `<div class="dados-head-btns">
         <button class="btn-editar-dados btn-cancelar" id="btnCancelarDados">Cancelar</button>
         <button class="btn-editar-dados" id="btnSalvarDados"><i data-lucide="save"></i> Salvar</button>
       </div>`
    : `<button class="btn-editar-dados" id="btnEditarDados"><i data-lucide="pencil"></i> Editar</button>`;

  cont.innerHTML = `
    <div class="dados-head">
      <div class="ficha-sec-titulo" style="border:none; margin:0; padding:0;">Dados pessoais</div>
      ${botao}
    </div>
    <div class="dados-balao-grid">
      ${b('nome', 'Nome', nome)}
      ${b('nascimento', 'Nascimento', editando ? nascimento : (nascimento ? fmtData(nascimento) : ''), 'date')}
      ${b('idade', 'Idade', idade != null ? idade + ' anos' : '', 'text', false)}
      ${b('sexo', 'Sexo', sexoLabel)}
      ${b('profissao', 'Profissão', profissao)}
      ${b('instagram', 'Instagram', p.instagram || '')}
      ${b('telefone', 'Telefone', telefone)}
      ${b('email', 'E-mail', email, 'email', true, true)}
    </div>

    <div class="ficha-sec-titulo" style="margin-top:24px;">Endereço</div>
    <div class="dados-balao-grid">
      ${b('pais', 'País', p.pais || 'Brasil')}
      ${b('cep', 'CEP', p.cep || '')}
      ${b('endereco', 'Endereço', p.endereco || '', 'text', true, true)}
      ${b('bairro', 'Bairro', p.bairro || '')}
      ${b('cidade', 'Cidade', cidade)}
      ${b('uf', 'UF', p.uf || '')}
    </div>

    <div class="ficha-sec-titulo" style="margin-top:24px;">Cadastro</div>
    <div class="dados-balao-grid">
      ${b('codigo', 'Código', p.codigo, 'text', false)}
      ${b('status', 'Status', p.status || 'aguardando', 'text', false)}
      ${b('criado', 'Cadastrado em', fmtData(p.criado_em), 'text', false)}
    </div>`;

  if (editando) {
    document.getElementById('btnCancelarDados').addEventListener('click', () => renderDadosView(cont, p, m1, false));
    document.getElementById('btnSalvarDados').addEventListener('click', async () => {
      const g = id => (document.getElementById(id)?.value || '').trim();
      const dados = {
        nome: g('d_nome') || null,
        nascimento: g('d_nascimento') || null,
        sexo: document.getElementById('d_sexo')?.value || null,
        profissao: g('d_profissao') || null,
        instagram: g('d_instagram') || null,
        telefone: g('d_telefone') || null,
        email: g('d_email') || null,
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
        renderDadosView(cont, _pacienteAtual, m1, false);
      } catch (e) {
        btn.disabled = false; btn.innerHTML = '<i data-lucide="save"></i> Salvar';
        mostrarErro('Erro ao salvar: ' + e.message);
      }
    });
  } else {
    document.getElementById('btnEditarDados').addEventListener('click', () => renderDadosView(cont, p, m1, true));
  }
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

// ───────────────────────────────────────────────────────────
// LINKS DE ACESSO (anamnese + app do aluno) — home fixa na ficha
// Os links derivam do código do paciente, então ficam sempre disponíveis.
// ───────────────────────────────────────────────────────────
function linksDoPaciente(p) {
  return {
    anamnese: `${QUESTIONARIO_URL}anamnese.html?p=${p.codigo}`,
    app:      `${QUESTIONARIO_URL}app.html?codigo=${p.codigo}`,
  };
}

// Botão "Links de acesso" no cabeçalho (junto ao nome/código) que abre o menu.
function botaoLinks(p) {
  const l = linksDoPaciente(p);
  return `
    <div class="ficha-links-wrap">
      <button class="ficha-links-btn" data-links-toggle aria-expanded="false" aria-haspopup="true">
        <i data-lucide="link"></i> <span>Links de acesso</span> <i data-lucide="chevron-down" class="flb-chev"></i>
      </button>
      <div class="ficha-links-pop" data-links-pop hidden>
        <div class="fl-pop-head"><i data-lucide="link"></i> Links de acesso</div>
        ${linkRow('Anamnese', 'Questionário pré-consulta', l.anamnese, 'anamnese')}
        ${linkRow('App do aluno', 'Treino + registro de carga', l.app, 'app')}
      </div>
    </div>`;
}

function linkRow(titulo, sub, url, key) {
  return `
    <div class="fl-row">
      <div class="fl-info">
        <div class="fl-titulo">${titulo} <span class="fl-sub">· ${sub}</span></div>
        <div class="fl-url">${esc(url)}</div>
      </div>
      <div class="fl-acoes">
        <button class="btn-sm" data-flcopy="${key}"><i data-lucide="copy"></i> Copiar</button>
        <button class="btn-sm btn-sm-secondary" data-flwa="${key}"><i data-lucide="message-circle"></i> WhatsApp</button>
      </div>
    </div>`;
}

function ligarLinksAcesso(page, p) {
  const l = linksDoPaciente(p);
  const btn = page.querySelector('[data-links-toggle]');
  const pop = page.querySelector('[data-links-pop]');
  const fechar = () => { if (pop) pop.hidden = true; btn?.setAttribute('aria-expanded', 'false'); };
  if (btn && pop) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const abrir = pop.hidden;
      pop.hidden = !abrir;
      btn.setAttribute('aria-expanded', String(abrir));
    });
    pop.addEventListener('click', (e) => e.stopPropagation());   // clique dentro não fecha
    document.addEventListener('click', fechar);                  // clique fora fecha
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
  }
  page.querySelectorAll('[data-flcopy]').forEach(b =>
    b.addEventListener('click', () => { copiarParaClipboard(l[b.dataset.flcopy], '✓ Link copiado'); fechar(); }));
  page.querySelectorAll('[data-flwa]').forEach(b =>
    b.addEventListener('click', () => {
      const key = b.dataset.flwa;
      const msg = key === 'app'
        ? montarMensagemApp(p.nome, l.app)
        : montarMensagemQuestionario(p.nome, l.anamnese);
      window.open(gerarLinkWhatsapp(msg, p.telefone || ''), '_blank');
      fechar();
    }));
}

function montarMensagemApp(nome, link) {
  const primeiro = nome ? nome.split(' ')[0] + ', ' : '';
  return `Oi ${primeiro}seu treino está no app 💪\n\nAcesse por aqui:\n${link}\n\nÉ só criar sua conta (email e senha) — seu treino já aparece. Dá pra instalar na tela inicial do celular. 🌿`;
}
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
