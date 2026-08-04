// ═══════════════════════════════════════════════════════════
// FINANCEIRO · RESUMO — a equipe ao longo do tempo
// ═══════════════════════════════════════════════════════════
// Os números existem desde a importação da planilha; o que faltava era lê-los
// juntos. Quatro perguntas, nesta ordem: quanto custou no período, como isso
// se distribuiu no tempo, quanto foi hora e quanto foi bônus, e quem pesou
// mais.
//
// TABELA SEMPRE DISPONÍVEL. Não é enfeite de acessibilidade: é onde se
// confere o número exato que o gráfico só sugere — e é o que torna a tela
// utilizável por quem não distingue as duas cores.

import { sb } from './supabase.js';
import { nomeCompetencia, formatarBRL } from './folha.js';
import { formatarData, mostrarErro } from './utils.js';
import {
  SERIES, graficoMensal, graficoPorPessoa, rotuloCurto, brl,
} from './resumo-grafico.js';

let _container = null;
let _meses = [];
let _pessoas = [];
let _periodo = 12;        // meses mostrados
let _tabela = false;

const PERIODOS = [
  { meses: 12, rotulo: '12 meses' },
  { meses: 24, rotulo: '24 meses' },
  { meses: 999, rotulo: 'Tudo' },
];

// ───────────────────────────────────────────────────────────
export async function initResumoUI(nutriId, containerId) {
  _container = containerId;
  const cont = document.getElementById(containerId);
  if (!cont) return;
  cont.innerHTML = `<div class="loading"><div class="spinner"></div>Somando as competências...</div>`;

  try {
    [_meses, _pessoas] = await Promise.all([carregarMeses(), carregarPessoas()]);
  } catch (e) {
    cont.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>
      ${esc(traduzirErro(e.message))}</div>`;
    return;
  }
  render();
}

async function carregarMeses() {
  const { data, error } = await sb
    .from('folha_resumo_mensal')
    .select('competencia, status, data_pagamento, pessoas, minutos, base, adicionais, total')
    .order('competencia', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function carregarPessoas() {
  const { data, error } = await sb
    .from('folha_resumo_colaborador')
    .select('colaborador_id, nome, cargo, ativo, competencia, minutos, base, adicionais, total');
  if (error) throw error;
  return data || [];
}

// ───────────────────────────────────────────────────────────
function mesesVisiveis() {
  return _meses.slice(Math.max(0, _meses.length - _periodo));
}

/** Soma por pessoa dentro da janela mostrada — o recorte tem que ser o mesmo
 *  dos dois gráficos, senão o total de um não fecha com o do outro. */
function pessoasNoPeriodo() {
  const janela = new Set(mesesVisiveis().map(m => m.competencia));
  const soma = new Map();
  for (const p of _pessoas) {
    if (!janela.has(p.competencia)) continue;
    const atual = soma.get(p.colaborador_id) || { nome: p.nome, cargo: p.cargo, total: 0, meses: 0 };
    atual.total += Number(p.total) || 0;
    atual.meses += 1;
    soma.set(p.colaborador_id, atual);
  }
  return [...soma.values()];
}

function render() {
  const cont = document.getElementById(_container);
  if (!cont) return;

  const meses = mesesVisiveis();
  const pessoas = pessoasNoPeriodo();

  if (!_meses.length) {
    cont.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><i data-lucide="chart-column"></i></div>
      Nenhuma competência lançada ainda. O resumo aparece assim que a primeira folha existir.</div>`;
    return;
  }

  const total = meses.reduce((s, m) => s + (Number(m.total) || 0), 0);
  const media = meses.length ? total / meses.length : 0;
  const maior = meses.reduce((a, m) => (Number(m.total) || 0) > (Number(a?.total) || 0) ? m : a, meses[0]);
  const ultimo = meses[meses.length - 1];
  const somaAdicionais = meses.reduce((s, m) => s + (Number(m.adicionais) || 0), 0);
  const pctAdicionais = total ? (somaAdicionais / total) * 100 : 0;

  const { svg, barras } = graficoMensal(meses);

  cont.innerHTML = `
    <div class="rs-barra">
      <div class="fn-filtros" role="group" aria-label="Período">
        ${PERIODOS.map(p => `
          <button class="fn-chip${_periodo === p.meses ? ' on' : ''}" data-rs-periodo="${p.meses}">${p.rotulo}</button>`).join('')}
      </div>
      <button class="btn-sm btn-sm-secondary" id="rsTabela">
        <i data-lucide="${_tabela ? 'chart-column' : 'table'}"></i>
        ${_tabela ? 'Ver gráfico' : 'Ver tabela'}
      </button>
    </div>

    <div class="rs-tiles">
      ${tile('Total no período', formatarBRL(total), `${meses.length} ${meses.length === 1 ? 'competência' : 'competências'}`)}
      ${tile('Média por mês', formatarBRL(media), `${pessoas.length} ${pessoas.length === 1 ? 'pessoa' : 'pessoas'} no período`)}
      ${tile('Maior mês', formatarBRL(maior?.total), nomeCompetencia(maior?.competencia))}
      ${tile('Peso dos adicionais', `${pctAdicionais.toFixed(0)}%`, formatarBRL(somaAdicionais))}
    </div>

    <div class="rs-cartao">
      <div class="rs-cartao-topo">
        <div>
          <div class="rs-titulo">Custo mensal da equipe</div>
          <div class="rs-sub">Horas trabalhadas e adicionais somam o total pago no mês</div>
        </div>
        <div class="rs-legenda">
          ${SERIES.map(s => `
            <span class="rs-leg"><i style="background:${s.cor}"></i>${s.rotulo}</span>`).join('')}
        </div>
      </div>

      ${_tabela ? tabelaHtml(meses) : `
        <div class="rs-plot" id="rsPlot">
          ${svg}
          <div class="rs-tip" id="rsTip" hidden></div>
        </div>`}
    </div>

    <div class="rs-cartao">
      <div class="rs-cartao-topo">
        <div>
          <div class="rs-titulo">Custo por colaborador</div>
          <div class="rs-sub">Soma do período mostrado, do maior para o menor</div>
        </div>
      </div>
      ${pessoas.length
        ? graficoPorPessoa(pessoas)
        : '<div class="rs-vazio">Nenhum pagamento no período.</div>'}
    </div>

    ${ultimo?.status === 'rascunho'
      ? `<p class="rs-nota">${esc(nomeCompetencia(ultimo.competencia))} ainda está em rascunho —
         os valores dela mudam até a folha ser fechada.</p>`
      : ''}
  `;

  cont.querySelectorAll('[data-rs-periodo]').forEach(b => b.addEventListener('click', () => {
    _periodo = Number(b.dataset.rsPeriodo);
    render();
  }));
  document.getElementById('rsTabela').addEventListener('click', () => {
    _tabela = !_tabela;
    render();
  });

  if (!_tabela) ligarHover(barras);
}

