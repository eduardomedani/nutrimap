// ═══════════════════════════════════════════════════════════
// DOCUMENTOS DO PACIENTE — dados
// ═══════════════════════════════════════════════════════════
// Exame, laudo, receita, atestado: o que o profissional guarda no prontuário e
// decide, um a um, se o paciente pode ver.
//
// O QUE ESTE MÓDULO GARANTE:
//   . nada nasce visível. `visivel_paciente` é false no banco e não é
//     parâmetro de criar() — disponibilizar é ato separado e explícito;
//   . nenhum arquivo fica órfão: se a linha falhar depois do upload, o objeto
//     é removido; se o upload falhar, nenhuma linha existe;
//   . o paciente nunca recebe UPDATE — a única escrita dele é a RPC de
//     visualização, que mexe em três campos e só na linha dele;
//   . nada devolve URL pública, e nenhuma assinada é guardada.
//
// TRÊS CONCEITOS SEPARADOS, e é de propósito:
//   status            — ciclo de vida do ARQUIVO   (ativo / arquivado)
//   visivel_paciente  — PERMISSÃO                  (privado / disponível)
//   visualizado_*     — LEITURA                    (novo / visto)
// Um documento ativo, privado e não lido é estado legítimo. Juntar os três num
// campo só esconderia justamente ele.

import { sb } from './supabase.js';
import {
  BUCKET, TAMANHO_MAXIMO, MIMES_ACEITOS, EXPIRACAO_PADRAO,
  validarArquivo, caminhoDoDocumento, anoDoDocumento, nomeSeguro,
  subirArquivo, removerArquivo, urlAssinada,
} from './paciente-documentos-storage.js';

export { BUCKET, TAMANHO_MAXIMO, MIMES_ACEITOS, urlAssinada };

const TABELA = 'paciente_documentos';

/** Espelho do CHECK `pd_tipo_check`. Acrescentar tipo é editar os dois. */
export const TIPOS = {
  exame:      { rotulo: 'Exame',      icone: 'flask-conical' },
  laudo:      { rotulo: 'Laudo',      icone: 'file-search' },
  relatorio:  { rotulo: 'Relatório',  icone: 'file-chart-column' },
  orientacao: { rotulo: 'Orientação', icone: 'file-pen' },
  prescricao: { rotulo: 'Prescrição', icone: 'clipboard-list' },
  receita:    { rotulo: 'Receita',    icone: 'pill' },
  avaliacao:  { rotulo: 'Avaliação',  icone: 'ruler' },
  termo:      { rotulo: 'Termo',      icone: 'file-signature' },
  declaracao: { rotulo: 'Declaração', icone: 'file-badge' },
  atestado:   { rotulo: 'Atestado',   icone: 'file-check' },
  outro:      { rotulo: 'Outro',      icone: 'file' },
};

/** Ciclo de vida do arquivo — e só ele. */
export const STATUS = { ativo: 'Ativo', arquivado: 'Arquivado' };

export const ORIGENS = {
  upload_profissional: 'Enviado pelo profissional',
  gerado_sistema:      'Gerado pelo Evollo',
};

const agora = () => new Date().toISOString();

// ───────────────────────────────────────────────────────────
// LEITURA (painel do profissional)
// ───────────────────────────────────────────────────────────

/**
 * A lista da ficha. Os filtros são os do painel; o RLS já garante que só vêm
 * documentos deste profissional, então nada aqui filtra por nutri_id — fazer
 * isso no cliente daria a impressão de que é o filtro que protege.
 */
