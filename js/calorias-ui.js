// ═══════════════════════════════════════════════════════════
// CÁLCULO DE CALORIAS — UI (aba da ficha do paciente)
// ═══════════════════════════════════════════════════════════
// Parte do GET (gasto energético) da última avaliação (TMB Mifflin-St Jeor ×
// fator de atividade, já calculado em avaliacoes.js) e devolve:
//   · meta calórica  = GET ajustado por objetivo (déficit/superávit em %)
//   · macros         = por g/kg OU por percentuais (seletor)
// Pode aplicar as metas direto no plano alimentar do paciente.
//
// Plugado na ficha via initCaloriasUIParaPaciente(nutriId, paciente, mountId).

import { listarAvaliacoes } from './avaliacoes.js';
import {
  listarPlanosDoPaciente, criarPlano, atualizarPlano,
  gerarPlanoParaPaciente, catalogoParaGerador, faltandoNoCatalogo,
} from './dieta.js';
import { TEMPLATES } from './dieta-grupos.js';
import { mostrarToast, confirmar } from './utils.js';

let _nutriId  = null;
let _paciente = null;
let _mountEl  = null;
let _av       = null;        // última avaliação (ou null)
let _modo     = 'gkg';       // 'gkg' | 'pct'

// Objetivo -> ajuste % padrão sobre o GET (sub-níveis com respaldo na literatura).
const OBJETIVOS = [
  { v: 'emag_leve',  label: 'Emagrecimento LEVE',      ajuste: -12 },
  { v: 'emag_mod',   label: 'Emagrecimento MODERADO',  ajuste: -20 },
  { v: 'emag_acent', label: 'Emagrecimento ACENTUADO', ajuste: -27 },
  { v: 'manutencao', label: 'Manutenção',              ajuste: 0 },
  { v: 'hiper_lean', label: 'Hipertrofia LEAN BULK',   ajuste: 8 },
  { v: 'hiper_mod',  label: 'Hipertrofia MODERADO',    ajuste: 15 },
];
const OBJ_PADRAO = 'emag_mod';   // pré-selecionado ao abrir

