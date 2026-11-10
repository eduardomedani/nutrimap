// ═══════════════════════════════════════════════════════════
// AGENDA DE TREINO — a tela do painel
// ═══════════════════════════════════════════════════════════
// Três abas, na ordem do dia a dia da recepção:
//   Semana — quem está em cada horário; marcar e desmarcar por um aluno.
//   Grade  — os horários de segunda a domingo e as vagas de cada um.
//   Regras — liga a agenda para os alunos e define os prazos do app.
//
// A agenda nasce DESLIGADA para os alunos (mês em paralelo com a Next Fit):
// a recepção já usa a semana e a grade; o app só mostra com "Visível".

import * as dados from './agenda-treino-data.js';
import { pode } from './permissoes.js';
import { mostrarToast, mostrarErro, confirmar } from './utils.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const alvo = () => document.getElementById('page-agenda-treino');

// Segunda primeiro, domingo por último; o número é o extract(dow) do banco.
export const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];
export const NOME_DIA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const CURTO_DIA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const minutos = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
const hora = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Os horários que o gerador cria: em cada dia escolhido, de `de` em diante a
 * cada `duracao`, sem passar de `ate` (a última aula TERMINA até `ate`).
 */
export function montarGrade({ dias = [], de, ate, duracao = 60, capacidade = 9, modalidade = 'Musculação' }) {
  const ini = minutos(de), fim = minutos(ate), passo = Number(duracao);
  if (!dias.length || !(passo >= 10) || !(fim > ini)) return [];
  const linhas = [];
  for (const dia of ORDEM_DIAS.filter(d => dias.includes(d))) {
    for (let t = ini; t + passo <= fim; t += passo) {
      linhas.push({ dia_semana: dia, hora_inicio: hora(t), duracao_min: passo, capacidade: Number(capacidade), modalidade: String(modalidade || 'Musculação').trim() });
    }
  }
  return linhas;
}

export const ROTULO_ORIGEM = { fixo: 'Fixo', app: 'Pelo app', recepcao: 'Recepção' };

