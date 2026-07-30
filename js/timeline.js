// ═══════════════════════════════════════════════════════════
// TIMELINE — serviço de eventos do paciente (camada de dados)
// ═══════════════════════════════════════════════════════════
// PONTO ÚNICO de escrita na tabela `paciente_eventos`. Nenhum outro módulo
// insere direto: os módulos chamam `registrarEvento()` DEPOIS que a operação
// principal já foi confirmada no banco.
//
// Regra de ouro: a timeline nunca pode derrubar a operação de negócio.
// `registrarEvento` engole o erro (loga no console) e devolve null — publicar
// um plano continua valendo mesmo que o registro do evento falhe.
//
// Deduplicação: `chave_dedup` é UNIQUE no banco e o insert usa
// "ON CONFLICT DO NOTHING". Com `dedupPorDia`, vários salvamentos do mesmo
// item no mesmo dia viram UM evento — é o que impede a poluição da timeline.

import { sb } from './supabase.js';
import { configDoTipo } from './timeline-config.js';

export const LIMITE_PAGINA = 20;

// Tabelas por entidade — usado para saber se o registro relacionado ainda existe.
const TABELA_DA_ENTIDADE = {
  plano:     'planos_alimentares',
  treino:    'treinos',
  avaliacao: 'avaliacoes',
  paciente:  'pacientes',
};

const hojeISO = () => new Date().toISOString().slice(0, 10);

/**
 * Registra um evento na timeline. Por padrão nunca lança: uma timeline que
 * falha não pode desfazer a ação que ela só observa.
 *
 * Quem MOSTRA o resultado ao usuário precisa do contrário — sem `propagarErro`
 * não há como separar "já existia" de "não gravou", e as duas viram null. Nesse
 * caso o retorno vira: linha = gravou · null = já existia hoje · throw = falhou.
 *
 * @param {object}  ev
 * @param {string}  ev.pacienteId        obrigatório
 * @param {string}  ev.tipo              constante do catálogo (ex: MEAL_PLAN_PUBLISHED)
 * @param {string} [ev.titulo]           padrão: rótulo do catálogo
 * @param {string} [ev.descricao]
 * @param {string} [ev.modulo]           padrão: módulo do catálogo
 * @param {string} [ev.importancia]      padrão: importância do catálogo
 * @param {string} [ev.entidadeTipo]     'plano' | 'treino' | 'avaliacao' | 'paciente'
 * @param {string} [ev.entidadeId]
 * @param {object} [ev.metadata]
 * @param {Date|string} [ev.dataEvento]  padrão: agora
 * @param {boolean}[ev.dedupPorDia]      1 evento por (tipo, entidade, dia)
 * @param {string} [ev.chaveDedup]       chave explícita (vence dedupPorDia)
 * @param {object} [opts]
 * @param {boolean}[opts.propagarErro]   lança em vez de engolir a falha
 * @returns {Promise<object|null>} o evento criado, ou null (já existia / falhou)
 */
export async function registrarEvento(ev, { propagarErro = false } = {}) {
  try {
    if (!ev || !ev.pacienteId || !ev.tipo) return null;
    const cfg = configDoTipo(ev.tipo);

    const chave = ev.chaveDedup ?? (ev.dedupPorDia
      ? `${ev.tipo}:${ev.entidadeId || ev.pacienteId}:${hojeISO()}`
      : null);

    const linha = {
      paciente_id:   ev.pacienteId,
      tipo:          ev.tipo,
      modulo:        ev.modulo || cfg.modulo,
      titulo:        ev.titulo || cfg.label,
      descricao:     ev.descricao || null,
      data_evento:   ev.dataEvento ? new Date(ev.dataEvento).toISOString() : new Date().toISOString(),
      entidade_tipo: ev.entidadeTipo || cfg.acao?.entidade || null,
      entidade_id:   ev.entidadeId || null,
      metadata:      limparMetadata(ev.metadata),
      importancia:   ev.importancia || cfg.importancia || 'normal',
      gerado_pelo_sistema: ev.manual ? false : true,
      chave_dedup:   chave,
    };
    // nutri_id e criado_por vêm do default auth.uid() — o RLS confere os dois.

    const { data, error } = await sb
      .from('paciente_eventos')
      .upsert(linha, { onConflict: 'chave_dedup', ignoreDuplicates: true })
      .select()
      .maybeSingle();

    if (error) throw error;
    return data || null;   // null = já existia hoje (dedup), e está tudo certo
  } catch (e) {
    // Falha de timeline não desfaz nada nem interrompe o fluxo do usuário.
    console.error('[timeline] não foi possível registrar o evento:', ev?.tipo, e?.message || e);
    if (propagarErro) throw e;
    return null;
  }
}

/**
 * Página de eventos de um paciente, do mais recente para o mais antigo.
 * Paginação por cursor (keyset em data_evento + id) — sem OFFSET.
 *
 * @param {string} pacienteId
 * @param {object} [opts]
 * @param {string[]|null} [opts.modulos]  filtro por módulo (null = todos)
 * @param {{data:string,id:string}|null} [opts.cursor]
 * @param {number} [opts.limite]
 * @returns {Promise<{eventos:object[], proximoCursor:object|null, temMais:boolean}>}
 */
