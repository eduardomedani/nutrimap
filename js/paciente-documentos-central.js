// ═══════════════════════════════════════════════════════════
// DOCUMENTOS — a central do profissional (menu lateral)
// ═══════════════════════════════════════════════════════════
// O lugar de cadastrar documento sem ter que abrir a ficha do paciente antes,
// e de enxergar de uma vez o que foi compartilhado com quem.
//
// A DIFERENÇA PARA A ABA DA FICHA é o alcance, não a função: lá o paciente já
// está decidido; aqui ele é o primeiro campo do formulário. O resto — upload,
// validação por assinatura de arquivo, disponibilizar, editar, arquivar — é o
// MESMO código, importado. Duas telas com duas regras de upload seria uma
// delas ficando para trás na primeira correção.
//
// Documento exige `paciente_id` (`not null`, com RLS conferindo a carteira):
// não existe "cadastrar agora e escolher o dono depois". Por isso o seletor é
// obrigatório e o salvamento só acontece com ele preenchido.

import {
  listarTodosDocumentos, criarDocumento, reativarDocumento, editarInformacoes,
  substituirArquivo, excluirDocumento, urlAssinada, traduzirErroDocumento, TIPOS,
} from './paciente-documentos.js';
import {
  disponibilizarDocumentoAoPaciente, removerDocumentoDoApp, arquivarDocumentoDoPaciente,
} from './paciente-documentos-eventos.js';
import { itemHtml, menuHtml, skeletonHtml, FILTROS, dataBR } from './paciente-documentos-ui.js';
import { abrirDrawer } from './paciente-documentos-drawer.js';
import { listarPacientes } from './pacientes.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ───────────────────────────────────────────────────────────
// MARCAÇÃO
// ───────────────────────────────────────────────────────────

/**
 * A linha da central é a mesma da ficha, com o NOME DO PACIENTE por cima.
 *
 * Numa lista transversal o título sozinho não identifica nada: "Exames
 * laboratoriais" aparece cinco vezes e nenhuma diz de quem é.
 */
export function linhaHtml(doc) {
  const nome = doc.paciente?.nome || '(paciente removido)';
  return `
    <div class="pdoc-central-linha">
      <button class="pdoc-central-quem" type="button" data-ir-paciente="${esc(doc.paciente_id)}"
              title="Abrir a ficha de ${esc(nome)}">
        <i data-lucide="user"></i>${esc(nome)}
      </button>
      ${itemHtml(doc)}
    </div>`;
}

/**
 * Os contadores dos chips, derivados da coleção JÁ CARREGADA.
 *
 * Uma consulta por chip seriam cinco idas à rede para mostrar cinco números
 * que saem da mesma lista. Arquivado é o único que conta fora dos vivos: ele
 * não é um recorte dos demais, é quem saiu da operação.
 */
export function contarPorStatus(docs = []) {
  const vivos = docs.filter(d => !d.arquivado_em);
  return {
    todos: vivos.length,
    privado: vivos.filter(d => !d.visivel_paciente).length,
    disponivel: vivos.filter(d => d.visivel_paciente).length,
    nao_lido: vivos.filter(d => d.visivel_paciente && !d.visualizado_pelo_paciente).length,
    arquivado: docs.filter(d => d.arquivado_em).length,
  };
}

/**
 * O recorte do chip, sobre a mesma coleção.
 *
 * Arquivado fica FORA de todos os outros recortes: documento arquivado não é
 * operação diária, e misturá-lo com o que está em aberto faria a lista de
 * trabalho crescer com o que já foi resolvido.
 */
export function filtrarPorStatus(docs = [], filtro = 'todos') {
  if (filtro === 'arquivado') return docs.filter(d => d.arquivado_em);
  const vivos = docs.filter(d => !d.arquivado_em);
  if (filtro === 'privado') return vivos.filter(d => !d.visivel_paciente);
  if (filtro === 'disponivel') return vivos.filter(d => d.visivel_paciente);
  if (filtro === 'nao_lido') return vivos.filter(d => d.visivel_paciente && !d.visualizado_pelo_paciente);
  return vivos;
}

