// ═══════════════════════════════════════════════════════════
// PAINEL DE SAÚDE 360° — aba "Visão geral" do Hub
// ═══════════════════════════════════════════════════════════
// Responde três perguntas em poucos segundos:
//   1. Como este paciente está?   → status, score, métricas
//   2. O que aconteceu?           → timeline recente
//   3. O que precisa ser feito?   → alertas e próximas ações
//
// Só desenha o que tem dado real. Módulo sem fundação (consultas, check-ins,
// aderência) não vira card vazio — simplesmente não aparece.

import { carregarResumo, invalidarResumo } from './paciente-resumo.js';
import { alertasDoPaciente, PRIORIDADES } from './paciente-alertas.js';
import { montarTimelineRecente } from './timeline-ui.js';
import { moduloAtivo } from './paciente-modulos.js';
import { listarTarefas, criarTarefa, concluirTarefa, tarefaDeAlerta, diasDePrazo, CATEGORIAS_TAREFA } from './paciente-tarefas.js';
import { listarMetas, situacaoDaMeta, TIPOS_META } from './paciente-metas.js';
import { mostrarToast, mostrarErro } from './utils.js';

let _paciente = null;
let _irParaAba = null;
let _alertas = [];
let _tarefas = [];
let _metas = [];
let _verTodos = false;
let _cont = null;

/**
 * @param {HTMLElement} opts.cont
 * @param {object} opts.paciente
 * @param {function} [opts.irParaAba]
 * @param {function} [opts.aoCarregar] recebe o resumo (o Hub usa no cabeçalho)
 */
export async function initPainel360({ cont, paciente, irParaAba, aoCarregar }) {
  _paciente = paciente;
  _irParaAba = typeof irParaAba === 'function' ? irParaAba : null;
  _verTodos = false;
  _cont = cont;

  cont.innerHTML = esqueleto();

  // A timeline recente carrega em paralelo: uma consulta não espera a outra.
  montarTimelineRecente({
    cont: cont.querySelector('[data-pv-timeline]'),
    paciente, limite: 5, irParaAba: _irParaAba,
  }).catch(e => console.error('[painel] timeline:', e));

  try {
    const r = await carregarResumo(paciente);
    aoCarregar?.(r);
    // Tarefas e metas são opcionais: se as tabelas ainda não existirem no
    // banco deste ambiente, o painel continua de pé sem elas.
    [_tarefas, _metas] = await Promise.all([
      moduloAtivo('tarefas') ? listarTarefas(paciente.id).catch(() => []) : [],
      moduloAtivo('metas') ? listarMetas(paciente.id).catch(() => []) : [],
    ]);
    renderPainel(r);
  } catch (e) {
    console.error('[painel]', e);
    const box = cont.querySelector('[data-pv-corpo]');
    if (box) {
      box.innerHTML = `
        <div class="tl-estado">
          <div class="tl-estado-t">Não foi possível carregar o resumo do paciente.</div>
          <button class="btn-sm" data-pv-retry>Tentar novamente</button>
        </div>`;
      box.querySelector('[data-pv-retry]')?.addEventListener('click', () => {
        invalidarResumo(paciente.id);
        initPainel360({ cont, paciente, irParaAba: _irParaAba, aoCarregar });
      });
    }
  }
}

/** Recarrega o painel depois de uma escrita (nova avaliação, plano, etc.). */
export async function recarregarPainel() {
  if (!_paciente || !_cont) return;
  invalidarResumo(_paciente.id);
  await initPainel360({ cont: _cont, paciente: _paciente, irParaAba: _irParaAba });
}

