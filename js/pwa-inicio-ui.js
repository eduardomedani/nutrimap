// ═══════════════════════════════════════════════════════════
// PWA · INÍCIO — a tela de abertura do app do aluno
// ═══════════════════════════════════════════════════════════
// Responde três perguntas, nessa ordem: o que vem agora, como estou indo, e
// para onde eu vou. Nada além disso — o Início é atalho, não um quarto módulo.
//
// A marcação é gerada por funções puras (recebem dado, devolvem string) para
// que os testes possam conferir a TELA, não o texto do arquivo.
//
// A dieta chega DEPOIS: o Início desenha na hora com o que já está em memória
// (treino) e preenche a linha da refeição quando a rede responder. Esperar a
// dieta para pintar a tela inteira deixaria o app em branco no primeiro toque.

import {
  proximaRefeicaoDoDia, treinoDoDia, treinosNaSemana, formatarConsulta, formatarMeta,
} from './pwa-inicio-data.js';
import { resumoParaInicio } from './pwa-documentos-data.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** "Quinta, 6 de agosto" — sem o ano, que o paciente já sabe. */
export function dataLonga(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  const txt = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

/**
 * Uma linha do bloco "Hoje".
 *
 * É um <button> e não uma <div> com onclick: a linha leva a algum lugar, e
 * quem navega por teclado ou leitor de tela precisa que ela se anuncie como
 * navegável. `destino` vira `data-ir`, lido pela casca.
 */
export function linhaHoje({ icone, rotulo, valor, detalhe = '', destino = '', carregando = false }) {
  if (carregando) {
    return `
      <div class="in-linha in-linha-esq" aria-hidden="true">
        <span class="in-linha-ic"><span class="in-sk in-sk-ic"></span></span>
        <span class="in-linha-txt">
          <span class="in-linha-rot">${esc(rotulo)}</span>
          <span class="in-sk in-sk-val"></span>
        </span>
      </div>`;
  }

  const miolo = `
      <span class="in-linha-ic"><i data-lucide="${esc(icone)}"></i></span>
      <span class="in-linha-txt">
        <span class="in-linha-rot">${esc(rotulo)}</span>
        <span class="in-linha-val">${esc(valor)}</span>
        ${detalhe ? `<span class="in-linha-det">${esc(detalhe)}</span>` : ''}
      </span>`;

  // Sem destino, a linha é informação e não caminho. Um <button> que não leva a
  // lugar nenhum é uma promessa que o toque não cumpre — a consulta é o caso:
  // o paciente não tem tela de consultas, só precisa saber a data.
  if (!destino) return `<div class="in-linha in-linha-fixa">${miolo}</div>`;

  return `
    <button class="in-linha" type="button" data-ir="${esc(destino)}">${miolo}
      <span class="in-linha-seta" aria-hidden="true"><i data-lucide="chevron-right"></i></span>
    </button>`;
}

/** O bloco "Hoje". `refeicao === undefined` significa "ainda carregando". */
export function hojeHtml({
  refeicao, treino, exercicios = 0, grupos = '', consulta = null, treinoCarregando = false,
} = {}) {
  const linhas = [];

  if (refeicao === undefined) {
    linhas.push(linhaHoje({ rotulo: 'Próxima refeição', carregando: true }));
  } else if (refeicao) {
    linhas.push(linhaHoje({
      icone: 'utensils',
      rotulo: 'Próxima refeição',
      valor: `${refeicao.nome}${refeicao.horario ? ` · ${refeicao.horario}` : ''}`,
      detalhe: refeicao.amanha ? 'amanhã' : '',
      destino: 'dieta',
    }));
  }

  if (!treino && treinoCarregando) {
    linhas.push(linhaHoje({ rotulo: 'Treino do dia', carregando: true }));
  } else if (treino) {
    linhas.push(linhaHoje({
      icone: treino.feito ? 'circle-check-big' : 'dumbbell',
      rotulo: 'Treino do dia',
      valor: `Treino ${treino.dia}`,
      detalhe: treino.feito
        ? `concluído hoje${treino.proximo ? ` · próximo: Treino ${treino.proximo}` : ''}`
        : [grupos, exercicios ? `${exercicios} ${exercicios === 1 ? 'exercício' : 'exercícios'}` : '']
            .filter(Boolean).join(' · '),
      destino: 'treino',
    }));
  }

  if (consulta) {
    linhas.push(linhaHoje({
      icone: consulta.online ? 'video' : 'calendar-check',
      rotulo: 'Próxima consulta',
      valor: `${consulta.data} · ${consulta.hora}`,
      detalhe: [consulta.quando, consulta.online ? 'online' : 'presencial'].filter(Boolean).join(' · '),
    }));
  }

  if (!linhas.length) return '';
  return `<section class="in-bloco" aria-label="Hoje">${linhas.join('')}</section>`;
}

/**
 * "Suas metas" — o que o profissional combinou com o paciente.
 *
 * Só leitura: não há policy de escrita para o paciente em `paciente_metas`, e
 * um campo editável aqui sugeriria que ele pode mudar o combinado.
 */
export function metasHtml(metas = []) {
  const lista = (metas || []).filter(Boolean);
  if (!lista.length) return '';

  const linha = m => `
    <li class="in-meta">
      <span class="in-meta-nome">${esc(m.nome)}</span>
      ${m.alvo ? `<span class="in-meta-alvo">${esc(m.alvo)}</span>` : ''}
      ${m.prazo ? `<span class="in-meta-prazo">até ${esc(m.prazo)}</span>` : ''}
    </li>`;

  return `
    <h2 class="in-t">Suas metas</h2>
    <ul class="in-metas">${lista.map(linha).join('')}</ul>`;
}

/**
 * "Seu progresso" — três números que EXISTEM.
 *
 * Peso e aderência à dieta ficaram de fora porque não há tabela para nenhum dos
 * dois. Um tile "Peso: —" convida ao toque e não leva a lugar nenhum.
 */
export function progressoHtml({ sequencia = 0, recordes = 0, semana = 0, carregando = false } = {}) {
  // Enquanto o treino não chega, o número é esqueleto e não zero. "0 dias"
  // piscando antes de virar "3 dias" é pior do que não mostrar: por um
  // instante a tela afirma algo falso sobre o esforço de quem está olhando.
  const tile = (ic, rot, val, un = '') => `
    <div class="pa-stat">
      <div class="pa-stat-top"><span class="pa-stat-ic">${ic}</span> ${esc(rot)}</div>
      ${carregando
        ? '<div class="pa-stat-val"><span class="in-sk in-sk-num"></span></div>'
        : `<div class="pa-stat-val">${esc(String(val))}${un ? ` <small>${esc(un)}</small>` : ''}</div>`}
    </div>`;

  return `
    <h2 class="in-t">Seu progresso</h2>
    <div class="pa-stats in-stats3">
      ${tile('🔥', 'Sequência', sequencia, sequencia === 1 ? 'dia' : 'dias')}
      ${tile('📅', 'Na semana', semana, semana === 1 ? 'treino' : 'treinos')}
      ${tile('🏆', 'Recordes', recordes)}
    </div>`;
}

/**
 * "Acesso rápido".
 *
 * Só entra botão que chega a uma tela que existe. "Responder check-in" e
 * "Registrar peso" ficaram de fora: sem tabela por trás, seriam botões que
 * abrem um aviso de "em breve" — e um app cheio de portas falsas ensina o
 * paciente a não tocar em nada.
 */
/**
 * O contador do atalho de Documentos.
 *
 *   null  → a consulta falhou. NÃO dizer "0 arquivos": isso afirma que o
 *           paciente não tem nenhum, e a tela não sabe disso. O atalho aparece
 *           sem número, porque a funcionalidade existe independentemente de a
 *           consulta ter respondido.
 *   novos → o que há de novo vence a contagem total: quem tem 8 arquivos e 2
 *           por abrir quer saber dos 2.
 */
export function rotuloDocumentos(documentos) {
  if (!documentos) return '';
  const { total = 0, novos = 0 } = documentos;
  if (novos > 0) return `${novos} ${novos === 1 ? 'novo' : 'novos'}`;
  if (total > 0) return `${total} ${total === 1 ? 'arquivo' : 'arquivos'}`;
  return 'Nenhum arquivo';
}

export function atalhosHtml({ temTreino = false, temDieta = false, documentos } = {}) {
  const botoes = [];
  if (temTreino) botoes.push(`
    <button class="in-atalho in-atalho-forte" type="button" data-ir="treino">
      <i data-lucide="play"></i> Iniciar treino
    </button>`);
  if (temDieta) botoes.push(`
    <button class="in-atalho" type="button" data-ir="dieta">
      <i data-lucide="salad"></i> Ver dieta
    </button>`);

  // Documentos é módulo PERMANENTE: o atalho existe mesmo sem nenhum arquivo.
  // Um módulo que só aparece quando já tem conteúdo é um módulo que o paciente
  // nunca descobre — ele não tem como saber que existe um lugar onde os exames
  // vão chegar. Encontrabilidade não pode depender de o profissional já ter
  // compartilhado alguma coisa.
  const rotulo = rotuloDocumentos(documentos);
  botoes.push(`
    <button class="in-atalho" type="button" data-ir="documentos">
      <i data-lucide="folder-open"></i> Documentos
      ${rotulo ? `<span class="in-atalho-n">${esc(rotulo)}</span>` : ''}
    </button>`);

  return `
    <h2 class="in-t">Acesso rápido</h2>
    <div class="in-atalhos">${botoes.join('')}</div>`;
}

/**
 * O cartão de documento NOVO — e só quando há novo.
 *
 * Sem novidade este bloco não existe (quem responde pelo acesso é o atalho lá
 * embaixo), e sem documento nenhum não existe nada: espaço vazio reservado
 * para o que pode nunca chegar é espaço roubado do que chega todo dia.
 *
 * Vem DEPOIS de refeição e treino de propósito. Um exame compartilhado é
 * importante, mas não é o que o paciente abriu o app para ver às 7h.
 */
export function documentosHtml({ novos = 0, titulo = null } = {}) {
  if (!novos) return '';
  const um = novos === 1;
  return `
    <section class="in-doc" aria-label="${um ? 'Novo documento' : `${novos} novos documentos`}">
      <div class="in-doc-ico"><i data-lucide="file-text"></i></div>
      <div class="in-doc-txt">
        <div class="in-doc-tag">${um ? 'Novo documento' : `${novos} novos documentos`}</div>
        ${um && titulo ? `<div class="in-doc-tit">${esc(titulo)}</div>` : ''}
        <div class="in-doc-sub">Compartilhado pelo seu profissional</div>
      </div>
      <button class="in-doc-btn" type="button" data-ir="documentos">
        ${um ? 'Ver documento' : 'Ver documentos'}
      </button>
    </section>`;
}

/** A tela inteira. */
export function inicioHtml(d = {}) {
  const {
    saudacao = 'Olá', nome = '', hoje = '',
    refeicao, treino = null, exercicios = 0, grupos = '', consulta = null,
    sequencia = 0, recordes = 0, semana = 0, metas = [],
    temTreino = false, temDieta = false, treinoCarregando = false,
    documentos = null,
  } = d;

  const corpo = hojeHtml({ refeicao, treino, exercicios, grupos, consulta, treinoCarregando });

  return `
    <div class="inicio">
      <section class="pa-hero in-hero">
        <div class="pa-hero-title">${esc(saudacao)}${nome ? `, ${esc(nome)}` : ''} 👋</div>
        ${hoje ? `<div class="pa-hero-sub">${esc(dataLonga(hoje))}</div>` : ''}
      </section>

      ${corpo || `
      <section class="pa-empty pa-empty-lg">
        <i data-lucide="calendar-clock"></i>
        <div class="pa-empty-t">Nada programado ainda</div>
        <div class="pa-empty-s">Assim que seu profissional publicar um treino ou uma dieta, ele aparece aqui.</div>
      </section>`}

      ${documentosHtml(documentos || {})}
      ${progressoHtml({ sequencia, recordes, semana, carregando: treinoCarregando })}
      ${metasHtml(metas)}
      ${atalhosHtml({ temTreino, temDieta, documentos })}
    </div>`;
}

/**
 * Traduz o que a casca tem em memória para o que a tela precisa.
 *
 * As contas (treino do dia, treinos da semana) moram DESTE lado, não em
 * js/paciente-ui.js: assim o teste consegue exercitá-las sem levantar o app
 * inteiro, e a casca continua só entregando matéria-prima.
 */
export function montarDados(b = {}) {
  return {
    saudacao: b.saudacao || 'Olá',
    nome: b.nome || '',
    hoje: b.hoje || '',
    treino: treinoDoDia({ dias: b.dias, proximo: b.proximo, treinadoHoje: b.treinadoHoje }),
    exercicios: b.exercicios || 0,
    grupos: b.grupos || '',
    sequencia: b.sequencia || 0,
    recordes: b.recordes || 0,
    semana: treinosNaSemana(b.datasTreinadas, b.hoje),
    temTreino: (b.dias || []).length > 0,
  };
}

/**
 * Monta a tela e liga os toques.
 *
 * `bruto` vem da casca (js/paciente-ui.js), que já tem o treino em memória.
 * `carregarDieta` é injetável para o teste poder rodar sem rede.
 */
export async function renderInicioPaciente(alvo, bruto = {}, opcoes = {}) {
  const cx = typeof alvo === 'string' ? document.getElementById(alvo) : alvo;
  if (!cx) return;

  // 1ª pintura: IMEDIATA, com o que não custa rede — a saudação e a data. O
  // treino, a dieta, a consulta e as metas entram em esqueleto. Esperar
  // qualquer uma delas para desenhar deixa o app parado em "Abrindo...".
  cx.innerHTML = inicioHtml({
    ...montarDados(bruto),
    refeicao: undefined,
    treinoCarregando: !!opcoes.treino,
  });
  ligarAtalhos(cx, opcoes.ir);

  // As três fontes vão JUNTAS e cada uma cai sozinha. São independentes: a
  // consulta não depende da dieta, e nenhuma delas justifica derrubar a tela.
  // Enquanto db/paciente_inicio_leitura.sql não tiver rodado, os dois RPCs
  // falham — e o Início precisa continuar de pé exatamente igual, só sem
  // essas duas seções.
  const carregarDieta = opcoes.carregarDieta
    || (async () => (await import('./pwa-dieta-data.js')).carregarDieta(bruto.pacienteId || null));
  const carregarConsulta = opcoes.carregarConsulta
    || (async () => (await import('./paciente-data.js')).proximaConsulta());
  const carregarMetas = opcoes.carregarMetas
    || (async () => (await import('./paciente-data.js')).minhasMetas());
  // UMA leitura para os dois números do bloco (total e novos) — nada de uma
  // consulta por documento só para mostrar uma contagem. O RLS já entrega
  // apenas o que está disponível e não arquivado.
  const carregarDocumentos = opcoes.carregarDocumentos
    || (async () => (await import('./paciente-documentos.js')).meusDocumentos({ limite: 100 }));

  // As QUATRO vão juntas. Antes o treino era esperado primeiro e só então
  // estas três começavam: quatro esperas em fila viravam a soma dos tempos, e
  // não o maior deles.
  const [rTreino, rDieta, rConsulta, rMetas, rDocs] = await Promise.all([
    opcoes.treino ? tentar(() => opcoes.treino, 'treino') : { ok: true, valor: null },
    tentar(carregarDieta, 'dieta'),
    tentar(carregarConsulta, 'consulta'),
    tentar(carregarMetas, 'metas'),
    tentar(carregarDocumentos, 'documentos'),
  ]);

  // Com a rede fora, TODAS falham. Aí a tela não pode dizer "nada programado":
  // isso afirma sobre o plano do paciente uma coisa que ela não sabe.
  const consultadas = [rDieta, rConsulta, rMetas].concat(opcoes.treino ? [rTreino] : []);
  if (consultadas.every(r => !r.ok)) {
    cx.innerHTML = erroHtml();
    const b = cx.querySelector('#inRetry');
    if (b) b.addEventListener('click', () => renderInicioPaciente(alvo, bruto, opcoes));
    return;
  }

  const treino = rTreino.valor;
  const dieta = rDieta.valor;
  const consultaBruta = rConsulta.valor;
  const metasBrutas = rMetas.valor;

  const dados = montarDados({ ...bruto, ...(treino || {}) });

  // Ter dieta e ter PRÓXIMA refeição são coisas diferentes: um plano cujas
  // refeições não têm horário não produz "próxima", mas continua existindo e
  // continua valendo o atalho. Amarrar o atalho à linha esconderia a dieta de
  // quem tem uma.
  const refeicao = dieta ? proximaRefeicaoDoDia(dieta.refeicoes, opcoes.agora ?? horaAgora()) : null;

  cx.innerHTML = inicioHtml({
    ...dados,
    refeicao,
    temDieta: !!dieta,
    consulta: formatarConsulta(consultaBruta, bruto.hoje || ''),
    metas: (metasBrutas || []).map(formatarMeta).filter(Boolean),
    // Documentos que não carregaram viram ausência de bloco, não bloco vazio:
    // "0 arquivos" afirmaria que o paciente não tem nenhum, e isso a tela não
    // sabe quando a consulta falhou.
    documentos: rDocs.ok ? resumoParaInicio(rDocs.valor || []) : null,
  });
  ligarAtalhos(cx, opcoes.ir);
}

// Cada fonte falha por si. O log fica, porque um RPC que sumiu é problema
// real — mas não é problema do paciente, que só veria a tela pela metade.
//
// Devolve `{ ok }` em vez do valor cru porque "carregou e está vazio" e "não
// carregou" são coisas diferentes: as duas dariam `null`, e a tela precisa
// dizer "você não tem plano" num caso e "não deu para carregar" no outro.
async function tentar(fn, rotulo) {
  try { return { ok: true, valor: await fn() }; }
  catch (e) { console.error(`Início · ${rotulo}:`, e); return { ok: false, valor: null }; }
}

/** Quando NENHUMA fonte respondeu, o problema é a conexão — não o plano. */
export function erroHtml() {
  return `
    <div class="inicio">
      <section class="pa-empty pa-empty-lg">
        <i data-lucide="cloud-off"></i>
        <div class="pa-empty-t">Não foi possível carregar</div>
        <div class="pa-empty-s">Verifique sua conexão e tente novamente.</div>
        <button class="in-atalho in-atalho-forte" type="button" id="inRetry">
          <i data-lucide="rotate-cw"></i> Tentar novamente
        </button>
      </section>
    </div>`;
}

function ligarAtalhos(cx, ir) {
  if (typeof ir !== 'function') return;
  cx.querySelectorAll('[data-ir]').forEach(b =>
    b.addEventListener('click', () => ir(b.dataset.ir)));
}

/** "HH:MM" de agora — mesmo formato que a dieta usa para comparar horários. */
export function horaAgora(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export { proximaRefeicaoDoDia, treinoDoDia, treinosNaSemana, formatarConsulta, formatarMeta };
