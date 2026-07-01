// ═══════════════════════════════════════════════════════════
// RELATÓRIO CLÍNICO — Cálculos + Renderização do Mapa Nutricional
// Migrado do dashboard antigo (05_NutriMap_Dashboard.html), adaptado para Supabase
// ═══════════════════════════════════════════════════════════

import { buscarPacientePorId } from './pacientes.js';
import { buscarRespostas } from './respostas.js';

// ═══════════════════════════════════════════════════════════
// MAPEAMENTO DE CHAVES — NutriMap (curtas) → Dashboard antigo (semânticas)
// ═══════════════════════════════════════════════════════════
function adaptarRespostas(respostasPorModulo) {
  const r = JSON.parse(JSON.stringify(respostasPorModulo || {})); // clone

  // ─── M1: Dados pessoais ───
  if (r.m1) {
    r.m1.q1_1_nome = r.m1.q1_1;
    r.m1.q1_2_email = r.m1.q1_2;
    r.m1.q1_3_telefone = r.m1.q1_3;
    r.m1.q1_4_nascimento = r.m1.q1_4;
    r.m1.q1_5_sexo = r.m1.q1_5;
    r.m1.q1_6_cidade = r.m1.q1_6;
    r.m1.q1_8_profissao = r.m1.q1_8;
  }

  // ─── M2: Objetivo ───
  if (r.m2) {
    r.m2.q2_1_objetivo_principal = r.m2.q2_1;
    r.m2.q2_2_objetivo_secundario = r.m2.q2_2;
    r.m2.q2_3_por_que = r.m2.q2_3;
    r.m2.q2_7_alinhamento = r.m2.q2_7;
    r.m2.q2_8_dificuldades = r.m2.q2_8;
  }

  // ─── M3: Histórico clínico ───
  if (r.m3) {
    const patologias = r.m3.q3_1;
    r.m3.q3_1_patologias = Array.isArray(patologias) ? patologias.join(', ') : patologias;
    r.m3.q3_2_cirurgia = r.m3.q3_2;
    r.m3.q3_2_detalhe = r.m3.q3_2_detalhe || r.m3.q3_2_det;
    r.m3.q3_3_medicamentos = r.m3.q3_3;
    r.m3.q3_4_deglutição = r.m3.q3_4;
    r.m3.q3_5_alergias = r.m3.q3_5;
  }

  // ─── M4: Antropometria ───
  if (r.m4) {
    r.m4.q4_1_peso_atual = r.m4.q4_1;
    r.m4.q4_2_altura = r.m4.q4_2;
    r.m4.q4_3_peso_habitual = r.m4.q4_3;
    r.m4.q4_4_peso_desejado = r.m4.q4_4;
    r.m4.q4_5_tempo_meta = r.m4.q4_5;
  }

  // ─── M5: Estilo de vida ───
  if (r.m5) {
    r.m5.q5_1_moradia = r.m5.q5_1;
    r.m5.q5_2_mora_com = r.m5.q5_2;
    r.m5.q5_4_quem_cozinha = r.m5.q5_4;
    r.m5.q5_7_horario_trabalho = r.m5.q5_7;
    r.m5.q5_7b_rotina_trabalho = r.m5.q5_7b;
    r.m5.q5_8_estresse = r.m5.q5_8;
    r.m5.q5_9_fuma = r.m5.q5_9;
    r.m5.q5_10_alcool = r.m5.q5_10;
    r.m5.q5_11_lazer = r.m5.q5_11;
    r.m5.q5_12_agua = r.m5.q5_12;
  }

  // ─── M6: Sono (PSQI + MEQ) ───
  if (r.m6) {
    // MEQ: q6_meq_1 a q6_meq_7
    for (let i = 1; i <= 7; i++) {
      if (r.m6['q6_meq_' + i] !== undefined) {
        r.m6['meq_' + i] = r.m6['q6_meq_' + i];
      }
    }
    // Outros campos do sono (nomes prováveis)
    r.m6.q6_qualidade = r.m6.q6_qualidade || r.m6.q6_qual || r.m6.q6_3;
    r.m6.latencia_min = r.m6.latencia_min || r.m6.q6_latencia || r.m6.q6_2;
    r.m6.horas_sono = r.m6.horas_sono || r.m6.q6_horas || r.m6.q6_1;
    r.m6.q5a = r.m6.q5a || r.m6.q6_5a;
    r.m6.q5b = r.m6.q5b || r.m6.q6_5b;
    r.m6.q5c = r.m6.q5c || r.m6.q6_5c;
    r.m6.q5d = r.m6.q5d || r.m6.q6_5d;
    r.m6.q7_medicacao = r.m6.q7_medicacao || r.m6.q6_medicacao;
    r.m6.q8_sonolencia = r.m6.q8_sonolencia || r.m6.q6_sonolencia;
    r.m6.q9_disposicao = r.m6.q9_disposicao || r.m6.q6_disposicao;
  }

  // ─── M7: Comportamento alimentar ───
  if (r.m7) {
    r.m7.q7_1_apetite = r.m7.q7_1;
    r.m7.q7_2_sabor = r.m7.q7_2;
    r.m7.q7_3_maior_fome = r.m7.q7_3;
    r.m7.q7_4_come_noite = r.m7.q7_4;
    r.m7.q7_5_mastigacao = r.m7.q7_5;
    r.m7.q7_9_nao_gosta = r.m7.q7_9;
    r.m7.q7_10_gosta_muito = r.m7.q7_10;
  }

  // ─── M8: Recordatório 24h ───
  if (r.m8) {
    // Mapeamento REAL do questionário (anamnese.html):
    // refeição → [campo_faz, campo_descricao, campo_horario]
    const mapaRef = {
      cafe:         ['q8_1',  'q8_3',  'q8_2'],
      lanche_manha: ['q8_4',  'q8_5',  'q8_5_time'],
      almoco:       ['q8_6',  'q8_7',  'q8_7_time'],
      lanche_tarde: ['q8_8',  'q8_9',  'q8_9_time'],
      jantar:       ['q8_10', 'q8_11', 'q8_11_time'],
      ceia:         ['q8_12', 'q8_13', 'q8_13_time'],
    };
    Object.entries(mapaRef).forEach(([ref, [cFaz, cDesc, cHora]]) => {
      r.m8[ref + '_faz']      = r.m8[ref + '_faz']      || r.m8[cFaz];
      r.m8[ref + '_descricao']= r.m8[ref + '_descricao']|| r.m8[cDesc];
      r.m8[ref + '_horario']  = r.m8[ref + '_horario']  || r.m8[cHora];
    });
  }

  // ─── M9: Frequência alimentar ───
  if (r.m9) {
    // Tenta mapear de q9_1, q9_2, etc para nomes (frutas, verduras, etc)
    // Mapeamento provável baseado na ordem das perguntas do questionário
    const mapaFreqAlim = {
      'q9_1': 'frutas',
      'q9_2': 'verduras',
      'q9_3': 'frango_peixe',
      'q9_4': 'ovos',
      'q9_5': 'lacteos',
      'q9_6': 'leguminosas',
      'q9_7': 'integrais',
      'q9_8': 'oleaginosas',
      'q9_9': 'doces',
      'q9_10': 'ultraprocessados',
      'q9_11': 'fastfood',
      'q9_12': 'refrigerantes'
    };
    Object.keys(mapaFreqAlim).forEach(k => {
      if (r.m9[k] !== undefined) {
        r.m9[mapaFreqAlim[k]] = r.m9[k];
      }
    });
  }

  // ─── M10: Atividade física ───
  if (r.m10) {
    r.m10.pratica = r.m10.q10_1 || r.m10.pratica;
    r.m10.nivel_neat = r.m10.q10_neat || r.m10.nivel_neat;
    r.m10.passos_dia = r.m10.q10_passos || r.m10.passos_dia;

    // Constrói detalhes_atividades_json a partir dos checkboxes + freq + int
    const atividades = ['caminhada', 'corrida', 'musc', 'crossfit', 'bike', 'natacao', 'pilates', 'danca', 'futebol', 'basquete', 'volei', 'tenis', 'tmesa', 'boxe', 'artes'];
    const detalhes = {};
    atividades.forEach(at => {
      const freq = r.m10['q10_' + at + '_freq'];
      const inten = r.m10['q10_' + at + '_int'];
      if (freq || inten) {
        detalhes['q10_' + at] = { frequencia: freq, intensidade: inten };
      }
    });
    if (Object.keys(detalhes).length > 0) {
      r.m10.detalhes_atividades_json = detalhes;
    }
  }

  // ─── M13: Mindset ───
  if (r.m13) {
    r.m13.q13_1_habitos_atuais = r.m13.q13_1;
    r.m13.q13_2_capacidade_mudar = r.m13.q13_2;
    r.m13.q13_3_suporte = r.m13.q13_3;
    r.m13.q13_4_metodos_tentados = Array.isArray(r.m13.q13_4) ? r.m13.q13_4.join(', ') : r.m13.q13_4;
    r.m13.q13_5_nao_funcionou = r.m13.q13_5;
    r.m13.q13_6_quero_evitar = r.m13.q13_6;
    r.m13.q13_7_algo_mais = r.m13.q13_7;
  }

  return r;
}

