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

import { carregarResumo, invalidarResumo, diasAte } from './paciente-resumo.js';
import { alertasDoPaciente, PRIORIDADES, ordenarPendencias } from './paciente-alertas.js';
import { medidaValida } from './avaliacao-validacao.js';
import { svgLinha } from './evolucao-core.js';
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
let _documentos = null;   // indicador do bloco de Documentos (null = ainda carregando)

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

  try {
    const r = await carregarResumo(paciente);
    aoCarregar?.(r);
    // Tarefas, metas e documentos são opcionais: se as tabelas ainda não
    // existirem no banco deste ambiente, o painel continua de pé sem elas.
    // Documentos que não carregaram viram `null`, e o bloco simplesmente não
    // aparece — "0 arquivos" afirmaria uma coisa que a tela não sabe.
    let docs = [];
    [_tarefas, _metas, docs] = await Promise.all([
      moduloAtivo('tarefas') ? listarTarefas(paciente.id).catch(() => []) : [],
      moduloAtivo('metas') ? listarMetas(paciente.id).catch(() => []) : [],
      moduloAtivo('documentos')
        ? import('./paciente-documentos.js')
            .then(m => m.listarDocumentos({ pacienteId: paciente.id, incluirArquivados: true, limite: 500 }))
            .catch(() => null)
        : null,
    ]);
    _documentos = docs
      ? (await import('./paciente-documentos-eventos.js')).indicadorDocumentos(docs)
      : null;
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
      <section class="pv2-inds">${'<div class="pv2-ind"><span class="sk sk-l"></span><span class="sk sk-v"></span></div>'.repeat(4)}</section>
      <div class="pv2-grade">
        <div class="pv2-principal"><div class="sk sk-bloco"></div></div>
        <aside class="pv2-lateral"><div class="sk sk-bloco"></div></aside>
      </div>
    </div>
    <details class="pv-dados">
      <summary class="pv-dados-sum">
        <span class="pv-dados-tit"><i data-lucide="user"></i> Dados pessoais e cadastro</span>
        <span class="pv-dados-hint">ver e editar</span>
      </summary>
      <div class="pv-dados-in" id="dadosPessoaisMount"></div>
    </details>`;
}

// ── Layout (redesenho de 10/11/2026) ─────────────────────────
// Quatro indicadores no topo; abaixo, duas colunas (≈65/35):
//   principal: Evolução · Plano alimentar + Treino · Metas
//   lateral:   Pendências · Agenda · Últimos registros · Documentos
// No celular é uma coluna só, e as PENDÊNCIAS sobem para logo depois dos
// indicadores (ordem por CSS, ver css/paciente-visao.css).
// O Score de acompanhamento mora no CABEÇALHO do Hub (js/paciente-hub.js).
function renderPainel(r) {
  const corpo = _cont.querySelector('[data-pv-corpo]');
  if (!corpo) return;
  _alertas = alertasDoPaciente(r);

  corpo.innerHTML = `
    <section class="pv2-inds" aria-label="Resumo">${indicadoresHtml(r)}</section>
    <div class="pv2-grade">
      <div class="pv2-principal">
        ${evolucaoHtml(r)}
        <div class="pv2-duo pv2-o-plano">${planoHtml(r)}${treinoHtml(r)}</div>
        <div class="pv2-o-metas">${metasHtml(r)}</div>
      </div>
      <aside class="pv2-lateral">
        <div class="pv2-o-pend">${acoesHtml()}</div>
        <div class="pv2-o-agenda">${agendaHtml(r)}</div>
        <section class="pv-card pv2-o-reg" aria-labelledby="pvRegT">
          <div class="pv-card-head">
            <h3 id="pvRegT"><i data-lucide="history"></i> Últimos registros</h3>
            <button class="pv-link" data-pv-aba="timeline">Ver timeline</button>
          </div>
          <div data-pv-timeline></div>
        </section>
        <div class="pv2-o-docs">${documentosHtml()}</div>
      </aside>
    </div>`;

  // Os três acontecimentos mais recentes, das fontes reais (paciente_eventos).
  montarTimelineRecente({
    cont: corpo.querySelector('[data-pv-timeline]'),
    paciente: _paciente, limite: 3, irParaAba: _irParaAba,
  }).catch(e => console.error('[painel] timeline:', e));

  ligar(corpo, r);
  window.renderIcons?.();
}

// ── Os quatro indicadores ────────────────────────────────────
// Cada número diz DE QUANDO é. Nunca "atual" para medida antiga; ausência é
// "Não registrado"; sem duas avaliações válidas, "Sem comparativo".
export function indicadoresDados(r) {
  const m = r.metricas;
  const av = a => a ? `AV ${a.numero} · ${fmtData(a.data_avaliacao)}` : '';
  const revisarGord = (r.revisar || []).some(x => x.gordura === 'invalida');
  const retorno = r.consultaAberta?.status === 'agendada' ? r.consultaAberta.data_hora : r.retornoSugerido;
  const dRet = retorno ? diasAte(retorno) : null;
  return [
    { id: 'peso', rot: 'Último peso registrado',
      val: m.pesoAtual != null ? `${fmt(m.pesoAtual)} kg` : null,
      sub: av(m.avPeso), vazio: 'Não registrado' },
    { id: 'variacao', rot: 'Variação de peso',
      val: m.variacao != null ? `${sinal(m.variacao)} kg` : null,
      sub: m.variacao != null ? `AV ${m.avPesoInicial.numero} (${fmtData(m.avPesoInicial.data_avaliacao)}) → AV ${m.avPeso.numero} (${fmtData(m.avPeso.data_avaliacao)})` : '',
      tom: tomVariacao(m.variacao, m.objetivo),
      vazio: m.pesoAtual != null ? 'Sem comparativo' : 'Não registrado' },
    { id: 'gordura', rot: 'Gordura corporal',
      val: m.gordura != null ? `${fmt(m.gordura)}%` : null,
      sub: av(m.avGordura), vazio: revisarGord ? 'Revisar dados' : 'Não registrado',
      revisar: revisarGord },
    { id: 'retorno', rot: 'Próximo retorno',
      val: retorno ? fmtData(retorno) : null,
      sub: dRet == null ? '' : dRet < 0 ? `passou há ${Math.abs(dRet)} ${Math.abs(dRet) === 1 ? 'dia' : 'dias'}` : dRet === 0 ? 'hoje' : `em ${dRet} ${dRet === 1 ? 'dia' : 'dias'}`,
      tom: dRet != null && dRet < 0 ? 'atencao' : '', vazio: 'Não agendado' },
  ];
}

function indicadoresHtml(r) {
  return indicadoresDados(r).map(i => {
    const tem = i.val != null;
    return `
      <div class="pv2-ind" data-ind="${i.id}">
        <span class="pv2-ind-l">${esc(i.rot)}</span>
        <span class="pv2-ind-v ${tem ? (i.tom ? 'tom-' + i.tom : '') : 'vazio'}">${esc(tem ? i.val : i.vazio)}</span>
        ${tem && i.sub ? `<span class="pv2-ind-s">${esc(i.sub)}</span>` : ''}
        ${i.revisar ? `<button class="pv-link pv2-ind-rev" data-pv-aba="avaliacoes"><i data-lucide="triangle-alert"></i> Revisar dados da avaliação</button>` : ''}
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

// ── Evolução ─────────────────────────────────────────────────
// Só medidas VÁLIDAS viram ponto (js/avaliacao-validacao.js). Uma série por
// vez (kg e % no mesmo eixo mentem sobre a escala). Com uma medida só, mostra
// a medida inicial e NÃO desenha tendência.
const SERIES_VISAO = [
  { id: 'peso',    rotulo: 'Peso',             unidade: ' kg' },
  { id: 'gordura', rotulo: 'Gordura corporal', unidade: '%' },
  { id: 'cintura', rotulo: 'Cintura',          unidade: ' cm' },
];
let _serie = 'peso';

export function pontosValidos(avaliacoes, serie) {
  return [...(avaliacoes || [])]
    .filter(a => a.data_avaliacao)
    .map(a => ({ av: a, valor: medidaValida(a, serie), data: new Date(`${a.data_avaliacao}T12:00:00`) }))
    .filter(p => p.valor != null && !isNaN(p.data))
    .sort((a, b) => a.data - b.data);
}

function evolucaoHtml(r) {
  const head = (extra = '') => `
    <div class="pv-card-head">
      <h3><i data-lucide="trending-up"></i> Evolução</h3>${extra}
    </div>`;
  if (!r.avaliacoes.length) {
    return `<section class="pv-card pv2-evol pv2-o-evol">${head()}
      <div class="pv-vazio"><p>Nenhuma avaliação registrada ainda.</p>
        <button class="btn-sm" data-pv-aba="avaliacoes">Nova avaliação</button></div></section>`;
  }
  const disponiveis = SERIES_VISAO.filter(s => pontosValidos(r.avaliacoes, s.id).length > 0);
  if (!disponiveis.some(s => s.id === _serie)) _serie = disponiveis[0]?.id || 'peso';
  const cfg = SERIES_VISAO.find(s => s.id === _serie);
  const pts = pontosValidos(r.avaliacoes, _serie);
  const abas = disponiveis.length > 1 ? `
    <div class="pv2-series" role="tablist" aria-label="Medida do gráfico">
      ${disponiveis.map(s => `<button type="button" role="tab" class="pv2-serie${s.id === _serie ? ' on' : ''}" aria-selected="${s.id === _serie}" data-pv-serie="${s.id}">${esc(s.rotulo)}</button>`).join('')}
    </div>` : '';

  let corpo;
  if (!pts.length) {
    corpo = `<div class="pv-vazio"><p>Nenhuma medida válida de ${esc(cfg.rotulo.toLowerCase())}.</p>
      <button class="btn-sm" data-pv-aba="avaliacoes">Abrir avaliações</button></div>`;
  } else if (pts.length === 1) {
    const p = pts[0];
    corpo = `
      <div class="pv2-inicial">
        <span>Medida inicial · AV ${p.av.numero} · ${fmtData(p.av.data_avaliacao)}</span>
        <b>${fmt(p.valor)}${cfg.unidade}</b>
      </div>
      <p class="pv2-nada">Registre uma nova avaliação para acompanhar a evolução.</p>
      <button class="btn-sm" data-pv-aba="avaliacoes">Nova avaliação</button>`;
  } else {
    const ult = pts[pts.length - 1], pri = pts[0];
    const dif = Number((ult.valor - pri.valor).toFixed(1));
    corpo = `
      <p class="pv2-evol-res"><b>${fmt(ult.valor)}${cfg.unidade}</b> em ${fmtData(ult.av.data_avaliacao)}
        <span>· ${sinal(dif)}${cfg.unidade} desde ${fmtData(pri.av.data_avaliacao)} (${pts.length} medidas)</span></p>
      <div class="ev-grafico pv2-graf">${svgLinha(pts, { unidade: cfg.unidade.trim(), rotulo: cfg.rotulo, largura: 640, altura: 200 })}</div>`;
  }
  return `<section class="pv-card pv2-evol pv2-o-evol">${head(abas)}${corpo}</section>`;
}

// ── Plano alimentar e treino ─────────────────────────────────
function planoHtml(r) {
  const p = r.planoAtivo;
  if (!p) {
    return `
      <section class="pv-card pv2-cartao">
        <div class="pv-card-head"><h3><i data-lucide="utensils"></i> Plano alimentar</h3></div>
        <div class="pv-vazio"><p>Nenhum plano alimentar ativo.</p>
          <button class="btn-sm" data-pv-aba="planejamento">Criar plano</button></div>
      </section>`;
  }
  // Dois números de energia SÓ com o nome de cada um: o prescrito no plano e o
  // gasto estimado na avaliação. Nunca dois valores soltos.
  const avGet = [...r.avaliacoes].reverse().find(a => Number(a.get_kcal) > 0);
  const publicado = p.data_inicio || p.criado_em;
  return `
    <section class="pv-card pv2-cartao">
      <div class="pv-card-head"><h3><i data-lucide="utensils"></i> Plano alimentar</h3></div>
      <div class="pv-card-tit">${esc(p.nome || 'Plano sem nome')}</div>
      <div class="pv-card-linhas">
        ${linha('Plano prescrito', p.kcal_meta ? `${fmt(p.kcal_meta, 0)} kcal` : 'Não definido')}
        ${avGet ? linha('Gasto estimado', `${fmt(avGet.get_kcal, 0)} kcal (AV ${avGet.numero})`) : ''}
        ${linha('Publicado', publicado ? fmtData(publicado) : 'Não registrado')}
        ${linha('Próxima revisão', p.data_fim ? fmtData(p.data_fim) : 'Não definida')}
      </div>
      <button class="btn-sm pv2-abrir" data-pv-aba="planejamento">Abrir plano</button>
    </section>`;
}

function treinoHtml(r) {
  const t = r.treinoAtivo;
  if (!t) {
    return `
      <section class="pv-card pv2-cartao">
        <div class="pv-card-head"><h3><i data-lucide="dumbbell"></i> Treino</h3></div>
        <div class="pv-vazio"><p>Nenhum treino ativo.</p>
          <button class="btn-sm" data-pv-aba="treinos">Criar treino</button></div>
      </section>`;
  }
  const dias = (t.divisao || '').replace(/[^A-Za-z]/g, '').length;
  return `
    <section class="pv-card pv2-cartao">
      <div class="pv-card-head"><h3><i data-lucide="dumbbell"></i> Treino</h3></div>
      <div class="pv-card-tit">${esc(t.nome || 'Treino sem nome')}</div>
      <div class="pv-card-linhas">
        ${linha('Divisão', t.divisao ? `${t.divisao} · ${dias} ${dias === 1 ? 'treino' : 'treinos'}` : 'Não definida')}
        ${linha('Início', t.data_inicio ? fmtData(t.data_inicio) : 'Não registrado')}
        ${linha('Próxima revisão', t.data_fim ? fmtData(t.data_fim) : 'Não definida')}
      </div>
      <button class="btn-sm pv2-abrir" data-pv-aba="treinos">Abrir treino</button>
    </section>`;
}

// ── Agenda (lateral) ─────────────────────────────────────────
// Última consulta e próximo retorno. Não há módulo de agendamento de consulta
// ainda: a ação é registrar a consulta.
function agendaHtml(r) {
  if (!moduloAtivo('consultas')) return '';
  const retorno = r.consultaAberta?.status === 'agendada' ? r.consultaAberta.data_hora : r.retornoSugerido;
  return `
    <section class="pv-card" aria-labelledby="pvAgT">
      <div class="pv-card-head"><h3 id="pvAgT"><i data-lucide="calendar-days"></i> Agenda</h3></div>
      <div class="pv-card-linhas">
        ${linha('Última consulta', r.ultimaConsulta ? `${fmtData(r.ultimaConsulta.data_hora)}${r.dias.ultimaConsulta != null ? ` · há ${r.dias.ultimaConsulta} ${r.dias.ultimaConsulta === 1 ? 'dia' : 'dias'}` : ''}` : 'Nenhuma registrada')}
        ${linha('Próximo retorno', retorno ? fmtData(retorno) : 'Não agendado')}
      </div>
      <button class="btn-sm pv2-abrir" data-pv-aba="consultas">Registrar consulta</button>
    </section>`;
}

/**
 * Documentos no Saúde 360°.
 *
 * O número que interessa não é o total: é quantos o paciente ainda não abriu.
 * "8 arquivos" não sugere ação nenhuma; "2 pendentes de visualização" é o que
 * o profissional consegue tratar na próxima consulta.
 *
 * Privado NÃO conta como pendente — ninguém está esperando abrir um documento
 * que não foi compartilhado. Arquivado não entra em nada.
 *
 * Sem documento nenhum o card some, como o resto do painel: módulo sem dado
 * real não vira card vazio.
 */
function documentosHtml() {
  if (!moduloAtivo('documentos')) return '';
  const d = _documentos;
  if (!d) return '';                 // ainda carregando, ou falhou: nada a afirmar
  if (!d.total) return '';           // consistente com plano/treino/metas vazios

  const linhas = [
    linha('Compartilhados', String(d.disponiveis)),
    d.privados ? linha('Privados', String(d.privados)) : '',
    d.ultimo ? linha('Último', `${esc(d.ultimo.titulo)}${d.ultimo.data ? ` · ${fmtData(d.ultimo.data)}` : ''}`) : '',
  ].filter(Boolean).join('');

  return `
    <section class="pv-card">
      <div class="pv-card-head">
        <h3><i data-lucide="paperclip"></i> Documentos</h3>
        <button class="pv-link" data-pv-aba="documentos">Ver documentos</button>
      </div>
      <div class="pv-card-tit">
        ${d.total} ${d.total === 1 ? 'arquivo' : 'arquivos'}${
          d.pendentes ? ` · <span class="pv-doc-pend">${d.pendentes} ${
            d.pendentes === 1 ? 'pendente' : 'pendentes'} de visualização</span>` : ''}
      </div>
      <div class="pv-card-linhas">${linhas}</div>
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

// ── Pendências: tarefas registradas + alertas automáticos, num bloco só ──
// A tarefa é uma decisão guardada; o alerta é uma leitura do estado que some
// quando a causa acaba. Aparecem juntos, com a origem sempre visível.
function acoesHtml() {
  const total = _tarefas.length + _alertas.length;
  const cabecalho = `
    <div class="pv-card-head">
      <h3><i data-lucide="list-checks"></i> Pendências</h3>
      <div class="pv-card-head-dir">
        ${total ? `<span class="pv-contador">${total}</span>` : ''}
        ${moduloAtivo('tarefas') ? `<button class="pv-link" data-tarefa-nova>Nova tarefa</button>` : ''}
      </div>
    </div>`;

  if (!total) {
    return `<section class="pv-card pv2-pend">${cabecalho}
      <div class="pv-tudo-ok"><i data-lucide="check"></i> Tudo em dia com este paciente.</div></section>`;
  }

  // Tarefas e alertas na MESMA fila: prioridade, depois o mais antigo.
  const PRIO_TAREFA = { alta: 'importante', normal: 'atencao', baixa: 'informativo' };
  const itens = ordenarPendencias([
    ..._tarefas.map(t => ({ tarefa: t, prioridade: PRIO_TAREFA[t.prioridade] || 'atencao', desde: t.prazo || t.criado_em })),
    ..._alertas.map(a => ({ alerta: a, prioridade: a.prioridade, desde: a.desde })),
  ]);
  const visiveis = _verTodos ? itens : itens.slice(0, 4);
  const resto = itens.length - visiveis.length;

  return `
    <section class="pv-card pv2-pend">${cabecalho}
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
        ${moduloAtivo('tarefas') ? `<button class="pv-link pv2-discreto" data-alerta-tarefa="${esc(a.id)}" title="Guardar como tarefa com prazo">Virar tarefa</button>` : ''}
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

  // Evolução: troca a medida do gráfico (Peso · Gordura · Cintura). Redesenha
  // SÓ o card — o resto do painel (e a timeline) não vai à rede de novo.
  const ligarSeries = () => corpo.querySelectorAll('[data-pv-serie]').forEach(b =>
    b.addEventListener('click', () => {
      _serie = b.dataset.pvSerie;
      const sec = corpo.querySelector('.pv2-evol');
      if (!sec) return;
      sec.outerHTML = evolucaoHtml(r);
      const nova = corpo.querySelector('.pv2-evol');
      nova.querySelectorAll('[data-pv-aba]').forEach(x => x.addEventListener('click', () => _irParaAba?.(x.dataset.pvAba)));
      ligarSeries();
      window.renderIcons?.();
      nova.querySelector(`[data-pv-serie="${_serie}"]`)?.focus();
    }));
  ligarSeries();

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
