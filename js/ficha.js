// ═══════════════════════════════════════════════════════════
// HUB DO PACIENTE — orquestração das abas
// ═══════════════════════════════════════════════════════════
// A ficha deixou de ser um menu lateral de módulos soltos: agora é o Hub, com
// o paciente sempre no contexto (cabeçalho + navegação fixos) e só o conteúdo
// da aba trocando. Cada aba carrega seu módulo por import dinâmico — nada é
// baixado antes de ser aberto.
//
// Quem decide QUAIS abas existem é paciente-modulos.js: módulo sem fundação
// (consultas, check-ins, exames, fotos) não aparece, em vez de virar uma aba
// cinza "em breve" dentro do prontuário.

import { buscarPacientePorId, atualizarPaciente } from './pacientes.js';
import { dadosBasicosDaAnamnese } from './avaliacoes.js';
import { buscarRespostasModulo } from './respostas.js';
import { gerarRelatorio, ativarConduta } from './relatorio.js';
import { processarRecordatorioIA } from './recordatorio-ia.js';
import { hubShellHtml, ligarHub, marcarAba, preencherContexto } from './paciente-hub.js';
import { normalizarAba, moduloExiste } from './paciente-modulos.js';
import { invalidarResumo } from './paciente-resumo.js';
import { mostrarErro, confirmar } from './utils.js';

let _pacienteAtual = null;
let _nutriId = null;
let _dados = { sexo: null, idade: null };
let _calorias = null;         // módulo carregado, p/ checar edições pendentes
let _abaAtual = 'visao';
let _m1 = {};                 // respostas do módulo 1 da anamnese (dados pessoais)

/**
 * Abre o Hub de um paciente. Assinatura mantida: index.html continua chamando
 * abrirFichaPaciente(id, nutriId, onVoltar, aba) e as URLs #ficha/<id>/<aba>
 * seguem funcionando (as abas antigas caem nos apelidos de paciente-modulos).
 */
export async function abrirFichaPaciente(pacienteId, nutriId, onVoltar, abaInicial = 'visao') {
  _nutriId = nutriId;
  const page = document.getElementById('page-ficha');
  if (!page) { console.error('page-ficha não existe'); return; }

  page.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando paciente...</div>`;

  try {
    _pacienteAtual = await buscarPacientePorId(pacienteId);
    _dados = await dadosBasicosDaAnamnese(pacienteId);
    _m1 = {};
  } catch (e) {
    page.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>Erro ao carregar: ${esc(e.message)}</div>`;
    return;
  }

  const p = _pacienteAtual;
  _abaAtual = normalizarAba(abaInicial);

  page.innerHTML = hubShellHtml(p, _dados, _abaAtual);
  ligarHub(page, p, {
    onVoltar: () => onVoltar?.(),
    irParaAba,
    onObservacao: async () => {
      const { abrirRegistroManual } = await import('./timeline-ui.js');
      abrirRegistroManual(p, () => { if (_abaAtual === 'visao') renderAba('visao'); });
    },
  });

  renderAba(_abaAtual);
}

/**
 * Troca de aba sem recarregar o Hub: cabeçalho e navegação permanecem.
 * Passa pela mesma trava de edição pendente do cálculo de calorias.
 */
export async function irParaAba(abaId) {
  const alvo = moduloExiste(abaId) ? abaId : normalizarAba(abaId);
  if (alvo === _abaAtual) return;

  if (_calorias?.caloriasSujo?.()) {
    const ok = await confirmar({
      titulo: 'Sair do cálculo',
      mensagem: 'Há alterações não salvas. Trocar de aba agora descarta essas mudanças.',
      textoOk: 'Sair sem salvar',
    });
    if (!ok) return;
  }
  _calorias?.encerrarCalorias?.();
  _calorias = null;

  _abaAtual = alvo;
  marcarAba(document.getElementById('page-ficha'), alvo);
  renderAba(alvo);
}

