// ═══════════════════════════════════════════════════════════
// PERMISSÕES — o contexto de sessão do painel
// ═══════════════════════════════════════════════════════════
// Uma chamada a `minhas_permissoes()` por sessão. O menu, as rotas e os botões
// perguntam a este módulo, não ao banco.
//
// ═══════════════════════════════════════════════════════════
// ISTO NÃO É SEGURANÇA
// ═══════════════════════════════════════════════════════════
// Esconder item de menu e barrar rota é CONFORTO: evita que alguém abra uma
// tela que não vai funcionar. Quem impede de verdade é `tem_permissao()`
// dentro das RPCs e, a partir da Etapa 4, a RLS.
//
// Quem trocar `pode()` por `() => true` no DevTools vê o menu inteiro e não
// recebe uma linha a mais de dado. É assim que tem que ser.
//
// ═══════════════════════════════════════════════════════════
// POR QUE MEMÓRIA, E NÃO localStorage
// ═══════════════════════════════════════════════════════════
// Cache em localStorage sobrevive à troca de conta. Este projeto já foi
// mordido por isso: em 05/08/2026 o painel abriu com uma conta de teste e o
// sistema apareceu inteiro vazio, sem erro na tela — tela vazia por sessão
// errada é indistinguível de banco apagado. Um menu servido do cache da conta
// anterior seria a mesma armadilha, com o agravante de mostrar módulos que a
// pessoa não pode abrir.
//
// Em memória, o pior caso é uma chamada a mais depois do F5.

import { sb } from './supabase.js';

let _chaves = null;       // Set das permissões efetivas, ou null se não carregou
let _carregando = null;   // promessa em voo, para não pedir duas vezes

/**
 * Carrega as permissões da sessão. Idempotente: chamadas simultâneas
 * compartilham a mesma ida à rede.
 *
 * @param {boolean} forcar  relê mesmo se já houver cache (depois de trocar
 *                          o próprio perfil, por exemplo)
 */
export async function carregarPermissoes({ forcar = false } = {}) {
  if (_chaves && !forcar) return _chaves;
  if (_carregando && !forcar) return _carregando;

  _carregando = (async () => {
    const { data, error } = await sb.rpc('minhas_permissoes');
    if (error) {
      // Sem permissões conhecidas o painel não deve "abrir tudo por via das
      // dúvidas": o default é negar, igual ao do banco.
      console.error('Permissões:', error);
      _chaves = new Set();
      return _chaves;
    }
    _chaves = new Set((data || []).map(r => (typeof r === 'string' ? r : r.minhas_permissoes)));
    return _chaves;
  })();

  try { return await _carregando; } finally { _carregando = null; }
}

/** Esquece o que sabia. Chamar no logout — senão a próxima conta herda. */
export function limparPermissoes() {
  _chaves = null;
  _carregando = null;
}

/**
 * O usuário atual pode `chave`?
 *
 * Antes de `carregarPermissoes()` devolve false, e é deliberado: negar
 * enquanto não se sabe é o mesmo default do banco.
 */
export function pode(chave) {
  return !!_chaves && _chaves.has(chave);
}

/** Pode ao menos uma das chaves. Útil para item de menu que abre uma área. */
export function podeAlguma(...chaves) {
  return chaves.some(pode);
}

/** As permissões efetivas, para depuração. Cópia, não a referência interna. */
export function permissoesAtuais() {
  return _chaves ? [..._chaves].sort() : [];
}

/** Já carregou? Distingue "não pode" de "ainda não sei". */
export function permissoesCarregadas() {
  return _chaves !== null;
}

/**
 * Marca o acesso desta sessão. Falha em silêncio de propósito: a coluna
 * `ultimo_acesso_em` é conveniência administrativa, e não pode impedir alguém
 * de usar o painel se a gravação falhar.
 */
export async function registrarAcesso() {
  try { await sb.rpc('registrar_meu_acesso'); }
  catch (e) { console.error('Último acesso:', e); }
}
