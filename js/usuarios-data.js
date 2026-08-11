// ═══════════════════════════════════════════════════════════
// USUÁRIOS E ACESSOS — acesso a dados
// ═══════════════════════════════════════════════════════════
// Só RPC. Não há um `.from('organizacao_usuarios')` neste arquivo, e não pode
// haver: as tabelas da administração ou têm RLS sem policy de escrita, ou não
// têm policy nenhuma. Toda operação sensível passa por função que confere
// `tem_permissao('usuarios.gerenciar')` no banco.
//
// Os erros do banco chegam como códigos curtos (`codigo_expirado`,
// `email_diferente_do_convite`). A tradução para português mora aqui, num
// lugar só — a mesma frase escrita em três handlers vira três frases
// diferentes na terceira vez que alguém a edita.

import { sb } from './supabase.js';

/** Código do Postgres → frase de gente. */
export const ERROS = {
  precisa_estar_logado:              'Você precisa estar logado.',
  sem_organizacao:                   'Sua conta não pertence a nenhuma organização.',
  sem_permissao:                     'Você não tem permissão para esta ação.',
  nome_e_email_obrigatorios:         'Informe o nome e o e-mail.',
  perfil_invalido:                   'Perfil inválido.',
  perfil_proprietario_nao_permitido: 'Proprietário não pode ser definido por aqui.',
  funcionario_de_outra_organizacao:  'Esse colaborador é de outra organização.',
  email_ja_e_membro:                 'Esse e-mail já tem acesso à organização.',
  conta_ja_vinculada:                'Esta conta já pertence a uma organização.',
  codigo_invalido:                   'Código não encontrado.',
  codigo_revogado:                   'Este código foi cancelado.',
  codigo_usado:                      'Este código já foi utilizado.',
  codigo_expirado:                   'Este código expirou. Peça um novo.',
  organizacao_inativa:               'A organização está inativa.',
  email_diferente_do_convite:        'O convite foi enviado para outro e-mail. Entre com o e-mail convidado ou peça um código novo.',
  usuario_nao_encontrado:            'Usuário não encontrado.',
  status_invalido:                   'Situação inválida.',
  nao_pode_bloquear_a_si_mesmo:      'Você não pode bloquear o próprio acesso.',
  ultimo_proprietario:               'Esta é a última pessoa com perfil Proprietário ativo. Promova outra antes.',
  modo_invalido:                     'Opção inválida.',
  permissao_invalida:                'Permissão desconhecida.',
  convite_nao_encontrado:            'Convite não encontrado ou já usado.',
  nao_foi_possivel_gerar_codigo:     'Não consegui gerar um código. Tente de novo.',
};

export function traduzirErro(e) {
  const bruto = String(e?.message || e || '');
  for (const [codigo, frase] of Object.entries(ERROS)) {
    if (bruto.includes(codigo)) return frase;
  }
  if (/failed to fetch|networkerror/i.test(bruto)) return 'Sem conexão. Tente novamente.';
  return 'Não foi possível concluir. Tente novamente.';
}

const chamar = async (nome, args) => {
  const { data, error } = await sb.rpc(nome, args);
  if (error) throw error;
  return data;
};

// ── leitura ────────────────────────────────────────────────
export const listarUsuarios   = () => chamar('usuarios_da_organizacao');
export const listarConvites   = () => chamar('convites_pendentes');
export const listarContasFora = () => chamar('contas_fora_da_organizacao');

export const permissoesDoUsuario = (usuarioId) =>
  chamar('permissoes_do_usuario', { p_usuario_id: usuarioId });

export const detalheContaExterna = (userId) =>
  chamar('conta_externa_detalhe', { p_user_id: userId });

/** Os perfis oferecíveis. Proprietário fica de fora: não nasce por convite. */
export async function listarPerfis() {
  const { data, error } = await sb
    .from('perfis')
    .select('id, chave, nome, descricao')
    .is('organizacao_id', null)
    .eq('ativo', true)
    .neq('chave', 'proprietario')
    .order('nome');
  if (error) throw error;
  return data || [];
}

/** Colaboradores para o vínculo opcional. */
export async function listarFuncionarios() {
  const { data, error } = await sb
    .from('funcionarios')
    .select('id, nome')
    .eq('ativo', true)
    .order('nome');
  if (error) throw error;
  return data || [];
}

// ── escrita ────────────────────────────────────────────────
export const convidar = (nome, email, perfilChave, funcionarioId = null) =>
  chamar('usuario_convidar', {
    p_nome: nome, p_email: email,
    p_perfil_chave: perfilChave, p_funcionario_id: funcionarioId,
  });

export const vincular = (codigo) => chamar('usuario_vincular', { p_codigo: codigo });

export const definirPerfil = (usuarioId, perfilId) =>
  chamar('usuario_definir_perfil', { p_usuario_id: usuarioId, p_perfil_id: perfilId });

/**
 * Troca o perfil e devolve o usuário RELIDO DO SERVIDOR.
 *
 * Existe como função própria — e não solta dentro do drawer — para poder ser
 * testada sem DOM. É o seam que a guarda usa para provar que a tela envia o
 * perfil ESCOLHIDO, chama a RPC, não fecha sem persistir e não engole erro.
 *
 * NÃO É OTIMISTA. Depois de gravar, relê a lista e devolve a linha que o banco
 * tem agora. Atualizar o objeto local com o que se acabou de enviar mostraria
 * "Recepção" na tela mesmo que o banco tivesse recusado — que é precisamente o
 * modo de falha que nos custou uma rodada inteira.
 *
 * @param {object}  api            injetável no teste; por padrão, este módulo
 * @param {string}  usuarioId      linha em organizacao_usuarios
 * @param {string}  perfilAtualId  para não gastar ida à rede à toa
 * @param {string}  perfilNovoId   o escolhido no select
 * @returns {{mudou: boolean, usuario?: object}}
 */
export async function trocarPerfil({ api, usuarioId, perfilAtualId, perfilNovoId }) {
  const a = api || { definirPerfil, listarUsuarios };

  if (!perfilNovoId || perfilNovoId === perfilAtualId) return { mudou: false };

  await a.definirPerfil(usuarioId, perfilNovoId);   // erro sobe: quem chama mostra

  const lista = await a.listarUsuarios();
  const fresco = (lista || []).find(u => u.id === usuarioId);
  if (!fresco) throw new Error('usuario_nao_encontrado');

  return { mudou: true, usuario: fresco };
}

export const definirStatus = (usuarioId, status) =>
  chamar('usuario_definir_status', { p_usuario_id: usuarioId, p_status: status });

/** modo: 'perfil' | 'permitir' | 'bloquear' */
export const definirPermissao = (usuarioId, chave, modo) =>
  chamar('usuario_definir_permissao', {
    p_usuario_id: usuarioId, p_chave: chave, p_modo: modo,
  });

export const revogarConvite = (conviteId) =>
  chamar('usuario_convite_revogar', { p_convite_id: conviteId });
