// ═══════════════════════════════════════════════════════════
// CHECK-INS — camada de dados
// ═══════════════════════════════════════════════════════════
// Só o serviço. Nenhuma tela nesta etapa: painel, PWA, Timeline, Saúde 360°,
// alertas e push são etapas seguintes.
//
// O QUE ESTE MÓDULO GARANTE:
//   . o paciente NUNCA escreve direto — a única escrita dele é a RPC
//     `finalizar_checkin`, que valida contra o snapshot dentro da transação;
//   . materializar é idempotente: mesma atribuição e mesmo período devolvem a
//     MESMA ocorrência, e isso é garantia do banco, não deste arquivo;
//   . pergunta não se apaga, se desativa — a resposta aponta para ela por FK
//     RESTRICT, e a identidade longitudinal depende disso.

import { sb } from './supabase.js';
import { validarConfiguracao, validarAtribuicao, calcularProximaOcorrencia } from './checkin.js';

const agora = () => new Date().toISOString();

// ───────────────────────────────────────────────────────────
// MODELOS
// ───────────────────────────────────────────────────────────

export async function listarModelos({ incluirArquivados = false } = {}) {
  let q = sb.from('checkin_modelos').select('*');
  if (!incluirArquivados) q = q.eq('status', 'ativo');
  const { data, error } = await q.order('criado_em', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function criarModelo({ nome, descricao = null, frequenciaPadrao = 'semanal' }) {
  if (!String(nome || '').trim()) throw new Error('checkin_modelo_sem_nome');
  const { data, error } = await sb.from('checkin_modelos').insert({
    nome: String(nome).trim(), descricao, frequencia_padrao: frequenciaPadrao,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function editarModelo(id, patch = {}) {
  const { data, error } = await sb.from('checkin_modelos')
    .update(patch).eq('id', id).select().maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Arquivar NÃO apaga nada: perguntas, atribuições, ocorrências e respostas
 * ficam. O que muda é que `materializar_ocorrencia_checkin` passa a recusar —
 * a regra mora lá, no banco, e não numa checagem de tela.
 */
export async function arquivarModelo(id) {
  return editarModelo(id, { status: 'arquivado' });
}
export async function reativarModelo(id) {
  return editarModelo(id, { status: 'ativo' });
}

// ───────────────────────────────────────────────────────────
// PERGUNTAS
// ───────────────────────────────────────────────────────────

export async function listarPerguntas(modeloId, { incluirInativas = false } = {}) {
  let q = sb.from('checkin_perguntas').select('*').eq('modelo_id', modeloId);
  if (!incluirInativas) q = q.eq('ativo', true);
  const { data, error } = await q.order('ordem').order('criado_em');
  if (error) throw error;
  return data || [];
}

export async function criarPergunta({
  modeloId, texto, tipo, obrigatoria = false, ordem = 0, unidade = null, configuracao = {},
}) {
  if (!String(texto || '').trim()) throw new Error('checkin_pergunta_sem_texto');
  const v = validarConfiguracao(tipo, configuracao);
  if (!v.ok) throw new Error(`checkin_configuracao_invalida: ${v.erros.join(' ')}`);

  const { data, error } = await sb.from('checkin_perguntas').insert({
    modelo_id: modeloId, texto: String(texto).trim(), tipo,
    obrigatoria, ordem, unidade, configuracao,
  }).select().single();
  if (error) throw error;
  return data;
}

/**
 * Editar pergunta mantém o `id` — e é aí que mora a regra conceitual.
 *
 * `pergunta_id` representa uma VARIÁVEL LONGITUDINAL. Ajustar a redação sem
 * mudar o que se mede ("Como está sua fome?" → "Como você avalia sua fome?")
 * pode manter o id. Mudar o SIGNIFICADO ("...sua fome à noite") deve gerar
 * pergunta NOVA — senão duas medidas diferentes viram uma série só, e o
 * gráfico passa a comparar coisas que não se comparam.
 *
 * O snapshot garante a leitura histórica de qualquer forma; o que se perde ao
 * reaproveitar o id indevidamente é a comparabilidade, não o registro.
 */
export async function editarPergunta(id, patch = {}) {
  if (patch.tipo || patch.configuracao) {
    const atual = await buscarPergunta(id);
    const tipo = patch.tipo || atual?.tipo;
    const cfg = patch.configuracao || atual?.configuracao || {};
    const v = validarConfiguracao(tipo, cfg);
    if (!v.ok) throw new Error(`checkin_configuracao_invalida: ${v.erros.join(' ')}`);
  }
  const { data, error } = await sb.from('checkin_perguntas')
    .update(patch).eq('id', id).select().maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function buscarPergunta(id) {
  const { data, error } = await sb.from('checkin_perguntas').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Desativar, não apagar.
 *
 * `checkin_respostas.pergunta_id` tem FK RESTRICT: uma pergunta já respondida
 * NÃO PODE ser apagada, e isso é intencional — a identidade longitudinal
 * depende de ela continuar existindo. Desativar tira de snapshots novos e
 * mantém tudo que já foi respondido comparável.
 *
 * Não existe `excluirPergunta()` neste módulo de propósito.
 */
export async function desativarPergunta(id) {
  const { data, error } = await sb.from('checkin_perguntas')
    .update({ ativo: false }).eq('id', id).select().maybeSingle();
  if (error) throw error;
  return data || null;
}
export async function reativarPergunta(id) {
  const { data, error } = await sb.from('checkin_perguntas')
    .update({ ativo: true }).eq('id', id).select().maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Duplicar pergunta cria um `pergunta_id` NOVO — e é essa a utilidade dela.
 *
 * Quando o profissional quer mudar o SIGNIFICADO ("sua fome" → "sua fome à
 * noite"), duplicar e editar a cópia preserva a série histórica da original,
 * que continua ativa ou é desativada. Editar a original no lugar juntaria duas
 * medidas diferentes numa série só.
 */
export async function duplicarPergunta(id) {
  const p = await buscarPergunta(id);
  if (!p) throw new Error('checkin_pergunta_inexistente');
  return criarPergunta({
    modeloId: p.modelo_id,
    texto: `${p.texto} (cópia)`,
    tipo: p.tipo,
    obrigatoria: p.obrigatoria,
    ordem: (p.ordem ?? 0) + 1,
    unidade: p.unidade,
    configuracao: p.configuracao || {},
  });
}

/** Grava a ordem de uma vez. `ids` na ordem desejada. */
export async function reordenarPerguntas(ids = []) {
  const atualizacoes = ids.map((id, i) =>
    sb.from('checkin_perguntas').update({ ordem: i + 1 }).eq('id', id));
  const rs = await Promise.all(atualizacoes);
  const erro = rs.find(r => r.error);
  if (erro) throw erro.error;
  return ids.length;
}

/** Quantas respostas já existem para esta pergunta — a tela usa para avisar. */
export async function historicoDaPergunta(id) {
  const { count, error } = await sb.from('checkin_respostas')
    .select('id', { count: 'exact', head: true })
    .eq('pergunta_id', id);
  if (error) throw error;
  return count || 0;
}

/**
 * Duplicar o modelo copia MODELO e PERGUNTAS, com ids novos.
 *
 * Não copia atribuição, ocorrência, resposta nem auditoria: aquilo é histórico
 * de pacientes reais, e um modelo novo não herda o passado de outro.
 */
export async function duplicarModelo(id) {
  const { data: orig, error: e1 } = await sb.from('checkin_modelos')
    .select('*').eq('id', id).single();
  if (e1) throw e1;

  const perguntas = await listarPerguntas(id, { incluirInativas: false });
  const novo = await criarModelo({
    nome: `${orig.nome} — cópia`,
    descricao: orig.descricao,
    frequenciaPadrao: orig.frequencia_padrao,
  });

  for (const p of perguntas) {
    await criarPergunta({
      modeloId: novo.id, texto: p.texto, tipo: p.tipo,
      obrigatoria: p.obrigatoria, ordem: p.ordem,
      unidade: p.unidade, configuracao: p.configuracao || {},
    });
  }
  return novo;
}

// ───────────────────────────────────────────────────────────
// ATRIBUIÇÕES
// ───────────────────────────────────────────────────────────

export async function listarAtribuicoes({ pacienteId = null, incluirInativas = false } = {}) {
  let q = sb.from('checkin_atribuicoes')
    .select('*, modelo:checkin_modelos ( id, nome, status ), paciente:pacientes ( id, nome )');
  if (pacienteId) q = q.eq('paciente_id', pacienteId);
  if (!incluirInativas) q = q.eq('ativo', true);
  const { data, error } = await q.order('criado_em', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function criarAtribuicao({
  pacienteId, modeloId, frequencia = 'semanal',
  dataInicio = null, diaSemana = null, diaMes = null,
}) {
  const v = validarAtribuicao({ frequencia, dia_semana: diaSemana, dia_mes: diaMes });
  if (!v.ok) throw new Error(`checkin_atribuicao_invalida: ${v.erros.join(' ')}`);

  const inicio = dataInicio || new Date().toISOString().slice(0, 10);
  const { data, error } = await sb.from('checkin_atribuicoes').insert({
    paciente_id: pacienteId, modelo_id: modeloId, frequencia,
    data_inicio: inicio, dia_semana: diaSemana, dia_mes: diaMes,
    // Informação de agendamento. Nada nesta etapa lê este campo sozinho —
    // quem vai chamar a materialização é a Etapa 2.
    proxima_ocorrencia_em: calcularProximaOcorrencia(
      { frequencia, dia_semana: diaSemana, dia_mes: diaMes }, inicio),
  }).select().single();
  if (error) throw error;
  return data;
}

/**
 * Desativar preserva histórico: ocorrências respondidas ficam, respostas
 * ficam, e a materialização passa a recusar. Ocorrência futura ainda não
 * disponível pode ser cancelada à parte — não há limpeza automática aqui.
 */
export async function desativarAtribuicao(id) {
  const { data, error } = await sb.from('checkin_atribuicoes')
    .update({ ativo: false, proxima_ocorrencia_em: null })
    .eq('id', id).select().maybeSingle();
  if (error) throw error;
  return data || null;
}

// ───────────────────────────────────────────────────────────
// OCORRÊNCIAS
// ───────────────────────────────────────────────────────────

/**
 * Transforma uma atribuição num check-in concreto.
 *
 * Idempotente: chamar duas vezes para o mesmo (atribuição, período) devolve a
 * MESMA ocorrência. Quem garante é o índice único parcial no banco, não este
 * arquivo — duas abas ou um cron reexecutado passariam por qualquer trava que
 * morasse aqui.
 *
 * Uma ocorrência por chamada. Gerar o ano inteiro adiantado faria uma edição
 * de modelo em março reescrever o significado de dezembro.
 */
export async function materializarOcorrencia({ atribuicaoId, periodo, disponivelEm = null, prazoEm = null }) {
  const { data, error } = await sb.rpc('materializar_ocorrencia_checkin', {
    p_atribuicao: atribuicaoId,
    p_periodo: periodo,
    p_disponivel_em: disponivelEm,
    p_prazo_em: prazoEm,
  });
  if (error) throw error;
  return data || null;
}

/** As ocorrências de um paciente, para o painel do profissional. */
export async function listarOcorrencias({ pacienteId, incluirCanceladas = false, limite = 100 } = {}) {
  let q = sb.from('checkin_ocorrencias').select('*').eq('paciente_id', pacienteId);
  if (!incluirCanceladas) q = q.neq('status', 'cancelado');
  const { data, error } = await q.order('disponivel_em', { ascending: false }).limit(limite);
  if (error) throw error;
  return data || [];
}

/**
 * As do paciente logado, para o PWA.
 *
 * Sem filtro de `paciente_id`: quem limita é o RLS, pela sessão. Filtrar aqui
 * daria a impressão de que trocar o id mudaria o resultado.
 */
export async function meusCheckins({ limite = 50 } = {}) {
  const { data, error } = await sb.from('checkin_ocorrencias')
    .select('id, modelo_id, periodo, snapshot, disponivel_em, prazo_em, respondido_em, status')
    .order('disponivel_em', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data || [];
}

export async function respostasDaOcorrencia(ocorrenciaId) {
  const { data, error } = await sb.from('checkin_respostas')
    .select('*').eq('ocorrencia_id', ocorrenciaId).order('criado_em');
  if (error) throw error;
  return data || [];
}

/** Cancelar libera o período para nova materialização (o unique ignora cancelado). */
export async function cancelarOcorrencia(id) {
  const { data, error } = await sb.from('checkin_ocorrencias')
    .update({ status: 'cancelado' })
    .eq('id', id).neq('status', 'respondido')
    .select().maybeSingle();
  if (error) throw error;
  return data || null;
}

// ───────────────────────────────────────────────────────────
// FINALIZAR — a única escrita do paciente
// ───────────────────────────────────────────────────────────

/**
 * `respostas` é `{ "<pergunta_id>": <valor> }`.
 *
 * Toda a validação que IMPORTA acontece no banco, contra o snapshot da própria
 * ocorrência — não contra a pergunta atual, que pode ter mudado depois. E a
 * ocorrência é travada (`for update`) antes de qualquer insert, então duas
 * abas nunca deixam respostas pela metade: a segunda espera, vê o status já
 * mudado e sai por exceção, com a transação inteira desfeita.
 */
export async function finalizarCheckin(ocorrenciaId, respostas) {
  const { data, error } = await sb.rpc('finalizar_checkin', {
    p_ocorrencia: ocorrenciaId,
    p_respostas: respostas,
  });
  if (error) throw error;
  return data || null;
}

// ───────────────────────────────────────────────────────────
// LEITURAS QUE A ETAPA 4 VAI PRECISAR
// ───────────────────────────────────────────────────────────

/**
 * Último e penúltimo respondidos — é o que sustenta comparação no Saúde 360°.
 * Existe agora para a estrutura provar que a consulta é barata; nenhuma tela
 * chama nesta etapa.
 */
export async function ultimosRespondidos(pacienteId, quantos = 2) {
  const { data, error } = await sb.from('checkin_ocorrencias')
    .select('id, modelo_id, periodo, snapshot, respondido_em')
    .eq('paciente_id', pacienteId)
    .eq('status', 'respondido')
    .order('respondido_em', { ascending: false })
    .limit(quantos);
  if (error) throw error;
  return data || [];
}

/** A série de uma pergunta ao longo do tempo — a identidade longitudinal em uso. */
export async function serieDaPergunta(perguntaId, { limite = 24 } = {}) {
  const { data, error } = await sb.from('checkin_respostas')
    .select('valor, tipo, criado_em, ocorrencia:checkin_ocorrencias ( periodo, respondido_em )')
    .eq('pergunta_id', perguntaId)
    .order('criado_em', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data || [];
}

/**
 * O prazo de uma ocorrência: até a PRÓXIMA.
 *
 * `checkin_atribuicoes` não guarda prazo — e não precisa. Um check-in semanal
 * está atrasado quando o da semana seguinte chega; um mensal, quando vira o
 * mês. Derivar da frequência dispensa uma coluna que seria mais um número para
 * manter coerente com a recorrência.
 *
 * Frequência manual não tem prazo: quem gerou decide quando cobrar.
 */
export function prazoDaOcorrencia(atribuicao, periodo) {
  const prox = calcularProximaOcorrencia(atribuicao, periodo);
  if (!prox) return null;
  // Fim do dia anterior à próxima: responder no dia da próxima já é atraso.
  const d = new Date(`${prox}T00:00:00`);
  d.setSeconds(d.getSeconds() - 1);
  return d.toISOString();
}

/** Panorama da aba Visão geral. Uma leitura, contagens derivadas. */
export async function panoramaCheckins() {
  const [{ data: ocs, error: e1 }, { data: mods, error: e2 }, { data: atrs, error: e3 }] =
    await Promise.all([
      sb.from('checkin_ocorrencias')
        .select('id, paciente_id, status, disponivel_em, prazo_em, respondido_em')
        .neq('status', 'cancelado').limit(1000),
      sb.from('checkin_modelos').select('id, status'),
      sb.from('checkin_atribuicoes').select('id, paciente_id, ativo'),
    ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  return { ocorrencias: ocs || [], modelos: mods || [], atribuicoes: atrs || [] };
}

/** A aba Respostas — transversal, com o paciente junto. */
export async function listarOcorrenciasGlobais({
  pacienteId = null, modeloId = null, situacao = null, desde = null, limite = 300,
} = {}) {
  let q = sb.from('checkin_ocorrencias')
    .select('*, paciente:pacientes ( id, nome ), modelo:checkin_modelos ( id, nome )')
    .neq('status', 'cancelado');
  if (pacienteId) q = q.eq('paciente_id', pacienteId);
  if (modeloId) q = q.eq('modelo_id', modeloId);
  if (desde) q = q.gte('disponivel_em', desde);
  const { data, error } = await q.order('disponivel_em', { ascending: false }).limit(limite);
  if (error) throw error;
  // `situacao` (atrasado) é derivada — filtrar no banco exigiria repetir a
  // regra de data em SQL, e aí haveria duas definições de "atrasado".
  return data || [];
}

/** Quantos pacientes usam cada modelo — a coluna "pacientes usando". */
export async function usoDosModelos() {
  const { data, error } = await sb.from('checkin_atribuicoes')
    .select('modelo_id, paciente_id').eq('ativo', true);
  if (error) throw error;
  const mapa = new Map();
  for (const a of data || []) {
    if (!mapa.has(a.modelo_id)) mapa.set(a.modelo_id, new Set());
    mapa.get(a.modelo_id).add(a.paciente_id);
  }
  return mapa;
}

export { agora };
