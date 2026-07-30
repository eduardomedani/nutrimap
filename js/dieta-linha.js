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
  macrosItem, medidaDoItem, MEDIDA_GRAMAS, fmtG, fmtQtd, fmtKcal, arredonda,
} from './dieta-calc.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const fmtQtdInput = v => String(arredonda(v, 2));

/**
 * ADAPTADOR DE APRESENTAÇÃO — o único lugar que traduz o item do banco para o
 * que o profissional lê. Quem mostra alimento chama isto; ninguém recalcula.
 *
 * Os três conceitos que não podem se misturar:
 *
 *   quantidade  o número prescrito NA MEDIDA escolhida  (2)
 *   medida      o nome da unidade                        ("unidade média")
 *   peso        o peso final em gramas                   (90 g)
 *
 * O banco guarda `quantidade` como múltiplo de 100 g — valor interno, que NUNCA
 * deve aparecer na tela. A reconstrução é toda de dieta-calc.js (`medidaDoItem`,
 * que por sua vez usa `pesoDeItem`); aqui não há uma única conta.
 *
 * O caso que exige cuidado: o item tem uma medida salva ("unidade média") que
 * não existe mais em food_measures. `medidaDoItem` cai para gramas, e é o certo
 * a fazer no cálculo — mas exibir "gramas" seria afirmar que a prescrição é em
 * gramas, o que é falso. Nesse caso a quantidade vem `null` (some da tela como
 * "—") e a medida mostra o nome salvo, com `medidaConhecida: false` para quem
 * quiser sinalizar.
 *
 * @returns {{quantidade: string|null, medida: string, peso: number,
 *            pesoTexto: string, medidaConhecida: boolean, substituicoes: number}}
 */
export function itemParaResumo(item, medidas = []) {
  const sel = medidaDoItem(medidas, item);
  const salva = String(item?.medida ?? '').trim();
  const temMedidaPropria = !!salva && salva !== MEDIDA_GRAMAS;
  const conhecida = !temMedidaPropria
    || (medidas || []).some(m => m.descricao === salva && Number(m.gramas) > 0);

  return {
    quantidade: conhecida ? fmtQtd(sel.n) : null,
    medida: conhecida
      ? (sel.medida === MEDIDA_GRAMAS ? 'gramas' : sel.medida)
      : salva,
    peso: sel.gramas,
    // O projeto só representa peso: food_measures tem `gramas`, não unidade.
    // Uma medida em ml carrega o "ml" no próprio nome, e o peso segue em g.
    pesoTexto: `${fmtG(sel.gramas)} g`,
    medidaConhecida: conhecida,
    substituicoes: substituicoesDoItem(item).length,
  };
}

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

// ── Lista de alimentos (Nível 2: dentro do drawer da refeição) ──────────────
// "Visualizar todos, editar um por vez."
//
// Antes, TODO alimento carregava 9 controles interativos ao mesmo tempo: campo
// de quantidade, seletor de medida, seis botões e mais o campo de observação.
// Numa refeição de seis alimentos eram ~54 alvos disputando a mesma tela — daí
// a sensação de texto amontoado.
//
// Agora o padrão é o estado COMPACTO (leitura, 2 ações) e só o alimento
// escolhido entra em EDIÇÃO. `ctx.editando` diz qual é.
export function listaAlimentosHtml(itens, ctx = {}) {
  if (!itens?.length) {
    return `
      <div class="al-vazio">
        <i data-lucide="utensils-crossed" aria-hidden="true"></i>
        <span>Nenhum alimento nesta refeição.</span>
      </div>`;
  }
  return `
    <ul class="al-lista" role="list">
      ${itens.map((it, i) => alimentoItemHtml(it, i, itens.length, ctx)).join('')}
    </ul>`;
}

/** Menu "mais ações" — o mesmo nos dois estados. */
function menuItemHtml(it, i, total, nome) {
  return `
    <div class="di-menu-wrap">
      <button class="al-btn" data-item-menu="${it.id}" aria-haspopup="menu" aria-expanded="false"
              title="Mais ações" aria-label="Mais ações de ${esc(nome)}">
        <i data-lucide="ellipsis-vertical"></i>
      </button>
      <div class="di-menu" data-item-menu-pop="${it.id}" role="menu" hidden>
        <button role="menuitem" data-item-subs="${it.id}"><i data-lucide="repeat-2"></i> Administrar substituições</button>
        <button role="menuitem" data-item-obs="${it.id}"><i data-lucide="message-square-plus"></i> Adicionar observação</button>
        <button role="menuitem" data-item-dup="${it.id}"><i data-lucide="copy"></i> Duplicar alimento</button>
        <button role="menuitem" data-item-up="${it.id}" ${i === 0 ? 'disabled' : ''}><i data-lucide="chevron-up"></i> Mover para cima</button>
        <button role="menuitem" data-item-down="${it.id}" ${i === total - 1 ? 'disabled' : ''}><i data-lucide="chevron-down"></i> Mover para baixo</button>
        <button role="menuitem" data-item-del="${it.id}" class="perigo"><i data-lucide="trash-2"></i> Excluir alimento</button>
      </div>
    </div>`;
}

