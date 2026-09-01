// ═══════════════════════════════════════════════════════════
// FINANCEIRO · DESPESAS — lista, filtros e ações
// ═══════════════════════════════════════════════════════════
// Saiu de financeiro-ui.js, que estava virando a tela inteira do módulo. Aqui
// mora só a aba Despesas e a aba Contas a pagar, que são a MESMA lista com
// filtro diferente: contas a pagar é despesa pendente com vencimento, não uma
// coleção própria. Duplicar a lista criaria dois lugares para corrigir cada
// defeito de filtro, e o segundo é sempre o que fica para trás.
//
// AS AÇÕES SECUNDÁRIAS FICAM NO MENU, a principal não. Editar é o que se faz
// em quase toda visita e está no clique da linha; marcar como paga, duplicar e
// cancelar são ocasionais e ficam atrás do "⋯". Seis ícones fixos por linha
// transformam a tabela num painel de botões e escondem o dado.

import {
  listarLancamentos, listarCategorias, listarCentrosCusto,
  marcarComoPaga, cancelarDespesa, excluirLancamento,
  somar, pendencias, contasAPagar, contaNoTotal,
  anoDa, dataBR, hojeISO, formatarBRL, nomeCompetencia, SEM_CATEGORIA,
} from './financeiro.js';
import { abrirLancamento, despesaDoBanco } from './financeiro-lancamento-form.js';
import { statusVisual, ROTULO_STATUS, duplicarLancamento } from './financeiro-lancamento-validacao.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Sem `categoria` e sem `origem`: os dois saíram da barra. Categoria continua
// alcançável pelo atalho de pendência da Visão geral (`pendencia`), que é a
// pergunta que de fato se faz — "o que ainda não classifiquei" — e não "me
// mostre só a categoria X", que a busca já resolve.
const FILTRO_VAZIO = {
  busca: '', ano: '', status: '', centro: '', pendencia: '',
};

let _dados = null;
let _modo = 'despesas';          // 'despesas' | 'contas-pagar'
let _aoMudar = null;             // avisa a Visão geral que os números mudaram
let _filtro = { ...FILTRO_VAZIO };
let _pagina = 0;
const POR_PAGINA = 50;

export { FILTRO_VAZIO };

/** Arma o filtro antes de a aba montar — é assim que o alerta da Visão geral
 *  leva direto ao que ele acabou de contar. */
export function definirFiltro(parcial = {}) {
  _filtro = { ...FILTRO_VAZIO, ...parcial };
  _pagina = 0;
}

