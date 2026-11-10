// ═══════════════════════════════════════════════════════════
// PWA · INÍCIO — a tela de abertura do app do aluno
// ═══════════════════════════════════════════════════════════
// Ordem (redesenho de 10/11/2026): o que o aluno FAZ hoje vem primeiro, o
// administrativo vem por último.
//   1. Saudação compacta
//   2. Treino de hoje   (card de destaque)
//   3. Sua alimentação  (card de destaque)
//   4. Sua semana       (frequência, compacta)
//   5. Próxima aula     (agenda presencial — diferente do treino no app)
//   6. Meu plano        (um card só: plano, aulas disponíveis, validade)
//   + documento novo, metas e o acesso aos documentos
//
// Regras que valem para a tela toda:
//   * Nada inventado: o card mostra o que o banco tem. Sem treino ou dieta
//     publicados, o card continua e diz que o profissional está preparando —
//     e NÃO oferece botão para uma tela vazia.
//   * Carregando é esqueleto dentro do card, não zero ("0 treinos" que vira
//     "3" afirma algo falso por um instante).
//   * Cada fonte falha sozinha; só com TODAS fora a tela diz que não carregou.
//
// A marcação sai de funções puras (dado → string), testadas como marcação.

import {
  proximaRefeicaoDoDia, treinoDoDia, treinosNaSemana, formatarConsulta, formatarMeta,
  inicioDaSemana, somarDias, diasAte,
} from './pwa-inicio-data.js';
import { resumoParaInicio } from './pwa-documentos-data.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ic = nome => `<i data-lucide="${esc(nome)}"></i>`;
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const ddmm = iso => String(iso || '').slice(0, 10).split('-').reverse().slice(0, 2).join('/');
const DIA_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const INICIAL = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/** "Quinta-feira, 6 de agosto" — sem o ano, que o aluno já sabe. */
export function dataLonga(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  const txt = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

// ── peças comuns ────────────────────────────────────────────
const esqueleto = (linhas = 2) => `
  <div class="in-sk-bloco" aria-hidden="true">
    <span class="in-sk in-sk-tit"></span>
    ${'<span class="in-sk in-sk-lin"></span>'.repeat(Math.max(0, linhas - 1))}
  </div>`;

function cabecalhoCard({ icone, rotulo, titulo = '', selo = '', id }) {
  return `
    <div class="in-card-top">
      <span class="in-card-ic">${ic(icone)}</span>
      <div class="in-card-cab">
        <p class="in-card-rot">${esc(rotulo)}</p>
        ${titulo ? `<h2 class="in-card-tit" id="${esc(id)}">${esc(titulo)}</h2>` : ''}
      </div>
      ${selo}
    </div>`;
}

// ── 2. Treino de hoje ───────────────────────────────────────
/**
 * `treino` vem de treinoDoDia; `carregando` enquanto a carga do treino não
 * chegou; sem treino publicado, o card avisa e não tem botão.
 */
export function treinoHojeHtml({ treino = null, temTreino = false, carregando = false, grupos = '', exercicios = 0, minutos = 0, emAndamento = false } = {}) {
  const abre = `<section class="in-card in-card-forte in-treino" aria-labelledby="inTreinoT">`;
  if (carregando && !treino) {
    return `${abre}${cabecalhoCard({ icone: 'dumbbell', rotulo: 'Treino de hoje' })}${esqueleto(2)}</section>`;
  }
  if (!treino || !temTreino) {
    return `
      <section class="in-card in-card-forte in-treino" aria-label="Treino de hoje">
        ${cabecalhoCard({ icone: 'dumbbell', rotulo: 'Treino de hoje' })}
        <p class="in-card-vazio">Seu profissional está preparando seu treino.</p>
      </section>`;
  }

  const feito = !!treino.feito;
  const selo = feito
    ? `<span class="in-selo in-selo-ok">${ic('circle-check')} Concluído</span>`
    : emAndamento ? `<span class="in-selo in-selo-vivo">Em andamento</span>` : '';
  const meta = feito
    ? [treino.proximo ? `Próximo: Treino ${treino.proximo}` : '']
    : [grupos, exercicios ? plural(exercicios, 'exercício', 'exercícios') : '', minutos ? `≈ ${minutos} min` : ''];
  // Cada pedaço inteiro numa linha: "≈ 55 min" não quebra no meio em 320px.
  const metaTxt = meta.filter(Boolean).map(p => `<span class="in-nq">${esc(p)}</span>`).join(' · ');
  const botao = feito
    ? `<button class="in-btn in-btn-sec" type="button" data-ir="treino">${ic('list-checks')} Ver treino</button>`
    : `<button class="in-btn in-btn-pri" type="button" data-ir="treino">${ic('play')} ${emAndamento ? 'Continuar treino' : 'Iniciar treino'}</button>`;

  return `
    ${abre}
      ${cabecalhoCard({ icone: feito ? 'circle-check-big' : 'dumbbell', rotulo: 'Treino de hoje', titulo: `Treino ${treino.dia}`, selo, id: 'inTreinoT' })}
      ${feito ? '<p class="in-card-ok">Treino de hoje concluído. Bom trabalho!</p>' : ''}
      ${metaTxt ? `<p class="in-card-meta">${metaTxt}</p>` : ''}
      ${botao}
    </section>`;
}

// ── 3. Sua alimentação ─────────────────────────────────────
/**
 * `dieta`: undefined = carregando; null = sem plano publicado; ou
 * `{ nome, refeicoes: n, proxima: { nome, horario, amanha } | null }`.
 */
export function alimentacaoHtml(dieta) {
  if (dieta === undefined) {
    return `<section class="in-card in-card-forte in-dieta" aria-label="Sua alimentação">${cabecalhoCard({ icone: 'salad', rotulo: 'Sua alimentação' })}${esqueleto(2)}</section>`;
  }
  if (!dieta || dieta === 'falhou') {
    // Falhou ≠ não existe: "preparando" afirmaria algo que a tela não sabe.
    return `
      <section class="in-card in-card-forte in-dieta" aria-label="Sua alimentação">
        ${cabecalhoCard({ icone: 'salad', rotulo: 'Sua alimentação' })}
        <p class="in-card-vazio">${dieta === 'falhou'
          ? 'Não foi possível carregar sua alimentação agora. Tente de novo em instantes.'
          : 'Seu profissional está preparando seu plano alimentar.'}</p>
      </section>`;
  }
  const p = dieta.proxima;
  const proxima = p
    ? `<div class="in-prox">
         <span class="in-prox-rot">${p.amanha ? 'Primeira refeição de amanhã' : 'Próxima refeição'}</span>
         <span class="in-prox-val">${esc(p.nome)}${p.horario ? ` · ${esc(p.horario)}` : ''}</span>
       </div>`
    : '';
  const meta = dieta.refeicoes ? plural(dieta.refeicoes, 'refeição no plano', 'refeições no plano') : '';
  return `
    <section class="in-card in-card-forte in-dieta" aria-labelledby="inDietaT">
      ${cabecalhoCard({ icone: 'salad', rotulo: 'Sua alimentação', titulo: dieta.nome || 'Plano alimentar', id: 'inDietaT' })}
      ${proxima}
      ${meta ? `<p class="in-card-meta">${esc(meta)}</p>` : ''}
      <button class="in-btn in-btn-sec" type="button" data-ir="dieta">${ic('utensils')} Ver dieta</button>
    </section>`;
}

// ── 4. Sua semana ───────────────────────────────────────────
/** Os 7 dias (seg→dom) da semana de `hoje`, com treino feito ou não. */
export function diasDaSemana(datas = [], hoje = '') {
  const ini = inicioDaSemana(hoje);
  if (!ini) return [];
  const feitos = new Set((datas || []).map(d => String(d).slice(0, 10)));
  return [...Array(7)].map((_, i) => {
    const data = somarDias(ini, i);
    const dow = new Date(data + 'T12:00:00').getDay();
    return { data, inicial: INICIAL[dow], nome: DIA_CURTO[dow], feito: feitos.has(data), hoje: data === hoje, futuro: data > hoje };
  });
}

/**
 * Frequência da semana. Dia futuro é só dia futuro — nunca "falta". A meta
 * semanal só aparece se o profissional cadastrou uma (meta "Treinos por
 * semana"). Sequência e recordes viram uma linha discreta, e só quando > 0.
 */
export function semanaHtml({ datas = [], hoje = '', semana = 0, meta = null, sequencia = 0, recordes = 0, carregando = false } = {}) {
  if (carregando) {
    return `<section class="in-card in-semana" aria-label="Sua semana">
      <div class="in-semana-top"><h2 class="in-card-rot">Sua semana</h2><span class="in-sk in-sk-num"></span></div>
      ${esqueleto(1)}</section>`;
  }
  const dias = diasDaSemana(datas, hoje);
  if (!dias.length) return '';
  const resumo = meta ? `${semana} de ${meta} treinos` : plural(semana, 'treino', 'treinos');
  const extra = [
    sequencia > 0 ? `${ic('flame')} ${plural(sequencia, 'dia seguido', 'dias seguidos')}` : '',
    recordes > 0 ? `${ic('trophy')} ${plural(recordes, 'recorde', 'recordes')}` : '',
  ].filter(Boolean);
  return `
    <section class="in-card in-semana" aria-labelledby="inSemanaT">
      <div class="in-semana-top">
        <h2 class="in-card-rot" id="inSemanaT">Sua semana</h2>
        <span class="in-semana-n">${esc(resumo)}</span>
      </div>
      <ol class="in-dias">
        ${dias.map(d => `
          <li class="in-dia${d.feito ? ' feito' : ''}${d.hoje ? ' hoje' : ''}${d.futuro ? ' futuro' : ''}"
              aria-label="${esc(d.nome)}${d.feito ? ', treinou' : d.futuro ? '' : ', sem treino'}${d.hoje ? ' (hoje)' : ''}">
            <span class="in-dia-l" aria-hidden="true">${esc(d.inicial)}</span>
            <span class="in-dia-m" aria-hidden="true">${d.feito ? ic('check') : ''}</span>
          </li>`).join('')}
      </ol>
      ${extra.length ? `<p class="in-semana-extra">${extra.join('<span aria-hidden="true">·</span>')}</p>` : ''}
    </section>`;
}

// ── 5. Próxima aula (agenda presencial) ─────────────────────
/**
 * A primeira aula marcada (fixo ou reserva) que ainda não começou, nas
 * semanas carregadas da agenda. Datas e horas são locais (Brasília).
 */
export function proximaAula(semanas = [], agora = '') {
  const lim = String(agora).slice(0, 16);
  const todas = (semanas || []).flatMap(s => (s?.horarios || []))
    .filter(h => (h.meu === 'fixo' || h.meu === 'reserva') && `${h.data}T${String(h.hora).slice(0, 5)}` > lim)
    .sort((a, b) => `${a.data}${a.hora}`.localeCompare(`${b.data}${b.hora}`));
  return todas[0] || null;
}

const fimDaAula = (hora, min) => { const [h, m] = String(hora).split(':').map(Number); const t = h * 60 + m + Number(min || 60); return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

/**
 * `agenda`: null/undefined = agenda desligada ou não carregou (não mostra);
 * `{ aula, podeAgendar, hoje }`.
 */
export function proximaAulaHtml(agenda) {
  if (!agenda) return '';
  const { aula, podeAgendar, hoje = '' } = agenda;
  if (!aula && !podeAgendar) return '';
  // "Presencial" fica na linha de detalhe, não ao lado do título: ali ele
  // cortava a data em 375px. É o que separa a aula na academia do treino
  // feito pelo app.
  const local = `<span class="in-local">${ic('map-pin')} Aula presencial</span>`;
  if (!aula) {
    return `
      <section class="in-card in-aula" aria-label="Próxima aula">
        ${cabecalhoCard({ icone: 'calendar-days', rotulo: 'Próxima aula' })}
        <p class="in-card-vazio">Você não tem aula marcada nos próximos dias.</p>
        <p class="in-card-meta">${local}</p>
        <button class="in-btn in-btn-sec" type="button" data-ir="agenda">${ic('calendar-plus')} Agendar aula</button>
      </section>`;
  }
  const dias = diasAte(aula.data, hoje);
  const quando = dias === 0 ? 'Hoje' : dias === 1 ? 'Amanhã' : dataLonga(aula.data).split(',')[0];
  return `
    <section class="in-card in-aula" aria-labelledby="inAulaT">
      ${cabecalhoCard({ icone: 'calendar-days', rotulo: 'Próxima aula', titulo: `${quando}, ${ddmm(aula.data)} · ${aula.hora}–${fimDaAula(aula.hora, aula.duracao_min)}`, id: 'inAulaT' })}
      <p class="in-card-meta">${local} · ${esc(aula.modalidade || 'Musculação')} · ${aula.meu === 'fixo' ? 'seu horário fixo' : 'reserva'}</p>
      <button class="in-btn in-btn-sec" type="button" data-ir="agenda">${ic('calendar-days')} Ver agenda</button>
    </section>`;
}

/** Consulta com o profissional (quando houver) — informação, sem botão. */
export function consultaHtml(consulta) {
  if (!consulta) return '';
  return `
    <section class="in-card in-consulta" aria-label="Próxima consulta">
      ${cabecalhoCard({ icone: consulta.online ? 'video' : 'stethoscope', rotulo: 'Próxima consulta', titulo: `${consulta.data} · ${consulta.hora}`, id: 'inConsT' })}
      <p class="in-card-meta">${esc([consulta.quando, consulta.online ? 'online' : 'presencial'].filter(Boolean).join(' · '))}</p>
    </section>`;
}

// ── 6. Meu plano ───────────────────────────────────────────
/**
 * Um card só: plano, aulas disponíveis e validade. Detalhes no fluxo que já
 * existe (a agenda). Os dias restantes são contados até a DATA DE VALIDADE
 * (`fim`), a mesma que o card mostra: em 10/11 com validade 10/12 → 30 dias;
 * no próprio dia 10/12 → "último dia".
 */
export function planoHtml(r, hoje = '') {
  if (!r || !r.ativo || !r.plano || !r.fim) return '';
  const n = v => Math.max(0, Number(v) || 0);
  const faltam = hoje ? diasAte(r.fim, hoje) : null;
  const resta = faltam === null ? '' : faltam > 1 ? `${faltam} dias restantes` : faltam === 1 ? 'termina amanhã' : faltam === 0 ? 'último dia' : 'vencido';
  return `
    <section class="in-plano" aria-label="Meu plano">
      <button class="in-plano-btn" type="button" data-ir="agenda">
        <span class="in-plano-ic">${ic('id-card')}</span>
        <span class="in-plano-txt">
          <span class="in-card-rot">Meu plano</span>
          <span class="in-plano-nome">${esc(r.plano)}</span>
          <span class="in-plano-det">${esc(plural(n(r.disponiveis), 'aula disponível', 'aulas disponíveis'))} · ${esc(plural(n(r.feitas), 'feita', 'feitas'))}</span>
          <span class="in-plano-det">Válido até ${esc(ddmm(r.fim))}${resta ? ` · ${esc(resta)}` : ''}</span>
        </span>
        <span class="in-seta" aria-hidden="true">${ic('chevron-right')}</span>
      </button>
    </section>`;
}

// ── extras: documentos e metas ──────────────────────────────
/** O contador do acesso a Documentos (null = consulta falhou: sem número). */
export function rotuloDocumentos(documentos) {
  if (!documentos) return '';
  const { total = 0, novos = 0 } = documentos;
  if (novos > 0) return `${novos} ${novos === 1 ? 'novo' : 'novos'}`;
  if (total > 0) return `${total} ${total === 1 ? 'arquivo' : 'arquivos'}`;
  return 'Nenhum arquivo';
}

/** Documento NOVO: cartão de aviso — e só quando há novo. */
export function documentosHtml({ novos = 0, titulo = null } = {}) {
  if (!novos) return '';
  const um = novos === 1;
  return `
    <section class="in-doc" aria-label="${um ? 'Novo documento' : `${novos} novos documentos`}">
      <div class="in-doc-ico">${ic('file-text')}</div>
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

/**
 * Acesso permanente a Documentos: o aluno precisa saber que o lugar existe
 * antes de o profissional compartilhar o primeiro arquivo.
 */
export function acessoDocumentosHtml(documentos) {
  const rotulo = rotuloDocumentos(documentos);
  return `
    <button class="in-linha-doc" type="button" data-ir="documentos">
      <span class="in-plano-ic">${ic('folder-open')}</span>
      <span class="in-linha-doc-t">Documentos</span>
      ${rotulo ? `<span class="in-linha-doc-n">${esc(rotulo)}</span>` : ''}
      <span class="in-seta" aria-hidden="true">${ic('chevron-right')}</span>
    </button>`;
}

/** Metas combinadas com o profissional — só leitura. */
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

/** A meta semanal de treinos, se o profissional cadastrou uma. */
export function metaSemanal(metasBrutas = []) {
  const m = (metasBrutas || []).find(x => x && x.tipo === 'frequencia_treino' && Number(x.valor_alvo) > 0);
  return m ? Math.round(Number(m.valor_alvo)) : null;
}

// ── a tela ──────────────────────────────────────────────────
export function inicioHtml(d = {}) {
  const {
    saudacao = 'Olá', nome = '', hoje = '',
    treino = null, temTreino = false, treinoCarregando = false,
    exercicios = 0, grupos = '', minutos = 0, emAndamento = false,
    dieta,   // undefined = carregando · null = sem plano · 'falhou' · resumo
    datasTreinadas = [], semana = 0, metaSemana = null, sequencia = 0, recordes = 0,
    agenda = null, consulta = null, plano = null, metas = [], documentos = null,
  } = d;

  return `
    <div class="inicio">
      <header class="in-ola">
        <h1 class="in-ola-t">${esc(saudacao)}${nome ? `, ${esc(nome)}` : ''} 👋</h1>
        ${hoje ? `<p class="in-ola-s">${esc(dataLonga(hoje))}</p>` : ''}
      </header>

      <div class="in-duo">
        ${treinoHojeHtml({ treino, temTreino, carregando: treinoCarregando, grupos, exercicios, minutos, emAndamento })}
        ${alimentacaoHtml(dieta)}
      </div>

      ${documentosHtml(documentos || {})}
      ${semanaHtml({ datas: datasTreinadas, hoje, semana, meta: metaSemana, sequencia, recordes, carregando: treinoCarregando })}
      ${proximaAulaHtml(agenda)}
      ${consultaHtml(consulta)}
      ${planoHtml(plano, hoje)}
      ${metasHtml(metas)}
      ${acessoDocumentosHtml(documentos)}
    </div>`;
}

/**
 * Traduz o que a casca tem em memória para o que a tela precisa. As contas
 * moram DESTE lado, para o teste exercitá-las sem levantar o app inteiro.
 */
export function montarDados(b = {}) {
  return {
    saudacao: b.saudacao || 'Olá',
    nome: b.nome || '',
    hoje: b.hoje || '',
    treino: treinoDoDia({ dias: b.dias, proximo: b.proximo, treinadoHoje: b.treinadoHoje }),
    exercicios: b.exercicios || 0,
    grupos: b.grupos || '',
    minutos: b.minutos || 0,
    emAndamento: !!b.emAndamento,
    sequencia: b.sequencia || 0,
    recordes: b.recordes || 0,
    datasTreinadas: b.datasTreinadas || [],
    semana: treinosNaSemana(b.datasTreinadas, b.hoje),
    temTreino: (b.dias || []).length > 0,
  };
}

/** A dieta como o card precisa: nome, quantas refeições e a próxima. */
export function resumoDaDieta(dieta, agora) {
  if (!dieta) return null;
  return {
    nome: dieta.plano?.nome || '',
    refeicoes: (dieta.refeicoes || []).length,
    proxima: proximaRefeicaoDoDia(dieta.refeicoes, agora),
  };
}

/**
 * Monta a tela e liga os toques. `bruto` vem da casca (js/paciente-ui.js);
 * as cargas são injetáveis para o teste rodar sem rede.
 */
export async function renderInicioPaciente(alvo, bruto = {}, opcoes = {}) {
  const cx = typeof alvo === 'string' ? document.getElementById(alvo) : alvo;
  if (!cx) return;

  // 1ª pintura IMEDIATA: saudação, data e o que já está em memória; o resto
  // em esqueleto dentro do próprio card.
  cx.innerHTML = inicioHtml({ ...montarDados(bruto), dieta: undefined, treinoCarregando: !!opcoes.treino });
  ligarAtalhos(cx, opcoes.ir);

  const carregarDieta = opcoes.carregarDieta
    || (async () => (await import('./pwa-dieta-data.js')).carregarDieta(bruto.pacienteId || null));
  const carregarConsulta = opcoes.carregarConsulta
    || (async () => (await import('./paciente-data.js')).proximaConsulta());
  const carregarMetas = opcoes.carregarMetas
    || (async () => (await import('./paciente-data.js')).minhasMetas());
  const carregarDocumentos = opcoes.carregarDocumentos
    || (async () => (await import('./paciente-documentos.js')).meusDocumentos({ limite: 100 }));
  // Agenda e plano: blocos a mais. Sem a migração ou com a agenda desligada,
  // simplesmente não aparecem — ficam fora da conta do "tudo falhou".
  const carregarPlano = opcoes.carregarPlano
    || (async () => (await import('./pwa-agenda-data.js')).resumoDoPlano());
  const carregarAgenda = opcoes.carregarAgenda || (async () => {
    const A = await import('./pwa-agenda-data.js');
    const esta = await A.semanaDaAgenda(null);
    if (!esta?.ativo) return null;
    const proxima = await A.semanaDaAgenda(somarDias(esta.semana, 7)).catch(() => null);
    return { semanas: [esta, proxima].filter(Boolean) };
  });

  const [rTreino, rDieta, rConsulta, rMetas, rDocs, rPlano, rAgenda] = await Promise.all([
    opcoes.treino ? tentar(() => opcoes.treino, 'treino') : { ok: true, valor: null },
    tentar(carregarDieta, 'dieta'),
    tentar(carregarConsulta, 'consulta'),
    tentar(carregarMetas, 'metas'),
    tentar(carregarDocumentos, 'documentos'),
    tentar(carregarPlano, 'plano'),
    tentar(carregarAgenda, 'agenda'),
  ]);

  // Com a rede fora, TODAS falham: aí a tela não pode dizer "preparando seu
  // treino" — isso afirma algo que ela não sabe.
  const consultadas = [rDieta, rConsulta, rMetas].concat(opcoes.treino ? [rTreino] : []);
  if (consultadas.every(r => !r.ok)) {
    cx.innerHTML = erroHtml();
    const b = cx.querySelector('#inRetry');
    if (b) b.addEventListener('click', () => renderInicioPaciente(alvo, bruto, opcoes));
    return;
  }

  const dados = montarDados({ ...bruto, ...(rTreino.valor || {}) });
  const plano = rPlano.ok ? rPlano.valor : null;
  const sem = rAgenda.ok ? rAgenda.valor : null;
  const agora = sem?.semanas?.[0]?.agora || `${bruto.hoje || ''}T${opcoes.agora ?? horaAgora()}`;
  const agenda = sem ? {
    aula: proximaAula(sem.semanas, agora),
    // Agendar só faz sentido com plano que tem agenda nesta semana.
    podeAgendar: Number(sem.semanas[0]?.limite) > 0,
    hoje: bruto.hoje || '',
  } : null;

  cx.innerHTML = inicioHtml({
    ...dados,
    // Dieta que falhou some (null seria "sem plano" — afirmação falsa); por
    // isso o card só diz "preparando" quando a busca respondeu vazio.
    dieta: rDieta.ok ? resumoDaDieta(rDieta.valor, opcoes.agora ?? horaAgora()) : 'falhou',
    consulta: formatarConsulta(rConsulta.valor, bruto.hoje || ''),
    metas: (rMetas.valor || []).map(formatarMeta).filter(Boolean),
    metaSemana: metaSemanal(rMetas.valor),
    documentos: rDocs.ok ? resumoParaInicio(rDocs.valor || []) : null,
    plano,
    agenda,
  });
  ligarAtalhos(cx, opcoes.ir);
}

// Cada fonte falha por si; o log fica (RPC que sumiu é problema real).
async function tentar(fn, rotulo) {
  try { return { ok: true, valor: await fn() }; }
  catch (e) { console.error(`Início · ${rotulo}:`, e); return { ok: false, valor: null }; }
}

/** Quando NENHUMA fonte respondeu, o problema é a conexão — não o plano. */
export function erroHtml() {
  return `
    <div class="inicio">
      <section class="pa-empty pa-empty-lg">
        ${ic('cloud-off')}
        <div class="pa-empty-t">Não foi possível carregar</div>
        <div class="pa-empty-s">Verifique sua conexão e tente novamente.</div>
        <button class="in-btn in-btn-pri" type="button" id="inRetry">${ic('rotate-cw')} Tentar novamente</button>
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
