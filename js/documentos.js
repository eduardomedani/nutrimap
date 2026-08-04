// ═══════════════════════════════════════════════════════════
// DOCUMENTOS DO COLABORADOR — repositório permanente
// ═══════════════════════════════════════════════════════════
// Um lugar só para tudo que o colaborador precisa poder abrir: contracheque,
// folha de ponto e, depois, férias, informe de rendimentos, advertência.
//
// O QUE ESTE MÓDULO GARANTE:
//   . o arquivo vai para o Storage privado ANTES de existir registro — assim
//     nunca há linha "disponível" apontando para arquivo que não subiu;
//   . o registro carrega colaborador_id e competência, sempre;
//   . regerar cria VERSÃO, não sobrescreve: o colaborador pode já ter visto e
//     impresso a versão anterior;
//   . nada aqui devolve URL pública — só assinada, com prazo curto.
//
// FORMATO NÃO ACOPLA A INTERFACE: cada documento se descreve por mime_type, e
// as telas decidem o que oferecer a partir disso. Hoje o contracheque é HTML e
// o ponto é PDF; quando um deles virar outro formato, nenhuma tela muda.

import { sb } from './supabase.js';

export const BUCKET = 'colaborador-documentos';

export const TIPOS = {
  contracheque:          { rotulo: 'Contracheque',           icone: 'receipt-text' },
  folha_ponto:           { rotulo: 'Folha de ponto',         icone: 'clock' },
  comprovante_ferias:    { rotulo: 'Comprovante de férias',  icone: 'palmtree' },
  aviso_ferias:          { rotulo: 'Aviso de férias',        icone: 'calendar-check' },
  recibo_ferias:         { rotulo: 'Recibo de férias',       icone: 'receipt' },
  comprovante_pagamento: { rotulo: 'Comprovante de pagamento', icone: 'banknote' },
  informe_rendimentos:   { rotulo: 'Informe de rendimentos', icone: 'file-text' },
  comunicado:            { rotulo: 'Comunicado',             icone: 'megaphone' },
  advertencia:           { rotulo: 'Advertência',            icone: 'triangle-alert' },
  documento_admissional: { rotulo: 'Documento admissional',  icone: 'file-badge' },
  personalizado:         { rotulo: 'Documento',              icone: 'file' },
};

export const STATUS = {
  rascunho:    'Rascunho',
  processando: 'Processando',
  disponivel:  'Disponível',
  erro:        'Erro',
  arquivado:   'Arquivado',
};

export const ORIGENS = {
  gerado_sistema: 'Gerado pelo sistema',
  importado:      'Importado',
  enviado_manual: 'Enviado manualmente',
};

/** Limite de tamanho. Espelho de ponto passa longe disso; PDF gigante, não. */
export const TAMANHO_MAXIMO = 15 * 1024 * 1024;

const MIMES_ACEITOS = ['application/pdf', 'text/html'];

// ───────────────────────────────────────────────────────────
// DESCRIÇÃO DO FORMATO — o que a interface consulta
// ───────────────────────────────────────────────────────────

/**
 * Traduz o documento em capacidades, para nenhuma tela precisar perguntar
 * "isto é HTML?". Quando o contracheque virar PDF um dia, só esta função muda.
 */
export function formatoDoDocumento(doc) {
  const mime = String(doc?.mime_type || '').toLowerCase();
  if (mime.includes('html')) {
    return {
      formato: 'html',
      mimeType: 'text/html',
      rotuloAbrir: 'Abrir',
      // O arquivo é HTML: chamar de "Baixar PDF" seria mentira. Quem quiser o
      // PDF usa a impressão do navegador, e o documento traz esse botão.
      rotuloSalvar: 'Imprimir ou salvar em PDF',
      podeImprimir: true,
      podeBaixar: true,
    };
  }
  return {
    formato: 'pdf',
    mimeType: mime || 'application/pdf',
    rotuloAbrir: 'Abrir',
    rotuloSalvar: 'Baixar',
    podeImprimir: true,
    podeBaixar: true,
  };
}

// ───────────────────────────────────────────────────────────
// CAMINHO E NOME
// ───────────────────────────────────────────────────────────

/** Sem acento, sem espaço e sem barra — barra criaria pasta e desalinharia o caminho. */
export function nomeSeguro(nome, extensaoPadrao = '') {
  const limpo = String(nome || '')
    .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(-90);
  if (limpo) return limpo;
  return extensaoPadrao ? `documento${extensaoPadrao}` : 'documento';
}