export async function initDespesasUI(containerId, opcoes = {}) {
  _modo = opcoes.modo || 'despesas';
  _aoMudar = opcoes.aoMudar || null;

  const alvo = document.getElementById(containerId);
  if (!alvo) return;
  alvo.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando...</div>`;

  try {
    await carregar();
  } catch (e) {
    alvo.innerHTML = erroHtml(e);
    return;
  }
  desenhar(alvo);
}

async function carregar() {
  const [lancamentos, categorias, centros] = await Promise.all([
    listarLancamentos({ tipo: 'despesa' }),
    listarCategorias('despesa'),
    listarCentrosCusto().catch(() => []),   // migração pode não ter rodado
  ]);
  _dados = { lancamentos, categorias, centros };
}

function erroHtml(e) {
  const msg = String(e?.message || e || '');
  const falta = /does not exist|schema cache|relation|column/i.test(msg);
  return `
    <div class="fe-vazio">
      <div class="fe-vazio-icone"><i data-lucide="triangle-alert"></i></div>
      <div class="fe-vazio-tit">${falta ? 'O banco ainda não tem as colunas novas' : 'Não consegui ler as despesas'}</div>
      <div class="fe-vazio-sub">${falta
        ? 'Rode <code>db/financeiro_despesas_etapa1.sql</code> no SQL Editor do Supabase.'
        : esc(msg)}</div>
      ${falta ? `<div class="fe-vazio-tag">${esc(msg)}</div>` : ''}
    </div>`;
}

// ───────────────────────────────────────────────────────────
// FILTRO
// ───────────────────────────────────────────────────────────
export function filtrar(lancamentos, filtro, hoje) {
  const termo = String(filtro.busca || '').trim().toLowerCase();

  return (lancamentos || []).filter(l => {
    if (filtro.ano && anoDa(l.competencia) !== filtro.ano) return false;

    if (filtro.centro === 'sem' && l.centro_custo_id) return false;
    if (filtro.centro && filtro.centro !== 'sem' && l.centro_custo_id !== filtro.centro) return false;

    if (filtro.status) {
      const s = statusVisual(l, hoje);
      if (filtro.status === 'aberto') { if (s !== 'pendente' && s !== 'vencido') return false; }
      else if (s !== filtro.status) return false;
    }

    if (filtro.pendencia === 'sem-valor' && l.valor != null) return false;
    if (filtro.pendencia === 'sem-categoria' && l.categoria_id) return false;

    if (termo) {
      const alvo = `${l.descricao || ''} ${l.fornecedor || ''} ${l.observacoes || ''}`.toLowerCase();
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });
}

/** Quantos filtros estão ativos. Serve ao contador do botão "Filtros" no
 *  celular, onde os campos ficam escondidos: sem o número, não há como saber
 *  que a lista está recortada — e uma lista curta sem explicação lê-se como
 *  "acabaram os lançamentos". */
export function contarFiltros(filtro = _filtro) {
  return Object.entries(filtro || {})
    .filter(([, v]) => String(v || '').trim() !== '').length;
}

/** Contas a pagar é a mesma lista com um recorte. */
function baseDoModo(hoje) {
  if (_modo !== 'contas-pagar') return _dados.lancamentos;
  return contasAPagar(_dados.lancamentos, hoje).todas;
}

// ───────────────────────────────────────────────────────────
// DESENHO
// ───────────────────────────────────────────────────────────
function desenhar(alvo) {
  const hoje = hojeISO();
  const base = baseDoModo(hoje);
  const anos = [...new Set(base.map(l => anoDa(l.competencia)).filter(Boolean))].sort().reverse();

  const ativos = contarFiltros();

  // DUAS ÁREAS, DUAS RESPONSABILIDADES. Os filtros podem quebrar de linha à
  // vontade; a ação não participa dessa quebra. Enquanto o botão era mais uma
  // célula do grid `auto-fit` dos filtros, o navegador o realocava junto com
  // eles e ele caía solto na última linha — não havia margem que corrigisse
  // isso, porque o problema era o botão estar no fluxo errado.
  alvo.innerHTML = `
    <div class="dsp-toolbar">
      <div class="dsp-toolbar-filtros">
        <input class="fp-in dsp-busca" id="dspBusca" type="search"
               placeholder="Buscar despesas" value="${esc(_filtro.busca)}"
               aria-label="Buscar na descrição, fornecedor ou observação">

        <button class="btn dsp-filtros-btn" id="dspFiltrosToggle" type="button"
                aria-expanded="false" aria-controls="dspFiltrosCampos">
          <i data-lucide="sliders-horizontal"></i> Filtros${
            ativos ? `<span class="dsp-filtros-n">${ativos}</span>` : ''}
        </button>

        <div class="dsp-filtros-campos" id="dspFiltrosCampos">
          <select class="fp-select dsp-f dsp-f-ano" id="dspFAno" aria-label="Ano">
            <option value="">Todos os anos</option>
            ${anos.map(a => `<option value="${a}"${_filtro.ano === a ? ' selected' : ''}>${a}</option>`).join('')}
          </select>
          <select class="fp-select dsp-f dsp-f-status" id="dspFStatus" aria-label="Situação">
            <option value="">Todas as situações</option>
            <option value="aberto"${_filtro.status === 'aberto' ? ' selected' : ''}>Em aberto</option>
            <option value="vencido"${_filtro.status === 'vencido' ? ' selected' : ''}>Vencidas</option>
            <option value="pago"${_filtro.status === 'pago' ? ' selected' : ''}>Pagas</option>
            <option value="cancelado"${_filtro.status === 'cancelado' ? ' selected' : ''}>Canceladas</option>
          </select>
          ${_dados.centros.length ? `
          <select class="fp-select dsp-f dsp-f-centro" id="dspFCentro" aria-label="Centro de custo">
            <option value="">Todos os centros</option>
            <option value="sem"${_filtro.centro === 'sem' ? ' selected' : ''}>— Sem centro —</option>
            ${_dados.centros.map(c => `<option value="${c.id}"${
              _filtro.centro === c.id ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}
          </select>` : ''}
          <button class="btn dsp-limpar" id="dspLimpar" type="button"${ativos ? '' : ' disabled'}>
            <i data-lucide="filter-x"></i> Limpar
          </button>
        </div>
      </div>

      <div class="dsp-toolbar-acao">
        <button class="btn primary dsp-btn-nova" id="dspNova" type="button">
          <i data-lucide="plus"></i> Nova despesa
        </button>
      </div>
    </div>

    <div id="dspLista"></div>`;

  const on = (id, ev, fn) => { const el = alvo.querySelector('#' + id); if (el) el.addEventListener(ev, fn); };
  on('dspBusca', 'input', debounce(e => { _filtro.busca = e.target.value; _pagina = 0; lista(); }, 200));
  on('dspFAno', 'change', e => { _filtro.ano = e.target.value; _pagina = 0; lista(); });
  on('dspFStatus', 'change', e => { _filtro.status = e.target.value; _pagina = 0; lista(); });
  on('dspFCentro', 'change', e => { _filtro.centro = e.target.value; _pagina = 0; lista(); });
  on('dspLimpar', 'click', () => { _filtro = { ...FILTRO_VAZIO }; _pagina = 0; desenhar(alvo); });
  on('dspNova', 'click', () => nova());

  // No celular os seis selects viram um painel que abre. Seis campos lado a
  // lado em 360px não são filtros: são uma parede entre a pessoa e a lista.
  on('dspFiltrosToggle', 'click', () => {
    const campos = alvo.querySelector('#dspFiltrosCampos');
    const botao = alvo.querySelector('#dspFiltrosToggle');
    const aberto = campos.classList.toggle('aberto');
    botao.setAttribute('aria-expanded', String(aberto));
    botao.classList.toggle('on', aberto);
  });

  lista();
}

function lista() {
  const cx = document.getElementById('dspLista');
  if (!cx || !_dados) return;

  const hoje = hojeISO();
  const todas = filtrar(baseDoModo(hoje), _filtro, hoje);
  const total = somar(todas);
  const semValor = todas.filter(l => l.valor == null).length;
  const cancel = todas.filter(l => !contaNoTotal(l)).length;

  if (!todas.length) {
    cx.innerHTML = vazioHtml();
    const b = cx.querySelector('#dspNovaVazio');
    if (b) b.addEventListener('click', () => nova());
    return;
  }

  const paginas = Math.max(1, Math.ceil(todas.length / POR_PAGINA));
  if (_pagina >= paginas) _pagina = paginas - 1;
  const pagina = todas.slice(_pagina * POR_PAGINA, (_pagina + 1) * POR_PAGINA);

  const nomeCat = new Map(_dados.categorias.map(c => [c.id, c.nome]));
  const nomeCC = new Map(_dados.centros.map(c => [c.id, c.nome]));

  cx.innerHTML = `
    <div class="dsp-resumo">
      <span class="dsp-resumo-n">${todas.length} lançamento(s)</span>
      <span class="dsp-resumo-sep">·</span>
      <strong>${esc(formatarBRL(total))}</strong>
      ${semValor ? `<span class="dsp-resumo-sep">·</span>
        <span class="fx-alerta">${semValor} sem valor, fora do total</span>` : ''}
      ${cancel ? `<span class="dsp-resumo-sep">·</span>
        <span class="dsp-mudo">${cancel} cancelada(s), fora do total</span>` : ''}
    </div>

    <div class="fp-tabela-wrap">
      <table class="fp-tabela fx-tabela dsp-tabela">
        <thead>
          <tr>
            <th>Descrição</th><th class="fx-c">Categoria</th><th class="fx-c">Competência</th>
            <th class="fx-c">Vencimento</th><th class="fx-c">Valor</th>
            <th class="fx-c">Situação</th><th class="fx-c">Origem</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${pagina.map(l => linha(l, hoje, nomeCat, nomeCC)).join('')}
        </tbody>
      </table>
    </div>

    ${paginas > 1 ? `
    <div class="dsp-paginacao">
      <button class="btn" id="dspAnt"${_pagina === 0 ? ' disabled' : ''}>
        <i data-lucide="chevron-left"></i> Anteriores</button>
      <span>Página ${_pagina + 1} de ${paginas}</span>
      <button class="btn" id="dspProx"${_pagina >= paginas - 1 ? ' disabled' : ''}>
        Próximas <i data-lucide="chevron-right"></i></button>
    </div>` : ''}`;

  cx.querySelectorAll('[data-editar]').forEach(el =>
    el.addEventListener('click', () => editar(el.dataset.editar)));
  cx.querySelectorAll('[data-menu]').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); abrirMenu(b, b.dataset.menu, hoje); }));

  const ant = cx.querySelector('#dspAnt');
  if (ant) ant.addEventListener('click', () => { _pagina--; lista(); });
  const prox = cx.querySelector('#dspProx');
  if (prox) prox.addEventListener('click', () => { _pagina++; lista(); });
}

