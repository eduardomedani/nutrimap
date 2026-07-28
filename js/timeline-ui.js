// ═══════════════════════════════════════════════════════════
// TIMELINE — visão geral do paciente (aba "Dados do Cliente")
// ═══════════════════════════════════════════════════════════
// A aba deixa de ser um formulário de cadastro e passa a ser a página inicial
// do paciente, em quatro blocos:
//   1. Resumo do acompanhamento  (indicadores em um container único)
//   2. Dados pessoais e cadastro (o formulário de sempre, recolhido)
//   3. Próximas ações            (pendências calculadas do estado atual)
//   4. Histórico do paciente     (a timeline em si)
//
// Nada aqui tem `if` por tipo de evento: a aparência vem de timeline-config.js.

import {
  listarEventos, entidadesExistentes, criarRegistroManual,
  atualizarRegistroManual, excluirRegistroManual, LIMITE_PAGINA,
} from './timeline.js';
import { configDoTipo, FILTROS, MODULOS, CATEGORIAS_MANUAIS, modulosDoFiltro } from './timeline-config.js';
import { listarAvaliacoes } from './avaliacoes.js';
import { listarPlanosDoPaciente } from './dieta.js';
import { listarTreinosDoPaciente } from './treinos.js';
import { obterPerfilNutri } from './auth.js';
import { mostrarToast, mostrarErro, confirmar } from './utils.js';

// ── Estado da tela (uma ficha aberta por vez) ──────────────
let _paciente = null;
let _irParaAba = null;
let _filtro = 'todos';
let _cursor = null;
let _temMais = false;
let _eventos = [];
let _existentes = new Set();
let _autor = 'Profissional';
let _autorPronto = null;    // promise: o nome tem que chegar antes de desenhar
let _todasPendencias = [];
let _verTodasPendencias = false;

const DIA_MS = 86400000;

/**
 * Monta a visão geral dentro de `cont`. Devolve quando o esqueleto está no DOM
 * (o carregamento dos dados continua e preenche cada bloco).
 * @param {object} opts
 * @param {HTMLElement} opts.cont
 * @param {object} opts.paciente
 * @param {function} [opts.irParaAba] - navegação para outra aba da ficha
 */
export async function initVisaoGeral({ cont, paciente, irParaAba }) {
  _paciente = paciente;
  _irParaAba = typeof irParaAba === 'function' ? irParaAba : null;
  _filtro = 'todos';
  _cursor = null; _temMais = false; _eventos = []; _existentes = new Set();
  _todasPendencias = []; _verTodasPendencias = false;

  cont.innerHTML = esqueletoHtml();
  ligarEventosFixos(cont);

  // Resumo + pendências e timeline carregam em paralelo: um não trava o outro.
  // O nome do profissional entra em cada evento: buscar antes de desenhar evita
  // a lista nascer com "Profissional" e só depois trocar de nome na tela.
  _autorPronto = obterPerfilNutri()
    .then(p => { _autor = (p?.nome || '').trim() || 'Profissional'; })
    .catch(() => { _autor = 'Profissional'; });

  carregarResumo(cont).catch(e => console.error('[timeline] resumo:', e));
  carregarPagina(true).catch(e => console.error('[timeline] eventos:', e));
}

