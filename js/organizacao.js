// ═══════════════════════════════════════════════════════════
// ORGANIZAÇÃO — de quem é o dado desta sessão
// ═══════════════════════════════════════════════════════════
// Uma chamada a `organizacao_do_auth()` por sessão. Toda camada de dados que
// precise saber o DONO de um registro pergunta aqui.
//
// ═══════════════════════════════════════════════════════════
// ISTO NÃO É permissoes.js, E A SEPARAÇÃO É PROPOSITAL
// ═══════════════════════════════════════════════════════════
//   organizacao.js  →  DE QUEM É o dado          (tenancy)
//   permissoes.js   →  O QUE a pessoa pode fazer (autorização)
//
// São perguntas diferentes, com ciclos de vida diferentes: a permissão muda
// quando o perfil ou uma exceção muda; a organização só muda quando a sessão
// muda. Juntá-las obrigaria a recarregar uma toda vez que a outra mudasse.
//
// ═══════════════════════════════════════════════════════════
// POR QUE ESTE MÓDULO PRECISOU EXISTIR
// ═══════════════════════════════════════════════════════════
// Até a Etapa 4, cada camada de dados resolvia o dono assim:
//
//     const { data: { user } } = await sb.auth.getUser();
//     return user.id;                       // o uuid da PESSOA
//
// Isso funcionou enquanto só existia o proprietário, porque para ele
// `auth.uid() === organizacao_do_auth()`. Com a Recepção os dois divergem, e o
// modo de falha é silencioso: o `.eq('nutri_id', user.id)` não casa com nada e
// a tela abre VAZIA, sem erro. Um painel vazio é indistinguível de uma empresa
// sem cadastro — e o proprietário, que continua funcionando, não percebe.
//
// ═══════════════════════════════════════════════════════════
// SEM FALLBACK PARA auth.uid()
// ═══════════════════════════════════════════════════════════
// Se a RPC falhar ou devolver null, este módulo levanta erro. Cair para o uuid
// da pessoa "para não quebrar a tela" reintroduziria exatamente o bug que ele
// existe para eliminar — e o reintroduziria disfarçado de robustez, no caminho
// de erro, onde ninguém olha.
//
// Também é diferente de `pode()`, que devolve false enquanto não sabe: ali o
// default seguro é negar. Aqui não existe default seguro. Gravar sem saber o
// dono é pior do que falhar.
//
// ═══════════════════════════════════════════════════════════
// POR QUE MEMÓRIA, E NÃO localStorage
// ═══════════════════════════════════════════════════════════
// Cache em localStorage sobrevive à troca de conta. Em 05/08/2026 o painel
// abriu com uma conta de teste e o sistema apareceu inteiro vazio, sem erro na
// tela. Uma organização servida do cache da conta anterior seria pior que isso:
// não mostraria dado de menos, gravaria dado no tenant errado.

import { sb } from './supabase.js';

let _org = null;          // uuid da organização, ou null se ainda não carregou
let _carregando = null;   // promessa em voo, para não pedir duas vezes

/**
 * A organização da sessão atual.
 *
 * Idempotente: chamadas simultâneas compartilham a mesma ida à rede — a tela
 * do Comercial dispara três consultas em paralelo e não deve custar três
 * chamadas de RPC.
 *
 * @returns {Promise<string>} uuid da organização
 * @throws  se não houver sessão, se o usuário não pertencer a nenhuma
 *          organização, ou se estiver bloqueado
 */
export async function organizacaoAtual() {
  if (_org) return _org;
  if (_carregando) return _carregando;

  _carregando = (async () => {
    const { data, error } = await sb.rpc('organizacao_do_auth');
    if (error) throw error;
    // NULL vem de três situações que a RPC não distingue, e nenhuma delas
    // permite continuar: sem sessão, sem vínculo, ou usuário/organização
    // inativos. Quem chamar trata como "sem acesso".
    if (!data) throw new Error('sem_organizacao');
    _org = data;
    return _org;
  })();

  try { return await _carregando; } finally { _carregando = null; }
}

/** Esquece o que sabia. Chamar no logout — senão a próxima conta herda. */
export function limparOrganizacao() {
  _org = null;
  _carregando = null;
}

/** Já carregou? Distingue "não tem" de "ainda não sei". */
export function organizacaoCarregada() {
  return _org !== null;
}

/** A organização em cache, sem ida à rede. null se ainda não carregou. */
export function organizacaoEmCache() {
  return _org;
}
