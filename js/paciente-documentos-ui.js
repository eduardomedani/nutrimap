// ═══════════════════════════════════════════════════════════
// DOCUMENTOS DO PACIENTE — a aba do Hub
// ═══════════════════════════════════════════════════════════
// Central de arquivos do prontuário: o que o profissional guardou e o que ele
// decidiu mostrar ao paciente.
//
// LISTA, NÃO TABELA. São poucos arquivos por paciente; uma grade de sete
// colunas para oito linhas gasta mais tela do que informa, e no celular vira
// rolagem horizontal — que aqui não existe em nenhuma largura.
//
// O QUE ESTA TELA NUNCA MOSTRA: caminho no Storage e UUID. Os dois só servem
// para depurar, e vazam estrutura interna para quem só quer abrir um exame.
//
// Visualizar e baixar passam por URL assinada, gerada na hora e com prazo
// curto — o bucket é privado e não há URL pública para lugar nenhum.

import {
  listarDocumentos, resumoDoPaciente, criarDocumento,
  reativarDocumento, editarInformacoes, substituirArquivo,
  excluirDocumento, urlAssinada, formatarTamanho, formatoDoDocumento,
  traduzirErroDocumento, TIPOS,
} from './paciente-documentos.js';
// Disponibilizar, remover e arquivar passam pelo orquestrador: são as três
// transições que disparam integrações (aviso, timeline, push, auditoria), e
// espalhá-las por botão faria a próxima tela esquecer uma delas.
import {
  disponibilizarDocumentoAoPaciente, removerDocumentoDoApp, arquivarDocumentoDoPaciente,
} from './paciente-documentos-eventos.js';
import { abrirDrawer } from './paciente-documentos-drawer.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ───────────────────────────────────────────────────────────
// APRESENTAÇÃO
// ───────────────────────────────────────────────────────────

export const FILTROS = [
  { id: 'todos',      label: 'Todos' },
  { id: 'privado',    label: 'Privados' },
  { id: 'disponivel', label: 'Disponíveis' },
  { id: 'nao_lido',   label: 'Não visualizados' },
  { id: 'arquivado',  label: 'Arquivados' },
];

export function dataBR(iso) {
  if (!iso) return null;
  const d = String(iso).slice(0, 10).split('-');
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : null;
}

/**
 * Os selos do documento. Privado é o estado mais comum e por isso é o mais
 * discreto — se ele gritasse, o que é exceção (disponível, não lido) sumiria.
 */
export function badgesDe(doc) {
  const b = [];
  if (doc.arquivado_em) {
    b.push({ tom: 'arquivado', icone: 'archive', label: 'Arquivado' });
    return b;   // arquivado não é privado nem disponível: saiu do jogo
  }
  if (doc.visivel_paciente) {
    b.push({ tom: 'disponivel', icone: 'check-circle-2', label: 'Disponível' });
    b.push(doc.visualizado_pelo_paciente
      ? { tom: 'visto', icone: 'eye', label: `Visualizado em ${dataBR(doc.visualizado_em) || '—'}` }
      : { tom: 'novo', icone: 'sparkles', label: 'Não visualizado' });
  } else {
    b.push({ tom: 'privado', icone: 'lock', label: 'Privado' });
  }
  return b;
}

export function itemHtml(doc) {
  const t = TIPOS[doc.tipo] || TIPOS.outro;
  const f = formatoDoDocumento(doc);
  const meta = [
    t.rotulo,
    f.formato === 'imagem' ? 'Imagem' : 'PDF',
    formatarTamanho(doc.tamanho_bytes),
    dataBR(doc.data_documento),
  ].filter(Boolean);

  return `
    <div class="pdoc-item ${doc.arquivado_em ? 'arquivado' : ''}" data-doc="${esc(doc.id)}">
      <div class="pdoc-ico"><i data-lucide="${t.icone}"></i></div>
      <div class="pdoc-corpo">
        <div class="pdoc-titulo" title="${esc(doc.titulo)}">${esc(doc.titulo)}</div>
        <div class="pdoc-linha2">
          ${meta.map(m => esc(m)).join('<span class="sep">·</span>')}
        </div>
        <div class="pdoc-badges">
          ${badgesDe(doc).map(b => `
            <span class="pdoc-badge ${b.tom}">
              <i data-lucide="${b.icone}"></i>${esc(b.label)}
            </span>`).join('')}
        </div>
      </div>
      <div class="pdoc-acoes">
        <button class="btn-sm btn-sm-secondary" data-acao="ver" data-id="${esc(doc.id)}">
          ${esc(f.rotuloAbrir)}
        </button>
        <div class="pdoc-menu-wrap">
          <button class="pdoc-menu-btn" data-menu="${esc(doc.id)}"
                  aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações">
            <i data-lucide="ellipsis-vertical"></i>
          </button>
        </div>
      </div>
    </div>`;
}

