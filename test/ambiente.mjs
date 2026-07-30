// Ambiente mínimo de navegador + instalação do loader.
// Carregado com `node --import ./test/ambiente.mjs`, ANTES de qualquer módulo
// do projeto: vários deles leem window/document já no topo do arquivo.
//
// É de propósito que isto seja pequeno. Um DOM completo (jsdom) mudaria o teste
// de "o módulo faz a conta certa" para "o jsdom concorda com o Chrome", e traria
// uma dependência num projeto que não tem nenhuma.

import { register } from 'node:module';

globalThis.window = {
  location: { href: 'http://localhost:3000/index.html', search: '', hash: '', origin: 'http://localhost:3000' },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame: (fn) => setTimeout(() => fn(0), 0),
  renderIcons() {},
};
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.matchMedia = globalThis.window.matchMedia;

globalThis.document = {
  createElement: () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, remove() {}, setAttribute() {}, focus() {},
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; },
  }),
  body: { appendChild() {}, classList: { add() {}, remove() {} } },
  documentElement: {},
  addEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
};

globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); },
  removeItem(k) { this._d.delete(k); },
};

register('./hook.mjs', import.meta.url);
