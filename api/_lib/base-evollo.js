// ═══════════════════════════════════════════════════════════
// BASE DE TREINOS EVOLLO — escolher o modelo e convertê-lo para o aluno
// ═══════════════════════════════════════════════════════════
// Puro (recebe a base, a biblioteca e o inventário; não lê banco nem rede),
// para ser testado. Usado por api/gerar-treino.js no modo "criar".
//
// O FLUXO (decisão do Eduardo, 09/11/2026: "o sistema escolhe, a IA adapta")
//   1. escolherModelo: regras da seção 3 do "Prompt do gerador Evollo" —
//      nível → objetivo → frequência (igual ou a mais próxima para baixo) →
//      ênfase (ou Equilibrado) → duração mais perto do tempo; empate sorteia.
//   2. converterModelo: cada exercício da base vira o da biblioteca (pelo
//      nome mapeado); o que não cabe no inventário é trocado por outro da base
//      com o MESMO grupo, o MESMO tipo (C/I) e nível mínimo ≤ o do aluno, sem
//      repetir no dia (seção 4); bi-set e técnicas viram os métodos do app.
//   3. cortarPorTempo: pouco tempo → sai primeiro isolado do fim do dia, nunca
//      os primeiros multiarticulares; depois, 1 série a menos nos isolados.
// A IA só entra (no handler) quando há lesões/observações ou músculos
// priorizados — o resto é regra, e regra não precisa de IA.

import { recursosDoItem, requisitosDoExercicio } from '../../js/academia-compat.js';
import { familiaDe } from '../../js/treino-ia-biblioteca.js';

export const NIVEL_NUM = { 'Iniciante': 1, 'Intermediário': 2, 'Avançado': 3 };

const k = s => String(s || '').trim().toLowerCase();

/** Objetivo da tela → objetivo da base, conforme o nível (seção 3, item 2). */
export function objetivoDaBase(nivel, objetivo) {
  const o = k(objetivo);
  if (/emagrec|resist|condicion/.test(o)) return 'Emagrecimento/Resistência';
  if (/adapta/.test(o)) return nivel === 'Iniciante' ? 'Adaptação' : 'Hipertrofia';
  if (/for[cç]a/.test(o)) return nivel === 'Iniciante' ? 'Hipertrofia' : 'Força';
  return 'Hipertrofia';
}

const ENFASES = {
  equilibrado: 'Equilibrado',
  inferiores: 'Ênfase em inferiores e glúteos',
  superiores: 'Ênfase em superiores',
};

/**
 * Seção 3. Devolve { modelo, notas } — `notas` explica cada desvio do pedido
 * (ex.: "não há modelo de 5 dias para Intermediário; usado 4").
 */
export function escolherModelo(base, { nivel, objetivo, dias, enfase, tempoMin }, sortear = Math.random) {
  const notas = [];
  const nv = NIVEL_NUM[nivel] ? nivel : 'Iniciante';
  if (nv !== nivel) notas.push('Nível não informado: usado Iniciante.');
  let lista = base.treinos.filter(t => t.nivel === nv);

  const obj = objetivoDaBase(nv, objetivo);
  if (k(obj) !== k(objetivo) && objetivo) notas.push(`Objetivo "${objetivo}" para ${nv}: usado "${obj}".`);
  let porObj = lista.filter(t => t.objetivo === obj);
  if (!porObj.length) {
    porObj = lista.filter(t => t.objetivo === 'Hipertrofia');
    notas.push(`Não há modelo de "${obj}" para ${nv}: usado Hipertrofia.`);
  }
  lista = porObj;

  const freqs = [...new Set(lista.map(t => t.freq))].sort((a, b) => a - b);
  const d = Number(dias) || 3;
  const abaixo = freqs.filter(f => f <= d);
  const freq = abaixo.length ? Math.max(...abaixo) : Math.min(...freqs);
  if (freq !== d) {
    notas.push(abaixo.length
      ? `Não há modelo de ${d}x/semana para ${nv} em ${obj}: usado ${freq}x (o mais próximo para baixo).`
      : `Não há modelo de ${d}x/semana para ${nv} em ${obj}: usado ${freq}x (o menor disponível).`);
  }
  lista = lista.filter(t => t.freq === freq);

  const enf = ENFASES[enfase] || 'Equilibrado';
  let porEnf = lista.filter(t => t.enfase === enf);
  if (!porEnf.length) {
    porEnf = lista.filter(t => t.enfase === 'Equilibrado');
    if (enf !== 'Equilibrado') notas.push(`Não há modelo "${enf}" nessa combinação: usado Equilibrado.`);
  }
  if (!porEnf.length) porEnf = lista;
  lista = porEnf;

  const tempo = Number(tempoMin) || 0;
  if (tempo) {
    const dist = t => Math.abs(t.duracao - tempo);
    const melhor = Math.min(...lista.map(dist));
    lista = lista.filter(t => dist(t) === melhor);
  }
  // Empate: varia (seção 3, item 5 — "não entregue sempre o mesmo id").
  const modelo = lista[Math.min(lista.length - 1, Math.floor(sortear() * lista.length))];
  return { modelo, notas, candidatos: porEnf.length };
}