// ═══════════════════════════════════════════════════════════
// CÁLCULOS CLÍNICOS
// ═══════════════════════════════════════════════════════════
const CALC = {
  idade(nascimento) {
    if (!nascimento) return null;
    const nasc = new Date(nascimento);
    if (isNaN(nasc.getTime())) return null;
    const hoje = new Date();
    let idade = hoje.getFullYear() - nasc.getFullYear();
    const m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
    return idade;
  },

  imc(peso, altura) {
    peso = parseFloat(peso); altura = parseFloat(altura);
    if (!peso || !altura) return null;
    const alturaM = altura > 3 ? altura / 100 : altura;
    return +(peso / (alturaM * alturaM)).toFixed(1);
  },

  classificarIMC(imc) {
    if (imc === null) return { label: '—', cor: 'var(--ink-mute)' };
    if (imc < 18.5) return { label: 'Abaixo do peso', cor: 'var(--gold)' };
    if (imc < 25) return { label: 'Peso normal', cor: 'var(--sage)' };
    if (imc < 30) return { label: 'Sobrepeso', cor: 'var(--gold)' };
    if (imc < 35) return { label: 'Obesidade I', cor: 'var(--terracotta)' };
    if (imc < 40) return { label: 'Obesidade II', cor: 'var(--terracotta)' };
    return { label: 'Obesidade III', cor: 'var(--rose)' };
  },

  psqi(m6) {
    if (!m6) return null;
    let score = 0;
    score += parseInt(m6.q6_qualidade) || 0;
    const lat = parseInt(m6.latencia_min) || 0;
    if (lat > 60) score += 3; else if (lat > 30) score += 2; else if (lat > 15) score += 1;
    const dist = (parseInt(m6.q5a)||0) + (parseInt(m6.q5b)||0) + (parseInt(m6.q5c)||0) + (parseInt(m6.q5d)||0);
    if (dist > 9) score += 3; else if (dist > 6) score += 2; else if (dist > 0) score += 1;
    score += parseInt(m6.q7_medicacao) || 0;
    const diurna = (parseInt(m6.q8_sonolencia)||0) + (parseInt(m6.q9_disposicao)||0);
    if (diurna > 4) score += 3; else if (diurna > 2) score += 2; else if (diurna > 0) score += 1;
    const horas = parseFloat(m6.horas_sono) || 0;
    if (horas < 5) score += 3; else if (horas < 6) score += 2; else if (horas < 7) score += 1;
    return Math.min(score, 21);
  },

  classificarPSQI(score) {
    if (score === null) return { label: '—', cor: 'var(--ink-mute)' };
    if (score <= 5) return { label: 'Bom', cor: 'var(--sage)' };
    if (score <= 10) return { label: 'Ruim', cor: 'var(--gold)' };
    return { label: 'Muito ruim', cor: 'var(--rose)' };
  },

  meq(m6) {
    if (!m6) return null;
    let score = 0;
    for (let i = 1; i <= 7; i++) {
      score += parseInt(m6['meq_' + i]) || 0;
    }
    return score;
  },

  classificarCronotipo(score) {
    if (score === null) return { label: '—', emoji: '', cor: 'var(--ink-mute)' };
    if (score >= 24) return { label: 'Matutino', emoji: '🌅', cor: 'var(--gold)' };
    if (score >= 18) return { label: 'Intermediário-matutino', emoji: '🌤️', cor: 'var(--sage)' };
    if (score >= 12) return { label: 'Intermediário-vespertino', emoji: '🌆', cor: 'var(--moss-light)' };
    return { label: 'Vespertino', emoji: '🌙', cor: 'var(--moss)' };
  },

  tmb(peso, altura, idade, sexo) {
    peso = parseFloat(peso); altura = parseFloat(altura); idade = parseInt(idade);
    if (!peso || !altura || !idade) return null;
    const alturaCm = altura < 3 ? altura * 100 : altura;
    const base = (10 * peso) + (6.25 * alturaCm) - (5 * idade);
    const ehHomem = (sexo || '').toLowerCase().includes('masc');
    return Math.round(base + (ehHomem ? 5 : -161));
  },

  get(tmb, m10) {
    if (!tmb) return null;
    let fatorBase = 1.2;
    const neat = (m10 && m10.nivel_neat || '').toLowerCase();
    if (neat.includes('leve')) fatorBase = 1.375;
    else if (neat.includes('moderad')) fatorBase = 1.55;
    else if (neat.includes('ativo')) fatorBase = 1.725;
    return Math.round(tmb * fatorBase);
  },

  scoreSono(m6, psqiScore) {
    if (psqiScore === null) return null;
    return Math.round(Math.max(0, 100 - (psqiScore / 21) * 100));
  },

  scoreAlimentacao(m9) {
    if (!m9) return null;
    const freqMap = { 'Nunca': 0, '1-2x/sem': 1, '3-4x/sem': 2, '5-6x/sem': 3, 'Diariamente': 4, '+1x/dia': 5 };
    const saudaveis = ['frutas', 'verduras', 'frango_peixe', 'ovos', 'lacteos', 'leguminosas', 'integrais', 'oleaginosas'];
    const risco = ['doces', 'ultraprocessados', 'fastfood', 'refrigerantes'];

    let pontosBons = 0, maxBons = saudaveis.length * 5;
    saudaveis.forEach(g => { pontosBons += (freqMap[m9[g]] || 0); });

    let pontosRuins = 0, maxRuins = risco.length * 5;
    risco.forEach(g => { pontosRuins += (freqMap[m9[g]] || 0); });

    const scoreBons = (pontosBons / maxBons) * 100;
    const penalidade = (pontosRuins / maxRuins) * 60;
    return Math.round(Math.max(0, Math.min(100, scoreBons - penalidade + 30)));
  },

  scoreAtividade(m10) {
    if (!m10) return null;
    const pratica = (m10.pratica || '').toLowerCase();
    let base = 0;
    if (pratica.includes('sim')) base = 50;
    else if (pratica.includes('espor')) base = 25;
    const neat = (m10.nivel_neat || '').toLowerCase();
    if (neat.includes('ativo')) base += 30;
    else if (neat.includes('moderad')) base += 20;
    else if (neat.includes('leve')) base += 10;
    if (m10.detalhes_atividades_json) {
      try {
        const det = typeof m10.detalhes_atividades_json === 'string'
          ? JSON.parse(m10.detalhes_atividades_json) : m10.detalhes_atividades_json;
        const numAtividades = Object.keys(det).length;
        base += Math.min(numAtividades * 7, 20);
      } catch (e) {}
    }
    return Math.round(Math.min(100, base));
  },

  scoreComportamento(m7) {
    if (!m7) return null;
    let score = 50;
    const mast = (m7.q7_5_mastigacao || '').toLowerCase();
    if (mast.includes('lenta')) score += 15;
    else if (mast.includes('rápida') || mast.includes('rapida')) score -= 15;
    const noite = (m7.q7_4_come_noite || '').toLowerCase();
    if (noite === 'não' || noite === 'nao') score += 15;
    else if (noite === 'sim') score -= 10;
    const apetite = (m7.q7_1_apetite || '').toLowerCase();
    if (apetite.includes('bom')) score += 20;
    else if (apetite.includes('excessivo')) score -= 15;
    return Math.round(Math.max(0, Math.min(100, score)));
  },

  scoreMindset(m13) {
    if (!m13) return null;
    const habitos = parseInt(m13.q13_1_habitos_atuais) || 0;
    const capacidade = parseInt(m13.q13_2_capacidade_mudar) || 0;
    const score = ((habitos * 0.4) + (capacidade * 0.6)) * 10;
    return Math.round(Math.max(0, Math.min(100, score)));
  },

  macros(dados) {
    const { get, pesoAtual, pesoMeta, objetivo, patologias, cronotipoLabel } = dados;
    if (!get || !pesoAtual) return null;

    const meta = pesoMeta || pesoAtual;
    const pesoAjustado = +((parseFloat(pesoAtual) + parseFloat(meta)) / 2).toFixed(1);

    const obj = (objetivo || '').toLowerCase();
    let metaKcal, gPorKg, ajusteLabel;
    if (obj.includes('emagre') || obj.includes('perder') || obj.includes('gordura') || obj.includes('peso')) {
      metaKcal = Math.round(get * 0.725);
      gPorKg = 2.0;
      ajusteLabel = 'Déficit 27,5%';
    } else if (obj.includes('hipertrofia') || obj.includes('massa') || obj.includes('ganho') || obj.includes('músculo') || obj.includes('musculo')) {
      metaKcal = Math.round(get * 1.10);
      gPorKg = 2.4;
      ajusteLabel = 'Superávit 10%';
    } else {
      metaKcal = get;
      gPorKg = 1.8;
      ajusteLabel = 'Manutenção';
    }

    const pat = (patologias || '').toLowerCase();
    let pctCarbo = 0.40, pctGordura = 0.30;
    const ajustesPatologia = [];
    if (pat.includes('renal') || pat.includes('rim') || pat.includes('insufici')) {
      gPorKg = Math.min(gPorKg, 1.1);
      ajustesPatologia.push('Proteína limitada (questão renal)');
    }
    if (pat.includes('diabet') || pat.includes('glic') || pat.includes('insulin')) {
      pctCarbo = 0.35;
      pctGordura = 0.35;
      ajustesPatologia.push('Carboidrato reduzido (controle glicêmico)');
    }
    if (pat.includes('colesterol') || pat.includes('triglic') || pat.includes('dislipid')) {
      ajustesPatologia.push('Atenção a gordura saturada');
    }
    if (pat.includes('hipertens') || pat.includes('pressão') || pat.includes('pressao')) {
      ajustesPatologia.push('Atenção ao sódio');
    }

    const proteinaG = Math.round(pesoAjustado * gPorKg);
    const proteinaKcal = proteinaG * 4;
    const kcalRestante = metaKcal - proteinaKcal;
    const totalCG = pctCarbo + pctGordura;
    const carboKcal = kcalRestante * (pctCarbo / totalCG);
    const gorduraKcal = kcalRestante * (pctGordura / totalCG);
    const carboG = Math.round(carboKcal / 4);
    const gorduraG = Math.round(gorduraKcal / 9);
    const pctProteinaReal = Math.round((proteinaKcal / metaKcal) * 100);
    const pctCarboReal = Math.round((carboKcal / metaKcal) * 100);
    const pctGorduraReal = Math.round((gorduraKcal / metaKcal) * 100);

    const crono = (cronotipoLabel || '').toLowerCase();
    let tipoCrono = crono.includes('matutino') ? 'matutino' : (crono.includes('vespertino') ? 'vespertino' : 'intermediario');

    // Distribuições por número de refeições e cronotipo (% das kcal do dia)
    const DISTRIBUICOES = {
      matutino: {
        4: { 'Café da manhã': 25, 'Almoço': 35, 'Lanche da tarde': 15, 'Jantar': 25 },
        5: { 'Café da manhã': 22, 'Lanche da manhã': 10, 'Almoço': 33, 'Lanche da tarde': 13, 'Jantar': 22 },
        6: { 'Café da manhã': 20, 'Lanche da manhã': 10, 'Almoço': 30, 'Lanche da tarde': 12, 'Jantar': 20, 'Ceia': 8 },
      },
      vespertino: {
        4: { 'Café da manhã': 15, 'Almoço': 30, 'Lanche da tarde': 20, 'Jantar': 35 },
        5: { 'Café da manhã': 13, 'Lanche da manhã': 8, 'Almoço': 29, 'Lanche da tarde': 18, 'Jantar': 32 },
        6: { 'Café da manhã': 12, 'Lanche da manhã': 8, 'Almoço': 27, 'Lanche da tarde': 16, 'Jantar': 27, 'Ceia': 10 },
      },
      intermediario: {
        4: { 'Café da manhã': 20, 'Almoço': 32, 'Lanche da tarde': 18, 'Jantar': 30 },
        5: { 'Café da manhã': 18, 'Lanche da manhã': 9, 'Almoço': 30, 'Lanche da tarde': 16, 'Jantar': 27 },
        6: { 'Café da manhã': 17, 'Lanche da manhã': 9, 'Almoço': 28, 'Lanche da tarde': 14, 'Jantar': 24, 'Ceia': 8 },
      },
    };
    const distribuicoesPorNum = DISTRIBUICOES[tipoCrono];
    const distribuicao = distribuicoesPorNum[4]; // padrão inicial: 4 refeições

    return {
      pesoAjustado, metaKcal, ajusteLabel, gPorKg,
      proteina: { g: proteinaG, pct: pctProteinaReal },
      carbo: { g: carboG, pct: pctCarboReal },
      gordura: { g: gorduraG, pct: pctGorduraReal },
      ajustesPatologia, distribuicao, cronotipoLabel,
      distribuicoesPorNum,
      pesoAtual: parseFloat(pesoAtual) || null,
      pesoMeta: pesoMeta ? parseFloat(pesoMeta) : null,
      objetivo: objetivo || '',
      tempoMeta: dados.tempoMeta || null
    };
  }
};

