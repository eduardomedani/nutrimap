// ═══════════════════════════════════════════════════════════
// DOCUMENTOS DO PACIENTE — o drawer
// ═══════════════════════════════════════════════════════════
// Três usos, um só painel: novo documento, editar informações e substituir
// arquivo. Painel lateral, não modal pequeno — são cinco campos mais uma área
// de upload, e modal de 400px transformaria isso em rolagem.
//
// O PONTO DELICADO desta tela é o switch. Ligar "disponibilizar" faz um exame
// aparecer no celular de outra pessoa, e isso não se desfaz da cabeça de quem
// já leu. Por isso: default DESLIGADO, aviso que nomeia o paciente, e o aviso
// só aparece quando o switch está ligado — avisar sempre é ensinar a ignorar.
//
// Comportamento igual ao drawer do comercial e do financeiro: fundo escuro,
// painel à direita, Escape fecha, clique no fundo fecha.

import { TIPOS, formatarTamanho, traduzirErroDocumento } from './paciente-documentos.js';
import { validarArquivo, MIMES_ACEITOS, TAMANHO_MAXIMO } from './paciente-documentos-storage.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** O `accept` do <input file>. Conveniência do seletor — quem valida é o byte. */
export const ACEITA = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ───────────────────────────────────────────────────────────
// MARCAÇÃO
// ───────────────────────────────────────────────────────────

export function opcoesDeTipo(selecionado = 'exame') {
  return Object.entries(TIPOS)
    .map(([id, t]) => `<option value="${id}"${id === selecionado ? ' selected' : ''}>${esc(t.rotulo)}</option>`)
    .join('');
}

/** A área de upload vazia — o estado antes de escolher. */
export function dropHtml() {
  return `
    <div class="pdoc-drop" data-drop tabindex="0" role="button"
         aria-label="Escolher arquivo para enviar">
      <i data-lucide="cloud-upload"></i>
      <div class="pdoc-drop-t">Arraste o arquivo aqui</div>
      <div class="pdoc-drop-s">ou clique para escolher · PDF, JPG ou PNG · até 15 MB</div>
    </div>`;
}

/** Depois de escolher: o arquivo, e como trocá-lo antes de salvar. */
export function arquivoHtml(arquivo) {
  const ehImagem = String(arquivo.type || '').startsWith('image/');
  return `
    <div class="pdoc-arquivo">
      <div class="pdoc-arquivo-ico"><i data-lucide="${ehImagem ? 'image' : 'file-text'}"></i></div>
      <div class="pdoc-arquivo-txt">
        <div class="pdoc-arquivo-nome" title="${esc(arquivo.name)}">${esc(arquivo.name)}</div>
        <div class="pdoc-arquivo-meta">${esc(formatarTamanho(arquivo.size))}</div>
      </div>
      <button type="button" class="pdoc-arquivo-trocar" data-trocar>Trocar</button>
    </div>`;
}

/**
 * O aviso que nomeia o paciente. Item 41 do briefing, e a razão dele: sem o
 * nome na frase, "disponibilizar" é abstrato — com o nome, é uma pessoa.
 */
export function avisoPrivacidadeHtml(nomePaciente) {
  return `
    <div class="pdoc-aviso" data-aviso>
      <i data-lucide="shield-check"></i>
      <div>Este documento ficará visível para <b>${esc(nomePaciente || 'o paciente')}</b>
           no aplicativo Evollo.</div>
    </div>`;
}

function campo(id, rotulo, controle, { obrigatorio = false } = {}) {
  return `
    <div class="pdoc-campo" data-campo="${id}">
      <label for="pdoc-${id}">${esc(rotulo)}${obrigatorio ? ' <span class="req">*</span>' : ''}</label>
      ${controle}
      <div class="pdoc-erro-campo" data-erro hidden></div>
    </div>`;
}

/**
 * O corpo do drawer. `modo`:
 *   'novo'        — todos os campos + upload + switch
 *   'editar'      — só informações. Trocar arquivo é outra ação, de propósito:
 *                   substituir calado faria o paciente abrir conteúdo diferente
 *                   do que ele viu, com a mesma data de visualização.
 *   'substituir'  — só o upload.
 */
/**
 * O seletor de paciente — só existe quando o drawer é aberto da CENTRAL.
 *
 * Documento exige `paciente_id` (`not null`, com RLS conferindo a carteira):
 * não há "cadastrar sem dono". Aberto de dentro da ficha, o paciente já está
 * decidido e o campo nem aparece — perguntar de novo o que a tela já sabe é
 * convite a errar o cliente.
 */
export function seletorPacienteHtml(pacientes = [], selecionado = '') {
  return `
    <div class="pdoc-campo" data-campo="paciente">
      <label for="pdoc-paciente">Paciente <span class="req">*</span></label>
      <select id="pdoc-paciente" data-paciente>
        <option value="">Escolha o paciente…</option>
        ${pacientes.map(p => `
          <option value="${esc(p.id)}"${p.id === selecionado ? ' selected' : ''}>${esc(p.nome || '(sem nome)')}</option>`).join('')}
      </select>
      <div class="pdoc-erro-campo" data-erro hidden></div>
    </div>`;
}

