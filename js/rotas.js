// ═══════════════════════════════════════════════════════════
// ROTAS — o mapa dos links antigos
// ═══════════════════════════════════════════════════════════
// O Financeiro nasceu guardando duas coisas diferentes: o dinheiro da empresa
// e o pagamento da equipe. Ao separá-las, todo link já compartilhado —
// #financeiro/folha num WhatsApp, um favorito do navegador — apontaria para
// uma tela que mudou de dono.
//
// Aqui mora a tradução, e só ela: função pura, sem DOM e sem rede, para o
// index.html chamar no load e o teste conferir sem abrir navegador.

/** Link antigo → link novo. A chave é o hash SEM o "#". */
export const REDIRECIONAMENTOS = {
  'financeiro/resumo':       'equipe/resumo',
  'financeiro/funcionarios': 'equipe/funcionarios',
  'financeiro/folha':        'equipe/folha',
  'financeiro/documentos':   'equipe/documentos',
  'financeiro/ponto':        'equipe/ponto',
};

/**
 * Separa o caminho da query: 'financeiro/folha?competencia=2026-08' vira
 * { caminho, query }. O "?" no hash não é a query da página — quem lê é este
 * roteador, não o servidor.
 */
function partir(hash) {
  const cru = String(hash || '').replace(/^#/, '');
  const i = cru.indexOf('?');
  const caminho = (i < 0 ? cru : cru.slice(0, i)).replace(/\/+$/, '');
  const query = i < 0 ? '' : cru.slice(i + 1);
  return { caminho, query };
}

/**
 * Devolve o hash canônico de uma rota (sem "#"). O que não é rota antiga volta
 * inalterado — inclusive string vazia, para o chamador decidir o que fazer.
 *
 * A QUERY VIAJA JUNTO. #financeiro/folha?competencia=2026-08 tem que chegar em
 * #equipe/folha?competencia=2026-08: redirecionar perdendo a competência
 * levaria a pessoa para a tela certa no mês errado — pior do que o link
 * quebrado, porque o mês errado não avisa que está errado.
 */
export function rotaCanonica(hash) {
  const { caminho, query } = partir(hash);
  const destino = REDIRECIONAMENTOS[caminho] || caminho;
  return query ? `${destino}?${query}` : destino;
}

/** Só avisa se houve troca — quem chama decide se reescreve a barra de endereço. */
export function ehRotaAntiga(hash) {
  return Object.prototype.hasOwnProperty.call(REDIRECIONAMENTOS, partir(hash).caminho);
}

/** O caminho sem a query: 'equipe/folha?competencia=…' → 'equipe/folha'. */
export function caminhoDaRota(hash) {
  return partir(hash).caminho;
}

/** Os parâmetros da rota como objeto. Sem query, devolve {}. */
export function parametrosDaRota(hash) {
  const { query } = partir(hash);
  if (!query) return {};
  const fora = {};
  for (const par of query.split('&')) {
    if (!par) continue;
    const [k, v = ''] = par.split('=');
    if (!k) continue;
    try { fora[decodeURIComponent(k)] = decodeURIComponent(v); }
    catch (e) { fora[k] = v; }
  }
  return fora;
}
