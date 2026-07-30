// ═══════════════════════════════════════════════════════════
// DIETA — NÍVEL 2: drawer de edição da refeição
// ═══════════════════════════════════════════════════════════
// A tela principal (Nível 1) organiza a rotina; a edição acontece aqui.
// Quatro seções, na ordem em que o nutri trabalha:
//
//   1. Informações — nome, horário, tipo
//   2. Alimentos   — a lista, com quantidade editável e ações por item
//   3. Resumo      — kcal, macros, fibra e peso total desta refeição
//   4. Observações — recolhido, porque na maioria das refeições não existe
//
// O drawer NÃO é modal de tela cheia: ocupa ~50% e o resto da rotina continua
// visível atrás. Trocar de refeição sem fechar é parte do fluxo.
//
// Este módulo não busca nada e não escreve nada: recebe a refeição e uma `api`
// com os callbacks de quem é dono do estado. Todos os números vêm de
// dieta-calc.js — aqui não há uma única conta.

import { listaAlimentosHtml, ligarItens } from './dieta-linha.js';
import { macrosRefeicao, pesoRefeicao, fmtKcal, fmtG } from './dieta-calc.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const hhmm = (h) => (h ? String(h).slice(0, 5) : '');

let _refId = null;
let _api = null;
let _obsAberta = false;
let _editando  = null;   // id do alimento em edição — no máximo um por vez
let _onTecla = null;

export const refeicaoAberta = () => _refId;

/**
 * @param {string} refId
 * @param {object} api
 *   refeicao(id) · medidasDe: Map · rerender() · fechar()
 *   acoesItem: objeto no contrato de ligarItens()
 *   onAdicionar(refId) · onDuplicar(refId) · onExcluir(refId) · onCampo(el)
 */
export function abrirRefeicao(refId, api) {
  const trocou = _refId && _refId !== refId;
  _refId = refId;
  _api = api;
  _obsAberta = !!(api.refeicao(refId)?.observacao || '').trim();
  _editando = null;
  // Trocar de refeição com a busca aberta deixaria uma busca da refeição
  // anterior pendurada — e ela reapareceria como painel lateral.
  if (trocou) api.aoFechar?.();

  if (!_onTecla) {
    // Esc fecha — menos quando o foco está num campo, onde Esc é do campo.
    _onTecla = (e) => {
      if (e.key !== 'Escape' || !_refId) return;
      // Esc é em camadas: primeiro sai da edição do alimento, depois fecha o
      // drawer. Sair de tudo de uma vez faria quem só queria desistir de um
      // campo perder a refeição inteira de vista.
      if (_editando) { e.preventDefault(); fecharEdicaoItem(); return; }
      const alvo = e.target;
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.tagName === 'SELECT')) return;
      e.preventDefault();
      fecharRefeicao();
    };
    document.addEventListener('keydown', _onTecla, true);
  }
  _api.rerender();
}

export function fecharRefeicao() {
  const api = _api;
  _refId = null;
  _obsAberta = false;
  _editando = null;
  if (_onTecla) { document.removeEventListener('keydown', _onTecla, true); _onTecla = null; }

  // A busca embutida pertence a ESTE painel. Sem fechá-la junto, o estado dela
  // sobrevive sem dono — e, como não há mais drawer para hospedá-la, ela
  // reabre sozinha como painel lateral ("Adicionar em ...").
  //
  // `aoFechar` devolve true quando já redesenhou; sem isso seriam dois renders
  // para o mesmo fechamento.
  if (!api?.aoFechar?.()) api?.rerender();
}

/** Abre a edição de UM alimento; fecha automaticamente a anterior. */
export function editarItem(id) {
  _editando = (_editando === id) ? null : id;
  _api?.rerender();
  if (_editando) {
    // O campo de quantidade é o motivo de 9 em 10 aberturas.
    const campo = document.querySelector(`[data-item-qtd="${_editando}"]`);
    campo?.focus?.(); campo?.select?.();
  }
}

export function fecharEdicaoItem() {
  if (!_editando) return;
  _editando = null;
  _api?.rerender();
}

export const itemEmEdicao = () => _editando;