export function corpoHtml({ modo = 'novo', doc = null, nomePaciente = '', pacientes = null } = {}) {
  if (modo === 'substituir') {
    return `
      <p class="pdoc-sub" style="margin-bottom:14px">
        O arquivo atual não é apagado: ele vira versão anterior e sai do aplicativo.
        O histórico do documento continua inteiro.
      </p>
      <div data-area-arquivo>${dropHtml()}</div>
      <input type="file" data-file accept="${ACEITA}" hidden>`;
  }

  const infos = `
    ${pacientes ? seletorPacienteHtml(pacientes, doc?.paciente_id || '') : ''}
    ${campo('titulo', 'Título',
      `<input type="text" id="pdoc-titulo" data-titulo maxlength="140"
              placeholder="Exames laboratoriais — agosto"
              value="${esc(doc?.titulo || '')}">`, { obrigatorio: true })}

    <div class="pdoc-campo-2">
      ${campo('tipo', 'Tipo',
        `<select id="pdoc-tipo" data-tipo>${opcoesDeTipo(doc?.tipo || 'exame')}</select>`,
        { obrigatorio: true })}
      ${campo('data', 'Data do documento',
        `<input type="date" id="pdoc-data" data-data max="${hojeISO()}"
                value="${esc(doc?.data_documento || '')}">`)}
    </div>

    ${campo('descricao', 'Descrição',
      `<textarea id="pdoc-descricao" data-descricao maxlength="600"
                 placeholder="O que este documento traz (opcional)">${esc(doc?.descricao || '')}</textarea>`)}`;

  if (modo === 'editar') return infos;

  return `
    ${infos}
    ${campo('arquivo', 'Arquivo',
      `<div data-area-arquivo>${dropHtml()}</div>
       <input type="file" data-file accept="${ACEITA}" hidden>`, { obrigatorio: true })}

    <div class="pdoc-switch">
      <div class="pdoc-switch-txt">
        <div class="pdoc-switch-t">Disponibilizar no aplicativo do paciente</div>
        <div class="pdoc-switch-s">O paciente poderá visualizar este documento no Evollo.</div>
      </div>
      <label class="pdoc-sw">
        <input type="checkbox" data-visivel aria-label="Disponibilizar no aplicativo do paciente">
        <span class="pdoc-sw-ui"></span>
      </label>
    </div>
    <div data-area-aviso hidden>${avisoPrivacidadeHtml(nomePaciente)}</div>`;
}

const TITULO = { novo: 'Novo documento', editar: 'Editar informações', substituir: 'Substituir arquivo' };
const SALVAR = { novo: 'Salvar documento', editar: 'Salvar', substituir: 'Substituir' };

