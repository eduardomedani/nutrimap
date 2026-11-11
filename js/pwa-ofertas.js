// ═══════════════════════════════════════════════════════════
// OFERTAS — apresentar o Treino e a Alimentação para quem ainda não tem
// ═══════════════════════════════════════════════════════════
// Fase 1 (11/11/2026): a aba do serviço não contratado abre uma VITRINE e o
// Início mostra um card com "Conhecer" / "Agora não" (30 dias no aparelho).
//
// Mini landing page (11/11/2026, terceira versão do dia). Seções de fundo
// inteiro, alternando o verde profundo, o claro e o verde suave:
//   1. ABERTURA (verde profundo): selo, título branco, descrição, a ação e
//      "Veja como funciona"; uma prévia do app sobre um fundo de marca.
//   2. BENEFÍCIOS (claro): três mensagens curtas.
//   3. DEMONSTRAÇÃO (verde suave): prévia compacta + "Experimentar
//      demonstração", que abre o componente interativo num PAINEL.
//   4. COMO FUNCIONA (claro): três etapas e quem prepara.
//   5. FECHAMENTO (verde profundo): convite, valores e a ação.
//   + a faixa fixa acima da navegação, SÓ quando há ação funcional e só
//     enquanto a ação da abertura e a do fechamento estão fora da tela.
//
// SEM FOTOGRAFIA. O projeto não tem nenhuma foto autorizada de treino ou de
// refeição (só logotipos e ícones), e as animações dos exercícios ficam num
// bucket privado. A abertura usa uma composição com componentes do app sobre
// o verde da marca — nada quebrado, nada de banco de imagens sem licença.
//
// O QUE A TELA PODE AFIRMAR. Cada frase foi conferida com o que o app faz:
//   * o treino é organizado por dia (Treino A, B...);
//   * vídeo/animação de execução existe, mas NÃO para todo exercício — por
//     isso "quando disponíveis";
//   * carga por série e histórico existem (rpc_paciente_salvar_series);
//   * a dieta mostra refeições, alimentos, quantidades e substituições;
//   * preço, prazo e nome do profissional NÃO existem para quem não contratou,
//     então a tela não mostra nenhum dos três e diz com quem consultar.
//
// A DEMONSTRAÇÃO É ISOLADA. Os dados são fixos, deste arquivo, sem paciente
// nenhum por trás. O treino usa só as classes visuais do card real, sem os
// data-* que os handlers da casca usam para gravar; a dieta usa o próprio
// refeicaoHtml (marcação pura) num container que nenhum handler real liga.
// Nada aqui chama rede, exceto a leitura do canal comercial.
//
// O CANAL COMERCIAL. A ação é "Consultar planos pelo WhatsApp" com o número
// que a ORGANIZAÇÃO do paciente configurou (rpc_paciente_canal_comercial,
// db/canal_comercial.sql). Sem número ou com erro, NÃO há botão nem faixa
// fixa: a abertura e o fechamento orientam a falar com a recepção ou o
// profissional — o único canal real nesse caso. Nunca um número fixo no
// código, nunca envio automático, nunca "pedido registrado".

import { sb } from './supabase.js';
import { refeicaoHtml, sheetHtml } from './pwa-dieta-ui.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ic = nome => `<i data-lucide="${esc(nome)}" aria-hidden="true"></i>`;

/**
 * O texto de cada oferta. `preco` fica null enquanto não houver preço
 * configurado para o estabelecimento — e aí a tela diz para consultar.
 */