// ── HTML ────────────────────────────────────────────────────
export function drawerRefeicaoHtml(r, ctx = {}) {
  if (!r) return '';
  const itens = r.itens || [];
  const m = macrosRefeicao(r);
  const peso = pesoRefeicao(r);
  const obs = String(r.observacao ?? '').trim();

  const dado = (rotulo, valor, unidade) => `
    <div class="rf-dado">
      <span class="rf-dado-lbl">${rotulo}</span>
      <span class="rf-dado-val">${valor}${unidade ? `<em>${unidade}</em>` : ''}</span>
    </div>`;

  // SEM backdrop. Um <div fixed inset:0> aqui cobria a tela inteira — barra de
  // ferramentas, botões de salvar e os outros cards — e todo clique fora virava
  // "fechar". O painel é de edição contínua, não modal: fecha pelo X, pelo
  // Concluir, pelo Esc ou abrindo outra refeição. A separação visual vem da
  // sombra e da borda, que não bloqueiam clique nenhum.
  return `
    <aside class="rf-drawer" role="dialog" aria-modal="false" aria-labelledby="rfTitulo">

      <header class="rf-hd">
        <div class="rf-hd-txt">
          <div class="rf-eyebrow">Editando refeição</div>
          <h2 class="rf-tit" id="rfTitulo">${esc(r.nome || 'Refeição')}</h2>
        </div>
        <button class="di-iact" data-rf-fechar title="Fechar (Esc)" aria-label="Fechar">
          <i data-lucide="x"></i>
        </button>
      </header>

      <div class="rf-body">

        <section class="rf-secao">
          <h3 class="rf-secao-tit">Informações</h3>
          <div class="rf-campos">
            <div class="rf-campo rf-campo-nome">
              <label for="rfNome">Nome</label>
              <!-- Campo livre COM sugestões. O <input list> do datalist não
                   abre no clique na maioria dos navegadores (só ao digitar ou
                   com a seta), então o gatilho é um botão de verdade. -->
              <div class="rf-nome-wrap">
                <input type="text" id="rfNome" class="np-input" value="${esc(r.nome || '')}"
                       data-ref-campo="nome" data-ref-id="${r.id}"
                       placeholder="Ex.: Café da manhã" autocomplete="off">
                <button class="rf-nome-btn" data-rf-nomes aria-haspopup="menu" aria-expanded="false"
                        title="Escolher um nome comum" aria-label="Escolher um nome comum de refeição">
                  <i data-lucide="chevron-down"></i>
                </button>
                <div class="di-menu rf-nome-menu" data-rf-nomes-pop role="menu" hidden>
                  ${(ctx.sugestoesNome || []).map(n => `
                    <button role="menuitem" data-rf-nome-opcao="${esc(n)}">${esc(n)}</button>`).join('')}
                </div>
              </div>
            </div>
            <div class="rf-campo">
              <label for="rfHora">Horário</label>
              <input type="time" id="rfHora" class="np-input" value="${esc(hhmm(r.horario))}"
                     data-ref-campo="horario" data-ref-id="${r.id}">
            </div>
          </div>
        </section>

        <!-- Adicionar alimento em linha própria, entre duas divisórias: a ação
             pertence a esta refeição, que já está aberta. Empilhar um segundo
             painel lateral por cima do primeiro escondia o que se está editando. -->
        <!-- Área de inclusão: uma superfície só, sempre no mesmo lugar. Fechada,
             mostra o botão; aberta, a busca cresce DENTRO dela. Assim o "onde
             se adiciona alimento" não muda de posição nem de identidade visual
             entre os dois estados. -->
        <div class="rf-add-area ${ctx.buscaHtml ? 'aberta' : ''}">
          ${ctx.buscaHtml || `
            <button class="rf-add" data-rf-add title="Adicionar alimento (Ctrl+K)" aria-expanded="false">
              <i data-lucide="plus"></i> Alimento
            </button>`}
        </div>

        <section class="rf-secao rf-secao-lista ${ctx.buscaHtml ? 'apos-busca' : ''}">
          <div class="rf-secao-hd">
            <h3 class="rf-secao-tit rf-secao-tit-forte">
              Alimentos <span class="rf-conta">${itens.length} ${itens.length === 1 ? 'item' : 'itens'}</span>
            </h3>
          </div>
          ${listaAlimentosHtml(itens, { ...ctx, editando: _editando })}
        </section>

        <section class="rf-secao">
          <h3 class="rf-secao-tit">Resumo desta refeição</h3>
          <!-- Um container só, dividido por dentro. Seis cards com borda e
               sombra próprias faziam o resumo pesar mais que a lista. -->
          <div class="rf-resumo">
            ${dado('Calorias', fmtKcal(m.kcal), 'kcal')}
            ${dado('Proteína', fmtG(m.prot), 'g')}
            ${dado('Carboidrato', fmtG(m.carb), 'g')}
            ${dado('Gordura', fmtG(m.gord), 'g')}
            ${dado('Fibra', fmtG(m.fibra), 'g')}
            ${dado('Peso total', fmtG(peso), 'g')}
          </div>
        </section>

        <section class="rf-secao">
          <button class="rf-obs-toggle" data-rf-obs aria-expanded="${_obsAberta}">
            <i data-lucide="chevron-${_obsAberta ? 'down' : 'right'}" aria-hidden="true"></i>
            <span class="rf-obs-txt">
              <span class="rf-obs-tit">Observações da refeição</span>
              <span class="rf-obs-sub">${!_obsAberta && obs
                ? `${esc(obs.slice(0, 70))}${obs.length > 70 ? '…' : ''}`
                : 'Adicionar orientações, preparo ou informações ao paciente.'}</span>
            </span>
          </button>
          ${_obsAberta ? `
            <textarea class="np-input rf-obs" rows="4" data-ref-campo="observacao" data-ref-id="${r.id}"
                      placeholder="O que o paciente precisa saber sobre esta refeição.">${esc(obs)}</textarea>` : ''}
        </section>
      </div>

      <footer class="rf-ft">
        <button class="rf-ft-btn" data-rf-duplicar title="Duplicar esta refeição">
          <i data-lucide="copy-plus"></i><span>Duplicar</span>
        </button>
        <button class="rf-ft-btn rf-excluir" data-rf-excluir title="Excluir esta refeição">
          <i data-lucide="trash-2"></i><span>Excluir</span>
        </button>
        <button class="rf-ft-ok" data-rf-fechar>Concluir</button>
      </footer>
    </aside>`;
}