export function drawerHtml({ modo = 'novo', doc = null, nomePaciente = '', pacientes = null } = {}) {
  return `
    <div class="pdoc-drawer-raiz" data-raiz>
      <div class="pdoc-drawer" role="dialog" aria-modal="true" aria-label="${esc(TITULO[modo])}">
        <div class="pdoc-drawer-topo">
          <h2>${esc(TITULO[modo])}</h2>
          <button type="button" class="pdoc-drawer-x" data-fechar aria-label="Fechar">
            <i data-lucide="x"></i>
          </button>
        </div>
        <div class="pdoc-drawer-corpo">
          <div class="pdoc-erro" data-erro-geral hidden>
            <i data-lucide="triangle-alert"></i><div data-erro-txt></div>
          </div>
          ${corpoHtml({ modo, doc, nomePaciente, pacientes })}
        </div>
        <div class="pdoc-drawer-pe">
          <button type="button" class="btn-sm btn-sm-secondary" data-cancelar>Cancelar</button>
          <button type="button" class="btn-sm" data-salvar>${esc(SALVAR[modo])}</button>
        </div>
      </div>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// VALIDAÇÃO
// ───────────────────────────────────────────────────────────

/**
 * As regras do formulário, sem DOM — é o que os testes exercitam.
 * Devolve `{ ok, erros: { campo: mensagem } }`.
 */
export function validarFormulario({ modo = 'novo', titulo, tipo, arquivo, dataDocumento, pacienteId, exigePaciente = false }, hoje = hojeISO()) {
  const erros = {};

  if (modo !== 'substituir') {
    // Só a central exige escolher: na ficha o paciente já está decidido.
    if (exigePaciente && !pacienteId) erros.paciente = 'Escolha o paciente.';
    if (!String(titulo || '').trim()) erros.titulo = 'Dê um título ao documento.';
    if (!TIPOS[tipo]) erros.tipo = 'Escolha um tipo.';
    // Data no futuro é quase sempre erro de digitação — e um exame emitido
    // amanhã ordenaria a lista inteira errado.
    if (dataDocumento && dataDocumento > hoje) erros.data = 'A data não pode ser no futuro.';
  }
  if (modo !== 'editar' && !arquivo) erros.arquivo = 'Escolha um arquivo para enviar.';

  return { ok: Object.keys(erros).length === 0, erros };
}

// ───────────────────────────────────────────────────────────
// ABRIR
// ───────────────────────────────────────────────────────────

/**
 * Abre o drawer e resolve quando o usuário salva (com os dados) ou fecha
 * (com null). Quem grava é quem chamou — este módulo não conhece o banco.
 */
export function abrirDrawer({ modo = 'novo', doc = null, nomePaciente = '', pacientes = null, aoSalvar }) {
  const raiz = document.createElement('div');
  raiz.innerHTML = drawerHtml({ modo, doc, nomePaciente, pacientes });
  const el = raiz.firstElementChild;
  document.body.appendChild(el);
  document.body.classList.add('pdoc-travado');
  window.lucide?.createIcons?.();

  let arquivo = null;
  const $ = (sel) => el.querySelector(sel);

  const fechar = () => {
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('pdoc-travado');
    el.remove();
  };
  const onKey = (e) => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', onKey);

  $('[data-fechar]')?.addEventListener('click', fechar);
  $('[data-cancelar]')?.addEventListener('click', fechar);
  // Clique no fundo fecha; dentro do painel, não.
  el.addEventListener('click', (e) => { if (e.target === el) fechar(); });

  // ── Arquivo ──
  const input = $('[data-file]');
  const area = $('[data-area-arquivo]');

  async function receber(f) {
    if (!f) return;
    try {
      await validarArquivo(f);          // recusa pelo CONTEÚDO, antes de salvar
      arquivo = f;
      area.innerHTML = arquivoHtml(f);
      window.lucide?.createIcons?.();
      area.querySelector('[data-trocar]')?.addEventListener('click', () => {
        arquivo = null;
        area.innerHTML = dropHtml();
        window.lucide?.createIcons?.();
        ligarDrop();
      });
      mostrarErro(null);
      marcarCampo('arquivo', null);
    } catch (e) {
      arquivo = null;
      marcarCampo('arquivo', traduzirErroDocumento(e.message));
    }
  }

  function ligarDrop() {
    const drop = area?.querySelector('[data-drop]');
    if (!drop || !input) return;
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    // preventDefault nos dois: sem ele o navegador abre o arquivo na aba.
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('sobre'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('sobre'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('sobre');
      receber(e.dataTransfer?.files?.[0]);
    });
  }
  ligarDrop();
  input?.addEventListener('change', () => receber(input.files?.[0]));

  // ── Switch e aviso ──
  const sw = $('[data-visivel]');
  const areaAviso = $('[data-area-aviso]');
  const sel = $('[data-paciente]');

  function atualizarAviso() {
    if (!areaAviso) return;
    areaAviso.hidden = !sw?.checked;
    // Na central o nome só se sabe depois de escolher — e o aviso sem nome
    // ("ficará visível para o paciente") não serve para conferir nada.
    if (sw?.checked && sel) {
      const nome = sel.options[sel.selectedIndex]?.textContent?.trim();
      areaAviso.innerHTML = avisoPrivacidadeHtml(sel.value ? nome : '');
      window.lucide?.createIcons?.();
    }
  }
  sw?.addEventListener('change', atualizarAviso);
  sel?.addEventListener('change', () => { marcarCampo('paciente', null); atualizarAviso(); });

  // ── Erros ──
  function mostrarErro(msg) {
    const box = $('[data-erro-geral]');
    if (!box) return;
    box.hidden = !msg;
    if (msg) $('[data-erro-txt]').textContent = msg;
  }
  function marcarCampo(id, msg) {
    const c = el.querySelector(`[data-campo="${id}"]`);
    if (!c) return;
    c.classList.toggle('invalido', Boolean(msg));
    const e = c.querySelector('[data-erro]');
    if (e) { e.hidden = !msg; e.textContent = msg || ''; }
  }

  // ── Salvar ──
  const btn = $('[data-salvar]');
  btn?.addEventListener('click', async () => {
    const dados = {
      modo,
      pacienteId: sel?.value || null,
      exigePaciente: Boolean(pacientes),
      titulo: $('[data-titulo]')?.value,
      tipo: $('[data-tipo]')?.value,
      descricao: $('[data-descricao]')?.value || null,
      dataDocumento: $('[data-data]')?.value || null,
      disponibilizar: Boolean(sw?.checked),
      arquivo,
    };

    const { ok, erros } = validarFormulario(dados);
    for (const id of ['paciente', 'titulo', 'tipo', 'data', 'arquivo']) marcarCampo(id, erros[id] || null);
    if (!ok) return;

    btn.disabled = true;
    const rotulo = btn.textContent;
    btn.textContent = 'Salvando...';
    try {
      await aoSalvar?.(dados);
      fechar();
    } catch (e) {
      mostrarErro(traduzirErroDocumento(e.message));
      btn.disabled = false;
      btn.textContent = rotulo;
    }
  });

  // O foco vai para o primeiro campo útil — no modo substituir, para a área.
  ($('[data-titulo]') || area?.querySelector('[data-drop]'))?.focus?.();

  return { fechar, el };
}

export { MIMES_ACEITOS, TAMANHO_MAXIMO };