export const OFERTAS = {
  treino: {
    id: 'treino',
    aba: 'treino',
    icone: 'dumbbell',
    rotulo: 'Treino',
    selo: 'Seu próximo passo',
    // Quebra pedida entre as duas frases: cada uma numa linha.
    titulo: ['Treine com direção.', 'Evolua com acompanhamento.'],
    // "vídeos" do pedido virou "demonstrações": nem todo exercício tem vídeo.
    descricao: 'Seu programa organizado no aplicativo, com exercícios, demonstrações e registro da sua evolução.',
    cardTitulo: 'Treine com direção. Evolua com acompanhamento.',
    card: 'Seu programa organizado no aplicativo, com exercícios, demonstrações e registro da sua evolução.',
    beneficios: [
      ['calendar-days', 'Abra e saiba o que treinar.', 'Seu programa organizado por dia.'],
      ['circle-play', 'Consulte como executar.', 'Demonstrações durante o treino, quando disponíveis.'],
      ['trending-up', 'Veja sua evolução.', 'Histórico de cargas e registros no aplicativo.'],
    ],
    quemPrepara: 'Um profissional da equipe do seu estabelecimento monta o programa.',
    mensagem: 'Olá! Quero conhecer os valores e o que está incluído no acompanhamento de treino pelo Evollo.',
    preco: null,
  },
  alimentacao: {
    id: 'alimentacao',
    aba: 'dieta',
    icone: 'salad',
    rotulo: 'Dieta',
    selo: 'Alimentação na vida real',
    titulo: ['Seu objetivo começa com um plano que cabe na sua rotina.'],
    descricao: 'Orientação nutricional e refeições organizadas para você saber como seguir seu plano no dia a dia.',
    cardTitulo: 'Seu objetivo começa com um plano que cabe na sua rotina.',
    card: 'Orientação nutricional e refeições organizadas para você saber como seguir seu plano no dia a dia.',
    beneficios: [
      ['utensils', 'Abra e saiba o que comer.', 'Refeições e quantidades organizadas.'],
      ['repeat', 'Encontre alternativas.', 'Consulte as substituições previstas no seu plano.'],
      ['messages-square', 'Tenha orientação.', 'Acompanhamento conforme o serviço contratado.'],
    ],
    quemPrepara: 'Um nutricionista da equipe do seu estabelecimento elabora o plano.',
    mensagem: 'Olá! Quero conhecer os valores e o que está incluído no acompanhamento alimentar pelo Evollo.',
    preco: null,
  },
};

/** A oferta que a aba representa ('treino' | 'dieta'), ou null. */
export const ofertaDaAba = aba => Object.values(OFERTAS).find(o => o.aba === aba) || null;

// ── Card do Início ──────────────────────────────────────────
export function ofertaCardHtml(id) {
  const o = OFERTAS[id];
  if (!o) return '';
  return `
    <section class="in-card in-oferta" data-oferta="${esc(id)}" aria-labelledby="inOferta-${esc(id)}">
      <div class="in-card-top">
        <span class="in-card-ic">${ic(o.icone)}</span>
        <div class="in-card-cab">
          <p class="in-card-rot">Para você</p>
          <h2 class="in-card-tit" id="inOferta-${esc(id)}">${esc(o.cardTitulo)}</h2>
        </div>
      </div>
      <p class="in-card-vazio">${esc(o.card)}</p>
      <div class="of-card-acoes">
        <button class="in-btn in-btn-pri" type="button" data-ir="${esc(o.aba)}">Conhecer</button>
        <button class="of-adiar" type="button" data-oferta-adiar="${esc(id)}">Agora não</button>
      </div>
    </section>`;
}

// ── "Agora não": some por 30 dias NESTE aparelho ─────────────
export const ADIAR_DIAS = 30;
const chaveAdiada = (pacienteId, id) => `evo_oferta_adiada_${pacienteId || 'anon'}_${id}`;

/** Ainda dentro dos 30 dias desde o "Agora não"? (puro: recebe as datas) */
export function estaAdiada(quando, agora = Date.now()) {
  const t = Date.parse(quando || '');
  if (!Number.isFinite(t)) return false;
  return agora - t < ADIAR_DIAS * 86400000;
}

export function ofertaAdiada(pacienteId, id, agora = Date.now()) {
  try { return estaAdiada(localStorage.getItem(chaveAdiada(pacienteId, id)), agora); }
  catch { return false; }   // sem storage (modo privado): mostra
}

export function adiarOferta(pacienteId, id, agora = new Date()) {
  try { localStorage.setItem(chaveAdiada(pacienteId, id), agora.toISOString()); } catch {}
}

// ── Canal comercial ─────────────────────────────────────────

/**
 * Número de WhatsApp em formato internacional só com dígitos, ou null.
 * 10–11 dígitos = número brasileiro sem DDI (ganha 55); 12–13 = já com DDI.
 */
