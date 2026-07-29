// ═══════════════════════════════════════════════════════════
// HUB DO PACIENTE — serviço de resumo (patientSummaryService)
// ═══════════════════════════════════════════════════════════
// Camada ÚNICA de leitura agregada do paciente. O cabeçalho do Hub, o Painel
// 360° e os alertas leem daqui — em vez de cada tela repetir as mesmas três
// consultas. Uma carga por paciente, com cache; quem grava algo invalida.
//
// Só devolve o que o banco tem. Nada de valor padrão, nada de zero no lugar
// de "não medido": o que falta vem como null e a UI escreve "Não registrado".

import { listarAvaliacoes } from './avaliacoes.js';
import { listarPlanosDoPaciente } from './dieta.js';
import { listarTreinosDoPaciente } from './treinos.js';
import { listarConsultas } from './consultas.js';
import { moduloAtivo } from './paciente-modulos.js';

const DIA_MS = 86400000;
const _cache = new Map();       // pacienteId -> resumo

export function invalidarResumo(pacienteId) {
  if (pacienteId) _cache.delete(pacienteId); else _cache.clear();
}

/**
 * Resumo completo do acompanhamento.
 * @param {object} paciente  registro de `pacientes`
 * @param {object} [opts]
 * @param {boolean} [opts.forcar]  ignora o cache
 */
export async function carregarResumo(paciente, { forcar = false } = {}) {
  if (!paciente?.id) return null;
  if (!forcar && _cache.has(paciente.id)) return _cache.get(paciente.id);

  // Uma rodada de consultas, em paralelo. Cada uma cai para lista vazia se
  // falhar: um módulo fora do ar não pode derrubar o Hub inteiro.
  const [avaliacoes, planos, treinos, consultas] = await Promise.all([
    listarAvaliacoes(paciente.id).catch(() => []),
    listarPlanosDoPaciente(paciente.id).catch(() => []),
    listarTreinosDoPaciente(paciente.id).catch(() => []),
    moduloAtivo('consultas') ? listarConsultas(paciente.id).catch(() => []) : Promise.resolve([]),
  ]);

  const resumo = montarResumo(paciente, { avaliacoes, planos, treinos, consultas });
  _cache.set(paciente.id, resumo);
  return resumo;
}

/**
 * Monta o resumo a partir de dados JÁ carregados — sem tocar na rede.
 * O dashboard usa isto para avaliar dezenas de pacientes com poucas consultas
 * agregadas, reaproveitando exatamente as mesmas regras da ficha.
 */
export function montarResumo(paciente, { avaliacoes = [], planos = [], treinos = [], consultas = [] } = {}) {
  const avs = [...(avaliacoes || [])].sort((a, b) => (a.numero || 0) - (b.numero || 0));
  const primeira = avs[0] || null;
  const ultima = avs[avs.length - 1] || null;
  const anterior = avs.length > 1 ? avs[avs.length - 2] : null;
  const planoAtivo = (planos || []).find(p => p.ativo) || null;
  const treinoAtivo = (treinos || []).find(t => t.ativo) || null;

  // Só consulta FINALIZADA conta como atendimento; agendada é compromisso.
  const cs = [...(consultas || [])].sort((a, b) => new Date(b.data_hora) - new Date(a.data_hora));
  const ultimaConsulta = cs.find(c => c.status === 'finalizada') || null;
  const consultaAberta = cs.filter(c => c.status === 'agendada' || c.status === 'em_andamento').pop() || null;
  // Enquanto não há agenda, o "próximo retorno" é o que a última consulta sugeriu.
  const retornoSugerido = ultimaConsulta?.retorno_sugerido || null;

  const resumo = {
    paciente,
    avaliacoes: avs,
    planos: planos || [],
    treinos: treinos || [],
    consultas: cs,
    primeira, ultima, anterior,
    planoAtivo, treinoAtivo,
    ultimaConsulta, consultaAberta, retornoSugerido,
    metricas: calcularMetricas({ primeira, ultima, anterior, planoAtivo }),
    dias: {
      cadastro:      diasDesde(paciente.criado_em),
      ultimaAv:      ultima ? diasDesde(ultima.data_avaliacao) : null,
      planoPublicado: planoAtivo ? diasDesde(planoAtivo.data_inicio || planoAtivo.criado_em) : null,
      treinoAte:     treinoAtivo ? diasAte(treinoAtivo.data_fim) : null,
      planoAte:      planoAtivo ? diasAte(planoAtivo.data_fim) : null,
      ultimaConsulta: ultimaConsulta ? diasDesde(ultimaConsulta.data_hora) : null,
      retornoEm:     retornoSugerido ? diasAte(retornoSugerido) : null,
    },
  };

  resumo.score = calcularScore(resumo);
  resumo.status = calcularStatus(resumo);
  return resumo;
}

