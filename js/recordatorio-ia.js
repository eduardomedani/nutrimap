// ═══════════════════════════════════════════════════════════
// RECORDATÓRIO POR IA — estima kcal/macros do texto livre
// Automático na 1ª abertura, salva em recordatorio_calc, reusa depois.
// ═══════════════════════════════════════════════════════════

import { sb } from './supabase.js';

// Hash simples do texto do recordatório (pra saber se mudou e recalcular)
function hashTexto(txt) {
  let h = 0;
  for (let i = 0; i < txt.length; i++) {
    h = ((h << 5) - h + txt.charCodeAt(i)) | 0;
  }
  return String(h);
}

/**
 * Monta o texto do recordatório a partir das refeições válidas.
 * @param {Array} refeicoes - [[label, faz, descricao, horario], ...]
 * @returns {string}
 */
export function montarTextoRecordatorio(refeicoes) {
  return refeicoes
    .filter(r => (r[1] || '').toLowerCase() !== 'não' && r[2])
    .map(r => `${r[0]}${r[3] ? ' ('+r[3]+')' : ''}: ${r[2]}`)
    .join('\n');
}

/**
 * Busca o cálculo já salvo (cache). Retorna null se não existe.
 */
export async function buscarCache(pacienteId) {
  const { data, error } = await sb
    .from('recordatorio_calc')
    .select('*')
    .eq('paciente_id', pacienteId)
    .maybeSingle();
  if (error) { console.warn('cache recordatorio:', error.message); return null; }
  return data;
}

/**
 * Chama a serverless function própria (/api/calcular-recordatorio) que,
 * por sua vez, chama a Anthropic com a chave protegida no servidor.
 * @returns {Promise<{kcal_total, prot_g, carb_g, gord_g, observacao}>}
 */
export async function estimarPorIA(textoRecordatorio) {
  const response = await fetch('/api/calcular-recordatorio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texto: textoRecordatorio })
  });

  if (!response.ok) {
    let msg = 'Falha no cálculo: ' + response.status;
    try { const e = await response.json(); if (e.error) msg = e.error; } catch {}
    throw new Error(msg);
  }

  const parsed = await response.json();
  if (parsed.error) throw new Error(parsed.error);
  return parsed;
}

/**
 * Salva o resultado no cache.
 */
export async function salvarCache(pacienteId, calc, hashOrigem) {
  const row = {
    paciente_id: pacienteId,
    kcal_total: calc.kcal_total,
    prot_g: calc.prot_g,
    carb_g: calc.carb_g,
    gord_g: calc.gord_g,
    detalhe: { observacao: calc.observacao || '' },
    hash_origem: hashOrigem,
    calculado_em: new Date().toISOString()
  };
  const { error } = await sb
    .from('recordatorio_calc')
    .upsert(row, { onConflict: 'paciente_id' });
  if (error) console.warn('salvar cache:', error.message);
}

/**
 * Fluxo completo: usa cache se válido, senão calcula por IA e salva.
 * @param {string} pacienteId
 * @param {Array} refeicoes - mesmas refeições montadas no relatorio.js
 * @param {number|null} getKcal - GET da última avaliação (ou null)
 * @returns {Promise<{kcal_total, prot_g, carb_g, gord_g, observacao, get_kcal, fonte}>}
 */
export async function obterRecordatorioCalculado(pacienteId, refeicoes, getKcal = null) {
  const texto = montarTextoRecordatorio(refeicoes);
  if (!texto.trim()) return null; // sem recordatório, nada a calcular

  const hashAtual = hashTexto(texto);

  // 1. Tenta cache
  const cache = await buscarCache(pacienteId);
  if (cache && cache.hash_origem === hashAtual) {
    return {
      kcal_total: cache.kcal_total, prot_g: cache.prot_g,
      carb_g: cache.carb_g, gord_g: cache.gord_g,
      observacao: cache.detalhe?.observacao || '',
      get_kcal: getKcal, fonte: 'cache'
    };
  }

  // 2. Calcula por IA
  const calc = await estimarPorIA(texto);
  await salvarCache(pacienteId, calc, hashAtual);
  return { ...calc, get_kcal: getKcal, fonte: 'ia' };
}

/**
 * Busca o GET da última avaliação física do paciente (ou null).
 */