// ───────────────────────────────────────────────────────────
// ESQUELETO
// ───────────────────────────────────────────────────────────
function esqueletoHtml() {
  return `
    <section class="vg-bloco" data-resumo>
      <div class="vg-sec-head"><h3 class="vg-sec-tit">Resumo do acompanhamento</h3></div>
      <div class="vg-strip">${'<div class="vg-ind"><span class="sk sk-l"></span><span class="sk sk-v"></span></div>'.repeat(6)}</div>
    </section>

    <details class="vg-dados">
      <summary class="vg-dados-sum">
        <span class="vg-dados-tit"><i data-lucide="user"></i> Dados pessoais e cadastro</span>
        <span class="vg-dados-hint">ver e editar</span>
      </summary>
      <div class="vg-dados-in" id="dadosPessoaisMount"></div>
    </details>

    <section class="vg-bloco" data-acoes>
      <div class="vg-sec-head"><h3 class="vg-sec-tit">Próximas ações</h3></div>
      <div class="vg-acoes-lista"><div class="sk sk-linha"></div><div class="sk sk-linha"></div></div>
    </section>

    <section class="vg-bloco vg-bloco-tl">
      <div class="vg-sec-head">
        <h3 class="vg-sec-tit">Histórico do paciente</h3>
        <button class="btn-sm" data-tl-novo><i data-lucide="plus"></i> Adicionar registro</button>
      </div>
      <div class="tl-filtros" role="tablist" aria-label="Filtrar histórico">
        ${FILTROS.map(f => `
          <button class="tl-filtro ${f.id === 'todos' ? 'ativo' : ''}" data-tl-filtro="${f.id}"
                  role="tab" aria-selected="${f.id === 'todos'}">${f.label}</button>`).join('')}
      </div>
      <div class="tl-lista" data-tl-lista>${skeletonEventos()}</div>
    </section>`;
}

function skeletonEventos() {
  const item = `
    <li class="tl-ev tl-sk">
      <span class="tl-marco"></span>
      <div class="tl-corpo">
        <div class="sk sk-tit"></div>
        <div class="sk sk-txt"></div>
        <div class="sk sk-meta"></div>
      </div>
    </li>`;
  return `<div class="tl-grupo"><div class="sk sk-dia"></div><ul class="tl-itens">${item.repeat(3)}</ul></div>`;
}

function ligarEventosFixos(cont) {
  cont.querySelector('[data-tl-novo]')?.addEventListener('click', () => abrirModalManual());

  cont.querySelectorAll('[data-tl-filtro]').forEach(b =>
    b.addEventListener('click', () => {
      if (_filtro === b.dataset.tlFiltro) return;
      _filtro = b.dataset.tlFiltro;
      cont.querySelectorAll('[data-tl-filtro]').forEach(x => {
        const on = x.dataset.tlFiltro === _filtro;
        x.classList.toggle('ativo', on);
        x.setAttribute('aria-selected', String(on));
      });
      listaEl().innerHTML = skeletonEventos();
      carregarPagina(true).catch(e => console.error('[timeline]', e));
    }));
}

const raizEl  = () => document.querySelector('#fichaConteudo') || document;
const listaEl = () => raizEl().querySelector('[data-tl-lista]');

// ───────────────────────────────────────────────────────────
// 1 · RESUMO + 3 · PRÓXIMAS AÇÕES
// ───────────────────────────────────────────────────────────
async function carregarResumo(cont) {
  const [avaliacoes, planos, treinos] = await Promise.all([
    listarAvaliacoes(_paciente.id).catch(() => []),
    listarPlanosDoPaciente(_paciente.id).catch(() => []),
    listarTreinosDoPaciente(_paciente.id).catch(() => []),
  ]);

  const dados = resumirAcompanhamento({ paciente: _paciente, avaliacoes, planos, treinos });
  const box = cont.querySelector('[data-resumo] .vg-strip');
  if (box) box.innerHTML = dados.map(indicadorHtml).join('');

  _todasPendencias = calcularPendencias({ paciente: _paciente, avaliacoes, planos, treinos });
  renderPendencias(cont);
}

