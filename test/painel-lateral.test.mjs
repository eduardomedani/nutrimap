// ═══════════════════════════════════════════════════════════
// MENU LATERAL EM VERDE PROFUNDO — tokens e contraste
// ═══════════════════════════════════════════════════════════
// Os tons são misturas (color-mix) do branco de texto com o fundo 800. O
// teste refaz a mistura e mede o contraste WCAG de cada papel.

import { grupo, teste, ok, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';

const ler = rel => readFileSync(new URL(rel, import.meta.url), 'utf8');
const tokens = ler('../css/tokens.css');
const hex = nome => (tokens.match(new RegExp(`${nome}:\\s*(#[0-9A-Fa-f]{6})`)) || [])[1];
const rgb = h => h.slice(1).match(/\w\w/g).map(x => parseInt(x, 16));
const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const razao = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mistura = (a, pa, b) => a.map((v, i) => Math.round(v * pa + b[i] * (1 - pa)));
const pct = nome => Number((tokens.match(new RegExp(`${nome}:\\s*color-mix\\(in srgb, [^ ]+ (\\d+)%`)) || [])[1]) / 100;

const fundo = rgb(hex('--color-primary-800'));
const branco = rgb(hex('--text-on-primary'));
const tom = nome => mistura(branco, pct(nome), fundo);

grupo('menu lateral · tokens', () => {
  teste('o fundo é o verde profundo da escala (800), não um hex novo', () => {
    contem(tokens, '--sidebar-bg:        var(--color-primary-800);');
  });
  teste('a folha da lateral só usa tokens (nenhum hex)', () => {
    const css = ler('../css/painel-lateral.css').replace(/\/\*[\s\S]*?\*\//g, '');
    ok(!/#[0-9A-Fa-f]{3,6}\b/.test(css), 'hex solto em painel-lateral.css');
  });
});

grupo('menu lateral · contraste sobre o verde', () => {
  teste('texto e texto suave ≥ 4,5:1', () => {
    for (const n of ['--sidebar-fg', '--sidebar-fg-soft', '--sidebar-fg-mute']) {
      const r = razao(tom(n), fundo);
      ok(r >= 4.5, `${n}: ${r.toFixed(2)}`);
    }
  });
  teste('item ativo: texto branco sobre a superfície ativa ≥ 4,5:1', () => {
    const ativo = mistura(rgb(hex('--color-primary-500')), 0.24, fundo);
    const r = razao(branco, ativo);
    ok(r >= 4.5, `ativo ${r.toFixed(2)}`);
  });
  teste('"em breve" (desabilitado) ainda legível (≥ 3:1)', () => {
    const r = razao(tom('--sidebar-fg-off'), fundo);
    ok(r >= 3, `off ${r.toFixed(2)}`);
  });
  teste('o verde de ação (600) não pinta a lateral', () => {
    naoContem(ler('../css/painel-lateral.css'), 'color-primary-600');
  });
});

// ── Grupos que recolhem e expandem (11/11/2026) ──────────────
import { lerRecolhidos, alternar } from '../js/menu-lateral.js';

grupo('menu lateral · grupos recolhíveis', () => {
  const css = ler('../css/painel-lateral.css');
  teste('o título tem o mesmo tamanho dos itens (14px), sem caixa alta', () => {
    contem(css, 'font-size: 14px; text-transform: none; letter-spacing: 0;');
    contem(css, 'font: inherit; font-size: 14px; font-weight: 700;');
  });
  teste('recolhido esconde os itens, MENOS o da página atual', () => {
    contem(css, '.sidebar .nav-group.recolhido .nav-item:not(.active) { display: none; }');
  });
  teste('alternar entra e sai da lista', () => {
    ok(alternar([], 'Financeiro').includes('Financeiro'));
    ok(!alternar(['Financeiro'], 'Financeiro').includes('Financeiro'));
  });
  teste('storage vazio, com lixo ou bloqueado: tudo expandido', () => {
    const st = v => ({ getItem: () => v });
    ok(lerRecolhidos(st(null)).length === 0);
    ok(lerRecolhidos(st('{quebrado')).length === 0);
    ok(lerRecolhidos(st('{"a":1}')).length === 0);
    ok(lerRecolhidos({ getItem: () => { throw new Error('bloqueado'); } }).length === 0);
    ok(lerRecolhidos(st('["Financeiro", 3]')).join() === 'Financeiro');
  });
  teste('o título vira botão com aria-expanded e o painel liga', () => {
    const js = ler('../js/menu-lateral.js');
    contem(js, '<button type="button" class="nav-group-botao" aria-expanded="${!fechado}" aria-controls="${esc(grupo.id)}">');
    contem(ler('../index.html'), '  ligarGruposDoMenu();');
  });
});