// ───────────────────────────────────────────────────────────
function esqueleto() {
  return `
    <div data-pv-corpo>
      <section class="pv-bloco">
        <div class="pv-strip">${'<div class="pv-ind"><span class="sk sk-l"></span><span class="sk sk-v"></span></div>'.repeat(6)}</div>
      </section>
      <div class="pv-colunas">
        <div class="pv-col"><div class="sk sk-bloco"></div></div>
        <div class="pv-col"><div class="sk sk-bloco"></div></div>
      </div>
    </div>
    <section class="pv-bloco">
      <div class="pv-sec-head">
        <h3 class="pv-sec-tit">Histórico recente</h3>
        <button class="pv-link" data-pv-ver-historico>Ver histórico completo</button>
      </div>
      <div data-pv-timeline></div>
    </section>
    <details class="pv-dados">
      <summary class="pv-dados-sum">
        <span class="pv-dados-tit"><i data-lucide="user"></i> Dados pessoais e cadastro</span>
        <span class="pv-dados-hint">ver e editar</span>
      </summary>
      <div class="pv-dados-in" id="dadosPessoaisMount"></div>
    </details>`;
}

function renderPainel(r) {
  const corpo = _cont.querySelector('[data-pv-corpo]');
  if (!corpo) return;
  _alertas = alertasDoPaciente(r);

  corpo.innerHTML = `
    ${faixaSuperiorHtml(r)}
    <section class="pv-bloco"><div class="pv-strip">${indicadoresHtml(r)}</div></section>
    <div class="pv-colunas">
      <div class="pv-col">
        ${planoHtml(r)}
        ${treinoHtml(r)}
        ${metasHtml(r)}
      </div>
      <div class="pv-col">
        ${acoesHtml()}
      </div>
    </div>`;

  ligar(corpo, r);
  _cont.querySelector('[data-pv-ver-historico]')
    ?.addEventListener('click', () => _irParaAba?.('timeline'));
}

// ── Faixa superior: status + score ─────────────────────────
function faixaSuperiorHtml(r) {
  const st = r.status;
  const s = r.score;
  return `
    <section class="pv-faixa">
      <div class="pv-status tom-${st.tom}">
        <span class="pv-status-dot"></span>
        <div>
          <div class="pv-status-l">${esc(st.label)}</div>
          <div class="pv-status-s">${esc(st.detalhe)}</div>
        </div>
      </div>
      <div class="pv-score">
        <div class="pv-score-txt">
          <span class="pv-score-l">Score de acompanhamento</span>
          ${s.valor != null
            ? `<span class="pv-score-v">${s.valor}<small>/100</small></span>`
            : `<span class="pv-score-v vazio">${esc(s.motivo)}</span>`}
        </div>
        ${s.valor != null ? `
          <div class="pv-score-bar"><span style="width:${s.valor}%"></span></div>
          <button class="pv-link" data-pv-criterios aria-expanded="false">Como é calculado</button>
          <div class="pv-criterios" data-pv-criterios-box hidden>
            <p class="pv-criterios-base">${esc(s.base)} Não é um indicador clínico.</p>
            <ul>${s.criterios.map(c => `
              <li><span>${esc(c.label)}</span><b>${c.nota}</b><small>${esc(c.detalhe)}</small></li>`).join('')}</ul>
          </div>` : ''}
      </div>
    </section>`;
}

