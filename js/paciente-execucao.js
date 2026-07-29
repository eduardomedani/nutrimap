// ═══════════════════════════════════════════════════════════
// EXECUÇÃO GUIADA — app do aluno
// ═══════════════════════════════════════════════════════════
// Este módulo cuida do que acontece DEPOIS do ✓ de uma série: o cronômetro
// de descanso, o metrônomo da cadência, a pergunta de esforço (RIR) e o
// resumo do exercício. Ele monta e desmonta o próprio DOM dentro do card do
// exercício — nunca abre modal, nunca troca de tela.
//
// Quem chama (paciente-ui.js) só precisa de três coisas:
//   configurarDescanso({ aoTick, aoTerminar })   uma vez, no boot
//   iniciarDescanso({ ... })                     ao concluir uma série
//   retomarDescanso(ancora)                      depois de re-renderizar
//
// O estado do descanso vive no localStorage: recarregar a página no meio de
// um descanso de 90 s devolve o aluno exatamente onde ele estava.

import {
  fmtRelogio, fmtSegLongo, parseCadencia,
  RIR_OPCOES, ESCALA_OPCOES, rotuloEsforco,
} from './execucao-core.js';

export { fmtRelogio, fmtSegLongo, parseCadencia, rotuloEsforco };

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Números para leitura em pt-BR: vírgula decimal.
const dec = v => String(v).replace('.', ',');

function menosMovimento() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// ── Feedback tátil ───────────────────────────────────────────
// navigator.vibrate não existe no iOS; a chamada some sem quebrar nada.
export function vibrar(padrao) {
  try { navigator.vibrate?.(padrao); } catch {}
}
export const VIB_SERIE  = 18;            // ✓ de uma série
export const VIB_QUASE  = [12, 60, 12];  // faltam 5 s
export const VIB_FIM    = [26, 90, 26];  // acabou o descanso

// ═══════════════════════════════════════════════════════════
// CRONÔMETRO DE DESCANSO
// ═══════════════════════════════════════════════════════════
const DESC_KEY = 'nm_treino_descanso';
const DESC_MAX_MS = 60 * 60 * 1000;   // descanso esquecido de 1 h: descarta

let _d = null;        // estado do descanso em andamento (ou null)
let _raf = null;      // loop de animação do anel
let _el = null;       // elemento .pa-rest montado na tela
let _cb = {};         // { aoTick, aoTerminar, aoContinuar }
let _ultResta = -1;   // último segundo já avisado (evita repintar 60×/s)

export function configurarDescanso(cbs) { _cb = cbs || {}; }

function gravar() {
  try {
    if (_d) localStorage.setItem(DESC_KEY, JSON.stringify(_d));
    else localStorage.removeItem(DESC_KEY);
  } catch {}
}

function carregar() {
  try {
    const d = JSON.parse(localStorage.getItem(DESC_KEY) || 'null');
    if (!d || !d.fim) return null;
    // Terminado há muito tempo (app fechado no meio) — não faz sentido retomar.
    if (Date.now() - d.fim > DESC_MAX_MS) return null;
    // O aviso "hora da próxima série" também tem validade: 2 min depois, some.
    if (d.terminado && Date.now() - d.fim > 2 * 60 * 1000) return null;
    return d;
  } catch { return null; }
}

/** Estado do descanso atual (ou null). Leitura apenas. */
export function estadoDescanso() { return _d; }
export function descansando() { return !!_d && !_d.terminado; }

/** Segundos que faltam (0 quando terminou). */
export function restanteSeg() {
  if (!_d) return 0;
  const agora = _d.pausadoEm || Date.now();
  return Math.max(0, Math.ceil((_d.fim - agora) / 1000));
}

/**
 * Começa (ou reinicia) o descanso.
 *   ancora  — elemento depois do qual o card do cronômetro é inserido
 *   proxima — { n, reps } da próxima série, para o aluno já saber o que vem
 *   ultima  — true quando é o descanso depois da última série do exercício
 */
