// ═══════════════════════════════════════════════════════════
// DIETA — painel de substituições (LEITURA)
// ═══════════════════════════════════════════════════════════
// Mostra, sem sair da tela, o que está gravado em
// `refeicao_itens.substituicoes` — o jsonb que o gerador preenche.
//
// SOMENTE LEITURA, e o painel diz isso na cara: o formato atual não tem
// food_id, nem critério de equivalência, nem confirmação do profissional.
// Oferecer edição em cima dele seria gravar decisão clínica numa estrutura que
// não sabe registrar quem confirmou o quê. A edição chega na Etapa 2, junto da
// migração para tabela própria.
//
// Este arquivo é o lugar onde a Etapa 2 cresce: o painel já tem cabeçalho,
// lista, foco e fechamento — falta o que só a estrutura nova permite.

import { substituicoesDoItem } from './dieta-linha.js';
import { macrosItem, medidaDoItem, fmtG, fmtKcal } from './dieta-calc.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let _el = null;
let _origem = null;      // quem abriu (recebe o foco de volta)
let _onTecla = null;

export const substituicoesAbertas = () => _el != null;

/**
 * @param {object} item   linha da prescrição (com .food e .substituicoes)
 * @param {object} ctx    { medidasDe: Map, origem?: Element }
 */
export function abrirSubstituicoes(item, ctx = {}) {
  fecharSubstituicoes();
  if (!item) return;

  _origem = ctx.origem || document.activeElement;
  const subs = substituicoesDoItem(item);
  const f = item.food || {};
  const medidas = ctx.medidasDe?.get(item.food_id) || [];
  const sel = medidaDoItem(medidas, item);
  const m = macrosItem(item);

  _el = document.createElement('div');
  _el.className = 'di-sb-wrap';
  _el.innerHTML = `
    <div class="di-sb-fundo" data-sb-fechar></div>
    <aside class="di-sb" role="dialog" aria-modal="true" aria-labelledby="diSbTit">
      <header class="di-sb-hd">
        <div class="di-sb-hd-txt">
          <div class="di-sb-eyebrow">Substituições de</div>
          <h2 class="di-sb-tit" id="diSbTit">${esc(f.nome || 'alimento')}</h2>
          <div class="di-sb-hd-sub">
            ${sel.medida === 'g'
              ? `${fmtG(sel.gramas)} g`
              : `${fmtG(sel.n)} ${esc(sel.medida)} · ${fmtG(sel.gramas)} g`}
            · ${fmtKcal(m.kcal)} kcal · P ${fmtG(m.prot)} · C ${fmtG(m.carb)} · G ${fmtG(m.gord)}
          </div>
        </div>
        <button class="di-iact" data-sb-fechar title="Fechar (Esc)" aria-label="Fechar">
          <i data-lucide="x"></i>
        </button>
      </header>

      <div class="di-sb-body">
        ${subs.length ? `
          <ol class="di-sb-lista">
            ${subs.map((s, i) => `
              <li class="di-sb-op">
                <span class="di-sb-op-n">${i + 1}</span>
                <span class="di-sb-op-nome">${esc(s.nome)}</span>
                ${s.detalhe ? `<span class="di-sb-op-qtd">${esc(s.detalhe)}</span>` : ''}
              </li>`).join('')}
          </ol>
          <p class="di-sb-nota">
            <i data-lucide="info" aria-hidden="true"></i>
            Estas alternativas vieram do gerador de dieta, equiparadas por calorias
            dentro do mesmo grupo alimentar. Ainda não é possível editá-las por aqui —
            a edição, a equivalência confirmada e a diferença nutricional entram na
            próxima etapa.
          </p>`
        : `
          <div class="di-sb-vazio">
            <i data-lucide="repeat-2" aria-hidden="true"></i>
            <div class="di-sb-vazio-t">Nenhuma substituição cadastrada</div>
            <div class="di-sb-vazio-s">Este alimento não tem alternativas gravadas. Criar substituições pela tela chega na próxima etapa.</div>
          </div>`}
      </div>
    </aside>`;

  document.body.appendChild(_el);
  _el.querySelectorAll('[data-sb-fechar]').forEach(b =>
    b.addEventListener('click', fecharSubstituicoes));

  _onTecla = (e) => { if (e.key === 'Escape') { e.preventDefault(); fecharSubstituicoes(); } };
  document.addEventListener('keydown', _onTecla, true);

  window.renderIcons?.();
  _el.querySelector('[data-sb-fechar]')?.focus?.();
}

export function fecharSubstituicoes() {
  if (_onTecla) document.removeEventListener('keydown', _onTecla, true);
  _onTecla = null;
  _el?.remove();
  _el = null;
  // Devolve o foco a quem abriu: quem navega por teclado não perde o lugar.
  try { _origem?.focus?.(); } catch {}
  _origem = null;
}
