// ═══════════════════════════════════════════════════════════
// DIETA — drawer de busca de alimentos
// ═══════════════════════════════════════════════════════════
// Saiu de dieta-ui.js com o estado que era dele: resultados, item ativo,
// aba e filtros moram aqui. Quem monta a tela injeta uma `api` e não precisa
// saber como a busca funciona.
//
// Quatro abas: Alimentos (busca + sugestões), Favoritos, Recentes e Mais
// usados. Os filtros de fonte valem para todas — inclusive para as listas sem
// termo digitado, senão "Favoritos + TACO" mentiria.
//
// A filtragem por fonte é feita AQUI, na lista já devolvida: `foods_buscar`
// retorna `setof foods`, então fonte_dados e nutri_id chegam prontos e não é
// preciso mexer no RPC nem no banco nesta etapa.

import { buscarFoods, listarFavoritos, listarRecentes, listarMaisUsados,
         listarIdsFavoritos, favoritar, desfavoritar } from './dieta.js';
import { fmtG, fmtKcal } from './dieta-calc.js';
import { badgeFonteHtml } from './dieta-linha.js';
import { mostrarToast, mostrarErro } from './utils.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Abas e filtros ──────────────────────────────────────────
export const ABAS = [
  ['alimentos',  'Alimentos'],
  ['favoritos',  'Favoritos'],
  ['recentes',   'Recentes'],
  ['maisusados', 'Mais usados'],
];

// `chave` é o que o filtro compara; `receitas` fica visível e desligado de
// propósito: receita ainda não entra como item da refeição (Etapa 5). Esconder
// o filtro faria parecer que ele nunca foi pedido; deixá-lo clicável faria a
// busca voltar sempre vazia.
export const FILTROS = [
  { chave: 'taco',     rotulo: 'TACO' },
  { chave: 'usda',     rotulo: 'USDA' },
  { chave: 'proprios', rotulo: 'Próprios' },
  { chave: 'receitas', rotulo: 'Receitas', indisponivel: 'Receitas entram como item do plano na Etapa 5' },
];

/** A qual filtro este alimento pertence. Próprio vence a procedência do dado. */
export function chaveDeFonte(food) {
  if (food?.nutri_id) return 'proprios';
  switch (String(food?.fonte_dados || '')) {
    case 'TACO': return 'taco';
    case 'USDA': return 'usda';
    case 'TBCA': return 'tbca';
    case 'OpenFoodFacts': return 'off';
    default: return 'outros';
  }
}

/** Filtro OU: sem nenhum marcado, passa tudo. Pura — é o que os testes cobrem. */
export function filtrarPorFonte(lista, filtros) {
  const f = filtros instanceof Set ? filtros : new Set(filtros || []);
  if (!f.size) return [...(lista || [])];
  return (lista || []).filter(a => f.has(chaveDeFonte(a)));
}

// ── Estado ──────────────────────────────────────────────────
let _api = null;              // injetada por abrirBusca()
let _refId = null;            // refeição que recebe o alimento
let _aba = 'alimentos';
let _filtros = new Set();
let _brutos = [];             // o que veio do banco, antes do filtro
let _resultados = [];         // o que está na tela
let _ativo = -1;
let _buscando = false;
let _favoritos = new Set();
let _erro = null;
// Estados POR RESULTADO: adicionar um alimento não pode travar a busca inteira,
// e o "Adicionado" precisa aparecer no botão que foi clicado.
let _adicionando = null;      // food_id em voo
let _adicionado = null;       // food_id recém-adicionado (some sozinho)
let _timerAdicionado = null;

/** Só para os testes e para quem precisa saber se o drawer está aberto. */
export const estadoBusca = () => ({
  refId: _refId, aba: _aba, filtros: new Set(_filtros),
  resultados: _resultados, ativo: _ativo, buscando: _buscando,
});

export const buscaAberta = () => _refId != null;

