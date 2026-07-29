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

/**
 * Lista exercícios do nutri (alfabético), com busca e paginação no banco.
 * Em vez de trazer os 740 e filtrar no navegador, filtra via ilike direto no
 * Supabase e devolve só a fatia pedida.
 *
 *   { termo, limite, offset }
 *     · termo  — busca por nome OU grupo muscular (ilike, case-insensitive)
 *     · limite — quantos trazer (default 40)
 *     · offset — a partir de qual registro (paginação "carregar mais")
 */
export async function listarExercicios({ termo = '', limite = 40, offset = 0 } = {}) {
  let q = sb
    .from('exercicios')
    .select('*')
    .order('nome', { ascending: true });

  const t = String(termo || '').trim();
  if (t) {
    // Sanitiza: vírgulas/parênteses/pontos quebram a sintaxe do filtro .or() do PostgREST.
    const alvo = t.replace(/[,()*.]/g, ' ').trim();
    const like = `%${alvo}%`;
    q = q.or(`nome.ilike.${like},grupo_muscular.ilike.${like}`);
  }

  q = q.range(offset, offset + limite - 1);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/**
 * Resolve um nome digitado/escolhido para o exercício da biblioteca (match
 * exato case-insensitive). Usado ao adicionar exercício ao treino, já que a
 * biblioteca inteira não fica mais carregada em memória.
 */
export async function buscarExercicioPorNome(nome) {
  const n = String(nome || '').trim();
  if (!n) return null;
  const { data, error } = await sb
    .from('exercicios')
    .select('*')
    .ilike('nome', n)          // sem curingas => casa o nome inteiro, ignorando maiúsc./minúsc.
    .limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
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
 * Treinos ATIVOS prescritos a alunos (com paciente), para a tela de
 * "Gerenciar treinos" — inclui o nome do aluno e as datas de vigência.
 * Ordena pelos que vencem primeiro (data_fim asc; sem data por último).
 */
export async function listarTreinosComVencimento() {
  const { data, error } = await sb
    .from('treinos')
    .select('id, nome, data_inicio, data_fim, criado_em, paciente_id, paciente:pacientes(nome, codigo)')
    .not('paciente_id', 'is', null)
    .eq('ativo', true)
    .order('data_fim', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
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

  // Modelo da biblioteca não gera evento; prescrição de aluno sim (e
  // prescreverModeloParaPaciente passa por aqui, então também é coberta).
  if (data.paciente_id) {
    const { registrarEvento } = await import('./timeline.js');
    await registrarEvento({
      pacienteId: data.paciente_id,
      tipo: 'WORKOUT_CREATED',
      descricao: `Treino "${data.nome || 'sem nome'}" criado${data.divisao ? ` · divisão ${data.divisao}` : ''}.`,
      entidadeTipo: 'treino',
      entidadeId: data.id,
      metadata: { workout_name: data.nome, divisao: data.divisao },
      chaveDedup: `WORKOUT_CREATED:${data.id}`,
    });
  }
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
    nome:            modelo.nome,
    divisao:         modelo.divisao,
    descanso_padrao: modelo.descanso_padrao ?? null,
    data_inicio:     extras.data_inicio ?? modelo.data_inicio ?? null,
    ativo:           extras.ativo ?? true,
    paciente_id:     pacienteId,
  });

  if (itens.length) {
    const copias = itens.map((it) => ({
      nutri_id:       modelo.nutri_id,
      treino_id:      novo.id,
      exercicio_id:   it.exercicio_id,
      dia:            it.dia,
      ordem:          it.ordem,
      series:         it.series,
      repeticoes:     it.repeticoes,
      carga:          it.carga,
      cadencia:       it.cadencia,
      descanso:       it.descanso,
      descanso_final: it.descanso_final,
      rir:            it.rir,
      rir_modo:       it.rir_modo,
      metodo:         it.metodo,
      observacao:     it.observacao,
    }));
    const { error } = await sb.from('treino_exercicios').insert(copias);
    if (error) throw error;
  }
  return novo;
}

/**
 * Sobe um treino (prescrição de um aluno, ou outro treino) para a BIBLIOTECA:
 * cria um novo treino MODELO (paciente_id NULL) copiando os dados + todos os
 * itens. NÃO copia a progressão (cargas realizadas são histórico do aluno).
 * Reaproveita o nutri_id do treino de origem. Retorna o modelo criado.
 */
export async function salvarComoModelo(treinoId, extras = {}) {
  const origem = await buscarTreino(treinoId);
  const itens  = await listarItensDoTreino(treinoId);

  const modelo = await criarTreino(origem.nutri_id, {
    nome:            extras.nome ?? origem.nome,
    divisao:         origem.divisao,
    descanso_padrao: origem.descanso_padrao ?? null,
    data_inicio:     null,     // modelo não tem data de início
    ativo:           true,
    paciente_id:     null,     // <- vai para a biblioteca
  });

  if (itens.length) {
    const copias = itens.map((it) => ({
      nutri_id:       origem.nutri_id,
      treino_id:      modelo.id,
      exercicio_id:   it.exercicio_id,
      dia:            it.dia,
      ordem:          it.ordem,
      series:         it.series,
      repeticoes:     it.repeticoes,
      carga:          it.carga,
      cadencia:       it.cadencia,
      descanso:       it.descanso,
      descanso_final: it.descanso_final,
      rir:            it.rir,
      rir_modo:       it.rir_modo,
      metodo:         it.metodo,
      observacao:     it.observacao,
    }));
    const { error } = await sb.from('treino_exercicios').insert(copias);
    if (error) throw error;
  }
  return modelo;
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