// ═══════════════════════════════════════════════════════════
// RED FLAGS
// ═══════════════════════════════════════════════════════════
function detectarRedFlags(m, calc) {
  const flags = [];
  if (calc.imc !== null && calc.imc >= 30)
    flags.push({ tipo: 'IMC elevado', detalhe: `IMC ${calc.imc} indica obesidade`, nivel: 'alto' });
  if (calc.imc !== null && calc.imc < 18.5)
    flags.push({ tipo: 'Baixo peso', detalhe: `IMC ${calc.imc} abaixo do saudável`, nivel: 'medio' });
  if (calc.psqiScore !== null && calc.psqiScore > 10)
    flags.push({ tipo: 'Sono muito comprometido', detalhe: `PSQI ${calc.psqiScore}/21`, nivel: 'alto' });

  if (m.m3 && m.m3.q3_1_patologias) {
    const pat = String(m.m3.q3_1_patologias).toLowerCase();
    if (pat.includes('diabet')) flags.push({ tipo: 'Diabetes', detalhe: 'Requer atenção a carboidratos', nivel: 'alto' });
    if (pat.includes('hipertens') || pat.includes('pressão')) flags.push({ tipo: 'Hipertensão', detalhe: 'Atenção ao sódio', nivel: 'alto' });
    if (pat.includes('renal') || pat.includes('rim')) flags.push({ tipo: 'Questão renal', detalhe: 'Cautela com proteína', nivel: 'alto' });
  }

  if (m.m3 && (m.m3.q3_4_deglutição || m.m3['q3_4_degluti\u00e7\u00e3o']) && (m.m3.q3_4_deglutição || m.m3['q3_4_degluti\u00e7\u00e3o']) !== 'Não') {
    const valor = m.m3.q3_4_deglutição || m.m3['q3_4_degluti\u00e7\u00e3o'];
    flags.push({
      tipo: 'Dificuldade de deglutição',
      detalhe: `Com ${valor.toLowerCase()} — adaptar texturas`,
      nivel: 'alto'
    });
  }

  if (m.m3 && m.m3.q3_2_cirurgia === 'Sim' && m.m3.q3_2_detalhe) {
    const cir = String(m.m3.q3_2_detalhe).toLowerCase();
    if (cir.includes('bariátrica') || cir.includes('bariatrica') ||
        cir.includes('gástrica') || cir.includes('gastrica') ||
        cir.includes('intestinal') || cir.includes('bypass')) {
      flags.push({
        tipo: 'Cirurgia digestiva prévia',
        detalhe: 'Impacta absorção — revisar suplementação',
        nivel: 'alto'
      });
    }
  }

  if (m.m9) {
    const freqRuim = ['Diariamente', '+1x/dia', '5-6x/sem'];
    if (freqRuim.includes(m.m9.ultraprocessados)) flags.push({ tipo: 'Ultraprocessados frequentes', detalhe: m.m9.ultraprocessados, nivel: 'medio' });
    if (freqRuim.includes(m.m9.fastfood)) flags.push({ tipo: 'Fast-food frequente', detalhe: m.m9.fastfood, nivel: 'medio' });
  }

  return flags;
}

