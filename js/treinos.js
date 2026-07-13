// ═══════════════════════════════════════════════════════════
// TREINOS — Prescrição de treino: biblioteca, treinos, itens e progressão
// ═══════════════════════════════════════════════════════════
// Single-tenant por nutri. O RLS filtra por nutri_id automaticamente; os inserts
// gravam nutri_id explicitamente (mesmo padrão de avaliacoes.criarAvaliacao).
//   · treinos com paciente_id NULL      = MODELO (biblioteca reutilizável)
//   · treinos com paciente_id preenchido = PRESCRIÇÃO de um aluno
//
// Tabelas: exercicios, treinos, treino_exercicios, treino_progressao.

import { sb } from './supabase.js';

// ───────────────────────────────────────────────────────────
// BIBLIOTECA DE EXERCÍCIOS  (exercicios)
// ───────────────────────────────────────────────────────────

/** Lista todos os exercícios do nutri (alfabético). */
export async function listarExercicios() {
  const { data, error } = await sb
    .from('exercicios')
    .select('*')
    .order('nome', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function buscarExercicio(id) {
  const { data, error } = await sb
    .from('exercicios').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

/** Cria exercício. Recebe { nome, grupo_muscular, equipamento, video_url, observacoes }. */
export async function criarExercicio(nutriId, dados) {
  const { data, error } = await sb
    .from('exercicios')
    .insert({ ...dados, nutri_id: nutriId })
    .select().single();
  if (error) throw error;
  return data;
}

export async function atualizarExercicio(id, dados) {
  const { data, error } = await sb
    .from('exercicios')
    .update(dados)
    .eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

/** Exclui exercício. Falha se estiver em uso (FK restrict em treino_exercicios). */
export async function excluirExercicio(id) {
  const { error } = await sb.from('exercicios').delete().eq('id', id);
  if (error) throw error;
  return true;
}

// ───────────────────────────────────────────────────────────
// TREINOS  (treinos) — modelos e prescrições
// ───────────────────────────────────────────────────────────

/** Lista MODELOS da biblioteca (paciente_id null), mais recentes primeiro. */
export async function listarModelos() {
  const { data, error } = await sb
    .from('treinos')
    .select('*')
    .is('paciente_id', null)
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Lista treinos (prescrições) de um paciente, mais recentes primeiro. */
export async function listarTreinosDoPaciente(pacienteId) {
  const { data, error } = await sb
    .from('treinos')
    .select('*')
    .eq('paciente_id', pacienteId)
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function buscarTreino(id) {
  const { data, error } = await sb
    .from('treinos').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

/**
 * Cria treino. Recebe { nome, divisao, data_inicio, ativo, paciente_id }.
 * paciente_id ausente/null => MODELO; preenchido => prescrição do aluno.
 */
export async function criarTreino(nutriId, dados) {
  const { data, error } = await sb
    .from('treinos')
    .insert({ ...dados, nutri_id: nutriId })
    .select().single();
  if (error) throw error;
  return data;
}

export async function atualizarTreino(id, dados) {
  const { data, error } = await sb
    .from('treinos')
    .update(dados)
    .eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

/** Exclui treino. Cascade remove os itens (treino_exercicios) e a progressão. */
export async function excluirTreino(id) {
  const { error } = await sb.from('treinos').delete().eq('id', id);
  if (error) throw error;
  return true;
}

/**
 * Instancia um MODELO como prescrição de um aluno: cria um novo treino
 * copiando os dados do modelo + todos os itens, agora com paciente_id.
 * Reaproveita o nutri_id do próprio modelo. Retorna o treino recém-criado.
 */
export async function prescreverModeloParaPaciente(modeloId, pacienteId, extras = {}) {
  const modelo = await buscarTreino(modeloId);
  const itens  = await listarItensDoTreino(modeloId);

  const novo = await criarTreino(modelo.nutri_id, {
    nome:        modelo.nome,
    divisao:     modelo.divisao,
    data_inicio: extras.data_inicio ?? modelo.data_inicio ?? null,
    ativo:       extras.ativo ?? true,
    paciente_id: pacienteId,
  });

  if (itens.length) {
    const copias = itens.map((it) => ({
      nutri_id:     modelo.nutri_id,
      treino_id:    novo.id,
      exercicio_id: it.exercicio_id,
      dia:          it.dia,
      ordem:        it.ordem,
      series:       it.series,
      repeticoes:   it.repeticoes,
      carga:        it.carga,
      cadencia:     it.cadencia,
      descanso:     it.descanso,
      rir:          it.rir,
      metodo:       it.metodo,
      observacao:   it.observacao,
    }));
    const { error } = await sb.from('treino_exercicios').insert(copias);
    if (error) throw error;
  }
  return novo;
}

// ───────────────────────────────────────────────────────────
// ITENS DO TREINO  (treino_exercicios)
// ───────────────────────────────────────────────────────────

/**
 * Lista os itens de um treino, ordenados por dia (A/B/C...) e ordem.
 * Traz junto os dados básicos do exercício (nome/grupo/equipamento).
 */
export async function listarItensDoTreino(treinoId) {
  const { data, error } = await sb
    .from('treino_exercicios')
    .select('*, exercicio:exercicios(nome, grupo_muscular, equipamento, video_url)')
    .eq('treino_id', treinoId)
    .order('dia',   { ascending: true })
    .order('ordem', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function buscarItem(id) {
  const { data, error } = await sb
    .from('treino_exercicios').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

/**
 * Adiciona um exercício a um treino. Recebe
 * { treino_id, exercicio_id, dia, ordem, series, repeticoes, carga, descanso, observacao }.
 */
export async function criarItem(nutriId, dados) {
  const { data, error } = await sb
    .from('treino_exercicios')
    .insert({ ...dados, nutri_id: nutriId })
    .select().single();
  if (error) throw error;
  return data;
}

/** Alias semântico de criarItem, usado pela UI de montagem de treino. */
export const adicionarExercicioAoTreino = criarItem;

export async function atualizarItem(id, dados) {
  const { data, error } = await sb
    .from('treino_exercicios')
    .update(dados)
    .eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

/** Exclui item. Cascade remove a progressão vinculada. */
export async function excluirItem(id) {
  const { error } = await sb.from('treino_exercicios').delete().eq('id', id);
  if (error) throw error;
  return true;
}

// ───────────────────────────────────────────────────────────
// PROGRESSÃO  (treino_progressao) — histórico de cargas realizadas
// ───────────────────────────────────────────────────────────

/** Histórico de um item do treino, mais recente primeiro. */
export async function listarProgressao(treinoExercicioId) {
  const { data, error } = await sb
    .from('treino_progressao')
    .select('*')
    .eq('treino_exercicio_id', treinoExercicioId)
    .order('data', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Registra uma carga realizada. Recebe
 * { treino_exercicio_id, data, carga_realizada, reps_realizadas, observacao }.
 * data ausente => default current_date no banco.
 */
export async function registrarProgressao(nutriId, dados) {
  const { data, error } = await sb
    .from('treino_progressao')
    .insert({ ...dados, nutri_id: nutriId })
    .select().single();
  if (error) throw error;
  return data;
}

export async function atualizarProgressao(id, dados) {
  const { data, error } = await sb
    .from('treino_progressao')
    .update(dados)
    .eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

export async function excluirProgressao(id) {
  const { error } = await sb.from('treino_progressao').delete().eq('id', id);
  if (error) throw error;
  return true;
}