// ── Indicadores ────────────────────────────────────────────
function indicadoresHtml(r) {
  const m = r.metricas;
  const inds = [
    { lab: 'Objetivo', val: m.objetivo, vazio: 'Não definido' },
    { lab: 'Peso atual', val: m.pesoAtual != null ? `${fmt(m.pesoAtual)} kg` : null,
      sub: r.ultima ? `AV ${r.ultima.numero} · ${fmtData(r.ultima.data_avaliacao)}` : '' },
    { lab: 'Variação total', val: m.variacao != null ? `${sinal(m.variacao)} kg` : null,
      tom: tomVariacao(m.variacao, m.objetivo),
      sub: m.pesoInicial != null ? `desde ${fmt(m.pesoInicial)} kg` : '',
      vazio: r.avaliacoes.length > 1 ? 'Não registrado' : 'Sem comparativo' },
    { lab: '% de gordura', val: m.gordura != null ? `${fmt(m.gordura)}%` : null,
      sub: m.gorduraAnterior != null ? `antes ${fmt(m.gorduraAnterior)}%` : '' },
    { lab: 'Massa magra', val: m.massaMagra != null ? `${fmt(m.massaMagra)} kg` : null },
    { lab: 'Cintura', val: m.cintura != null ? `${fmt(m.cintura)} cm` : null },
    { lab: 'Plano alimentar', val: r.planoAtivo?.nome || null, vazio: 'Nenhum ativo',
      sub: m.kcalPlano ? `meta de ${fmt(m.kcalPlano, 0)} kcal` : '' },
    { lab: 'Última avaliação', val: r.ultima ? fmtData(r.ultima.data_avaliacao) : null,
      sub: r.dias.ultimaAv != null ? `há ${r.dias.ultimaAv} dias` : '', vazio: 'Aguardando primeira avaliação' },
    // Consultas: só aparecem porque o módulo existe (Fase 2A).
    ...(moduloAtivo('consultas') ? [
      { lab: 'Última consulta', val: r.ultimaConsulta ? fmtData(r.ultimaConsulta.data_hora) : null,
        sub: r.dias.ultimaConsulta != null ? `há ${r.dias.ultimaConsulta} dias` : '',
        vazio: 'Nenhuma consulta registrada' },
      { lab: 'Próximo retorno', val: r.retornoSugerido ? fmtData(r.retornoSugerido) : null,
        sub: r.dias.retornoEm != null
          ? (r.dias.retornoEm < 0 ? `atrasado ${Math.abs(r.dias.retornoEm)} dias` : `em ${r.dias.retornoEm} dias`)
          : '',
        tom: r.dias.retornoEm != null && r.dias.retornoEm < 0 ? 'atencao' : '',
        vazio: 'Não definido' },
    ] : []),
  ];
  // Aderência entra quando o módulo de check-ins existir (Fase 3).
  return inds.map(i => {
    const tem = i.val !== null && i.val !== undefined && i.val !== '';
    return `
      <div class="pv-ind">
        <span class="pv-ind-l">${esc(i.lab)}</span>
        <span class="pv-ind-v ${tem ? (i.tom ? 'tom-' + i.tom : '') : 'vazio'}">${esc(tem ? i.val : (i.vazio || 'Não registrado'))}</span>
        ${tem && i.sub ? `<span class="pv-ind-s">${esc(i.sub)}</span>` : ''}
      </div>`;
  }).join('');
}

// Perder peso só é "bom" se o objetivo for esse — sem objetivo, fica neutro.
function tomVariacao(v, objetivo) {
  if (v == null || !objetivo) return '';
  const o = objetivo.toLowerCase();
  const emagrecer = /emagre|perda|redu|gordura|definic/.test(o);
  const ganhar = /hipertrof|ganho|massa|volume/.test(o);
  if (emagrecer) return v < 0 ? 'bom' : v > 0 ? 'atencao' : '';
  if (ganhar) return v > 0 ? 'bom' : v < 0 ? 'atencao' : '';
  return '';
}

// ── Plano e treino ativos ──────────────────────────────────
function planoHtml(r) {
  const p = r.planoAtivo;
  return `
    <section class="pv-card">
      <div class="pv-card-head">
        <h3><i data-lucide="utensils"></i> Plano alimentar</h3>
        ${p ? `<button class="pv-link" data-pv-aba="planejamento">Abrir</button>` : ''}
      </div>
      ${p ? `
        <div class="pv-card-tit">${esc(p.nome || 'Plano sem nome')}</div>
        <div class="pv-card-linhas">
          ${linha('Meta', p.kcal_meta ? `${fmt(p.kcal_meta, 0)} kcal` : 'Não definida')}
          ${linha('Objetivo', p.objetivo || 'Não definido')}
          ${linha('Publicado', r.dias.planoPublicado != null ? `há ${r.dias.planoPublicado} dias` : 'Não registrado')}
          ${p.data_fim ? linha('Validade', fmtData(p.data_fim)) : ''}
        </div>` : `
        <div class="pv-vazio">
          <p>Nenhum plano alimentar ativo.</p>
          <button class="btn-sm" data-pv-aba="planejamento">Criar plano</button>
        </div>`}
    </section>`;
}