// ═══════════════════════════════════════════════════════════
// HELPERS DE RENDERING
// ═══════════════════════════════════════════════════════════
// Card largo (largura total) com valor + conduta escrita. Usado por PSQI e Cronotipo.
function cardConduta(label, valor, sub, cor, conduta) {
  const texto = conduta ? conduta.texto : 'Sem dados suficientes para conduta.';
  const titulo = conduta ? conduta.titulo : label;
  return `
    <div class="conduta-card">
      <div class="conduta-card-head">
        <div class="conduta-card-label">${label}</div>
        <div class="conduta-card-valor" style="color:${cor};">${valor}${sub ? ` <span class="conduta-card-sub">${sub}</span>` : ''}</div>
      </div>
      <div class="conduta-card-body">
        <div class="conduta-card-titulo">${titulo}</div>
        <div class="conduta-card-texto">${texto}</div>
      </div>
    </div>
  `;
}

function metricCard(label, valor, sub, cor) {
  return `
    <div class="metric-card">
      <div class="metric-label">${label}</div>
      <div class="metric-value" style="color: ${cor};">${valor}</div>
      ${sub ? `<div class="metric-sub">${sub}</div>` : ''}
    </div>
  `;
}

// Card clicável (abre modal com conduta). Usado por PSQI e Cronotipo.
function metricCardBotao(label, valor, sub, cor, tipoModal, chave) {
  return `
    <div class="metric-card metric-card-btn" data-modal="${tipoModal}" data-chave="${chave || ''}" role="button" tabindex="0">
      <div class="metric-label">${label} <span class="metric-info">ⓘ</span></div>
      <div class="metric-value" style="color: ${cor};">${valor}</div>
      ${sub ? `<div class="metric-sub">${sub}</div>` : ''}
      <div class="metric-cta">ver conduta</div>
    </div>
  `;
}

