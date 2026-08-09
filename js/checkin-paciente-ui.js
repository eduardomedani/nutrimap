// ═══════════════════════════════════════════════════════════
// CHECK-INS — a aba da ficha do paciente
// ═══════════════════════════════════════════════════════════
// Atribuições ativas e o histórico de ocorrências daquele paciente.
//
// "Gerar agora" chama a MESMA RPC do agendamento futuro
// (`materializar_ocorrencia_checkin`). Uma criação paralela aqui seria uma
// segunda definição de "o que é uma ocorrência", e as duas divergiriam no
// primeiro ajuste de snapshot.

import {
  listarAtribuicoes, listarOcorrencias, listarModelos, criarAtribuicao,
  desativarAtribuicao, materializarOcorrencia, respostasDaOcorrencia,
  ultimosRespondidos, prazoDaOcorrencia,
} from './checkin-data.js';
import {
  FREQUENCIAS, calcularProximaOcorrencia, validarAtribuicao,
  situacaoDaOcorrencia, SITUACAO_ROTULO, traduzirErroCheckin,
} from './checkin.js';
import { FREQ_ROTULO, AJUDA_DIA_MES } from './checkin-modelo-drawer.js';
import { abrirRespostas, dataBR, dataHoraBR } from './checkin-respostas-ui.js';
import { mostrarToast, mostrarErro } from './utils.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

/** "Semanal · Toda segunda-feira" — a recorrência em português. */
export function recorrenciaTexto(a) {
  if (a.frequencia === 'manual') return 'Manual · sem data automática';
  if (a.frequencia === 'mensal') return `Mensal · Todo dia ${a.dia_mes}`;
  const dia = DIAS[a.dia_semana] || '';
  return `${FREQ_ROTULO[a.frequencia] || a.frequencia} · Toda ${dia.toLowerCase()}`;
}

// ───────────────────────────────────────────────────────────
// MARCAÇÃO
// ───────────────────────────────────────────────────────────

export function atribuicaoHtml(a) {
  return `
    <div class="ck-atr ${a.ativo ? '' : 'inativa'}" data-atr="${esc(a.id)}">
      <div class="ck-atr-txt">
        <div class="ck-atr-nome">${esc(a.modelo?.nome || 'Modelo')}</div>
        <div class="ck-atr-meta">
          <span>${esc(recorrenciaTexto(a))}</span>
          ${a.proxima_ocorrencia_em ? `<span class="sep">·</span><span>Próximo ${esc(dataBR(a.proxima_ocorrencia_em))}</span>` : ''}
          <span class="ck-badge ${a.ativo ? 'ck-s-disponivel' : 'ck-s-cancelado'}">
            ${a.ativo ? 'Ativo' : 'Inativo'}
          </span>
        </div>
      </div>
      <div class="ck-atr-acoes">
        ${a.ativo ? `
          <button class="btn-sm btn-sm-secondary" data-gerar="${esc(a.id)}">Gerar agora</button>
          <button class="ck-link ck-link-sutil" data-desativar-atr="${esc(a.id)}">Desativar</button>`
        : ''}
      </div>
    </div>`;
}

export function ocorrenciaHtml(o) {
  const sit = situacaoDaOcorrencia(o);
  return `
    <div class="ck-oc" data-oc="${esc(o.id)}">
      <div class="ck-oc-txt">
        <div class="ck-oc-modelo">${esc(o.snapshot?.modelo?.nome || 'Check-in')}</div>
        <div class="ck-oc-meta">
          <span>${esc(dataBR(o.periodo || o.disponivel_em))}</span>
          <span class="ck-badge ck-s-${esc(sit)}">${esc(SITUACAO_ROTULO[sit] || sit)}</span>
          ${o.respondido_em ? `<span>Respondido em ${esc(dataHoraBR(o.respondido_em))}</span>` : ''}
          ${sit === 'atrasado' && o.prazo_em ? `<span class="ck-atraso">Prazo ${esc(dataBR(o.prazo_em))}</span>` : ''}
        </div>
      </div>
      <button class="btn-sm btn-sm-secondary" data-ver="${esc(o.id)}">
        ${o.status === 'respondido' ? 'Ver respostas' : 'Ver'}
      </button>
    </div>`;
}

