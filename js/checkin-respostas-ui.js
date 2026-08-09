// ═══════════════════════════════════════════════════════════
// CHECK-INS — a leitura de uma resposta
// ═══════════════════════════════════════════════════════════
// A REGRA QUE ESTE ARQUIVO EXISTE PARA CUMPRIR:
//
// A tela de uma resposta antiga é montada com o SNAPSHOT da ocorrência, nunca
// com `checkin_perguntas`. Se lesse a pergunta de hoje, editar o modelo
// mudaria visualmente o passado — "Como está sua fome?" viraria "Como está sua
// fome à noite?" sobre uma resposta dada antes de a pergunta existir assim.
//
// O snapshot dá o TEXTO de então; `checkin_respostas.pergunta_id` casa o valor
// com a pergunta certa. Nenhuma consulta a `checkin_perguntas` aqui — há teste
// que falha se aparecer uma.

import { situacaoDaOcorrencia, SITUACAO_ROTULO, diasDeAtraso } from './checkin.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function dataHoraBR(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('pt-BR')} às ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const dataBR = (iso) => {
  const s = String(iso || '').slice(0, 10).split('-');
  return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : '';
};

/**
 * O valor pronto para leitura, no formato do TIPO DO SNAPSHOT.
 *
 * Usa `pergunta.tipo` do snapshot e não o tipo de hoje: se a pergunta virou
 * outro tipo depois, a resposta antiga continua sabendo como se ler.
 */
export function valorLegivel(pergunta, resposta) {
  if (!resposta || resposta.valor === null || resposta.valor === undefined) return '—';
  const v = resposta.valor;
  const cfg = pergunta?.configuracao || {};

  switch (pergunta?.tipo) {
    case 'escala':
      return `${v} / ${cfg.max ?? 10}`;
    case 'numero':
      return cfg.unidade ? `${String(v).replace('.', ',')} ${cfg.unidade}`
                         : String(v).replace('.', ',');
    case 'sim_nao':
      return v ? 'Sim' : 'Não';
    case 'multipla_escolha':
      return String(v);
    default:
      return String(v);
  }
}

/** A diferença para a ocorrência anterior — só onde comparar faz sentido. */
export function comparar(pergunta, atual, anterior) {
  if (!['escala', 'numero'].includes(pergunta?.tipo)) return null;
  if (!atual || !anterior) return null;
  const a = Number(atual.valor), b = Number(anterior.valor);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const delta = Number((a - b).toFixed(2));
  return {
    anterior: b,
    delta,
    // Sem juízo de valor: menos fome pode ser bom ou ruim, e a tela não tem
    // como saber. Mostra o número e deixa a leitura com quem entende do caso.
    texto: delta === 0 ? 'igual' : `${delta > 0 ? '+' : ''}${String(delta).replace('.', ',')}`,
  };
}

/** Uma linha do drawer: a pergunta como ela era, e o que foi respondido. */
export function linhaRespostaHtml(pergunta, resposta, comparacao) {
  return `
    <div class="ck-resp-linha">
      <div class="ck-resp-pergunta">${esc(pergunta.texto)}</div>
      <div class="ck-resp-valor">
        ${esc(valorLegivel(pergunta, resposta))}
        ${comparacao ? `
          <span class="ck-resp-delta">
            anterior ${esc(String(comparacao.anterior).replace('.', ','))}
            <b>${esc(comparacao.texto)}</b>
          </span>` : ''}
      </div>
    </div>`;
}

/**
 * O corpo do drawer.
 *
 * `respostas` e `anteriores` são mapas por `pergunta_id`. A ordem é a do
 * SNAPSHOT — não a de `criado_em` da resposta, que reflete a ordem em que o
 * paciente digitou.
 */
export function corpoRespostasHtml(ocorrencia, respostas = {}, anteriores = {}) {
  const snap = ocorrencia?.snapshot || {};
  const perguntas = snap.perguntas || [];
  const sit = situacaoDaOcorrencia(ocorrencia);

  if (!perguntas.length) {
    return '<p class="ck-vazio-txt">Este check-in não tem perguntas registradas.</p>';
  }

  const respondido = ocorrencia.status === 'respondido';
  return `
    <div class="ck-resp-cab">
      <div class="ck-resp-modelo">${esc(snap.modelo?.nome || 'Check-in')}</div>
      <div class="ck-resp-meta">
        <span class="ck-badge ck-s-${esc(sit)}">${esc(SITUACAO_ROTULO[sit] || sit)}</span>
        ${respondido
          ? `<span>Respondido em ${esc(dataHoraBR(ocorrencia.respondido_em))}</span>`
          : ocorrencia.prazo_em
            ? `<span>Prazo ${esc(dataBR(ocorrencia.prazo_em))}</span>` : ''}
        ${sit === 'atrasado' ? `<span class="ck-atraso">há ${diasDeAtraso(ocorrencia)} dia(s)</span>` : ''}
      </div>
    </div>

    ${respondido ? `
      <div class="ck-resp-lista">
        ${perguntas.map(p =>
          linhaRespostaHtml(p, respostas[p.id], comparar(p, respostas[p.id], anteriores[p.id]))).join('')}
      </div>`
    : `
      <p class="ck-vazio-txt">Ainda não respondido. As perguntas deste check-in são:</p>
      <div class="ck-resp-lista">
        ${perguntas.map(p => `
          <div class="ck-resp-linha">
            <div class="ck-resp-pergunta">${esc(p.texto)}</div>
            <div class="ck-resp-valor ck-resp-vazio">—</div>
          </div>`).join('')}
      </div>`}`;
}

export function drawerRespostasHtml(ocorrencia, respostas, anteriores) {
  return `
    <div class="ck-drawer-raiz" data-raiz>
      <div class="ck-drawer" role="dialog" aria-modal="true" aria-label="Respostas do check-in">
        <div class="ck-drawer-topo">
          <h2>Check-in</h2>
          <button type="button" class="ck-drawer-x" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
        </div>
        <div class="ck-drawer-corpo">
          ${corpoRespostasHtml(ocorrencia, respostas, anteriores)}
        </div>
        <div class="ck-drawer-pe">
          <button type="button" class="btn-sm btn-sm-secondary" data-fechar>Fechar</button>
        </div>
      </div>
    </div>`;
}

/** Mapa `pergunta_id -> resposta`, para casar com a ordem do snapshot. */
export const porPergunta = (respostas = []) =>
  Object.fromEntries((respostas || []).map(r => [r.pergunta_id, r]));

/**
 * Abre a leitura. `carregar` é injetável para o teste rodar sem rede.
 *
 * Repare no que ele busca: as respostas DESTA ocorrência e as da ANTERIOR do
 * mesmo modelo. Em nenhum momento consulta a pergunta atual.
 */
export async function abrirRespostas({ ocorrencia, carregar, aoFechar }) {
  const el = document.createElement('div');
  document.body.appendChild(el);

  const fechar = () => { document.removeEventListener('keydown', onKey); el.remove(); aoFechar?.(); };
  const onKey = (e) => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', onKey);

  let respostas = {}, anteriores = {};
  try {
    const r = await carregar?.(ocorrencia);
    respostas = porPergunta(r?.respostas);
    anteriores = porPergunta(r?.anteriores);
  } catch (e) { console.error('[check-in] respostas', e); }

  el.innerHTML = drawerRespostasHtml(ocorrencia, respostas, anteriores);
  window.lucide?.createIcons?.();
  el.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', fechar));
  el.firstElementChild?.addEventListener('click', (e) => {
    if (e.target === el.firstElementChild) fechar();
  });
  return { fechar, el };
}