/** Indicadores do resumo. Sem dado => "Não registrado"/"Não definido", nunca 0. */
function resumirAcompanhamento({ paciente, avaliacoes, planos, treinos }) {
  const avs = [...(avaliacoes || [])].sort((a, b) => (a.numero || 0) - (b.numero || 0));
  const primeira = avs[0] || null;
  const ultima   = avs[avs.length - 1] || null;
  const plano  = (planos  || []).find(p => p.ativo) || null;
  const treino = (treinos || []).find(t => t.ativo) || null;

  const pesoIni = num(primeira?.peso);
  const pesoAtu = num(ultima?.peso);
  const dif = (pesoIni != null && pesoAtu != null && avs.length > 1) ? pesoAtu - pesoIni : null;
  // pct_gordura 0 = avaliação sem protocolo de dobras, não "0% de gordura".
  const pctG = num(ultima?.pct_gordura) || null;

  return [
    { lab: 'Objetivo',       val: plano?.objetivo || null, vazio: 'Não definido' },
    { lab: 'Peso inicial',   val: pesoIni != null ? `${fmtNum(pesoIni)} kg` : null,
      sub: primeira ? `AV ${primeira.numero} · ${fmtData(primeira.data_avaliacao)}` : '' },
    { lab: 'Peso atual',     val: pesoAtu != null ? `${fmtNum(pesoAtu)} kg` : null,
      sub: ultima ? `AV ${ultima.numero} · ${fmtData(ultima.data_avaliacao)}` : '' },
    { lab: 'Diferença',      val: dif != null ? `${dif > 0 ? '+' : ''}${fmtNum(dif)} kg` : null,
      tom: dif == null ? '' : (dif < 0 ? 'bom' : dif > 0 ? 'atencao' : ''),
      vazio: avs.length > 1 ? 'Não registrado' : 'Sem comparativo' },
    { lab: '% de gordura',   val: pctG != null ? `${fmtNum(pctG * 100)}%` : null,
      sub: ultima ? `AV ${ultima.numero}` : '' },
    { lab: 'Plano alimentar', val: plano?.nome || null, vazio: 'Nenhum plano ativo',
      sub: plano?.kcal_meta != null ? `meta de ${fmtNum(plano.kcal_meta, 0)} kcal` : '' },
    { lab: 'Treino',         val: treino?.nome || null, vazio: 'Nenhum treino ativo',
      sub: treino?.divisao || '' },
    { lab: 'Última avaliação', val: ultima ? fmtData(ultima.data_avaliacao) : null,
      sub: ultima ? `há ${diasDesde(ultima.data_avaliacao)} dias` : '' },
  ];
}

function indicadorHtml(i) {
  const vazio = i.vazio || 'Não registrado';
  const temValor = i.val !== null && i.val !== undefined && i.val !== '';
  return `
    <div class="vg-ind">
      <span class="vg-ind-l">${esc(i.lab)}</span>
      <span class="vg-ind-v ${temValor ? (i.tom ? 'tom-' + i.tom : '') : 'vazio'}">${esc(temValor ? i.val : vazio)}</span>
      ${temValor && i.sub ? `<span class="vg-ind-s">${esc(i.sub)}</span>` : ''}
    </div>`;
}

/**
 * Pendências derivadas do estado atual — nada é inventado e nada é persistido.
 * Só entram itens de módulos que existem: consultas, exames, financeiro e
 * check-ins ainda não fazem parte do sistema.
 */