// Condutas por cronotipo
const CONDUTA_CRONOTIPO = {
  'Matutino': {
    titulo: '🌅 Cronotipo Matutino',
    texto: 'Pico de energia e apetite pela manhã. Conduta recomendada: concentrar as refeições maiores no café e almoço, reduzindo o volume no jantar. Treinos rendem melhor no início do dia. Evitar refeições pesadas à noite, que prejudicam o sono. Café da manhã reforçado favorece a adesão.'
  },
  'Intermediário-matutino': {
    titulo: '🌤️ Intermediário-matutino',
    texto: 'Tendência a funcionar melhor de manhã, com flexibilidade. Conduta: distribuir as calorias de forma equilibrada ao longo do dia, com leve ênfase no período da manhã/almoço. Treinos no fim da manhã ou início da tarde tendem a render bem.'
  },
  'Intermediário-vespertino': {
    titulo: '🌆 Intermediário-vespertino',
    texto: 'Energia cresce ao longo do dia. Conduta: café da manhã mais leve é aceitável, com refeições maiores concentradas no almoço e fim de tarde. Treinos no fim da tarde tendem a render melhor. Cuidar para o jantar não ser excessivamente tardio.'
  },
  'Vespertino': {
    titulo: '🌙 Cronotipo Vespertino',
    texto: 'Pico de energia e apetite à tarde/noite. Conduta: respeitar o apetite reduzido pela manhã (café mais leve), distribuindo calorias para almoço e jantar. Atenção ao risco de comer tarde demais — estabelecer um horário-limite para a última refeição ajuda o sono e o controle de peso. Treinos rendem melhor no fim do dia.'
  }
};

// Condutas por classificação de PSQI (qualidade do sono)
const CONDUTA_PSQI = {
  'Bom': {
    titulo: '😴 Sono de boa qualidade (PSQI ≤ 5)',
    texto: 'Qualidade de sono adequada. Conduta: manter a higiene do sono atual. O sono preservado favorece a regulação hormonal (leptina/grelina), a recuperação e a adesão ao plano alimentar. Reforçar positivamente esse hábito com a paciente.'
  },
  'Ruim': {
    titulo: '⚠️ Sono comprometido (PSQI 6–10)',
    texto: 'Qualidade de sono prejudicada. Conduta: investigar higiene do sono (telas à noite, cafeína tardia, horários irregulares). Sono ruim aumenta a fome e a preferência por alimentos calóricos, dificultando o emagrecimento. Considerar orientações de sono como parte do plano e reavaliar em consulta.'
  },
  'Muito ruim': {
    titulo: '🚨 Sono muito comprometido (PSQI > 10)',
    texto: 'Qualidade de sono severamente prejudicada — ponto de atenção clínico. Conduta: priorizar a abordagem do sono, pois ele pode ser o principal limitante do resultado. Investigar causas (estresse, ansiedade, apneia). O impacto hormonal do sono ruim compromete diretamente a perda de peso. Avaliar encaminhamento se persistir.'
  }
};

