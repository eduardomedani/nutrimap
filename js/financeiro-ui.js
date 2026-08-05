// ═══════════════════════════════════════════════════════════
// FINANCEIRO DA EMPRESA — casca da página e navegação entre as seções
// ═══════════════════════════════════════════════════════════
// O resultado do negócio: o que entra, o que sai, o que está para receber e o
// que está para pagar. NÃO é a folha de pagamento — pessoas, horas, ponto e
// contracheques moram em Equipe e pagamentos (js/equipe-admin-ui.js).
//
// O custo da equipe aparece aqui como PARCELA do custo do mês, lida da folha,
// e a tela sempre mostra as duas parcelas separadas. Um total que junta
// despesas e folha sem dizer de onde cada pedaço veio é impossível de conferir
// no dia em que os dois números divergirem.
//
// A VISÃO GERAL NÃO ESCONDE O QUE FALTA. A importação da planilha trouxe
// lançamento sem categoria e lançamento sem valor; a tela abre com isso à
// vista, porque um total apresentado como fechado quando não é vale menos que
// nenhum total — quem confere caixa não pode duvidar do que lê.
//
// Despesas e Receitas são A MESMA TELA com `tipo` diferente. Duplicar a lista
// para trocar uma palavra criaria dois lugares para corrigir todo defeito de
// filtro, e o segundo é sempre o que fica para trás.

import {
  listarCategorias, listarLancamentos, folhaPorCompetencia,
  salvarLancamento, criarLancamento, excluirLancamento, fundirCategorias,
  somar, porCategoria, porAno, pendencias, serieAnual, totaisDoAno, anosDisponiveis,
  fluxoDeCaixa, forasDoFluxo,
  anoDa, dataBR, formatarBRL, nomeCompetencia, valorDeTexto, SEM_CATEGORIA,
} from './financeiro.js';
import {
  graficoReceitaDespesa, legendaHtml, graficoFluxo, legendaFluxoHtml, SERIES, brl,
} from './financeiro-grafico.js';

const SECOES = [
  { id: 'visao-geral', rotulo: 'Visão geral', icone: 'layout-dashboard',
    titulo: 'Financeiro',
    sub: 'Acompanhe receitas, despesas e o resultado da operação.' },
  { id: 'receitas', rotulo: 'Receitas', icone: 'trending-up',
    titulo: 'Receitas',
    sub: 'O que entra: consultas, planos, pacotes e recebimentos avulsos.' },
  { id: 'despesas', rotulo: 'Despesas', icone: 'trending-down',
    titulo: 'Despesas',
    sub: 'O que sai: custos fixos, variáveis e o custo da equipe.' },
  { id: 'contas-receber', rotulo: 'Contas a receber', icone: 'hand-coins',
    titulo: 'Contas a receber',
    sub: 'Cobranças em aberto, vencidas e o que entra nos próximos dias.' },
  { id: 'contas-pagar', rotulo: 'Contas a pagar', icone: 'file-clock',
    titulo: 'Contas a pagar',
    sub: 'Compromissos com data marcada, antes de virarem atraso.' },
  { id: 'fluxo-caixa', rotulo: 'Fluxo de caixa', icone: 'waves',
    titulo: 'Fluxo de caixa',
    sub: 'Entradas e saídas no tempo, com o saldo acumulado.' },
  { id: 'categorias', rotulo: 'Categorias', icone: 'tags',
    titulo: 'Categorias',
    sub: 'O plano de contas: como cada lançamento é classificado.' },
  { id: 'relatorios', rotulo: 'Relatórios', icone: 'file-chart-column',
    titulo: 'Relatórios',
    sub: 'Fechamentos por período, comparativos e exportação.' },
];

const MIOLO = 'finConteudo';
let _nutriId = null;
let _secao = null;
let _aoAbrirEquipe = null;

/** Cache do período inteiro: são centenas de linhas de três anos, e toda seção
 *  precisa do conjunto todo para somar. Reler a cada troca de aba seria a mesma
 *  consulta quatro vezes por visita. */
let _cache = null;
let _tipo = 'despesa';
let _anoGrafico = null;
let _filtroDespesa = null;       // armado pelos atalhos de pendência
const _filtro = { ano: '', categoria: '', busca: '' };

export { SECOES };

export async function initFinanceiroUI(nutriId, secao = 'visao-geral', opcoes = {}) {
  _nutriId = nutriId;
  _aoAbrirEquipe = opcoes.aoAbrirEquipe || null;
  _cache = null;

  const page = document.getElementById('page-financeiro');
  if (!page) return;

  const alvo = SECOES.find(s => s.id === secao) || SECOES[0];

  page.innerHTML = `
    <div class="page-header">
      <div class="fn-trilha"><i data-lucide="wallet"></i> Financeiro da empresa</div>
      <h1 class="page-title"><i data-lucide="${alvo.icone}"></i> <em>${alvo.titulo}</em></h1>
      <div class="page-sub" id="finSub">${alvo.sub}</div>
    </div>

    <nav class="fin-abas" role="tablist" aria-label="Seções do Financeiro">
      ${SECOES.map(s => `
        <button class="fin-aba${s.id === alvo.id ? ' on' : ''}" role="tab"
                aria-selected="${s.id === alvo.id}" data-fin-secao="${s.id}">
          <i data-lucide="${s.icone}"></i> ${s.rotulo}
        </button>`).join('')}
    </nav>

    <div id="${MIOLO}"><div class="loading"><div class="spinner"></div>Carregando...</div></div>
  `;

  page.querySelectorAll('[data-fin-secao]').forEach(b =>
    b.addEventListener('click', () => abrirSecao(b.dataset.finSecao)));

  await montarSecao(alvo.id);
}