export function normalizarWhatsapp(bruto) {
  const d = String(bruto ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if (d.length === 12 || d.length === 13) return d;
  return null;
}

/** O retorno da RPC (linha ou lista) → { organizacao, whatsapp } ou null. */
export function canalDoRetorno(data) {
  const l = Array.isArray(data) ? data[0] : data;
  const whatsapp = normalizarWhatsapp(l?.whatsapp);
  if (!whatsapp) return null;
  return { organizacao: String(l?.organizacao || '').trim() || null, whatsapp };
}

/** Link que ABRE a conversa com o texto pronto; quem envia é o cliente. */
export function linkWhatsapp(numero, texto) {
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

/**
 * Lê o canal da organização do paciente. Qualquer falha (RPC ausente, sem
 * número, rede) devolve null — e a tela cai na orientação.
 */
export async function carregarCanalComercial() {
  try {
    const { data, error } = await sb.rpc('rpc_paciente_canal_comercial');
    if (error) return null;
    return canalDoRetorno(data);
  } catch { return null; }
}

/**
 * A ação. `onde`: 'escuro' (abertura e fechamento, sobre o verde profundo)
 * ou 'faixa' (a faixa fixa, sobre o claro). Sem canal: na faixa, nada; no
 * escuro, a orientação compacta — sem botão que termina em aviso.
 */
export function acaoHtml(id, canal, onde = 'escuro') {
  const o = OFERTAS[id];
  if (!o) return '';
  if (canal?.whatsapp) {
    const cls = onde === 'faixa' ? 'pa-btn of-cta-btn' : 'of-btn-claro';
    return `
      <a class="${cls}" href="${esc(linkWhatsapp(canal.whatsapp, o.mensagem))}"
         target="_blank" rel="noopener" data-of-whats="${esc(id)}">
        ${ic('message-circle')} Consultar planos pelo WhatsApp
      </a>`;
  }
  if (onde === 'faixa') return '';
  return `
    <p class="of-orient">${ic('message-circle')}
      <span>Para contratar, fale com a recepção ou com o seu profissional.</span></p>`;
}

/** Enquanto o canal carrega: reserva a altura, sem botão falso. */
export const acaoCarregandoHtml = () => '<div class="of-acao-carregando" aria-hidden="true"></div>';

// ── Prévias (dados FIXOS, ilustrativos) ─────────────────────

const DEMO_TREINO = {
  nome: 'Supino reto com barra',
  grupo: 'Peito',
  series: 3,
  reps: '8–12',
  descanso: '1 min 30 s',
};

const DEMO_REFEICAO = {
  id: 'demo-almoco',
  nome: 'Almoço',
  horario: '12:30',
  observacao: null,
  alimentos: [
    {
      id: 'demo-arroz', nome: 'Arroz branco cozido', medida: '4 colheres de sopa', peso: '100 g',
      temSubstituicoes: true,
      substituicoes: [
        { nome: 'Batata cozida', medida: '1 unidade média', peso: '140 g' },
        { nome: 'Macarrão cozido', medida: '1 pegador', peso: '110 g' },
      ],
    },
    { id: 'demo-feijao', nome: 'Feijão cozido', medida: '1 concha média', peso: '80 g' },
    { id: 'demo-frango', nome: 'Filé de frango grelhado', medida: '1 filé médio', peso: '120 g' },
    { id: 'demo-salada', nome: 'Salada de folhas e legumes', medida: 'à vontade' },
  ],
};

/**
 * A prévia da ABERTURA: um recorte do app, legível, sobre o verde.
 * Leva o selo "Demonstração" para não parecer o plano de quem está vendo.
 */
export function previaAberturaHtml(id) {
  if (id === 'treino') {
    const linhas = [
      [DEMO_TREINO.nome, `3 × ${DEMO_TREINO.reps}`, true],
      ['Remada curvada', '3 × 10–12', false],
      ['Desenvolvimento com halteres', '3 × 10', false],
    ].map(([n, s, feito]) => `
          <li class="of-mini-l${feito ? ' feito' : ''}">
            <span class="of-mini-ck">${feito ? ic('check') : ''}</span>
            <span class="of-mini-n">${esc(n)}</span>
            <span class="of-mini-v">${esc(s)}</span>
          </li>`).join('');
    return `
      <figure class="of-mini" aria-label="Demonstração: um dia de treino no aplicativo">
        <div class="of-mini-cab"><span class="of-mini-ic">${ic('dumbbell')}</span>
          <span><b>Treino A</b><small>Hoje · 3 exercícios</small></span>
          <span class="of-mini-selo">Demonstração</span></div>
        <div class="of-mini-barra" aria-hidden="true"><span style="width:33%"></span></div>
        <ul class="of-mini-lista">${linhas}
        </ul>
      </figure>`;
  }
  const linhas = DEMO_REFEICAO.alimentos.slice(0, 3).map(a => `
          <li class="of-mini-l">
            <span class="of-mini-n">${esc(a.nome)}</span>
            <span class="of-mini-v">${esc(a.medida)}</span>
          </li>`).join('');
  return `
    <figure class="of-mini" aria-label="Demonstração: uma refeição no aplicativo">
      <div class="of-mini-cab"><span class="of-mini-ic">${ic('utensils')}</span>
        <span><b>${esc(DEMO_REFEICAO.nome)}</b><small>${esc(DEMO_REFEICAO.horario)} · próxima refeição</small></span>
        <span class="of-mini-selo">Demonstração</span></div>
      <ul class="of-mini-lista">${linhas}
      </ul>
      <span class="of-mini-chip">${ic('repeat')} Substituições</span>
    </figure>`;
}

/** Resumo compacto da seção de demonstração (a ficha inteira vai no painel). */
export function resumoDemoHtml(id) {
  if (id === 'treino') {
    const t = DEMO_TREINO;
    return `
      <div class="of-resumo">
        <p class="of-resumo-t">${esc(t.nome)}</p>
        <p class="of-resumo-s">${t.series} séries · ${esc(t.reps)} reps · ${esc(t.descanso)} de descanso</p>
        <ul class="of-resumo-tags">
          <li>${ic('circle-play')} Demonstração de execução</li>
          <li>${ic('pencil-line')} Registro de carga por série</li>
        </ul>
      </div>`;
  }
  const r = DEMO_REFEICAO;
  return `
    <div class="of-resumo">
      <p class="of-resumo-t">${esc(r.nome)} · ${esc(r.horario)}</p>
      <p class="of-resumo-s">${esc(r.alimentos.slice(0, 3).map(a => a.nome).join(', '))}…</p>
      <ul class="of-resumo-tags">
        <li>${ic('scale')} Quantidades em medida e gramas</li>
        <li>${ic('repeat')} Substituições</li>
      </ul>
    </div>`;
}

/** Card de exercício com as classes do real, sem os gatilhos que gravam. */
export function demoTreinoHtml() {
  const t = DEMO_TREINO;
  const series = Array.from({ length: t.series }, (_, i) => `
          <div class="pa-serie-block" data-demo-bloco="${i}">
            <div class="pa-serie">
              <span class="pa-serie-num">${i + 1}ª</span>
              <input type="number" step="0.5" inputmode="decimal" class="pa-input pa-mini"
                placeholder="kg" aria-label="Peso da série ${i + 1} (demonstração)">
              <input type="number" inputmode="numeric" class="pa-input pa-mini"
                placeholder="${esc(t.reps)}" aria-label="Repetições da série ${i + 1} (demonstração)">
              <button type="button" class="pa-serie-check" data-demo-serie="${i}"
                aria-pressed="false" aria-label="Concluir série ${i + 1} (demonstração)">${ic('check')}</button>
            </div>
          </div>`).join('');
  return `
    <div class="pa-ex of-demo-ex">
      <div class="pa-exh of-demo-exh">
        <span class="pa-ex-status" aria-hidden="true">1</span>
        <span class="pa-exh-txt">
          <span class="pa-exh-nome">${esc(t.nome)}</span>
          <span class="pa-exh-grupo">${esc(t.grupo)}</span>
        </span>
      </div>
      <div class="pa-ex-body">
        <div class="pa-ex-spec">
          <span><b>${t.series}</b> séries</span><span class="sep">·</span>
          <span><b>${esc(t.reps)}</b> reps</span><span class="sep">·</span>
          <span><b>${esc(t.descanso)}</b> de descanso</span>
        </div>
        <div class="pa-ex-foot">
          <button type="button" class="pa-video" data-demo-video aria-expanded="false" aria-controls="ofDemoVideo">
            ${ic('play')} Ver execução
          </button>
        </div>
        <p class="of-demo-nota" id="ofDemoVideo" hidden>
          No seu treino, este botão abre o vídeo ou a animação do exercício, quando disponível.
        </p>
        <div class="of-demo-series" role="group" aria-label="Registro de carga (demonstração)">${series}</div>
        <p class="of-demo-rodape">Na demonstração, nada do que você digitar é salvo.</p>
      </div>
    </div>`;
}

/** A refeição pelo MESMO componente da tela de Dieta, aberta. */
export function demoDietaHtml() {
  return `<div class="dt-lista of-demo-dieta">${refeicaoHtml(DEMO_REFEICAO, 'futura', true)}</div>`;
}

// ── A página ────────────────────────────────────────────────

export function vitrineHtml(id) {
  const o = OFERTAS[id];
  if (!o) return '';
  const beneficios = o.beneficios.map(([icone, t, s]) => `
          <li class="of-ben">
            <span class="of-ben-ic">${ic(icone)}</span>
            <span class="of-ben-txt"><b>${esc(t)}</b><span>${esc(s)}</span></span>
          </li>`).join('');
  const passos = [
    ['Conheça os planos', 'Converse com a equipe e entenda as opções.'],
    ['Receba as orientações iniciais', 'Saiba quais informações ou avaliações são necessárias.'],
    ['Acesse seu plano no aplicativo', 'Após a preparação, consulte suas orientações no Evollo.'],
  ].map(([t, s], i) => `
          <li class="of-passo">
            <span class="of-passo-n" aria-hidden="true">${i + 1}</span>
            <span class="of-passo-txt"><b>${esc(t)}</b><span>${esc(s)}</span></span>
          </li>`).join('');
  const titulo = o.titulo.map(l => `<span>${esc(l)}</span>`).join(' ');

  return `
    <article class="of-vitrine of-${esc(id)}" data-vitrine="${esc(id)}" aria-labelledby="ofTit">
      <header class="of-s of-escuro of-hero">
        <div class="of-in">
          <p class="of-selo">${esc(o.selo)}</p>
          <h1 class="of-tit" id="ofTit">${titulo}</h1>
          <p class="of-chamada">${esc(o.descricao)}</p>
          <div class="of-acao" data-of-acao="abertura">${acaoCarregandoHtml()}</div>
          <a class="of-link" href="#ofComo" data-of-ir="ofComo">Veja como funciona ${ic('arrow-down')}</a>
        </div>
        <div class="of-palco">
          <span class="of-palco-forma" aria-hidden="true"></span>
          ${previaAberturaHtml(id)}
        </div>
      </header>

      <section class="of-s of-claro" aria-labelledby="ofBenT">
        <div class="of-in">
          <h2 class="of-sec-t" id="ofBenT">O que você tem no app</h2>
          <ul class="of-bens">${beneficios}
          </ul>
        </div>
      </section>

      <section class="of-s of-suave" aria-labelledby="ofDemoT">
        <div class="of-in">
          <span class="of-demo-selo">Demonstração</span>
          <h2 class="of-sec-t" id="ofDemoT">Veja como fica simples no seu dia a dia.</h2>
          <p class="of-demo-aviso">Exemplo ilustrativo. Seu plano será individualizado.</p>
          ${resumoDemoHtml(id)}
          <button type="button" class="of-btn-linha" data-of-demo aria-haspopup="dialog">
            ${ic('hand')} Experimentar demonstração
          </button>
        </div>
      </section>

      <section class="of-s of-claro" id="ofComo" tabindex="-1" aria-labelledby="ofComoT">
        <div class="of-in">
          <h2 class="of-sec-t" id="ofComoT">Como funciona</h2>
          <ol class="of-passos">${passos}
          </ol>
          <p class="of-quem">${ic('user-round')} <span>${esc(o.quemPrepara)}</span></p>
        </div>
      </section>

      <section class="of-s of-escuro of-fim" aria-labelledby="ofFimT">
        <div class="of-in">
          <h2 class="of-fim-t" id="ofFimT">Vamos organizar seu próximo passo?</h2>
          <p class="of-chamada">Conheça os planos e descubra como incluir esse acompanhamento na sua rotina.</p>
          ${o.preco
            ? `<p class="of-preco">${esc(o.preco)}</p>`
            : '<p class="of-valores">Consulte os planos e valores com a equipe.</p>'}
          <div class="of-acao" data-of-acao="fechamento">${acaoCarregandoHtml()}</div>
          <p class="of-status">Ainda não incluído no seu plano.</p>
        </div>
      </section>
    </article>`;
}

// ── Painel da demonstração ──────────────────────────────────

/** O painel (marcação pura): mesmo visual da folha da Dieta. */
export function painelDemoHtml(id) {
  return `
    <div class="dt-sheet-fundo of-painel-fundo" data-of-painel>
      <div class="dt-sheet of-painel" role="dialog" aria-modal="true" aria-labelledby="ofPainelT">
        <div class="dt-sheet-alca" aria-hidden="true"></div>
        <header class="dt-sheet-topo">
          <div>
            <div class="dt-sheet-t">Demonstração</div>
            <div class="dt-sheet-alvo" id="ofPainelT">${id === 'treino' ? 'Um exercício no seu treino' : 'Uma refeição no seu plano'}</div>
            <p class="of-painel-aviso">Exemplo ilustrativo. Seu plano será individualizado.</p>
          </div>
          <button class="dt-sheet-x" type="button" data-of-painel-fechar aria-label="Fechar demonstração">${ic('x')}</button>
        </header>
        <div class="of-demo">${id === 'treino' ? demoTreinoHtml() : demoDietaHtml()}</div>
      </div>
    </div>`;
}

/** Abre uma folha (painel ou substituições) por cima do que houver. */
function abrirFolha(fundo, origem) {
  document.body.appendChild(fundo);
  document.body.classList.add('dt-travado');
  window.renderIcons?.();
  const fechar = () => {
    document.removeEventListener('keydown', tecla, true);
    fundo.remove();
    if (!document.querySelector('.dt-sheet-fundo')) document.body.classList.remove('dt-travado');
    origem?.focus();
  };
  // Na CAPTURA: com o painel e as substituições abertos, cada folha confere
  // se é a de cima (a última no DOM); só ela fecha, e o Esc para ali.
  function tecla(e) {
    if (e.key !== 'Escape') return;
    const todas = [...document.querySelectorAll('.dt-sheet-fundo')];
    if (todas[todas.length - 1] !== fundo) return;   // não sou a de cima
    e.preventDefault();
    e.stopImmediatePropagation();
    fechar();
  }
  document.addEventListener('keydown', tecla, true);
  fundo.addEventListener('mousedown', e => { if (e.target === fundo) fechar(); });
  // Foco preso no painel: Tab no último volta ao primeiro, e vice-versa.
  fundo.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = [...fundo.querySelectorAll('button, input, a[href], [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const [pri, ult] = [f[0], f[f.length - 1]];
    if (e.shiftKey && document.activeElement === pri) { e.preventDefault(); ult.focus(); }
    else if (!e.shiftKey && document.activeElement === ult) { e.preventDefault(); pri.focus(); }
  });
  return fechar;
}

/** Folha de substituições da DEMONSTRAÇÃO: mesma marcação, nada gravado. */
function abrirSubstituicoesDemo(alimento, origem) {
  const no = document.createElement('div');
  no.innerHTML = sheetHtml(alimento);
  const fundo = no.firstElementChild;
  // Na demonstração não há plano para trocar: sem "Escolher", e a nota diz
  // que é exemplo — "indicadas no seu plano" soaria como recomendação.
  fundo.querySelectorAll('[data-dt-escolher]').forEach(b => b.remove());
  const nota = fundo.querySelector('.dt-sheet-nota');
  if (nota) nota.textContent = 'Demonstração. No seu plano, aqui aparecem as trocas indicadas pelo seu nutricionista.';
  const fechar = abrirFolha(fundo, origem);
  fundo.querySelectorAll('[data-dt-sheet-fechar]').forEach(b => b.addEventListener('click', fechar));
  fundo.querySelector('.dt-sheet-x')?.focus();
}

function ligarDemo(cx) {
  // Treino: "Ver execução" mostra a explicação; ✓ marca a série só na tela.
  const video = cx.querySelector('[data-demo-video]');
  video?.addEventListener('click', () => {
    const nota = cx.querySelector('#ofDemoVideo');
    const abrir = nota.hidden;
    nota.hidden = !abrir;
    video.setAttribute('aria-expanded', String(abrir));
  });
  cx.querySelectorAll('[data-demo-serie]').forEach(b => b.addEventListener('click', () => {
    const bloco = b.closest('.pa-serie-block');
    const feito = !bloco.classList.contains('done');
    bloco.classList.toggle('done', feito);
    b.setAttribute('aria-pressed', String(feito));
  }));
  // Dieta: abrir/fechar a refeição e a folha de substituições.
  cx.querySelectorAll('[data-dt-toggle]').forEach(b => b.addEventListener('click', () => {
    const corpo = cx.querySelector(`#${CSS.escape(b.getAttribute('aria-controls'))}`);
    const abrir = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(abrir));
    b.closest('.dt-card')?.classList.toggle('dt-aberta', abrir);
    if (corpo) corpo.hidden = !abrir;
  }));
  cx.querySelectorAll('[data-dt-sub]').forEach(b => b.addEventListener('click', () => {
    const a = DEMO_REFEICAO.alimentos.find(x => x.id === b.dataset.dtSub);
    if (a) abrirSubstituicoesDemo(a, b);
  }));
}

function abrirPainelDemo(id, origem) {
  document.querySelector('[data-of-painel]')?.remove();
  const no = document.createElement('div');
  no.innerHTML = painelDemoHtml(id);
  const fundo = no.firstElementChild;
  const fechar = abrirFolha(fundo, origem);
  fundo.querySelector('[data-of-painel-fechar]').addEventListener('click', fechar);
  ligarDemo(fundo);
  fundo.querySelector('[data-of-painel-fechar]').focus();
}

// ── Montagem ────────────────────────────────────────────────

/**
 * Monta a página em `alvo` e a faixa fixa em `alvoAcao` (o .pa-finishbar-in
 * da casca; a faixa em si é o pai dele). `carregarCanal` é injetável para o
 * teste e para a prévia.
 */
export function renderVitrine(alvo, id, { alvoAcao = null, carregarCanal = carregarCanalComercial } = {}) {
  const cx = typeof alvo === 'string' ? document.getElementById(alvo) : alvo;
  if (!cx) return;
  cx.innerHTML = vitrineHtml(id);
  window.renderIcons?.();

  cx.querySelector('[data-of-ir]')?.addEventListener('click', e => {
    e.preventDefault();
    const alvoSec = cx.querySelector('#ofComo');
    const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
    alvoSec?.scrollIntoView({ behavior: calmo ? 'auto' : 'smooth', block: 'start' });
    alvoSec?.focus({ preventScroll: true });
  });
  cx.querySelector('[data-of-demo]')?.addEventListener('click', e => abrirPainelDemo(id, e.currentTarget));

  const faixaIn = typeof alvoAcao === 'string' ? document.getElementById(alvoAcao) : alvoAcao;
  const faixa = faixaIn?.closest('.pa-finishbar') || null;
  if (faixa) faixa.hidden = true;   // só aparece se houver ação funcional

  Promise.resolve(carregarCanal()).catch(() => null).then(canal => {
    if (!cx.isConnected) return;   // saiu da tela antes de responder
    cx.querySelectorAll('[data-of-acao]').forEach(a => { a.innerHTML = acaoHtml(id, canal, 'escuro'); });
    if (faixa && faixaIn && canal?.whatsapp) {
      faixaIn.innerHTML = acaoHtml(id, canal, 'faixa');
      ligarFaixa(cx, faixa);
    }
    window.renderIcons?.();
  });
}

/**
 * A faixa fixa só aparece quando NENHUMA das ações da página está à vista —
 * duas vezes o mesmo botão na mesma tela é ruído.
 */
function ligarFaixa(cx, faixa) {
  const acoes = [...cx.querySelectorAll('[data-of-acao]')];
  if (!('IntersectionObserver' in window) || !acoes.length) { faixa.hidden = false; return; }
  const visiveis = new Set();
  const io = new IntersectionObserver(entradas => {
    if (!faixa.isConnected) { io.disconnect(); return; }
    for (const en of entradas) en.isIntersecting ? visiveis.add(en.target) : visiveis.delete(en.target);
    faixa.hidden = visiveis.size > 0;
  }, { root: cx.closest('.pa-main') || null, threshold: 0 });
  acoes.forEach(a => io.observe(a));
}
