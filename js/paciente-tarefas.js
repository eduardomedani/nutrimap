// ═══════════════════════════════════════════════════════════
// TAREFAS DO PACIENTE — próximas ações que o profissional guarda
// ═══════════════════════════════════════════════════════════
// Convivem com os alertas automáticos (paciente-alertas.js): o alerta é uma
// leitura do estado atual e some quando a causa acaba; a tarefa é uma decisão
// e fica registrada até ser concluída.
//
// Um alerta pode virar tarefa (origem: 'alerta') — é assim que "revisar plano"
// deixa de ser um aviso repetido e passa a ser um compromisso com prazo.

import { sb } from './supabase.js';

export const STATUS_TAREFA = {
  pendente:     'Pendente',
  em_andamento: 'Em andamento',
  concluida:    'Concluída',
  adiada:       'Adiada',
  cancelada:    'Cancelada',
};

export const CATEGORIAS_TAREFA = [
  'Plano alimentar', 'Treino', 'Avaliação', 'Contato', 'Exames', 'Orientação', 'Outro',
];

const ABERTAS = ['pendente', 'em_andamento', 'adiada'];

/** Tarefas em aberto (as concluídas/canceladas ficam no histórico). */
export async function listarTarefas(pacienteId, { incluirFechadas = false } = {}) {
  let q = sb.from('paciente_tarefas').select('*').eq('paciente_id', pacienteId);
  if (!incluirFechadas) q = q.in('status', ABERTAS);
  const { data, error } = await q
    .order('prazo', { ascending: true, nullsFirst: false })
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function criarTarefa(pacienteId, dados) {
  const { data, error } = await sb
    .from('paciente_tarefas')
    .insert({ ...limpar(dados), paciente_id: pacienteId })
    .select().single();
  if (error) throw error;
  return data;
}

export async function atualizarTarefa(id, dados) {
  const patch = { ...limpar(dados), atualizado_em: new Date().toISOString() };
  if (patch.status === 'concluida' && !patch.concluida_em) patch.concluida_em = new Date().toISOString();
  if (patch.status && patch.status !== 'concluida') patch.concluida_em = null;

  const { data, error } = await sb
    .from('paciente_tarefas')
    .update(patch)
    .eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

export const concluirTarefa = (id) => atualizarTarefa(id, { status: 'concluida' });

export async function excluirTarefa(id) {
  const { error } = await sb.from('paciente_tarefas').delete().eq('id', id);
  if (error) throw error;
  return true;
}

/** Cria uma tarefa a partir de um alerta automático, sem duplicar. */
export async function tarefaDeAlerta(pacienteId, alerta, existentes = []) {
  const jaExiste = existentes.some(t =>
    t.origem === 'alerta' && t.categoria === (alerta.origem || null) && t.titulo === alerta.titulo);
  if (jaExiste) return null;
  return criarTarefa(pacienteId, {
    titulo: alerta.titulo,
    descricao: alerta.descricao,
    categoria: categoriaDoAlerta(alerta.origem),
    prioridade: alerta.prioridade === 'urgente' || alerta.prioridade === 'importante' ? 'alta' : 'normal',
    prazo: alerta.prazo || null,
    origem: 'alerta',
  });
}

function categoriaDoAlerta(origem) {
  return ({
    alimentacao: 'Plano alimentar', treinos: 'Treino',
    avaliacoes: 'Avaliação', paciente: 'Contato',
  })[origem] || 'Outro';
}

/** Prazo em dias (negativo = atrasada); null quando não há prazo. */
export function diasDePrazo(tarefa) {
  if (!tarefa?.prazo) return null;
  const d = new Date(`${tarefa.prazo}T12:00:00`);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function limpar(d) {
  const out = {};
  for (const [k, v] of Object.entries(d || {})) {
    if (v === undefined) continue;
    out[k] = (v === '' ? null : v);
  }
  return out;
}