function linha(l, hoje, nomeCat, nomeCC) {
  const s = statusVisual(l, hoje);
  const semValor = l.valor == null;
  const pend = semValor || !l.categoria_id;

  return `
    <tr class="dsp-linha${pend ? ' fx-pendente' : ''}${s === 'cancelado' ? ' dsp-cancelada' : ''}"
        data-editar="${l.id}" tabindex="0" role="button"
        aria-label="Editar ${esc(l.descricao)}">
      <td data-rot="Descrição">
        <div class="dsp-desc">${esc(l.descricao)}</div>
        ${l.fornecedor ? `<div class="fp-nome-sub">${esc(l.fornecedor)}</div>` : ''}
      </td>
      <td class="fx-c" data-rot="Categoria">
        ${l.categoria_id
          ? esc(nomeCat.get(l.categoria_id) || '—')
          : `<span class="dsp-mudo">${SEM_CATEGORIA}</span>`}
        ${l.centro_custo_id ? `<div class="fp-nome-sub">${esc(nomeCC.get(l.centro_custo_id) || '')}</div>` : ''}
      </td>
      <td class="fx-c" data-rot="Competência">${esc(nomeCompetencia(l.competencia))}</td>
      <td class="fx-c" data-rot="Vencimento">${l.vencimento
        ? esc(dataBR(l.vencimento))
        : '<span class="dsp-mudo">—</span>'}</td>
      <td class="fx-c" data-rot="Valor">${semValor
        ? '<span class="fx-alerta">sem valor</span>'
        : esc(formatarBRL(l.valor))}</td>
      <td class="fx-c" data-rot="Situação"><span class="dsp-selo dsp-selo-${s}">${ROTULO_STATUS[s]}</span></td>
      <td class="fx-c" data-rot="Origem">${l.origem === 'manual'
        ? '<span class="dsp-mudo">Manual</span>'
        : `<span class="dsp-selo dsp-selo-import">Importada</span>`}</td>
      <td class="fx-acao-cel" data-rot="Ações">
        <button class="fp-acao" data-menu="${l.id}" aria-label="Ações de ${esc(l.descricao)}"
                aria-haspopup="menu"><i data-lucide="ellipsis-vertical"></i></button>
      </td>
    </tr>`;
}

