// ═══════════════════════════════════════════════════════════
// PWA · DIETA — a tela do paciente
// ═══════════════════════════════════════════════════════════
// O que o paciente precisa saber, na ordem em que precisa: o que comer, quanto,
// a que horas. Tudo o mais é secundário e fica visualmente secundário.
//
// O QUE ESTA TELA NÃO MOSTRA, e é decisão, não esquecimento: macros por
// alimento, fonte TACO/USDA, ids, fatores de equivalência, botões de editar ou
// excluir. Nada disso ajuda quem vai comer — e a presença de um botão de editar
// numa prescrição sugere que ela é editável, que é o oposto do que ela é.
//
// FUNÇÕES PURAS DEVOLVEM MARCAÇÃO. `telaHtml`, `refeicaoHtml` e os estados são
// testáveis sem DOM e sem rede. Foi assim que se pegou, no módulo financeiro,
// um formulário que nunca abria e cujos testes passavam porque liam o arquivo
// como texto.
//
// A ORDEM DOS ESTADOS IMPORTA: carregando → (plano | vazio). O vazio nunca
// pisca antes dos dados: enquanto não se sabe, mostra-se esqueleto, não a frase
// "sua dieta está a caminho" para quem já tem dieta.

import {
  carregarDieta, dataBR, resumoDoDia, textoDaPorcao,
  refeicaoAtual, proximaRefeicao, estadoDaRefeicao,
} from './pwa-dieta-data.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ICONE_REFEICAO = [
  [/caf[ée]|desjejum|manh[ãa]/i, 'coffee'],
  [/almo[çc]o/i,                 'utensils'],
  [/jantar|ceia|noite/i,         'moon'],
  [/lanche|colação|colacao/i,    'apple'],
  [/pr[ée].?treino|p[óo]s.?treino|treino/i, 'dumbbell'],
];

/** Ícone pelo nome da refeição. Cai em `utensils` quando não reconhece — um
 *  ícone genérico é melhor que um errado, que ensina a categoria errada. */
export function iconeDaRefeicao(nome) {
  for (const [re, icone] of ICONE_REFEICAO) if (re.test(String(nome || ''))) return icone;
  return 'utensils';
}

// ───────────────────────────────────────────────────────────
// ESTADOS
// ───────────────────────────────────────────────────────────

/** Esqueleto com a FORMA da tela: cabeçalho, duas refeições, linhas de
 *  alimento. Um spinner centralizado não diz o que vem — e faz a chegada do
 *  conteúdo parecer um salto. */
export function esqueletoHtml() {
  const linha = () => `<div class="dt-sk-linha"></div>`;
  const card = () => `
    <div class="dt-sk-card">
      <div class="dt-sk-topo"><div class="dt-sk-bolha"></div><div class="dt-sk-tit"></div></div>
      ${linha()}${linha()}${linha()}
    </div>`;
  return `
    <div class="dt-sk" role="status" aria-live="polite" aria-label="Carregando sua dieta">
      <div class="dt-sk-header"></div>
      ${card()}${card()}
    </div>`;
}

export function vazioHtml() {
  return `
    <div class="dt-vazio">
      <div class="dt-vazio-icone"><i data-lucide="salad"></i></div>
      <div class="dt-vazio-t">Sua dieta está a caminho</div>
      <div class="dt-vazio-s">Em breve seu profissional vai liberar seu plano alimentar por aqui.</div>

      <div class="dt-vazio-box">
        <div class="dt-vazio-box-t">Plano alimentar em breve</div>
        <div class="dt-vazio-box-s">
          Assim que seu profissional publicar o plano, você poderá consultar suas
          refeições, horários, porções, orientações e substituições.
        </div>
      </div>
    </div>`;
}

