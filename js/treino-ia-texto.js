// ═══════════════════════════════════════════════════════════
// O QUE A IA LÊ DO TREINO ATUAL E DAS CARGAS (Evoluir / Ajustar)
// ═══════════════════════════════════════════════════════════
// Puro (sem DOM, sem banco) para poder ser testado. Três buracos que existiam:
//   1. Das cargas, só a ÚLTIMA sessão ia — a IA não via tendência (estagnou?
//      vem subindo?). Agora vão as últimas SESSOES_POR_EXERCICIO, com data.
//   2. Do treino, só séries/reps/carga/método. Descanso, cadência, RIR, drop
//      e observação ficavam de fora — e a IA "evoluía" o que não via.
//   3. O exercício B do bi-set era filtrado: a IA via um exercício solto com
//      método "Bi-set" e sem par. Agora o par vai junto, como bloco.

export const SESSOES_POR_EXERCICIO = 4;

const curto = (s, n = 140) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/** "4x 8-12 · carga 40kg · descanso 90s · cadência 2-0-2 · RIR 1-2 · Drop-set (últimas 2) · obs: …" */
export function especificacao(it, { comMetodo = true, comDescanso = true } = {}) {
  const partes = [];
  const sr = [it.series ? `${it.series}x` : '', it.repeticoes || ''].filter(Boolean).join(' ');
  if (sr) partes.push(sr);
  if (it.carga) partes.push(`carga ${it.carga}`);
  if (comDescanso && it.descanso) partes.push(`descanso ${it.descanso}`);
  if (it.cadencia) partes.push(`cadência ${it.cadencia}`);
  if (it.rir) partes.push(`RIR ${it.rir}`);
  const metodo = String(it.metodo || '').trim();
  if (comMetodo && metodo && metodo !== 'Normal' && metodo.toLowerCase() !== 'bi-set') {
    partes.push(metodo.toLowerCase() === 'drop-set' && it.drop_ultimas ? `Drop-set (últimas ${it.drop_ultimas})` : metodo);
  }
  if (it.observacao) partes.push(`obs: ${curto(it.observacao)}`);
  return partes.join(' · ');
}

const nomeDe = it => it.exercicio?.nome || '(exercício)';

/** O B de um âncora, se houver. */
function parDe(itens, a) {
  return itens.find(x => x.grupo_pos === 'B' && x.grupo_id === a.id) || null;
}

/** Texto do treino atual, por dia, com bi-set como bloco (A + B). */
export function montarTextoTreino(itens) {
  const porDia = {};
  itens.filter(it => it.grupo_pos !== 'B')
    .sort((a, b) => String(a.dia).localeCompare(String(b.dia)) || (a.ordem ?? 0) - (b.ordem ?? 0))
    .forEach(it => { (porDia[it.dia] ||= []).push(it); });

  return Object.keys(porDia).sort().map(dia => {
    const linhas = porDia[dia].map((it, i) => {
      const b = parDe(itens, it);
      if (b) {
        const desc = it.descanso ? ` (descanso ${it.descanso} após o par)` : '';
        return `  ${i + 1}. Bi-set${desc}:\n` +
               `     A) ${nomeDe(it)} — ${especificacao(it, { comMetodo: false, comDescanso: false }) || 'sem especificação'}\n` +
               `     B) ${nomeDe(b)} — ${especificacao(b, { comMetodo: false, comDescanso: false }) || 'sem especificação'}`;
      }
      const spec = especificacao(it);
      return `  ${i + 1}. ${nomeDe(it)}${spec ? ` — ${spec}` : ''}`;
    }).join('\n');
    return `Dia ${dia}:\n${linhas}`;
  }).join('\n');
}

const dataBR = d => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? `${m[3]}/${m[2]}` : '?';
};

/** "60x10, 60x9" de uma sessão registrada; '' se a sessão não tem carga. */
export function textoSessao(reg) {
  const arr = Array.isArray(reg?.series_realizadas) ? reg.series_realizadas : [];
  if (arr.length) return arr.map(s => `${s.peso ?? '–'}x${s.reps ?? '–'}`).join(', ');
  if (reg?.carga_realizada != null) return `${reg.carga_realizada}kg x ${reg.reps_realizadas ?? '–'}`;
  return '';
}

// Carga de uma sessão: a maior carga usada e, nela, o total de repetições.
function cargaDaSessao(reg) {
  const arr = Array.isArray(reg?.series_realizadas) ? reg.series_realizadas : [];
  const series = arr.length ? arr.map(s => ({ peso: Number(s.peso), reps: Number(s.reps) }))
    : (reg?.carga_realizada != null ? [{ peso: Number(reg.carga_realizada), reps: Number(reg.reps_realizadas) }] : []);
  const validas = series.filter(s => Number.isFinite(s.peso));
  if (!validas.length) return null;
  const peso = Math.max(...validas.map(s => s.peso));
  const reps = validas.filter(s => s.peso === peso).reduce((t, s) => t + (Number.isFinite(s.reps) ? s.reps : 0), 0);
  return { peso, reps };
}

/**
 * Exercícios que ESTÃO EVOLUINDO — usados no "Novo ciclo" para continuar no
 * treino novo. Compara a sessão mais recente com a mais antiga das últimas
 * SESSOES_POR_EXERCICIO: subiu a carga, ou fez mais repetições com a mesma
 * carga. Precisa de pelo menos 2 sessões com carga. Devolve exercicio_id
 * (da biblioteca), sem repetir.
 */
export function exerciciosProgredindo(itens, regsPorItem) {
  const out = new Set();
  for (const it of itens) {
    const sessoes = (regsPorItem.get(it.id) || []).slice(0, SESSOES_POR_EXERCICIO).map(cargaDaSessao).filter(Boolean);
    if (sessoes.length < 2) continue;
    const recente = sessoes[0], antiga = sessoes[sessoes.length - 1];
    if (recente.peso > antiga.peso || (recente.peso === antiga.peso && recente.reps > antiga.reps)) {
      if (it.exercicio_id) out.add(it.exercicio_id);
    }
  }
  return [...out];
}

/**
 * Histórico de cargas por exercício (inclui o B dos bi-sets).
 * `regsPorItem`: Map(itemId → registros, mais recente primeiro).
 */
export function montarTextoProgressao(itens, regsPorItem) {
  const linhas = [];
  for (const it of itens) {
    const regs = (regsPorItem.get(it.id) || []).filter(r => textoSessao(r));
    if (!regs.length) continue;
    const sessoes = regs.slice(0, SESSOES_POR_EXERCICIO)
      .map(r => `${dataBR(r.data)}: ${textoSessao(r)}`).join(' | ');
    const papel = it.grupo_pos === 'B' ? ' (B do bi-set)' : '';
    linhas.push(`  - ${nomeDe(it)}${papel} — ${regs.length} sessões; mais recentes primeiro: ${sessoes}`);
  }
  return linhas.length ? linhas.join('\n') : 'O aluno ainda não registrou cargas.';
}