/** Troca de aba sem redesenhar o cabeçalho inteiro. */
export async function abrirSecao(id) {
  if (id === _secao) return;
  const alvo = SECOES.find(s => s.id === id);
  if (!alvo) return;

  const page = document.getElementById('page-financeiro');
  if (!page) return;
  page.querySelectorAll('[data-fin-secao]').forEach(b => {
    const on = b.dataset.finSecao === id;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });

  const titulo = page.querySelector('.page-title');
  if (titulo) titulo.innerHTML = `<i data-lucide="${alvo.icone}"></i> <em>${alvo.titulo}</em>`;
  const sub = document.getElementById('finSub');
  if (sub) sub.textContent = alvo.sub;

  await montarSecao(id);
}

async function montarSecao(id) {
  _secao = id;
  try { history.replaceState(null, '', `#financeiro/${id}`); } catch (e) {}

  const miolo = document.getElementById(MIOLO);
  if (!miolo) return;

  if (id === 'visao-geral')  { await montarVisaoGeral(miolo); return; }
  if (id === 'despesas')     { await montarDespesas(miolo, 'despesas'); return; }
  if (id === 'contas-pagar') { await montarDespesas(miolo, 'contas-pagar'); return; }
  if (id === 'receitas')     { await montarLista(miolo, 'receita'); return; }
  if (id === 'fluxo-caixa')  { await montarFluxo(miolo); return; }
  if (id === 'categorias')   { await montarCategorias(miolo); return; }

  const alvo = SECOES.find(s => s.id === id);
  miolo.innerHTML = emConstrucaoHtml(alvo);
  ligarAcoes(miolo);
}

// ───────────────────────────────────────────────────────────
// DADOS
// ───────────────────────────────────────────────────────────

/** Carrega uma vez por visita. `recarregar` força depois de uma edição. */
async function dados({ recarregar = false } = {}) {
  if (_cache && !recarregar) return _cache;
  const [lancamentos, categorias, folha] = await Promise.all([
    listarLancamentos({}),
    listarCategorias(),
    folhaPorCompetencia(),
  ]);
  _cache = { lancamentos, categorias, folha };
  return _cache;
}

const doTipo = (lista, tipo) => (lista || []).filter(l => l.tipo === tipo);

/** Erro de leitura com a causa à mostra. Um "não foi possível carregar" sem o
 *  motivo transforma tabela-que-falta-rodar em bug de código. */
function erroHtml(e) {
  const msg = String(e?.message || e || '');
  const faltaTabela = /does not exist|schema cache|relation/i.test(msg);
  return `
    <div class="fe-vazio">
      <div class="fe-vazio-icone"><i data-lucide="triangle-alert"></i></div>
      <div class="fe-vazio-tit">${faltaTabela ? 'As tabelas do Financeiro ainda não existem' : 'Não consegui ler os lançamentos'}</div>
      <div class="fe-vazio-sub">${faltaTabela
        ? 'Rode <code>db/financeiro_lancamentos.sql</code> e depois <code>db/financeiro_lancamentos_seed.sql</code> no SQL Editor do Supabase.'
        : esc(msg)}</div>
      ${faltaTabela ? `<div class="fe-vazio-tag">${esc(msg)}</div>` : ''}
    </div>`;
}

