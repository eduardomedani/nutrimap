// ═══════════════════════════════════════════════════════════
// SONDA TEMPORÁRIA DO RODAPÉ — para onde vão os pixels abaixo dos rótulos
// ═══════════════════════════════════════════════════════════
// TEMPORÁRIA. Existe para responder UMA pergunta, medida no iPhone real em
// standalone, e sai inteira depois — este arquivo e a linha que o carrega no
// app.html:
//
//   dos pixels entre o fim de "Início / Treino / Dieta" e o fim FÍSICO da
//   tela, quantos são (A) conteúdo da nav, (B) safe-area e (C) a faixa que o
//   iOS deixa fora da viewport de layout?
//
// NÃO MUDA O LAYOUT. Não escreve variável, classe nem regra do app. Tudo o que
// desenha é `position: fixed` com `pointer-events: none`, criado ao abrir e
// removido ao fechar. A única pintura em algo que já existe é o fundo do
// <body>, e é de propósito: ele é o ÚNICO que pinta a faixa C — provado pela
// sonda magenta de 99e62d7 —, então é o único jeito de enxergá-la. O valor
// anterior volta ao fechar.
//
// AS TRÊS LIÇÕES DA SONDA ANTERIOR, que custaram um deploy cada:
//   · o gesto é `pointerup` em CAPTURE, não `click`: o iOS atrasa ou engole
//     cliques repetidos num elemento que não é botão (37b515f);
//   · o painel é `pointer-events: none`: ele cobre a topbar e, sem isso,
//     engolia os toques no logo que o fecham — quem abria ficava preso (68f7ccd);
//   · sem persistência e sem reload: o painel dura a sessão (68f7ccd).
//
// A seleção do texto "Evollo", que também matava o gesto, é barrada aqui por
// `selectstart` no próprio logo, e não por CSS: esta sonda não pode depender de
// regra nenhuma no <style> do app, porque o layout não está em discussão.
//
// Liga e desliga com CINCO TOQUES no logo "Evollo" da topbar.

const COR_A = 'rgba(40, 120, 255, .30)';   // conteúdo da nav
const COR_B = 'rgba(255, 150, 0, .45)';    // safe-area (padding de baixo da nav)
const COR_C = '#FF00C8';                   // faixa fora da viewport (fundo do body)

let painel = null, faixaA = null, faixaB = null, linha = null, sondaEnv = null;
let tique = null, fundoAntes = '';

const px = (n) => (Math.round(n * 10) / 10).toFixed(1);

// O inset lido DIRETO da fonte, num <div> 0x0 e invisível, em vez de deduzido
// do padding da barra — a barra usa `max(10px, env(...))`, e é justamente a
// diferença entre os dois que interessa.
function envBottom() {
  if (!sondaEnv) {
    sondaEnv = document.createElement('div');
    sondaEnv.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;'
      + 'pointer-events:none;padding-bottom:env(safe-area-inset-bottom, 0px)';
    document.body.appendChild(sondaEnv);
  }
  return parseFloat(getComputedStyle(sondaEnv).paddingBottom) || 0;
}

