// ═══════════════════════════════════════════════════════════
// METAS DO PACIENTE — dados + cálculo de progresso
// ═══════════════════════════════════════════════════════════
// A meta guarda onde o paciente começou e onde quer chegar. O valor ATUAL
// nunca é copiado para cá: vem da última avaliação, na hora. Duas cópias do
// mesmo número divergem no primeiro dia.
//
// Nada de previsão fantasiosa: a tendência só aparece quando há ritmo medido
// entre duas avaliações, e é rotulada como estimativa.

import { sb } from './supabase.js';

export const TIPOS_META = {
  peso:              { label: 'Peso',              unidade: 'kg', campo: 'pesoAtual',   casas: 1 },
  gordura:           { label: '% de gordura',      unidade: '%',  campo: 'gordura',     casas: 1 },
  massa_magra:       { label: 'Massa magra',       unidade: 'kg', campo: 'massaMagra',  casas: 1 },
  cintura:           { label: 'Cintura',           unidade: 'cm', campo: 'cintura',     casas: 1 },
  frequencia_treino: { label: 'Frequência de treino', unidade: 'x/semana', campo: null, casas: 0 },
  agua:              { label: 'Consumo de água',   unidade: 'L/dia', campo: null,       casas: 1 },
  habito:            { label: 'Hábito',            unidade: '',   campo: null,          casas: 0 },
};

export const STATUS_META = {
  nao_iniciada: 'Não iniciada',
  em_andamento: 'Em andamento',
  atingida:     'Atingida',
  pausada:      'Pausada',
  cancelada:    'Cancelada',
};

// ── CRUD ───────────────────────────────────────────────────
export async function listarMetas(pacienteId) {
  const { data, error } = await sb
    .from('paciente_metas')
    .select('*')
    .eq('paciente_id', pacienteId)
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function criarMeta(pacienteId, dados) {
  const { data, error } = await sb
    .from('paciente_metas')
    .insert({ ...limpar(dados), paciente_id: pacienteId })
    .select().single();
  if (error) throw error;
  return data;
}

export async function atualizarMeta(id, dados) {
  const { data, error } = await sb
    .from('paciente_metas')
    .update({ ...limpar(dados), atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

export async function excluirMeta(id) {
  const { error } = await sb.from('paciente_metas').delete().eq('id', id);
  if (error) throw error;
  return true;
}

// ── Progresso ──────────────────────────────────────────────
/**
 * Situação da meta somando o que está no banco com o valor medido hoje.
 * @param {object} meta
 * @param {object} metricas  resumo.metricas (paciente-resumo.js)
 * @returns {{atual, progresso, restante, status, statusLabel, tom, vencida, tendencia}}
 */
export function situacaoDaMeta(meta, metricas = {}) {
  const cfg = TIPOS_META[meta.tipo] || {};
  const atual = cfg.campo ? num(metricas[cfg.campo]) : null;
  const inicial = num(meta.valor_inicial);
  const alvo = num(meta.valor_alvo);

  let progresso = null;      // 0–100
  let restante = null;
  if (atual != null && inicial != null && alvo != null && inicial !== alvo) {
    progresso = Math.max(0, Math.min(100, Math.round(((atual - inicial) / (alvo - inicial)) * 100)));
    restante = Number((alvo - atual).toFixed(cfg.casas ?? 1));
  }

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const prazo = meta.prazo ? new Date(`${meta.prazo}T12:00:00`) : null;
  const vencida = !!prazo && prazo < hoje && meta.status !== 'atingida' && meta.status !== 'cancelada';

  // Status mostrado = o do banco, com dois estados derivados que ninguém
  // precisa marcar à mão: atingida (bateu o alvo) e vencida (passou do prazo).
  let status = meta.status;
  if (progresso != null && progresso >= 100 && status === 'em_andamento') status = 'atingida';
  if (vencida && status === 'em_andamento') status = 'vencida';

  const LABEL = { ...STATUS_META, vencida: 'Prazo vencido' };
  const TOM = {
    atingida: 'positivo', vencida: 'alerta', pausada: 'neutro',
    cancelada: 'neutro', nao_iniciada: 'neutro', em_andamento: 'info',
  };
  const perto = progresso != null && progresso >= 80 && status === 'em_andamento';

  return {
    atual, inicial, alvo,
    unidade: meta.unidade || cfg.unidade || '',
    progresso, restante, vencida,
    status, statusLabel: perto ? 'Próxima da meta' : (LABEL[status] || status),
    tom: perto ? 'positivo' : (TOM[status] || 'neutro'),
    medida: !!cfg.campo,   // false = acompanhada manualmente (sem check-ins ainda)
  };
}

/**
 * Estimativa de quando a meta seria atingida, no ritmo recente.
 * Só devolve algo com duas avaliações e ritmo na direção do alvo — caso
 * contrário, null (melhor não dizer nada do que chutar uma data).
 */
export function estimativa(meta, avaliacoes, metricas) {
  const cfg = TIPOS_META[meta.tipo] || {};
  if (!cfg.campo || !avaliacoes || avaliacoes.length < 2) return null;

  const campoAv = { pesoAtual: 'peso', gordura: 'pct_gordura', massaMagra: 'peso_magro', cintura: 'per_cintura' }[cfg.campo];
  if (!campoAv) return null;

  const comValor = avaliacoes.filter(a => num(a[campoAv]) != null && a.data_avaliacao);
  if (comValor.length < 2) return null;

  const a = comValor[comValor.length - 2], b = comValor[comValor.length - 1];
  const escala = campoAv === 'pct_gordura' ? 100 : 1;
  const v1 = num(a[campoAv]) * escala, v2 = num(b[campoAv]) * escala;
  const dias = (new Date(`${b.data_avaliacao}T12:00:00`) - new Date(`${a.data_avaliacao}T12:00:00`)) / 86400000;
  if (!dias || dias <= 0) return null;

  const ritmo = (v2 - v1) / dias;                    // unidade por dia
  const falta = num(meta.valor_alvo) - v2;
  if (!ritmo || Math.sign(ritmo) !== Math.sign(falta)) return null;   // andando para o outro lado

  const diasFalta = Math.ceil(falta / ritmo);
  if (!Number.isFinite(diasFalta) || diasFalta <= 0 || diasFalta > 730) return null;

  const data = new Date(Date.now() + diasFalta * 86400000);
  return { dias: diasFalta, data, texto: `Estimativa baseada no ritmo recente: ${diasFalta} dias.` };
}

// ── Helpers ────────────────────────────────────────────────
function limpar(d) {
  const out = {};
  for (const [k, v] of Object.entries(d || {})) {
    if (v === undefined) continue;
    out[k] = (v === '' ? null : v);
  }
  return out;
}
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
