// ═══════════════════════════════════════════════════════════
// CONSULTAS — camada de dados do atendimento
// ═══════════════════════════════════════════════════════════
// Fundação da Fase 2. O Modo Consulta (2B) roda em cima disto; aqui está o
// registro em si: agendar/abrir, escrever durante o atendimento, finalizar.
//
// Depois de FINALIZADA a consulta não muda mais — e isso é garantido pelo RLS,
// não pela tela. As funções abaixo respeitam a mesma regra para falhar cedo,
// com mensagem clara, em vez de deixar o banco recusar em silêncio.

import { sb } from './supabase.js';
import { registrarEvento } from './timeline.js';

export const TIPOS_CONSULTA = {
  primeira:       'Primeira consulta',
  retorno:        'Retorno',
  avaliacao:      'Avaliação',
  acompanhamento: 'Acompanhamento',
  outro:          'Outro',
};

export const STATUS_CONSULTA = {
  agendada:     'Agendada',
  em_andamento: 'Em andamento',
  finalizada:   'Finalizada',
  cancelada:    'Cancelada',
};

/** Campos que o profissional escreve durante o atendimento. */
export const CAMPOS_CLINICOS = ['motivo', 'relato', 'observacoes', 'conduta', 'orientacoes'];

export const estaFechada = (c) => c?.status === 'finalizada';

