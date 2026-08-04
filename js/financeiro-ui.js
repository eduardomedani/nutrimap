// ═══════════════════════════════════════════════════════════
// FINANCEIRO — casca da página e navegação entre as seções
// ═══════════════════════════════════════════════════════════
// Monta o cabeçalho e as abas de #page-financeiro e entrega o miolo para o
// módulo da seção. Cada seção continua autocontida: recebe o id do container e
// desenha dentro dele, sem saber que existe uma aba.
//
// A aba escolhida vai para o #hash (financeiro/folha), então F5 volta no mesmo
// lugar e o link pode ser guardado.

const SECOES = [
  { id: 'resumo', rotulo: 'Resumo', icone: 'chart-column',
    sub: 'Quanto a equipe custou, mês a mês e por pessoa.' },
  { id: 'funcionarios', rotulo: 'Funcionários', icone: 'users-round',
    sub: 'O cadastro da equipe. É daqui que a folha e os custos saem.' },
  { id: 'folha', rotulo: 'Folha de pagamento', icone: 'receipt',
    sub: 'As horas do ponto viram o pagamento do mês.' },
];

const MIOLO = 'finConteudo';
let _nutriId = null;
let _secao = null;

export async function initFinanceiroUI(nutriId, secao = 'resumo') {
  _nutriId = nutriId;
  const page = document.getElementById('page-financeiro');
  if (!page) return;

  const alvo = SECOES.find(s => s.id === secao) || SECOES[0];

  page.innerHTML = `
    <div class="page-header">
      <div class="fn-trilha"><i data-lucide="wallet"></i> Financeiro</div>
      <h1 class="page-title"><i data-lucide="${alvo.icone}"></i> <em>${alvo.rotulo}</em></h1>
      <div class="page-sub" id="finSub">${alvo.sub}</div>
    </div>

    <nav class="fin-abas" role="tablist">
      ${SECOES.map(s => `
        <button class="fin-aba${s.id === alvo.id ? ' on' : ''}" role="tab" data-fin-secao="${s.id}">
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
async function abrirSecao(id) {
  if (id === _secao) return;
  const alvo = SECOES.find(s => s.id === id);
  if (!alvo) return;

  const page = document.getElementById('page-financeiro');
  page.querySelectorAll('[data-fin-secao]').forEach(b =>
    b.classList.toggle('on', b.dataset.finSecao === id));

  const titulo = page.querySelector('.page-title');
  if (titulo) titulo.innerHTML = `<i data-lucide="${alvo.icone}"></i> <em>${alvo.rotulo}</em>`;
  const sub = document.getElementById('finSub');
  if (sub) sub.textContent = alvo.sub;

  await montarSecao(id);
}

async function montarSecao(id) {
  _secao = id;
  try { history.replaceState(null, '', `#financeiro/${id}`); } catch (e) {}

  const miolo = document.getElementById(MIOLO);
  if (miolo) miolo.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando...</div>`;

  if (id === 'resumo') {
    const { initResumoUI } = await import('./resumo-ui.js');
    await initResumoUI(_nutriId, MIOLO);
    return;
  }
  if (id === 'folha') {
    const { initFolhaUI } = await import('./folha-ui.js');
    await initFolhaUI(_nutriId, MIOLO);
    return;
  }
  const { initFuncionariosUI } = await import('./funcionarios-ui.js');
  await initFuncionariosUI(_nutriId, MIOLO);
}
