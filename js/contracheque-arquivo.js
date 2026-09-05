// ═══════════════════════════════════════════════════════════
// CONTRACHEQUE PUBLICADO — o recibo que o colaborador abre
// ═══════════════════════════════════════════════════════════
// Ao FECHAR a folha, cada linha vira um HTML autossuficiente guardado no
// Storage, ao lado do espelho de ponto daquele mês. É esse arquivo que o app
// do colaborador vai abrir.
//
// POR QUE UM ARQUIVO, E NÃO RENDERIZAR NA HORA:
// o contracheque é o documento de um pagamento que já aconteceu. Renderizado
// a partir da tabela, ele mudaria sozinho se a folha fosse reaberta e
// corrigida — e o colaborador veria um recibo diferente do que assinou, sem
// nada indicando a troca. O arquivo congela o que foi pago naquele dia.
//
// AUTOSSUFICIENTE DE VERDADE: o estilo vai embutido, lido de css/tokens.css e
// css/contracheque.css no momento da publicação. São as MESMAS folhas que
// desenham o recibo na tela — copiar o CSS para dentro deste módulo faria os
// dois divergirem no primeiro ajuste.

import { htmlContracheque } from './contracheque.js';
import { guardarDocumento, urlAssinada, BUCKET } from './documentos.js';

export { BUCKET };

const FOLHAS_DE_ESTILO = ['css/tokens.css', 'css/contracheque.css'];
let _estiloEmCache = null;

/** Lê as folhas de estilo do próprio app uma vez por sessão. */
export async function estiloDoDocumento(carregar = buscarTexto) {
  if (_estiloEmCache !== null) return _estiloEmCache;
  const partes = [];
  for (const caminho of FOLHAS_DE_ESTILO) {
    partes.push(await carregar(caminho));
  }
  _estiloEmCache = partes.join('\n\n');
  return _estiloEmCache;
}

async function buscarTexto(caminho) {
  const base = new URL('.', window.location.href);
  const r = await fetch(new URL(caminho, base));
  if (!r.ok) throw new Error('contracheque_estilo_indisponivel');
  return r.text();
}

/**
 * Documento completo: `<!doctype html>` com o estilo embutido.
 * Abre em qualquer navegador, offline, sem depender do painel estar no ar.
 */
export function documentoHtml(miolo, { titulo, css = '' }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapar(titulo)}</title>
<style>
body { margin: 0; padding: 24px; background: #F7F7F6; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
.cc { margin: 0 auto; }
.cc-imprimir {
  display: block;
  margin: 0 auto 18px;
  padding: 11px 20px;
  min-height: 44px;
  border: 1px solid #D8DEE5;
  border-radius: 12px;
  background: #fff;
  color: #1D2939;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.cc-imprimir:hover { border-color: #18B984; color: #167C57; }
@media print {
  body { padding: 0; background: #fff; }
  .cc-imprimir { display: none !important; }
}
${css}
</style>
</head>
<body>
<button type="button" class="cc-imprimir" onclick="window.print()">Imprimir ou salvar em PDF</button>
${miolo}
</body>
</html>`;
}

/**
 * Gera o contracheque e guarda no repositório de documentos.
 *
 * Quem cuida de caminho, versão, duplicidade e registro é js/documentos.js —
 * este módulo só sabe montar o documento. Antes o arquivo era gravado direto
 * num bucket próprio, sem registro nenhum: existia no Storage e não existia
 * para o sistema.
 *
 * @returns {{documento: object, duplicado: boolean}}
 */
export async function publicarContracheque(item, folha, opcoes = {}) {
  const { css = '', folhaId = null } = opcoes;
  const miolo = htmlContracheque(item, folha, opcoes);
  const nome = item.funcionario?.nome || '';
  const html = documentoHtml(miolo, { titulo: `Contracheque · ${nome}`.trim(), css });

  return guardarDocumento({
    colaboradorId: item.funcionario_id,
    competencia: folha?.competencia,
    tipo: 'contracheque',
    conteudo: html,
    nomeArquivo: 'contracheque.html',
    mimeType: 'text/html',
    titulo: 'Contracheque',
    origem: 'gerado_sistema',
    metadata: {
      folha_id: folhaId || folha?.id || null,
      gerado_a_partir_de: 'folha_pagamento',
      item_id: item.id || null,
    },
  });
}

/** URL temporária para abrir o documento. O bucket é privado. */
export async function urlDoContracheque(caminho, segundos = 3600) {
  return urlAssinada(caminho, segundos);
}

export function traduzirErroContracheque(msg) {
  const m = String(msg || '').toLowerCase();
  if (m.includes('bucket not found')) {
    return 'O lugar de publicar os contracheques ainda não existe — rode db/contracheque_publicado.sql.';
  }
  if (m.includes('estilo_indisponivel')) {
    return 'Não consegui ler o estilo do documento. Recarregue a página e tente de novo.';
  }
  // O contracheque é HTML. Quando a lista de tipos do bucket é reescrita à mão
  // para aceitar um formato novo, é este que costuma ficar de fora — e o erro
  // só aparece no fechamento da folha, meses depois da mexida.
  if (/mime type .* is not supported/.test(m)) {
    return 'O repositório de documentos não aceita mais o contracheque (text/html). '
      + 'Rode db/documentos_mime_do_app.sql no Supabase e feche a folha de novo.';
  }
  // AS DUAS CAUSAS DE COLISÃO EM `uniq_cd_atual`, e elas pedem coisas
  // diferentes de quem lê:
  //
  //   . o contracheque anterior EXISTE E NÃO É VISÍVEL para esta conta — foi
  //     publicado antes da Etapa 4C, com o uuid da pessoa no lugar do da
  //     organização. Nenhuma quantidade de "tente de novo" resolve: é dado a
  //     corrigir no banco.
  //   . o anterior é visível e alguém publicou ao mesmo tempo, de outra aba.
  if (m.includes('documento_atual_invisivel')) {
    return 'Existe um contracheque desta competência gravado em outro dono, invisível '
      + 'para esta conta. Rode db/conferencia/119_documentos_fora_da_organizacao.sql '
      + 'para ver quais são e db/documentos_trazer_para_organizacao.sql para corrigir.';
  }
  if (m.includes('uniq_cd_atual')) {
    return 'Outra aba publicou este contracheque ao mesmo tempo. Recarregue a página: '
      + 'se o documento já estiver lá, não há nada a refazer.';
  }
  if (m.includes('row-level security') || m.includes('unauthorized')) {
    return 'Sem permissão para publicar este contracheque.';
  }
  return msg || 'Não consegui publicar o contracheque.';
}

const escapar = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
