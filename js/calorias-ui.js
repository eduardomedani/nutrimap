// ═══════════════════════════════════════════════════════════
// CÁLCULO DE CALORIAS — UI da aba da ficha
// ═══════════════════════════════════════════════════════════
// Escopo: só o cálculo. Gasto energético, meta calórica e distribuição de
// macros. Refeições, prescrição e entrega continuam na aba "Planejamento
// Alimentar" (dieta-ui.js) — esta tela não tenta conduzir o fluxo inteiro.
//
// Monta dentro da aba, sem overlay e sem tela cheia.
// Regras de cálculo: todas em calorias-calc.js, intocadas.

import {
  OBJETIVOS, FORMULAS, FATORES, FATOR_PADRAO, MACRO_DEF, OBJ_PADRAO,
  num, tmbPorFormula, getDe, metaDe, statusAjuste, ritmoSemanal, calcularMacros,
} from './calorias-calc.js';
import { ATIVIDADES_ORDENADAS, atividadePorNome, gastoDeAtividades } from './atividades.js';
import { listarAvaliacoes } from './avaliacoes.js';
import {
  listarPlanosDoPaciente, criarPlano, atualizarPlano, gerarPlanoParaPaciente,
  catalogoParaGerador, faltandoNoCatalogo,
} from './dieta.js';
import { TEMPLATES } from './dieta-grupos.js';
import { mapearAtividadeFisica, mapearAntropometria } from './anamnese-calorias.js';
import { buscarRespostasModulo } from './respostas.js';
import { buscarCache as buscarRecordatorio } from './recordatorio-ia.js';
import { mostrarToast, confirmar } from './utils.js';

let _nutriId = null;
let _paciente = null;
let _av = null;
// Fonte dos dados que a TMB consome (altura, idade, sexo, %gordura). Separado
// de _av de propósito: a avaliação física é a medição clínica e continua
// mandando; quando ela não existe, a anamnese pode preencher — e o cabeçalho
// não pode dizer "Avaliação" onde não houve nenhuma.
//   { alturaCm, idade, sexo, pctGordura, origem: 'avaliacao' | 'anamnese' }
let _antropo = null;
let _root = null;
let _salvoEm = null;           // timestamp do último salvamento
let _tickSalvo = null;

// Estado do formulário — fonte de verdade. `_salvo` é o último estado
// persistido; a diferença entre os dois acende "Alterações não salvas".
let _form = null;
let _salvo = null;

const estadoInicial = () => ({
  peso: '', formula: 'mifflin', fator: FATOR_PADRAO, get: '', objetivo: OBJ_PADRAO,
  // null = nada escolhido ainda | 'fator' = multiplicador único da rotina
  // | 'met' = soma atividade a atividade.
  // Começa nulo de propósito: nenhum dos dois painéis abre antes de o nutri
  // decidir. Para o cálculo, nulo se comporta como 'fator' — o GET segue o
  // fator que veio da avaliação, sem inventar nada.
  modoAtiv: null,
  atividades: [],
  // Base do modelo aditivo: o quanto a rotina SEM exercício já gasta. Era
  // fixa em 1,2 (sedentário) e invisível; virou campo porque quem trabalha
  // em pé não tem o mesmo gasto de quem fica sentado, e a anamnese pergunta
  // exatamente isso (q10_neat). Continua em 1,2 por padrão, então nenhum
  // cálculo existente muda sozinho.
  fatorBase: FATOR_PADRAO,
  ajuste: OBJETIVOS.find(o => o.v === OBJ_PADRAO).ajuste,
  modo: 'gkg',
  gkg: { proteina: 2, carboidrato: 3, gordura: 1 },
  pct: { proteina: 30, carboidrato: 40, gordura: 30 },
  travas: [],
});

const clonar = o => JSON.parse(JSON.stringify(o));
const sujo = () => JSON.stringify(_form) !== JSON.stringify(_salvo);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtKcal = v => Math.round(v).toLocaleString('pt-BR');
// `data_avaliacao` é um DATE puro; sem o T00:00:00 o browser lê como UTC e
// mostra o dia anterior (mesmo tratamento de avaliacoes-ui.js:333).
const fmtData = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—';

// ───────────────────────────────────────────────────────────
// CICLO DE VIDA
// ───────────────────────────────────────────────────────────

export async function initCaloriasUIParaPaciente(nutriId, paciente, mountId) {
  _nutriId = nutriId;
  _paciente = paciente;
  _salvoEm = null;

  _root = document.getElementById(mountId);
  if (!_root) return;
  _root.innerHTML = `<div class="cal-boot"><div class="spinner"></div>Carregando cálculo...</div>`;

  _form = estadoInicial();

  try {
    const avs = await listarAvaliacoes(paciente.id);
    _av = avs && avs[0] ? avs[0] : null;
  } catch (e) { _av = null; }
  if (_av?.peso) _form.peso = String(_av.peso);
  if (_av?.fator_atividade) _form.fator = num(_av.fator_atividade) || FATOR_PADRAO;
  _antropo = _av ? {
    alturaCm: num(_av.altura) * 100,     // altura vem em metros no banco
    idade: num(_av.idade),
    sexo: _av.sexo,
    pctGordura: num(_av.pct_gordura),
    origem: 'avaliacao',
  } : null;

  // Retoma as metas do plano ativo: sem isto a tela abriria sempre nos
  // padrões e "Descartar" não teria a que voltar.
  try {
    const planos = await listarPlanosDoPaciente(paciente.id);
    const plano = planos.find(p => p.ativo) || planos[0];
    const peso = num(_form.peso);
    if (plano?.kcal_meta && peso) {
      if (plano.prot_meta) _form.gkg.proteina    = +(plano.prot_meta / peso).toFixed(1);
      if (plano.carb_meta) _form.gkg.carboidrato = +(plano.carb_meta / peso).toFixed(1);
      if (plano.gord_meta) _form.gkg.gordura     = +(plano.gord_meta / peso).toFixed(1);
    }
  } catch (e) { /* sem plano ainda */ }

  render();
  recalcularGet();
  _salvo = clonar(_form);      // baseline: abrir não conta como alteração
  pintar();
}

/**
 * Há edições pendentes? A ficha consulta antes de trocar de aba — trocar
 * substitui o innerHTML e levaria o formulário junto, sem aviso.
 */
export function caloriasSujo() {
  return !!_form && !!_salvo && sujo();
}

