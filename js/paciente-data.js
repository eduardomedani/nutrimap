// ═══════════════════════════════════════════════════════════
// PACIENTE — Camada de dados do app do aluno
// ═══════════════════════════════════════════════════════════
// Tudo com a anon-key + RLS. Leituras batem direto nas tabelas (as políticas
// "..._paciente_read" liberam só o que é do próprio paciente); escritas de
// carga vão por RPC SECURITY DEFINER (grava o nutri_id correto).

import { sb } from './supabase.js';

// ── AUTENTICAÇÃO ──────────────────────────────────────────────

export async function entrar(email, senha) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) throw error;
  return data;
}

export async function cadastrar(email, senha) {
  const { data, error } = await sb.auth.signUp({ email, password: senha });
  if (error) throw error;
  return data;   // data.session pode vir null se o projeto exige confirmação de email
}

export async function sair() {
  await sb.auth.signOut();
}

export async function sessaoAtual() {
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

// ── INÍCIO: próxima consulta e metas ──────────────────────────
// Vêm por RPC, e não por select direto na tabela, porque `consultas` e
// `paciente_metas` guardam o que o profissional escreveu SOBRE o paciente e
// não PARA ele (observacoes, relato, conduta, resumo). RLS filtra linha, não
// coluna: uma policy de select liberaria a linha inteira pela API. A função
// devolve só o que é do paciente. Ver db/paciente_inicio_leitura.sql.
//
// Quem chama trata a falha como "não há": enquanto a migração não rodar, o
// erro do RPC inexistente não pode derrubar a tela.

export async function proximaConsulta() {
  const { data, error } = await sb.rpc('rpc_paciente_proxima_consulta');
  if (error) throw error;
  return (data && data[0]) || null;
}

export async function minhasMetas() {
  const { data, error } = await sb.rpc('rpc_paciente_metas');
  if (error) throw error;
  return data || [];
}

// ── VÍNCULO CONTA <-> PACIENTE ────────────────────────────────

/** Registro do paciente ligado à conta logada (ou null se ainda não vinculado). */
export async function meuPaciente() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb
    .from('pacientes')
    .select('id, nome, codigo, status')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Vincula a conta ao paciente pelo código. Retorna o id do paciente. */
export async function vincularPorCodigo(codigo) {
  const { data, error } = await sb.rpc('rpc_vincular_paciente', { p_codigo: codigo });
  if (error) throw error;
  return data;   // uuid do paciente
}

// ── TREINO ────────────────────────────────────────────────────

/**
 * Treinos ativos do paciente, mais recentes primeiro.
 * Filtra por paciente_id explicitamente: se a conta logada também for um nutri
 * (o nutri testando o app como aluno), a policy de dono faria o RLS devolver
 * a biblioteca inteira e os treinos de outros pacientes.
 */
export async function meusTreinos(pacienteId) {
  if (!pacienteId) return [];
  const { data, error } = await sb
    .from('treinos')
    .select('*')
    .eq('paciente_id', pacienteId)
    .eq('ativo', true)
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Itens de um treino (com dados do exercício), ordenados por dia e ordem. */
export async function itensDoTreino(treinoId) {
  const { data, error } = await sb
    .from('treino_exercicios')
    .select('*, exercicio:exercicios(nome, grupo_muscular, equipamento, video_url, observacoes)')
    .eq('treino_id', treinoId)
    .order('dia',   { ascending: true })
    .order('ordem', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ── PROGRESSÃO DE CARGA ───────────────────────────────────────

/** Histórico de carga de um item, mais recente primeiro. */
export async function progressaoDoItem(treinoExercicioId) {
  const { data, error } = await sb
    .from('treino_progressao')
    .select('*')
    .eq('treino_exercicio_id', treinoExercicioId)
    .order('data', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Progressão de VÁRIOS itens de uma vez (1 consulta) — usado p/ pré-carregar
 * tudo ao abrir o treino, deixando o "Registrar séries" instantâneo.
 * Vem ordenado por data desc; agrupar por treino_exercicio_id preserva a ordem.
 */
export async function progressaoDosItens(ids) {
  if (!ids || !ids.length) return [];
  const { data, error } = await sb
    .from('treino_progressao')
    .select('*')
    .in('treino_exercicio_id', ids)
    .order('data', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Salva as séries realizadas (peso + reps de cada série) de um item.
 * series = [{ peso, reps }, ...]. Um registro por dia (salvar de novo atualiza).
 */
export async function salvarSeries({ treinoExercicioId, data, series }) {
  const { data: id, error } = await sb.rpc('rpc_paciente_salvar_series', {
    p_treino_exercicio_id: treinoExercicioId,
    p_data: data || null,
    p_series: series,
  });
  if (error) throw error;
  return id;
}

/** Registra uma carga realizada. { treinoExercicioId, data, carga, reps, obs }. */
export async function registrarCarga({ treinoExercicioId, data, carga, reps, obs }) {
  const { data: id, error } = await sb.rpc('rpc_paciente_registrar_progressao', {
    p_treino_exercicio_id: treinoExercicioId,
    p_data:  data || null,
    p_carga: (carga === '' || carga == null) ? null : Number(carga),
    p_reps:  (reps === '' || reps == null) ? null : parseInt(reps, 10),
    p_obs:   obs || null,
  });
  if (error) throw error;
  return id;
}

export async function excluirCarga(id) {
  const { data, error } = await sb.rpc('rpc_paciente_excluir_progressao', { p_id: id });
  if (error) throw error;
  return data === true;
}

// ── ERROS ─────────────────────────────────────────────────────

export function traduzirErro(msg) {
  const m = (msg || '').toLowerCase();
  if (m.includes('invalid login'))                  return 'Email ou senha incorretos.';
  if (m.includes('already registered'))             return 'Este email já tem conta. Toque em "Entrar".';
  if (m.includes('email not confirmed'))            return 'Confirme seu email pelo link que enviamos e volte para entrar.';
  if (m.includes('password'))                       return 'Senha muito curta (mínimo 6 caracteres).';
  if (m.includes('codigo_invalido_ou_ja_vinculado')) return 'Código inválido ou já usado por outra conta.';
  if (m.includes('rate limit'))                     return 'Muitas tentativas. Aguarde alguns minutos.';
  if (m.includes('item_nao_pertence_ao_paciente'))  return 'Este exercício não está no seu treino. Recarregue a página e tente de novo.';
  if (m.includes('sem_paciente'))                   return 'Sua conta não está vinculada a um paciente. Informe seu código de acesso.';
  if (m.includes('email'))                          return 'Email inválido.';
  return msg || 'Algo deu errado. Tente de novo.';
}