// ── Eventos ─────────────────────────────────────────────────
export function ligarRefeicaoDrawer(cont) {
  const r = _api?.refeicao(_refId);
  if (!r) return;

  cont.querySelectorAll('[data-rf-fechar]').forEach(b =>
    b.addEventListener('click', fecharRefeicao));

  cont.querySelectorAll('[data-ref-campo]').forEach(el =>
    el.addEventListener('change', () => _api.onCampo(el)));

  cont.querySelector('[data-rf-add]')?.addEventListener('click', () => _api.onAdicionar(_refId));

  // Sugestões de nome: menu de verdade, porque datalist não abre no clique.
  const btnNomes = cont.querySelector('[data-rf-nomes]');
  const popNomes = cont.querySelector('[data-rf-nomes-pop]');
  if (btnNomes && popNomes) {
    btnNomes.addEventListener('click', () => _api.abrirMenu?.(btnNomes, popNomes));
    popNomes.querySelectorAll('[data-rf-nome-opcao]').forEach(b =>
      b.addEventListener('click', () => {
        const campo = cont.querySelector('[data-ref-campo="nome"]');
        if (!campo) return;
        campo.value = b.dataset.rfNomeOpcao;
        popNomes.hidden = true;
        btnNomes.setAttribute('aria-expanded', 'false');
        // `change` é o mesmo evento que o campo dispara ao ser digitado: o
        // caminho de salvamento continua sendo um só.
        campo.dispatchEvent(new Event('change', { bubbles: true }));
      }));
  }
  cont.querySelector('[data-rf-duplicar]')?.addEventListener('click', () => _api.onDuplicar(_refId));
  cont.querySelector('[data-rf-excluir]')?.addEventListener('click', () => _api.onExcluir(_refId));

  cont.querySelector('[data-rf-obs]')?.addEventListener('click', () => {
    _obsAberta = !_obsAberta;
    _api.rerender();
    if (_obsAberta) cont.ownerDocument?.querySelector('.rf-obs')?.focus();
  });

  ligarItens(cont, _api.acoesItem);
}
