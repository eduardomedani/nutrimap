// ═══════════════════════════════════════════════════════════
// HUB DO PACIENTE — casca: cabeçalho, navegação e ações rápidas
// ═══════════════════════════════════════════════════════════
// Só apresentação. Quem decide o que existe é paciente-modulos.js; quem
// carrega os dados é paciente-resumo.js. Aqui monta-se o contexto que fica
// visível o tempo todo, enquanto o conteúdo da aba troca por baixo.
//
// O cabeçalho não repete o que o Painel 360° já mostra: ele responde "quem é
// este paciente e o que dá para fazer agora".

import { modulosDisponiveis } from './paciente-modulos.js';
import { QUESTIONARIO_URL } from './supabase.js';
import { copiarParaClipboard, gerarLinkWhatsapp, montarMensagemQuestionario } from './utils.js';

// Ações rápidas: só o que tem tela de verdade hoje. Iniciar consulta, anexar
// exame, agendar retorno e enviar material entram quando as fases 2, 4 e 6
// forem construídas — botão que não leva a lugar nenhum não entra.
const ACOES = [
  { id: 'consulta',  label: 'Registrar consulta',  icone: 'stethoscope', aba: 'consultas',    destaque: true },
  { id: 'avaliacao', label: 'Registrar avaliação', icone: 'ruler',       aba: 'avaliacoes',   destaque: true },
  { id: 'plano',     label: 'Revisar plano',       icone: 'utensils',    aba: 'planejamento' },
  { id: 'observacao', label: 'Adicionar observação', icone: 'notebook-pen', evento: 'observacao' },
  { id: 'treino',    label: 'Abrir treino',        icone: 'dumbbell',    aba: 'treinos' },
  { id: 'calorias',  label: 'Cálculo de calorias', icone: 'flame',       aba: 'calorias' },
  { id: 'anamnese',  label: 'Ver anamnese',        icone: 'clipboard-list', aba: 'anamnese' },
];

/**
 * HTML da casca do Hub. O conteúdo da aba entra em #fichaConteudo.
 * @param {object} p      paciente
 * @param {object} dados  { sexo, idade } da anamnese
 * @param {string} abaAtiva
 */
export function hubShellHtml(p, dados, abaAtiva) {
  const abas = modulosDisponiveis();
  const acoesDisponiveis = ACOES.filter(a => !a.aba || abas.some(m => m.id === a.aba));
  const destaques = acoesDisponiveis.filter(a => a.destaque);
  const secundarias = acoesDisponiveis.filter(a => !a.destaque);

  const sexo = dados?.sexo === 'M' ? 'Masculino' : dados?.sexo === 'F' ? 'Feminino' : null;
  const idade = dados?.idade != null ? `${dados.idade} anos` : null;
  const linha = [sexo, idade, `Cadastrado em ${fmtData(p.criado_em)}`].filter(Boolean).join(' · ');

  return `
    <button class="hub-voltar" id="fichaVoltar"><i data-lucide="arrow-left"></i> Clientes</button>

    <header class="hub-head">
      <div class="hub-id">
        <div class="hub-avatar">${esc(iniciais(p.nome))}</div>
        <div class="hub-id-txt">
          <h1 class="hub-nome">${esc(p.nome || '(sem nome)')}</h1>
          <div class="hub-meta">${esc(linha)}</div>
          <div class="hub-chips">
            <span class="hub-chip hub-chip-cod" title="Código do paciente">${esc(p.codigo || '—')}</span>
            <span class="hub-status" data-hub-status><span class="sk sk-chip"></span></span>
            <span class="hub-objetivo" data-hub-objetivo></span>
          </div>
        </div>
      </div>

      <div class="hub-acoes">
        ${destaques.map(a => `
          <button class="btn-sm btn-sm-secondary hub-acao" data-hub-acao="${a.id}">
            <i data-lucide="${a.icone}"></i> ${esc(a.label)}
          </button>`).join('')}
        <div class="hub-menu-wrap">
          <button class="btn-sm btn-sm-secondary hub-acao-mais" data-hub-menu
                  aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações">
            <i data-lucide="ellipsis"></i>
          </button>
          <div class="hub-menu" data-hub-menu-pop role="menu" hidden>
            ${secundarias.map(a => `
              <button role="menuitem" data-hub-acao="${a.id}">
                <i data-lucide="${a.icone}"></i> ${esc(a.label)}
              </button>`).join('')}
            <div class="hub-menu-sep"></div>
            <button role="menuitem" data-hub-link="anamnese"><i data-lucide="link"></i> Copiar link da anamnese</button>
            <button role="menuitem" data-hub-link="app"><i data-lucide="smartphone"></i> Copiar link do app</button>
            <button role="menuitem" data-hub-wa><i data-lucide="message-circle"></i> Enviar por WhatsApp</button>
          </div>
        </div>
      </div>
    </header>

    <nav class="hub-nav" role="tablist" aria-label="Módulos do paciente">
      ${abas.map(m => `
        <button class="hub-tab ${m.id === abaAtiva ? 'ativa' : ''}" data-aba="${m.id}"
                role="tab" aria-selected="${m.id === abaAtiva}">
          <i data-lucide="${m.icone}"></i> <span>${esc(m.label)}</span>
        </button>`).join('')}
    </nav>

    <div class="hub-conteudo" id="fichaConteudo"></div>`;
}