function gerarRadar(scores) {
  const cx = 160, cy = 160, raio = 108;
  const n = scores.length;
  const anguloInicial = -Math.PI / 2;

  function ponto(indice, distancia) {
    const ang = anguloInicial + (2 * Math.PI * indice / n);
    return { x: cx + Math.cos(ang) * distancia, y: cy + Math.sin(ang) * distancia };
  }

  let gradesHtml = '';
  for (let nivel = 1; nivel <= 4; nivel++) {
    const r = (raio * nivel) / 4;
    const pts = scores.map((_, i) => { const p = ponto(i, r); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ');
    gradesHtml += `<polygon points="${pts}" />`;
  }

  let linhasHtml = '';
  scores.forEach((_, i) => {
    const p = ponto(i, raio);
    linhasHtml += `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" />`;
  });

  const pontosData = scores.map((s, i) => {
    const valor = s.valor !== null ? s.valor : 0;
    const p = ponto(i, (raio * valor) / 100);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ');

  let circulosHtml = '';
  scores.forEach((s, i) => {
    const valor = s.valor !== null ? s.valor : 0;
    const p = ponto(i, (raio * valor) / 100);
    circulosHtml += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5"/>`;
  });

  let labelsHtml = '';
  scores.forEach((s, i) => {
    const p = ponto(i, raio + 26);
    let anchor = 'middle';
    if (p.x < cx - 10) anchor = 'end';
    else if (p.x > cx + 10) anchor = 'start';
    labelsHtml += `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="${anchor}">${s.label.toUpperCase()}</text>`;
  });

  const svg = `
    <svg viewBox="-10 -10 340 340" class="radar-svg" xmlns="http://www.w3.org/2000/svg">
      <g stroke="#DDD6C5" fill="none" stroke-width="1">${gradesHtml}</g>
      <g stroke="#C3BBA8" stroke-width="1">${linhasHtml}</g>
      <polygon points="${pontosData}" fill="rgba(61,77,63,0.18)" stroke="#3D4D3F" stroke-width="2.5"/>
      <g fill="#2A3A2C">${circulosHtml}</g>
      <g font-family="Inter Tight, sans-serif" font-size="9" fill="#4A524C" font-weight="600">${labelsHtml}</g>
    </svg>
  `;

  const legendaHtml = scores.map(s => {
    const valor = s.valor !== null ? s.valor : 0;
    const classe = valor >= 60 ? 'good' : (valor >= 40 ? 'mid' : 'bad');
    return `
      <div class="radar-legend-item">
        <div class="radar-legend-top">
          <span class="radar-legend-label">${s.label}</span>
          <span class="radar-legend-value">${s.valor !== null ? s.valor : '—'}</span>
        </div>
        <div class="radar-legend-bar"><div class="radar-legend-fill ${classe}" style="width: ${valor}%;"></div></div>
      </div>
    `;
  }).join('');

  return `
    <div class="radar-card">
      <div class="radar-title">Mapa Nutricional</div>
      <div class="radar-layout">
        ${svg}
        <div class="radar-legend">${legendaHtml}</div>
      </div>
    </div>
  `;
}

function gerarIntroPrescricao(mac) {
  const atual = mac.pesoAtual;
  const meta = mac.pesoMeta;
  let tempo = mac.tempoMeta;

  // Normaliza o tempo: se vier só número ("4"), vira "4 meses".
  // Se já tiver texto (ex: "4 meses", "1 ano", "6 semanas"), mantém.
  if (tempo != null && tempo !== '') {
    const tempoStr = String(tempo).trim();
    if (/^\d+([.,]\d+)?$/.test(tempoStr)) {
      const n = parseFloat(tempoStr.replace(',', '.'));
      tempo = `${tempoStr} ${n === 1 ? 'mês' : 'meses'}`;
    } else {
      tempo = tempoStr;
    }
  } else {
    tempo = null;
  }

  if (atual && meta && atual !== meta) {
    const diff = Math.abs(+(atual - meta).toFixed(1));
    const acao = meta < atual ? 'reduzir' : 'ganhar';
    const prazoTxt = tempo ? ` em <strong>${tempo}</strong>` : '';
    return `<div class="prescricao-intro">
      Meta: <strong>${acao} ${diff} kg</strong>${prazoTxt} — de ${atual} kg para ${meta} kg.
      Os valores abaixo são o ponto de partida; ajuste conforme a evolução da paciente.
    </div>`;
  }
  return `<div class="prescricao-intro">
    Prescrição calculada a partir do gasto energético estimado.
    Use como ponto de partida e ajuste conforme a evolução da paciente.
  </div>`;
}

function gerarCardMacros(mac, imc) {
  const alertaPesoAjustado = (imc !== null && imc >= 30)
    ? `<div class="macro-alerta">⚠️ IMC elevado (${imc}) — proteína calculada sobre peso ajustado (${mac.pesoAjustado} kg). Considere revisar conforme composição corporal.</div>`
    : '';

  const ajustesPat = mac.ajustesPatologia.length > 0
    ? `<div class="macro-ajustes">
         <div class="macro-ajustes-label">Ajustes por patologia:</div>
         ${mac.ajustesPatologia.map(a => `<span class="macro-ajuste-tag">${a}</span>`).join('')}
       </div>`
    : '';

  // Empacota os dados necessários pro seletor de refeições recalcular no front
  const distribData = {
    metaKcal: mac.metaKcal,
    prot: mac.proteina.g, carb: mac.carbo.g, gord: mac.gordura.g,
    dist: mac.distribuicoesPorNum || { 4: mac.distribuicao }
  };

  return `
    <div class="macros-card">
      <div class="macros-header">
        <div class="macros-title">Prescrição Nutricional</div>
        <div class="macros-badge">${mac.ajusteLabel}</div>
      </div>
      ${gerarIntroPrescricao(mac)}

      <div class="presc-layout">
        <div class="presc-kcal">
          <div class="presc-kcal-value">${mac.metaKcal.toLocaleString('pt-BR')}</div>
          <div class="presc-kcal-label">kcal/dia</div>
          <div class="presc-kcal-sub">meta calórica</div>
        </div>
        <div class="presc-macros">
          <div class="presc-macro">
            <div class="presc-macro-top">
              <span class="presc-macro-nome">🥩 Proteína</span>
              <span class="presc-macro-g">${mac.proteina.g}g</span>
            </div>
            <div class="presc-bar"><div class="presc-bar-fill" style="width:${mac.proteina.pct}%; background:var(--terracotta);"></div></div>
            <div class="presc-macro-det">${mac.proteina.pct}% · ${mac.gPorKg}g/kg</div>
          </div>
          <div class="presc-macro">
            <div class="presc-macro-top">
              <span class="presc-macro-nome">🍚 Carboidrato</span>
              <span class="presc-macro-g">${mac.carbo.g}g</span>
            </div>
            <div class="presc-bar"><div class="presc-bar-fill" style="width:${mac.carbo.pct}%; background:var(--gold);"></div></div>
            <div class="presc-macro-det">${mac.carbo.pct}% do total</div>
          </div>
          <div class="presc-macro">
            <div class="presc-macro-top">
              <span class="presc-macro-nome">🥑 Gordura</span>
              <span class="presc-macro-g">${mac.gordura.g}g</span>
            </div>
            <div class="presc-bar"><div class="presc-bar-fill" style="width:${mac.gordura.pct}%; background:var(--sage);"></div></div>
            <div class="presc-macro-det">${mac.gordura.pct}% do total</div>
          </div>
        </div>
      </div>
      ${ajustesPat}
      ${alertaPesoAjustado}

      <div class="distrib-section" data-distrib='${JSON.stringify(distribData).replace(/'/g, "&#39;")}'>
        <div class="distrib-header">
          <div>
            <div class="distrib-titulo">Distribuição nas refeições · <span class="distrib-titulo-crono">Cronotipo ${mac.cronotipoLabel.toLowerCase()}</span></div>
          </div>
          <div class="distrib-seletor">
            <button class="ds-btn active" data-n="4">4</button>
            <button class="ds-btn" data-n="5">5</button>
            <button class="ds-btn" data-n="6">6</button>
            <span class="ds-label">refeições</span>
          </div>
        </div>
        <div class="distrib-grid" style="grid-template-columns: repeat(4, 1fr);">${gerarLinhasDistrib(distribData, 4)}</div>
      </div>
    </div>
  `;
}

// Gera as linhas da distribuição para N refeições (usada no render e no seletor)
function gerarLinhasDistrib(data, n) {
  const dist = data.dist[n] || data.dist[4];
  return Object.keys(dist).map(ref => {
    const pct = dist[ref];
    const kcal = Math.round(data.metaKcal * pct / 100);
    const protRef = Math.round(data.prot * pct / 100);
    const carbRef = Math.round(data.carb * pct / 100);
    const gordRef = Math.round(data.gord * pct / 100);
    const maxG = Math.max(protRef, carbRef, gordRef, 1);
    const barra = (g, cor) => `<div class="dc-macro-bar"><div class="dc-macro-fill" style="width:${(g/maxG*100).toFixed(0)}%; background:${cor};"></div></div>`;
    return `
      <div class="distrib-card">
        <div class="dc-head">
          <span class="dc-ref">${ref}</span>
          <span class="dc-kcal">${kcal} kcal</span>
        </div>
        <div class="dc-macros">
          <div class="dc-macro"><span class="dc-macro-nome">Proteína</span>${barra(protRef, 'var(--terracotta)')}<span class="dc-macro-g">${protRef}g</span></div>
          <div class="dc-macro"><span class="dc-macro-nome">Carboidrato</span>${barra(carbRef, 'var(--gold)')}<span class="dc-macro-g">${carbRef}g</span></div>
          <div class="dc-macro"><span class="dc-macro-nome">Gorduras</span>${barra(gordRef, 'var(--sage)')}<span class="dc-macro-g">${gordRef}g</span></div>
        </div>
      </div>
    `;
  }).join('');
}

function secaoCard(titulo, pares) {
  const rows = pares
    .filter(([k, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `
      <div class="secao-row">
        <span class="secao-key">${k}</span>
        <span class="secao-val">${v}</span>
      </div>
    `).join('');
  if (!rows) return '';
  return `
    <div class="secao-card">
      <div class="secao-title">${titulo}</div>
      <div class="secao-rows">${rows}</div>
    </div>
  `;
}

function renderModulosDetalhados(m) {
  let html = '<div class="rel-sections">';

  if (m.m2) {
    html += secaoCard('🎯 Objetivo & Motivação', [
      ['Objetivo principal', m.m2.q2_1_objetivo_principal],
      ['Objetivo secundário', m.m2.q2_2_objetivo_secundario],
      ['Por quê agora', m.m2.q2_3_por_que],
      ['Alinhamento atual', m.m2.q2_7_alinhamento ? m.m2.q2_7_alinhamento + '/10' : null],
      ['Maiores dificuldades', m.m2.q2_8_dificuldades]
    ]);
  }

  if (m.m3) {
    const cirurgiaDisplay = m.m3.q3_2_cirurgia === 'Sim'
      ? `Sim — ${m.m3.q3_2_detalhe || '(sem detalhes)'}`
      : (m.m3.q3_2_cirurgia || null);
    html += secaoCard('🩺 Histórico Clínico', [
      ['Patologias', m.m3.q3_1_patologias],
      ['Cirurgia prévia', cirurgiaDisplay],
      ['Medicamentos', m.m3.q3_3_medicamentos],
      ['Deglutição', m.m3.q3_4_deglutição || m.m3['q3_4_degluti\u00e7\u00e3o']],
      ['Alergias/intolerâncias', m.m3.q3_5_alergias]
    ]);
  }

  if (m.m5) {
    html += secaoCard('🏠 Estilo de Vida', [
      ['Quem cozinha', m.m5.q5_4_quem_cozinha],
      ['Horário de trabalho', m.m5.q5_7_horario_trabalho],
      ['Rotina refeições no trabalho', m.m5.q5_7b_rotina_trabalho],
      ['Nível de estresse', m.m5.q5_8_estresse],
      ['Fuma', m.m5.q5_9_fuma],
      ['Álcool', m.m5.q5_10_alcool],
      ['Hidratação', m.m5.q5_12_agua]
    ]);
  }

  if (m.m7) {
    html += secaoCard('🍽️ Comportamento Alimentar', [
      ['Apetite', m.m7.q7_1_apetite],
      ['Preferência de sabor', m.m7.q7_2_sabor],
      ['Maior fome', m.m7.q7_3_maior_fome],
      ['Mastigação', m.m7.q7_5_mastigacao],
      ['Não gosta', m.m7.q7_9_nao_gosta],
      ['Gosta muito', m.m7.q7_10_gosta_muito]
    ]);
  }

  if (m.m8) {
    const refeicoes = [
      ['☀️ Café da manhã', m.m8.cafe_faz, m.m8.cafe_descricao, m.m8.cafe_horario],
      ['🍎 Lanche manhã', m.m8.lanche_manha_faz, m.m8.lanche_manha_descricao, m.m8.lanche_manha_horario],
      ['🍽️ Almoço', m.m8.almoco_faz, m.m8.almoco_descricao, m.m8.almoco_horario],
      ['🥪 Lanche tarde', m.m8.lanche_tarde_faz, m.m8.lanche_tarde_descricao, m.m8.lanche_tarde_horario],
      ['🌙 Jantar', m.m8.jantar_faz, m.m8.jantar_descricao, m.m8.jantar_horario],
      ['🌌 Ceia', m.m8.ceia_faz, m.m8.ceia_descricao, m.m8.ceia_horario]
    ];
    const refeicoesValidas = refeicoes.filter(r => (r[1]||'').toLowerCase() !== 'não' && (r[2] || r[3]));
    if (refeicoesValidas.length > 0) {
      html += `<div class="secao-card">
        <div class="secao-title">📋 Recordatório 24h</div>
        <div class="recordatorio-list">
          ${refeicoesValidas.map(r => `
            <div class="refeicao-item">
              <div class="refeicao-head"><span>${r[0]}</span>${r[3] ? `<span class="refeicao-hora">${r[3]}</span>` : ''}</div>
              <div class="refeicao-desc">${r[2] || '<em style="color:var(--ink-mute)">Sem descrição</em>'}</div>
            </div>
          `).join('')}
        </div>
        <div class="ia-hint" id="rec-calc-container" data-refeicoes='${encodeURIComponent(JSON.stringify(refeicoesValidas))}'>⚛ Calculando calorias e macros por IA...</div>
      </div>`;
    }
  }

  if (m.m10) {
    let atividadesHtml = '';
    if (m.m10.detalhes_atividades_json) {
      try {
        const det = typeof m.m10.detalhes_atividades_json === 'string'
          ? JSON.parse(m.m10.detalhes_atividades_json) : m.m10.detalhes_atividades_json;
        const nomes = { q10_caminhada:'🚶 Caminhada', q10_corrida:'🏃 Corrida', q10_musc:'🏋 Musculação', q10_crossfit:'🔥 CrossFit', q10_bike:'🚴 Ciclismo', q10_natacao:'🏊 Natação', q10_pilates:'🧘 Pilates', q10_danca:'💃 Dança', q10_futebol:'⚽ Futebol', q10_basquete:'🏀 Basquete', q10_volei:'🏐 Vôlei', q10_tenis:'🎾 Tênis', q10_tmesa:'🏓 Tênis mesa', q10_boxe:'🥊 Boxe', q10_artes:'🥋 Artes Marciais' };
        atividadesHtml = Object.keys(det).map(k =>
          `<div class="ativ-tag">${nomes[k] || k}: ${det[k].frequencia || '?'}x/sem · ${det[k].intensidade || '?'}</div>`
        ).join('');
      } catch (e) {}
    }
    html += `<div class="secao-card">
      <div class="secao-title">🏃 Atividade Física</div>
      <div class="secao-rows">
        <div class="secao-row"><span class="secao-key">Pratica</span><span class="secao-val">${m.m10.pratica || '—'}</span></div>
        <div class="secao-row"><span class="secao-key">Nível diário (NEAT)</span><span class="secao-val">${m.m10.nivel_neat || '—'}</span></div>
        <div class="secao-row"><span class="secao-key">Passos/dia</span><span class="secao-val">${m.m10.passos_dia || '—'}</span></div>
      </div>
      ${atividadesHtml ? `<div class="ativ-tags">${atividadesHtml}</div>` : ''}
    </div>`;
  }

  if (m.m13) {
    html += secaoCard('🧠 Mindset & Adesão', [
      ['Hábitos atuais', m.m13.q13_1_habitos_atuais ? m.m13.q13_1_habitos_atuais + '/10' : null],
      ['Capacidade de mudar', m.m13.q13_2_capacidade_mudar ? m.m13.q13_2_capacidade_mudar + '/10' : null],
      ['Suporte do ambiente', m.m13.q13_3_suporte],
      ['Já tentou', m.m13.q13_4_metodos_tentados],
      ['O que não funcionou', m.m13.q13_5_nao_funcionou],
      ['Algo mais', m.m13.q13_7_algo_mais]
    ]);
  }

  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════════════════════
// FUNÇÃO PRINCIPAL — busca dados do Supabase e renderiza
// ═══════════════════════════════════════════════════════════

/**
 * Carrega e renderiza o relatório do paciente
 * @param {string} pacienteId
 * @returns {string} HTML do relatório
 */
export async function gerarRelatorio(pacienteId) {
  // Buscar dados do paciente e respostas
  const paciente = await buscarPacientePorId(pacienteId);
  const respostasPorModulo = await buscarRespostas(pacienteId);

  // Adapta as chaves do NutriMap (curtas) para o formato esperado pelo relatório
  const m = adaptarRespostas(respostasPorModulo);

  // Cálculos
  const nascimento = m.m1 ? m.m1.q1_4_nascimento : null;
  const idade = CALC.idade(nascimento);
  const sexo = m.m1 ? m.m1.q1_5_sexo : '';
  const peso = m.m4 ? m.m4.q4_1_peso_atual : null;
  const altura = m.m4 ? m.m4.q4_2_altura : null;
  const pesoDesejado = m.m4 ? m.m4.q4_4_peso_desejado : null;

  const calc = {};
  calc.imc = CALC.imc(peso, altura);
  calc.imcClass = CALC.classificarIMC(calc.imc);
  calc.psqiScore = CALC.psqi(m.m6);
  calc.psqiClass = CALC.classificarPSQI(calc.psqiScore);
  calc.meqScore = CALC.meq(m.m6);
  calc.cronotipo = CALC.classificarCronotipo(calc.meqScore);
  calc.tmb = CALC.tmb(peso, altura, idade, sexo);
  calc.get = CALC.get(calc.tmb, m.m10);

  const radarScores = [
    { label: 'Sono', valor: CALC.scoreSono(m.m6, calc.psqiScore) },
    { label: 'Alimentação', valor: CALC.scoreAlimentacao(m.m9) },
    { label: 'Atividade', valor: CALC.scoreAtividade(m.m10) },
    { label: 'Comportamento', valor: CALC.scoreComportamento(m.m7) },
    { label: 'Mindset', valor: CALC.scoreMindset(m.m13) }
  ];

  const macros = CALC.macros({
    get: calc.get,
    pesoAtual: peso,
    pesoMeta: pesoDesejado,
    objetivo: m.m2 ? m.m2.q2_1_objetivo_principal : '',
    patologias: m.m3 ? m.m3.q3_1_patologias : '',
    cronotipoLabel: calc.cronotipo.label,
    tempoMeta: m.m4 ? m.m4.q4_5_tempo_meta : null
  });

  const redFlags = detectarRedFlags(m, calc);
  const nome = (m.m1 && m.m1.q1_1_nome) || paciente.nome || 'Paciente';
  const iniciais = nome.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

  return `
    <div class="rel-topbar">
      <button class="btn" data-relatorio-action="voltar">← Voltar</button>
      <button class="btn primary" onclick="window.print()">🖨️ Imprimir / PDF</button>
    </div>

    <div class="rel-hero">
      <div class="rel-avatar">${iniciais}</div>
      <div class="rel-hero-info">
        <h1 class="rel-name">${nome}</h1>
        <div class="rel-meta">
          ${idade ? idade + ' anos' : ''} ${sexo ? '· ' + sexo : ''} ${m.m1 && m.m1.q1_6_cidade ? '· ' + m.m1.q1_6_cidade : ''}
        </div>
        <div class="rel-code-badge">${paciente.codigo}</div>
      </div>
      ${m.m2 && m.m2.q2_1_objetivo_principal ? `
      <div class="rel-objetivo">
        <div class="rel-objetivo-label">Objetivo principal</div>
        <div class="rel-objetivo-value">${m.m2.q2_1_objetivo_principal}</div>
      </div>` : ''}
    </div>

    ${redFlags.length > 0 ? `
    <div class="rel-flags">
      <div class="rel-flags-title">⚠️ ${redFlags.length} ${redFlags.length === 1 ? 'ponto de atenção' : 'pontos de atenção'}</div>
      <div class="rel-flags-grid">
        ${redFlags.map(f => `
          <div class="flag-card flag-${f.nivel}">
            <div class="flag-tipo">${f.tipo}</div>
            <div class="flag-detalhe">${f.detalhe}</div>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    <div class="rel-mapa-metrics">
      <div class="rel-mapa-col">
        ${gerarRadar(radarScores)}
      </div>
      <div class="rel-metrics">
        ${metricCard('IMC', calc.imc !== null ? calc.imc : '—', calc.imcClass.label, calc.imcClass.cor)}
        ${metricCard('Peso atual', peso ? peso + ' kg' : '—', pesoDesejado ? 'Meta: ' + pesoDesejado + ' kg' : '', 'var(--moss)')}
        ${metricCard('TMB', calc.tmb ? calc.tmb + ' kcal' : '—', 'Metabolismo basal', 'var(--olive)')}
        ${metricCard('GET estimado', calc.get ? calc.get + ' kcal' : '—', 'Gasto total/dia', 'var(--olive)')}
      </div>
      <div class="rel-condutas">
        ${cardConduta('PSQI (sono)', calc.psqiScore !== null ? calc.psqiScore + '/21' : '—', calc.psqiClass.label, calc.psqiClass.cor, CONDUTA_PSQI[calc.psqiClass.label])}
        ${cardConduta('Cronotipo', (calc.cronotipo.emoji ? calc.cronotipo.emoji + ' ' : '') + calc.cronotipo.label, '', calc.cronotipo.cor, CONDUTA_CRONOTIPO[calc.cronotipo.label])}
      </div>
    </div>

    ${macros ? gerarCardMacros(macros, calc.imc) : ''}

    ${renderModulosDetalhados(m)}

    <div class="rel-disclaimer">
      ⚕️ Este relatório é uma <strong>estimativa preliminar gerada automaticamente</strong> a partir das respostas do paciente. Todos os dados, cálculos e estimativas devem ser <strong>validados pelo nutricionista</strong> antes de qualquer conduta clínica. Não constitui diagnóstico.
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════
// CONDUTA (modal): liga os cliques dos cards PSQI e Cronotipo.
// Chamar após inserir o relatório no DOM.
// ═══════════════════════════════════════════════════════════
export function ativarConduta(container) {
  const root = container || document;
  root.querySelectorAll('.metric-card-btn').forEach(card => {
    const abrir = () => {
      const tipo = card.dataset.modal;
      const chave = card.dataset.chave;
      const fonte = tipo === 'psqi' ? CONDUTA_PSQI : CONDUTA_CRONOTIPO;
      const info = fonte[chave];
      if (!info) return;
      mostrarModalConduta(info.titulo, info.texto);
    };
    card.addEventListener('click', abrir);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });
  });

  // Seletor de nº de refeições (4/5/6)
  root.querySelectorAll('.distrib-section').forEach(sec => {
    let data;
    try { data = JSON.parse(sec.dataset.distrib.replace(/&#39;/g, "'")); } catch { return; }
    const lista = sec.querySelector('.distrib-grid');
    sec.querySelectorAll('.ds-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sec.querySelectorAll('.ds-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const n = parseInt(btn.dataset.n);
        lista.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
        lista.innerHTML = gerarLinhasDistribGlobal(data, n);
      });
    });
  });
}

// Versão acessível globalmente pro seletor (mesma lógica de gerarLinhasDistrib)
function gerarLinhasDistribGlobal(data, n) {
  return gerarLinhasDistrib(data, n);
}

function mostrarModalConduta(titulo, texto) {
  // Remove modal anterior se houver
  document.getElementById('condutaModalOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'condutaModalOverlay';
  overlay.className = 'conduta-overlay';
  overlay.innerHTML = `
    <div class="conduta-modal" role="dialog" aria-modal="true">
      <button class="conduta-fechar" aria-label="Fechar">✕</button>
      <div class="conduta-titulo">${titulo}</div>
      <div class="conduta-texto">${texto}</div>
      <div class="conduta-aviso">Sugestão de conduta baseada na classificação. Sempre valide clinicamente.</div>
    </div>`;
  document.body.appendChild(overlay);
  const fechar = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) fechar(); });
  overlay.querySelector('.conduta-fechar').addEventListener('click', fechar);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ fechar(); document.removeEventListener('keydown', esc);} });
}