/** O menu [...]. Excluir por último, separado, e é a única ação de risco. */
export function menuHtml(doc) {
  const arq = Boolean(doc.arquivado_em);
  const itens = [
    ['ver', 'eye', 'Visualizar'],
    ['baixar', 'download', 'Baixar'],
    ['editar', 'pencil', 'Editar informações'],
  ];
  if (!arq) {
    itens.push(doc.visivel_paciente
      ? ['remover', 'eye-off', 'Remover do aplicativo']
      : ['disponibilizar', 'send', 'Disponibilizar ao paciente']);
    itens.push(['substituir', 'refresh-cw', 'Substituir arquivo']);
  }
  itens.push(arq ? ['reativar', 'archive-restore', 'Reativar'] : ['arquivar', 'archive', 'Arquivar']);

  return `
    <div class="pdoc-menu" role="menu" data-menu-pop>
      ${itens.map(([a, i, l]) => `
        <button role="menuitem" data-acao="${a}" data-id="${esc(doc.id)}">
          <i data-lucide="${i}"></i>${esc(l)}
        </button>`).join('')}
      <div class="pdoc-menu-sep"></div>
      <button role="menuitem" class="risco" data-acao="excluir" data-id="${esc(doc.id)}">
        <i data-lucide="trash-2"></i>Excluir
      </button>
    </div>`;
}

export function vazioHtml(filtro) {
  // O vazio por filtro não é o mesmo vazio de "não há nada": oferecer
  // "adicionar documento" a quem só filtrou por Arquivados seria não ler.
  if (filtro && filtro !== 'todos') {
    return `
      <div class="pdoc-vazio">
        <i data-lucide="filter"></i>
        <div class="pdoc-vazio-t">Nenhum documento neste filtro</div>
        <div class="pdoc-vazio-s">Tente outro filtro ou limpe a pesquisa.</div>
      </div>`;
  }
  return `
    <div class="pdoc-vazio">
      <i data-lucide="paperclip"></i>
      <div class="pdoc-vazio-t">Nenhum documento adicionado.</div>
      <div class="pdoc-vazio-s">Envie exames, relatórios e arquivos relacionados a este paciente.</div>
      <button class="btn-sm" data-novo>Adicionar documento</button>
    </div>`;
}

/** Três esqueletos: a lista tem forma conhecida, então o carregamento a mostra. */
export const skeletonHtml = (n = 3) =>
  `<div class="pdoc-lista">${'<div class="pdoc-sk"></div>'.repeat(n)}</div>`;