/** A faixa de indicadores — compacta, não quatro cartões grandes. */
export function indicadoresHtml(n) {
  const item = (rot, valor, destaque = false) => `
    <div class="pdoc-ind ${destaque && valor > 0 ? 'destaque' : ''}">
      <span class="pdoc-ind-n">${valor}</span>
      <span class="pdoc-ind-r">${esc(rot)}</span>
    </div>`;
  return `
    <div class="pdoc-inds">
      ${item('Documentos', n.todos)}
      ${item('Disponíveis', n.disponivel)}
      ${item('Não visualizados', n.nao_lido, true)}
      ${item('Privados', n.privado)}
    </div>`;
}

export function vazioHtml(temFiltro) {
  if (temFiltro) {
    // Oferecer "adicionar" a quem só filtrou seria não ler o que ele fez. O
    // que resolve o problema dele é desfazer o filtro.
    return `
      <div class="pdoc-vazio">
        <i data-lucide="filter"></i>
        <div class="pdoc-vazio-t">Nenhum documento encontrado com estes filtros.</div>
        <button class="btn-sm btn-sm-secondary" data-limpar>Limpar filtros</button>
      </div>`;
  }
  return `
    <div class="pdoc-vazio">
      <i data-lucide="paperclip"></i>
      <div class="pdoc-vazio-t">Nenhum documento cadastrado.</div>
      <div class="pdoc-vazio-s">Envie exames, relatórios e outros arquivos relacionados aos seus pacientes.</div>
      <button class="btn-sm" data-novo>Adicionar primeiro documento</button>
    </div>`;
}

