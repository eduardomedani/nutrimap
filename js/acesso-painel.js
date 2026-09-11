// ═══════════════════════════════════════════════════════════
// ACESSO AO PAINEL — quem pode ver a tela do profissional
// ═══════════════════════════════════════════════════════════
// Antes deste módulo, o painel conferia AUTENTICAÇÃO e tratava como
// AUTORIZAÇÃO: `fazerLogin()` dava certo e `iniciarApp()` revelava a tela na
// primeira linha. Uma conta de aluno que abrisse a raiz do site e usasse a
// senha do app entrava no painel. O banco segurava os dados (a RLS devolvia só
// a própria ficha, o menu sumia, toda escrita era negada), mas a tela
// profissional aparecia para quem não é profissional.
//
// A REGRA — decidida pelo Eduardo:
//
//   organização ativa ................ monta o painel
//   sem organização + ficha de aluno .. encerra a sessão do painel → app.html
//   sem organização + sem ficha ...... encerra a sessão do painel → aviso
//   falha ao consultar ............... não monta, avisa, MANTÉM a sessão
//
// "Organização ativa" é `organizacao_do_auth()` — a mesma função da RLS. Ela só
// devolve a organização quando o vínculo está `ativo` E a organização está
// `ativa`: usuário bloqueado e organização desativada caem no mesmo "sem
// organização", sem regra nova aqui. A RPC não distingue os casos, e o painel
// não precisa: em nenhum deles a tela pode montar.
//
// ── POR QUE FALHA DE REDE NÃO DESCONECTA ────────────────────────────────────
// Erro ao consultar não é resposta de "sem acesso": é ausência de resposta. Um
// profissional com a rede instável não pode ser desconectado nem mandado para
// o app do aluno por isso. O painel não monta (nega por padrão, como o banco),
// e a tela de entrada diz que não conseguiu confirmar.
//
// ── POR QUE `scope: 'local'` ────────────────────────────────────────────────
// O `signOut()` do supabase-js é GLOBAL por padrão: revoga os tokens da conta
// em todos os lugares. Um aluno que caísse na raiz por engano perderia, dali a
// pouco, o login do app no celular dele. `local` encerra só a sessão deste
// cliente — a do painel, que tem chave própria (`evollo-auth-painel`, ver
// js/supabase.js).

import { sb } from './supabase.js';
import { organizacaoAtual, limparOrganizacao } from './organizacao.js';

export const ACESSO = Object.freeze({
  PAINEL: 'painel',
  ALUNO: 'aluno',
  SEM_ACESSO: 'sem_acesso',
  ERRO: 'erro',
});

export const AVISO_SEM_ACESSO =
  'Esta conta não tem acesso ao painel profissional. Se você trabalha numa organização, ' +
  'peça ao responsável para liberar seu acesso.';
export const AVISO_ERRO =
  'Não foi possível confirmar seu acesso ao painel. Verifique a conexão e tente de novo.';

/**
 * Qual das quatro situações vale para a sessão atual. Só lê, não age.
 *
 * `organizacaoAtual()` já distingue "sem organização" (lança `sem_organizacao`)
 * de falha da RPC (lança o erro do Supabase) — por isso a comparação é pela
 * mensagem.
 */
export async function decidirAcesso() {
  try {
    await organizacaoAtual();
    return ACESSO.PAINEL;
  } catch (e) {
    if (e?.message !== 'sem_organizacao') return ACESSO.ERRO;
  }

  // Sem organização ativa, com certeza. Resta saber se é aluno. Se ESTA
  // consulta falhar, o que já se sabe basta para negar o painel — e mandar
  // para o app sem saber se é aluno seria um palpite.
  const { data, error } = await sb.rpc('paciente_do_auth');
  if (error) return ACESSO.SEM_ACESSO;

  // Só um id de verdade conta como ficha. O dublê dos testes devolve `[]` para
  // RPC não programada, e `[]` é verdadeiro em JS.
  return (typeof data === 'string' && data) ? ACESSO.ALUNO : ACESSO.SEM_ACESSO;
}

/**
 * O portão. Devolve `true` se o painel pode montar; `false` se não pode — e,
 * nesse caso, já fez o que a regra manda.
 *
 * @param {object}   [op]
 * @param {Function} [op.avisar]  mostra o texto na tela de entrada
 * @param {Function} [op.irPara]  navega; `replace` para o Voltar não reabrir o painel
 */
export async function portaoDoPainel({
  avisar = () => {},
  irPara = (url) => window.location.replace(url),
} = {}) {
  const acesso = await decidirAcesso();

  if (acesso === ACESSO.PAINEL) return true;

  if (acesso === ACESSO.ERRO) {
    avisar(AVISO_ERRO);
    return false;
  }

  // Sem organização: a sessão do PAINEL sai, e só ela. Se o próprio signOut
  // falhar, o painel continua sem montar — o que protege a tela é o `false`
  // abaixo, não o signOut.
  try { await sb.auth.signOut({ scope: 'local' }); } catch { /* segue negando */ }
  limparOrganizacao();

  if (acesso === ACESSO.ALUNO) {
    // Relativo, e não `/app.html`: o site também roda em subpasta.
    irPara('app.html');
    return false;
  }

  avisar(AVISO_SEM_ACESSO);
  return false;
}
