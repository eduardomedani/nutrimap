// ═══════════════════════════════════════════════════════════
// MODO APRESENTAÇÃO — "Apresentar Evolução"
// ═══════════════════════════════════════════════════════════
// Tela cheia por cima do painel, para usar DURANTE a consulta: o profissional
// avança enquanto conversa, e o paciente só vê a própria história.
//
// Este arquivo é o motor — overlay, navegação, foco e transição. Ele não sabe
// desenhar nenhum slide: cada slide é um módulo com o contrato de
// apresentacao-slides.js. É o que impede isto aqui de virar um arquivo de
// 3.000 linhas.
//
// z-index 9000: acima de tudo que é tela (sidebar 100, modais 1000), abaixo de
// toast (10000) e confirmar() (10001) — que precisam funcionar POR CIMA da
// apresentação.

import { carregarDados, montarDados } from './apresentacao-dados.js';
import { slidesDisponiveis } from './apresentacao-slides.js';
import { mostrarErro } from './utils.js';

let _el = null;          // overlay montado
let _d = null;           // dados do deck
let _slides = [];        // slides disponíveis para ESTE paciente
let _i = 0;              // índice do slide corrente
let _origem = null;      // elemento que abriu (recebe o foco de volta)
let _onTecla = null;

const menosMovimento = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/**
 * Abre a apresentação de um paciente. Carrega os dados uma vez.
 * @param {object} paciente
 * @param {{origem?: Element}} opts
 */
export async function abrirApresentacao(paciente, { origem = null } = {}) {
  if (_el) return;                                  // já aberta
  _origem = origem || document.activeElement;

  montarOverlay();
  try {
    _d = await carregarDados(paciente);
  } catch (e) {
    console.error('[apresentacao]', e);
    fechar();
    mostrarErro('Não foi possível carregar a evolução: ' + (e.message || e));
    return;
  }

  _slides = slidesDisponiveis(_d);
  if (!_slides.length) {
    fechar();
    mostrarErro('Ainda não há avaliações suficientes para apresentar a evolução.');
    return;
  }

  _i = 0;
  _sessao.acoes = '';                               // cada consulta começa limpa
  desenharEstrutura();
  mostrarSlide(0, { animar: false });
}

/** Fecha e devolve a tela ao estado anterior. */
export function fecharApresentacao() { fechar(); }

// ── Overlay ─────────────────────────────────────────────────
function montarOverlay() {
  _el = document.createElement('div');
  _el.className = 'ap';
  _el.setAttribute('role', 'application');
  _el.setAttribute('aria-label', 'Apresentação da evolução');
  _el.innerHTML = `<div class="ap-carregando"><div class="spinner"></div></div>`;
  document.body.appendChild(_el);
  document.body.classList.add('ap-aberto');         // trava a rolagem de trás

  _onTecla = (e) => aoTeclar(e);
  document.addEventListener('keydown', _onTecla, true);
  _el.addEventListener('pointerdown', aoTocar);
  _el.focus?.();
}

function fechar() {
  if (_onTecla) document.removeEventListener('keydown', _onTecla, true);
  _onTecla = null;
  _el?.remove();
  _el = null;
  _d = null;
  _slides = [];
  _i = 0;
  document.body.classList.remove('ap-aberto');
  // O foco volta para o botão que abriu — quem navega por teclado não perde o lugar.
  try { _origem?.focus?.(); } catch {}
  _origem = null;
}

function desenharEstrutura() {
  _el.innerHTML = `
    <button class="ap-sair" data-ap-sair aria-label="Sair da apresentação (Esc)">
      <i data-lucide="x"></i>
    </button>

    <button class="ap-seta ap-seta-ant" data-ap-ant aria-label="Slide anterior">
      <i data-lucide="chevron-left"></i>
    </button>
    <button class="ap-seta ap-seta-prox" data-ap-prox aria-label="Próximo slide">
      <i data-lucide="chevron-right"></i>
    </button>

    <main class="ap-palco" data-ap-palco aria-live="polite"></main>

    <footer class="ap-rodape">
      <div class="ap-pontos" role="tablist" aria-label="Slides">
        ${_slides.map((s, i) => `
          <button class="ap-ponto" data-ap-ir="${i}" role="tab"
            aria-selected="${i === 0}" title="${esc(s.titulo)}">
            <span class="sr-only">${esc(s.titulo)}</span>
          </button>`).join('')}
      </div>
      <div class="ap-contador"><span data-ap-n>1</span> / ${_slides.length}</div>
    </footer>`;

  _el.querySelector('[data-ap-sair]').addEventListener('click', () => fechar());
  _el.querySelector('[data-ap-ant]').addEventListener('click', () => anterior());
  _el.querySelector('[data-ap-prox]').addEventListener('click', () => proximo());
  _el.querySelectorAll('[data-ap-ir]').forEach(b =>
    b.addEventListener('click', () => ir(Number(b.dataset.apIr))));
}