export async function listarEventos(pacienteId, { modulos = null, cursor = null, limite = LIMITE_PAGINA } = {}) {
  let q = sb
    .from('paciente_eventos')
    .select('*')
    .eq('paciente_id', pacienteId)
    .eq('visivel', true)
    .order('data_evento', { ascending: false })
    .order('id', { ascending: false })
    .limit(limite + 1);                       // +1 só para saber se há próxima página

  if (modulos && modulos.length) q = q.in('modulo', modulos);
  // Keyset: (data < cursor.data) OU (data = cursor.data E id < cursor.id).
  if (cursor) q = q.or(`data_evento.lt.${cursor.data},and(data_evento.eq.${cursor.data},id.lt.${cursor.id})`);

  const { data, error } = await q;
  if (error) throw error;

  const linhas = data || [];
  const temMais = linhas.length > limite;
  const eventos = temMais ? linhas.slice(0, limite) : linhas;
  const ultimo = eventos[eventos.length - 1];

  return {
    eventos,
    temMais,
    proximoCursor: temMais && ultimo ? { data: ultimo.data_evento, id: ultimo.id } : null,
  };
}

/**
 * Dos eventos recebidos, quais entidades relacionadas ainda existem.
 * Serve para esconder o botão "Abrir plano" de um registro já excluído sem
 * apagar o evento nem quebrar a timeline.
 * @returns {Promise<Set<string>>} chaves "tipo:id" existentes
 */
export async function entidadesExistentes(eventos) {
  const existentes = new Set();
  const porTipo = new Map();

  for (const e of eventos || []) {
    if (!e.entidade_tipo || !e.entidade_id) continue;
    const tabela = TABELA_DA_ENTIDADE[e.entidade_tipo];
    if (!tabela) continue;
    if (!porTipo.has(e.entidade_tipo)) porTipo.set(e.entidade_tipo, new Set());
    porTipo.get(e.entidade_tipo).add(e.entidade_id);
  }

  await Promise.all([...porTipo.entries()].map(async ([tipo, ids]) => {
    try {
      const { data, error } = await sb
        .from(TABELA_DA_ENTIDADE[tipo])
        .select('id')
        .in('id', [...ids]);
      if (error) throw error;
      (data || []).forEach(r => existentes.add(`${tipo}:${r.id}`));
    } catch (e) {
      // Sem certeza: não esconde nada (o botão abre a aba, que é inofensivo).
      ids.forEach(id => existentes.add(`${tipo}:${id}`));
    }
  }));

  return existentes;
}

// ── Registros manuais ──────────────────────────────────────
// Só estes podem ser editados/excluídos (o RLS bloqueia o resto).

export async function criarRegistroManual({ pacienteId, titulo, descricao, dataEvento, categoria, importancia }) {
  const { data, error } = await sb
    .from('paciente_eventos')
    .insert({
      paciente_id: pacienteId,
      tipo:        'MANUAL_NOTE',
      modulo:      'manual',
      titulo:      titulo,
      descricao:   descricao || null,
      data_evento: dataEvento ? new Date(dataEvento).toISOString() : new Date().toISOString(),
      metadata:    limparMetadata({ categoria }),
      importancia: importancia || 'normal',
      gerado_pelo_sistema: false,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Edita um registro manual. Guarda `editado_em` — o histórico nunca some sem marca. */
export async function atualizarRegistroManual(id, { titulo, descricao, dataEvento, categoria, importancia }) {
  const patch = { editado_em: new Date().toISOString() };
  if (titulo !== undefined)      patch.titulo = titulo;
  if (descricao !== undefined)   patch.descricao = descricao || null;
  if (dataEvento !== undefined)  patch.data_evento = new Date(dataEvento).toISOString();
  if (importancia !== undefined) patch.importancia = importancia;
  if (categoria !== undefined)   patch.metadata = limparMetadata({ categoria });

  const { data, error } = await sb
    .from('paciente_eventos')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function excluirRegistroManual(id) {
  const { error } = await sb.from('paciente_eventos').delete().eq('id', id);
  if (error) throw error;
  return true;
}

// ── Helpers ────────────────────────────────────────────────

/** Tira nulos/vazios do metadata: campo ausente é melhor que campo vazio. */
function limparMetadata(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta || {})) {
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Compara dois registros e devolve os campos relevantes que mudaram.
 * Usado para decidir se vale um evento de "atualizado" — microalteração
 * (um acento no nome, um campo em branco) não vira evento.
 */
export function camposAlterados(antes, depois, campos) {
  const mudou = [];
  for (const c of campos) {
    const a = normaliza(antes?.[c]);
    const b = normaliza(depois?.[c]);
    if (a !== b) mudou.push(c);
  }
  return mudou;
}

function normaliza(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v).trim();
}