export async function buscarGetUltimaAvaliacao(pacienteId) {
  const { data, error } = await sb
    .from('avaliacoes')
    .select('get_kcal')
    .eq('paciente_id', pacienteId)
    .order('numero', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.get_kcal || null;
}

/**
 * Disparado pelo index.html LOGO APÓS o relatório entrar no DOM.
 * Lê o container deixado pelo relatorio.js, calcula (ou usa cache) e
 * substitui o "Calculando..." pelo card final.
 */
export async function processarRecordatorioIA(pacienteId) {
  const cont = document.getElementById('rec-calc-container');
  if (!cont) return; // paciente sem recordatório → nada a fazer

  let refeicoes;
  try {
    refeicoes = JSON.parse(decodeURIComponent(cont.dataset.refeicoes || '[]'));
  } catch { return; }

  try {
    const getKcal = await buscarGetUltimaAvaliacao(pacienteId);
    const calc = await obterRecordatorioCalculado(pacienteId, refeicoes, getKcal);
    if (!calc) { cont.remove(); return; }
    // Substitui o container inteiro pelo card final (com relato + estimativa)
    cont.outerHTML = renderCardRecordatorio(calc, refeicoes);
  } catch (e) {
    cont.innerHTML = `⚠️ Não foi possível calcular agora (${e.message}). Reabra o relatório para tentar de novo.`;
  }
}

/**
 * Monta o HTML do card do recordatório calculado.
 */
export function renderCardRecordatorio(calc, refeicoes) {
  if (!calc) return '';

  // ── Coluna esquerda: o que a pessoa relatou ──
  let relato = '';
  if (Array.isArray(refeicoes) && refeicoes.length) {
    const linhas = refeicoes
      .filter(r => (r[1] || '').toLowerCase() !== 'não' && r[2])
      .map(r => `
        <div class="rec-refeicao">
          <div class="rec-refeicao-nome">${r[0]}${r[3] ? ` <span class="rec-refeicao-hora">${r[3]}</span>` : ''}</div>
          <div class="rec-refeicao-desc">${r[2]}</div>
        </div>`).join('');
    relato = linhas || '<div class="rec-vazio">Sem refeições relatadas.</div>';
  } else {
    relato = '<div class="rec-vazio">Sem refeições relatadas.</div>';
  }

  // ── Coluna direita: comparação com GET ──
  let comparacao = '';
  if (calc.get_kcal) {
    const diff = Math.round(calc.kcal_total - calc.get_kcal);
    const cor = diff > 0 ? 'var(--terracotta)' : 'var(--moss)';
    const sinal = diff > 0 ? '+' : '';
    const rotulo = diff > 0 ? 'acima do GET (superávit)' : 'abaixo do GET (déficit)';
    comparacao = `
      <div class="rec-compara">
        <div class="rec-compara-row"><span>GET (avaliação)</span><strong>${Math.round(calc.get_kcal)} kcal</strong></div>
        <div class="rec-compara-row"><span>Recordatório</span><strong>${Math.round(calc.kcal_total)} kcal</strong></div>
        <div class="rec-compara-diff" style="color:${cor}">${sinal}${diff} kcal · ${rotulo}</div>
      </div>`;
  } else {
    comparacao = `<div class="rec-sem-get">Sem avaliação física cadastrada — comparação com GET indisponível.</div>`;
  }

  return `
    <div class="rec-full-card">
      <div class="rec-full-title">🍽️ Recordatório alimentar</div>
      <div class="rec-full-grid">
        <div class="rec-lado rec-lado-pessoa">
          <div class="rec-lado-head">Relato da paciente</div>
          <div class="rec-relato">${relato}</div>
        </div>
        <div class="rec-lado rec-lado-ia">
          <div class="rec-lado-head">⚛ Estimativa nutricional (IA)</div>
          <div class="rec-calc-kcal">${Math.round(calc.kcal_total)} <span>kcal/dia</span></div>
          <div class="rec-calc-macros">
            <div class="rec-macro"><div class="rec-macro-v">${Math.round(calc.prot_g)}g</div><div class="rec-macro-l">Proteína</div></div>
            <div class="rec-macro"><div class="rec-macro-v">${Math.round(calc.carb_g)}g</div><div class="rec-macro-l">Carboidrato</div></div>
            <div class="rec-macro"><div class="rec-macro-v">${Math.round(calc.gord_g)}g</div><div class="rec-macro-l">Gordura</div></div>
          </div>
          ${comparacao}
          <div class="rec-calc-aviso">⚠️ Estimativa aproximada a partir de texto livre. ${calc.observacao || ''} Não substitui pesagem de alimentos.</div>
        </div>
      </div>
    </div>`;
}
