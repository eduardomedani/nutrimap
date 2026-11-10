// ═══════════════════════════════════════════════════════════
// DIETA — segurança alimentar: vocabulário + validador (FUNÇÃO PURA)
// ═══════════════════════════════════════════════════════════
// Sem DOM, sem rede, sem Supabase — mesmo padrão de dieta-calc.js e
// dieta-gerar.js. Recebe as restrições do paciente, o plano e os MARCADORES
// curados de cada alimento, e devolve os conflitos.
//
// O QUE ESTE ARQUIVO NÃO FAZ, DE PROPÓSITO: procurar texto no nome do
// alimento. "Queijo minas" não contém a palavra "lactose"; "pão" não contém
// "trigo". Segurança por busca textual dá falso negativo exatamente onde dói.
// Aqui um alimento só é considerado seguro se tiver marcadores CURADOS; sem
// curadoria, ele é "informação insuficiente" — e, diante de alergia ou
// contraindicação, isso BLOQUEIA a publicação.
//
// ESTADO: preparado, ainda NÃO ligado à publicação. Falta a origem dos
// marcadores (tabela food_marcadores, migration proposta) e o registro das
// restrições confirmadas pelo profissional (paciente_restricoes). Ver o
// diagnóstico. A anamnese já coleta as respostas com estes mesmos códigos.

// ── Vocabulário: o código é o valor gravado na anamnese ─────────
export const ALERGENOS = {
  leite:      'Leite de vaca (proteína do leite)',
  ovo:        'Ovo',
  amendoim:   'Amendoim',
  castanhas:  'Castanhas e nozes',
  peixe:      'Peixes',
  crustaceos: 'Crustáceos e frutos do mar',
  soja:       'Soja',
  trigo:      'Trigo',
  gergelim:   'Gergelim',
};

export const INTOLERANCIAS = {
  lactose:  'Intolerância à lactose',
  celiaca:  'Doença celíaca (diagnosticada)',
  gluten:   'Sensibilidade ao glúten (não celíaca)',
  frutose:  'Intolerância à frutose',
};

export const PADROES = {
  onivoro:     'Como de tudo (onívoro)',
  ovolacto:    'Vegetariano (com ovos e laticínios)',
  vegano:      'Vegano (nenhum produto de origem animal)',
  pescetariano: 'Pescetariano (não come carne, come peixe)',
};

export const GESTACAO = {
  nao:          'Não',
  gestante:     'Gestante',
  amamentando:  'Amamentando',
  nao_se_aplica: 'Não se aplica',
};

/** Rótulo legível de um código da anamnese (ou o próprio valor, se for livre). */
export function rotuloRestricao(codigo) {
  return ALERGENOS[codigo] || INTOLERANCIAS[codigo] || PADROES[codigo] || GESTACAO[codigo]
    || ({ nenhuma: 'Nenhuma', outra: 'Outra (ver detalhe)', outro: 'Outro (ver detalhe)' })[codigo]
    || codigo;
}

// ── Marcadores: o que o alimento CONTÉM (curado por profissional) ──
export const MARCADORES = [
  'contem_leite', 'contem_lactose', 'contem_ovo', 'contem_amendoim', 'contem_castanhas',
  'contem_peixe', 'contem_crustaceos', 'contem_soja', 'contem_trigo', 'contem_gluten',
  'contem_gergelim', 'contem_frutose_alta',
  'origem_animal', 'carne', 'pescado',
];