function faixa(cor, z) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:0;right:0;z-index:${z};pointer-events:none;background:${cor}`;
  document.body.appendChild(el);
  return el;
}

function posicionar(el, topo, altura) {
  el.style.top = `${topo}px`;
  el.style.height = `${Math.max(0, altura)}px`;
}

function medir() {
  const nav = document.querySelector('.pa-bottomnav');
  if (!nav) return null;

  const n = nav.getBoundingClientRect();
  const cs = getComputedStyle(nav);
  const padB = parseFloat(cs.paddingBottom) || 0;
  const borda = parseFloat(cs.borderTopWidth) || 0;
  const conteudoFim = n.bottom - padB;

  // O fim do RÓTULO é o último pixel de conteúdo de verdade. É o maior entre os
  // três, para um rótulo mais alto não esconder folga embaixo dos outros.
  let rotuloFim = -Infinity;
  nav.querySelectorAll('.pa-nav-item span').forEach((s) => {
    rotuloFim = Math.max(rotuloFim, s.getBoundingClientRect().bottom);
  });
  const item = nav.querySelector('.pa-nav-item');
  const vv = window.visualViewport;

  return {
    secao: nav.querySelector('.pa-nav-item.active span')?.textContent?.trim() || '?',
    standalone: !!navigator.standalone || matchMedia('(display-mode: standalone)').matches,
    innerH: innerHeight,
    vvH: vv ? vv.height : NaN,
    vvTop: vv ? vv.offsetTop : NaN,
    tela: screen.height,
    env: envBottom(),
    navTop: n.top,
    navBottom: n.bottom,
    padB,
    borda,
    itemH: item ? item.getBoundingClientRect().height : NaN,
    conteudoFim,
    rotuloFim,
  };
}

function ler() {
  if (!painel) return;
  const m = medir();
  if (!m) {
    painel.textContent = 'SONDA DO RODAPÉ\nnav ainda não montada nesta tela\n· 5 toques no logo fecham';
    [faixaA, faixaB, linha].forEach((el) => posicionar(el, 0, 0));
    return;
  }

  // A decomposição, de cima para baixo. Somam, por construção, a distância do
  // fim do rótulo até o fim da tela — o que cada parcela diz é QUEM é dono de
  // cada trecho, e é essa a pergunta.
  const A = m.conteudoFim - m.rotuloFim;         // nav, abaixo do rótulo
  const B = m.navBottom - m.conteudoFim;         // safe-area (padding da nav)
  const vao = m.innerH - m.navBottom;            // entre a nav e o fim da viewport
  const C = m.tela - m.innerH;                   // fora da viewport de layout
  const total = m.tela - m.rotuloFim;

  posicionar(faixaA, m.navTop, m.conteudoFim - m.navTop);
  posicionar(faixaB, m.conteudoFim, B);
  posicionar(linha, m.rotuloFim, 2);

  const piso = Math.max(10, m.env);
  painel.textContent =
    `SONDA DO RODAPÉ · tela ${m.secao} · standalone ${m.standalone ? 'SIM' : 'não'}\n` +
    `innerHeight             ${px(m.innerH)}\n` +
    `visualViewport.height   ${px(m.vvH)}   offsetTop ${px(m.vvTop)}\n` +
    `screen.height           ${px(m.tela)}\n` +
    `safe-area-inset-bottom  ${px(m.env)}   (env, lido direto)\n` +
    `nav top / bottom        ${px(m.navTop)} / ${px(m.navBottom)}\n` +
    `navContentHeight        ${px(m.conteudoFim - m.navTop)}   (item ${px(m.itemH)} + borda ${px(m.borda)})\n` +
    `fim do rótulo           ${px(m.rotuloFim)}\n` +
    `safe-area               ${px(m.conteudoFim)} → ${px(m.navBottom)}   (${px(B)})\n` +
    `  padding da nav ${px(m.padB)}  = max(10, env ${px(m.env)}) = ${px(piso)}  ${Math.abs(m.padB - piso) < 0.5 ? 'ok' : 'DIVERGE'}\n` +
    `faixa fora da viewport  ${px(C)}   (screen − innerHeight)\n` +
    `────────────────────────────────────────────\n` +
    `do fim do rótulo ao fim da tela: ${px(total)}\n` +
    `  A  nav, abaixo do rótulo    ${px(A).padStart(6)}   azul\n` +
    `  B  safe-area                ${px(B).padStart(6)}   laranja\n` +
    `     vão nav → fim viewport   ${px(vao).padStart(6)}\n` +
    `  C  faixa externa            ${px(C).padStart(6)}   magenta\n` +
    `· linha vermelha = fim do rótulo · 5 toques no logo fecham`;
}

function abrir() {
  if (painel) return;
  painel = document.createElement('pre');
  // `pointer-events: none` NÃO é detalhe — ver o cabeçalho. O painel cobre o
  // logo, e os toques que o fecham precisam atravessá-lo.
  painel.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;margin:0;'
    + 'padding:max(6px, env(safe-area-inset-top, 0px)) 8px 6px;background:rgba(14,26,22,.93);'
    + 'color:#7EE2C3;font:10.5px/1.35 ui-monospace,Menlo,monospace;white-space:pre-wrap;'
    + 'pointer-events:none';
  faixaA = faixa(COR_A, 99997);
  faixaB = faixa(COR_B, 99997);
  linha = faixa('#FF2A2A', 99998);
  document.body.appendChild(painel);

  fundoAntes = document.body.style.background;
  document.body.style.background = COR_C;

  tique = setInterval(ler, 400);
  ler();
}

function fechar() {
  if (!painel) return;
  clearInterval(tique);
  [painel, faixaA, faixaB, linha, sondaEnv].forEach((el) => el && el.remove());
  document.body.style.background = fundoAntes;
  painel = faixaA = faixaB = linha = sondaEnv = null;
  tique = null;
}

const noLogo = (alvo) => {
  const el = alvo && alvo.nodeType === 3 ? alvo.parentElement : alvo;
  return !!(el && el.closest && el.closest('.pa-topbrand'));
};

// `pointerup` em capture: chega antes de o iOS decidir se aquilo é zoom ou
// seleção, e não depende de nenhum handler da tela deixar o evento subir.
const EVENTO = window.PointerEvent ? 'pointerup' : ('ontouchend' in window ? 'touchend' : 'click');
let toques = 0, ultimo = 0;

document.addEventListener(EVENTO, (e) => {
  if (!noLogo(e.target)) return;
  const agora = Date.now();
  // 1200ms entre toques: 800 exigia uma cadência que o dedo não sustenta.
  toques = agora - ultimo < 1200 ? toques + 1 : 1;
  ultimo = agora;
  if (toques < 5) return;
  toques = 0;
  if (painel) fechar(); else abrir();
}, true);

document.addEventListener('selectstart', (e) => {
  if (noLogo(e.target)) e.preventDefault();
}, true);
