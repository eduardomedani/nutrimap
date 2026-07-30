// ═══════════════════════════════════════════════════════════
// DIETA — a linha do alimento na prescrição
// ═══════════════════════════════════════════════════════════
// Saiu de dieta-ui.js para caber sozinha na cabeça: é a peça que o nutri olha
// o dia inteiro, e a que mais vai mudar nas próximas etapas (substituições,
// grupos de opções, receitas).
//
// Contrato com quem monta a tela:
//   itensHtml(itens, ctx)        HTML da tabela inteira (cabeçalho + linhas)
//   ligarItens(cont, acoes)      liga os eventos; `acoes` traz os callbacks
//
// `ctx` = { medidasDe: Map<food_id, medidas[]> }. A linha não busca nada e não
// guarda estado — recebe o que precisa e devolve string.
//
// NADA de conta aqui dentro. Peso, macros e conversão de medida vêm de
// dieta-calc.js, que é a única fonte da regra "quantidade é múltiplo de 100 g".

import {
  macrosItem, medidaDoItem, MEDIDA_GRAMAS, fmtG, fmtKcal, arredonda,
} from './dieta-calc.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const fmtQtdInput = v => String(arredonda(v, 2));

// ── Badge de fonte ──────────────────────────────────────────
// Antes a linha mostrava `marca || fonte_dados` como texto solto, então "TACO"
// e "Nestlé" apareciam iguais — uma é a procedência do dado, a outra é o
// fabricante. Agora a procedência é badge (vocabulário fechado do banco, o
// check constraint de foods.fonte_dados) e a marca é texto.
const FONTES = {
  TACO:          { rotulo: 'TACO',  titulo: 'Tabela Brasileira de Composição de Alimentos' },
  TBCA:          { rotulo: 'TBCA',  titulo: 'Tabela Brasileira de Composição de Alimentos (USP)' },
  USDA:          { rotulo: 'USDA',  titulo: 'United States Department of Agriculture' },
  OpenFoodFacts: { rotulo: 'OFF',   titulo: 'Open Food Facts' },
  Proprio:       { rotulo: 'Próprio', titulo: 'Alimento cadastrado por você' },
};

/** @returns {{rotulo: string, titulo: string, chave: string}|null} */
export function fonteDoAlimento(food) {
  const f = FONTES[food?.fonte_dados];
  if (!f) return null;
  return { ...f, chave: String(food.fonte_dados).toLowerCase() };
}

export function badgeFonteHtml(food) {
  const f = fonteDoAlimento(food);
  if (!f) return '';
  return `<span class="di-badge di-badge-${esc(f.chave)}" title="${esc(f.titulo)}">${esc(f.rotulo)}</span>`;
}

// ── Substituições (SOMENTE LEITURA nesta etapa) ─────────────
/**
 * Lê `refeicao_itens.substituicoes`, que hoje é jsonb livre gravado pelo
 * gerador no formato { nome, quantidade, medida } — sem food_id, sem critério
 * de equivalência, sem confirmação do profissional.
 *
 * Por isso a leitura é defensiva e a tela é só de leitura: este formato NÃO é
 * a estrutura definitiva, e a Etapa 2 vai migrá-lo para uma tabela própria.
 * Aqui só tornamos visível o que já está gravado e hoje não aparece para
 * ninguém — nem para o nutri, nem para o paciente.
 *
 * @returns {Array<{nome: string, detalhe: string}>}
 */
export function substituicoesDoItem(item) {
  const bruto = item?.substituicoes;
  if (!Array.isArray(bruto)) return [];      // null, objeto solto ou string: ignora
  return bruto
    .map(s => {
      if (!s) return null;
      // Aceita tanto o objeto do gerador quanto uma string simples.
      if (typeof s === 'string') return s.trim() ? { nome: s.trim(), detalhe: '' } : null;
      const nome = String(s.nome ?? '').trim();
      if (!nome) return null;
      // `medida` do gerador já vem como rótulo pronto ("55g"). Sem ela, cai
      // para a quantidade em múltiplo de 100 g, que é o contrato do banco.
      const medida = String(s.medida ?? '').trim();
      const qtd = Number(s.quantidade);
      const detalhe = medida || (Number.isFinite(qtd) && qtd > 0 ? `${fmtG(qtd * 100)} g` : '');
      return { nome, detalhe };
    })
    .filter(Boolean);
}

const TETO_CHIPS = 3;

/**
 * O bloco é um BOTÃO: clicar abre o painel lateral com a lista completa.
 * `.di-sub-chip`, e não `.di-chip` — este último já era o chip de status do
 * plano (ativo/inativo/modelo), e reusar o nome apagava a formatação dele.
 */