export function iniciarDescanso({ itemId, serie, seg, ancora, proxima = null, ultima = false, titulo = 'Descanso' }) {
  const dur = Math.max(1, Math.round(Number(seg) || 0));
  encerrarDescanso({ silencioso: true });
  _ultResta = -1;
  _d = {
    itemId, serie, dur, titulo,
    fim: Date.now() + dur * 1000,
    pausadoEm: null,
    proxima, ultima,
    aviso5: false,
    terminado: false,
  };
  gravar();
  montar(ancora);
  loop();
  return _d;
}

/**
 * Depois de um re-render, recoloca o cronômetro na tela.
 * `acharAncora(estado)` devolve o elemento âncora (ou null se o card sumiu).
 * Sem âncora o cronômetro continua contando — só deixa de ter card visível,
 * e quem chama mostra o indicador compacto no cabeçalho.
 */
export function retomarDescanso(acharAncora) {
  if (!_d) _d = carregar();
  if (!_d) return null;
  if (_d.terminado || restanteSeg() <= 0) {
    // Terminou enquanto a tela estava sendo remontada.
    _d.terminado = true;
  }
  const ancora = typeof acharAncora === 'function' ? acharAncora(_d) : acharAncora;
  montar(ancora);
  loop();
  return _d;
}

/** Encerra o descanso (pulado, concluído ou trocou de exercício). */
export function encerrarDescanso({ silencioso = false } = {}) {
  pararLoop();
  if (_el) { _el.remove(); _el = null; }
  const tinha = !!_d;
  _d = null;
  _ultResta = -1;
  gravar();
  if (tinha && !silencioso) _cb.aoTick?.(null, 0);
  return tinha;
}

export function pausarDescanso() {
  if (!_d || _d.pausadoEm || _d.terminado) return;
  _d.pausadoEm = Date.now();
  gravar();
  pintar();
}

export function retomarContagem() {
  if (!_d || !_d.pausadoEm) return;
  _d.fim = Date.now() + (_d.fim - _d.pausadoEm);
  _d.pausadoEm = null;
  gravar();
  loop();
}

export function somarSegundos(n) {
  if (!_d || _d.terminado) return;
  _d.fim += n * 1000;
  _d.dur += n;
  _d.aviso5 = false;
  gravar();
  pintar();
}

// ── Loop de animação ─────────────────────────────────────────
function pararLoop() {
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
}

function loop() {
  pararLoop();
  if (!_d) return;
  const passo = () => {
    _raf = null;
    if (!_d) return;
    pintar();
    if (!_d.terminado && !_d.pausadoEm) _raf = requestAnimationFrame(passo);
  };
  passo();
}

const RAIO = 46;
const CIRC = 2 * Math.PI * RAIO;

function pintar() {
  if (!_d) return;
  const resta = restanteSeg();
  const agora = _d.pausadoEm || Date.now();
  const fracao = Math.max(0, Math.min(1, (_d.fim - agora) / (_d.dur * 1000)));

  // Avisos: 5 s para o fim e o fim propriamente dito (uma vez cada).
  if (!_d.terminado && !_d.aviso5 && resta <= 5 && resta > 0) {
    _d.aviso5 = true;
    _el?.classList.add('quase');
    vibrar(VIB_QUASE);
    gravar();
  }
  if (!_d.terminado && resta <= 0) {
    _d.terminado = true;
    _d.pausadoEm = null;
    gravar();
    vibrar(VIB_FIM);
    pararLoop();
    desenhar();                       // troca o card para "hora da próxima série"
    _cb.aoTerminar?.(_d);
    _cb.aoTick?.(_d, 0);
    return;
  }

  // O anel anda a cada frame; quem está fora do card só precisa saber do
  // segundo — avisar 60×/s reescreveria o cabeçalho à toa.
  if (_ultResta !== resta) { _ultResta = resta; _cb.aoTick?.(_d, resta); }
  if (!_el) return;

  const t = _el.querySelector('[data-rest-tempo]');
  if (t) {
    const txt = fmtRelogio(resta);
    if (t.textContent !== txt) t.textContent = txt;
  }
  const anel = _el.querySelector('[data-rest-anel]');
  if (anel) anel.style.strokeDashoffset = String(CIRC * (1 - fracao));
  _el.classList.toggle('pausado', !!_d.pausadoEm);
  _el.classList.toggle('quase', resta <= 5 && !_d.pausadoEm);
}