function calcularPendencias({ paciente, avaliacoes, planos, treinos }) {
  const out = [];
  const plano  = (planos  || []).find(p => p.ativo) || null;
  const treino = (treinos || []).find(t => t.ativo) || null;
  const avs = [...(avaliacoes || [])].sort((a, b) => (b.numero || 0) - (a.numero || 0));
  const ultimaAv = avs[0] || null;

  // Anamnese
  if ((paciente.status || 'aguardando') !== 'completo') {
    const dias = diasDesde(paciente.criado_em);
    out.push({
      icone: 'clipboard-list', prioridade: dias > 7 ? 'alta' : 'media',
      titulo: 'Anamnese incompleta',
      texto: dias != null
        ? `O paciente ainda não finalizou o questionário — cadastrado há ${dias} ${dias === 1 ? 'dia' : 'dias'}.`
        : 'O paciente ainda não finalizou o questionário.',
      acao: { label: 'Ver anamnese', aba: 'anamnese' },
    });
  }

  // Plano alimentar
  if (!plano) {
    out.push({
      icone: 'utensils', prioridade: 'alta',
      titulo: 'Sem plano alimentar ativo',
      texto: 'Este paciente ainda não tem um plano alimentar publicado.',
      acao: { label: 'Prescrever plano', aba: 'planejamento' },
    });
  } else {
    const dias = diasDesde(plano.data_inicio || plano.criado_em);
    if (dias != null && dias >= 30) {
      out.push({
        icone: 'file-pen', prioridade: dias >= 60 ? 'alta' : 'media',
        titulo: 'Revisar plano alimentar',
        texto: `O plano atual foi publicado há ${dias} dias.`,
        acao: { label: 'Revisar plano', aba: 'planejamento' },
      });
    }
    const dFim = diasAte(plano.data_fim);
    if (dFim != null && dFim <= 7) {
      out.push({
        icone: 'calendar-clock', prioridade: dFim < 0 ? 'alta' : 'media',
        titulo: dFim < 0 ? 'Plano alimentar vencido' : 'Plano alimentar vencendo',
        texto: dFim < 0 ? `Terminou em ${fmtData(plano.data_fim)}.` : `Termina em ${fmtData(plano.data_fim)}.`,
        prazo: plano.data_fim,
        acao: { label: 'Abrir plano', aba: 'planejamento' },
      });
    }
  }

  // Treino
  if (!treino) {
    out.push({
      icone: 'dumbbell', prioridade: 'media',
      titulo: 'Sem treino ativo',
      texto: 'Nenhum treino publicado para este paciente.',
      acao: { label: 'Prescrever treino', aba: 'treinos' },
    });
  } else {
    const dFim = diasAte(treino.data_fim);
    if (dFim != null && dFim <= 7) {
      out.push({
        icone: 'calendar-clock', prioridade: dFim < 0 ? 'alta' : 'media',
        titulo: dFim < 0 ? 'Treino vencido' : 'Treino próximo da revisão',
        texto: dFim < 0 ? `Terminou em ${fmtData(treino.data_fim)}.` : `Termina em ${fmtData(treino.data_fim)}.`,
        prazo: treino.data_fim,
        acao: { label: 'Abrir treino', aba: 'treinos' },
      });
    }
  }

  // Avaliação física
  if (!ultimaAv) {
    out.push({
      icone: 'ruler', prioridade: 'media',
      titulo: 'Sem avaliação física',
      texto: 'Nenhuma avaliação registrada até agora.',
      acao: { label: 'Nova avaliação', aba: 'avaliacoes' },
    });
  } else {
    const dias = diasDesde(ultimaAv.data_avaliacao);
    if (dias != null && dias >= 60) {
      out.push({
        icone: 'ruler', prioridade: dias >= 90 ? 'alta' : 'media',
        titulo: 'Avaliação física atrasada',
        texto: `A última avaliação foi há ${dias} dias (${fmtData(ultimaAv.data_avaliacao)}).`,
        acao: { label: 'Nova avaliação', aba: 'avaliacoes' },
      });
    }
  }

  const peso = { alta: 0, media: 1, baixa: 2 };
  return out.sort((a, b) => (peso[a.prioridade] ?? 3) - (peso[b.prioridade] ?? 3));
}

function renderPendencias(cont) {
  const box = cont.querySelector('[data-acoes]');
  if (!box) return;
  const lista = box.querySelector('.vg-acoes-lista');

  if (!_todasPendencias.length) {
    lista.innerHTML = `
      <div class="vg-tudo-ok"><i data-lucide="check"></i> Tudo em dia com este paciente.</div>`;
    return;
  }

  const visiveis = _verTodasPendencias ? _todasPendencias : _todasPendencias.slice(0, 3);
  const resto = _todasPendencias.length - visiveis.length;

  lista.innerHTML = visiveis.map((p, i) => `
    <div class="vg-acao prio-${p.prioridade}">
      <span class="vg-acao-ic"><i data-lucide="${p.icone}"></i></span>
      <div class="vg-acao-txt">
        <div class="vg-acao-tit">${esc(p.titulo)}
          <span class="vg-prio prio-${p.prioridade}">${p.prioridade === 'alta' ? 'Prioridade alta' : p.prioridade === 'media' ? 'Média' : 'Baixa'}</span>
        </div>
        <div class="vg-acao-sub">${esc(p.texto)}</div>
      </div>
      ${p.acao ? `<button class="btn-sm btn-sm-secondary" data-acao-idx="${_todasPendencias.indexOf(p)}">${esc(p.acao.label)}</button>` : ''}
    </div>`).join('')
    + (resto > 0
        ? `<button class="vg-ver-todas" data-ver-todas>Ver todas as pendências (${_todasPendencias.length})</button>`
        : '');

  lista.querySelectorAll('[data-acao-idx]').forEach(b =>
    b.addEventListener('click', () => {
      const p = _todasPendencias[Number(b.dataset.acaoIdx)];
      if (p?.acao?.aba && _irParaAba) _irParaAba(p.acao.aba);
    }));
  lista.querySelector('[data-ver-todas]')?.addEventListener('click', () => {
    _verTodasPendencias = true;
    renderPendencias(cont);
  });
}

