// ═══════════════════════════════════════════════════════════
// HUB DO PACIENTE — alertas e próximas ações (patientAlertsService)
// ═══════════════════════════════════════════════════════════
// Regras explícitas sobre dados reais. Nada aqui é persistido: um alerta é
// uma leitura do estado atual, então some sozinho quando a causa é resolvida.
// (As tarefas criadas à mão, essas sim, ganham tabela na Fase 1B.)
//
// Cada regra declara de qual fundação depende — quando o módulo de consultas
// ou de check-ins existir, basta acrescentar a regra aqui: o Painel 360° e o
// dashboard passam a mostrá-la sem nenhuma outra alteração.
//
// Prioridades: informativo < atencao < importante < urgente.
// "urgente" é reservado para regra objetiva e rara; nada clínico.

import { moduloAtivo } from './paciente-modulos.js';

export const PRIORIDADES = {
  urgente:     { ordem: 0, label: 'Urgente',     tom: 'perigo' },
  importante:  { ordem: 1, label: 'Importante',  tom: 'alerta' },
  atencao:     { ordem: 2, label: 'Atenção',     tom: 'atencao' },
  informativo: { ordem: 3, label: 'Informativo', tom: 'neutro' },
};

/**
 * Alertas do paciente a partir do resumo (paciente-resumo.js).
 * @returns {Array<{id,tipo,titulo,descricao,prioridade,origem,prazo,acao}>}
 */