// ── Leitura ────────────────────────────────────────────────
export async function listarConsultas(pacienteId) {
  const { data, error } = await sb
    .from('consultas')
    .select('*')
    .eq('paciente_id', pacienteId)
    .order('data_hora', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function buscarConsulta(id) {
  const { data, error } = await sb.from('consultas').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

/** Última consulta finalizada — é ela que vale como "último atendimento". */
export async function ultimaConsulta(pacienteId) {
  const { data, error } = await sb
    .from('consultas')
    .select('*')
    .eq('paciente_id', pacienteId)
    .eq('status', 'finalizada')
    .order('data_hora', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Consulta ainda aberta (agendada ou em andamento), se houver. */
export async function consultaAberta(pacienteId) {
  const { data, error } = await sb
    .from('consultas')
    .select('*')
    .eq('paciente_id', pacienteId)
    .in('status', ['agendada', 'em_andamento'])
    .order('data_hora', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// ── Escrita ────────────────────────────────────────────────
export async function criarConsulta(pacienteId, dados = {}) {
  const { data, error } = await sb
    .from('consultas')
    .insert({ ...limpar(dados), paciente_id: pacienteId })
    .select().single();
  if (error) throw error;

  await registrarEvento({
    pacienteId,
    tipo: 'CONSULTATION_STARTED',
    titulo: 'Consulta registrada',
    descricao: `${TIPOS_CONSULTA[data.tipo] || 'Consulta'} de ${fmtData(data.data_hora)}.`,
    entidadeTipo: 'consulta',
    entidadeId: data.id,
    metadata: { tipo: data.tipo, modalidade: data.modalidade },
    dataEvento: data.data_hora,
    chaveDedup: `CONSULTATION_STARTED:${data.id}`,
  });
  return data;
}

/**
 * Salva alterações da consulta. Usado também pelo autosave do Modo Consulta,
 * por isso não gera evento: quem marca a passagem do tempo é a finalização.
 */
export async function atualizarConsulta(id, dados) {
  const { data, error } = await sb
    .from('consultas')
    .update({ ...limpar(dados), atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .select().maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('consulta_finalizada_nao_editavel');
  return data;
}

export async function iniciarConsulta(id) {
  return atualizarConsulta(id, { status: 'em_andamento', iniciada_em: new Date().toISOString() });
}

/**
 * Finaliza: fecha o registro, calcula a duração e deixa a marca na timeline.
 * A partir daqui o RLS impede qualquer edição.
 * @param {object} extras  campos escritos no fechamento (resumo, conduta...)
 */
export async function finalizarConsulta(id, extras = {}) {
  const atual = await buscarConsulta(id);
  if (estaFechada(atual)) throw new Error('consulta_ja_finalizada');

  const fim = new Date();
  const inicio = atual.iniciada_em ? new Date(atual.iniciada_em) : null;
  const duracao = atual.duracao_min
    ?? (inicio ? Math.max(1, Math.round((fim - inicio) / 60000)) : null);

  const { data, error } = await sb
    .from('consultas')
    .update({
      ...limpar(extras),
      status: 'finalizada',
      finalizada_em: fim.toISOString(),
      duracao_min: duracao,
      atualizado_em: fim.toISOString(),
    })
    .eq('id', id)
    .select().maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('consulta_finalizada_nao_editavel');

  await registrarEvento({
    pacienteId: data.paciente_id,
    tipo: 'CONSULTATION_COMPLETED',
    titulo: 'Consulta finalizada',
    descricao: resumoCurto(data),
    entidadeTipo: 'consulta',
    entidadeId: data.id,
    metadata: {
      tipo: data.tipo, modalidade: data.modalidade,
      duracao_min: data.duracao_min, retorno_sugerido: data.retorno_sugerido,
    },
    dataEvento: data.data_hora,
    chaveDedup: `CONSULTATION_COMPLETED:${data.id}`,
  });
  return data;
}

export async function cancelarConsulta(id, motivo) {
  const atual = await buscarConsulta(id);
  if (estaFechada(atual)) throw new Error('consulta_ja_finalizada');

  const data = await atualizarConsulta(id, {
    status: 'cancelada',
    observacoes: motivo ? `${atual.observacoes ? atual.observacoes + '\n' : ''}Cancelada: ${motivo}` : atual.observacoes,
  });
  await registrarEvento({
    pacienteId: data.paciente_id,
    tipo: 'CONSULTATION_CANCELLED',
    titulo: 'Consulta cancelada',
    descricao: motivo || `${TIPOS_CONSULTA[data.tipo] || 'Consulta'} de ${fmtData(data.data_hora)} cancelada.`,
    entidadeTipo: 'consulta',
    entidadeId: data.id,
    chaveDedup: `CONSULTATION_CANCELLED:${data.id}`,
  });
  return data;
}

/** Só apaga o que não virou histórico. Consulta finalizada não some. */
export async function excluirConsulta(id) {
  const atual = await buscarConsulta(id);
  if (estaFechada(atual)) throw new Error('consulta_ja_finalizada');
  const { error } = await sb.from('consultas').delete().eq('id', id);
  if (error) throw error;
  return true;
}

// ── Helpers ────────────────────────────────────────────────
/** Uma linha com o que a consulta produziu — vai para a timeline. */
function resumoCurto(c) {
  const partes = [];
  if (c.duracao_min) partes.push(`${c.duracao_min} min`);
  if (c.conduta) partes.push('conduta registrada');
  if (c.orientacoes) partes.push('orientações registradas');
  if (c.retorno_sugerido) partes.push(`retorno em ${fmtData(c.retorno_sugerido)}`);
  return partes.length
    ? `${TIPOS_CONSULTA[c.tipo] || 'Consulta'} · ${partes.join(' · ')}.`
    : `${TIPOS_CONSULTA[c.tipo] || 'Consulta'} finalizada.`;
}

export function traduzirErroConsulta(msg) {
  const m = String(msg || '').toLowerCase();
  if (m.includes('consulta_ja_finalizada') || m.includes('nao_editavel')) {
    return 'Esta consulta já foi finalizada e não pode mais ser alterada.';
  }
  return msg || 'Algo deu errado.';
}

function limpar(d) {
  const out = {};
  for (const [k, v] of Object.entries(d || {})) {
    if (v === undefined) continue;
    out[k] = (v === '' ? null : v);
  }
  return out;
}

function fmtData(d) {
  if (!d) return '—';
  const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T12:00:00` : d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('pt-BR');
}