/** Solta o timer quando a aba é desmontada. */
export function encerrarCalorias() {
  if (_tickSalvo) { clearInterval(_tickSalvo); _tickSalvo = null; }
  _form = null; _salvo = null; _root = null;
}

// ───────────────────────────────────────────────────────────
// RENDER
// ───────────────────────────────────────────────────────────

function render() {
  _root.innerHTML = `
    <div class="cal">
      ${barraAcoes()}
      <div class="cal-grid">
        ${cardEnergetico()}
        ${cardMeta()}
        ${cardMacros()}
      </div>
      <div class="cal-barra-mobile">
        <span class="cal-status-m" id="calStatusM"></span>
        <button class="btn primary" id="calSalvarM" disabled><i data-lucide="save"></i> Salvar</button>
      </div>
    </div>`;
  ligarEventos();
}

function barraAcoes() {
  // A origem dos dados fica visível: medição de consulta e auto-relato do
  // paciente não têm o mesmo peso, e quem lê a tela precisa saber qual é.
  const av = _av?.data_avaliacao
    ? `Avaliação ${_av.numero} · ${fmtData(_av.data_avaliacao)}`
    : _antropo?.origem === 'anamnese'
      // Curto porque a barra é estreita; a ressalva completa ("informados
      // pelo paciente, confirme na avaliação") fica no bloco de importação,
      // logo abaixo e sempre visível.
      ? 'Sem avaliação · dados da anamnese'
      : 'Sem avaliação registrada';
  return `
    <div class="cal-head">
      <div class="cal-ident">
        <div class="cal-nome">Cálculo de calorias</div>
        <div class="cal-sub">${esc(av)}</div>
      </div>
      <div class="cal-head-r">
        <span class="cal-status" id="calStatus" role="status" aria-live="polite"></span>
        <button class="btn" id="calDescartar" disabled>Descartar</button>
        <button class="btn" id="calImportar"
                title="Preenche a partir da anamnese: peso, altura e atividade física">
          <i data-lucide="download"></i> Importar da anamnese
        </button>
        <button class="btn primary" id="calSalvar" disabled>
          <i data-lucide="save"></i> Salvar alterações
        </button>
      </div>
    </div>`;
}

function cardEnergetico() {
  return `
    <section class="cal-card" aria-labelledby="calTitEnerg">
      <h3 class="cal-card-tit" id="calTitEnerg"><i data-lucide="flame"></i> Cálculo energético</h3>

      <div class="cal-linha cal-linha-3">
        <div class="cal-campo">
          <label for="calPeso">Peso <span class="cal-un">kg</span></label>
          <input type="number" step="0.1" min="0" inputmode="decimal" id="calPeso" class="cal-input" data-campo="peso">
        </div>
        <div class="cal-campo">
          <label for="calFormula">Fórmula da TMB</label>
          <select id="calFormula" class="cal-input" data-campo="formula">
            ${FORMULAS.map(f => `<option value="${f.v}">${f.label}</option>`).join('')}
          </select>
        </div>
        <div class="cal-campo">
          <label for="calGet">GET <span class="cal-un">kcal/dia</span></label>
          <input type="number" step="1" min="0" inputmode="decimal" id="calGet" class="cal-input" data-campo="get">
        </div>
        <p class="cal-hint cal-hint-larga" id="calTmbNota" aria-live="polite"></p>
      </div>

      ${blocoAtividades()}

      <fieldset class="cal-obj">
        <legend>Objetivo</legend>
        <div class="cal-obj-grid">
          ${OBJETIVOS.map(o => `
            <label class="cal-obj-op">
              <input type="radio" name="calObjetivo" value="${o.v}" data-campo="objetivo">
              <span class="cal-obj-txt">
                <span class="cal-obj-l">${o.label}</span>
                <span class="cal-obj-a">${o.ajuste > 0 ? '+' : ''}${o.ajuste}% sobre o GET</span>
              </span>
            </label>`).join('')}
        </div>
      </fieldset>

      <div class="cal-linha cal-linha-1">
        <div class="cal-campo">
          <label for="calAjuste">Ajuste sobre o GET <span class="cal-un">%</span></label>
          <div class="cal-step-wrap">
            <input type="number" step="1" inputmode="decimal" id="calAjuste" class="cal-input" data-campo="ajuste">
            <div class="cal-step">
              <button type="button" class="cal-step-b" data-step="up" data-alvo="ajuste" tabindex="-1"
                      aria-label="Aumentar o ajuste sobre o GET"><i data-lucide="chevron-up"></i></button>
              <button type="button" class="cal-step-b" data-step="down" data-alvo="ajuste" tabindex="-1"
                      aria-label="Diminuir o ajuste sobre o GET"><i data-lucide="chevron-down"></i></button>
            </div>
          </div>
        </div>
      </div>

      <details class="cal-det">
        <summary><i data-lucide="chevron-right"></i> Ver detalhes do cálculo</summary>
        <div class="cal-det-corpo" id="calDetCorpo"></div>
      </details>
    </section>`;
}

/**
 * Modo aditivo: cada atividade entra separada e o gasto médio diário é somado
 * ao GET. Com ele ligado o fator da rotina sai de cena e entra a BASE sem
 * exercício — os dois modelos contariam o treino duas vezes se somados.
 */
function blocoAtividades() {
  const met = _form.modoAtiv === 'met';
  const fat = _form.modoAtiv === 'fator';
  return `
    <div class="cal-ativ">
      <div class="cal-ativ-hd">
        <span class="cal-ativ-tit">Lançar fator atividade física:</span>
        <div class="cal-seg" role="group" aria-label="Modelo de atividade física">
          <button type="button" data-modoativ="fator" aria-pressed="${fat}">Fator único</button>
          <button type="button" data-modoativ="met" aria-pressed="${met}">Somar atividades</button>
        </div>
      </div>
      <!-- O botão de importar vive na barra de ações do topo; aqui fica só o
           resultado, perto dos campos que ele preencheu. -->
      <div id="calImportInfo"></div>
      <div class="cal-ativ-fator" ${fat ? '' : 'hidden'}>
        <label for="calFator">Nível de atividade da rotina</label>
        <select id="calFator" class="cal-input" data-campo="fator">
          ${FATORES.map(f => `<option value="${f.v}">${f.label} (${String(f.v).replace('.', ',')})</option>`).join('')}
        </select>
      </div>

      <div class="cal-ativ-corpo" ${met ? '' : 'hidden'}>
        <div class="cal-ativ-base">
          <label for="calFatorBase">Rotina sem exercício (dia a dia)</label>
          <select id="calFatorBase" class="cal-input" data-campo="fatorBase">
            ${FATORES.map(f => `<option value="${f.v}">${f.label} (${String(f.v).replace('.', ',')})</option>`).join('')}
          </select>
        </div>
        <div class="cal-ativ-cab" aria-hidden="true">
          <span>Atividade</span><span>Intensidade</span><span>Tempo (min)</span><span>×/semana</span><span></span><span></span>
        </div>
        <div class="cal-ativ-lista" id="calAtivLista"></div>
        <button type="button" class="btn" id="calAtivAdd"><i data-lucide="plus"></i> Adicionar atividade</button>
        <div class="cal-ativ-total" id="calAtivTotal"></div>
        <p class="cal-hint">A base cobre trabalho, casa e deslocamento — o exercício NÃO entra nela, vem somado das atividades abaixo.</p>
      </div>
    </div>`;
}