// ── Regras: restrição -> marcadores proibidos + nível ───────────
// BLOQUEANTE: alergia e contraindicação. Não há justificativa que libere.
// JUSTIFICAVEL: o profissional pode decidir que é clinicamente apropriado,
//               desde que registre a justificativa.
const REGRAS = {
  'alergia:leite':      { proibe: ['contem_leite'],      nivel: 'bloqueante' },
  'alergia:ovo':        { proibe: ['contem_ovo'],        nivel: 'bloqueante' },
  'alergia:amendoim':   { proibe: ['contem_amendoim'],   nivel: 'bloqueante' },
  'alergia:castanhas':  { proibe: ['contem_castanhas'],  nivel: 'bloqueante' },
  'alergia:peixe':      { proibe: ['contem_peixe'],      nivel: 'bloqueante' },
  'alergia:crustaceos': { proibe: ['contem_crustaceos'], nivel: 'bloqueante' },
  'alergia:soja':       { proibe: ['contem_soja'],       nivel: 'bloqueante' },
  'alergia:trigo':      { proibe: ['contem_trigo'],      nivel: 'bloqueante' },
  'alergia:gergelim':   { proibe: ['contem_gergelim'],   nivel: 'bloqueante' },
  // Doença celíaca é contraindicação, não preferência.
  'intolerancia:celiaca': { proibe: ['contem_gluten'],   nivel: 'bloqueante' },
  'intolerancia:lactose': { proibe: ['contem_lactose'],  nivel: 'justificavel' },
  'intolerancia:gluten':  { proibe: ['contem_gluten'],   nivel: 'justificavel' },
  'intolerancia:frutose': { proibe: ['contem_frutose_alta'], nivel: 'justificavel' },
  'padrao:vegano':        { proibe: ['origem_animal'],   nivel: 'justificavel' },
  'padrao:ovolacto':      { proibe: ['carne', 'pescado'], nivel: 'justificavel' },
  'padrao:pescetariano':  { proibe: ['carne'],           nivel: 'justificavel' },
};

/**
 * Restrições a partir do módulo 3 da anamnese.
 *
 * `informado` é false quando a pergunta de alergias NÃO foi respondida (toda
 * anamnese anterior a este formulário). Isso não é "sem alergia": é falta de
 * informação, e bloqueia.
 *
 * "Outra" alergia (texto livre) vira `alergia:outra`: o sistema não sabe o
 * alérgeno, então não sabe validar — bloqueia até o profissional estruturar.
 */
export function restricoesDaAnamnese(m3 = {}) {
  const lista = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).map(String);
  const alergias = lista(m3.q3_alergias);
  const intolerancias = lista(m3.q3_intolerancias);
  const restricoes = [];

  for (const a of alergias) {
    if (a === 'nenhuma') continue;
    restricoes.push(ALERGENOS[a] ? `alergia:${a}` : 'alergia:outra');
  }
  for (const i of intolerancias) {
    if (i === 'nenhuma') continue;
    restricoes.push(INTOLERANCIAS[i] ? `intolerancia:${i}` : 'intolerancia:outra');
  }
  const padrao = String(m3.q3_padrao || '');
  if (padrao && padrao !== 'onivoro') restricoes.push(PADROES[padrao] ? `padrao:${padrao}` : 'padrao:outro');
  const gest = String(m3.q3_gestacao || '');
  if (gest === 'gestante' || gest === 'amamentando') restricoes.push(`condicao:${gest}`);

  return { informado: alergias.length > 0, restricoes: [...new Set(restricoes)] };
}

/**
 * Valida um plano contra as restrições.
 *
 * @param {object} p
 * @param {{informado:boolean, restricoes:string[]}} p.paciente  restricoesDaAnamnese()
 * @param {Array}  p.refeicoes  [{id, nome, substitui_refeicao_id, itens:[{id, food_id,
 *                              food:{nome}, substituicoes:[{food_id?, nome}]}]}]
 * @param {Map|object} p.marcadores  food_id -> { curado: true, marcadores: [...] }
 * @param {object} [p.justificativas]  id do conflito -> texto
 * @returns {{conflitos: Array, podePublicar: boolean, bloqueantes: number, semJustificativa: number}}
 */