/** Macros da segunda linha: informação secundária, tabular, sem destaque. */
function macrosLinhaHtml(mm, nSubs, id) {
  return `
    <div class="al-sec">
      <span class="al-macros">
        <b>${fmtKcal(mm.kcal)}</b> kcal
        <span>P ${fmtG(mm.prot)}</span>
        <span>C ${fmtG(mm.carb)}</span>
        <span>G ${fmtG(mm.gord)}</span>
      </span>
      ${nSubs ? `
        <button class="al-chip" data-item-subs="${id}"
                title="Ver as ${nSubs} substituições deste alimento">
          ${nSubs} ${nSubs === 1 ? 'substituição' : 'substituições'}
        </button>` : ''}
    </div>`;
}

export function alimentoItemHtml(it, i, total, ctx = {}) {
  const f = it.food || {};
  const mm = macrosItem(it);
  const medidas = ctx.medidasDe?.get(it.food_id) || [];
  const sel = medidaDoItem(medidas, it);
  const nome = f.nome || '(alimento removido)';
  const obs = String(it.observacao ?? '').trim();
  const nSubs = substituicoesDoItem(it).length;
  const editando = ctx.editando === it.id;
  const v = itemParaResumo(it, medidas);

  if (!editando) {
    // ── COMPACTO ──────────────────────────────────────────────────────────
    // Duas linhas, quatro colunas, DUAS ações. Quantidade, medida e peso são
    // texto: viram campo só quando o alimento entra em edição.
    return `
      <li class="al-item" data-item-row="${it.id}">
        <div class="al-topo">
          <div class="al-id">
            <span class="al-nome" title="${esc(nome)}">${esc(nome)}</span>
            ${badgeFonteHtml(f)}
          </div>
          <span class="al-qtd-txt">${v.quantidade ?? '—'}</span>
          <span class="al-med-txt" title="${esc(v.medida)}">${esc(v.medida)}</span>
          <span class="al-peso">${v.pesoTexto}</span>
          <div class="al-acts">
            <button class="al-btn al-btn-editar" data-item-editar="${it.id}"
                    title="Editar ${esc(nome)}" aria-label="Editar ${esc(nome)}" aria-expanded="false">
              <i data-lucide="pencil"></i>
            </button>
            ${menuItemHtml(it, i, total, nome)}
          </div>
        </div>
        ${macrosLinhaHtml(mm, nSubs, it.id)}
        ${obs ? `<p class="al-obs-txt" title="${esc(obs)}"><i data-lucide="message-square-text" aria-hidden="true"></i>${esc(obs)}</p>` : ''}
      </li>`;
  }

  // ── EDIÇÃO ──────────────────────────────────────────────────────────────
  // Só um alimento chega aqui por vez. Os campos aparecem porque é o momento
  // em que eles servem para alguma coisa.
  const opcoes = [
    `<option value="${MEDIDA_GRAMAS}" ${sel.medida === MEDIDA_GRAMAS ? 'selected' : ''}>gramas</option>`,
    ...medidas.map(m =>
      `<option value="${esc(m.descricao)}" ${sel.medida === m.descricao ? 'selected' : ''}>${esc(m.descricao)}</option>`),
  ].join('');

  return `
    <li class="al-item al-item-edit" data-item-row="${it.id}">
      <div class="al-edit-hd">
        <span class="al-nome" title="${esc(nome)}">${esc(nome)}</span>
        ${badgeFonteHtml(f)}
        <div class="al-acts">
          ${menuItemHtml(it, i, total, nome)}
          <button class="al-btn al-btn-fechar" data-item-fechar="${it.id}"
                  title="Concluir edição (Esc)" aria-label="Concluir edição de ${esc(nome)}" aria-expanded="true">
            <i data-lucide="check"></i>
          </button>
        </div>
      </div>

      <div class="al-campos">
        <label class="al-campo">
          <span>Quantidade</span>
          <input type="number" step="0.25" min="0" inputmode="decimal" class="al-inp"
                 value="${fmtQtdInput(sel.n)}" data-item-qtd="${it.id}"
                 aria-label="Quantidade de ${esc(nome)}">
        </label>
        <label class="al-campo">
          <span>Medida</span>
          <select class="al-sel" data-item-med="${it.id}" aria-label="Medida de ${esc(nome)}"
                  ${medidas.length ? '' : 'title="Este alimento ainda não tem medidas caseiras."'}>
            ${opcoes}
          </select>
        </label>
        <div class="al-campo al-campo-ro">
          <span>Peso</span>
          <output>${v.pesoTexto}</output>
        </div>
      </div>

      ${macrosLinhaHtml(mm, nSubs, it.id)}

      <label class="al-campo al-campo-obs">
        <span>Observação para o paciente</span>
        <input type="text" class="al-inp" value="${esc(obs)}"
               data-item-campo="observacao" data-item-id="${it.id}"
               placeholder="Ex.: preparar grelhado, sem óleo">
      </label>
    </li>`;
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

  // Um alimento por vez em edição: quem abre, fecha o anterior (quem decide é
  // o dono do estado, em dieta-refeicao.js).
  cada('[data-item-editar]', b => b.addEventListener('click', () => acoes.editar?.(b.dataset.itemEditar)));
  cada('[data-item-fechar]', b => b.addEventListener('click', () => acoes.fecharEdicao?.()));
}
