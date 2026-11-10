// ═══════════════════════════════════════════════════════════
// BARRA FLUTUANTE RETRÁTIL — a regra pura e o contraste
// ═══════════════════════════════════════════════════════════
// O pior defeito é a barra presa escondida sem gesto para trazê-la de volta:
// toda dúvida se resolve MOSTRANDO. Estes testes cobrem a ordem das decisões
// de js/barra-retratil.js e o contraste dos tons sobre o vidro.

import { grupo, teste, ok, igual } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  decidir, estadoInicial, ehCampoDeTexto, tecladoAberto,
  PASSO_RECOLHER, PASSO_MOSTRAR, TOPO_SEMPRE_VISIVEL, FOLGA_FIM, BARRA_RETRATIL,
} from '../js/barra-retratil.js';

const MAX = 2000;   // página longa
// Rola em passos de 1px de `de` até `ate`, como o navegador entrega eventos.
const rolar = (estado, de, ate, extra = {}) => {
  let e = estado; const passo = ate > de ? 1 : -1;
  for (let y = de + passo; passo > 0 ? y <= ate : y >= ate; y += passo) e = decidir(e, { y, maximo: MAX, ...extra });
  return e;
};

grupo('barra retrátil · constantes e interruptor', () => {
  teste('as constantes pedidas', () => {
    igual([PASSO_RECOLHER, PASSO_MOSTRAR, TOPO_SEMPRE_VISIVEL, FOLGA_FIM], [16, 8, 64, 8]);
    igual(BARRA_RETRATIL, true);
  });
  teste('interruptor desligado: sempre visível', () => {
    const e = rolar({ ...estadoInicial(), y: 500 }, 500, 700, { retratil: false });
    igual(e.visivel, true);
  });
});

grupo('barra retrátil · a regra', () => {
  teste('página curta NUNCA esconde', () => {
    let e = { ...estadoInicial(), y: 0 };
    for (let y = 1; y <= 80; y++) e = decidir(e, { y, maximo: TOPO_SEMPRE_VISIVEL + PASSO_RECOLHER });
    igual(e.visivel, true);
  });

  teste('perto do topo e do fim, mostra', () => {
    const escondida = { visivel: false, y: 500, acumulado: 0 };
    igual(decidir(escondida, { y: 64, maximo: MAX }).visivel, true, 'y ≤ 64');
    igual(decidir(escondida, { y: MAX - 8, maximo: MAX }).visivel, true, 'y ≥ máximo − 8');
  });

  teste('ACUMULAR 16px PARA BAIXO ESCONDE (15 não)', () => {
    igual(rolar({ ...estadoInicial(), y: 500 }, 500, 515).visivel, true, '15px ainda mostra');
    igual(rolar({ ...estadoInicial(), y: 500 }, 500, 516).visivel, false, '16px esconde');
  });

  teste('8px PARA CIMA MOSTRA (7 não)', () => {
    const escondida = { visivel: false, y: 800, acumulado: 0 };
    igual(rolar(escondida, 800, 793).visivel, false, '7px ainda escondida');
    igual(rolar(escondida, 800, 792).visivel, true, '8px mostra');
  });

  teste('trocar de sentido zera o acumulado', () => {
    // 10 para baixo, 3 para cima, 10 para baixo: nunca chega a 16 seguidos.
    let e = rolar({ ...estadoInicial(), y: 500 }, 500, 510);
    e = rolar(e, 510, 507);
    e = rolar(e, 507, 517);
    igual(e.visivel, true, '10 + 10 com troca no meio não são 16 seguidos');
    e = rolar(e, 517, 523);
    igual(e.visivel, false, 'agora sim 16 seguidos');
  });

  teste('PROTEGIDA SEMPRE MOSTRA (campo de texto, teclado, foco na barra)', () => {
    const escondida = { visivel: false, y: 800, acumulado: 0 };
    igual(decidir(escondida, { y: 900, maximo: MAX, protegida: true }).visivel, true);
  });

  teste('travada (modal/bottom sheet) não muda nada', () => {
    const e = { visivel: false, y: 800, acumulado: 5 };
    igual(decidir(e, { y: 300, maximo: MAX, travada: true }), e);
    const v = { visivel: true, y: 800, acumulado: 0 };
    igual(decidir(v, { y: 1200, maximo: MAX, travada: true }), v);
  });

  teste('protegida vence travada (a ordem importa)', () => {
    const e = { visivel: false, y: 800, acumulado: 0 };
    igual(decidir(e, { y: 900, maximo: MAX, protegida: true, travada: true }).visivel, true);
  });

  teste('salto elástico do iOS (y fora de [0, máximo]) é ignorado', () => {
    const e = { visivel: false, y: 800, acumulado: 0 };
    igual(decidir(e, { y: -40, maximo: MAX }), e, 'acima do topo');
    igual(decidir(e, { y: MAX + 30, maximo: MAX }), e, 'abaixo do fim');
  });

  teste('mesmo y não muda o acumulado', () => {
    const e = { visivel: true, y: 500, acumulado: 10 };
    igual(decidir(e, { y: 500, maximo: MAX }), e);
  });

  teste('em qualquer posição do meio, um gesto para cima traz a barra de volta', () => {
    for (const y of [100, 700, 1500, MAX - 20]) {
      const escondida = { visivel: false, y, acumulado: 0 };
      ok(rolar(escondida, y, y - PASSO_MOSTRAR).visivel, `presa escondida em y=${y}`);
    }
  });
});