const somaDias = (data, n) => { const d = new Date(data + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const ddmm = data => data.slice(8, 10) + '/' + data.slice(5, 7);
const fimDe = (h, dur) => hora(minutos(h) + Number(dur || 60));

// ── estado da tela ─────────────────────────────────────────
let _aba = 'semana';
let _inicio = null;          // segunda-feira da semana na tela (null = a atual)
let _semana = null;          // resposta de agenda_painel_semana
let _aberto = null;          // `${grade_id}|${data}` do horário com a lista aberta
let _grade = [];
let _regras = dados.REGRAS_PADRAO;
let _alunos = null;          // carregados na primeira marcação
let _editando = null;        // id do horário da grade em edição

export async function abrirAgendaTreino() {
  const el = alvo(); if (!el) return;
  el.innerHTML = '<div class="agt-carregando">Carregando a agenda…</div>';
  try {
    [_regras, _grade] = await Promise.all([dados.lerRegras(), dados.listarGrade()]);
    if (_aba === 'semana') _semana = await dados.semanaDoPainel(_inicio);
  } catch (e) {
    el.innerHTML = `<div class="agt-vazio">${esc(e.message)}</div>`;
    return;
  }
  desenhar();
}

function desenhar() {
  const el = alvo(); if (!el) return;
  const corpo = _aba === 'semana' ? semanaHtml() : _aba === 'grade' ? gradeHtml() : regrasHtml();
  el.innerHTML = `
    <div class="agt">
      <div class="agt-topo">
        <div>
          <h2>Agenda de treino</h2>
          <p class="agt-sub">Horários da academia, vagas e quem treina em cada um.</p>
        </div>
        <span class="agt-status ${_regras.ativo ? 'agt-status-on' : ''}">
          <i data-lucide="${_regras.ativo ? 'eye' : 'eye-off'}"></i>
          ${_regras.ativo ? 'Visível para os alunos' : 'Em teste: os alunos ainda não veem'}
        </span>
      </div>
      <div class="agt-abas" role="tablist">
        ${[['semana', 'Semana'], ['grade', 'Grade de horários'], ['regras', 'Regras']].map(([k, r]) =>
          `<button type="button" role="tab" class="agt-aba${_aba === k ? ' ativa' : ''}" aria-selected="${_aba === k}" data-aba="${k}">${r}</button>`).join('')}
      </div>
      ${corpo}
    </div>`;
  ligar(el);
  window.renderIcons?.();
}

// ── Semana ─────────────────────────────────────────────────
function semanaHtml() {
  const s = _semana;
  if (!s) return '<div class="agt-carregando">Carregando…</div>';
  if (!_grade.some(g => g.ativo)) {
    return `<div class="agt-vazio"><i data-lucide="calendar-plus"></i>
      <p>Nenhum horário na grade ainda.</p>
      ${pode('agenda.editar') ? '<button type="button" class="agt-btn agt-btn-pri" data-aba="grade">Montar a grade</button>' : ''}</div>`;
  }
  const porDia = new Map();
  for (const h of s.horarios || []) { if (!porDia.has(h.data)) porDia.set(h.data, []); porDia.get(h.data).push(h); }
  const fim = somaDias(s.semana, 6);
  const dias = [...Array(7)].map((_, i) => somaDias(s.semana, i));
  const editar = pode('agenda.editar');
  return `
    <div class="agt-semana-nav">
      <button type="button" class="agt-btn-icone" data-semana="-7" aria-label="Semana anterior"><i data-lucide="chevron-left"></i></button>
      <b>${ddmm(s.semana)} a ${ddmm(fim)}</b>
      <button type="button" class="agt-btn-icone" data-semana="7" aria-label="Próxima semana"><i data-lucide="chevron-right"></i></button>
      ${_inicio ? '<button type="button" class="agt-btn agt-btn-sec" data-semana="0">Esta semana</button>' : ''}
    </div>
    ${dias.map(data => {
      const lista = porDia.get(data) || [];
      if (!lista.length) return '';
      const dow = new Date(data + 'T12:00:00').getDay();
      const aberto = lista.find(h => `${h.grade_id}|${h.data}` === _aberto);
      return `
        <section class="agt-dia">
          <h3>${NOME_DIA[dow]} <span>${ddmm(data)}</span></h3>
          <div class="agt-slots">
            ${lista.map(h => {
              const cheio = h.ocupados >= h.capacidade;
              const chave = `${h.grade_id}|${h.data}`;
              return `<button type="button" class="agt-slot${cheio ? ' cheio' : ''}${chave === _aberto ? ' aberto' : ''}" data-slot="${esc(chave)}" aria-expanded="${chave === _aberto}">
                <b>${esc(h.hora)}</b>
                <span>${h.ocupados}/${h.capacidade}</span>
                <i class="agt-ocup" style="--agt-ocup:${Math.min(1, h.ocupados / h.capacidade)}"></i>
              </button>`;
            }).join('')}
          </div>
          ${aberto ? detalheHtml(aberto, editar) : ''}
        </section>`;
    }).join('')}`;
}

function detalheHtml(h, editar) {
  const alunos = h.alunos || [];
  const desm = h.desmarcados || [];
  const vagas = h.capacidade - h.ocupados;
  return `
    <div class="agt-detalhe">
      <div class="agt-detalhe-topo">
        <b>${esc(h.hora)}–${fimDe(h.hora, h.duracao_min)} · ${esc(h.modalidade)}</b>
        <span>${vagas > 0 ? `${vagas} vaga(s)` : 'Lotado'}</span>
      </div>
      ${alunos.length ? `<ul class="agt-lista">${alunos.map(a => `
        <li><span class="agt-nome">${esc(a.nome)}</span>
          <span class="agt-tag agt-tag-${esc(a.origem)}">${ROTULO_ORIGEM[a.origem] || esc(a.origem)}</span>
          ${editar ? `<button type="button" class="agt-btn agt-btn-sec" data-desmarcar="${esc(a.paciente_id)}" data-nome="${esc(a.nome)}" data-origem="${esc(a.origem)}">Desmarcar</button>` : ''}</li>`).join('')}</ul>`
        : '<p class="agt-nada">Ninguém neste horário.</p>'}
      ${desm.length ? `<p class="agt-rot">Desmarcaram</p><ul class="agt-lista agt-lista-desm">${desm.map(a => `
        <li><span class="agt-nome">${esc(a.nome)}</span>
          <span class="agt-tag">${ROTULO_ORIGEM[a.origem] || esc(a.origem)}</span>
          ${editar && vagas > 0 ? `<button type="button" class="agt-btn agt-btn-sec" data-marcar="${esc(a.paciente_id)}">Voltar</button>` : ''}</li>`).join('')}</ul>` : ''}
      ${editar && vagas > 0 ? `
        <form class="agt-marcar" data-form="marcar">
          <label for="agtAluno">Marcar aluno neste horário</label>
          <div class="agt-linha">
            <input id="agtAluno" list="agtAlunos" placeholder="Digite o nome" autocomplete="off">
            <datalist id="agtAlunos">${(_alunos || []).map(a => `<option value="${esc(a.nome)}"></option>`).join('')}</datalist>
            <button type="submit" class="agt-btn agt-btn-pri">Marcar</button>
          </div>
        </form>` : ''}
    </div>`;
}

// ── Grade ──────────────────────────────────────────────────
function gradeHtml() {
  const editar = pode('agenda.editar');
  const porDia = new Map(ORDEM_DIAS.map(d => [d, []]));
  for (const g of _grade) porDia.get(g.dia_semana)?.push(g);
  return `
    ${editar ? `
    <form class="agt-cartao agt-gerador" data-form="gerar">
      <h3>Gerar horários</h3>
      <p class="agt-ajuda">Escolha os dias e a faixa de funcionamento. Horários que já existem ficam como estão.</p>
      <fieldset class="agt-dias"><legend>Dias</legend>
        ${ORDEM_DIAS.map(d => `<label class="agt-dia-chk"><input type="checkbox" name="dia" value="${d}" ${d >= 1 && d <= 5 ? 'checked' : ''}><span>${CURTO_DIA[d]}</span></label>`).join('')}
      </fieldset>
      <div class="agt-campos">
        <label>Primeira aula<input type="time" name="de" value="06:00" step="900" required></label>
        <label>Última termina às<input type="time" name="ate" value="22:00" step="900" required></label>
        <label>Duração (min)<input type="number" name="duracao" value="60" min="10" max="240" step="5" required></label>
        <label>Vagas por horário<input type="number" name="capacidade" value="9" min="1" max="200" required></label>
        <label>Modalidade<input type="text" name="modalidade" value="Musculação" maxlength="40" required></label>
      </div>
      <div class="agt-linha agt-linha-fim">
        <span class="agt-previa" data-previa></span>
        <button type="submit" class="agt-btn agt-btn-pri">Criar horários</button>
      </div>
    </form>` : ''}
    ${!_grade.length ? '<div class="agt-vazio"><p>A grade está vazia.</p></div>' : `
    <div class="agt-cartao">
      <h3>Grade atual</h3>
      <p class="agt-ajuda">Toque num horário para mudar as vagas ou tirá-lo da agenda. Horário fora da agenda some para os alunos; quem é fixo nele continua no cadastro.</p>
      ${ORDEM_DIAS.map(d => {
        const lista = porDia.get(d);
        if (!lista.length) return '';
        return `<div class="agt-grade-dia"><b>${NOME_DIA[d]}</b><div class="agt-chips">
          ${lista.map(g => `<button type="button" class="agt-chip${g.ativo ? '' : ' off'}${_editando === g.id ? ' aberto' : ''}" ${editar ? `data-editar="${esc(g.id)}"` : 'disabled'}>
            ${esc(g.hora_inicio)} <span>${g.capacidade} vagas${g.ativo ? '' : ' · fora'}</span></button>`).join('')}
        </div>${lista.some(g => g.id === _editando) ? edicaoHtml(lista.find(g => g.id === _editando)) : ''}</div>`;
      }).join('')}
    </div>`}`;
}

function edicaoHtml(g) {
  return `<form class="agt-edicao" data-form="editar">
    <b>${NOME_DIA[g.dia_semana]} ${esc(g.hora_inicio)} · ${esc(g.modalidade)}</b>
    <label>Vagas<input type="number" name="capacidade" value="${g.capacidade}" min="1" max="200" required></label>
    <label class="agt-chk"><input type="checkbox" name="ativo" ${g.ativo ? 'checked' : ''}> Na agenda</label>
    <button type="submit" class="agt-btn agt-btn-pri">Salvar</button>
    <button type="button" class="agt-btn agt-btn-sec" data-cancelar-edicao>Cancelar</button>
  </form>`;
}

// ── Regras ─────────────────────────────────────────────────
function regrasHtml() {
  const r = _regras;
  const editar = pode('agenda.editar');
  const dis = editar ? '' : 'disabled';
  return `
    <form class="agt-cartao agt-regras" data-form="regras">
      <h3>Para os alunos</h3>
      <label class="agt-chk agt-chk-grande"><input type="checkbox" name="ativo" ${r.ativo ? 'checked' : ''} ${dis}>
        <span><b>Mostrar a agenda no app do aluno</b><br>
        Desligada, os alunos não veem a aba Agenda; a recepção continua usando esta tela normalmente.</span></label>
      <div class="agt-campos">
        <label>A reserva abre quantos dias antes<input type="number" name="abre" value="${r.abre_dias_antes}" min="0" max="30" ${dis} required></label>
        <label>Desmarcar até quantas horas antes<input type="number" name="cancela" value="${r.cancela_horas_antes}" min="0" max="72" step="0.5" ${dis} required></label>
      </div>
      <p class="agt-ajuda">O limite de treinos por semana vem da frequência do plano no Comercial: quem tem plano de 3 dias marca até 3 por semana, contando o horário fixo. A recepção pode marcar e desmarcar fora desses prazos, mas não passa da vaga nem do limite do plano.</p>
      ${editar ? '<div class="agt-linha agt-linha-fim"><button type="submit" class="agt-btn agt-btn-pri">Salvar regras</button></div>' : ''}
    </form>`;
}

// ── eventos ────────────────────────────────────────────────
function slotAberto() {
  if (!_aberto || !_semana) return null;
  return (_semana.horarios || []).find(h => `${h.grade_id}|${h.data}` === _aberto) || null;
}

async function recarregarSemana() {
  _semana = await dados.semanaDoPainel(_inicio);
  desenhar();
}

function ligar(el) {
  el.querySelectorAll('[data-aba]').forEach(b => b.addEventListener('click', async () => {
    _aba = b.dataset.aba; _editando = null;
    if (_aba === 'semana') { _semana = null; desenhar(); try { await recarregarSemana(); } catch (e) { mostrarErro(e.message); } }
    else desenhar();
  }));

  el.querySelectorAll('[data-semana]').forEach(b => b.addEventListener('click', async () => {
    const n = Number(b.dataset.semana);
    _inicio = n === 0 ? null : somaDias(_semana.semana, n);
    _aberto = null;
    try { await recarregarSemana(); } catch (e) { mostrarErro(e.message); }
  }));

  el.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', async () => {
    _aberto = _aberto === b.dataset.slot ? null : b.dataset.slot;
    if (_aberto && _alunos === null && pode('agenda.editar')) {
      try { _alunos = await dados.listarAlunos(); } catch (e) { _alunos = []; mostrarErro(e.message); }
    }
    desenhar();
  }));

  const acao = async (fn, ok) => {
    const h = slotAberto(); if (!h) return;
    try { await fn(h); mostrarToast(ok); await recarregarSemana(); }
    catch (e) { mostrarErro(e.message); }
  };

  el.querySelectorAll('[data-desmarcar]').forEach(b => b.addEventListener('click', async () => {
    const h = slotAberto(); if (!h) return;
    const sim = await confirmar({
      titulo: 'Desmarcar aluno',
      mensagem: `Tirar ${b.dataset.nome} de ${NOME_DIA[new Date(h.data + 'T12:00:00').getDay()]} ${ddmm(h.data)} às ${h.hora}?${b.dataset.origem === 'fixo' ? ' Vale só para este dia; o horário fixo continua.' : ' A reserva é cancelada e a vaga volta para a agenda.'}`,
      textoOk: 'Desmarcar',
    });
    if (sim) acao(x => dados.desmarcarPelaRecepcao(b.dataset.desmarcar, x.grade_id, x.data), 'Desmarcado.');
  }));

  el.querySelectorAll('[data-marcar]').forEach(b => b.addEventListener('click', () =>
    acao(x => dados.marcarPelaRecepcao(b.dataset.marcar, x.grade_id, x.data), 'Marcado de volta.')));

  el.querySelector('[data-form="marcar"]')?.addEventListener('submit', ev => {
    ev.preventDefault();
    const nome = el.querySelector('#agtAluno').value.trim().toLowerCase();
    const achados = (_alunos || []).filter(a => String(a.nome).trim().toLowerCase() === nome);
    if (achados.length !== 1) { mostrarErro(achados.length ? 'Há mais de um aluno com esse nome.' : 'Escolha um aluno da lista.'); return; }
    acao(x => dados.marcarPelaRecepcao(achados[0].id, x.grade_id, x.data), 'Aluno marcado.');
  });

  // Gerador: prévia ao vivo e criação.
  const gerar = el.querySelector('[data-form="gerar"]');
  if (gerar) {
    const ler = () => ({
      dias: [...gerar.querySelectorAll('input[name="dia"]:checked')].map(i => Number(i.value)),
      de: gerar.de.value, ate: gerar.ate.value, duracao: gerar.duracao.value,
      capacidade: gerar.capacidade.value, modalidade: gerar.modalidade.value,
    });
    const previa = () => {
      const n = montarGrade(ler()).length;
      gerar.querySelector('[data-previa]').textContent = n ? `${n} horário(s) na semana` : 'Nenhum horário com essas escolhas';
    };
    gerar.addEventListener('input', previa); previa();
    gerar.addEventListener('submit', async ev => {
      ev.preventDefault();
      const linhas = montarGrade(ler());
      if (!linhas.length) { mostrarErro('Escolha ao menos um dia e uma faixa que caiba uma aula.'); return; }
      try {
        const n = await dados.criarHorarios(linhas);
        _grade = await dados.listarGrade();
        mostrarToast(n === linhas.length ? `${n} horário(s) criados.` : `${n} criado(s); ${linhas.length - n} já existiam.`, 3500);
        desenhar();
      } catch (e) { mostrarErro(e.message); }
    });
  }

  el.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', () => {
    _editando = _editando === b.dataset.editar ? null : b.dataset.editar; desenhar();
  }));
  el.querySelector('[data-cancelar-edicao]')?.addEventListener('click', () => { _editando = null; desenhar(); });
  el.querySelector('[data-form="editar"]')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.currentTarget;
    try {
      await dados.alterarHorario(_editando, { capacidade: Number(f.capacidade.value), ativo: f.ativo.checked });
      _grade = await dados.listarGrade(); _editando = null;
      mostrarToast('Horário atualizado.'); desenhar();
    } catch (e) { mostrarErro(e.message); }
  });

  el.querySelector('[data-form="regras"]')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const nova = { ativo: f.ativo.checked, abre_dias_antes: Number(f.abre.value), cancela_horas_antes: Number(f.cancela.value) };
    if (nova.ativo && !_regras.ativo && !(await confirmar({
      titulo: 'Mostrar a agenda aos alunos',
      mensagem: 'A aba Agenda aparece no app de todos os alunos com plano ativo, e eles passam a poder desmarcar e reservar horários. Continuar?',
      textoOk: 'Mostrar',
    }))) return;
    try { await dados.salvarRegras(nova); _regras = nova; mostrarToast('Regras salvas.'); desenhar(); }
    catch (e) { mostrarErro(e.message); }
  });
}