// ── Navegação ───────────────────────────────────────────────
function ir(n, opts = {}) {
  if (!_el || !_slides.length) return;
  const alvo = Math.max(0, Math.min(_slides.length - 1, n));
  if (alvo === _i && !opts.forcar) return;
  const sentido = alvo > _i ? 1 : -1;
  _i = alvo;
  mostrarSlide(alvo, { sentido, ...opts });
}
const proximo  = () => ir(_i + 1);
const anterior = () => ir(_i - 1);

/**
 * Só o slide corrente vive no DOM. Nove gráficos SVG simultâneos custam caro e
 * ninguém olha oito deles.
 */
function mostrarSlide(n, { sentido = 1, animar = true } = {}) {
  const palco = _el?.querySelector('[data-ap-palco]');
  const slide = _slides[n];
  if (!palco || !slide) return;

  const el = document.createElement('section');
  el.className = 'ap-slide';
  if (animar && !menosMovimento()) el.classList.add(sentido >= 0 ? 'entra-dir' : 'entra-esq');
  el.dataset.slide = slide.id;
  el.innerHTML = slide.html(_d);

  palco.innerHTML = '';
  palco.appendChild(el);

  slide.ligar?.(el, _d, api);
  // aoEntrar dispara as animações depois do nó estar no documento —
  // barras crescendo e números contando precisam de um layout válido antes.
  requestAnimationFrame(() => slide.aoEntrar?.(el, _d, api));

  atualizarCromo(n);
}

function atualizarCromo(n) {
  _el.querySelectorAll('[data-ap-ir]').forEach((b, i) => {
    const ativo = i === n;
    b.classList.toggle('ativo', ativo);
    b.setAttribute('aria-selected', String(ativo));
  });
  const cont = _el.querySelector('[data-ap-n]');
  if (cont) cont.textContent = String(n + 1);
  _el.querySelector('[data-ap-ant]').disabled = n === 0;
  _el.querySelector('[data-ap-prox]').disabled = n === _slides.length - 1;
}

/**
 * Trocar a avaliação "atual" (slide da linha do tempo) remonta os dados
 * derivados sem tocar na rede: montarDados é puro.
 */
function trocarAvaliacao(id) {
  if (!_d || id === _d.idAtual) return;
  _d = montarDados(_d.paciente, _d.resumo, _d.metas, id);
  mostrarSlide(_i, { animar: false, sentido: 1 });
}

// O que o profissional digita DURANTE a apresentação (as próximas ações).
// Fica fora de `_d` de propósito: `montarDados` é puro e recria o deck a cada
// troca de avaliação — o que foi escrito na consulta não pode evaporar junto.
let _sessao = { acoes: '' };

const api = {
  ir, proximo, anterior,
  sair: () => fechar(),
  trocarAvaliacao,
  get dados() { return _d; },
  sessao: _sessao,
};

// ── Teclado ─────────────────────────────────────────────────
function aoTeclar(e) {
  if (!_el) return;
  // Digitando num campo (as "próximas ações" do slide de objetivos), as setas
  // são do cursor, não da apresentação.
  const alvo = e.target;
  const digitando = alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable);

  if (e.key === 'Escape') { e.preventDefault(); fechar(); return; }
  if (digitando) return;

  switch (e.key) {
    case 'ArrowRight': case 'PageDown': case ' ': case 'Spacebar':
      e.preventDefault(); proximo(); break;
    case 'ArrowLeft': case 'PageUp':
      e.preventDefault(); anterior(); break;
    case 'Home': e.preventDefault(); ir(0); break;
    case 'End':  e.preventDefault(); ir(_slides.length - 1); break;
  }
}

// ── Gesto no tablet ─────────────────────────────────────────
// Swipe horizontal. Ignora o gesto que começa num controle — arrastar de
// dentro de um botão da linha do tempo não deve virar troca de slide.
const LIMIAR = 60;
let _toque = null;

function aoTocar(e) {
  if (e.pointerType === 'mouse') return;
  if (e.target.closest('button, a, input, textarea, select')) return;
  _toque = { x: e.clientX, y: e.clientY };
  const fim = (ev) => {
    _el?.removeEventListener('pointerup', fim);
    _el?.removeEventListener('pointercancel', fim);
    if (!_toque) return;
    const dx = ev.clientX - _toque.x;
    const dy = ev.clientY - _toque.y;
    _toque = null;
    if (Math.abs(dx) < LIMIAR || Math.abs(dx) < Math.abs(dy)) return;   // rolagem vertical
    if (dx < 0) proximo(); else anterior();
  };
  _el.addEventListener('pointerup', fim);
  _el.addEventListener('pointercancel', fim);
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