function treinoHtml(r) {
  const t = r.treinoAtivo;
  const dias = (t?.divisao || '').length;
  return `
    <section class="pv-card">
      <div class="pv-card-head">
        <h3><i data-lucide="dumbbell"></i> Treino</h3>
        ${t ? `<button class="pv-link" data-pv-aba="treinos">Abrir</button>` : ''}
      </div>
      ${t ? `
        <div class="pv-card-tit">${esc(t.nome || 'Treino sem nome')}</div>
        <div class="pv-card-linhas">
          ${linha('Divisão', t.divisao ? `${t.divisao} · ${dias} ${dias === 1 ? 'dia' : 'dias'}` : 'Não definida')}
          ${linha('Início', t.data_inicio ? fmtData(t.data_inicio) : 'Não registrado')}
          ${t.data_fim ? linha('Revisão', fmtData(t.data_fim)) : ''}
        </div>` : `
        <div class="pv-vazio">
          <p>Nenhum treino ativo.</p>
          <button class="btn-sm" data-pv-aba="treinos">Criar treino</button>
        </div>`}
    </section>`;
}

const linha = (l, v) => `<div class="pv-linha"><span>${esc(l)}</span><b>${esc(v)}</b></div>`;

// ── Metas (resumo; a gestão fica na aba Evolução) ──────────
function metasHtml(r) {
  if (!moduloAtivo('metas')) return '';
  const ativas = _metas.filter(m => m.status !== 'cancelada' && m.status !== 'pausada');
  if (!ativas.length) {
    return `
      <section class="pv-card">
        <div class="pv-card-head"><h3><i data-lucide="target"></i> Metas</h3></div>
        <div class="pv-vazio">
          <p>Nenhuma meta definida.</p>
          <button class="btn-sm" data-pv-aba="evolucao">Definir meta</button>
        </div>
      </section>`;
  }
  return `
    <section class="pv-card">
      <div class="pv-card-head">
        <h3><i data-lucide="target"></i> Metas</h3>
        <button class="pv-link" data-pv-aba="evolucao">Ver todas</button>
      </div>
      <div class="pv-metas">
        ${ativas.slice(0, 3).map(m => {
          const s = situacaoDaMeta(m, r.metricas);
          const cfg = TIPOS_META[m.tipo] || {};
          return `
            <div class="pv-meta">
              <div class="pv-meta-topo">
                <span>${esc(m.titulo || cfg.label || m.tipo)}</span>
                <b class="tom-${s.tom}">${s.progresso != null ? s.progresso + '%' : esc(s.statusLabel)}</b>
              </div>
              ${s.progresso != null ? `<div class="pv-meta-bar"><span style="width:${Math.min(100, s.progresso)}%"></span></div>` : ''}
              <div class="pv-meta-sub">${s.atual != null ? `${fmt(s.atual)}${s.unidade} de ${fmt(s.alvo)}${s.unidade}` : (s.medida ? 'Sem medida atual' : 'Acompanhada manualmente')}</div>
            </div>`;
        }).join('')}
      </div>
    </section>`;
}

// ── Próximas ações: tarefas registradas + alertas automáticos ──
// A tarefa é uma decisão guardada; o alerta é uma leitura do estado que some
// quando a causa acaba. Aparecem juntos, com a origem sempre visível.
function acoesHtml() {
  const total = _tarefas.length + _alertas.length;
  const cabecalho = `
    <div class="pv-card-head">
      <h3><i data-lucide="list-checks"></i> Próximas ações</h3>
      <div class="pv-card-head-dir">
        ${total ? `<span class="pv-contador">${total}</span>` : ''}
        ${moduloAtivo('tarefas') ? `<button class="pv-link" data-tarefa-nova>Nova tarefa</button>` : ''}
      </div>
    </div>`;

  if (!total) {
    return `<section class="pv-card">${cabecalho}
      <div class="pv-tudo-ok"><i data-lucide="check"></i> Tudo em dia com este paciente.</div></section>`;
  }

  const itens = [
    ..._tarefas.map(t => ({ tarefa: t })),
    ..._alertas.map(a => ({ alerta: a })),
  ];
  const visiveis = _verTodos ? itens : itens.slice(0, 4);
  const resto = itens.length - visiveis.length;

  return `
    <section class="pv-card">${cabecalho}
      <div class="pv-acoes">
        ${visiveis.map(i => i.tarefa ? tarefaHtml(i.tarefa) : alertaHtml(i.alerta)).join('')}
        ${resto > 0 ? `<button class="pv-link" data-pv-ver-todas>Ver todas as pendências (${itens.length})</button>` : ''}
      </div>
    </section>`;
}