// ───────────────────────────────────────────────────────────
// 4 · TIMELINE
// ───────────────────────────────────────────────────────────
async function carregarPagina(primeira = false) {
  const lista = listaEl();
  if (!lista) return;
  if (primeira) { _cursor = null; _eventos = []; }

  try {
    const r = await listarEventos(_paciente.id, {
      modulos: modulosDoFiltro(_filtro),
      cursor: _cursor,
      limite: LIMITE_PAGINA,
    });
    _cursor = r.proximoCursor;
    _temMais = r.temMais;
    _eventos = primeira ? r.eventos : _eventos.concat(r.eventos);

    const novos = await entidadesExistentes(r.eventos);
    novos.forEach(k => _existentes.add(k));
    await _autorPronto;

    renderTimeline();
  } catch (e) {
    console.error('[timeline]', e);
    lista.innerHTML = `
      <div class="tl-estado">
        <div class="tl-estado-t">Não foi possível carregar o histórico.</div>
        <button class="btn-sm" data-tl-retry>Tentar novamente</button>
      </div>`;
    lista.querySelector('[data-tl-retry]')?.addEventListener('click', () => {
      lista.innerHTML = skeletonEventos();
      carregarPagina(true).catch(err => console.error('[timeline]', err));
    });
  }
}

function renderTimeline() {
  const lista = listaEl();
  if (!lista) return;

  if (!_eventos.length) {
    lista.innerHTML = _filtro === 'todos' ? vazioHtml() : vazioFiltroHtml();
    lista.querySelector('[data-tl-primeiro]')?.addEventListener('click', () => abrirModalManual());
    lista.querySelector('[data-tl-limpar]')?.addEventListener('click', () => {
      raizEl().querySelector('[data-tl-filtro="todos"]')?.click();
    });
    return;
  }

  lista.innerHTML = gruposHtml(_eventos)
    + (_temMais ? `<button class="tl-mais" data-tl-mais>Carregar eventos anteriores</button>` : '');

  lista.querySelector('[data-tl-mais]')?.addEventListener('click', (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Carregando...';
    carregarPagina(false).catch(err => console.error('[timeline]', err));
  });

  lista.querySelectorAll('[data-ev-abrir]').forEach(b =>
    b.addEventListener('click', () => {
      const aba = b.dataset.evAbrir;
      if (aba && _irParaAba) _irParaAba(aba);
    }));
  lista.querySelectorAll('[data-ev-editar]').forEach(b =>
    b.addEventListener('click', () => {
      const ev = _eventos.find(x => x.id === b.dataset.evEditar);
      if (ev) abrirModalManual(ev);
    }));
  lista.querySelectorAll('[data-ev-excluir]').forEach(b =>
    b.addEventListener('click', () => removerManual(b.dataset.evExcluir)));
}

/** Agrupa eventos consecutivos pela mesma chave de data (dia ou mês). */
function gruposHtml(eventos) {
  const grupos = [];
  for (const ev of eventos) {
    const g = chaveGrupo(ev.data_evento);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.chave === g.chave) ultimo.itens.push(ev);
    else grupos.push({ chave: g.chave, label: g.label, itens: [ev] });
  }
  return grupos.map(g => `
    <div class="tl-grupo">
      <div class="tl-dia">${esc(g.label)}</div>
      <ul class="tl-itens">${g.itens.map(eventoHtml).join('')}</ul>
    </div>`).join('');
}

