// ═══════════════════════════════════════════════════════════
// AGENDA DE TREINO — dados do app do aluno
// ═══════════════════════════════════════════════════════════
// Só chama as funções do banco (db/agenda_treino.sql). O aluno não lê tabela
// nenhuma direto: plano, vaga, limite semanal e prazos são conferidos NO
// SERVIDOR. A tela usa o que volta daqui só para mostrar; quem decide é lá.

import { sb } from './supabase.js';

// O erro de regra vem com a frase pronta (raise exception ... P0001). Erro de
// rede/permissão vira frase de gente.
function mensagem(error) {
  if (!error) return '';
  if (error.code === 'P0001' && error.message) return error.message;
  if (/fetch|network|Failed/i.test(error.message || '')) return 'Sem conexão. Tente de novo.';
  return 'Não foi possível concluir. Tente de novo.';
}

/** A agenda está ligada para a academia deste aluno? (false também se a migração não existir) */
export async function agendaAtiva() {
  const { data, error } = await sb.rpc('agenda_aluno_semana', { p_inicio: null });
  if (error) return false;
  return !!data?.ativo;
}

/** A semana (seg–dom) que contém `inicio` (YYYY-MM-DD; null = esta semana). */
export async function semanaDaAgenda(inicio = null) {
  const { data, error } = await sb.rpc('agenda_aluno_semana', { p_inicio: inicio });
  if (error) throw new Error(mensagem(error));
  return data;
}

export async function reservarHorario(gradeId, data) {
  const { error } = await sb.rpc('agenda_aluno_reservar', { p_grade: gradeId, p_data: data });
  if (error) throw new Error(mensagem(error));
}

export async function desmarcarHorario(gradeId, data) {
  const { error } = await sb.rpc('agenda_aluno_desmarcar', { p_grade: gradeId, p_data: data });
  if (error) throw new Error(mensagem(error));
}