// ── técnicas da base → métodos do app ───────────────────────
export function metodoDaTecnica(tecnica) {
  const t = k(tecnica);
  if (!t) return { metodo: 'Normal' };
  if (t.startsWith('bi-set')) return { metodo: 'Bi-set' };
  if (t.startsWith('drop-set') || t.startsWith('série descendente') || t.startsWith('serie descendente')) return { metodo: 'Drop-set', drop_ultimas: 1 };
  if (t.startsWith('cluster')) return { metodo: 'Cluster' };
  if (t.startsWith('pirâmide') || t.startsWith('piramide')) return { metodo: 'Piramidal' };
  if (t.startsWith('rest-pause')) return { metodo: 'Rest-pause' };
  if (t.startsWith('fst-7')) return { metodo: 'FST-7' };
  if (t.includes('pausa de 2s')) return { metodo: 'Isometria' };
  return { metodo: 'Normal' };
}

/** Recursos disponíveis a partir do recorte do inventário enviado pelo front. */
export function recursosDoInventario(inventario) {
  if (!inventario?.disponiveis?.length) return null;
  const s = new Set();
  inventario.disponiveis.forEach(i => recursosDoItem(i).forEach(r => s.add(r)));
  return s;
}

const cabe = (ex, recursos) => !recursos || requisitosDoExercicio(ex).some(alt => alt.every(r => recursos.has(r)));

/**
 * Em qual estação/puxador do inventário o exercício é feito — para a linha
 * "Aparelho: …" que o aluno vê. A primeira alternativa que cabe manda.
 */
export function estacaoDoInventario(ex, inventario, recursos) {
  if (!inventario?.disponiveis?.length || !recursos) return {};
  const alt = requisitosDoExercicio(ex).find(a => a.every(r => recursos.has(r)));
  if (!alt || !alt.length) return {};
  const fornece = (i, r) => recursosDoItem(i).includes(r);
  const estacao = inventario.disponiveis.find(i => i.tipo !== 'puxador' && fornece(i, alt[0]))
    || inventario.disponiveis.find(i => i.tipo !== 'puxador' && alt.some(r => fornece(i, r)));
  const puxador = inventario.disponiveis.find(i => i.tipo === 'puxador' && alt.some(r => fornece(i, r)));
  return { equipamento_id: estacao?.id || '', acessorio_id: puxador?.id || '' };
}

/**
 * Seção 4 (trocas). `biblioteca`: [{ id, nome, grupo, equipamento }].
 * Devolve { dias, trocas, faltas } no formato do gerador (exercicio_id da
 * biblioteca, descanso "90s", metodo do app, par para bi-set).
 */