// ───────────────────────────────────────────────────────────
// VISÃO GERAL
// ───────────────────────────────────────────────────────────
async function montarVisaoGeral(miolo) {
  miolo.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando...</div>`;

  let d;
  try { d = await dados(); }
  catch (e) { miolo.innerHTML = erroHtml(e); return; }

  const despesas = doTipo(d.lancamentos, 'despesa');
  const receitas = doTipo(d.lancamentos, 'receita');

  if (!d.lancamentos.length) { miolo.innerHTML = vazioHtml('despesa'); ligarAcoes(miolo); return; }

  const totalDespesas = somar(despesas);
  const totalReceitas = somar(receitas);
  const totalFolha = d.folha.reduce((s, f) => s + (Number(f.total) || 0), 0);
  const pend = pendencias(d.lancamentos);
  const anos = porAno(despesas);
  const cats = porCategoria(despesas, d.categorias);
  const meses = d.lancamentos.map(l => l.competencia).sort();

  const maiorAno = Math.max(...anos.map(a => a.total), 1);

  miolo.innerHTML = `
    <div class="fx-acoes-topo">
      <button class="btn primary" id="fxNovaDespesa">
        <i data-lucide="plus"></i> Nova despesa
      </button>
    </div>

    <div class="rs-tiles">
      <div class="rs-tile">
        <div class="rs-tile-rot">Despesas lançadas</div>
        <div class="rs-tile-val">${esc(formatarBRL(totalDespesas))}</div>
        <div class="rs-tile-sub">${despesas.length} lançamentos</div>
      </div>
      <div class="rs-tile">
        <div class="rs-tile-rot">Custo da equipe</div>
        <div class="rs-tile-val">${esc(formatarBRL(totalFolha))}</div>
        <div class="rs-tile-sub">${d.folha.length} competências · apurado na folha</div>
      </div>
      <div class="rs-tile">
        <div class="rs-tile-rot">Custo total</div>
        <div class="rs-tile-val">${esc(formatarBRL(totalDespesas + totalFolha))}</div>
        <div class="rs-tile-sub">despesas + folha</div>
      </div>
      <div class="rs-tile">
        <div class="rs-tile-rot">${receitas.length ? 'Receitas lançadas' : 'Período'}</div>
        ${receitas.length
          ? `<div class="rs-tile-val">${esc(formatarBRL(totalReceitas))}</div>
             <div class="rs-tile-sub">${receitas.length} lançamentos</div>`
          : `<div class="rs-tile-val fx-tile-txt">${esc(nomeCompetencia(meses[0]))}</div>
             <div class="rs-tile-sub">até ${esc(nomeCompetencia(meses[meses.length - 1]))}</div>`}
      </div>
    </div>

    ${pendenciasHtml(pend)}

    <div class="fx-bloco" id="fxGraficoBloco"></div>

    <div class="fx-bloco">
      <div class="fx-bloco-tit"><i data-lucide="calendar-range"></i> Despesas por ano</div>
      <div class="fx-barras">
        ${anos.map(a => `
          <div class="fx-barra-linha">
            <div class="fx-barra-rot">${esc(a.ano)}</div>
            <div class="fx-barra-trilho">
              <div class="fx-barra-fill" style="width:${(a.total / maiorAno * 100).toFixed(1)}%"></div>
            </div>
            <div class="fx-barra-val">${esc(formatarBRL(a.total))}</div>
          </div>`).join('')}
      </div>
      <p class="fe-nota">
        Só despesas de operação. O custo da equipe é apurado na folha e não é
        somado aqui para não aparecer duas vezes.
      </p>
    </div>

    <div class="fx-bloco">
      <div class="fx-bloco-tit"><i data-lucide="tags"></i> Para onde foi o dinheiro</div>
      <table class="fp-tabela fx-tabela">
        <thead><tr><th>Categoria</th><th class="fx-num">Lançamentos</th><th class="fx-num">Total</th><th class="fx-num">%</th></tr></thead>
        <tbody>
          ${cats.map(c => `
            <tr${c.id ? '' : ' class="fx-pendente"'}>
              <td data-rot="Categoria">${c.id ? esc(c.nome) : `<i data-lucide="circle-help"></i> ${esc(SEM_CATEGORIA)}`}</td>
              <td class="fx-num" data-rot="Lançamentos">${c.n}</td>
              <td class="fx-num" data-rot="Total">${esc(formatarBRL(c.total))}</td>
              <td class="fx-num" data-rot="Participação">${(c.total / (totalDespesas || 1) * 100).toFixed(1)}%</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="fe-ponte">
      <div class="fe-ponte-info">
        <div class="fe-ponte-rot"><i data-lucide="users-round"></i> Custo da equipe</div>
        <div class="fe-ponte-val">${esc(formatarBRL(totalFolha))}</div>
        <div class="fe-ponte-sub">horas, adicionais e contracheques ficam em Equipe e pagamentos</div>
      </div>
      <button class="btn" id="feVerEquipe">
        Ver folha e colaboradores <i data-lucide="arrow-right"></i>
      </button>
    </div>
  `;

  desenharGrafico();
  ligarAcoes(miolo);
}

// ───────────────────────────────────────────────────────────
// RECEITA × DESPESA DO ANO
// ───────────────────────────────────────────────────────────

/** Redesenha só o bloco do gráfico. Trocar de ano não pode remontar a Visão
 *  geral inteira: o scroll voltaria ao topo a cada clique no seletor. */
function desenharGrafico() {
  const bloco = document.getElementById('fxGraficoBloco');
  if (!bloco || !_cache) return;

  const anos = anosDisponiveis(_cache.lancamentos, _cache.folha);
  if (!anos.length) { bloco.innerHTML = ''; return; }

  // Abre no ano mais recente com movimento, não no ano do relógio: em janeiro,
  // o ano corrente ainda está quase vazio e o gráfico abriria em branco.
  if (!_anoGrafico || !anos.includes(_anoGrafico)) _anoGrafico = anos[0];

  const meses = serieAnual(_cache.lancamentos, _cache.folha, _anoGrafico);
  const t = totaisDoAno(meses);
  const { svg, barras } = graficoReceitaDespesa(meses);

  bloco.innerHTML = `
    <div class="fx-bloco-topo">
      <div class="fx-bloco-tit"><i data-lucide="chart-column-big"></i> Receita × Despesa</div>
      <select class="fp-select fx-sel-ano" id="fxAnoGrafico" aria-label="Ano do gráfico">
        ${anos.map(a => `<option value="${a}"${a === _anoGrafico ? ' selected' : ''}>${a}</option>`).join('')}
      </select>
    </div>

    <div class="rs-tiles fx-tiles-ano">
      <div class="rs-tile">
        <div class="rs-tile-rot">Receita em ${esc(_anoGrafico)}</div>
        <div class="rs-tile-val">${esc(formatarBRL(t.receita))}</div>
      </div>
      <div class="rs-tile">
        <div class="rs-tile-rot">Custo total</div>
        <div class="rs-tile-val">${esc(formatarBRL(t.custo))}</div>
        <div class="rs-tile-sub">${esc(formatarBRL(t.despesa))} lançados + ${esc(formatarBRL(t.folha))} de folha</div>
      </div>
      <div class="rs-tile">
        <div class="rs-tile-rot">Resultado</div>
        <div class="rs-tile-val ${t.resultado < 0 ? 'fx-negativo' : 'fx-positivo'}">${esc(formatarBRL(t.resultado))}</div>
        <div class="rs-tile-sub">receita − custo total</div>
      </div>
    </div>

    <div class="rs-plot" id="fxPlot">
      ${svg}
      <div class="rs-tip" id="fxTip" hidden></div>
    </div>

    ${legendaHtml()}

    <p class="fe-nota">
      Os doze meses aparecem sempre, inclusive os vazios: mês sem receita é um
      fato sobre o negócio, não falta de dado. A folha vem do módulo Equipe.
    </p>
  `;

  const sel = document.getElementById('fxAnoGrafico');
  if (sel) sel.addEventListener('change', () => { _anoGrafico = sel.value; desenharGrafico(); });

  ligarHoverGrafico(barras);
}

/** O alvo do hover é a faixa inteira do mês, não o retângulo da barra: um mês
 *  de valor baixo tem barra de 3px e mirar nela é impossível. */
function ligarHoverGrafico(barras) {
  const plot = document.getElementById('fxPlot');
  const tip = document.getElementById('fxTip');
  if (!plot || !tip) return;

  const mostrar = (i, evento) => {
    const m = barras[i];
    if (!m) return;
    tip.innerHTML = `
      <div class="rs-tip-tit">${esc(nomeCompetencia(m.competencia))}</div>
      <div class="rs-tip-linha"><i style="background:${SERIES[0].cor}"></i>
        ${esc(SERIES[0].rotulo)}<b>${esc(brl(m.receita))}</b></div>
      <div class="rs-tip-linha"><i style="background:${SERIES[1].cor}"></i>
        ${esc(SERIES[1].rotulo)}<b>${esc(brl(m.despesa))}</b></div>
      <div class="rs-tip-linha"><i style="background:${SERIES[2].cor}"></i>
        ${esc(SERIES[2].rotulo)}<b>${esc(brl(m.folha))}</b></div>
      <div class="rs-tip-total">Resultado<b>${esc(brl(m.resultado))}</b></div>`;
    tip.hidden = false;

    const caixa = plot.getBoundingClientRect();
    const x = evento.clientX - caixa.left;
    // Perto da borda direita o balão vira para a esquerda, senão sai da tela.
    const largura = tip.offsetWidth || 200;
    tip.style.left = `${Math.min(Math.max(8, x + 14), caixa.width - largura - 8)}px`;
    tip.style.top = `${Math.max(8, evento.clientY - caixa.top - 12)}px`;
  };

  plot.querySelectorAll('[data-fg-mes]').forEach(g => {
    const i = Number(g.dataset.fgMes);
    g.addEventListener('mousemove', e => { g.classList.add('on'); mostrar(i, e); });
    g.addEventListener('mouseleave', () => { g.classList.remove('on'); tip.hidden = true; });
  });
  plot.addEventListener('mouseleave', () => { tip.hidden = true; });
}

function pendenciasHtml(pend) {
  // Cada atalho leva à lista JÁ FILTRADA pelo que o número acabou de contar.
  // Mandar para a lista inteira obrigaria a refazer na mão a busca que o
  // próprio alerta descreveu.
  const itens = [];
  if (pend.semCategoria.length)
    itens.push({ n: pend.semCategoria.length, txt: 'sem categoria', icone: 'tag',
                 filtro: { pendencia: 'sem-categoria' } });
  if (pend.semValor.length)
    itens.push({ n: pend.semValor.length, txt: 'sem valor', icone: 'circle-dollar-sign',
                 filtro: { pendencia: 'sem-valor' } });
  if (pend.naoPagos.length)
    itens.push({ n: pend.naoPagos.length, txt: 'ainda não pagos', icone: 'clock',
                 filtro: { status: 'aberto' } });
  if (!itens.length) return '';

  return `
    <div class="fx-pend">
      <div class="fx-pend-tit"><i data-lucide="triangle-alert"></i> O total ainda não está fechado</div>
      <div class="fx-pend-itens">
        ${itens.map(i => `
          <button class="fx-pend-item" data-fin-ir="despesas"
                  data-fin-filtro="${esc(JSON.stringify(i.filtro))}">
            <i data-lucide="${i.icone}"></i>
            <strong>${i.n}</strong> ${esc(i.txt)}
          </button>`).join('')}
      </div>
      <p class="fe-nota">
        Vieram assim da planilha. Nada foi classificado por semelhança de texto:
        um centro de custo adivinhado entra no relatório como se fosse informação.
      </p>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// FLUXO DE CAIXA
// ───────────────────────────────────────────────────────────
let _anoFluxo = null;

async function montarFluxo(miolo) {
  miolo.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando...</div>`;

  let d;
  try { d = await dados(); }
  catch (e) { miolo.innerHTML = erroHtml(e); return; }

  if (!d.lancamentos.length) { miolo.innerHTML = vazioHtml('despesa'); ligarAcoes(miolo); return; }

  miolo.innerHTML = `<div id="fxFluxoBloco"></div>`;
  desenharFluxo();
}

function desenharFluxo() {
  const bloco = document.getElementById('fxFluxoBloco');
  if (!bloco || !_cache) return;

  const anos = anosDisponiveis(_cache.lancamentos, _cache.folha);
  if (!anos.length) { bloco.innerHTML = ''; return; }
  if (!_anoFluxo || !anos.includes(_anoFluxo)) _anoFluxo = anos[0];

  const meses = fluxoDeCaixa(_cache.lancamentos, _cache.folha, _anoFluxo);
  const fora = forasDoFluxo(_cache.lancamentos);
  const { svg, barras } = graficoFluxo(meses);

  const entrou = somarCampo(meses, 'entrou');
  const saiu = somarCampo(meses, 'saiu');
  const fecho = meses[meses.length - 1]?.acumulado || 0;
  const aPagar = somarCampo(meses, 'aPagar');
  const aReceber = somarCampo(meses, 'aReceber');

  bloco.innerHTML = `
    <div class="fx-bloco-topo">
      <div class="fx-bloco-tit"><i data-lucide="waves"></i> Fluxo de caixa realizado</div>
      <select class="fp-select fx-sel-ano" id="fxAnoFluxo" aria-label="Ano do fluxo">
        ${anos.map(a => `<option value="${a}"${a === _anoFluxo ? ' selected' : ''}>${a}</option>`).join('')}
      </select>
    </div>

    <div class="rs-tiles fx-tiles-ano">
      <div class="rs-tile">
        <div class="rs-tile-rot">Entrou em ${esc(_anoFluxo)}</div>
        <div class="rs-tile-val fx-positivo">${esc(formatarBRL(entrou))}</div>
        <div class="rs-tile-sub">pela data do recebimento</div>
      </div>
      <div class="rs-tile">
        <div class="rs-tile-rot">Saiu</div>
        <div class="rs-tile-val fx-negativo">${esc(formatarBRL(saiu))}</div>
        <div class="rs-tile-sub">despesas pagas + folha</div>
      </div>
      <div class="rs-tile">
        <div class="rs-tile-rot">Saldo do ano</div>
        <div class="rs-tile-val ${fecho < 0 ? 'fx-negativo' : 'fx-positivo'}">${esc(formatarBRL(fecho))}</div>
        <div class="rs-tile-sub">acumulado em dezembro</div>
      </div>
      <div class="rs-tile">
        <div class="rs-tile-rot">Ainda em aberto</div>
        <div class="rs-tile-val fx-tile-txt">${esc(formatarBRL(aReceber - aPagar))}</div>
        <div class="rs-tile-sub">${esc(formatarBRL(aReceber))} a receber · ${esc(formatarBRL(aPagar))} a pagar</div>
      </div>
    </div>

    <div class="rs-plot" id="fxFluxoPlot">
      ${svg}
      <div class="rs-tip" id="fxFluxoTip" hidden></div>
    </div>

    ${legendaFluxoHtml()}

    ${foraDoFluxoHtml(fora)}

    <div class="fx-bloco">
      <div class="fx-bloco-tit"><i data-lucide="table"></i> Mês a mês</div>
      <div class="fp-tabela-wrap">
        <table class="fp-tabela fx-tabela">
          <thead>
            <tr>
              <th>Mês</th><th class="fx-c">Entrou</th><th class="fx-c">Saiu</th>
              <th class="fx-c">Saldo</th><th class="fx-c">Acumulado</th><th class="fx-c">Em aberto</th>
            </tr>
          </thead>
          <tbody>
            ${meses.map(m => `
              <tr${m.entrou || m.saiu || m.aPagar || m.aReceber ? '' : ' class="fx-mes-vazio"'}>
                <td data-rot="Mês">${esc(nomeCompetencia(m.competencia))}</td>
                <td class="fx-c" data-rot="Entrou">${m.entrou ? esc(formatarBRL(m.entrou)) : '—'}</td>
                <td class="fx-c" data-rot="Saiu">${m.saiu ? esc(formatarBRL(m.saiu)) : '—'}</td>
                <td class="fx-c ${m.saldo < 0 ? 'fx-negativo' : ''}" data-rot="Saldo">${
                  esc(formatarBRL(m.saldo))}</td>
                <td class="fx-c ${m.acumulado < 0 ? 'fx-negativo' : ''}" data-rot="Acumulado">${
                  esc(formatarBRL(m.acumulado))}</td>
                <td class="fx-c" data-rot="Em aberto">${m.aPagar || m.aReceber
                  ? esc(formatarBRL(m.aReceber - m.aPagar)) : '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="fe-nota">
        Realizado pela data em que o dinheiro andou (<em>pago em</em>), não pela
        competência. Um boleto de julho pago em agosto sai do caixa em agosto —
        é isso que o extrato do banco mostra.
      </p>
    </div>`;

  const sel = document.getElementById('fxAnoFluxo');
  if (sel) sel.addEventListener('change', () => { _anoFluxo = sel.value; desenharFluxo(); });

  ligarHoverFluxo(barras);
}

const somarCampo = (meses, campo) =>
  (meses || []).reduce((s, m) => s + Math.round((Number(m[campo]) || 0) * 100), 0) / 100;

/** O que o fluxo não conseguiu posicionar no tempo. Sem este aviso, o saldo
 *  apareceria como se fosse o caixa inteiro — e faltariam linhas dentro dele. */
function foraDoFluxoHtml(fora) {
  const n = fora.pagoSemData.length + fora.pendenteSemVencimento.length;
  if (!n) return '';
  return `
    <div class="fx-pend">
      <div class="fx-pend-tit"><i data-lucide="triangle-alert"></i> ${n} lançamento(s) fora do fluxo</div>
      <div class="fx-pend-itens">
        ${fora.pagoSemData.length ? `<span class="fx-pend-item fx-pend-info">
          <i data-lucide="calendar-off"></i>
          <strong>${fora.pagoSemData.length}</strong> pagos sem data de pagamento</span>` : ''}
        ${fora.pendenteSemVencimento.length ? `<span class="fx-pend-item fx-pend-info">
          <i data-lucide="calendar-off"></i>
          <strong>${fora.pendenteSemVencimento.length}</strong> em aberto sem vencimento</span>` : ''}
      </div>
      <p class="fe-nota">
        Sem data não há mês onde colocá-los, e chutar um poria dinheiro no lugar
        errado do calendário. Abra cada um e informe a data que falta.
      </p>
    </div>`;
}

function ligarHoverFluxo(barras) {
  const plot = document.getElementById('fxFluxoPlot');
  const tip = document.getElementById('fxFluxoTip');
  if (!plot || !tip) return;

  const mostrar = (i, evento) => {
    const m = barras[i];
    if (!m) return;
    tip.innerHTML = `
      <div class="rs-tip-tit">${esc(nomeCompetencia(m.competencia))}</div>
      <div class="rs-tip-linha"><i style="background:${SERIES[0].cor}"></i>
        Entrou<b>${esc(brl(m.entrou))}</b></div>
      <div class="rs-tip-linha"><i style="background:${SERIES[1].cor}"></i>
        Saiu<b>${esc(brl(m.saiu))}</b></div>
      ${m.folha ? `<div class="rs-tip-linha"><i style="background:${SERIES[2].cor}"></i>
        dos quais folha<b>${esc(brl(m.folha))}</b></div>` : ''}
      <div class="rs-tip-total">Saldo<b>${esc(brl(m.saldo))}</b></div>
      <div class="rs-tip-pe">Acumulado ${esc(brl(m.acumulado))}${
        m.aPagar || m.aReceber ? ` · em aberto ${esc(brl(m.aReceber - m.aPagar))}` : ''}</div>`;
    tip.hidden = false;

    const caixa = plot.getBoundingClientRect();
    const x = evento.clientX - caixa.left;
    const largura = tip.offsetWidth || 200;
    tip.style.left = `${Math.min(Math.max(8, x + 14), caixa.width - largura - 8)}px`;
    tip.style.top = `${Math.max(8, evento.clientY - caixa.top - 12)}px`;
  };

  plot.querySelectorAll('[data-fg-mes]').forEach(g => {
    const i = Number(g.dataset.fgMes);
    g.addEventListener('mousemove', e => { g.classList.add('on'); mostrar(i, e); });
    g.addEventListener('mouseleave', () => { g.classList.remove('on'); tip.hidden = true; });
  });
  plot.addEventListener('mouseleave', () => { tip.hidden = true; });
}

// ───────────────────────────────────────────────────────────
// DESPESAS — módulo próprio (lista, filtros, drawer)
// ───────────────────────────────────────────────────────────

/** A aba Despesas e a aba Contas a pagar são o MESMO módulo com recorte
 *  diferente: conta a pagar é despesa pendente com vencimento, não coleção
 *  própria. A casca só decide o recorte e passa o container. */
async function montarDespesas(miolo, modo) {
  miolo.innerHTML = `<div id="dspRaiz"></div>`;
  const { initDespesasUI, definirFiltro } = await import('./financeiro-despesas-ui.js');

  if (_filtroDespesa) { definirFiltro(_filtroDespesa); _filtroDespesa = null; }

  await initDespesasUI(_nutriId, 'dspRaiz', {
    modo,
    // Editar uma despesa muda os totais da Visão geral. Recarregar a página
    // inteira faria perder o scroll e a aba; recarregar o cache basta.
    aoMudar: async () => { await dados({ recarregar: true }); },
  });
}

/**
 * Abre o drawer de lançamento de qualquer aba.
 *
 * Despesa e receita usam O MESMO drawer. Antes, receita abria um modal
 * centralizado e despesa um painel lateral: duas telas para a mesma tarefa,
 * com dois espaçamentos e duas validações — e a segunda é sempre a que fica
 * para trás.
 */
/** Abre um lançamento existente no mesmo drawer — é por aqui que se dá baixa:
 *  mudar a situação para Pago/Recebido e informar a data. */
async function editarLancamento(id) {
  const l = _cache?.lancamentos.find(x => x.id === id);
  if (!l) return;
  const { abrirLancamento } = await import('./financeiro-lancamento-form.js');
  await abrirLancamento({
    nutriId: _nutriId,
    tipo: l.tipo === 'receita' ? 'receita' : 'despesa',
    lancamento: l,
    aoSalvar: async () => {
      await dados({ recarregar: true });
      const miolo = document.getElementById(MIOLO);
      if (_secao === 'visao-geral') await montarVisaoGeral(miolo);
      else await montarLista(miolo, _tipo);
    },
  });
}

async function novoLancamento(tipo = 'despesa') {
  const { abrirLancamento } = await import('./financeiro-lancamento-form.js');
  await abrirLancamento({
    nutriId: _nutriId,
    tipo,
    aoSalvar: async () => {
      await dados({ recarregar: true });
      const miolo = document.getElementById(MIOLO);
      if (_secao === 'visao-geral') await montarVisaoGeral(miolo);
      else if (_secao === 'receitas') await montarLista(miolo, 'receita');
    },
  });
}

// ───────────────────────────────────────────────────────────
// LISTA — a mesma tela para Receitas
// ───────────────────────────────────────────────────────────
async function montarLista(miolo, tipo) {
  _tipo = tipo;
  miolo.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando...</div>`;

  let d;
  try { d = await dados(); }
  catch (e) { miolo.innerHTML = erroHtml(e); return; }

  const doLado = doTipo(d.lancamentos, tipo);
  if (!doLado.length) { miolo.innerHTML = vazioHtml(tipo); ligarAcoes(miolo); return; }

  const anos = [...new Set(doLado.map(l => anoDa(l.competencia)))].sort().reverse();
  const cats = d.categorias.filter(c => c.tipo === tipo);

  // Mesma estrutura da aba Despesas: filtros de um lado, ação do outro. O botão
  // não pode participar da quebra de linha dos filtros — ver .dsp-toolbar.
  miolo.innerHTML = `
    <div class="dsp-toolbar">
      <div class="dsp-toolbar-filtros">
        <input class="fp-in dsp-busca" id="fxBusca" type="search"
               placeholder="Buscar ${tipo === 'receita' ? 'receitas' : 'despesas'}"
               value="${esc(_filtro.busca)}" aria-label="Buscar na descrição">
        <div class="dsp-filtros-campos">
          <select class="fp-select dsp-f dsp-f-ano" id="fxAno" aria-label="Ano">
            <option value="">Todos os anos</option>
            ${anos.map(a => `<option value="${a}"${_filtro.ano === a ? ' selected' : ''}>${a}</option>`).join('')}
          </select>
          <select class="fp-select dsp-f dsp-f-cat" id="fxCat" aria-label="Categoria">
            <option value="">Todas as categorias</option>
            <option value="sem"${_filtro.categoria === 'sem' ? ' selected' : ''}>— ${SEM_CATEGORIA} —</option>
            ${cats.map(c => `
              <option value="${c.id}"${_filtro.categoria === c.id ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="dsp-toolbar-acao">
        <button class="btn primary dsp-btn-nova" id="fxNovo" type="button">
          <i data-lucide="plus"></i> ${tipo === 'receita' ? 'Nova receita' : 'Nova despesa'}
        </button>
      </div>
    </div>

    <div id="fxLista"></div>
  `;

  miolo.querySelector('#fxBusca').addEventListener('input', debounce(e => {
    _filtro.busca = e.target.value; desenharLista();
  }, 200));
  miolo.querySelector('#fxAno').addEventListener('change', e => {
    _filtro.ano = e.target.value; desenharLista();
  });
  miolo.querySelector('#fxCat').addEventListener('change', e => {
    _filtro.categoria = e.target.value; desenharLista();
  });
  miolo.querySelector('#fxNovo').addEventListener('click', () => novoLancamento(tipo).catch(console.error));

  desenharLista();
}

function filtrar(lancamentos) {
  const termo = _filtro.busca.trim().toLowerCase();
  return lancamentos.filter(l => {
    if (_filtro.ano && anoDa(l.competencia) !== _filtro.ano) return false;
    if (_filtro.categoria === 'sem' && l.categoria_id) return false;
    if (_filtro.categoria && _filtro.categoria !== 'sem' && l.categoria_id !== _filtro.categoria) return false;
    if (termo && !String(l.descricao || '').toLowerCase().includes(termo)) return false;
    return true;
  });
}

function desenharLista() {
  const alvo = document.getElementById('fxLista');
  if (!alvo || !_cache) return;

  const doLado = doTipo(_cache.lancamentos, _tipo);
  const lista = filtrar(doLado);
  const total = somar(lista);
  const semValor = lista.filter(l => l.valor === null || l.valor === undefined).length;

  if (!lista.length) {
    alvo.innerHTML = `<div class="fe-vazio fe-vazio-topo">
      <div class="fe-vazio-tit">Nenhum lançamento neste filtro</div>
      <div class="fe-vazio-sub">Ajuste o ano, a categoria ou o texto da busca.</div>
    </div>`;
    return;
  }

  alvo.innerHTML = `
    <div class="dsp-resumo">
      <span class="dsp-resumo-n">${lista.length} de ${doLado.length} lançamentos</span>
      <span class="dsp-resumo-sep">·</span>
      <strong>${esc(formatarBRL(total))}</strong>
      ${semValor ? `<span class="dsp-resumo-sep">·</span>
        <span class="fx-alerta">${semValor} sem valor, fora do total</span>` : ''}
    </div>

    <div class="fp-tabela-wrap">
      <table class="fp-tabela fx-tabela">
        <thead>
          <tr>
            <th class="fx-c">Data</th><th>Descrição</th><th class="fx-c">Categoria</th>
            <th class="fx-c">Valor</th><th class="fx-c">Pago</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${lista.map(l => linhaHtml(l)).join('')}
        </tbody>
      </table>
    </div>
  `;

  // A LINHA INTEIRA ABRE O LANÇAMENTO — é como se dá baixa: abrir, mudar a
  // situação para Recebido e informar a data. Os controles de dentro (o select
  // de categoria, o campo de valor, o botão de excluir) param o clique antes:
  // quem foi mudar a categoria não quer o drawer por cima.
  alvo.querySelectorAll('tr[data-editar]').forEach(tr => {
    const abrir = () => editarLancamento(tr.dataset.editar);
    tr.addEventListener('click', e => {
      if (e.target.closest('select, button, input, textarea, a')) return;
      abrir();
    });
    tr.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
    });
  });

  alvo.querySelectorAll('[data-lanc-cat]').forEach(sel =>
    sel.addEventListener('change', () => trocarCategoria(sel.dataset.lancCat, sel.value)));
  alvo.querySelectorAll('[data-lanc-valor]').forEach(inp => {
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('blur', () => gravarValor(inp.dataset.lancValor, inp.value));
  });
  alvo.querySelectorAll('[data-lanc-excluir]').forEach(b =>
    b.addEventListener('click', () => apagar(b.dataset.lancExcluir)));
}

function linhaHtml(l) {
  const semValor = l.valor === null || l.valor === undefined;
  const cats = _cache.categorias.filter(c => c.tipo === l.tipo);
  const classes = ` class="dsp-linha${(semValor || !l.categoria_id) ? ' fx-pendente' : ''}"`;

  return `
    <tr${classes} data-editar="${l.id}" tabindex="0" role="button"
        aria-label="Abrir ${esc(l.descricao)} para editar ou dar baixa">
      <td class="fp-data fx-c" data-rot="Data">${esc(dataBR(l.data))}</td>
      <td data-rot="Descrição">
        ${esc(l.descricao)}
        ${l.observacoes ? `<div class="fp-nome-sub">${esc(l.observacoes)}</div>` : ''}
      </td>
      <td class="fx-c" data-rot="Categoria">
        <select class="fp-select fx-sel-cat" data-lanc-cat="${l.id}" aria-label="Categoria de ${esc(l.descricao)}">
          <option value=""${l.categoria_id ? '' : ' selected'}>— ${SEM_CATEGORIA} —</option>
          ${cats.map(c => `
            <option value="${c.id}"${c.id === l.categoria_id ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}
        </select>
      </td>
      <td class="fx-c" data-rot="Valor">
        ${semValor
          ? `<input class="fp-in fx-in-valor" data-lanc-valor="${l.id}" placeholder="sem valor"
                    inputmode="decimal" aria-label="Valor de ${esc(l.descricao)}">`
          : esc(formatarBRL(l.valor))}
      </td>
      <td class="fx-c" data-rot="Pago">${l.pago
        ? '<span class="fp-chip fp-chip-fechada">Pago</span>'
        : '<span class="fp-chip fp-chip-rascunho">Em aberto</span>'}</td>
      <td class="fx-acao-cel" data-rot="Ações">
        <button class="fp-acao fp-acao-danger" data-lanc-excluir="${l.id}"
                aria-label="Excluir ${esc(l.descricao)}"><i data-lucide="trash-2"></i></button>
      </td>
    </tr>`;
}

async function trocarCategoria(id, categoriaId) {
  const lanc = _cache?.lancamentos.find(l => l.id === id);
  if (!lanc) return;
  const anterior = lanc.categoria_id;
  lanc.categoria_id = categoriaId || null;
  try {
    await salvarLancamento(id, { categoria_id: categoriaId || null });
    desenharLista();
  } catch (e) {
    lanc.categoria_id = anterior;                 // a tela volta ao que o banco tem
    alert('Não consegui salvar a categoria: ' + (e?.message || e));
    desenharLista();
  }
}

async function gravarValor(id, texto) {
  const bruto = String(texto || '').trim();
  if (!bruto) return;                              // sair do campo vazio não é uma edição

  const valor = valorDeTexto(bruto);
  if (!Number.isFinite(valor) || valor < 0) {
    alert('Valor inválido. Use o formato 1.234,56.');
    return;
  }

  const lanc = _cache?.lancamentos.find(l => l.id === id);
  try {
    await salvarLancamento(id, { valor });
    if (lanc) lanc.valor = valor;
    desenharLista();
  } catch (e) {
    alert('Não consegui salvar o valor: ' + (e?.message || e));
  }
}

/** Excluir avisa quando a linha veio da planilha: reimportar a traz de volta, e
 *  quem apagou precisa saber disso antes de apagar, não depois. */
async function apagar(id) {
  const lanc = _cache?.lancamentos.find(l => l.id === id);
  if (!lanc) return;

  const daPlanilha = lanc.origem === 'planilha';
  const ok = confirm(
    `Excluir "${lanc.descricao}" de ${dataBR(lanc.data)}?` +
    (daPlanilha ? '\n\nEsta linha veio da planilha de custos. Rodar a importação de novo vai trazê-la de volta.' : ''));
  if (!ok) return;

  try {
    await excluirLancamento(id);
    _cache.lancamentos = _cache.lancamentos.filter(l => l.id !== id);
    desenharLista();
  } catch (e) {
    alert('Não consegui excluir: ' + (e?.message || e));
  }
}

// ───────────────────────────────────────────────────────────
// CATEGORIAS
// ───────────────────────────────────────────────────────────
async function montarCategorias(miolo) {
  miolo.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando...</div>`;

  let d;
  try { d = await dados(); }
  catch (e) { miolo.innerHTML = erroHtml(e); return; }

  if (!d.categorias.length) { miolo.innerHTML = vazioHtml('despesa'); ligarAcoes(miolo); return; }

  const usos = porCategoria(d.lancamentos, d.categorias);
  const porId = new Map(usos.map(u => [u.id, u]));

  miolo.innerHTML = `
    <p class="fe-nota fx-nota-topo">
      As categorias vieram da coluna CENTRO DE CUSTO da planilha, como estavam
      escritas. Duas grafias do mesmo assunto continuam separadas porque juntá-las
      é decisão de quem lê o balanço — use <em>Fundir</em> para resolver.
    </p>

    <div class="fp-tabela-wrap">
      <table class="fp-tabela fx-tabela">
        <thead>
          <tr><th>Categoria</th><th>Tipo</th><th class="fx-num">Lançamentos</th><th class="fx-num">Total</th><th></th></tr>
        </thead>
        <tbody>
          ${d.categorias.map(c => {
            const u = porId.get(c.id) || { n: 0, total: 0 };
            const irmas = d.categorias.filter(o => o.id !== c.id && o.tipo === c.tipo);
            return `
            <tr>
              <td data-rot="Categoria">${esc(c.nome)}</td>
              <td data-rot="Tipo">${c.tipo === 'receita' ? 'Receita' : 'Despesa'}</td>
              <td class="fx-num" data-rot="Lançamentos">${u.n}</td>
              <td class="fx-num" data-rot="Total">${esc(formatarBRL(u.total))}</td>
              <td class="fx-acao-cel" data-rot="Unificar">
                <select class="fp-select fx-sel-fundir" data-fundir="${c.id}"
                        aria-label="Fundir ${esc(c.nome)} em outra categoria">
                  <option value="">Fundir em...</option>
                  ${irmas.map(o => `<option value="${o.id}">${esc(o.nome)}</option>`).join('')}
                </select>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  miolo.querySelectorAll('[data-fundir]').forEach(sel =>
    sel.addEventListener('change', () => fundir(sel.dataset.fundir, sel.value, sel)));
}

async function fundir(idOrigem, idDestino, sel) {
  if (!idDestino) return;
  const origem = _cache.categorias.find(c => c.id === idOrigem);
  const destino = _cache.categorias.find(c => c.id === idDestino);
  if (!origem || !destino) return;

  const quantos = _cache.lancamentos.filter(l => l.categoria_id === idOrigem).length;
  const ok = confirm(
    `Mover ${quantos} lançamento(s) de "${origem.nome}" para "${destino.nome}" ` +
    `e apagar "${origem.nome}"?\n\nOs lançamentos não são apagados — só mudam de categoria.`);
  if (!ok) { sel.value = ''; return; }

  try {
    await fundirCategorias(idOrigem, idDestino);
    await dados({ recarregar: true });
    await montarCategorias(document.getElementById(MIOLO));
  } catch (e) {
    alert('Não consegui fundir: ' + (e?.message || e));
    sel.value = '';
  }
}

// ───────────────────────────────────────────────────────────
// ESTADOS
// ───────────────────────────────────────────────────────────
function vazioHtml(tipo) {
  const ehReceita = tipo === 'receita';
  return `
    <div class="fe-vazio">
      <div class="fe-vazio-icone"><i data-lucide="wallet"></i></div>
      <div class="fe-vazio-tit">Nenhum lançamento ainda</div>
      <div class="fe-vazio-sub">
        Registre ${ehReceita ? 'a primeira receita' : 'a primeira despesa'} — ou importe a
        planilha de custos com <code>db/financeiro_lancamentos_seed.sql</code>.
      </div>
      <div class="fe-vazio-acoes">
        <button class="btn primary" id="fxNovoVazio">
          <i data-lucide="plus"></i> ${ehReceita ? 'Nova receita' : 'Nova despesa'}
        </button>
      </div>
    </div>`;
}

function emConstrucaoHtml(secao) {
  return `
    <div class="fe-vazio">
      <div class="fe-vazio-icone"><i data-lucide="${secao?.icone || 'wallet'}"></i></div>
      <div class="fe-vazio-tit">${esc(secao?.titulo || '')} ainda não está disponível</div>
      <div class="fe-vazio-sub">${esc(secao?.sub || '')}</div>
      <div class="fe-vazio-tag">Próximo passo do módulo</div>
    </div>`;
}

// ───────────────────────────────────────────────────────────
function ligarAcoes(raiz) {
  raiz.querySelectorAll('[data-fin-ir]').forEach(b =>
    b.addEventListener('click', () => {
      // O atalho da pendência já chega com o filtro armado: mandar para a lista
      // inteira obrigaria a refazer na mão a busca que o número acabou de dizer.
      if (b.dataset.finFiltro) {
        try { _filtroDespesa = JSON.parse(b.dataset.finFiltro); } catch (e) { _filtroDespesa = null; }
      }
      abrirSecao(b.dataset.finIr);
    }));

  const novaDesp = raiz.querySelector('#fxNovaDespesa');
  if (novaDesp) novaDesp.addEventListener('click', () => novoLancamento('despesa').catch(console.error));

  const novo = raiz.querySelector('#fxNovoVazio');
  if (novo) novo.addEventListener('click', () => novoLancamento(_tipo).catch(console.error));

  const verEquipe = raiz.querySelector('#feVerEquipe');
  if (verEquipe) verEquipe.addEventListener('click', () => {
    if (_aoAbrirEquipe) _aoAbrirEquipe('resumo');
    else location.hash = '#equipe/resumo';
  });
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
