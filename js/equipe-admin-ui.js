// ═══════════════════════════════════════════════════════════
// EQUIPE E PAGAMENTOS — casca da página e navegação entre as seções
// ═══════════════════════════════════════════════════════════
// Pessoas, horas, folha e documentos. É o módulo que antes morava dentro do
// "Financeiro" e se apresentava como o resumo financeiro da empresa — o que
// nunca foi: custo de equipe é UMA das despesas, não o resultado do negócio.
//
// Monta o cabeçalho e as abas de #page-equipe e entrega o miolo para o módulo
// da seção. Cada seção continua autocontida: recebe o id do container e desenha
// dentro dele, sem saber que existe uma aba.
//
// A aba escolhida vai para o #hash (equipe/folha), então F5 volta no mesmo
// lugar e o link pode ser guardado.
//
// Não confundir com js/equipe-ui.js: aquele é o PWA do colaborador
// (equipe.html), este é a área administrativa do painel.

// O TÍTULO DA PÁGINA É FIXO. O menu diz "Equipe", curto, e a página diz
// "Equipe e pagamentos": o nome longo não cabe na barra lateral, mas dentro da
// tela ele é o que evita a leitura de "isto aqui é só o cadastro de pessoas".
// O assunto de cada aba vem logo abaixo, no cabeçalho da seção — assim a
// identidade do módulo não pisca a cada troca de aba.
const TITULO = 'Equipe e pagamentos';
const SUBTITULO = 'Gerencie colaboradores, ponto, folha de pagamento e documentos.';

// A ordem é o fluxo do trabalho: cadastro → conferência do ponto → pagamento →
// documentação. Trocar a ordem aqui troca o caminho que a tela ensina.
const SECOES = [
  { id: 'resumo', rotulo: 'Resumo', icone: 'chart-column',
    titulo: 'Custos da equipe',
    sub: 'Acompanhe horas, pagamentos, adicionais e custos dos colaboradores.' },
  { id: 'funcionarios', rotulo: 'Funcionários', icone: 'users-round',
    titulo: 'Funcionários',
    sub: 'O cadastro da equipe. É daqui que a folha e os custos saem.' },
  { id: 'ponto', rotulo: 'Ponto', icone: 'clock',
    titulo: 'Ponto',
    sub: 'As folhas de ponto importadas, por competência e por colaborador.' },
  { id: 'folha', rotulo: 'Folha de pagamento', icone: 'receipt',
    titulo: 'Folha de pagamento',
    sub: 'Transforme as horas trabalhadas em pagamentos e contracheques.' },
  { id: 'documentos', rotulo: 'Documentos', icone: 'folder-open',
    titulo: 'Documentos',
    sub: 'Contracheques, folhas de ponto e o que ainda falta entregar.' },
];

const MIOLO = 'eqConteudo';
let _secao = null;

export { SECOES, TITULO, SUBTITULO };

export async function initEquipeUI(secao = 'resumo') {
  const page = document.getElementById('page-equipe');
  if (!page) return;

  const alvo = SECOES.find(s => s.id === secao) || SECOES[0];

  page.innerHTML = `
    <div class="page-header">
      <div class="fn-trilha"><i data-lucide="briefcase-business"></i> Administração</div>
      <h1 class="page-title"><i data-lucide="id-card"></i> <em>${TITULO}</em></h1>
      <div class="page-sub">${SUBTITULO}</div>
    </div>

    <nav class="fin-abas" role="tablist" aria-label="Seções de Equipe e pagamentos">
      ${SECOES.map(s => `
        <button class="fin-aba${s.id === alvo.id ? ' on' : ''}" role="tab"
                aria-selected="${s.id === alvo.id}" data-eq-secao="${s.id}">
          <i data-lucide="${s.icone}"></i> ${s.rotulo}
        </button>`).join('')}
    </nav>

    <div class="eq-secao-hd">
      <div class="eq-secao-tit" id="eqTitulo"><i data-lucide="${alvo.icone}"></i> ${alvo.titulo}</div>
      <div class="eq-secao-sub" id="eqSub">${alvo.sub}</div>
    </div>

    <div id="${MIOLO}"><div class="loading"><div class="spinner"></div>Carregando...</div></div>
  `;

  page.querySelectorAll('[data-eq-secao]').forEach(b =>
    b.addEventListener('click', () => abrirSecao(b.dataset.eqSecao)));

  await montarSecao(alvo.id);
}

/**
 * Troca de aba sem redesenhar o cabeçalho da página.
 *
 * `opcoes` viaja até o módulo da seção — é assim que a aba Ponto pede à Folha
 * que abra na mesma competência e destaque a zona de importação.
 */
export async function abrirSecao(id, opcoes = {}) {
  const alvo = SECOES.find(s => s.id === id);
  if (!alvo) return;
  // Repetir a aba é trabalho jogado fora, EXCETO quando vem com pedido: quem
  // clica em "Revisar na folha" estando na folha quer o destaque de novo.
  if (id === _secao && !Object.keys(opcoes).length) return;

  const page = document.getElementById('page-equipe');
  if (!page) return;
  page.querySelectorAll('[data-eq-secao]').forEach(b => {
    const on = b.dataset.eqSecao === id;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });

  const titulo = document.getElementById('eqTitulo');
  if (titulo) titulo.innerHTML = `<i data-lucide="${alvo.icone}"></i> ${alvo.titulo}`;
  const sub = document.getElementById('eqSub');
  if (sub) sub.textContent = alvo.sub;

  await montarSecao(id, opcoes);
}

async function montarSecao(id, opcoes = {}) {
  _secao = id;
  try { history.replaceState(null, '', `#equipe/${id}`); } catch (e) {}

  const miolo = document.getElementById(MIOLO);
  if (miolo) miolo.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando...</div>`;

  if (id === 'resumo') {
    const { initResumoUI } = await import('./resumo-ui.js');
    await initResumoUI(MIOLO);
    return;
  }
  if (id === 'ponto') {
    const { initPontoUI } = await import('./ponto-ui.js');
    await initPontoUI(MIOLO, {
      irParaFolha: (o) => abrirSecao('folha', o || {}),
    });
    return;
  }
  if (id === 'folha') {
    const { initFolhaUI } = await import('./folha-ui.js');
    await initFolhaUI(MIOLO, opcoes);
    return;
  }
  if (id === 'documentos') {
    const { initDocumentosCentralUI } = await import('./documentos-central.js');
    await initDocumentosCentralUI(MIOLO);
    return;
  }
  const { initFuncionariosUI } = await import('./funcionarios-ui.js');
  await initFuncionariosUI(MIOLO);
}
