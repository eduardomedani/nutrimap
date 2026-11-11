// ═══════════════════════════════════════════════════════════
// MENU LATERAL — grupos que recolhem e expandem (11/11/2026)
// ═══════════════════════════════════════════════════════════
// Cada título de grupo (.nav-group-title) vira um BOTÃO: clicar (ou Enter/
// Espaço) recolhe e expande os itens do grupo. O estado é conveniência de
// quem usa, então mora no navegador (localStorage) e nunca é obrigatório:
// sem storage, tudo começa expandido.
//
// O item da página ATUAL continua à vista mesmo com o grupo recolhido (regra
// em css/painel-lateral.css) — recolher não esconde onde você está.
//
// O HTML de index.html não muda: o título continua um <div> com o texto, e o
// botão é montado aqui dentro dele.

const CHAVE = 'evollo_menu_recolhidos';

/** Lê a lista de grupos recolhidos (títulos). Sem storage: nenhum. */
export function lerRecolhidos(storage = globalThis.localStorage) {
  try {
    const v = JSON.parse(storage?.getItem(CHAVE) || '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  } catch { return []; }
}

/** Liga/desliga um título na lista e devolve a nova lista. */
export function alternar(lista, titulo) {
  return lista.includes(titulo) ? lista.filter(t => t !== titulo) : [...lista, titulo];
}

function gravar(lista, storage = globalThis.localStorage) {
  try { storage?.setItem(CHAVE, JSON.stringify(lista)); } catch { /* modo privado: só não lembra */ }
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Monta os botões nos títulos do menu. Chamar UMA vez, com o DOM pronto. */
export function ligarGruposDoMenu(raiz = document) {
  let recolhidos = lerRecolhidos();
  raiz.querySelectorAll('.sidebar .nav-group').forEach((grupo, i) => {
    const tit = grupo.querySelector(':scope > .nav-group-title');
    if (!tit || tit.querySelector('.nav-group-botao')) return;
    const texto = tit.textContent.trim();
    const fechado = recolhidos.includes(texto);
    grupo.classList.toggle('recolhido', fechado);
    // Os itens ganham um id de grupo para o aria-controls apontar para eles.
    const idItens = `navGrupo${i}`;
    grupo.id = grupo.id || idItens;
    tit.innerHTML = `<button type="button" class="nav-group-botao" aria-expanded="${!fechado}" aria-controls="${esc(grupo.id)}">
        <span class="nav-group-nome">${esc(texto)}</span><i data-lucide="chevron-down" aria-hidden="true"></i>
      </button>`;
    tit.querySelector('button').addEventListener('click', e => {
      const b = e.currentTarget;
      recolhidos = alternar(recolhidos, texto);
      const agoraFechado = recolhidos.includes(texto);
      grupo.classList.toggle('recolhido', agoraFechado);
      b.setAttribute('aria-expanded', String(!agoraFechado));
      gravar(recolhidos);
    });
  });
  window.renderIcons?.();
}