/** Erro sem jargão. "PGRST116" não ajuda quem quer almoçar. */
export function erroHtml() {
  return `
    <div class="dt-vazio dt-erro">
      <div class="dt-vazio-icone"><i data-lucide="cloud-off"></i></div>
      <div class="dt-vazio-t">Não foi possível carregar sua dieta</div>
      <div class="dt-vazio-s">Verifique sua conexão e tente novamente.</div>
      <button class="pa-btn dt-retry" id="dtRetry" type="button">
        <i data-lucide="rotate-cw"></i> Tentar novamente
      </button>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// PLANO
// ───────────────────────────────────────────────────────────

export function cabecalhoHtml(plano) {
  const periodo = plano.inicio && plano.fim
    ? `${dataBR(plano.inicio)} a ${dataBR(plano.fim)}`
    : plano.inicio ? `desde ${dataBR(plano.inicio)}` : '';

  return `
    <header class="dt-head">
      <div class="dt-head-linha">
        <h2 class="dt-head-titulo">Dieta</h2>
        <span class="dt-head-badge"><i data-lucide="check"></i> Plano ativo</span>
      </div>
      <div class="dt-head-nome">${esc(plano.nome)}</div>
      ${plano.objetivo ? `<div class="dt-head-obj">${esc(plano.objetivo)}</div>` : ''}
      ${periodo || plano.atualizadoEm ? `
        <div class="dt-head-meta">
          ${periodo ? `<span><i data-lucide="calendar-range"></i> ${esc(periodo)}</span>` : ''}
          ${plano.atualizadoEm ? `<span><i data-lucide="rotate-cw"></i> Atualizado em ${
            esc(dataBR(plano.atualizadoEm.slice(0, 10)))}</span>` : ''}
        </div>` : ''}
    </header>`;
}

/** Resumo compacto. Três números, não um painel: o paciente abriu a tela para
 *  saber o que comer, não para ler indicadores. */
export function resumoHtml(refeicoes) {
  const r = resumoDoDia(refeicoes);
  if (!r.refeicoes) return '';
  return `
    <div class="dt-resumo">
      <div class="dt-resumo-hoje">Plano diário</div>
      <div class="dt-resumo-linha">
        <span><strong>${r.refeicoes}</strong> ${r.refeicoes === 1 ? 'refeição' : 'refeições'}</span>
        ${r.primeira ? `<span class="dt-resumo-sep">·</span>
          <span>primeira às <strong>${esc(r.primeira)}</strong></span>` : ''}
        ${r.ultima && r.ultima !== r.primeira ? `<span class="dt-resumo-sep">·</span>
          <span>última às <strong>${esc(r.ultima)}</strong></span>` : ''}
      </div>
    </div>`;
}

export function alimentoHtml(a) {
  return `
    <li class="dt-item">
      <div class="dt-item-info">
        <div class="dt-item-nome">${esc(a.nome)}</div>
        <div class="dt-item-porcao">
          ${a.medida ? `<span class="dt-item-qtd">${esc(a.medida)}</span>` : ''}
          ${a.peso ? `<span class="dt-item-peso${a.medida ? '' : ' dt-item-peso-unico'}">${
            esc(a.peso)}</span>` : ''}
        </div>
        ${a.observacao ? `<div class="dt-item-obs">${esc(a.observacao)}</div>` : ''}
      </div>
      ${a.temSubstituicoes ? `
        <button class="dt-sub-btn" type="button" data-dt-sub="${esc(a.id)}"
                aria-label="Ver substituições de ${esc(a.nome)}">
          <i data-lucide="repeat"></i> Substituições
        </button>` : ''}
    </li>`;
}

/** Contagem no cabeçalho fechado — é o que diz se vale abrir. */
function resumoFechado(r) {
  const n = r.alimentos.length;
  const partes = [n ? `${n} ${n === 1 ? 'alimento' : 'alimentos'}` : 'sem alimentos'];
  if (r.observacao) partes.push('orientação');
  if (r.alternativas?.length) partes.push('opções');
  return partes.join(' · ');
}

/**
 * Uma refeição como accordion, FECHADA.
 *
 * O cabeçalho é um <button> de verdade, não uma div com onclick: leitor de tela
 * anuncia "botão, recolhido", Enter e Espaço funcionam de graça, e o foco
 * aparece no desktop sem nada a mais.
 *
 * O conteúdo fica no DOM mesmo fechado (hidden), e não é removido: assim a
 * animação tem de onde partir e o aria-controls aponta para algo que existe.
 */
export function refeicaoHtml(r, estado = 'futura', aberta = false) {
  const id = esc(r.id);
  const selo = estado === 'atual' ? 'agora' : estado === 'proxima' ? 'próxima' : '';

  return `
    <section class="dt-card dt-${estado}${aberta ? ' dt-aberta' : ''}">
      <h3 class="dt-card-h">
        <button class="dt-card-topo" type="button"
                id="dt-b-${id}" data-dt-toggle="${id}"
                aria-expanded="${aberta}" aria-controls="dt-c-${id}">
          <span class="dt-card-icone"><i data-lucide="${iconeDaRefeicao(r.nome)}"></i></span>
          <span class="dt-card-tit">
            <span class="dt-card-nome">${esc(r.nome)}</span>
            <span class="dt-card-sub">${esc(resumoFechado(r))}</span>
          </span>
          <span class="dt-card-dir">
            ${r.horario ? `<span class="dt-card-hora">${esc(r.horario)}</span>` : ''}
            ${selo ? `<span class="dt-selo dt-selo-${estado}">${selo}</span>` : ''}
          </span>
          <span class="dt-chevron" aria-hidden="true"><i data-lucide="chevron-down"></i></span>
        </button>
      </h3>

      <div class="dt-card-corpo" id="dt-c-${id}" role="region"
           aria-labelledby="dt-b-${id}"${aberta ? '' : ' hidden'}>
        ${r.alimentos.length
          ? `<ul class="dt-itens">${r.alimentos.map(alimentoHtml).join('')}</ul>`
          : `<div class="dt-card-vazio">Não há alimentos definidos para esta refeição.</div>`}

        ${r.observacao ? `
          <div class="dt-orientacao">
            <div class="dt-orientacao-t"><i data-lucide="info"></i> Orientação da refeição</div>
            <div class="dt-orientacao-s">${esc(r.observacao)}</div>
          </div>` : ''}
      </div>
    </section>`;
}

/** A tela inteira. Pura: entra o plano montado, sai a marcação.
 *
 *  TODAS FECHADAS. A refeição do horário ganha destaque visual, mas continua
 *  recolhida: abrir sozinha decidiria pelo paciente o que ele quer ver, e
 *  quebraria a visão limpa da rotina inteira que é o motivo de ser accordion. */
export function telaHtml(dieta, agora = '') {
  if (!dieta) return vazioHtml();

  const idAtual = refeicaoAtual(dieta.refeicoes, agora);
  const idProxima = proximaRefeicao(dieta.refeicoes, agora);
  return `
    <div class="dt">
      ${cabecalhoHtml(dieta.plano)}
      ${resumoHtml(dieta.refeicoes)}
      <div class="dt-lista">
        ${dieta.refeicoes.map(r =>
          refeicaoHtml(r, estadoDaRefeicao(r, idAtual, agora, idProxima), false)).join('')}
      </div>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// SUBSTITUIÇÕES — bottom sheet
// ───────────────────────────────────────────────────────────

/** A folha, como marcação pura. */
export function sheetHtml(alimento) {
  const subs = alimento?.substituicoes || [];
  return `
    <div class="dt-sheet-fundo" data-dt-sheet-fundo>
      <div class="dt-sheet" role="dialog" aria-modal="true" aria-labelledby="dtSheetTit">
        <div class="dt-sheet-alca" aria-hidden="true"></div>

        <header class="dt-sheet-topo">
          <div>
            <div class="dt-sheet-t" id="dtSheetTit">Substituições</div>
            <div class="dt-sheet-alvo">${esc(alimento.nome)}</div>
            <div class="dt-sheet-rot">Porção atual</div>
            <div class="dt-sheet-qtd">${esc(textoDaPorcao(alimento))}</div>
          </div>
          <button class="dt-sheet-x" type="button" data-dt-sheet-fechar aria-label="Fechar">
            <i data-lucide="x"></i>
          </button>
        </header>

        <p class="dt-sheet-nota">Escolha uma das opções aprovadas pelo seu profissional.</p>

        <ul class="dt-sheet-lista">
          ${subs.map((s, i) => `
            <li class="dt-sheet-item">
              <div class="dt-sheet-info">
                <div class="dt-item-nome">${esc(s.nome)}</div>
                ${textoDaPorcao(s) ? `<div class="dt-sheet-porcao">${
                  esc(textoDaPorcao(s))}</div>` : ''}
                ${s.observacao ? `<div class="dt-item-obs">${esc(s.observacao)}</div>` : ''}
              </div>
              <button class="dt-escolher" type="button" data-dt-escolher="${i}">Escolher</button>
            </li>`).join('')}
        </ul>
      </div>
    </div>`;
}

/**
 * Abre a folha de substituições.
 *
 * A ESCOLHA É LOCAL. Não existe módulo de adesão nem de registro de consumo no
 * projeto, e gravar isso na prescrição faria o paciente editar o que o
 * profissional prescreveu. Enquanto a persistência não for planejada, a troca
 * vive na sessão — e a tela deixa claro o que era o original.
 */
function abrirSheet(cx, alimento, aoEscolher) {
  const antigo = document.querySelector('.dt-sheet-fundo');
  if (antigo) antigo.remove();

  const no = document.createElement('div');
  no.innerHTML = sheetHtml(alimento);
  const fundo = no.firstElementChild;
  document.body.appendChild(fundo);
  document.body.classList.add('dt-travado');

  const fechar = () => {
    document.removeEventListener('keydown', aoTeclado);
    document.body.classList.remove('dt-travado');
    fundo.remove();
  };
  function aoTeclado(e) { if (e.key === 'Escape') { e.preventDefault(); fechar(); } }
  document.addEventListener('keydown', aoTeclado);

  fundo.addEventListener('mousedown', e => { if (e.target === fundo) fechar(); });
  fundo.querySelectorAll('[data-dt-sheet-fechar]').forEach(b => b.addEventListener('click', fechar));
  fundo.querySelectorAll('[data-dt-escolher]').forEach(b =>
    b.addEventListener('click', () => {
      aoEscolher(alimento.substituicoes[Number(b.dataset.dtEscolher)]);
      fechar();
    }));

  const primeiro = fundo.querySelector('.dt-escolher, .dt-sheet-x');
  if (primeiro) primeiro.focus();
}

// ───────────────────────────────────────────────────────────
// MONTAGEM
// ───────────────────────────────────────────────────────────

/**
 * Desenha a Dieta dentro do container.
 *
 * @param {string|HTMLElement} alvo  onde escrever
 * @param {object} opcoes  { agora } — a hora atual, injetável para o teste
 */
export async function renderDietaPaciente(alvo, opcoes = {}) {
  const cx = typeof alvo === 'string' ? document.getElementById(alvo) : alvo;
  if (!cx) return;

  cx.innerHTML = esqueletoHtml();

  try {
    // O id vem da casca, que já o tem: sem ele a função descobre sozinha, mas
    // gasta uma ida ao banco. Passá-lo NÃO é opcional por segurança — o filtro
    // acontece de todo jeito dentro de `carregarDieta` —, é só economia.
    const dieta = await carregarDieta(opcoes.pacienteId || null);
    // Só aqui o vazio pode aparecer: antes disso não se sabe se há plano, e
    // mostrar "sua dieta está a caminho" para quem tem dieta é pior que
    // demorar meio segundo.
    cx.innerHTML = telaHtml(dieta, opcoes.agora ?? horaAgora());
    if (dieta) ligarAccordion(cx, dieta);
  } catch (e) {
    console.error('Dieta do paciente:', e);
    cx.innerHTML = erroHtml();
    const b = cx.querySelector('#dtRetry');
    if (b) b.addEventListener('click', () => renderDietaPaciente(cx, opcoes));
  }
}

/**
 * Liga a expansão e as substituições.
 *
 * MÚLTIPLAS ABERTAS ao mesmo tempo, de propósito: o paciente pode querer
 * comparar o almoço com o jantar, e fechar uma ao abrir outra transformaria a
 * comparação em vaivém.
 */
function ligarAccordion(cx, dieta) {
  const porItem = new Map();
  for (const r of dieta.refeicoes) for (const a of r.alimentos) porItem.set(a.id, a);

  cx.querySelectorAll('[data-dt-toggle]').forEach(botao => {
    botao.addEventListener('click', () => {
      const corpo = cx.querySelector(`#dt-c-${CSS.escape(botao.dataset.dtToggle)}`);
      if (!corpo) return;
      const abrindo = corpo.hidden;
      corpo.hidden = !abrindo;
      botao.setAttribute('aria-expanded', String(abrindo));
      botao.closest('.dt-card')?.classList.toggle('dt-aberta', abrindo);
    });
  });

  cx.querySelectorAll('[data-dt-sub]').forEach(botao => {
    botao.addEventListener('click', e => {
      e.stopPropagation();                       // não deixa fechar a refeição
      const alimento = porItem.get(botao.dataset.dtSub);
      if (alimento) abrirSheet(cx, alimento, s => aplicarTroca(cx, alimento, s));
    });
  });
}

/**
 * Mostra a troca escolhida no lugar do alimento, sem tocar na prescrição.
 *
 * A referência ao original fica à vista e o "voltar" é um clique: a escolha é
 * do paciente para aquele dia, não uma edição do que o profissional prescreveu
 * — e essa diferença precisa estar legível na própria linha.
 */
function aplicarTroca(cx, alimento, sub) {
  const li = cx.querySelector(`[data-dt-sub="${CSS.escape(alimento.id)}"]`)?.closest('.dt-item');
  if (!li || !sub) return;

  li.classList.add('dt-trocado');
  li.querySelector('.dt-item-nome').textContent = sub.nome;
  const porcaoEl = li.querySelector('.dt-item-porcao');
  if (porcaoEl) porcaoEl.innerHTML = linhaPorcao(sub);

  if (!li.querySelector('.dt-troca-nota')) {
    const nota = document.createElement('div');
    nota.className = 'dt-troca-nota';
    nota.innerHTML = `
      <span class="dt-troca-orig">Substitui: <strong>${esc(alimento.nome)}</strong></span>
      <button class="dt-desfazer" type="button">Voltar ao original</button>`;
    li.querySelector('.dt-item-info').appendChild(nota);
    nota.querySelector('.dt-desfazer').addEventListener('click', e => {
      e.stopPropagation();
      desfazerTroca(li, alimento);
    });
  }
}

function desfazerTroca(li, alimento) {
  li.classList.remove('dt-trocado');
  li.querySelector('.dt-item-nome').textContent = alimento.nome;
  const porcaoEl = li.querySelector('.dt-item-porcao');
  if (porcaoEl) porcaoEl.innerHTML = linhaPorcao(alimento);
  li.querySelector('.dt-troca-nota')?.remove();
}

/** Os dois spans da porção. Existe para a troca e o desfazer redesenharem
 *  exatamente o que `alimentoHtml` desenha — duas versões da mesma linha
 *  divergiriam na primeira mudança de estilo. */
function linhaPorcao(x) {
  return (x?.medida ? `<span class="dt-item-qtd">${esc(x.medida)}</span>` : '') +
         (x?.peso ? `<span class="dt-item-peso${x.medida ? '' : ' dt-item-peso-unico'}">${
           esc(x.peso)}</span>` : '');
}

/** 'HH:MM' pelo relógio local. */
export function horaAgora(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
