// ═══════════════════════════════════════════════════════════
// AVALIAÇÃO FÍSICA — o que é medida válida, o que é ausência, o que é erro
// ═══════════════════════════════════════════════════════════
// Caso real (10/11/2026): uma avaliação com 98 kg de peso, 99 kg de massa
// magra e −1% de gordura. Origem: o protocolo de dobras devolveu fração de
// gordura NEGATIVA (dobras baixas demais ou digitadas na unidade errada), e
// calcularResultados() fez massa magra = peso − (−0,01 × peso). Nada conferia.
//
// Regras (pedido do Eduardo):
//   * gordura < 0% ou ≥ 100% é inválida;
//   * massa magra maior que o peso DA MESMA avaliação é inconsistente;
//   * ausência (null, ou 0 = "sem protocolo de dobras") NÃO é erro: é "não
//     registrado";
//   * valor inválido não entra em indicador, gráfico nem conta derivada — e o
//     dado histórico nunca é corrigido nem apagado sozinho.
//
// Funções puras: a gravação (avaliacoes.js) usa `conferirResultados` para
// recusar o erro novo; a Visão geral usa o resto para não exibir o antigo.

const n = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

// Faixas de plausibilidade de peso (kg): fora disso é quase sempre digitação.
export const PESO_MIN = 20;
export const PESO_MAX = 350;

/**
 * Situação de cada medida de UMA avaliação.
 * @returns {{
 *   peso:    'ok'|'ausente'|'invalida',
 *   gordura: 'ok'|'ausente'|'invalida',
 *   magra:   'ok'|'ausente'|'invalida',
 *   problemas: string[],          // frases para o profissional
 *   revisar: boolean,             // há algo inválido nesta avaliação
 * }}
 */
export function situacaoDaAvaliacao(av) {
  const problemas = [];
  const peso = n(av?.peso);
  const pct = n(av?.pct_gordura);          // fração (0,25 = 25%)
  const magra = n(av?.peso_magro);

  let sPeso = 'ausente';
  if (peso != null && peso !== 0) {
    sPeso = peso >= PESO_MIN && peso <= PESO_MAX ? 'ok' : 'invalida';
    if (sPeso === 'invalida') problemas.push(`Peso fora do esperado (${fmt(peso)} kg).`);
  }

  // 0 é "sem protocolo de dobras" (calcularResultados grava 0): ausência.
  let sGord = 'ausente';
  if (pct != null && pct !== 0) {
    sGord = pct > 0 && pct < 1 ? 'ok' : 'invalida';
    if (sGord === 'invalida') problemas.push(`Gordura corporal impossível (${fmt(pct * 100)}%).`);
  }

  // Massa magra só tem sentido com gordura medida: sem protocolo, o cálculo
  // copia o peso, e isso não é medida.
  let sMagra = 'ausente';
  if (magra != null && sGord !== 'ausente') {
    if (sGord === 'invalida') sMagra = 'invalida';
    else if (sPeso === 'ok' && magra > peso) {
      sMagra = 'invalida';
      problemas.push(`Massa magra (${fmt(magra)} kg) maior que o peso (${fmt(peso)} kg).`);
    } else sMagra = magra > 0 ? 'ok' : 'invalida';
  }

  return { peso: sPeso, gordura: sGord, magra: sMagra, problemas, revisar: problemas.length > 0 };
}

/** A medida, só se for válida; senão null. `campo`: 'peso' | 'gordura' (em %) | 'magra'. */
export function medidaValida(av, campo) {
  const s = situacaoDaAvaliacao(av);
  if (campo === 'peso') return s.peso === 'ok' ? n(av.peso) : null;
  if (campo === 'gordura') return s.gordura === 'ok' ? Number((n(av.pct_gordura) * 100).toFixed(1)) : null;
  if (campo === 'magra') return s.magra === 'ok' ? n(av.peso_magro) : null;
  if (campo === 'cintura') { const c = n(av.per_cintura); return c != null && c > 20 && c < 250 ? c : null; }
  return null;
}

/**
 * A avaliação MAIS RECENTE que tem `campo` válido, com o valor.
 * `avaliacoes` em qualquer ordem; a ordem é a do número (AV 1, AV 2…).
 */
export function ultimaValida(avaliacoes, campo) {
  const avs = [...(avaliacoes || [])].sort((a, b) => (a.numero || 0) - (b.numero || 0));
  for (let i = avs.length - 1; i >= 0; i--) {
    const v = medidaValida(avs[i], campo);
    if (v != null) return { valor: v, av: avs[i] };
  }
  return null;
}

/** A primeira (mais antiga) avaliação com `campo` válido. */
export function primeiraValida(avaliacoes, campo) {
  const avs = [...(avaliacoes || [])].sort((a, b) => (a.numero || 0) - (b.numero || 0));
  for (const av of avs) {
    const v = medidaValida(av, campo);
    if (v != null) return { valor: v, av };
  }
  return null;
}

/** As avaliações que precisam de revisão (dado inválido), da mais recente para a mais antiga. */
export function avaliacoesARevisar(avaliacoes) {
  return [...(avaliacoes || [])]
    .sort((a, b) => (b.numero || 0) - (a.numero || 0))
    .map(av => ({ av, ...situacaoDaAvaliacao(av) }))
    .filter(x => x.revisar);
}

/**
 * Trava da GRAVAÇÃO: resultados calculados que não podem ir para o banco.
 * Devolve a frase do erro, ou null se está tudo certo.
 */
export function conferirResultados(registro, resultados) {
  const peso = n(registro?.peso);
  const pct = n(resultados?.pct_gordura);
  const magra = n(resultados?.peso_magro);
  if (peso != null && peso !== 0 && (peso < PESO_MIN || peso > PESO_MAX)) {
    return `Peso fora do esperado (${fmt(peso)} kg). Confira a digitação.`;
  }
  if (pct != null && pct !== 0 && !(pct > 0 && pct < 1)) {
    return `O protocolo de dobras resultou em ${fmt(pct * 100)}% de gordura, o que é impossível. Confira as dobras (em milímetros) e o protocolo escolhido.`;
  }
  if (pct && magra != null && peso != null && magra > peso) {
    return `A massa magra calculada (${fmt(magra)} kg) ficou maior que o peso (${fmt(peso)} kg). Confira as dobras e o peso.`;
  }
  return null;
}

function fmt(v) {
  return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}