function vazioHtml() {
  const filtrado = Object.values(_filtro).some(Boolean);
  return `
    <div class="fe-vazio">
      <div class="fe-vazio-icone"><i data-lucide="${filtrado ? 'filter-x' : 'trending-down'}"></i></div>
      <div class="fe-vazio-tit">${filtrado
        ? 'Nenhuma despesa neste filtro'
        : (_modo === 'contas-pagar' ? 'Nenhuma conta a pagar' : 'Nenhuma despesa ainda')}</div>
      <div class="fe-vazio-sub">${filtrado
        ? 'Ajuste os filtros ou limpe-os para ver tudo.'
        : (_modo === 'contas-pagar'
            ? 'Conta a pagar é despesa pendente com data de vencimento. Nenhuma está nessa situação.'
            : 'Registre a primeira saída financeira da empresa.')}</div>
      <div class="fe-vazio-acoes">
        <button class="btn primary" id="dspNovaVazio"><i data-lucide="plus"></i> Nova despesa</button>
      </div>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// AÇÕES
// ───────────────────────────────────────────────────────────
async function recarregar() {
  await carregar();
  lista();
  if (_aoMudar) await _aoMudar();      // a Visão geral acompanha, sem F5
}

function nova() {
  abrirLancamento({ tipo: 'despesa', aoSalvar: recarregar });
}

function editar(id) {
  const l = _dados.lancamentos.find(x => x.id === id);
  if (!l) return;
  abrirLancamento({ tipo: 'despesa', lancamento: l, aoSalvar: recarregar });
}

function abrirMenu(botao, id, hoje) {
  document.querySelectorAll('.dsp-menu').forEach(m => m.remove());
  const l = _dados.lancamentos.find(x => x.id === id);
  if (!l) return;

  const s = statusVisual(l, hoje);
  const menu = document.createElement('div');
  menu.className = 'dsp-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <button role="menuitem" data-a="editar"><i data-lucide="pencil"></i> Editar</button>
    ${s !== 'pago' && s !== 'cancelado'
      ? `<button role="menuitem" data-a="pagar"><i data-lucide="circle-check"></i> Marcar como paga</button>` : ''}
    <button role="menuitem" data-a="duplicar"><i data-lucide="copy"></i> Duplicar</button>
    ${s !== 'cancelado'
      ? `<button role="menuitem" data-a="cancelar"><i data-lucide="ban"></i> Cancelar</button>` : ''}
    <button role="menuitem" class="dsp-menu-danger" data-a="excluir">
      <i data-lucide="trash-2"></i> Excluir</button>`;

  const caixa = botao.getBoundingClientRect();
  menu.style.top = `${caixa.bottom + window.scrollY + 4}px`;
  menu.style.left = `${Math.max(8, caixa.right + window.scrollX - 200)}px`;
  document.body.appendChild(menu);

  const fechar = () => { menu.remove(); document.removeEventListener('click', fechar); };
  setTimeout(() => document.addEventListener('click', fechar), 0);

  menu.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    fechar();
    await acao(b.dataset.a, l);
  }));
}

