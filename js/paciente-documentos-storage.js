// ═══════════════════════════════════════════════════════════
// DOCUMENTOS DO PACIENTE — arquivo, validação e caminho
// ═══════════════════════════════════════════════════════════
// O que este módulo faz é só o que envolve o BYTE: conferir o que o arquivo
// realmente é, decidir onde ele mora e subir/remover no Storage privado.
// Quem grava a linha é paciente-documentos.js.
//
// A separação não é cosmética: a compensação de upload (arquivo sobe, banco
// falha, arquivo sai) precisa que remover seja tão barato quanto subir, e sem
// passar por regra de negócio nenhuma.
//
// NADA AQUI DEVOLVE URL PÚBLICA. O bucket é privado; só assinada, com prazo
// curto, gerada na hora e nunca guardada.

import { sb } from './supabase.js';

export const BUCKET = 'paciente-documentos';

/** 15 MB — o mesmo teto do bucket, e do resto do projeto. */
export const TAMANHO_MAXIMO = 15 * 1024 * 1024;

/**
 * O que o bucket aceita. A lista tem que ser a MESMA do
 * `allowed_mime_types` em db/paciente_documentos.sql: divergir aqui só troca
 * um erro claro nosso por um erro cru do Supabase.
 */
export const MIMES_ACEITOS = ['application/pdf', 'image/jpeg', 'image/png'];

export const EXTENSAO_DO_MIME = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

// ───────────────────────────────────────────────────────────
// O QUE O ARQUIVO REALMENTE É
// ───────────────────────────────────────────────────────────

/**
 * Assinaturas de formato (magic numbers). Extensão é sugestão do usuário e
 * `file.type` é sugestão do sistema operacional — os dois se renomeiam. O
 * primeiro byte, não.
 */