/** Renderiza o conteúdo da aba ativa. */
async function renderAba(abaId) {
  const page = document.getElementById('page-ficha');
  const cont = document.getElementById('fichaConteudo');
  const p = _pacienteAtual;
  if (!cont || !p) return;

  // Rota na URL (sem poluir o histórico): F5 mantém paciente + aba.
  try { history.replaceState(null, '', '#ficha/' + p.id + '/' + abaId); } catch (e) {}

  if (abaId === 'visao') {
    cont.innerHTML = '';
    try {
      const { initPainel360 } = await import('./paciente-painel.js');
      await initPainel360({
        cont, paciente: p, irParaAba,
        aoCarregar: (resumo) => preencherContexto(page, resumo),
      });
      // O formulário de dados pessoais continua o mesmo — agora recolhido.
      const mount = document.getElementById('dadosPessoaisMount');
      if (mount) {
        if (!Object.keys(_m1).length) {
          try { _m1 = (await buscarRespostasModulo(p.id, 'm1')) || {}; } catch (e) { _m1 = {}; }
        }
        renderDadosView(mount, p, _m1, false);
      }
    } catch (e) {
      erroAba(cont, 'Não foi possível carregar a visão geral.', e);
    }
    return;
  }

  if (abaId === 'timeline') {
    cont.innerHTML = '';
    try {
      const { initTimeline } = await import('./timeline-ui.js');
      await initTimeline({ cont, paciente: p, irParaAba });
    } catch (e) { erroAba(cont, 'Não foi possível carregar o histórico.', e); }
    return;
  }

  if (abaId === 'anamnese') {
    cont.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando relatório...</div>`;
    try {
      cont.innerHTML = await gerarRelatorio(p.id);
      processarRecordatorioIA(p.id).catch(e => console.warn('recordatorio ia:', e));
      ativarConduta(cont);
      cont.querySelectorAll('[data-relatorio-action="voltar"]').forEach(b => b.remove());
    } catch (e) { erroAba(cont, 'Não foi possível carregar a anamnese.', e); }
    return;
  }

  if (abaId === 'avaliacoes') {
    cont.innerHTML = `<div id="avaliacoesFichaMount"><div class="loading"><div class="spinner"></div>Carregando avaliações...</div></div>`;
    try {
      const { initAvaliacoesUIParaPaciente } = await import('./avaliacoes-ui.js');
      await initAvaliacoesUIParaPaciente(_nutriId, p, 'avaliacoesFichaMount');
    } catch (e) { erroAba(cont, 'Não foi possível carregar as avaliações.', e); }
    return;
  }

  if (abaId === 'treinos') {
    cont.innerHTML = `<div id="treinosFichaMount"><div class="loading"><div class="spinner"></div>Carregando treinos...</div></div>`;
    try {
      const { initTreinosUIParaPaciente } = await import('./treinos-ui.js');
      await initTreinosUIParaPaciente(_nutriId, p, 'treinosFichaMount');
    } catch (e) { erroAba(cont, 'Não foi possível carregar os treinos.', e); }
    return;
  }

  if (abaId === 'calorias') {
    cont.innerHTML = `<div id="caloriasFichaMount"><div class="loading"><div class="spinner"></div>Carregando...</div></div>`;
    try {
      const mod = await import('./calorias-ui.js');
      _calorias = mod;
      await mod.initCaloriasUIParaPaciente(_nutriId, p, 'caloriasFichaMount');
    } catch (e) { erroAba(cont, 'Não foi possível carregar o cálculo de calorias.', e); }
    return;
  }

  if (abaId === 'planejamento') {
    cont.innerHTML = `<div id="dietaFichaMount"><div class="loading"><div class="spinner"></div>Carregando planos...</div></div>`;
    try {
      const { initDietaUIParaPaciente } = await import('./dieta-ui.js');
      await initDietaUIParaPaciente(_nutriId, p, 'dietaFichaMount');
    } catch (e) { erroAba(cont, 'Não foi possível carregar o planejamento.', e); }
    return;
  }

  // Aba desconhecida (URL antiga de módulo removido): cai na visão geral.
  _abaAtual = 'visao';
  marcarAba(page, 'visao');
  renderAba('visao');
}

/** Falha de um módulo não derruba o Hub: cabeçalho e abas continuam de pé. */
function erroAba(cont, msg, e) {
  console.error('[hub]', msg, e);
  cont.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>
      <div>${esc(msg)}</div>
      <button class="btn-sm" style="margin-top:12px" data-hub-retry>Tentar novamente</button>
    </div>`;
  cont.querySelector('[data-hub-retry]')?.addEventListener('click', () => renderAba(_abaAtual));
}

// ─── Dados pessoais: um só layout; editar muda os balões in-place ───
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
        invalidarResumo(p.id);            // o cabeçalho e o painel releem no próximo acesso
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
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
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