export function alertasDoPaciente(r) {
  if (!r) return [];
  const out = [];
  const add = (a) => out.push(a);

  // ── Anamnese ────────────────────────────────────────────
  if ((r.paciente.status || 'aguardando') !== 'completo') {
    const d = r.dias.cadastro;
    add({
      id: 'anamnese-incompleta', tipo: 'ANAMNESE_PENDENTE', origem: 'paciente',
      titulo: 'Anamnese incompleta',
      descricao: d != null
        ? `O paciente ainda não finalizou o questionário — cadastrado há ${d} ${d === 1 ? 'dia' : 'dias'}.`
        : 'O paciente ainda não finalizou o questionário.',
      prioridade: (d ?? 0) > 14 ? 'importante' : 'atencao',
      icone: 'clipboard-list',
      acao: { label: 'Ver anamnese', aba: 'anamnese' },
    });
  }

  // ── Plano alimentar ─────────────────────────────────────
  if (!r.planoAtivo) {
    add({
      id: 'sem-plano', tipo: 'MEAL_PLAN_MISSING', origem: 'alimentacao',
      titulo: 'Sem plano alimentar ativo',
      descricao: 'Este paciente ainda não tem um plano alimentar publicado.',
      prioridade: 'importante', icone: 'utensils',
      acao: { label: 'Prescrever plano', aba: 'planejamento' },
    });
  } else {
    // Sem data de revisão definida, o tempo desde a publicação é SUGESTÃO, não
    // atraso (10/11/2026). Com data_fim, quem fala é "vencendo/vencido".
    const d = r.dias.planoPublicado;
    if (d != null && d >= 30 && !r.planoAtivo.data_fim) {
      add({
        id: 'plano-antigo', tipo: 'MEAL_PLAN_STALE', origem: 'alimentacao',
        titulo: 'Revisão do plano sugerida',
        descricao: `Publicado em ${fmtData(r.planoAtivo.data_inicio || r.planoAtivo.criado_em)} (há ${d} dias), sem data de revisão definida.`,
        prioridade: 'atencao', icone: 'file-pen',
        desde: r.planoAtivo.data_inicio || r.planoAtivo.criado_em,
        acao: { label: 'Revisar plano', aba: 'planejamento' },
      });
    }
    const ate = r.dias.planoAte;
    if (ate != null && ate <= 7) {
      add({
        id: 'plano-vencendo', tipo: 'MEAL_PLAN_EXPIRING', origem: 'alimentacao',
        titulo: ate < 0 ? 'Plano alimentar vencido' : 'Plano alimentar vencendo',
        descricao: ate < 0
          ? `Terminou em ${fmtData(r.planoAtivo.data_fim)}.`
          : `Termina em ${fmtData(r.planoAtivo.data_fim)}.`,
        prioridade: ate < 0 ? 'importante' : 'atencao', icone: 'calendar-clock',
        prazo: r.planoAtivo.data_fim,
        acao: { label: 'Abrir plano', aba: 'planejamento' },
      });
    }
  }

  // ── Treino ──────────────────────────────────────────────
  if (!r.treinoAtivo) {
    add({
      id: 'sem-treino', tipo: 'WORKOUT_MISSING', origem: 'treinos',
      titulo: 'Sem treino ativo',
      descricao: 'Nenhum treino publicado para este paciente.',
      prioridade: 'atencao', icone: 'dumbbell',
      acao: { label: 'Prescrever treino', aba: 'treinos' },
    });
  } else {
    const ate = r.dias.treinoAte;
    if (ate != null && ate <= 7) {
      add({
        id: 'treino-vencendo', tipo: 'WORKOUT_EXPIRING', origem: 'treinos',
        titulo: ate < 0 ? 'Treino vencido' : 'Treino próximo da revisão',
        descricao: ate < 0
          ? `Terminou em ${fmtData(r.treinoAtivo.data_fim)}.`
          : `Termina em ${fmtData(r.treinoAtivo.data_fim)}.`,
        prioridade: ate < 0 ? 'importante' : 'atencao', icone: 'calendar-clock',
        prazo: r.treinoAtivo.data_fim,
        acao: { label: 'Abrir treino', aba: 'treinos' },
      });
    }
  }

  // ── Avaliação física ────────────────────────────────────
  if (!r.ultima) {
    add({
      id: 'sem-avaliacao', tipo: 'ASSESSMENT_MISSING', origem: 'avaliacoes',
      titulo: 'Sem avaliação física',
      descricao: 'Nenhuma avaliação registrada até agora.',
      prioridade: 'atencao', icone: 'ruler',
      acao: { label: 'Nova avaliação', aba: 'avaliacoes' },
    });
  } else {
    // Não há prazo de reavaliação no sistema: é sugestão, não "atrasada".
    const d = r.dias.ultimaAv;
    if (d != null && d >= 60) {
      add({
        id: 'avaliacao-atrasada', tipo: 'ASSESSMENT_STALE', origem: 'avaliacoes',
        titulo: 'Nova avaliação sugerida',
        descricao: `A última avaliação foi em ${fmtData(r.ultima.data_avaliacao)} (há ${d} dias).`,
        prioridade: 'atencao', icone: 'ruler',
        desde: r.ultima.data_avaliacao,
        acao: { label: 'Nova avaliação', aba: 'avaliacoes' },
      });
    }
  }

  // Avaliação com dado impossível (gordura < 0 ou ≥ 100%, massa magra acima do
  // peso): não entra nos números; aqui vira pendência. O dado não é corrigido
  // sozinho — quem decide é o profissional, abrindo a avaliação.
  for (const x of (r.revisar || []).slice(0, 2)) {
    add({
      id: `revisar-av-${x.av.id || x.av.numero}`, tipo: 'ASSESSMENT_INVALID', origem: 'avaliacoes',
      titulo: 'Revisar dados da avaliação',
      descricao: `AV ${x.av.numero}${x.av.data_avaliacao ? ` (${fmtData(x.av.data_avaliacao)})` : ''}: ${x.problemas.join(' ')}`,
      prioridade: 'importante', icone: 'triangle-alert',
      desde: x.av.data_avaliacao,
      acao: { label: 'Abrir avaliação', aba: 'avaliacoes' },
    });
  }

  // ── Evolução: peso estagnado ────────────────────────────
  // Só com objetivo declarado no plano e três avaliações — sem isso, "parado"
  // não significa nada.
  const pesos = r.avaliacoes.filter(a => a.peso != null).slice(-3);
  if (pesos.length === 3 && r.metricas.objetivo) {
    const variacao = Math.abs(Number(pesos[2].peso) - Number(pesos[0].peso));
    const dias = diffDias(pesos[0].data_avaliacao, pesos[2].data_avaliacao);
    if (variacao < 0.5 && dias >= 45) {
      add({
        id: 'peso-estagnado', tipo: 'WEIGHT_PLATEAU', origem: 'avaliacoes',
        titulo: 'Peso estável nas últimas avaliações',
        descricao: `Variação de ${variacao.toFixed(1)} kg em ${dias} dias. Pode valer revisar o plano.`,
        prioridade: 'informativo', icone: 'trending-up',
        acao: { label: 'Revisar plano', aba: 'planejamento' },
      });
    }
  }

  // ── Sem acompanhamento recente ──────────────────────────
  if (r.status?.id === 'parado') {
    // Título FIXO (a dedução de tarefa repetida compara o título); os dias
    // vão na descrição.
    add({
      id: 'sem-acompanhamento', tipo: 'FOLLOWUP_MISSING', origem: 'paciente',
      titulo: 'Sem acompanhamento recente',
      descricao: r.status.detalhe,
      prioridade: 'importante', icone: 'clock',
      ...(moduloAtivo('consultas') ? { acao: { label: 'Registrar consulta', aba: 'consultas' } } : {}),
    });
  }

  // ── Consultas ───────────────────────────────────────────
  if (moduloAtivo('consultas')) {
    if (r.consultaAberta) {
      add({
        id: 'consulta-aberta', tipo: 'CONSULTATION_OPEN', origem: 'consultas',
        titulo: r.consultaAberta.status === 'em_andamento' ? 'Consulta em andamento' : 'Consulta em aberto',
        descricao: r.consultaAberta.status === 'em_andamento'
          ? 'Há um atendimento iniciado e ainda não finalizado.'
          : `Consulta registrada para ${fmtData(r.consultaAberta.data_hora)} sem finalização.`,
        prioridade: 'atencao', icone: 'stethoscope',
        acao: { label: 'Abrir consulta', aba: 'consultas' },
      });
    }
    const dRet = r.dias.retornoEm;
    if (dRet != null && dRet <= 7) {
      add({
        id: 'retorno', tipo: 'FOLLOWUP_DUE', origem: 'consultas',
        titulo: dRet < 0 ? 'Retorno atrasado' : 'Retorno próximo',
        descricao: dRet < 0
          ? `O retorno sugerido era ${fmtData(r.retornoSugerido)}.`
          : `Retorno sugerido para ${fmtData(r.retornoSugerido)}.`,
        prioridade: dRet < 0 ? 'importante' : 'informativo',
        icone: 'calendar-clock', prazo: r.retornoSugerido,
        acao: { label: 'Registrar consulta', aba: 'consultas' },
      });
    }
    const dCons = r.dias.ultimaConsulta;
    if (r.ultimaConsulta && dCons != null && dCons >= 90 && dRet == null) {
      add({
        id: 'sem-consulta', tipo: 'CONSULTATION_STALE', origem: 'consultas',
        titulo: 'Sem consulta há bastante tempo',
        descricao: `O último atendimento foi há ${dCons} dias.`,
        prioridade: 'atencao', icone: 'stethoscope',
        acao: { label: 'Registrar consulta', aba: 'consultas' },
      });
    }
  }

  // ── Regras que dependem de módulos ainda não construídos ─
  // (check-ins aguardando análise, exame pendente...)
  // Entram aqui quando as fundações existirem — a UI não muda.
  if (moduloAtivo('checkins')) { /* Fase 3 */ }
  if (moduloAtivo('agendamentos')) { /* Fase 6 */ }

  return ordenarPendencias(out);
}

