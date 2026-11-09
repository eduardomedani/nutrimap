// ═══════════════════════════════════════════════════════════
// HTML SEGURO — escape de texto não confiável antes de ir para innerHTML
// ═══════════════════════════════════════════════════════════
// Tudo o que o PACIENTE escreve chega ao painel do profissional: a anamnese
// (gravada por RPC anônima — quem tem o código grava o que quiser, inclusive
// valores fora das opções do formulário), o nome e o e-mail que o gatilho
// copia dela para `pacientes`, e o que a IA devolve a partir desse texto.
// Nada disso pode virar marcação.
//
// UMA função, cinco caracteres. Escapar também as aspas simples é o que torna
// o resultado seguro dentro de atributo com QUALQUER delimitador — o defeito
// que existia em `data-refeicoes='...'` era justamente o apóstrofo, que
// encodeURIComponent deixa passar.
//
// Escapar é na SAÍDA, nunca na entrada: o dado continua íntegro no banco e nas
// contas (comparar "Sim", parseFloat do peso), e só vira texto inerte no
// momento de ser posto em HTML.

const MAPA = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Texto (ou número, ou nulo) → HTML inerte. Serve para conteúdo e atributo. */
export function escaparHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, c => MAPA[c]);
}