export function converterModelo(base, modelo, { biblioteca, inventario = null, nivel }) {
  const recursos = recursosDoInventario(inventario);
  const nivelNum = NIVEL_NUM[nivel] || 1;
  const porNome = new Map(biblioteca.map(e => [k(e.nome), e]));
  const libDe = baseId => porNome.get(k(base.exercicios[baseId]?.b)) || null;
  const trocas = [];
  const faltas = [];

  // Substitutos possíveis, na ordem da base (PE01, PE02…). Prefere um
  // movimento que o dia ainda não tem: trocar "Paralelas" num dia que já tem
  // três supinos por um quarto supino cumpre a regra e piora o treino.
  const nomePorId = new Map(biblioteca.map(e => [e.id, e.nome]));
  const substituto = (baseId, usados) => {
    const o = base.exercicios[baseId];
    const familiasDoDia = new Set([...usados].map(id => familiaDe(nomePorId.get(id))));
    const possiveis = [];
    for (const [id, e] of Object.entries(base.exercicios)) {
      if (id === baseId || id === 'CARDIO' || e.g !== o.g || e.t !== o.t || e.nm > nivelNum) continue;
      const lib = libDe(id);
      if (lib && !usados.has(lib.id) && cabe(lib, recursos)) possiveis.push({ id, lib });
    }
    return possiveis.find(p => !familiasDoDia.has(familiaDe(p.lib.nome))) || possiveis[0] || null;
  };

  // Resolve um exercício da base para um da biblioteca, trocando se preciso.
  const resolver = (baseId, usados, dia) => {
    const o = base.exercicios[baseId];
    const lib = libDe(baseId);
    if (lib && cabe(lib, recursos) && !usados.has(lib.id)) return { lib, baseId };
    const motivo = !lib ? 'não está na biblioteca' : usados.has(lib.id) ? 'repetido no dia' : 'não cabe no inventário da academia';
    const sub = substituto(baseId, usados);
    if (sub) {
      trocas.push(`Dia ${dia}: ${o.b} → ${sub.lib.nome} (${motivo}; mesmo grupo e tipo)`);
      return { lib: sub.lib, baseId: sub.id };
    }
    faltas.push(`Dia ${dia}: ${o.b} — ${motivo} e sem substituto do mesmo grupo/tipo; removido`);
    return null;
  };

  const descanso = s => (Number(s) > 0 ? `${Number(s)}s` : '');
  const obsDe = (tecnica, observacao) => {
    const t = /^bi-set/i.test(tecnica || '') ? '' : tecnica;
    return [t, observacao].filter(Boolean).join(' · ');
  };

  const dias = modelo.dias.map(d => {
    const usados = new Set();
    const exercicios = [];
    for (let i = 0; i < d.ex.length; i++) {
      const [id, series, reps, desc, tecnica, observacao] = d.ex[i];
      const ehA = /^bi-set com/i.test(tecnica) && !/2º exercício/i.test(tecnica);
      const a = resolver(id, usados, d.l);
      if (ehA) {
        const prox = d.ex[i + 1];
        i++;   // o B é consumido junto com o A
        const b = prox ? resolver(prox[0], new Set([...usados, ...(a ? [a.lib.id] : [])]), d.l) : null;
        if (a) usados.add(a.lib.id);
        if (b) usados.add(b.lib.id);
        if (a && b) {
          exercicios.push({
            exercicio_id: a.lib.id, series, repeticoes: reps, descanso: descanso(prox[3]), metodo: 'Bi-set',
            observacao: obsDe('', observacao), _tipo: base.exercicios[a.baseId].t,
            ...estacaoDoInventario(a.lib, inventario, recursos),
            par: { exercicio_id: b.lib.id, repeticoes: prox[2], observacao: obsDe('', prox[5]), ...estacaoDoInventario(b.lib, inventario, recursos) },
          });
        } else {
          // Um dos dois caiu: o que sobrou vira exercício normal, com o descanso do par.
          const s = a || b; const src = a ? d.ex[i - 1] : prox;
          if (s) exercicios.push({
            exercicio_id: s.lib.id, series: src[1], repeticoes: src[2], descanso: descanso(prox?.[3] || src[3]), metodo: 'Normal',
            observacao: obsDe('', src[5]), _tipo: base.exercicios[s.baseId].t, ...estacaoDoInventario(s.lib, inventario, recursos),
          });
        }
        continue;
      }
      if (!a) continue;
      usados.add(a.lib.id);
      const m = metodoDaTecnica(tecnica);
      exercicios.push({
        exercicio_id: a.lib.id, series, repeticoes: reps, descanso: descanso(desc),
        metodo: m.metodo === 'Bi-set' ? 'Normal' : m.metodo, ...(m.drop_ultimas ? { drop_ultimas: m.drop_ultimas } : {}),
        observacao: obsDe(tecnica, observacao), _tipo: base.exercicios[a.baseId].t,
        ...(id === 'CARDIO' ? { _cardio: true } : {}),
        ...estacaoDoInventario(a.lib, inventario, recursos),
      });
    }
    return { dia: d.l, foco: `${d.nome} (${d.grupos.join(', ')})`, exercicios, _dur: d.dur };
  });

  return { dias, trocas, faltas };
}