/**
 * @param {string} refId
 * @param {object} api
 *   qs(id) · rerender() · adicionar(food) · medidasDe: Map · carregarMedidas(ids)
 *   nutriId(): Promise<string> · sugestoes(): Promise<food[]> · invalidarSugestoes()
 */
export async function abrirBusca(refId, api) {
  _api = api; _refId = refId;
  _aba = 'alimentos'; _brutos = []; _resultados = []; _ativo = -1; _erro = null;
  _api.rerender();
  _api.qs('diDwInput')?.focus();
  // A estrela precisa saber o que já é favorito; falhar aqui não impede buscar.
  try { _favoritos = await listarIdsFavoritos(); } catch (e) { _favoritos = new Set(); }
  await carregarAba();
}

export function fecharBusca() {
  _refId = null; _brutos = []; _resultados = []; _ativo = -1; _erro = null;
  _api?.rerender();
}

// ── HTML ────────────────────────────────────────────────────
/**
 * Dois modos, mesmo conteúdo:
 *
 *   painel  (padrão)  entra pela direita, sobre a tela — usado quando a busca
 *                     é chamada da rotina, sem refeição aberta.
 *   inline            fica DENTRO do drawer da refeição, logo abaixo do botão
 *                     "+ Alimento". Um painel lateral por cima de outro painel
 *                     lateral empilha duas camadas para uma ação que pertence
 *                     à refeição que já está aberta.
 */
export function drawerHtml(nomeRefeicao, { inline = false } = {}) {
  return `
    ${inline ? '' : '<div class="di-drawer-fundo" id="diDrawerFundo"></div>'}
    <aside class="di-drawer ${inline ? 'di-drawer-inline' : ''}" id="diDrawer"
           role="${inline ? 'region' : 'dialog'}" ${inline ? '' : 'aria-modal="true"'}
           aria-label="Adicionar alimento">
      <div class="di-dw-hd">
        <div class="di-dw-hd-txt">
          <!-- A ação é o título; a refeição é o contexto. Antes o "ADICIONAR
               EM" em caixa alta era o maior elemento da área. -->
          <div class="di-dw-tit">Adicionar alimento</div>
          <div class="di-dw-eyebrow">Em ${esc(nomeRefeicao || 'refeição')}</div>
        </div>
        <button class="di-iact di-dw-x" id="diDwFechar" title="Fechar (Esc)" aria-label="Fechar busca">
          <kbd>Esc</kbd><i data-lucide="x"></i>
        </button>
      </div>

      <div class="di-dw-abas" role="tablist">
        ${ABAS.map(([k, txt]) => `
          <button role="tab" class="di-dw-aba ${_aba === k ? 'ativa' : ''}"
                  data-dw-aba="${k}" aria-selected="${_aba === k}">${txt}</button>`).join('')}
      </div>

      <div class="di-dw-busca">
        <i data-lucide="search" aria-hidden="true"></i>
        <input type="text" id="diDwInput" autocomplete="off"
               placeholder="Buscar alimento, marca, receita ou código de barras"
               aria-label="Buscar alimento">
      </div>

      <div class="di-dw-filtros" role="group" aria-label="Filtrar por fonte">
        ${FILTROS.map(f => f.indisponivel
          ? `<button class="di-filtro" data-dw-filtro="${f.chave}" disabled
                     title="${esc(f.indisponivel)}" aria-disabled="true">${esc(f.rotulo)}</button>`
          : `<button class="di-filtro ${_filtros.has(f.chave) ? 'ativo' : ''}" data-dw-filtro="${f.chave}"
                     aria-pressed="${_filtros.has(f.chave)}">${esc(f.rotulo)}</button>`).join('')}
        ${_filtros.size ? `<button class="di-filtro di-filtro-limpar" data-dw-filtro-limpar>Limpar</button>` : ''}
      </div>

      <div class="di-dw-lista" id="diDwLista" role="listbox" aria-label="Resultados"></div>
      <span class="sr" role="status" aria-live="polite" id="diDwAviso"></span>

      <div class="di-dw-ft">
        <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
        <span><kbd>Enter</kbd> adicionar</span>
        <span><kbd>Esc</kbd> fechar</span>
      </div>
    </aside>`;
}