/**
 * Liga a casca. `handlers`: { onVoltar, irParaAba, onObservacao }.
 */
export function ligarHub(page, p, handlers = {}) {
  page.querySelector('#fichaVoltar')?.addEventListener('click', () => handlers.onVoltar?.());

  page.querySelectorAll('.hub-tab').forEach(b =>
    b.addEventListener('click', () => handlers.irParaAba?.(b.dataset.aba)));

  // Ações rápidas (destaque e menu compartilham o mesmo data-hub-acao).
  page.querySelectorAll('[data-hub-acao]').forEach(b =>
    b.addEventListener('click', () => {
      fecharMenu(page);
      const acao = ACOES.find(a => a.id === b.dataset.hubAcao);
      if (!acao) return;
      if (acao.evento === 'observacao') handlers.onObservacao?.();
      else if (acao.aba) handlers.irParaAba?.(acao.aba);
    }));

  const btnMenu = page.querySelector('[data-hub-menu]');
  const pop = page.querySelector('[data-hub-menu-pop]');
  if (btnMenu && pop) {
    btnMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const abrir = pop.hidden;
      pop.hidden = !abrir;
      btnMenu.setAttribute('aria-expanded', String(abrir));
    });
    pop.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => fecharMenu(page));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharMenu(page); });
  }

  const links = linksDoPaciente(p);
  page.querySelectorAll('[data-hub-link]').forEach(b =>
    b.addEventListener('click', () => {
      fecharMenu(page);
      copiarParaClipboard(links[b.dataset.hubLink], '✓ Link copiado');
    }));
  page.querySelector('[data-hub-wa]')?.addEventListener('click', () => {
    fecharMenu(page);
    const msg = montarMensagemQuestionario(p.nome, links.anamnese);
    window.open(gerarLinkWhatsapp(msg, p.telefone || ''), '_blank');
  });
}

function fecharMenu(page) {
  const pop = page.querySelector('[data-hub-menu-pop]');
  if (pop) pop.hidden = true;
  page.querySelector('[data-hub-menu]')?.setAttribute('aria-expanded', 'false');
}

/** Marca a aba ativa sem redesenhar o cabeçalho. */
export function marcarAba(page, abaId) {
  page.querySelectorAll('.hub-tab').forEach(b => {
    const on = b.dataset.aba === abaId;
    b.classList.toggle('ativa', on);
    b.setAttribute('aria-selected', String(on));
  });
}

/** Preenche status e objetivo assim que o resumo chega. */
export function preencherContexto(page, resumo) {
  const st = page.querySelector('[data-hub-status]');
  if (st && resumo?.status) {
    st.className = `hub-status tom-${resumo.status.tom}`;
    st.innerHTML = `<span class="hub-status-dot"></span>${esc(resumo.status.label)}`;
    st.title = resumo.status.detalhe || '';
  }
  const ob = page.querySelector('[data-hub-objetivo]');
  if (ob) {
    const obj = resumo?.metricas?.objetivo;
    ob.textContent = obj ? `Objetivo: ${obj}` : '';
    ob.hidden = !obj;
  }
}

// ── Links de acesso do paciente ────────────────────────────
export function linksDoPaciente(p) {
  return {
    anamnese: `${QUESTIONARIO_URL}anamnese.html?p=${p.codigo}`,
    app:      `${QUESTIONARIO_URL}app.html?codigo=${p.codigo}`,
  };
}

// ── Helpers ────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function iniciais(nome) {
  if (!nome) return '?';
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
}
function fmtData(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('pt-BR');
}