function linhaAtividadeHtml(a, i, calc) {
  const opcoes = ATIVIDADES_ORDENADAS.map(x =>
    `<option value="${esc(x.nome)}" ${x.nome === a.nome ? 'selected' : ''}>${esc(x.nome)}</option>`).join('');

  const at = atividadePorNome(a.nome);
  const intens = (at?.intensidades || []).map(x =>
    `<option value="${esc(x.label)}" ${x.label === a.intensidade ? 'selected' : ''}>
      ${esc(x.label)} · MET ${String(x.met).replace('.', ',')}
    </option>`).join('');

  return `
    <div class="cal-ativ-linha" data-ativ-i="${i}">
      <select class="cal-input" data-ativ-campo="nome" data-ativ-i="${i}" aria-label="Atividade ${i + 1}">
        ${opcoes}
      </select>
      <select class="cal-input" data-ativ-campo="intensidade" data-ativ-i="${i}"
              aria-label="Intensidade da atividade ${i + 1}" ${(at?.intensidades.length || 0) < 2 ? 'disabled' : ''}>
        ${intens}
      </select>
      <input type="number" min="0" step="5" inputmode="numeric"
             class="cal-input" value="${a.minutos}" data-ativ-campo="minutos" data-ativ-i="${i}"
             aria-label="Tempo em minutos da atividade ${i + 1}">
      <input type="number" min="0" max="14" step="1" inputmode="numeric"
             class="cal-input" value="${a.vezesSemana}" data-ativ-campo="vezesSemana" data-ativ-i="${i}"
             aria-label="Vezes por semana da atividade ${i + 1}">
      <span class="cal-ativ-kcal">${fmtKcal(calc.kcalSemana)} kcal/sem</span>
      <button type="button" class="cal-ativ-x" data-ativ-del="${i}" aria-label="Remover atividade ${i + 1}">
        <i data-lucide="x"></i>
      </button>
    </div>`;
}

function cardMacros() {
  const bloco = m => `
    <div class="cal-macro" data-macro="${m.id}">
      <div class="cal-macro-top">
        <span class="cal-macro-nome">${m.label}</span>
        <button type="button" class="cal-lock" data-lock="${m.id}" aria-pressed="false"
                title="Congelar ${m.label.toLowerCase()}">
          <i data-lucide="lock-open"></i>
        </button>
      </div>
      <div class="cal-macro-in">
        <input type="number" min="0" inputmode="decimal" id="calM_${m.id}"
               class="cal-input" data-macro-input="${m.id}" aria-label="${m.label}">
        <span class="cal-macro-un" aria-hidden="true"></span>
        <div class="cal-step">
          <button type="button" class="cal-step-b" data-step="up" data-alvo="${m.id}" tabindex="-1"
                  aria-label="Aumentar ${m.label.toLowerCase()}"><i data-lucide="chevron-up"></i></button>
          <button type="button" class="cal-step-b" data-step="down" data-alvo="${m.id}" tabindex="-1"
                  aria-label="Diminuir ${m.label.toLowerCase()}"><i data-lucide="chevron-down"></i></button>
        </div>
      </div>
      <div class="cal-macro-g" id="calG_${m.id}">—</div>
      <div class="cal-macro-sub" id="calS_${m.id}">—</div>
      <div class="cal-barra"><span id="calB_${m.id}"></span></div>
    </div>`;

  return `
    <section class="cal-card" aria-labelledby="calTitMacro">
      <div class="cal-card-head">
        <h3 class="cal-card-tit" id="calTitMacro"><i data-lucide="chart-pie"></i> Distribuição de macronutrientes</h3>
        <div class="cal-seg" role="group" aria-label="Unidade dos macronutrientes">
          <button type="button" data-modo="gkg" aria-pressed="true">g/kg</button>
          <button type="button" data-modo="pct" aria-pressed="false">%</button>
        </div>
      </div>

      <div class="cal-macros">${MACRO_DEF.map(bloco).join('')}</div>

      <div id="calAviso"></div>

      <div class="cal-cta">
        <button class="btn primary cal-cta-b" id="calGerar">
          <i data-lucide="wand-sparkles"></i> Gerar plano completo
        </button>
        <p class="cal-cta-why" id="calGerarWhy"></p>
      </div>
      <p class="cal-msg" id="calMsg" role="status" aria-live="polite"></p>
    </section>`;
}

function cardMeta() {
  return `
    <section class="cal-meta" aria-labelledby="calMetaTit">
      <h3 class="cal-meta-tit" id="calMetaTit">Meta calórica</h3>
      <div class="cal-meta-topo">
        <div class="cal-meta-big"><strong id="calMeta">—</strong><span>kcal/dia</span></div>
        <div class="cal-badge" id="calBadge">—</div>
      </div>

      <div class="cal-comp">
        <div class="cal-comp-linha">
          <span class="cal-comp-rot">GET</span>
          <div class="cal-comp-bar" aria-hidden="true"><span id="calCompBarGet"></span></div>
          <span class="cal-comp-v" id="calCompGet">—</span>
        </div>
        <div class="cal-comp-linha">
          <span class="cal-comp-rot">Meta</span>
          <div class="cal-comp-bar" aria-hidden="true"><span id="calCompBarMeta"></span></div>
          <span class="cal-comp-v forte" id="calCompMeta">—</span>
        </div>
        <p class="cal-comp-dif" id="calCompDif"></p>
      </div>

      <dl class="cal-meta-lista">
        <div><dt>GET</dt><dd id="calResGet">—</dd></div>
        <div><dt>Objetivo</dt><dd id="calResObj">—</dd></div>
        <div><dt>Ajuste</dt><dd id="calResAj">—</dd></div>
        <div><dt id="calResRitmoL">Variação estimada</dt><dd id="calResRitmo">—</dd></div>
      </dl>
      <div class="cal-meta-alerta" id="calMetaAlerta" hidden></div>
    </section>`;
}