function resultadoHtml(a, i, ativo) {
  const med = (_api?.medidasDe?.get(a.id) || [])[0];
  const porcao = med ? `${esc(med.descricao)} · ${fmtG(med.gramas)} g` : 'Porção padrão: 100 g';
  const fav = _favoritos.has(a.id);
  return `
    <div class="di-res ${ativo ? 'ativo' : ''}" role="option" aria-selected="${ativo}" data-res="${i}">
      <button class="di-res-fav ${fav ? 'ativo' : ''}" data-res-fav="${i}"
              title="${fav ? 'Remover dos favoritos' : 'Marcar como favorito'}"
              aria-label="${fav ? 'Remover' : 'Marcar'} ${esc(a.nome)} ${fav ? 'dos' : 'nos'} favoritos"
              aria-pressed="${fav}">
        <i data-lucide="star"></i>
      </button>
      <div class="di-res-txt">
        <div class="di-res-nome">${esc(a.nome)}</div>
        <div class="di-res-sub">
          ${badgeFonteHtml(a)}
          ${a.marca ? `<span class="di-it-marca">${esc(a.marca)}</span>` : ''}
          <span>${porcao}</span>
        </div>
      </div>
      <div class="di-res-mac">
        <div class="di-res-kcal">${fmtKcal(a.calorias)} kcal</div>
        <div class="di-res-pcg">P ${fmtG(a.proteina)} · C ${fmtG(a.carboidrato)} · G ${fmtG(a.gordura)}</div>
      </div>
      ${botaoAddHtml(a, i)}
    </div>`;
}

/**
 * O botão de adicionar em três estados. O "em voo" e o "adicionado" são POR
 * ITEM: travar a busca inteira a cada inclusão quebraria o fluxo de enfileirar
 * vários alimentos seguidos, que é como a tela é usada.
 */
function botaoAddHtml(a, i) {
  if (_adicionando === a.id) {
    return `<button class="di-res-add carregando" disabled aria-label="Adicionando ${esc(a.nome)}">
              <span class="spinner"></span> Adicionando
            </button>`;
  }
  if (_adicionado === a.id) {
    return `<button class="di-res-add feito" disabled aria-label="${esc(a.nome)} adicionado">
              <i data-lucide="check"></i> Adicionado
            </button>`;
  }
  return `<button class="di-res-add" data-res-add="${i}" aria-label="Adicionar ${esc(a.nome)}">
            <i data-lucide="plus"></i> Adicionar
          </button>`;
}

/** @returns {{titulo: string, sub: string, acao?: string}} */
function vazioHtml() {
  const termo = (_api?.qs('diDwInput')?.value || '').trim();

  // Filtro ligado com resultado bruto não-vazio: o problema é o filtro, e dizer
  // "nada encontrado" mandaria o nutri procurar o erro no lugar errado.
  if (_filtros.size && _brutos.length) {
    const nomes = FILTROS.filter(f => _filtros.has(f.chave)).map(f => f.rotulo).join(', ');
    return {
      titulo: `${_brutos.length} ${_brutos.length === 1 ? 'resultado escondido' : 'resultados escondidos'} pelo filtro`,
      sub: `Nenhum deles é ${esc(nomes)}.`,
      acao: 'limpar',
    };
  }
  if (termo) {
    return {
      titulo: 'Nenhum alimento encontrado.',
      sub: _filtros.size ? 'Tente outro termo ou altere os filtros.' : 'Tente outro termo.',
      acao: _filtros.size ? 'limpar' : null,
    };
  }
  switch (_aba) {
    case 'favoritos':  return { titulo: 'Você ainda não tem favoritos.', sub: 'Marque a estrela em qualquer resultado da busca.' };
    case 'recentes':   return { titulo: 'Nada por aqui ainda.', sub: 'Os alimentos que você usar aparecem nesta aba.' };
    case 'maisusados': return { titulo: 'Ainda não há histórico suficiente.', sub: 'Os mais prescritos aparecem aqui conforme você trabalha.' };
    default:           return { titulo: 'Comece a digitar.', sub: 'Ou escolha entre favoritos, recentes e mais usados.' };
  }
}