export async function initCaloriasUIParaPaciente(nutriId, paciente, mountId) {
  _nutriId = nutriId;
  _paciente = paciente;
  _mountEl = document.getElementById(mountId);
  _modo = 'gkg';
  if (!_mountEl) return;

  _mountEl.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando...</div>`;
  try {
    const avs = await listarAvaliacoes(paciente.id);
    _av = avs && avs[0] ? avs[0] : null;
  } catch (e) { _av = null; }
  render();
}

function render() {
  const peso = num(_av?.peso);
  const get  = num(_av?.get_kcal);
  const avInfo = _av
    ? `Da última avaliação (AV ${_av.numero})${_av.tmb ? ` — TMB ${Math.round(_av.tmb)} kcal, GET ${Math.round(get)} kcal` : ''}.`
    : 'Nenhuma avaliação encontrada. Preencha o peso e o GET manualmente, ou faça uma avaliação física.';

  _mountEl.innerHTML = `
    <div class="av-form-card">
      <div class="av-form-title"><i data-lucide="flame"></i> Cálculo de calorias</div>

      <!-- 1) Base -->
      <div class="cal-hint">${esc(avInfo)}</div>
      ${_av ? `
      <div class="av-field cal-formula-field">
        <label>Fórmula da TMB</label>
        <select id="calFormula" class="np-input">
          <option value="mifflin">Mifflin-St Jeor</option>
          <option value="harris">Harris-Benedict (revisada)</option>
          <option value="katch">Katch-McArdle (massa magra)</option>
        </select>
        <div class="cal-hint" id="calFormulaNote" style="margin:6px 0 0;"></div>
      </div>` : ''}
      <!-- 1-2) Base + objetivo: tudo na mesma linha -->
      <div class="cal-inputs">
        <div class="av-field">
          <label>Peso (kg)</label>
          <input type="number" step="0.1" inputmode="decimal" id="calPeso" class="np-input" value="${peso ? peso : ''}" placeholder="Ex.: 80">
        </div>
        <div class="av-field">
          <label>GET (kcal/dia)</label>
          <input type="number" step="1" inputmode="decimal" id="calGet" class="np-input" value="${get ? Math.round(get) : ''}" placeholder="Ex.: 2400">
        </div>
        <div class="av-field">
          <label>Objetivo</label>
          <select id="calObjetivo" class="np-input">
            ${OBJETIVOS.map(o => `<option value="${o.v}" data-ajuste="${o.ajuste}" ${o.v === OBJ_PADRAO ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </div>
        <div class="av-field">
          <label>Ajuste sobre o GET (%)</label>
          <input type="number" step="1" inputmode="decimal" id="calAjuste" class="np-input" value="${OBJETIVOS.find(o => o.v === OBJ_PADRAO).ajuste}">
        </div>
      </div>

      <!-- Dica ao vivo: ritmo estimado + alerta -->
      <div class="cal-rate" id="calRate"></div>

      <!-- Meta calórica (card de destaque) -->
      <div class="cal-meta-card">
        <div class="cal-meta-main">
          <div class="cal-meta-title">Meta calórica</div>
          <div class="cal-meta-big"><strong id="calMetaVal">—</strong> <span>kcal/dia</span></div>
          <div class="cal-base">
            <div class="cal-base-lbl">Baseado em</div>
            <dl class="cal-base-list">
              <div><dt>GET</dt><dd><b id="calBaseGet">—</b> kcal/dia</dd></div>
              <div><dt>Objetivo</dt><dd id="calBaseObj">—</dd></div>
              <div><dt>Ajuste</dt><dd id="calBaseAj">—</dd></div>
            </dl>
          </div>
        </div>
        <div class="cal-badge" id="calBadge">—</div>
      </div>

      <!-- 3) Macros -->
      <div class="cal-macro-head">
        <div class="av-form-subtitle">Distribuição de macros</div>
        <div class="cal-toggle" id="calToggle">
          <button type="button" data-modo="gkg" class="active">g/kg</button>
          <button type="button" data-modo="pct">%</button>
        </div>
      </div>

      <div class="av-grid cal-3col" id="calGkg">
        <div class="av-field"><label>Proteína (g/kg)</label>
          <input type="number" step="0.1" inputmode="decimal" id="calProtGkg" class="np-input" value="2"></div>
        <div class="av-field"><label>Carboidrato (g/kg)</label>
          <input type="number" step="0.1" inputmode="decimal" id="calCarbGkg" class="np-input" value="3"></div>
        <div class="av-field"><label>Gordura (g/kg)</label>
          <input type="number" step="0.1" inputmode="decimal" id="calGordGkg" class="np-input" value="1"></div>
      </div>

      <div class="av-grid cal-3col" id="calPct">
        <div class="av-field"><label>Proteína (%)</label>
          <input type="number" step="1" inputmode="decimal" id="calProtPct" class="np-input" value="30"></div>
        <div class="av-field"><label>Carboidrato (%) <span class="ex-opt">automático</span></label>
          <input type="number" id="calCarbPct" class="np-input cal-ro" value="40" readonly tabindex="-1"></div>
        <div class="av-field"><label>Gordura (%)</label>
          <input type="number" step="1" inputmode="decimal" id="calGordPct" class="np-input" value="30"></div>
        <div class="cal-note">O carboidrato completa 100% automaticamente (100 − proteína − gordura).</div>
      </div>

      <!-- Resultado dos macros -->
      <div class="cal-macros" id="calMacros"></div>

      <div class="av-actions">
        <button class="btn" id="calAplicar"><i data-lucide="check"></i> Aplicar só as metas</button>
        <button class="btn primary" id="calGerar"><i data-lucide="wand-sparkles"></i> Gerar plano completo</button>
      </div>
      <div class="cal-hint" id="calAplicarMsg" style="text-align:right;"></div>
    </div>
  `;

  // listeners
  const ids = ['calGet', 'calAjuste', 'calProtGkg', 'calCarbGkg', 'calGordGkg', 'calCarbPct', 'calProtPct', 'calGordPct'];
  ids.forEach(id => document.getElementById(id)?.addEventListener('input', recomputar));

  // Peso e fórmula recalculam o GET (quando há dados da avaliação).
  document.getElementById('calPeso')?.addEventListener('input', recomputarGet);
  document.getElementById('calFormula')?.addEventListener('change', recomputarGet);

  const obj = document.getElementById('calObjetivo');
  obj.addEventListener('change', () => {
    const aj = obj.selectedOptions[0]?.dataset.ajuste ?? '0';
    document.getElementById('calAjuste').value = aj;
    recomputar();
  });

  document.getElementById('calToggle').querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => setModo(b.dataset.modo)));

  document.getElementById('calAplicar').addEventListener('click', aplicarAoPlano);
  document.getElementById('calGerar').addEventListener('click', gerarPlanoCompleto);

  setModo(_modo);                 // visibilidade inicial dos macros
  if (_av) recomputarGet();       // preenche o GET pela fórmula selecionada
}

