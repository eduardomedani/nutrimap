// ═══════════════════════════════════════════════════════════
// DIETA — CÁLCULO (puro, sem DOM e sem rede)
// ═══════════════════════════════════════════════════════════
// Isolado de propósito: é a única parte do módulo de dieta que dá para testar
// sozinha, e é onde um erro passa despercebido e corrompe o plano inteiro.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ CONTRATO DO BANCO — não mude sem migrar os dados existentes             │
// │                                                                         │
// │ refeicao_itens.quantidade é MULTIPLICADOR DE 100 g, não gramas.         │
// │   quantidade = 1    -> 100 g   -> macros = food.<nutriente> * 1         │
// │   quantidade = 0.5  ->  50 g   -> macros = food.<nutriente> * 0.5       │
// │                                                                         │
// │ Os nutrientes em `foods` são por 100 g. Tratar quantidade como gramas   │
// │ deixaria todos os macros 100x errados.                                  │
// │                                                                         │
// │ refeicao_itens.medida é TEXTO LIVRE — não é FK para food_measures.      │
// └─────────────────────────────────────────────────────────────────────────┘

/** Nutrientes em foods são por 100 g. */
export const BASE_G = 100;

/** Peso do item em gramas (a UI trabalha em gramas; o banco, em múltiplos de 100 g). */
export const pesoDeItem = (item) => (Number(item?.quantidade) || 0) * BASE_G;

/** Inverso de pesoDeItem: gramas -> valor a gravar em refeicao_itens.quantidade. */
export const quantidadeDePeso = (gramas) => (Number(gramas) || 0) / BASE_G;

// ───────────────────────────────────────────────────────────
// MACROS
// ───────────────────────────────────────────────────────────
const ZERO = { kcal: 0, prot: 0, carb: 0, gord: 0, fibra: 0 };

/** Macros de um item. `item.food` traz os valores por 100 g. */
export function macrosItem(item) {
  const f = item?.food || {};
  const q = Number(item?.quantidade) || 0;
  return {
    kcal:  (Number(f.calorias) || 0) * q,
    prot:  (Number(f.proteina) || 0) * q,
    carb:  (Number(f.carboidrato) || 0) * q,
    gord:  (Number(f.gordura) || 0) * q,
    fibra: (Number(f.fibra) || 0) * q,
  };
}

export function macrosSoma(lista) {
  return (lista || []).reduce((t, m) => ({
    kcal: t.kcal + (m.kcal || 0),
    prot: t.prot + (m.prot || 0),
    carb: t.carb + (m.carb || 0),
    gord: t.gord + (m.gord || 0),
    fibra: t.fibra + (m.fibra || 0),
  }), { ...ZERO });
}

export const macrosRefeicao = (r) => macrosSoma((r?.itens || []).map(macrosItem));
export const macrosPlano = (refeicoes) => macrosSoma((refeicoes || []).map(macrosRefeicao));

/**
 * Distribuição percentual dos macros pelas CALORIAS que cada um fornece
 * (4 kcal/g proteína e carboidrato, 9 kcal/g gordura) — não pelo peso, que
 * daria percentuais sem significado nutricional.
 */
export function distribuicaoMacros(m) {
  const kp = (m.prot || 0) * 4, kc = (m.carb || 0) * 4, kg = (m.gord || 0) * 9;
  const tot = kp + kc + kg;
  if (tot <= 0) return { prot: 0, carb: 0, gord: 0 };
  return {
    prot: Math.round((kp / tot) * 100),
    carb: Math.round((kc / tot) * 100),
    gord: Math.round((kg / tot) * 100),
  };
}

// ───────────────────────────────────────────────────────────
// METAS
// ───────────────────────────────────────────────────────────
/**
 * Estado de um valor perante a meta. Sem vermelho forte por padrão:
 *   'sem-meta' | 'abaixo' (neutro) | 'perto' (>=90%) | 'acima' (>105%) | 'excesso' (>120%)
 */
export function statusMeta(atual, meta) {
  const m = Number(meta);
  if (!m || m <= 0) return 'sem-meta';
  const pct = (Number(atual) || 0) / m;
  if (pct > 1.2) return 'excesso';
  if (pct > 1.05) return 'acima';
  if (pct >= 0.9) return 'perto';
  return 'abaixo';
}

/** Progresso vs. meta. `pct` é limitado a 100 para a barra; `pctReal` não. */
export function progresso(atual, meta) {
  const a = Number(atual) || 0;
  const m = Number(meta);
  if (!m || m <= 0) return { temMeta: false, pct: 0, pctReal: 0, resta: 0, excedeu: 0, status: 'sem-meta' };
  const pctReal = Math.round((a / m) * 100);
  const dif = m - a;
  return {
    temMeta: true,
    pct: Math.max(0, Math.min(100, pctReal)),
    pctReal,
    resta: dif > 0 ? dif : 0,
    excedeu: dif < 0 ? -dif : 0,
    status: statusMeta(a, m),
  };
}

// ───────────────────────────────────────────────────────────
// MEDIDAS CASEIRAS
// ───────────────────────────────────────────────────────────
// O banco guarda só o PESO (em quantidade) e o NOME da medida (texto livre).
// A "quantidade de medidas" (2 colheres) é reconstruída na leitura dividindo o
// peso pelos gramas da medida. Assim nada de novo precisa ser persistido e os
// três campos da tela (quantidade, medida, peso) nunca se contradizem.