// ── seção 4: pouco tempo ───────────────────────────────────
const segundosDe = s => { const m = /(\d+)\s*s/.exec(String(s || '')); return m ? Number(m[1]) : 60; };

/** Minutos estimados do dia: cada série ~45 s + descanso (bi-set: 2×45 s); cardio pelo próprio tempo. */
export function minutosDoDia(exercicios) {
  let seg = 0;
  for (const e of exercicios) {
    const min = /(\d+)\s*min/.exec(String(e.repeticoes || ''));
    if (min && Number(e.series) <= 1) { seg += Number(min[1]) * 60; continue; }
    const s = Number(e.series) || 3;
    seg += s * ((e.par ? 90 : 45) + segundosDe(e.descanso));
  }
  return Math.round(seg / 60);
}

export function cortarPorTempo(dias, tempoMin) {
  const notas = [];
  const tempo = Number(tempoMin) || 0;
  if (!tempo) return notas;
  for (const d of dias) {
    const antes = minutosDoDia(d.exercicios);
    // 1º: tira isolados do FIM, preservando os dois primeiros exercícios.
    while (minutosDoDia(d.exercicios) > tempo) {
      let idx = -1;
      for (let i = d.exercicios.length - 1; i >= 2; i--) {
        // O cardio do emagrecimento é parte do modelo, não "isolado do fim".
        if (d.exercicios[i]._tipo === 'I' && !d.exercicios[i]._cardio) { idx = i; break; }
      }
      if (idx < 0) break;
      d.exercicios.splice(idx, 1);
    }
    // 2º: ainda passou? 1 série a menos nos isolados (mínimo 2).
    if (minutosDoDia(d.exercicios) > tempo) {
      d.exercicios.forEach(e => { if (e._tipo === 'I' && !e._cardio && Number(e.series) > 2) e.series = Number(e.series) - 1; });
    }
    const depois = minutosDoDia(d.exercicios);
    if (depois < antes) notas.push(`Dia ${d.dia}: ~${antes} → ~${depois} min para caber em ${tempo} min (isolados do fim removidos/reduzidos).`);
  }
  return notas;
}

/** Orientações finais (seção 5), iguais para todo treino gerado da base. */
export function orientacoes(nivel) {
  const rir = nivel === 'Iniciante' ? '2 a 3' : '1 a 2';
  return [
    'Aquecimento de 5 a 10 min + 1 a 2 séries leves do primeiro exercício.',
    'Progressão: ao completar o topo da faixa de repetições em todas as séries, aumentar a carga de 2 a 5% na sessão seguinte.',
    `Carga que deixe ${rir} repetições "na reserva".`,
    ...(nivel === 'Iniciante' ? [] : ['Semana mais leve (deload) a cada 6 a 8 semanas.']),
    'Trocar o treino a cada 6 a 10 semanas.',
  ].join('\n');
}
