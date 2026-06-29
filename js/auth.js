// ═══════════════════════════════════════════════════════════
// AUTH — Autenticação de nutricionistas
// ═══════════════════════════════════════════════════════════

import { sb } from './supabase.js';

/**
 * Faz login com email e senha
 * @returns {Promise<{user, session}>}
 */
export async function fazerLogin(email, senha) {
  const { data, error } = await sb.auth.signInWithPassword({
    email,
    password: senha
  });
  if (error) throw error;
  return data;
}

/**
 * Cria conta nova de nutricionista
 * @returns {Promise<{user, session}>}
 */
export async function criarConta({ nome, email, senha }) {
  const { data, error } = await sb.auth.signUp({
    email,
    password: senha,
    options: {
      data: { nome }
    }
  });
  if (error) throw error;
  return data;
}

/**
 * Valida um código de convite ANTES do cadastro
 */
export async function validarCodigoConvite(codigo) {
  const { data, error } = await sb.rpc('validar_codigo_convite', { p_codigo: codigo });
  if (error) throw error;
  return data; // { valido, erro?, codigo_id?, descricao? }
}

/**
 * Registra uso do código DEPOIS do cadastro bem-sucedido
 */
export async function registrarUsoCodigo(codigo, nutriId, email) {
  const { data, error } = await sb.rpc('registrar_uso_codigo', {
    p_codigo: codigo,
    p_nutri_id: nutriId,
    p_email: email
  });
  if (error) throw error;
  return data;
}

/**
 * Faz logout
 */
export async function fazerLogout() {
  return await sb.auth.signOut();
}

/**
 * Retorna a sessão atual (null se não logado)
 */
export async function obterSessao() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

/**
 * Retorna o usuário atual (null se não logado)
 */
export async function obterUsuario() {
  const { data } = await sb.auth.getUser();
  return data.user;
}

/**
 * Obtém o perfil do nutri logado (da tabela nutricionistas)
 */
export async function obterPerfilNutri() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data, error } = await sb
    .from('nutricionistas')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Traduz mensagens de erro do Supabase para português
 */
export function traduzirErroAuth(msg) {
  const m = (msg || '').toLowerCase();
  if (m.includes('invalid login')) return 'Email ou senha incorretos';
  if (m.includes('already registered')) return 'Este email já está cadastrado. Tente entrar.';
  if (m.includes('password')) return 'Senha muito curta (mínimo 6 caracteres)';
  if (m.includes('email')) return 'Email inválido';
  if (m.includes('rate limit')) return 'Muitas tentativas. Aguarde alguns minutos.';
  return msg;
}