// ───────────────────────────────────────────────────────────
// EVENTOS
// ───────────────────────────────────────────────────────────

function ligarEventos() {
  _root.querySelector('#calSalvar').addEventListener('click', salvar);
  _root.querySelector('#calSalvarM').addEventListener('click', salvar);
  _root.querySelector('#calDescartar').addEventListener('click', descartar);
  _root.querySelector('#calGerar').addEventListener('click', gerarPlanoCompleto);

  _root.querySelectorAll('[data-campo]').forEach(el => {
    el.addEventListener('input', () => {
      const c = el.dataset.campo;
      _form[c] = el.value;
      if (c === 'objetivo') {
        const o = OBJETIVOS.find(x => x.v === el.value);
        if (o) { _form.ajuste = o.ajuste; _root.querySelector('#calAjuste').value = o.ajuste; }
      }
      if (c === 'fator') _form.fator = num(el.value) || FATOR_PADRAO;   // select devolve string
      if (c === 'fatorBase') _form.fatorBase = num(el.value) || FATOR_PADRAO;
      if (c === 'peso' || c === 'formula' || c === 'fator' || c === 'fatorBase') recalcularGet();
      pintar();
    });
  });

  _root.querySelector('#calImportar')?.addEventListener('click', importarDaAnamnese);

  _root.querySelectorAll('[data-macro-input]').forEach(el => {
    el.addEventListener('input', () => {
      _form[_form.modo][el.dataset.macroInput] = num(el.value);
      pintar();
    });
  });

  // Delegação: os <i data-lucide> viram <svg> depois da renderização e um
  // handler preso no ícone morreria junto com o nó trocado (index.html:13).
  _root.addEventListener('click', (ev) => {
    const lock = ev.target.closest?.('.cal-lock');
    if (lock) { alternarTrava(lock.dataset.lock); return; }

    const st = ev.target.closest?.('.cal-step-b');
    if (st?.dataset.alvo === 'ajuste') { passoAjuste(st.dataset.step); return; }
    if (st) { passo(st.dataset.alvo, st.dataset.step); return; }

    const seg = ev.target.closest?.('.cal-seg button');
    if (seg?.dataset.modoativ) { setModoAtiv(seg.dataset.modoativ); return; }
    if (seg?.dataset.modo) { setModo(seg.dataset.modo); return; }

    const add = ev.target.closest?.('#calAtivAdd');
    if (add) { addAtividade(); return; }

    const del = ev.target.closest?.('[data-ativ-del]');
    if (del) { delAtividade(Number(del.dataset.ativDel)); return; }
  });

  // Campos das atividades: delegado porque a lista é re-renderizada.
  _root.addEventListener('input', (ev) => {
    const el = ev.target.closest?.('[data-ativ-campo]');
    if (!el) return;
    const i = Number(el.dataset.ativI);
    const campo = el.dataset.ativCampo;
    if (!_form.atividades[i]) return;
    if (campo === 'nome') {
      _form.atividades[i].nome = el.value;
      // intensidade da atividade anterior não existe na nova: volta para a 1ª
      _form.atividades[i].intensidade = atividadePorNome(el.value)?.intensidades[0]?.label || '';
    } else if (campo === 'intensidade') {
      _form.atividades[i].intensidade = el.value;
    } else {
      _form.atividades[i][campo] = num(el.value) || 0;
    }
    recalcularGet();
    pintar();
  });
}

function setModoAtiv(modo) {
  if (_form.modoAtiv === modo) return;
  _form.modoAtiv = modo;
  if (modo === 'met') {
    _form.fator = FATOR_PADRAO;                    // sem contagem dupla
    if (!_form.atividades.length) addAtividade(false);
  }
  const corpo = _root.querySelector('.cal-ativ-corpo');
  if (corpo) corpo.hidden = modo !== 'met';
  const bloco = _root.querySelector('.cal-ativ-fator');
  if (bloco) bloco.hidden = modo !== 'fator';
  _root.querySelectorAll('[data-modoativ]').forEach(b =>
    b.setAttribute('aria-pressed', b.dataset.modoativ === modo ? 'true' : 'false'));
  recalcularGet();
  pintar();
}

function addAtividade(repintar = true) {
  _form.atividades.push({ nome: 'Musculação', intensidade: 'Moderada', minutos: 60, vezesSemana: 3 });
  if (repintar) { recalcularGet(); pintar(); }
}

function delAtividade(i) {
  _form.atividades.splice(i, 1);
  recalcularGet();
  pintar();
}

function setModo(modo) {
  if (_form.modo === modo) return;
  _form.modo = modo;
  _root.querySelectorAll('.cal-seg button').forEach(b =>
    b.setAttribute('aria-pressed', b.dataset.modo === modo ? 'true' : 'false'));
  pintar();
}

function alternarTrava(macro) {
  const i = _form.travas.indexOf(macro);
  if (i >= 0) _form.travas.splice(i, 1); else _form.travas.push(macro);
  pintar();
}

/**
 * Passo do ajuste sobre o GET, de 1 em 1 ponto percentual. Diferente dos
 * macros, aceita valor NEGATIVO — é um déficit — então não há piso em zero.
 * Os limites só evitam absurdo aritmético (−100% zeraria a meta).
 */
function passoAjuste(dir) {
  const atual = num(_form.ajuste) || 0;
  _form.ajuste = Math.max(-90, Math.min(100, atual + (dir === 'up' ? 1 : -1)));
  pintar();
}

/** Passo do stepper. Respeita a trava e normaliza o ruído de ponto flutuante. */
function passo(macro, dir) {
  if (_form.travas.includes(macro)) return;
  const step = _form.modo === 'gkg' ? 0.1 : 1;
  const atual = _form[_form.modo][macro] || 0;
  const novo = Math.max(0, atual + (dir === 'up' ? step : -step));
  _form[_form.modo][macro] = step < 1 ? +novo.toFixed(1) : Math.round(novo);
  pintar();
}