export function cascaHtml(pacientes = []) {
  return `
    <div class="pdoc pdoc-central">
      <div class="pdoc-head">
        <div>
          <h2>Documentos</h2>
          <p class="pdoc-sub">Gerencie arquivos, exames e documentos compartilhados com seus pacientes.</p>
        </div>
        <button class="btn-sm" data-novo><i data-lucide="plus"></i> Novo documento</button>
      </div>

      <div data-inds></div>

      <!-- Toolbar em duas faixas: os chips de status em cima, os campos de
           recorte embaixo. Numa linha só, em tela estreita, eles disputariam
           espaço e o "Novo documento" acabaria quebrando junto. -->
      <div class="pdoc-toolbar">
        <div class="pdoc-chips" data-chips role="tablist" aria-label="Filtrar por situação"></div>
        <div class="pdoc-campos">
          <div class="pdoc-busca">
            <i data-lucide="search"></i>
            <input type="search" data-busca placeholder="Pesquisar" aria-label="Pesquisar documentos">
          </div>
          <select class="pdoc-select" data-f-paciente aria-label="Filtrar por paciente">
            <option value="">Todos os pacientes</option>
            ${pacientes.map(p => `<option value="${esc(p.id)}">${esc(p.nome || '(sem nome)')}</option>`).join('')}
          </select>
          <select class="pdoc-select" data-f-tipo aria-label="Filtrar por tipo">
            <option value="">Todos os tipos</option>
            ${Object.entries(TIPOS).map(([id, t]) => `<option value="${id}">${esc(t.rotulo)}</option>`).join('')}
          </select>
          <button class="pdoc-limpar" type="button" data-limpar hidden>
            <i data-lucide="x"></i> Limpar filtros
          </button>
        </div>
      </div>

      <div class="pdoc-erro" data-erro hidden>
        <i data-lucide="triangle-alert"></i>
        <div><div data-erro-txt></div><button data-retry>Tentar novamente</button></div>
      </div>

      <div data-lista>${skeletonHtml(4)}</div>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// A PÁGINA
// ───────────────────────────────────────────────────────────

/**
 * Monta a central. `irParaFicha(pacienteId)` é injetado pelo index.html, que é
 * quem sabe navegar entre as páginas do painel.
 */
export async function initDocumentosCentral({ cont, irParaFicha } = {}) {
  const alvo = typeof cont === 'string' ? document.getElementById(cont) : cont;
  if (!alvo) return;

  let pacientes = [];
  try { pacientes = await listarPacientes(); }
  catch (e) { console.error('[documentos] pacientes', e); }

  alvo.innerHTML = cascaHtml(pacientes);
  window.lucide?.createIcons?.();

  const $ = (s) => alvo.querySelector(s);
  const lista = $('[data-lista]');
  let filtro = 'todos';
  let docs = [];

  const temFiltro = () =>
    filtro !== 'todos' || Boolean($('[data-f-paciente]').value || $('[data-f-tipo]').value || $('[data-busca]').value);

  function limparFiltros() {
    filtro = 'todos';
    $('[data-f-paciente]').value = '';
    $('[data-f-tipo]').value = '';
    $('[data-busca]').value = '';
    carregar();
  }

  function erro(e) {
    console.error('[documentos central]', e);
    $('[data-erro]').hidden = false;
    $('[data-erro-txt]').textContent = traduzirErroDocumento(e?.message);
  }
  const limparErro = () => { $('[data-erro]').hidden = true; };
  $('[data-retry]')?.addEventListener('click', () => carregar());

  function pintarChips(n) {
    $('[data-chips]').innerHTML = FILTROS.map(f => `
      <button class="pdoc-chip ${f.id === filtro ? 'ativo' : ''}" data-filtro="${f.id}"
              role="tab" aria-selected="${f.id === filtro}">
        ${esc(f.label)}<span class="pdoc-chip-n">${n[f.id] ?? 0}</span>
      </button>`).join('');
    alvo.querySelectorAll('[data-filtro]').forEach(b =>
      b.addEventListener('click', () => { filtro = b.dataset.filtro; carregar(); }));
  }

  /**
   * UMA leitura por carga.
   *
   * Busca tudo que casa com os recortes de CONTEÚDO (paciente, tipo, busca),
   * inclusive arquivados, e resolve o resto em memória: os contadores dos
   * cinco chips e o recorte de situação saem da mesma coleção. Uma consulta
   * por chip seriam cinco idas à rede para mostrar cinco números que já estão
   * na mão.
   */
  async function carregar() {
    limparErro();
    lista.innerHTML = skeletonHtml(4);
    try {
      const base = await listarTodosDocumentos({
        pacienteId: $('[data-f-paciente]').value || null,
        tipo: $('[data-f-tipo]').value || null,
        busca: $('[data-busca]').value.trim() || null,
        incluirArquivados: true,
        limite: 500,
      });

      const n = contarPorStatus(base);
      docs = filtrarPorStatus(base, filtro);

      $('[data-inds]').innerHTML = indicadoresHtml(n);
      pintarChips(n);
      $('[data-limpar]').hidden = !temFiltro();

      lista.innerHTML = docs.length
        ? `<div class="pdoc-lista">${docs.map(linhaHtml).join('')}</div>`
        : vazioHtml(temFiltro());
      window.lucide?.createIcons?.();
      ligar();
    } catch (e) {
      lista.innerHTML = '';
      erro(e);
    }
  }

  let timer = null;
  $('[data-busca]').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(carregar, 280); });
  $('[data-f-paciente]').addEventListener('change', carregar);
  $('[data-f-tipo]').addEventListener('change', carregar);
  alvo.querySelectorAll('[data-novo]').forEach(b => b.addEventListener('click', novo));
  $('[data-limpar]')?.addEventListener('click', limparFiltros);

  // ── Menus e ações (mesma mecânica da aba da ficha) ──
  function fecharMenus() {
    alvo.querySelectorAll('[data-menu-pop]').forEach(m => m.remove());
    alvo.querySelectorAll('[data-menu]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }
  ligarFechamentoGlobal();

  function ligar() {
    // O botão de limpar do estado vazio é redesenhado a cada carga.
    lista.querySelector('[data-limpar]')?.addEventListener('click', limparFiltros);
    lista.querySelectorAll('[data-novo]').forEach(b => b.addEventListener('click', novo));

    alvo.querySelectorAll('[data-ir-paciente]').forEach(b =>
      b.addEventListener('click', () => irParaFicha?.(b.dataset.irPaciente)));

    alvo.querySelectorAll('[data-menu]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const jaAberto = btn.getAttribute('aria-expanded') === 'true';
        fecharMenus();
        if (jaAberto) return;
        const doc = docs.find(d => d.id === btn.dataset.menu);
        if (!doc) return;
        btn.parentElement.insertAdjacentHTML('beforeend', menuHtml(doc));
        btn.setAttribute('aria-expanded', 'true');
        window.lucide?.createIcons?.();
        btn.parentElement.querySelector('[data-menu-pop]').addEventListener('click', ev => ev.stopPropagation());
        ligarAcoes(btn.parentElement);
      });
    });
    ligarAcoes(alvo);
  }

  function ligarAcoes(escopo) {
    escopo.querySelectorAll('[data-acao]').forEach(b => {
      if (b.dataset.ligado) return;
      b.dataset.ligado = '1';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fecharMenus();
        executar(b.dataset.acao, b.dataset.id);
      });
    });
  }

  async function executar(acao, id) {
    const doc = docs.find(d => d.id === id);
    if (!doc) return;
    limparErro();
    try {
      if (acao === 'ver' || acao === 'baixar') return abrir(doc, acao === 'baixar');
      if (acao === 'editar') return editar(doc);
      if (acao === 'substituir') return trocarArquivo(doc);

      const nome = doc.paciente?.nome || 'o paciente';
      if (acao === 'disponibilizar') {
        if (!confirm(`Este documento ficará visível para ${nome} no aplicativo Evollo.\n\n"${doc.titulo}"`)) return;
        await disponibilizarDocumentoAoPaciente(id);
      }
      if (acao === 'remover') {
        if (!confirm(`Remover este documento do aplicativo de ${nome}?\n\n"${doc.titulo}"\n\nO arquivo NÃO é apagado — ele continua aqui, e o histórico da timeline também.`)) return;
        await removerDocumentoDoApp(id);
      }
      if (acao === 'arquivar') {
        if (!confirm(`Arquivar "${doc.titulo}"?\n\nEle sai do aplicativo do paciente e da lista, mas o arquivo é preservado.`)) return;
        await arquivarDocumentoDoPaciente(id);
      }
      if (acao === 'reativar') await reativarDocumento(id);
      if (acao === 'excluir') {
        const t = prompt(`EXCLUIR DEFINITIVAMENTE\n\nO arquivo e o registro somem, e não há como recuperar.\nPrefira Arquivar.\n\nPara confirmar, digite o título do documento:\n"${doc.titulo}"`);
        if (t === null) return;
        if (t.trim() !== String(doc.titulo).trim()) { erro(new Error('titulo_nao_confere')); return; }
        await excluirDocumento(id, { caminhoStorage: doc.caminho_storage });
      }
      await carregar();
    } catch (e) { erro(e); }
  }

  async function abrir(doc, baixar = false) {
    try {
      const url = await urlAssinada(doc.caminho_storage);
      if (!url) throw new Error('sem_url');
      if (!baixar) { window.open(url, '_blank', 'noopener'); return; }
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.nome_arquivo || 'documento';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      erro(new Error('Não foi possível abrir este documento.'));
    }
  }

  /**
   * O cadastro da central. A única diferença para o da ficha é o seletor de
   * paciente — o `nutriId` sai do próprio paciente escolhido, e o documento
   * continua nascendo privado.
   */
  function novo() {
    abrirDrawer({
      modo: 'novo', pacientes,
      aoSalvar: async (d) => {
        const p = pacientes.find(x => x.id === d.pacienteId);
        if (!p) throw new Error('documento_sem_paciente');
        const doc = await criarDocumento({
          nutriId: p.nutri_id, pacienteId: p.id,
          arquivo: d.arquivo, titulo: d.titulo, tipo: d.tipo,
          descricao: d.descricao, dataDocumento: d.dataDocumento,
        });
        if (d.disponibilizar) await disponibilizarDocumentoAoPaciente(doc.id);
        await carregar();
      },
    });
  }

  function editar(doc) {
    abrirDrawer({
      modo: 'editar', doc, nomePaciente: doc.paciente?.nome,
      aoSalvar: async (d) => {
        await editarInformacoes(doc.id, {
          titulo: d.titulo, tipo: d.tipo, descricao: d.descricao, dataDocumento: d.dataDocumento,
        });
        await carregar();
      },
    });
  }

  function trocarArquivo(doc) {
    abrirDrawer({
      modo: 'substituir', doc, nomePaciente: doc.paciente?.nome,
      aoSalvar: async (d) => { await substituirArquivo(doc, d.arquivo); await carregar(); },
    });
  }

  await carregar();
}

/** Fecha qualquer menu aberto. Registrado uma vez por carga do módulo. */
let _fechamentoLigado = false;
function ligarFechamentoGlobal() {
  if (_fechamentoLigado) return;
  _fechamentoLigado = true;
  const fechar = () => {
    document.querySelectorAll('[data-menu-pop]').forEach(m => m.remove());
    document.querySelectorAll('[data-menu][aria-expanded="true"]')
      .forEach(b => b.setAttribute('aria-expanded', 'false'));
  };
  document.addEventListener('click', fechar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
}

export { dataBR };
