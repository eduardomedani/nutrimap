// ═══════════════════════════════════════════════════════════
// CÁLCULO DE CALORIAS — regras puras
// ═══════════════════════════════════════════════════════════
// Sem DOM, sem rede, sem Supabase. Mesmo padrão do dieta-calc.js /
// dieta-gerar.js: a apresentação lê daqui, nunca recalcula por conta.
//
// Extraído de calorias-ui.js sem alterar nenhuma fórmula. A única mudança é
// de vocabulário: "acentuado"/"controlado"/"agressivo" viraram "elevado"/
// "leve"/"elevado" para casar com os estados nomeados na UI. Os limiares
// (12% e 25% no déficit, 12% e 20% no superávit) são os mesmos de antes.

// Objetivo -> ajuste % padrão sobre o GET (sub-níveis com respaldo na literatura).
export const OBJETIVOS = [
  { v: 'emag_leve',  label: 'Emagrecimento LEVE',      ajuste: -12 },
  { v: 'emag_mod',   label: 'Emagrecimento MODERADO',  ajuste: -20 },
  { v: 'emag_acent', label: 'Emagrecimento ACENTUADO', ajuste: -27 },
  { v: 'manutencao', label: 'Manutenção',              ajuste: 0 },
  { v: 'hiper_lean', label: 'Hipertrofia LEAN BULK',   ajuste: 8 },
  { v: 'hiper_mod',  label: 'Hipertrofia MODERADO',    ajuste: 15 },
];
export const OBJ_PADRAO = 'emag_mod';

export const FORMULAS = [
  { v: 'mifflin', label: 'Mifflin-St Jeor' },
  { v: 'harris',  label: 'Harris-Benedict (revisada)' },
  { v: 'katch',   label: 'Katch-McArdle (massa magra)' },
];

// Fator de atividade: multiplica a TMB para chegar ao GET. JÁ INCLUI o
// exercício — por isso não se soma o gasto do treino por cima, sob pena de
// contar o mesmo gasto duas vezes. Fonte única, usada aqui e nas avaliações.
export const FATORES = [
  { v: 1.2,   label: 'Sedentário' },
  { v: 1.375, label: 'Levemente ativo' },
  { v: 1.55,  label: 'Moderadamente ativo' },
  { v: 1.725, label: 'Muito ativo' },
  { v: 1.9,   label: 'Extremamente ativo' },
];
export const FATOR_PADRAO = 1.2;

/** GET = TMB × fator de atividade. */
export function getDe(tmb, fator) {
  return Math.round((Number(tmb) || 0) * (Number(fator) || FATOR_PADRAO));
}

export const KCAL_G = { proteina: 4, carboidrato: 4, gordura: 9 };
export const MACRO_DEF = [
  { id: 'proteina',    label: 'Proteína',    cor: 'var(--moss)',       vGkg: '2', vPct: '30' },
  { id: 'carboidrato', label: 'Carboidrato', cor: 'var(--gold)',       vGkg: '3', vPct: '40' },
  { id: 'gordura',     label: 'Gordura',     cor: 'var(--terracotta)', vGkg: '1', vPct: '30' },
];

// Tolerância do saldo. Com passo de 0,1 g/kg num paciente de 98 kg cada clique
// move ~39 kcal; exigir igualdade exata deixaria a meta inalcançável na mão.
export const TOL_PCT = 0.01;
export const TOL_MIN = 15;

// ~7700 kcal ≈ 1 kg de tecido adiposo
const KCAL_POR_KG = 7700;