// ───────────────────────────────────────────────────────────
// CÁLCULO + PINTURA
// ───────────────────────────────────────────────────────────

function recalcularGet() {
  const nota = _root.querySelector('#calTmbNota');
  if (!_antropo) {
    if (nota) nota.textContent = _av
      ? 'Sem avaliação: informe o GET manualmente.'
      : 'Sem avaliação física. Use "Importar da anamnese" se o paciente já respondeu, ou informe o GET manualmente.';
    return;
  }

  // No modo aditivo o fator de rotina NÃO pode ser o mesmo do modo único: o
  // multiplicador de lá já embute o treino, e o treino aqui entra somado.
  // Usa-se a base sem exercício (--fatorBase, 1,2 por padrão).
  const fator = _form.modoAtiv === 'met'
    ? (num(_form.fatorBase) || FATOR_PADRAO)
    : (num(_form.fator) || FATOR_PADRAO);
  const tmb = tmbPorFormula(_form.formula, {
    peso: num(_form.peso),
    alturaCm: _antropo.alturaCm,
    idade: _antropo.idade,
    sexo: _antropo.sexo,
    pctGordura: _antropo.pctGordura,
  });

  if (tmb == null) {
    if (nota) nota.textContent = _form.formula === 'katch'
      ? 'Katch-McArdle precisa do % de gordura (avaliação com dobras). GET mantido.'
      : 'Faltam dados da avaliação (idade/altura/sexo) para esta fórmula. GET mantido.';
    return;
  }

  const extra = _form.modoAtiv === 'met'
    ? gastoDeAtividades(_form.atividades, num(_form.peso)).kcalDia : 0;

  _form.get = String(getDe(tmb, fator) + Math.round(extra));
  const getEl = _root.querySelector('#calGet');
  if (getEl) getEl.value = _form.get;
  // Deu certo: nada escrito. A nota só existe para explicar falha.
  if (nota) nota.textContent = '';
  _form._tmb = Math.round(tmb);
}

function estado() {
  const peso = num(_form.peso);
  const get = num(_form.get);
  const ajuste = num(_form.ajuste);
  const meta = metaDe(get, ajuste);
  const macros = calcularMacros({ modo: _form.modo, meta, peso, valores: _form[_form.modo] });
  return { peso, get, ajuste, meta, macros, status: statusAjuste(ajuste), ritmo: ritmoSemanal(meta, get, peso) };
}

function pintar() {
  const s = estado();
  const q = sel => _root.querySelector(sel);
  const txt = (sel, v) => { const el = q(sel); if (el) el.textContent = v; };
  const setV = (sel, v) => { const el = q(sel); if (el && el.value !== String(v)) el.value = v; };

  setV('#calPeso', _form.peso);
  setV('#calGet', _form.get);
  setV('#calAjuste', _form.ajuste);
  const fEl = q('#calFormula'); if (fEl) fEl.value = _form.formula;
  const aEl = q('#calFator'); if (aEl) aEl.value = String(_form.fator);
  const bEl = q('#calFatorBase'); if (bEl) bEl.value = String(_form.fatorBase);
  pintarAtividades(q);
  // o objetivo virou grupo de rádios: marca o que corresponde ao estado
  const oEl = q(`input[name="calObjetivo"][value="${_form.objetivo}"]`);
  if (oEl && !oEl.checked) oEl.checked = true;

  // ── macros ──
  const un = _form.modo === 'gkg' ? 'g/kg' : '%';
  for (const m of MACRO_DEF) {
    const travado = _form.travas.includes(m.id);
    const inp = q(`[data-macro-input="${m.id}"]`);
    if (inp) {
      const v = _form[_form.modo][m.id];
      if (num(inp.value) !== v) inp.value = v;
      inp.readOnly = travado;
      inp.step = _form.modo === 'gkg' ? '0.1' : '1';
      inp.setAttribute('aria-label', `${m.label} em ${un}`);
    }
    const bloco = q(`.cal-macro[data-macro="${m.id}"]`);
    if (bloco) {
      bloco.classList.toggle('travado', travado);
      bloco.querySelectorAll('.cal-step-b').forEach(b => { b.disabled = travado; });
      const u = bloco.querySelector('.cal-macro-un'); if (u) u.textContent = un;
    }
    const lock = q(`[data-lock="${m.id}"]`);
    if (lock) {
      lock.classList.toggle('travado', travado);
      lock.setAttribute('aria-pressed', travado ? 'true' : 'false');
      lock.title = `${travado ? 'Destravar' : 'Congelar'} ${m.label.toLowerCase()}`;
      lock.innerHTML = `<i data-lucide="${travado ? 'lock' : 'lock-open'}"></i>`;
    }
    txt(`#calG_${m.id}`, `${Math.round(s.macros.gramas[m.id])} g`);
    txt(`#calS_${m.id}`, `${fmtKcal(s.macros.kcalPorMacro[m.id])} kcal · ${Math.round(s.macros.somaPct[m.id])}%`);
    const barra = q(`#calB_${m.id}`);
    if (barra) barra.style.width = Math.min(100, Math.round(s.macros.somaPct[m.id])) + '%';
  }

  pintarAviso(s);

  const btnGerar = q('#calGerar');
  if (btnGerar) btnGerar.disabled = !s.macros.bate;
  txt('#calGerarWhy', s.macros.bate ? '' :
    !s.meta ? 'Informe o GET para calcular a meta.'
      : 'Os macronutrientes precisam somar a meta calórica.');

  // ── card de meta ──
  txt('#calMeta', s.meta ? fmtKcal(s.meta) : '—');
  txt('#calResGet', s.get ? `${fmtKcal(s.get)} kcal/dia` : '—');
  txt('#calResObj', OBJETIVOS.find(o => o.v === _form.objetivo)?.label || '—');
  txt('#calResAj', (s.ajuste > 0 ? '+' : '') + s.ajuste + '%');
  txt('#calResRitmoL', s.ajuste < 0 ? 'Perda estimada' : s.ajuste > 0 ? 'Ganho estimado' : 'Variação estimada');
  // Em gramas: "420 g/semana" pesa mais na leitura do que "0,42 kg/semana".
  txt('#calResRitmo', s.ajuste === 0 || !s.get ? 'Manutenção do peso'
    : `${fmtKcal(s.ritmo.kgSemana * 1000)} g/semana`);

  const badge = q('#calBadge');
  if (badge) { badge.textContent = s.status.label; badge.dataset.tom = s.status.tom; }

  // Duas barras na MESMA escala: assim o déficit (meta menor) e o superávit
  // (meta maior) se leem do mesmo jeito, sem inverter o significado da barra.
  txt('#calCompGet', s.get ? `${fmtKcal(s.get)} kcal` : '—');
  txt('#calCompMeta', s.meta ? `${fmtKcal(s.meta)} kcal` : '—');
  const maior = Math.max(s.get || 0, s.meta || 0) || 1;
  const bGet = q('#calCompBarGet');
  if (bGet) bGet.style.width = Math.round((s.get || 0) / maior * 100) + '%';
  const bMeta = q('#calCompBarMeta');
  if (bMeta) {
    bMeta.style.width = Math.round((s.meta || 0) / maior * 100) + '%';
    bMeta.dataset.tom = s.status.tom;
  }
  const dif = q('#calCompDif');
  if (dif) {
    const d = Math.round(s.ritmo.kcalDia);
    dif.textContent = !s.get || !s.meta ? ''
      : d === 0 ? 'Meta igual ao gasto estimado'
        : `${fmtKcal(Math.abs(d))} kcal/dia ${d < 0 ? 'abaixo' : 'acima'} do gasto`;
    dif.dataset.tom = s.status.tom;
  }

  const alerta = q('#calMetaAlerta');
  if (alerta) {
    let t = '';
    if (s.ajuste <= -25) t = 'Déficit acima de 25%: maior risco de perda de massa magra e menor adesão. Prefira ciclos curtos e proteína alta.';
    else if (s.ajuste >= 20) t = 'Superávit acima de 20%: tende a gerar mais gordura. Para treinados, +5 a +10% costuma bastar.';
    alerta.hidden = !t;
    alerta.textContent = t;
  }

  // ── detalhes ──
  const det = q('#calDetCorpo');
  if (det) {
    const f = FORMULAS.find(x => x.v === _form.formula)?.label || _form.formula;
    det.innerHTML = `
      <dl class="cal-det-lista">
        <div><dt>Fórmula</dt><dd>${esc(f)}</dd></div>
        <div><dt>TMB</dt><dd>${_form._tmb ? fmtKcal(_form._tmb) + ' kcal/dia' : '—'}</dd></div>
        <div><dt>Atividade física</dt><dd>${esc(FATORES.find(x => x.v === _form.fator)?.label || '—')} (${String(_form.fator).replace('.', ',')})</dd></div>
        <div><dt>GET</dt><dd>${s.get ? fmtKcal(s.get) + ' kcal/dia' : '—'}</dd></div>
        <div><dt>Ajuste aplicado</dt><dd>${(s.ajuste > 0 ? '+' : '') + s.ajuste}% → ${s.meta ? fmtKcal(s.meta) : '—'} kcal/dia</dd></div>
        <div><dt>${s.ritmo.kcalDia < 0 ? 'Déficit' : 'Superávit'} diário</dt><dd>${fmtKcal(Math.abs(s.ritmo.kcalDia))} kcal</dd></div>
        <div><dt>Estimativa semanal</dt><dd>${fmtKcal(Math.abs(s.ritmo.kcalDia) * 7)} kcal ≈ ${fmtKcal(s.ritmo.kgSemana * 1000)} g</dd></div>
        <div><dt>Total distribuído</dt><dd>${fmtKcal(s.macros.totalKcal)} kcal (tolerância ±${Math.round(s.macros.tol)})</dd></div>
      </dl>
      <p class="cal-det-nota">A estimativa semanal usa 7.700 kcal ≈ 1 kg de tecido adiposo: <strong>referência de planejamento, não garantia de resultado</strong>.</p>`;
  }

  pintarStatusSalvo();
}

