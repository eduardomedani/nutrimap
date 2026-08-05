// ═══════════════════════════════════════════════════════════
// EQUIPE · DOCUMENTOS — a visão central do repositório
// ═══════════════════════════════════════════════════════════
// As outras duas telas de documento entram por uma porta: a competência (a
// partir da folha) ou a pessoa (a partir do cadastro). Esta entra por
// nenhuma — é a lista inteira, filtrável, para responder "quem ainda não viu
// o contracheque de julho?" sem abrir seis fichas.
//
// Não guarda arquivo nem gera documento: quem produz é o fluxo que o originou
// (importação do ponto, fechamento da folha). Aqui se consulta, abre, arquiva
// e reativa — usando os MESMOS serviços de js/documentos.js. Nenhuma consulta
// paralela, nenhuma tabela nova.

import {
  TIPOS, STATUS, listarDocumentos, urlAssinada, arquivarDocumento, reativarDocumento,
  formatoDoDocumento, contarPendentes, traduzirErroDocumento,
} from './documentos.js';
import { tamanho } from './documentos-ui.js';
import { listarFuncionarios } from './funcionarios.js';
import { listarFolhas, nomeCompetencia } from './folha.js';
import { competenciaAtiva, definirCompetencia } from './competencia.js';
import { formatarData, mostrarToast, mostrarErro, confirmar } from './utils.js';

// Os dois tipos que o sistema produz sozinho — fechar a folha gera o
// contracheque, importar o ponto guarda o espelho. São o que se procura em 9
// de cada 10 visitas, então ganham atalho próprio em vez de sumir numa lista
// de onze opções.
const TIPOS_PRINCIPAIS = ['contracheque', 'folha_ponto'];

let _nutriId = null;
let _container = null;

let _equipe = [];
let _competencias = [];
let _docs = [];
let _pendentes = 0;

const VISTOS = {
  todos: 'Qualquer visualização',
  visto: 'Visualizado',
  nao: 'Não visualizado',
};

let _filtro = {
  colaborador: '',
  tipo: '',
  competencia: '',
  status: '',
  visto: 'todos',
  arquivados: false,
};

// ───────────────────────────────────────────────────────────
export async function initDocumentosCentralUI(nutriId, containerId) {
  _nutriId = nutriId;
  _container = containerId;

  const cont = document.getElementById(containerId);
  if (!cont) return;
  cont.innerHTML = `<div class="loading"><div class="spinner"></div>Abrindo o repositório...</div>`;

  try {
    [_equipe, _competencias] = await Promise.all([
      listarFuncionarios({ incluirInativos: true, limite: 200 }),
      listarFolhas().then(fs => fs.map(f => f.competencia)),
    ]);
  } catch (e) {
    cont.innerHTML = erroHtml(e);
    return;
  }

  // Chegou de Ponto ou da Folha: o mês que estava na tela lá continua aqui.
  const daSessao = competenciaAtiva();
  if (daSessao && _competencias.includes(daSessao)) _filtro.competencia = daSessao;

  await carregar();
}

async function carregar() {
  const cont = document.getElementById(_container);
  if (!cont) return;

  try {
    _docs = await listarDocumentos({
      colaboradorId: _filtro.colaborador || undefined,
      competencia: _filtro.competencia || undefined,
      tipo: _filtro.tipo || undefined,
      incluirArquivados: _filtro.arquivados,
      apenasAtuais: false,
      limite: 300,
    });
  } catch (e) {
    cont.innerHTML = erroHtml(e);
    return;
  }

  try { _pendentes = await contarPendentes(); } catch (e) { _pendentes = 0; }

  render();
}

/** Os filtros que o banco não faz — status exato e visualização. */
function visiveis() {
  return _docs.filter(d => {
    if (_filtro.status && d.status !== _filtro.status) return false;
    if (_filtro.visto === 'visto' && !d.visualizado_pelo_colaborador) return false;
    if (_filtro.visto === 'nao' && d.visualizado_pelo_colaborador) return false;
    return true;
  });
}

