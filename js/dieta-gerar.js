// ═══════════════════════════════════════════════════════════
// DIETA — Motor de geração automática de plano
// ═══════════════════════════════════════════════════════════
// Função pura: sem DOM, sem rede, sem Supabase. Recebe metas + template +
// catálogo e devolve a estrutura plano→refeições→itens pronta para gravar.
// Testável isoladamente, mesmo padrão do dieta-calc.js.
//
// A ideia: o template diz QUAIS alimentos entram e em que refeição; o motor
// calcula QUANTO de cada um para bater kcal e macros. Diferente de uma tabela
// fixa de gramagens, o resultado acompanha a meta real do paciente.
//
// Contrato de quantidade (igual ao dieta-calc.js): quantidade = gramas / 100.

import { GRUPOS, templatePorId } from './dieta-grupos.js';

const BASE_G = 100;
const MACROS = ['proteina', 'carboidrato', 'gordura'];

// papel do grupo -> macro que aquela vaga governa
const MACRO_DO_PAPEL = {
  proteina: 'proteina',
  carbo:    'carboidrato',
  gordura:  'gordura',
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Macros de `g` gramas de um alimento do catálogo. */
function macrosDe(food, g) {
  const f = g / BASE_G;
  return {
    kcal:        (food.calorias    || 0) * f,
    proteina:    (food.proteina    || 0) * f,
    carboidrato: (food.carboidrato || 0) * f,
    gordura:     (food.gordura     || 0) * f,
    fibra:       (food.fibra       || 0) * f,
  };
}

function somar(lista) {
  const t = { kcal: 0, proteina: 0, carboidrato: 0, gordura: 0, fibra: 0 };
  for (const m of lista) for (const k in t) t[k] += m[k] || 0;
  return t;
}

/**
 * Escolhe o alimento de uma vaga: primeiro do grupo que exista no catálogo,
 * não esteja excluído e não tenha sido usado demais no dia.
 */
function escolherAlimento(grupoId, cat, { excluir = [], preferir = {}, usados = new Map() } = {}) {
  const grupo = GRUPOS[grupoId];
  if (!grupo) return null;
  const veto = new Set(excluir.map(s => s.toLowerCase()));

  const pref = preferir[grupoId];
  const ordem = pref ? [pref, ...grupo.alimentos.filter(a => a !== pref)] : grupo.alimentos;

  const viaveis = ordem.filter(nome => cat[nome] && !veto.has(nome.toLowerCase()));
  if (!viaveis.length) return null;

  // desempata pelo menos usado no dia, preservando a ordem de curadoria
  let melhor = viaveis[0], melhorUso = usados.get(melhor) ?? 0;
  for (const nome of viaveis) {
    const u = usados.get(nome) ?? 0;
    if (u < melhorUso) { melhor = nome; melhorUso = u; }
  }
  return melhor;
}

/**
 * Ajusta as gramagens das vagas escaláveis para bater `alvo`.
 * Escalonamento proporcional por macro, com limites por vaga (min/max).
 */
function resolverGramas(vagas, alvo, cat, iteracoes = 80) {
  const escalaveis = vagas.filter(v => !v.fixo);
  if (!escalaveis.length) return;

  const total = () => somar(vagas.map(v => macrosDe(cat[v.alimento], v.gramas)));

  for (let it = 0; it < iteracoes; it++) {
    // 1) um passe por macro, mexendo só nas vagas que governam aquele macro
    for (const macro of MACROS) {
      if (!alvo[macro]) continue;
      const pool = escalaveis.filter(v => MACRO_DO_PAPEL[GRUPOS[v.grupo].papel] === macro);
      if (!pool.length) continue;

      const t = total();
      const noPool = somar(pool.map(v => macrosDe(cat[v.alimento], v.gramas)))[macro];
      if (noPool <= 0) continue;

      const falta = alvo[macro] - t[macro];
      const fator = clamp((noPool + falta) / noPool, 0.7, 1.4);
      for (const v of pool) v.gramas = clamp(v.gramas * fator, v.min, v.max);
    }

    // 2) correção final de kcal em todas as vagas escaláveis
    const t = total();
    const noPool = somar(escalaveis.map(v => macrosDe(cat[v.alimento], v.gramas))).kcal;
    if (noPool > 0 && alvo.kcal) {
      const fator = clamp((noPool + (alvo.kcal - t.kcal)) / noPool, 0.85, 1.15);
      for (const v of escalaveis) v.gramas = clamp(v.gramas * fator, v.min, v.max);
    }
  }

  // arredonda para múltiplos de 5 g (gramagem que se prescreve na prática)
  for (const v of escalaveis) v.gramas = clamp(Math.round(v.gramas / 5) * 5, v.min, v.max);
}

// Abaixo disto a troca isocalórica vira uma quantidade que ninguém pesa
// na prática (ex.: "5g de queijo" para substituir um iogurte).
const MIN_SUB_G = 10;

/**
 * Substituições isocalóricas: mesmas kcal, alimentos do mesmo grupo.
 * Respeita as MESMAS exclusões da escolha principal — uma sugestão de troca
 * com alimento vetado é tão perigosa quanto prescrevê-lo direto.
 */
function substituicoesDe(vaga, cat, excluir = []) {
  const grupo = GRUPOS[vaga.grupo];
  if (!grupo) return [];
  const alvoKcal = macrosDe(cat[vaga.alimento], vaga.gramas).kcal;
  if (!alvoKcal) return [];
  const veto = new Set(excluir.map(s => s.toLowerCase()));

  return grupo.alimentos
    .filter(n => n !== vaga.alimento && cat[n] && (cat[n].calorias || 0) > 0 && !veto.has(n.toLowerCase()))
    .map(nome => {
      const g = Math.round((alvoKcal / cat[nome].calorias) * BASE_G / 5) * 5;
      return { nome, quantidade: +(g / BASE_G).toFixed(4), medida: `${g}g`, _g: g };
    })
    .filter(s => s._g >= MIN_SUB_G)
    .slice(0, 3)
    .map(({ _g, ...s }) => s);
}

/**
 * Gera um plano alimentar completo.
 *
 * @param {object} metas    { kcal, prot, carb, gord } — o que calorias-ui.js já produz
 * @param {object} catalogo mapa nome -> { id, calorias, proteina, carboidrato, gordura, fibra }
 * @param {object} opcoes   { templateId, excluir: [nomes], preferir: { grupoId: nome } }
 * @returns {object} { refeicoes, macros, alvo, desvio, avisos }
 */
export function gerarPlano(metas, catalogo, opcoes = {}) {
  const template = templatePorId(opcoes.templateId);
  const cat = catalogo;
  const avisos = [];

  const alvo = {
    kcal:        Number(metas.kcal) || 0,
    proteina:    Number(metas.prot) || 0,
    carboidrato: Number(metas.carb) || 0,
    gordura:     Number(metas.gord) || 0,
  };
  if (!alvo.kcal) throw new Error('meta de calorias ausente');

  // 1) monta as vagas com o alimento escolhido
  const usados = new Map();
  const vagas = [];
  const refeicoes = template.refeicoes.map((r, ri) => {
    const itens = [];
    for (const slot of r.slots) {
      const alimento = escolherAlimento(slot.grupo, cat, { ...opcoes, usados });
      if (!alimento) {
        avisos.push(`vaga "${GRUPOS[slot.grupo]?.nome || slot.grupo}" em ${r.nome} ficou vazia (nenhum alimento do grupo está no catálogo ou todos foram excluídos)`);
        continue;
      }
      usados.set(alimento, (usados.get(alimento) ?? 0) + 1);
      const v = {
        grupo: slot.grupo, alimento,
        gramas: slot.fixo ?? slot.base,
        min: slot.fixo ?? slot.min ?? 5,
        max: slot.fixo ?? slot.max ?? 500,
        fixo: slot.fixo != null,
        medida: slot.medida || null,
      };
      vagas.push(v); itens.push(v);
    }
    return { chave: r.chave, nome: r.nome, horario: r.horario, ordem: ri + 1, _itens: itens };
  });

  // 2) resolve as gramagens contra a meta
  resolverGramas(vagas, alvo, cat);

  // 3) materializa os itens
  const out = refeicoes.map(r => ({
    nome: r.nome, horario: r.horario, ordem: r.ordem,
    itens: r._itens.map((v, i) => ({
      food_id: cat[v.alimento].id || null,
      nome: v.alimento,
      quantidade: +(v.gramas / BASE_G).toFixed(4),
      gramas: v.gramas,
      medida: v.medida,
      ordem: i + 1,
      substituicoes: substituicoesDe(v, cat, opcoes.excluir || []),
    })),
  }));

  const macros = somar(vagas.map(v => macrosDe(cat[v.alimento], v.gramas)));
  const desvio = {
    kcal:        alvo.kcal        ? (macros.kcal        - alvo.kcal)        / alvo.kcal        : 0,
    proteina:    alvo.proteina    ? (macros.proteina    - alvo.proteina)    / alvo.proteina    : 0,
    carboidrato: alvo.carboidrato ? (macros.carboidrato - alvo.carboidrato) / alvo.carboidrato : 0,
    gordura:     alvo.gordura     ? (macros.gordura     - alvo.gordura)     / alvo.gordura     : 0,
  };
  if (Math.abs(desvio.kcal) > 0.10)
    avisos.push(`o plano ficou ${(desvio.kcal * 100).toFixed(0)}% fora da meta calórica — os limites das vagas podem não comportar esse alvo`);

  return { template: { id: template.id, nome: template.nome }, refeicoes: out, macros, alvo, desvio, avisos };
}
