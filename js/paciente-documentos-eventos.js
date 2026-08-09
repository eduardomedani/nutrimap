// ═══════════════════════════════════════════════════════════
// DOCUMENTOS DO PACIENTE — o orquestrador das integrações
// ═══════════════════════════════════════════════════════════
// PONTO ÚNICO de "disponibilizar um documento ao paciente". A tela chama uma
// função; nenhuma integração fica pendurada numa sequência de cliques.
//
// O EVENTO QUE DISPARA TUDO É A TRANSIÇÃO privado → disponível. Não é o upload:
// documento no prontuário não avisa ninguém. E não é "estar disponível": editar
// o título de um documento já compartilhado não é novidade nenhuma para quem
// já foi avisado.
//
// QUEM GARANTE QUE A TRANSIÇÃO ACONTECEU UMA VEZ SÓ é o banco, não este
// arquivo. `disponibilizar()` só casa com linhas em `visivel_paciente = false`;
// o segundo clique, ou a segunda aba, volta vazio e este módulo simplesmente
// não faz nada. Ver o comentário em paciente-documentos.js.
//
// O PUSH NÃO SAI DAQUI. No Evollo, push é disparado por Database Webhook →
// supabase/functions/enviar-push, exatamente como no treino. Um `invoke()`
// neste ponto criaria um segundo caminho de envio e faria o profissional
// esperar a resposta de uma notificação que não é problema dele.

import { sb } from './supabase.js';
import {
  disponibilizar, removerDoApp, arquivarDocumento, TIPOS,
} from './paciente-documentos.js';
import { registrarEvento } from './timeline.js';

const AUDITORIA = 'paciente_documento_auditoria';
const AVISOS = 'paciente_notificacoes';

/** A rota do PWA, não uma URL. Assinatura em banco viraria link permanente. */
export const ROTA_DOCUMENTOS = 'documentos';

/**
 * O texto do aviso INTERNO — mais específico que o push de propósito.
 *
 * Aqui o paciente já está autenticado dentro do app, então o título do
 * documento pode aparecer. Na tela bloqueada, não: ver o corpo neutro em
 * supabase/functions/enviar-push.
 */
export function textoDoAviso(doc) {
  return {
    titulo: 'Novo documento disponível',
    corpo: `Seu profissional compartilhou “${doc?.titulo || 'um documento'}”.`,
  };
}

/**
 * A chave que impede duplicidade em cascata.
 *
 * Carrega o INSTANTE da disponibilização: dois cliques não passam da primeira
 * (o banco já barrou), e redisponibilizar depois de remover gera chave nova —
 * que é o que o briefing pede, porque é novidade de verdade.
 */
export const chaveDaDisponibilizacao = (doc) =>
  `documento_disponibilizado:${doc.id}:${doc.disponibilizado_em}`;

// ───────────────────────────────────────────────────────────
// AUDITORIA
// ───────────────────────────────────────────────────────────

/**
 * Registro de integração no log que já existe. O gatilho do banco cobre o que
 * acontece NA TABELA (disponibilizado, removido, visualizado); estas linhas
 * cobrem o que acontece FORA dela — aviso criado, push enviado, push falhou.
 *
 * Nunca lança: auditoria que derruba a operação que ela só observa é pior que
 * auditoria faltando.
 */
export async function auditar(doc, acao, metadata = {}) {
  try {
    await sb.from(AUDITORIA).insert({
      nutri_id: doc.nutri_id,
      documento_id: doc.id,
      paciente_id: doc.paciente_id,
      acao,
      metadata,
    });
    return true;
  } catch (e) {
    console.error('[documentos] auditoria', acao, e?.message || e);
    return false;
  }
}

// ───────────────────────────────────────────────────────────
// O ORQUESTRADOR
// ───────────────────────────────────────────────────────────

/**
 * Disponibiliza o documento e dispara as integrações.
 *
 * Ordem, e o porquê de cada posição:
 *   1. a transição no banco — se não mudou nada, nada mais acontece;
 *   2. o aviso interno, que é o que o paciente vê mesmo sem push;
 *   3. a timeline, que é o registro do profissional;
 *   4. a auditoria da integração.
 * O push não está na lista: quem o dispara é o webhook do passo 1.
 *
 * NENHUMA das etapas 2–4 pode desfazer a 1. O documento ficou disponível; um
 * aviso que não gravou não torna isso menos verdade, e reverter deixaria o
 * paciente sem o exame por causa de um problema que não é dele.
 *
 * @returns {{disponibilizado:boolean, documento:object|null, avisou:boolean, timeline:boolean}}
 */
export async function disponibilizarDocumentoAoPaciente(documentoId) {
  const doc = await disponibilizar(documentoId);

  // Já estava disponível, ou está arquivado: nada mudou, nada a anunciar.
  if (!doc) return { disponibilizado: false, documento: null, avisou: false, timeline: false };

  const chave = chaveDaDisponibilizacao(doc);
  const [avisou, timeline] = await Promise.all([
    criarAviso(doc, chave),
    registrarNaTimeline(doc, chave),
  ]);

  await auditar(doc, 'notificacao_criada', { chave_dedup: chave, entregue: avisou });

  return { disponibilizado: true, documento: doc, avisou, timeline };
}

/** O aviso interno. `on conflict do nothing` pela chave — igual à timeline. */
async function criarAviso(doc, chave) {
  try {
    const t = textoDoAviso(doc);
    const { error } = await sb.from(AVISOS).upsert({
      nutri_id: doc.nutri_id,
      paciente_id: doc.paciente_id,
      tipo: 'documento',
      referencia_id: doc.id,
      titulo: t.titulo,
      corpo: t.corpo,
      acao: ROTA_DOCUMENTOS,
      chave_dedup: chave,
    }, { onConflict: 'chave_dedup', ignoreDuplicates: true });
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('[documentos] aviso interno', e?.message || e);
    return false;
  }
}

