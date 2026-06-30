// ═══════════════════════════════════════════════════════════
// RESPOSTAS — Salvar e buscar respostas do questionário
// ═══════════════════════════════════════════════════════════

import { sb } from './supabase.js';

/**
 * Salva ou atualiza as respostas de um módulo específico
 * @param {string} pacienteId
 * @param {string} modulo - ex: 'm1', 'm2', etc
 * @param {object} dados - JSON com as respostas
 */
export async function salvarRespostasModulo(pacienteId, modulo, dados) {
  const { data, error } = await sb
    .from('respostas')
    .upsert({
      paciente_id: pacienteId,
      modulo,
      dados,
      salvo_em: new Date().toISOString()
    }, {
      onConflict: 'paciente_id,modulo'
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Salva TODAS as respostas de uma vez (usado ao finalizar o questionário).
 * Fluxo ANÔNIMO: usa RPC SECURITY DEFINER, validando pelo CÓDIGO do paciente.
 * @param {string} codigo - código do paciente (não o id)
 * @param {object} todosOsModulos - { m1: {...}, m2: {...}, ... }
 */
export async function salvarTodasRespostas(codigo, todosOsModulos) {
  const { error } = await sb
    .rpc('rpc_salvar_respostas', {
      p_codigo: codigo,
      p_modulos: todosOsModulos
    });

  if (error) throw error;
  return true;
}

/**
 * Busca todas as respostas de um paciente, organizadas por módulo
 * @returns {object} { m1: {...}, m2: {...}, ... }
 */
export async function buscarRespostas(pacienteId) {
  const { data, error } = await sb
    .from('respostas')
    .select('*')
    .eq('paciente_id', pacienteId);

  if (error) throw error;

  // Organizar por módulo
  const porModulo = {};
  (data || []).forEach(r => {
    porModulo[r.modulo] = r.dados;
  });
  return porModulo;
}

/**
 * Busca respostas de um módulo específico
 */
export async function buscarRespostasModulo(pacienteId, modulo) {
  const { data, error } = await sb
    .from('respostas')
    .select('dados')
    .eq('paciente_id', pacienteId)
    .eq('modulo', modulo)
    .maybeSingle();

  if (error) throw error;
  return data ? data.dados : null;
}