export function validarPlano({ paciente, refeicoes = [], marcadores = new Map(), justificativas = {} }) {
  const conflitos = [];
  const marc = marcadores instanceof Map ? marcadores : new Map(Object.entries(marcadores || {}));
  const add = (c) => {
    const justificativa = (justificativas[c.id] || '').trim();
    conflitos.push({ ...c, justificativa: c.nivel === 'justificavel' ? (justificativa || null) : null });
  };

  // 1) Informação insuficiente sobre o PACIENTE
  if (!paciente?.informado) {
    add({ id: 'paciente:alergias-nao-informadas', nivel: 'bloqueante', regra: 'alergias-nao-informadas',
      motivo: 'O paciente não informou se tem alergia alimentar. Sem essa informação, nenhum plano é seguro.' });
  }
  const restricoes = paciente?.restricoes || [];
  for (const r of restricoes) {
    if (r === 'alergia:outra') add({ id: 'paciente:alergia-outra', nivel: 'bloqueante', regra: r,
      motivo: 'Alergia informada em texto livre: identifique o alérgeno antes de publicar.' });
    if (r === 'intolerancia:outra' || r === 'padrao:outro') add({ id: `paciente:${r}`, nivel: 'justificavel', regra: r,
      motivo: 'Restrição informada em texto livre: confira o plano e registre a justificativa.' });
    if (r.startsWith('condicao:')) add({ id: `paciente:${r}`, nivel: 'justificavel', regra: r,
      motivo: `${rotuloRestricao(r.split(':')[1])}: o plano exige revisão clínica específica.` });
  }

  // 2) Cada alimento em cada posição: item, substituição, refeição alternativa
  const ativas = restricoes.filter(r => REGRAS[r]);
  const temBloqueante = ativas.some(r => REGRAS[r].nivel === 'bloqueante') || !paciente?.informado;

  const conferir = (foodId, nome, local) => {
    const m = foodId ? marc.get(foodId) : null;
    const curado = !!m?.curado;
    if (!curado) {
      // Sem marcadores curados não dá para afirmar que é seguro.
      if (!ativas.length && paciente?.informado) return;
      add({
        id: `${local.chave}:insuficiente`,
        nivel: temBloqueante ? 'bloqueante' : 'justificavel',
        regra: 'alimento-nao-curado', local, alimento: nome,
        motivo: foodId
          ? `"${nome}" não tem a composição (alérgenos/origem) conferida.`
          : `"${nome}" não está ligado a um alimento do catálogo: impossível conferir a composição.`,
      });
      return;
    }
    const tem = new Set(m.marcadores || []);
    for (const r of ativas) {
      const hit = REGRAS[r].proibe.filter(x => tem.has(x));
      if (hit.length) add({
        id: `${local.chave}:${r}`, nivel: REGRAS[r].nivel, regra: r, local, alimento: nome,
        motivo: `"${nome}" contém ${hit.join(', ').replace(/contem_/g, '')} — conflita com ${rotuloRestricao(r.split(':')[1])}.`,
      });
    }
  };

  for (const r of refeicoes) {
    const alternativa = !!r.substitui_refeicao_id;
    for (const it of r.itens || []) {
      const nome = it.food?.nome || it.nome || 'alimento';
      conferir(it.food_id || null, nome,
        { tipo: 'item', chave: `item:${it.id}`, refeicao: r.nome, alternativa });
      (it.substituicoes || []).forEach((s, i) => conferir(s.food_id || null, s.nome || 'substituição',
        { tipo: 'substituicao', chave: `item:${it.id}:sub:${i}`, refeicao: r.nome, alternativa, de: nome }));
    }
  }

  const bloqueantes = conflitos.filter(c => c.nivel === 'bloqueante').length;
  const semJustificativa = conflitos.filter(c => c.nivel === 'justificavel' && !c.justificativa).length;
  return { conflitos, bloqueantes, semJustificativa, podePublicar: bloqueantes === 0 && semJustificativa === 0 };
}