/**
 * Prioridade primeiro; dentro da mesma prioridade, o MAIS ANTIGO primeiro
 * (`desde`: data em que o motivo começou). Sem data, vai depois dos datados.
 */
export function ordenarPendencias(lista) {
  const t = v => { const d = v ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? `${v}T12:00:00` : v) : null; return d && !isNaN(d) ? d.getTime() : Infinity; };
  return [...(lista || [])].sort((a, b) =>
    ((PRIORIDADES[a.prioridade]?.ordem ?? 9) - (PRIORIDADES[b.prioridade]?.ordem ?? 9))
    || (t(a.desde) - t(b.desde)));
}

/** Conta por prioridade — usado no cabeçalho e, na Fase 1B, no dashboard. */
export function resumoDeAlertas(alertas) {
  const c = { urgente: 0, importante: 0, atencao: 0, informativo: 0 };
  (alertas || []).forEach(a => { if (c[a.prioridade] != null) c[a.prioridade]++; });
  return { ...c, total: (alertas || []).length };
}

function fmtData(d) {
  if (!d) return '—';
  const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T12:00:00` : d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('pt-BR');
}
function diffDias(a, b) {
  const d1 = new Date(`${a}T12:00:00`), d2 = new Date(`${b}T12:00:00`);
  if (isNaN(d1) || isNaN(d2)) return 0;
  return Math.round(Math.abs(d2 - d1) / 86400000);
}