/**
 * Lista de atividades + total. Re-renderiza o HTML inteiro da lista, mas só
 * quando o modo aditivo está ligado — evita reconstruir o que está escondido.
 */
function pintarAtividades(q) {
  if (_form.modoAtiv !== 'met') return;
  const lista = q('#calAtivLista');
  const total = q('#calAtivTotal');
  if (!lista) return;

  const g = gastoDeAtividades(_form.atividades, num(_form.peso));

  // Não recria enquanto o nutri digita: só o foco perdido justificaria.
  const focado = document.activeElement?.dataset?.ativCampo;
  if (!focado) {
    lista.innerHTML = _form.atividades
      .map((a, i) => linhaAtividadeHtml(a, i, g.porAtividade[i])).join('');
  } else {
    // Atualiza só os números, preservando o campo em edição.
    _form.atividades.forEach((a, i) => {
      const el = lista.querySelector(`.cal-ativ-linha[data-ativ-i="${i}"] .cal-ativ-kcal`);
      if (el) el.textContent = `${fmtKcal(g.porAtividade[i].kcalSemana)} kcal/sem`;
    });
  }

  if (total) {
    total.innerHTML = _form.atividades.length
      ? `<strong>${fmtKcal(g.kcalSemana)} kcal/semana</strong>
         <span>= ${fmtKcal(g.kcalDia)} kcal/dia somadas ao GET</span>`
      : `<span>Nenhuma atividade lançada.</span>`;
  }
}

function pintarAviso(s) {
  const box = _root.querySelector('#calAviso');
  if (!box) return;
  if (!s.meta || s.macros.bate) {
    box.innerHTML = s.meta ? `
      <div class="cal-ok"><i data-lucide="check-circle-2"></i>
        <span>Distribuição fecha com a meta — <strong>${fmtKcal(s.macros.totalKcal)} kcal</strong> distribuídas.</span>
      </div>` : '';
    return;
  }

  const dif = Math.round(s.macros.dif);
  const acima = dif > 0;
  box.innerHTML = `
    <div class="cal-alerta" data-tom="${acima ? 'erro' : 'aviso'}" role="alert">
      <div class="cal-alerta-h">
        <i data-lucide="${acima ? 'alert-triangle' : 'info'}"></i>
        <strong>Distribuição ${acima ? 'acima' : 'abaixo'} da meta</strong>
      </div>
      <dl class="cal-alerta-n">
        <div><dt>Meta</dt><dd>${fmtKcal(s.meta)} kcal</dd></div>
        <div><dt>Distribuído</dt><dd>${fmtKcal(s.macros.totalKcal)} kcal</dd></div>
        <div><dt>${acima ? 'Excesso' : 'Faltam'}</dt><dd>${fmtKcal(Math.abs(dif))} kcal</dd></div>
      </dl>
      <p class="cal-alerta-msg">Ajuste os macronutrientes até a soma fechar a meta.</p>
    </div>`;
}

