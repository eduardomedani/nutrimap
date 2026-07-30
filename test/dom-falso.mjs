// ═══════════════════════════════════════════════════════════
// DOM falso — o suficiente para exercitar ligarItens()
// ═══════════════════════════════════════════════════════════
// Suporta só o que a linha do alimento usa: querySelector/querySelectorAll com
// seletor de atributo ([data-x] e [data-x="v"]), addEventListener e dataset.
// Qualquer coisa além disso deve ser testada no navegador, não aqui — um DOM
// pela metade que finge ser completo é pior que nenhum.

function camel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

export function criarNo(atributos = {}) {
  const dataset = {};
  for (const [k, v] of Object.entries(atributos)) {
    if (k.startsWith('data-')) dataset[camel(k.slice(5))] = String(v);
  }
  const ouvintes = new Map();
  let selecionado = false;
  let focado = false;

  return {
    atributos, dataset, value: atributos.value ?? '',
    disabled: !!atributos.disabled,
    addEventListener(evento, fn) {
      if (!ouvintes.has(evento)) ouvintes.set(evento, []);
      ouvintes.get(evento).push(fn);
    },
    /** Dispara um evento como o navegador faria. Devolve o objeto do evento. */
    disparar(evento, dados = {}) {
      let padraoImpedido = false;
      const ev = {
        type: evento, target: this, currentTarget: this,
        preventDefault() { padraoImpedido = true; },
        stopPropagation() {},
        get defaultPrevented() { return padraoImpedido; },
        ...dados,
      };
      for (const fn of ouvintes.get(evento) || []) fn(ev);
      return ev;
    },
    temOuvinte(evento) { return (ouvintes.get(evento) || []).length > 0; },
    select() { selecionado = true; },
    focus() { focado = true; },
    get foiSelecionado() { return selecionado; },
    get foiFocado() { return focado; },
  };
}

/** Casa seletores de atributo: [data-x], [data-x="v"]. */
function casa(no, seletor) {
  const m = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(seletor.trim());
  if (!m) return false;
  const [, attr, valor] = m;
  const tem = Object.prototype.hasOwnProperty.call(no.atributos, attr);
  if (!tem) return false;
  return valor === undefined || String(no.atributos[attr]) === valor;
}

export function criarContainer(nos = []) {
  return {
    nos,
    querySelectorAll(seletor) { return nos.filter(n => casa(n, seletor)); },
    querySelector(seletor) { return nos.find(n => casa(n, seletor)) || null; },
  };
}