function tile(rotulo, valor, sub) {
  return `
    <div class="rs-tile">
      <div class="rs-tile-rot">${esc(rotulo)}</div>
      <div class="rs-tile-val">${esc(valor)}</div>
      <div class="rs-tile-sub">${esc(sub || '')}</div>
    </div>`;
}

/**
 * Camada de hover. O alvo é a faixa inteira do mês, não o retângulo da barra:
 * um mês de valor baixo tem barra de 3px de altura, e mirar nela é impossível.
 */
function ligarHover(barras) {
  const plot = document.getElementById('rsPlot');
  const tip = document.getElementById('rsTip');
  if (!plot || !tip) return;

  const mostrar = (i, evento) => {
    const m = barras[i];
    if (!m) return;
    tip.innerHTML = `
      <div class="rs-tip-tit">${esc(nomeCompetencia(m.competencia))}</div>
      <div class="rs-tip-linha"><i style="background:${SERIES[0].cor}"></i>
        ${esc(SERIES[0].rotulo)}<b>${esc(brl(m.base))}</b></div>
      <div class="rs-tip-linha"><i style="background:${SERIES[1].cor}"></i>
        ${esc(SERIES[1].rotulo)}<b>${esc(brl(m.adicionais))}</b></div>
      <div class="rs-tip-total">Total<b>${esc(brl(m.total))}</b></div>
      <div class="rs-tip-pe">${m.pessoas} ${m.pessoas === 1 ? 'pessoa' : 'pessoas'}${
        m.data_pagamento ? ` · pago em ${formatarData(m.data_pagamento)}` : ''}</div>`;
    tip.hidden = false;

    const caixa = plot.getBoundingClientRect();
    const x = evento.clientX - caixa.left;
    // Perto da borda direita o balão vira para a esquerda, senão sai da tela.
    const largura = tip.offsetWidth || 200;
    tip.style.left = `${Math.min(Math.max(8, x + 14), caixa.width - largura - 8)}px`;
    tip.style.top = `${Math.max(8, evento.clientY - caixa.top - 12)}px`;
  };

  plot.querySelectorAll('[data-rg-mes]').forEach(g => {
    const i = Number(g.dataset.rgMes);
    g.addEventListener('mousemove', (e) => { g.classList.add('on'); mostrar(i, e); });
    g.addEventListener('mouseleave', () => { g.classList.remove('on'); tip.hidden = true; });
  });
  plot.addEventListener('mouseleave', () => { tip.hidden = true; });
}

/** A mesma informação em números exatos. */
function tabelaHtml(meses) {
  return `
    <div class="fp-tabela-wrap">
      <table class="fp-tabela rs-tabela">
        <thead>
          <tr>
            <th>Competência</th>
            <th class="fp-num">Pessoas</th>
            <th class="fp-num">Horas e fixo</th>
            <th class="fp-num">Adicionais</th>
            <th class="fp-num">Total</th>
          </tr>
        </thead>
        <tbody>
          ${[...meses].reverse().map(m => `
            <tr>
              <td>${esc(nomeCompetencia(m.competencia))}${
                m.status === 'rascunho' ? ' <span class="rs-rascunho">rascunho</span>' : ''}</td>
              <td class="fp-num">${m.pessoas}</td>
              <td class="fp-num">${esc(brl(m.base))}</td>
              <td class="fp-num">${esc(brl(m.adicionais))}</td>
              <td class="fp-num"><strong>${esc(brl(m.total))}</strong></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function traduzirErro(msg) {
  const m = String(msg || '').toLowerCase();
  if (m.includes('folha_resumo') || (m.includes('relation') && m.includes('resumo'))) {
    return 'As visões de resumo ainda não existem — rode db/financeiro_resumo.sql.';
  }
  return msg || 'Não consegui montar o resumo.';
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export { rotuloCurto };