export function vazioHtml() {
  return `
    <div class="ck-vazio">
      <i data-lucide="clipboard-check"></i>
      <div class="ck-vazio-t">Nenhum check-in atribuído.</div>
      <div class="ck-vazio-s">Use um check-in para acompanhar evolução, adesão e bem-estar entre as consultas.</div>
      <button class="btn-sm" data-atribuir>Atribuir check-in</button>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// DRAWER DE ATRIBUIÇÃO
// ───────────────────────────────────────────────────────────

export function drawerAtribuirHtml(modelos, form, erros = {}) {
  const f = FREQUENCIAS[form.frequencia] || {};
  return `
    <div class="ck-drawer-raiz" data-raiz>
      <div class="ck-drawer" role="dialog" aria-modal="true" aria-label="Atribuir check-in">
        <div class="ck-drawer-topo">
          <h2>Atribuir check-in</h2>
          <button type="button" class="ck-drawer-x" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
        </div>
        <div class="ck-drawer-corpo">
          <div class="ck-campo${erros.modelo ? ' invalido' : ''}">
            <label for="ckaModelo">Modelo <span class="req">*</span></label>
            <select id="ckaModelo" data-modelo>
              <option value="">Escolha o modelo…</option>
              ${modelos.map(m => `<option value="${esc(m.id)}"${m.id === form.modeloId ? ' selected' : ''}>${esc(m.nome)}</option>`).join('')}
            </select>
            ${erros.modelo ? `<div class="ck-erro">${esc(erros.modelo)}</div>` : ''}
          </div>

          <div class="ck-campo-2">
            <div class="ck-campo">
              <label for="ckaFreq">Frequência</label>
              <select id="ckaFreq" data-frequencia>
                ${Object.keys(FREQUENCIAS).map(k =>
                  `<option value="${k}"${k === form.frequencia ? ' selected' : ''}>${esc(FREQ_ROTULO[k])}</option>`).join('')}
              </select>
            </div>
            <div class="ck-campo">
              <label for="ckaInicio">Data de início</label>
              <input id="ckaInicio" type="date" data-inicio value="${esc(form.dataInicio)}">
            </div>
          </div>

          ${f.exige === 'dia_semana' ? `
            <div class="ck-campo${erros.dia ? ' invalido' : ''}">
              <label for="ckaDiaSemana">Dia da semana <span class="req">*</span></label>
              <select id="ckaDiaSemana" data-dia-semana>
                <option value="">Escolha…</option>
                ${DIAS.map((d, i) => `<option value="${i}"${String(form.diaSemana) === String(i) ? ' selected' : ''}>${esc(d)}</option>`).join('')}
              </select>
              ${erros.dia ? `<div class="ck-erro">${esc(erros.dia)}</div>` : ''}
            </div>` : ''}

          ${f.exige === 'dia_mes' ? `
            <div class="ck-campo${erros.dia ? ' invalido' : ''}">
              <label for="ckaDiaMes">Dia do mês <span class="req">*</span></label>
              <input id="ckaDiaMes" type="number" min="1" max="31" data-dia-mes value="${esc(form.diaMes ?? '')}">
              <!-- A regra do 29/30/31 fica à vista de quem escolhe, não
                   escondida no código. -->
              <div class="ck-ajuda">${esc(AJUDA_DIA_MES)}</div>
              ${erros.dia ? `<div class="ck-erro">${esc(erros.dia)}</div>` : ''}
            </div>` : ''}

          ${form.frequencia === 'manual' ? `
            <p class="ck-ajuda">Sem data automática. Você gera cada check-in quando quiser, pelo botão <b>Gerar agora</b>.</p>` : ''}

          <div class="ck-previa" data-previa></div>
        </div>
        <div class="ck-drawer-pe">
          <button type="button" class="btn-sm btn-sm-secondary" data-fechar>Cancelar</button>
          <button type="button" class="btn-sm" data-salvar>Atribuir</button>
        </div>
      </div>
    </div>`;
}

/** A prévia da próxima data — reusa a regra do domínio, sem recalcular nada. */
export function previaHtml(form) {
  const prox = calcularProximaOcorrencia(
    { frequencia: form.frequencia, dia_semana: form.diaSemana, dia_mes: form.diaMes },
    form.dataInicio);
  if (!prox) return form.frequencia === 'manual' ? '' : '';
  return `<div class="ck-previa-txt"><b>Próximo check-in:</b> ${esc(dataBR(prox))}</div>`;
}

export function abrirAtribuirDrawer({ pacienteId, modelos, aoSalvar }) {
  const hoje = new Date().toISOString().slice(0, 10);
  let form = { modeloId: '', frequencia: 'semanal', dataInicio: hoje, diaSemana: '', diaMes: '' };
  let salvando = false;

  const el = document.createElement('div');
  document.body.appendChild(el);
  const fechar = () => { document.removeEventListener('keydown', onKey); el.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', onKey);

  function coletar() {
    form.modeloId = el.querySelector('[data-modelo]')?.value || '';
    form.frequencia = el.querySelector('[data-frequencia]')?.value || 'semanal';
    form.dataInicio = el.querySelector('[data-inicio]')?.value || hoje;
    const ds = el.querySelector('[data-dia-semana]')?.value;
    const dm = el.querySelector('[data-dia-mes]')?.value;
    form.diaSemana = ds === '' || ds === undefined ? null : Number(ds);
    form.diaMes = dm === '' || dm === undefined ? null : Number(dm);
  }

  function desenhar(erros = {}) {
    el.innerHTML = drawerAtribuirHtml(modelos, form, erros);
    window.lucide?.createIcons?.();
    const p = el.querySelector('[data-previa]');
    if (p) p.innerHTML = previaHtml(form);
    ligar();
  }

  function ligar() {
    el.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', fechar));
    el.firstElementChild?.addEventListener('click', e => { if (e.target === el.firstElementChild) fechar(); });
    // Trocar a frequência troca os campos que ela exige.
    el.querySelector('[data-frequencia]')?.addEventListener('change', () => {
      coletar(); form.diaSemana = null; form.diaMes = null; desenhar();
    });
    ['[data-dia-semana]', '[data-dia-mes]', '[data-inicio]'].forEach(s =>
      el.querySelector(s)?.addEventListener('change', () => {
        coletar();
        const p = el.querySelector('[data-previa]');
        if (p) p.innerHTML = previaHtml(form);
      }));

    el.querySelector('[data-salvar]')?.addEventListener('click', async () => {
      if (salvando) return;
      coletar();
      const erros = {};
      if (!form.modeloId) erros.modelo = 'Escolha o modelo.';
      // A coerência da frequência vem do domínio — não é reescrita aqui.
      const v = validarAtribuicao({ frequencia: form.frequencia, dia_semana: form.diaSemana, dia_mes: form.diaMes });
      if (!v.ok) erros.dia = v.erros[0];
      if (Object.keys(erros).length) { desenhar(erros); return; }

      salvando = true;
      try {
        await criarAtribuicao({
          pacienteId, modeloId: form.modeloId, frequencia: form.frequencia,
          dataInicio: form.dataInicio, diaSemana: form.diaSemana, diaMes: form.diaMes,
        });
        mostrarToast('Check-in atribuído.');
        fechar();
        aoSalvar?.();
      } catch (e) {
        console.error('[check-in] atribuir', e);
        mostrarErro(traduzirErroCheckin(e?.message));
        salvando = false;
      }
    });
  }

  desenhar();
  return { fechar, el };
}

// ───────────────────────────────────────────────────────────
// A ABA
// ───────────────────────────────────────────────────────────

export async function initCheckinsPaciente({ cont, paciente }) {
  const alvo = typeof cont === 'string' ? document.getElementById(cont) : cont;
  if (!alvo) return;

  alvo.innerHTML = `<div class="ck"><div class="ck-lista">${'<div class="ck-sk"></div>'.repeat(3)}</div></div>`;

  async function carregar() {
    try {
      const [atrs, ocs, modelos] = await Promise.all([
        listarAtribuicoes({ pacienteId: paciente.id, incluirInativas: true }),
        listarOcorrencias({ pacienteId: paciente.id }),
        listarModelos(),
      ]);

      const ativas = atrs.filter(a => a.ativo);
      alvo.innerHTML = `
        <div class="ck">
          <div class="ck-head">
            <div>
              <h2>Check-ins</h2>
              <p class="ck-sub">Acompanhamento entre as consultas.</p>
            </div>
            ${ativas.length || atrs.length ? '<button class="btn-sm" data-atribuir><i data-lucide="plus"></i> Atribuir check-in</button>' : ''}
          </div>
          ${atrs.length
            ? `<div class="ck-lista">${atrs.map(atribuicaoHtml).join('')}</div>`
            : vazioHtml()}
          ${ocs.length ? `
            <h3 class="ck-secao">Histórico</h3>
            <div class="ck-lista">${ocs.map(ocorrenciaHtml).join('')}</div>` : ''}
        </div>`;
      window.lucide?.createIcons?.();
      ligar(modelos, ocs);
    } catch (e) {
      console.error('[check-in] ficha', e);
      alvo.innerHTML = `<div class="ck"><div class="ck-vazio">
        <div class="ck-vazio-t">${esc(traduzirErroCheckin(e?.message))}</div>
        <button class="btn-sm" data-retry>Tentar novamente</button></div></div>`;
      alvo.querySelector('[data-retry]')?.addEventListener('click', carregar);
    }
  }

  function ligar(modelos, ocs) {
    alvo.querySelectorAll('[data-atribuir]').forEach(b =>
      b.addEventListener('click', () =>
        abrirAtribuirDrawer({ pacienteId: paciente.id, modelos, aoSalvar: carregar })));

    alvo.querySelectorAll('[data-desativar-atr]').forEach(b =>
      b.addEventListener('click', async () => {
        if (!confirm('Desativar este check-in?\n\nO histórico é preservado: as respostas e os check-ins já criados continuam. O que muda é que não nascem novos.')) return;
        try { await desativarAtribuicao(b.dataset.desativarAtr); mostrarToast('Check-in desativado.'); carregar(); }
        catch (e) { mostrarErro(traduzirErroCheckin(e?.message)); }
      }));

    // Gerar agora: a MESMA RPC do agendamento futuro. Chamar duas vezes para o
    // mesmo período devolve a ocorrência existente, sem duplicar.
    alvo.querySelectorAll('[data-gerar]').forEach(b =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const atrs = await listarAtribuicoes({ pacienteId: paciente.id });
          const a = atrs.find(x => x.id === b.dataset.gerar);
          if (!a) return;
          const periodo = a.proxima_ocorrencia_em || new Date().toISOString().slice(0, 10);
          const antes = await listarOcorrencias({ pacienteId: paciente.id });
          const oc = await materializarOcorrencia({
            atribuicaoId: a.id, periodo,
            disponivelEm: new Date().toISOString(),
            prazoEm: prazoDaOcorrencia(a, periodo),
          });
          const jaExistia = antes.some(x => x.id === oc?.id);
          mostrarToast(jaExistia
            ? 'Este check-in já existia para o período.'
            : `Check-in criado. Disponível agora${oc?.prazo_em ? ` · prazo ${dataBR(oc.prazo_em)}` : ''}.`);
          await carregar();
        } catch (e) {
          console.error('[check-in] gerar', e);
          mostrarErro(traduzirErroCheckin(e?.message));
        } finally { b.disabled = false; }
      }));

    alvo.querySelectorAll('[data-ver]').forEach(b =>
      b.addEventListener('click', () => {
        const o = ocs.find(x => x.id === b.dataset.ver);
        if (o) abrirRespostas({ ocorrencia: o, carregar: carregarRespostasDaFicha });
      }));
  }

  await carregar();
}

/** Igual à da tela global: snapshot + respostas, nunca a pergunta de hoje. */
async function carregarRespostasDaFicha(oc) {
  const respostas = await respostasDaOcorrencia(oc.id);
  let anteriores = [];
  try {
    const ultimas = await ultimosRespondidos(oc.paciente_id, 5);
    const anterior = ultimas.find(u => u.id !== oc.id && u.modelo_id === oc.modelo_id);
    if (anterior) anteriores = await respostasDaOcorrencia(anterior.id);
  } catch (e) { /* comparação é bônus */ }
  return { respostas, anteriores };
}