/**
 * A timeline do profissional. `registrarEvento` já engole o próprio erro e já
 * deduplica por `chaveDedup` — é o ponto único de escrita em paciente_eventos.
 */
async function registrarNaTimeline(doc, chave) {
  const ev = await registrarEvento({
    pacienteId: doc.paciente_id,
    tipo: 'DOCUMENT_SHARED',
    titulo: doc.titulo,
    descricao: TIPOS[doc.tipo]?.rotulo || null,
    entidadeTipo: 'documento',
    entidadeId: doc.id,
    dataEvento: doc.disponibilizado_em,
    chaveDedup: chave,
    metadata: { tipo: doc.tipo },
  });
  return Boolean(ev);
}

// ───────────────────────────────────────────────────────────
// AS OUTRAS TRANSIÇÕES
// ───────────────────────────────────────────────────────────

/**
 * Remover do app. NÃO apaga o evento da timeline: o documento esteve
 * disponível naquela data, e isso continua verdade. Quem mostra o estado atual
 * é a tela, lendo o documento — o passado não se reescreve para caber no
 * presente.
 */
export async function removerDocumentoDoApp(documentoId) {
  const doc = await removerDoApp(documentoId);
  if (doc) await auditar(doc, 'removido_do_pwa', {});
  return doc;
}

/** Arquivar. Mesmo princípio: histórico intacto, estado atual na tela. */
export async function arquivarDocumentoDoPaciente(documentoId) {
  return arquivarDocumento(documentoId);
}

// ───────────────────────────────────────────────────────────
// O ESTADO ATUAL, PARA A TIMELINE MOSTRAR
// ───────────────────────────────────────────────────────────

/**
 * Evento gerado pelo sistema é IMUTÁVEL — o RLS de paciente_eventos só permite
 * UPDATE onde `gerado_pelo_sistema = false`. Então "visualizado em" não entra
 * no evento: ele é lido do documento na hora de desenhar.
 *
 * É o mesmo caminho que `entidadesExistentes()` já usa para saber se o
 * registro relacionado ainda existe. Resultado: um card por documento, com o
 * histórico congelado e o estado atual ao vivo — que é o que o briefing pede
 * sem pedir dois cards consecutivos.
 *
 * @returns {Map<string, {visualizadoEm, visivel, arquivado, titulo}>}
 */
export async function estadoDosDocumentos(ids = []) {
  const unicos = [...new Set(ids.filter(Boolean))];
  const mapa = new Map();
  if (!unicos.length) return mapa;

  try {
    const { data, error } = await sb
      .from('paciente_documentos')
      .select('id, titulo, visivel_paciente, visualizado_em, arquivado_em')
      .in('id', unicos);
    if (error) throw error;
    for (const d of data || []) {
      mapa.set(d.id, {
        titulo: d.titulo,
        visivel: d.visivel_paciente,
        visualizadoEm: d.visualizado_em,
        arquivado: Boolean(d.arquivado_em),
      });
    }
  } catch (e) {
    // Sem certeza, não afirma nada: o card fica só com o histórico, que é
    // sempre verdadeiro. Inventar "removido" por causa de rede fora seria pior.
    console.error('[documentos] estado para a timeline', e?.message || e);
  }
  return mapa;
}

/**
 * A linha secundária do card. Ordem de precedência: o que mudou por último e
 * mais importa para quem lê.
 */
export function estadoParaTimeline(est) {
  if (!est) return null;
  if (est.arquivado) return { rotulo: 'Documento arquivado', tom: 'neutro', abrePwa: false };
  if (!est.visivel) return { rotulo: 'Disponibilidade removida', tom: 'alerta', abrePwa: false };
  if (est.visualizadoEm) {
    return { rotulo: `Visualizado em ${dataHoraBR(est.visualizadoEm)}`, tom: 'sucesso', abrePwa: true };
  }
  return { rotulo: 'Ainda não visualizado', tom: 'info', abrePwa: true };
}

export function dataHoraBR(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('pt-BR')} às ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ───────────────────────────────────────────────────────────
// INDICADOR DO SAÚDE 360°
// ───────────────────────────────────────────────────────────

/**
 * O que o painel mostra. O número mais útil não é o total — é quantos o
 * paciente ainda não abriu, que é o que o profissional pode fazer alguma coisa
 * a respeito na próxima consulta.
 *
 * Privado NÃO entra em "pendentes de visualização": ninguém está esperando
 * abrir um documento que não foi compartilhado. Arquivado não entra em nada.
 */
export function indicadorDocumentos(docs = []) {
  const vivos = (docs || []).filter(d => !d.arquivado_em);
  const disponiveis = vivos.filter(d => d.visivel_paciente);
  const pendentes = disponiveis.filter(d => !d.visualizado_pelo_paciente);
  const ultimo = [...disponiveis].sort((a, b) =>
    String(b.disponibilizado_em || '').localeCompare(String(a.disponibilizado_em || '')))[0] || null;

  return {
    total: vivos.length,
    privados: vivos.length - disponiveis.length,
    disponiveis: disponiveis.length,
    pendentes: pendentes.length,
    ultimo: ultimo ? {
      titulo: ultimo.titulo,
      data: String(ultimo.disponibilizado_em || '').slice(0, 10),
    } : null,
  };
}