// TMB pela fórmula escolhida. Retorna null se faltar dado necessário.
function tmbPorFormula(formula, d) {
  const { peso, alturaCm, idade, sexo, pctGordura } = d;
  if (formula === 'katch') {
    if (!peso || !pctGordura || pctGordura <= 0) return null;   // precisa de %gordura
    return 370 + 21.6 * (peso * (1 - pctGordura));
  }
  if (!peso || !alturaCm || !idade || !sexo) return null;
  if (formula === 'harris') {
    return sexo === 'M'
      ? 88.362 + 13.397 * peso + 4.799 * alturaCm - 5.677 * idade
      : 447.593 + 9.247 * peso + 3.098 * alturaCm - 4.330 * idade;
  }
  // mifflin-st jeor (padrão)
  const base = 10 * peso + 6.25 * alturaCm - 5 * idade;
  return sexo === 'M' ? base + 5 : base - 161;
}

// Recalcula o GET a partir da fórmula + dados da avaliação e preenche o campo.
function recomputarGet() {
  if (!_av) { recomputar(); return; }
  const formula = document.getElementById('calFormula')?.value || 'mifflin';
  const fator = num(_av.fator_atividade) || 1.2;
  const d = {
    peso: num(document.getElementById('calPeso')?.value),
    alturaCm: num(_av.altura) * 100,   // altura vem em metros no banco
    idade: num(_av.idade),
    sexo: _av.sexo,
    pctGordura: num(_av.pct_gordura),
  };
  const tmb = tmbPorFormula(formula, d);
  const note = document.getElementById('calFormulaNote');
  if (tmb == null) {
    if (note) note.textContent = formula === 'katch'
      ? 'Katch-McArdle precisa do % de gordura (faça a avaliação com dobras). GET mantido.'
      : 'Faltam dados da avaliação (idade/altura/sexo) para esta fórmula. GET mantido.';
    recomputar();
    return;
  }
  const get = Math.round(tmb * fator);
  const getEl = document.getElementById('calGet');
  if (getEl) getEl.value = get;
  if (note) note.textContent = `TMB ${Math.round(tmb)} kcal × fator ${String(fator).replace('.', ',')} = GET ${get} kcal/dia`;
  recomputar();
}

function setModo(modo) {
  _modo = modo;
  // style.display inline vence o `display:grid` do CSS (o atributo hidden não venceria).
  const gkg = document.getElementById('calGkg');
  const pct = document.getElementById('calPct');
  if (gkg) gkg.style.display = modo === 'gkg' ? '' : 'none';
  if (pct) pct.style.display = modo === 'pct' ? '' : 'none';
  document.getElementById('calToggle').querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.modo === modo));
  recomputar();
}

// Lê inputs, calcula meta + macros, e atualiza os resultados na tela.
function _calcular() {
  const peso = num(document.getElementById('calPeso')?.value);
  const get  = num(document.getElementById('calGet')?.value);
  const ajuste = num(document.getElementById('calAjuste')?.value) || 0;
  const meta = get ? Math.round(get * (1 + ajuste / 100)) : 0;

  let protG = 0, gordG = 0, carbG = 0;
  if (_modo === 'gkg') {
    const pk = num(document.getElementById('calProtGkg')?.value) || 0;
    const ck = num(document.getElementById('calCarbGkg')?.value) || 0;
    const gk = num(document.getElementById('calGordGkg')?.value) || 0;
    protG = pk * (peso || 0);
    carbG = ck * (peso || 0);
    gordG = gk * (peso || 0);
  } else {
    // % travado em 100: carboidrato = 100 − proteína − gordura (preenchido auto).
    const pp = num(document.getElementById('calProtPct')?.value) || 0;
    const gp = num(document.getElementById('calGordPct')?.value) || 0;
    let cp = 100 - pp - gp;
    if (cp < 0) cp = 0;
    const carbEl = document.getElementById('calCarbPct');
    if (carbEl) carbEl.value = Math.round(cp);
    carbG = (meta * cp / 100) / 4;
    protG = (meta * pp / 100) / 4;
    gordG = (meta * gp / 100) / 9;
  }
  return { peso, get, meta, protG, gordG, carbG };
}

// Selo automático conforme o ajuste (%). Sem cores fortes; texto no card.
function badgeAjuste(aj) {
  if (aj <= -1) {
    const a = Math.abs(aj);
    const q = a >= 25 ? 'acentuado' : a >= 12 ? 'moderado' : 'leve';
    return `🔥 Déficit ${q}`;
  }
  if (aj >= 1) {
    const q = aj >= 20 ? 'agressivo' : aj >= 12 ? 'moderado' : 'controlado';
    return `💪 Superávit ${q}`;
  }
  return '⚖️ Manutenção';
}

