// ═══════════════════════════════════════════════════════════
// COMPETÊNCIA — o mês em que a sessão está trabalhando
// ═══════════════════════════════════════════════════════════
// Ponto, Folha e Documentos falam do MESMO mês. Enquanto cada aba guardava a
// própria competência, trocar de aba jogava a pessoa de volta no mês corrente:
// quem estava conferindo agosto no ponto abria a folha em outubro sem ver a
// troca, e o número que ela tinha acabado de ler já não era o da tela.
//
// Um lugar só, e nenhum a mais. É estado de SESSÃO, não preferência salva: no
// dia seguinte o padrão volta a ser o mês mais recente com folha — abrir o
// sistema numa competência velha por causa de ontem seria o defeito inverso.

const CHAVE = 'evollo.competencia';
const CHAVE_PERIODO = 'evollo.resumo.periodo';

// Espelho em memória: em aba com storage bloqueado o sessionStorage lança, e
// um throw aqui derrubaria a montagem da aba inteira.
const _memoria = { competencia: null, periodo: null };

/** '2026-08-01' ou '2026-08' → true. Qualquer outra coisa → false. */
export function competenciaValida(c) {
  return /^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/.test(String(c || ''));
}

/** Normaliza para o primeiro dia do mês, que é como a tabela `folhas` guarda. */
export function normalizar(c) {
  if (!competenciaValida(c)) return null;
  return `${String(c).slice(0, 7)}-01`;
}

/** O mês da sessão, ou null se ainda ninguém escolheu um. */
export function competenciaAtiva() {
  try {
    return normalizar(sessionStorage.getItem(CHAVE));
  } catch (e) {
    return _memoria.competencia;
  }
}

/** Guarda a escolha. Valor inválido não apaga o que já valia. */
export function definirCompetencia(c) {
  const n = normalizar(c);
  if (!n) return competenciaAtiva();
  _memoria.competencia = n;
  try { sessionStorage.setItem(CHAVE, n); } catch (e) {}
  return n;
}

/** O que a aba deve abrir: a escolha da sessão, ou o padrão que ela sugeriu. */
export function competenciaOuPadrao(padrao) {
  return competenciaAtiva() || normalizar(padrao) || null;
}

// ── Janela do resumo (12 / 24 / tudo) ──────────────────────
// Mesma ideia: quem abriu "24 meses" e foi ver a folha não quer voltar em 12.
export function periodoDoResumo(padrao = 12) {
  try {
    const n = Number(sessionStorage.getItem(CHAVE_PERIODO));
    return Number.isFinite(n) && n > 0 ? n : padrao;
  } catch (e) {
    return _memoria.periodo || padrao;
  }
}

export function definirPeriodoDoResumo(meses) {
  const n = Number(meses);
  if (!Number.isFinite(n) || n <= 0) return;
  _memoria.periodo = n;
  try { sessionStorage.setItem(CHAVE_PERIODO, String(n)); } catch (e) {}
}

/** Só para o teste: esquece o que a sessão guardou. */
export function esquecer() {
  _memoria.competencia = null;
  _memoria.periodo = null;
  try {
    sessionStorage.removeItem(CHAVE);
    sessionStorage.removeItem(CHAVE_PERIODO);
  } catch (e) {}
}
