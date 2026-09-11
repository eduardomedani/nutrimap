// ═══════════════════════════════════════════════════════════
// MÍDIA DO EXERCÍCIO — escolher, assinar, renovar
// ═══════════════════════════════════════════════════════════
// O acervo de animações vive num bucket PRIVADO. Nada nele tem URL pública:
// cada reprodução usa uma URL assinada, válida por uma hora, emitida com a
// sessão do próprio usuário e submetida à RLS de `midias` e `storage.objects`.
//
// NUNCA com service_role. A chave de serviço ignora RLS, e no navegador ela
// estaria ao alcance de qualquer um com o DevTools aberto.
//
// ── O CAMINHO NÃO ENTRA NO DOM ─────────────────────────────────────────────
// A marcação carrega `data-midia="<uuid>"`, nunca `caminho`. O caminho vive no
// Map deste módulo, montado a partir das linhas que a consulta devolveu — ou
// seja, já filtradas pela RLS.
//
// Na renovação, `renovar()` recebe um id, procura no Map e RECUSA o que não
// achar. Um caminho digitado no console não existe no Map e não é assinado.
//
// A RLS do Storage barraria de todo modo — está provado no gate 129, prova 4:
// forasteiro não enxerga o objeto. Esta é a segunda tranca, não a única.

import { sb } from './supabase.js';

export const BUCKET = 'exercicio-midias';
export const VALIDADE_S = 3600;   // uma hora cobre um treino inteiro com folga

// id da mídia -> caminho no bucket. Só o que a consulta trouxe.
const _caminhos = new Map();
// id da mídia -> Promise de assinatura em andamento, para duas ocorrências da
// mesma mídia não pedirem duas URLs ao mesmo tempo.
const _emVoo = new Map();

/**
 * O sexo do aluno, normalizado.
 *
 * A mesma regra de `js/anamnese-calorias.js`: começa com "m" é masculino,
 * começa com "f" é feminino, o resto é desconhecido. Escrever uma segunda
 * normalização seria criar duas verdades sobre o mesmo campo.
 */
export function normalizarSexo(bruto) {
  const s = String(bruto || '').trim().toLowerCase();
  if (s.startsWith('m')) return 'M';
  if (s.startsWith('f')) return 'F';
  return null;
}

/**
 * Qual animação mostrar para este exercício.
 *
 * A ordem é a decidida pelo Eduardo:
 *   1. a do gênero preferido       (F -> feminino; M e desconhecido -> masculino)
 *   2. a de papel 'principal'
 *   3. a primeira por `ordem`
 *
 * NUNCA devolve nulo quando existe alguma mídia. Faltar a versão do gênero
 * certo é motivo para mostrar a outra, não para esconder a demonstração — dos
 * 49 exercícios com animação, só 19 têm par M/F.
 */
export function escolherMidia(exercicio, sexo) {
  const linhas = (exercicio?.midias || [])
    .filter(l => l?.midia?.caminho)
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  if (!linhas.length) return null;

  const preferido = sexo === 'F' ? 'feminino' : 'masculino';

  return (linhas.find(l => l.midia.genero === preferido)
       || linhas.find(l => l.papel === 'principal')
       || linhas[0]).midia;
}

/**
 * Resolve a mídia de cada item e assina o lote — UMA chamada ao Storage.
 *
 * A escolha vem ANTES da assinatura, de propósito: assinar M e F para depois
 * mostrar só uma emitiria o dobro de tokens, metade deles para nada.
 *
 * Devolve `Map` de id da mídia -> URL assinada. Os itens sem mídia não entram;
 * quem os desenha cai no `video_url`, e depois em nada.
 */
export async function assinarDoTreino(itens, sexo) {
  const escolhidas = new Map();          // id -> objeto da mídia
  for (const it of itens || []) {
    const m = escolherMidia(it?.exercicio, sexo);
    if (m) escolhidas.set(m.id, m);
  }
  if (!escolhidas.size) return new Map();

  // Deduplicado pelo próprio Map: dois exercícios que compartilham o mesmo
  // arquivo pedem uma assinatura só.
  const midias = [...escolhidas.values()];
  for (const m of midias) _caminhos.set(m.id, m.caminho);

  const { data, error } = await sb.storage.from(BUCKET)
    .createSignedUrls(midias.map(m => m.caminho), VALIDADE_S);

  const urls = new Map();
  if (error || !Array.isArray(data)) return urls;   // sem vídeo é melhor que erro na cara

  // `createSignedUrls` devolve na mesma ordem dos caminhos pedidos.
  data.forEach((r, i) => {
    if (r?.signedUrl && !r.error) urls.set(midias[i].id, r.signedUrl);
  });
  return urls;
}

/**
 * Uma URL nova para uma mídia — usado quando a assinada expirou.
 *
 * Duas ocorrências da mesma mídia na tela falham quase juntas. Sem o `_emVoo`,
 * seriam dois pedidos simultâneos para o mesmo arquivo; com ele, o segundo
 * espera o primeiro e os dois recebem a mesma URL.
 *
 * Recusa id que não esteja no Map: é a tranca contra caminho arbitrário.
 */
export function renovar(midiaId) {
  const caminho = _caminhos.get(midiaId);
  if (!caminho) return Promise.resolve(null);

  if (_emVoo.has(midiaId)) return _emVoo.get(midiaId);

  const p = sb.storage.from(BUCKET).createSignedUrl(caminho, VALIDADE_S)
    .then(({ data, error }) => (error ? null : (data?.signedUrl || null)))
    .catch(() => null)
    .finally(() => _emVoo.delete(midiaId));

  _emVoo.set(midiaId, p);
  return p;
}

/** Esquece tudo. Chamado ao sair, para a sessão seguinte não herdar caminhos. */
export function limpar() {
  _caminhos.clear();
  _emVoo.clear();
}

/** Só para os testes verem o que entrou no Map — não usar na aplicação. */
export function _caminhoDe(midiaId) {
  return _caminhos.get(midiaId) || null;
}