// ── Montagem do card ─────────────────────────────────────────
function montar(ancora) {
  if (_el) { _el.remove(); _el = null; }
  if (!ancora || !ancora.parentNode) return;   // sem card visível: só conta
  _el = document.createElement('div');
  _el.className = 'pa-rest';
  _el.setAttribute('role', 'timer');
  _el.setAttribute('aria-live', 'off');
  ancora.parentNode.insertBefore(_el, ancora.nextSibling);
  desenhar();
  if (!menosMovimento()) {
    _el.animate(
      [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
      { duration: 220, easing: 'cubic-bezier(.4,0,.2,1)' });
  }
  requestAnimationFrame(() => {
    _el?.scrollIntoView({ block: 'center', behavior: menosMovimento() ? 'auto' : 'smooth' });
  });
}

function desenhar() {
  if (!_el || !_d) return;
  _el.innerHTML = _d.terminado ? htmlFim() : htmlContando();
  ligarBotoes();
  if (!_d.terminado) pintar();
}

function htmlProxima() {
  const p = _d.proxima;
  if (!p) {
    return `<div class="pa-rest-prox"><span class="pa-rest-prox-lab">Depois do descanso</span>
      <span class="pa-rest-prox-val">${_d.ultima ? 'Próximo exercício' : 'Continue o treino'}</span></div>`;
  }
  const reps = p.reps ? `<span class="pa-rest-prox-reps">${esc(String(p.reps))} repetições</span>` : '';
  return `<div class="pa-rest-prox">
      <span class="pa-rest-prox-lab">Próxima série</span>
      <span class="pa-rest-prox-val">${esc(String(p.n))}ª série</span>
      ${reps}
    </div>`;
}

function htmlContando() {
  const resta = restanteSeg();
  const pausado = !!_d.pausadoEm;
  return `
    <div class="pa-rest-main">
      <div class="pa-rest-ring">
        <svg viewBox="0 0 110 110" aria-hidden="true">
          <circle class="pa-rest-trilho" cx="55" cy="55" r="${RAIO}"></circle>
          <circle class="pa-rest-arco" data-rest-anel cx="55" cy="55" r="${RAIO}"
            stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="0"></circle>
        </svg>
        <div class="pa-rest-nums">
          <span class="pa-rest-lab">${esc(_d.titulo)}</span>
          <span class="pa-rest-tempo" data-rest-tempo>${fmtRelogio(resta)}</span>
        </div>
      </div>
      ${htmlProxima()}
    </div>
    <div class="pa-rest-acoes">
      <button type="button" class="pa-rest-btn" data-rest-mais>+15 s</button>
      <button type="button" class="pa-rest-btn" data-rest-pausa>
        <i data-lucide="${pausado ? 'play' : 'pause'}"></i> ${pausado ? 'Retomar' : 'Pausar'}
      </button>
      <button type="button" class="pa-rest-btn pa-rest-btn-forte" data-rest-pular>
        Pular descanso <i data-lucide="chevron-right"></i>
      </button>
    </div>`;
}

function htmlFim() {
  return `
    <div class="pa-rest-fim">
      <span class="pa-rest-fim-ic"><i data-lucide="zap"></i></span>
      <div class="pa-rest-fim-txt">
        <b>Hora da próxima série</b>
        ${_d.proxima ? `<span>${esc(String(_d.proxima.n))}ª série${_d.proxima.reps ? ` · ${esc(String(_d.proxima.reps))} reps` : ''}</span>`
                     : `<span>${_d.ultima ? 'Exercício concluído' : 'Continue o treino'}</span>`}
      </div>
      <button type="button" class="pa-rest-continuar" data-rest-ok>Continuar</button>
    </div>`;
}

function ligarBotoes() {
  if (!_el) return;
  _el.querySelector('[data-rest-mais]')?.addEventListener('click', () => { somarSegundos(15); vibrar(VIB_SERIE); });
  _el.querySelector('[data-rest-pausa]')?.addEventListener('click', () => {
    if (_d?.pausadoEm) retomarContagem(); else pausarDescanso();
    desenhar();
  });
  _el.querySelector('[data-rest-pular]')?.addEventListener('click', () => {
    const est = _d;
    encerrarDescanso();
    _cb.aoTerminar?.({ ...est, pulado: true });
  });
  _el.querySelector('[data-rest-ok]')?.addEventListener('click', () => {
    const est = _d;
    encerrarDescanso();
    _cb.aoContinuar?.(est);
  });
}

// ═══════════════════════════════════════════════════════════
// CADÊNCIA — leitura didática + metrônomo visual
// ═══════════════════════════════════════════════════════════
// Só aparece quando o profissional prescreveu cadência. É visual e mudo: o
// bip por fase fica para depois, e entraria em iniciarMetronomo(), na virada
// de `atual.k` — que é o único ponto que sabe quando a fase troca.
let _met = null;   // { raf, ini, cad, el }

export function cadenciaHtml(cad) {
  if (!cad) return '';
  const fases = cad.fases.map(f => `
    <li class="pa-cad-fase${f.seg ? '' : ' off'}">
      <span class="pa-cad-fase-nome">${esc(f.seg ? f.label : f.vazio)}</span>
      ${f.seg ? `<span class="pa-cad-fase-seg">${f.seg} ${f.seg === 1 ? 'segundo' : 'segundos'}</span>` : ''}
    </li>`).join('');

  return `
    <section class="pa-cad" data-cad>
      <header class="pa-cad-head">
        <span class="pa-cad-tit"><i data-lucide="activity"></i> Cadência</span>
        <span class="pa-cad-tec" title="Formato técnico">${esc(cad.tec)}</span>
      </header>
      <ul class="pa-cad-fases">${fases}</ul>
      <div class="pa-cad-metro" data-metro hidden>
        <div class="pa-cad-barra"><span class="pa-cad-mark" data-metro-mark></span></div>
        <div class="pa-cad-agora">
          <span class="pa-cad-agora-fase" data-metro-fase>—</span>
          <span class="pa-cad-agora-num" data-metro-num>—</span>
        </div>
      </div>
      <button type="button" class="pa-cad-btn" data-metro-toggle>
        <i data-lucide="play" data-metro-ic></i> <span data-metro-txt>Iniciar metrônomo</span>
      </button>
    </section>`;
}

/** Liga o botão do metrônomo dentro de `root` (o card do exercício). */
export function ligarCadencia(root, cad) {
  const sec = root?.querySelector('[data-cad]');
  if (!sec || !cad) return;
  // Reabrir o mesmo exercício chama isto de novo: sem a trava, o clique
  // ligaria e desligaria o metrônomo no mesmo toque.
  if (sec.dataset.ligado) return;
  sec.dataset.ligado = '1';
  sec.querySelector('[data-metro-toggle]')?.addEventListener('click', () => {
    if (_met && _met.sec === sec) pararMetronomo();
    else iniciarMetronomo(sec, cad);
  });
}

export function pararMetronomo() {
  if (!_met) return;
  cancelAnimationFrame(_met.raf);
  const { sec } = _met;
  _met = null;
  const box = sec.querySelector('[data-metro]');
  if (box) box.hidden = true;
  const txt = sec.querySelector('[data-metro-txt]');
  if (txt) txt.textContent = 'Iniciar metrônomo';
  sec.querySelector('[data-metro-toggle]')?.classList.remove('rodando');
  trocarIconeMetro(sec, 'play');
}

// O ícone do botão é um <svg> depois que o Lucide passa; trocá-lo é
// substituir o nó por um <i data-lucide> novo — o observer converte de novo.
function trocarIconeMetro(sec, nome) {
  const btn = sec.querySelector('[data-metro-toggle]');
  const ic = btn?.querySelector('[data-metro-ic]') || btn?.querySelector('svg, i');
  if (!ic) return;
  const novo = document.createElement('i');
  novo.setAttribute('data-lucide', nome);
  novo.setAttribute('data-metro-ic', '');
  ic.replaceWith(novo);
}

function iniciarMetronomo(sec, cad) {
  pararMetronomo();
  const box = sec.querySelector('[data-metro]');
  if (box) box.hidden = false;
  const txt = sec.querySelector('[data-metro-txt]');
  if (txt) txt.textContent = 'Parar metrônomo';
  sec.querySelector('[data-metro-toggle]')?.classList.add('rodando');
  trocarIconeMetro(sec, 'square');

  const ativas = cad.fases.filter(f => f.seg > 0);
  const ciclo = ativas.reduce((a, f) => a + f.seg, 0);
  if (!ciclo) return;

  _met = { sec, cad, ini: performance.now(), raf: 0 };
  const mark = sec.querySelector('[data-metro-mark]');
  const elFase = sec.querySelector('[data-metro-fase]');
  const elNum = sec.querySelector('[data-metro-num]');

  const passo = (agora) => {
    if (!_met) return;
    const t = ((agora - _met.ini) / 1000) % ciclo;
    let acc = 0, atual = ativas[0], dentro = 0;
    for (const f of ativas) {
      if (t < acc + f.seg) { atual = f; dentro = t - acc; break; }
      acc += f.seg;
    }
    // O marcador desce na excêntrica e sobe na concêntrica; nas pausas, para.
    const prog = atual.seg ? dentro / atual.seg : 0;
    let pos = 0;
    if (atual.k === 'desc') pos = prog;
    else if (atual.k === 'sobe') pos = 1 - prog;
    else pos = atual.k === 'pausa' ? 1 : 0;
    // --pa-cad-curso é a altura útil da barra (definida em execucao.css).
    if (mark) mark.style.transform = `translateY(calc(var(--pa-cad-curso) * ${pos.toFixed(3)}))`;
    if (elFase) elFase.textContent = atual.label;
    const restante = Math.max(1, Math.ceil(atual.seg - dentro));
    if (elNum) elNum.textContent = String(restante);
    sec.dataset.fase = atual.k;
    _met.raf = requestAnimationFrame(passo);
  };
  _met.raf = requestAnimationFrame(passo);
}

// ═══════════════════════════════════════════════════════════
// ESFORÇO (RIR / escala subjetiva)
// ═══════════════════════════════════════════════════════════
/**
 * Pergunta o esforço logo abaixo da última série. Inline, sem modal.
 * `onEscolha(valor|null)` recebe null quando o aluno pula.
 */
export function perguntarEsforco({ ancora, modo, onEscolha }) {
  if (!ancora || !ancora.parentNode) { onEscolha?.(null); return null; }
  const opcoes = modo === 'escala' ? ESCALA_OPCOES : RIR_OPCOES;
  const el = document.createElement('div');
  el.className = 'pa-esforco';
  el.innerHTML = `
    <div class="pa-esforco-perg">Quantas repetições você ainda conseguiria fazer?</div>
    <div class="pa-esforco-ops">
      ${opcoes.map(o => `<button type="button" class="pa-esforco-op" data-esf="${o.v}">${esc(o.label)}</button>`).join('')}
    </div>
    <button type="button" class="pa-esforco-pular" data-esf-pular>Prefiro não responder</button>`;
  ancora.parentNode.insertBefore(el, ancora.nextSibling);
  if (!menosMovimento()) {
    el.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
      { duration: 200, easing: 'cubic-bezier(.4,0,.2,1)' });
  }
  requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: menosMovimento() ? 'auto' : 'smooth' }));

  const fechar = (v) => { el.remove(); onEscolha?.(v); };
  el.querySelectorAll('[data-esf]').forEach(b =>
    b.addEventListener('click', () => { vibrar(VIB_SERIE); fechar(Number(b.dataset.esf)); }));
  el.querySelector('[data-esf-pular]').addEventListener('click', () => fechar(null));
  return el;
}