async function acao(qual, l) {
  try {
    if (qual === 'editar') return editar(l.id);

    if (qual === 'pagar') {
      const hoje = hojeISO();
      if (!confirm(`Marcar "${l.descricao}" como paga em ${dataBR(hoje)}?`)) return;
      await marcarComoPaga(l.id, { pago_em: hoje });
      return recarregar();
    }

    if (qual === 'duplicar') {
      // Sem id, sem pagamento, sem auditoria: a cópia nasce pendente. Copiar o
      // status de pagamento criaria uma despesa que já nasce dizendo que saiu
      // dinheiro que não saiu.
      abrirLancamento({ tipo: 'despesa', inicial: duplicarLancamento(l), aoSalvar: recarregar });
      return;
    }

    if (qual === 'cancelar') {
      if (!confirm(`Cancelar "${l.descricao}"?\n\nSai dos totais e dos alertas, ` +
                   'mas continua na lista com o rótulo Cancelado. Nada é apagado.')) return;
      await cancelarDespesa(l.id);
      return recarregar();
    }

    if (qual === 'excluir') {
      const importada = l.origem !== 'manual';
      if (!confirm(
        `Excluir "${l.descricao}" definitivamente?\n\n` +
        'Cancelar é quase sempre melhor: preserva o registro de que existiu.' +
        (importada ? '\n\nEsta linha veio de importação — reimportar vai trazê-la de volta.' : ''))) return;
      await excluirLancamento(l.id);
      return recarregar();
    }
  } catch (e) {
    alert('Não consegui completar: ' + (e?.message || e));
  }
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export { despesaDoBanco, pendencias };