// ───────────────────────────────────────────────────────────
function render() {
  const cont = document.getElementById(_container);
  if (!cont) return;

  const lista = visiveis();
  const vistos = lista.filter(d => d.visualizado_pelo_colaborador).length;

  cont.innerHTML = `
    <div class="fn-filtros dx-tipos" role="group" aria-label="Tipo de documento">
      <button class="fn-chip${_filtro.tipo === '' ? ' on' : ''}" data-dx-tipo="">Todos</button>
      ${TIPOS_PRINCIPAIS.map(t => `
        <button class="fn-chip${_filtro.tipo === t ? ' on' : ''}" data-dx-tipo="${t}">
          <i data-lucide="${TIPOS[t].icone}"></i> ${esc(TIPOS[t].rotulo)}
        </button>`).join('')}
    </div>

    <div class="dx-filtros">
      ${select('dxCol', 'Colaborador', _filtro.colaborador, [
        { v: '', r: 'Todos os colaboradores' },
        ..._equipe.map(f => ({ v: f.id, r: f.nome })),
      ])}
      ${select('dxTipo', 'Tipo', _filtro.tipo, [
        { v: '', r: 'Todos os tipos' },
        ...Object.entries(TIPOS).map(([k, t]) => ({ v: k, r: t.rotulo })),
      ])}
      ${select('dxComp', 'Competência', _filtro.competencia, [
        { v: '', r: 'Todas as competências' },
        ..._competencias.map(c => ({ v: c, r: nomeCompetencia(c) })),
      ])}
      ${select('dxStatus', 'Status do documento', _filtro.status, [
        { v: '', r: 'Qualquer status' },
        ...Object.entries(STATUS).map(([k, r]) => ({ v: k, r })),
      ])}
      ${select('dxVisto', 'Visualização pelo colaborador', _filtro.visto,
        Object.entries(VISTOS).map(([v, r]) => ({ v, r })))}

      <label class="dx-check">
        <input type="checkbox" id="dxArquivados" ${_filtro.arquivados ? 'checked' : ''}>
        Incluir arquivados
      </label>
    </div>

    <div class="dx-barra">
      <div class="dx-contagem">
        <strong>${lista.length}</strong> ${lista.length === 1 ? 'documento' : 'documentos'}
        · ${vistos} ${vistos === 1 ? 'visualizado' : 'visualizados'} pelo colaborador
      </div>
      ${_pendentes > 0 ? `
        <button class="btn" id="dxPendentes">
          <i data-lucide="inbox"></i> ${_pendentes} ${_pendentes === 1 ? 'pendente de vínculo' : 'pendentes de vínculo'}
        </button>` : ''}
    </div>

    ${lista.length ? tabelaHtml(lista) : `
      <div class="empty-state">
        <div class="empty-state-icon"><i data-lucide="folder-open"></i></div>
        Nenhum documento com esses filtros. Contracheques nascem ao fechar a
        folha; folhas de ponto, ao importar o PDF.
      </div>`}
  `;

  ligar();
}

function tabelaHtml(lista) {
  return `
    <div class="fp-tabela-wrap">
      <table class="fp-tabela dx-tabela">
        <thead>
          <tr>
            <th>Colaborador</th>
            <th>Documento</th>
            <th>Competência</th>
            <th>Status do documento</th>
            <th>Visualização pelo colaborador</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${lista.map(d => linhaHtml(d)).join('')}
        </tbody>
      </table>
    </div>`;
}

function linhaHtml(d) {
  const tipo = TIPOS[d.tipo_documento] || TIPOS.personalizado;
  const f = formatoDoDocumento(d);
  const arquivado = !!d.arquivado_em;

  return `
    <tr class="${arquivado ? 'dx-arquivado' : ''}">
      <td class="fp-nome" data-rot="Colaborador">
        <div>${esc(d.colaborador?.nome || '—')}</div>
        <div class="fp-nome-sub">${esc(d.colaborador?.cargo || '')}</div>
      </td>

      <td data-rot="Documento">
        <span class="dx-tipo"><i data-lucide="${tipo.icone}"></i> ${esc(d.titulo || tipo.rotulo)}</span>
        <div class="fp-nome-sub">
          ${d.versao > 1 ? `v${d.versao} · ` : ''}${esc(tamanho(d.tamanho_bytes))}${
            d.atual ? '' : ' · versão antiga'}
        </div>
      </td>

      <td data-rot="Competência">${esc(nomeCompetencia(d.competencia))}</td>

      <td data-rot="Status">
        <span class="dx-selo dx-selo-${esc(d.status || 'disponivel')}">${esc(STATUS[d.status] || d.status || '—')}</span>
        ${arquivado ? '<span class="dc-selo">Arquivado</span>' : ''}
      </td>

      <td data-rot="Visto pelo colaborador">
        ${d.visualizado_pelo_colaborador
          ? `<span class="dc-visto"><i data-lucide="eye"></i> ${esc(formatarData(d.visualizado_em))}</span>`
          : '<span class="dc-nao-visto">Ainda não visualizado</span>'}
      </td>

      <td class="fp-acoes">
        <button class="btn-sm" data-dx-abrir="${esc(d.caminho_storage)}">${esc(f.rotuloAbrir)}</button>
        ${arquivado
          ? `<button class="btn-sm btn-sm-secondary" data-dx-reativar="${d.id}">Reativar</button>`
          : `<button class="btn-sm btn-sm-secondary" data-dx-arquivar="${d.id}">Arquivar</button>`}
      </td>
    </tr>`;
}