function chipsHtml(item) {
  const subs = substituicoesDoItem(item);
  if (!subs.length) return '';

  const visiveis = subs.slice(0, TETO_CHIPS);
  const resto = subs.length - visiveis.length;
  const todas = subs.map(s => s.detalhe ? `${s.nome} (${s.detalhe})` : s.nome).join(' · ');

  return `
    <button class="di-subs" data-item-subs="${item.id}" type="button"
            title="${esc(`${subs.length} ${subs.length === 1 ? 'substituição' : 'substituições'}: ${todas}`)}"
            aria-label="Ver as ${subs.length} substituições deste alimento">
      <i data-lucide="repeat-2" aria-hidden="true"></i>
      ${visiveis.map(s => `<span class="di-sub-chip">${esc(s.nome)}${
        s.detalhe ? `<em>${esc(s.detalhe)}</em>` : ''}</span>`).join('')}
      ${resto > 0 ? `<span class="di-sub-chip di-sub-chip-mais">+${resto}</span>` : ''}
    </button>`;
}

// ── Tabela ──────────────────────────────────────────────────
export function itensHtml(itens, ctx = {}) {
  return `
    <div class="di-tab" role="table" aria-label="Alimentos da refeição">
      <div class="di-tr di-th" role="row">
        <span role="columnheader" class="c-num">#</span>
        <span role="columnheader" class="c-nome">Alimento</span>
        <span role="columnheader" class="c-qtd">Qtd</span>
        <span role="columnheader" class="c-med">Medida</span>
        <span role="columnheader" class="c-peso">Peso</span>
        <span role="columnheader" class="c-mac">P</span>
        <span role="columnheader" class="c-mac">C</span>
        <span role="columnheader" class="c-mac">G</span>
        <span role="columnheader" class="c-kcal">kcal</span>
        <span role="columnheader" class="c-acts"><span class="sr">Ações</span></span>
      </div>
      ${itens.map((it, i) => itemRowHtml(it, i, itens.length, ctx)).join('')}
    </div>`;
}