// ═══════════════════════════════════════════════════════════
// COMPARAÇÃO COM O ÚLTIMO TREINO
// ═══════════════════════════════════════════════════════════
/** Badge "▲ +2 kg" / "▼ -1 rep" / "=" — sem vermelho gritante na queda. */
export function deltaHtml(hoje, antes, unidade) {
  // Number(null) é 0 — sem esta guarda, "não registrado" viraria "−60 kg".
  if (hoje == null || antes == null || hoje === '' || antes === '') return '';
  const a = Number(hoje), b = Number(antes);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
  const d = Math.round((a - b) * 100) / 100;
  if (d === 0) return `<span class="pa-delta igual">= igual</span>`;
  const sinal = d > 0 ? '+' : '−';
  const cls = d > 0 ? 'sobe' : 'desce';
  const ico = d > 0 ? 'trending-up' : 'trending-down';
  return `<span class="pa-delta ${cls}"><i data-lucide="${ico}"></i> ${sinal}${dec(Math.abs(d))} ${esc(unidade)}</span>`;
}

/** Linha "Hoje 62 kg · Última vez 60 kg · ▲ +2 kg" de uma série. */
export function comparacaoSerieHtml(atual, anterior) {
  if (!anterior || (anterior.peso == null && anterior.reps == null)) return '';
  const partes = [];
  if (atual.peso != null && anterior.peso != null && Number(atual.peso) !== Number(anterior.peso)) {
    partes.push(deltaHtml(atual.peso, anterior.peso, 'kg'));
  }
  if (atual.reps != null && anterior.reps != null && Number(atual.reps) !== Number(anterior.reps)) {
    partes.push(deltaHtml(atual.reps, anterior.reps, Math.abs(atual.reps - anterior.reps) === 1 ? 'rep' : 'reps'));
  }
  const antes = `${anterior.peso != null ? `${dec(anterior.peso)} kg` : '—'}${anterior.reps != null ? ` × ${anterior.reps}` : ''}`;
  return `<div class="pa-serie-comp">
      <span class="pa-serie-comp-ant">Última vez: ${esc(antes)}</span>
      ${partes.join('') || '<span class="pa-delta igual">= igual</span>'}
    </div>`;
}

