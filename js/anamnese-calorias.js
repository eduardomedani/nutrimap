// ═══════════════════════════════════════════════════════════
// ANAMNESE → CÁLCULO DE CALORIAS
// ═══════════════════════════════════════════════════════════
// Função pura: sem DOM, sem rede. Traduz o módulo 10 da anamnese
// (atividade física) para o formato que a tela de cálculo consome.
//
// POR QUE UMA TRADUÇÃO, E NÃO LEITURA DIRETA:
// os dois lados nasceram separados e não falam a mesma língua.
//
//   . NOME — a anamnese tem 15 modalidades, o motor tem 40. "Ciclismo" lá é
//     "Bicicleta" aqui, "Dança" é "Dança de salão", "Artes Marciais" não tem
//     equivalente único e "Tênis de mesa" simplesmente não existe no motor.
//
//   . INTENSIDADE — a anamnese usa sempre Leve/Moderada/Alta; o motor usa
//     rótulos próprios por modalidade (Recreativo/Competitivo, 8 km/h/Sprint,
//     Leve/Moderada/Intensa/Circuito...). Casar por POSIÇÃO na lista erraria:
//     "Alta" em Musculação viraria "Circuito" (MET 8), quando a anamnese
//     entende Alta como MET 6.
//     Por isso casamos por VALOR: cada nível da anamnese tem um MET declarado
//     no questionário, e escolhemos a intensidade do motor cujo MET é o mais
//     próximo. É auto-calibrado e não depende da ordem das listas.
//
//   . DURAÇÃO — a anamnese NÃO pergunta minutos por sessão, e a fórmula do
//     MET precisa deles. Entram as estimativas de DE_PARA, marcadas para o
//     profissional conferir. Nenhuma é medida do paciente.
//
// Nada aqui vai para o banco: a tela de cálculo só persiste as metas.

import { atividadePorNome } from './atividades.js';

/**
 * id da anamnese → { nome no motor, METs que a ANAMNESE atribui a cada nível,
 * duração típica em minutos }.
 *
 * Os METs vêm do próprio questionário (atributo data-met de cada opção), não
 * foram inventados aqui. As durações são estimativa editável.
 */
export const DE_PARA = {
  q10_caminhada: { motor: 'Caminhada',      met: { Leve: 2,   Moderada: 3.5, Alta: 5  }, minutos: 40 },
  q10_corrida:   { motor: 'Corrida',        met: { Leve: 6,   Moderada: 9,   Alta: 15 }, minutos: 35 },
  q10_musc:      { motor: 'Musculação',     met: { Leve: 3,   Moderada: 4.5, Alta: 6  }, minutos: 60 },
  q10_crossfit:  { motor: 'CrossFit',       met: { Leve: 8,   Moderada: 10,  Alta: 14 }, minutos: 60 },
  q10_bike:      { motor: 'Bicicleta',      met: { Leve: 4,   Moderada: 7,   Alta: 12 }, minutos: 45 },
  q10_natacao:   { motor: 'Natação',        met: { Leve: 5,   Moderada: 7,   Alta: 11 }, minutos: 45 },
  q10_pilates:   { motor: 'Pilates',        met: { Leve: 2.5, Moderada: 3.5, Alta: 5  }, minutos: 50 },
  q10_danca:     { motor: 'Dança de salão', met: { Leve: 3,   Moderada: 5,   Alta: 8  }, minutos: 60 },
  q10_futebol:   { motor: 'Futebol',        met: { Leve: 5,   Moderada: 7,   Alta: 10 }, minutos: 60 },
  q10_basquete:  { motor: 'Basquete',       met: { Leve: 4,   Moderada: 6,   Alta: 8  }, minutos: 60 },
  q10_volei:     { motor: 'Vôlei',          met: { Leve: 3,   Moderada: 4.5, Alta: 6  }, minutos: 60 },
  q10_tenis:     { motor: 'Tênis',          met: { Leve: 5,   Moderada: 7,   Alta: 8  }, minutos: 60 },
  q10_boxe:      { motor: 'Boxe',           met: { Leve: 6,   Moderada: 9,   Alta: 12 }, minutos: 50 },
  // "Artes Marciais" é genérico na anamnese; no motor cada arte é uma entrada
  // e todas ficam entre MET 10 e 10,3. Jiu-Jitsu representa o grupo.
  q10_artes:     { motor: 'Jiu-Jitsu',      met: { Leve: 6,   Moderada: 8,   Alta: 10 }, minutos: 60 },
  // Sem equivalente no motor: entra na lista de avisos, não no cálculo.
  q10_tmesa:     { motor: null,             met: { Leve: 3,   Moderada: 5,   Alta: 7  }, minutos: 45 },
};

/**
 * Nível de atividade do DIA A DIA (q10_neat) → fator da rotina.
 * Os rótulos da anamnese são os mesmos de FATORES em calorias-calc.js.
 * Esta é a BASE do modelo aditivo: cobre trabalho, casa e deslocamento —
 * o exercício entra depois, atividade por atividade.
 */
export const NEAT_FATOR = {
  'Sedentário': 1.2,
  'Leve':       1.375,
  'Moderado':   1.55,
  'Ativo':      1.725,
};

