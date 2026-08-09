// ═══════════════════════════════════════════════════════════
// PWA · DOCUMENTOS — a tela do paciente
// ═══════════════════════════════════════════════════════════
// Os arquivos que o profissional compartilhou. Só leitura: nada aqui edita,
// apaga ou muda visibilidade, e não há controle que sugira que muda.
//
// A ORDEM DE ABRIR é o ponto desta tela:
//     valida → gera URL assinada → marca visualizado → abre
// Marcar antes de a URL existir contaria leitura de documento que não abriu.
// E marcar porque o cartão apareceu contaria leitura de quem só rolou a lista.
//
// Sem viewer interno nesta etapa: a URL assinada abre no visualizador do
// próprio sistema, que no celular é o que o paciente já sabe usar.

import { meusDocumentos, marcarVisualizado, urlAssinada } from './paciente-documentos.js';
import { paraCartao, agruparPorAno } from './pwa-documentos-data.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ───────────────────────────────────────────────────────────
// MARCAÇÃO
// ───────────────────────────────────────────────────────────

/**
 * Um documento. O botão é <button> de verdade, não <div> com onclick: quem
 * navega por teclado ou leitor de tela precisa que ele se anuncie como ação.
 */
export function cartaoHtml(c) {
  return `
    <article class="pd-card" data-card="${esc(c.id)}">
      <div class="pd-card-topo">
        <div class="pd-ico"><i data-lucide="${c.icone}"></i></div>
        <div class="pd-card-txt">
          <h3 class="pd-titulo">${esc(c.titulo)}</h3>
          <div class="pd-data">${esc(c.data)}</div>
          <div class="pd-meta">
            ${esc(c.tipo)}<span class="pd-sep">·</span>${esc(c.formato)}${
              c.tamanho ? `<span class="pd-sep">·</span>${esc(c.tamanho)}` : ''}
          </div>
        </div>
        ${c.novo ? `<span class="pd-novo">Novo</span>` : ''}
      </div>
      <button type="button" class="pd-abrir" data-abrir="${esc(c.id)}"
              aria-label="Visualizar ${esc(c.titulo)}${c.novo ? ', ainda não visualizado' : ''}">
        <i data-lucide="external-link"></i> Visualizar
      </button>
    </article>`;
}

export function listaHtml(docs = []) {
  return agruparPorAno(docs).map(g => `
    ${g.ano ? `<h2 class="pd-ano">${esc(g.ano)}</h2>` : ''}
    <div class="pd-lista">
      ${g.itens.map(d => cartaoHtml(paraCartao(d))).join('')}
    </div>`).join('');
}

/** Três esqueletos: a tela tem forma conhecida, então o carregamento a mostra. */
export const skeletonHtml = (n = 3) =>
  `<div class="pd-lista">${'<div class="pd-sk"></div>'.repeat(n)}</div>`;

export function vazioHtml() {
  // Esta tela agora abre mesmo sem nenhum arquivo — Documentos é módulo
  // permanente, e o atalho do Início não some. Então o vazio não é um beco:
  // é a explicação do que vai acontecer ali.
  //
  // Sem botão: não há nada que o paciente possa fazer daqui para conseguir um
  // documento. Botão que não leva a lugar nenhum ensina a não tocar em nada.
  return `
    <div class="pa-empty pa-empty-lg">
      <i data-lucide="folder-open"></i>
      <div class="pa-empty-t">Nenhum documento por aqui ainda</div>
      <div class="pa-empty-s">Quando seu profissional compartilhar exames, relatórios ou outros arquivos, eles aparecerão aqui.</div>
    </div>`;
}

export function erroHtml() {
  return `
    <div class="pa-empty pa-empty-lg">
      <i data-lucide="cloud-off"></i>
      <div class="pa-empty-t">Não foi possível carregar seus documentos.</div>
      <button class="in-atalho in-atalho-forte" type="button" data-retry>
        <i data-lucide="rotate-cw"></i> Tentar novamente
      </button>
    </div>`;
}