/** Número tolerante a vírgula decimal e vazio. */
export function num(v) {
  const s = String(v ?? '').trim().replace(',', '.');
  if (s === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** TMB pela fórmula escolhida. Retorna null se faltar dado necessário. */
export function tmbPorFormula(formula, d) {
  const { peso, alturaCm, idade, sexo, pctGordura } = d;
  if (formula === 'katch') {
    if (!peso || !pctGordura || pctGordura <= 0) return null;   // precisa de %gordura
    return 370 + 21.6 * (peso * (1 - pctGordura));
  }
  if (!peso || !alturaCm || !idade || !sexo) return null;
  if (formula === 'harris') {
    return sexo === 'M'
      ? 88.362 + 13.397 * peso + 4.799 * alturaCm - 5.677 * idade
      : 447.593 + 9.247 * peso + 3.098 * alturaCm - 4.330 * idade;
  }
  // mifflin-st jeor (padrão)
  const base = 10 * peso + 6.25 * alturaCm - 5 * idade;
  return sexo === 'M' ? base + 5 : base - 161;
}

/** Meta calórica = GET ajustado pelo objetivo. */
export function metaDe(get, ajustePct) {
  return get ? Math.round(get * (1 + (ajustePct || 0) / 100)) : 0;
}

/**
 * Estado do ajuste, para rótulo e cor do card de resultado.
 * @returns {{chave: string, label: string, tom: 'neutro'|'deficit'|'superavit'}}
 */
export function statusAjuste(aj) {
  const a = Math.abs(aj);
  if (aj <= -1) {
    const q = a >= 25 ? 'elevado' : a >= 12 ? 'moderado' : 'leve';
    return { chave: 'deficit_' + q, label: `Déficit ${q}`, tom: 'deficit' };
  }
  if (aj >= 1) {
    const q = a >= 20 ? 'elevado' : a >= 12 ? 'moderado' : 'leve';
    return { chave: 'superavit_' + q, label: `Superávit ${q}`, tom: 'superavit' };
  }
  return { chave: 'manutencao', label: 'Manutenção', tom: 'neutro' };
}

/**
 * Ritmo estimado de perda/ganho.
 * @returns {{kcalDia: number, kgSemana: number, pctPesoSemana: number|null}}
 */
export function ritmoSemanal(meta, get, peso) {
  const kcalDia = (meta || 0) - (get || 0);
  const kgSemana = Math.abs(kcalDia) * 7 / KCAL_POR_KG;
  return {
    kcalDia,
    kgSemana,
    pctPesoSemana: peso ? (kgSemana / peso * 100) : null,
  };
}

/**
 * Distribuição de macros. Os três são independentes: mexer num não move os
 * outros. Quem fecha a conta é o nutri, e `bate` diz se fechou — é o que
 * libera a geração do plano. Derivar automaticamente descolava a distribuição
 * da meta (2/3/1 g/kg em 98 kg dá 2842 kcal contra um alvo de 2021).
 *
 * @param {object} p { modo: 'gkg'|'pct', meta, peso, valores: {macroId: number} }
 * @returns {{gramas, kcalPorMacro, totalKcal, dif, tol, bate, somaPct}}
 */
export function calcularMacros({ modo, meta, peso, valores }) {
  const gramas = {};

  if (modo === 'gkg') {
    for (const m of MACRO_DEF) gramas[m.id] = (valores[m.id] || 0) * (peso || 0);
  } else {
    // No modo %, cada macro vale essa fatia da META; a soma dos três só bate
    // as calorias quando os percentuais somam 100.
    for (const m of MACRO_DEF) {
      gramas[m.id] = (meta * (valores[m.id] || 0) / 100) / KCAL_G[m.id];
    }
  }

  const kcalPorMacro = {};
  for (const m of MACRO_DEF) kcalPorMacro[m.id] = gramas[m.id] * KCAL_G[m.id];

  const totalKcal = MACRO_DEF.reduce((s, m) => s + kcalPorMacro[m.id], 0);
  const dif = meta ? totalKcal - meta : 0;
  const tol = Math.max(TOL_MIN, meta * TOL_PCT);

  // % calórico de cada macro sobre o total realmente distribuído
  const somaPct = {};
  for (const m of MACRO_DEF) {
    somaPct[m.id] = totalKcal ? (kcalPorMacro[m.id] / totalKcal * 100) : 0;
  }

  return {
    gramas, kcalPorMacro, totalKcal, dif, tol, somaPct,
    bate: !!meta && Math.abs(dif) <= tol,
  };
}
