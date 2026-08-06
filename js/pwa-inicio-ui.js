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
export function hojeHtml({ refeicao, treino, exercicios = 0, grupos = '', consulta = null } = {}) {
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

  if (treino) {
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
export function progressoHtml({ sequencia = 0, recordes = 0, semana = 0 } = {}) {
  const tile = (ic, rot, val, un = '') => `
    <div class="pa-stat">
      <div class="pa-stat-top"><span class="pa-stat-ic">${ic}</span> ${esc(rot)}</div>
      <div class="pa-stat-val">${esc(String(val))}${un ? ` <small>${esc(un)}</small>` : ''}</div>
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
export function atalhosHtml({ temTreino = false, temDieta = false } = {}) {
  const botoes = [];
  if (temTreino) botoes.push(`
    <button class="in-atalho in-atalho-forte" type="button" data-ir="treino">
      <i data-lucide="play"></i> Iniciar treino
    </button>`);
  if (temDieta) botoes.push(`
    <button class="in-atalho" type="button" data-ir="dieta">
      <i data-lucide="salad"></i> Ver dieta
    </button>`);

  if (!botoes.length) return '';
  return `
    <h2 class="in-t">Acesso rápido</h2>
    <div class="in-atalhos">${botoes.join('')}</div>`;
}

/** A tela inteira. */
export function inicioHtml(d = {}) {
  const {
    saudacao = 'Olá', nome = '', hoje = '',
    refeicao, treino = null, exercicios = 0, grupos = '', consulta = null,
    sequencia = 0, recordes = 0, semana = 0, metas = [],
    temTreino = false, temDieta = false,
  } = d;

  const corpo = hojeHtml({ refeicao, treino, exercicios, grupos, consulta });

  return `
    <div class="inicio">
      <section class="pa-hero">
        <div class="pa-hero-hi">${esc(saudacao)}${nome ? `, ${esc(nome)}` : ''} 👋</div>
        <div class="pa-hero-title">Hoje</div>
        ${hoje ? `<div class="pa-hero-sub">${esc(dataLonga(hoje))}</div>` : ''}
      </section>

      ${corpo || `
      <section class="pa-empty pa-empty-lg">
        <i data-lucide="calendar-clock"></i>
        <div class="pa-empty-t">Nada programado ainda</div>
        <div class="pa-empty-s">Assim que seu profissional publicar um treino ou uma dieta, ele aparece aqui.</div>
      </section>`}

      ${progressoHtml({ sequencia, recordes, semana })}
      ${metasHtml(metas)}
      ${atalhosHtml({ temTreino, temDieta })}
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

  const dados = montarDados(bruto);

  // 1ª pintura: tudo o que já se sabe, com a refeição em esqueleto.
  cx.innerHTML = inicioHtml({ ...dados, refeicao: undefined });
  ligarAtalhos(cx, opcoes.ir);

  // As três fontes vão JUNTAS e cada uma cai sozinha. São independentes: a
  // consulta não depende da dieta, e nenhuma delas justifica derrubar a tela.
  // Enquanto db/paciente_inicio_leitura.sql não tiver rodado, os dois RPCs
  // falham — e o Início precisa continuar de pé exatamente igual, só sem
  // essas duas seções.
  const carregarDieta = opcoes.carregarDieta
    || (async () => (await import('./pwa-dieta-data.js')).carregarDieta());
  const carregarConsulta = opcoes.carregarConsulta
    || (async () => (await import('./paciente-data.js')).proximaConsulta());
  const carregarMetas = opcoes.carregarMetas
    || (async () => (await import('./paciente-data.js')).minhasMetas());

  const [dieta, consultaBruta, metasBrutas] = await Promise.all([
    tentar(carregarDieta, 'dieta'),
    tentar(carregarConsulta, 'consulta'),
    tentar(carregarMetas, 'metas'),
  ]);

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
  });
  ligarAtalhos(cx, opcoes.ir);
}

// Cada fonte falha por si. O log fica, porque um RPC que sumiu é problema
// real — mas não é problema do paciente, que só veria a tela pela metade.
async function tentar(fn, rotulo) {
  try { return await fn(); }
  catch (e) { console.error(`Início · ${rotulo}:`, e); return null; }
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