export async function listarDocumentos({
  pacienteId, tipo = null, ano = null, visibilidade = null,
  incluirArquivados = false, busca = null, limite = 200,
} = {}) {
  if (!pacienteId) throw new Error('documento_sem_paciente');

  let q = sb.from(TABELA).select('*').eq('paciente_id', pacienteId);

  if (!incluirArquivados) q = q.is('arquivado_em', null);
  if (tipo) q = q.eq('tipo', tipo);

  if (visibilidade === 'privado')     q = q.eq('visivel_paciente', false);
  if (visibilidade === 'disponivel')  q = q.eq('visivel_paciente', true);
  if (visibilidade === 'nao_lido')    q = q.eq('visivel_paciente', true).eq('visualizado_pelo_paciente', false);
  if (visibilidade === 'arquivado')   q = q.not('arquivado_em', 'is', null);

  if (ano) q = q.gte('data_documento', `${ano}-01-01`).lte('data_documento', `${ano}-12-31`);

  // Título, descrição, nome do arquivo e tipo (item 36). Conteúdo do PDF não —
  // exigiria indexação de texto, que não é desta etapa.
  if (busca) {
    const t = String(busca).replace(/[%,()]/g, ' ').trim();
    if (t) q = q.or(`titulo.ilike.%${t}%,descricao.ilike.%${t}%,nome_arquivo.ilike.%${t}%,tipo.ilike.%${t}%`);
  }

  const { data, error } = await q
    .order('data_documento', { ascending: false, nullsFirst: false })
    .order('criado_em', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data || [];
}

/**
 * A lista da CENTRAL — documentos de todos os pacientes da carteira.
 *
 * Sem `paciente_id`: quem limita o alcance é o RLS (`nutri_id = auth.uid()`),
 * não um filtro daqui. O nome do paciente vem junto porque numa lista
 * transversal ele é a primeira coisa que identifica a linha — sem ele,
 * "Exames laboratoriais" aparece cinco vezes e nenhuma diz de quem é.
 */
export async function listarTodosDocumentos({
  pacienteId = null, tipo = null, ano = null, visibilidade = null,
  incluirArquivados = false, busca = null, limite = 300,
} = {}) {
  let q = sb.from(TABELA).select('*, paciente:pacientes ( id, nome )');

  if (pacienteId) q = q.eq('paciente_id', pacienteId);
  if (!incluirArquivados) q = q.is('arquivado_em', null);
  if (tipo) q = q.eq('tipo', tipo);

  if (visibilidade === 'privado')    q = q.eq('visivel_paciente', false);
  if (visibilidade === 'disponivel') q = q.eq('visivel_paciente', true);
  if (visibilidade === 'nao_lido')   q = q.eq('visivel_paciente', true).eq('visualizado_pelo_paciente', false);
  if (visibilidade === 'arquivado')  q = q.not('arquivado_em', 'is', null);

  if (ano) q = q.gte('data_documento', `${ano}-01-01`).lte('data_documento', `${ano}-12-31`);

  if (busca) {
    const t = String(busca).replace(/[%,()]/g, ' ').trim();
    if (t) q = q.or(`titulo.ilike.%${t}%,descricao.ilike.%${t}%,nome_arquivo.ilike.%${t}%,tipo.ilike.%${t}%`);
  }

  const { data, error } = await q
    .order('criado_em', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data || [];
}

/** Contadores dos filtros e do indicador do Saúde 360°. */
export async function resumoDoPaciente(pacienteId) {
  const todos = await listarDocumentos({ pacienteId, incluirArquivados: true, limite: 500 });
  const vivos = todos.filter(d => !d.arquivado_em);
  return {
    total:          vivos.length,
    privados:       vivos.filter(d => !d.visivel_paciente).length,
    disponiveis:    vivos.filter(d => d.visivel_paciente).length,
    naoLidos:       vivos.filter(d => d.visivel_paciente && !d.visualizado_pelo_paciente).length,
    arquivados:     todos.filter(d => d.arquivado_em).length,
    ultimo:         vivos[0] || null,
  };
}

export async function historicoDoDocumento(documentoId, { limite = 50 } = {}) {
  const { data, error } = await sb
    .from('paciente_documento_auditoria')
    .select('*')
    .eq('documento_id', documentoId)
    .order('criado_em', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data || [];
}

// ───────────────────────────────────────────────────────────
// CRIAR — o fluxo com compensação
// ───────────────────────────────────────────────────────────

/**
 * Upload + registro, nesta ordem e com desfazer.
 *
 * A ORDEM IMPORTA:
 *   1. o id sai daqui, não do banco. É o que permite montar o caminho
 *      definitivo antes de existir linha — e nenhuma linha existir até o
 *      arquivo estar no lugar;
 *   2. valida o CONTEÚDO antes de gastar rede;
 *   3. sobe o arquivo;
 *   4. grava a linha. Se falhar, o objeto que acabou de subir é removido.
 *
 * O caso que sobra é a remoção também falhar — rede caiu entre um passo e
 * outro. Aí não há linha, e o arquivo fica no bucket sem registro: é o que
 * db/conferencia/61 compara. Preferi isso a criar linha "processando", que
 * seria um documento visível na lista apontando para nada.
 *
 * NÃO recebe `visivel_paciente`. Documento nasce privado, sempre. Publicar é
 * disponibilizar(), que é outra chamada e outra confirmação na tela.
 */
export async function criarDocumento({
  nutriId, pacienteId, arquivo,
  titulo, tipo = 'outro', descricao = null, dataDocumento = null,
  origem = 'upload_profissional', metadata = {},
}) {
  if (!nutriId || !pacienteId) throw new Error('documento_sem_dono');
  if (!titulo || !String(titulo).trim()) throw new Error('documento_sem_titulo');
  if (!TIPOS[tipo]) throw new Error('documento_tipo_invalido');

  const { mimeType, tamanho, suspeito } = await validarArquivo(arquivo);

  const documentoId = crypto.randomUUID();
  const nomeOriginal = String(arquivo.name || 'documento');
  const caminho = caminhoDoDocumento({
    nutriId, pacienteId, documentoId,
    ano: anoDoDocumento(dataDocumento),
    arquivo: nomeOriginal,
  });

  await subirArquivo(caminho, arquivo, mimeType);

  try {
    const { data, error } = await sb.from(TABELA).insert({
      id: documentoId,
      nutri_id: nutriId,
      paciente_id: pacienteId,
      titulo: String(titulo).trim(),
      descricao,
      tipo,
      // O nome ORIGINAL, com acento e espaço. O saneado é o do Storage.
      nome_arquivo: nomeOriginal,
      caminho_storage: caminho,
      mime_type: mimeType,
      tamanho_bytes: tamanho,
      data_documento: dataDocumento,
      origem,
      status: 'ativo',
      visivel_paciente: false,
      versao: 1,
      metadata: {
        ...metadata,
        // Fica registrado quando o arquivo alegou ser uma coisa e era outra.
        ...(suspeito ? { mime_declarado_divergente: true } : {}),
      },
    }).select().single();
    if (error) throw error;
    return data;
  } catch (e) {
    // Compensação: a linha não existe, então o arquivo não pode existir.
    const limpou = await removerArquivo(caminho);
    if (!limpou) e.arquivoOrfao = caminho;
    throw e;
  }
}

/**
 * Substituir o arquivo NÃO sobrescreve (item 18): cria uma linha nova, versão
 * seguinte, apontando para a anterior — que é arquivada, não apagada. O
 * paciente pode já ter aberto e baixado aquela.
 *
 * A anterior só sai de cena depois de a nova existir. Ordem inversa deixaria o
 * documento sem versão corrente se a criação falhasse no meio.
 */
export async function substituirArquivo(documentoAtual, arquivo) {
  if (!documentoAtual?.id) throw new Error('documento_sem_id');

  const novo = await criarDocumento({
    nutriId: documentoAtual.nutri_id,
    pacienteId: documentoAtual.paciente_id,
    arquivo,
    titulo: documentoAtual.titulo,
    tipo: documentoAtual.tipo,
    descricao: documentoAtual.descricao,
    dataDocumento: documentoAtual.data_documento,
    origem: documentoAtual.origem,
    metadata: documentoAtual.metadata || {},
  });

  const { data, error } = await sb.from(TABELA).update({
    versao: (documentoAtual.versao || 1) + 1,
    substitui_documento_id: documentoAtual.id,
  }).eq('id', novo.id).select().single();
  if (error) throw error;

  // A anterior sai do app e da lista, mas continua existindo e auditável.
  await arquivarDocumento(documentoAtual.id);

  return data;
}

// ───────────────────────────────────────────────────────────
// VISIBILIDADE
// ───────────────────────────────────────────────────────────

/**
 * O ato explícito. `disponibilizado_em` só é carimbado na PRIMEIRA vez: se um
 * documento for removido do app e devolvido depois, a data original é a que
 * responde desde quando o paciente teve acesso.
 *
 * A notificação (interna e push) é da Etapa 4 e o gancho é este ponto — não o
 * upload. Documento privado não avisa ninguém.
 */
export async function disponibilizar(documentoId, { disponibilizadoEm = null } = {}) {
  const { data, error } = await sb.from(TABELA).update({
    visivel_paciente: true,
    disponibilizado_em: disponibilizadoEm || agora(),
  })
    .eq('id', documentoId)
    // A TRANSIÇÃO, não o estado. `eq(false)` faz o banco decidir quem venceu:
    // o segundo clique (ou a segunda aba) não casa com nenhuma linha e volta
    // vazio, então não há segunda notificação, segundo push nem segundo evento
    // na timeline. Idempotência no lugar certo — o botão desabilitado protege
    // um clique de um dedo, não duas abas.
    .eq('visivel_paciente', false)
    .is('arquivado_em', null)     // arquivado não volta ao app por este caminho
    .select().maybeSingle();
  if (error) throw error;
  // null = já estava disponível (ou está arquivado). Quem chamou decide se
  // isso é sucesso silencioso ou erro — para o orquestrador, é "nada mudou".
  return data || null;
}

/**
 * Tira do app e não apaga nada: nem arquivo, nem histórico, nem
 * `disponibilizado_em` — a data fica, porque o paciente realmente teve acesso
 * e a auditoria precisa poder dizer entre quando e quando.
 */
export async function removerDoApp(documentoId) {
  const { data, error } = await sb.from(TABELA).update({
    visivel_paciente: false,
  }).eq('id', documentoId).select().single();
  if (error) throw error;
  return data;
}

// ───────────────────────────────────────────────────────────
// CICLO DE VIDA
// ───────────────────────────────────────────────────────────

/** Arquivar preserva o arquivo e tira do app — o CHECK do banco exige as duas. */
export async function arquivarDocumento(documentoId) {
  const { data, error } = await sb.from(TABELA).update({
    status: 'arquivado',
    arquivado_em: agora(),
    visivel_paciente: false,
  }).eq('id', documentoId).select().single();
  if (error) throw error;
  return data;
}

export async function reativarDocumento(documentoId) {
  const { data, error } = await sb.from(TABELA).update({
    status: 'ativo',
    arquivado_em: null,
  }).eq('id', documentoId).select().single();
  if (error) throw error;
  return data;
}

export async function editarInformacoes(documentoId, { titulo, descricao, tipo, dataDocumento }) {
  if (tipo && !TIPOS[tipo]) throw new Error('documento_tipo_invalido');
  const patch = {};
  if (titulo !== undefined)        patch.titulo = String(titulo).trim();
  if (descricao !== undefined)     patch.descricao = descricao;
  if (tipo !== undefined)          patch.tipo = tipo;
  if (dataDocumento !== undefined) patch.data_documento = dataDocumento;
  // Arquivo não entra aqui: trocá-lo é substituirArquivo(), que versiona.

  const { data, error } = await sb.from(TABELA).update(patch)
    .eq('id', documentoId).select().single();
  if (error) throw error;
  return data;
}

/**
 * Exclusão definitiva. A UI é da Etapa 2 — o serviço existe agora porque a
 * ORDEM é o que impede órfão, e essa decisão é de infraestrutura.
 *
 * Registro primeiro, arquivo depois: o gatilho de auditoria roda no delete e
 * grava o caminho antes de a linha sumir. Se a remoção do objeto falhar, o
 * caminho está no log — dá para limpar depois. Fosse ao contrário, uma falha
 * no delete deixaria linha viva apontando para arquivo que não existe mais, e
 * o paciente veria um documento que não abre.
 */
export async function excluirDocumento(documentoId, { caminhoStorage = null } = {}) {
  let caminho = caminhoStorage;
  if (!caminho) {
    const { data } = await sb.from(TABELA).select('caminho_storage').eq('id', documentoId).single();
    caminho = data?.caminho_storage || null;
  }

  const { error } = await sb.from(TABELA).delete().eq('id', documentoId);
  if (error) throw error;

  const removeu = await removerArquivo(caminho);
  return { excluido: true, arquivoRemovido: removeu, caminho };
}

// ───────────────────────────────────────────────────────────
// PWA DO PACIENTE
// ───────────────────────────────────────────────────────────

/**
 * A lista do app. Sem filtro de paciente_id: quem filtra é o RLS, pelo
 * `paciente_do_auth()` da sessão. Mandar o id daqui daria a impressão de que
 * trocá-lo mudaria o resultado — e a tela não é o que protege.
 */
export async function meusDocumentos({ limite = 100 } = {}) {
  const { data, error } = await sb.from(TABELA)
    .select('id, titulo, descricao, tipo, nome_arquivo, caminho_storage, mime_type, ' +
            'tamanho_bytes, data_documento, disponibilizado_em, ' +
            'visualizado_pelo_paciente, visualizado_em')
    .order('disponibilizado_em', { ascending: false, nullsFirst: false })
    .limit(limite);
  if (error) throw error;
  return data || [];
}

/**
 * A ÚNICA escrita do paciente, e ela passa por RPC. Sem UPDATE genérico: com
 * ele, o paciente teria como mexer em visivel_paciente e se autopublicar um
 * documento privado.
 */
export async function marcarVisualizado(documentoId) {
  const { data, error } = await sb.rpc('marcar_documento_paciente_visualizado', {
    p_documento: documentoId,
  });
  if (error) throw error;
  return data === true;
}

/** Documento disponível que o paciente ainda não abriu — o badge "Novo". */
export const ehNovo = (doc) => Boolean(doc) && !doc.visualizado_pelo_paciente;

// ───────────────────────────────────────────────────────────
// APRESENTAÇÃO
// ───────────────────────────────────────────────────────────

export function formatarTamanho(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** O que a tela oferece, a partir do mime — nenhuma tela pergunta "é PDF?". */
export function formatoDoDocumento(doc) {
  const mime = String(doc?.mime_type || '').toLowerCase();
  if (mime.startsWith('image/')) {
    return { formato: 'imagem', rotuloAbrir: 'Ver imagem', ehImagem: true, podeBaixar: true };
  }
  return { formato: 'pdf', rotuloAbrir: 'Visualizar', ehImagem: false, podeBaixar: true };
}

/** Erro do Supabase não é frase de gente. */
export function traduzirErroDocumento(msg) {
  const m = String(msg || '').toLowerCase();
  if (m.includes('documento_sem_arquivo'))      return 'Escolha um arquivo para enviar.';
  if (m.includes('documento_vazio'))            return 'O arquivo está vazio.';
  if (m.includes('documento_grande_demais'))    return 'O arquivo passa de 15 MB. Envie um menor.';
  if (m.includes('documento_tipo_nao_aceito'))  return 'Formato não aceito. Envie PDF, JPG ou PNG.';
  if (m.includes('documento_tipo_invalido'))    return 'Escolha um tipo de documento válido.';
  if (m.includes('documento_sem_titulo'))       return 'Dê um título ao documento.';
  if (m.includes('documento_sem_paciente') ||
      m.includes('documento_sem_dono'))         return 'Documento sem paciente. Recarregue a página.';
  if (m.includes('bucket not found'))           return 'Storage não configurado. Rode db/paciente_documentos.sql.';
  if (m.includes('mime type') ||
      m.includes('payload too large'))          return 'O arquivo foi recusado pelo servidor: formato ou tamanho.';
  if (m.includes('row-level security') ||
      m.includes('violates row-level'))         return 'Sem permissão para este documento.';
  if (m.includes('duplicate key'))              return 'Este arquivo já foi enviado.';
  if (m.includes('failed to fetch') ||
      m.includes('networkerror'))               return 'Sem conexão. Tente novamente.';
  return 'Não foi possível concluir. Tente novamente.';
}

export { EXPIRACAO_PADRAO, nomeSeguro, caminhoDoDocumento, anoDoDocumento };
