// ═══════════════════════════════════════════════════════════
// AGENDA DE TREINO — dados do painel (dono e recepção)
// ═══════════════════════════════════════════════════════════
// Regras e grade são tabelas com RLS por permissão (agenda.visualizar /
// agenda.editar). Ocupação e marcações passam SÓ pelas funções do banco
// (db/agenda_treino.sql): vaga, limite do plano e trava de concorrência moram
// lá, e a tela não tem atalho para escrever em agenda_movimentos.

import { sb } from './supabase.js';

export const REGRAS_PADRAO = { ativo: false, abre_dias_antes: 2, cancela_horas_antes: 1 };

// Erro de regra (P0001) chega com o texto pronto para o usuário; o resto vira
// uma frase que não assusta e o detalhe vai para o console.
function falha(error, contexto) {
  if (error?.code === 'P0001' && error.message) return new Error(error.message);
  if (error?.code === '42501') return new Error('Você não tem permissão para esta ação na agenda.');
  if (error?.code === '23505') return new Error('Esse horário já existe na grade.');
  console.error(`[agenda] ${contexto}:`, error);
  return new Error('Não foi possível concluir. Confira a conexão e tente de novo.');
}

// ── Regras ─────────────────────────────────────────────────
export async function lerRegras() {
  const { data, error } = await sb.from('agenda_config')
    .select('ativo, abre_dias_antes, cancela_horas_antes').maybeSingle();
  if (error) throw falha(error, 'ler regras');
  return { ...REGRAS_PADRAO, ...(data || {}), cancela_horas_antes: Number(data?.cancela_horas_antes ?? 1) };
}

export async function salvarRegras({ ativo, abre_dias_antes, cancela_horas_antes }) {
  // nutri_id nasce de organizacao_do_auth(); o upsert resolve "primeira vez".
  const { data: atual, error: e1 } = await sb.from('agenda_config').select('nutri_id').maybeSingle();
  if (e1) throw falha(e1, 'ler regras');
  const linha = { ativo: !!ativo, abre_dias_antes, cancela_horas_antes, atualizado_em: new Date().toISOString() };
  const { error } = atual
    ? await sb.from('agenda_config').update(linha).eq('nutri_id', atual.nutri_id)
    : await sb.from('agenda_config').insert(linha);
  if (error) throw falha(error, 'salvar regras');
}

// ── Grade ──────────────────────────────────────────────────
export async function listarGrade() {
  const { data, error } = await sb.from('agenda_grade')
    .select('id, dia_semana, hora_inicio, duracao_min, capacidade, modalidade, ativo')
    .order('dia_semana').order('hora_inicio');
  if (error) throw falha(error, 'listar grade');
  return (data || []).map(g => ({ ...g, hora_inicio: String(g.hora_inicio).slice(0, 5) }));
}

/** Cria os horários; os que já existem (mesmo dia, hora e modalidade) ficam como estão. */
export async function criarHorarios(linhas) {
  if (!linhas.length) return 0;
  const { data, error } = await sb.from('agenda_grade')
    .upsert(linhas, { onConflict: 'nutri_id,dia_semana,hora_inicio,modalidade', ignoreDuplicates: true })
    .select('id');
  if (error) throw falha(error, 'criar horários');
  return (data || []).length;
}

export async function alterarHorario(id, campos) {
  const { error } = await sb.from('agenda_grade').update(campos).eq('id', id);
  if (error) throw falha(error, 'alterar horário');
}

// ── Semana e recepção ──────────────────────────────────────
export async function semanaDoPainel(inicio) {
  const { data, error } = await sb.rpc('agenda_painel_semana', { p_inicio: inicio });
  if (error) throw falha(error, 'semana');
  return data;
}

export async function marcarPelaRecepcao(pacienteId, gradeId, data) {
  const { error } = await sb.rpc('agenda_recepcao_reservar', { p_paciente: pacienteId, p_grade: gradeId, p_data: data });
  if (error) throw falha(error, 'marcar');
}

export async function desmarcarPelaRecepcao(pacienteId, gradeId, data) {
  const { error } = await sb.rpc('agenda_recepcao_desmarcar', { p_paciente: pacienteId, p_grade: gradeId, p_data: data });
  if (error) throw falha(error, 'desmarcar');
}

/** Nomes dos alunos para a busca da recepção (a RLS de pacientes já filtra a organização). */
export async function listarAlunos() {
  const { data, error } = await sb.from('pacientes').select('id, nome').order('nome');
  if (error) throw falha(error, 'listar alunos');
  return data || [];
}