export function cascaHtml() {
  return `
    <div class="pd">
      <header class="pd-head">
        <button type="button" class="pa-back" data-voltar aria-label="Voltar para o início">
          <i data-lucide="chevron-left"></i> Início
        </button>
        <h1 class="pd-h1">Documentos</h1>
        <p class="pd-sub">Arquivos compartilhados pelo seu profissional.</p>
      </header>
      <div data-corpo>${skeletonHtml()}</div>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// A TELA
// ───────────────────────────────────────────────────────────

export async function renderDocumentosPaciente(alvo, opcoes = {}) {
  const cx = typeof alvo === 'string' ? document.getElementById(alvo) : alvo;
  if (!cx) return;

  const carregar = opcoes.carregar || (() => meusDocumentos());
  const marcar = opcoes.marcar || marcarVisualizado;
  const assinar = opcoes.assinar || urlAssinada;
  const abrirUrl = opcoes.abrirUrl || ((url) => window.open(url, '_blank', 'noopener'));

  cx.innerHTML = cascaHtml();
  window.lucide?.createIcons?.();
  cx.querySelector('[data-voltar]')?.addEventListener('click', () => opcoes.aoVoltar?.());

  let docs = [];

  async function pintar() {
    const corpo = cx.querySelector('[data-corpo]');
    corpo.innerHTML = skeletonHtml();
    try {
      // A consulta não manda paciente_id: quem filtra é o RLS, pela sessão.
      // Documento privado, arquivado ou de outro paciente não chega aqui.
      docs = await carregar();
      corpo.innerHTML = docs.length ? listaHtml(docs) : vazioHtml();
      window.lucide?.createIcons?.();
      ligar(corpo);
      opcoes.aoCarregar?.(docs);
    } catch (e) {
      console.error('Documentos:', e);
      corpo.innerHTML = erroHtml();
      window.lucide?.createIcons?.();
      corpo.querySelector('[data-retry]')?.addEventListener('click', pintar);
    }
  }

  function ligar(corpo) {
    corpo.querySelectorAll('[data-abrir]').forEach(b =>
      b.addEventListener('click', () => abrir(b)));
  }

  /**
   * O caminho NÃO vem do DOM. O botão carrega só o id; o caminho sai do
   * registro que o RLS já autorizou. Fosse um atributo, bastaria editá-lo no
   * inspetor para pedir assinatura de qualquer arquivo do bucket.
   */
  async function abrir(botao) {
    const doc = docs.find(d => d.id === botao.dataset.abrir);
    if (!doc) return;

    botao.disabled = true;
    const rotulo = botao.innerHTML;
    botao.textContent = 'Abrindo...';
    try {
      // 1) a URL primeiro. Se o documento tiver sido removido do app enquanto
      //    a tela estava aberta, a policy do Storage recusa aqui — e nenhuma
      //    leitura é contada por um arquivo que não abriu.
      const url = await assinar(doc.caminho_storage);
      if (!url) throw new Error('sem_url');

      // 2) só então a leitura é registrada. Falhar aqui não impede de abrir:
      //    o paciente veio ver o exame, não alimentar a nossa métrica.
      try {
        await marcar(doc.id);
        doc.visualizado_pelo_paciente = true;
        // O selo some na hora, sem esperar recarga — e o banco já guardou.
        cx.querySelector(`[data-card="${CSS.escape(doc.id)}"] .pd-novo`)?.remove();
      } catch (e) { console.warn('Documentos · marcar:', e); }

      abrirUrl(url);
    } catch (e) {
      console.error('Documentos · abrir:', e);
      avisar(botao, 'Não foi possível abrir este documento.');
    } finally {
      botao.disabled = false;
      botao.innerHTML = rotulo;
      window.lucide?.createIcons?.();
    }
  }

  function avisar(botao, msg) {
    const card = botao.closest('.pd-card');
    if (!card) return;
    let box = card.querySelector('[data-aviso]');
    if (!box) {
      box = document.createElement('div');
      box.className = 'pd-aviso';
      box.setAttribute('data-aviso', '');
      // Leitor de tela anuncia sem precisar mover o foco.
      box.setAttribute('role', 'status');
      card.appendChild(box);
    }
    box.textContent = msg;
  }

  await pintar();
}