const ASSINATURAS = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },              // %PDF-
  { mime: 'image/jpeg',      bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png',       bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

/** Quantos bytes bastam para reconhecer qualquer um dos formatos aceitos. */
export const BYTES_DE_ASSINATURA = 8;

/**
 * Lê a assinatura e devolve o MIME real, ou null se não for nenhum dos
 * aceitos. Recebe bytes, não Blob, para poder ser testado sem I/O.
 */
export function detectarMimeReal(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  for (const a of ASSINATURAS) {
    if (b.length >= a.bytes.length && a.bytes.every((v, i) => b[i] === v)) return a.mime;
  }
  return null;
}

/** Os primeiros bytes do arquivo, para a detecção acima. */
export async function assinaturaDe(blob) {
  const pedaco = blob.slice(0, BYTES_DE_ASSINATURA);
  return new Uint8Array(await pedaco.arrayBuffer());
}

/**
 * A porta de entrada. Recusa antes de gastar upload, e recusa pelo CONTEÚDO —
 * um .exe renomeado para .pdf passa na extensão e morre aqui.
 *
 * Devolve o mime real, que é o que vai para o registro: guardar o `file.type`
 * seria guardar a versão que o arquivo alega ser.
 */
export async function validarArquivo(arquivo) {
  if (!arquivo || typeof arquivo.slice !== 'function') throw new Error('documento_sem_arquivo');
  if (arquivo.size === 0) throw new Error('documento_vazio');
  if (arquivo.size > TAMANHO_MAXIMO) throw new Error('documento_grande_demais');

  const mimeReal = detectarMimeReal(await assinaturaDe(arquivo));
  if (!mimeReal) throw new Error('documento_tipo_nao_aceito');
  if (!MIMES_ACEITOS.includes(mimeReal)) throw new Error('documento_tipo_nao_aceito');

  // O que o arquivo diz ser x o que ele é. Divergir não é erro do usuário —
  // navegador manda 'image/jpg', sistema manda vazio —, então o real vence em
  // silêncio. O que não pode é o declarado vencer.
  const declarado = String(arquivo.type || '').toLowerCase();
  const suspeito = Boolean(declarado) && declarado !== mimeReal;

  return { mimeType: mimeReal, tamanho: arquivo.size, declarado, suspeito };
}

// ───────────────────────────────────────────────────────────
// NOME E CAMINHO
// ───────────────────────────────────────────────────────────

/**
 * Sem acento, sem espaço e sem barra — barra criaria pasta e desalinharia o
 * caminho, que é o que as policies do Storage leem para decidir acesso.
 *
 * Mesmo saneamento de js/documentos.js. Não importado de lá de propósito: são
 * módulos de domínios diferentes, e o do colaborador não deve virar
 * dependência do prontuário só por causa de uma função de string.
 */
export function nomeSeguro(nome, extensaoPadrao = '') {
  const limpo = String(nome || '')
    .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(-90);
  if (limpo) return limpo;
  return extensaoPadrao ? `documento${extensaoPadrao}` : 'documento';
}

/**
 * {nutri}/{paciente}/{AAAA}/{documento}/{arquivo}
 *
 * A pasta 1 é o que a policy do nutri confere; a 2, o que a policy do paciente
 * confere. A 4 é o id do documento: sem ela, substituir arquivo gravaria por
 * cima do anterior no mesmo lugar e a linha antiga passaria a apontar para
 * conteúdo novo.
 *
 * O ANO vem de data_documento quando existe, não do relógio: exame de março
 * enviado em agosto pertence a 2026/, não à pasta do mês do upload.
 */
export function caminhoDoDocumento({ nutriId, pacienteId, documentoId, ano, arquivo }) {
  if (!nutriId || !pacienteId) throw new Error('documento_sem_dono');
  if (!documentoId) throw new Error('documento_sem_id');
  const a = String(ano || '');
  if (!/^\d{4}$/.test(a)) throw new Error('documento_sem_ano');
  return `${nutriId}/${pacienteId}/${a}/${documentoId}/${nomeSeguro(arquivo)}`;
}

/** O ano da pasta: o do documento, com o de hoje como último recurso. */
export function anoDoDocumento(dataDocumento, hoje = new Date()) {
  const d = String(dataDocumento || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 4);
  return String(hoje.getFullYear());
}

// ───────────────────────────────────────────────────────────
// STORAGE
// ───────────────────────────────────────────────────────────

/**
 * Sobe o arquivo. `upsert: false` de propósito: o caminho carrega o id do
 * documento, então colisão significa que alguma coisa está errada — e
 * sobrescrever calado seria destruir o arquivo de outro registro.
 */
export async function subirArquivo(caminho, arquivo, mimeType) {
  const { error } = await sb.storage.from(BUCKET).upload(caminho, arquivo, {
    upsert: false,
    contentType: mimeType,
  });
  if (error) throw error;
  return caminho;
}

/**
 * Remove o objeto. Usada na compensação, e por isso NÃO lança: se a limpeza
 * falhar, quem chamou já está tratando o erro que a provocou — deixar um
 * segundo erro por cima esconderia o primeiro, que é o que importa.
 *
 * Devolve se conseguiu, para o chamador poder registrar o arquivo que ficou.
 */
export async function removerArquivo(caminho) {
  if (!caminho) return false;
  try {
    const { error } = await sb.storage.from(BUCKET).remove([caminho]);
    return !error;
  } catch (e) {
    return false;
  }
}

/**
 * URL temporária para abrir o documento. O bucket é privado — esta é a única
 * forma de chegar ao arquivo.
 *
 * NUNCA guardar o retorno. A assinatura não consulta RLS depois de emitida:
 * uma URL salva em banco continuaria abrindo um documento já removido do app,
 * pelo tempo que faltasse para expirar. É por isso que o prazo é curto.
 */
export const EXPIRACAO_PADRAO = 10 * 60;   // 10 minutos

export async function urlAssinada(caminho, segundos = EXPIRACAO_PADRAO) {
  if (!caminho) throw new Error('documento_sem_caminho');
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(caminho, segundos);
  if (error) throw error;
  return data?.signedUrl || null;
}