/** "Alterações não salvas" / "Salvo há X" — texto, não só cor. */
function pintarStatusSalvo() {
  const d = sujo();
  const el = _root.querySelector('#calStatus');
  const elM = _root.querySelector('#calStatusM');
  let t = '', tom = '';
  if (d) { t = 'Alterações não salvas'; tom = 'aviso'; }
  else if (_salvoEm) {
    const seg = Math.round((Date.now() - _salvoEm) / 1000);
    t = seg < 60 ? 'Salvo há poucos segundos'
      : seg < 3600 ? `Salvo há ${Math.floor(seg / 60)} min`
        : 'Salvo';
    tom = 'ok';
  }
  if (el) { el.textContent = t; el.dataset.tom = tom; }
  if (elM) { elM.textContent = t; elM.dataset.tom = tom; }

  const s = estado();
  const sv = _root.querySelector('#calSalvar'); if (sv) sv.disabled = !d || !s.meta;
  const svm = _root.querySelector('#calSalvarM'); if (svm) svm.disabled = !d || !s.meta;
  const ds = _root.querySelector('#calDescartar'); if (ds) ds.disabled = !d;
}

// ───────────────────────────────────────────────────────────
// AÇÕES
// ───────────────────────────────────────────────────────────

/**
 * Traz o que a anamnese já sabe sobre a rotina do paciente: nível do dia a dia
 * e as atividades praticadas (frequência + intensidade).
 *
 * NÃO salva nada — preenche o formulário para o profissional conferir e
 * corrigir. É de propósito: a anamnese é auto-relato, e a duração da sessão
 * nem sequer é perguntada lá (entra estimada).
 */
