// ═══════════════════════════════════════════════════════════
// EQUIPE — Camada de dados do app do colaborador
// ═══════════════════════════════════════════════════════════
// Tudo com a anon-key + RLS. As políticas "*_funcionario_read" liberam só o
// que é da própria pessoa, e só de folha FECHADA. Aqui não há escrita nenhuma:
// no app o colaborador lê, quem lança é o painel.
//
// FILTRO EXPLÍCITO POR funcionario_id, sempre. As políticas do Postgres se
// somam por OR: se a conta logada também for a do dono do negócio, a política
// de nutri casaria e a mesma consulta devolveria a folha da equipe inteira.
// A policy não segura esse caso — a consulta é que tem que ser específica.

import { sb } from './supabase.js';

// ── AUTENTICAÇÃO ──────────────────────────────────────────────
// Glue do Supabase, igual à do app do aluno. Fica repetida aqui de propósito:
// os dois apps são independentes e nenhum deve quebrar por mudança no outro.

export async function entrar(email, senha) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) throw error;
  return data;
}

export async function cadastrar(email, senha) {
  const { data, error } = await sb.auth.signUp({ email, password: senha });
  if (error) throw error;
  return data;   // data.session vem null se o projeto exigir confirmação por e-mail
}

export async function sair() {
  await sb.auth.signOut();
}

export async function sessaoAtual() {
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

// ── VÍNCULO CONTA <-> FUNCIONÁRIO ─────────────────────────────

/** O cadastro ligado à conta logada, ou null se ainda não vinculada. */
export async function meuCadastro() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb
    .from('funcionarios')
    .select('id, nome, cargo, unidade, cpf, chave_pix, ativo, acesso_bloqueado')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Liga a conta ao cadastro pelo código que o gestor passou. */
export async function vincularPorCodigo(codigo) {
  const { data, error } = await sb.rpc('vincular_funcionario', {
    p_codigo: String(codigo || '').trim(),
  });
  if (error) throw error;
  return data;   // uuid do funcionário
}

/**
 * Tenta ligar sozinho, pelo e-mail da conta.
 *
 * Devolve null quando não dá — e "não dá" é a maioria dos casos legítimos:
 * e-mail não confirmado, e-mail que não está em ficha nenhuma, ou dois
 * cadastros com o mesmo e-mail. Nada disso é erro: é a hora de pedir o código.
 */
export async function vincularPorEmail() {
  const { data, error } = await sb.rpc('vincular_funcionario_por_email');
  if (error) throw error;
  return data || null;
}

// ── PAGAMENTOS ────────────────────────────────────────────────

/**
 * Os pagamentos do colaborador, do mais recente para o mais antigo.
 * Só folha fechada chega aqui — é o RLS que garante, e é o certo: rascunho é
 * número mudando enquanto o valor ainda está sendo digitado.
 */
export async function meusPagamentos(funcionarioId, { limite = 36 } = {}) {
  if (!funcionarioId) return [];

  // `!inner` + filtro na tabela ligada: quem descarta o rascunho é o BANCO.
  // Filtrando depois, no navegador, o `limite` cortaria antes — bastava a
  // pessoa ter rascunhos recentes para meses pagos sumirem da tela dela.
  const { data, error } = await sb
    .from('folha_itens')
    .select(`
      id, modo, minutos, valor_hora, valor_base, observacoes,
      ponto_arquivo, ponto_minutos, ponto_noturnas, ponto_inicio, ponto_fim,
      contracheque_arquivo, contracheque_gerado_em,
      folha:folhas!inner ( id, competencia, data_pagamento, status ),
      adicionais:folha_adicionais ( id, descricao, valor, ordem )
    `)
    .eq('funcionario_id', funcionarioId)
    .eq('folha.status', 'fechada')
    .order('competencia', { referencedTable: 'folhas', ascending: false })
    .limit(limite);
  if (error) throw error;

  return (data || [])
    .map(i => ({
      ...i,
      adicionais: (i.adicionais || []).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)),
    }))
    .sort((a, b) => String(b.folha?.competencia).localeCompare(String(a.folha?.competencia)));
}

// ── DOCUMENTOS ────────────────────────────────────────────────

/**
 * Os documentos do colaborador, do mais recente para o mais antigo.
 *
 * O filtro por colaborador_id é explícito de novo: as políticas se somam por
 * OR, e a conta do dono casaria com a de nutri, devolvendo os documentos da
 * equipe inteira.
 */
export async function meusDocumentos(funcionarioId, { limite = 120 } = {}) {
  if (!funcionarioId) return [];
  const { data, error } = await sb
    .from('colaborador_documentos')
    .select('id, competencia, tipo_documento, titulo, nome_arquivo, caminho_storage, mime_type, tamanho_bytes, versao, disponibilizado_em, visualizado_pelo_colaborador, visualizado_em')
    .eq('colaborador_id', funcionarioId)
    .eq('status', 'disponivel')
    .eq('atual', true)
    .is('arquivado_em', null)
    .order('competencia', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data || [];
}

export function traduzirErro(msg) {
  const m = String(msg || '').toLowerCase();

  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar.';
  if (m.includes('user already registered')) return 'Já existe uma conta com este e-mail. Entre em vez de criar.';
  if (m.includes('password should be at least')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (m.includes('unable to validate email')) return 'E-mail inválido.';

  if (m.includes('codigo_invalido')) {
    return 'Código não encontrado. Confira com quem passou — ele pode já ter sido usado.';
  }
  if (m.includes('conta_ja_vinculada')) return 'Esta conta já está ligada a um cadastro.';
  if (m.includes('precisa_estar_logado')) return 'Entre na sua conta antes de usar o código.';
  if (m.includes('acesso_bloqueado')) {
    return 'Seu acesso está bloqueado. Fale com quem cuida da folha.';
  }

  if (m.includes('failed to fetch') || m.includes('networkerror')) {
    return 'Sem conexão. Verifique a internet e tente de novo.';
  }
  return msg || 'Algo deu errado.';
}
