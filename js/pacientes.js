// ═══════════════════════════════════════════════════════════
// PACIENTES — CRUD e operações com pacientes
// ═══════════════════════════════════════════════════════════

import { sb } from './supabase.js';
import { registrarEvento, camposAlterados } from './timeline.js';

// Campos cuja mudança é digna de virar evento. Ajuste de endereço, Instagram
// ou profissão é manutenção de cadastro — não entra na timeline clínica.
const CAMPOS_RELEVANTES = ['nome', 'nascimento', 'sexo', 'email', 'telefone', 'status'];

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
  // O INSERT NÃO MANDA `nutri_id` — quem determina o tenant é o banco, pelo
  // `default public.organizacao_do_auth()` que a Etapa 4B pôs na coluna. O
  // frontend manda dado de negócio e mais nada, então não existe caminho em que
  // uma tela escolha o dono de um registro.
  //
  // Isto SÓ VALE DEPOIS DA 4B. Antes dela a coluna era `not null` sem default,
  // e é por isso que a Fase 1 ainda mandava o campo à mão. Se um dia o rollback
  // for necessário, db/multiusuario_etapa4b_rls_desfazer.sql repõe um default
  // em vez de removê-lo — justamente para esta linha não quebrar.

  // Gerar código único
  const { data: codigo, error: errCod } = await sb.rpc('gerar_codigo_paciente');
  if (errCod) throw errCod;

  // Inserir paciente
  const { data, error } = await sb
    .from('pacientes')
    .insert({
      codigo,
      nome: nome || null,
      email: email || null,
      telefone: telefone || null,
      status: 'aguardando'
    })
    .select()
    .single();

  if (error) throw error;

  // Timeline depois da operação confirmada — e sem poder derrubá-la.
  await registrarEvento({
    pacienteId: data.id,
    tipo: 'PATIENT_CREATED',
    descricao: 'Cadastro criado no NutriMap.',
    entidadeTipo: 'paciente',
    entidadeId: data.id,
    metadata: { codigo: data.codigo },
    dataEvento: data.criado_em,
    chaveDedup: `PATIENT_CREATED:${data.id}`,
  });

  return data;
}

/**
 * Atualiza dados de um paciente
 */
export async function atualizarPaciente(id, dados) {
  // Estado anterior: sem ele não dá para saber se a mudança foi relevante.
  let antes = null;
  try { antes = await buscarPacientePorId(id); } catch (e) { /* segue sem comparar */ }

  const { data, error } = await sb
    .from('pacientes')
    .update(dados)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  // Um evento por dia por paciente, e só se mudou algo que importa: salvar o
  // formulário três vezes seguidas não vira três linhas na timeline.
  const mudou = antes ? camposAlterados(antes, data, CAMPOS_RELEVANTES) : [];
  if (mudou.length) {
    await registrarEvento({
      pacienteId: id,
      tipo: 'PATIENT_UPDATED',
      descricao: 'Dados cadastrais do paciente foram atualizados.',
      entidadeTipo: 'paciente',
      entidadeId: id,
      metadata: { campos: mudou },
      dedupPorDia: true,
    });
  }

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