// ═══════════════════════════════════════════════════════════
// RESUMO DO EXERCÍCIO
// ═══════════════════════════════════════════════════════════
const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Métricas de uma lista de séries [{peso, reps, drop:{peso,reps}}]. */
export function metricas(series) {
  const feitas = (series || []).filter(s => s && (s.peso != null || s.reps != null));
  let volume = 0, somaPeso = 0, nPeso = 0, maiorCarga = null, melhor = null, melhorVol = -1, reps = 0;
  for (const s of feitas) {
    const p = num(s.peso), r = num(s.reps);
    if (r != null) reps += r;
    if (p != null) { somaPeso += p; nPeso++; if (maiorCarga == null || p > maiorCarga) maiorCarga = p; }
    const v = (p ?? 0) * (r ?? 0);
    const dv = s.drop ? (num(s.drop.peso) ?? 0) * (num(s.drop.reps) ?? 0) : 0;
    volume += v + dv;
    if (v > melhorVol) { melhorVol = v; melhor = s; }
  }
  return {
    series: feitas.length,
    volume: Math.round(volume * 10) / 10,
    cargaMedia: nPeso ? Math.round(somaPeso / nPeso * 10) / 10 : null,
    maiorCarga, melhor, reps,
  };
}

const fmtKg = v => (v == null ? '—' : `${dec(Number.isInteger(v) ? v : v.toFixed(1))} kg`);
const fmtVol = v => (!v ? '—' : (v >= 1000 ? `${dec((v / 1000).toFixed(1))} t` : `${Math.round(v)} kg`));
function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
}

