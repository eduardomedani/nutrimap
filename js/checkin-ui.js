// ═══════════════════════════════════════════════════════════
// CHECK-INS — a tela global (menu Análise)
// ═══════════════════════════════════════════════════════════
// Três abas, e só: Visão geral, Modelos, Respostas.
//
// A Visão geral é OPERAÇÃO, não painel decorativo: quem está aguardando, quem
// atrasou, quem nem tem check-in. Gráfico bonito que não muda o que o
// profissional vai fazer hoje é espaço gasto.

import { panoramaCheckins, listarOcorrenciasGlobais, listarModelos, respostasDaOcorrencia, ultimosRespondidos } from './checkin-data.js';
import { situacaoDaOcorrencia, SITUACAO_ROTULO, traduzirErroCheckin } from './checkin.js';
import { renderModelos } from './checkin-modelos-ui.js';
import { abrirRespostas, dataBR, dataHoraBR, porPergunta } from './checkin-respostas-ui.js';
import { listarPacientes } from './pacientes.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const ABAS = [
  { id: 'visao',     label: 'Visão geral' },
  { id: 'modelos',   label: 'Modelos' },
  { id: 'respostas', label: 'Respostas' },
];

// ───────────────────────────────────────────────────────────
// VISÃO GERAL
// ───────────────────────────────────────────────────────────

/** Os números da operação, derivados de uma leitura só. */
export function panorama({ ocorrencias = [], modelos = [], atribuicoes = [] }, agora = new Date(), pacientes = []) {
  const sit = (o) => situacaoDaOcorrencia(o, agora);
  const seteDias = new Date(agora.getTime() - 7 * 86400000);
  const comAtribuicao = new Set(atribuicoes.filter(a => a.ativo).map(a => a.paciente_id));

  return {
    modelosAtivos: modelos.filter(m => m.status === 'ativo').length,
    pacientesComCheckin: comAtribuicao.size,
    disponiveis: ocorrencias.filter(o => sit(o) === 'disponivel').length,
    aguardando: ocorrencias.filter(o => ['disponivel', 'atrasado'].includes(sit(o))).length,
    atrasados: ocorrencias.filter(o => sit(o) === 'atrasado').length,
    respondidosSemana: ocorrencias.filter(o =>
      o.status === 'respondido' && o.respondido_em && new Date(o.respondido_em) >= seteDias).length,
    semCheckin: pacientes.filter(p => !comAtribuicao.has(p.id)).length,
  };
}

export function indicadoresHtml(n) {
  const item = (rot, v, destaque = false) => `
    <div class="ck-ind ${destaque && v > 0 ? 'destaque' : ''}">
      <span class="ck-ind-n">${v}</span><span class="ck-ind-r">${esc(rot)}</span>
    </div>`;
  return `
    <div class="ck-inds">
      ${item('Modelos ativos', n.modelosAtivos)}
      ${item('Pacientes com check-in', n.pacientesComCheckin)}
      ${item('Aguardando resposta', n.aguardando)}
      ${item('Atrasados', n.atrasados, true)}
      ${item('Respondidos (7 dias)', n.respondidosSemana)}
      ${item('Sem check-in ativo', n.semCheckin)}
    </div>`;
}

// ───────────────────────────────────────────────────────────
// LINHA DE OCORRÊNCIA
// ───────────────────────────────────────────────────────────