grupo('barra retrátil · campo de texto e teclado', () => {
  const el = (tag, attrs = {}) => ({ tagName: tag.toUpperCase(), type: attrs.type, isContentEditable: !!attrs.ce, getAttribute: k => (k === 'contenteditable' ? (attrs.ce ? 'true' : null) : null) });
  teste('abre teclado: input de texto, textarea, select, contenteditable', () => {
    for (const t of ['text', 'email', 'number', 'search', 'tel', 'password', undefined]) ok(ehCampoDeTexto(el('input', { type: t })), `input ${t}`);
    ok(ehCampoDeTexto(el('textarea')));
    ok(ehCampoDeTexto(el('select')));
    ok(ehCampoDeTexto(el('div', { ce: true })));
  });
  teste('NÃO abre teclado: checkbox, radio, botão, arquivo, faixa, cor', () => {
    for (const t of ['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color']) ok(!ehCampoDeTexto(el('input', { type: t })), `input ${t}`);
    ok(!ehCampoDeTexto(el('button')));
    ok(!ehCampoDeTexto(null));
  });
  teste('teclado aberto = viewport visual perdeu mais de 150px', () => {
    igual(tecladoAberto({ innerHeight: 800, vvHeight: 500, vvOffsetTop: 0 }), true);
    igual(tecladoAberto({ innerHeight: 800, vvHeight: 700, vvOffsetTop: 0 }), false, 'barra do navegador não é teclado');
    igual(tecladoAberto({ innerHeight: 800, vvHeight: 640, vvOffsetTop: 10 }), false);
    igual(tecladoAberto({ innerHeight: 800, vvHeight: 0 }), false, 'sem visualViewport, não decide');
  });
});

// ── Contraste: os tons da barra sobre o VIDRO, inclusive sobre preto ──
grupo('barra retrátil · contraste sobre o vidro', () => {
  const tokens = readFileSync(new URL('../css/tokens.css', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  const hexDe = nome => (tokens.match(new RegExp(`${nome}:\\s*(#[0-9A-Fa-f]{6})`)) || [])[1];
  const rgb = h => h.slice(1).match(/\w\w/g).map(x => parseInt(x, 16));
  const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const mistura = (topo, a, base) => topo.map((v, i) => Math.round(v * a + base[i] * (1 - a)));
  const razao = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const superficie = rgb(hexDe('--surface'));
  const vidroPreto = mistura(superficie, 0.7, [0, 0, 0]);       // pior caso
  const vidroBranco = mistura(superficie, 0.7, [255, 255, 255]);
  const pilula = mistura(rgb(hexDe('--color-primary-600')), 0.16, vidroPreto);

  const ativo = rgb(hexDe('--color-primary-800'));
  const inativo = rgb(hexDe('--text-primary'));   // --ink

  teste('a barra usa estes tokens (e não os da barra antiga)', () => {
    const css = shell.replace(/\/\*[\s\S]*?\*\//g, '');
    ok(/\.pa-barra-item \{[^}]*color: var\(--ink\)/.test(css), 'inativo = --ink');
    ok(/\.pa-barra-item\.ativo \{[^}]*color: var\(--color-primary-800\)/.test(css), 'ativo = --color-primary-800');
  });

  teste('INATIVO passa de 4,5:1 sobre vidro claro e sobre preto', () => {
    ok(razao(inativo, vidroBranco) >= 4.5, `sobre branco ${razao(inativo, vidroBranco).toFixed(2)}`);
    ok(razao(inativo, vidroPreto) >= 4.5, `sobre preto ${razao(inativo, vidroPreto).toFixed(2)}`);
  });

  teste('ATIVO passa de 4,5:1 sobre vidro, sobre preto e sobre a pílula', () => {
    ok(razao(ativo, vidroBranco) >= 4.5, `sobre branco ${razao(ativo, vidroBranco).toFixed(2)}`);
    ok(razao(ativo, vidroPreto) >= 4.5, `sobre preto ${razao(ativo, vidroPreto).toFixed(2)}`);
    ok(razao(ativo, pilula) >= 4.5, `sobre a pílula ${razao(ativo, pilula).toFixed(2)}`);
  });

  teste('os tons da barra antiga reprovariam no vidro (por isso trocaram)', () => {
    ok(razao(rgb(hexDe('--text-muted')), vidroPreto) < 4.5, 'o cinza antigo reprova');
    ok(razao(rgb(hexDe('--color-primary-700')), vidroPreto) < 4.5, 'o verde antigo reprova');
  });
});