/**
 * Antropometria da anamnese: o que a TMB precisa e o paciente já informou.
 *
 * É AUTO-RELATO — vale como ponto de partida quando não existe avaliação
 * física, nunca como substituto dela. Quem chama decide a precedência.
 *
 *   m1.q1_4  nascimento (YYYY-MM-DD)   m4.q4_1  peso atual (kg)
 *   m1.q1_5  sexo (Feminino/Masculino) m4.q4_2  altura (cm)
 *                                      m4.q4_3  peso habitual no último ano
 *                                      m4.q4_4  peso desejado
 *
 * @param {Date} [hoje] injetável para o cálculo da idade ser testável.
 */
export function mapearAntropometria(m1, m4, hoje = new Date()) {
  const n = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : null; };

  const sexoBruto = (m1?.q1_5 || '').trim().toLowerCase();
  const sexo = sexoBruto.startsWith('m') ? 'M' : sexoBruto.startsWith('f') ? 'F' : null;

  let idade = null;
  const nasc = m1?.q1_4 ? new Date(m1.q1_4 + 'T00:00:00') : null;   // DATE puro: sem hora vira UTC e volta um dia
  if (nasc && !isNaN(nasc)) {
    idade = hoje.getFullYear() - nasc.getFullYear();
    const m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
    if (idade < 0 || idade > 130) idade = null;
  }

  const peso = n(m4?.q4_1);
  const alturaCm = n(m4?.q4_2);

  return {
    peso, alturaCm, idade, sexo,
    pesoHabitual: n(m4?.q4_3),
    pesoDesejado: n(m4?.q4_4),
    // A TMB de Mifflin/Harris precisa dos quatro; sem isso não há cálculo.
    completa: !!(peso && alturaCm && idade && sexo),
  };
}

/** Intensidade do motor cujo MET é o mais próximo do alvo. */
export function intensidadeMaisProxima(nomeMotor, metAlvo) {
  const at = atividadePorNome(nomeMotor);
  if (!at?.intensidades?.length) return null;
  let melhor = at.intensidades[0];
  for (const i of at.intensidades) {
    if (Math.abs(i.met - metAlvo) < Math.abs(melhor.met - metAlvo)) melhor = i;
  }
  return melhor;
}

/** Distância a partir da qual a tradução merece conferência do profissional. */
const TOLERANCIA_MET = 1.5;

/**
 * Traduz o módulo 10 da anamnese.
 *
 * @param {object} m10 respostas cruas (dados da tabela `respostas`, modulo m10)
 * @returns {{
 *   respondeu: boolean,
 *   praticaRegularmente: boolean,
 *   neat: {rotulo: string|null, fator: number|null},
 *   passos: string|null,
 *   atividades: Array<{nome, intensidade, minutos, vezesSemana}>,
 *   avisos: string[]
 * }}
 */
export function mapearAtividadeFisica(m10) {
  const vazio = {
    respondeu: false, praticaRegularmente: false,
    neat: { rotulo: null, fator: null }, passos: null,
    atividades: [], avisos: [],
  };
  if (!m10 || typeof m10 !== 'object') return vazio;

  const rotuloNeat = m10.q10_neat || null;
  const neat = { rotulo: rotuloNeat, fator: NEAT_FATOR[rotuloNeat] ?? null };
  const pratica = m10.q10_1 === 'Sim' || m10.q10_1 === 'Esporádico';

  const marcadas = Array.isArray(m10.q10_atividades_marcadas) ? m10.q10_atividades_marcadas : [];
  const atividades = [];
  const avisos = [];

  for (const marcada of marcadas) {
    const id = marcada?.id;
    const de = DE_PARA[id];
    const rotulo = marcada?.name || id || 'atividade';

    if (!de) { avisos.push(`"${rotulo}" não tem equivalente no cálculo — adicione manualmente.`); continue; }
    if (!de.motor) { avisos.push(`"${rotulo}" ainda não existe na tabela de METs — adicione manualmente.`); continue; }

    const nivel = m10[`${id}_int`] || 'Moderada';
    const vezes = Number(m10[`${id}_freq`]) || 0;
    const metAnamnese = de.met[nivel] ?? de.met.Moderada;
    const escolhida = intensidadeMaisProxima(de.motor, metAnamnese);
    if (!escolhida) { avisos.push(`"${rotulo}" não pôde ser traduzida.`); continue; }

    if (!vezes) avisos.push(`"${rotulo}" veio sem frequência — confira o "×/semana".`);

    // O motor pode não ter granularidade equivalente (Pilates e Dança têm um
    // MET único, artes marciais idem). Quando o valor se afasta demais do que
    // a anamnese registrou, avisamos em vez de esconder a diferença.
    if (Math.abs(escolhida.met - metAnamnese) > TOLERANCIA_MET) {
      avisos.push(
        `"${rotulo}" ${nivel.toLowerCase()}: a anamnese indica MET ${metAnamnese} e ` +
        `o mais próximo disponível é ${escolhida.met} (${escolhida.label}). Confira a intensidade.`
      );
    }

    atividades.push({
      nome: de.motor,
      intensidade: escolhida.label,
      minutos: de.minutos,
      vezesSemana: vezes,
    });
  }

  if (pratica && !marcadas.length) avisos.push('A anamnese diz que pratica atividade, mas nenhuma modalidade foi marcada.');
  if (atividades.length) avisos.push('Os tempos por sessão são estimativas — a anamnese não pergunta duração.');

  return {
    respondeu: true,
    praticaRegularmente: pratica,
    neat,
    passos: m10.q10_passos || null,
    atividades,
    avisos,
  };
}