// ───────────────────────────────────────────────────────────
function ligar() {
  const cont = document.getElementById(_container);
  if (!cont) return;

  const trocar = (id, campo) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => { _filtro[campo] = el.value; carregar(); });
  };
  trocar('dxCol', 'colaborador');
  trocar('dxTipo', 'tipo');
  trocar('dxStatus', 'status');
  trocar('dxVisto', 'visto');

  // A competência escolhida aqui vale para as outras abas. "Todas" não apaga a
  // escolha: é um recorte desta tela, não a decisão de trocar de mês.
  const comp = document.getElementById('dxComp');
  if (comp) comp.addEventListener('change', () => {
    _filtro.competencia = comp.value;
    if (comp.value) definirCompetencia(comp.value);
    carregar();
  });

  cont.querySelectorAll('[data-dx-tipo]').forEach(b =>
    b.addEventListener('click', () => { _filtro.tipo = b.dataset.dxTipo; carregar(); }));

  const arq = document.getElementById('dxArquivados');
  if (arq) arq.addEventListener('change', () => { _filtro.arquivados = arq.checked; carregar(); });

  cont.querySelectorAll('[data-dx-abrir]').forEach(b =>
    b.addEventListener('click', () => abrir(b.dataset.dxAbrir)));

  cont.querySelectorAll('[data-dx-arquivar]').forEach(b =>
    b.addEventListener('click', async () => {
      const sim = await confirmar({
        titulo: 'Arquivar documento',
        mensagem: 'O colaborador deixa de ver este documento no app.\n\nO arquivo continua guardado e pode ser reativado.',
        textoOk: 'Arquivar',
      });
      if (!sim) return;
      await comErro(async () => {
        await arquivarDocumento(b.dataset.dxArquivar);
        mostrarToast('Documento arquivado.');
        await carregar();
      });
    }));

  cont.querySelectorAll('[data-dx-reativar]').forEach(b =>
    b.addEventListener('click', () => comErro(async () => {
      await reativarDocumento(b.dataset.dxReativar);
      mostrarToast('Documento reativado.');
      await carregar();
    })));

  const pend = document.getElementById('dxPendentes');
  if (pend) pend.addEventListener('click', async () => {
    const { abrirPendentes } = await import('./documentos-ui.js');
    await abrirPendentes({
      container: _container,
      equipe: _equipe,
      competencia: _filtro.competencia || null,
      aoVoltar: () => carregar(),
    });
  });
}

async function abrir(caminho) {
  if (!caminho) return;
  await comErro(async () => {
    const url = await urlAssinada(caminho);
    if (url) window.open(url, '_blank', 'noopener');
  });
}

async function comErro(fn) {
  try { await fn(); }
  catch (e) { mostrarErro(traduzirErroDocumento(e.message)); }
}

// ───────────────────────────────────────────────────────────
function select(id, rotulo, valor, opcoes) {
  return `
    <div class="dx-campo">
      <label for="${id}">${esc(rotulo)}</label>
      <select class="fp-select" id="${id}">
        ${opcoes.map(o => `
          <option value="${esc(o.v)}"${String(o.v) === String(valor) ? ' selected' : ''}>${esc(o.r)}</option>`).join('')}
      </select>
    </div>`;
}

function erroHtml(e) {
  return `<div class="empty-state">
    <div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>
    ${esc(traduzirErroDocumento(e?.message))}</div>`;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
