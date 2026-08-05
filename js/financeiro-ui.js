// ═══════════════════════════════════════════════════════════
// FINANCEIRO DA EMPRESA — casca da página e navegação entre as seções
// ═══════════════════════════════════════════════════════════
// O resultado do negócio: o que entra, o que sai, o que está para receber e o
// que está para pagar. NÃO é a folha de pagamento — pessoas, horas, ponto e
// contracheques moram em Equipe e pagamentos (js/equipe-admin-ui.js).
//
// Esta área ainda não tem lançamentos. A tela diz isso com todas as letras em
// vez de desenhar gráfico vazio: um eixo sem barra parece sistema quebrado, e
// número inventado é pior — quem confere caixa não pode duvidar do que lê.
//
// O único número real aqui é o custo da equipe, que já existe no banco. Ele
// aparece como indicador e leva para o módulo dono do assunto; a folha não é
// duplicada dentro do financeiro.

import { sb } from './supabase.js';
import { formatarBRL, nomeCompetencia } from './folha.js';

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

/** Categorias sugeridas para o primeiro dia de uso. Nada disso está gravado —
 *  é a proposta que a tela oferece, não um dado do banco. */
const CATEGORIAS_INICIAIS = {
  Receitas: ['Consultas', 'Planos e pacotes', 'Avaliações', 'Outras receitas'],
  Despesas: ['Equipe', 'Aluguel', 'Software e assinaturas', 'Marketing', 'Impostos', 'Outras despesas'],
};

const MIOLO = 'finConteudo';
let _nutriId = null;
let _secao = null;
let _aoAbrirEquipe = null;

export { SECOES, CATEGORIAS_INICIAIS };

export async function initFinanceiroUI(nutriId, secao = 'visao-geral', opcoes = {}) {
  _nutriId = nutriId;
  _aoAbrirEquipe = opcoes.aoAbrirEquipe || null;

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

  if (id === 'visao-geral') { await montarVisaoGeral(miolo); return; }
  if (id === 'categorias') { miolo.innerHTML = categoriasHtml(); ligarAcoes(miolo); return; }

  const alvo = SECOES.find(s => s.id === id);
  miolo.innerHTML = emConstrucaoHtml(alvo);
  ligarAcoes(miolo);
}

// ───────────────────────────────────────────────────────────
// VISÃO GERAL
// ───────────────────────────────────────────────────────────
async function montarVisaoGeral(miolo) {
  miolo.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando...</div>`;

  // O custo da equipe é o único número real que este módulo tem hoje. Se as
  // views não existirem ainda, a tela segue sem ele — não é motivo de erro.
  const equipe = await custoDaEquipe();

  miolo.innerHTML = `
    <div class="fe-vazio">
      <div class="fe-vazio-icone"><i data-lucide="wallet"></i></div>
      <div class="fe-vazio-tit">Nenhum lançamento ainda</div>
      <div class="fe-vazio-sub">
        Comece registrando as receitas e despesas da operação. O módulo está
        preparado — falta o lançamento, que é o próximo passo da construção.
      </div>
      <div class="fe-vazio-passos">
        <div class="fe-passo"><i data-lucide="trending-up"></i> Registrar receita</div>
        <div class="fe-passo"><i data-lucide="trending-down"></i> Registrar despesa</div>
      </div>
      <div class="fe-vazio-acoes">
        <button class="btn" data-fin-ir="categorias">
          <i data-lucide="tags"></i> Ver categorias sugeridas
        </button>
      </div>
    </div>

    ${equipe ? `
      <div class="fe-ponte">
        <div class="fe-ponte-info">
          <div class="fe-ponte-rot"><i data-lucide="users-round"></i> Custo da equipe</div>
          <div class="fe-ponte-val">${esc(formatarBRL(equipe.total))}</div>
          <div class="fe-ponte-sub">${esc(nomeCompetencia(equipe.competencia))}${
            equipe.status === 'rascunho' ? ' · folha em rascunho' : ''}</div>
        </div>
        <button class="btn" id="feVerEquipe">
          Ver folha e colaboradores <i data-lucide="arrow-right"></i>
        </button>
      </div>
      <p class="fe-nota">
        A folha não é duplicada aqui: horas, adicionais e contracheques ficam em
        Equipe e pagamentos. Quando houver despesas lançadas, este custo entra no
        cálculo do resultado do mês.
      </p>` : ''}
  `;

  ligarAcoes(miolo);
}

/** Último mês com folha lançada. Silencioso quando o resumo não existe. */
async function custoDaEquipe() {
  try {
    const { data, error } = await sb
      .from('folha_resumo_mensal')
      .select('competencia, status, total')
      .order('competencia', { ascending: false })
      .limit(1);
    if (error) return null;
    return data?.[0] || null;
  } catch (e) {
    return null;
  }
}

// ───────────────────────────────────────────────────────────
// SEÇÕES AINDA NÃO CONSTRUÍDAS
// ───────────────────────────────────────────────────────────
function emConstrucaoHtml(secao) {
  return `
    <div class="fe-vazio">
      <div class="fe-vazio-icone"><i data-lucide="${secao?.icone || 'wallet'}"></i></div>
      <div class="fe-vazio-tit">${esc(secao?.titulo || '')} ainda não está disponível</div>
      <div class="fe-vazio-sub">${esc(secao?.sub || '')}</div>
      <div class="fe-vazio-tag">Próximo passo do módulo</div>
    </div>`;
}

function categoriasHtml() {
  return `
    <div class="fe-vazio fe-vazio-topo">
      <div class="fe-vazio-tit">Nenhuma categoria criada</div>
      <div class="fe-vazio-sub">
        Categoria é como cada lançamento é classificado no relatório. Estas são
        as sugestões iniciais — nada foi gravado ainda.
      </div>
    </div>

    <div class="fe-cats">
      ${Object.entries(CATEGORIAS_INICIAIS).map(([grupo, itens]) => `
        <div class="fe-cat">
          <div class="fe-cat-tit">${esc(grupo)}</div>
          <div class="fe-cat-chips">
            ${itens.map(i => `<span class="fe-chip">${esc(i)}</span>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
}

// ───────────────────────────────────────────────────────────
function ligarAcoes(raiz) {
  raiz.querySelectorAll('[data-fin-ir]').forEach(b =>
    b.addEventListener('click', () => abrirSecao(b.dataset.finIr)));

  const verEquipe = raiz.querySelector('#feVerEquipe');
  if (verEquipe) verEquipe.addEventListener('click', () => {
    if (_aoAbrirEquipe) _aoAbrirEquipe('resumo');
    else location.hash = '#equipe/resumo';
  });
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
