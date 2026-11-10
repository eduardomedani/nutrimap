// ═══════════════════════════════════════════════════════════
// AGENDA DE TREINO — tela do aluno
// ═══════════════════════════════════════════════════════════
// Dois modos:
//   Dia — um dia por vez; desliza para o lado e vai para o dia seguinte.
//         Uma faixa da semana em cima mostra onde ele está e onde treina.
//   Mês — calendário com uma bolinha nos dias em que ele tem treino. Tocar
//         num dia abre esse dia.
//
// O saldo da semana é a frequência do plano — desmarcar devolve 1, reservar
// gasta 1 (o "crédito de reposição na mesma semana" da Next Fit, sem tabela
// de crédito).
//
// "Só dentro do tempo contratado" não é filtro da tela: o banco só diz que um
// horário é do aluno (`meu`) nas datas em que a assinatura está vigente
// (agenda__situacao → agenda__vigente). Depois do fim do contrato, nenhuma
// bolinha — sem a tela precisar saber a data de fim.
//
// As funções exportadas são PURAS (test/pwa-agenda.test.mjs): só decidem o
// que MOSTRAR. Quem aceita ou recusa é o servidor.

import { semanaDaAgenda, reservarHorario, desmarcarHorario } from './pwa-agenda-data.js';
import { mostrarToast, confirmar } from './utils.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const INICIAL = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Datas e horas da grade são locais (Brasília) e vêm "nuas" (sem fuso); o
// "agora" vem do servidor no mesmo formato. Comparar como texto ISO evita o
// navegador converter fuso no meio do caminho.
const iso = (data, hora) => `${data}T${String(hora).slice(0, 5)}`;
const p2 = n => String(n).padStart(2, '0');
const isoDe = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const somaDias = (data, n) => { const d = new Date(data + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDe(d); };
const menosHoras = (quando, h) => { const d = new Date(quando + ':00'); d.setMinutes(d.getMinutes() - Math.round(h * 60)); return `${isoDe(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const diaDaSemana = data => new Date(data + 'T12:00:00').getDay();

/**
 * O que mostrar num horário:
 *   'passou' · 'desmarcar' · 'prazo' (é seu, mas o prazo para desmarcar
 *   acabou) · 'voltar' (era seu fixo, desmarcado; pode voltar) · 'reservar' ·
 *   'lotado' · 'abre' (fora da janela) · 'sem_plano' (nenhum plano com
 *   agenda vigente) · 'sem_saldo' (já usou os treinos da semana)
 */
export function estadoDoHorario(h, ctx) {
  const agora = String(ctx.agora).slice(0, 16);
  const inicio = iso(h.data, h.hora);
  if (inicio <= agora) return 'passou';
  if (h.meu === 'fixo' || h.meu === 'reserva') {
    return agora <= menosHoras(inicio, ctx.cancela_horas_antes ?? 1) ? 'desmarcar' : 'prazo';
  }
  if (h.ocupados >= h.capacidade) return 'lotado';
  if (h.data > somaDias(agora.slice(0, 10), ctx.abre_dias_antes ?? 2)) return 'abre';
  // Sem plano não é 'semana completa': dizer isso a quem nem tem plano engana.
  if (!(Number(ctx.limite) > 0)) return 'sem_plano';
  if ((ctx.usados ?? 0) >= ctx.limite) return 'sem_saldo';
  return h.meu === 'desmarcado' ? 'voltar' : 'reservar';
}

/**
 * O que vale mostrar: horário encerrado some, a não ser que fosse do aluno
 * (fica como registro do que ele treinou).
 */
export function horariosVisiveis(horarios = [], ctx) {
  return horarios.filter(h => h.meu === 'fixo' || h.meu === 'reserva' || estadoDoHorario(h, ctx) !== 'passou');
}

/** Horários agrupados por dia, só os dias que têm horário. */
export function agruparPorDia(horarios = []) {
  const dias = new Map();
  for (const h of horarios) {
    if (!dias.has(h.data)) dias.set(h.data, []);
    dias.get(h.data).push(h);
  }
  return [...dias.entries()].map(([data, lista]) => ({ data, lista }));
}

/** Segunda-feira da semana que contém `data` (a semana do banco é seg–dom). */
export function inicioDaSemana(data) {
  return somaDias(data, -((diaDaSemana(data) + 6) % 7));
}

/**
 * A marca de cada dia: 'treino' se ele tem fixo ou reserva naquele dia;
 * 'desmarcado' se o único horário dele ali foi desmarcado. Dia sem marca não
 * entra no mapa.
 */
export function marcasDosDias(horarios = []) {
  const m = new Map();
  for (const h of horarios) {
    if (h.meu === 'fixo' || h.meu === 'reserva') m.set(h.data, 'treino');
    else if (h.meu === 'desmarcado' && !m.has(h.data)) m.set(h.data, 'desmarcado');
  }
  return m;
}

/**
 * As casas do calendário de um mês (mes 1–12), de segunda a domingo, com os
 * dias do mês vizinho completando a primeira e a última semana.
 */
export function casasDoMes(ano, mes) {
  const primeiro = `${ano}-${p2(mes)}-01`;
  const ultimo = isoDe(new Date(ano, mes, 0, 12));
  const ini = inicioDaSemana(primeiro);
  const fim = somaDias(inicioDaSemana(ultimo), 6);
  const casas = [];
  for (let d = ini; d <= fim; d = somaDias(d, 1)) casas.push({ data: d, doMes: d.slice(0, 7) === primeiro.slice(0, 7) });
  return casas;
}

/** Gesto horizontal: +1 (próximo dia), −1 (anterior) ou 0 (não foi deslize). */
export function sentidoDoDeslize(dx, dy) {
  if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

// ── formatação ─────────────────────────────────────────────
const fmtDia = data => { const d = new Date(data + 'T12:00:00'); return `${DIAS[d.getDay()]}, ${p2(d.getDate())}/${p2(d.getMonth() + 1)}`; };
const fmtDiaLongo = data => { const d = new Date(data + 'T12:00:00'); return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`; };
const fmtFim = (hora, min) => { const [h, m] = hora.split(':').map(Number); const t = h * 60 + m + Number(min || 60); return `${p2(Math.floor(t / 60) % 24)}:${p2(t % 60)}`; };

function linhaHorario(h, ctx) {
  const est = estadoDoHorario(h, ctx);
  const vagas = Math.max(0, h.capacidade - h.ocupados);
  const selo = h.meu === 'fixo' ? '<span class="ag-selo ag-selo-fixo">Seu horário</span>'
    : h.meu === 'reserva' ? '<span class="ag-selo ag-selo-res">Reservado</span>'
    : h.meu === 'desmarcado' ? '<span class="ag-selo ag-selo-des">Desmarcado</span>' : '';
  const acao = {
    desmarcar: `<button type="button" class="ag-btn ag-btn-sec" data-ag="desmarcar">Desmarcar</button>`,
    reservar: `<button type="button" class="ag-btn" data-ag="reservar">Reservar</button>`,
    voltar: `<button type="button" class="ag-btn" data-ag="reservar">Voltar</button>`,
    prazo: `<span class="ag-info">Prazo para desmarcar encerrado</span>`,
    lotado: `<span class="ag-info">Lotado</span>`,
    abre: `<span class="ag-info">Abre ${ctx.abre_dias_antes ?? 2} dia(s) antes</span>`,
    sem_saldo: `<span class="ag-info">Semana completa</span>`,
    sem_plano: `<span class="ag-info">Sem plano</span>`,
    passou: '',
  }[est];
  const meu = h.meu === 'fixo' || h.meu === 'reserva';
  const vagasTxt = est === 'passou' ? 'Encerrado' : est === 'lotado' ? '' : `${vagas} vaga${vagas === 1 ? '' : 's'}`;
  return `<li class="ag-hor${meu ? ' ag-hor-meu' : ''}${est === 'passou' ? ' ag-hor-passou' : ''}" data-grade="${esc(h.grade_id)}" data-data="${esc(h.data)}">
      <div class="ag-hor-h"><b>${esc(h.hora)}</b><span>–${esc(fmtFim(h.hora, h.duracao_min))}</span></div>
      <div class="ag-hor-meio">${selo}${vagasTxt ? `<span class="ag-vagas">${vagasTxt}</span>` : ''}</div>
      <div class="ag-hor-acao">${acao}</div>
    </li>`;
}

const fechadaHtml = () => `<div class="pa-empty pa-empty-lg"><i data-lucide="calendar-off"></i>
  <div class="pa-empty-t">A agenda ainda não está aberta</div>
  <div class="pa-empty-s">Quando a academia liberar, seus horários aparecem aqui.</div></div>`;

const modosHtml = modo => `
  <div class="ag-modos" role="tablist" aria-label="Ver a agenda por">
    <button type="button" role="tab" class="ag-modo${modo === 'dia' ? ' ativo' : ''}" aria-selected="${modo === 'dia'}" data-modo="dia">Dia</button>
    <button type="button" role="tab" class="ag-modo${modo === 'mes' ? ' ativo' : ''}" aria-selected="${modo === 'mes'}" data-modo="mes">Mês</button>
  </div>`;

function diaHtml(s, dia, hoje, entrada) {
  const marcas = marcasDosDias(s.horarios);
  const saldo = Math.max(0, (s.limite ?? 0) - (s.usados ?? 0));
  const doDia = (s.horarios || []).filter(h => h.data === dia);
  const lista = horariosVisiveis(doDia, s);
  const resumo = s.limite
    ? `<div class="ag-resumo"><b>${s.usados} de ${s.limite}</b> treinos da semana${saldo ? ` · <span>${saldo} para marcar</span>` : ''}</div>`
    : `<div class="ag-resumo ag-resumo-alerta">Sem plano ativo com agenda nesta semana.</div>`;
  const faixa = [...Array(7)].map((_, i) => {
    const d = somaDias(s.semana, i);
    const marca = marcas.get(d);
    return `<button type="button" class="ag-fx${d === dia ? ' ativo' : ''}${d === hoje ? ' hoje' : ''}${d < hoje ? ' passado' : ''}" data-dia="${d}"
        aria-label="${esc(fmtDiaLongo(d))}${marca === 'treino' ? ', com treino' : ''}"${d === dia ? ' aria-current="date"' : ''}>
      <span>${INICIAL[diaDaSemana(d)]}</span><b>${Number(d.slice(8))}</b><i class="ag-ponto${marca ? ` ag-ponto-${marca}` : ''}"></i></button>`;
  }).join('');
  const vazio = doDia.length
    ? 'Os horários deste dia já passaram.'
    : 'A academia não tem horários neste dia.';
  return `
    ${modosHtml('dia')}
    <div class="ag-cab">
      <button type="button" class="ag-sem" data-passo="-1" aria-label="Dia anterior"><i data-lucide="chevron-left"></i></button>
      <div class="ag-cab-t"><h1>${esc(fmtDiaLongo(dia))}</h1>
        ${dia === hoje ? '<span>Hoje</span>' : '<button type="button" class="ag-hoje" data-dia="' + hoje + '">Voltar para hoje</button>'}</div>
      <button type="button" class="ag-sem" data-passo="1" aria-label="Próximo dia"><i data-lucide="chevron-right"></i></button>
    </div>
    <div class="ag-faixa">${faixa}</div>
    ${resumo}
    <div class="ag-corpo ${entrada ? 'ag-entra-' + entrada : ''}" data-desliza>
      ${lista.length ? `<ul class="ag-lista">${lista.map(h => linhaHorario(h, s)).join('')}</ul>`
        : `<div class="pa-empty"><div class="pa-empty-t">${vazio}</div></div>`}
    </div>
    <p class="ag-regra">A reserva abre ${s.abre_dias_antes} dia(s) antes. Dá para desmarcar até ${Number(s.cancela_horas_antes)} hora(s) antes do treino. Deslize para o lado para trocar de dia.</p>`;
}

function mesHtml(ano, mes, marcas, hoje, carregando) {
  const casas = casasDoMes(ano, mes);
  const cab = [1, 2, 3, 4, 5, 6, 0].map(d => `<span>${INICIAL[d]}</span>`).join('');
  const nTreinos = casas.filter(c => c.doMes && marcas.get(c.data) === 'treino').length;
  return `
    ${modosHtml('mes')}
    <div class="ag-cab">
      <button type="button" class="ag-sem" data-mes="-1" aria-label="Mês anterior"><i data-lucide="chevron-left"></i></button>
      <div class="ag-cab-t"><h1>${MESES[mes - 1][0].toUpperCase() + MESES[mes - 1].slice(1)} ${ano}</h1>
        <span>${carregando ? 'Carregando…' : `${nTreinos} dia${nTreinos === 1 ? '' : 's'} com treino`}</span></div>
      <button type="button" class="ag-sem" data-mes="1" aria-label="Próximo mês"><i data-lucide="chevron-right"></i></button>
    </div>
    <div class="ag-cal" data-desliza>
      <div class="ag-cal-cab" aria-hidden="true">${cab}</div>
      <div class="ag-cal-grade">
        ${casas.map(c => {
          const marca = marcas.get(c.data);
          return `<button type="button" class="ag-casa${c.doMes ? '' : ' fora'}${c.data === hoje ? ' hoje' : ''}${c.data < hoje ? ' passado' : ''}" data-dia="${c.data}"
            aria-label="${esc(fmtDiaLongo(c.data))}${marca === 'treino' ? ', com treino' : marca === 'desmarcado' ? ', treino desmarcado' : ''}">
            <b>${Number(c.data.slice(8))}</b><i class="ag-ponto${marca ? ` ag-ponto-${marca}` : ''}"></i></button>`;
        }).join('')}
      </div>
    </div>
    <div class="ag-legenda"><span><i class="ag-ponto ag-ponto-treino"></i> Treino marcado</span><span><i class="ag-ponto ag-ponto-desmarcado"></i> Desmarcado</span></div>
    <p class="ag-regra">Toque num dia para ver os horários. Os dias marcados vão até o fim do seu plano.</p>`;
}

/** Monta a tela no elemento `alvo` (id). */
export async function renderAgendaPaciente(alvo) {
  const el = document.getElementById(alvo);
  if (!el) return;

  const semanas = new Map();          // segunda-feira → resposta do banco
  let hoje = null, dia = null, modo = 'dia';
  let mesAno = null;                   // { ano, mes }
  let entrada = '';                    // 'dir' | 'esq': de que lado o dia novo entra

  const semana = async (data) => {
    const ini = inicioDaSemana(data);
    if (!semanas.has(ini)) semanas.set(ini, await semanaDaAgenda(ini));
    return semanas.get(ini);
  };

  const erro = e => {
    el.innerHTML = `<div class="pa-empty pa-empty-lg"><i data-lucide="cloud-off"></i>
      <div class="pa-empty-t">Não foi possível carregar a agenda</div><div class="pa-empty-s">${esc(e.message)}</div></div>`;
    window.renderIcons?.();
  };

  const desenharDia = async () => {
    let s;
    try { s = await semana(dia); } catch (e) { erro(e); return; }
    if (!s?.ativo) { el.innerHTML = fechadaHtml(); window.renderIcons?.(); return; }
    el.innerHTML = `<div class="ag">${diaHtml(s, dia, hoje, entrada)}</div>`;
    entrada = '';
    ligar();
  };

  const desenharMes = async () => {
    const { ano, mes } = mesAno;
    const casas = casasDoMes(ano, mes);
    const inis = [...new Set(casas.map(c => inicioDaSemana(c.data)))];
    const marcasJa = () => {
      const m = new Map();
      for (const i of inis) if (semanas.has(i)) for (const [k, v] of marcasDosDias(semanas.get(i).horarios)) m.set(k, v);
      return m;
    };
    const faltam = inis.filter(i => !semanas.has(i));
    el.innerHTML = `<div class="ag">${mesHtml(ano, mes, marcasJa(), hoje, faltam.length > 0)}</div>`;
    ligar();
    if (!faltam.length) return;
    try { await Promise.all(faltam.map(i => semana(i))); } catch (e) { erro(e); return; }
    if (modo === 'mes' && mesAno.ano === ano && mesAno.mes === mes) {
      el.innerHTML = `<div class="ag">${mesHtml(ano, mes, marcasJa(), hoje, false)}</div>`;
      ligar();
    }
  };

  const desenhar = () => (modo === 'dia' ? desenharDia() : desenharMes());

  const irPara = (novo) => {
    if (novo === dia) return;
    entrada = novo > dia ? 'dir' : 'esq';
    dia = novo;
    desenharDia();
  };

  function ligar() {
    window.renderIcons?.();
    el.querySelectorAll('[data-modo]').forEach(b => b.addEventListener('click', () => {
      modo = b.dataset.modo;
      if (modo === 'mes') mesAno = { ano: Number(dia.slice(0, 4)), mes: Number(dia.slice(5, 7)) };
      desenhar();
    }));
    el.querySelectorAll('[data-passo]').forEach(b => b.addEventListener('click', () => irPara(somaDias(dia, Number(b.dataset.passo)))));
    el.querySelectorAll('[data-dia]').forEach(b => b.addEventListener('click', () => {
      if (modo === 'mes') { modo = 'dia'; dia = b.dataset.dia; desenharDia(); }
      else irPara(b.dataset.dia);
    }));
    el.querySelectorAll('[data-mes]').forEach(b => b.addEventListener('click', () => {
      const d = new Date(mesAno.ano, mesAno.mes - 1 + Number(b.dataset.mes), 1);
      mesAno = { ano: d.getFullYear(), mes: d.getMonth() + 1 };
      desenharMes();
    }));

    // Deslizar: no Dia troca o dia; no Mês troca o mês.
    const area = el.querySelector('[data-desliza]');
    if (area) {
      let x0 = null, y0 = null;
      area.addEventListener('touchstart', e => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
      area.addEventListener('touchend', e => {
        if (x0 === null) return;
        const t = e.changedTouches[0];
        const s = sentidoDoDeslize(t.clientX - x0, t.clientY - y0);
        x0 = y0 = null;
        if (!s) return;
        if (modo === 'dia') irPara(somaDias(dia, s));
        else el.querySelector(`[data-mes="${s}"]`)?.click();
      }, { passive: true });
    }

    el.querySelectorAll('[data-ag]').forEach(b => b.addEventListener('click', async () => {
      const li = b.closest('.ag-hor');
      const { grade, data } = li.dataset;
      const hora = li.querySelector('.ag-hor-h b')?.textContent || '';
      if (b.dataset.ag === 'desmarcar' && !(await confirmar({
        titulo: 'Desmarcar treino',
        mensagem: `Desmarcar ${fmtDia(data)} às ${hora}? A vaga fica livre e você pode marcar outro dia desta semana.`,
        textoOk: 'Desmarcar',
      }))) return;
      b.disabled = true;
      try {
        if (b.dataset.ag === 'desmarcar') { await desmarcarHorario(grade, data); mostrarToast('Treino desmarcado'); }
        else { await reservarHorario(grade, data); mostrarToast(`Reservado: ${fmtDia(data)} às ${hora}`); }
      } catch (e) {
        mostrarToast(e.message);
      }
      semanas.delete(inicioDaSemana(data));   // vaga e saldo mudaram: relê a semana
      desenharDia();
    }));
  }

  el.innerHTML = `<div class="ag"><div class="pa-boot" style="min-height:40vh"><span class="pa-spin pa-spin-lg"></span></div></div>`;
  let s;
  try { s = await semanaDaAgenda(null); } catch (e) { erro(e); return; }
  if (!s?.ativo) { el.innerHTML = fechadaHtml(); window.renderIcons?.(); return; }
  semanas.set(s.semana, s);
  hoje = String(s.agora).slice(0, 10);
  dia = hoje;
  await desenharDia();
}
