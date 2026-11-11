// ═══════════════════════════════════════════════════════════
// BARRA FLUTUANTE RETRÁTIL do app do aluno — a regra e quem a liga
// ═══════════════════════════════════════════════════════════
// Some ao rolar para baixo, volta ao rolar para cima. A REGRA é uma função
// pura (`decidir`), testada sem DOM em test/barra-retratil.test.mjs. O resto do
// arquivo só liga essa regra aos eventos do navegador.
//
// PRINCÍPIO: o pior defeito é a barra presa escondida sem gesto para trazê-la
// de volta. Toda dúvida se resolve MOSTRANDO.
//
// No Evollo quem rola é o MIOLO (`.pa-main`, dentro da casca fixa), não a
// janela — foi assim que o iOS deixou de errar a viewport (ver A CASCA em
// app.html). Então a rolagem ouvida é a do miolo.

// Interruptor de reversão rápida: false = barra sempre visível.
export const BARRA_RETRATIL = true;

export const PASSO_RECOLHER = 16;        // px rolados para baixo, acumulados, para esconder
export const PASSO_MOSTRAR = 8;          // px rolados para cima, acumulados, para mostrar
export const TOPO_SEMPRE_VISIVEL = 64;   // perto do topo: sempre visível
export const FOLGA_FIM = 8;              // perto do fim: sempre visível
export const TECLADO_LIMIAR = 150;       // px de viewport "comidos" = teclado aberto

export const estadoInicial = () => ({ visivel: true, y: 0, acumulado: 0 });

/**
 * Próximo estado para um novo deslocamento `y`. Ordem das decisões:
 *   1. protegida (campo de texto com foco, teclado, foco de teclado na barra) → MOSTRA
 *   2. travada (fundo travado por modal/bottom sheet)                        → mantém
 *   3. página curta                                                          → MOSTRA
 *   4. y fora de [0, máximo] (salto elástico do iOS)                         → mantém
 *   5. perto do topo ou do fim                                               → MOSTRA
 *   6. acumula no mesmo sentido (zera ao trocar): ≥ +16 esconde; ≤ −8 mostra
 */
export function decidir(estado, { y, maximo, protegida = false, travada = false, retratil = BARRA_RETRATIL }) {
  const mostra = () => ({ visivel: true, y, acumulado: 0 });
  if (!retratil) return mostra();
  if (protegida) return mostra();
  if (travada) return estado;
  if (maximo <= TOPO_SEMPRE_VISIVEL + PASSO_RECOLHER) return mostra();
  if (y < 0 || y > maximo) return estado;
  if (y <= TOPO_SEMPRE_VISIVEL || y >= maximo - FOLGA_FIM) return mostra();

  const delta = y - estado.y;
  if (delta === 0) return { ...estado, y };
  const mesmoSentido = estado.acumulado === 0 || Math.sign(delta) === Math.sign(estado.acumulado);
  const acumulado = mesmoSentido ? estado.acumulado + delta : delta;
  if (acumulado >= PASSO_RECOLHER) return { visivel: false, y, acumulado: 0 };
  if (acumulado <= -PASSO_MOSTRAR) return { visivel: true, y, acumulado: 0 };
  return { visivel: estado.visivel, y, acumulado };
}

// Campo que abre teclado. Checkbox e botão não abrem — não seguram a barra.
const SEM_TECLADO = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image', 'hidden']);
export function ehCampoDeTexto(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') return !SEM_TECLADO.has(String(el.type || 'text').toLowerCase());
  return !!el.isContentEditable || el.getAttribute?.('contenteditable') === 'true' || el.getAttribute?.('contenteditable') === '';
}

/** Teclado virtual aberto: a viewport visual perdeu mais que o limiar. */
export function tecladoAberto({ innerHeight, vvHeight, vvOffsetTop = 0 }) {
  if (!vvHeight) return false;
  return innerHeight - vvHeight - vvOffsetTop > TECLADO_LIMIAR;
}

/**
 * O teclado está (ou vai estar) na tela?
 *
 * A medida da viewport sozinha NÃO basta (11/11/2026): no iPhone em modo app
 * — e com `interactive-widget=resizes-content` — a janela e a viewport visual
 * encolhem JUNTAS, a diferença fica zero e o teclado nunca era percebido. A
 * barra e o "Finalizar treino" ficavam por cima do campo de peso/repetições.
 * Num aparelho de toque, campo de texto com foco = teclado aberto.
 */
export function tecladoProvavel({ medido = false, campoFocado = false, toque = false }) {
  return medido || (campoFocado && toque);
}