export function itemRowHtml(it, i, total, ctx = {}) {
  const f = it.food || {};
  const mm = macrosItem(it);
  const medidas = ctx.medidasDe?.get(it.food_id) || [];
  const sel = medidaDoItem(medidas, it);
  const nome = f.nome || '(alimento removido)';
  const obs = String(it.observacao ?? '').trim();
  const temSubs = substituicoesDoItem(it).length > 0;

  const opcoes = [
    `<option value="${MEDIDA_GRAMAS}" ${sel.medida === MEDIDA_GRAMAS ? 'selected' : ''}>gramas</option>`,
    ...medidas.map(m =>
      `<option value="${esc(m.descricao)}" ${sel.medida === m.descricao ? 'selected' : ''}>${esc(m.descricao)} (${fmtG(m.gramas)} g)</option>`),
  ].join('');

  return `
    <div class="di-tr di-item" role="row" data-item-row="${it.id}">
      <span class="c-num" role="cell">${i + 1}</span>

      <div class="c-nome" role="cell">
        <div class="di-it-nome">${esc(nome)}</div>
        <div class="di-it-sub">
          ${badgeFonteHtml(f)}
          ${f.marca ? `<span class="di-it-marca">${esc(f.marca)}</span>` : ''}
        </div>
        ${chipsHtml(it)}
        ${obs ? `
          <div class="di-it-obs">
            <i data-lucide="message-square-text" aria-hidden="true"></i>
            <input type="text" class="di-obs" value="${esc(obs)}"
                   data-item-campo="observacao" data-item-id="${it.id}"
                   aria-label="Observação sobre ${esc(nome)}">
          </div>` : ''}
      </div>

      <div class="c-qtd" role="cell">
        <input type="number" step="0.25" min="0" inputmode="decimal" class="di-inp di-inp-qtd"
               value="${fmtQtdInput(sel.n)}" data-item-qtd="${it.id}"
               aria-label="Quantidade de ${esc(nome)}">
      </div>

      <div class="c-med" role="cell">
        <select class="di-inp di-inp-med" data-item-med="${it.id}"
                aria-label="Medida de ${esc(nome)}"
                ${medidas.length ? '' : 'title="Este alimento ainda não tem medidas caseiras. Cadastre em Alimentos."'}>
          ${opcoes}
        </select>
      </div>

      <span class="c-peso" role="cell"><b>${fmtG(sel.gramas)}</b> g</span>

      <span class="c-mac" role="cell" title="Proteína">${fmtG(mm.prot)}</span>
      <span class="c-mac" role="cell" title="Carboidrato">${fmtG(mm.carb)}</span>
      <span class="c-mac" role="cell" title="Gordura">${fmtG(mm.gord)}</span>
      <span class="c-kcal" role="cell"><b>${fmtKcal(mm.kcal)}</b></span>

      <div class="c-acts" role="cell">
        <button class="di-iact" data-item-up="${it.id}" ${i === 0 ? 'disabled' : ''}
                title="Mover para cima" aria-label="Mover ${esc(nome)} para cima">
          <i data-lucide="chevron-up"></i>
        </button>
        <button class="di-iact" data-item-down="${it.id}" ${i === total - 1 ? 'disabled' : ''}
                title="Mover para baixo" aria-label="Mover ${esc(nome)} para baixo">
          <i data-lucide="chevron-down"></i>
        </button>
        <button class="di-iact" data-item-dup="${it.id}" title="Duplicar" aria-label="Duplicar ${esc(nome)}">
          <i data-lucide="copy"></i>
        </button>
        <button class="di-iact ${obs ? 'ativo' : ''}" data-item-obs="${it.id}"
                title="${obs ? 'Editar observação' : 'Adicionar observação'}"
                aria-label="${obs ? 'Editar' : 'Adicionar'} observação de ${esc(nome)}">
          <i data-lucide="message-square-plus"></i>
        </button>
        <button class="di-iact ${temSubs ? 'ativo' : ''}" data-item-subs="${it.id}"
                title="${temSubs ? 'Ver substituições' : 'Substituições (nenhuma cadastrada)'}"
                aria-label="Substituições de ${esc(nome)}">
          <i data-lucide="repeat-2"></i>
        </button>

        <div class="di-menu-wrap">
          <button class="di-iact" data-item-menu="${it.id}" aria-haspopup="menu" aria-expanded="false"
                  title="Mais ações" aria-label="Mais ações de ${esc(nome)}">
            <i data-lucide="ellipsis-vertical"></i>
          </button>
          <div class="di-menu" data-item-menu-pop="${it.id}" role="menu" hidden>
            <button role="menuitem" data-item-del="${it.id}" class="perigo">
              <i data-lucide="trash-2"></i> Remover alimento
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

// ── Eventos ─────────────────────────────────────────────────
/**
 * Liga a linha aos callbacks de quem é dono do estado.
 *
 * @param {Element} cont
 * @param {object}  acoes
 *   salvarCampo(el) · salvarQuantidade(id) · trocarMedida(id) · mover(id, dir)
 *   duplicar(id) · remover(id) · abrirMenu(btn, pop) · pedirObservacao(id)
 *   focoSeguinte(id, dir) — devolve o id do próximo item, para o Enter andar
 */
export function ligarItens(cont, acoes = {}) {
  const cada = (sel, fn) => cont.querySelectorAll(sel).forEach(fn);

  cada('[data-item-campo]', el =>
    el.addEventListener('change', () => acoes.salvarCampo?.(el)));

  cada('[data-item-qtd]', el => {
    el.addEventListener('change', () => acoes.salvarQuantidade?.(el.dataset.itemQtd));
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      // Enter encadeia: confirma esta quantidade e desce para a próxima linha.
      // Sem o preventDefault o form nativo tentaria submeter a página.
      e.preventDefault();
      acoes.salvarQuantidade?.(el.dataset.itemQtd, { seguir: e.shiftKey ? -1 : +1 });
    });
    // Selecionar o conteúdo ao focar deixa "digita e substitui" ser o padrão.
    el.addEventListener('focus', () => el.select?.());
  });

  cada('[data-item-med]', el =>
    el.addEventListener('change', () => acoes.trocarMedida?.(el.dataset.itemMed)));

  cada('[data-item-menu]', b => {
    const pop = cont.querySelector(`[data-item-menu-pop="${b.dataset.itemMenu}"]`);
    if (pop) b.addEventListener('click', () => acoes.abrirMenu?.(b, pop));
  });

  cada('[data-item-up]',   b => b.addEventListener('click', () => acoes.mover?.(b.dataset.itemUp, -1)));
  cada('[data-item-down]', b => b.addEventListener('click', () => acoes.mover?.(b.dataset.itemDown, +1)));
  cada('[data-item-dup]',  b => b.addEventListener('click', () => acoes.duplicar?.(b.dataset.itemDup)));
  cada('[data-item-del]',  b => b.addEventListener('click', () => acoes.remover?.(b.dataset.itemDel)));
  cada('[data-item-obs]',  b => b.addEventListener('click', () => acoes.pedirObservacao?.(b.dataset.itemObs)));
  cada('[data-item-subs]', b => b.addEventListener('click', () => acoes.verSubstituicoes?.(b.dataset.itemSubs)));
}