export function pintarResultados() {
  const lista = _api?.qs('diDwLista');
  if (!lista) return;

  if (_buscando) {
    lista.innerHTML = `<div class="di-dw-vazio"><div class="spinner"></div>Buscando...</div>`;
    return;
  }
  if (_erro) {
    lista.innerHTML = `<div class="di-dw-vazio"><i data-lucide="triangle-alert"></i>${esc(_erro)}</div>`;
    return;
  }
  if (!_resultados.length) {
    const v = vazioHtml();
    lista.innerHTML = `
      <div class="di-dw-vazio">
        <i data-lucide="search-x" aria-hidden="true"></i>
        <div class="di-dw-vazio-t">${v.titulo}</div>
        <div class="di-dw-vazio-s">${v.sub}</div>
        ${v.acao === 'limpar' ? `<button class="di-dw-vazio-btn" data-dw-filtro-limpar>Limpar filtros</button>` : ''}
      </div>`;
    lista.querySelector('[data-dw-filtro-limpar]')?.addEventListener('click', () => {
      _filtros.clear();
      _api.rerender();
      aplicarFiltro();
    });
    return;
  }

  lista.innerHTML = _resultados.map((a, i) => resultadoHtml(a, i, i === _ativo)).join('');

  lista.querySelectorAll('[data-res-add]').forEach(b =>
    b.addEventListener('click', () => adicionar(Number(b.dataset.resAdd))));

  lista.querySelectorAll('[data-res-fav]').forEach(b =>
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      alternarFavorito(Number(b.dataset.resFav));
    }));

  lista.querySelectorAll('[data-res]').forEach(el =>
    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('[data-res-add], [data-res-fav]')) return;
      e.preventDefault();
      adicionar(Number(el.dataset.res));
    }));

  lista.querySelector('.di-res.ativo')?.scrollIntoView({ block: 'nearest' });
}

// ── Eventos ─────────────────────────────────────────────────
export function ligarBusca(cont) {
  cont.querySelector('#diDwFechar')?.addEventListener('click', fecharBusca);
  cont.querySelector('#diDrawerFundo')?.addEventListener('click', fecharBusca);

  cont.querySelectorAll('[data-dw-aba]').forEach(b =>
    b.addEventListener('click', async () => {
      _aba = b.dataset.dwAba;
      _ativo = -1;
      _api.rerender();
      _api.qs('diDwInput')?.focus();
      await carregarAba();
    }));

  cont.querySelectorAll('[data-dw-filtro]').forEach(b =>
    b.addEventListener('click', () => {
      const k = b.dataset.dwFiltro;
      if (_filtros.has(k)) _filtros.delete(k); else _filtros.add(k);
      const termo = _api.qs('diDwInput')?.value || '';
      _api.rerender();
      const inp = _api.qs('diDwInput');
      if (inp) { inp.value = termo; inp.focus(); }   // filtrar não apaga a busca
      aplicarFiltro();
    }));

  cont.querySelector('[data-dw-filtro-limpar]')?.addEventListener('click', () => {
    _filtros.clear();
    const termo = _api.qs('diDwInput')?.value || '';
    _api.rerender();
    const inp = _api.qs('diDwInput');
    if (inp) { inp.value = termo; inp.focus(); }
    aplicarFiltro();
  });

  const inp = cont.querySelector('#diDwInput');
  if (!inp) return;
  inp.addEventListener('input', dwBuscar);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); fecharBusca(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); _ativo = Math.min(_ativo + 1, _resultados.length - 1); pintarResultados(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _ativo = Math.max(_ativo - 1, 0); pintarResultados(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const i = _ativo >= 0 ? _ativo : 0;
      if (_resultados[i]) adicionar(i);
    }
  });
  inp.focus();
}