function recomputar() {
  const c = _calcular();
  const metaEl = document.getElementById('calMetaVal');
  if (metaEl) metaEl.textContent = c.meta ? c.meta : '—';

  // "Baseado em" + selo (apresentação; não altera o cálculo)
  const ajuste = num(document.getElementById('calAjuste')?.value) || 0;
  const objTxt = document.getElementById('calObjetivo')?.selectedOptions[0]?.textContent || '—';
  const getEl = document.getElementById('calBaseGet');
  if (getEl) getEl.textContent = c.get ? Math.round(c.get) : '—';
  const objEl = document.getElementById('calBaseObj');
  if (objEl) objEl.textContent = objTxt;
  const ajEl = document.getElementById('calBaseAj');
  if (ajEl) ajEl.textContent = (ajuste > 0 ? '+' : '') + ajuste + '%';
  const badgeEl = document.getElementById('calBadge');
  if (badgeEl) badgeEl.textContent = c.meta ? badgeAjuste(ajuste) : '—';

  // Dica ao vivo: ritmo semanal estimado + alerta se ajuste for extremo.
  const rateEl = document.getElementById('calRate');
  if (rateEl) {
    if (!c.meta || !c.get) {
      rateEl.innerHTML = '';
    } else {
      const kgSem = Math.abs((c.meta - c.get) * 7 / 7700);   // ~7700 kcal ≈ 1 kg
      const kgTxt = kgSem.toFixed(2).replace('.', ',');
      const pctBw = c.peso ? ` · ${(kgSem / c.peso * 100).toFixed(1).replace('.', ',')}% do peso/sem` : '';
      let linha;
      if (ajuste === 0) linha = `<i data-lucide="minus"></i> Manutenção do peso`;
      else if (ajuste < 0) linha = `<i data-lucide="trending-down"></i> Perda estimada de <strong>${kgTxt} kg/semana</strong>${pctBw}`;
      else linha = `<i data-lucide="trending-up"></i> Ganho estimado de <strong>${kgTxt} kg/semana</strong>${pctBw}`;

      let alerta = '';
      if (ajuste <= -25) alerta = `<div class="cal-alert"><i data-lucide="triangle-alert"></i> Déficit acentuado (acima de 25%): maior risco de perda de massa magra e menor adesão. Prefira ciclos curtos e proteína alta.</div>`;
      else if (ajuste >= 20) alerta = `<div class="cal-alert"><i data-lucide="triangle-alert"></i> Superávit alto (acima de 20%): tende a gerar mais gordura. Para treinados, +5 a +10% costuma bastar.</div>`;

      rateEl.innerHTML = `<div class="cal-rate-line">${linha}</div>${alerta}`;
    }
  }

  const macros = document.getElementById('calMacros');
  if (!macros) return;
  if (!c.meta) { macros.innerHTML = `<div class="cal-note">Informe o GET para calcular os macros.</div>`; return; }

  const totalKcal = c.protG * 4 + c.carbG * 4 + c.gordG * 9;
  const linha = (nome, gr, kcalPg, cor) => {
    const kcal = gr * kcalPg;
    const pct = totalKcal ? Math.round(kcal / totalKcal * 100) : 0;   // % do total (soma 100)
    return `<div class="cal-macro" style="--c:${cor}">
      <div class="cal-macro-nome">${nome}</div>
      <div class="cal-macro-g">${Math.round(gr)} g</div>
      <div class="cal-macro-sub">${Math.round(kcal)} kcal · ${pct}%</div>
    </div>`;
  };
  const dif = c.meta ? Math.round(totalKcal - c.meta) : 0;
  const difTxt = (c.meta && Math.abs(dif) >= 20)
    ? ` <span class="cal-total-dif">(${dif > 0 ? '+' : ''}${dif} kcal vs meta)</span>` : '';
  macros.innerHTML =
    linha('Proteína', c.protG, 4, 'var(--moss)') +
    linha('Carboidrato', c.carbG, 4, 'var(--gold)') +
    linha('Gordura', c.gordG, 9, 'var(--terracotta)') +
    `<div class="cal-total">Total: <strong>${Math.round(totalKcal)} kcal</strong>${difTxt}</div>`;
}

/**
 * Gera um plano completo (refeições + itens) a partir das metas da tela.
 * Cria um plano NOVO — nunca sobrescreve o que já existe, porque o plano
 * atual pode ter ajuste manual do nutri que a geração não sabe reproduzir.
 */