export function cascaHtml() {
  return `
    <div class="pdoc">
      <div class="pdoc-head">
        <div>
          <h2>Documentos</h2>
          <p class="pdoc-sub">Arquivos, exames, relatórios e documentos compartilhados com o paciente.</p>
        </div>
        <button class="btn-sm" data-novo><i data-lucide="plus"></i> Novo documento</button>
      </div>

      <div class="pdoc-filtros">
        <div class="pdoc-chips" data-chips role="tablist" aria-label="Filtrar documentos"></div>
        <select class="pdoc-select" data-f-tipo aria-label="Filtrar por tipo">
          <option value="">Todos os tipos</option>
          ${Object.entries(TIPOS).map(([id, t]) =>
            `<option value="${id}">${esc(t.rotulo)}</option>`).join('')}
        </select>
        <select class="pdoc-select" data-f-ano aria-label="Filtrar por ano"></select>
        <div class="pdoc-busca">
          <i data-lucide="search"></i>
          <input type="search" data-busca placeholder="Pesquisar" aria-label="Pesquisar documentos">
        </div>
      </div>

      <div class="pdoc-erro" data-erro hidden>
        <i data-lucide="triangle-alert"></i>
        <div><div data-erro-txt></div><button data-retry>Tentar novamente</button></div>
      </div>

      <div data-lista>${skeletonHtml()}</div>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// A ABA
// ───────────────────────────────────────────────────────────

/**
 * Fecha qualquer menu [...] aberto, venha o clique de onde vier. Ligado uma
 * única vez por carga do módulo — ver o comentário em initDocumentos().
 */
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

/** Contrato do Hub: initXxx({ cont, paciente, irParaAba }). */
export async function initDocumentos({ cont, paciente }) {
  cont.innerHTML = cascaHtml();
  window.lucide?.createIcons?.();

  const $ = (s) => cont.querySelector(s);
  const lista = $('[data-lista]');
  let filtro = 'todos';
  let docs = [];

  // ── Erro: frase de gente, e um caminho de volta ──
  function erro(e) {
    console.error('[documentos]', e);
    const box = $('[data-erro]');
    box.hidden = false;
    $('[data-erro-txt]').textContent = traduzirErroDocumento(e?.message);
  }
  const limparErro = () => { $('[data-erro]').hidden = true; };
  $('[data-retry]')?.addEventListener('click', () => carregar());

  // ── Chips com contador ──
  function pintarChips(resumo) {
    const n = {
      todos: resumo.total, privado: resumo.privados, disponivel: resumo.disponiveis,
      nao_lido: resumo.naoLidos, arquivado: resumo.arquivados,
    };
    $('[data-chips]').innerHTML = FILTROS.map(f => `
      <button class="pdoc-chip ${f.id === filtro ? 'ativo' : ''}" data-filtro="${f.id}"
              role="tab" aria-selected="${f.id === filtro}">
        ${esc(f.label)}<span class="pdoc-chip-n">${n[f.id] ?? 0}</span>
      </button>`).join('');
    cont.querySelectorAll('[data-filtro]').forEach(b =>
      b.addEventListener('click', () => { filtro = b.dataset.filtro; carregar(); }));
  }

  function pintarAnos(todos) {
    const anos = [...new Set(todos.map(d => (d.data_documento || d.criado_em || '').slice(0, 4)).filter(Boolean))]
      .sort().reverse();
    const sel = $('[data-f-ano]');
    const atual = sel.value;
    sel.innerHTML = `<option value="">Todos os anos</option>` +
      anos.map(a => `<option value="${a}"${a === atual ? ' selected' : ''}>${a}</option>`).join('');
  }

  // ── Carregar ──
  async function carregar() {
    limparErro();
    lista.innerHTML = skeletonHtml();
    try {
      const [itens, resumo] = await Promise.all([
        listarDocumentos({
          pacienteId: paciente.id,
          tipo: $('[data-f-tipo]').value || null,
          ano: $('[data-f-ano]').value || null,
          visibilidade: filtro === 'todos' ? null : filtro,
          incluirArquivados: filtro === 'arquivado',
          busca: $('[data-busca]').value.trim() || null,
        }),
        resumoDoPaciente(paciente.id),
      ]);
      docs = itens;
      pintarChips(resumo);
      pintarAnos(itens);
      lista.innerHTML = itens.length
        ? `<div class="pdoc-lista">${itens.map(itemHtml).join('')}</div>`
        : vazioHtml(filtro === 'todos' && !$('[data-busca]').value ? null : filtro);
      window.lucide?.createIcons?.();
      ligarLista();
    } catch (e) {
      lista.innerHTML = '';
      erro(e);
    }
  }

  // Busca com espera: uma consulta por tecla digitada seria uma por letra.
  let timer = null;
  $('[data-busca]').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(carregar, 280);
  });
  $('[data-f-tipo]').addEventListener('change', carregar);
  $('[data-f-ano]').addEventListener('change', carregar);
  cont.querySelectorAll('[data-novo]').forEach(b => b.addEventListener('click', novo));

  // ── Menu por documento ──
  function fecharMenus() {
    cont.querySelectorAll('[data-menu-pop]').forEach(m => m.remove());
    cont.querySelectorAll('[data-menu]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }
  // Registrado no módulo, não aqui: initDocumentos() roda a cada visita à aba,
  // e um addEventListener no `document` por visita empilharia um listener novo
  // toda vez — o mesmo motivo do _pushLigado em paciente-ui.js. O fechamento
  // varre o documento inteiro, então serve para qualquer container montado.
  ligarFechamentoGlobal();

  function ligarLista() {
    cont.querySelectorAll('[data-menu]').forEach(btn => {
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
        btn.parentElement.querySelector('[data-menu-pop]')
          .addEventListener('click', (ev) => ev.stopPropagation());
        ligarAcoes(btn.parentElement);
      });
    });
    ligarAcoes(cont);
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

  // ── Ações ──
  async function executar(acao, id) {
    const doc = docs.find(d => d.id === id);
    if (!doc && acao !== 'novo') return;
    limparErro();
    try {
      if (acao === 'ver' || acao === 'baixar') return abrir(doc, acao === 'baixar');
      if (acao === 'editar') return editar(doc);
      if (acao === 'substituir') return trocarArquivo(doc);

      if (acao === 'disponibilizar') {
        // A confirmação nomeia o paciente: "disponibilizar" é abstrato,
        // "ficará visível para Eduardo" é uma pessoa.
        const nome = paciente.nome || 'o paciente';
        if (!confirm(`Este documento ficará visível para ${nome} no aplicativo Evollo.\n\n"${doc.titulo}"`)) return;
        const r = await disponibilizarDocumentoAoPaciente(id);
        // `disponibilizado: false` = alguma outra aba já tinha feito isso. Não
        // é erro: o estado final é o desejado, e a lista vai mostrá-lo.
        if (r.disponibilizado && !r.avisou) {
          console.warn('[documentos] disponibilizado, mas o aviso interno não gravou');
        }
      }
      if (acao === 'remover') {
        if (!confirm(`Remover este documento do aplicativo do paciente?\n\n"${doc.titulo}"\n\nO arquivo NÃO é apagado — ele continua aqui, e o histórico da timeline também.`)) return;
        await removerDocumentoDoApp(id);
      }
      if (acao === 'arquivar') {
        if (!confirm(`Arquivar "${doc.titulo}"?\n\nEle sai do aplicativo do paciente e da lista, mas o arquivo é preservado.`)) return;
        await arquivarDocumentoDoPaciente(id);
      }
      if (acao === 'reativar') await reativarDocumento(id);
      if (acao === 'excluir') {
        // Confirmação forte: o nome do documento tem que ser digitado. Um
        // "OK" a mais não distingue quem leu de quem clicou.
        const t = prompt(`EXCLUIR DEFINITIVAMENTE\n\nO arquivo e o registro somem, e não há como recuperar.\nPrefira Arquivar.\n\nPara confirmar, digite o título do documento:\n"${doc.titulo}"`);
        if (t === null) return;
        if (t.trim() !== String(doc.titulo).trim()) {
          erro(new Error('titulo_nao_confere'));
          return;
        }
        await excluirDocumento(id, { caminhoStorage: doc.caminho_storage });
      }
      await carregar();
    } catch (e) { erro(e); }
  }

  /**
   * Abrir e baixar passam pela mesma porta: URL assinada, gerada agora, com
   * prazo curto. Nada de URL pública, e nada de guardar a assinada.
   */
  async function abrir(doc, baixar = false) {
    try {
      const url = await urlAssinada(doc.caminho_storage);
      if (!url) throw new Error('sem_url');
      if (!baixar) { window.open(url, '_blank', 'noopener'); return; }
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.nome_arquivo || 'documento';   // o nome ORIGINAL, não o saneado
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      erro(new Error('Não foi possível abrir este documento.'));
    }
  }

  function novo() {
    abrirDrawer({
      modo: 'novo', nomePaciente: paciente.nome,
      aoSalvar: async (d) => {
        const doc = await criarDocumento({
          nutriId: paciente.nutri_id, pacienteId: paciente.id,
          arquivo: d.arquivo, titulo: d.titulo, tipo: d.tipo,
          descricao: d.descricao, dataDocumento: d.dataDocumento,
        });
        // Nasce privado, sempre. Disponibilizar é o segundo passo, mesmo com o
        // switch ligado — o documento existe antes de ser publicado, e é essa
        // segunda chamada (não o upload) que dispara aviso, timeline e push.
        if (d.disponibilizar) await disponibilizarDocumentoAoPaciente(doc.id);
        await carregar();
      },
    });
  }

  function editar(doc) {
    abrirDrawer({
      modo: 'editar', doc, nomePaciente: paciente.nome,
      aoSalvar: async (d) => {
        await editarInformacoes(doc.id, {
          titulo: d.titulo, tipo: d.tipo,
          descricao: d.descricao, dataDocumento: d.dataDocumento,
        });
        await carregar();
      },
    });
  }

  function trocarArquivo(doc) {
    abrirDrawer({
      modo: 'substituir', doc, nomePaciente: paciente.nome,
      aoSalvar: async (d) => { await substituirArquivo(doc, d.arquivo); await carregar(); },
    });
  }

  await carregar();
}