const dwBuscar = debounce(async () => {
  const inp = _api?.qs('diDwInput');
  if (!inp) return;
  const termo = inp.value.trim();
  if (!termo) { await carregarAba(); return; }
  _buscando = true; _erro = null; pintarResultados();
  try {
    _brutos = await buscarFoods(termo, 25);
  } catch (e) {
    _buscando = false; _brutos = []; _resultados = [];
    _erro = `Erro na busca: ${e.message}`;
    pintarResultados();
    return;
  }
  _buscando = false;
  await depoisDeCarregar();
}, 180);

/** Aba sem termo digitado: sugestões, favoritos, recentes ou mais usados. */
export async function carregarAba() {
  _buscando = true; _erro = null; pintarResultados();
  try {
    if (_aba === 'favoritos')       _brutos = await listarFavoritos(50);
    else if (_aba === 'recentes')   _brutos = await listarRecentes(25);
    else if (_aba === 'maisusados') _brutos = await listarMaisUsados(25);
    else                            _brutos = await _api.sugestoes();
  } catch (e) {
    _buscando = false; _brutos = []; _resultados = [];
    _erro = `Não foi possível carregar: ${e.message}`;
    pintarResultados();
    return;
  }
  _buscando = false;
  await depoisDeCarregar();
}

async function depoisDeCarregar() {
  _resultados = filtrarPorFonte(_brutos, _filtros);
  await _api.carregarMedidas(_resultados.map(a => a.id));
  _ativo = _resultados.length ? 0 : -1;
  pintarResultados();
}

/** Trocar o filtro não volta ao banco: refiltra o que já veio. */
function aplicarFiltro() {
  _resultados = filtrarPorFonte(_brutos, _filtros);
  _ativo = _resultados.length ? 0 : -1;
  pintarResultados();
}

// Adiciona e MANTÉM o drawer aberto — a ideia é enfileirar vários alimentos.
async function adicionar(i) {
  const al = _resultados[i];
  if (!al || !_refId || _adicionando) return;

  _adicionando = al.id;
  pintarResultados();                       // só o botão dele muda de estado
  try {
    await _api.adicionar(_refId, al);
  } finally {
    _adicionando = null;
  }

  // "Adicionado" por 1,6 s no botão que foi clicado, e o aviso ao leitor de
  // tela — o toast some rápido demais para quem navega por teclado.
  _adicionado = al.id;
  clearTimeout(_timerAdicionado);
  _timerAdicionado = setTimeout(() => { _adicionado = null; pintarResultados(); }, 1600);

  const aviso = _api.qs('diDwAviso');
  if (aviso) aviso.textContent = `${al.nome} adicionado`;
  mostrarToast(`✓ ${al.nome}`);

  // Fluxo de adição inalterado: limpa o termo e volta às sugestões, pronto
  // para o próximo alimento.
  const inp = _api.qs('diDwInput');
  if (inp) { inp.value = ''; inp.focus(); }
  _api.invalidarSugestoes();
  await carregarAba();
}

async function alternarFavorito(i) {
  const al = _resultados[i];
  if (!al) return;
  const era = _favoritos.has(al.id);
  // Otimista: a estrela responde na hora e volta atrás se o banco recusar.
  if (era) _favoritos.delete(al.id); else _favoritos.add(al.id);
  pintarResultados();
  try {
    const nutriId = await _api.nutriId();
    if (era) await desfavoritar(nutriId, al.id);
    else await favoritar(nutriId, al.id);
    // A aba Favoritos mostra a lista do banco: desfavoritar tem que sumir dali.
    if (_aba === 'favoritos') await carregarAba();
  } catch (e) {
    if (era) _favoritos.add(al.id); else _favoritos.delete(al.id);
    pintarResultados();
    mostrarErro('Não foi possível atualizar o favorito: ' + (e.message || e));
  }
}