async function importarDaAnamnese() {
  const btn = _root.querySelector('#calImportar');
  const caixa = _root.querySelector('#calImportInfo');
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Buscando...';
  try {
    const [m10, m1, m4] = await Promise.all([
      buscarRespostasModulo(_paciente.id, 'm10'),
      buscarRespostasModulo(_paciente.id, 'm1'),
      buscarRespostasModulo(_paciente.id, 'm4'),
    ]);
    const r = mapearAtividadeFisica(m10);
    const antro = mapearAntropometria(m1, m4);

    if (!r.respondeu && !antro.completa) {
      caixa.innerHTML = `<div class="cal-import cal-import-vazio">
        <i data-lucide="info"></i> Este paciente ainda não respondeu o módulo de atividade física da anamnese.</div>`;
      return;
    }

    // Sobrescrever a lista atual é destrutivo: confirma antes.
    if (_form.atividades.length && r.atividades.length) {
      const ok = await confirmar({
        titulo: 'Substituir atividades',
        mensagem: `A tela já tem ${_form.atividades.length} atividade(s) lançada(s). Importar da anamnese vai substituí-las.`,
        textoOk: 'Substituir',
      });
      if (!ok) return;
    }

    // Antropometria: SÓ preenche se não há avaliação física. A avaliação é
    // medição de consulta e continua mandando — auto-relato não a sobrescreve.
    let antroImportada = false;
    if (!_av && antro.completa) {
      _antropo = {
        alturaCm: antro.alturaCm, idade: antro.idade, sexo: antro.sexo,
        pctGordura: null,          // a anamnese não mede dobras
        origem: 'anamnese',
      };
      _form.peso = String(antro.peso);
      antroImportada = true;
    }

    if (r.neat.fator) _form.fatorBase = r.neat.fator;
    if (r.atividades.length) {
      _form.atividades = clonar(r.atividades);
      _form.modoAtiv = 'met';
    } else if (r.neat.fator) {
      // Não pratica exercício: o nível do dia a dia é a resposta inteira.
      _form.fator = r.neat.fator;
      _form.modoAtiv = 'fator';
    }

    // O recordatório é REFERÊNCIA, não meta: mostra o que a pessoa come hoje,
    // para o profissional comparar com o GET calculado. Sub-relato é comum.
    let rec = null;
    try { rec = await buscarRecordatorio(_paciente.id); } catch (e) { /* opcional */ }

    render();
    recalcularGet();
    pintar();

    const infoAntro = antroImportada
      ? `<div class="cal-import-linha"><i data-lucide="ruler"></i>
           <span>Antropometria da anamnese: <strong>${antro.peso} kg</strong> · ${antro.alturaCm} cm ·
           ${antro.idade} anos · ${antro.sexo === 'M' ? 'masculino' : 'feminino'}.
           São dados <strong>informados pelo paciente</strong> — confirme na avaliação física.</span></div>`
      : (!_av && !antro.completa)
        ? `<div class="cal-import-linha"><i data-lucide="triangle-alert"></i>
             <span>Sem avaliação física e a anamnese não tem peso/altura/idade/sexo completos —
             o GET precisa ser informado à mão.</span></div>`
        : (_av && antro.completa)
          ? `<div class="cal-import-linha"><i data-lucide="ruler"></i>
               <span>Peso e altura vieram da <strong>avaliação física</strong>, que tem precedência
               sobre o que o paciente informou na anamnese.</span></div>`
          : '';

    const infoNeat = r.neat.rotulo
      ? `Dia a dia: <strong>${esc(r.neat.rotulo)}</strong> (fator ${String(r.neat.fator).replace('.', ',')}).`
      : 'A anamnese não trouxe o nível de atividade diária.';
    const infoAtiv = r.atividades.length
      ? `${r.atividades.length} atividade(s) importada(s).`
      : (r.praticaRegularmente ? 'Nenhuma atividade pôde ser traduzida.' : 'Não pratica exercício regularmente.');
    const infoRec = rec?.kcal_total
      ? `<div class="cal-import-rec"><i data-lucide="utensils"></i>
           Recordatório da anamnese: <strong>${fmtKcal(rec.kcal_total)} kcal/dia</strong>
           (P ${Math.round(rec.prot_g)} · C ${Math.round(rec.carb_g)} · G ${Math.round(rec.gord_g)}).
           É o consumo relatado, não a meta — compare com o GET ao lado.</div>`
      : '';

    _root.querySelector('#calImportInfo').innerHTML = `
      <div class="cal-import">
        <div class="cal-import-hd"><i data-lucide="circle-check"></i> Importado da anamnese</div>
        ${infoAntro}
        <div class="cal-import-linha">${infoNeat} ${esc(infoAtiv)}</div>
        ${r.avisos.length ? `<ul class="cal-import-avisos">${
          r.avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
        ${infoRec}
      </div>`;
    window.renderIcons?.();
    mostrarToast('✓ Dados da anamnese carregados — confira antes de salvar');
  } catch (e) {
    // Sem o console.warn a mensagem genérica esconderia erro de programação
    // (foi assim que um import faltando virou "não foi possível ler").
    console.warn('Importar da anamnese falhou:', e);
    _root.querySelector('#calImportInfo').innerHTML =
      `<div class="cal-import cal-import-vazio"><i data-lucide="triangle-alert"></i> Não foi possível ler a anamnese.</div>`;
    window.renderIcons?.();
  } finally {
    // Re-consulta: render() troca o DOM, e o `btn` capturado no início pode
    // estar apontando para um nó já descartado.
    const atual = _root.querySelector('#calImportar');
    if (atual) { atual.disabled = false; atual.innerHTML = orig; }
    window.renderIcons?.();
  }
}

async function salvar() {
  const s = estado();
  if (!s.meta) { mostrarToast('Informe o GET para calcular a meta'); return; }

  // Os dois botões travam juntos: só um está visível por vez, e deixar o
  // outro ativo permitiria envio duplicado.
  const btn = _root.querySelector('#calSalvar');
  const btnM = _root.querySelector('#calSalvarM');
  const orig = btn.innerHTML, origM = btnM.innerHTML;
  btn.disabled = btnM.disabled = true;
  btn.textContent = btnM.textContent = 'Salvando...';
  try {
    const metas = {
      kcal_meta: s.meta,
      prot_meta: Math.round(s.macros.gramas.proteina),
      carb_meta: Math.round(s.macros.gramas.carboidrato),
      gord_meta: Math.round(s.macros.gramas.gordura),
      objetivo: OBJETIVOS.find(o => o.v === _form.objetivo)?.label || null,
    };

    const planos = await listarPlanosDoPaciente(_paciente.id);
    if (!planos.length) {
      await criarPlano(_nutriId, { nome: 'Plano alimentar', ativo: true, paciente_id: _paciente.id, ...metas });
      mostrarToast('✓ Plano criado com as metas');
    } else {
      const plano = planos.find(p => p.ativo) || planos[0];
      await atualizarPlano(plano.id, metas);
      mostrarToast('✓ Metas salvas');
    }
    _salvo = clonar(_form);
    _salvoEm = Date.now();
    if (!_tickSalvo) _tickSalvo = setInterval(pintarStatusSalvo, 30000);
  } catch (e) {
    mostrarToast('Erro ao salvar: ' + e.message);
  } finally {
    btn.innerHTML = orig; btnM.innerHTML = origM;
    pintar();            // devolve o disabled ao estado real do formulário
  }
}

async function descartar() {
  if (!sujo()) return;
  if (!(await confirmar({
    titulo: 'Descartar alterações',
    mensagem: 'Os campos voltam ao último estado salvo.',
    textoOk: 'Descartar',
  }))) return;
  _form = clonar(_salvo);
  pintar();
  mostrarToast('Alterações descartadas');
}

async function gerarPlanoCompleto() {
  const s = estado();
  if (!s.macros.bate) {
    const d = Math.round(s.macros.dif);
    mostrarToast(`Macros ${d > 0 ? 'passam' : 'faltam'} ${Math.abs(d)} kcal da meta`);
    return;
  }

  const btn = _root.querySelector('#calGerar');
  const msg = _root.querySelector('#calMsg');
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Gerando...';
  try {
    const catalogo = await catalogoParaGerador();
    const faltam = faltandoNoCatalogo(catalogo);
    if (faltam.length) {
      if (msg) msg.textContent =
        `Faltam ${faltam.length} alimentos no catálogo (ex.: ${faltam.slice(0, 3).join(', ')}). ` +
        `Rode db/foods_gerador_seed.sql no Supabase.`;
      mostrarToast('Catálogo incompleto');
      return;
    }

    const planos = await listarPlanosDoPaciente(_paciente.id);
    if (planos.length && !(await confirmar({
      titulo: 'Gerar novo plano',
      mensagem: `${_paciente.nome} já tem ${planos.length} plano(s). ` +
        `Gerar cria um plano NOVO e desativa o atual — nada é apagado.`,
      textoOk: 'Gerar',
    }))) return;

    const { plano, resultado } = await gerarPlanoParaPaciente(_nutriId, {
      pacienteId: _paciente.id,
      nome: `Plano ${fmtKcal(s.meta)} kcal`,
      objetivo: OBJETIVOS.find(o => o.v === _form.objetivo)?.label || null,
      templateId: TEMPLATES[0].id,
      // kcal vem da SOMA dos macros, não da meta: dentro da tolerância os dois
      // diferem por algumas kcal, e mandar dois alvos discordantes ao motor foi
      // exatamente o que produziu planos 33% fora antes.
      metas: {
        kcal: Math.round(s.macros.totalKcal),
        prot: Math.round(s.macros.gramas.proteina),
        carb: Math.round(s.macros.gramas.carboidrato),
        gord: Math.round(s.macros.gramas.gordura),
      },
    });

    // o novo vira o ativo; os anteriores saem de cena sem serem apagados
    for (const p of planos) if (p.ativo) await atualizarPlano(p.id, { ativo: false });

    const m = resultado.macros, dv = resultado.desvio;
    const pc = v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`;
    if (msg) msg.textContent =
      `✓ "${plano.nome}" criado: ${fmtKcal(m.kcal)} kcal (${pc(dv.kcal)}), ` +
      `P ${Math.round(m.proteina)}g · C ${Math.round(m.carboidrato)}g · G ${Math.round(m.gordura)}g. ` +
      `Monte as refeições na aba "Planejamento Alimentar".` +
      (resultado.avisos.length ? ` ⚠ ${resultado.avisos.join(' ')}` : '');
    mostrarToast('✓ Plano gerado');
  } catch (e) {
    if (msg) msg.textContent = 'Erro: ' + e.message;
    mostrarToast('Erro ao gerar o plano');
  } finally {
    btn.innerHTML = orig;
    pintar();
  }
}