// ── Métricas ───────────────────────────────────────────────
function calcularMetricas({ primeira, ultima, anterior, planoAtivo }) {
  const pesoIni = num(primeira?.peso);
  const pesoAtu = num(ultima?.peso);
  const pesoAnt = num(anterior?.peso);

  return {
    pesoInicial: pesoIni,
    pesoAtual:   pesoAtu,
    // Só há "variação" com pelo menos duas avaliações.
    variacao:    (pesoIni != null && pesoAtu != null && primeira !== ultima)
                   ? arred(pesoAtu - pesoIni, 1) : null,
    variacaoUltima: (pesoAnt != null && pesoAtu != null) ? arred(pesoAtu - pesoAnt, 1) : null,
    // pct_gordura vem como fração; 0 = sem protocolo de dobras, não "0%".
    gordura:     num(ultima?.pct_gordura) ? arred(num(ultima.pct_gordura) * 100, 1) : null,
    gorduraAnterior: num(anterior?.pct_gordura) ? arred(num(anterior.pct_gordura) * 100, 1) : null,
    massaMagra:  num(ultima?.peso_magro),
    massaGorda:  num(ultima?.peso_gordura),
    imc:         num(ultima?.imc),
    cintura:     num(ultima?.per_cintura),
    quadril:     num(ultima?.per_quadril),
    abdomen:     num(ultima?.per_abdomen),
    objetivo:    (planoAtivo?.objetivo || '').trim() || null,
    kcalPlano:   num(planoAtivo?.kcal_meta),
  };
}

// ── Score de acompanhamento ────────────────────────────────
// NÃO é score de saúde nem diagnóstico: mede o quanto o acompanhamento está
// em dia. Cada critério só entra se for mensurável com o que existe hoje;
// com menos de 3 critérios, o serviço diz "dados insuficientes" em vez de
// inventar um número.
const MIN_CRITERIOS = 3;

function calcularScore(r) {
  // Paciente recém-cadastrado não tem score baixo: não tem score. Sem
  // avaliação, plano nem treino, todo critério mediria só ausência — e "0/100"
  // seria uma leitura injusta de quem acabou de entrar.
  if (!r.avaliacoes.length && !r.planoAtivo && !r.treinoAtivo) {
    return { valor: null, criterios: [], motivo: 'Dados insuficientes para calcular' };
  }

  const criterios = [];

  // Anamnese respondida
  criterios.push({
    id: 'anamnese', label: 'Anamnese respondida', peso: 1,
    nota: (r.paciente.status === 'completo') ? 100 : 0,
    detalhe: r.paciente.status === 'completo' ? 'Questionário concluído' : 'Questionário pendente',
  });

  // Avaliação em dia (até 60 dias = 100; 120+ = 0)
  if (r.ultima) {
    const d = r.dias.ultimaAv ?? 0;
    criterios.push({
      id: 'avaliacao', label: 'Avaliação em dia', peso: 1.5,
      nota: faixa(d, 60, 120),
      detalhe: `Última avaliação há ${d} ${d === 1 ? 'dia' : 'dias'}`,
    });
  }

  // Plano alimentar ativo e recente (até 30 dias = 100; 90+ = 0)
  if (r.planoAtivo) {
    const d = r.dias.planoPublicado ?? 0;
    criterios.push({
      id: 'plano', label: 'Plano alimentar vigente', peso: 1.5,
      nota: faixa(d, 30, 90),
      detalhe: `Publicado há ${d} ${d === 1 ? 'dia' : 'dias'}`,
    });
  } else {
    criterios.push({ id: 'plano', label: 'Plano alimentar vigente', peso: 1.5, nota: 0, detalhe: 'Nenhum plano ativo' });
  }

  // Treino ativo
  criterios.push({
    id: 'treino', label: 'Treino vigente', peso: 1,
    nota: r.treinoAtivo ? (r.dias.treinoAte != null && r.dias.treinoAte < 0 ? 40 : 100) : 0,
    detalhe: r.treinoAtivo
      ? (r.dias.treinoAte != null && r.dias.treinoAte < 0 ? 'Treino vencido' : 'Treino em vigor')
      : 'Nenhum treino ativo',
  });

  // Consultas: só entra no cálculo se o módulo existir e houver histórico —
  // um paciente antigo, sem consulta registrada, não deve ser punido por isso.
  if (moduloAtivo('consultas') && r.ultimaConsulta) {
    const d = r.dias.ultimaConsulta ?? 0;
    criterios.push({
      id: 'consulta', label: 'Consulta recente', peso: 1.5,
      nota: faixa(d, 45, 120),
      detalhe: `Último atendimento há ${d} ${d === 1 ? 'dia' : 'dias'}`,
    });
  }

  // Evolução registrada (duas ou mais avaliações = há acompanhamento medido)
  if (r.avaliacoes.length) {
    criterios.push({
      id: 'evolucao', label: 'Evolução acompanhada', peso: 1,
      nota: r.avaliacoes.length >= 3 ? 100 : r.avaliacoes.length === 2 ? 70 : 35,
      detalhe: `${r.avaliacoes.length} ${r.avaliacoes.length === 1 ? 'avaliação registrada' : 'avaliações registradas'}`,
    });
  }

  const validos = criterios.filter(c => c.nota != null);
  if (validos.length < MIN_CRITERIOS) {
    return { valor: null, criterios: validos, motivo: 'Dados insuficientes para calcular' };
  }
  const somaPesos = validos.reduce((s, c) => s + c.peso, 0);
  const valor = Math.round(validos.reduce((s, c) => s + c.nota * c.peso, 0) / somaPesos);
  return {
    valor,
    criterios: validos,
    // Aderência, check-ins e consultas entram no cálculo quando esses módulos existirem.
    base: moduloAtivo('consultas')
      ? 'Calculado com base em anamnese, consultas, avaliações, plano, treino e evolução registrada.'
      : 'Calculado com base em anamnese, avaliações, plano, treino e evolução registrada.',
  };
}