// ── A parte que liga a regra aos eventos (navegador) ─────────
// O estado vive em CLASSES DO <body>, não na <nav>: cada tela do app
// redesenha o HTML inteiro, e a barra nova herda o estado sem piscar.
//   body.pa-barra-recolhida  → translateY para fora + pointer-events: none
//   body.pa-teclado          → a barra não aparece (no iPhone ela flutuaria
//                              no meio da tela, presa à viewport de layout)
let _estado = estadoInicial();
let _ligada = false;
let _largura = 0;

function aplicar(visivel) {
  document.body.classList.toggle('pa-barra-recolhida', !visivel);
}

function barra() { return document.querySelector('.pa-barra'); }

/** Trocar de rota, girar a tela: a barra volta. */
export function mostrarBarra() {
  _estado = { ..._estado, visivel: true, acumulado: 0 };
  if (typeof document !== 'undefined') aplicar(true);
}

/**
 * Liga a barra UMA vez. `obterRolador()` devolve o elemento que rola agora
 * (o `.pa-main` da tela atual, que muda a cada render).
 */
export function ligarBarraRetratil({ obterRolador }) {
  if (_ligada || typeof window === 'undefined') return;
  _ligada = true;
  _largura = window.innerWidth;

  const vv = window.visualViewport;
  // Aparelho de toque (dedo, não mouse): é onde existe teclado virtual.
  const toque = () => !!window.matchMedia?.('(pointer: coarse)')?.matches;
  let teclado = false;
  const medirTeclado = () => {
    const medido = vv ? tecladoAberto({ innerHeight: window.innerHeight, vvHeight: vv.height, vvOffsetTop: vv.offsetTop }) : false;
    const agora = tecladoProvavel({ medido, campoFocado: ehCampoDeTexto(document.activeElement), toque: toque() });
    if (agora !== teclado) { teclado = agora; document.body.classList.toggle('pa-teclado', teclado); }
  };

  // O campo que ganhou foco vai para o MEIO do que sobra de tela: com a
  // barra e o "Finalizar" fora, ele não pode ficar atrás do teclado. Espera o
  // teclado terminar de subir (iOS anima ~250ms).
  document.addEventListener('focusin', e => {
    if (!toque() || !ehCampoDeTexto(e.target)) return;
    setTimeout(() => {
      if (document.activeElement === e.target) e.target.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }, 320);
  });

  const reavaliar = () => {
    const r = obterRolador();
    if (!r) { mostrarBarra(); return; }
    medirTeclado();
    const ativo = document.activeElement;
    const b = barra();
    const focoNaBarra = !!(b && ativo && b.contains(ativo) && ativo.matches?.(':focus-visible'));
    const protegida = teclado || ehCampoDeTexto(ativo) || focoNaBarra;
    const travada = [...document.body.classList].some(c => c.endsWith('-travado'));
    const novo = decidir(_estado, { y: r.scrollTop, maximo: r.scrollHeight - r.clientHeight, protegida, travada });
    if (novo.visivel !== _estado.visivel) aplicar(novo.visivel);
    _estado = novo;
  };

  // Só a rolagem do MIOLO (scroll não borbulha: captura no document e filtra).
  document.addEventListener('scroll', e => { if (e.target === obterRolador()) reavaliar(); }, { capture: true, passive: true });
  window.addEventListener('resize', () => {
    // Largura mudou (giro, aparelho dobrável): mostra. Só a altura (barra do
    // navegador): reavalia.
    if (window.innerWidth !== _largura) { _largura = window.innerWidth; mostrarBarra(); }
    else reavaliar();
  });
  document.addEventListener('focusin', reavaliar);
  // No focusout o foco ainda não chegou ao destino: espera um tique.
  document.addEventListener('focusout', () => setTimeout(reavaliar, 0));
  if (vv) { vv.addEventListener('resize', reavaliar); vv.addEventListener('scroll', reavaliar); }

  // Conteúdo que encolhe (um filtro, uma lista que carregou menor) pode fazer a
  // página parar de rolar SEM evento de scroll. Observa o app e reavalia.
  let agendado = false;
  const observar = () => { if (agendado) return; agendado = true; requestAnimationFrame(() => { agendado = false; reavaliar(); }); };
  const raiz = document.getElementById('app');
  if (raiz && 'MutationObserver' in window) new MutationObserver(observar).observe(raiz, { childList: true, subtree: true });
  if ('ResizeObserver' in window && raiz) new ResizeObserver(observar).observe(raiz);
}