/** Medida especial: peso direto, sempre disponível mesmo sem food_measures. */
export const MEDIDA_GRAMAS = 'g';

/** Gramas de `n` vezes uma medida. Sem medida (ou 'g'), n já são os gramas. */
export function gramasDeMedida(medidas, nomeMedida, n) {
  const qtd = Number(n) || 0;
  if (!nomeMedida || nomeMedida === MEDIDA_GRAMAS) return qtd;
  const m = (medidas || []).find(x => x.descricao === nomeMedida);
  if (!m) return qtd;                       // medida sumiu: trata o número como gramas
  return qtd * (Number(m.gramas) || 0);
}

/**
 * Reconstrói {n, medida} a partir do item gravado.
 * Se o nome da medida não existir mais em food_measures, cai para gramas — em
 * vez de mostrar uma conversão inventada.
 */
export function medidaDoItem(medidas, item) {
  const gramas = pesoDeItem(item);
  const nome = item?.medida || null;
  if (!nome || nome === MEDIDA_GRAMAS) return { n: gramas, medida: MEDIDA_GRAMAS, gramas };
  const m = (medidas || []).find(x => x.descricao === nome);
  const g = Number(m?.gramas) || 0;
  if (!m || g <= 0) return { n: gramas, medida: MEDIDA_GRAMAS, gramas };
  return { n: arredonda(gramas / g, 2), medida: nome, gramas };
}

// ───────────────────────────────────────────────────────────
// FORMATAÇÃO (pt-BR)
// ───────────────────────────────────────────────────────────
export function arredonda(v, casas = 1) {
  const f = 10 ** casas;
  return Math.round((Number(v) || 0) * f) / f;
}

/** 1234.56 -> "1.235" (kcal são sempre inteiras na tela). */
export const fmtKcal = (v) => Math.round(Number(v) || 0).toLocaleString('pt-BR');

/** 30.55 -> "30,6" — uma casa, vírgula decimal, sem ",0" desnecessário. */
export function fmtG(v) {
  const n = arredonda(v, 1);
  return Number.isInteger(n) ? String(n) : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Quantidade de medida: até 2 casas, sem zeros à toa. */
export function fmtQtd(v) {
  const n = arredonda(v, 2);
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

/** Parse tolerante: aceita vírgula. Vazio/inválido -> null. */
export function num(v) {
  const s = String(v ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ───────────────────────────────────────────────────────────
// ALERTAS — só com dados reais; nada de aviso inventado
// ───────────────────────────────────────────────────────────
/**
 * Avisos do plano. Retorna [] quando não há meta ou não há refeições:
 * é melhor não dizer nada do que afirmar algo que não dá para calcular.
 */
export function alertasPlano(refeicoes, plano) {
  const out = [];
  const refs = refeicoes || [];
  if (!refs.length) return out;

  const tot = macrosPlano(refs);
  const pk = progresso(tot.kcal, plano?.kcal_meta);
  if (pk.temMeta) {
    if (pk.status === 'excesso') out.push({ nivel: 'alerta', texto: `Plano ${pk.pctReal}% da meta calórica — ${fmtKcal(pk.excedeu)} kcal acima.` });
    else if (pk.status === 'acima') out.push({ nivel: 'aviso', texto: `Plano ${fmtKcal(pk.excedeu)} kcal acima da meta.` });
    else if (pk.status === 'perto') out.push({ nivel: 'ok', texto: 'Plano próximo da meta calórica.' });
  }

  const pp = progresso(tot.prot, plano?.prot_meta);
  if (pp.temMeta && pp.pctReal < 80) {
    out.push({ nivel: 'aviso', texto: `Proteína em ${pp.pctReal}% da meta — faltam ${fmtG(pp.resta)} g.` });
  }

  const vazias = refs.filter(r => !(r.itens || []).length);
  if (vazias.length) {
    out.push({
      nivel: 'aviso',
      texto: vazias.length === 1
        ? `"${vazias[0].nome}" está sem alimentos.`
        : `${vazias.length} refeições estão sem alimentos.`,
    });
  }
  return out;
}

/**
 * Intervalo médio entre refeições, em horas. null se menos de 2 refeições
 * tiverem horário — a média de um ponto só não significa nada.
 */
export function intervaloMedioHoras(refeicoes) {
  const mins = (refeicoes || [])
    .map(r => horarioParaMinutos(r.horario))
    .filter(v => v != null)
    .sort((a, b) => a - b);
  if (mins.length < 2) return null;
  const total = mins[mins.length - 1] - mins[0];
  return arredonda(total / 60 / (mins.length - 1), 1);
}

/** "08:00" ou "08:00:00" -> 480. Inválido -> null. */
export function horarioParaMinutos(h) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(h || ''));
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

/** Ordena refeições por horário; as sem horário mantêm a ordem manual, no fim. */
export function ordemPorHorario(refeicoes) {
  return [...(refeicoes || [])].sort((a, b) => {
    const ma = horarioParaMinutos(a.horario), mb = horarioParaMinutos(b.horario);
    if (ma == null && mb == null) return (a.ordem ?? 0) - (b.ordem ?? 0);
    if (ma == null) return 1;
    if (mb == null) return -1;
    return ma - mb;
  });
}
