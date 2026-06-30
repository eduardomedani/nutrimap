// ═══════════════════════════════════════════════════════════
// PACIENTES — CRUD e operações com pacientes
// ═══════════════════════════════════════════════════════════

import { sb } from './supabase.js';

/**
 * Lista todos os pacientes do nutri logado
 * O RLS filtra automaticamente
 */
export async function listarPacientes() {
  const { data, error } = await sb
    .from('pacientes')
    .select('*')
    .order('criado_em', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Busca um paciente pelo código (usado pelo questionário, sem login)
 */
export async function buscarPacientePorCodigo(codigo) {
  // Acesso anônimo via RPC SECURITY DEFINER (não lê a tabela direto).
  // Retorna apenas { id, nome, status } do paciente daquele código.
  const { data, error } = await sb
    .rpc('rpc_buscar_paciente_por_codigo', { p_codigo: codigo });

  if (error) throw error;
  return (data && data[0]) || null;
}

/**
 * Busca um paciente pelo ID (usado pelo painel)
 */
export async function buscarPacientePorId(id) {
  const { data, error } = await sb
    .from('pacientes')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Cria um novo paciente vinculado ao nutri logado
 * Gera código único via função SQL
 */
export async function criarPaciente({ nome, email, telefone }) {
  // Pegar usuário logado
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Usuário não autenticado');

  // Gerar código único
  const { data: codigo, error: errCod } = await sb.rpc('gerar_codigo_paciente');
  if (errCod) throw errCod;

  // Inserir paciente
  const { data, error } = await sb
    .from('pacientes')
    .insert({
      codigo,
      nutri_id: user.id,
      nome: nome || null,
      email: email || null,
      telefone: telefone || null,
      status: 'aguardando'
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Atualiza dados de um paciente
 */
export async function atualizarPaciente(id, dados) {
  const { data, error } = await sb
    .from('pacientes')
    .update(dados)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Marca paciente como completo (chamado quando termina o questionário)
 */
export async function marcarComoCompleto(codigo) {
  // Acesso anônimo via RPC SECURITY DEFINER.
  const { error } = await sb
    .rpc('rpc_marcar_completo', { p_codigo: codigo });

  if (error) throw error;
  return true;
}

/**
 * Exclui um paciente (CASCADE apaga respostas e exames)
 */
export async function excluirPaciente(id) {
  const { error } = await sb
    .from('pacientes')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return true;
}

/**
 * Calcula estatísticas dos pacientes
 */
export function calcularEstatisticas(pacientes) {
  const total = pacientes.length;
  const completos = pacientes.filter(p => p.status === 'completo').length;
  const aguardando = total - completos;
  const taxa = total > 0 ? Math.round((completos / total) * 100) : 0;
  return { total, completos, aguardando, taxa };
}