/** 100 até `bom` dias, cai linearmente até 0 em `ruim` dias. */
function faixa(dias, bom, ruim) {
  if (dias <= bom) return 100;
  if (dias >= ruim) return 0;
  return Math.round(100 * (ruim - dias) / (ruim - bom));
}

// ── Status geral ───────────────────────────────────────────
// Linguagem descritiva, nunca alarmista, e nunca clínica.
function calcularStatus(r) {
  if (!r.avaliacoes.length && !r.planoAtivo && !r.treinoAtivo) {
    return { id: 'aguardando', label: 'Aguardando dados', tom: 'neutro',
             detalhe: 'Sem avaliação, plano ou treino registrados até agora.' };
  }
  const semContato = Math.max(r.dias.ultimaAv ?? 0, r.dias.planoPublicado ?? 0);
  if (semContato >= 90) {
    return { id: 'parado', label: 'Sem acompanhamento recente', tom: 'alerta',
             detalhe: `Nada registrado há ${semContato} dias.` };
  }
  const s = r.score?.valor;
  if (s == null) {
    return { id: 'acompanhamento', label: 'Em acompanhamento', tom: 'info',
             detalhe: 'Ainda faltam dados para avaliar o ritmo.' };
  }
  if (s < 50) {
    return { id: 'atencao', label: 'Atenção necessária', tom: 'alerta',
             detalhe: 'Há itens do acompanhamento em atraso.' };
  }
  if (s >= 80) {
    return { id: 'evoluindo', label: 'Evoluindo bem', tom: 'positivo',
             detalhe: 'Acompanhamento em dia.' };
  }
  return { id: 'acompanhamento', label: 'Em acompanhamento', tom: 'info',
           detalhe: 'Acompanhamento em andamento, com pontos a revisar.' };
}

// ── Helpers ────────────────────────────────────────────────
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const arred = (v, c = 1) => Number(Number(v).toFixed(c));

export function diasDesde(d) {
  const dt = paraData(d);
  return dt ? Math.max(0, Math.floor((Date.now() - dt.getTime()) / DIA_MS)) : null;
}
export function diasAte(d) {
  const dt = paraData(d);
  return dt ? Math.ceil((dt.getTime() - Date.now()) / DIA_MS) : null;
}
function paraData(d) {
  if (!d) return null;
  const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T12:00:00` : d);
  return isNaN(dt.getTime()) ? null : dt;
}

/** Sinaliza para a UI se vale a pena oferecer a aba de evolução. */
export const temEvolucao = (r) => moduloAtivo('evolucao') && (r?.avaliacoes?.length || 0) >= 2;