function tarefaHtml(t) {
  const dias = diasDePrazo(t);
  const prazo = dias == null ? '' :
    dias < 0 ? `Atrasada ${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'dia' : 'dias'}` :
    dias === 0 ? 'Para hoje' : `Em ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  const prio = t.prioridade === 'alta' ? 'importante' : t.prioridade === 'baixa' ? 'informativo' : 'atencao';
  return `
    <div class="pv-acao prio-${prio} pv-acao-tarefa">
      <button class="pv-check" data-tarefa-ok="${t.id}" title="Concluir tarefa" aria-label="Concluir: ${esc(t.titulo)}"><i data-lucide="check"></i></button>
      <div class="pv-acao-txt">
        <div class="pv-acao-tit">${esc(t.titulo)}
          <span class="pv-prio">Tarefa</span>
          ${prazo ? `<span class="pv-prio ${dias < 0 ? 'prio-importante' : ''}">${esc(prazo)}</span>` : ''}
        </div>
        ${t.descricao ? `<div class="pv-acao-sub">${esc(t.descricao)}</div>` : ''}
      </div>
    </div>`;
}

function alertaHtml(a) {
  return `
    <div class="pv-acao prio-${a.prioridade}">
      <span class="pv-acao-ic"><i data-lucide="${a.icone || 'circle-dot'}"></i></span>
      <div class="pv-acao-txt">
        <div class="pv-acao-tit">${esc(a.titulo)}
          <span class="pv-prio prio-${a.prioridade}">${esc(PRIORIDADES[a.prioridade]?.label || '')}</span>
        </div>
        <div class="pv-acao-sub">${esc(a.descricao)}</div>
      </div>
      <div class="pv-acao-btns">
        ${a.acao ? `<button class="btn-sm btn-sm-secondary" data-pv-aba="${esc(a.acao.aba)}">${esc(a.acao.label)}</button>` : ''}
        ${moduloAtivo('tarefas') ? `<button class="pv-link" data-alerta-tarefa="${esc(a.id)}" title="Guardar como tarefa com prazo">Virar tarefa</button>` : ''}
      </div>
    </div>`;
}

// ───────────────────────────────────────────────────────────
function ligar(corpo, r) {
  corpo.querySelectorAll('[data-pv-aba]').forEach(b =>
    b.addEventListener('click', () => _irParaAba?.(b.dataset.pvAba)));

  corpo.querySelector('[data-pv-ver-todas]')?.addEventListener('click', () => {
    _verTodos = true;
    renderPainel(r);
  });

  // Concluir tarefa direto do painel: um clique, sem sair da visão geral.
  corpo.querySelectorAll('[data-tarefa-ok]').forEach(b =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await concluirTarefa(b.dataset.tarefaOk);
        _tarefas = _tarefas.filter(t => t.id !== b.dataset.tarefaOk);
        mostrarToast('✓ Tarefa concluída');
        renderPainel(r);
      } catch (e) { b.disabled = false; mostrarErro('Não foi possível concluir: ' + (e.message || e)); }
    }));

  // Alerta vira tarefa: deixa de ser aviso repetido e passa a ter prazo.
  corpo.querySelectorAll('[data-alerta-tarefa]').forEach(b =>
    b.addEventListener('click', async () => {
      const alerta = _alertas.find(a => a.id === b.dataset.alertaTarefa);
      if (!alerta) return;
      b.disabled = true;
      try {
        const nova = await tarefaDeAlerta(_paciente.id, alerta, _tarefas);
        if (nova) { _tarefas = [nova, ..._tarefas]; mostrarToast('✓ Tarefa criada'); renderPainel(r); }
        else { b.disabled = false; mostrarToast('Já existe uma tarefa para isso'); }
      } catch (e) { b.disabled = false; mostrarErro('Não foi possível criar a tarefa: ' + (e.message || e)); }
    }));

  corpo.querySelector('[data-tarefa-nova]')?.addEventListener('click', () => abrirModalTarefa(r));

  const btn = corpo.querySelector('[data-pv-criterios]');
  const box = corpo.querySelector('[data-pv-criterios-box]');
  btn?.addEventListener('click', () => {
    const abrir = box.hidden;
    box.hidden = !abrir;
    btn.setAttribute('aria-expanded', String(abrir));
    btn.textContent = abrir ? 'Ocultar critérios' : 'Como é calculado';
  });
}

// ── Modal de tarefa ────────────────────────────────────────
function abrirModalTarefa(r) {
  const fundo = document.createElement('div');
  fundo.className = 'tl-modal-fundo';
  fundo.innerHTML = `
    <div class="tl-modal" role="dialog" aria-modal="true" aria-labelledby="tfTit">
      <div class="tl-modal-head">
        <h3 id="tfTit">Nova tarefa</h3>
        <button class="tl-modal-x" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
      </div>
      <div class="tl-modal-body">
        <label class="tl-campo"><span>O que precisa ser feito</span>
          <input type="text" id="tfTitulo" class="np-input" maxlength="120" placeholder="Ex.: Solicitar exames de rotina"></label>
        <label class="tl-campo"><span>Detalhes</span>
          <textarea id="tfDesc" class="np-input" rows="2"></textarea></label>
        <div class="tl-campo-linha">
          <label class="tl-campo"><span>Categoria</span>
            <select id="tfCat" class="np-input">${CATEGORIAS_TAREFA.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
          <label class="tl-campo"><span>Prioridade</span>
            <select id="tfPrio" class="np-input">
              <option value="normal" selected>Normal</option>
              <option value="alta">Alta</option>
              <option value="baixa">Baixa</option>
            </select></label>
          <label class="tl-campo"><span>Prazo</span>
            <input type="date" id="tfPrazo" class="np-input"></label>
        </div>
        <div class="tl-modal-erro" data-erro role="alert"></div>
      </div>
      <div class="tl-modal-foot">
        <button class="btn" data-fechar>Cancelar</button>
        <button class="btn primary" data-salvar>Criar tarefa</button>
      </div>
    </div>`;
  document.body.appendChild(fundo);

  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', onEsc); };
  const onEsc = (e) => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', onEsc);
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  fundo.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', fechar));
  setTimeout(() => fundo.querySelector('#tfTitulo')?.focus(), 30);

  fundo.querySelector('[data-salvar]').addEventListener('click', async () => {
    const titulo = fundo.querySelector('#tfTitulo').value.trim();
    const erro = fundo.querySelector('[data-erro]');
    if (!titulo) { erro.textContent = 'Descreva a tarefa.'; return; }
    erro.textContent = '';
    const btn = fundo.querySelector('[data-salvar]');
    btn.disabled = true; btn.textContent = 'Salvando...';
    try {
      const nova = await criarTarefa(_paciente.id, {
        titulo,
        descricao: fundo.querySelector('#tfDesc').value.trim() || null,
        categoria: fundo.querySelector('#tfCat').value,
        prioridade: fundo.querySelector('#tfPrio').value,
        prazo: fundo.querySelector('#tfPrazo').value || null,
        origem: 'manual',
      });
      _tarefas = [nova, ..._tarefas];
      fechar();
      mostrarToast('✓ Tarefa criada');
      renderPainel(r);
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Criar tarefa';
      erro.textContent = 'Não foi possível salvar: ' + (e.message || e);
    }
  });
}

// ── Helpers ────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmt(v, casas = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
}
const sinal = (v) => `${v > 0 ? '+' : ''}${fmt(v)}`;

function fmtData(d) {
  if (!d) return '—';
  const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T12:00:00` : d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('pt-BR');
}

// Reexporta para quem quiser saber se um módulo está de pé sem importar tudo.
export { moduloAtivo };