export function ocorrenciaHtml(o, { comPaciente = false } = {}) {
  const sit = situacaoDaOcorrencia(o);
  const nome = o.paciente?.nome || '';
  const modelo = o.modelo?.nome || o.snapshot?.modelo?.nome || 'Check-in';
  return `
    <div class="ck-oc" data-oc="${esc(o.id)}">
      <div class="ck-oc-txt">
        ${comPaciente && nome ? `
          <button class="ck-oc-quem" type="button" data-ir-paciente="${esc(o.paciente_id)}">
            <i data-lucide="user"></i>${esc(nome)}
          </button>` : ''}
        <div class="ck-oc-modelo">${esc(modelo)}</div>
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

export function vazioHtml(t, s, acao = '') {
  return `
    <div class="ck-vazio">
      <i data-lucide="clipboard-check"></i>
      <div class="ck-vazio-t">${esc(t)}</div>
      ${s ? `<div class="ck-vazio-s">${esc(s)}</div>` : ''}
      ${acao}
    </div>`;
}

export const skeletonHtml = (n = 3) => `<div class="ck-lista">${'<div class="ck-sk"></div>'.repeat(n)}</div>`;

export function cascaHtml(abaAtiva, pacientes = [], modelos = []) {
  return `
    <div class="ck">
      <div class="ck-head">
        <div>
          <h2>Check-ins</h2>
          <p class="ck-sub">Acompanhe evolução, adesão e bem-estar dos seus pacientes entre as consultas.</p>
        </div>
        <button class="btn-sm" data-novo-modelo><i data-lucide="plus"></i> Novo modelo</button>
      </div>

      <nav class="ck-abas" role="tablist">
        ${ABAS.map(a => `
          <button class="ck-aba ${a.id === abaAtiva ? 'ativa' : ''}" data-aba="${a.id}"
                  role="tab" aria-selected="${a.id === abaAtiva}">${esc(a.label)}</button>`).join('')}
      </nav>

      <div class="ck-filtros" data-filtros ${abaAtiva === 'respostas' ? '' : 'hidden'}>
        <div class="ck-campos">
          <select class="ck-select" data-f-paciente aria-label="Filtrar por paciente">
            <option value="">Todos os pacientes</option>
            ${pacientes.map(p => `<option value="${esc(p.id)}">${esc(p.nome || '(sem nome)')}</option>`).join('')}
          </select>
          <select class="ck-select" data-f-modelo aria-label="Filtrar por modelo">
            <option value="">Todos os modelos</option>
            ${modelos.map(m => `<option value="${esc(m.id)}">${esc(m.nome)}</option>`).join('')}
          </select>
          <select class="ck-select" data-f-situacao aria-label="Filtrar por situação">
            <option value="">Todas as situações</option>
            <option value="disponivel">Disponível</option>
            <option value="atrasado">Atrasado</option>
            <option value="respondido">Respondido</option>
          </select>
          <button class="ck-limpar" type="button" data-limpar hidden><i data-lucide="x"></i> Limpar filtros</button>
        </div>
      </div>

      <div data-corpo>${skeletonHtml()}</div>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// A PÁGINA
// ───────────────────────────────────────────────────────────

export async function initCheckins({ cont, irParaFicha } = {}) {
  const alvo = typeof cont === 'string' ? document.getElementById(cont) : cont;
  if (!alvo) return;

  let aba = 'visao';
  let pacientes = [], modelos = [];
  try {
    [pacientes, modelos] = await Promise.all([
      listarPacientes().catch(() => []),
      listarModelos({ incluirArquivados: true }).catch(() => []),
    ]);
  } catch (e) { console.error('[check-in]', e); }

  const $ = (s) => alvo.querySelector(s);

  function desenhar() {
    alvo.innerHTML = cascaHtml(aba, pacientes, modelos);
    window.lucide?.createIcons?.();
    ligarCasca();
    render();
  }

  function ligarCasca() {
    alvo.querySelectorAll('[data-aba]').forEach(b =>
      b.addEventListener('click', () => { aba = b.dataset.aba; desenhar(); }));
    $('[data-novo-modelo]')?.addEventListener('click', async () => {
      const { abrirModeloDrawer } = await import('./checkin-modelos-ui.js');
      abrirModeloDrawer({ aoSalvar: () => { aba = 'modelos'; desenhar(); } });
    });
    ['[data-f-paciente]', '[data-f-modelo]', '[data-f-situacao]'].forEach(s =>
      $(s)?.addEventListener('change', render));
    $('[data-limpar]')?.addEventListener('click', () => {
      ['[data-f-paciente]', '[data-f-modelo]', '[data-f-situacao]'].forEach(s => { if ($(s)) $(s).value = ''; });
      render();
    });
  }

  const temFiltro = () =>
    Boolean($('[data-f-paciente]')?.value || $('[data-f-modelo]')?.value || $('[data-f-situacao]')?.value);

  async function render() {
    const corpo = $('[data-corpo]');
    corpo.innerHTML = skeletonHtml();

    if (aba === 'modelos') {
      await renderModelos(corpo, { aoMudar: async () => {
        modelos = await listarModelos({ incluirArquivados: true }).catch(() => modelos);
      } });
      return;
    }

    try {
      if (aba === 'visao') {
        const dados = await panoramaCheckins();
        const n = panorama(dados, new Date(), pacientes);
        const aguardando = (dados.ocorrencias || [])
          .filter(o => ['disponivel', 'atrasado'].includes(situacaoDaOcorrencia(o)))
          .slice(0, 20);
        corpo.innerHTML = `
          ${indicadoresHtml(n)}
          <h3 class="ck-secao">Aguardando resposta</h3>
          ${aguardando.length
            ? `<div class="ck-lista">${aguardando.map(o => ocorrenciaHtml(o, { comPaciente: true })).join('')}</div>`
            : vazioHtml('Nada aguardando resposta.', 'Quando um check-in ficar disponível, ele aparece aqui.')}`;
        window.lucide?.createIcons?.();
        ligarLista(corpo, []);
        return;
      }

      // Respostas
      const itens = await listarOcorrenciasGlobais({
        pacienteId: $('[data-f-paciente]').value || null,
        modeloId: $('[data-f-modelo]').value || null,
      });
      const sitFiltro = $('[data-f-situacao]').value;
      // "atrasado" é derivado — filtrar no banco exigiria repetir a regra de
      // data em SQL, e passaria a haver duas definições da mesma coisa.
      const lista = sitFiltro ? itens.filter(o => situacaoDaOcorrencia(o) === sitFiltro) : itens;
      $('[data-limpar]').hidden = !temFiltro();

      corpo.innerHTML = lista.length
        ? `<div class="ck-lista">${lista.map(o => ocorrenciaHtml(o, { comPaciente: true })).join('')}</div>`
        : temFiltro()
          ? vazioHtml('Nenhum check-in com estes filtros.', '', '<button class="btn-sm btn-sm-secondary" data-limpar2>Limpar filtros</button>')
          : vazioHtml('Nenhum check-in respondido.', 'Atribua um modelo a um paciente na ficha dele para começar.');
      window.lucide?.createIcons?.();
      ligarLista(corpo, lista);
      corpo.querySelector('[data-limpar2]')?.addEventListener('click', () => $('[data-limpar]')?.click());
    } catch (e) {
      console.error('[check-in]', e);
      corpo.innerHTML = vazioHtml(traduzirErroCheckin(e?.message), '',
        '<button class="btn-sm" data-retry>Tentar novamente</button>');
      corpo.querySelector('[data-retry]')?.addEventListener('click', render);
    }
  }

  function ligarLista(corpo, lista) {
    corpo.querySelectorAll('[data-ir-paciente]').forEach(b =>
      b.addEventListener('click', () => irParaFicha?.(b.dataset.irPaciente)));
    corpo.querySelectorAll('[data-ver]').forEach(b =>
      b.addEventListener('click', async () => {
        const o = lista.find(x => x.id === b.dataset.ver)
          || (await listarOcorrenciasGlobais({ limite: 300 })).find(x => x.id === b.dataset.ver);
        if (o) abrirRespostas({ ocorrencia: o, carregar: carregarRespostas });
      }));
  }

  desenhar();
}

/**
 * As respostas desta ocorrência e as da ANTERIOR do mesmo modelo.
 *
 * Nenhuma consulta a `checkin_perguntas`: o texto vem do snapshot, e é isso
 * que impede editar o modelo de mudar visualmente o passado.
 */
export async function carregarRespostas(oc) {
  const respostas = await respostasDaOcorrencia(oc.id);
  let anteriores = [];
  try {
    const ultimas = await ultimosRespondidos(oc.paciente_id, 5);
    const anterior = ultimas.find(u => u.id !== oc.id && u.modelo_id === oc.modelo_id);
    if (anterior) anteriores = await respostasDaOcorrencia(anterior.id);
  } catch (e) { /* comparação é bônus; a leitura principal não depende dela */ }
  return { respostas, anteriores };
}

export { porPergunta };