function eventoHtml(ev) {
  const cfg = configDoTipo(ev.tipo);
  const manual = ev.gerado_pelo_sistema === false;
  const importante = ev.importancia === 'alta';
  const cat = ev.metadata?.categoria;

  const acao = cfg.acao;
  const temEntidade = ev.entidade_tipo && ev.entidade_id;
  const entidadeViva = !temEntidade || _existentes.has(`${ev.entidade_tipo}:${ev.entidade_id}`);
  const mostrarAcao = acao && (!temEntidade || entidadeViva);

  const dados = linhasDeMetadata(ev);

  return `
    <li class="tl-ev tom-${cfg.tom}${importante ? ' destaque' : ''}${manual ? ' manual' : ''}">
      <span class="tl-marco" aria-hidden="true"><i data-lucide="${cfg.icone}"></i></span>
      <div class="tl-corpo">
        <div class="tl-topo">
          <span class="tl-titulo">${esc(ev.titulo || cfg.label)}</span>
          ${manual ? `<span class="tl-tag">Registro manual</span>` : ''}
          ${cat ? `<span class="tl-tag tl-tag-cat">${esc(cat)}</span>` : ''}
          ${ev.metadata?.importado ? `<span class="tl-tag tl-tag-hist">Histórico inicial</span>` : ''}
        </div>
        ${ev.descricao ? `<p class="tl-desc">${esc(ev.descricao)}</p>` : ''}
        ${dados.length ? `<ul class="tl-dados">${dados.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
        <div class="tl-meta">
          <span>${esc(quandoLongo(ev.data_evento))}</span>
          <span class="tl-sep">·</span>
          <span>${esc(_autor)}</span>
          <span class="tl-sep">·</span>
          <span>${esc(MODULOS[ev.modulo] || ev.modulo)}</span>
          ${ev.editado_em ? `<span class="tl-sep">·</span><span class="tl-editado">editado em ${esc(quandoLongo(ev.editado_em))}</span>` : ''}
        </div>
        ${(mostrarAcao || manual) ? `
          <div class="tl-acoes">
            ${mostrarAcao ? `<button class="btn-sm btn-sm-secondary" data-ev-abrir="${esc(acao.aba)}">${esc(acao.label)}</button>` : ''}
            ${manual ? `<button class="tl-link" data-ev-editar="${ev.id}">Editar</button>
                        <button class="tl-link tl-link-perigo" data-ev-excluir="${ev.id}">Excluir</button>` : ''}
          </div>` : ''}
      </div>
    </li>`;
}

// Rótulos dos campos conhecidos de metadata. Chave desconhecida é ignorada —
// metadata é para dado estruturado, não para texto solto na tela.
const CAMPOS_META = {
  plan_name:            v => `Plano: ${v}`,
  calories:             v => `${fmtNum(v, 0)} kcal prescritas`,
  target_calories:      v => `meta de ${fmtNum(v, 0)} kcal`,
  meals:                v => `${v} ${v === 1 ? 'refeição' : 'refeições'}`,
  protein:              v => `P ${fmtNum(v)} g`,
  carbohydrate:         v => `C ${fmtNum(v)} g`,
  fat:                  v => `G ${fmtNum(v)} g`,
  weight:               v => `Peso: ${fmtNum(v)} kg`,
  previous_weight:      v => `anterior: ${fmtNum(v)} kg`,
  weight_difference:    v => `variação: ${v > 0 ? '+' : ''}${fmtNum(v)} kg`,
  body_fat_percentage:  v => `gordura: ${fmtNum(v)}%`,
  imc:                  v => `IMC ${fmtNum(v)}`,
  workout_name:         v => `Treino: ${v}`,
  previous_workout_name: v => `anterior: ${v}`,
  weekly_sessions:      v => `${v} ${v === 1 ? 'dia' : 'dias'} por semana`,
  divisao:              v => `divisão ${v}`,
  objetivo:             v => `objetivo: ${v}`,
  campos:               v => `campos: ${Array.isArray(v) ? v.join(', ') : v}`,
};
const MAX_DADOS = 4;

function linhasDeMetadata(ev) {
  const m = ev.metadata || {};
  const out = [];
  for (const [k, fn] of Object.entries(CAMPOS_META)) {
    if (m[k] === undefined || m[k] === null || m[k] === '') continue;
    // O que já está no título/descrição não se repete como chip.
    if (k === 'plan_name' || k === 'workout_name') {
      const nome = String(m[k]);
      if ((ev.descricao || '').includes(nome)) continue;
    }
    out.push(fn(m[k]));
    if (out.length >= MAX_DADOS) break;
  }
  return out;
}

function vazioHtml() {
  return `
    <div class="tl-estado">
      <div class="tl-estado-ic"><i data-lucide="history"></i></div>
      <div class="tl-estado-t">Este paciente ainda não possui histórico.</div>
      <div class="tl-estado-s">As principais movimentações do acompanhamento aparecerão aqui.</div>
      <button class="btn primary" data-tl-primeiro><i data-lucide="plus"></i> Adicionar primeiro registro</button>
    </div>`;
}

function vazioFiltroHtml() {
  return `
    <div class="tl-estado">
      <div class="tl-estado-t">Nenhum evento neste filtro.</div>
      <button class="btn-sm btn-sm-secondary" data-tl-limpar>Ver todos os eventos</button>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// MODAL — registro manual
// ───────────────────────────────────────────────────────────
function abrirModalManual(evento = null) {
  const editando = !!evento;
  const d = evento ? new Date(evento.data_evento) : new Date();
  const dataLocal = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  const fundo = document.createElement('div');
  fundo.className = 'tl-modal-fundo';
  fundo.innerHTML = `
    <div class="tl-modal" role="dialog" aria-modal="true" aria-labelledby="tlModalTit">
      <div class="tl-modal-head">
        <h3 id="tlModalTit">${editando ? 'Editar registro' : 'Adicionar registro'}</h3>
        <button class="tl-modal-x" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
      </div>
      <div class="tl-modal-body">
        <label class="tl-campo">
          <span>Título</span>
          <input type="text" id="tlmTitulo" class="np-input" maxlength="120"
                 placeholder="Ex.: Contato por WhatsApp" value="${esc(evento?.titulo || '')}">
        </label>
        <label class="tl-campo">
          <span>Descrição</span>
          <textarea id="tlmDesc" class="np-input" rows="3"
                    placeholder="O que aconteceu">${esc(evento?.descricao || '')}</textarea>
        </label>
        <div class="tl-campo-linha">
          <label class="tl-campo">
            <span>Data e hora</span>
            <input type="datetime-local" id="tlmData" class="np-input" value="${dataLocal}">
          </label>
          <label class="tl-campo">
            <span>Categoria</span>
            <select id="tlmCat" class="np-input">
              ${CATEGORIAS_MANUAIS.map(c =>
                `<option ${evento?.metadata?.categoria === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
            </select>
          </label>
          <label class="tl-campo">
            <span>Importância</span>
            <select id="tlmImp" class="np-input">
              <option value="normal" ${(evento?.importancia || 'normal') === 'normal' ? 'selected' : ''}>Normal</option>
              <option value="alta"   ${evento?.importancia === 'alta' ? 'selected' : ''}>Relevante</option>
              <option value="baixa"  ${evento?.importancia === 'baixa' ? 'selected' : ''}>Baixa</option>
            </select>
          </label>
        </div>
        <div class="tl-modal-erro" data-erro role="alert"></div>
      </div>
      <div class="tl-modal-foot">
        <button class="btn" data-fechar>Cancelar</button>
        <button class="btn primary" data-salvar>${editando ? 'Salvar alterações' : 'Adicionar registro'}</button>
      </div>
    </div>`;
  document.body.appendChild(fundo);

  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', onEsc); };
  const onEsc = (e) => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', onEsc);
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  fundo.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', fechar));
  setTimeout(() => fundo.querySelector('#tlmTitulo')?.focus(), 30);

  fundo.querySelector('[data-salvar]').addEventListener('click', async () => {
    const titulo = fundo.querySelector('#tlmTitulo').value.trim();
    const erro = fundo.querySelector('[data-erro]');
    if (!titulo) { erro.textContent = 'Informe um título para o registro.'; return; }
    erro.textContent = '';

    const dados = {
      titulo,
      descricao: fundo.querySelector('#tlmDesc').value.trim(),
      dataEvento: fundo.querySelector('#tlmData').value || new Date().toISOString(),
      categoria: fundo.querySelector('#tlmCat').value,
      importancia: fundo.querySelector('#tlmImp').value,
    };

    const btn = fundo.querySelector('[data-salvar]');
    btn.disabled = true; btn.textContent = 'Salvando...';
    try {
      if (editando) await atualizarRegistroManual(evento.id, dados);
      else await criarRegistroManual({ pacienteId: _paciente.id, ...dados });
      fechar();
      mostrarToast(editando ? '✓ Registro atualizado' : '✓ Registro adicionado');
      listaEl().innerHTML = skeletonEventos();
      await carregarPagina(true);
    } catch (e) {
      btn.disabled = false; btn.textContent = editando ? 'Salvar alterações' : 'Adicionar registro';
      erro.textContent = 'Não foi possível salvar: ' + (e.message || e);
    }
  });
}

async function removerManual(id) {
  if (!(await confirmar({
    titulo: 'Excluir registro',
    mensagem: 'Excluir este registro manual da timeline?',
    textoOk: 'Excluir', perigo: true,
  }))) return;
  try {
    await excluirRegistroManual(id);
    mostrarToast('Registro excluído');
    await carregarPagina(true);
  } catch (e) {
    mostrarErro('Não foi possível excluir: ' + (e.message || e));
  }
}

// ───────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtNum(v, casas = 1) {
  const n = num(v);
  if (n === null) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
}

function fmtData(d) {
  if (!d) return '—';
  const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T12:00:00` : d);
  return isNaN(dt) ? '—' : dt.toLocaleDateString('pt-BR');
}

/** Dias completos desde uma data (null se não der para calcular). */
function diasDesde(d) {
  if (!d) return null;
  const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T12:00:00` : d);
  if (isNaN(dt)) return null;
  return Math.max(0, Math.floor((Date.now() - dt.getTime()) / DIA_MS));
}

/** Dias até uma data futura (negativo = já passou). */
function diasAte(d) {
  if (!d) return null;
  const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T12:00:00` : d);
  if (isNaN(dt)) return null;
  return Math.ceil((dt.getTime() - Date.now()) / DIA_MS);
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
               'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/**
 * Chave + rótulo do grupo. Recente agrupa por dia (Hoje, Ontem, 22 de julho);
 * acima de 180 dias agrupa por mês (Junho de 2026), para não virar uma lista
 * de dezenas de cabeçalhos de um evento cada.
 */
function chaveGrupo(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return { chave: 'sem-data', label: 'Sem data' };

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dia = new Date(d); dia.setHours(0, 0, 0, 0);
  const difDias = Math.round((hoje - dia) / DIA_MS);

  if (difDias === 0) return { chave: 'hoje',  label: 'Hoje' };
  if (difDias === 1) return { chave: 'ontem', label: 'Ontem' };

  if (difDias <= 180) {
    const label = d.getFullYear() === hoje.getFullYear()
      ? `${d.getDate()} de ${MESES[d.getMonth()]}`
      : `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
    return { chave: `d-${dia.toISOString().slice(0, 10)}`, label };
  }
  const mes = MESES[d.getMonth()];
  return {
    chave: `m-${d.getFullYear()}-${d.getMonth()}`,
    label: `${mes[0].toUpperCase()}${mes.slice(1)} de ${d.getFullYear()}`,
  };
}

/** "Hoje, 08:42" / "15 de julho, 14:20". */
function quandoLongo(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const g = chaveGrupo(iso);
  return `${g.label}, ${hora}`;
}