async function gerarPlanoCompleto() {
  const c = _calcular();
  if (!c.meta) { mostrarToast('Informe o GET para calcular a meta'); return; }

  const btn = document.getElementById('calGerar');
  const msg = document.getElementById('calAplicarMsg');
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Gerando...';
  try {
    // o catálogo precisa ter os alimentos dos grupos; sem isso o plano sai furado
    const catalogo = await catalogoParaGerador();
    const faltam = faltandoNoCatalogo(catalogo);
    if (faltam.length) {
      const aviso = `Faltam ${faltam.length} alimentos no catálogo (ex.: ${faltam.slice(0, 3).join(', ')}). ` +
        `Rode db/foods_gerador_seed.sql no Supabase.`;
      if (msg) msg.textContent = aviso;
      mostrarToast('Catálogo incompleto — veja a mensagem abaixo do botão');
      return;
    }

    const planos = await listarPlanosDoPaciente(_paciente.id);
    if (planos.length && !(await confirmar({
      titulo: 'Gerar novo plano',
      mensagem: `${_paciente.nome} já tem ${planos.length} plano(s). ` +
        `Gerar cria um plano NOVO e desativa o atual — nada é apagado.`,
      textoOk: 'Gerar',
    }))) return;

    const objetivo = document.getElementById('calObjetivo')?.selectedOptions[0]?.textContent || null;
    const { plano, resultado } = await gerarPlanoParaPaciente(_nutriId, {
      pacienteId: _paciente.id,
      nome: `Plano ${Math.round(c.meta)} kcal`,
      objetivo,
      templateId: TEMPLATES[0].id,
      metas: {
        kcal: c.meta,
        prot: Math.round(c.protG),
        carb: Math.round(c.carbG),
        gord: Math.round(c.gordG),
      },
    });

    // o novo vira o ativo; os anteriores saem de cena sem serem apagados
    for (const p of planos) if (p.ativo) await atualizarPlano(p.id, { ativo: false });

    const m = resultado.macros, d = resultado.desvio;
    const pc = v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`;
    if (msg) msg.textContent =
      `✓ "${plano.nome}" criado: ${Math.round(m.kcal)} kcal (${pc(d.kcal)}), ` +
      `P ${Math.round(m.proteina)}g · C ${Math.round(m.carboidrato)}g · G ${Math.round(m.gordura)}g. ` +
      `Ajuste na aba "Planejamento Alimentar".` +
      (resultado.avisos.length ? ` ⚠ ${resultado.avisos.join(' ')}` : '');
    mostrarToast('✓ Plano gerado');
  } catch (e) {
    if (msg) msg.textContent = 'Erro: ' + e.message;
    mostrarToast('Erro ao gerar o plano');
  } finally {
    btn.disabled = false; btn.innerHTML = orig;
  }
}

async function aplicarAoPlano() {
  const c = _calcular();
  if (!c.meta) { mostrarToast('Informe o GET para calcular a meta'); return; }

  const btn = document.getElementById('calAplicar');
  const msg = document.getElementById('calAplicarMsg');
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Aplicando...';
  try {
    const metas = {
      kcal_meta: c.meta,
      prot_meta: Math.round(c.protG),
      carb_meta: Math.round(c.carbG),
      gord_meta: Math.round(c.gordG),
      objetivo:  document.getElementById('calObjetivo')?.selectedOptions[0]?.textContent || null,
    };

    const planos = await listarPlanosDoPaciente(_paciente.id);
    if (!planos.length) {
      // Nenhum plano ainda: cria um já com as metas (o nutri só adiciona as refeições depois).
      await criarPlano(_nutriId, { nome: 'Plano alimentar', ativo: true, paciente_id: _paciente.id, ...metas });
      if (msg) msg.textContent = '✓ Plano criado com as metas. Monte as refeições na aba "Planejamento Alimentar".';
      mostrarToast('✓ Plano criado com as metas');
      return;
    }

    const plano = planos.find(p => p.ativo) || planos[0];
    await atualizarPlano(plano.id, metas);
    if (msg) msg.textContent = `✓ Metas aplicadas ao plano "${plano.nome}".`;
    mostrarToast('✓ Metas aplicadas ao plano');
  } catch (e) {
    if (msg) msg.textContent = 'Erro: ' + e.message;
  } finally {
    btn.disabled = false; btn.innerHTML = orig;
  }
}

// helpers
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function num(v) {
  const s = String(v ?? '').trim().replace(',', '.');
  if (s === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