/** {nutri}/{colaborador}/{AAAA-MM}/{tipo}/{arquivo} */
export function caminhoDoDocumento({ nutriId, colaboradorId, competencia, tipo, arquivo }) {
  if (!nutriId || !colaboradorId) throw new Error('documento_sem_dono');
  if (!tipo) throw new Error('documento_sem_tipo');
  const mes = String(competencia || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('documento_sem_competencia');
  return `${nutriId}/${colaboradorId}/${mes}/${tipo}/${nomeSeguro(arquivo)}`;
}

/** SHA-256 do conteúdo — é o que separa reenvio por engano de versão legítima. */
export async function hashDoConteudo(blobOuTexto) {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  const dados = typeof blobOuTexto === 'string'
    ? new TextEncoder().encode(blobOuTexto)
    : new Uint8Array(await blobOuTexto.arrayBuffer());
  const buffer = await crypto.subtle.digest('SHA-256', dados);
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ───────────────────────────────────────────────────────────
// LEITURA
// ───────────────────────────────────────────────────────────

export async function listarDocumentos({
  colaboradorId, competencia, tipo, incluirArquivados = false, apenasAtuais = true, limite = 200,
} = {}) {
  let q = sb.from('colaborador_documentos')
    .select('*, colaborador:funcionarios ( id, nome, cargo )')
    .order('competencia', { ascending: false })
    .order('versao', { ascending: false })
    .limit(limite);

  if (colaboradorId) q = q.eq('colaborador_id', colaboradorId);
  if (competencia) q = q.eq('competencia', competencia);
  if (tipo) q = q.eq('tipo_documento', tipo);
  if (apenasAtuais) q = q.eq('atual', true);
  if (!incluirArquivados) q = q.is('arquivado_em', null);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** Todas as versões de um documento, da mais nova para a mais antiga. */
export async function versoesDoDocumento({ colaboradorId, competencia, tipo }) {
  const { data, error } = await sb
    .from('colaborador_documentos')
    .select('*')
    .eq('colaborador_id', colaboradorId)
    .eq('competencia', competencia)
    .eq('tipo_documento', tipo)
    .order('versao', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** O que já existe para uma competência, indexado por colaborador e tipo. */
export async function mapaDaCompetencia(competencia) {
  const docs = await listarDocumentos({ competencia });
  const mapa = new Map();
  for (const d of docs) {
    if (!mapa.has(d.colaborador_id)) mapa.set(d.colaborador_id, {});
    mapa.get(d.colaborador_id)[d.tipo_documento] = d;
  }
  return mapa;
}

export async function urlAssinada(caminho, segundos = 3600) {
  if (!caminho) return null;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(caminho, segundos);
  if (error) throw error;
  return data?.signedUrl || null;
}

// ───────────────────────────────────────────────────────────
// ESCRITA
// ───────────────────────────────────────────────────────────

/**
 * Guarda o arquivo e registra o documento.
 *
 * A ORDEM IMPORTA: primeiro o upload, depois a linha. Ao contrário, uma falha
 * de rede deixaria um documento "disponível" apontando para nada — e o
 * colaborador clicaria num link quebrado sem ninguém saber por quê.
 *
 * Se já existe versão atual do mesmo tipo/competência:
 *   . conteúdo idêntico (mesmo hash) → não duplica, devolve o que existe;
 *   . conteúdo diferente → nova versão, a anterior fica atual = false.
 */
export async function guardarDocumento({
  nutriId, colaboradorId, competencia, tipo,
  conteudo, nomeArquivo, mimeType,
  titulo = null, descricao = null,
  origem = 'gerado_sistema', metadata = {},
}) {
  if (!MIMES_ACEITOS.includes(mimeType)) throw new Error('documento_tipo_nao_aceito');

  const blob = conteudo instanceof Blob
    ? conteudo
    : new Blob([conteudo], { type: mimeType });

  if (blob.size > TAMANHO_MAXIMO) throw new Error('documento_grande_demais');

  const hash = await hashDoConteudo(blob);
  const anteriores = await versoesDoDocumento({ colaboradorId, competencia, tipo });
  const atual = anteriores.find(d => d.atual);

  // Mesmo conteúdo, mesma competência: reenvio por engano. Nada a fazer.
  if (atual && hash && atual.hash === hash && atual.arquivado_em === null) {
    return { documento: atual, duplicado: true };
  }

  const versao = (anteriores[0]?.versao || 0) + 1;
  const nome = nomeSeguro(nomeArquivo || `${tipo}.html`);
  const caminho = caminhoDoDocumento({
    nutriId, colaboradorId, competencia, tipo,
    // A versão entra no nome do arquivo: sem isso a v2 sobrescreveria a v1 no
    // Storage e a linha antiga apontaria para o conteúdo novo.
    arquivo: versao > 1 ? `v${versao}-${nome}` : nome,
  });

  const { error: erroUpload } = await sb.storage.from(BUCKET).upload(caminho, blob, {
    upsert: true,
    contentType: mimeType,
  });
  if (erroUpload) throw erroUpload;

  const { data, error } = await sb
    .from('colaborador_documentos')
    .insert({
      nutri_id: nutriId,
      colaborador_id: colaboradorId,
      competencia,
      tipo_documento: tipo,
      titulo: titulo || TIPOS[tipo]?.rotulo || 'Documento',
      descricao,
      nome_arquivo: nome,
      caminho_storage: caminho,
      mime_type: mimeType,
      tamanho_bytes: blob.size,
      hash,
      origem,
      status: 'disponivel',
      versao,
      atual: true,
      substitui_documento_id: atual?.id || null,
      disponibilizado_em: new Date().toISOString(),
      metadata: {
        printable: true,
        can_save_as_pdf: mimeType === 'text/html',
        format_version: 1,
        ...metadata,
      },
    })
    .select().single();
  if (error) throw error;

  // Só depois de a nova existir a anterior deixa de ser atual: se a ordem
  // fosse inversa, uma falha aqui deixaria a competência sem versão atual.
  if (atual) {
    await sb.from('colaborador_documentos')
      .update({ atual: false, atualizado_em: new Date().toISOString() })
      .eq('id', atual.id);
  }

  return { documento: data, duplicado: false, versaoAnterior: atual || null };
}

/** Arquivar tira da vista do colaborador e preserva o arquivo. */
export async function arquivarDocumento(id) {
  const { data, error } = await sb
    .from('colaborador_documentos')
    .update({
      status: 'arquivado',
      arquivado_em: new Date().toISOString(),
      atual: false,
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

export async function reativarDocumento(id) {
  const { data, error } = await sb
    .from('colaborador_documentos')
    .update({
      status: 'disponivel',
      arquivado_em: null,
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

/** Marca visualização. Só o próprio colaborador consegue — é RPC definer. */
export async function marcarVisualizado(documentoId) {
  const { data, error } = await sb.rpc('marcar_documento_visualizado', {
    p_documento: documentoId,
  });
  if (error) throw error;
  return !!data;
}

// ───────────────────────────────────────────────────────────
// PENDENTES DE VÍNCULO
// ───────────────────────────────────────────────────────────
// O arquivo que não casou com ninguém não é descartado: fica numa pasta
// separada, com o que o sistema conseguiu ler dele. Antes, quem importasse o
// ponto de alguém fora do cadastro perdia o arquivo e tinha que reimportar
// depois de corrigir — supondo que lembrasse.

/** Pasta da sala de espera. A pasta 2 não é um colaborador, então nenhuma
 *  policy de leitura do colaborador casa aqui. */
export function caminhoPendente({ nutriId, competencia, arquivo }) {
  if (!nutriId) throw new Error('documento_sem_dono');
  const mes = String(competencia || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('documento_sem_competencia');
  return `${nutriId}/_pendentes/${mes}/${nomeSeguro(arquivo)}`;
}

/** Guarda o arquivo órfão e registra a pendência. */
export async function guardarPendente({
  nutriId, competencia, conteudo, nomeArquivo, mimeType = 'application/pdf',
  tipo = 'folha_ponto', cpfLido = null, nomeLido = null, motivo = null,
  sugestaoId = null, metadata = {},
}) {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: mimeType });
  if (blob.size > TAMANHO_MAXIMO) throw new Error('documento_grande_demais');

  const hash = await hashDoConteudo(blob);
  const caminho = caminhoPendente({ nutriId, competencia, arquivo: nomeArquivo });

  const { error: erroUpload } = await sb.storage.from(BUCKET).upload(caminho, blob, {
    upsert: true, contentType: mimeType,
  });
  if (erroUpload) throw erroUpload;

  const { data, error } = await sb
    .from('documentos_pendentes')
    .insert({
      nutri_id: nutriId,
      competencia,
      tipo_documento: tipo,
      nome_arquivo: nomeSeguro(nomeArquivo),
      caminho_storage: caminho,
      mime_type: mimeType,
      tamanho_bytes: blob.size,
      hash,
      cpf_lido: cpfLido,
      nome_lido: nomeLido,
      motivo,
      sugestao_id: sugestaoId,
      metadata,
    })
    .select().single();

  // Mesmo arquivo já na fila: não é erro, é a mesma importação repetida.
  if (error && /uniq_dp_hash|duplicate key/i.test(error.message || '')) {
    return { pendente: null, duplicado: true };
  }
  if (error) throw error;
  return { pendente: data, duplicado: false };
}

export async function listarPendentes({ competencia = null, limite = 100 } = {}) {
  let q = sb.from('documentos_pendentes')
    .select('*, sugestao:funcionarios!documentos_pendentes_sugestao_id_fkey ( id, nome, cpf )')
    .eq('status', 'aguardando_vinculo')
    .order('criado_em', { ascending: false })
    .limit(limite);
  if (competencia) q = q.eq('competencia', competencia);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function contarPendentes() {
  const { count, error } = await sb
    .from('documentos_pendentes')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'aguardando_vinculo');
  if (error) throw error;
  return count || 0;
}

/**
 * Resolve a pendência: copia o arquivo para a pasta do colaborador e cria o
 * documento.
 *
 * O arquivo é COPIADO, não movido, e o original só sai depois de o documento
 * existir. Mover primeiro deixaria o arquivo fora das duas pastas se o insert
 * falhasse — e nenhuma tela saberia onde ele foi parar.
 */
export async function vincularPendente(pendente, colaboradorId) {
  const caminhoNovo = caminhoDoDocumento({
    nutriId: pendente.nutri_id,
    colaboradorId,
    competencia: pendente.competencia,
    tipo: pendente.tipo_documento,
    arquivo: pendente.nome_arquivo,
  });

  const { error: erroCopia } = await sb.storage.from(BUCKET)
    .copy(pendente.caminho_storage, caminhoNovo);
  // Já existe lá: a cópia anterior serve, seguimos para o registro.
  if (erroCopia && !/exists|duplicate/i.test(erroCopia.message || '')) throw erroCopia;

  const { data, error } = await sb.rpc('vincular_documento_pendente', {
    p_pendente: pendente.id,
    p_colaborador: colaboradorId,
    p_caminho_novo: caminhoNovo,
  });
  if (error) throw error;

  // Só agora o órfão pode sair da sala de espera.
  await sb.storage.from(BUCKET).remove([pendente.caminho_storage]).catch(() => {});
  return data;
}

export async function ignorarPendente(id) {
  const { error } = await sb
    .from('documentos_pendentes')
    .update({ status: 'ignorado', resolvido_em: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
  return true;
}

// ───────────────────────────────────────────────────────────
// AUDITORIA — só leitura; quem escreve é o gatilho do banco
// ───────────────────────────────────────────────────────────
export const ACOES = {
  documento_gerado:      'Gerado pelo sistema',
  documento_importado:   'Importado',
  nova_versao_gerada:    'Nova versão gerada',
  versao_substituida:    'Versão substituída',
  documento_visualizado: 'Visualizado pelo colaborador',
  documento_arquivado:   'Arquivado',
  documento_reativado:   'Reativado',
  status_alterado:       'Status alterado',
  documento_excluido:    'Excluído',
};

export async function historicoDoDocumento(documentoId, { limite = 50 } = {}) {
  const { data, error } = await sb
    .from('documento_auditoria')
    .select('*')
    .eq('documento_id', documentoId)
    .order('criado_em', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data || [];
}

// ───────────────────────────────────────────────────────────
export function traduzirErroDocumento(msg) {
  const m = String(msg || '').toLowerCase();
  if (m.includes('bucket not found')) {
    return 'O repositório de documentos ainda não existe — rode db/colaborador_documentos.sql.';
  }
  if (m.includes('relation') && m.includes('colaborador_documentos')) {
    return 'A tabela de documentos ainda não existe — rode db/colaborador_documentos.sql.';
  }
  if (m.includes('documento_sem_dono')) return 'Documento sem colaborador definido.';
  if (m.includes('documento_sem_competencia')) return 'Documento sem competência definida.';
  if (m.includes('documento_sem_tipo')) return 'Documento sem tipo definido.';
  if (m.includes('documento_tipo_nao_aceito')) return 'Formato não aceito. Envie PDF ou HTML.';
  if (m.includes('documento_grande_demais')) return 'Arquivo grande demais (máximo 15 MB).';
  if (m.includes('uniq_cd_atual')) return 'Já existe uma versão atual deste documento.';
  if (m.includes('pendencia_nao_encontrada')) return 'Esta pendência já foi resolvida por outra aba.';
  if (m.includes('colaborador_invalido')) return 'Colaborador não encontrado na sua equipe.';
  if (m.includes('relation') && m.includes('documentos_pendentes')) {
    return 'A fila de pendências ainda não existe — rode db/documentos_etapa2.sql.';
  }
  if (m.includes('row-level security') || m.includes('violates')) {
    return 'Sem permissão para este documento.';
  }
  return msg || 'Não consegui guardar o documento.';
}
