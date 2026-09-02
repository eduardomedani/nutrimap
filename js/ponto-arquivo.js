// ═══════════════════════════════════════════════════════════
// ARQUIVO DO PONTO — guarda o PDF que originou as horas
// ═══════════════════════════════════════════════════════════
// O sistema lia o total do PDF e jogava o arquivo fora. A partir daqui ele
// fica: é o documento que o colaborador confere no app, e é a resposta para
// "de onde saiu esse número?" quando alguém perguntar meses depois.
//
// Quem cuida de caminho, versão, duplicidade e registro é js/documentos.js.
// Este módulo é a ponte entre a importação da folha e o repositório — ele
// existe para a folha não precisar conhecer o formato do documento.
//
// CADA ARQUIVO É DE UMA PESSOA SÓ. O espelho de ponto que o gerador emite já
// vem individual; guardar um PDF com a jornada de seis pessoas entregaria a
// cada uma os dados das outras.

import {
  guardarDocumento, urlAssinada, nomeSeguro, caminhoDoDocumento,
  traduzirErroDocumento, BUCKET,
} from './documentos.js';

export { BUCKET, nomeSeguro };

/** Caminho do espelho de ponto no repositório. */
export function caminhoDoPonto({ nutriId, funcionarioId, competencia, arquivo }) {
  return caminhoDoDocumento({
    nutriId,
    colaboradorId: funcionarioId,
    competencia,
    tipo: 'folha_ponto',
    arquivo: arquivo || 'ponto.pdf',
  });
}

/**
 * Guarda o espelho de ponto e devolve o documento criado.
 * Reimportar o mesmo arquivo não duplica — o hash é igual e o repositório
 * devolve o que já existe.
 */
export async function guardarPonto(arquivo, { funcionarioId, competencia, periodo = null }) {
  return guardarDocumento({
    colaboradorId: funcionarioId,
    competencia,
    tipo: 'folha_ponto',
    conteudo: arquivo,
    nomeArquivo: arquivo?.name || 'ponto.pdf',
    mimeType: 'application/pdf',
    titulo: 'Folha de ponto',
    descricao: periodo ? `Período de ${periodo.inicio} a ${periodo.fim}` : null,
    origem: 'importado',
    metadata: periodo
      ? { periodo_inicio: periodo.inicio, periodo_fim: periodo.fim }
      : {},
  });
}

/** URL temporária para abrir o PDF. Vale por 1 hora, o suficiente para ler. */
export async function urlDoPonto(caminho, segundos = 3600) {
  return urlAssinada(caminho, segundos);
}

export function traduzirErroArquivo(msg) {
  return traduzirErroDocumento(msg);
}