/**
 * Cartão de fechamento do exercício. `dados`:
 *   { series, anteriores, tempoMs, descansoMs, esforco, modoEsforco, temProximo }
 */
export function resumoExercicioHtml(dados) {
  const m = metricas(dados.series);
  const ant = dados.anteriores?.length ? metricas(dados.anteriores) : null;

  const tile = (lab, val, extra = '') =>
    `<div class="pa-res-tile"><span class="pa-res-lab">${esc(lab)}</span>
      <span class="pa-res-val">${val}</span>${extra}</div>`;

  const cmpVolume = ant && ant.volume ? deltaHtml(m.volume, ant.volume, 'kg') : '';
  const cmpCarga = ant && ant.maiorCarga != null && m.maiorCarga != null
    ? deltaHtml(m.maiorCarga, ant.maiorCarga, 'kg') : '';
  const melhor = m.melhor
    ? `${fmtKg(num(m.melhor.peso))} × ${num(m.melhor.reps) ?? '—'}`
    : '—';
  const esf = dados.esforco != null
    ? `<div class="pa-res-esforco"><i data-lucide="gauge"></i> Esforço registrado: <b>${esc(rotuloEsforco(dados.esforco, dados.modoEsforco))}</b></div>`
    : '';

  return `
    <section class="pa-resumo" data-resumo>
      <header class="pa-resumo-head">
        <span class="pa-resumo-ic"><i data-lucide="check"></i></span>
        <div>
          <b>Exercício concluído</b>
          <span>${m.series} ${m.series === 1 ? 'série' : 'séries'} · ${m.reps || '—'} repetições</span>
        </div>
      </header>
      <div class="pa-res-grid">
        ${tile('Volume total', fmtVol(m.volume), cmpVolume)}
        ${tile('Maior carga', fmtKg(m.maiorCarga), cmpCarga)}
        ${tile('Carga média', fmtKg(m.cargaMedia))}
        ${tile('Melhor série', melhor)}
        ${tile('Tempo no exercício', fmtDur(dados.tempoMs || 0))}
        ${tile('Descanso total', fmtDur(dados.descansoMs || 0))}
      </div>
      ${esf}
      <button type="button" class="pa-btn pa-resumo-btn" data-resumo-prox>
        ${dados.temProximo ? 'Próximo exercício' : 'Voltar para o treino'} <i data-lucide="arrow-right"></i>
      </button>
    </section>`;
}

// ═══════════════════════════════════════════════════════════
// ÚLTIMA EXECUÇÃO — série a série
// ═══════════════════════════════════════════════════════════
/** Lista compacta "1ª · 60 kg · 4 reps" da sessão anterior. */
export function ultimaExecucaoHtml(reg) {
  if (!reg) return `<div class="pa-last-vazio">Sem registros anteriores</div>`;
  const series = reg.series_realizadas || [];
  if (!series.length) {
    const p = reg.carga_realizada != null ? `${reg.carga_realizada} kg` : '—';
    const r = reg.reps_realizadas != null ? ` · ${reg.reps_realizadas} reps` : '';
    return `<div class="pa-last-val"><b>${esc(p)}</b>${esc(r)}</div>`;
  }
  const linhas = series.map((s, i) => `
    <li class="pa-last-serie">
      <span class="pa-last-n">${i + 1}ª</span>
      <span class="pa-last-peso">${s.peso != null ? `${esc(dec(s.peso))} kg` : '—'}</span>
      <span class="pa-last-reps">${s.reps != null ? `${esc(String(s.reps))} reps` : '—'}</span>
      ${s.drop ? `<span class="pa-last-drop"><i data-lucide="corner-down-right"></i> ${esc(s.drop.peso != null ? dec(s.drop.peso) : '—')} × ${esc(String(s.drop.reps ?? '—'))}</span>` : ''}
    </li>`).join('');
  return `<ul class="pa-last-lista">${linhas}</ul>`;
}
